import type { PrismaClient } from '@prisma/client';
import {
  evaluatePublishChecklist,
  SeedTopicBundleSchema,
  UpsertQuestionSchema,
  type ImportExamBundleInput,
  type SeedExamModelSchema,
  type SeedTopicBundle,
  type UpsertQuestionInput,
} from '@mathlens/shared';
import type { z } from 'zod';
import type { AppEnv } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import { scopedTopicWhere, writeAuditLog } from '../lib/scoping.js';
import {
  createQuestionWithChildren,
  recalculateExamTotalPoints,
  resolveVideoId,
  softDeleteQuestionSubtree,
  syncTwinQuestionsForTopic,
  TOPIC_FULL_INCLUDE,
  type LoadedExamModel,
  type LoadedTopicTree,
} from './examPersistenceHelpers.js';
import { TopicService } from './topicService.js';

type SeedModelInput = z.infer<typeof SeedExamModelSchema>;

export interface ModelImportDiff {
  modelNumber: 1 | 2;
  titleChanged: boolean;
  previousTotalPoints: number;
  nextTotalPoints: number;
  addedOrderIndexes: number[];
  updatedOrderIndexes: number[];
  removedOrderIndexes: number[];
  incomingQuestionCount: number;
}

export interface BundleImportDiff {
  mode: 'CREATE_TOPIC' | 'UPDATE_TOPIC';
  topicChanges: Array<{ field: string; before: unknown; after: unknown }>;
  models: [ModelImportDiff, ModelImportDiff];
}

function validateBundleQuestions(models: [SeedModelInput, SeedModelInput]): {
  model1: SeedModelInput;
  model2: SeedModelInput;
  questions1: UpsertQuestionInput[];
  questions2: UpsertQuestionInput[];
} {
  const model1 = models.find((m) => m.modelNumber === 1);
  const model2 = models.find((m) => m.modelNumber === 2);

  if (!model1 || !model2) {
    throw new AppError('VALIDATION_ERROR', {
      messageEn: 'Bundle must include both Model 1 and Model 2.',
      messageAr: 'يجب أن تحتوي الحزمة على النموذج 1 والنموذج 2 معاً.',
    });
  }

  const parseQuestions = (m: SeedModelInput): UpsertQuestionInput[] =>
    m.questions.map((q) => {
      const parsed = UpsertQuestionSchema.safeParse({
        orderIndex: q.orderIndex,
        conceptKey: q.conceptKey,
        type: q.type,
        promptLatex: q.promptLatex,
        points: q.points,
        videoTimestampSeconds: q.videoTimestampSeconds,
        needsTeacherConfirmation: q.needsTeacherConfirmation,
        mcqOptions: q.mcqOptions,
        modelAnswer: q.modelAnswer ?? null,
        rubricCriteria: q.rubricCriteria,
      });

      if (!parsed.success) {
        const rubricIssue = parsed.error.issues.some((i) => i.path.includes('rubricCriteria'));
        if (rubricIssue) {
          throw new AppError('RUBRIC_SUM_MISMATCH', {
            details: parsed.error.flatten(),
          });
        }
        throw new AppError('VALIDATION_ERROR', {
          messageEn: `Invalid question ${q.orderIndex} in Model ${m.modelNumber}.`,
          messageAr: `بيانات السؤال ${q.orderIndex} في النموذج ${m.modelNumber} غير صالحة.`,
          details: parsed.error.flatten(),
        });
      }

      return parsed.data;
    });

  return {
    model1,
    model2,
    questions1: parseQuestions(model1),
    questions2: parseQuestions(model2),
  };
}

function diffModel(
  existing: LoadedExamModel | undefined,
  incoming: SeedModelInput,
  parsedQuestions: UpsertQuestionInput[],
): ModelImportDiff {
  const existingByOrder = new Map((existing?.questions ?? []).map((q) => [q.orderIndex, q]));
  const incomingOrderSet = new Set(parsedQuestions.map((q) => q.orderIndex));

  const addedOrderIndexes: number[] = [];
  const updatedOrderIndexes: number[] = [];
  const removedOrderIndexes: number[] = [];

  for (const q of parsedQuestions) {
    const prev = existingByOrder.get(q.orderIndex);
    if (!prev) {
      addedOrderIndexes.push(q.orderIndex);
    } else if (
      prev.conceptKey !== q.conceptKey ||
      prev.type !== q.type ||
      prev.promptLatex !== q.promptLatex ||
      prev.points !== q.points ||
      prev.videoTimestampSeconds !== q.videoTimestampSeconds ||
      prev.needsTeacherConfirmation !== q.needsTeacherConfirmation
    ) {
      updatedOrderIndexes.push(q.orderIndex);
    }
  }

  for (const prev of existing?.questions ?? []) {
    if (!incomingOrderSet.has(prev.orderIndex)) {
      removedOrderIndexes.push(prev.orderIndex);
    }
  }

  return {
    modelNumber: incoming.modelNumber,
    titleChanged: existing ? existing.title !== incoming.title : true,
    previousTotalPoints: existing?.totalPoints ?? 0,
    nextTotalPoints: parsedQuestions.reduce((acc, q) => acc + q.points, 0),
    addedOrderIndexes,
    updatedOrderIndexes,
    removedOrderIndexes,
    incomingQuestionCount: parsedQuestions.length,
  };
}

function buildImportDiff(
  existingTopic: LoadedTopicTree | null,
  bundle: SeedTopicBundle,
  model1: SeedModelInput,
  model2: SeedModelInput,
  questions1: UpsertQuestionInput[],
  questions2: UpsertQuestionInput[],
): BundleImportDiff {
  const topicChanges: BundleImportDiff['topicChanges'] = [];

  if (!existingTopic) {
    topicChanges.push(
      { field: 'title', before: null, after: bundle.topic.title },
      { field: 'videoUrl', before: null, after: bundle.topic.videoUrl },
    );
  } else {
    const fields: Array<keyof typeof bundle.topic> = [
      'title',
      'description',
      'videoUrl',
      'minWatchSeconds',
      'correctnessThreshold',
    ];
    for (const field of fields) {
      if (existingTopic[field] !== bundle.topic[field]) {
        topicChanges.push({
          field,
          before: existingTopic[field],
          after: bundle.topic[field],
        });
      }
    }
  }

  const existingM1 = existingTopic?.examModels.find((m) => m.modelNumber === 1);
  const existingM2 = existingTopic?.examModels.find((m) => m.modelNumber === 2);

  return {
    mode: existingTopic ? 'UPDATE_TOPIC' : 'CREATE_TOPIC',
    topicChanges,
    models: [diffModel(existingM1, model1, questions1), diffModel(existingM2, model2, questions2)],
  };
}

export class ExamImportExportService {
  private readonly topicService: TopicService;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly env: AppEnv,
  ) {
    this.topicService = new TopicService(prisma, env);
  }

  async exportTopicBundle(teacherId: string, topicId: string): Promise<SeedTopicBundle> {
    const topic = await this.prisma.topic.findFirst({
      where: {
        id: topicId,
        ...scopedTopicWhere(teacherId),
      },
      include: TOPIC_FULL_INCLUDE,
    });

    if (!topic) {
      throw new AppError('NOT_FOUND');
    }

    const m1 = topic.examModels.find((m) => m.modelNumber === 1);
    const m2 = topic.examModels.find((m) => m.modelNumber === 2);
    if (!m1 || !m2) {
      throw new AppError('CONFLICT', {
        messageEn: 'Topic is missing Model 1 or Model 2 and cannot be exported.',
        messageAr: 'الموضوع يفتقد النموذج 1 أو النموذج 2 ولا يمكن تصديره.',
      });
    }

    const mapModel = (model: LoadedExamModel, modelNumber: 1 | 2) => ({
      modelNumber,
      title: model.title,
      durationMinutes: model.durationMinutes,
      status: model.status,
      questions: model.questions.map((q) => ({
        orderIndex: q.orderIndex,
        conceptKey: q.conceptKey,
        type: q.type,
        promptLatex: q.promptLatex,
        points: q.points,
        videoTimestampSeconds: q.videoTimestampSeconds,
        needsTeacherConfirmation: q.needsTeacherConfirmation,
        ...(q.type === 'MCQ'
          ? {
              mcqOptions: q.mcqOptions.map((o) => ({
                label: o.label as 'A' | 'B' | 'C' | 'D',
                textLatex: o.textLatex,
                isCorrect: o.isCorrect,
              })),
            }
          : {
              modelAnswer:
                q.modelAnswer && q.modelAnswer.deletedAt === null
                  ? {
                      solutionStepsLatex: q.modelAnswer.solutionStepsLatex,
                      finalAnswerLatex: q.modelAnswer.finalAnswerLatex,
                      finalAnswerSympy: q.modelAnswer.finalAnswerSympy,
                      commonMistakes: q.modelAnswer.commonMistakes,
                    }
                  : undefined,
              rubricCriteria: q.rubricCriteria.map((c) => ({
                orderIndex: c.orderIndex,
                key: c.key,
                descriptionEn: c.descriptionEn,
                descriptionAr: c.descriptionAr,
                maxPoints: c.maxPoints,
              })),
            }),
      })),
    });

    return SeedTopicBundleSchema.parse({
      topic: {
        title: topic.title,
        description: topic.description,
        videoUrl: topic.videoUrl,
        minWatchSeconds: topic.minWatchSeconds,
        correctnessThreshold: topic.correctnessThreshold,
      },
      models: [mapModel(m1, 1), mapModel(m2, 2)],
    });
  }

  async importExamBundle(
    teacherId: string,
    input: ImportExamBundleInput,
    ip?: string,
  ): Promise<{
    dryRun: boolean;
    applied: boolean;
    diff: BundleImportDiff;
    topicId: string | null;
    topic: Awaited<ReturnType<TopicService['getTopic']>> | null;
  }> {
    const { bundle, dryRun, targetTopicId } = input;
    const { model1, model2, questions1, questions2 } = validateBundleQuestions(bundle.models);

    let existingTopic: LoadedTopicTree | null = null;
    if (targetTopicId) {
      existingTopic = await this.prisma.topic.findFirst({
        where: {
          id: targetTopicId,
          ...scopedTopicWhere(teacherId),
        },
        include: TOPIC_FULL_INCLUDE,
      });
      if (!existingTopic) {
        throw new AppError('NOT_FOUND');
      }
    }

    const diff = buildImportDiff(existingTopic, bundle, model1, model2, questions1, questions2);
    if (dryRun) {
      return {
        dryRun: true,
        applied: false,
        diff,
        topicId: targetTopicId ?? null,
        topic: null,
      };
    }

    const checklist = evaluatePublishChecklist(
      { videoUrl: bundle.topic.videoUrl },
      { modelNumber: 1, questions: questions1 },
      { modelNumber: 2, questions: questions2 },
    );
    const resolvedStatus1 =
      model1.status === 'PUBLISHED' && checklist.ready ? 'PUBLISHED' : 'DRAFT';
    const resolvedStatus2 =
      model2.status === 'PUBLISHED' && checklist.ready ? 'PUBLISHED' : 'DRAFT';
    const videoId = resolveVideoId(bundle.topic.videoUrl);

    const savedTopicId = await this.prisma.$transaction(async (tx) => {
      let topicId: string;
      let model1Id: string;
      let model2Id: string;
      const now = new Date();

      if (existingTopic) {
        topicId = existingTopic.id;
        await tx.topic.update({
          where: { id: topicId },
          data: {
            title: bundle.topic.title,
            description: bundle.topic.description,
            videoUrl: bundle.topic.videoUrl,
            videoId,
            minWatchSeconds: bundle.topic.minWatchSeconds,
            correctnessThreshold: bundle.topic.correctnessThreshold,
          },
        });

        const existingM1 = existingTopic.examModels.find((m) => m.modelNumber === 1);
        const existingM2 = existingTopic.examModels.find((m) => m.modelNumber === 2);

        if (!existingM1 || !existingM2) {
          throw new AppError('CONFLICT', {
            messageEn: 'Target topic is missing paired Model 1 or Model 2.',
            messageAr: 'الموضوع المستهدف يفتقد أحد النموذجين 1 أو 2.',
          });
        }

        model1Id = existingM1.id;
        model2Id = existingM2.id;

        for (const existingQ of [...existingM1.questions, ...existingM2.questions]) {
          await softDeleteQuestionSubtree(tx, existingQ.id, now);
        }

        await tx.question.updateMany({
          where: { examModelId: { in: [model1Id, model2Id] }, deletedAt: null },
          data: { deletedAt: now, twinQuestionId: null },
        });

        await tx.examModel.update({
          where: { id: model1Id },
          data: {
            title: model1.title,
            durationMinutes: model1.durationMinutes,
            status: resolvedStatus1,
          },
        });

        await tx.examModel.update({
          where: { id: model2Id },
          data: {
            title: model2.title,
            durationMinutes: model2.durationMinutes,
            status: resolvedStatus2,
          },
        });
      } else {
        const createdTopic = await tx.topic.create({
          data: {
            ownerId: teacherId,
            title: bundle.topic.title,
            description: bundle.topic.description,
            videoUrl: bundle.topic.videoUrl,
            videoId,
            minWatchSeconds: bundle.topic.minWatchSeconds,
            correctnessThreshold: bundle.topic.correctnessThreshold,
          },
        });
        topicId = createdTopic.id;

        const createdM1 = await tx.examModel.create({
          data: {
            topicId,
            modelNumber: 1,
            title: model1.title,
            durationMinutes: model1.durationMinutes,
            totalPoints: 0,
            status: resolvedStatus1,
          },
        });

        const createdM2 = await tx.examModel.create({
          data: {
            topicId,
            modelNumber: 2,
            title: model2.title,
            durationMinutes: model2.durationMinutes,
            totalPoints: 0,
            status: resolvedStatus2,
            pairedWithId: createdM1.id,
          },
        });

        await tx.examModel.update({
          where: { id: createdM1.id },
          data: { pairedWithId: createdM2.id },
        });

        model1Id = createdM1.id;
        model2Id = createdM2.id;
      }

      for (const q of questions1) {
        await createQuestionWithChildren(tx, model1Id, q);
      }
      for (const q of questions2) {
        await createQuestionWithChildren(tx, model2Id, q);
      }

      await recalculateExamTotalPoints(tx, model1Id);
      await recalculateExamTotalPoints(tx, model2Id);
      await syncTwinQuestionsForTopic(tx, topicId);

      await writeAuditLog(tx, this.env, {
        actorType: 'TEACHER',
        actorId: teacherId,
        action: 'EXAM_BUNDLE_IMPORT',
        entity: 'Topic',
        entityId: topicId,
        diff,
        ip,
      });

      return topicId;
    });

    const loaded = await this.topicService.getTopic(teacherId, savedTopicId);
    return {
      dryRun: false,
      applied: true,
      diff,
      topicId: savedTopicId,
      topic: loaded,
    };
  }

  async seedTopicBundleIfMissing(
    teacherId: string,
    bundle: SeedTopicBundle,
  ): Promise<{ seeded: boolean; topicId: string }> {
    const existing = await this.prisma.topic.findFirst({
      where: {
        ...scopedTopicWhere(teacherId),
        title: bundle.topic.title,
      },
      select: { id: true },
    });

    if (existing) {
      return { seeded: false, topicId: existing.id };
    }

    const res = await this.importExamBundle(teacherId, {
      dryRun: false,
      bundle,
    });

    return {
      seeded: true,
      topicId: res.topicId!,
    };
  }
}
