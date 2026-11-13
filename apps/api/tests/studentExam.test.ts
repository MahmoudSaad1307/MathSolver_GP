import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { createLogger } from '../src/lib/logger.js';
import { hashPassword, signTeacherAccessToken } from '../src/lib/security.js';
import type {
  EssayGradingJobPayload,
  GradingDispatcher,
} from '../src/services/gradingDispatcher.js';
import { LocalDiskStorageAdapter, NoopVirusScanner } from '../src/services/storage/index.js';
import { createInMemoryPrisma } from './helpers/fakePrisma.js';
import { createTestEnv } from './helpers/testEnv.js';

const TEACHER_ID = '11111111-1111-4111-8111-111111111111';

function extractCookie(res: request.Response, cookieName: string): string {
  const rawCookies = res.headers['set-cookie'];
  const list = Array.isArray(rawCookies) ? rawCookies : rawCookies ? [rawCookies] : [];
  const found = list.find((c) => c.startsWith(`${cookieName}=`));
  if (!found) {
    throw new Error(`Missing expected cookie: ${cookieName}`);
  }
  return found.split(';')[0]!;
}

describe('Cohorts, student join/consent/exam flow, image sanitization, and lock gate', () => {
  const env = createTestEnv();
  const logger = createLogger('silent');
  let tmpDir: string;
  let prisma: ReturnType<typeof createInMemoryPrisma>;
  let app: ReturnType<typeof createApp>;
  let teacherToken: string;
  let dispatchedJobs: EssayGradingJobPayload[];

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mathlens-student-test-'));
    dispatchedJobs = [];
    const dispatcher: GradingDispatcher = {
      enqueueEssayGrading: vi.fn(async (payload) => {
        dispatchedJobs.push(payload);
      }),
    };
    const storage = new LocalDiskStorageAdapter(tmpDir, env.VIDEO_UNLOCK_HMAC_SECRET);

    const passwordHash = await hashPassword('TeacherPass123!');
    prisma = createInMemoryPrisma([
      {
        id: TEACHER_ID,
        email: 'teacher@mathlens.local',
        passwordHash,
        displayName: 'أ. أحمد',
        role: 'TEACHER',
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      },
    ]);

    app = createApp({
      env: { ...env, STORAGE_DRIVER: 'local', LOCAL_STORAGE_DIR: tmpDir },
      prisma,
      logger,
      storage,
      virusScanner: new NoopVirusScanner(),
      gradingDispatcher: dispatcher,
    });
    teacherToken = signTeacherAccessToken(
      { id: TEACHER_ID, email: 'teacher@mathlens.local', role: 'TEACHER' },
      env,
    );
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function seedPublishedTopic(): Promise<{
    topicId: string;
    model1Id: string;
    mcqQuestionId: string;
    correctOptionId: string;
    wrongOptionId: string;
    essayQuestionId: string;
  }> {
    const topicRes = await request(app)
      .post('/api/v1/topics')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        title: 'الاشتقاق',
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        minWatchSeconds: 180,
      });
    const topic = topicRes.body.topic;
    const m1 = topic.examModels[0];
    const m2 = topic.examModels[1];

    const mcqPayload = {
      orderIndex: 1,
      conceptKey: 'exp-basic',
      type: 'MCQ',
      promptLatex: 'What is $(e^{2x})^{\\prime}$?',
      points: 10,
      videoTimestampSeconds: 30,
      mcqOptions: [
        { label: 'A', textLatex: '$e^{2x}$', isCorrect: false },
        { label: 'B', textLatex: '$2e^{2x}$', isCorrect: true },
        { label: 'C', textLatex: '$2x$', isCorrect: false },
        { label: 'D', textLatex: '$e^x$', isCorrect: false },
      ],
    };

    const essayPayload = {
      orderIndex: 2,
      conceptKey: 'log-diff',
      type: 'ESSAY',
      promptLatex: 'Differentiate $y = x^x$.',
      points: 20,
      videoTimestampSeconds: 90,
      modelAnswer: {
        solutionStepsLatex: ['$\\ln y = x\\ln x$', '$y^{\\prime} = x^x(\\ln x + 1)$'],
        finalAnswerLatex: '$x^x(\\ln x + 1)$',
        finalAnswerSympy: 'x**x*(log(x)+1)',
      },
      rubricCriteria: [
        {
          orderIndex: 1,
          key: 'ln',
          descriptionEn: 'Take ln of both sides',
          descriptionAr: 'أخذ اللوغاريتم الطبيعي للطرفين',
          maxPoints: 10,
        },
        {
          orderIndex: 2,
          key: 'diff',
          descriptionEn: 'Implicit differentiation',
          descriptionAr: 'التفاضل الضمني والناتج',
          maxPoints: 10,
        },
      ],
    };

    const q1 = await request(app)
      .post(`/api/v1/exams/${m1.id}/questions`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send(mcqPayload);
    const q2 = await request(app)
      .post(`/api/v1/exams/${m1.id}/questions`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send(essayPayload);

    await request(app)
      .post(`/api/v1/exams/${m2.id}/questions`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send(mcqPayload);
    await request(app)
      .post(`/api/v1/exams/${m2.id}/questions`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send(essayPayload);

    const pub1 = await request(app)
      .post(`/api/v1/exams/${m1.id}/publish`)
      .set('Authorization', `Bearer ${teacherToken}`);
    expect(pub1.status).toBe(200);
    const pub2 = await request(app)
      .post(`/api/v1/exams/${m2.id}/publish`)
      .set('Authorization', `Bearer ${teacherToken}`);
    expect(pub2.status).toBe(200);

    const opts = q1.body.question.mcqOptions as Array<{ id: string; isCorrect: boolean }>;
    return {
      topicId: topic.id,
      model1Id: m1.id,
      mcqQuestionId: q1.body.question.id,
      correctOptionId: opts.find((o) => o.isCorrect)!.id,
      wrongOptionId: opts.find((o) => !o.isCorrect)!.id,
      essayQuestionId: q2.body.question.id,
    };
  }

  it('supports cohort creation, deterministic roster split, and closed-cohort rejection', async () => {
    const { topicId } = await seedPublishedTopic();

    const splitA = await request(app)
      .post('/api/v1/cohorts/randomize-split')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ studentNames: ['علي', 'سارة', 'محمد', 'مريم'], seed: 42 });
    const splitB = await request(app)
      .post('/api/v1/cohorts/randomize-split')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ studentNames: ['علي', 'سارة', 'محمد', 'مريم'], seed: 42 });
    expect(splitA.status).toBe(200);
    expect(splitA.body.treatment).toEqual(splitB.body.treatment);
    expect(splitA.body.control).toEqual(splitB.body.control);

    const cohortRes = await request(app)
      .post('/api/v1/cohorts')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        topicId,
        name: 'فصل 3أ تجريبي',
        group: 'TREATMENT',
      });
    expect(cohortRes.status).toBe(201);
    const cohort = cohortRes.body.cohort;
    expect(cohort.joinCode).toHaveLength(6);
    expect(cohort.requireVideoBeforePost).toBe(true);

    // List and inspect cohorts
    const listCohorts = await request(app)
      .get('/api/v1/cohorts')
      .set('Authorization', `Bearer ${teacherToken}`);
    expect(listCohorts.status).toBe(200);
    expect(listCohorts.body.cohorts).toHaveLength(1);

    const getCohort = await request(app)
      .get(`/api/v1/cohorts/${cohort.id}`)
      .set('Authorization', `Bearer ${teacherToken}`);
    expect(getCohort.status).toBe(200);

    // Closing cohort blocks student join
    await request(app)
      .patch(`/api/v1/cohorts/${cohort.id}`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ status: 'CLOSED' });

    const joinClosed = await request(app)
      .post('/api/v1/student/join')
      .send({ joinCode: cohort.joinCode, displayName: 'طالب جديد' });
    expect(joinClosed.status).toBe(403);
    expect(joinClosed.body.error.code).toBe('COHORT_CLOSED');

    const delCohort = await request(app)
      .delete(`/api/v1/cohorts/${cohort.id}`)
      .set('Authorization', `Bearer ${teacherToken}`);
    expect(delCohort.status).toBe(204);
  });

  it('executes full student join, consent, MCQ autosave, image EXIF strip/limit, deadline check, and idempotent submit', async () => {
    const seeded = await seedPublishedTopic();

    const cohortRes = await request(app)
      .post('/api/v1/cohorts')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        topicId: seeded.topicId,
        name: 'فصل 3ب',
        group: 'TREATMENT',
      });
    const joinCode = cohortRes.body.cohort.joinCode as string;

    // 1. Join
    const joinRes = await request(app)
      .post('/api/v1/student/join')
      .send({ joinCode, displayName: 'عمر خالد' });
    expect(joinRes.status).toBe(201);
    const resumeCode = joinRes.body.student.resumeCode as string;
    const studentCookie = extractCookie(joinRes, 'ml_student_session');

    // Before consent, starting exam fails with CONSENT_REQUIRED
    const noConsentStart = await request(app)
      .post('/api/v1/student/attempts')
      .set('Cookie', studentCookie)
      .send({ modelNumber: 1 });
    expect(noConsentStart.status).toBe(403);
    expect(noConsentStart.body.error.code).toBe('CONSENT_REQUIRED');

    // 2. Accept consent
    const consentRes = await request(app)
      .post('/api/v1/student/consent')
      .set('Cookie', studentCookie)
      .send({ accepted: true });
    expect(consentRes.status).toBe(200);
    expect(consentRes.body.step).toBe('PRETEST_IN_PROGRESS');

    // 3. Resume works using resumeCode & /me/state reflects step
    const resumeRes = await request(app).post('/api/v1/student/resume').send({ resumeCode });
    expect(resumeRes.status).toBe(200);
    const resumedCookie = extractCookie(resumeRes, 'ml_student_session');

    const stateRes = await request(app)
      .get('/api/v1/student/me/state')
      .set('Cookie', resumedCookie);
    expect(stateRes.status).toBe(200);
    expect(stateRes.body.step).toBe('PRETEST_IN_PROGRESS');

    // Cannot unlock Model 2 early
    const earlyM2 = await request(app)
      .post('/api/v1/student/attempts')
      .set('Cookie', resumedCookie)
      .send({ modelNumber: 2 });
    expect(earlyM2.status).toBe(403);
    expect(earlyM2.body.error.code).toBe('POSTTEST_LOCKED');

    // 4. Start Model 1 & verify zero answer key leak
    const startRes = await request(app)
      .post('/api/v1/student/attempts')
      .set('Cookie', resumedCookie)
      .send({ modelNumber: 1 });
    expect(startRes.status).toBe(200);
    const attempt = startRes.body.attempt;
    expect(attempt.questions).toHaveLength(2);

    const getAttemptRes = await request(app)
      .get(`/api/v1/student/attempts/${attempt.id}`)
      .set('Cookie', resumedCookie);
    expect(getAttemptRes.status).toBe(200);
    expect(getAttemptRes.body.attempt.id).toBe(attempt.id);
    const mcqQ = attempt.questions[0];
    const essayQ = attempt.questions[1];

    for (const opt of mcqQ.mcqOptions) {
      expect(opt.isCorrect).toBeUndefined();
    }
    expect(essayQ.modelAnswer).toBeUndefined();
    expect(essayQ.rubricCriteria).toBeUndefined();

    // 5. Autosave MCQ
    const saveRes = await request(app)
      .put(`/api/v1/student/answers/${mcqQ.answerId}`)
      .set('Cookie', resumedCookie)
      .send({ selectedOptionId: seeded.correctOptionId });
    expect(saveRes.status).toBe(200);
    expect(saveRes.body.selectedOptionId).toBe(seeded.correctOptionId);

    // 6. Upload oversized PNG with EXIF & verify resize <=1600px + EXIF strip
    const oversizedPngWithExif = await sharp({
      create: {
        width: 2200,
        height: 1100,
        channels: 3,
        background: { r: 245, g: 245, b: 245 },
      },
    })
      .withMetadata({ exif: { IFD0: { ImageDescription: 'GPS_SECRET_EXIF' } } })
      .png()
      .toBuffer();

    const up1 = await request(app)
      .post(`/api/v1/student/answers/${essayQ.answerId}/images`)
      .set('Cookie', resumedCookie)
      .attach('image', oversizedPngWithExif, 'solution.png');
    expect(up1.status).toBe(201);
    expect(up1.body.image.width).toBe(1600);
    expect(up1.body.image.height).toBe(800);

    // Stored image bytes contain zero EXIF metadata
    const storedSignedUrl = up1.body.image.signedUrl as string;
    const storedRes = await request(app).get(storedSignedUrl);
    expect(storedRes.status).toBe(200);
    const meta = await sharp(storedRes.body).metadata();
    expect(meta.exif).toBeUndefined();
    expect(storedRes.body.toString('utf8')).not.toContain('GPS_SECRET_EXIF');

    // Invalid executable / text payload rejected via magic-byte inspection
    const fakeExe = await request(app)
      .post(`/api/v1/student/answers/${essayQ.answerId}/images`)
      .set('Cookie', resumedCookie)
      .attach('image', Buffer.from('MZ\x90\x00not_an_image'), 'evil.jpg');
    expect(fakeExe.status).toBe(400);
    expect(fakeExe.body.error.code).toBe('INVALID_UPLOAD');

    // Second valid upload succeeds; 3rd exceeds limit of 2
    const up2 = await request(app)
      .post(`/api/v1/student/answers/${essayQ.answerId}/images`)
      .set('Cookie', resumedCookie)
      .attach('image', oversizedPngWithExif, 'page2.png');
    expect(up2.status).toBe(201);

    const up3 = await request(app)
      .post(`/api/v1/student/answers/${essayQ.answerId}/images`)
      .set('Cookie', resumedCookie)
      .attach('image', oversizedPngWithExif, 'page3.png');
    expect(up3.status).toBe(400);
    expect(up3.body.error.code).toBe('IMAGE_LIMIT_EXCEEDED');

    // Delete 2nd image
    const delImg = await request(app)
      .delete(`/api/v1/student/answer-images/${up2.body.image.id}`)
      .set('Cookie', resumedCookie);
    expect(delImg.status).toBe(204);

    // Expired deadline blocks autosave and image upload
    prisma._state.attempts[0]!.deadlineAt = new Date(Date.now() - 60_000);
    const expiredSave = await request(app)
      .put(`/api/v1/student/attempts/${attempt.id}/answers/${seeded.mcqQuestionId}`)
      .set('Cookie', resumedCookie)
      .send({ selectedOptionId: seeded.wrongOptionId });
    expect(expiredSave.status).toBe(409);
    expect(expiredSave.body.error.code).toBe('EXAM_DEADLINE_EXPIRED');

    // 7. Submit idempotently
    const submit1 = await request(app)
      .post(`/api/v1/student/attempts/${attempt.id}/submit`)
      .set('Cookie', resumedCookie);
    expect(submit1.status).toBe(200);
    expect(submit1.body.status).toBe('GRADING');
    expect(submit1.body.pendingEssayCount).toBe(1);
    expect(dispatchedJobs).toHaveLength(1);
    expect(prisma._state.answers.find((a) => a.questionId === seeded.mcqQuestionId)?.score).toBe(
      10,
    );

    // Double submit is idempotent and does not re-enqueue AI jobs
    const submit2 = await request(app)
      .post(`/api/v1/student/attempts/${attempt.id}/submit`)
      .set('Cookie', resumedCookie);
    expect(submit2.status).toBe(200);
    expect(submit2.body.status).toBe('GRADING');
    expect(dispatchedJobs).toHaveLength(1);
  });

  it('rate-limits repeated student resume attempts cleanly', async () => {
    for (let i = 0; i < 10; i += 1) {
      const r = await request(app).post('/api/v1/student/resume').send({ resumeCode: '234567' });
      expect(r.status).toBe(401);
    }
    const eleventh = await request(app)
      .post('/api/v1/student/resume')
      .send({ resumeCode: '234567' });
    expect(eleventh.status).toBe(429);
    expect(eleventh.body.error.code).toBe('RATE_LIMITED');
  });
});
