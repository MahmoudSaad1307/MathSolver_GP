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

export interface AiServiceClient {
  gradeEssay(input: AiGradeEssayInput): Promise<AiGradeEssayResponse>;
  transcribeOnly(input: {
    images: AiGradeEssayInput['images'];
    questionPromptLatex?: string;
  }): Promise<AiTranscriptionResult>;
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

export class HttpAiServiceClient implements AiServiceClient {
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
}
