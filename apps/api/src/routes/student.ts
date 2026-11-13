import { Router, type Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import multer from 'multer';
import { z } from 'zod';
import {
  McqAutosaveSchema,
  StudentConsentSchema,
  StudentJoinSchema,
  StudentResumeSchema,
  type McqAutosaveInput,
  type StudentJoinInput,
  type StudentResumeInput,
} from '@mathlens/shared';
import type { AppEnv } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import { requireStudent, STUDENT_SESSION_COOKIE } from '../middleware/auth.js';
import { createRateLimiter } from '../middleware/rateLimit.js';
import { getParamId, getStudentSession, UuidParamSchema } from '../middleware/requestHelpers.js';
import { asyncHandler, validateBody, validateParams } from '../middleware/validate.js';
import type { GradingDispatcher } from '../services/gradingDispatcher.js';
import { ImageUploadService } from '../services/imageUploadService.js';
import { RetentionService } from '../services/retentionService.js';
import type { StorageAdapter, VirusScanner } from '../services/storage/index.js';
import { StudentService } from '../services/studentService.js';

const StartAttemptSchema = z.object({
  modelNumber: z.union([z.literal(1), z.literal(2)]).default(1),
});

const AttemptAnswerParamsSchema = z.object({
  attemptId: z.string().uuid(),
  questionId: z.string().uuid(),
});

function setStudentSessionCookie(res: Response, env: AppEnv, token: string): void {
  res.cookie(STUDENT_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.COOKIE_SECURE,
    path: '/',
    maxAge: 12 * 60 * 60 * 1000,
  });
}

export function createStudentRouter(params: {
  prisma: PrismaClient;
  env: AppEnv;
  storage: StorageAdapter;
  virusScanner: VirusScanner;
  gradingDispatcher: GradingDispatcher;
  redis?: Redis;
}): Router {
  const { prisma, env, storage, virusScanner, gradingDispatcher, redis } = params;
  const router = Router();
  const studentService = new StudentService(prisma, env, storage, gradingDispatcher);
  const imageUploadService = new ImageUploadService(prisma, env, storage, virusScanner);
  const retentionService = new RetentionService(prisma, env, storage);
  const studentOnly = requireStudent(env);

  const resumeLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 10,
    prefix: 'student_resume',
    redis,
  });

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: env.MAX_IMAGE_BYTES,
      files: 1,
    },
  });

  router.post(
    '/join',
    validateBody(StudentJoinSchema),
    asyncHandler(async (req, res) => {
      const input = req.body as StudentJoinInput;
      const result = await studentService.join(input, req.ip);
      setStudentSessionCookie(res, env, result.token);
      res.status(201).json({ student: result.student });
    }),
  );

  router.post(
    '/resume',
    resumeLimiter,
    validateBody(StudentResumeSchema),
    asyncHandler(async (req, res) => {
      const input = req.body as StudentResumeInput;
      const result = await studentService.resume(input, req.ip);
      setStudentSessionCookie(res, env, result.token);
      res.json({ student: result.student });
    }),
  );

  router.post('/logout', (_req, res) => {
    res.clearCookie(STUDENT_SESSION_COOKIE, {
      httpOnly: true,
      sameSite: 'lax',
      secure: env.COOKIE_SECURE,
      path: '/',
    });
    res.json({ ok: true });
  });

  router.post(
    '/consent',
    studentOnly,
    validateBody(StudentConsentSchema),
    asyncHandler(async (req, res) => {
      const session = getStudentSession(req);
      const state = await studentService.acceptConsent(session.studentId, req.ip);
      res.json(state);
    }),
  );

  router.get(
    '/me/state',
    studentOnly,
    asyncHandler(async (req, res) => {
      const session = getStudentSession(req);
      const state = await studentService.getState(session.studentId);
      res.json(state);
    }),
  );

  router.post(
    '/attempts',
    studentOnly,
    validateBody(StartAttemptSchema),
    asyncHandler(async (req, res) => {
      const session = getStudentSession(req);
      const { modelNumber } = req.body as z.infer<typeof StartAttemptSchema>;
      const attempt = await studentService.startOrGetAttempt(
        session.studentId,
        modelNumber,
        req.ip,
      );
      res.json({ attempt });
    }),
  );

  router.get(
    '/attempts/:id',
    studentOnly,
    validateParams(UuidParamSchema),
    asyncHandler(async (req, res) => {
      const session = getStudentSession(req);
      const attempt = await studentService.getAttempt(session.studentId, getParamId(req));
      res.json({ attempt });
    }),
  );

  router.put(
    '/answers/:id',
    studentOnly,
    validateParams(UuidParamSchema),
    validateBody(McqAutosaveSchema),
    asyncHandler(async (req, res) => {
      const session = getStudentSession(req);
      const input = req.body as McqAutosaveInput;
      const saved = await studentService.saveMcqAnswer({
        studentId: session.studentId,
        targetId: getParamId(req),
        selectedOptionId: input.selectedOptionId,
      });
      res.json(saved);
    }),
  );

  router.put(
    '/attempts/:attemptId/answers/:questionId',
    studentOnly,
    validateParams(AttemptAnswerParamsSchema),
    validateBody(McqAutosaveSchema),
    asyncHandler(async (req, res) => {
      const session = getStudentSession(req);
      const input = req.body as McqAutosaveInput;
      const saved = await studentService.saveMcqAnswer({
        studentId: session.studentId,
        targetId: getParamId(req, 'questionId'),
        attemptId: getParamId(req, 'attemptId'),
        selectedOptionId: input.selectedOptionId,
      });
      res.json(saved);
    }),
  );

  router.post(
    '/answers/:id/images',
    studentOnly,
    validateParams(UuidParamSchema),
    (req, res, next) => {
      upload.single('image')(req, res, (err) => {
        if (err) {
          return next(new AppError('INVALID_UPLOAD'));
        }
        return next();
      });
    },
    asyncHandler(async (req, res) => {
      const session = getStudentSession(req);
      if (!req.file || !req.file.buffer) {
        throw new AppError('INVALID_UPLOAD');
      }
      const image = await imageUploadService.uploadAnswerImage({
        studentId: session.studentId,
        answerId: getParamId(req),
        fileBuffer: req.file.buffer,
        ip: req.ip,
      });
      res.status(201).json({ image });
    }),
  );

  router.delete(
    '/answer-images/:id',
    studentOnly,
    validateParams(UuidParamSchema),
    asyncHandler(async (req, res) => {
      const session = getStudentSession(req);
      await imageUploadService.deleteAnswerImage({
        studentId: session.studentId,
        imageId: getParamId(req),
        ip: req.ip,
      });
      res.status(204).send();
    }),
  );

  router.post(
    '/attempts/:id/submit',
    studentOnly,
    validateParams(UuidParamSchema),
    asyncHandler(async (req, res) => {
      const session = getStudentSession(req);
      const result = await studentService.submitAttempt(session.studentId, getParamId(req), req.ip);
      res.json(result);
    }),
  );

  router.delete(
    '/data',
    studentOnly,
    asyncHandler(async (req, res) => {
      const session = getStudentSession(req);
      const result = await retentionService.deleteStudentData(session.studentId, req.ip);
      res.clearCookie(STUDENT_SESSION_COOKIE, {
        httpOnly: true,
        sameSite: 'lax',
        secure: env.COOKIE_SECURE,
        path: '/',
      });
      res.json(result);
    }),
  );

  return router;
}
