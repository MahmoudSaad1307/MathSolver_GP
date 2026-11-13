import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import {
  AnalyticsQuerySchema,
  UsageQuerySchema,
  type AnalyticsQueryInput,
  type UsageQueryInput,
} from '@mathlens/shared';
import type { AppEnv } from '../config/env.js';
import { requireTeacher } from '../middleware/auth.js';
import { getParamId, getTeacherId, UuidParamSchema } from '../middleware/requestHelpers.js';
import { asyncHandler, validateParams, validateQuery } from '../middleware/validate.js';
import { HttpAiServiceClient, type StatsServiceClient } from '../services/aiClient.js';
import { AnalyticsService } from '../services/analyticsService.js';
import { ExportService } from '../services/exportService.js';

export interface AnalyticsRouterDeps {
  prisma: PrismaClient;
  env: AppEnv;
  statsClient?: StatsServiceClient;
}

/** Exposes teacher analytics, AI cost usage telemetry, and cohort CSV/XLSX exports. */
export function createAnalyticsRouter({
  prisma,
  env,
  statsClient = new HttpAiServiceClient(env),
}: AnalyticsRouterDeps): Router {
  const router = Router();
  const analyticsService = new AnalyticsService(prisma, env, statsClient);
  const exportService = new ExportService(prisma);
  const teacherAuth = requireTeacher(env);

  router.get(
    '/analytics',
    teacherAuth,
    validateQuery(AnalyticsQuerySchema),
    asyncHandler(async (req, res) => {
      const filters = (res.locals.validatedQuery ?? {}) as AnalyticsQueryInput;
      const report = await analyticsService.getAnalytics(getTeacherId(req), filters);
      res.status(200).json(report);
    }),
  );

  router.get(
    '/usage',
    teacherAuth,
    validateQuery(UsageQuerySchema),
    asyncHandler(async (req, res) => {
      const query = (res.locals.validatedQuery ?? { days: 30 }) as UsageQueryInput;
      const usage = await analyticsService.getUsage(getTeacherId(req), query.days);
      res.status(200).json(usage);
    }),
  );

  router.get(
    '/cohorts/:id/export.csv',
    teacherAuth,
    validateParams(UuidParamSchema),
    asyncHandler(async (req, res) => {
      const cohortId = getParamId(req);
      const { filename, content } = await exportService.exportCohortCsv(
        getTeacherId(req),
        cohortId,
      );
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.status(200).send(content);
    }),
  );

  router.get(
    '/cohorts/:id/export.xlsx',
    teacherAuth,
    validateParams(UuidParamSchema),
    asyncHandler(async (req, res) => {
      const cohortId = getParamId(req);
      const { filename, buffer } = await exportService.exportCohortXlsx(
        getTeacherId(req),
        cohortId,
      );
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.status(200).send(buffer);
    }),
  );

  return router;
}
