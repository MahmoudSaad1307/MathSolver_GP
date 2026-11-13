import { z } from 'zod';
import {
  CohortGroupSchema,
  CohortStatusSchema,
  ExamStatusSchema,
  GradingErrorTypeSchema,
  QuestionTypeSchema,
  ReviewReasonSchema,
} from '../enums.js';

export const CreateTopicSchema = z.object({
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(2000).default(''),
  videoUrl: z.string().trim().url().max(500),
  minWatchSeconds: z.number().int().min(10).max(7200).default(300),
  correctnessThreshold: z.number().min(0.1).max(1).default(0.6),
});
export type CreateTopicInput = z.infer<typeof CreateTopicSchema>;

export const UpdateTopicSchema = CreateTopicSchema.partial();
export type UpdateTopicInput = z.infer<typeof UpdateTopicSchema>;

export const McqOptionInputSchema = z.object({
  label: z.enum(['A', 'B', 'C', 'D']),
  textLatex: z.string().trim().min(1).max(2000),
  isCorrect: z.boolean(),
});

export const ModelAnswerInputSchema = z.object({
  solutionStepsLatex: z.array(z.string().trim().min(1).max(2000)).min(1),
  finalAnswerLatex: z.string().trim().min(1).max(1000),
  finalAnswerSympy: z.string().trim().max(500).nullable().optional(),
  commonMistakes: z.string().trim().max(4000).default(''),
});

export const RubricCriterionInputSchema = z.object({
  id: z.string().uuid().optional(),
  orderIndex: z.number().int().min(1),
  key: z.string().trim().min(1).max(100),
  descriptionEn: z.string().trim().min(1).max(1000),
  descriptionAr: z.string().trim().min(1).max(1000),
  maxPoints: z.number().positive().max(100),
});

export const UpsertQuestionSchema = z
  .object({
    orderIndex: z.number().int().min(1).max(100),
    conceptKey: z.string().trim().min(1).max(100),
    type: QuestionTypeSchema,
    promptLatex: z.string().trim().min(1).max(5000),
    points: z.number().positive().max(100),
    videoTimestampSeconds: z.number().int().min(0).max(86400).default(0),
    needsTeacherConfirmation: z.boolean().default(false),
    twinQuestionId: z.string().uuid().nullable().optional(),
    mcqOptions: z.array(McqOptionInputSchema).optional(),
    modelAnswer: ModelAnswerInputSchema.nullable().optional(),
    rubricCriteria: z.array(RubricCriterionInputSchema).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.type === 'MCQ') {
      if (!val.mcqOptions || val.mcqOptions.length !== 4) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['mcqOptions'],
          message: 'MCQ questions require exactly 4 options',
        });
      } else {
        const labels = new Set(val.mcqOptions.map((o) => o.label));
        const correctCount = val.mcqOptions.filter((o) => o.isCorrect).length;
        if (labels.size !== 4 || correctCount !== 1) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['mcqOptions'],
            message: 'MCQ options must have distinct labels A-D and exactly one correct option',
          });
        }
      }
    } else {
      if (!val.modelAnswer) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['modelAnswer'],
          message: 'Essay questions require a model answer',
        });
      }
      const criteria = val.rubricCriteria ?? [];
      const sum = criteria.reduce((acc, c) => acc + c.maxPoints, 0);
      if (criteria.length === 0 || Math.abs(sum - val.points) > 1e-6) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['rubricCriteria'],
          message: `Rubric sum (${sum}) must equal question points (${val.points})`,
        });
      }
    }
  });
export type UpsertQuestionInput = z.infer<typeof UpsertQuestionSchema>;

export const UpdateRubricSchema = z.object({
  criteria: z.array(RubricCriterionInputSchema).min(1),
});
export type UpdateRubricInput = z.infer<typeof UpdateRubricSchema>;

export const UpdateExamModelSchema = z.object({
  title: z.string().trim().min(2).max(200).optional(),
  durationMinutes: z.number().int().min(5).max(300).optional(),
  status: ExamStatusSchema.optional(),
});
export type UpdateExamModelInput = z.infer<typeof UpdateExamModelSchema>;

export const CreateCohortSchema = z.object({
  topicId: z.string().uuid(),
  name: z.string().trim().min(2).max(150),
  group: CohortGroupSchema,
  requireVideoBeforePost: z.boolean().optional(),
  requireWrongSegmentVisits: z.boolean().default(false),
  showProvisionalScore: z.boolean().default(false),
  postTestOpensAt: z.string().datetime().nullable().optional(),
});
export type CreateCohortInput = z.infer<typeof CreateCohortSchema>;

export const UpdateCohortSchema = z.object({
  name: z.string().trim().min(2).max(150).optional(),
  group: CohortGroupSchema.optional(),
  requireVideoBeforePost: z.boolean().optional(),
  requireWrongSegmentVisits: z.boolean().optional(),
  showProvisionalScore: z.boolean().optional(),
  postTestOpensAt: z.string().datetime().nullable().optional(),
  status: CohortStatusSchema.optional(),
});
export type UpdateCohortInput = z.infer<typeof UpdateCohortSchema>;

export const TeacherOverrideSchema = z.object({
  criteriaScores: z
    .array(
      z.object({
        criterionId: z.string().uuid(),
        awarded: z.number().min(0).max(100),
        commentAr: z.string().trim().max(1000).optional(),
      }),
    )
    .min(1),
  finalAnswerCorrect: z.boolean().optional(),
  errorType: GradingErrorTypeSchema.optional(),
  errorExplanationAr: z.string().trim().min(1).max(2000).optional(),
  note: z.string().trim().max(2000).optional(),
});
export type TeacherOverrideInput = z.infer<typeof TeacherOverrideSchema>;

export const ManualGradeSchema = TeacherOverrideSchema;
export type ManualGradeInput = z.infer<typeof ManualGradeSchema>;

export const PinImageSchema = z.object({
  pinned: z.boolean(),
});
export type PinImageInput = z.infer<typeof PinImageSchema>;

export const ReviewQueueQuerySchema = z.object({
  topicId: z.string().uuid().optional(),
  cohortId: z.string().uuid().optional(),
  reason: ReviewReasonSchema.optional(),
  includeResolved: z.enum(['true', 'false']).optional(),
});
export type ReviewQueueQuery = z.infer<typeof ReviewQueueQuerySchema>;

export const StudentsQuerySchema = z.object({
  cohortId: z.string().uuid().optional(),
  topicId: z.string().uuid().optional(),
  search: z.string().trim().max(100).optional(),
});
export type StudentsQuery = z.infer<typeof StudentsQuerySchema>;

export const UnlockPostTestSchema = z.object({
  note: z.string().trim().max(500).optional(),
});
export type UnlockPostTestInput = z.infer<typeof UnlockPostTestSchema>;

export const RandomizeRosterSplitSchema = z.object({
  studentNames: z.array(z.string().trim().min(2).max(60)).min(2).max(500),
  seed: z.number().int().optional(),
});
export type RandomizeRosterSplitInput = z.infer<typeof RandomizeRosterSplitSchema>;

export const AnalyticsQuerySchema = z.object({
  topicId: z.string().uuid().optional(),
  cohortId: z.string().uuid().optional(),
});
export type AnalyticsQueryInput = z.infer<typeof AnalyticsQuerySchema>;

export const UsageQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});
export type UsageQueryInput = z.infer<typeof UsageQuerySchema>;
