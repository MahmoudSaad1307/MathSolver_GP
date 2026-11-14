import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { createLogger } from '../src/lib/logger.js';
import { hashPassword, signTeacherAccessToken } from '../src/lib/security.js';
import {
  STUDENT_SESSION_COOKIE,
  TEACHER_ACCESS_COOKIE,
  TEACHER_REFRESH_COOKIE,
} from '../src/middleware/auth.js';
import type { AiServiceClient, StatsServiceClient } from '../src/services/aiClient.js';
import type { GradingDispatcher } from '../src/services/gradingDispatcher.js';
import { GradingOrchestrator } from '../src/services/gradingOrchestrator.js';
import { LocalDiskStorageAdapter } from '../src/services/storage/localStorage.js';
import { createInMemoryPrisma } from './helpers/fakePrisma.js';
import { createTestEnv } from './helpers/testEnv.js';

function createE2eAiClient(): AiServiceClient {
  const transcription = {
    lines: [
      {
        lineNumber: 1,
        textLatex: 'f(x) = x^2',
        confidence: 0.96,
        hasUnsure: false,
        illegible: false,
        crossedOut: false,
      },
      {
        lineNumber: 2,
        textLatex: "f'(x) = 2x",
        confidence: 0.94,
        hasUnsure: false,
        illegible: false,
        crossedOut: false,
      },
    ],
    fullTranscriptionLatex: "f(x) = x^2 \\\\ f'(x) = 2x",
    finalAnswerLatex: '2x',
    overallConfidence: 0.95,
    illegibleRatio: 0,
    containsUnsureToken: false,
    injectionDetected: false,
    injectionSignals: [],
    rawModelOutput: '{"lines":[]}',
    preprocessWarnings: [],
    provider: 'fake',
    modelName: 'fake-eval-v1',
    promptVersion: 'transcribe.v1',
    inputTokens: 100,
    outputTokens: 40,
    costUsd: 0.0005,
    latencyMs: 20,
  };

  return {
    async transcribeOnly() {
      return transcription;
    },
    async gradeEssay(payload) {
      const totalMax = payload.rubricCriteria.reduce((acc, c) => acc + c.maxPoints, 0);
      return {
        provider: 'fake',
        modelName: 'fake-eval-v1',
        promptVersion: 'transcribe.v1+grade.v1',
        rubricVersion: payload.rubricVersion,
        imageHash: payload.images[0]?.sha256 ?? 'f'.repeat(64),
        transcription,
        criteriaScores: payload.rubricCriteria.map((c) => ({
          criterionKey: c.key,
          awardedPoints: c.maxPoints,
          maxPoints: c.maxPoints,
          met: true,
          evidenceStep: 2,
          commentAr: 'حل صحيح وواضح.',
        })),
        aiTotal: totalMax,
        maxPoints: totalMax,
        finalAnswerCorrect: true,
        firstErrorStep: null,
        errorType: 'none',
        errorExplanationAr: 'لا توجد أخطاء؛ أحسنت.',
        hintAr: 'استمر على نفس المستوى.',
        confidence: 0.95,
        sympyCheck: {
          checked: true,
          status: 'EQUIVALENT',
          studentFinalSympy: '2*x',
          expectedFinalSympy: '2*x',
          equivalent: true,
          detail: 'symbolic',
        },
        needsReview: false,
        reviewReasons: [],
        rawOutput: '{"ok":true}',
        latencyMs: 42,
        costUsd: 0.001,
        inputTokens: 200,
        outputTokens: 80,
        schemaRetryUsed: false,
        cached: false,
      };
    },
  };
}

function createFakeStatsClient(): StatsServiceClient {
  return {
    async computePairedStats(input) {
      return {
        n: input.pre_scores.length,
        pre_mean: 50,
        pre_sd: 0,
        pre_median: 50,
        pre_iqr: 0,
        post_mean: 100,
        post_sd: 0,
        post_median: 100,
        post_iqr: 0,
        mean_diff: 50,
        sd_diff: 0,
        median_diff: 50,
        shapiro: { statistic: null, p_value: null, normal: true },
        paired_t: { statistic: 0, p_value: 1, df: 0 },
        wilcoxon: { statistic: null, p_value: null },
        cohens_dz: { estimate: 0, ci_low: 0, ci_high: 0 },
        hake_gain: { mean_gain: 1, per_student_gains: [1] },
        outlier_indices: [],
        warnings: ['SMALL_SAMPLE'],
        recommended_test: 'WILCOXON',
        interpretation_ar: 'عينة تجريبية مكتملة.',
        interpretation_en: 'E2E sample completed.',
      };
    },
    async computeBetweenStats() {
      return {
        group_comparison: null,
        mcnemar: [],
        reliability: {
          n: 1,
          mae: 0,
          exact_agreement_rate: 1,
          within_one_agreement_rate: 1,
          override_rate: 0,
          cohens_kappa: 1,
          quadratic_weighted_kappa: 1,
        },
        warnings: [],
        interpretation_ar: 'ملخص مجموعة واحدة.',
        interpretation_en: 'Single cohort summary.',
      };
    },
  };
}

describe('Phase 8: Security Hardening, Tenant Matrix & Full E2E Lifecycle', () => {
  it('enforces CSP YouTube-only frames, strict CORS, HttpOnly cookies, and complete cross-tenant isolation', async () => {
    const passwordHash = await hashPassword('SecretPass123!');
    const owner = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      email: 'owner@mathlens.local',
      passwordHash,
      displayName: 'Owner',
      role: 'TEACHER' as const,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };
    const attacker = {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      email: 'attacker@mathlens.local',
      passwordHash,
      displayName: 'Attacker',
      role: 'TEACHER' as const,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };
    const prisma = createInMemoryPrisma([owner, attacker]);
    const env = createTestEnv({ STORAGE_DRIVER: 'local', CORS_ORIGINS: 'http://localhost:5173' });
    const storage = new LocalDiskStorageAdapter(
      env.LOCAL_STORAGE_DIR,
      env.VIDEO_UNLOCK_HMAC_SECRET,
    );
    const app = createApp({
      env,
      prisma: prisma as never,
      logger: createLogger('silent'),
      storage,
    });

    const loginRes = await request(app)
      .post('/api/v1/auth/teacher/login')
      .send({ email: 'owner@mathlens.local', password: 'SecretPass123!' });
    expect(loginRes.status).toBe(200);
    const cookies = loginRes.headers['set-cookie'] ?? [];
    expect(
      cookies.some(
        (c) =>
          c.includes(TEACHER_ACCESS_COOKIE) && c.includes('HttpOnly') && c.includes('SameSite=Lax'),
      ),
    ).toBe(true);
    expect(cookies.some((c) => c.includes(TEACHER_REFRESH_COOKIE) && c.includes('HttpOnly'))).toBe(
      true,
    );

    const csp = loginRes.headers['content-security-policy'] ?? '';
    expect(csp).toContain('frame-src https://www.youtube.com https://www.youtube-nocookie.com');
    expect(loginRes.headers['x-content-type-options']).toBe('nosniff');

    const badOrigin = await request(app).get('/healthz').set('Origin', 'https://evil.example');
    expect(badOrigin.status).toBe(403);

    // Seed topic & cohort owned by owner
    const topic = await prisma.topic.create({
      data: {
        ownerId: owner.id,
        title: 'Owner Topic',
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        videoId: 'dQw4w9WgXcQ',
      },
    });
    const cohort = await prisma.cohort.create({
      data: {
        topicId: topic.id,
        teacherId: owner.id,
        name: 'Owner Cohort',
        joinCode: 'OWN789',
        group: 'TREATMENT',
        requireVideoBeforePost: true,
      },
    });
    const student = await prisma.student.create({
      data: { cohortId: cohort.id, displayName: 'S1', resumeCode: 'RES789' },
    });

    const attackerToken = signTeacherAccessToken(
      { id: attacker.id, email: attacker.email, role: 'TEACHER' },
      env,
    );
    const attackerCookie = `${TEACHER_ACCESS_COOKIE}=${attackerToken}`;

    const probes = await Promise.all([
      request(app).get(`/api/v1/topics/${topic.id}`).set('Cookie', [attackerCookie]),
      request(app)
        .patch(`/api/v1/topics/${topic.id}`)
        .set('Cookie', [attackerCookie])
        .send({ title: 'Hacked' }),
      request(app).get(`/api/v1/cohorts/${cohort.id}`).set('Cookie', [attackerCookie]),
      request(app)
        .post(`/api/v1/cohorts/${cohort.id}/open-posttest`)
        .set('Cookie', [attackerCookie]),
      request(app).get(`/api/v1/cohorts/${cohort.id}/export.csv`).set('Cookie', [attackerCookie]),
      request(app).get(`/api/v1/cohorts/${cohort.id}/export.xlsx`).set('Cookie', [attackerCookie]),
      request(app).delete(`/api/v1/cohorts/${cohort.id}/data`).set('Cookie', [attackerCookie]),
      request(app).get(`/api/v1/students/${student.id}`).set('Cookie', [attackerCookie]),
      request(app)
        .post(`/api/v1/students/${student.id}/unlock-posttest`)
        .set('Cookie', [attackerCookie])
        .send({ note: 'cross tenant' }),
    ]);

    for (const res of probes) {
      expect([403, 404]).toContain(res.status);
    }
  });

  it('executes complete seed -> cohort -> pre-test -> AI grade -> video unlock -> post-test -> comparison -> analytics/export E2E flow', async () => {
    const passwordHash = await hashPassword('TeacherPass123!');
    const teacher = {
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      email: 'e2e@mathlens.local',
      passwordHash,
      displayName: 'أ. إياد',
      role: 'TEACHER' as const,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };
    const prisma = createInMemoryPrisma([teacher]);
    const tmpDir = path.resolve('storage-e2e-tmp');
    const env = createTestEnv({ STORAGE_DRIVER: 'local', LOCAL_STORAGE_DIR: tmpDir });
    const storage = new LocalDiskStorageAdapter(tmpDir, env.VIDEO_UNLOCK_HMAC_SECRET);
    const testLogger = createLogger('silent');
    const orchestrator = new GradingOrchestrator(
      prisma as never,
      env,
      storage,
      createE2eAiClient(),
      testLogger,
    );
    const enqueuedJobs: Array<{ attemptId: string; answerId: string; studentId: string }> = [];
    const gradingDispatcher: GradingDispatcher = {
      async enqueueEssayGrading(payload) {
        enqueuedJobs.push(payload);
      },
    };

    const app = createApp({
      env,
      prisma: prisma as never,
      logger: testLogger,
      storage,
      gradingDispatcher,
      statsClient: createFakeStatsClient(),
    });

    try {
      const teacherToken = signTeacherAccessToken(
        { id: teacher.id, email: teacher.email, role: 'TEACHER' },
        env,
      );
      const tCookie = `${TEACHER_ACCESS_COOKIE}=${teacherToken}`;

      // 1. Seed import + prepare publish checklist + publish both models from /seed/exams.seed.json
      const seedPath = path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '../../../seed/exams.seed.json',
      );
      const seedBundle = JSON.parse(await fs.readFile(seedPath, 'utf8')) as Record<string, unknown>;
      const importRes = await request(app)
        .post('/api/v1/exams/import')
        .set('Cookie', [tCookie])
        .send({ dryRun: false, bundle: seedBundle });
      expect(importRes.status).toBe(200);
      const topicId = importRes.body.topic.id as string;

      await request(app)
        .patch(`/api/v1/topics/${topicId}`)
        .set('Cookie', [tCookie])
        .send({ videoUrl: 'https://youtu.be/dQw4w9WgXcQ' });

      const examsRes = await request(app)
        .get(`/api/v1/topics/${topicId}/exams`)
        .set('Cookie', [tCookie]);
      expect(examsRes.status).toBe(200);
      const model1 = examsRes.body.models.find((m: { modelNumber: number }) => m.modelNumber === 1);
      const model2 = examsRes.body.models.find((m: { modelNumber: number }) => m.modelNumber === 2);

      for (const m of [model1, model2]) {
        for (const q of m.questions as Array<{
          id: string;
          orderIndex: number;
          conceptKey: string;
          type: 'MCQ' | 'ESSAY';
          promptLatex: string;
          points: number;
          needsTeacherConfirmation: boolean;
          mcqOptions: Array<{ label: string; textLatex: string; isCorrect: boolean }>;
          modelAnswer: {
            solutionStepsLatex: string[];
            finalAnswerLatex: string;
            finalAnswerSympy: string | null;
            commonMistakes: string;
          } | null;
          rubricCriteria: Array<{
            orderIndex: number;
            key: string;
            descriptionEn: string;
            descriptionAr: string;
            maxPoints: number;
          }>;
        }>) {
          if (q.needsTeacherConfirmation) {
            const conf = await request(app)
              .post(`/api/v1/questions/${q.id}/confirm`)
              .set('Cookie', [tCookie]);
            expect(conf.status).toBe(200);
          }
          await request(app)
            .patch(`/api/v1/questions/${q.id}`)
            .set('Cookie', [tCookie])
            .send({
              orderIndex: q.orderIndex,
              conceptKey: q.conceptKey,
              type: q.type,
              promptLatex: q.promptLatex,
              points: q.points,
              solutionUrl: `https://www.youtube.com/watch?v=dQw4w9WgXcQ`,
              needsTeacherConfirmation: false,
              ...(q.type === 'MCQ'
                ? {
                    mcqOptions: q.mcqOptions.map((o) => ({
                      label: o.label,
                      textLatex: o.textLatex,
                      isCorrect: o.isCorrect,
                    })),
                  }
                : {
                    modelAnswer: q.modelAnswer,
                    rubricCriteria: q.rubricCriteria.map((c) => ({
                      orderIndex: c.orderIndex,
                      key: c.key,
                      descriptionEn: c.descriptionEn,
                      descriptionAr: c.descriptionAr,
                      maxPoints: c.maxPoints,
                    })),
                  }),
            });
        }
      }

      for (const m of [model1, model2]) {
        const pub = await request(app)
          .post(`/api/v1/exams/${m.id}/publish`)
          .set('Cookie', [tCookie]);
        expect(pub.status).toBe(200);
      }

      // 2. Create Treatment cohort
      const cohortRes = await request(app).post('/api/v1/cohorts').set('Cookie', [tCookie]).send({
        topicId,
        name: 'شعبة التفاضل 1',
        group: 'TREATMENT',
        requireVideoBeforePost: true,
      });
      expect(cohortRes.status).toBe(201);
      const joinCode = cohortRes.body.cohort.joinCode as string;
      const cohortId = cohortRes.body.cohort.id as string;

      // 3. Student joins & accepts consent
      const joinRes = await request(app)
        .post('/api/v1/student/join')
        .send({ joinCode, displayName: 'يوسف طارق' });
      expect(joinRes.status).toBe(201);
      const studentCookieHeader = joinRes.headers['set-cookie']?.find((c) =>
        c.startsWith(`${STUDENT_SESSION_COOKIE}=`),
      );
      expect(studentCookieHeader).toBeDefined();
      const sCookie = studentCookieHeader!.split(';')[0];

      const consentRes = await request(app)
        .post('/api/v1/student/consent')
        .set('Cookie', [sCookie])
        .send({ accepted: true });
      expect(consentRes.status).toBe(200);

      // 4. Start Model 1, verify locked Model 2 fails with 403 POSTTEST_LOCKED
      const earlyPost = await request(app)
        .post('/api/v1/student/attempts')
        .set('Cookie', [sCookie])
        .send({ modelNumber: 2 });
      expect(earlyPost.status).toBe(403);
      expect(earlyPost.body.error.code).toBe('POSTTEST_LOCKED');

      const startPre = await request(app)
        .post('/api/v1/student/attempts')
        .set('Cookie', [sCookie])
        .send({ modelNumber: 1 });
      expect(startPre.status).toBe(200);
      const preAttempt = startPre.body.attempt;
      const jpegBuf = await sharp({
        create: { width: 120, height: 80, channels: 3, background: { r: 255, g: 255, b: 255 } },
      })
        .jpeg()
        .toBuffer();

      for (const q of preAttempt.questions as Array<{
        id: string;
        answerId: string;
        type: string;
        mcqOptions?: Array<{ id: string }>;
      }>) {
        if (q.type === 'MCQ' && q.mcqOptions?.[0]) {
          const saveMcq = await request(app)
            .put(`/api/v1/student/attempts/${preAttempt.id}/answers/${q.id}`)
            .set('Cookie', [sCookie])
            .send({ selectedOptionId: q.mcqOptions[0].id });
          expect(saveMcq.status).toBe(200);
        } else {
          const uploadRes = await request(app)
            .post(`/api/v1/student/answers/${q.answerId}/images`)
            .set('Cookie', [sCookie])
            .attach('image', jpegBuf, { filename: 'sol.jpg', contentType: 'image/jpeg' });
          expect(uploadRes.status).toBe(201);
        }
      }

      const submitPre = await request(app)
        .post(`/api/v1/student/attempts/${preAttempt.id}/submit`)
        .set('Cookie', [sCookie]);
      expect(submitPre.status).toBe(200);
      expect(enqueuedJobs.length).toBeGreaterThan(0);

      // Process essay jobs via real orchestrator
      for (const job of enqueuedJobs.splice(0, enqueuedJobs.length)) {
        await orchestrator.processEssayGradingJob(job);
      }

      const preResults = await request(app)
        .get(`/api/v1/student/attempts/${preAttempt.id}/results`)
        .set('Cookie', [sCookie]);
      expect(preResults.status).toBe(200);

      // 5. Visit wrong-question explanation videos to unlock Model 2
      const videoStateRes = await request(app)
        .get('/api/v1/student/video/state')
        .set('Cookie', [sCookie]);
      expect(videoStateRes.status).toBe(200);
      for (const seg of videoStateRes.body.wrongQuestionSegments as Array<{ questionId: string }>) {
        const hbVisit = await request(app)
          .post('/api/v1/student/video/heartbeat')
          .set('Cookie', [sCookie])
          .send({
            type: 'QUESTION_LINK_CLICK',
            position: 0,
            playbackRate: 1,
            tabVisible: true,
            questionId: seg.questionId,
            clientTs: new Date().toISOString(),
          });
        expect(hbVisit.status).toBe(200);
      }

      // 6. Start & submit Model 2
      const startPost = await request(app)
        .post('/api/v1/student/attempts')
        .set('Cookie', [sCookie])
        .send({ modelNumber: 2 });
      expect(startPost.status).toBe(200);
      const postAttempt = startPost.body.attempt;

      for (const q of postAttempt.questions as Array<{
        id: string;
        answerId: string;
        type: string;
        mcqOptions?: Array<{ id: string }>;
      }>) {
        if (q.type === 'MCQ' && q.mcqOptions?.[0]) {
          await request(app)
            .put(`/api/v1/student/answers/${q.answerId}`)
            .set('Cookie', [sCookie])
            .send({ selectedOptionId: q.mcqOptions[0].id });
        } else {
          await request(app)
            .post(`/api/v1/student/answers/${q.answerId}/images`)
            .set('Cookie', [sCookie])
            .attach('image', jpegBuf, { filename: 'post.jpg', contentType: 'image/jpeg' });
        }
      }

      const submitPost = await request(app)
        .post(`/api/v1/student/attempts/${postAttempt.id}/submit`)
        .set('Cookie', [sCookie]);
      expect(submitPost.status).toBe(200);
      for (const job of enqueuedJobs.splice(0, enqueuedJobs.length)) {
        await orchestrator.processEssayGradingJob(job);
      }

      // 7. Student comparison + Teacher analytics + CSV/XLSX export
      const cmpRes = await request(app).get('/api/v1/student/comparison').set('Cookie', [sCookie]);
      expect(cmpRes.status).toBe(200);
      expect(cmpRes.body.twinQuestions.length).toBeGreaterThan(0);

      const analyticsRes = await request(app).get('/api/v1/analytics').set('Cookie', [tCookie]);
      expect(analyticsRes.status).toBe(200);
      expect(analyticsRes.body.summary.pairedStudents).toBe(1);

      const csvRes = await request(app)
        .get(`/api/v1/cohorts/${cohortId}/export.csv`)
        .set('Cookie', [tCookie]);
      expect(csvRes.status).toBe(200);
      expect(csvRes.text).toContain('يوسف طارق');

      // Ensure warn spy doesn't fail anything if omitted
      vi.restoreAllMocks();
    } finally {
      vi.useRealTimers();
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});
