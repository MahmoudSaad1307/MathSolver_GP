import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createLogger } from '../src/lib/logger.js';
import {
  hashPassword,
  signStudentSessionToken,
  signTeacherAccessToken,
} from '../src/lib/security.js';
import { LocalDiskStorageAdapter } from '../src/services/storage/localStorage.js';
import { mergeWatchSegment, VideoService } from '../src/services/videoService.js';
import { createInMemoryPrisma } from './helpers/fakePrisma.js';
import { createTestEnv } from './helpers/testEnv.js';

const TEACHER_ID = '11111111-1111-4111-8111-111111111111';
const TOPIC_ID = '22222222-2222-4222-8222-222222222222';
const MODEL_1_ID = '33333333-3333-4333-8333-333333333331';
const MODEL_2_ID = '33333333-3333-4333-8333-333333333332';
const Q1_1 = '44444444-4444-4444-8444-444444444411';
const Q1_2 = '44444444-4444-4444-8444-444444444412';
const Q2_1 = '44444444-4444-4444-8444-444444444421';
const Q2_2 = '44444444-4444-4444-8444-444444444422';
const COHORT_TREATMENT_ID = '55555555-5555-4555-8555-555555555551';
const COHORT_CONTROL_ID = '55555555-5555-4555-8555-555555555552';
const STU_TREATMENT_ID = '66666666-6666-4666-8666-666666666661';
const STU_CONTROL_ID = '66666666-6666-4666-8666-666666666662';

describe('Phase 6 Video Gate, Fraud Guards, Teacher Unlocks & Comparison Analytics', () => {
  const env = createTestEnv();
  const logger = createLogger('silent');
  let tmpDir: string;
  let prisma: ReturnType<typeof createInMemoryPrisma>;
  let app: ReturnType<typeof createApp>;
  let teacherCookie: string;
  let treatmentCookie: string;
  let controlCookie: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mathlens-video-test-'));
    const storage = new LocalDiskStorageAdapter(tmpDir, env.VIDEO_UNLOCK_HMAC_SECRET);
    const passwordHash = await hashPassword('TeacherPass123!');
    const now = new Date();

    prisma = createInMemoryPrisma([
      {
        id: TEACHER_ID,
        email: 'teacher@mathlens.local',
        passwordHash,
        displayName: 'أ. كريم',
        role: 'TEACHER',
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
    ]);

    prisma._state.topics.push({
      id: TOPIC_ID,
      ownerId: TEACHER_ID,
      title: 'نهايات الدوال الأسية',
      description: 'مراجعة قبل وبعد',
      videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      videoId: 'dQw4w9WgXcQ',
      minWatchSeconds: 15,
      correctnessThreshold: 0.6,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });

    prisma._state.examModels.push(
      {
        id: MODEL_1_ID,
        topicId: TOPIC_ID,
        modelNumber: 1,
        title: 'نموذج 1',
        durationMinutes: 45,
        totalPoints: 20,
        status: 'PUBLISHED',
        pairedWithId: MODEL_2_ID,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
      {
        id: MODEL_2_ID,
        topicId: TOPIC_ID,
        modelNumber: 2,
        title: 'نموذج 2',
        durationMinutes: 45,
        totalPoints: 20,
        status: 'PUBLISHED',
        pairedWithId: MODEL_1_ID,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
    );

    prisma._state.questions.push(
      {
        id: Q1_1,
        examModelId: MODEL_1_ID,
        orderIndex: 1,
        conceptKey: 'exp-limit',
        type: 'MCQ',
        promptLatex: 'Pre Q1',
        points: 10,
        solutionUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        needsTeacherConfirmation: false,
        teacherConfirmedAt: now,
        twinQuestionId: Q2_1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
      {
        id: Q1_2,
        examModelId: MODEL_1_ID,
        orderIndex: 2,
        conceptKey: 'chain-rule',
        type: 'ESSAY',
        promptLatex: 'Pre Q2',
        points: 10,
        solutionUrl: 'https://www.youtube.com/watch?v=1Q1D7B7Y1uQ',
        needsTeacherConfirmation: false,
        teacherConfirmedAt: now,
        twinQuestionId: Q2_2,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
      {
        id: Q2_1,
        examModelId: MODEL_2_ID,
        orderIndex: 1,
        conceptKey: 'exp-limit',
        type: 'MCQ',
        promptLatex: 'Post Q1',
        points: 10,
        solutionUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        needsTeacherConfirmation: false,
        teacherConfirmedAt: now,
        twinQuestionId: Q1_1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
      {
        id: Q2_2,
        examModelId: MODEL_2_ID,
        orderIndex: 2,
        conceptKey: 'chain-rule',
        type: 'ESSAY',
        promptLatex: 'Post Q2',
        points: 10,
        solutionUrl: 'https://www.youtube.com/watch?v=1Q1D7B7Y1uQ',
        needsTeacherConfirmation: false,
        teacherConfirmedAt: now,
        twinQuestionId: Q1_2,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
    );

    prisma._state.cohorts.push(
      {
        id: COHORT_TREATMENT_ID,
        topicId: TOPIC_ID,
        teacherId: TEACHER_ID,
        name: 'تجريبي 1',
        joinCode: 'TR9K2M',
        group: 'TREATMENT',
        requireVideoBeforePost: true,
        requireWrongSegmentVisits: true,
        showProvisionalScore: false,
        postTestOpensAt: null,
        status: 'OPEN',
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
      {
        id: COHORT_CONTROL_ID,
        topicId: TOPIC_ID,
        teacherId: TEACHER_ID,
        name: 'ضابطة 1',
        joinCode: 'CN9K2M',
        group: 'CONTROL',
        requireVideoBeforePost: false,
        requireWrongSegmentVisits: false,
        showProvisionalScore: false,
        postTestOpensAt: new Date(now.getTime() + 86_400_000),
        status: 'OPEN',
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
    );

    prisma._state.students.push(
      {
        id: STU_TREATMENT_ID,
        cohortId: COHORT_TREATMENT_ID,
        displayName: 'طالب تجريبي',
        resumeCode: 'TRSTU1',
        consentAcceptedAt: now,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
      {
        id: STU_CONTROL_ID,
        cohortId: COHORT_CONTROL_ID,
        displayName: 'طالب ضابط',
        resumeCode: 'CNSTU1',
        consentAcceptedAt: now,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
    );

    // Seed completed pre-test attempts for both students (both got Q1 wrong -> segment 45s required)
    const preTreatId = '77777777-7777-4777-8777-777777777711';
    const preCtrlId = '77777777-7777-4777-8777-777777777721';
    prisma._state.attempts.push(
      {
        id: preTreatId,
        studentId: STU_TREATMENT_ID,
        examModelId: MODEL_1_ID,
        status: 'GRADED',
        startedAt: now,
        submittedAt: now,
        deadlineAt: now,
        totalScore: 10,
        maxScore: 20,
        percentage: 50,
        scoreSource: 'MIXED',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: preCtrlId,
        studentId: STU_CONTROL_ID,
        examModelId: MODEL_1_ID,
        status: 'GRADED',
        startedAt: now,
        submittedAt: now,
        deadlineAt: now,
        totalScore: 8,
        maxScore: 20,
        percentage: 40,
        scoreSource: 'MIXED',
        createdAt: now,
        updatedAt: now,
      },
    );

    prisma._state.answers.push(
      {
        id: '88888888-8888-4888-8888-888888888811',
        attemptId: preTreatId,
        questionId: Q1_1,
        selectedOptionId: null,
        isCorrect: false,
        score: 0,
        maxScore: 10,
        misreadReportedAt: null,
        misreadNote: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: '88888888-8888-4888-8888-888888888812',
        attemptId: preTreatId,
        questionId: Q1_2,
        selectedOptionId: null,
        isCorrect: true,
        score: 10,
        maxScore: 10,
        misreadReportedAt: null,
        misreadNote: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: '88888888-8888-4888-8888-888888888821',
        attemptId: preCtrlId,
        questionId: Q1_1,
        selectedOptionId: null,
        isCorrect: false,
        score: 0,
        maxScore: 10,
        misreadReportedAt: null,
        misreadNote: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: '88888888-8888-4888-8888-888888888822',
        attemptId: preCtrlId,
        questionId: Q1_2,
        selectedOptionId: null,
        isCorrect: true,
        score: 8,
        maxScore: 10,
        misreadReportedAt: null,
        misreadNote: null,
        createdAt: now,
        updatedAt: now,
      },
    );

    teacherCookie = `ml_teacher_access=${signTeacherAccessToken(
      { id: TEACHER_ID, email: 'teacher@mathlens.local', role: 'TEACHER' },
      env,
    )}`;
    treatmentCookie = `ml_student_session=${signStudentSessionToken(
      { id: STU_TREATMENT_ID, cohortId: COHORT_TREATMENT_ID },
      env,
    )}`;
    controlCookie = `ml_student_session=${signStudentSessionToken(
      { id: STU_CONTROL_ID, cohortId: COHORT_CONTROL_ID },
      env,
    )}`;

    app = createApp({ env, prisma, logger, storage });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('merges continuous watch intervals and prevents seek-jump, hidden-tab, and >1.5x speed cheating', async () => {
    // Pure merge test: overlapping replays never double-count
    const m1 = mergeWatchSegment([], 0, 5);
    const m2 = mergeWatchSegment(m1.intervals, 3, 10);
    expect(m2.totalSeconds).toBe(10);

    const svc = new VideoService(prisma, env);
    const t0 = new Date('2026-11-13T10:00:00.000Z');

    // PLAY at 0s
    await svc.recordHeartbeat(
      STU_TREATMENT_ID,
      { type: 'PLAY', position: 0, playbackRate: 1, tabVisible: true, clientTs: t0.toISOString() },
      t0,
    );

    // Cheat attempt 1: seek jump directly to 120s
    const t1 = new Date(t0.getTime() + 5000);
    const seekFraud = await svc.recordHeartbeat(
      STU_TREATMENT_ID,
      {
        type: 'HEARTBEAT',
        position: 120,
        playbackRate: 1,
        tabVisible: true,
        clientTs: t1.toISOString(),
      },
      t1,
    );
    expect(seekFraud.fraudWarning).toBe('SEEK_JUMP_IGNORED');
    expect(seekFraud.watchedSeconds).toBe(0);

    // Reset seek back to 0 and try hidden tab
    const t2 = new Date(t1.getTime() + 1000);
    await svc.recordHeartbeat(
      STU_TREATMENT_ID,
      { type: 'SEEK', position: 0, playbackRate: 1, tabVisible: true, clientTs: t2.toISOString() },
      t2,
    );
    const t3 = new Date(t2.getTime() + 5000);
    const tabHidden = await svc.recordHeartbeat(
      STU_TREATMENT_ID,
      {
        type: 'HEARTBEAT',
        position: 5,
        playbackRate: 1,
        tabVisible: false,
        clientTs: t3.toISOString(),
      },
      t3,
    );
    expect(tabHidden.fraudWarning).toBe('TAB_HIDDEN');
    expect(tabHidden.watchedSeconds).toBe(0);

    // Cheat attempt 3: 2x playback speed
    const t4 = new Date(t3.getTime() + 5000);
    const fastRate = await svc.recordHeartbeat(
      STU_TREATMENT_ID,
      {
        type: 'HEARTBEAT',
        position: 5,
        playbackRate: 2.0,
        tabVisible: true,
        clientTs: t4.toISOString(),
      },
      t4,
    );
    expect(fastRate.fraudWarning).toBe('PLAYBACK_RATE_TOO_HIGH');
    expect(fastRate.watchedSeconds).toBe(0);

    // Genuine sequential 5-sec ticks up to 15s (minWatchSeconds = 15)
    await svc.recordHeartbeat(
      STU_TREATMENT_ID,
      { type: 'PLAY', position: 0, playbackRate: 1, tabVisible: true, clientTs: t4.toISOString() },
      t4,
    );
    let currentTime = t4;
    for (const pos of [5, 10, 15]) {
      currentTime = new Date(currentTime.getTime() + 5000);
      await svc.recordHeartbeat(
        STU_TREATMENT_ID,
        {
          type: 'HEARTBEAT',
          position: pos,
          playbackRate: 1,
          tabVisible: true,
          clientTs: currentTime.toISOString(),
        },
        currentTime,
      );
    }

    // Because cohort.requireWrongSegmentVisits = true and Q1_1 timestamp (45s) not yet visited -> still locked!
    const stateBeforeSegment = await request(app)
      .get('/api/v1/student/video/state')
      .set('Cookie', treatmentCookie);
    expect(stateBeforeSegment.status).toBe(200);
    expect(stateBeforeSegment.body.watchedSeconds).toBe(15);
    expect(stateBeforeSegment.body.wrongSegmentsIncomplete).toBe(true);
    expect(stateBeforeSegment.body.unlocked).toBe(false);

    // Click wrong question segment -> unlocks post-test cleanly with HMAC signature
    const clickRes = await request(app)
      .post('/api/v1/student/video/heartbeat')
      .set('Cookie', treatmentCookie)
      .send({
        type: 'QUESTION_LINK_CLICK',
        position: 45,
        playbackRate: 1,
        tabVisible: true,
        questionId: Q1_1,
        clientTs: new Date().toISOString(),
      });
    expect(clickRes.status).toBe(200);
    expect(clickRes.body.wrongSegmentsIncomplete).toBe(false);
    expect(clickRes.body.unlocked).toBe(true);
  });

  it('logs player alerts, supports teacher cohort open-posttest & manual unlock, and serves comparison analytics with Control ethics offer', async () => {
    // Player error alert
    const alertRes = await request(app)
      .post('/api/v1/student/video/alert')
      .set('Cookie', treatmentCookie)
      .send({ errorCode: 150 });
    expect(alertRes.status).toBe(201);
    const alerts = await (
      prisma as unknown as { videoAlert: { findMany: () => Promise<unknown[]> } }
    ).videoAlert.findMany();
    expect(alerts).toHaveLength(1);

    // Teacher manual unlock for treatment student
    const unlockRes = await request(app)
      .post(`/api/v1/students/${STU_TREATMENT_ID}/unlock-posttest`)
      .set('Cookie', teacherCookie)
      .send({ note: 'YouTube blocked in lab' });
    expect(unlockRes.status).toBe(200);
    expect(unlockRes.body.manualUnlockedById).toBe(TEACHER_ID);

    // Control cohort waits for future scheduled open -> teacher opens now -> Model 2 opens
    const openCohortRes = await request(app)
      .post(`/api/v1/cohorts/${COHORT_CONTROL_ID}/open-posttest`)
      .set('Cookie', teacherCookie);
    expect(openCohortRes.status).toBe(200);

    // Comparison before Model 2 completion -> 409 CONFLICT
    const prematureComp = await request(app)
      .get('/api/v1/student/comparison')
      .set('Cookie', controlCookie);
    expect(prematureComp.status).toBe(409);

    // Seed completed Model 2 attempt for control student (improved from 8/20 -> 17/20)
    const now = new Date();
    const postCtrlId = '99999999-9999-4999-8999-999999999922';
    prisma._state.attempts.push({
      id: postCtrlId,
      studentId: STU_CONTROL_ID,
      examModelId: MODEL_2_ID,
      status: 'FINAL',
      startedAt: now,
      submittedAt: now,
      deadlineAt: now,
      totalScore: 17,
      maxScore: 20,
      percentage: 85,
      scoreSource: 'MIXED',
      createdAt: now,
      updatedAt: now,
    });
    prisma._state.answers.push(
      {
        id: '88888888-8888-4888-8888-888888888891',
        attemptId: postCtrlId,
        questionId: Q2_1,
        selectedOptionId: null,
        isCorrect: true,
        score: 8,
        maxScore: 10,
        misreadReportedAt: null,
        misreadNote: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: '88888888-8888-4888-8888-888888888892',
        attemptId: postCtrlId,
        questionId: Q2_2,
        selectedOptionId: null,
        isCorrect: true,
        score: 9,
        maxScore: 10,
        misreadReportedAt: null,
        misreadNote: null,
        createdAt: now,
        updatedAt: now,
      },
    );

    const compRes = await request(app)
      .get('/api/v1/student/comparison')
      .set('Cookie', controlCookie);
    expect(compRes.status).toBe(200);
    expect(compRes.body.deltaPoints).toBe(9);
    expect(compRes.body.deltaPercentage).toBe(45);
    expect(compRes.body.normalizedGain).toBe(0.75); // (85 - 40) / (100 - 40) = 45/60 = 0.75
    expect(compRes.body.concepts).toHaveLength(2);
    expect(
      compRes.body.concepts.find((c: { conceptKey: string }) => c.conceptKey === 'exp-limit')
        ?.status,
    ).toBe('IMPROVED');
    expect(compRes.body.twinQuestions).toHaveLength(2);
    // Ethics: Control student who skipped pre-post video is offered remediation after post-test
    expect(compRes.body.videoOfferAfterPost.recommendedForControl).toBe(true);
  });
});
