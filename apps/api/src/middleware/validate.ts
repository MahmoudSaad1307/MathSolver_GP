import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodType } from 'zod';
import { AppError } from '../lib/errors.js';

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void> | void,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function validateBody<T>(schema: ZodType<T>): RequestHandler {
  return (req, _res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return next(
        new AppError('VALIDATION_ERROR', {
          details: parsed.error.flatten(),
        }),
      );
    }
    req.body = parsed.data;
    return next();
  };
}

export function validateParams<T extends Record<string, string>>(
  schema: ZodType<T>,
): RequestHandler {
  return (req, _res, next) => {
    const parsed = schema.safeParse(req.params);
    if (!parsed.success) {
      return next(
        new AppError('VALIDATION_ERROR', {
          details: parsed.error.flatten(),
        }),
      );
    }
    req.params = parsed.data;
    return next();
  };
}
