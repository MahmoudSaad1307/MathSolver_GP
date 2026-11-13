import crypto from 'node:crypto';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { logger } from '../src/lib/logger.js';
import { hashPassword, signTeacherAccessToken } from '../src/lib/security.js';
import { HttpAiServiceClient, type StatsServiceClient } from '../src/services/aiClient.js';
import { sanitizeSpreadsheetCell } from '../src/services/exportService.js';
import { createInMemoryPrisma } from './helpers/fakePrisma.js';
import { createTestEnv } from './helpers/testEnv.js';

function createFakeStatsClient(): {
  client: StatsServiceClient;
  pairedMock: ReturnType<typeof vi.fn>;
  betweenMock: ReturnType<typeof vi.fn>;
} {
  const pairedMock = vi.fn(async (input) => ({
    n: input.pre_scores.length,
    pre_mean: 40,
    pre_sd: 10,
    pre_median: 40,
    pre_iqr: 15,
    post_mean: 80,
    post_sd: 8,
    post_median: 80,
    post_iqr: 10,
    mean_diff: 40,
    sd_diff: 6,
    median_diff: 40,
    shapiro: { statistic: 0.96, p_value: 0.42, normal: true },
    paired_t: { statistic: 7.5, p_value: 0.002, df: Math.max(0, input.pre_scores.length - 1) },
    wilcoxon: { statistic: 0, p_value: 0.015 },
    cohens_dz: { estimate: 1.85, ci_low: 1.1, ci_high: 2.6 },
    hake_gain: { mean_gain: 0.67, per_student_gains: input.pre_scores.map(() => 0.67) },
    outlier_indices: [],
    warnings: ['SMALL_SAMPLE'],
    recommended_test: 'WILCOXON' as const,
    interpretation_ar: 'تحسن ذو دلالة إحصائية بمقدار 40 نقطة.',
    interpretation_en: 'Statistically significant gain of +40 points.',
  }));

  const betweenMock = vi.fn(async (input) => ({
    group_comparison:
      input.treatment_pre.length >= 2 && input.control_pre.length >= 2
        ? {
            treatment_n: input.treatment_pre.length,
            control_n: input.control_pre.length,
            treatment_gain_mean: 40,
            treatment_gain_sd: 5,
            control_gain_mean: 8,
            control_gain_sd: 4,
            welch_t: { statistic: 8.2, p_value: 0.001, df: 3.8 },
            mann_whitney: { statistic: 4, p_value: 0.03 },
            hedges_g: { estimate: 3.1, ci_low: 1.8, ci_high: 4.5 },
            did: {
              estimate: 32,
              se: 3.5,
              t_stat: 9.1,
              p_value: 0.0005,
              ci_low: 25,
              ci_high: 39,
              clustered_by_student: true,
            },
          }
        : null,
    mcnemar: input.twin_question_outcomes.map(
      (item: {
        concept_key: string;
        order_index: number;
        pre_wrong_post_correct: number;
        pre_correct_post_wrong: number;
      }) => ({
        concept_key: item.concept_key,
        order_index: item.order_index,
        b_improved: item.pre_wrong_post_correct,
        c_regressed: item.pre_correct_post_wrong,
        p_value: 0.03125,
        p_adjusted_holm: 0.03125,
        significant: true,
      }),
    ),
    reliability:
      input.reliability_pairs.length > 0
        ? {
            n: input.reliability_pairs.length,
            mae: 0.5,
            exact_agreement_rate: 0.5,
            within_one_agreement_rate: 1.0,
            override_rate: 0.5,
            cohens_kappa: 0.65,
            quadratic_weighted_kappa: 0.85,
          }
        : null,
    warnings: ['SMALL_GROUP_SAMPLE'],
    interpretation_ar: 'فارق جوهري لصالح مجموعة الفيديو.',
    interpretation_en: 'Significant Difference-in-Differences effect favoring the video group.',
  }));

  return {
    client: {
      computePairedStats: pairedMock,
      computeBetweenStats: betweenMock,
    },
    pairedMock,
    betweenMock,
  };
}

describe('Phase 7: Analytics, Statistics Proxy, Exports & AI Cost Usage', () => {
  it('computes paired/between analytics, concept McNemar counts, reliability pairs, usage, and sanitized CSV/XLSX exports', async () => {
    const env = createTestEnv({ AI_DAILY_CAP_USD: 30 });
    const passwordHash = await hashPassword('StrongPass123!');
    const teacher1Id = '11111111-1111-4111-8111-111111111111';
    const teacher2Id = '22222222-2222-4222-8222-222222222222';

    const prisma = createInMemoryPrisma([
      {
        id: teacher1Id,
        email: 'teacher1@mathlens.test',
        passwordHash,
        displayName: 'أستاذ طارق',
        role: 'TEACHER',
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      },
      {
        id: teacher2Id,
        email: 'teacher2@mathlens.test',
        passwordHash,
        displayName: 'أستاذة سارة',
        role: 'TEACHER',
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      },
    ]);

    const tok1 = signTeacherAccessToken(
      { id: teacher1Id, email: 'teacher1@mathlens.test', role: 'TEACHER' },
      env,
    );
    const tok2 = signTeacherAccessToken(
      { id: teacher2Id, email: 'teacher2@mathlens.test', role: 'TEACHER' },
      env,
    );

    const topic = await prisma.topic.create({
      data: {
        ownerId: teacher1Id,
        title: 'التفاضل اللوغاريتمي',
        description: 'شرح التفاضل',
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        videoId: 'dQw4w9WgXcQ',
        minWatchSeconds: 180,
      },
    });
    const m1 = await prisma.examModel.create({
      data: { topicId: topic.id, modelNumber: 1, title: 'M1', totalPoints: 10 },
    });
    const m2 = await prisma.examModel.create({
      data: {
        topicId: topic.id,
        modelNumber: 2,
        title: 'M2',
        totalPoints: 10,
        pairedWithId: m1.id,
      },
    });
    const q1 = await prisma.question.create({
      data: {
        examModelId: m1.id,
        orderIndex: 1,
        conceptKey: 'log-diff',
        type: 'ESSAY',
        promptLatex: '$\\frac{d}{dx}\\ln(x)$',
        points: 10,
      },
    });
    const q2 = await prisma.question.create({
      data: {
        examModelId: m2.id,
        orderIndex: 1,
        conceptKey: 'log-diff',
        type: 'ESSAY',
        promptLatex: '$\\frac{d}{dx}\\ln(2x)$',
        points: 10,
        twinQuestionId: q1.id,
      },
    });

    const treatCohort = await prisma.cohort.create({
      data: {
        topicId: topic.id,
        teacherId: teacher1Id,
        name: 'فصل 3أ',
        joinCode: 'TRT234',
        group: 'TREATMENT',
        requireVideoBeforePost: true,
        showProvisionalScore: true,
        requireWrongSegmentVisits: false,
        postTestOpensAt: null,
      },
    });
    const ctrlCohort = await prisma.cohort.create({
      data: {
        topicId: topic.id,
        teacherId: teacher1Id,
        name: 'فصل 3ب',
        joinCode: 'CTL234',
        group: 'CONTROL',
        requireVideoBeforePost: false,
        showProvisionalScore: true,
        requireWrongSegmentVisits: false,
        postTestOpensAt: new Date(Date.now() - 10_000),
      },
    });

    const seedPairedStudent = async (opts: {
      cohortId: string;
      displayName: string;
      resumeCode: string;
      preScore: number;
      postScore: number;
      preCorrect: boolean;
      postCorrect: boolean;
      overrideTo?: number;
    }) => {
      const s = await prisma.student.create({
        data: {
          cohortId: opts.cohortId,
          displayName: opts.displayName,
          resumeCode: opts.resumeCode,
        },
      });
      const now = new Date();
      prisma._state.videoSessions.push({
        id: crypto.randomUUID(),
        studentId: s.id,
        topicId: topic.id,
        startedAt: now,
        watchedSeconds: 200,
        lastPosition: 200,
        completedAt: now,
        unlockedPostAt: now,
        manualUnlockedById: null,
        createdAt: now,
        updatedAt: now,
      });
      const att1Id = crypto.randomUUID();
      const att2Id = crypto.randomUUID();
      prisma._state.attempts.push(
        {
          id: att1Id,
          studentId: s.id,
          examModelId: m1.id,
          status: 'FINAL',
          startedAt: now,
          submittedAt: now,
          deadlineAt: new Date(now.getTime() + 3_600_000),
          totalScore: opts.preScore,
          maxScore: 10,
          percentage: opts.preScore * 10,
          scoreSource: 'AI',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: att2Id,
          studentId: s.id,
          examModelId: m2.id,
          status: 'FINAL',
          startedAt: now,
          submittedAt: now,
          deadlineAt: new Date(now.getTime() + 3_600_000),
          totalScore: opts.postScore,
          maxScore: 10,
          percentage: opts.postScore * 10,
          scoreSource: opts.overrideTo !== undefined ? 'TEACHER_OVERRIDE' : 'AI',
          createdAt: now,
          updatedAt: now,
        },
      );
      const ans1 = {
        id: crypto.randomUUID(),
        attemptId: att1Id,
        questionId: q1.id,
        selectedOptionId: null,
        isCorrect: opts.preCorrect,
        score: opts.preScore,
        maxScore: 10,
        misreadReportedAt: null,
        misreadNote: null,
        createdAt: now,
        updatedAt: now,
      };
      const ans2 = {
        id: crypto.randomUUID(),
        attemptId: att2Id,
        questionId: q2.id,
        selectedOptionId: null,
        isCorrect: opts.postCorrect,
        score: opts.postScore,
        maxScore: 10,
        misreadReportedAt: null,
        misreadNote: null,
        createdAt: now,
        updatedAt: now,
      };
      prisma._state.answers.push(ans1, ans2);
      const gr = await prisma.gradingResult.create({
        data: {
          answerId: ans2.id,
          version: 1,
          provider: 'groq',
          modelName: 'llama-3.2',
          promptVersion: 'v1',
          rubricVersion: 1,
          imageHash: 'hash',
          transcriptionJson: {},
          gradingJson: {},
          criteriaScores: [],
          aiTotal: opts.overrideTo !== undefined ? opts.postScore - 1 : opts.postScore,
          finalAnswerCorrect: opts.postCorrect,
          firstErrorStep: null,
          errorType: 'NONE',
          errorExplanationAr: 'صحيح',
          hintAr: '',
          confidence: 0.9,
          sympyCheck: {},
          needsReview: opts.overrideTo !== undefined,
          reviewReasons: [],
          rawOutput: '{}',
          latencyMs: 500,
          costUsd: 0.012,
        },
      });
      if (opts.overrideTo !== undefined) {
        await prisma.teacherOverride.create({
          data: {
            gradingResultId: gr.id,
            teacherId: teacher1Id,
            newCriteriaScores: [],
            newTotal: opts.overrideTo,
            newExplanationAr: null,
            note: 'Adjusted method point',
          },
        });
      }
      await prisma.aiUsage.create({
        data: {
          answerId: ans1.id,
          provider: 'groq',
          modelName: 'llama-3.2-90b',
          operation: 'grade_essay',
          inputTokens: 400,
          outputTokens: 150,
          costUsd: 0.015,
          latencyMs: 620,
          success: true,
          errorCode: null,
        },
      });
      await prisma.aiUsage.create({
        data: {
          answerId: ans2.id,
          provider: 'anthropic',
          modelName: 'claude-sonnet',
          operation: 'grade_essay',
          inputTokens: 500,
          outputTokens: 180,
          costUsd: 0.025,
          latencyMs: 910,
          success: false,
          errorCode: 'RATE_LIMIT',
        },
      });
    };

    await seedPairedStudent({
      cohortId: treatCohort.id,
      displayName: '=CMD|calc',
      resumeCode: 'STU111',
      preScore: 3,
      postScore: 9,
      preCorrect: false,
      postCorrect: true,
      overrideTo: 9,
    });
    await seedPairedStudent({
      cohortId: treatCohort.id,
      displayName: 'مريم حسن',
      resumeCode: 'STU222',
      preScore: 4,
      postScore: 8,
      preCorrect: false,
      postCorrect: true,
    });
    await seedPairedStudent({
      cohortId: ctrlCohort.id,
      displayName: 'علي محمود',
      resumeCode: 'STU333',
      preScore: 4,
      postScore: 5,
      preCorrect: false,
      postCorrect: false,
    });
    await seedPairedStudent({
      cohortId: ctrlCohort.id,
      displayName: 'نور سعيد',
      resumeCode: 'STU444',
      preScore: 5,
      postScore: 6,
      preCorrect: true,
      postCorrect: false,
    });

    // Add unrelated AiUsage for teacher2 that must never leak to teacher1
    await prisma.aiUsage.create({
      data: {
        answerId: '99999999-9999-4999-8999-999999999999',
        provider: 'groq',
        modelName: 'other',
        operation: 'grade_essay',
        inputTokens: 1000,
        outputTokens: 500,
        costUsd: 9.99,
        latencyMs: 1200,
        success: true,
        errorCode: null,
      },
    });

    const statsMock = createFakeStatsClient();
    const app = createApp({
      env,
      prisma,
      logger,
      statsClient: statsMock.client,
    });

    // Analytics overview
    const analyticsRes = await request(app)
      .get('/api/v1/analytics')
      .set('Authorization', `Bearer ${tok1}`);
    expect(analyticsRes.status).toBe(200);
    expect(analyticsRes.body.summary.totalStudents).toBe(4);
    expect(analyticsRes.body.summary.pairedStudents).toBe(4);
    expect(analyticsRes.body.summary.treatmentPairedCount).toBe(2);
    expect(analyticsRes.body.summary.controlPairedCount).toBe(2);
    expect(analyticsRes.body.summary.totalEssayGraded).toBe(4);
    expect(analyticsRes.body.summary.totalOverrides).toBe(1);
    expect(analyticsRes.body.cohorts).toHaveLength(2);
    expect(analyticsRes.body.concepts).toHaveLength(1);
    expect(analyticsRes.body.concepts[0].preWrongPostCorrect).toBe(2);
    expect(analyticsRes.body.concepts[0].preCorrectPostWrong).toBe(1);
    expect(analyticsRes.body.formalStats.paired.recommended_test).toBe('WILCOXON');
    expect(analyticsRes.body.formalStats.between.group_comparison.did.estimate).toBe(32);
    expect(statsMock.pairedMock).toHaveBeenCalledTimes(1);
    expect(statsMock.betweenMock).toHaveBeenCalledTimes(1);

    // Filtered analytics by cohortId
    const filteredRes = await request(app)
      .get(`/api/v1/analytics?topicId=${topic.id}&cohortId=${treatCohort.id}`)
      .set('Authorization', `Bearer ${tok1}`);
    expect(filteredRes.status).toBe(200);
    expect(filteredRes.body.cohorts).toHaveLength(1);
    expect(filteredRes.body.summary.totalStudents).toBe(2);

    // Cross-tenant isolation on analytics + exports
    const crossAnalytics = await request(app)
      .get(`/api/v1/analytics?topicId=${topic.id}`)
      .set('Authorization', `Bearer ${tok2}`);
    expect(crossAnalytics.status).toBe(404);

    const crossCsv = await request(app)
      .get(`/api/v1/cohorts/${treatCohort.id}/export.csv`)
      .set('Authorization', `Bearer ${tok2}`);
    expect(crossCsv.status).toBe(404);

    // Empty analytics for teacher 2
    const emptyAnalytics = await request(app)
      .get('/api/v1/analytics')
      .set('Authorization', `Bearer ${tok2}`);
    expect(emptyAnalytics.status).toBe(200);
    expect(emptyAnalytics.body.summary.totalStudents).toBe(0);

    // Usage endpoint (excludes teacher 2's $9.99 record from teacher1's breakdown)
    const usageRes = await request(app)
      .get('/api/v1/usage?days=30')
      .set('Authorization', `Bearer ${tok1}`);
    expect(usageRes.status).toBe(200);
    expect(usageRes.body.dailyCapUsd).toBe(env.AI_DAILY_CAP_USD);
    expect(usageRes.body.summary.totalCalls).toBe(8);
    expect(usageRes.body.summary.successCalls).toBe(4);
    expect(usageRes.body.summary.failedCalls).toBe(4);
    expect(usageRes.body.summary.totalCostUsd).toBeCloseTo(0.16, 4);
    expect(usageRes.body.breakdown).toHaveLength(2);

    // Teacher 2 has zero usage calls for their own cohorts
    const emptyUsage = await request(app)
      .get('/api/v1/usage?days=7')
      .set('Authorization', `Bearer ${tok2}`);
    expect(emptyUsage.status).toBe(200);
    expect(emptyUsage.body.summary.totalCalls).toBe(0);

    // CSV Export with UTF-8 BOM + formula injection neutralization
    const csvRes = await request(app)
      .get(`/api/v1/cohorts/${treatCohort.id}/export.csv`)
      .set('Authorization', `Bearer ${tok1}`);
    expect(csvRes.status).toBe(200);
    expect(csvRes.headers['content-type']).toContain('text/csv');
    expect(csvRes.text.startsWith('\uFEFF')).toBe(true);
    expect(csvRes.text).toContain("'=CMD|calc");
    expect(csvRes.text).toContain('مريم حسن');

    // XLSX Export multi-sheet validation + formula injection neutralization
    const xlsxRes = await request(app)
      .get(`/api/v1/cohorts/${treatCohort.id}/export.xlsx`)
      .set('Authorization', `Bearer ${tok1}`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(xlsxRes.status).toBe(200);
    expect(xlsxRes.headers['content-type']).toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsxRes.body as Buffer);
    expect(wb.worksheets.map((ws) => ws.name)).toEqual([
      'Summary',
      'Students',
      'Questions',
      'Concepts',
      'Reviews & Overrides',
    ]);
    const stuSheet = wb.getWorksheet('Students')!;
    const studentNamesInSheet = [
      String(stuSheet.getRow(2).getCell(1).value ?? ''),
      String(stuSheet.getRow(3).getCell(1).value ?? ''),
    ];
    expect(studentNamesInSheet).toContain("'=CMD|calc");
    expect(studentNamesInSheet).toContain('مريم حسن');
  });

  it('handles stats service outage gracefully and sends HTTP stats requests with X-Internal-Key', async () => {
    const env = createTestEnv();
    const passwordHash = await hashPassword('StrongPass123!');
    const teacherId = '11111111-1111-4111-8111-111111111111';
    const prisma = createInMemoryPrisma([
      {
        id: teacherId,
        email: 'teacher@mathlens.test',
        passwordHash,
        displayName: 'T',
        role: 'TEACHER',
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      },
    ]);
    const tok = signTeacherAccessToken(
      { id: teacherId, email: 'teacher@mathlens.test', role: 'TEACHER' },
      env,
    );

    const topic = await prisma.topic.create({
      data: {
        ownerId: teacherId,
        title: 'T1',
        description: 'D1',
        videoUrl: 'https://youtu.be/dQw4w9WgXcQ',
        videoId: 'dQw4w9WgXcQ',
        minWatchSeconds: 120,
      },
    });
    const m1 = await prisma.examModel.create({
      data: { topicId: topic.id, modelNumber: 1, title: 'M1', totalPoints: 10 },
    });
    const m2 = await prisma.examModel.create({
      data: { topicId: topic.id, modelNumber: 2, title: 'M2', totalPoints: 10 },
    });
    const coh = await prisma.cohort.create({
      data: {
        topicId: topic.id,
        teacherId,
        name: 'C1',
        joinCode: 'ABC234',
        group: 'TREATMENT',
        requireVideoBeforePost: true,
        showProvisionalScore: true,
        requireWrongSegmentVisits: false,
        postTestOpensAt: null,
      },
    });
    const stu = await prisma.student.create({
      data: { cohortId: coh.id, displayName: 'Student A', resumeCode: 'RES123' },
    });
    const now = new Date();
    prisma._state.attempts.push(
      {
        id: crypto.randomUUID(),
        studentId: stu.id,
        examModelId: m1.id,
        status: 'FINAL',
        startedAt: now,
        submittedAt: now,
        deadlineAt: new Date(now.getTime() + 3_600_000),
        totalScore: 5,
        maxScore: 10,
        percentage: 50,
        scoreSource: 'AI',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: crypto.randomUUID(),
        studentId: stu.id,
        examModelId: m2.id,
        status: 'FINAL',
        startedAt: now,
        submittedAt: now,
        deadlineAt: new Date(now.getTime() + 3_600_000),
        totalScore: 8,
        maxScore: 10,
        percentage: 80,
        scoreSource: 'AI',
        createdAt: now,
        updatedAt: now,
      },
    );

    const failingStatsClient: StatsServiceClient = {
      computePairedStats: async () => {
        throw new Error('AI down');
      },
      computeBetweenStats: async () => {
        throw new Error('AI down');
      },
    };
    const app = createApp({ env, prisma, logger, statsClient: failingStatsClient });

    const res = await request(app).get('/api/v1/analytics').set('Authorization', `Bearer ${tok}`);
    expect(res.status).toBe(200);
    expect(res.body.formalStats.statsUnavailable).toBe(true);
    expect(res.body.formalStats.statsError).toContain('AI down');

    // Direct test of sanitizeSpreadsheetCell & HttpAiServiceClient stats methods
    expect(sanitizeSpreadsheetCell('=1+1')).toBe("'=1+1");
    expect(sanitizeSpreadsheetCell('+SUM(A1)')).toBe("'+SUM(A1)");
    expect(sanitizeSpreadsheetCell('-5')).toBe("'-5");
    expect(sanitizeSpreadsheetCell('@cmd')).toBe("'@cmd");
    expect(sanitizeSpreadsheetCell(42)).toBe(42);
    expect(sanitizeSpreadsheetCell(null)).toBe('');

    const origFetch = globalThis.fetch;
    try {
      const fetchSpy = vi.fn(
        async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
      globalThis.fetch = fetchSpy as unknown as typeof fetch;
      const client = new HttpAiServiceClient(env);
      await client.computePairedStats({ pre_scores: [50], post_scores: [80] });
      await client.computeBetweenStats({
        treatment_pre: [],
        treatment_post: [],
        control_pre: [],
        control_post: [],
        twin_question_outcomes: [],
        reliability_pairs: [],
      });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(String(fetchSpy.mock.calls[0]?.[0])).toContain('/v1/stats/paired');
      expect(String(fetchSpy.mock.calls[1]?.[0])).toContain('/v1/stats/between');
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
