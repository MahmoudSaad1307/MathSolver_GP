import type { Prisma } from '@prisma/client';
import {
  evaluatePublishChecklist,
  hasValidQuestionVideo,
  isRubricSumValid,
  type PublishChecklistResult,
  type UpsertQuestionInput,
  type ValidatableExamModel,
  type ValidatableQuestion,
} from '@mathlens/shared';
import { AppError } from '../lib/errors.js';
import type { PrismaTx } from '../lib/scoping.js';

export const TOPIC_FULL_INCLUDE = {
  examModels: {
    where: { deletedAt: null },
    orderBy: { modelNumber: 'asc' as const },
    include: {
      questions: {
        where: { deletedAt: null },
        orderBy: { orderIndex: 'asc' as const },
        include: {
          mcqOptions: {
            where: { deletedAt: null },
            orderBy: { label: 'asc' as const },
          },
          modelAnswer: true,
          rubricCriteria: {
            where: { deletedAt: null },
            orderBy: { orderIndex: 'asc' as const },
          },
        },
      },
    },
  },
} satisfies Prisma.TopicInclude;

export type LoadedTopicTree = Prisma.TopicGetPayload<{
  include: typeof TOPIC_FULL_INCLUDE;
}>;

export type LoadedExamModel = LoadedTopicTree['examModels'][number];
export type LoadedQuestion = LoadedExamModel['questions'][number];

export function toValidatableQuestion(q: LoadedQuestion): ValidatableQuestion {
  const activeModelAnswer =
    q.modelAnswer && q.modelAnswer.deletedAt === null ? q.modelAnswer : null;

  return {
    id: q.id,
    orderIndex: q.orderIndex,
    conceptKey: q.conceptKey,
    type: q.type,
    points: q.points,
    solutionUrl: q.solutionUrl ?? null,
    needsTeacherConfirmation: q.needsTeacherConfirmation,
    mcqOptions: q.mcqOptions.map((o) => ({
      label: o.label,
      textLatex: o.textLatex,
      isCorrect: o.isCorrect,
    })),
    modelAnswer: activeModelAnswer
      ? {
          solutionStepsLatex: activeModelAnswer.solutionStepsLatex,
          finalAnswerLatex: activeModelAnswer.finalAnswerLatex,
        }
      : null,
    rubricCriteria: q.rubricCriteria.map((c) => ({
      key: c.key,
      maxPoints: c.maxPoints,
    })),
  };
}

export function toValidatableModel(
  model: LoadedExamModel | undefined | null,
): ValidatableExamModel | null {
  if (!model || (model.modelNumber !== 1 && model.modelNumber !== 2)) {
    return null;
  }
  return {
    modelNumber: model.modelNumber,
    questions: model.questions.map(toValidatableQuestion),
  };
}

export interface TopicStatusMetadata {
  publishChecklist: PublishChecklistResult;
  hasPlaceholders: boolean;
  missingVideoCount: number;
  unconfirmedCount: number;
}

export function computeTopicStatusMetadata(topic: LoadedTopicTree): TopicStatusMetadata {
  const m1Raw = topic.examModels.find((m) => m.modelNumber === 1);
  const m2Raw = topic.examModels.find((m) => m.modelNumber === 2);
  const m1 = toValidatableModel(m1Raw);
  const m2 = toValidatableModel(m2Raw);
  const publishChecklist = evaluatePublishChecklist(m1, m2);

  const allQuestions = topic.examModels.flatMap((m) => m.questions);
  const missingVideoCount = (m1Raw?.questions ?? []).filter(
    (q) => !hasValidQuestionVideo(q.solutionUrl),
  ).length;
  const unconfirmedCount = allQuestions.filter((q) => q.needsTeacherConfirmation).length;

  return {
    publishChecklist,
    hasPlaceholders: missingVideoCount > 0 || unconfirmedCount > 0,
    missingVideoCount,
    unconfirmedCount,
  };
}

export function serializeTopicWithStatus(topic: LoadedTopicTree) {
  const sanitizedModels = topic.examModels.map((model) => ({
    ...model,
    questions: model.questions.map((q) => ({
      ...q,
      solutionUrl: q.solutionUrl ?? null,
      modelAnswer: q.modelAnswer && q.modelAnswer.deletedAt === null ? q.modelAnswer : null,
    })),
  }));
  const sanitizedTopic: LoadedTopicTree = {
    ...topic,
    examModels: sanitizedModels,
  };

  return {
    ...sanitizedTopic,
    ...computeTopicStatusMetadata(sanitizedTopic),
  };
}

export function validateQuestionPayload(input: UpsertQuestionInput): void {
  if (input.type === 'MCQ') {
    const opts = input.mcqOptions ?? [];
    const labels = new Set(opts.map((o) => o.label));
    const correctCount = opts.filter((o) => o.isCorrect).length;
    if (opts.length !== 4 || labels.size !== 4 || correctCount !== 1) {
      throw new AppError('VALIDATION_ERROR', {
        messageEn: 'MCQ must have 4 distinct options (A-D) and exactly 1 correct option.',
        messageAr: 'يجب أن يحتوي سؤال الاختيار من متعدد على 4 خيارات مميزة وإجابة صحيحة واحدة.',
      });
    }
    return;
  }

  if (!input.modelAnswer || input.modelAnswer.solutionStepsLatex.length === 0) {
    throw new AppError('VALIDATION_ERROR', {
      messageEn: 'Essay questions require a model answer with solution steps.',
      messageAr: 'الأسئلة المقالية تتطلب نموذج إجابة وخطوات حل.',
    });
  }

  const criteria = input.rubricCriteria ?? [];
  if (!isRubricSumValid(input.points, criteria)) {
    throw new AppError('RUBRIC_SUM_MISMATCH');
  }
}

export async function recalculateExamTotalPoints(
  tx: PrismaTx,
  examModelId: string,
): Promise<number> {
  const activeQuestions = await tx.question.findMany({
    where: { examModelId, deletedAt: null },
    select: { points: true },
  });
  const totalPoints = activeQuestions.reduce((acc, q) => acc + q.points, 0);
  await tx.examModel.update({
    where: { id: examModelId },
    data: { totalPoints },
  });
  return totalPoints;
}

export async function syncTwinQuestionsForTopic(tx: PrismaTx, topicId: string): Promise<void> {
  const models = await tx.examModel.findMany({
    where: { topicId, deletedAt: null },
    select: {
      id: true,
      modelNumber: true,
      questions: {
        where: { deletedAt: null },
        orderBy: { orderIndex: 'asc' },
        select: { id: true, conceptKey: true, orderIndex: true, twinQuestionId: true },
      },
    },
  });

  const m1 = models.find((m) => m.modelNumber === 1);
  const m2 = models.find((m) => m.modelNumber === 2);
  if (!m1 || !m2) {
    return;
  }

  // Group Model 2 questions by conceptKey so repeated concepts pair cleanly in orderIndex sequence.
  const m2ByConcept = new Map<string, typeof m2.questions>();
  for (const q2 of m2.questions) {
    const bucket = m2ByConcept.get(q2.conceptKey) ?? [];
    bucket.push(q2);
    m2ByConcept.set(q2.conceptKey, bucket);
  }

  const desiredLinks = new Map<string, string | null>();
  for (const q of [...m1.questions, ...m2.questions]) {
    desiredLinks.set(q.id, null);
  }

  for (const q1 of m1.questions) {
    const candidates = m2ByConcept.get(q1.conceptKey);
    const matched = candidates?.shift();
    if (matched) {
      desiredLinks.set(q1.id, matched.id);
      desiredLinks.set(matched.id, q1.id);
    }
  }

  // Clear links first on mismatched questions to avoid @unique collisions before setting new twins.
  for (const q of [...m1.questions, ...m2.questions]) {
    const target = desiredLinks.get(q.id) ?? null;
    if (q.twinQuestionId !== null && q.twinQuestionId !== target) {
      await tx.question.update({
        where: { id: q.id },
        data: { twinQuestionId: null },
      });
    }
  }

  for (const q of [...m1.questions, ...m2.questions]) {
    const target = desiredLinks.get(q.id) ?? null;
    if (target !== null && q.twinQuestionId !== target) {
      await tx.question.update({
        where: { id: q.id },
        data: { twinQuestionId: target },
      });
    }
  }
}

export async function populateQuestionChildren(
  tx: PrismaTx,
  questionId: string,
  input: UpsertQuestionInput,
  existingRubricVersion?: number | null,
  bumpRubricVersion = true,
): Promise<void> {
  if (input.type === 'MCQ' && input.mcqOptions) {
    await tx.mcqOption.createMany({
      data: input.mcqOptions.map((opt) => ({
        questionId,
        label: opt.label,
        textLatex: opt.textLatex,
        isCorrect: opt.isCorrect,
      })),
    });
  } else if (input.type === 'ESSAY' && input.modelAnswer && input.rubricCriteria) {
    const nextVersion = existingRubricVersion
      ? bumpRubricVersion
        ? existingRubricVersion + 1
        : existingRubricVersion
      : 1;
    await tx.modelAnswer.upsert({
      where: { questionId },
      create: {
        questionId,
        solutionStepsLatex: input.modelAnswer.solutionStepsLatex,
        finalAnswerLatex: input.modelAnswer.finalAnswerLatex,
        finalAnswerSympy: input.modelAnswer.finalAnswerSympy ?? null,
        commonMistakes: input.modelAnswer.commonMistakes ?? '',
        rubricVersion: 1,
      },
      update: {
        deletedAt: null,
        solutionStepsLatex: input.modelAnswer.solutionStepsLatex,
        finalAnswerLatex: input.modelAnswer.finalAnswerLatex,
        finalAnswerSympy: input.modelAnswer.finalAnswerSympy ?? null,
        commonMistakes: input.modelAnswer.commonMistakes ?? '',
        rubricVersion: nextVersion,
      },
    });
    await tx.rubricCriterion.createMany({
      data: input.rubricCriteria.map((c) => ({
        questionId,
        orderIndex: c.orderIndex,
        key: c.key,
        descriptionEn: c.descriptionEn,
        descriptionAr: c.descriptionAr,
        maxPoints: c.maxPoints,
      })),
    });
  }
}

export async function createQuestionWithChildren(
  tx: PrismaTx,
  examModelId: string,
  input: UpsertQuestionInput,
): Promise<string> {
  validateQuestionPayload(input);

  const created = await tx.question.create({
    data: {
      examModelId,
      orderIndex: input.orderIndex,
      conceptKey: input.conceptKey,
      type: input.type,
      promptLatex: input.promptLatex,
      points: input.points,
      solutionUrl: input.solutionUrl ?? null,
      needsTeacherConfirmation: input.needsTeacherConfirmation,
      teacherConfirmedAt: input.needsTeacherConfirmation ? null : new Date(),
    },
  });

  await populateQuestionChildren(tx, created.id, input);
  return created.id;
}

export async function softDeleteQuestionSubtree(
  tx: PrismaTx,
  questionId: string,
  deletedAt: Date,
): Promise<void> {
  await tx.mcqOption.updateMany({
    where: { questionId, deletedAt: null },
    data: { deletedAt },
  });
  await tx.rubricCriterion.updateMany({
    where: { questionId, deletedAt: null },
    data: { deletedAt },
  });
  await tx.modelAnswer.updateMany({
    where: { questionId, deletedAt: null },
    data: { deletedAt },
  });
}
