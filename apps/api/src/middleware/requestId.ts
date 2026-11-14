import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

declare module 'express-serve-static-core' {
  interface Request {
    requestId?: string;
    teacher?: {
      id: string;
      email: string;
      role: 'TEACHER';
    };
    studentSession?: {
      studentId: string;
      cohortId: string;
      accountId?: string;
      email?: string;
    };
    studentAccount?: {
      id: string;
      email: string;
      activeStudentId: string | null;
      activeCohortId: string | null;
    };
  }
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  const id = incoming && /^[a-zA-Z0-9_-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
  req.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
}
