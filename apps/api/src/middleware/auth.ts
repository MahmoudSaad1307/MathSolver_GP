import type { RequestHandler } from 'express';
import type { AppEnv } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import { verifyStudentSessionToken, verifyTeacherAccessToken } from '../lib/security.js';

export const TEACHER_ACCESS_COOKIE = 'ml_teacher_access';
export const TEACHER_REFRESH_COOKIE = 'ml_teacher_refresh';
export const STUDENT_SESSION_COOKIE = 'ml_student_session';

export function getCookieValue(req: { cookies?: unknown }, name: string): string | undefined {
  if (!req.cookies || typeof req.cookies !== 'object') {
    return undefined;
  }
  const value = (req.cookies as Record<string, unknown>)[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function requireTeacher(env: AppEnv): RequestHandler {
  return (req, _res, next) => {
    const cookieToken = getCookieValue(req, TEACHER_ACCESS_COOKIE);
    const authHeader = req.header('authorization');
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;
    const token = cookieToken || bearerToken;

    if (!token) {
      return next(new AppError('UNAUTHORIZED'));
    }

    const claims = verifyTeacherAccessToken(token, env);
    if (!claims) {
      return next(new AppError('UNAUTHORIZED'));
    }

    req.teacher = {
      id: claims.sub,
      email: claims.email,
      role: claims.role,
    };
    return next();
  };
}

export function requireStudent(env: AppEnv): RequestHandler {
  return (req, _res, next) => {
    const token = getCookieValue(req, STUDENT_SESSION_COOKIE);
    if (!token) {
      return next(new AppError('UNAUTHORIZED'));
    }

    const claims = verifyStudentSessionToken(token, env);
    if (!claims) {
      return next(new AppError('UNAUTHORIZED'));
    }

    req.studentSession = {
      studentId: claims.sub,
      cohortId: claims.cohortId,
    };
    return next();
  };
}
