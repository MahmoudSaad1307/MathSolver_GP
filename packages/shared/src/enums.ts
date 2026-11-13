import { z } from 'zod';

/**
 * Unambiguous 31-character code alphabet (excludes 0, O, 1, I, L).
 */
export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export const RoleSchema = z.enum(['TEACHER']);
export type Role = z.infer<typeof RoleSchema>;

export const ExamStatusSchema = z.enum(['DRAFT', 'PUBLISHED']);
export type ExamStatus = z.infer<typeof ExamStatusSchema>;

export const QuestionTypeSchema = z.enum(['MCQ', 'ESSAY']);
export type QuestionType = z.infer<typeof QuestionTypeSchema>;

export const CohortGroupSchema = z.enum(['TREATMENT', 'CONTROL']);
export type CohortGroup = z.infer<typeof CohortGroupSchema>;

export const CohortStatusSchema = z.enum(['OPEN', 'CLOSED', 'ARCHIVED']);
export type CohortStatus = z.infer<typeof CohortStatusSchema>;

export const AttemptStatusSchema = z.enum([
  'IN_PROGRESS',
  'SUBMITTED',
  'GRADING',
  'GRADED',
  'NEEDS_REVIEW',
  'FINAL',
]);
export type AttemptStatus = z.infer<typeof AttemptStatusSchema>;

export const ScoreSourceSchema = z.enum(['AUTO', 'AI', 'TEACHER_OVERRIDE', 'MIXED']);
export type ScoreSource = z.infer<typeof ScoreSourceSchema>;

export const VideoEventTypeSchema = z.enum([
  'PLAY',
  'PAUSE',
  'SEEK',
  'HEARTBEAT',
  'ENDED',
  'QUESTION_LINK_CLICK',
  'PLAYER_ERROR',
]);
export type VideoEventType = z.infer<typeof VideoEventTypeSchema>;

export const StudentFlowStepSchema = z.enum([
  'JOIN',
  'CONSENT',
  'PRETEST_IN_PROGRESS',
  'PRETEST_SUBMITTED',
  'PRETEST_GRADING',
  'PRETEST_RESULTS',
  'REMEDIATION',
  'POSTTEST_UNLOCKED',
  'POSTTEST_IN_PROGRESS',
  'POSTTEST_GRADING',
  'COMPARISON',
]);
export type StudentFlowStep = z.infer<typeof StudentFlowStepSchema>;

export const GradingErrorTypeSchema = z.enum([
  'none',
  'sign',
  'arithmetic',
  'algebra',
  'rule_misuse',
  'concept',
  'domain',
  'notation',
  'incomplete',
  'other',
]);
export type GradingErrorType = z.infer<typeof GradingErrorTypeSchema>;

export const ReviewReasonSchema = z.enum([
  'LOW_CONFIDENCE',
  'UNSURE_EVIDENCE_TOKEN',
  'HIGH_ILLEGIBLE_RATIO',
  'EMPTY_SUBMISSION',
  'SCHEMA_RETRY_USED',
  'SYMPY_MISMATCH',
  'TOTAL_MISMATCH',
  'INJECTION_ATTEMPT',
  'STUDENT_REPORTED_MISREAD',
  'AI_SERVICE_FAILED',
  'STEP_CHECK_MISMATCH',
]);
export type ReviewReason = z.infer<typeof ReviewReasonSchema>;
