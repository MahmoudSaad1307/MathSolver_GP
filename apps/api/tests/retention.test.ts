import crypto from 'node:crypto';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { createLogger } from '../src/lib/logger.js';
import { signStudentSessionToken, signTeacherAccessToken } from '../src/lib/security.js';
import { STUDENT_SESSION_COOKIE, TEACHER_ACCESS_COOKIE } from '../src/middleware/auth.js';
import { RetentionService } from '../src/services/retentionService.js';
import type { StorageAdapter } from '../src/services/storage/index.js';
import { createInMemoryPrisma } from './helpers/fakePrisma.js';
import { createTestEnv } from './helpers/testEnv.js';

function createMemoryStorage(): {
  adapter: StorageAdapter;
  objects: Map<string, Buffer>;
  failDeleteKeys: Set<string>;
  throwNotFoundKeys: Set<string>;
} {
  const objects = new Map<string, Buffer>();
  const failDeleteKeys = new Set<string>();
  const throwNotFoundKeys = new Set<string>();

  const adapter: StorageAdapter = {
    async putObject(key, body) {
      objects.set(key, body);
    },
    async getObject(key) {
      const buf = objects.get(key);
      if (!buf) {
        const err = new Error('ENOENT') as Error & { code?: string };
        err.code = 'ENOENT';
        throw err;
      }
      return buf;
    },
    async deleteObject(key) {
      if (failDeleteKeys.has(key)) {
        throw new Error('Transient S3 network error');
      }
      if (throwNotFoundKeys.has(key)) {
        const err = new Error('Missing object') as Error & { code?: string };
        err.code = 'NoSuchKey';
        throw err;
      }
      objects.delete(key);
    },
    async getSignedUrl(key) {
      return `http://localhost/local?key=${encodeURIComponent(key)}`;
    },
  };

  return { adapter, objects, failDeleteKeys, throwNotFoundKeys };
}

async function seedImageFixture() {
  const teacherA = {
    id: crypto.randomUUID(),
    email: 'teacher-a@mathlens.local',
    passwordHash: 'hash',
    displayName: 'Teacher A',
    role: 'TEACHER' as const,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };
  const teacherB = {
    id: crypto.randomUUID(),
    email: 'teacher-b@mathlens.local',
    passwordHash: 'hash',
    displayName: 'Teacher B',
    role: 'TEACHER' as const,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };
  const prisma = createInMemoryPrisma([teacherA, teacherB]);
  const env = createTestEnv({ RETENTION_DAYS: 30 });
  const storage = createMemoryStorage();
  const now = new Date('2026-11-13T12:00:00Z');
  const oldDate = new Date(now.getTime() - 35 * 86_400_000);
  const recentDate = new Date(now.getTime() - 5 * 86_400_000);

  const topic = await prisma.topic.create({
    data: {
      ownerId: teacherA.id,
      title: 'Derivatives',
      videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      videoId: 'dQw4w9WgXcQ',
    },
  });
  const model = await prisma.examModel.create({
    data: { topicId: topic.id, modelNumber: 1, title: 'Model 1', totalPoints: 10 },
  });
  const q = await prisma.question.create({
    data: {
      examModelId: model.id,
      orderIndex: 1,
      conceptKey: 'power-rule',
      type: 'ESSAY',
      promptLatex: 'Find derivative',
      points: 10,
      videoTimestampSeconds: 10,
    },
  });
  const cohort = await prisma.cohort.create({
    data: {
      topicId: topic.id,
      teacherId: teacherA.id,
      name: 'Cohort A',
      joinCode: 'RET123',
      group: 'TREATMENT',
      requireVideoBeforePost: true,
    },
  });
  const student = await prisma.student.create({
    data: { cohortId: cohort.id, displayName: 'Student One', resumeCode: 'STU123' },
  });

  const oldFinalAttemptId = crypto.randomUUID();
  const recentFinalAttemptId = crypto.randomUUID();
  const activeAttemptId = crypto.randomUUID();
  prisma._state.attempts.push(
    {
      id: oldFinalAttemptId,
      studentId: student.id,
      examModelId: model.id,
      status: 'FINAL',
      startedAt: oldDate,
      submittedAt: oldDate,
      deadlineAt: oldDate,
      totalScore: 8,
      maxScore: 10,
      percentage: 80,
      scoreSource: 'AI',
      createdAt: oldDate,
      updatedAt: oldDate,
    },
    {
      id: recentFinalAttemptId,
      studentId: student.id,
      examModelId: model.id,
      status: 'FINAL',
      startedAt: recentDate,
      submittedAt: recentDate,
      deadlineAt: recentDate,
      totalScore: 9,
      maxScore: 10,
      percentage: 90,
      scoreSource: 'AI',
      createdAt: recentDate,
      updatedAt: recentDate,
    },
    {
      id: activeAttemptId,
      studentId: student.id,
      examModelId: model.id,
      status: 'NEEDS_REVIEW',
      startedAt: oldDate,
      submittedAt: oldDate,
      deadlineAt: oldDate,
      totalScore: null,
      maxScore: 10,
      percentage: null,
      scoreSource: null,
      createdAt: oldDate,
      updatedAt: oldDate,
    },
  );

  const ansOld = crypto.randomUUID();
  const ansRecent = crypto.randomUUID();
  const ansActive = crypto.randomUUID();
  prisma._state.answers.push(
    {
      id: ansOld,
      attemptId: oldFinalAttemptId,
      questionId: q.id,
      selectedOptionId: null,
      isCorrect: null,
      score: 8,
      maxScore: 10,
      misreadReportedAt: null,
      misreadNote: null,
      createdAt: oldDate,
      updatedAt: oldDate,
    },
    {
      id: ansRecent,
      attemptId: recentFinalAttemptId,
      questionId: q.id,
      selectedOptionId: null,
      isCorrect: null,
      score: 9,
      maxScore: 10,
      misreadReportedAt: null,
      misreadNote: null,
      createdAt: recentDate,
      updatedAt: recentDate,
    },
    {
      id: ansActive,
      attemptId: activeAttemptId,
      questionId: q.id,
      selectedOptionId: null,
      isCorrect: null,
      score: null,
      maxScore: 10,
      misreadReportedAt: null,
      misreadNote: null,
      createdAt: oldDate,
      updatedAt: oldDate,
    },
  );

  await storage.adapter.putObject('expired-unpinned.jpg', Buffer.from('img1'), 'image/jpeg');
  await storage.adapter.putObject('expired-pinned.jpg', Buffer.from('img2'), 'image/jpeg');
  await storage.adapter.putObject('recent-final.jpg', Buffer.from('img3'), 'image/jpeg');
  await storage.adapter.putObject('needs-review.jpg', Buffer.from('img4'), 'image/jpeg');
  await storage.adapter.putObject('expired-fail-s3.jpg', Buffer.from('img5'), 'image/jpeg');
  storage.throwNotFoundKeys.add('expired-missing-s3.jpg');
  storage.failDeleteKeys.add('expired-fail-s3.jpg');

  const imgExpired = await prisma.answerImage.create({
    data: {
      answerId: ansOld,
      storageKey: 'expired-unpinned.jpg',
      sha256: 'a'.repeat(64),
      width: 100,
      height: 100,
      bytes: 4,
    },
  });
  const imgMissingS3 = await prisma.answerImage.create({
    data: {
      answerId: ansOld,
      storageKey: 'expired-missing-s3.jpg',
      sha256: 'b'.repeat(64),
      width: 100,
      height: 100,
      bytes: 4,
    },
  });
  const imgFailS3 = await prisma.answerImage.create({
    data: {
      answerId: ansOld,
      storageKey: 'expired-fail-s3.jpg',
      sha256: 'c'.repeat(64),
      width: 100,
      height: 100,
      bytes: 4,
    },
  });
  const imgPinned = await prisma.answerImage.create({
    data: {
      answerId: ansOld,
      storageKey: 'expired-pinned.jpg',
      sha256: 'd'.repeat(64),
      width: 100,
      height: 100,
      bytes: 4,
    },
  });
  await prisma.answerImage.update({ where: { id: imgPinned.id }, data: { pinnedByTeacher: true } });

  const imgRecent = await prisma.answerImage.create({
    data: {
      answerId: ansRecent,
      storageKey: 'recent-final.jpg',
      sha256: 'e'.repeat(64),
      width: 100,
      height: 100,
      bytes: 4,
    },
  });
  const imgActive = await prisma.answerImage.create({
    data: {
      answerId: ansActive,
      storageKey: 'needs-review.jpg',
      sha256: 'f'.repeat(64),
      width: 100,
      height: 100,
      bytes: 4,
    },
  });

  return {
    prisma,
    env,
    storage,
    now,
    teacherA,
    teacherB,
    cohort,
    student,
    imgExpired,
    imgMissingS3,
    imgFailS3,
    imgPinned,
    imgRecent,
    imgActive,
  };
}

describe('Phase 8: Retention Purge & Privacy Data Erasure', () => {
  it('purges only expired unpinned images of FINAL attempts and tolerates missing S3 keys', async () => {
    const fx = await seedImageFixture();
    const testLogger = createLogger('silent');
    const warnSpy = vi.spyOn(testLogger, 'warn').mockImplementation(() => undefined);
    const service = new RetentionService(
      fx.prisma as never,
      fx.env,
      fx.storage.adapter,
      testLogger,
    );

    const summary = await service.purgeExpiredImages(fx.now);
    warnSpy.mockRestore();

    expect(summary.deleted).toBe(2);
    expect(summary.storageErrors).toBe(1);
    expect(fx.storage.objects.has('expired-unpinned.jpg')).toBe(false);
    expect(fx.storage.objects.has('expired-pinned.jpg')).toBe(true);
    expect(fx.storage.objects.has('recent-final.jpg')).toBe(true);
    expect(fx.storage.objects.has('needs-review.jpg')).toBe(true);
    expect(fx.storage.objects.has('expired-fail-s3.jpg')).toBe(true);

    const expiredRow = fx.prisma._state.answerImages.find((i) => i.id === fx.imgExpired.id);
    const missingRow = fx.prisma._state.answerImages.find((i) => i.id === fx.imgMissingS3.id);
    const failRow = fx.prisma._state.answerImages.find((i) => i.id === fx.imgFailS3.id);
    const pinnedRow = fx.prisma._state.answerImages.find((i) => i.id === fx.imgPinned.id);
    const recentRow = fx.prisma._state.answerImages.find((i) => i.id === fx.imgRecent.id);
    const activeRow = fx.prisma._state.answerImages.find((i) => i.id === fx.imgActive.id);

    expect(expiredRow?.deletedAt).not.toBeNull();
    expect(missingRow?.deletedAt).not.toBeNull();
    expect(failRow?.deletedAt).toBeNull();
    expect(pinnedRow?.deletedAt).toBeNull();
    expect(recentRow?.deletedAt).toBeNull();
    expect(activeRow?.deletedAt).toBeNull();

    const logs = fx.prisma._state.auditLogs.filter((a) => a.action === 'RETENTION_PURGE');
    expect(logs).toHaveLength(2);
  });

  it('supports student self-erasure (DELETE /api/v1/student/data) and teacher cohort data wipe with tenant isolation', async () => {
    const fx = await seedImageFixture();
    fx.storage.failDeleteKeys.clear();
    const app = createApp({
      env: fx.env,
      prisma: fx.prisma as never,
      logger: createLogger('silent'),
      storage: fx.storage.adapter,
    });

    const unauth = await request(app).delete('/api/v1/student/data');
    expect(unauth.status).toBe(401);

    const teacherBToken = signTeacherAccessToken(
      { id: fx.teacherB.id, email: fx.teacherB.email, role: 'TEACHER' },
      fx.env,
    );
    const crossTenant = await request(app)
      .delete(`/api/v1/cohorts/${fx.cohort.id}/data`)
      .set('Cookie', [`${TEACHER_ACCESS_COOKIE}=${teacherBToken}`]);
    expect(crossTenant.status).toBe(404);

    const studentToken = signStudentSessionToken(
      { id: fx.student.id, cohortId: fx.cohort.id },
      fx.env,
    );
    const studentErase = await request(app)
      .delete('/api/v1/student/data')
      .set('Cookie', [`${STUDENT_SESSION_COOKIE}=${studentToken}`]);
    expect(studentErase.status).toBe(200);
    expect(studentErase.body.deleted).toBe(true);
    expect(studentErase.body.imagesRemoved).toBe(6);
    expect(fx.storage.objects.size).toBe(0);
    expect(studentErase.headers['set-cookie']?.join(';')).toContain(`${STUDENT_SESSION_COOKIE}=;`);

    const erasedStudent = fx.prisma._state.students.find((s) => s.id === fx.student.id);
    expect(erasedStudent?.displayName).toBe('[محذوف]');
    expect(erasedStudent?.deletedAt).not.toBeNull();

    // Re-add an active student to verify cohort-level erasure
    const student2 = await fx.prisma.student.create({
      data: { cohortId: fx.cohort.id, displayName: 'Student Two', resumeCode: 'TWO234' },
    });
    const teacherAToken = signTeacherAccessToken(
      { id: fx.teacherA.id, email: fx.teacherA.email, role: 'TEACHER' },
      fx.env,
    );
    const cohortErase = await request(app)
      .delete(`/api/v1/cohorts/${fx.cohort.id}/data`)
      .set('Cookie', [`${TEACHER_ACCESS_COOKIE}=${teacherAToken}`]);
    expect(cohortErase.status).toBe(200);
    expect(cohortErase.body.deleted).toBe(true);
    expect(cohortErase.body.studentsRemoved).toBe(1);
    const erasedStudent2 = fx.prisma._state.students.find((s) => s.id === student2.id);
    expect(erasedStudent2?.displayName).toBe('[محذوف]');
    const cohortRow = fx.prisma._state.cohorts.find((c) => c.id === fx.cohort.id);
    expect(cohortRow?.status).toBe('ARCHIVED');
  });
});
