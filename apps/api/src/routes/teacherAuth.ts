import { Router, type Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import { TeacherLoginSchema, type TeacherLoginInput } from '@mathlens/shared';
import type { AppEnv } from '../config/env.js';
import {
  getCookieValue,
  requireTeacher,
  TEACHER_ACCESS_COOKIE,
  TEACHER_REFRESH_COOKIE,
} from '../middleware/auth.js';
import { createRateLimiter } from '../middleware/rateLimit.js';
import { asyncHandler, validateBody } from '../middleware/validate.js';
import { TeacherAuthService } from '../services/authService.js';

function setAuthCookies(
  res: Response,
  env: AppEnv,
  accessToken: string,
  refreshToken: string,
): void {
  const baseOptions = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: env.COOKIE_SECURE,
  };

  res.cookie(TEACHER_ACCESS_COOKIE, accessToken, {
    ...baseOptions,
    path: '/',
    maxAge: 15 * 60 * 1000,
  });

  res.cookie(TEACHER_REFRESH_COOKIE, refreshToken, {
    ...baseOptions,
    path: '/api/v1/auth/teacher',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

function clearAuthCookies(res: Response, env: AppEnv): void {
  const baseOptions = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: env.COOKIE_SECURE,
  };
  res.clearCookie(TEACHER_ACCESS_COOKIE, { ...baseOptions, path: '/' });
  res.clearCookie(TEACHER_REFRESH_COOKIE, {
    ...baseOptions,
    path: '/api/v1/auth/teacher',
  });
}

export function createTeacherAuthRouter(prisma: PrismaClient, env: AppEnv, redis?: Redis): Router {
  const router = Router();
  const authService = new TeacherAuthService(prisma, env);

  const loginLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: env.NODE_ENV === 'test' ? 100 : 15,
    prefix: 'teacher_login',
    redis,
  });

  router.post(
    '/login',
    loginLimiter,
    validateBody(TeacherLoginSchema),
    asyncHandler(async (req, res) => {
      const body = req.body as TeacherLoginInput;
      const result = await authService.login(body.email, body.password, req.ip);
      setAuthCookies(res, env, result.accessToken, result.refreshToken);
      res.json({ teacher: result.teacher });
    }),
  );

  router.post(
    '/refresh',
    asyncHandler(async (req, res) => {
      const rawRefresh = getCookieValue(req, TEACHER_REFRESH_COOKIE) ?? '';
      const result = await authService.refresh(rawRefresh, req.ip);
      setAuthCookies(res, env, result.accessToken, result.refreshToken);
      res.json({ teacher: result.teacher });
    }),
  );

  router.post(
    '/logout',
    asyncHandler(async (req, res) => {
      const rawRefresh = getCookieValue(req, TEACHER_REFRESH_COOKIE);
      await authService.logout(rawRefresh);
      clearAuthCookies(res, env);
      res.json({ ok: true });
    }),
  );

  router.post(
    '/logout-all',
    requireTeacher(env),
    asyncHandler(async (req, res) => {
      await authService.logoutAll(req.teacher!.id, req.ip);
      clearAuthCookies(res, env);
      res.json({ ok: true });
    }),
  );

  router.get(
    '/me',
    requireTeacher(env),
    asyncHandler(async (req, res) => {
      const teacher = await authService.getProfile(req.teacher!.id);
      res.json({ teacher });
    }),
  );

  return router;
}
