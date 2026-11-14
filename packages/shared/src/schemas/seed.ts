import { z } from 'zod';
import {
  McqOptionInputSchema,
  ModelAnswerInputSchema,
  OptionalSolutionUrlSchema,
  RubricCriterionInputSchema,
} from './teacher.js';
import { ExamStatusSchema, QuestionTypeSchema } from '../enums.js';

export const SeedQuestionSchema = z.object({
  orderIndex: z.number().int().min(1),
  conceptKey: z.string().trim().min(1),
  type: QuestionTypeSchema,
  promptLatex: z.string().trim().min(1),
  points: z.number().positive(),
  solutionUrl: OptionalSolutionUrlSchema,
  needsTeacherConfirmation: z.boolean().default(false),
  mcqOptions: z.array(McqOptionInputSchema).optional(),
  modelAnswer: ModelAnswerInputSchema.optional(),
  rubricCriteria: z.array(RubricCriterionInputSchema).optional(),
});

export const SeedExamModelSchema = z.object({
  modelNumber: z.union([z.literal(1), z.literal(2)]),
  title: z.string().trim().min(2),
  durationMinutes: z.number().int().min(5).default(60),
  status: ExamStatusSchema.default('DRAFT'),
  questions: z.array(SeedQuestionSchema).min(1),
});

export const SeedTopicBundleSchema = z.object({
  topic: z.object({
    title: z.string().trim().min(2),
    description: z.string().default(''),
    correctnessThreshold: z.number().min(0.1).max(1).default(0.6),
  }),
  models: z.tuple([SeedExamModelSchema, SeedExamModelSchema]),
});

export type SeedTopicBundle = z.infer<typeof SeedTopicBundleSchema>;

export const ImportExamBundleSchema = z.object({
  dryRun: z.boolean().default(false),
  targetTopicId: z.string().uuid().optional(),
  bundle: SeedTopicBundleSchema,
});
export type ImportExamBundleInput = z.infer<typeof ImportExamBundleSchema>;
