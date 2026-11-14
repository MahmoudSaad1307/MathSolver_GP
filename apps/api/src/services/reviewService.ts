import type { Prisma, PrismaClient } from '@prisma/client';
import type {
  GradingErrorType,
  ManualGradeInput,
  ReviewQueueQuery,
  StudentsQuery,
  TeacherOverrideInput,
} from '@mathlens/shared';
import type { AppEnv } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import { writeAuditLog } from '../lib/scoping.js';
import type { GradingDispatcher } from './gradingDispatcher.js';
import { computeAttemptRollup } from './gradingOrchestrator.js';
import type { StorageAdapter } from './storage/index.js';
import { deriveStudentFlowStep } from './studentFlow.js';
import {
  extractAiCriteriaList,
  extractOverrideCriteriaList,
  extractTranscribedLines,
} from './studentResultsService.js';

function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function roundTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

interface BoundedOverrideCriteria {
  criterionId: string;
  key: string;
  descriptionEn: string;
  descriptionAr: string;
  awarded: number;
  maxPoints: number;
  commentAr: string;
  clamped: boolean;
}

function validateAndBoundTeacherCriteria(
  submitted: TeacherOverrideInput['criteriaScores'],
  rubricCriteria: Array<{
    id: string;
    key: string;
    descriptionEn: string;
    descriptionAr: string;
    maxPoints: number;
  }>,
  questionMaxPoints: number,
): { criteriaScores: BoundedOverrideCriteria[]; newTotal: number } {
  const criterionMap = new Map(rubricCriteria.map((c) => [c.id, c]));
  const submittedMap = new Map<string, (typeof submitted)[number]>();

  for (const entry of submitted) {
    if (!criterionMap.has(entry.criterionId)) {
      throw new AppError('VALIDATION_ERROR', {
        messageEn: `Unknown rubric criterion ID: ${entry.criterionId}`,
        messageAr: 'يوجد معيار تقييم غير صالح لهذا السؤال.',
      });
    }
    if (submittedMap.has(entry.criterionId)) {
      throw new AppError('VALIDATION_ERROR', {
        messageEn: `Duplicate rubric criterion ID: ${entry.criterionId}`,
        messageAr: 'تم تكرار أحد معايير التقييم.',
      });
    }
    submittedMap.set(entry.criterionId, entry);
  }

  const bounded: BoundedOverrideCriteria[] = rubricCriteria.map((crit) => {
    const sub = submittedMap.get(crit.id);
    if (!sub) {
      throw new AppError('VALIDATION_ERROR', {
        messageEn: `Missing score for rubric criterion "${crit.key}".`,
        messageAr: 'يرجى إدخال درجة لكل معايير التقييم.',
      });
    }
    const clampedAward = roundTwo(Math.max(0, Math.min(crit.maxPoints, sub.awarded)));
    return {
      criterionId: crit.id,
      key: crit.key,
      descriptionEn: crit.descriptionEn,
      descriptionAr: crit.descriptionAr,
      awarded: clampedAward,
      maxPoints: crit.maxPoints,
      commentAr: sub.commentAr?.trim() ?? '',
      clamped: clampedAward !== roundTwo(sub.awarded),
    };
  });

  const sum = roundTwo(bounded.reduce((acc, item) => acc + item.awarded, 0));
  const boundedTotal = roundTwo(Math.max(0, Math.min(questionMaxPoints, sum)));

  return {
    criteriaScores: bounded,
    newTotal: boundedTotal,
  };
}

export class ReviewService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly env: AppEnv,
    private readonly storage: StorageAdapter,
  ) {}

  private async recomputeAttemptTx(
    tx: Prisma.TransactionClient | PrismaClient,
    attemptId: string,
    examModelId: string,
    maxScore: number,
  ) {
    const [attemptAnswers, questions] = await Promise.all([
      tx.answer.findMany({ where: { attemptId } }),
      tx.question.findMany({ where: { examModelId, deletedAt: null } }),
    ]);

    const answerIds = attemptAnswers.map((a) => a.id);
    const [images, gradingResults] = await Promise.all([
      answerIds.length
        ? tx.answerImage.findMany({
            where: { answerId: { in: answerIds }, deletedAt: null },
          })
        : Promise.resolve([]),
      answerIds.length
        ? tx.gradingResult.findMany({
            where: { answerId: { in: answerIds } },
            orderBy: { version: 'desc' },
          })
        : Promise.resolve([]),
    ]);

    const resultIds = gradingResults.map((g) => g.id);
    const overrides = resultIds.length
      ? await tx.teacherOverride.findMany({
          where: { gradingResultId: { in: resultIds } },
          orderBy: { createdAt: 'desc' },
        })
      : [];

    const qTypeMap = new Map(questions.map((q) => [q.id, q.type]));
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

    const resultsByAnswer = new Map<
      string,
      Array<(typeof gradingResults)[number] & { overrides: typeof overrides }>
    >();
    for (const gr of gradingResults) {
      const list = resultsByAnswer.get(gr.answerId) ?? [];
      list.push({ ...gr, overrides: overridesByResult.get(gr.id) ?? [] });
      resultsByAnswer.set(gr.answerId, list);
    }

    const rollup = computeAttemptRollup({
      id: attemptId,
      maxScore,
      answers: attemptAnswers.map((a) => ({
        id: a.id,
        score: a.score,
        maxScore: a.maxScore,
        question: { type: qTypeMap.get(a.questionId) ?? 'ESSAY' },
        images: imagesByAnswer.get(a.id) ?? [],
        gradingResults: resultsByAnswer.get(a.id) ?? [],
      })),
    });

    await tx.attempt.update({
      where: { id: attemptId },
      data: {
        status: rollup.status,
        totalScore: rollup.totalScore,
        percentage: rollup.percentage,
        scoreSource: rollup.scoreSource,
      },
    });

    return rollup;
  }

  private async verifyAnswerOwnership(teacherId: string, answerId: string) {
    const answer = await this.prisma.answer.findFirst({ where: { id: answerId } });
    if (!answer) {
      throw new AppError('NOT_FOUND');
    }
    const attempt = await this.prisma.attempt.findFirst({ where: { id: answer.attemptId } });
    if (!attempt) {
      throw new AppError('NOT_FOUND');
    }
    const [student, question, examModel] = await Promise.all([
      this.prisma.student.findUnique({ where: { id: attempt.studentId } }),
      this.prisma.question.findFirst({ where: { id: answer.questionId, deletedAt: null } }),
      this.prisma.examModel.findFirst({ where: { id: attempt.examModelId, deletedAt: null } }),
    ]);
    if (!student || student.deletedAt !== null || !question || !examModel) {
      throw new AppError('NOT_FOUND');
    }
    const [cohort, topic] = await Promise.all([
      this.prisma.cohort.findFirst({
        where: { id: student.cohortId, teacherId, deletedAt: null },
      }),
      this.prisma.topic.findFirst({
        where: { id: examModel.topicId, ownerId: teacherId, deletedAt: null },
      }),
    ]);
    if (!cohort || !topic) {
      throw new AppError('NOT_FOUND');
    }

    const [rubricCriteria, images] = await Promise.all([
      this.prisma.rubricCriterion.findMany({
        where: { questionId: question.id, deletedAt: null },
        orderBy: { orderIndex: 'asc' },
      }),
      this.prisma.answerImage.findMany({
        where: { answerId: answer.id, deletedAt: null },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    return { answer, attempt, student, cohort, topic, examModel, question, rubricCriteria, images };
  }

  async getReviewQueue(teacherId: string, filters: ReviewQueueQuery) {
    const topics = await this.prisma.topic.findMany({
      where: { ownerId: teacherId, deletedAt: null },
    });
    const scopedTopics = filters.topicId ? topics.filter((t) => t.id === filters.topicId) : topics;
    if (scopedTopics.length === 0) {
      return { items: [], pendingCount: 0, totalCount: 0 };
    }

    const topicMap = new Map(scopedTopics.map((t) => [t.id, t]));
    const topicIds = scopedTopics.map((t) => t.id);

    const [cohorts, examModels] = await Promise.all([
      this.prisma.cohort.findMany({
        where: { teacherId, deletedAt: null },
      }),
      this.prisma.examModel.findMany({
        where: { topicId: { in: topicIds }, deletedAt: null },
      }),
    ]);

    const scopedCohorts = cohorts.filter(
      (c) => topicMap.has(c.topicId) && (!filters.cohortId || c.id === filters.cohortId),
    );
    if (scopedCohorts.length === 0 || examModels.length === 0) {
      return { items: [], pendingCount: 0, totalCount: 0 };
    }

    const cohortMap = new Map(scopedCohorts.map((c) => [c.id, c]));
    const cohortIds = scopedCohorts.map((c) => c.id);
    const modelMap = new Map(examModels.map((m) => [m.id, m]));
    const modelIds = examModels.map((m) => m.id);

    const [students, allQuestions] = await Promise.all([
      this.prisma.student.findMany({
        where: { cohortId: { in: cohortIds }, deletedAt: null },
      }),
      this.prisma.question.findMany({
        where: { examModelId: { in: modelIds }, deletedAt: null },
        orderBy: { orderIndex: 'asc' },
      }),
    ]);

    const essayQuestions = allQuestions.filter((q) => q.type === 'ESSAY');
    if (students.length === 0 || essayQuestions.length === 0) {
      return { items: [], pendingCount: 0, totalCount: 0 };
    }

    const studentMap = new Map(students.map((s) => [s.id, s]));
    const studentIds = students.map((s) => s.id);
    const essayQMap = new Map(essayQuestions.map((q) => [q.id, q]));
    const essayQIds = essayQuestions.map((q) => q.id);

    const [attempts, modelAnswers, rubricCriteria] = await Promise.all([
      this.prisma.attempt.findMany({
        where: { studentId: { in: studentIds } },
      }),
      this.prisma.modelAnswer.findMany({
        where: { questionId: { in: essayQIds }, deletedAt: null },
      }),
      this.prisma.rubricCriterion.findMany({
        where: { questionId: { in: essayQIds }, deletedAt: null },
        orderBy: { orderIndex: 'asc' },
      }),
    ]);

    const submittedAttempts = attempts.filter(
      (a) => a.status !== 'IN_PROGRESS' && modelMap.has(a.examModelId),
    );
    if (submittedAttempts.length === 0) {
      return { items: [], pendingCount: 0, totalCount: 0 };
    }

    const attemptMap = new Map(submittedAttempts.map((a) => [a.id, a]));
    const attemptIds = submittedAttempts.map((a) => a.id);

    const answers = await this.prisma.answer.findMany({
      where: { attemptId: { in: attemptIds } },
    });
    const essayAnswers = answers.filter((a) => essayQMap.has(a.questionId));
    if (essayAnswers.length === 0) {
      return { items: [], pendingCount: 0, totalCount: 0 };
    }

    const answerIds = essayAnswers.map((a) => a.id);
    const [images, gradingResults] = await Promise.all([
      this.prisma.answerImage.findMany({
        where: { answerId: { in: answerIds }, deletedAt: null },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.gradingResult.findMany({
        where: { answerId: { in: answerIds } },
        orderBy: { version: 'desc' },
      }),
    ]);

    const gradingResultIds = gradingResults.map((g) => g.id);
    const overrides = gradingResultIds.length
      ? await this.prisma.teacherOverride.findMany({
          where: { gradingResultId: { in: gradingResultIds } },
          orderBy: { createdAt: 'desc' },
        })
      : [];

    const modelAnswerByQ = new Map(modelAnswers.map((m) => [m.questionId, m]));
    const rubricByQ = new Map<string, typeof rubricCriteria>();
    for (const c of rubricCriteria) {
      const list = rubricByQ.get(c.questionId) ?? [];
      list.push(c);
      rubricByQ.set(c.questionId, list);
    }

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

    const includeResolved = filters.includeResolved === 'true';

    const hydratedItems = await Promise.all(
      essayAnswers.map(async (ans) => {
        const attempt = attemptMap.get(ans.attemptId);
        const question = essayQMap.get(ans.questionId);
        if (!attempt || !question) return null;

        const student = studentMap.get(attempt.studentId);
        const examModel = modelMap.get(attempt.examModelId);
        if (!student || !examModel) return null;

        const cohort = cohortMap.get(student.cohortId);
        const topic = topicMap.get(examModel.topicId);
        if (!cohort || !topic) return null;

        const latestResult = latestResultByAnswer.get(ans.id) ?? null;
        const resultOverrides = latestResult ? (overridesByResult.get(latestResult.id) ?? []) : [];
        const latestOverride = resultOverrides[0] ?? null;

        const misreadUnresolved =
          ans.misreadReportedAt !== null &&
          (!latestOverride || ans.misreadReportedAt > latestOverride.createdAt);
        const isPendingReview =
          Boolean(latestResult?.needsReview) ||
          misreadUnresolved ||
          (!latestResult && attempt.status === 'NEEDS_REVIEW');

        if (!includeResolved && !isPendingReview) {
          return null;
        }

        const reviewReasons = Array.from(
          new Set([
            ...(latestResult?.reviewReasons ?? []),
            ...(ans.misreadReportedAt ? ['STUDENT_REPORTED_MISREAD'] : []),
          ]),
        );

        if (filters.reason && !reviewReasons.includes(filters.reason)) {
          return null;
        }

        const rawImages = imagesByAnswer.get(ans.id) ?? [];
        const signedImages = await Promise.all(
          rawImages.map(async (img) => ({
            id: img.id,
            signedUrl: await this.storage.getSignedUrl(img.storageKey, 900),
            width: img.width,
            height: img.height,
            pinnedByTeacher: img.pinnedByTeacher,
          })),
        );

        const criteria = (rubricByQ.get(question.id) ?? []).sort(
          (a, b) => a.orderIndex - b.orderIndex,
        );
        const aiCriteria = extractAiCriteriaList(latestResult?.criteriaScores);
        const overrideCriteria = extractOverrideCriteriaList(latestOverride?.newCriteriaScores);

        const effectiveCriteria = criteria.map((crit) => {
          const ov =
            overrideCriteria.find((c) => c.criterionId === crit.id || c.key === crit.key) ?? null;
          const ai = aiCriteria.find((c) => c.key === crit.key) ?? null;
          return {
            criterionId: crit.id,
            key: crit.key,
            descriptionEn: crit.descriptionEn,
            descriptionAr: crit.descriptionAr,
            maxPoints: crit.maxPoints,
            aiAwarded: ai?.awardedPoints ?? 0,
            effectiveAwarded: ov ? ov.awarded : (ai?.awardedPoints ?? 0),
            commentAr: ov?.commentAr ?? ai?.commentAr ?? '',
          };
        });

        const modelAnswer = modelAnswerByQ.get(question.id) ?? null;

        return {
          answerId: ans.id,
          attemptId: attempt.id,
          attemptStatus: attempt.status,
          submittedAt: attempt.submittedAt ? attempt.submittedAt.toISOString() : null,
          isPendingReview,
          misreadReportedAt: ans.misreadReportedAt ? ans.misreadReportedAt.toISOString() : null,
          misreadNote: ans.misreadNote,
          reviewReasons,
          student: {
            id: student.id,
            displayName: student.displayName,
          },
          cohort: {
            id: cohort.id,
            name: cohort.name,
            group: cohort.group,
          },
          topic: {
            id: topic.id,
            title: topic.title,
          },
          examModel: {
            id: examModel.id,
            modelNumber: examModel.modelNumber,
            title: examModel.title,
          },
          question: {
            id: question.id,
            orderIndex: question.orderIndex,
            conceptKey: question.conceptKey,
            promptLatex: question.promptLatex,
            points: question.points,
            solutionUrl: question.solutionUrl ?? null,
            modelAnswer: modelAnswer
              ? {
                  solutionStepsLatex: modelAnswer.solutionStepsLatex,
                  finalAnswerLatex: modelAnswer.finalAnswerLatex,
                  finalAnswerSympy: modelAnswer.finalAnswerSympy,
                  commonMistakes: modelAnswer.commonMistakes,
                }
              : null,
          },
          images: signedImages,
          latestResult: latestResult
            ? {
                id: latestResult.id,
                version: latestResult.version,
                provider: latestResult.provider,
                modelName: latestResult.modelName,
                aiTotal: latestResult.aiTotal,
                finalAnswerCorrect: latestResult.finalAnswerCorrect,
                firstErrorStep: latestResult.firstErrorStep,
                errorType: latestResult.errorType as GradingErrorType | null,
                errorExplanationAr: latestResult.errorExplanationAr,
                hintAr: latestResult.hintAr,
                confidence: latestResult.confidence,
                needsReview: latestResult.needsReview,
                reviewReasons: latestResult.reviewReasons,
                sympyCheck: latestResult.sympyCheck,
                transcribedLines: extractTranscribedLines(latestResult.transcriptionJson),
                createdAt: latestResult.createdAt.toISOString(),
              }
            : null,
          effectiveCriteria,
          effectiveTotal: latestOverride?.newTotal ?? latestResult?.aiTotal ?? ans.score ?? 0,
          effectiveExplanationAr:
            latestOverride?.newExplanationAr ?? latestResult?.errorExplanationAr ?? '',
          overrideHistory: resultOverrides.map((ov) => ({
            id: ov.id,
            newTotal: ov.newTotal,
            newExplanationAr: ov.newExplanationAr,
            note: ov.note,
            newCriteriaScores: ov.newCriteriaScores,
            createdAt: ov.createdAt.toISOString(),
          })),
        };
      }),
    );

    const items = hydratedItems
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .sort((a, b) => {
        if (a.isPendingReview !== b.isPendingReview) {
          return a.isPendingReview ? -1 : 1;
        }
        return (b.submittedAt ?? '').localeCompare(a.submittedAt ?? '');
      });

    return {
      items,
      pendingCount: items.filter((i) => i.isPendingReview).length,
      totalCount: items.length,
    };
  }

  async overrideGradingResult(
    teacherId: string,
    gradingResultId: string,
    input: TeacherOverrideInput,
    ip?: string,
  ) {
    const gradingResult = await this.prisma.gradingResult.findFirst({
      where: { id: gradingResultId },
    });
    if (!gradingResult) {
      throw new AppError('NOT_FOUND');
    }

    const ctx = await this.verifyAnswerOwnership(teacherId, gradingResult.answerId);
    if (ctx.question.type !== 'ESSAY') {
      throw new AppError('VALIDATION_ERROR', {
        messageEn: 'Overrides apply only to essay questions.',
        messageAr: 'التعديل متاح فقط للأسئلة المقالية.',
      });
    }

    const { criteriaScores, newTotal } = validateAndBoundTeacherCriteria(
      input.criteriaScores,
      ctx.rubricCriteria,
      ctx.question.points,
    );

    const isCorrect =
      input.finalAnswerCorrect ?? newTotal >= ctx.question.points * ctx.topic.correctnessThreshold;

    return this.prisma.$transaction(async (tx) => {
      const createdOverride = await tx.teacherOverride.create({
        data: {
          gradingResultId: gradingResult.id,
          teacherId,
          newCriteriaScores: toJson(criteriaScores),
          newTotal,
          newExplanationAr: input.errorExplanationAr?.trim() ?? null,
          note: input.note?.trim() ?? null,
        },
      });

      await tx.gradingResult.update({
        where: { id: gradingResult.id },
        data: { needsReview: false },
      });

      await tx.answer.update({
        where: { id: ctx.answer.id },
        data: {
          score: newTotal,
          maxScore: ctx.question.points,
          isCorrect,
        },
      });

      const rollup = await this.recomputeAttemptTx(
        tx,
        ctx.attempt.id,
        ctx.attempt.examModelId,
        ctx.attempt.maxScore,
      );

      await writeAuditLog(tx, this.env, {
        actorType: 'TEACHER',
        actorId: teacherId,
        action: 'TEACHER_OVERRIDE',
        entity: 'GradingResult',
        entityId: gradingResult.id,
        diff: {
          answerId: ctx.answer.id,
          attemptId: ctx.attempt.id,
          previousAiTotal: gradingResult.aiTotal,
          newTotal,
          attemptStatus: rollup.status,
          scoreSource: rollup.scoreSource,
        },
        ip,
      });

      return {
        override: {
          id: createdOverride.id,
          gradingResultId: createdOverride.gradingResultId,
          newTotal: createdOverride.newTotal,
          newExplanationAr: createdOverride.newExplanationAr,
          note: createdOverride.note,
          newCriteriaScores: criteriaScores,
          createdAt: createdOverride.createdAt.toISOString(),
        },
        attempt: {
          id: ctx.attempt.id,
          status: rollup.status,
          totalScore: rollup.totalScore,
          percentage: rollup.percentage,
          scoreSource: rollup.scoreSource,
        },
      };
    });
  }

  async manualGradeAnswer(
    teacherId: string,
    answerId: string,
    input: ManualGradeInput,
    ip?: string,
  ) {
    const ctx = await this.verifyAnswerOwnership(teacherId, answerId);
    if (ctx.question.type !== 'ESSAY') {
      throw new AppError('VALIDATION_ERROR', {
        messageEn: 'Manual grading applies only to essay questions.',
        messageAr: 'التصحيح اليدوي متاح فقط للأسئلة المقالية.',
      });
    }

    const existingResults = await this.prisma.gradingResult.findMany({
      where: { answerId: ctx.answer.id },
      orderBy: { version: 'desc' },
    });
    const latestResult = existingResults[0] ?? null;

    if (latestResult) {
      return this.overrideGradingResult(teacherId, latestResult.id, input, ip);
    }

    const { criteriaScores, newTotal } = validateAndBoundTeacherCriteria(
      input.criteriaScores,
      ctx.rubricCriteria,
      ctx.question.points,
    );

    const isCorrect =
      input.finalAnswerCorrect ?? newTotal >= ctx.question.points * ctx.topic.correctnessThreshold;

    const modelAnswer = await this.prisma.modelAnswer.findFirst({
      where: { questionId: ctx.question.id, deletedAt: null },
    });

    return this.prisma.$transaction(async (tx) => {
      const createdResult = await tx.gradingResult.create({
        data: {
          answerId: ctx.answer.id,
          version: 1,
          provider: 'teacher',
          modelName: 'manual-grade',
          promptVersion: 'manual',
          rubricVersion: modelAnswer?.rubricVersion ?? 1,
          imageHash: ctx.images[0]?.sha256 ?? 'manual',
          transcriptionJson: toJson({ lines: [], fullTranscriptionLatex: '' }),
          gradingJson: toJson({ criteriaScores }),
          criteriaScores: toJson(
            criteriaScores.map((c) => ({
              criterionKey: c.key,
              awardedPoints: c.awarded,
              maxPoints: c.maxPoints,
              met: c.awarded >= c.maxPoints,
              commentAr: c.commentAr,
            })),
          ),
          aiTotal: newTotal,
          finalAnswerCorrect: isCorrect,
          firstErrorStep: null,
          errorType: input.errorType ?? 'none',
          errorExplanationAr: input.errorExplanationAr?.trim() ?? 'تم التصحيح يدوياً من قبل المعلم.',
          hintAr: '',
          confidence: 1,
          sympyCheck: toJson({
            checked: false,
            status: 'NOT_APPLICABLE',
            detail: 'Manual teacher grade',
          }),
          needsReview: false,
          reviewReasons: [],
          rawOutput: '{}',
          latencyMs: 0,
          costUsd: 0,
        },
      });

      const createdOverride = await tx.teacherOverride.create({
        data: {
          gradingResultId: createdResult.id,
          teacherId,
          newCriteriaScores: toJson(criteriaScores),
          newTotal,
          newExplanationAr: input.errorExplanationAr?.trim() ?? null,
          note: input.note?.trim() ?? null,
        },
      });

      await tx.answer.update({
        where: { id: ctx.answer.id },
        data: {
          score: newTotal,
          maxScore: ctx.question.points,
          isCorrect,
        },
      });

      const rollup = await this.recomputeAttemptTx(
        tx,
        ctx.attempt.id,
        ctx.attempt.examModelId,
        ctx.attempt.maxScore,
      );

      await writeAuditLog(tx, this.env, {
        actorType: 'TEACHER',
        actorId: teacherId,
        action: 'TEACHER_MANUAL_GRADE',
        entity: 'Answer',
        entityId: ctx.answer.id,
        diff: {
          gradingResultId: createdResult.id,
          newTotal,
          attemptStatus: rollup.status,
          scoreSource: rollup.scoreSource,
        },
        ip,
      });

      return {
        override: {
          id: createdOverride.id,
          gradingResultId: createdResult.id,
          newTotal: createdOverride.newTotal,
          newExplanationAr: createdOverride.newExplanationAr,
          note: createdOverride.note,
          newCriteriaScores: criteriaScores,
          createdAt: createdOverride.createdAt.toISOString(),
        },
        attempt: {
          id: ctx.attempt.id,
          status: rollup.status,
          totalScore: rollup.totalScore,
          percentage: rollup.percentage,
          scoreSource: rollup.scoreSource,
        },
      };
    });
  }

  async retranscribeAnswer(
    teacherId: string,
    answerId: string,
    dispatcher: GradingDispatcher,
    ip?: string,
  ) {
    const ctx = await this.verifyAnswerOwnership(teacherId, answerId);
    if (ctx.question.type !== 'ESSAY') {
      throw new AppError('VALIDATION_ERROR', {
        messageEn: 'Retranscription applies only to handwritten essay questions.',
        messageAr: 'إعادة القراءة متاحة فقط للأسئلة المقالية.',
      });
    }
    if (ctx.images.length === 0) {
      throw new AppError('VALIDATION_ERROR', {
        messageEn: 'No uploaded handwritten images found for this answer.',
        messageAr: 'لا توجد صور مرفوعة لهذه الإجابة.',
      });
    }
    if (ctx.attempt.status === 'IN_PROGRESS') {
      throw new AppError('CONFLICT', {
        messageEn: 'Cannot retranscribe while attempt is still in progress.',
        messageAr: 'لا يمكن إعادة التصحيح قبل تسليم الطالب للاختبار.',
      });
    }

    await this.prisma.attempt.update({
      where: { id: ctx.attempt.id },
      data: { status: 'GRADING' },
    });

    await dispatcher.enqueueEssayGrading({
      attemptId: ctx.attempt.id,
      answerId: ctx.answer.id,
      studentId: ctx.attempt.studentId,
      forceRefresh: true,
    });

    await writeAuditLog(this.prisma, this.env, {
      actorType: 'TEACHER',
      actorId: teacherId,
      action: 'TEACHER_RETRANSCRIBE',
      entity: 'Answer',
      entityId: ctx.answer.id,
      diff: { attemptId: ctx.attempt.id },
      ip,
    });

    return {
      queued: true,
      answerId: ctx.answer.id,
      attemptId: ctx.attempt.id,
    };
  }

  async pinAnswerImage(teacherId: string, imageId: string, pinned: boolean, ip?: string) {
    const image = await this.prisma.answerImage.findFirst({
      where: { id: imageId, deletedAt: null },
    });
    if (!image) {
      throw new AppError('NOT_FOUND');
    }

    await this.verifyAnswerOwnership(teacherId, image.answerId);

    const updated = await this.prisma.answerImage.update({
      where: { id: image.id },
      data: { pinnedByTeacher: pinned },
    });

    await writeAuditLog(this.prisma, this.env, {
      actorType: 'TEACHER',
      actorId: teacherId,
      action: 'TEACHER_PIN_IMAGE',
      entity: 'AnswerImage',
      entityId: image.id,
      diff: { pinned },
      ip,
    });

    return {
      id: updated.id,
      answerId: updated.answerId,
      pinnedByTeacher: updated.pinnedByTeacher,
    };
  }

  async listStudents(teacherId: string, query: StudentsQuery) {
    const [topics, cohorts] = await Promise.all([
      this.prisma.topic.findMany({ where: { ownerId: teacherId, deletedAt: null } }),
      this.prisma.cohort.findMany({ where: { teacherId, deletedAt: null } }),
    ]);

    const topicMap = new Map(topics.map((t) => [t.id, t]));
    const scopedCohorts = cohorts.filter(
      (c) =>
        topicMap.has(c.topicId) &&
        (!query.cohortId || c.id === query.cohortId) &&
        (!query.topicId || c.topicId === query.topicId),
    );
    if (scopedCohorts.length === 0) {
      return { students: [] };
    }

    const cohortMap = new Map(scopedCohorts.map((c) => [c.id, c]));
    const cohortIds = scopedCohorts.map((c) => c.id);

    const rawStudents = await this.prisma.student.findMany({
      where: { cohortId: { in: cohortIds }, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    const search = query.search?.trim().toLowerCase() ?? '';
    const filteredStudents = search
      ? rawStudents.filter(
          (s) =>
            s.displayName.toLowerCase().includes(search) ||
            s.resumeCode.toLowerCase().includes(search),
        )
      : rawStudents;

    if (filteredStudents.length === 0) {
      return { students: [] };
    }

    const studentIds = filteredStudents.map((s) => s.id);
    const topicIds = Array.from(new Set(scopedCohorts.map((c) => c.topicId)));

    const [examModels, attempts, videoSessions] = await Promise.all([
      this.prisma.examModel.findMany({
        where: { topicId: { in: topicIds }, deletedAt: null },
      }),
      this.prisma.attempt.findMany({
        where: { studentId: { in: studentIds } },
      }),
      this.prisma.videoSession.findMany({
        where: { studentId: { in: studentIds } },
      }),
    ]);

    const attemptIds = attempts.map((a) => a.id);
    const answers = attemptIds.length
      ? await this.prisma.answer.findMany({ where: { attemptId: { in: attemptIds } } })
      : [];
    const answerIds = answers.map((a) => a.id);
    const gradingResults = answerIds.length
      ? await this.prisma.gradingResult.findMany({
          where: { answerId: { in: answerIds } },
          orderBy: { version: 'desc' },
        })
      : [];

    const modelById = new Map(examModels.map((m) => [m.id, m]));
    const latestResultByAnswer = new Map<string, (typeof gradingResults)[number]>();
    for (const gr of gradingResults) {
      if (!latestResultByAnswer.has(gr.answerId)) {
        latestResultByAnswer.set(gr.answerId, gr);
      }
    }
    const answersByAttempt = new Map<string, typeof answers>();
    for (const ans of answers) {
      const list = answersByAttempt.get(ans.attemptId) ?? [];
      list.push(ans);
      answersByAttempt.set(ans.attemptId, list);
    }

    const videoByStudentTopic = new Map(
      videoSessions.map((v) => [`${v.studentId}:${v.topicId}`, v]),
    );

    const rows = filteredStudents.map((student) => {
      const cohort = cohortMap.get(student.cohortId)!;
      const topic = topicMap.get(cohort.topicId)!;
      const studentAttempts = attempts.filter((a) => a.studentId === student.id);
      const preTest =
        studentAttempts.find((a) => modelById.get(a.examModelId)?.modelNumber === 1) ?? null;
      const postTest =
        studentAttempts.find((a) => modelById.get(a.examModelId)?.modelNumber === 2) ?? null;
      const videoSession = videoByStudentTopic.get(`${student.id}:${topic.id}`) ?? null;

      let pendingReviewCount = 0;
      for (const att of studentAttempts) {
        for (const ans of answersByAttempt.get(att.id) ?? []) {
          const latest = latestResultByAnswer.get(ans.id);
          if (latest?.needsReview) {
            pendingReviewCount += 1;
          }
        }
      }

      const flow = deriveStudentFlowStep({
        cohort: {
          group: cohort.group,
          requireVideoBeforePost: cohort.requireVideoBeforePost,
          showProvisionalScore: cohort.showProvisionalScore,
          postTestOpensAt: cohort.postTestOpensAt,
        },
        topic: { minWatchSeconds: topic.minWatchSeconds },
        consentAcceptedAt: student.consentAcceptedAt,
        preTestAttempt: preTest ? { status: preTest.status } : null,
        postTestAttempt: postTest ? { status: postTest.status } : null,
        videoSession: videoSession
          ? {
              startedAt: videoSession.startedAt,
              watchedSeconds: videoSession.watchedSeconds,
              unlockedPostAt: videoSession.unlockedPostAt,
              manualUnlockedById: videoSession.manualUnlockedById,
            }
          : null,
      });

      const scoreGain =
        preTest?.percentage !== null &&
        preTest?.percentage !== undefined &&
        postTest?.percentage !== null &&
        postTest?.percentage !== undefined
          ? roundTwo(postTest.percentage - preTest.percentage)
          : null;

      return {
        id: student.id,
        displayName: student.displayName,
        resumeCode: student.resumeCode,
        consentAcceptedAt: student.consentAcceptedAt
          ? student.consentAcceptedAt.toISOString()
          : null,
        createdAt: student.createdAt.toISOString(),
        cohort: {
          id: cohort.id,
          name: cohort.name,
          group: cohort.group,
          joinCode: cohort.joinCode,
        },
        topic: {
          id: topic.id,
          title: topic.title,
          minWatchSeconds: topic.minWatchSeconds,
        },
        currentStep: flow.step,
        pendingReviewCount,
        scoreGain,
        preTest: preTest
          ? {
              attemptId: preTest.id,
              status: preTest.status,
              totalScore: preTest.totalScore,
              maxScore: preTest.maxScore,
              percentage: preTest.percentage,
              submittedAt: preTest.submittedAt ? preTest.submittedAt.toISOString() : null,
            }
          : null,
        postTest: postTest
          ? {
              attemptId: postTest.id,
              status: postTest.status,
              totalScore: postTest.totalScore,
              maxScore: postTest.maxScore,
              percentage: postTest.percentage,
              submittedAt: postTest.submittedAt ? postTest.submittedAt.toISOString() : null,
            }
          : null,
        videoProgress: {
          watchedSeconds: videoSession?.watchedSeconds ?? 0,
          minWatchSeconds: topic.minWatchSeconds,
          unlockedPostAt: videoSession?.unlockedPostAt
            ? videoSession.unlockedPostAt.toISOString()
            : null,
          manualUnlocked: Boolean(videoSession?.manualUnlockedById),
        },
      };
    });

    return { students: rows };
  }

  async getStudentDetail(teacherId: string, studentId: string) {
    const student = await this.prisma.student.findUnique({ where: { id: studentId } });
    if (!student || student.deletedAt !== null) {
      throw new AppError('NOT_FOUND');
    }

    const cohort = await this.prisma.cohort.findFirst({
      where: { id: student.cohortId, teacherId, deletedAt: null },
    });
    if (!cohort) {
      throw new AppError('NOT_FOUND');
    }

    const topic = await this.prisma.topic.findFirst({
      where: { id: cohort.topicId, ownerId: teacherId, deletedAt: null },
    });
    if (!topic) {
      throw new AppError('NOT_FOUND');
    }

    const [examModels, attempts, videoSessions] = await Promise.all([
      this.prisma.examModel.findMany({ where: { topicId: topic.id, deletedAt: null } }),
      this.prisma.attempt.findMany({ where: { studentId: student.id } }),
      this.prisma.videoSession.findMany({ where: { studentId: student.id, topicId: topic.id } }),
    ]);

    const modelById = new Map(examModels.map((m) => [m.id, m]));
    const modelIds = examModels.map((m) => m.id);
    const attemptIds = attempts.map((a) => a.id);

    const [questions, answers] = await Promise.all([
      modelIds.length
        ? this.prisma.question.findMany({
            where: { examModelId: { in: modelIds }, deletedAt: null },
            orderBy: { orderIndex: 'asc' },
          })
        : Promise.resolve([]),
      attemptIds.length
        ? this.prisma.answer.findMany({ where: { attemptId: { in: attemptIds } } })
        : Promise.resolve([]),
    ]);

    const answerIds = answers.map((a) => a.id);
    const [images, gradingResults] = await Promise.all([
      answerIds.length
        ? this.prisma.answerImage.findMany({
            where: { answerId: { in: answerIds }, deletedAt: null },
          })
        : Promise.resolve([]),
      answerIds.length
        ? this.prisma.gradingResult.findMany({
            where: { answerId: { in: answerIds } },
            orderBy: { version: 'desc' },
          })
        : Promise.resolve([]),
    ]);

    const resultIds = gradingResults.map((g) => g.id);
    const overrides = resultIds.length
      ? await this.prisma.teacherOverride.findMany({
          where: { gradingResultId: { in: resultIds } },
          orderBy: { createdAt: 'desc' },
        })
      : [];

    const questionById = new Map(questions.map((q) => [q.id, q]));
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

    const detailedAttempts = await Promise.all(
      attempts.map(async (att) => {
        const model = modelById.get(att.examModelId);
        const attAnswers = answers.filter((a) => a.attemptId === att.id);
        const items = await Promise.all(
          attAnswers.map(async (ans) => {
            const q = questionById.get(ans.questionId);
            const latest = latestResultByAnswer.get(ans.id) ?? null;
            const latestOv = latest ? (overridesByResult.get(latest.id)?.[0] ?? null) : null;
            const signedImgs = await Promise.all(
              (imagesByAnswer.get(ans.id) ?? []).map(async (img) => ({
                id: img.id,
                signedUrl: await this.storage.getSignedUrl(img.storageKey, 900),
                pinnedByTeacher: img.pinnedByTeacher,
              })),
            );
            return {
              answerId: ans.id,
              questionId: ans.questionId,
              orderIndex: q?.orderIndex ?? 0,
              conceptKey: q?.conceptKey ?? '',
              type: q?.type ?? 'MCQ',
              promptLatex: q?.promptLatex ?? '',
              score: ans.score,
              maxScore: ans.maxScore,
              isCorrect: ans.isCorrect,
              misreadReportedAt: ans.misreadReportedAt ? ans.misreadReportedAt.toISOString() : null,
              misreadNote: ans.misreadNote,
              images: signedImgs,
              latestGrading: latest
                ? {
                    id: latest.id,
                    aiTotal: latest.aiTotal,
                    confidence: latest.confidence,
                    needsReview: latest.needsReview,
                    reviewReasons: latest.reviewReasons,
                    errorExplanationAr: latestOv?.newExplanationAr ?? latest.errorExplanationAr,
                    overriddenTotal: latestOv?.newTotal ?? null,
                  }
                : null,
            };
          }),
        );
        return {
          id: att.id,
          modelNumber: model?.modelNumber ?? 1,
          title: model?.title ?? '',
          status: att.status,
          startedAt: att.startedAt.toISOString(),
          submittedAt: att.submittedAt ? att.submittedAt.toISOString() : null,
          totalScore: att.totalScore,
          maxScore: att.maxScore,
          percentage: att.percentage,
          scoreSource: att.scoreSource,
          answers: items.sort((a, b) => a.orderIndex - b.orderIndex),
        };
      }),
    );

    const videoSession = videoSessions[0] ?? null;

    return {
      student: {
        id: student.id,
        displayName: student.displayName,
        resumeCode: student.resumeCode,
        consentAcceptedAt: student.consentAcceptedAt
          ? student.consentAcceptedAt.toISOString()
          : null,
        createdAt: student.createdAt.toISOString(),
      },
      cohort: {
        id: cohort.id,
        name: cohort.name,
        group: cohort.group,
        joinCode: cohort.joinCode,
      },
      topic: {
        id: topic.id,
        title: topic.title,
        minWatchSeconds: topic.minWatchSeconds,
      },
      videoProgress: {
        watchedSeconds: videoSession?.watchedSeconds ?? 0,
        lastPosition: videoSession?.lastPosition ?? 0,
        unlockedPostAt: videoSession?.unlockedPostAt
          ? videoSession.unlockedPostAt.toISOString()
          : null,
        manualUnlocked: Boolean(videoSession?.manualUnlockedById),
      },
      attempts: detailedAttempts.sort((a, b) => a.modelNumber - b.modelNumber),
    };
  }
}
