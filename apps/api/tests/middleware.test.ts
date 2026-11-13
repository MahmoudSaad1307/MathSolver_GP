import express from 'express';
import type { Redis } from 'ioredis';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createLogger } from '../src/lib/logger.js';
import { getPrisma, scopedTopicWhere } from '../src/lib/prisma.js';
import { createRedisClient } from '../src/lib/redis.js';
import { signStudentSessionToken, signTeacherAccessToken } from '../src/lib/security.js';
import { requireStudent, requireTeacher, STUDENT_SESSION_COOKIE } from '../src/middleware/auth.js';
import { createErrorHandler } from '../src/middleware/errorHandler.js';
import { requestIdMiddleware } from '../src/middleware/requestId.js';
import { asyncHandler, validateParams } from '../src/middleware/validate.js';
import { createHealthRouter } from '../src/routes/health.js';
import { createTestEnv } from './helpers/testEnv.js';

describe('API middlewares and infrastructure helpers', () => {
  const env = createTestEnv();
  const logger = createLogger('silent');

  it('handles Bearer teacher auth and student cookie auth', async () => {
    const app = express();
    app.use(requestIdMiddleware);
    app.use((req, _res, next) => {
      req.cookies = req.headers.cookie
        ? Object.fromEntries(
            req.headers.cookie.split(';').map((p) => {
              const [k, ...v] = p.trim().split('=');
              return [k, v.join('=')];
            }),
          )
        : {};
      next();
    });

    app.get('/t', requireTeacher(env), (req, res) => {
      res.json({ teacherId: req.teacher?.id });
    });
    app.get('/s', requireStudent(env), (req, res) => {
      res.json(req.studentSession);
    });
    app.get('/params/:id', validateParams(z.object({ id: z.string().uuid() })), (req, res) => {
      res.json({ id: req.params.id });
    });
    app.use(createErrorHandler(logger));

    const tToken = signTeacherAccessToken(
      { id: '11111111-1111-1111-1111-111111111111', email: 't@ml.local', role: 'TEACHER' },
      env,
    );
    const sToken = signStudentSessionToken(
      {
        id: '22222222-2222-2222-2222-222222222222',
        cohortId: '33333333-3333-3333-3333-333333333333',
      },
      env,
    );

    const tRes = await request(app).get('/t').set('Authorization', `Bearer ${tToken}`);
    expect(tRes.status).toBe(200);
    expect(tRes.body.teacherId).toBe('11111111-1111-1111-1111-111111111111');

    const badT = await request(app).get('/t').set('Authorization', 'Bearer bad-token');
    expect(badT.status).toBe(401);

    const noS = await request(app).get('/s');
    expect(noS.status).toBe(401);

    const badS = await request(app).get('/s').set('Cookie', `${STUDENT_SESSION_COOKIE}=bad-token`);
    expect(badS.status).toBe(401);

    const okS = await request(app).get('/s').set('Cookie', `${STUDENT_SESSION_COOKIE}=${sToken}`);
    expect(okS.status).toBe(200);
    expect(okS.body.studentId).toBe('22222222-2222-2222-2222-222222222222');

    const badParam = await request(app).get('/params/not-a-uuid');
    expect(badParam.status).toBe(400);
    expect(badParam.body.error.code).toBe('VALIDATION_ERROR');

    const okParam = await request(app).get('/params/11111111-1111-4111-8111-111111111111');
    expect(okParam.status).toBe(200);
  });

  it('maps ZodError, malformed JSON, and unexpected errors consistently', async () => {
    const app = express();
    app.use(express.json());
    app.post('/json', (_req, res) => res.json({ ok: true }));
    app.get(
      '/zod',
      asyncHandler(async () => {
        await z.object({ a: z.number() }).parseAsync({ a: 'bad' });
      }),
    );
    app.get(
      '/boom',
      asyncHandler(() => {
        throw new Error('Unexpected failure');
      }),
    );
    app.use(createErrorHandler(logger));

    const badJson = await request(app)
      .post('/json')
      .set('Content-Type', 'application/json')
      .send('{broken');
    expect(badJson.status).toBe(400);
    expect(badJson.body.error.code).toBe('VALIDATION_ERROR');

    const zodRes = await request(app).get('/zod');
    expect(zodRes.status).toBe(400);
    expect(zodRes.body.error.code).toBe('VALIDATION_ERROR');

    const boomRes = await request(app).get('/boom');
    expect(boomRes.status).toBe(500);
    expect(boomRes.body.error.code).toBe('INTERNAL_ERROR');
  });

  it('reports redis health status in /readyz and exposes scopedPrisma helpers', async () => {
    const fakePrisma = { $queryRaw: async () => [{ ok: 1 }] } as unknown as ReturnType<
      typeof getPrisma
    >;
    const okRedis = { ping: async () => 'PONG' } as unknown as Redis;
    const downRedis = { ping: async () => 'ERR' } as unknown as Redis;

    const appOk = express();
    appOk.use(createHealthRouter(fakePrisma, okRedis));
    const rOk = await request(appOk).get('/readyz');
    expect(rOk.status).toBe(200);
    expect(rOk.body.redis).toBe(true);

    const appDown = express();
    appDown.use(createHealthRouter(fakePrisma, downRedis));
    const rDown = await request(appDown).get('/readyz');
    expect(rDown.status).toBe(503);
    expect(rDown.body.redis).toBe(false);

    expect(scopedTopicWhere('teacher-1')).toEqual({ ownerId: 'teacher-1', deletedAt: null });
    const redisClient = createRedisClient('redis://localhost:6379', logger);
    expect(redisClient).toBeDefined();
    redisClient.disconnect();
  });
});
