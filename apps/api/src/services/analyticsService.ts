import type { PrismaClient } from '@prisma/client';
import type { AnalyticsQueryInput } from '@mathlens/shared';
import type { AppEnv } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import { scopedCohortWhere, scopedTopicWhere } from '../lib/scoping.js';
import type {
  BetweenStatsResponsePayload,
  PairedStatsResponsePayload,
  StatsServiceClient,
} from './aiClient.js';

const SCORED_STATUSES = new Set(['GRADED', 'NEEDS_REVIEW', 'FINAL']);

export interface AnalyticsCohortRow {
  id: string;
  name: string;
  group: string;
  topicId: string;
  topicTitle: string;
  studentsCount: number;
  preCompletedCount: number;
  postCompletedCount: number;
  pairedCount: number;
  preAvgPct: number | null;
  postAvgPct: number | null;
  deltaPct: number | null;
  hakeGain: number | null;
  avgWatchedSeconds: number;
}

export interface AnalyticsConceptRow {
  conceptKey: string;
  preCount: number;
  postCount: number;
  preAvgPct: number;
  postAvgPct: number;
  deltaPct: number;
  preWrongPostCorrect: number;
  preCorrectPostWrong: number;
  bothCorrect: number;
  bothWrong: number;
}

export interface AnalyticsQuestionRow {
  conceptKey: string;
  orderIndex: number;
  preQuestionId: string;
  postQuestionId: string | null;
  preAvgPct: number;
  postAvgPct: number | null;
  deltaPct: number | null;
  preCorrectRate: number;
  postCorrectRate: number | null;
}

export interface AnalyticsDistributionBucket {
  rangeLabel: string;
  preCount: number;
  postCount: number;
}

export interface AnalyticsResponse {
  filters: {
    topicId: string | null;
    cohortId: string | null;
  };
  topics: Array<{ id: string; title: string }>;
  cohorts: AnalyticsCohortRow[];
  summary: {
    totalStudents: number;
    pairedStudents: number;
    treatmentPairedCount: number;
    controlPairedCount: number;
    preMeanPct: number | null;
    postMeanPct: number | null;
    deltaMeanPct: number | null;
    hakeMeanGain: number | null;
    totalEssayGraded: number;
    totalOverrides: number;
    overrideRate: number;
  };
  concepts: AnalyticsConceptRow[];
  questions: AnalyticsQuestionRow[];
  distributions: AnalyticsDistributionBucket[];
  formalStats: {
    pairedScope: 'TREATMENT' | 'ALL';
    paired: PairedStatsResponsePayload | null;
    between: BetweenStatsResponsePayload | null;
    statsUnavailable: boolean;
    statsError: string | null;
  };
}

export interface UsageDailyRow {
  date: string;
  calls: number;
  successCalls: number;
  costUsd: number;
  avgLatencyMs: number;
}

export interface UsageBreakdownRow {
  provider: string;
  modelName: string;
  operation: string;
  calls: number;
  successRate: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  avgLatencyMs: number;
}

export interface UsageResponse {
  days: number;
  dailyCapUsd: number;
  todayCostUsd: number;
  capRemainingUsd: number;
  summary: {
    totalCalls: number;
    successCalls: number;
    failedCalls: number;
    totalCostUsd: number;
    avgLatencyMs: number;
    p95LatencyMs: number;
    totalInputTokens: number;
    totalOutputTokens: number;
  };
  daily: UsageDailyRow[];
  breakdown: UsageBreakdownRow[];
  recentCalls: Array<{
    id: string;
    provider: string;
    modelName: string;
    operation: string;
    costUsd: number;
    latencyMs: number;
    success: boolean;
    errorCode: string | null;
    createdAt: string;
  }>;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function mean(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((acc, x) => acc + x, 0) / nums.length;
}

function buildBuckets(preScores: number[], postScores: number[]): AnalyticsDistributionBucket[] {
  const ranges: Array<[string, number, number]> = [
    ['0-24%', 0, 25],
    ['25-49%', 25, 50],
    ['50-74%', 50, 75],
    ['75-100%', 75, 100.01],
  ];
  return ranges.map(([label, min, max]) => ({
    rangeLabel: label,
    preCount: preScores.filter((v) => v >= min && v < max).length,
    postCount: postScores.filter((v) => v >= min && v < max).length,
  }));
}

/** Computes aggregated cohort/concept analytics and invokes formal statistical tests. */
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly env: AppEnv,
    private readonly statsClient: StatsServiceClient,
  ) {}

  async getAnalytics(teacherId: string, filters: AnalyticsQueryInput): Promise<AnalyticsResponse> {
    if (filters.topicId) {
      const ownedTopic = await this.prisma.topic.findFirst({
        where: { id: filters.topicId, ...scopedTopicWhere(teacherId) },
      });
      if (!ownedTopic) throw new AppError('NOT_FOUND');
    }
    if (filters.cohortId) {
      const ownedCohort = await this.prisma.cohort.findFirst({
        where: { id: filters.cohortId, ...scopedCohortWhere(teacherId) },
      });
      if (!ownedCohort) throw new AppError('NOT_FOUND');
    }

    const allTopics = await this.prisma.topic.findMany({
      where: scopedTopicWhere(teacherId),
    });
    const scopedTopics = filters.topicId
      ? allTopics.filter((t) => t.id === filters.topicId)
      : allTopics;
    const topicTitleById = new Map(allTopics.map((t) => [t.id, t.title]));

    const rawCohorts = await this.prisma.cohort.findMany({
      where: {
        ...scopedCohortWhere(teacherId),
        ...(filters.topicId ? { topicId: filters.topicId } : {}),
        ...(filters.cohortId ? { id: filters.cohortId } : {}),
      },
    });
    const cohorts = filters.cohortId
      ? rawCohorts.filter((c) => c.id === filters.cohortId)
      : rawCohorts;

    const emptyResponse: AnalyticsResponse = {
      filters: { topicId: filters.topicId ?? null, cohortId: filters.cohortId ?? null },
      topics: allTopics.map((t) => ({ id: t.id, title: t.title })),
      cohorts: cohorts.map((c) => ({
        id: c.id,
        name: c.name,
        group: c.group,
        topicId: c.topicId,
        topicTitle: topicTitleById.get(c.topicId) ?? '',
        studentsCount: 0,
        preCompletedCount: 0,
        postCompletedCount: 0,
        pairedCount: 0,
        preAvgPct: null,
        postAvgPct: null,
        deltaPct: null,
        hakeGain: null,
        avgWatchedSeconds: 0,
      })),
      summary: {
        totalStudents: 0,
        pairedStudents: 0,
        treatmentPairedCount: 0,
        controlPairedCount: 0,
        preMeanPct: null,
        postMeanPct: null,
        deltaMeanPct: null,
        hakeMeanGain: null,
        totalEssayGraded: 0,
        totalOverrides: 0,
        overrideRate: 0,
      },
      concepts: [],
      questions: [],
      distributions: buildBuckets([], []),
      formalStats: {
        pairedScope: 'ALL',
        paired: null,
        between: null,
        statsUnavailable: false,
        statsError: null,
      },
    };

    if (cohorts.length === 0 || scopedTopics.length === 0) {
      return emptyResponse;
    }

    const cohortIds = cohorts.map((c) => c.id);
    const topicIds = scopedTopics.map((t) => t.id);
    const examModels = await this.prisma.examModel.findMany({
      where: { topicId: { in: topicIds }, deletedAt: null },
    });
    const modelIds = examModels.map((m) => m.id);
    const modelById = new Map(examModels.map((m) => [m.id, m]));

    const questions =
      modelIds.length > 0
        ? await this.prisma.question.findMany({
            where: { examModelId: { in: modelIds }, deletedAt: null },
          })
        : [];
    const questionById = new Map(questions.map((q) => [q.id, q]));

    const students = await this.prisma.student.findMany({
      where: { cohortId: { in: cohortIds }, deletedAt: null },
    });
    if (students.length === 0) {
      return emptyResponse;
    }

    const studentIds = students.map((s) => s.id);
    const [attempts, videoSessions] = await Promise.all([
      this.prisma.attempt.findMany({ where: { studentId: { in: studentIds } } }),
      this.prisma.videoSession.findMany({ where: { studentId: { in: studentIds } } }),
    ]);

    const attemptIds = attempts.map((a) => a.id);
    const answers =
      attemptIds.length > 0
        ? await this.prisma.answer.findMany({ where: { attemptId: { in: attemptIds } } })
        : [];
    const answerIds = answers.map((a) => a.id);

    const gradingResults =
      answerIds.length > 0
        ? await this.prisma.gradingResult.findMany({ where: { answerId: { in: answerIds } } })
        : [];
    const latestGrByAnswer = new Map<string, (typeof gradingResults)[number]>();
    for (const gr of gradingResults) {
      const prev = latestGrByAnswer.get(gr.answerId);
      if (!prev || gr.version > prev.version) {
        latestGrByAnswer.set(gr.answerId, gr);
      }
    }

    const grIds = Array.from(latestGrByAnswer.values()).map((g) => g.id);
    const overrides =
      grIds.length > 0
        ? await this.prisma.teacherOverride.findMany({
            where: { gradingResultId: { in: grIds } },
            orderBy: { createdAt: 'desc' },
          })
        : [];
    const latestOverrideByGr = new Map<string, (typeof overrides)[number]>();
    for (const ov of overrides) {
      if (!latestOverrideByGr.has(ov.gradingResultId)) {
        latestOverrideByGr.set(ov.gradingResultId, ov);
      }
    }

    const attemptByStudentModel = new Map<string, (typeof attempts)[number]>();
    for (const att of attempts) {
      const model = modelById.get(att.examModelId);
      if (!model) continue;
      attemptByStudentModel.set(`${att.studentId}:${model.modelNumber}`, att);
    }

    const answersByAttempt = new Map<string, Array<(typeof answers)[number]>>();
    for (const ans of answers) {
      const list = answersByAttempt.get(ans.attemptId) ?? [];
      list.push(ans);
      answersByAttempt.set(ans.attemptId, list);
    }

    const cohortById = new Map(cohorts.map((c) => [c.id, c]));
    const videoByStudent = new Map<string, number>();
    for (const vs of videoSessions) {
      videoByStudent.set(vs.studentId, (videoByStudent.get(vs.studentId) ?? 0) + vs.watchedSeconds);
    }

    const treatmentPre: number[] = [];
    const treatmentPost: number[] = [];
    const controlPre: number[] = [];
    const controlPost: number[] = [];
    const allPre: number[] = [];
    const allPost: number[] = [];
    const pairedHake: number[] = [];

    const cohortMetrics = new Map<
      string,
      {
        studentsCount: number;
        preScores: number[];
        postScores: number[];
        deltas: number[];
        hake: number[];
        watchedSeconds: number[];
      }
    >();
    for (const c of cohorts) {
      cohortMetrics.set(c.id, {
        studentsCount: 0,
        preScores: [],
        postScores: [],
        deltas: [],
        hake: [],
        watchedSeconds: [],
      });
    }

    // Paired twin counts per (conceptKey + orderIndex)
    const twinOutcomeMap = new Map<
      string,
      {
        conceptKey: string;
        orderIndex: number;
        preQuestionId: string;
        postQuestionId: string | null;
        prePcts: number[];
        postPcts: number[];
        preCorrectCount: number;
        postCorrectCount: number;
        preWrongPostCorrect: number;
        preCorrectPostWrong: number;
        bothCorrect: number;
        bothWrong: number;
      }
    >();

    for (const stu of students) {
      const cohort = cohortById.get(stu.cohortId);
      if (!cohort) continue;
      const cm = cohortMetrics.get(cohort.id)!;
      cm.studentsCount += 1;
      cm.watchedSeconds.push(videoByStudent.get(stu.id) ?? 0);

      const pre = attemptByStudentModel.get(`${stu.id}:1`);
      const post = attemptByStudentModel.get(`${stu.id}:2`);
      const preDone = pre && SCORED_STATUSES.has(pre.status) && pre.percentage !== null;
      const postDone = post && SCORED_STATUSES.has(post.status) && post.percentage !== null;

      if (preDone) {
        cm.preScores.push(pre.percentage!);
        allPre.push(pre.percentage!);
      }
      if (postDone) {
        cm.postScores.push(post.percentage!);
        allPost.push(post.percentage!);
      }

      if (preDone && postDone) {
        const p0 = pre.percentage!;
        const p1 = post.percentage!;
        cm.deltas.push(p1 - p0);
        if (p0 < 100) {
          const g = (p1 - p0) / (100 - p0);
          cm.hake.push(g);
          pairedHake.push(g);
        }
        if (cohort.group === 'TREATMENT') {
          treatmentPre.push(p0);
          treatmentPost.push(p1);
        } else {
          controlPre.push(p0);
          controlPost.push(p1);
        }

        // Pair Model 1 & Model 2 question answers
        const preAnsList = answersByAttempt.get(pre.id) ?? [];
        const postAnsList = answersByAttempt.get(post.id) ?? [];
        const postByQuestionId = new Map(postAnsList.map((a) => [a.questionId, a]));

        for (const a1 of preAnsList) {
          const q1 = questionById.get(a1.questionId);
          if (!q1) continue;
          const a2 =
            (q1.twinQuestionId ? postByQuestionId.get(q1.twinQuestionId) : undefined) ??
            postAnsList.find((cand) => {
              const q2 = questionById.get(cand.questionId);
              return (
                q2 !== undefined &&
                (q2.twinQuestionId === q1.id ||
                  (q2.conceptKey === q1.conceptKey && q2.orderIndex === q1.orderIndex))
              );
            });
          const q2 = a2 ? questionById.get(a2.questionId) : undefined;
          const key = `${q1.conceptKey}#${q1.orderIndex}`;
          const bucket = twinOutcomeMap.get(key) ?? {
            conceptKey: q1.conceptKey,
            orderIndex: q1.orderIndex,
            preQuestionId: q1.id,
            postQuestionId: q2?.id ?? q1.twinQuestionId ?? null,
            prePcts: [],
            postPcts: [],
            preCorrectCount: 0,
            postCorrectCount: 0,
            preWrongPostCorrect: 0,
            preCorrectPostWrong: 0,
            bothCorrect: 0,
            bothWrong: 0,
          };

          const pct1 = q1.points > 0 && a1.score !== null ? (a1.score / q1.points) * 100 : 0;
          const ok1 =
            a1.isCorrect !== null ? a1.isCorrect : q1.points > 0 && (a1.score ?? 0) >= q1.points * 0.6;
          bucket.prePcts.push(pct1);
          if (ok1) bucket.preCorrectCount += 1;

          if (a2 && q2) {
            const pct2 = q2.points > 0 && a2.score !== null ? (a2.score / q2.points) * 100 : 0;
            const ok2 =
              a2.isCorrect !== null
                ? a2.isCorrect
                : q2.points > 0 && (a2.score ?? 0) >= q2.points * 0.6;
            bucket.postPcts.push(pct2);
            if (ok2) bucket.postCorrectCount += 1;

            if (!ok1 && ok2) bucket.preWrongPostCorrect += 1;
            else if (ok1 && !ok2) bucket.preCorrectPostWrong += 1;
            else if (ok1 && ok2) bucket.bothCorrect += 1;
            else bucket.bothWrong += 1;
          }

          twinOutcomeMap.set(key, bucket);
        }
      }
    }

    // Concept rollup
    const conceptMap = new Map<
      string,
      {
        prePcts: number[];
        postPcts: number[];
        bImproved: number;
        cRegressed: number;
        bothCorrect: number;
        bothWrong: number;
      }
    >();

    for (const item of twinOutcomeMap.values()) {
      const c = conceptMap.get(item.conceptKey) ?? {
        prePcts: [],
        postPcts: [],
        bImproved: 0,
        cRegressed: 0,
        bothCorrect: 0,
        bothWrong: 0,
      };
      c.prePcts.push(...item.prePcts);
      c.postPcts.push(...item.postPcts);
      c.bImproved += item.preWrongPostCorrect;
      c.cRegressed += item.preCorrectPostWrong;
      c.bothCorrect += item.bothCorrect;
      c.bothWrong += item.bothWrong;
      conceptMap.set(item.conceptKey, c);
    }

    const concepts: AnalyticsConceptRow[] = Array.from(conceptMap.entries()).map(([key, c]) => {
      const preAvg = round2(mean(c.prePcts) ?? 0);
      const postAvg = round2(mean(c.postPcts) ?? 0);
      return {
        conceptKey: key,
        preCount: c.prePcts.length,
        postCount: c.postPcts.length,
        preAvgPct: preAvg,
        postAvgPct: postAvg,
        deltaPct: round2(postAvg - preAvg),
        preWrongPostCorrect: c.bImproved,
        preCorrectPostWrong: c.cRegressed,
        bothCorrect: c.bothCorrect,
        bothWrong: c.bothWrong,
      };
    });

    const questionsSummary: AnalyticsQuestionRow[] = Array.from(twinOutcomeMap.values())
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map((item) => {
        const preAvg = round2(mean(item.prePcts) ?? 0);
        const postAvg = item.postPcts.length > 0 ? round2(mean(item.postPcts)!) : null;
        return {
          conceptKey: item.conceptKey,
          orderIndex: item.orderIndex,
          preQuestionId: item.preQuestionId,
          postQuestionId: item.postQuestionId,
          preAvgPct: preAvg,
          postAvgPct: postAvg,
          deltaPct: postAvg !== null ? round2(postAvg - preAvg) : null,
          preCorrectRate:
            item.prePcts.length > 0 ? round4(item.preCorrectCount / item.prePcts.length) : 0,
          postCorrectRate:
            item.postPcts.length > 0 ? round4(item.postCorrectCount / item.postPcts.length) : null,
        };
      });

    // Reliability pairs (AI vs Teacher score across completed/overridden essay gradings)
    const reliabilityPairs: Array<{ ai_score: number; teacher_score: number; max_score: number }> =
      [];
    const answerById = new Map(answers.map((a) => [a.id, a]));
    const attemptById = new Map(attempts.map((a) => [a.id, a]));
    for (const gr of latestGrByAnswer.values()) {
      const ans = answerById.get(gr.answerId);
      if (!ans) continue;
      const att = attemptById.get(ans.attemptId);
      const q = questionById.get(ans.questionId);
      if (!att || !q) continue;
      const ov = latestOverrideByGr.get(gr.id);
      if (ov || att.status === 'FINAL') {
        reliabilityPairs.push({
          ai_score: gr.aiTotal,
          teacher_score: ov ? ov.newTotal : (ans.score ?? gr.aiTotal),
          max_score: Math.max(1, q.points),
        });
      }
    }

    const totalEssayGraded = latestGrByAnswer.size;
    const totalOverrides = latestOverrideByGr.size;

    const cohortRows: AnalyticsCohortRow[] = cohorts.map((c) => {
      const cm = cohortMetrics.get(c.id)!;
      const preAvg = mean(cm.preScores);
      const postAvg = mean(cm.postScores);
      const deltaAvg = mean(cm.deltas);
      const hakeAvg = mean(cm.hake);
      const watchAvg = mean(cm.watchedSeconds) ?? 0;
      return {
        id: c.id,
        name: c.name,
        group: c.group,
        topicId: c.topicId,
        topicTitle: topicTitleById.get(c.topicId) ?? '',
        studentsCount: cm.studentsCount,
        preCompletedCount: cm.preScores.length,
        postCompletedCount: cm.postScores.length,
        pairedCount: cm.deltas.length,
        preAvgPct: preAvg !== null ? round2(preAvg) : null,
        postAvgPct: postAvg !== null ? round2(postAvg) : null,
        deltaPct: deltaAvg !== null ? round2(deltaAvg) : null,
        hakeGain: hakeAvg !== null ? round4(hakeAvg) : null,
        avgWatchedSeconds: Math.round(watchAvg),
      };
    });

    const pairedPreAll = [...treatmentPre, ...controlPre];
    const pairedPostAll = [...treatmentPost, ...controlPost];
    const pairedScope: 'TREATMENT' | 'ALL' = treatmentPre.length > 0 ? 'TREATMENT' : 'ALL';
    const pairedInputPre = pairedScope === 'TREATMENT' ? treatmentPre : pairedPreAll;
    const pairedInputPost = pairedScope === 'TREATMENT' ? treatmentPost : pairedPostAll;

    const twinInputs = Array.from(twinOutcomeMap.values()).map((item) => ({
      concept_key: item.conceptKey,
      order_index: item.orderIndex,
      pre_wrong_post_correct: item.preWrongPostCorrect,
      pre_correct_post_wrong: item.preCorrectPostWrong,
      both_correct: item.bothCorrect,
      both_wrong: item.bothWrong,
    }));

    let pairedStats: PairedStatsResponsePayload | null = null;
    let betweenStats: BetweenStatsResponsePayload | null = null;
    let statsUnavailable = false;
    let statsError: string | null = null;

    const shouldCallPaired = pairedInputPre.length >= 1;
    const shouldCallBetween =
      (treatmentPre.length >= 2 && controlPre.length >= 2) ||
      twinInputs.length > 0 ||
      reliabilityPairs.length > 0;

    if (shouldCallPaired || shouldCallBetween) {
      try {
        [pairedStats, betweenStats] = await Promise.all([
          shouldCallPaired
            ? this.statsClient.computePairedStats({
                pre_scores: pairedInputPre,
                post_scores: pairedInputPost,
                max_score: 100,
              })
            : Promise.resolve(null),
          shouldCallBetween
            ? this.statsClient.computeBetweenStats({
                treatment_pre: treatmentPre,
                treatment_post: treatmentPost,
                control_pre: controlPre,
                control_post: controlPost,
                twin_question_outcomes: twinInputs,
                reliability_pairs: reliabilityPairs,
              })
            : Promise.resolve(null),
        ]);
      } catch (err) {
        statsUnavailable = true;
        statsError = err instanceof Error ? err.message : 'Statistical engine unavailable';
      }
    }

    const preOverallMean = mean(allPre);
    const postOverallMean = mean(allPost);
    const deltaOverall =
      pairedPreAll.length > 0
        ? mean(pairedPostAll.map((p, idx) => p - pairedPreAll[idx]!))
        : null;
    const hakeOverall = mean(pairedHake);

    return {
      filters: { topicId: filters.topicId ?? null, cohortId: filters.cohortId ?? null },
      topics: allTopics.map((t) => ({ id: t.id, title: t.title })),
      cohorts: cohortRows,
      summary: {
        totalStudents: students.length,
        pairedStudents: pairedPreAll.length,
        treatmentPairedCount: treatmentPre.length,
        controlPairedCount: controlPre.length,
        preMeanPct: preOverallMean !== null ? round2(preOverallMean) : null,
        postMeanPct: postOverallMean !== null ? round2(postOverallMean) : null,
        deltaMeanPct: deltaOverall !== null ? round2(deltaOverall) : null,
        hakeMeanGain: hakeOverall !== null ? round4(hakeOverall) : null,
        totalEssayGraded,
        totalOverrides,
        overrideRate: totalEssayGraded > 0 ? round4(totalOverrides / totalEssayGraded) : 0,
      },
      concepts,
      questions: questionsSummary,
      distributions: buildBuckets(allPre, allPost),
      formalStats: {
        pairedScope,
        paired: pairedStats,
        between: betweenStats,
        statsUnavailable,
        statsError,
      },
    };
  }

  async getUsage(teacherId: string, days: number): Promise<UsageResponse> {
    const cohorts = await this.prisma.cohort.findMany({ where: scopedCohortWhere(teacherId) });
    const cohortIds = cohorts.map((c) => c.id);
    const students =
      cohortIds.length > 0
        ? await this.prisma.student.findMany({
            where: { cohortId: { in: cohortIds }, deletedAt: null },
          })
        : [];
    const studentIds = students.map((s) => s.id);
    const attempts =
      studentIds.length > 0
        ? await this.prisma.attempt.findMany({ where: { studentId: { in: studentIds } } })
        : [];
    const attemptIds = attempts.map((a) => a.id);
    const answers =
      attemptIds.length > 0
        ? await this.prisma.answer.findMany({ where: { attemptId: { in: attemptIds } } })
        : [];
    const answerIds = answers.map((a) => a.id);

    const since = new Date(Date.now() - days * 86_400_000);
    const rows =
      answerIds.length > 0
        ? await this.prisma.aiUsage.findMany({
            where: {
              answerId: { in: answerIds },
              createdAt: { gte: since },
            },
            orderBy: { createdAt: 'desc' },
          })
        : [];

    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);
    const todayAgg = await this.prisma.aiUsage.aggregate({
      where: { createdAt: { gte: startOfToday } },
      _sum: { costUsd: true },
    });
    const todayCostUsd = round4(todayAgg._sum.costUsd ?? 0);

    const totalCalls = rows.length;
    const successCalls = rows.filter((r) => r.success).length;
    const failedCalls = totalCalls - successCalls;
    const totalCostUsd = round4(rows.reduce((acc, r) => acc + r.costUsd, 0));
    const totalInputTokens = rows.reduce((acc, r) => acc + r.inputTokens, 0);
    const totalOutputTokens = rows.reduce((acc, r) => acc + r.outputTokens, 0);
    const latencies = rows.map((r) => r.latencyMs).sort((a, b) => a - b);
    const avgLatencyMs =
      totalCalls > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / totalCalls) : 0;
    const p95LatencyMs =
      latencies.length > 0 ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))]! : 0;

    const dailyMap = new Map<
      string,
      { calls: number; successCalls: number; costUsd: number; latencySum: number }
    >();
    const breakdownMap = new Map<
      string,
      {
        provider: string;
        modelName: string;
        operation: string;
        calls: number;
        successCalls: number;
        inputTokens: number;
        outputTokens: number;
        costUsd: number;
        latencySum: number;
      }
    >();

    for (const r of rows) {
      const dateKey = r.createdAt.toISOString().slice(0, 10);
      const d = dailyMap.get(dateKey) ?? { calls: 0, successCalls: 0, costUsd: 0, latencySum: 0 };
      d.calls += 1;
      if (r.success) d.successCalls += 1;
      d.costUsd += r.costUsd;
      d.latencySum += r.latencyMs;
      dailyMap.set(dateKey, d);

      const bKey = `${r.provider}|${r.modelName}|${r.operation}`;
      const b = breakdownMap.get(bKey) ?? {
        provider: r.provider,
        modelName: r.modelName,
        operation: r.operation,
        calls: 0,
        successCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        latencySum: 0,
      };
      b.calls += 1;
      if (r.success) b.successCalls += 1;
      b.inputTokens += r.inputTokens;
      b.outputTokens += r.outputTokens;
      b.costUsd += r.costUsd;
      b.latencySum += r.latencyMs;
      breakdownMap.set(bKey, b);
    }

    const daily: UsageDailyRow[] = Array.from(dailyMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, d]) => ({
        date,
        calls: d.calls,
        successCalls: d.successCalls,
        costUsd: round4(d.costUsd),
        avgLatencyMs: Math.round(d.latencySum / d.calls),
      }));

    const breakdown: UsageBreakdownRow[] = Array.from(breakdownMap.values()).map((b) => ({
      provider: b.provider,
      modelName: b.modelName,
      operation: b.operation,
      calls: b.calls,
      successRate: round4(b.successCalls / b.calls),
      inputTokens: b.inputTokens,
      outputTokens: b.outputTokens,
      costUsd: round4(b.costUsd),
      avgLatencyMs: Math.round(b.latencySum / b.calls),
    }));

    return {
      days,
      dailyCapUsd: this.env.AI_DAILY_CAP_USD,
      todayCostUsd,
      capRemainingUsd: round4(Math.max(0, this.env.AI_DAILY_CAP_USD - todayCostUsd)),
      summary: {
        totalCalls,
        successCalls,
        failedCalls,
        totalCostUsd,
        avgLatencyMs,
        p95LatencyMs,
        totalInputTokens,
        totalOutputTokens,
      },
      daily,
      breakdown,
      recentCalls: rows.slice(0, 50).map((r) => ({
        id: r.id,
        provider: r.provider,
        modelName: r.modelName,
        operation: r.operation,
        costUsd: round4(r.costUsd),
        latencyMs: r.latencyMs,
        success: r.success,
        errorCode: r.errorCode,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }
}
