export interface PairedStatsPayload {
  n: number;
  pre_mean: number;
  pre_sd: number;
  pre_median: number;
  pre_iqr: number;
  post_mean: number;
  post_sd: number;
  post_median: number;
  post_iqr: number;
  mean_diff: number;
  sd_diff: number;
  median_diff: number;
  shapiro: { statistic: number | null; p_value: number | null; normal: boolean };
  paired_t: { statistic: number | null; p_value: number | null; df: number };
  wilcoxon: { statistic: number | null; p_value: number | null };
  cohens_dz: { estimate: number; ci_low: number; ci_high: number };
  hake_gain: { mean_gain: number; per_student_gains: Array<number | null> };
  outlier_indices: number[];
  warnings: string[];
  recommended_test: 'PAIRED_T' | 'WILCOXON';
  interpretation_ar: string;
  interpretation_en: string;
}

export interface BetweenStatsPayload {
  group_comparison: {
    treatment_n: number;
    control_n: number;
    treatment_gain_mean: number;
    treatment_gain_sd: number;
    control_gain_mean: number;
    control_gain_sd: number;
    welch_t: { statistic: number | null; p_value: number | null; df: number };
    mann_whitney: { statistic: number | null; p_value: number | null };
    hedges_g: { estimate: number; ci_low: number; ci_high: number };
    did: {
      estimate: number;
      se: number;
      t_stat: number;
      p_value: number;
      ci_low: number;
      ci_high: number;
      clustered_by_student: boolean;
    };
  } | null;
  mcnemar: Array<{
    concept_key: string;
    order_index: number;
    b_improved: number;
    c_regressed: number;
    p_value: number;
    p_adjusted_holm: number;
    significant: boolean;
  }>;
  reliability: {
    n: number;
    mae: number;
    exact_agreement_rate: number;
    within_one_agreement_rate: number;
    override_rate: number;
    cohens_kappa: number;
    quadratic_weighted_kappa: number;
  } | null;
  warnings: string[];
  interpretation_ar: string;
  interpretation_en: string;
}

export interface TeacherAnalyticsResponse {
  filters: {
    topicId: string | null;
    cohortId: string | null;
  };
  topics: Array<{ id: string; title: string }>;
  cohorts: Array<{
    id: string;
    name: string;
    group: 'TREATMENT' | 'CONTROL' | (string & {});
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
  }>;
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
  concepts: Array<{
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
  }>;
  questions: Array<{
    conceptKey: string;
    orderIndex: number;
    preQuestionId: string;
    postQuestionId: string | null;
    preAvgPct: number;
    postAvgPct: number | null;
    deltaPct: number | null;
    preCorrectRate: number;
    postCorrectRate: number | null;
  }>;
  distributions: Array<{
    rangeLabel: string;
    preCount: number;
    postCount: number;
  }>;
  formalStats: {
    pairedScope: 'TREATMENT' | 'ALL';
    paired: PairedStatsPayload | null;
    between: BetweenStatsPayload | null;
    statsUnavailable: boolean;
    statsError: string | null;
  };
}

export interface TeacherUsageResponse {
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
  daily: Array<{
    date: string;
    calls: number;
    successCalls: number;
    costUsd: number;
    avgLatencyMs: number;
  }>;
  breakdown: Array<{
    provider: string;
    modelName: string;
    operation: string;
    calls: number;
    successRate: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    avgLatencyMs: number;
  }>;
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
