import type { PrismaClient } from '@prisma/client';
import type {
  CreateTopicInput,
  UpdateExamModelInput,
  UpdateRubricInput,
  UpdateTopicInput,
  UpsertQuestionInput,
} from '@mathlens/shared';
import { isRubricSumValid } from '@mathlens/shared';
import type { AppEnv } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import { scopedTopicWhere, writeAuditLog, type PrismaTx } from '../lib/scoping.js';
import {
  computeTopicStatusMetadata,
  createQuestionWithChildren,
  populateQuestionChildren,
  recalculateExamTotalPoints,
  serializeTopicWithStatus,
  softDeleteQuestionSubtree,
  syncTwinQuestionsForTopic,
  TOPIC_FULL_INCLUDE,
  validateQuestionPayload,
  type LoadedTopicTree,
} from './examPersistenceHelpers.js';

export class TopicService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly env: AppEnv,
  ) {}

  private async loadOwnedTopicOrThrow(
    tx: PrismaTx,
    teacherId: string,
    topicId: string,
  ): Promise<LoadedTopicTree> {
    const topic = await tx.topic.findFirst({
      where: {
        id: topicId,
        ...scopedTopicWhere(teacherId),
      },
      include: TOPIC_FULL_INCLUDE,
    });
    if (!topic) {
      throw new AppError('NOT_FOUND');
    }
    return topic;
  }

  private async loadOwnedExamOrThrow(tx: PrismaTx, teacherId: string, examId: string) {
    const exam = await tx.examModel.findFirst({
      where: {
        id: examId,
        deletedAt: null,
        topic: scopedTopicWhere(teacherId),
      },
      include: {
        topic: true,
        questions: {
          where: { deletedAt: null },
          orderBy: { orderIndex: 'asc' },
          include: {
            mcqOptions: {
              where: { deletedAt: null },
              orderBy: { label: 'asc' },
            },
            modelAnswer: true,
            rubricCriteria: {
              where: { deletedAt: null },
              orderBy: { orderIndex: 'asc' },
            },
          },
        },
      },
    });
    if (!exam) {
      throw new AppError('NOT_FOUND');
    }
    return exam;
  }

  private async loadOwnedQuestionOrThrow(tx: PrismaTx, teacherId: string, questionId: string) {
    const question = await tx.question.findFirst({
      where: {
        id: questionId,
        deletedAt: null,
        examModel: {
          deletedAt: null,
          topic: scopedTopicWhere(teacherId),
        },
      },
      include: {
        examModel: true,
        mcqOptions: {
          where: { deletedAt: null },
          orderBy: { label: 'asc' },
        },
        modelAnswer: true,
        rubricCriteria: {
          where: { deletedAt: null },
          orderBy: { orderIndex: 'asc' },
        },
      },
    });
    if (!question) {
      throw new AppError('NOT_FOUND');
    }
    return question;
  }

  async listTopics(teacherId: string) {
    const topics = await this.prisma.topic.findMany({
      where: scopedTopicWhere(teacherId),
      orderBy: { createdAt: 'desc' },
      include: {
        ...TOPIC_FULL_INCLUDE,
        _count: {
          select: {
            cohorts: {
              where: { deletedAt: null },
            },
          },
        },
      },
    });

    return topics.map((topic) => {
      const { _count, ...rest } = topic;
      return {
        ...serializeTopicWithStatus(rest),
        cohortCount: _count.cohorts,
      };
    });
  }

  async getTopic(teacherId: string, topicId: string) {
    const topic = await this.loadOwnedTopicOrThrow(this.prisma, teacherId, topicId);
    return serializeTopicWithStatus(topic);
  }

  async createTopic(teacherId: string, input: CreateTopicInput, ip?: string) {
    const createdId = await this.prisma.$transaction(async (tx) => {
      const topic = await tx.topic.create({
        data: {
          ownerId: teacherId,
          title: input.title,
          description: input.description ?? '',
          correctnessThreshold: input.correctnessThreshold,
        },
      });

      const model1 = await tx.examModel.create({
        data: {
          topicId: topic.id,
          modelNumber: 1,
          title: `${input.title} — النموذج 1`,
          durationMinutes: 60,
          totalPoints: 0,
          status: 'DRAFT',
        },
      });

      const model2 = await tx.examModel.create({
        data: {
          topicId: topic.id,
          modelNumber: 2,
          title: `${input.title} — النموذج 2`,
          durationMinutes: 60,
          totalPoints: 0,
          status: 'DRAFT',
          pairedWithId: model1.id,
        },
      });

      await tx.examModel.update({
        where: { id: model1.id },
        data: { pairedWithId: model2.id },
      });

      await writeAuditLog(tx, this.env, {
        actorType: 'TEACHER',
        actorId: teacherId,
        action: 'TOPIC_CREATE',
        entity: 'Topic',
        entityId: topic.id,
        diff: { title: topic.title },
        ip,
      });

      return topic.id;
    });

    return this.getTopic(teacherId, createdId);
  }

  async updateTopic(teacherId: string, topicId: string, input: UpdateTopicInput, ip?: string) {
    await this.prisma.$transaction(async (tx) => {
      const existing = await this.loadOwnedTopicOrThrow(tx, teacherId, topicId);

      await tx.topic.update({
        where: { id: existing.id },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.correctnessThreshold !== undefined
            ? { correctnessThreshold: input.correctnessThreshold }
            : {}),
        },
      });

      await writeAuditLog(tx, this.env, {
        actorType: 'TEACHER',
        actorId: teacherId,
        action: 'TOPIC_UPDATE',
        entity: 'Topic',
        entityId: existing.id,
        diff: input,
        ip,
      });
    });

    return this.getTopic(teacherId, topicId);
  }

  async deleteTopic(teacherId: string, topicId: string, ip?: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const existing = await this.loadOwnedTopicOrThrow(tx, teacherId, topicId);
      const now = new Date();
      const examIds = existing.examModels.map((m) => m.id);

      await tx.question.updateMany({
        where: { examModelId: { in: examIds }, deletedAt: null },
        data: { deletedAt: now, twinQuestionId: null },
      });
      await tx.examModel.updateMany({
        where: { topicId: existing.id, deletedAt: null },
        data: { deletedAt: now },
      });
      await tx.topic.update({
        where: { id: existing.id },
        data: { deletedAt: now },
      });

      await writeAuditLog(tx, this.env, {
        actorType: 'TEACHER',
        actorId: teacherId,
        action: 'TOPIC_DELETE',
        entity: 'Topic',
        entityId: existing.id,
        ip,
      });
    });
  }

  async getExamModel(teacherId: string, examId: string) {
    const exam = await this.loadOwnedExamOrThrow(this.prisma, teacherId, examId);
    const topic = await this.loadOwnedTopicOrThrow(this.prisma, teacherId, exam.topicId);
    return {
      ...exam,
      questions: exam.questions.map((q) => ({
        ...q,
        modelAnswer: q.modelAnswer && q.modelAnswer.deletedAt === null ? q.modelAnswer : null,
      })),
      ...computeTopicStatusMetadata(topic),
    };
  }

  async updateExamModel(
    teacherId: string,
    examId: string,
    input: UpdateExamModelInput,
    ip?: string,
  ) {
    if (input.status === 'PUBLISHED') {
      return this.publishExam(teacherId, examId, ip);
    }

    await this.prisma.$transaction(async (tx) => {
      const existing = await this.loadOwnedExamOrThrow(tx, teacherId, examId);
      await tx.examModel.update({
        where: { id: existing.id },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.durationMinutes !== undefined
            ? { durationMinutes: input.durationMinutes }
            : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
        },
      });

      await writeAuditLog(tx, this.env, {
        actorType: 'TEACHER',
        actorId: teacherId,
        action: 'EXAM_UPDATE',
        entity: 'ExamModel',
        entityId: existing.id,
        diff: input,
        ip,
      });
    });

    return this.getExamModel(teacherId, examId);
  }

  async addQuestion(teacherId: string, examId: string, input: UpsertQuestionInput, ip?: string) {
    const createdQuestionId = await this.prisma.$transaction(async (tx) => {
      const exam = await this.loadOwnedExamOrThrow(tx, teacherId, examId);
      const questionId = await createQuestionWithChildren(tx, exam.id, input);
      await recalculateExamTotalPoints(tx, exam.id);
      await syncTwinQuestionsForTopic(tx, exam.topicId);

      await writeAuditLog(tx, this.env, {
        actorType: 'TEACHER',
        actorId: teacherId,
        action: 'QUESTION_CREATE',
        entity: 'Question',
        entityId: questionId,
        diff: { examId: exam.id, orderIndex: input.orderIndex, conceptKey: input.conceptKey },
        ip,
      });

      return questionId;
    });

    return this.loadOwnedQuestionOrThrow(this.prisma, teacherId, createdQuestionId);
  }

  async updateQuestion(
    teacherId: string,
    questionId: string,
    input: UpsertQuestionInput,
    ip?: string,
  ) {
    validateQuestionPayload(input);

    await this.prisma.$transaction(async (tx) => {
      const existing = await this.loadOwnedQuestionOrThrow(tx, teacherId, questionId);
      const now = new Date();

      await tx.question.update({
        where: { id: existing.id },
        data: {
          orderIndex: input.orderIndex,
          conceptKey: input.conceptKey,
          type: input.type,
          promptLatex: input.promptLatex,
          points: input.points,
          solutionUrl: input.solutionUrl === undefined ? existing.solutionUrl : input.solutionUrl,
          needsTeacherConfirmation: input.needsTeacherConfirmation,
          teacherConfirmedAt: input.needsTeacherConfirmation
            ? null
            : (existing.teacherConfirmedAt ?? now),
        },
      });

      const prevMa = existing.modelAnswer;
      const nextMa = input.modelAnswer;
      const prevCriteria = existing.rubricCriteria ?? [];
      const nextCriteria = input.rubricCriteria ?? [];
      const rubricUnchanged =
        Boolean(prevMa && nextMa) &&
        JSON.stringify(prevMa?.solutionStepsLatex ?? []) ===
          JSON.stringify(nextMa?.solutionStepsLatex ?? []) &&
        (prevMa?.finalAnswerLatex ?? '') === (nextMa?.finalAnswerLatex ?? '') &&
        (prevMa?.finalAnswerSympy ?? null) === (nextMa?.finalAnswerSympy ?? null) &&
        (prevMa?.commonMistakes ?? '') === (nextMa?.commonMistakes ?? '') &&
        prevCriteria.length === nextCriteria.length &&
        prevCriteria.every((c, idx) => {
          const nc = nextCriteria[idx];
          return (
            nc !== undefined &&
            c.orderIndex === nc.orderIndex &&
            c.key === nc.key &&
            c.descriptionEn === nc.descriptionEn &&
            c.descriptionAr === nc.descriptionAr &&
            c.maxPoints === nc.maxPoints
          );
        });

      await softDeleteQuestionSubtree(tx, existing.id, now);
      await populateQuestionChildren(
        tx,
        existing.id,
        input,
        existing.modelAnswer?.rubricVersion ?? null,
        !rubricUnchanged,
      );

      await recalculateExamTotalPoints(tx, existing.examModelId);
      await syncTwinQuestionsForTopic(tx, existing.examModel.topicId);

      await writeAuditLog(tx, this.env, {
        actorType: 'TEACHER',
        actorId: teacherId,
        action: 'QUESTION_UPDATE',
        entity: 'Question',
        entityId: existing.id,
        diff: { orderIndex: input.orderIndex, conceptKey: input.conceptKey, points: input.points },
        ip,
      });
    });

    return this.loadOwnedQuestionOrThrow(this.prisma, teacherId, questionId);
  }

  async deleteQuestion(teacherId: string, questionId: string, ip?: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const existing = await this.loadOwnedQuestionOrThrow(tx, teacherId, questionId);
      const now = new Date();

      if (existing.twinQuestionId) {
        await tx.question.update({
          where: { id: existing.twinQuestionId },
          data: { twinQuestionId: null },
        });
      }

      await softDeleteQuestionSubtree(tx, existing.id, now);
      await tx.question.update({
        where: { id: existing.id },
        data: { deletedAt: now, twinQuestionId: null },
      });

      await recalculateExamTotalPoints(tx, existing.examModelId);
      await syncTwinQuestionsForTopic(tx, existing.examModel.topicId);

      await writeAuditLog(tx, this.env, {
        actorType: 'TEACHER',
        actorId: teacherId,
        action: 'QUESTION_DELETE',
        entity: 'Question',
        entityId: existing.id,
        ip,
      });
    });
  }

  async confirmQuestion(teacherId: string, questionId: string, ip?: string) {
    await this.prisma.$transaction(async (tx) => {
      const existing = await this.loadOwnedQuestionOrThrow(tx, teacherId, questionId);
      await tx.question.update({
        where: { id: existing.id },
        data: {
          needsTeacherConfirmation: false,
          teacherConfirmedAt: new Date(),
        },
      });

      await writeAuditLog(tx, this.env, {
        actorType: 'TEACHER',
        actorId: teacherId,
        action: 'QUESTION_CONFIRM',
        entity: 'Question',
        entityId: existing.id,
        ip,
      });
    });

    return this.loadOwnedQuestionOrThrow(this.prisma, teacherId, questionId);
  }

  async updateRubric(teacherId: string, questionId: string, input: UpdateRubricInput, ip?: string) {
    await this.prisma.$transaction(async (tx) => {
      const existing = await this.loadOwnedQuestionOrThrow(tx, teacherId, questionId);
      if (existing.type !== 'ESSAY') {
        throw new AppError('VALIDATION_ERROR', {
          messageEn: 'Rubric criteria apply only to essay questions.',
          messageAr: 'معايير التصحيح متاحة للأسئلة المقالية فقط.',
        });
      }

      if (!isRubricSumValid(existing.points, input.criteria)) {
        throw new AppError('RUBRIC_SUM_MISMATCH');
      }

      const now = new Date();
      await tx.rubricCriterion.updateMany({
        where: { questionId: existing.id, deletedAt: null },
        data: { deletedAt: now },
      });

      await tx.rubricCriterion.createMany({
        data: input.criteria.map((c) => ({
          questionId: existing.id,
          orderIndex: c.orderIndex,
          key: c.key,
          descriptionEn: c.descriptionEn,
          descriptionAr: c.descriptionAr,
          maxPoints: c.maxPoints,
        })),
      });

      if (existing.modelAnswer && existing.modelAnswer.deletedAt === null) {
        await tx.modelAnswer.update({
          where: { questionId: existing.id },
          data: { rubricVersion: existing.modelAnswer.rubricVersion + 1 },
        });
      }

      await writeAuditLog(tx, this.env, {
        actorType: 'TEACHER',
        actorId: teacherId,
        action: 'RUBRIC_UPDATE',
        entity: 'Question',
        entityId: existing.id,
        diff: { criteriaCount: input.criteria.length, points: existing.points },
        ip,
      });
    });

    return this.loadOwnedQuestionOrThrow(this.prisma, teacherId, questionId);
  }

  async publishExam(teacherId: string, examId: string, ip?: string) {
    await this.prisma.$transaction(async (tx) => {
      const exam = await this.loadOwnedExamOrThrow(tx, teacherId, examId);
      const topic = await this.loadOwnedTopicOrThrow(tx, teacherId, exam.topicId);
      const metadata = computeTopicStatusMetadata(topic);

      if (!metadata.publishChecklist.ready) {
        throw new AppError('PUBLISH_CHECKLIST_FAILED', {
          details: metadata.publishChecklist,
        });
      }

      await tx.examModel.update({
        where: { id: exam.id },
        data: { status: 'PUBLISHED' },
      });

      await writeAuditLog(tx, this.env, {
        actorType: 'TEACHER',
        actorId: teacherId,
        action: 'EXAM_PUBLISH',
        entity: 'ExamModel',
        entityId: exam.id,
        ip,
      });
    });

    return this.getExamModel(teacherId, examId);
  }

  async unpublishExam(teacherId: string, examId: string, ip?: string) {
    await this.prisma.$transaction(async (tx) => {
      const exam = await this.loadOwnedExamOrThrow(tx, teacherId, examId);
      await tx.examModel.update({
        where: { id: exam.id },
        data: { status: 'DRAFT' },
      });

      await writeAuditLog(tx, this.env, {
        actorType: 'TEACHER',
        actorId: teacherId,
        action: 'EXAM_UNPUBLISH',
        entity: 'ExamModel',
        entityId: exam.id,
        ip,
      });
    });

    return this.getExamModel(teacherId, examId);
  }
}
