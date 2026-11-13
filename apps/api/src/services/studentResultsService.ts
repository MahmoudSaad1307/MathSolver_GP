import type { PrismaClient } from '@prisma/client';
import type { AttemptStatus, ReportMisreadInput } from '@mathlens/shared';
import type { AppEnv } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import { writeAuditLog } from '../lib/scoping.js';
import { computeAttemptRollup } from './gradingOrchestrator.js';
import type { StorageAdapter } from './storage/index.js';

export interface TranscribedLineView {
  lineNumber: number;
  textLatex: string;
  confidence: number;
  hasUnsure: boolean;
  illegible: boolean;
  crossedOut: boolean;
}

export interface CriterionBreakdownView {
  criterionId?: string;
  key: string;
  descriptionEn: string;
  descriptionAr: string;
  awardedPoints: number;
  maxPoints: number;
  commentAr: string;
}

export type StudentQuestionStatusChip = 'GRADING' | 'GRADED' | 'NEEDS_REVIEW' | 'OVERRIDDEN';

export function extractTranscribedLines(transcriptionJson: unknown): TranscribedLineView[] {
  if (!transcriptionJson || typeof transcriptionJson !== 'object') {
    return [];
  }
  const rawLines: unknown[] = (transcriptionJson as { lines?: unknown[] }).lines ?? [];
  if (!Array.isArray(rawLines)) {
    return [];
  }
  const parsed: TranscribedLineView[] = [];
  for (let idx = 0; idx < rawLines.length; idx += 1) {
    const item = rawLines[idx];
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const lineNumber = typeof rec.lineNumber === 'number' ? rec.lineNumber : idx + 1;
    const textLatex = typeof rec.textLatex === 'string' ? rec.textLatex : '';
    const confidence = typeof rec.confidence === 'number' ? rec.confidence : 0;
    parsed.push({
      lineNumber,
      textLatex,
      confidence,
      hasUnsure: Boolean(rec.hasUnsure),
      illegible: Boolean(rec.illegible),
      crossedOut: Boolean(rec.crossedOut),
    });
  }
  return parsed.sort((a, b) => a.lineNumber - b.lineNumber);
}

export function extractAiCriteriaList(
  rawCriteriaScores: unknown,
): Array<{ key: string; awardedPoints: number; maxPoints: number; commentAr: string }> {
  if (!Array.isArray(rawCriteriaScores)) return [];
  return rawCriteriaScores
    .filter(
      (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object',
    )
    .map((rec) => ({
      key:
        typeof rec.criterionKey === 'string'
          ? rec.criterionKey
          : typeof rec.key === 'string'
            ? rec.key
            : '',
      awardedPoints: typeof rec.awardedPoints === 'number' ? rec.awardedPoints : 0,
      maxPoints: typeof rec.maxPoints === 'number' ? rec.maxPoints : 0,
      commentAr: typeof rec.commentAr === 'string' ? rec.commentAr : '',
    }))
    .filter((entry) => entry.key.length > 0);
}

export function extractOverrideCriteriaList(
  rawNewCriteriaScores: unknown,
): Array<{ criterionId: string; key: string; awarded: number; commentAr: string }> {
  if (!Array.isArray(rawNewCriteriaScores)) return [];
  return rawNewCriteriaScores
    .filter(
      (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object',
    )
    .map((rec) => ({
      criterionId: typeof rec.criterionId === 'string' ? rec.criterionId : '',
      key: typeof rec.key === 'string' ? rec.key : '',
      awarded:
        typeof rec.awarded === 'number'
          ? rec.awarded
          : typeof rec.awardedPoints === 'number'
            ? rec.awardedPoints
            : 0,
      commentAr: typeof rec.commentAr === 'string' ? rec.commentAr : '',
    }))
    .filter((entry) => entry.criterionId.length > 0 || entry.key.length > 0);
}

export class StudentResultsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly env: AppEnv,
    private readonly storage: StorageAdapter,
  ) {}

  async getAttemptResults(studentId: string, attemptId: string) {
    const attempt = await this.prisma.attempt.findFirst({
      where: { id: attemptId, studentId },
    });
    if (!attempt) {
      throw new AppError('NOT_FOUND');
    }

    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      include: { cohort: true },
    });
    if (
      !student ||
      student.deletedAt !== null ||
      !student.cohort ||
      student.cohort.deletedAt !== null
    ) {
      throw new AppError('NOT_FOUND');
    }

    const topic = await this.prisma.topic.findFirst({
      where: { id: student.cohort.topicId, deletedAt: null },
    });
    if (!topic) {
      throw new AppError('NOT_FOUND');
    }

    if (attempt.status === 'IN_PROGRESS') {
      throw new AppError('CONFLICT', {
        messageEn: 'Exam must be submitted before viewing results.',
        messageAr: 'يجب تسليم الاختبار أولاً قبل عرض النتائج.',
      });
    }

    const examModel = await this.prisma.examModel.findFirst({
      where: { id: attempt.examModelId, deletedAt: null },
      include: {
        questions: true,
      },
    });
    if (!examModel) {
      throw new AppError('NOT_FOUND');
    }

    const rawQuestions = examModel.questions
      .filter((q) => q.deletedAt === null)
      .sort((a, b) => a.orderIndex - b.orderIndex);
    const questionIds = rawQuestions.map((q) => q.id);

    const [mcqOptions, rubricCriteria, answers] = await Promise.all([
      questionIds.length
        ? this.prisma.mcqOption.findMany({
            where: { questionId: { in: questionIds }, deletedAt: null },
          })
        : Promise.resolve([]),
      questionIds.length
        ? this.prisma.rubricCriterion.findMany({
            where: { questionId: { in: questionIds }, deletedAt: null },
            orderBy: { orderIndex: 'asc' },
          })
        : Promise.resolve([]),
      this.prisma.answer.findMany({
        where: { attemptId: attempt.id },
      }),
    ]);

    const answerIds = answers.map((a) => a.id);
    const [images, gradingResults] = await Promise.all([
      answerIds.length
        ? this.prisma.answerImage.findMany({
            where: { answerId: { in: answerIds }, deletedAt: null },
            orderBy: { createdAt: 'asc' },
          })
        : Promise.resolve([]),
      answerIds.length
        ? this.prisma.gradingResult.findMany({
            where: { answerId: { in: answerIds } },
            orderBy: { version: 'desc' },
          })
        : Promise.resolve([]),
    ]);

    const gradingResultIds = gradingResults.map((g) => g.id);
    const overrides = gradingResultIds.length
      ? await this.prisma.teacherOverride.findMany({
          where: { gradingResultId: { in: gradingResultIds } },
          orderBy: { createdAt: 'desc' },
        })
      : [];

    const optionsByQuestion = new Map<string, typeof mcqOptions>();
    for (const opt of mcqOptions) {
      const list = optionsByQuestion.get(opt.questionId) ?? [];
      list.push(opt);
      optionsByQuestion.set(opt.questionId, list);
    }

    const rubricByQuestion = new Map<string, typeof rubricCriteria>();
    for (const crit of rubricCriteria) {
      const list = rubricByQuestion.get(crit.questionId) ?? [];
      list.push(crit);
      rubricByQuestion.set(crit.questionId, list);
    }

    const answerByQuestion = new Map(answers.map((a) => [a.questionId, a]));
    const imagesByAnswer = new Map<string, typeof images>();
    for (const img of images) {
      const list = imagesByAnswer.get(img.answerId) ?? [];
      list.push(img);
      imagesByAnswer.set(img.answerId, list);
    }

    const overridesByResult = new Map<string, typeof overrides>();
    for (const ov of overrides) {
      const list = overridesByResult.get(ov.gradingResultId) ?? [];
      list.push(ov);
      overridesByResult.set(ov.gradingResultId, list);
    }

    const latestResultByAnswer = new Map<string, (typeof gradingResults)[number]>();
    for (const gr of gradingResults) {
      if (!latestResultByAnswer.has(gr.answerId)) {
        latestResultByAnswer.set(gr.answerId, gr);
      }
    }

    const showProvisional = student.cohort.showProvisionalScore;
    const scoreHidden =
      attempt.status === 'SUBMITTED' ||
      attempt.status === 'GRADING' ||
      (attempt.status === 'NEEDS_REVIEW' && !showProvisional);
    const isProvisional = attempt.status === 'NEEDS_REVIEW';

    const questionViews = await Promise.all(
      rawQuestions.map(async (q) => {
        const answer = answerByQuestion.get(q.id) ?? null;
        const answerImages = answer ? (imagesByAnswer.get(answer.id) ?? []) : [];
        const latestResult = answer ? (latestResultByAnswer.get(answer.id) ?? null) : null;
        const resultOverrides = latestResult ? (overridesByResult.get(latestResult.id) ?? []) : [];
        const latestOverride = resultOverrides[0] ?? null;

        let statusChip: StudentQuestionStatusChip = 'GRADED';
        let displayScore: number | null = answer?.score ?? 0;

        if (q.type === 'ESSAY') {
          if (latestOverride) {
            statusChip = 'OVERRIDDEN';
            displayScore = latestOverride.newTotal;
          } else if (!latestResult) {
            if (
              answerImages.length === 0 &&
              (attempt.status === 'GRADED' || attempt.status === 'FINAL')
            ) {
              statusChip = 'GRADED';
              displayScore = answer?.score ?? 0;
            } else {
              statusChip = 'GRADING';
              displayScore = null;
            }
          } else if (latestResult.needsReview) {
            statusChip = 'NEEDS_REVIEW';
            displayScore = showProvisional ? latestResult.aiTotal : null;
          } else {
            statusChip = 'GRADED';
            displayScore = answer?.score ?? latestResult.aiTotal;
          }
        }

        const criteria = (rubricByQuestion.get(q.id) ?? []).sort(
          (a, b) => a.orderIndex - b.orderIndex,
        );
        const aiCriteria = extractAiCriteriaList(latestResult?.criteriaScores);
        const overrideCriteria = extractOverrideCriteriaList(latestOverride?.newCriteriaScores);

        const criteriaBreakdown: CriterionBreakdownView[] = criteria.map((crit) => {
          const ov =
            overrideCriteria.find((c) => c.criterionId === crit.id || c.key === crit.key) ?? null;
          const ai = aiCriteria.find((c) => c.key === crit.key) ?? null;
          const awarded =
            ov !== null
              ? ov.awarded
              : statusChip === 'GRADING' || (statusChip === 'NEEDS_REVIEW' && !showProvisional)
                ? 0
                : (ai?.awardedPoints ?? 0);
          return {
            criterionId: crit.id,
            key: crit.key,
            descriptionEn: crit.descriptionEn,
            descriptionAr: crit.descriptionAr,
            awardedPoints: awarded,
            maxPoints: crit.maxPoints,
            commentAr: ov?.commentAr || ai?.commentAr || '',
          };
        });

        const signedImages = await Promise.all(
          answerImages.map(async (img) => ({
            id: img.id,
            signedUrl: await this.storage.getSignedUrl(img.storageKey, 900),
            width: img.width,
            height: img.height,
          })),
        );

        const numericForThreshold =
          displayScore !== null
            ? displayScore
            : latestOverride
              ? latestOverride.newTotal
              : latestResult
                ? latestResult.aiTotal
                : null;
        const belowThreshold =
          q.type === 'MCQ'
            ? answer?.isCorrect === false
            : numericForThreshold !== null
              ? numericForThreshold < q.points * topic.correctnessThreshold
              : false;

        const transcribedLines = latestResult
          ? extractTranscribedLines(latestResult.transcriptionJson)
          : [];

        const showDetailedFeedback =
          q.type === 'ESSAY' &&
          (statusChip === 'GRADED' ||
            statusChip === 'OVERRIDDEN' ||
            (statusChip === 'NEEDS_REVIEW' && showProvisional));

        return {
          questionId: q.id,
          answerId: answer?.id ?? null,
          orderIndex: q.orderIndex,
          conceptKey: q.conceptKey,
          type: q.type,
          promptLatex: q.promptLatex,
          points: q.points,
          videoTimestampSeconds: q.videoTimestampSeconds,
          statusChip,
          score: displayScore,
          isCorrect: answer?.isCorrect ?? null,
          belowThreshold,
          // Answer key (isCorrect on options) & modelAnswer are strictly redacted for students.
          mcqOptions: (optionsByQuestion.get(q.id) ?? []).map((opt) => ({
            id: opt.id,
            label: opt.label,
            textLatex: opt.textLatex,
          })),
          selectedOptionId: answer?.selectedOptionId ?? null,
          images: signedImages,
          transcribedLines,
          firstErrorStep: showDetailedFeedback ? (latestResult?.firstErrorStep ?? null) : null,
          errorType: showDetailedFeedback ? (latestResult?.errorType ?? null) : null,
          errorExplanationAr:
            latestOverride?.newExplanationAr ??
            (showDetailedFeedback ? (latestResult?.errorExplanationAr ?? null) : null),
          hintAr: showDetailedFeedback ? (latestResult?.hintAr ?? null) : null,
          teacherNote: latestOverride?.note ?? null,
          criteriaBreakdown: showDetailedFeedback ? criteriaBreakdown : [],
          misreadReportedAt: answer?.misreadReportedAt
            ? answer.misreadReportedAt.toISOString()
            : null,
          misreadNote: answer?.misreadNote ?? null,
        };
      }),
    );

    const statusCounts = {
      totalQuestions: questionViews.length,
      gradedCount: questionViews.filter(
        (q) => q.statusChip === 'GRADED' || q.statusChip === 'OVERRIDDEN',
      ).length,
      gradingCount: questionViews.filter((q) => q.statusChip === 'GRADING').length,
      needsReviewCount: questionViews.filter((q) => q.statusChip === 'NEEDS_REVIEW').length,
    };

    return {
      attempt: {
        id: attempt.id,
        examModelId: attempt.examModelId,
        modelNumber: examModel.modelNumber,
        title: examModel.title,
        status: attempt.status,
        startedAt: attempt.startedAt.toISOString(),
        submittedAt: attempt.submittedAt ? attempt.submittedAt.toISOString() : null,
        maxScore: attempt.maxScore,
        totalScore: scoreHidden ? null : attempt.totalScore,
        percentage: scoreHidden ? null : attempt.percentage,
        scoreHidden,
        isProvisional,
        scoreSource: attempt.scoreSource,
      },
      topic: {
        id: topic.id,
        title: topic.title,
        videoId: topic.videoId,
        minWatchSeconds: topic.minWatchSeconds,
        correctnessThreshold: topic.correctnessThreshold,
      },
      cohort: {
        id: student.cohort.id,
        group: student.cohort.group,
        requireVideoBeforePost: student.cohort.requireVideoBeforePost,
        showProvisionalScore: showProvisional,
      },
      statusCounts,
      questions: questionViews,
    };
  }

  async reportMisread(studentId: string, answerId: string, input: ReportMisreadInput, ip?: string) {
    const answer = await this.prisma.answer.findFirst({
      where: { id: answerId },
    });
    if (!answer) {
      throw new AppError('NOT_FOUND');
    }

    const attempt = await this.prisma.attempt.findFirst({
      where: { id: answer.attemptId, studentId },
    });
    if (!attempt) {
      throw new AppError('NOT_FOUND');
    }

    if (attempt.status === 'IN_PROGRESS') {
      throw new AppError('CONFLICT', {
        messageEn: 'Submit your exam before reporting a transcription misread.',
        messageAr: 'يرجى تسليم الاختبار أولاً قبل الإبلاغ عن خطأ في القراءة.',
      });
    }

    const question = await this.prisma.question.findFirst({
      where: { id: answer.questionId, deletedAt: null },
    });
    if (!question || question.type !== 'ESSAY') {
      throw new AppError('VALIDATION_ERROR', {
        messageEn: 'Misread reporting is only available for handwritten essay questions.',
        messageAr: 'الإبلاغ عن خطأ القراءة متاح فقط للأسئلة المقالية.',
      });
    }

    const now = new Date();
    const cleanedNote = input.note?.trim() ? input.note.trim() : null;

    const outcome = await this.prisma.$transaction(async (tx) => {
      const updatedAnswer = await tx.answer.update({
        where: { id: answer.id },
        data: {
          misreadReportedAt: now,
          misreadNote: cleanedNote,
        },
      });

      const gradingResults = await tx.gradingResult.findMany({
        where: { answerId: answer.id },
        orderBy: { version: 'desc' },
      });
      const latestResult = gradingResults[0] ?? null;

      if (latestResult) {
        const nextReasons = latestResult.reviewReasons.includes('STUDENT_REPORTED_MISREAD')
          ? latestResult.reviewReasons
          : [...latestResult.reviewReasons, 'STUDENT_REPORTED_MISREAD'];

        await tx.gradingResult.update({
          where: { id: latestResult.id },
          data: {
            needsReview: true,
            reviewReasons: nextReasons,
          },
        });
      }

      const attemptAnswers = await tx.answer.findMany({
        where: { attemptId: attempt.id },
      });
      const attemptAnswerIds = attemptAnswers.map((a) => a.id);

      const [allQuestions, allImages, allResults] = await Promise.all([
        tx.question.findMany({
          where: { examModelId: attempt.examModelId, deletedAt: null },
        }),
        attemptAnswerIds.length
          ? tx.answerImage.findMany({
              where: { answerId: { in: attemptAnswerIds }, deletedAt: null },
            })
          : Promise.resolve([]),
        attemptAnswerIds.length
          ? tx.gradingResult.findMany({
              where: { answerId: { in: attemptAnswerIds } },
              orderBy: { version: 'desc' },
            })
          : Promise.resolve([]),
      ]);

      const allResultIds = allResults.map((g) => g.id);
      const allOverrides = allResultIds.length
        ? await tx.teacherOverride.findMany({
            where: { gradingResultId: { in: allResultIds } },
            orderBy: { createdAt: 'desc' },
          })
        : [];

      const qTypeMap = new Map(allQuestions.map((q) => [q.id, q.type]));
      const imgsMap = new Map<string, typeof allImages>();
      for (const img of allImages) {
        const list = imgsMap.get(img.answerId) ?? [];
        list.push(img);
        imgsMap.set(img.answerId, list);
      }
      const ovMap = new Map<string, typeof allOverrides>();
      for (const ov of allOverrides) {
        const list = ovMap.get(ov.gradingResultId) ?? [];
        list.push(ov);
        ovMap.set(ov.gradingResultId, list);
      }
      const grMap = new Map<
        string,
        Array<(typeof allResults)[number] & { overrides: typeof allOverrides }>
      >();
      for (const gr of allResults) {
        const list = grMap.get(gr.answerId) ?? [];
        list.push({ ...gr, overrides: ovMap.get(gr.id) ?? [] });
        grMap.set(gr.answerId, list);
      }

      const rollup = computeAttemptRollup({
        id: attempt.id,
        maxScore: attempt.maxScore,
        answers: attemptAnswers.map((a) => ({
          id: a.id,
          score: a.score,
          maxScore: a.maxScore,
          question: { type: qTypeMap.get(a.questionId) ?? 'ESSAY' },
          images: imgsMap.get(a.id) ?? [],
          gradingResults: grMap.get(a.id) ?? [],
        })),
      });

      const nextStatus: AttemptStatus = 'NEEDS_REVIEW';
      await tx.attempt.update({
        where: { id: attempt.id },
        data: {
          status: nextStatus,
          totalScore: rollup.totalScore,
          percentage: rollup.percentage,
          scoreSource: rollup.scoreSource,
        },
      });

      await writeAuditLog(tx, this.env, {
        actorType: 'STUDENT',
        actorId: studentId,
        action: 'STUDENT_REPORT_MISREAD',
        entity: 'Answer',
        entityId: answer.id,
        diff: {
          attemptId: attempt.id,
          hasNote: Boolean(cleanedNote),
          gradingResultId: latestResult?.id ?? null,
        },
        ip,
      });

      return {
        answerId: updatedAnswer.id,
        attemptId: attempt.id,
        attemptStatus: nextStatus,
        misreadReportedAt: now.toISOString(),
        misreadNote: cleanedNote,
      };
    });

    return outcome;
  }
}
