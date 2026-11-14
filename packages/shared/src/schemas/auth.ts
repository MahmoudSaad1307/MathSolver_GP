import { z } from 'zod';
import { AttemptStatusSchema, CODE_ALPHABET, StudentFlowStepSchema } from '../enums.js';

const codeRegex = new RegExp(`^[${CODE_ALPHABET}]{6}$`);

export const TeacherLoginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(128),
});
export type TeacherLoginInput = z.infer<typeof TeacherLoginSchema>;

export const TeacherProfileSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string(),
  role: z.literal('TEACHER'),
});
export type TeacherProfile = z.infer<typeof TeacherProfileSchema>;

export const StudentRegisterSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(2, 'Display name must be at least 2 characters')
    .max(60, 'Display name cannot exceed 60 characters'),
  email: z.string().trim().email('Valid email is required').max(254),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password cannot exceed 128 characters'),
  consentAccepted: z.boolean().optional(),
});
export type StudentRegisterInput = z.infer<typeof StudentRegisterSchema>;

export const StudentLoginSchema = z.object({
  email: z.string().trim().email('Valid email is required').max(254),
  password: z.string().min(8).max(128),
});
export type StudentLoginInput = z.infer<typeof StudentLoginSchema>;

export const StudentEnterQuizCodeSchema = z.object({
  joinCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(codeRegex, 'Join code must be 6 valid characters'),
});
export type StudentEnterQuizCodeInput = z.infer<typeof StudentEnterQuizCodeSchema>;

export const StudentProfileSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string(),
  consentAcceptedAt: z.string().datetime().nullable(),
  role: z.literal('STUDENT'),
});
export type StudentProfile = z.infer<typeof StudentProfileSchema>;

export const StudentAttemptSummarySchema = z.object({
  id: z.string().uuid(),
  examModelId: z.string().uuid(),
  status: AttemptStatusSchema,
  totalScore: z.number().nullable(),
  maxScore: z.number().nullable(),
  submittedAt: z.string().datetime().nullable(),
  deadlineAt: z.string().datetime(),
});
export type StudentAttemptSummary = z.infer<typeof StudentAttemptSummarySchema>;

export const StudentEnrollmentSummarySchema = z.object({
  studentId: z.string().uuid(),
  cohortId: z.string().uuid(),
  cohortName: z.string(),
  joinCode: z.string(),
  group: z.enum(['TREATMENT', 'CONTROL']),
  requireVideoBeforePost: z.boolean(),
  topicId: z.string().uuid(),
  topicTitle: z.string(),
  step: StudentFlowStepSchema,
  enrolledAt: z.string().datetime(),
  preTestAttempt: StudentAttemptSummarySchema.nullable(),
  postTestAttempt: StudentAttemptSummarySchema.nullable(),
  videoProgress: z.object({
    watchedSeconds: z.number().int(),
    visitedCount: z.number().int(),
    requiredCount: z.number().int(),
    unlockedPostAt: z.string().datetime().nullable(),
  }),
});
export type StudentEnrollmentSummary = z.infer<typeof StudentEnrollmentSummarySchema>;

export const StudentAccountMeResponseSchema = z.object({
  account: StudentProfileSchema,
  activeEnrollmentId: z.string().uuid().nullable(),
  enrollments: z.array(StudentEnrollmentSummarySchema),
});
export type StudentAccountMeResponse = z.infer<typeof StudentAccountMeResponseSchema>;

export const StudentJoinSchema = z.object({
  joinCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(codeRegex, 'Join code must be 6 valid characters'),
  displayName: z
    .string()
    .trim()
    .min(2, 'Display name must be at least 2 characters')
    .max(60, 'Display name cannot exceed 60 characters')
    .optional(),
});
export type StudentJoinInput = z.infer<typeof StudentJoinSchema>;

export const StudentResumeSchema = z.object({
  resumeCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(codeRegex, 'Resume code must be 6 valid characters'),
});
export type StudentResumeInput = z.infer<typeof StudentResumeSchema>;

export const StudentConsentSchema = z.object({
  accepted: z.literal(true),
});
export type StudentConsentInput = z.infer<typeof StudentConsentSchema>;

export const StudentJoinResponseSchema = z.object({
  student: z.object({
    id: z.string().uuid(),
    accountId: z.string().uuid().nullable().optional(),
    email: z.string().email().nullable().optional(),
    displayName: z.string(),
    resumeCode: z.string(),
    cohortId: z.string().uuid(),
    cohortName: z.string(),
    group: z.enum(['TREATMENT', 'CONTROL']),
  }),
});
export type StudentJoinResponse = z.infer<typeof StudentJoinResponseSchema>;
