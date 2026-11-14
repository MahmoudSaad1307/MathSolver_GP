import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { createLogger } from '../src/lib/logger.js';
import {
  hashPassword,
  signStudentSessionToken,
  signTeacherAccessToken,
} from '../src/lib/security.js';
import type {
  EssayGradingJobPayload,
  GradingDispatcher,
} from '../src/services/gradingDispatcher.js';
import { LocalDiskStorageAdapter } from '../src/services/storage/localStorage.js';
import { createInMemoryPrisma } from './helpers/fakePrisma.js';
import { createTestEnv } from './helpers/testEnv.js';

const TEACHER_A = '11111111-1111-4111-8111-111111111111';
const TEACHER_B = '11111111-1111-4111-8111-111111111112';
const TOPIC_ID = '22222222-2222-4222-8222-222222222222';
const MODEL_1_ID = '33333333-3333-4333-8333-333333333331';
const Q_MCQ_ID = '44444444-4444-4444-8444-444444444441';
const Q_ESSAY_ID = '44444444-4444-4444-8444-444444444442';
const OPT_A_ID = '55555555-5555-4555-8555-555555555551';
const OPT_B_ID = '55555555-5555-4555-8555-555555555552';
const CRIT_1_ID = '66666666-6666-4666-8666-666666666661';
const CRIT_2_ID = '66666666-6666-4666-8666-666666666662';
const COHORT_ID = '77777777-7777-4777-8777-777777777777';
const STUDENT_ID = '88888888-8888-4888-8888-888888888888';
const ATTEMPT_ID = '99999999-9999-4999-8999-999999999999';
const ANS_MCQ_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const ANS_ESSAY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const IMG_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const GRADING_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

describe('Phase 5 Student Results, Misread Reporting, Teacher Review Queue & Roster', () => {
  const env = createTestEnv();
  const logger = createLogger('silent');
  let tmpDir: string;
  let prisma: ReturnType<typeof createInMemoryPrisma>;
  let app: ReturnType<typeof createApp>;
  let teacherACookie: string;
  let teacherBCookie: string;
  let studentCookie: string;
  let dispatchedJobs: EssayGradingJobPayload[];

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mathlens-review-test-'));
    dispatchedJobs = [];
    const dispatcher: GradingDispatcher = {
      enqueueEssayGrading: vi.fn(async (payload) => {
        dispatchedJobs.push(payload);
      }),
    };
    const storage = new LocalDiskStorageAdapter(tmpDir, env.VIDEO_UNLOCK_HMAC_SECRET);
    const passwordHash = await hashPassword('TeacherPass123!');
    const now = new Date();

    prisma = createInMemoryPrisma([
      {
        id: TEACHER_A,
        email: 'teachera@mathlens.local',
        passwordHash,
        displayName: 'أ. محمود',
        role: 'TEACHER',
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
      {
        id: TEACHER_B,
        email: 'teacherb@mathlens.local',
        passwordHash,
        displayName: 'أ. سارة',
        role: 'TEACHER',
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
    ]);

    prisma._state.topics.push({
      id: TOPIC_ID,
      ownerId: TEACHER_A,
      title: 'الاشتقاق الأسّي',
      description: 'مراجعة شاملة',
      correctnessThreshold: 0.6,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });

    prisma._state.examModels.push({
      id: MODEL_1_ID,
      topicId: TOPIC_ID,
      modelNumber: 1,
      title: 'نموذج 1 — قبلي',
      durationMinutes: 45,
      totalPoints: 20,
      status: 'PUBLISHED',
      pairedWithId: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });

    prisma._state.questions.push(
      {
        id: Q_MCQ_ID,
        examModelId: MODEL_1_ID,
        orderIndex: 1,
        conceptKey: 'exp-deriv',
        type: 'MCQ',
        promptLatex: 'Find $\\frac{d}{dx}(e^{3x})$.',
        points: 5,
        solutionUrl: 'https://example.com/solutions/q-mcq',
        needsTeacherConfirmation: false,
        teacherConfirmedAt: now,
        twinQuestionId: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
      {
        id: Q_ESSAY_ID,
        examModelId: MODEL_1_ID,
        orderIndex: 2,
        conceptKey: 'chain-rule',
        type: 'ESSAY',
        promptLatex: 'Solve and differentiate $y=\\ln(2x+1)$.',
        points: 15,
        needsTeacherConfirmation: false,
        teacherConfirmedAt: now,
        twinQuestionId: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
    );

    prisma._state.mcqOptions.push(
      {
        id: OPT_A_ID,
        questionId: Q_MCQ_ID,
        label: 'A',
        textLatex: '$e^{3x}$',
        isCorrect: false,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
      {
        id: OPT_B_ID,
        questionId: Q_MCQ_ID,
        label: 'B',
        textLatex: '$3e^{3x}$',
        isCorrect: true,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
    );

    prisma._state.modelAnswers.push({
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      questionId: Q_ESSAY_ID,
      solutionStepsLatex: ['$u = 2x+1$', "$y' = \\frac{2}{2x+1}$"],
      finalAnswerLatex: '\\frac{2}{2x+1}',
      finalAnswerSympy: '2/(2*x+1)',
      commonMistakes: 'Forgetting chain rule factor 2',
      rubricVersion: 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });

    prisma._state.rubricCriteria.push(
      {
        id: CRIT_1_ID,
        questionId: Q_ESSAY_ID,
        orderIndex: 1,
        key: 'chain',
        descriptionEn: 'Chain factor',
        descriptionAr: 'مشتقة ما بداخل اللوغاريتم',
        maxPoints: 10,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
      {
        id: CRIT_2_ID,
        questionId: Q_ESSAY_ID,
        orderIndex: 2,
        key: 'denom',
        descriptionEn: 'Denominator placement',
        descriptionAr: 'المقام الصحيح',
        maxPoints: 5,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
    );

    prisma._state.cohorts.push({
      id: COHORT_ID,
      topicId: TOPIC_ID,
      teacherId: TEACHER_A,
      name: 'الصف الثاني الإعدادي — تجريبي',
      joinCode: 'AB7K9M',
      group: 'TREATMENT',
      requireVideoBeforePost: true,
      requireWrongSegmentVisits: false,
      showProvisionalScore: false,
      postTestOpensAt: null,
      status: 'OPEN',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });

    prisma._state.students.push({
      id: STUDENT_ID,
      cohortId: COHORT_ID,
      displayName: 'زياد طارق',
      resumeCode: 'ZT89KM',
      consentAcceptedAt: now,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });

    prisma._state.attempts.push({
      id: ATTEMPT_ID,
      studentId: STUDENT_ID,
      examModelId: MODEL_1_ID,
      status: 'GRADED',
      startedAt: new Date(now.getTime() - 600_000),
      submittedAt: now,
      deadlineAt: new Date(now.getTime() + 1_800_000),
      totalScore: 10,
      maxScore: 20,
      percentage: 50,
      scoreSource: 'MIXED',
      createdAt: now,
      updatedAt: now,
    });

    prisma._state.answers.push(
      {
        id: ANS_MCQ_ID,
        attemptId: ATTEMPT_ID,
        questionId: Q_MCQ_ID,
        selectedOptionId: OPT_A_ID,
        isCorrect: false,
        score: 0,
        maxScore: 5,
        misreadReportedAt: null,
        misreadNote: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: ANS_ESSAY_ID,
        attemptId: ATTEMPT_ID,
        questionId: Q_ESSAY_ID,
        selectedOptionId: null,
        isCorrect: true,
        score: 10,
        maxScore: 15,
        misreadReportedAt: null,
        misreadNote: null,
        createdAt: now,
        updatedAt: now,
      },
    );

    const imgKey = `attempts/${ATTEMPT_ID}/${ANS_ESSAY_ID}/sol.jpg`;
    await storage.putObject(imgKey, Buffer.from('fakejpegbytes'), 'image/jpeg');
    prisma._state.answerImages.push({
      id: IMG_ID,
      answerId: ANS_ESSAY_ID,
      storageKey: imgKey,
      sha256: 'deadbeef',
      width: 1000,
      height: 800,
      bytes: 1200,
      pinnedByTeacher: false,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    prisma._state.gradingResults.push({
      id: GRADING_ID,
      answerId: ANS_ESSAY_ID,
      version: 1,
      provider: 'anthropic',
      modelName: 'claude-sonnet-4',
      promptVersion: 'transcribe.v1+grade.v1',
      rubricVersion: 1,
      imageHash: 'deadbeef',
      transcriptionJson: {
        lines: [
          {
            lineNumber: 1,
            textLatex: 'u = 2x + 1',
            confidence: 0.94,
            hasUnsure: false,
            illegible: false,
            crossedOut: false,
          },
          {
            lineNumber: 2,
            textLatex: "y' = \\frac{1}{2x+1}",
            confidence: 0.91,
            hasUnsure: false,
            illegible: false,
            crossedOut: false,
          },
        ],
        fullTranscriptionLatex: "u = 2x+1 \\\\ y' = \\frac{1}{2x+1}",
      },
      gradingJson: {},
      criteriaScores: [
        {
          criterionKey: 'chain',
          awardedPoints: 5,
          maxPoints: 10,
          met: false,
          commentAr: 'نسيان معامل 2',
        },
        {
          criterionKey: 'denom',
          awardedPoints: 5,
          maxPoints: 5,
          met: true,
          commentAr: 'المقام صحيح',
        },
      ],
      aiTotal: 10,
      finalAnswerCorrect: false,
      firstErrorStep: 2,
      errorType: 'rule_misuse',
      errorExplanationAr: 'أخطأت في الخطوة 2: نسيت ضرب البسط في مشتقة ما بداخل اللوغاريتم (2).',
      hintAr: "تذكر قاعدة السلسلة: مشتقة ln(g(x)) تساوي g'(x)/g(x).",
      confidence: 0.92,
      sympyCheck: { checked: true, status: 'NOT_EQUIVALENT', equivalent: false },
      needsReview: false,
      reviewReasons: [],
      rawOutput: '{}',
      latencyMs: 320,
      costUsd: 0.004,
      createdAt: now,
      updatedAt: now,
    });

    teacherACookie = `ml_teacher_access=${signTeacherAccessToken(
      { id: TEACHER_A, email: 'teachera@mathlens.local', role: 'TEACHER' },
      env,
    )}`;
    teacherBCookie = `ml_teacher_access=${signTeacherAccessToken(
      { id: TEACHER_B, email: 'teacherb@mathlens.local', role: 'TEACHER' },
      env,
    )}`;
    studentCookie = `ml_student_session=${signStudentSessionToken(
      { id: STUDENT_ID, cohortId: COHORT_ID },
      env,
    )}`;

    app = createApp({ env, prisma, logger, storage, gradingDispatcher: dispatcher });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns redacted student results, hides NEEDS_REVIEW total unless showProvisionalScore, and records misread reports', async () => {
    const res = await request(app)
      .get(`/api/v1/student/attempts/${ATTEMPT_ID}/results`)
      .set('Cookie', studentCookie);

    expect(res.status).toBe(200);
    expect(res.body.attempt.totalScore).toBe(10);
    expect(res.body.attempt.scoreHidden).toBe(false);
    expect(res.body.questions).toHaveLength(2);
    // Security: never expose isCorrect key on MCQ options or teacher modelAnswer
    expect(res.body.questions[0].mcqOptions[0].isCorrect).toBeUndefined();
    expect(res.body.questions[1].modelAnswer).toBeUndefined();
    expect(res.body.questions[0].belowThreshold).toBe(true);
    expect(res.body.questions[0].solutionUrl).toBe('https://example.com/solutions/q-mcq');
    expect(res.body.questions[1].solutionUrl).toBeNull();
    expect(res.body.questions[1].transcribedLines).toHaveLength(2);
    expect(res.body.questions[1].images[0].signedUrl).toContain('/api/v1/storage/local');

    // Misread report cannot target an MCQ question
    const badMisread = await request(app)
      .post(`/api/v1/student/answers/${ANS_MCQ_ID}/report-misread`)
      .set('Cookie', studentCookie)
      .send({ note: 'MCQ test' });
    expect(badMisread.status).toBe(400);

    // Report misread on essay answer -> moves GradingResult + Attempt to NEEDS_REVIEW
    const misread = await request(app)
      .post(`/api/v1/student/answers/${ANS_ESSAY_ID}/report-misread`)
      .set('Cookie', studentCookie)
      .send({ note: 'الرقم 2 في البسط واضح بالصورة' });

    expect(misread.status).toBe(200);
    expect(misread.body.attemptStatus).toBe('NEEDS_REVIEW');
    expect(prisma._state.gradingResults[0]?.needsReview).toBe(true);
    expect(prisma._state.gradingResults[0]?.reviewReasons).toContain('STUDENT_REPORTED_MISREAD');

    // Because cohort.showProvisionalScore is false, attempt score is now hidden
    const hiddenRes = await request(app)
      .get(`/api/v1/student/attempts/${ATTEMPT_ID}/results`)
      .set('Cookie', studentCookie);
    expect(hiddenRes.status).toBe(200);
    expect(hiddenRes.body.attempt.scoreHidden).toBe(true);
    expect(hiddenRes.body.attempt.totalScore).toBeNull();
    expect(hiddenRes.body.questions[0].statusChip).toBe('GRADED'); // MCQ still visible
    expect(hiddenRes.body.questions[1].statusChip).toBe('NEEDS_REVIEW');
    expect(hiddenRes.body.questions[1].score).toBeNull();

    // Flipping showProvisionalScore = true exposes provisional total to the student
    prisma._state.cohorts[0]!.showProvisionalScore = true;
    const provisionalRes = await request(app)
      .get(`/api/v1/student/attempts/${ATTEMPT_ID}/results`)
      .set('Cookie', studentCookie);
    expect(provisionalRes.body.attempt.scoreHidden).toBe(false);
    expect(provisionalRes.body.attempt.isProvisional).toBe(true);
    expect(provisionalRes.body.attempt.totalScore).toBe(10);
  });

  it('isolates teacher review queue across tenants, clamps criterion overrides, keeps override history, and resolves attempt', async () => {
    // Flag the essay for review first
    prisma._state.gradingResults[0]!.needsReview = true;
    prisma._state.gradingResults[0]!.reviewReasons = ['LOW_CONFIDENCE'];
    prisma._state.attempts[0]!.status = 'NEEDS_REVIEW';

    const unauth = await request(app).get('/api/v1/review-queue');
    expect(unauth.status).toBe(401);

    const otherTeacherQueue = await request(app)
      .get('/api/v1/review-queue')
      .set('Cookie', teacherBCookie);
    expect(otherTeacherQueue.status).toBe(200);
    expect(otherTeacherQueue.body.items).toHaveLength(0);

    const queueRes = await request(app).get('/api/v1/review-queue').set('Cookie', teacherACookie);
    expect(queueRes.status).toBe(200);
    expect(queueRes.body.pendingCount).toBe(1);
    expect(queueRes.body.items[0].question.modelAnswer.finalAnswerSympy).toBe('2/(2*x+1)');

    // Cross-teacher override is forbidden/not found
    const crossOverride = await request(app)
      .post(`/api/v1/grading-results/${GRADING_ID}/override`)
      .set('Cookie', teacherBCookie)
      .send({
        criteriaScores: [
          { criterionId: CRIT_1_ID, awarded: 10 },
          { criterionId: CRIT_2_ID, awarded: 5 },
        ],
      });
    expect(crossOverride.status).toBe(404);

    // Override with over-cap criterion value (99 -> clamped to 10)
    const override1 = await request(app)
      .post(`/api/v1/grading-results/${GRADING_ID}/override`)
      .set('Cookie', teacherACookie)
      .send({
        criteriaScores: [
          { criterionId: CRIT_1_ID, awarded: 99, commentAr: 'صحيح بعد المراجعة' },
          { criterionId: CRIT_2_ID, awarded: 5 },
        ],
        finalAnswerCorrect: true,
        errorExplanationAr: 'الحل صحيح بعد مراجعة المعلم.',
        note: 'مراجعة أولى',
      });

    expect(override1.status).toBe(200);
    expect(override1.body.override.newTotal).toBe(15);
    expect(override1.body.attempt.status).toBe('FINAL');
    expect(override1.body.attempt.totalScore).toBe(15);
    expect(override1.body.attempt.percentage).toBe(75);
    expect(override1.body.attempt.scoreSource).toBe('MIXED');

    // Second override appends full history without deleting first override
    const override2 = await request(app)
      .post(`/api/v1/grading-results/${GRADING_ID}/override`)
      .set('Cookie', teacherACookie)
      .send({
        criteriaScores: [
          { criterionId: CRIT_1_ID, awarded: 8 },
          { criterionId: CRIT_2_ID, awarded: 5 },
        ],
        note: 'مراجعة ثانية',
      });
    expect(override2.status).toBe(200);
    expect(override2.body.override.newTotal).toBe(13);

    const resolvedQueue = await request(app)
      .get('/api/v1/review-queue?includeResolved=true')
      .set('Cookie', teacherACookie);
    expect(resolvedQueue.body.pendingCount).toBe(0);
    expect(resolvedQueue.body.items[0].overrideHistory).toHaveLength(2);
    expect(resolvedQueue.body.items[0].effectiveTotal).toBe(13);
  });

  it('supports manual grading fallback, image pinning, retranscribe dispatch, and student roster endpoints', async () => {
    // Pin image
    const pinRes = await request(app)
      .patch(`/api/v1/answer-images/${IMG_ID}/pin`)
      .set('Cookie', teacherACookie)
      .send({ pinned: true });
    expect(pinRes.status).toBe(200);
    expect(pinRes.body.image.pinnedByTeacher).toBe(true);

    // Retranscribe enqueue
    const retranscribeRes = await request(app)
      .post(`/api/v1/answers/${ANS_ESSAY_ID}/retranscribe`)
      .set('Cookie', teacherACookie);
    expect(retranscribeRes.status).toBe(202);
    expect(dispatchedJobs).toHaveLength(1);
    expect(dispatchedJobs[0]?.forceRefresh).toBe(true);
    expect(prisma._state.attempts[0]?.status).toBe('GRADING');

    // Remove existing grading results to verify manual grading fallback from zero AI results
    prisma._state.gradingResults.length = 0;
    const manualRes = await request(app)
      .post(`/api/v1/answers/${ANS_ESSAY_ID}/manual-grade`)
      .set('Cookie', teacherACookie)
      .send({
        criteriaScores: [
          { criterionId: CRIT_1_ID, awarded: 9 },
          { criterionId: CRIT_2_ID, awarded: 4 },
        ],
        errorExplanationAr: 'تقييم يدوي مباشر.',
      });
    expect(manualRes.status).toBe(200);
    expect(manualRes.body.override.newTotal).toBe(13);
    expect(manualRes.body.attempt.status).toBe('FINAL');

    // Student roster list & detail
    const rosterRes = await request(app)
      .get('/api/v1/students?search=زياد')
      .set('Cookie', teacherACookie);
    expect(rosterRes.status).toBe(200);
    expect(rosterRes.body.students).toHaveLength(1);
    expect(rosterRes.body.students[0].preTest.totalScore).toBe(13);

    const detailRes = await request(app)
      .get(`/api/v1/students/${STUDENT_ID}`)
      .set('Cookie', teacherACookie);
    expect(rosterRes.status).toBe(200);
    expect(detailRes.status).toBe(200);
    expect(detailRes.body.student.displayName).toBe('زياد طارق');
    expect(detailRes.body.attempts[0].answers).toHaveLength(2);
  });

  it('validates error paths, review filters, and IN_PROGRESS attempt guards', async () => {
    // 1. IN_PROGRESS attempt cannot fetch results
    prisma._state.attempts[0]!.status = 'IN_PROGRESS';
    const inProgRes = await request(app)
      .get(`/api/v1/student/attempts/${ATTEMPT_ID}/results`)
      .set('Cookie', studentCookie);
    expect(inProgRes.status).toBe(409);

    const misreadInProg = await request(app)
      .post(`/api/v1/student/answers/${ANS_ESSAY_ID}/report-misread`)
      .set('Cookie', studentCookie)
      .send({});
    expect(misreadInProg.status).toBe(409);

    // Restore submitted/needs-review state with manual queue filters
    prisma._state.attempts[0]!.status = 'NEEDS_REVIEW';
    prisma._state.gradingResults[0]!.needsReview = true;
    prisma._state.gradingResults[0]!.reviewReasons = ['LOW_CONFIDENCE'];

    const filteredMatch = await request(app)
      .get(`/api/v1/review-queue?topicId=${TOPIC_ID}&cohortId=${COHORT_ID}&reason=LOW_CONFIDENCE`)
      .set('Cookie', teacherACookie);
    expect(filteredMatch.status).toBe(200);
    expect(filteredMatch.body.items).toHaveLength(1);

    const filteredMiss = await request(app)
      .get(`/api/v1/review-queue?topicId=${TOPIC_ID}&reason=INJECTION_ATTEMPT`)
      .set('Cookie', teacherACookie);
    expect(filteredMiss.status).toBe(200);
    expect(filteredMiss.body.items).toHaveLength(0);

    const missingTopicRes = await request(app)
      .get(`/api/v1/review-queue?topicId=00000000-0000-4000-8000-000000000099`)
      .set('Cookie', teacherACookie);
    expect(missingTopicRes.status).toBe(200);
    expect(missingTopicRes.body.items).toHaveLength(0);

    // 2. Invalid override criteria payloads -> 400
    const unknownCrit = await request(app)
      .post(`/api/v1/grading-results/${GRADING_ID}/override`)
      .set('Cookie', teacherACookie)
      .send({
        criteriaScores: [{ criterionId: '00000000-0000-4000-8000-000000000099', awarded: 5 }],
      });
    expect(unknownCrit.status).toBe(400);

    const duplicateCrit = await request(app)
      .post(`/api/v1/grading-results/${GRADING_ID}/override`)
      .set('Cookie', teacherACookie)
      .send({
        criteriaScores: [
          { criterionId: CRIT_1_ID, awarded: 5 },
          { criterionId: CRIT_1_ID, awarded: 5 },
        ],
      });
    expect(duplicateCrit.status).toBe(400);

    const incompleteCrit = await request(app)
      .post(`/api/v1/grading-results/${GRADING_ID}/override`)
      .set('Cookie', teacherACookie)
      .send({
        criteriaScores: [{ criterionId: CRIT_1_ID, awarded: 5 }],
      });
    expect(incompleteCrit.status).toBe(400);

    // 3. MCQ manual-grade / retranscribe / unknown IDs -> 400 or 404
    const mcqManual = await request(app)
      .post(`/api/v1/answers/${ANS_MCQ_ID}/manual-grade`)
      .set('Cookie', teacherACookie)
      .send({ criteriaScores: [{ criterionId: CRIT_1_ID, awarded: 5 }] });
    expect(mcqManual.status).toBe(400);

    const mcqRetranscribe = await request(app)
      .post(`/api/v1/answers/${ANS_MCQ_ID}/retranscribe`)
      .set('Cookie', teacherACookie);
    expect(mcqRetranscribe.status).toBe(400);

    const badImgPin = await request(app)
      .patch(`/api/v1/answer-images/00000000-0000-4000-8000-000000000099/pin`)
      .set('Cookie', teacherACookie)
      .send({ pinned: true });
    expect(badImgPin.status).toBe(404);

    // 4. Student filters with unknown cohortId -> empty list
    const emptyRoster = await request(app)
      .get('/api/v1/students?cohortId=00000000-0000-4000-8000-000000000099')
      .set('Cookie', teacherACookie);
    expect(emptyRoster.status).toBe(200);
    expect(emptyRoster.body.students).toHaveLength(0);
  });

  it('covers GRADING status chips, no-image essay paths, and remaining 404 guards', async () => {
    const missingAttempt = await request(app)
      .get('/api/v1/student/attempts/00000000-0000-4000-8000-000000000099/results')
      .set('Cookie', studentCookie);
    expect(missingAttempt.status).toBe(404);

    const missingMisread = await request(app)
      .post('/api/v1/student/answers/00000000-0000-4000-8000-000000000099/report-misread')
      .set('Cookie', studentCookie)
      .send({});
    expect(missingMisread.status).toBe(404);

    // GRADING status with zero AI results yet shows GRADING chip + scoreHidden
    prisma._state.attempts[0]!.status = 'GRADING';
    prisma._state.gradingResults.length = 0;

    const gradingRes = await request(app)
      .get(`/api/v1/student/attempts/${ATTEMPT_ID}/results`)
      .set('Cookie', studentCookie);
    expect(gradingRes.status).toBe(200);
    expect(gradingRes.body.attempt.scoreHidden).toBe(true);
    expect(gradingRes.body.questions[1].statusChip).toBe('GRADING');

    // Reporting misread when zero AI results exist still flags attempt NEEDS_REVIEW
    const misreadNoAi = await request(app)
      .post(`/api/v1/student/answers/${ANS_ESSAY_ID}/report-misread`)
      .set('Cookie', studentCookie)
      .send({ note: 'مراجعة بدون نتيجة' });
    expect(misreadNoAi.status).toBe(200);
    expect(misreadNoAi.body.attemptStatus).toBe('NEEDS_REVIEW');

    // Retranscribe with zero uploaded images -> 400
    prisma._state.answerImages.length = 0;
    const retranscribeNoImg = await request(app)
      .post(`/api/v1/answers/${ANS_ESSAY_ID}/retranscribe`)
      .set('Cookie', teacherACookie);
    expect(retranscribeNoImg.status).toBe(400);

    // Graded attempt with zero essay images & zero gradingResults -> GRADED 0
    prisma._state.attempts[0]!.status = 'GRADED';
    const noImgGraded = await request(app)
      .get(`/api/v1/student/attempts/${ATTEMPT_ID}/results`)
      .set('Cookie', studentCookie);
    expect(noImgGraded.status).toBe(200);
    expect(noImgGraded.body.questions[1].statusChip).toBe('GRADED');

    // Unknown student detail -> 404, unknown teacher result override -> 404
    const missingStu = await request(app)
      .get('/api/v1/students/00000000-0000-4000-8000-000000000099')
      .set('Cookie', teacherACookie);
    expect(missingStu.status).toBe(404);

    const missingGr = await request(app)
      .post('/api/v1/grading-results/00000000-0000-4000-8000-000000000099/override')
      .set('Cookie', teacherACookie)
      .send({ criteriaScores: [{ criterionId: CRIT_1_ID, awarded: 5 }] });
    expect(missingGr.status).toBe(404);
  });
});
