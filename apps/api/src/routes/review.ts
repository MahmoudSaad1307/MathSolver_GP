import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import {
  ManualGradeSchema,
  PinImageSchema,
  ReviewQueueQuerySchema,
  StudentsQuerySchema,
  TeacherOverrideSchema,
  type ManualGradeInput,
  type PinImageInput,
  type ReviewQueueQuery,
  type StudentsQuery,
  type TeacherOverrideInput,
} from '@mathlens/shared';
import type { AppEnv } from '../config/env.js';
import { requireTeacher } from '../middleware/auth.js';
import { getParamId, getTeacherId, UuidParamSchema } from '../middleware/requestHelpers.js';
import {
  asyncHandler,
  validateBody,
  validateParams,
  validateQuery,
} from '../middleware/validate.js';
import type { GradingDispatcher } from '../services/gradingDispatcher.js';
import { ReviewService } from '../services/reviewService.js';
import type { StorageAdapter } from '../services/storage/index.js';

export interface ReviewRouterDeps {
  prisma: PrismaClient;
  env: AppEnv;
  storage: StorageAdapter;
  gradingDispatcher: GradingDispatcher;
}

export function createReviewRouter({
  prisma,
  env,
  storage,
  gradingDispatcher,
}: ReviewRouterDeps): Router {
  const router = Router();
  const teacherOnly = requireTeacher(env);
  const service = new ReviewService(prisma, env, storage);

  router.get(
    '/review-queue',
    teacherOnly,
    validateQuery(ReviewQueueQuerySchema),
    asyncHandler(async (req, res) => {
      const filters = (res.locals.validatedQuery ?? {}) as ReviewQueueQuery;
      const queue = await service.getReviewQueue(getTeacherId(req), filters);
      res.json(queue);
    }),
  );

  router.post(
    '/grading-results/:id/override',
    teacherOnly,
    validateParams(UuidParamSchema),
    validateBody(TeacherOverrideSchema),
    asyncHandler(async (req, res) => {
      const input = req.body as TeacherOverrideInput;
      const result = await service.overrideGradingResult(
        getTeacherId(req),
        getParamId(req),
        input,
        req.ip,
      );
      res.json(result);
    }),
  );

  router.post(
    '/answers/:id/manual-grade',
    teacherOnly,
    validateParams(UuidParamSchema),
    validateBody(ManualGradeSchema),
    asyncHandler(async (req, res) => {
      const input = req.body as ManualGradeInput;
      const result = await service.manualGradeAnswer(
        getTeacherId(req),
        getParamId(req),
        input,
        req.ip,
      );
      res.json(result);
    }),
  );

  router.post(
    '/answers/:id/retranscribe',
    teacherOnly,
    validateParams(UuidParamSchema),
    asyncHandler(async (req, res) => {
      const result = await service.retranscribeAnswer(
        getTeacherId(req),
        getParamId(req),
        gradingDispatcher,
        req.ip,
      );
      res.status(202).json(result);
    }),
  );

  router.patch(
    '/answer-images/:id/pin',
    teacherOnly,
    validateParams(UuidParamSchema),
    validateBody(PinImageSchema),
    asyncHandler(async (req, res) => {
      const { pinned } = req.body as PinImageInput;
      const result = await service.pinAnswerImage(
        getTeacherId(req),
        getParamId(req),
        pinned,
        req.ip,
      );
      res.json({ image: result });
    }),
  );

  router.get(
    '/students',
    teacherOnly,
    validateQuery(StudentsQuerySchema),
    asyncHandler(async (req, res) => {
      const query = (res.locals.validatedQuery ?? {}) as StudentsQuery;
      const result = await service.listStudents(getTeacherId(req), query);
      res.json(result);
    }),
  );

  router.get(
    '/students/:id',
    teacherOnly,
    validateParams(UuidParamSchema),
    asyncHandler(async (req, res) => {
      const detail = await service.getStudentDetail(getTeacherId(req), getParamId(req));
      res.json(detail);
    }),
  );

  return router;
}
