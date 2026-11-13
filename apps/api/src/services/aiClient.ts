import type { GradingErrorType, ReviewReason } from '@mathlens/shared';
import type { AppEnv } from '../config/env.js';

export interface AiGradeEssayInput {
  questionPromptLatex: string;
  modelAnswer: {
    solutionStepsLatex: string[];
    finalAnswerLatex: string;
    finalAnswerSympy: string | null;
    commonMistakes: string;
  };
  rubricCriteria: Array<{
    id?: string;
    key: string;
    descriptionEn: string;
    descriptionAr: string;
    maxPoints: number;
  }>;
  images: Array<{
    dataBase64: string;
    mimeType: string;
    sha256: string;
  }>;
  rubricVersion: number;
  languageHint?: string;
  forceRefresh?: boolean;
  hintTag?: string;
}

export interface AiCriterionScore {
  criterionKey: string;
  awardedPoints: number;
  maxPoints: number;
  met: boolean;
  evidenceStep: number | null;
  commentAr: string;
}

export interface AiTranscriptionLine {
  lineNumber: number;
  textLatex: string;
  confidence: number;
  hasUnsure: boolean;
  illegible: boolean;
  crossedOut: boolean;
}

export interface AiTranscriptionResult {
  lines: AiTranscriptionLine[];
  fullTranscriptionLatex: string;
  finalAnswerLatex: string | null;
  overallConfidence: number;
  illegibleRatio: number;
  containsUnsureToken: boolean;
  injectionDetected: boolean;
  injectionSignals: string[];
  rawModelOutput: string;
  preprocessWarnings: string[];
  provider: string;
  modelName: string;
  promptVersion: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
}

export interface AiSympyCheck {
  checked: boolean;
  status: 'EQUIVALENT' | 'NOT_EQUIVALENT' | 'UNPARSABLE' | 'TIMEOUT' | 'NOT_APPLICABLE';
  studentFinalSympy: string | null;
  expectedFinalSympy: string | null;
  equivalent: boolean | null;
  detail: string;
}

export interface AiGradeEssayResponse {
  provider: string;
  modelName: string;
  promptVersion: string;
  rubricVersion: number;
  imageHash: string;
  transcription: AiTranscriptionResult;
  criteriaScores: AiCriterionScore[];
  aiTotal: number;
  maxPoints: number;
  finalAnswerCorrect: boolean | null;
  firstErrorStep: number | null;
  errorType: GradingErrorType;
  errorExplanationAr: string;
  hintAr: string;
  confidence: number;
  sympyCheck: AiSympyCheck;
  needsReview: boolean;
  reviewReasons: ReviewReason[];
  rawOutput: string;
  latencyMs: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  schemaRetryUsed: boolean;
  cached: boolean;
}

export interface StatsTTestResult {
  statistic: number | null;
  p_value: number | null;
  df: number;
}

export interface StatsNonParametricResult {
  statistic: number | null;
  p_value: number | null;
}

export interface StatsEffectSizeCiResult {
  estimate: number;
  ci_low: number;
  ci_high: number;
}

export interface PairedStatsRequestPayload {
  pre_scores: number[];
  post_scores: number[];
  max_score?: number;
  n_bootstrap?: number;
  seed?: number;
}

export interface PairedStatsResponsePayload {
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
  paired_t: StatsTTestResult;
  wilcoxon: StatsNonParametricResult;
  cohens_dz: StatsEffectSizeCiResult;
  hake_gain: { mean_gain: number; per_student_gains: Array<number | null> };
  outlier_indices: number[];
  warnings: string[];
  recommended_test: 'PAIRED_T' | 'WILCOXON';
  interpretation_ar: string;
  interpretation_en: string;
}

export interface BetweenStatsRequestPayload {
  treatment_pre: number[];
  treatment_post: number[];
  control_pre: number[];
  control_post: number[];
  twin_question_outcomes: Array<{
    concept_key: string;
    order_index: number;
    pre_wrong_post_correct: number;
    pre_correct_post_wrong: number;
    both_correct: number;
    both_wrong: number;
  }>;
  reliability_pairs: Array<{
    ai_score: number;
    teacher_score: number;
    max_score: number;
  }>;
  n_bootstrap?: number;
  seed?: number;
}

export interface BetweenStatsResponsePayload {
  group_comparison: {
    treatment_n: number;
    control_n: number;
    treatment_gain_mean: number;
    treatment_gain_sd: number;
    control_gain_mean: number;
    control_gain_sd: number;
    welch_t: StatsTTestResult;
    mann_whitney: StatsNonParametricResult;
    hedges_g: StatsEffectSizeCiResult;
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

export interface AiServiceClient {
  gradeEssay(input: AiGradeEssayInput): Promise<AiGradeEssayResponse>;
  transcribeOnly(input: {
    images: AiGradeEssayInput['images'];
    questionPromptLatex?: string;
  }): Promise<AiTranscriptionResult>;
}

export interface StatsServiceClient {
  computePairedStats(input: PairedStatsRequestPayload): Promise<PairedStatsResponsePayload>;
  computeBetweenStats(input: BetweenStatsRequestPayload): Promise<BetweenStatsResponsePayload>;
}

export class AiServiceHttpError extends Error {
  public readonly status: number;
  public readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'AiServiceHttpError';
    this.status = status;
    this.code = code;
  }
}

export class HttpAiServiceClient implements AiServiceClient, StatsServiceClient {
  constructor(private readonly env: AppEnv) {}

  private async postJson<T>(path: string, body: unknown): Promise<T> {
    const baseUrl = this.env.AI_SERVICE_URL.replace(/\/+$/, '');
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Key': this.env.AI_INTERNAL_KEY,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.env.AI_REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      let errCode = `AI_HTTP_${res.status}`;
      let msg = `AI service returned HTTP ${res.status}`;
      try {
        const parsed = (await res.json()) as { detail?: { code?: string; message?: string } };
        if (parsed.detail?.code) errCode = parsed.detail.code;
        if (parsed.detail?.message) msg = parsed.detail.message;
      } catch {
        // Keep HTTP status fallback
      }
      throw new AiServiceHttpError(res.status, errCode, msg);
    }

    return (await res.json()) as T;
  }

  async gradeEssay(input: AiGradeEssayInput): Promise<AiGradeEssayResponse> {
    return this.postJson<AiGradeEssayResponse>('/v1/grade-essay', input);
  }

  async transcribeOnly(input: {
    images: AiGradeEssayInput['images'];
    questionPromptLatex?: string;
  }): Promise<AiTranscriptionResult> {
    return this.postJson<AiTranscriptionResult>('/v1/transcribe', input);
  }

  async computePairedStats(input: PairedStatsRequestPayload): Promise<PairedStatsResponsePayload> {
    return this.postJson<PairedStatsResponsePayload>('/v1/stats/paired', input);
  }

  async computeBetweenStats(
    input: BetweenStatsRequestPayload,
  ): Promise<BetweenStatsResponsePayload> {
    return this.postJson<BetweenStatsResponsePayload>('/v1/stats/between', input);
  }
}
