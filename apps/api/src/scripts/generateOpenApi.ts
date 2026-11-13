import fs from 'node:fs/promises';
import path from 'node:path';
import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import {
  AnalyticsQuerySchema,
  ApiErrorSchema,
  CreateCohortSchema,
  CreateTopicSchema,
  ImportExamBundleSchema,
  ManualGradeSchema,
  McqAutosaveSchema,
  MeStateResponseSchema,
  PinImageSchema,
  RandomizeRosterSplitSchema,
  ReportMisreadSchema,
  ReviewQueueQuerySchema,
  StudentConsentSchema,
  StudentJoinResponseSchema,
  StudentJoinSchema,
  StudentResumeSchema,
  StudentsQuerySchema,
  TeacherLoginSchema,
  TeacherOverrideSchema,
  TeacherProfileSchema,
  UnlockPostTestSchema,
  UpdateCohortSchema,
  UpdateExamModelSchema,
  UpdateRubricSchema,
  UpdateTopicSchema,
  UpsertQuestionSchema,
  UsageQuerySchema,
  VideoAlertSchema,
  VideoHeartbeatSchema,
} from '@mathlens/shared';

extendZodWithOpenApi(z);

const registry = new OpenAPIRegistry();

const UuidPathParams = z.object({ id: z.string().uuid() });
const AttemptAnswerPathParams = z.object({
  attemptId: z.string().uuid(),
  questionId: z.string().uuid(),
});
const OkResponseSchema = z.object({ ok: z.boolean() });
const StartAttemptSchema = z.object({
  modelNumber: z.union([z.literal(1), z.literal(2)]).default(1),
});

function errorResponse(description: string) {
  return {
    description,
    content: { 'application/json': { schema: ApiErrorSchema } },
  };
}

// --- Operations & Observability ---
registry.registerPath({
  method: 'get',
  path: '/healthz',
  tags: ['Operations'],
  responses: { 200: { description: 'Liveness probe OK' } },
});

registry.registerPath({
  method: 'get',
  path: '/readyz',
  tags: ['Operations'],
  responses: {
    200: { description: 'Database & Redis ready' },
    503: { description: 'Dependency unavailable' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/metrics',
  tags: ['Operations'],
  responses: { 200: { description: 'Prometheus metrics text exposition' } },
});

// --- Teacher Auth ---
registry.registerPath({
  method: 'post',
  path: '/api/v1/auth/teacher/login',
  tags: ['Teacher Auth'],
  request: { body: { content: { 'application/json': { schema: TeacherLoginSchema } } } },
  responses: {
    200: {
      description: 'Authenticated teacher profile (httpOnly access & refresh cookies set)',
      content: { 'application/json': { schema: z.object({ teacher: TeacherProfileSchema }) } },
    },
    401: errorResponse('Invalid credentials'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/auth/teacher/refresh',
  tags: ['Teacher Auth'],
  responses: {
    200: {
      description: 'Rotated access & refresh cookies',
      content: { 'application/json': { schema: z.object({ teacher: TeacherProfileSchema }) } },
    },
    401: errorResponse('Missing, expired, or reused refresh token'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/auth/teacher/logout',
  tags: ['Teacher Auth'],
  responses: {
    200: {
      description: 'Logged out current teacher session',
      content: { 'application/json': { schema: OkResponseSchema } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/auth/teacher/logout-all',
  tags: ['Teacher Auth'],
  responses: {
    200: {
      description: 'All teacher refresh token families revoked',
      content: { 'application/json': { schema: OkResponseSchema } },
    },
    401: errorResponse('Unauthorized'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/auth/teacher/me',
  tags: ['Teacher Auth'],
  responses: {
    200: {
      description: 'Current authenticated teacher profile',
      content: { 'application/json': { schema: z.object({ teacher: TeacherProfileSchema }) } },
    },
    401: errorResponse('Unauthorized'),
  },
});

// --- Topics, Exam Models & Questions ---
registry.registerPath({
  method: 'get',
  path: '/api/v1/topics',
  tags: ['Teacher Content'],
  responses: {
    200: { description: 'List teacher-owned topics' },
    401: errorResponse('Unauthorized'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/topics',
  tags: ['Teacher Content'],
  request: { body: { content: { 'application/json': { schema: CreateTopicSchema } } } },
  responses: { 201: { description: 'Created topic with paired DRAFT Model 1 & Model 2' } },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/topics/{id}',
  tags: ['Teacher Content'],
  request: { params: UuidPathParams },
  responses: { 200: { description: 'Topic details' }, 404: errorResponse('Not found') },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/topics/{id}',
  tags: ['Teacher Content'],
  request: {
    params: UuidPathParams,
    body: { content: { 'application/json': { schema: UpdateTopicSchema } } },
  },
  responses: { 200: { description: 'Updated topic' } },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/topics/{id}',
  tags: ['Teacher Content'],
  request: { params: UuidPathParams },
  responses: { 204: { description: 'Soft-deleted topic' } },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/topics/{id}/exams',
  tags: ['Teacher Content'],
  request: { params: UuidPathParams },
  responses: { 200: { description: 'Paired Model 1 & Model 2 plus publish checklist' } },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/topics/{id}/export',
  tags: ['Teacher Content'],
  request: { params: UuidPathParams },
  responses: { 200: { description: 'Exported JSON exam bundle' } },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/exams/import',
  tags: ['Teacher Content'],
  request: { body: { content: { 'application/json': { schema: ImportExamBundleSchema } } } },
  responses: { 200: { description: 'Dry-run diff or imported topic bundle' } },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/exams/{id}',
  tags: ['Teacher Content'],
  request: { params: UuidPathParams },
  responses: { 200: { description: 'Exam model with ordered questions' } },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/exams/{id}',
  tags: ['Teacher Content'],
  request: {
    params: UuidPathParams,
    body: { content: { 'application/json': { schema: UpdateExamModelSchema } } },
  },
  responses: { 200: { description: 'Updated exam model metadata' } },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/exams/{id}/publish',
  tags: ['Teacher Content'],
  request: { params: UuidPathParams },
  responses: {
    200: { description: 'Published exam model after passing rubric & twin checklist' },
    400: errorResponse('Publish checklist failed'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/exams/{id}/unpublish',
  tags: ['Teacher Content'],
  request: { params: UuidPathParams },
  responses: { 200: { description: 'Returned exam model to DRAFT status' } },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/exams/{id}/questions',
  tags: ['Teacher Content'],
  request: {
    params: UuidPathParams,
    body: { content: { 'application/json': { schema: UpsertQuestionSchema } } },
  },
  responses: { 201: { description: 'Question created' } },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/questions/{id}',
  tags: ['Teacher Content'],
  request: {
    params: UuidPathParams,
    body: { content: { 'application/json': { schema: UpsertQuestionSchema } } },
  },
  responses: { 200: { description: 'Question updated' } },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/questions/{id}',
  tags: ['Teacher Content'],
  request: { params: UuidPathParams },
  responses: { 204: { description: 'Soft-deleted question' } },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/questions/{id}/confirm',
  tags: ['Teacher Content'],
  request: { params: UuidPathParams },
  responses: { 200: { description: 'Confirmed placeholder question for publishing' } },
});

registry.registerPath({
  method: 'put',
  path: '/api/v1/questions/{id}/rubric',
  tags: ['Teacher Content'],
  request: {
    params: UuidPathParams,
    body: { content: { 'application/json': { schema: UpdateRubricSchema } } },
  },
  responses: { 200: { description: 'Updated rubric criteria and incremented rubricVersion' } },
});

// --- Cohorts & Privacy Erasure ---
registry.registerPath({
  method: 'get',
  path: '/api/v1/cohorts',
  tags: ['Cohorts'],
  responses: { 200: { description: 'List teacher-owned cohorts' } },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/cohorts',
  tags: ['Cohorts'],
  request: { body: { content: { 'application/json': { schema: CreateCohortSchema } } } },
  responses: { 201: { description: 'Cohort created with unique 6-character joinCode' } },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/cohorts/randomize-split',
  tags: ['Cohorts'],
  request: { body: { content: { 'application/json': { schema: RandomizeRosterSplitSchema } } } },
  responses: { 200: { description: 'Deterministic seeded 50/50 TREATMENT/CONTROL split' } },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/cohorts/{id}',
  tags: ['Cohorts'],
  request: { params: UuidPathParams },
  responses: { 200: { description: 'Cohort details' } },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/cohorts/{id}',
  tags: ['Cohorts'],
  request: {
    params: UuidPathParams,
    body: { content: { 'application/json': { schema: UpdateCohortSchema } } },
  },
  responses: { 200: { description: 'Updated cohort settings' } },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/cohorts/{id}',
  tags: ['Cohorts'],
  request: { params: UuidPathParams },
  responses: { 204: { description: 'Soft-deleted cohort' } },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/cohorts/{id}/data',
  tags: ['Cohorts'],
  request: { params: UuidPathParams },
  responses: {
    200: { description: 'Purged all cohort student answer images & anonymized students' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/cohorts/{id}/open-posttest',
  tags: ['Cohorts'],
  request: { params: UuidPathParams },
  responses: { 200: { description: 'Immediately opened Model 2 post-test for a CONTROL cohort' } },
});

// --- Teacher Review, Roster & Manual Unlocks ---
registry.registerPath({
  method: 'get',
  path: '/api/v1/review-queue',
  tags: ['Teacher Review'],
  request: { query: ReviewQueueQuerySchema },
  responses: { 200: { description: 'List essays awaiting or resolved in human review queue' } },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/grading-results/{id}/override',
  tags: ['Teacher Review'],
  request: {
    params: UuidPathParams,
    body: { content: { 'application/json': { schema: TeacherOverrideSchema } } },
  },
  responses: { 200: { description: 'Clamped teacher override recorded (history preserved)' } },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/answers/{id}/manual-grade',
  tags: ['Teacher Review'],
  request: {
    params: UuidPathParams,
    body: { content: { 'application/json': { schema: ManualGradeSchema } } },
  },
  responses: { 200: { description: 'Manual grade persisted cleanly when AI fallback occurred' } },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/answers/{id}/retranscribe',
  tags: ['Teacher Review'],
  request: { params: UuidPathParams },
  responses: { 202: { description: 'Enqueued forceRefresh re-transcription & grading job' } },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/answer-images/{id}/pin',
  tags: ['Teacher Review'],
  request: {
    params: UuidPathParams,
    body: { content: { 'application/json': { schema: PinImageSchema } } },
  },
  responses: { 200: { description: 'Updated pinnedByTeacher retention exemption flag' } },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/students',
  tags: ['Teacher Review'],
  request: { query: StudentsQuerySchema },
  responses: { 200: { description: 'Student roster filtered to teacher-owned cohorts' } },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/students/{id}',
  tags: ['Teacher Review'],
  request: { params: UuidPathParams },
  responses: { 200: { description: 'Student detail with attempts, video session & audit trail' } },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/students/{id}/unlock-posttest',
  tags: ['Teacher Review'],
  request: {
    params: UuidPathParams,
    body: { content: { 'application/json': { schema: UnlockPostTestSchema } } },
  },
  responses: { 200: { description: 'Manually unlocked Model 2 for student with audit log' } },
});

// --- Analytics, Usage & Exports ---
registry.registerPath({
  method: 'get',
  path: '/api/v1/analytics',
  tags: ['Analytics'],
  request: { query: AnalyticsQuerySchema },
  responses: {
    200: {
      description: 'Cohort pre/post analytics, SciPy/statsmodels tests, McNemar & AI reliability',
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/usage',
  tags: ['Analytics'],
  request: { query: UsageQuerySchema },
  responses: { 200: { description: 'AI token spend, latency percentiles & daily cap progress' } },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/cohorts/{id}/export.csv',
  tags: ['Analytics'],
  request: { params: UuidPathParams },
  responses: { 200: { description: 'UTF-8 BOM formula-sanitized CSV cohort export' } },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/cohorts/{id}/export.xlsx',
  tags: ['Analytics'],
  request: { params: UuidPathParams },
  responses: {
    200: {
      description:
        'Multi-sheet Excel workbook (Summary, Students, PerQuestion, VideoEvents, Overrides)',
    },
  },
});

// --- Student Flow, Exam, Results, Video & Comparison ---
registry.registerPath({
  method: 'post',
  path: '/api/v1/student/join',
  tags: ['Student'],
  request: { body: { content: { 'application/json': { schema: StudentJoinSchema } } } },
  responses: {
    201: {
      description:
        'Joined cohort and issued httpOnly student session cookie + printable resumeCode',
      content: { 'application/json': { schema: StudentJoinResponseSchema } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/student/resume',
  tags: ['Student'],
  request: { body: { content: { 'application/json': { schema: StudentResumeSchema } } } },
  responses: {
    200: { description: 'Student session restored from resumeCode' },
    429: errorResponse('Rate limited'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/student/logout',
  tags: ['Student'],
  responses: { 200: { description: 'Student cookie cleared' } },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/student/consent',
  tags: ['Student'],
  request: { body: { content: { 'application/json': { schema: StudentConsentSchema } } } },
  responses: { 200: { description: 'Consent timestamp persisted' } },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/student/me/state',
  tags: ['Student'],
  responses: {
    200: {
      description: 'Authoritative student state machine snapshot',
      content: { 'application/json': { schema: MeStateResponseSchema } },
    },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/student/data',
  tags: ['Student'],
  responses: { 200: { description: 'Student privacy self-erasure completed and cookie cleared' } },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/student/attempts',
  tags: ['Student'],
  request: { body: { content: { 'application/json': { schema: StartAttemptSchema } } } },
  responses: {
    200: { description: 'Started or resumed attempt (1 or 2)' },
    403: errorResponse('POSTTEST_LOCKED'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/student/attempts/{id}',
  tags: ['Student'],
  request: { params: UuidPathParams },
  responses: {
    200: { description: 'Sanitized exam payload (solution keys omitted during active attempt)' },
  },
});

registry.registerPath({
  method: 'put',
  path: '/api/v1/student/answers/{id}',
  tags: ['Student'],
  request: {
    params: UuidPathParams,
    body: { content: { 'application/json': { schema: McqAutosaveSchema } } },
  },
  responses: { 200: { description: 'MCQ answer autosaved' } },
});

registry.registerPath({
  method: 'put',
  path: '/api/v1/student/attempts/{attemptId}/answers/{questionId}',
  tags: ['Student'],
  request: {
    params: AttemptAnswerPathParams,
    body: { content: { 'application/json': { schema: McqAutosaveSchema } } },
  },
  responses: { 200: { description: 'MCQ answer autosaved by attempt + question id' } },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/student/answers/{id}/images',
  tags: ['Student'],
  responses: {
    201: { description: 'Sanitized handwritten JPEG uploaded to storage & linked cleanly' },
    400: errorResponse('Invalid image upload'),
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/student/answer-images/{id}',
  tags: ['Student'],
  request: { params: UuidPathParams },
  responses: { 204: { description: 'Answer image deleted before submit' } },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/student/attempts/{id}/submit',
  tags: ['Student'],
  request: { params: UuidPathParams },
  responses: { 200: { description: 'Idempotent submission; MCQ graded + essay jobs enqueued' } },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/student/attempts/{id}/results',
  tags: ['Student'],
  request: { params: UuidPathParams },
  responses: {
    200: { description: 'Per-question feedback, timestamps & Arabic error explanations' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/student/answers/{id}/report-misread',
  tags: ['Student'],
  request: {
    params: UuidPathParams,
    body: { content: { 'application/json': { schema: ReportMisreadSchema } } },
  },
  responses: { 200: { description: 'Flagged AI transcription for teacher review' } },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/student/video/state',
  tags: ['Student Video'],
  responses: {
    200: { description: 'Video progress, wrong question timestamp shortcuts & unlock status' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/student/video/heartbeat',
  tags: ['Student Video'],
  request: { body: { content: { 'application/json': { schema: VideoHeartbeatSchema } } } },
  responses: {
    200: { description: 'Interval-merged watch time update (rejects seek jumps & >1.5x)' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/student/video/alert',
  tags: ['Student Video'],
  request: { body: { content: { 'application/json': { schema: VideoAlertSchema } } } },
  responses: { 201: { description: 'Recorded YouTube player error alert for teacher visibility' } },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/student/comparison',
  tags: ['Student Video'],
  responses: {
    200: { description: 'Pre vs Post comparison with Hake normalized gain & concept breakdown' },
  },
});

async function main() {
  const generator = new OpenApiGeneratorV3(registry.definitions);
  const doc = generator.generateDocument({
    openapi: '3.0.3',
    info: {
      title: 'MathLens API',
      version: '1.0.0',
      description: 'REST API for MathLens AI-Graded Handwritten Math Exams with Video Remediation',
    },
  });

  const outPath = path.resolve(process.cwd(), '../../docs/API.md');
  const md = `# MathLens API Reference\n\nGenerated from Zod schemas via \`npm run docs:openapi\`.\n\n\`\`\`json\n${JSON.stringify(doc, null, 2)}\n\`\`\`\n`;
  await fs.writeFile(outPath, md, 'utf8');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
