import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import { metricsRegistry } from '../lib/metrics.js';
import { asyncHandler } from '../middleware/validate.js';

export function createHealthRouter(prisma: PrismaClient, redis?: Redis): Router {
  const router = Router();

  router.get('/healthz', (_req, res) => {
    res.json({ ok: true, service: 'mathlens-api' });
  });

  router.get(
    '/readyz',
    asyncHandler(async (_req, res) => {
      await prisma.$queryRaw`SELECT 1`;
      let redisOk = true;
      if (redis) {
        const pong = await redis.ping();
        redisOk = pong === 'PONG';
      }
      if (!redisOk) {
        res.status(503).json({ ok: false, db: true, redis: false });
        return;
      }
      res.json({ ok: true, db: true, redis: redis ? true : 'disabled' });
    }),
  );

  router.get(
    '/metrics',
    asyncHandler(async (_req, res) => {
      res.setHeader('Content-Type', metricsRegistry.contentType);
      res.send(await metricsRegistry.metrics());
    }),
  );

  return router;
}
