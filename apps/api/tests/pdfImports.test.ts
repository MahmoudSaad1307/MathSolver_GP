import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { PdfImportJobResponse } from '@mathlens/shared';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createLogger } from '../src/lib/logger.js';
import { signTeacherAccessToken } from '../src/lib/security.js';
import { TEACHER_ACCESS_COOKIE } from '../src/middleware/auth.js';
import type {
  AiExtractExamPdfInput,
  AiExtractExamPdfResponse,
  AiServiceClient,
} from '../src/services/aiClient.js';
import type {
  PdfImportDispatcher,
  PdfImportJobPayload,
} from '../src/services/pdfImportDispatcher.js';
import { PdfImportService } from '../src/services/pdfImportService.js';
import { RetentionService } from '../src/services/retentionService.js';
import { LocalDiskStorageAdapter } from '../src/services/storage/localStorage.js';
import { createInMemoryPrisma } from './helpers/fakePrisma.js';
import { createTestEnv } from './helpers/testEnv.js';

const FAKE_PDF_BYTES = Buffer.from(
  '%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF',
  'ascii',
);
const FAKE_JPEG_B64 = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
]).toString('base64');

function createFakeAiClient(): { client: AiServiceClient; calls: AiExtractExamPdfInput[] } {
  const calls: AiExtractExamPdfInput[] = [];
  const client: AiServiceClient = {
    gradeEssay: () => Promise.reject(new Error('not used')),
    transcribeOnly: () => Promise.reject(new Error('not used')),
    extractExamPdf: async (input: AiExtractExamPdfInput): Promise<AiExtractExamPdfResponse> => {
      calls.push(input);
      const models: AiExtractExamPdfResponse['models'] = [];
      const renderedPages: AiExtractExamPdfResponse['renderedPages'] = [];

      if (input.preModel) {
        renderedPages.push({
          modelNumber: 1,
          pageNumber: 1,
          imageBase64: FAKE_JPEG_B64,
          mimeType: 'image/jpeg',
          role: 'QUESTIONS',
          hasTextLayer: true,
          isBlank: false,
        });
        models.push({
          modelNumber: 1,
          title: input.preModel.title,
          durationMinutes: input.preModel.durationMinutes,
          pageCount: 1,
          pages: [{ pageNumber: 1, role: 'QUESTIONS', hasTextLayer: true, isBlank: false }],
          questionsFoundCount: 2,
          answersFoundCount: 2,
          matchedCount: 2,
          unmatchedQuestionNumbers: [],
          unmatchedAnswerNumbers: [],
          reportWarnings: [],
          questions: [
            {
              tempId: 'm1-q1',
              orderIndex: 1,
              conceptKey: 'linear-eq',
              type: 'MCQ',
              promptLatex: 'Solve $2x = 10$',
              points: 2,
              solutionUrl: null,
              needsTeacherConfirmation: false,
              mcqOptions: [
                { label: 'A', textLatex: '$3$', isCorrect: false },
                { label: 'B', textLatex: '$5$', isCorrect: true },
                { label: 'C', textLatex: '$7$', isCorrect: false },
                { label: 'D', textLatex: '$9$', isCorrect: false },
              ],
              modelAnswer: null,
              ocrConfidence: 0.97,
              dualOcrAgreed: true,
              sympyStatus: 'VERIFIED',
              sympyDetail: 'Consistent',
              sourceQuestionPages: [1],
              sourceAnswerPages: [1],
              warnings: [],
              verifiedByTeacher: false,
            },
            {
              tempId: 'm1-q2',
              orderIndex: 2,
              conceptKey: 'deriv-basic',
              type: 'ESSAY',
              promptLatex: 'Differentiate $x^2 + 3x$',
              points: 5,
              solutionUrl: null,
              needsTeacherConfirmation: true,
              modelAnswer: {
                solutionStepsLatex: ['$2x + 3$'],
                finalAnswerLatex: '2x + 3',
                finalAnswerSympy: '2*x + 3',
                commonMistakes: '',
              },
              rubricCriteria: [
                {
                  orderIndex: 1,
                  key: 'method',
                  descriptionEn: 'Power rule',
                  descriptionAr: 'قاعدة القوة',
                  maxPoints: 3,
                },
                {
                  orderIndex: 2,
                  key: 'final_answer',
                  descriptionEn: 'Final derivative',
                  descriptionAr: 'المشتقة النهائية',
                  maxPoints: 2,
                },
              ],
              ocrConfidence: 0.72,
              dualOcrAgreed: true,
              sympyStatus: 'VERIFIED',
              sympyDetail: 'Identical',
              sourceQuestionPages: [1],
              sourceAnswerPages: [1],
              warnings: [
                {
                  code: 'OCR_LOW_CONFIDENCE',
                  severity: 'warning',
                  messageEn: 'Low OCR confidence (72%).',
                  messageAr: 'دقة قراءة منخفضة (72%).',
                },
              ],
              verifiedByTeacher: false,
            },
          ],
        });
      }

      if (input.postModel) {
        renderedPages.push({
          modelNumber: 2,
          pageNumber: 1,
          imageBase64: FAKE_JPEG_B64,
          mimeType: 'image/jpeg',
          role: 'QUESTIONS',
          hasTextLayer: true,
          isBlank: false,
        });
        models.push({
          modelNumber: 2,
          title: input.postModel.title,
          durationMinutes: input.postModel.durationMinutes,
          pageCount: 1,
          pages: [{ pageNumber: 1, role: 'QUESTIONS', hasTextLayer: true, isBlank: false }],
          questionsFoundCount: 1,
          answersFoundCount: 1,
          matchedCount: 1,
          unmatchedQuestionNumbers: [],
          unmatchedAnswerNumbers: [],
          reportWarnings: [],
          questions: [
            {
              tempId: 'm2-q1',
              orderIndex: 1,
              conceptKey: 'linear-eq',
              type: 'MCQ',
              promptLatex: 'Solve $3x = 15$',
              points: 2,
              solutionUrl: null,
              needsTeacherConfirmation: false,
              mcqOptions: [
                { label: 'A', textLatex: '$5$', isCorrect: true },
                { label: 'B', textLatex: '$6$', isCorrect: false },
                { label: 'C', textLatex: '$7$', isCorrect: false },
                { label: 'D', textLatex: '$8$', isCorrect: false },
              ],
              modelAnswer: null,
              ocrConfidence: 0.98,
              dualOcrAgreed: true,
              sympyStatus: 'VERIFIED',
              sympyDetail: 'Consistent',
              sourceQuestionPages: [1],
              sourceAnswerPages: [1],
              warnings: [],
              verifiedByTeacher: false,
            },
          ],
        });
      }

      return Promise.resolve({
        models,
        renderedPages,
        twinSummary: {
          matchedConceptKeys: input.preModel && input.postModel ? ['linear-eq'] : [],
          onlyInModel1: input.preModel ? ['deriv-basic'] : [],
          onlyInModel2: [],
        },
        telemetry: {
          provider: 'fake',
          secondaryProvider: null,
          totalInputTokens: 500,
          totalOutputTokens: 320,
          totalCostUsd: 0.004,
          latencyMs: 42,
        },
      });
    },
  };
  return { client, calls };
}

describe('PDF import API & worker lifecycle', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tempDirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  async function setupHarness() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mathlens-pdf-test-'));
    tempDirs.push(dir);
    const env = createTestEnv();
    const logger = createLogger('silent');
    const prisma = createInMemoryPrisma();
    const storage = new LocalDiskStorageAdapter(dir, env.VIDEO_UNLOCK_HMAC_SECRET);
    const { client: aiClient, calls: aiCalls } = createFakeAiClient();
    const enqueuedJobs: PdfImportJobPayload[] = [];
    const dispatcher: PdfImportDispatcher = {
      enqueue: (payload) => {
        enqueuedJobs.push(payload);
        return Promise.resolve();
      },
    };
    const workerService = new PdfImportService({
      prisma,
      env,
      storage,
      aiClient,
      dispatcher,
    });
    const app = createApp({
      env,
      prisma,
      logger,
      storage,
      aiClient,
      pdfImportDispatcher: dispatcher,
    });
    const teacher = {
      id: crypto.randomUUID(),
      email: 'teacher@mathlens.local',
      passwordHash: 'hashed',
      displayName: 'Teacher Test',
      role: 'TEACHER' as const,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };
    prisma._state.users.push(teacher);
    const accessToken = signTeacherAccessToken(
      { id: teacher.id, email: teacher.email, role: teacher.role },
      env,
    );
    const cookieHeader = `${TEACHER_ACCESS_COOKIE}=${accessToken}`;
    return {
      app,
      env,
      prisma,
      storage,
      aiCalls,
      enqueuedJobs,
      workerService,
      teacher,
      cookieHeader,
    };
  }

  it('requires authentication and rejects non-PDF or empty payloads', async () => {
    const { app, cookieHeader } = await setupHarness();

    await request(app).post('/api/v1/pdf-imports').expect(401);

    const badRes = await request(app)
      .post('/api/v1/pdf-imports')
      .set('Cookie', cookieHeader)
      .attach('prePdf', Buffer.from('not-a-pdf-file'), 'bad.pdf')
      .expect(400);
    expect((badRes.body as { error: { code: string } }).error.code).toBe('PDF_INVALID');
  });

  it('queues, processes, previews page JPEG, edits draft, enforces confirmation, and applies to new Topic', async () => {
    const { app, prisma, storage, enqueuedJobs, workerService, cookieHeader } =
      await setupHarness();

    const uploadRes = await request(app)
      .post('/api/v1/pdf-imports')
      .set('Cookie', cookieHeader)
      .field('topicTitle', 'Calculus Diagnostic Exam')
      .field('topicDescription', 'Imported from Word PDFs')
      .field('correctnessThreshold', '0.7')
      .attach('prePdf', FAKE_PDF_BYTES, 'pre.pdf')
      .attach('postPdf', FAKE_PDF_BYTES, 'post.pdf')
      .expect(202);

    const createdJob = (uploadRes.body as { job: PdfImportJobResponse }).job;
    expect(createdJob.status).toBe('QUEUED');
    expect(createdJob.hasPrePdf).toBe(true);
    expect(createdJob.hasPostPdf).toBe(true);
    expect(enqueuedJobs).toEqual([{ jobId: createdJob.id }]);

    await workerService.processJob(createdJob.id);

    const pollRes = await request(app)
      .get(`/api/v1/pdf-imports/${createdJob.id}`)
      .set('Cookie', cookieHeader)
      .expect(200);
    const readyJob = (pollRes.body as { job: PdfImportJobResponse }).job;
    expect(readyJob.status).toBe('READY_FOR_REVIEW');
    expect(readyJob.preview?.models).toHaveLength(2);
    expect(readyJob.preview?.models[0]?.pages[0]?.imageUrl).toBe(
      `/api/v1/pdf-imports/${createdJob.id}/pages/1/1`,
    );

    const imgRes = await request(app)
      .get(`/api/v1/pdf-imports/${createdJob.id}/pages/1/1`)
      .set('Cookie', cookieHeader)
      .expect(200);
    expect(imgRes.headers['content-type']).toContain('image/jpeg');

    // Attempt apply before verifying flagged Q2 -> rejected cleanly
    const models = readyJob.preview!.models;
    const unverifiedRes = await request(app)
      .post(`/api/v1/pdf-imports/${createdJob.id}/apply`)
      .set('Cookie', cookieHeader)
      .send({
        models: models.map((m) => ({
          modelNumber: m.modelNumber,
          title: m.title,
          durationMinutes: m.durationMinutes,
          questions: m.questions,
        })),
      })
      .expect(400);
    expect((unverifiedRes.body as { error: { code: string } }).error.code).toBe('VALIDATION_ERROR');

    // Edit draft & verify flagged Q2
    models[0]!.questions[1]!.verifiedByTeacher = true;
    models[0]!.questions[1]!.promptLatex = 'Differentiate $x^2 + 3x$ with respect to $x$';

    const draftRes = await request(app)
      .put(`/api/v1/pdf-imports/${createdJob.id}/draft`)
      .set('Cookie', cookieHeader)
      .send({
        models: models.map((m) => ({
          modelNumber: m.modelNumber,
          title: m.title,
          durationMinutes: m.durationMinutes,
          questions: m.questions,
        })),
      })
      .expect(200);
    expect(
      (draftRes.body as { job: PdfImportJobResponse }).job.preview?.models[0]?.questions[1]
        ?.verifiedByTeacher,
    ).toBe(true);

    // Apply atomically
    const applyRes = await request(app)
      .post(`/api/v1/pdf-imports/${createdJob.id}/apply`)
      .set('Cookie', cookieHeader)
      .send({
        models: models.map((m) => ({
          modelNumber: m.modelNumber,
          title: m.title,
          durationMinutes: m.durationMinutes,
          questions: m.questions,
        })),
      })
      .expect(200);

    const appliedBody = applyRes.body as {
      job: PdfImportJobResponse;
      topic: { id: string; title: string; examModels: Array<{ totalPoints: number }> };
    };
    expect(appliedBody.job.status).toBe('APPLIED');
    expect(appliedBody.job.appliedTopicId).toBe(appliedBody.topic.id);
    expect(appliedBody.topic.title).toBe('Calculus Diagnostic Exam');
    expect(prisma._state.aiUsages.some((u) => u.operation === 'pdf_extract' && u.success)).toBe(
      true,
    );
    expect(prisma._state.auditLogs.some((a) => a.action === 'PDF_IMPORT_APPLIED')).toBe(true);

    // Expired retention purge removes PDFs and rendered JPEGs
    const retention = new RetentionService(prisma, createTestEnv(), storage);
    await prisma.pdfImportJob.update({
      where: { id: createdJob.id },
      data: { expiresAt: new Date(Date.now() - 10_000) },
    });
    const purgeResult = await retention.purgeExpiredPdfImports(new Date());
    expect(purgeResult.deletedJobs).toBe(1);
    expect(prisma._state.pdfImportJobs).toHaveLength(0);
  });

  it('passes Model 1 twin references when importing Post-Model PDF alone into an existing topic', async () => {
    const { app, prisma, aiCalls, workerService, teacher, cookieHeader } = await setupHarness();

    const topic = await prisma.topic.create({
      data: { ownerId: teacher.id, title: 'Existing Pre Topic', correctnessThreshold: 0.6 },
    });
    const m1 = await prisma.examModel.create({
      data: {
        topicId: topic.id,
        modelNumber: 1,
        title: 'Pre',
        durationMinutes: 45,
        status: 'PUBLISHED',
      },
    });
    await prisma.question.create({
      data: {
        examModelId: m1.id,
        orderIndex: 1,
        conceptKey: 'linear-eq',
        type: 'MCQ',
        promptLatex: 'Solve $2x = 10$',
        points: 2,
      },
    });

    const uploadRes = await request(app)
      .post('/api/v1/pdf-imports')
      .set('Cookie', cookieHeader)
      .field('topicId', topic.id)
      .attach('postPdf', FAKE_PDF_BYTES, 'post.pdf')
      .expect(202);

    const jobId = (uploadRes.body as { job: PdfImportJobResponse }).job.id;
    await workerService.processJob(jobId);

    expect(aiCalls).toHaveLength(1);
    expect(aiCalls[0]?.preModel).toBeUndefined();
    expect(aiCalls[0]?.postModel).toBeDefined();
    expect(aiCalls[0]?.referenceModel1Questions).toEqual([
      { conceptKey: 'linear-eq', promptLatex: 'Solve $2x = 10$', type: 'MCQ' },
    ]);
  });
});
