import type { Prisma, PrismaClient } from '@prisma/client';

function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}
import type { ReviewReason, ScoreSource } from '@mathlens/shared';
import type { AppEnv } from '../config/env.js';
import type { Logger } from '../lib/logger.js';
import { aiCostCounter, gradingErrorCounter, gradingLatencyHistogram } from '../lib/metrics.js';
import type { AiCriterionScore, AiServiceClient } from './aiClient.js';
import type { EssayGradingJobPayload } from './gradingDispatcher.js';
import type { StorageAdapter } from './storage/index.js';

function startOfUtcDay(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
}

function roundTwo(val: number): number {
  return Math.round(val * 100) / 100;
}

/**
 * Recompute per-criterion scores server-side and enforce criterion max caps (Principle #2).
 */
export function boundAndRecomputeCriteriaScores(
  rawScores: AiCriterionScore[],
  rubricCriteria: Array<{ key: string; maxPoints: number }>,
): {
  boundedScores: AiCriterionScore[];
  recomputedTotal: number;
  cappedMismatch: boolean;
} {
  const byKey = new Map<string, AiCriterionScore>();
  for (const item of rawScores) {
    byKey.set(item.criterionKey, item);
  }

  let running = 0;
  let totalMax = 0;
  let cappedMismatch = false;

  const boundedScores: AiCriterionScore[] = rubricCriteria.map((crit) => {
    totalMax += crit.maxPoints;
    const match = byKey.get(crit.key);
    const rawPts = match ? Number(match.awardedPoints) : 0;
    if (!Number.isFinite(rawPts) || rawPts < 0 || rawPts > crit.maxPoints) {
      cappedMismatch = true;
    }
    const clamped = roundTwo(
      Math.min(Math.max(0, Number.isFinite(rawPts) ? rawPts : 0), crit.maxPoints),
    );
    running += clamped;
    return {
      criterionKey: crit.key,
      awardedPoints: clamped,
      maxPoints: crit.maxPoints,
      met: clamped >= crit.maxPoints - 1e-6,
      evidenceStep: match?.evidenceStep ?? null,
      commentAr: match?.commentAr ?? '',
    };
  });

  const recomputedTotal = roundTwo(Math.min(Math.max(0, running), totalMax));
  return { boundedScores, recomputedTotal, cappedMismatch };
}

export interface AttemptRollupCandidate {
  id: string;
  maxScore: number;
  answers: Array<{
    id: string;
    score: number | null;
    maxScore: number;
    question: { type: 'MCQ' | 'ESSAY' };
    images: Array<{ id: string }>;
    gradingResults: Array<{
      id: string;
      needsReview: boolean;
      overrides: Array<{ id: string }>;
    }>;
  }>;
}

export function computeAttemptRollup(attempt: AttemptRollupCandidate): {
  allReady: boolean;
  status: 'GRADING' | 'NEEDS_REVIEW' | 'GRADED' | 'FINAL';
  totalScore: number | null;
  percentage: number | null;
  scoreSource: ScoreSource | null;
} {
  let pendingEssay = false;
  let hasNeedsReview = false;
  let hasOverride = false;
  let hasAi = false;
  let hasAuto = false;
  let runningTotal = 0;

  for (const ans of attempt.answers) {
    if (ans.question.type === 'MCQ') {
      hasAuto = true;
      runningTotal += ans.score ?? 0;
      continue;
    }

    if (ans.images.length === 0) {
      hasAuto = true;
      runningTotal += ans.score ?? 0;
      continue;
    }

    const latest = ans.gradingResults[0];
    const overrideCount = latest?.overrides.length ?? 0;
    const isResolvedByOverride = overrideCount > 0;

    if (ans.score === null && !isResolvedByOverride) {
      pendingEssay = true;
      continue;
    }

    runningTotal += ans.score ?? 0;
    if (isResolvedByOverride) {
      hasOverride = true;
    } else if (latest) {
      hasAi = true;
      if (latest.needsReview) {
        hasNeedsReview = true;
      }
    }
  }

  if (pendingEssay) {
    return {
      allReady: false,
      status: 'GRADING',
      totalScore: null,
      percentage: null,
      scoreSource: null,
    };
  }

  const totalScore = roundTwo(runningTotal);
  const percentage = attempt.maxScore > 0 ? roundTwo((totalScore / attempt.maxScore) * 100) : 0;

  let scoreSource: ScoreSource = 'AUTO';
  if (hasOverride && !hasAi && !hasAuto) {
    scoreSource = 'TEACHER_OVERRIDE';
  } else if (hasAi && !hasOverride && !hasAuto) {
    scoreSource = 'AI';
  } else if (hasAi || hasOverride) {
    scoreSource = 'MIXED';
  }

  const status = hasNeedsReview ? 'NEEDS_REVIEW' : hasOverride ? 'FINAL' : 'GRADED';
  return {
    allReady: true,
    status,
    totalScore,
    percentage,
    scoreSource,
  };
}

export class GradingOrchestrator {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly env: AppEnv,
    private readonly storage: StorageAdapter,
    private readonly aiClient: AiServiceClient,
    private readonly logger: Logger,
  ) {}

  private async checkBudgetCaps(studentId: string): Promise<string | null> {
    const dayStart = startOfUtcDay();

    const dailyAgg = await this.prisma.aiUsage.aggregate({
      where: { createdAt: { gte: dayStart } },
      _sum: { costUsd: true },
    });
    const spentToday = dailyAgg._sum.costUsd ?? 0;
    if (spentToday >= this.env.AI_DAILY_CAP_USD) {
      return 'DAILY_USD_CAP_EXCEEDED';
    }

    const studentCallsToday = await this.prisma.gradingResult.count({
      where: {
        createdAt: { gte: dayStart },
        answer: { attempt: { studentId } },
      },
    });
    if (studentCallsToday >= this.env.AI_STUDENT_DAILY_CALL_CAP) {
      return 'STUDENT_DAILY_CALL_CAP_EXCEEDED';
    }

    return null;
  }

  async processEssayGradingJob(payload: EssayGradingJobPayload): Promise<{
    gradingResultId: string;
    needsReview: boolean;
    attemptStatus: string;
  }> {
    const { answerId, attemptId, studentId, forceRefresh = false } = payload;

    const answer = await this.prisma.answer.findFirst({
      where: { id: answerId, attemptId },
      include: {
        attempt: {
          include: {
            examModel: {
              include: { topic: true },
            },
          },
        },
        question: {
          include: {
            modelAnswer: true,
            rubricCriteria: { where: { deletedAt: null }, orderBy: { orderIndex: 'asc' } },
          },
        },
        images: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
        gradingResults: { orderBy: { version: 'desc' }, take: 1 },
      },
    });

    if (!answer) {
      throw new Error(`Answer ${answerId} not found for grading`);
    }

    const nextVersion = (answer.gradingResults[0]?.version ?? 0) + 1;

    if (answer.images.length === 0) {
      return this.persistFallbackResult({
        answerId,
        attemptId,
        version: nextVersion,
        rubricVersion: answer.question.modelAnswer?.rubricVersion ?? 1,
        criteria: answer.question.rubricCriteria,
        reason: 'EMPTY_SUBMISSION',
        explanationAr: 'لم تُرفع صور حل لهذا السؤال.',
        errorCode: 'EMPTY_SUBMISSION',
      });
    }

    if (!answer.question.modelAnswer || answer.question.rubricCriteria.length === 0) {
      return this.persistFallbackResult({
        answerId,
        attemptId,
        version: nextVersion,
        rubricVersion: 1,
        criteria: answer.question.rubricCriteria,
        reason: 'AI_SERVICE_FAILED',
        explanationAr: 'نموذج الإجابة أو معايير التصحيح غير مكتملة؛ يتطلب مراجعة المعلم.',
        errorCode: 'MISSING_RUBRIC',
      });
    }

    const capError = await this.checkBudgetCaps(studentId);
    if (capError) {
      this.logger.warn(
        { studentId, answerId, capError },
        'AI budget cap reached; routing to human review',
      );
      gradingErrorCounter.inc({ code: capError });
      return this.persistFallbackResult({
        answerId,
        attemptId,
        version: nextVersion,
        rubricVersion: answer.question.modelAnswer.rubricVersion,
        criteria: answer.question.rubricCriteria,
        reason: 'AI_SERVICE_FAILED',
        explanationAr: 'تم تحويل السؤال للمراجعة اليدوية لبلوغ الحد الأقصى اليومي للتصحيح الآلي.',
        errorCode: capError,
      });
    }

    const imagePayloads = await Promise.all(
      answer.images.map(async (img) => {
        const buf = await this.storage.getObject(img.storageKey);
        return {
          dataBase64: buf.toString('base64'),
          mimeType: 'image/jpeg',
          sha256: img.sha256,
        };
      }),
    );

    const startMs = Date.now();
    try {
      const aiRes = await this.aiClient.gradeEssay({
        questionPromptLatex: answer.question.promptLatex,
        modelAnswer: {
          solutionStepsLatex: answer.question.modelAnswer.solutionStepsLatex,
          finalAnswerLatex: answer.question.modelAnswer.finalAnswerLatex,
          finalAnswerSympy: answer.question.modelAnswer.finalAnswerSympy,
          commonMistakes: answer.question.modelAnswer.commonMistakes,
        },
        rubricCriteria: answer.question.rubricCriteria.map((c) => ({
          id: c.id,
          key: c.key,
          descriptionEn: c.descriptionEn,
          descriptionAr: c.descriptionAr,
          maxPoints: c.maxPoints,
        })),
        images: imagePayloads,
        rubricVersion: answer.question.modelAnswer.rubricVersion,
        languageHint: 'ar',
        forceRefresh,
      });

      const { boundedScores, recomputedTotal, cappedMismatch } = boundAndRecomputeCriteriaScores(
        aiRes.criteriaScores,
        answer.question.rubricCriteria,
      );

      const mergedReasons = [...aiRes.reviewReasons];
      if (
        (cappedMismatch || Math.abs(aiRes.aiTotal - recomputedTotal) > 0.05) &&
        !mergedReasons.includes('TOTAL_MISMATCH')
      ) {
        mergedReasons.push('TOTAL_MISMATCH');
      }
      const needsReview = aiRes.needsReview || mergedReasons.length > 0;
      const threshold = answer.attempt.examModel.topic.correctnessThreshold ?? 0.6;
      const isCorrect =
        answer.question.points > 0
          ? recomputedTotal >= answer.question.points * threshold - 1e-6
          : false;

      const totalLatencyMs = aiRes.latencyMs > 0 ? aiRes.latencyMs : Date.now() - startMs;
      gradingLatencyHistogram.observe(totalLatencyMs / 1000);
      if (aiRes.costUsd > 0) {
        aiCostCounter.inc(aiRes.costUsd);
      }

      const saved = await this.prisma.$transaction(async (tx) => {
        const gradingRow = await tx.gradingResult.create({
          data: {
            answerId,
            version: nextVersion,
            provider: aiRes.provider,
            modelName: aiRes.modelName,
            promptVersion: aiRes.promptVersion,
            rubricVersion: aiRes.rubricVersion,
            imageHash: aiRes.imageHash,
            transcriptionJson: toJson(aiRes.transcription),
            gradingJson: toJson({
              criteriaScores: boundedScores,
              aiTotal: recomputedTotal,
              errorType: aiRes.errorType,
            }),
            criteriaScores: toJson(boundedScores),
            aiTotal: recomputedTotal,
            finalAnswerCorrect: aiRes.finalAnswerCorrect,
            firstErrorStep: aiRes.firstErrorStep,
            errorType: aiRes.errorType,
            errorExplanationAr: aiRes.errorExplanationAr,
            hintAr: aiRes.hintAr,
            confidence: aiRes.confidence,
            sympyCheck: toJson(aiRes.sympyCheck),
            needsReview,
            reviewReasons: mergedReasons,
            rawOutput: aiRes.rawOutput,
            latencyMs: totalLatencyMs,
            costUsd: aiRes.costUsd,
          },
        });

        await tx.aiUsage.create({
          data: {
            answerId,
            provider: aiRes.provider,
            modelName: aiRes.modelName,
            operation: 'grade-essay',
            inputTokens: aiRes.inputTokens,
            outputTokens: aiRes.outputTokens,
            costUsd: aiRes.costUsd,
            latencyMs: totalLatencyMs,
            success: true,
            errorCode: null,
          },
        });

        await tx.answer.update({
          where: { id: answerId },
          data: {
            score: recomputedTotal,
            isCorrect,
          },
        });

        const attemptStatus = await this.recomputeAttemptInTx(tx, attemptId);
        return { gradingResultId: gradingRow.id, needsReview, attemptStatus };
      });

      return saved;
    } catch (err) {
      const code = err instanceof Error ? err.name : 'AI_CALL_FAILED';
      gradingErrorCounter.inc({ code });
      this.logger.error({ err, answerId, attemptId }, 'AI grading call failed');

      await this.prisma.aiUsage.create({
        data: {
          answerId,
          provider: 'http-ai-client',
          modelName: 'unknown',
          operation: 'grade-essay',
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          latencyMs: Date.now() - startMs,
          success: false,
          errorCode: err instanceof Error ? err.message.slice(0, 120) : 'UNKNOWN',
        },
      });

      throw err;
    }
  }

  async persistFallbackResult(params: {
    answerId: string;
    attemptId: string;
    version: number;
    rubricVersion: number;
    criteria: Array<{ key: string; maxPoints: number }>;
    reason: ReviewReason;
    explanationAr: string;
    errorCode: string;
  }): Promise<{ gradingResultId: string; needsReview: boolean; attemptStatus: string }> {
    const zeroCriteria: AiCriterionScore[] = params.criteria.map((c) => ({
      criterionKey: c.key,
      awardedPoints: 0,
      maxPoints: c.maxPoints,
      met: false,
      evidenceStep: null,
      commentAr: params.explanationAr,
    }));

    return this.prisma.$transaction(async (tx) => {
      const gradingRow = await tx.gradingResult.create({
        data: {
          answerId: params.answerId,
          version: params.version,
          provider: 'fallback',
          modelName: 'human-review-queue',
          promptVersion: 'fallback.v1',
          rubricVersion: params.rubricVersion,
          imageHash: 'fallback',
          transcriptionJson: { lines: [], overallConfidence: 0 },
          gradingJson: { fallback: true, errorCode: params.errorCode },
          criteriaScores: toJson(zeroCriteria),
          aiTotal: 0,
          finalAnswerCorrect: false,
          firstErrorStep: null,
          errorType: 'other',
          errorExplanationAr: params.explanationAr,
          hintAr: 'سيراجع معلمك هذا السؤال ويعيد احتساب الدرجة.',
          confidence: 0,
          sympyCheck: { checked: false, status: 'NOT_APPLICABLE' },
          needsReview: true,
          reviewReasons: [params.reason],
          rawOutput: params.errorCode,
          latencyMs: 0,
          costUsd: 0,
        },
      });

      await tx.answer.update({
        where: { id: params.answerId },
        data: { score: 0, isCorrect: false },
      });

      const attemptStatus = await this.recomputeAttemptInTx(tx, params.attemptId);
      return { gradingResultId: gradingRow.id, needsReview: true, attemptStatus };
    });
  }

  private async recomputeAttemptInTx(
    tx: Pick<PrismaClient, 'attempt'>,
    attemptId: string,
  ): Promise<string> {
    const attempt = await tx.attempt.findFirst({
      where: { id: attemptId },
      include: {
        answers: {
          include: {
            question: { select: { type: true } },
            images: { where: { deletedAt: null }, select: { id: true } },
            gradingResults: {
              orderBy: { version: 'desc' },
              take: 1,
              include: { overrides: { select: { id: true } } },
            },
          },
        },
      },
    });

    if (!attempt) return 'GRADING';
    const rollup = computeAttemptRollup(attempt);

    await tx.attempt.update({
      where: { id: attempt.id },
      data: {
        status: rollup.status,
        totalScore: rollup.totalScore,
        percentage: rollup.percentage,
        scoreSource: rollup.scoreSource,
      },
    });

    return rollup.status;
  }
}
