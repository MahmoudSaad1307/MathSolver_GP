import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadEnv } from '../src/config/env.js';
import { createLogger } from '../src/lib/logger.js';
import {
  HttpAiServiceClient,
  type AiGradeEssayResponse,
  type AiServiceClient,
} from '../src/services/aiClient.js';
import { parseRedisConnectionOptions } from '../src/services/gradingDispatcher.js';
import {
  boundAndRecomputeCriteriaScores,
  computeAttemptRollup,
  GradingOrchestrator,
} from '../src/services/gradingOrchestrator.js';
import { LocalDiskStorageAdapter } from '../src/services/storage/localStorage.js';
import { createInMemoryPrisma } from './helpers/fakePrisma.js';

function testEnv(overrides: Record<string, string | undefined> = {}) {
  return loadEnv({
    DATABASE_URL: 'postgresql://mathlens:mathlens@localhost:5432/mathlens_test',
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    JWT_REFRESH_SECRET: 'b'.repeat(32),
    STUDENT_JWT_SECRET: 'c'.repeat(32),
    VIDEO_UNLOCK_HMAC_SECRET: 'd'.repeat(32),
    IP_HASH_SALT: 'e'.repeat(16),
    AI_INTERNAL_KEY: 'f'.repeat(16),
    LOG_LEVEL: 'silent',
    ...overrides,
  });
}

function seedEssayFixture() {
  const prisma = createInMemoryPrisma();
  const now = new Date();
  const topicId = '11111111-1111-4111-8111-111111111111';
  const modelId = '22222222-2222-4222-8222-222222222222';
  const q1Id = '33333333-3333-4333-8333-333333333331';
  const q2Id = '33333333-3333-4333-8333-333333333332';
  const studentId = '44444444-4444-4444-8444-444444444444';
  const attemptId = '55555555-5555-4555-8555-555555555555';
  const ans1Id = '66666666-6666-4666-8666-666666666661';
  const ans2Id = '66666666-6666-4666-8666-666666666662';
  const storageKey = 'attempts/sample.jpg';

  prisma._state.topics.push({
    id: topicId,
    ownerId: '99999999-9999-4999-8999-999999999999',
    title: 'Derivatives',
    description: 'Calculus',
    videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    videoId: 'dQw4w9WgXcQ',
    minWatchSeconds: 300,
    correctnessThreshold: 0.6,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });
  prisma._state.examModels.push({
    id: modelId,
    topicId,
    modelNumber: 1,
    title: 'Model 1',
    durationMinutes: 60,
    totalPoints: 20,
    status: 'PUBLISHED',
    pairedWithId: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });
  prisma._state.questions.push(
    {
      id: q1Id,
      examModelId: modelId,
      orderIndex: 1,
      conceptKey: 'mcq-rule',
      type: 'MCQ',
      promptLatex: 'MCQ?',
      points: 5,
      videoTimestampSeconds: 30,
      needsTeacherConfirmation: false,
      teacherConfirmedAt: now,
      twinQuestionId: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    },
    {
      id: q2Id,
      examModelId: modelId,
      orderIndex: 2,
      conceptKey: 'exp-tangent',
      type: 'ESSAY',
      promptLatex: 'Find slope of $y=e^{2x}$ at $0$.',
      points: 15,
      videoTimestampSeconds: 95,
      needsTeacherConfirmation: false,
      teacherConfirmedAt: now,
      twinQuestionId: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    },
  );
  prisma._state.modelAnswers.push({
    id: '77777777-7777-4777-8777-777777777777',
    questionId: q2Id,
    solutionStepsLatex: ["$y'=2e^{2x}$", "$y'(0)=2$"],
    finalAnswerLatex: '2',
    finalAnswerSympy: '2',
    commonMistakes: 'Missing chain factor',
    rubricVersion: 1,
    createdAt: now,
    updatedAt: now,
  });
  prisma._state.rubricCriteria.push(
    {
      id: '88888888-8888-4888-8888-888888888881',
      questionId: q2Id,
      orderIndex: 1,
      key: 'rule',
      descriptionEn: 'Derivative rule',
      descriptionAr: 'قاعدة الاشتقاق',
      maxPoints: 10,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    },
    {
      id: '88888888-8888-4888-8888-888888888882',
      questionId: q2Id,
      orderIndex: 2,
      key: 'eval',
      descriptionEn: 'Final value',
      descriptionAr: 'القيمة النهائية',
      maxPoints: 5,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    },
  );
  prisma._state.attempts.push({
    id: attemptId,
    studentId,
    examModelId: modelId,
    status: 'GRADING',
    startedAt: now,
    submittedAt: now,
    deadlineAt: new Date(now.getTime() + 3600_000),
    totalScore: null,
    maxScore: 20,
    percentage: null,
    scoreSource: null,
    createdAt: now,
    updatedAt: now,
  });
  prisma._state.answers.push(
    {
      id: ans1Id,
      attemptId,
      questionId: q1Id,
      selectedOptionId: 'opt-a',
      isCorrect: true,
      score: 5,
      maxScore: 5,
      misreadReportedAt: null,
      misreadNote: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: ans2Id,
      attemptId,
      questionId: q2Id,
      selectedOptionId: null,
      isCorrect: null,
      score: null,
      maxScore: 15,
      misreadReportedAt: null,
      misreadNote: null,
      createdAt: now,
      updatedAt: now,
    },
  );
  prisma._state.answerImages.push({
    id: '99999999-1111-4111-8111-999999999999',
    answerId: ans2Id,
    storageKey,
    sha256: 'abc123',
    width: 800,
    height: 600,
    bytes: 1200,
    pinnedByTeacher: false,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  });

  return { prisma, studentId, attemptId, ans2Id, storageKey };
}

function makeFakeAiResponse(overrides: Partial<AiGradeEssayResponse> = {}): AiGradeEssayResponse {
  return {
    provider: 'fake',
    modelName: 'fake-grader-v1',
    promptVersion: 'transcribe.v1+grade.v1',
    rubricVersion: 1,
    imageHash: 'hash1',
    transcription: {
      lines: [
        {
          lineNumber: 1,
          textLatex: "y'=2e^{2x}",
          confidence: 0.96,
          hasUnsure: false,
          illegible: false,
          crossedOut: false,
        },
      ],
      fullTranscriptionLatex: "y'=2e^{2x}",
      finalAnswerLatex: '2',
      overallConfidence: 0.96,
      illegibleRatio: 0,
      containsUnsureToken: false,
      injectionDetected: false,
      injectionSignals: [],
      rawModelOutput: '{}',
      preprocessWarnings: [],
      provider: 'fake',
      modelName: 'fake-vision-v1',
      promptVersion: 'transcribe.v1',
      inputTokens: 100,
      outputTokens: 60,
      costUsd: 0.001,
      latencyMs: 50,
    },
    criteriaScores: [
      {
        criterionKey: 'rule',
        awardedPoints: 10,
        maxPoints: 10,
        met: true,
        evidenceStep: 1,
        commentAr: 'ممتاز',
      },
      {
        criterionKey: 'eval',
        awardedPoints: 5,
        maxPoints: 5,
        met: true,
        evidenceStep: 2,
        commentAr: 'دقيق',
      },
    ],
    aiTotal: 15,
    maxPoints: 15,
    finalAnswerCorrect: true,
    firstErrorStep: null,
    errorType: 'none',
    errorExplanationAr: 'الحل صحيح بالكامل.',
    hintAr: 'أحسنت.',
    confidence: 0.95,
    sympyCheck: {
      checked: true,
      status: 'EQUIVALENT',
      studentFinalSympy: '2',
      expectedFinalSympy: '2',
      equivalent: true,
      detail: 'Identical',
    },
    needsReview: false,
    reviewReasons: [],
    rawOutput: '{}',
    latencyMs: 180,
    costUsd: 0.004,
    inputTokens: 300,
    outputTokens: 150,
    schemaRetryUsed: false,
    cached: false,
    ...overrides,
  };
}

describe('Phase 4 AI Grading Orchestrator, Guardrails, Caps & Rollup', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
  });

  it('parses Redis connection URLs and clamps criterion scores strictly on server', () => {
    const conn = parseRedisConnectionOptions('redis://:secret@redis.internal:6380/2');
    expect(conn).toMatchObject({ host: 'redis.internal', port: 6380, password: 'secret', db: 2 });

    const bounded = boundAndRecomputeCriteriaScores(
      [
        {
          criterionKey: 'rule',
          awardedPoints: 18,
          maxPoints: 10,
          met: true,
          evidenceStep: 1,
          commentAr: '',
        },
        {
          criterionKey: 'eval',
          awardedPoints: -2,
          maxPoints: 5,
          met: false,
          evidenceStep: 2,
          commentAr: '',
        },
      ],
      [
        { key: 'rule', maxPoints: 10 },
        { key: 'eval', maxPoints: 5 },
      ],
    );
    expect(bounded.cappedMismatch).toBe(true);
    expect(bounded.recomputedTotal).toBe(10);
    expect(bounded.boundedScores.map((s) => s.awardedPoints)).toEqual([10, 0]);
  });

  it('persists GradingResult + AiUsage, computes server total, and rolls up Attempt status', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ml-grade-'));
    tempDirs.push(tmpDir);
    const storage = new LocalDiskStorageAdapter(tmpDir, 'http://localhost', 's'.repeat(32));
    const { prisma, studentId, attemptId, ans2Id, storageKey } = seedEssayFixture();
    await storage.putObject(storageKey, Buffer.from('fakejpegdata'), 'image/jpeg');

    const aiClient: AiServiceClient = {
      gradeEssay: vi.fn().mockResolvedValue(
        makeFakeAiResponse({
          // Simulate over-cap attempt from AI response to confirm Node-side defense-in-depth
          criteriaScores: [
            {
              criterionKey: 'rule',
              awardedPoints: 14,
              maxPoints: 10,
              met: true,
              evidenceStep: 1,
              commentAr: 'ok',
            },
            {
              criterionKey: 'eval',
              awardedPoints: 5,
              maxPoints: 5,
              met: true,
              evidenceStep: 2,
              commentAr: 'ok',
            },
          ],
          aiTotal: 19,
        }),
      ),
      transcribeOnly: vi.fn(),
    };

    const orch = new GradingOrchestrator(
      prisma,
      testEnv(),
      storage,
      aiClient,
      createLogger('silent'),
    );
    const out = await orch.processEssayGradingJob({ attemptId, answerId: ans2Id, studentId });

    expect(out.needsReview).toBe(true);
    expect(out.attemptStatus).toBe('NEEDS_REVIEW');
    expect(prisma._state.gradingResults).toHaveLength(1);
    expect(prisma._state.gradingResults[0]?.aiTotal).toBe(15);
    expect(prisma._state.gradingResults[0]?.reviewReasons).toContain('TOTAL_MISMATCH');
    expect(prisma._state.aiUsages).toHaveLength(1);
    expect(prisma._state.aiUsages[0]?.success).toBe(true);
    expect(prisma._state.attempts[0]?.totalScore).toBe(20);
    expect(prisma._state.attempts[0]?.scoreSource).toBe('MIXED');
  });

  it('routes to human review when daily USD or per-student daily cap is exceeded', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ml-cap-'));
    tempDirs.push(tmpDir);
    const storage = new LocalDiskStorageAdapter(tmpDir, 'http://localhost', 's'.repeat(32));
    const { prisma, studentId, attemptId, ans2Id, storageKey } = seedEssayFixture();
    await storage.putObject(storageKey, Buffer.from('fakejpegdata'), 'image/jpeg');

    // Already hit $10 daily cap
    prisma._state.aiUsages.push({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      answerId: ans2Id,
      provider: 'anthropic',
      modelName: 'claude-sonnet-4',
      operation: 'grade-essay',
      inputTokens: 1000,
      outputTokens: 500,
      costUsd: 10.5,
      latencyMs: 1200,
      success: true,
      errorCode: null,
      createdAt: new Date(),
    });

    const aiClient: AiServiceClient = {
      gradeEssay: vi.fn(),
      transcribeOnly: vi.fn(),
    };

    const orch = new GradingOrchestrator(
      prisma,
      testEnv({ AI_DAILY_CAP_USD: '10' }),
      storage,
      aiClient,
      createLogger('silent'),
    );
    const out = await orch.processEssayGradingJob({ attemptId, answerId: ans2Id, studentId });

    expect(aiClient.gradeEssay).not.toHaveBeenCalled();
    expect(out.needsReview).toBe(true);
    expect(out.attemptStatus).toBe('NEEDS_REVIEW');
    expect(prisma._state.gradingResults[0]?.provider).toBe('fallback');
    expect(prisma._state.gradingResults[0]?.reviewReasons).toEqual(['AI_SERVICE_FAILED']);
  });

  it('sends X-Internal-Key header cleanly in HttpAiServiceClient and handles rollup variants', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(makeFakeAiResponse()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const client = new HttpAiServiceClient(testEnv({ AI_SERVICE_URL: 'http://ai.local:8000' }));
    const res = await client.gradeEssay({
      questionPromptLatex: 'Q',
      modelAnswer: {
        solutionStepsLatex: ['s'],
        finalAnswerLatex: '2',
        finalAnswerSympy: '2',
        commonMistakes: '',
      },
      rubricCriteria: [{ key: 'rule', descriptionEn: 'r', descriptionAr: 'ر', maxPoints: 5 }],
      images: [{ dataBase64: 'abc', mimeType: 'image/jpeg', sha256: '123' }],
      rubricVersion: 1,
    });

    expect(res.aiTotal).toBe(15);
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://ai.local:8000/v1/grade-essay',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-Internal-Key': 'f'.repeat(16) }),
      }),
    );

    const pendingRollup = computeAttemptRollup({
      id: 'att1',
      maxScore: 20,
      answers: [
        {
          id: 'a1',
          score: 5,
          maxScore: 5,
          question: { type: 'MCQ' },
          images: [],
          gradingResults: [],
        },
        {
          id: 'a2',
          score: null,
          maxScore: 15,
          question: { type: 'ESSAY' },
          images: [{ id: 'img1' }],
          gradingResults: [],
        },
      ],
    });
    expect(pendingRollup.allReady).toBe(false);
    expect(pendingRollup.status).toBe('GRADING');
  });
});
