import fs from 'node:fs/promises';
import path from 'node:path';
import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import {
  ApiErrorSchema,
  McqAutosaveSchema,
  ReportMisreadSchema,
  StudentConsentSchema,
  StudentJoinResponseSchema,
  StudentJoinSchema,
  StudentResumeSchema,
  TeacherLoginSchema,
  TeacherProfileSchema,
  VideoHeartbeatSchema,
} from '@mathlens/shared';

extendZodWithOpenApi(z);

const registry = new OpenAPIRegistry();

registry.registerPath({
  method: 'post',
  path: '/api/v1/auth/teacher/login',
  tags: ['Teacher Auth'],
  request: {
    body: { content: { 'application/json': { schema: TeacherLoginSchema } } },
  },
  responses: {
    200: {
      description: 'Authenticated teacher profile (cookies set)',
      content: { 'application/json': { schema: z.object({ teacher: TeacherProfileSchema }) } },
    },
    401: {
      description: 'Invalid credentials',
      content: { 'application/json': { schema: ApiErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/auth/teacher/refresh',
  tags: ['Teacher Auth'],
  responses: {
    200: { description: 'Rotated access & refresh cookies' },
    401: { description: 'Unauthorized' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/auth/teacher/logout',
  tags: ['Teacher Auth'],
  responses: { 200: { description: 'Logged out' } },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/auth/teacher/logout-all',
  tags: ['Teacher Auth'],
  responses: { 200: { description: 'All teacher sessions revoked' } },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/join',
  tags: ['Student'],
  request: { body: { content: { 'application/json': { schema: StudentJoinSchema } } } },
  responses: {
    201: {
      description: 'Joined cohort',
      content: { 'application/json': { schema: StudentJoinResponseSchema } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/resume',
  tags: ['Student'],
  request: { body: { content: { 'application/json': { schema: StudentResumeSchema } } } },
  responses: { 200: { description: 'Session restored' } },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/consent',
  tags: ['Student'],
  request: { body: { content: { 'application/json': { schema: StudentConsentSchema } } } },
  responses: { 200: { description: 'Consent recorded' } },
});

registry.registerPath({
  method: 'put',
  path: '/api/v1/attempts/{id}/answers/{qid}',
  tags: ['Student'],
  request: { body: { content: { 'application/json': { schema: McqAutosaveSchema } } } },
  responses: { 200: { description: 'MCQ answer saved' } },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/answers/{id}/report-misread',
  tags: ['Student'],
  request: { body: { content: { 'application/json': { schema: ReportMisreadSchema } } } },
  responses: { 200: { description: 'Flagged for teacher review' } },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/video/heartbeat',
  tags: ['Student'],
  request: { body: { content: { 'application/json': { schema: VideoHeartbeatSchema } } } },
  responses: { 200: { description: 'Heartbeat processed' } },
});

async function main() {
  const generator = new OpenApiGeneratorV3(registry.definitions);
  const doc = generator.generateDocument({
    openapi: '3.0.3',
    info: {
      title: 'MathLens API',
      version: '1.0.0',
      description: 'REST API for MathLens AI-Graded Math Exams with Video Remediation',
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
