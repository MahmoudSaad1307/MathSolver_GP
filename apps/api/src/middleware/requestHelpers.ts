import type { Request } from 'express';
import { z } from 'zod';
import { AppError } from '../lib/errors.js';

export const UuidParamSchema = z.object({
  id: z.string().uuid(),
});

export function getTeacherId(req: Request): string {
  if (!req.teacher) {
    throw new AppError('UNAUTHORIZED');
  }
  return req.teacher.id;
}

export function getStudentSession(req: Request): { studentId: string; cohortId: string } {
  if (!req.studentSession) {
    throw new AppError('UNAUTHORIZED');
  }
  return req.studentSession;
}

export function getParamId(req: Request, key = 'id'): string {
  const val = req.params[key];
  if (typeof val !== 'string') {
    throw new AppError('VALIDATION_ERROR');
  }
  return val;
}
