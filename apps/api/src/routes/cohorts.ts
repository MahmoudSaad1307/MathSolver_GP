import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import {
  CreateCohortSchema,
  RandomizeRosterSplitSchema,
  UpdateCohortSchema,
  type CreateCohortInput,
  type RandomizeRosterSplitInput,
  type UpdateCohortInput,
} from '@mathlens/shared';
import type { AppEnv } from '../config/env.js';
import { requireTeacher } from '../middleware/auth.js';
import { getParamId, getTeacherId, UuidParamSchema } from '../middleware/requestHelpers.js';
import { asyncHandler, validateBody, validateParams } from '../middleware/validate.js';
import { CohortService } from '../services/cohortService.js';

export function createCohortsRouter(prisma: PrismaClient, env: AppEnv): Router {
  const router = Router();
  const service = new CohortService(prisma, env);
  const teacherOnly = requireTeacher(env);

  router.get(
    '/',
    teacherOnly,
    asyncHandler(async (req, res) => {
      const topicId = typeof req.query.topicId === 'string' ? req.query.topicId : undefined;
      const cohorts = await service.listCohorts(getTeacherId(req), topicId);
      res.json({ cohorts });
    }),
  );

  router.post(
    '/',
    teacherOnly,
    validateBody(CreateCohortSchema),
    asyncHandler(async (req, res) => {
      const input = req.body as CreateCohortInput;
      const cohort = await service.createCohort(getTeacherId(req), input, req.ip);
      res.status(201).json({ cohort });
    }),
  );

  router.post(
    '/randomize-split',
    teacherOnly,
    validateBody(RandomizeRosterSplitSchema),
    (req, res) => {
      const input = req.body as RandomizeRosterSplitInput;
      res.json(service.randomizeRosterSplit(input));
    },
  );

  router.get(
    '/:id',
    teacherOnly,
    validateParams(UuidParamSchema),
    asyncHandler(async (req, res) => {
      const cohort = await service.getCohort(getTeacherId(req), getParamId(req));
      res.json({ cohort });
    }),
  );

  router.patch(
    '/:id',
    teacherOnly,
    validateParams(UuidParamSchema),
    validateBody(UpdateCohortSchema),
    asyncHandler(async (req, res) => {
      const input = req.body as UpdateCohortInput;
      const cohort = await service.updateCohort(
        getTeacherId(req),
        getParamId(req),
        input,
        req.ip,
      );
      res.json({ cohort });
    }),
  );

  router.delete(
    '/:id',
    teacherOnly,
    validateParams(UuidParamSchema),
    asyncHandler(async (req, res) => {
      await service.deleteCohort(getTeacherId(req), getParamId(req), req.ip);
      res.status(204).send();
    }),
  );

  return router;
}
