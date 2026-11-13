import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { ReportMisreadSchema, type ReportMisreadInput } from '@mathlens/shared';
import type { AppEnv } from '../config/env.js';
import { requireStudent } from '../middleware/auth.js';
import { getParamId, getStudentSession, UuidParamSchema } from '../middleware/requestHelpers.js';
import { asyncHandler, validateBody, validateParams } from '../middleware/validate.js';
import type { StorageAdapter } from '../services/storage/index.js';
import { StudentResultsService } from '../services/studentResultsService.js';

export interface StudentResultsRouterDeps {
  prisma: PrismaClient;
  env: AppEnv;
  storage: StorageAdapter;
}

export function createStudentResultsRouter({
  prisma,
  env,
  storage,
}: StudentResultsRouterDeps): Router {
  const router = Router();
  const studentOnly = requireStudent(env);
  const service = new StudentResultsService(prisma, env, storage);

  router.get(
    '/attempts/:id/results',
    studentOnly,
    validateParams(UuidParamSchema),
    asyncHandler(async (req, res) => {
      const { studentId } = getStudentSession(req);
      const result = await service.getAttemptResults(studentId, getParamId(req));
      res.json(result);
    }),
  );

  router.post(
    '/answers/:id/report-misread',
    studentOnly,
    validateParams(UuidParamSchema),
    validateBody(ReportMisreadSchema),
    asyncHandler(async (req, res) => {
      const { studentId } = getStudentSession(req);
      const input = req.body as ReportMisreadInput;
      const result = await service.reportMisread(studentId, getParamId(req), input, req.ip);
      res.json(result);
    }),
  );

  return router;
}
