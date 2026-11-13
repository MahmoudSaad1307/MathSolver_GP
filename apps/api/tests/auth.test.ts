import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createLogger } from '../src/lib/logger.js';
import { hashPassword } from '../src/lib/security.js';
import { createInMemoryAuthPrisma } from './helpers/fakePrisma.js';
import { createTestEnv } from './helpers/testEnv.js';

describe('Teacher auth & core HTTP middleware', () => {
  const env = createTestEnv();
  const logger = createLogger('silent');
  let app: ReturnType<typeof createApp>;
  let prisma: ReturnType<typeof createInMemoryAuthPrisma>;

  beforeEach(async () => {
    const passwordHash = await hashPassword('TeacherPass123!');
    prisma = createInMemoryAuthPrisma([
      {
        id: '11111111-1111-1111-1111-111111111111',
        email: 'teacher@mathlens.local',
        passwordHash,
        displayName: 'أ. أحمد',
        role: 'TEACHER',
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      },
    ]);
    app = createApp({ env, prisma, logger });
  });

  it('serves healthz, readyz, and prometheus metrics', async () => {
    const health = await request(app).get('/healthz');
    expect(health.status).toBe(200);
    expect(health.body.ok).toBe(true);
    expect(health.headers['x-request-id']).toBeTruthy();

    const ready = await request(app).get('/readyz');
    expect(ready.status).toBe(200);
    expect(ready.body.db).toBe(true);

    const metrics = await request(app).get('/metrics');
    expect(metrics.status).toBe(200);
    expect(metrics.text).toContain('mathlens_grading_queue_depth');
  });

  it('logs in teacher, sets httpOnly cookies, accesses /me, and rejects invalid credentials', async () => {
    const bad = await request(app)
      .post('/api/v1/auth/teacher/login')
      .send({ email: 'teacher@mathlens.local', password: 'WrongPassword1!' });
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(bad.body.error.message_ar).toBeTruthy();

    const agent = request.agent(app);
    const login = await agent
      .post('/api/v1/auth/teacher/login')
      .send({ email: 'teacher@mathlens.local', password: 'TeacherPass123!' });
    expect(login.status).toBe(200);
    expect(login.body.teacher.email).toBe('teacher@mathlens.local');

    const cookies = login.headers['set-cookie'] as unknown as string[];
    expect(cookies.some((c) => c.includes('ml_teacher_access=') && c.includes('HttpOnly'))).toBe(
      true,
    );
    expect(cookies.some((c) => c.includes('ml_teacher_refresh=') && c.includes('HttpOnly'))).toBe(
      true,
    );

    const me = await agent.get('/api/v1/auth/teacher/me');
    expect(me.status).toBe(200);
    expect(me.body.teacher.displayName).toBe('أ. أحمد');
  });

  it('rotates refresh tokens and revokes entire family on token reuse', async () => {
    const login = await request(app)
      .post('/api/v1/auth/teacher/login')
      .send({ email: 'teacher@mathlens.local', password: 'TeacherPass123!' });
    const rawCookies = login.headers['set-cookie'] as unknown as string[];
    const refreshCookie1 = rawCookies
      .find((c) => c.startsWith('ml_teacher_refresh='))!
      .split(';')[0]!;

    // First refresh succeeds and rotates token
    const refresh1 = await request(app)
      .post('/api/v1/auth/teacher/refresh')
      .set('Cookie', [refreshCookie1]);
    expect(refresh1.status).toBe(200);
    const rotatedCookies = refresh1.headers['set-cookie'] as unknown as string[];
    const refreshCookie2 = rotatedCookies
      .find((c) => c.startsWith('ml_teacher_refresh='))!
      .split(';')[0]!;
    expect(refreshCookie2).not.toBe(refreshCookie1);

    // Replaying old refresh token fails and revokes the family
    const replay = await request(app)
      .post('/api/v1/auth/teacher/refresh')
      .set('Cookie', [refreshCookie1]);
    expect(replay.status).toBe(401);

    // Subsequent use of rotated token is also rejected because family was revoked
    const afterRevoke = await request(app)
      .post('/api/v1/auth/teacher/refresh')
      .set('Cookie', [refreshCookie2]);
    expect(afterRevoke.status).toBe(401);
  });

  it('supports logout and logout-all', async () => {
    const agent = request.agent(app);
    await agent
      .post('/api/v1/auth/teacher/login')
      .send({ email: 'teacher@mathlens.local', password: 'TeacherPass123!' });

    const logoutAll = await agent.post('/api/v1/auth/teacher/logout-all');
    expect(logoutAll.status).toBe(200);
    expect(prisma._state.refreshTokens.every((t) => t.revokedAt !== null)).toBe(true);

    const meAfter = await agent.get('/api/v1/auth/teacher/me');
    expect(meAfter.status).toBe(401);

    const logoutOnly = await agent.post('/api/v1/auth/teacher/logout');
    expect(logoutOnly.status).toBe(200);
  });

  it('rejects missing or expired refresh tokens and unknown login emails', async () => {
    const unknown = await request(app)
      .post('/api/v1/auth/teacher/login')
      .send({ email: 'nobody@mathlens.local', password: 'TeacherPass123!' });
    expect(unknown.status).toBe(401);

    const noRefresh = await request(app).post('/api/v1/auth/teacher/refresh');
    expect(noRefresh.status).toBe(401);

    prisma._state.refreshTokens.push({
      id: '99999999-9999-9999-9999-999999999999',
      userId: '11111111-1111-1111-1111-111111111111',
      tokenHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      familyId: '88888888-8888-8888-8888-888888888888',
      expiresAt: new Date(Date.now() - 10_000),
      revokedAt: null,
      replacedById: null,
      createdAt: new Date(),
    });
    const expired = await request(app)
      .post('/api/v1/auth/teacher/refresh')
      .set('Cookie', ['ml_teacher_refresh=expired-raw']);
    expect(expired.status).toBe(401);
  });

  it('returns standard validation and 404 error envelopes', async () => {
    const badBody = await request(app)
      .post('/api/v1/auth/teacher/login')
      .send({ email: 'not-an-email', password: '123' });
    expect(badBody.status).toBe(400);
    expect(badBody.body.error.code).toBe('VALIDATION_ERROR');

    const missing = await request(app).get('/api/v1/does-not-exist');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');
  });
});
