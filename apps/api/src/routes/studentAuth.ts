import { Router, type Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import {
  StudentLoginSchema,
  StudentRegisterSchema,
  type StudentLoginInput,
  type StudentRegisterInput,
} from '@mathlens/shared';
import type { AppEnv } from '../config/env.js';
import { signStudentSessionToken } from '../lib/security.js';
import {
  getCookieValue,
  requireStudentAccount,
  STUDENT_REFRESH_COOKIE,
  STUDENT_SESSION_COOKIE,
  tryGetStudentClaims,
} from '../middleware/auth.js';
import { createRateLimiter } from '../middleware/rateLimit.js';
import { getStudentAccount } from '../middleware/requestHelpers.js';
import { asyncHandler, validateBody } from '../middleware/validate.js';
import { StudentAuthService } from '../services/studentAuthService.js';

export function setStudentAuthCookies(
  res: Response,
  env: AppEnv,
  sessionToken: string,
  refreshToken?: string,
): void {
  const baseOptions = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: env.COOKIE_SECURE,
  };

  res.cookie(STUDENT_SESSION_COOKIE, sessionToken, {
    ...baseOptions,
    path: '/',
    maxAge: 12 * 60 * 60 * 1000,
  });

  if (refreshToken) {
    res.cookie(STUDENT_REFRESH_COOKIE, refreshToken, {
      ...baseOptions,
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  }
}

export function clearStudentAuthCookies(res: Response, env: AppEnv): void {
  const baseOptions = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: env.COOKIE_SECURE,
  };
  res.clearCookie(STUDENT_SESSION_COOKIE, { ...baseOptions, path: '/' });
  res.clearCookie(STUDENT_REFRESH_COOKIE, { ...baseOptions, path: '/' });
}

export function createStudentAuthRouter(prisma: PrismaClient, env: AppEnv, redis?: Redis): Router {
  const router = Router();
  const authService = new StudentAuthService(prisma, env);

  const authLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: env.NODE_ENV === 'test' ? 100 : 20,
    prefix: 'student_auth',
    redis,
  });

  router.post(
    '/register',
    authLimiter,
    validateBody(StudentRegisterSchema),
    asyncHandler(async (req, res) => {
      const body = req.body as StudentRegisterInput;
      const result = await authService.register(body, req.ip);
      setStudentAuthCookies(res, env, result.sessionToken, result.refreshToken);
      res.status(201).json({
        account: result.account,
        activeEnrollmentId: result.activeEnrollmentId,
        enrollments: result.enrollments,
      });
    }),
  );

  router.post(
    '/login',
    authLimiter,
    validateBody(StudentLoginSchema),
    asyncHandler(async (req, res) => {
      const body = req.body as StudentLoginInput;
      const result = await authService.login(body.email, body.password, req.ip);
      setStudentAuthCookies(res, env, result.sessionToken, result.refreshToken);
      res.json({
        account: result.account,
        activeEnrollmentId: result.activeEnrollmentId,
        enrollments: result.enrollments,
      });
    }),
  );

  router.post(
    '/refresh',
    asyncHandler(async (req, res) => {
      const rawRefresh = getCookieValue(req, STUDENT_REFRESH_COOKIE) ?? '';
      const existingClaims = tryGetStudentClaims(req, env);
      const preferredStudentId = existingClaims?.cohortId ? existingClaims.sub : null;
      const result = await authService.refresh(rawRefresh, preferredStudentId, req.ip);
      setStudentAuthCookies(res, env, result.sessionToken, result.refreshToken);
      res.json({
        account: result.account,
        activeEnrollmentId: result.activeEnrollmentId,
        enrollments: result.enrollments,
      });
    }),
  );

  router.post(
    '/logout',
    asyncHandler(async (req, res) => {
      const rawRefresh = getCookieValue(req, STUDENT_REFRESH_COOKIE);
      await authService.logout(rawRefresh);
      clearStudentAuthCookies(res, env);
      res.json({ ok: true });
    }),
  );

  router.get(
    '/me',
    requireStudentAccount(env),
    asyncHandler(async (req, res) => {
      const accountCtx = getStudentAccount(req);
      const dashboard = await authService.getAccountDashboard(
        accountCtx.id,
        accountCtx.activeStudentId,
      );

      // Ensure session cookie reflects active enrollment if one exists
      if (
        dashboard.activeEnrollmentId &&
        dashboard.activeEnrollmentId !== accountCtx.activeStudentId
      ) {
        const active = dashboard.enrollments.find(
          (e) => e.studentId === dashboard.activeEnrollmentId,
        );
        if (active) {
          const updatedToken = signStudentSessionToken(
            {
              id: active.studentId,
              cohortId: active.cohortId,
              accountId: dashboard.account.id,
              email: dashboard.account.email,
            },
            env,
          );
          setStudentAuthCookies(res, env, updatedToken);
        }
      }

      res.json(dashboard);
    }),
  );

  return router;
}
