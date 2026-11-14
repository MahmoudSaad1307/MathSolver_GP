import { z } from 'zod';
import { QuestionTypeSchema } from '../enums.js';
import {
  McqOptionInputSchema,
  ModelAnswerInputSchema,
  OptionalSolutionUrlSchema,
  RubricCriterionInputSchema,
} from './teacher.js';

export const PdfImportStatusSchema = z.enum([
  'QUEUED',
  'PROCESSING',
  'READY_FOR_REVIEW',
  'APPLIED',
  'FAILED',
]);
export type PdfImportStatus = z.infer<typeof PdfImportStatusSchema>;

export const PdfPageRoleSchema = z.enum(['QUESTIONS', 'MODEL_ANSWERS', 'MIXED', 'COVER_BLANK']);
export type PdfPageRole = z.infer<typeof PdfPageRoleSchema>;

export const PdfExtractionWarningCodeSchema = z.enum([
  'OCR_LOW_CONFIDENCE',
  'OCR_DISAGREEMENT',
  'TEXT_LAYER_DISAGREEMENT',
  'SYMPY_UNPARSABLE',
  'ANSWER_STEP_MISMATCH',
  'MCQ_ANSWER_CONFLICT',
  'DUPLICATE_MCQ_OPTIONS',
  'UNMATCHED_QUESTION',
  'UNMATCHED_ANSWER',
  'COUNT_MISMATCH',
  'DEFAULT_POINTS_ASSIGNED',
  'INVALID_MCQ_OPTIONS',
  'ARABIC_LABELS_MAPPED',
]);
export type PdfExtractionWarningCode = z.infer<typeof PdfExtractionWarningCodeSchema>;

export const PdfSympyVerificationStatusSchema = z.enum([
  'VERIFIED',
  'MISMATCH',
  'UNPARSABLE',
  'NOT_APPLICABLE',
]);
export type PdfSympyVerificationStatus = z.infer<typeof PdfSympyVerificationStatusSchema>;

export const ExtractedQuestionWarningSchema = z.object({
  code: PdfExtractionWarningCodeSchema,
  severity: z.enum(['info', 'warning', 'error']),
  messageEn: z.string(),
  messageAr: z.string(),
});
export type ExtractedQuestionWarning = z.infer<typeof ExtractedQuestionWarningSchema>;

/**
 * Preview representation of an extracted question. Intentionally permits partial MCQ/Essay
 * payloads so damaged/incomplete PDF extractions are still displayed to the teacher with
 * actionable warnings instead of being silently dropped. Strict UpsertQuestionSchema validation
 * is enforced when applying to the database.
 */
export const ExtractedQuestionPreviewSchema = z.object({
  tempId: z.string().min(1).max(100),
  orderIndex: z.number().int().min(1).max(200),
  conceptKey: z.string().trim().min(1).max(100),
  type: QuestionTypeSchema,
  promptLatex: z.string().trim().min(1).max(10000),
  points: z.number().positive().max(100),
  solutionUrl: OptionalSolutionUrlSchema,
  needsTeacherConfirmation: z.boolean().default(true),
  mcqOptions: z
    .array(
      z.object({
        label: z.enum(['A', 'B', 'C', 'D']),
        textLatex: z.string().trim().max(2000),
        isCorrect: z.boolean(),
      }),
    )
    .nullable()
    .transform((v) => v ?? undefined)
    .optional(),
  modelAnswer: z
    .object({
      solutionStepsLatex: z.array(z.string().trim().max(4000)).default([]),
      finalAnswerLatex: z.string().trim().max(2000).default(''),
      finalAnswerSympy: z.string().trim().max(1000).nullable().optional(),
      commonMistakes: z
        .string()
        .trim()
        .max(4000)
        .nullable()
        .default('')
        .transform((v) => v ?? ''),
    })
    .nullable()
    .optional(),
  rubricCriteria: z
    .array(
      z.object({
        orderIndex: z.number().int().min(1),
        key: z.string().trim().min(1).max(100),
        descriptionEn: z.string().trim().min(1).max(1000),
        descriptionAr: z.string().trim().min(1).max(1000),
        maxPoints: z.number().positive().max(100),
      }),
    )
    .nullable()
    .transform((v) => v ?? undefined)
    .optional(),
  ocrConfidence: z.number().min(0).max(1).default(1),
  dualOcrAgreed: z.boolean().default(true),
  sympyStatus: PdfSympyVerificationStatusSchema.default('NOT_APPLICABLE'),
  sympyDetail: z
    .string()
    .nullable()
    .default('')
    .transform((v) => v ?? ''),
  sourceQuestionPages: z.array(z.number().int().min(1)).default([]),
  sourceAnswerPages: z.array(z.number().int().min(1)).default([]),
  warnings: z.array(ExtractedQuestionWarningSchema).default([]),
  verifiedByTeacher: z.boolean().default(false),
});
export type ExtractedQuestionPreview = z.infer<typeof ExtractedQuestionPreviewSchema>;

export const PdfPageMetaSchema = z.object({
  pageNumber: z.number().int().min(1),
  role: PdfPageRoleSchema,
  hasTextLayer: z.boolean(),
  isBlank: z.boolean(),
  imageUrl: z.string().optional(),
});
export type PdfPageMeta = z.infer<typeof PdfPageMetaSchema>;

export const ExtractedModelPreviewSchema = z.object({
  modelNumber: z.union([z.literal(1), z.literal(2)]),
  title: z.string().trim().min(1).max(200),
  durationMinutes: z.number().int().min(5).max(300).default(60),
  pageCount: z.number().int().min(1),
  pages: z.array(PdfPageMetaSchema),
  questionsFoundCount: z.number().int().min(0),
  answersFoundCount: z.number().int().min(0),
  matchedCount: z.number().int().min(0),
  unmatchedQuestionNumbers: z.array(z.number().int()).default([]),
  unmatchedAnswerNumbers: z.array(z.number().int()).default([]),
  reportWarnings: z.array(ExtractedQuestionWarningSchema).default([]),
  questions: z.array(ExtractedQuestionPreviewSchema),
});
export type ExtractedModelPreview = z.infer<typeof ExtractedModelPreviewSchema>;

export const PdfImportPreviewPayloadSchema = z.object({
  models: z.array(ExtractedModelPreviewSchema).min(1).max(2),
  twinSummary: z.object({
    matchedConceptKeys: z.array(z.string()),
    onlyInModel1: z.array(z.string()),
    onlyInModel2: z.array(z.string()),
  }),
  telemetry: z.object({
    provider: z.string(),
    secondaryProvider: z.string().nullable().default(null),
    totalInputTokens: z.number().int().min(0),
    totalOutputTokens: z.number().int().min(0),
    totalCostUsd: z.number().min(0),
    latencyMs: z.number().int().min(0),
  }),
});
export type PdfImportPreviewPayload = z.infer<typeof PdfImportPreviewPayloadSchema>;

export const PdfImportTopicMetaSchema = z.object({
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(2000).default(''),
  correctnessThreshold: z.number().min(0.1).max(1).default(0.6),
});
export type PdfImportTopicMeta = z.infer<typeof PdfImportTopicMetaSchema>;

export const SavePdfDraftModelSchema = z.object({
  modelNumber: z.union([z.literal(1), z.literal(2)]),
  title: z.string().trim().min(2).max(200),
  durationMinutes: z.number().int().min(5).max(300).default(60),
  questions: z.array(ExtractedQuestionPreviewSchema),
});

export const SavePdfDraftSchema = z.object({
  topicMeta: PdfImportTopicMetaSchema.optional(),
  models: z.array(SavePdfDraftModelSchema).min(1).max(2),
});
export type SavePdfDraftInput = z.infer<typeof SavePdfDraftSchema>;

export const ApplyPdfImportSchema = z.object({
  targetTopicId: z.string().uuid().optional(),
  topicMeta: PdfImportTopicMetaSchema.optional(),
  confirmAllReviewed: z.boolean().default(false),
  models: z.array(SavePdfDraftModelSchema).min(1).max(2),
});
export type ApplyPdfImportInput = z.infer<typeof ApplyPdfImportSchema>;

export const StrictApplyQuestionSchema = z.object({
  orderIndex: z.number().int().min(1).max(100),
  conceptKey: z.string().trim().min(1).max(100),
  type: QuestionTypeSchema,
  promptLatex: z.string().trim().min(1).max(5000),
  points: z.number().positive().max(100),
  solutionUrl: OptionalSolutionUrlSchema,
  needsTeacherConfirmation: z.boolean().default(false),
  mcqOptions: z
    .array(McqOptionInputSchema)
    .nullable()
    .transform((v) => v ?? undefined)
    .optional(),
  modelAnswer: ModelAnswerInputSchema.nullable().optional(),
  rubricCriteria: z
    .array(RubricCriterionInputSchema)
    .nullable()
    .transform((v) => v ?? undefined)
    .optional(),
});

export const PdfImportJobResponseSchema = z.object({
  id: z.string().uuid(),
  topicId: z.string().uuid().nullable(),
  appliedTopicId: z.string().uuid().nullable(),
  status: PdfImportStatusSchema,
  currentStage: z.string(),
  progressPct: z.number().int().min(0).max(100),
  hasPrePdf: z.boolean(),
  hasPostPdf: z.boolean(),
  topicMeta: PdfImportTopicMetaSchema.nullable(),
  preview: PdfImportPreviewPayloadSchema.nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  expiresAt: z.string(),
});
export type PdfImportJobResponse = z.infer<typeof PdfImportJobResponseSchema>;
