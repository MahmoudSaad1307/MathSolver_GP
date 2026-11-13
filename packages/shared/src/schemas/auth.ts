import { z } from 'zod';
import { CODE_ALPHABET } from '../enums.js';

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
    .max(60, 'Display name cannot exceed 60 characters'),
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
    displayName: z.string(),
    resumeCode: z.string(),
    cohortId: z.string().uuid(),
    cohortName: z.string(),
    group: z.enum(['TREATMENT', 'CONTROL']),
  }),
});
export type StudentJoinResponse = z.infer<typeof StudentJoinResponseSchema>;
