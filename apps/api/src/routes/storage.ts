import { Router } from 'express';
import { z } from 'zod';
import type { AppEnv } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import { asyncHandler } from '../middleware/validate.js';
import { verifyLocalStorageSignature, type StorageAdapter } from '../services/storage/index.js';

const SignedLocalQuerySchema = z.object({
  key: z.string().min(1).max(300),
  exp: z.coerce.number().int(),
  sig: z.string().regex(/^[0-9a-f]{64}$/),
});

export function createStorageRouter(storage: StorageAdapter, env: AppEnv): Router {
  const router = Router();

  router.get(
    '/local',
    asyncHandler(async (req, res) => {
      if (env.STORAGE_DRIVER !== 'local') {
        throw new AppError('NOT_FOUND');
      }

      const parsed = SignedLocalQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        throw new AppError('FORBIDDEN');
      }

      const { key, exp, sig } = parsed.data;
      if (!verifyLocalStorageSignature(key, exp, sig, env.VIDEO_UNLOCK_HMAC_SECRET)) {
        throw new AppError('FORBIDDEN');
      }

      let data: Buffer;
      try {
        data = await storage.getObject(key);
      } catch {
        throw new AppError('NOT_FOUND');
      }

      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, max-age=60');
      res.send(data);
    }),
  );

  return router;
}
