import { Router, type Request } from 'express';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import {
  CreateTopicSchema,
  ImportExamBundleSchema,
  UpdateExamModelSchema,
  UpdateRubricSchema,
  UpdateTopicSchema,
  UpsertQuestionSchema,
  type CreateTopicInput,
  type ImportExamBundleInput,
  type UpdateExamModelInput,
  type UpdateRubricInput,
  type UpdateTopicInput,
  type UpsertQuestionInput,
} from '@mathlens/shared';
import type { AppEnv } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import { requireTeacher } from '../middleware/auth.js';
import { asyncHandler, validateBody, validateParams } from '../middleware/validate.js';
import { ExamImportExportService } from '../services/examImportExportService.js';
import { TopicService } from '../services/topicService.js';

const UuidParamSchema = z.object({
  id: z.string().uuid(),
});

function getTeacherId(req: Request): string {
  if (!req.teacher) {
    throw new AppError('UNAUTHORIZED');
  }
  return req.teacher.id;
}

function getParamId(req: Request): string {
  const id = req.params.id;
  if (typeof id !== 'string') {
    throw new AppError('VALIDATION_ERROR');
  }
  return id;
}

export function createTeacherContentRouter(prisma: PrismaClient, env: AppEnv): Router {
  const router = Router();
  const topicService = new TopicService(prisma, env);
  const importExportService = new ExamImportExportService(prisma, env);
  const teacherOnly = requireTeacher(env);

  // --- Topics ---
  router.get(
    '/topics',
    teacherOnly,
    asyncHandler(async (req, res) => {
      const topics = await topicService.listTopics(getTeacherId(req));
      res.json({ topics });
    }),
  );

  router.post(
    '/topics',
    teacherOnly,
    validateBody(CreateTopicSchema),
    asyncHandler(async (req, res) => {
      const input = req.body as CreateTopicInput;
      const topic = await topicService.createTopic(getTeacherId(req), input, req.ip);
      res.status(201).json({ topic });
    }),
  );

  router.get(
    '/topics/:id',
    teacherOnly,
    validateParams(UuidParamSchema),
    asyncHandler(async (req, res) => {
      const topic = await topicService.getTopic(getTeacherId(req), getParamId(req));
      res.json({ topic });
    }),
  );

  router.patch(
    '/topics/:id',
    teacherOnly,
    validateParams(UuidParamSchema),
    validateBody(UpdateTopicSchema),
    asyncHandler(async (req, res) => {
      const input = req.body as UpdateTopicInput;
      const topic = await topicService.updateTopic(
        getTeacherId(req),
        getParamId(req),
        input,
        req.ip,
      );
      res.json({ topic });
    }),
  );

  router.delete(
    '/topics/:id',
    teacherOnly,
    validateParams(UuidParamSchema),
    asyncHandler(async (req, res) => {
      await topicService.deleteTopic(getTeacherId(req), getParamId(req), req.ip);
      res.status(204).send();
    }),
  );

  router.get(
    '/topics/:id/exams',
    teacherOnly,
    validateParams(UuidParamSchema),
    asyncHandler(async (req, res) => {
      const topic = await topicService.getTopic(getTeacherId(req), getParamId(req));
      res.json({
        topic: {
          id: topic.id,
          title: topic.title,
          description: topic.description,
          correctnessThreshold: topic.correctnessThreshold,
        },
        models: topic.examModels,
        publishChecklist: topic.publishChecklist,
      });
    }),
  );

  router.get(
    '/topics/:id/export',
    teacherOnly,
    validateParams(UuidParamSchema),
    asyncHandler(async (req, res) => {
      const topicId = getParamId(req);
      const bundle = await importExportService.exportTopicBundle(getTeacherId(req), topicId);
      if (req.query.download === '1' || req.query.download === 'true') {
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="mathlens-topic-${topicId}.json"`,
        );
      }
      res.json(bundle);
    }),
  );

  // --- Exams & Import ---
  router.post(
    '/exams/import',
    teacherOnly,
    validateBody(ImportExamBundleSchema),
    asyncHandler(async (req, res) => {
      const input = req.body as ImportExamBundleInput;
      const result = await importExportService.importExamBundle(getTeacherId(req), input, req.ip);
      res.json(result);
    }),
  );

  router.get(
    '/exams/:id',
    teacherOnly,
    validateParams(UuidParamSchema),
    asyncHandler(async (req, res) => {
      const exam = await topicService.getExamModel(getTeacherId(req), getParamId(req));
      res.json({ exam });
    }),
  );

  router.patch(
    '/exams/:id',
    teacherOnly,
    validateParams(UuidParamSchema),
    validateBody(UpdateExamModelSchema),
    asyncHandler(async (req, res) => {
      const input = req.body as UpdateExamModelInput;
      const exam = await topicService.updateExamModel(
        getTeacherId(req),
        getParamId(req),
        input,
        req.ip,
      );
      res.json({ exam });
    }),
  );

  router.post(
    '/exams/:id/publish',
    teacherOnly,
    validateParams(UuidParamSchema),
    asyncHandler(async (req, res) => {
      const exam = await topicService.publishExam(getTeacherId(req), getParamId(req), req.ip);
      res.json({ exam });
    }),
  );

  router.post(
    '/exams/:id/unpublish',
    teacherOnly,
    validateParams(UuidParamSchema),
    asyncHandler(async (req, res) => {
      const exam = await topicService.unpublishExam(getTeacherId(req), getParamId(req), req.ip);
      res.json({ exam });
    }),
  );

  // --- Questions & Rubrics ---
  router.post(
    '/exams/:id/questions',
    teacherOnly,
    validateParams(UuidParamSchema),
    validateBody(UpsertQuestionSchema),
    asyncHandler(async (req, res) => {
      const input = req.body as UpsertQuestionInput;
      const question = await topicService.addQuestion(
        getTeacherId(req),
        getParamId(req),
        input,
        req.ip,
      );
      res.status(201).json({ question });
    }),
  );

  router.patch(
    '/questions/:id',
    teacherOnly,
    validateParams(UuidParamSchema),
    validateBody(UpsertQuestionSchema),
    asyncHandler(async (req, res) => {
      const input = req.body as UpsertQuestionInput;
      const question = await topicService.updateQuestion(
        getTeacherId(req),
        getParamId(req),
        input,
        req.ip,
      );
      res.json({ question });
    }),
  );

  router.delete(
    '/questions/:id',
    teacherOnly,
    validateParams(UuidParamSchema),
    asyncHandler(async (req, res) => {
      await topicService.deleteQuestion(getTeacherId(req), getParamId(req), req.ip);
      res.status(204).send();
    }),
  );

  router.post(
    '/questions/:id/confirm',
    teacherOnly,
    validateParams(UuidParamSchema),
    asyncHandler(async (req, res) => {
      const question = await topicService.confirmQuestion(
        getTeacherId(req),
        getParamId(req),
        req.ip,
      );
      res.json({ question });
    }),
  );

  router.put(
    '/questions/:id/rubric',
    teacherOnly,
    validateParams(UuidParamSchema),
    validateBody(UpdateRubricSchema),
    asyncHandler(async (req, res) => {
      const input = req.body as UpdateRubricInput;
      const question = await topicService.updateRubric(
        getTeacherId(req),
        getParamId(req),
        input,
        req.ip,
      );
      res.json({ question });
    }),
  );

  return router;
}
