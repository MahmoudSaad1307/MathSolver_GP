import { z } from 'zod';
import { AttemptStatusSchema, StudentFlowStepSchema, VideoEventTypeSchema } from '../enums.js';

export const MeStateResponseSchema = z.object({
  step: StudentFlowStepSchema,
  student: z.object({
    id: z.string().uuid(),
    displayName: z.string(),
    cohortId: z.string().uuid(),
    cohortName: z.string(),
    group: z.enum(['TREATMENT', 'CONTROL']),
    requireVideoBeforePost: z.boolean(),
    consentAcceptedAt: z.string().datetime().nullable(),
  }),
  topic: z.object({
    id: z.string().uuid(),
    title: z.string(),
    videoId: z.string().nullable(),
    minWatchSeconds: z.number().int(),
  }),
  preTestAttempt: z
    .object({
      id: z.string().uuid(),
      examModelId: z.string().uuid(),
      status: AttemptStatusSchema,
      deadlineAt: z.string().datetime(),
    })
    .nullable(),
  postTestAttempt: z
    .object({
      id: z.string().uuid(),
      examModelId: z.string().uuid(),
      status: AttemptStatusSchema,
      deadlineAt: z.string().datetime(),
    })
    .nullable(),
  postTestLockReason: z
    .object({
      code: z.string(),
      message_ar: z.string(),
      message_en: z.string(),
    })
    .nullable(),
  videoProgress: z.object({
    watchedSeconds: z.number().int(),
    minWatchSeconds: z.number().int(),
    unlockedPostAt: z.string().datetime().nullable(),
  }),
});
export type MeStateResponse = z.infer<typeof MeStateResponseSchema>;

export const McqAutosaveSchema = z.object({
  selectedOptionId: z.string().uuid().nullable(),
});
export type McqAutosaveInput = z.infer<typeof McqAutosaveSchema>;

export const ReportMisreadSchema = z.object({
  note: z.string().trim().max(500).optional(),
});
export type ReportMisreadInput = z.infer<typeof ReportMisreadSchema>;

export const VideoHeartbeatSchema = z.object({
  type: VideoEventTypeSchema,
  position: z.number().min(0).max(86400),
  playbackRate: z.number().min(0.25).max(4).default(1),
  tabVisible: z.boolean().default(true),
  clientTs: z.string().datetime(),
  questionId: z.string().uuid().optional(),
  playerErrorCode: z.number().int().optional(),
});
export type VideoHeartbeatInput = z.infer<typeof VideoHeartbeatSchema>;
