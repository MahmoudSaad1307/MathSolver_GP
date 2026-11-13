import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';

export function createErrorHandler(logger: Logger) {
  return (err: unknown, req: Request, res: Response, _next: NextFunction): void => {
    if (err instanceof AppError) {
      res.status(err.statusCode).json(err.toJSON());
      return;
    }

    if (err instanceof ZodError) {
      const appErr = new AppError('VALIDATION_ERROR', { details: err.flatten() });
      res.status(appErr.statusCode).json(appErr.toJSON());
      return;
    }

    if (
      typeof err === 'object' &&
      err !== null &&
      'type' in err &&
      (err as { type?: string }).type === 'entity.parse.failed'
    ) {
      const appErr = new AppError('VALIDATION_ERROR', {
        messageEn: 'Malformed JSON body.',
        messageAr: 'صيغة JSON المرسلة غير صالحة.',
      });
      res.status(appErr.statusCode).json(appErr.toJSON());
      return;
    }

    logger.error(
      {
        requestId: req.requestId,
        err: err instanceof Error ? { message: err.message, stack: err.stack } : String(err),
      },
      'Unhandled API error',
    );

    const internal = new AppError('INTERNAL_ERROR');
    res.status(internal.statusCode).json(internal.toJSON());
  };
}
