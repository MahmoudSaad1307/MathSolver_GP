import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import {
  VideoAlertSchema,
  VideoHeartbeatSchema,
  type VideoAlertInput,
  type VideoHeartbeatInput,
} from '@mathlens/shared';
import type { AppEnv } from '../config/env.js';
import { requireStudent } from '../middleware/auth.js';
import { getStudentSession } from '../middleware/requestHelpers.js';
import { asyncHandler, validateBody } from '../middleware/validate.js';
import { ComparisonService } from '../services/comparisonService.js';
import { VideoService } from '../services/videoService.js';

export interface StudentVideoRouterDeps {
  prisma: PrismaClient;
  env: AppEnv;
}

export function createStudentVideoRouter({ prisma, env }: StudentVideoRouterDeps): Router {
  const router = Router();
  const studentOnly = requireStudent(env);
  const videoService = new VideoService(prisma, env);
  const comparisonService = new ComparisonService(prisma);

  router.get(
    '/video/state',
    studentOnly,
    asyncHandler(async (req, res) => {
      const { studentId } = getStudentSession(req);
      const state = await videoService.getVideoState(studentId);
      res.json(state);
    }),
  );

  router.post(
    '/video/heartbeat',
    studentOnly,
    validateBody(VideoHeartbeatSchema),
    asyncHandler(async (req, res) => {
      const { studentId } = getStudentSession(req);
      const input = req.body as VideoHeartbeatInput;
      const result = await videoService.recordHeartbeat(studentId, input);
      res.json(result);
    }),
  );

  router.post(
    '/video/alert',
    studentOnly,
    validateBody(VideoAlertSchema),
    asyncHandler(async (req, res) => {
      const { studentId } = getStudentSession(req);
      const { errorCode } = req.body as VideoAlertInput;
      const result = await videoService.reportPlayerAlert(studentId, errorCode, req.ip);
      res.status(201).json(result);
    }),
  );

  router.get(
    '/comparison',
    studentOnly,
    asyncHandler(async (req, res) => {
      const { studentId } = getStudentSession(req);
      const comparison = await comparisonService.getStudentComparison(studentId);
      res.json(comparison);
    }),
  );

  return router;
}
