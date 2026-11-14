import crypto from 'node:crypto';
import type {
  ApplyPdfImportInput,
  ExtractedModelPreview,
  PdfImportJobResponse,
  PdfImportPreviewPayload,
  PdfImportTopicMeta,
  SavePdfDraftInput,
} from '@mathlens/shared';
import { PdfImportPreviewPayloadSchema, StrictApplyQuestionSchema } from '@mathlens/shared';
import type { Prisma, PrismaClient } from '@prisma/client';
import { fileTypeFromBuffer } from 'file-type';
import type { AppEnv } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import { hashIp } from '../lib/security.js';
import {
  AiServiceHttpError,
  type AiExtractExamPdfInput,
  type AiPdfTwinReferenceQuestion,
  type AiServiceClient,
} from './aiClient.js';
import {
  TOPIC_FULL_INCLUDE,
  createQuestionWithChildren,
  recalculateExamTotalPoints,
  serializeTopicWithStatus,
  softDeleteQuestionSubtree,
  syncTwinQuestionsForTopic,
  validateQuestionPayload,
} from './examPersistenceHelpers.js';
import type { PdfImportDispatcher } from './pdfImportDispatcher.js';
import { createVirusScanner, type StorageAdapter, type VirusScanner } from './storage/index.js';

function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

async function assertOwnedTopicExists(
  db: PrismaClient | Prisma.TransactionClient,
  topicId: string,
  ownerId: string,
): Promise<{ id: string }> {
  const topic = await db.topic.findFirst({
    where: { id: topicId, ownerId, deletedAt: null },
    select: { id: true },
  });
  if (!topic) {
    throw new AppError('NOT_FOUND', { messageEn: 'Topic not found.' });
  }
  return topic;
}

export interface UploadedPdfFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
}

interface StoredImportConfig {
  topicMeta: PdfImportTopicMeta | null;
  preTitle: string;
  postTitle: string;
  preDurationMinutes: number;
  postDurationMinutes: number;
}

type PageImageKeyMap = Record<string, Record<string, string>>;

interface PdfImportJobRow {
  id: string;
  ownerId: string;
  topicId: string | null;
  appliedTopicId: string | null;
  status: 'QUEUED' | 'PROCESSING' | 'READY_FOR_REVIEW' | 'APPLIED' | 'FAILED';
  currentStage: string;
  progressPct: number;
  prePdfKey: string | null;
  postPdfKey: string | null;
  pageImageKeys: unknown;
  topicMetaJson: unknown;
  previewJson: unknown;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
}

export interface PdfImportServiceDeps {
  prisma: PrismaClient;
  env: AppEnv;
  storage: StorageAdapter;
  aiClient: AiServiceClient;
  dispatcher: PdfImportDispatcher;
  virusScanner?: VirusScanner;
}

export interface CreatePdfImportJobInput {
  ownerId: string;
  topicId?: string;
  preFile?: UploadedPdfFile;
  postFile?: UploadedPdfFile;
  preTitle?: string;
  postTitle?: string;
  preDurationMinutes?: number;
  postDurationMinutes?: number;
  topicMeta?: PdfImportTopicMeta;
}

async function validateAndScanPdf(
  file: UploadedPdfFile,
  env: AppEnv,
  virusScanner: VirusScanner,
): Promise<void> {
  if (file.buffer.length === 0) {
    throw new AppError('PDF_INVALID', { messageEn: `${file.originalname} is empty.` });
  }
  if (file.buffer.length > env.MAX_PDF_BYTES) {
    throw new AppError('PDF_TOO_LARGE', {
      messageEn: `${file.originalname} exceeds maximum allowed size (${env.MAX_PDF_BYTES} bytes).`,
    });
  }

  const hasPdfSignature = file.buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  const detected = await fileTypeFromBuffer(file.buffer);
  const validMagic =
    hasPdfSignature &&
    (!detected || (detected.ext === 'pdf' && detected.mime === 'application/pdf'));
  if (!validMagic) {
    throw new AppError('PDF_INVALID', {
      messageEn: `${file.originalname} does not appear to be a valid PDF document.`,
    });
  }

  const scan = await virusScanner.scan(file.buffer);
  if (!scan.clean) {
    throw new AppError('INVALID_UPLOAD', {
      messageEn: `Uploaded PDF rejected by security scan: ${scan.reason ?? 'unknown threat'}`,
    });
  }
}

function computeTwinSummary(
  models: ExtractedModelPreview[],
  fallbackM1Keys: string[] = [],
): PdfImportPreviewPayload['twinSummary'] {
  const m1Keys = new Set(
    models.find((m) => m.modelNumber === 1)?.questions.map((q) => q.conceptKey) ?? fallbackM1Keys,
  );
  const m2Keys = new Set(
    models.find((m) => m.modelNumber === 2)?.questions.map((q) => q.conceptKey) ?? [],
  );
  const matchedConceptKeys = [...m1Keys].filter((k) => m2Keys.has(k)).sort();
  const onlyInModel1 = [...m1Keys].filter((k) => !m2Keys.has(k)).sort();
  const onlyInModel2 = [...m2Keys].filter((k) => !m1Keys.has(k)).sort();
  return { matchedConceptKeys, onlyInModel1, onlyInModel2 };
}

export function extractStorageKeysFromJob(row: {
  prePdfKey: string | null;
  postPdfKey: string | null;
  pageImageKeys: unknown;
}): string[] {
  const keys: string[] = [];
  if (row.prePdfKey) keys.push(row.prePdfKey);
  if (row.postPdfKey) keys.push(row.postPdfKey);
  if (row.pageImageKeys && typeof row.pageImageKeys === 'object') {
    for (const modelMap of Object.values(row.pageImageKeys as Record<string, unknown>)) {
      if (modelMap && typeof modelMap === 'object') {
        for (const key of Object.values(modelMap as Record<string, unknown>)) {
          if (typeof key === 'string' && key.length > 0) {
            keys.push(key);
          }
        }
      }
    }
  }
  return keys;
}

export class PdfImportService {
  private readonly prisma: PrismaClient;
  private readonly env: AppEnv;
  private readonly storage: StorageAdapter;
  private readonly aiClient: AiServiceClient;
  private readonly dispatcher: PdfImportDispatcher;
  private readonly virusScanner: VirusScanner;

  constructor(deps: PdfImportServiceDeps) {
    this.prisma = deps.prisma;
    this.env = deps.env;
    this.storage = deps.storage;
    this.aiClient = deps.aiClient;
    this.dispatcher = deps.dispatcher;
    this.virusScanner = deps.virusScanner ?? createVirusScanner(deps.env);
  }

  private toResponse(row: PdfImportJobRow): PdfImportJobResponse {
    const cfg = row.topicMetaJson as StoredImportConfig | null;
    const parsedPreview = row.previewJson
      ? PdfImportPreviewPayloadSchema.safeParse(row.previewJson)
      : null;
    const fallbackPreview =
      row.previewJson &&
      typeof row.previewJson === 'object' &&
      Array.isArray((row.previewJson as { models?: unknown }).models)
        ? (row.previewJson as PdfImportPreviewPayload)
        : null;

    return {
      id: row.id,
      topicId: row.topicId,
      appliedTopicId: row.appliedTopicId,
      status: row.status,
      currentStage: row.currentStage,
      progressPct: row.progressPct,
      hasPrePdf: Boolean(row.prePdfKey),
      hasPostPdf: Boolean(row.postPdfKey),
      topicMeta: cfg?.topicMeta ?? null,
      preview: parsedPreview?.success ? parsedPreview.data : fallbackPreview,
      errorCode: row.errorCode,
      errorMessage: row.errorMessage,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
    };
  }

  private async loadOwnedJobOrThrow(jobId: string, ownerId: string): Promise<PdfImportJobRow> {
    const row = await this.prisma.pdfImportJob.findFirst({
      where: { id: jobId, ownerId },
    });
    if (!row) {
      throw new AppError('NOT_FOUND', { messageEn: 'PDF import job not found.' });
    }
    return row;
  }

  async createJob(input: CreatePdfImportJobInput): Promise<PdfImportJobResponse> {
    if (!input.preFile && !input.postFile) {
      throw new AppError('PDF_INVALID', {
        messageEn: 'Upload at least one PDF file (Pre-Model or Post-Model).',
      });
    }

    if (input.preFile) {
      await validateAndScanPdf(input.preFile, this.env, this.virusScanner);
    }
    if (input.postFile) {
      await validateAndScanPdf(input.postFile, this.env, this.virusScanner);
    }

    if (input.topicId) {
      await assertOwnedTopicExists(this.prisma, input.topicId, input.ownerId);
    }

    const jobId = crypto.randomUUID();
    let prePdfKey: string | null = null;
    let postPdfKey: string | null = null;

    if (input.preFile) {
      prePdfKey = `pdf-imports/${jobId}/pre.pdf`;
      await this.storage.putObject(prePdfKey, input.preFile.buffer, 'application/pdf');
    }
    if (input.postFile) {
      postPdfKey = `pdf-imports/${jobId}/post.pdf`;
      await this.storage.putObject(postPdfKey, input.postFile.buffer, 'application/pdf');
    }

    const config: StoredImportConfig = {
      topicMeta: input.topicMeta ?? null,
      preTitle: input.preTitle?.trim() || 'النموذج القبلي (Pre-Model)',
      postTitle: input.postTitle?.trim() || 'النموذج البعدي (Post-Model)',
      preDurationMinutes: input.preDurationMinutes ?? 60,
      postDurationMinutes: input.postDurationMinutes ?? 60,
    };

    const ttlDays = Math.min(7, this.env.RETENTION_DAYS);
    const expiresAt = new Date(Date.now() + ttlDays * 86_400_000);

    const created = await this.prisma.pdfImportJob.create({
      data: {
        id: jobId,
        ownerId: input.ownerId,
        topicId: input.topicId ?? null,
        status: 'QUEUED',
        currentStage: 'QUEUED',
        progressPct: 0,
        prePdfKey,
        postPdfKey,
        topicMetaJson: toJson(config),
        expiresAt,
      },
    });

    await this.dispatcher.enqueue({ jobId: created.id });
    return this.toResponse(created);
  }

  async processJob(jobId: string): Promise<void> {
    const job = await this.prisma.pdfImportJob.findUnique({ where: { id: jobId } });
    if (!job || job.status === 'APPLIED') {
      return;
    }

    const cfg = (job.topicMetaJson as StoredImportConfig | null) ?? {
      topicMeta: null,
      preTitle: 'النموذج القبلي (Pre-Model)',
      postTitle: 'النموذج البعدي (Post-Model)',
      preDurationMinutes: 60,
      postDurationMinutes: 60,
    };

    await this.prisma.pdfImportJob.update({
      where: { id: jobId },
      data: { status: 'PROCESSING', currentStage: 'READING_PDFS', progressPct: 15 },
    });

    try {
      const payload: AiExtractExamPdfInput = {};

      if (job.prePdfKey) {
        const preBuf = await this.storage.getObject(job.prePdfKey);
        payload.preModel = {
          modelNumber: 1,
          title: cfg.preTitle,
          durationMinutes: cfg.preDurationMinutes,
          pdfBase64: preBuf.toString('base64'),
        };
      }

      if (job.postPdfKey) {
        const postBuf = await this.storage.getObject(job.postPdfKey);
        payload.postModel = {
          modelNumber: 2,
          title: cfg.postTitle,
          durationMinutes: cfg.postDurationMinutes,
          pdfBase64: postBuf.toString('base64'),
        };
      }

      if (job.topicId && !job.prePdfKey) {
        const m1 = await this.prisma.examModel.findFirst({
          where: { topicId: job.topicId, modelNumber: 1, deletedAt: null },
          include: {
            questions: {
              where: { deletedAt: null },
              orderBy: { orderIndex: 'asc' },
            },
          },
        });
        if (m1?.questions.length) {
          payload.referenceModel1Questions = m1.questions.map((q): AiPdfTwinReferenceQuestion => ({
            conceptKey: q.conceptKey,
            promptLatex: q.promptLatex,
            type: q.type,
          }));
        }
      }

      await this.prisma.pdfImportJob.update({
        where: { id: jobId },
        data: { currentStage: 'OCR_AND_AI_EXTRACTION', progressPct: 40 },
      });

      const extracted = await this.aiClient.extractExamPdf(
        payload,
        this.env.PDF_EXTRACTION_TIMEOUT_MS,
      );

      await this.prisma.pdfImportJob.update({
        where: { id: jobId },
        data: { currentStage: 'RENDERING_PREVIEW', progressPct: 80 },
      });

      const pageImageKeys: PageImageKeyMap = {};
      for (const rendered of extracted.renderedPages) {
        const key = `pdf-imports/${jobId}/model-${rendered.modelNumber}/page-${rendered.pageNumber}.jpg`;
        await this.storage.putObject(
          key,
          Buffer.from(rendered.imageBase64, 'base64'),
          'image/jpeg',
        );
        const modelStr = String(rendered.modelNumber);
        pageImageKeys[modelStr] ??= {};
        pageImageKeys[modelStr][String(rendered.pageNumber)] = key;
      }

      const preview: PdfImportPreviewPayload = {
        models: extracted.models.map((m) => ({
          ...m,
          pages: m.pages.map((p) => ({
            ...p,
            imageUrl: `/api/v1/pdf-imports/${jobId}/pages/${m.modelNumber}/${p.pageNumber}`,
          })),
        })),
        twinSummary: extracted.twinSummary,
        telemetry: extracted.telemetry,
      };

      await this.prisma.aiUsage.create({
        data: {
          answerId: null,
          provider: extracted.telemetry.provider,
          modelName: 'pdf-extract',
          operation: 'pdf_extract',
          inputTokens: extracted.telemetry.totalInputTokens,
          outputTokens: extracted.telemetry.totalOutputTokens,
          costUsd: extracted.telemetry.totalCostUsd,
          latencyMs: extracted.telemetry.latencyMs,
          success: true,
        },
      });

      await this.prisma.pdfImportJob.update({
        where: { id: jobId },
        data: {
          status: 'READY_FOR_REVIEW',
          currentStage: 'READY_FOR_REVIEW',
          progressPct: 100,
          pageImageKeys: toJson(pageImageKeys),
          previewJson: toJson(preview),
          errorCode: null,
          errorMessage: null,
        },
      });
    } catch (err) {
      const errorCode =
        err instanceof AiServiceHttpError
          ? err.code
          : err instanceof AppError
            ? err.code
            : 'PDF_EXTRACTION_FAILED';
      const errorMessage = err instanceof Error ? err.message : 'PDF extraction failed';

      await this.prisma.aiUsage
        .create({
          data: {
            answerId: null,
            provider: 'ai-service',
            modelName: 'pdf-extract',
            operation: 'pdf_extract',
            inputTokens: 0,
            outputTokens: 0,
            costUsd: 0,
            latencyMs: 0,
            success: false,
            errorCode,
          },
        })
        .catch(() => undefined);

      await this.prisma.pdfImportJob.update({
        where: { id: jobId },
        data: {
          status: 'FAILED',
          currentStage: 'FAILED',
          errorCode,
          errorMessage: errorMessage.slice(0, 500),
        },
      });
    }
  }

  async listJobs(ownerId: string): Promise<PdfImportJobResponse[]> {
    const rows = await this.prisma.pdfImportJob.findMany({
      where: { ownerId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return rows.map((row) => this.toResponse(row));
  }

  async getJob(jobId: string, ownerId: string): Promise<PdfImportJobResponse> {
    const row = await this.loadOwnedJobOrThrow(jobId, ownerId);
    return this.toResponse(row);
  }

  async getPageImage(
    jobId: string,
    ownerId: string,
    modelNumber: 1 | 2,
    pageNumber: number,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    const row = await this.loadOwnedJobOrThrow(jobId, ownerId);
    const keys = row.pageImageKeys as PageImageKeyMap | null;
    const key = keys?.[String(modelNumber)]?.[String(pageNumber)];
    if (!key) {
      throw new AppError('NOT_FOUND', { messageEn: 'Rendered PDF page not found.' });
    }
    const buffer = await this.storage.getObject(key);
    return { buffer, contentType: 'image/jpeg' };
  }

  async saveDraft(
    jobId: string,
    ownerId: string,
    input: SavePdfDraftInput,
  ): Promise<PdfImportJobResponse> {
    const row = await this.loadOwnedJobOrThrow(jobId, ownerId);
    if (row.status !== 'READY_FOR_REVIEW') {
      throw new AppError('CONFLICT', {
        messageEn: 'Only jobs in READY_FOR_REVIEW status can be edited.',
      });
    }

    const existingPreview = row.previewJson
      ? PdfImportPreviewPayloadSchema.parse(row.previewJson)
      : null;
    if (!existingPreview) {
      throw new AppError('NOT_FOUND', { messageEn: 'Job preview payload missing.' });
    }

    const editedMap = new Map(input.models.map((m) => [m.modelNumber, m]));
    const updatedModels: ExtractedModelPreview[] = existingPreview.models.map((existing) => {
      const edited = editedMap.get(existing.modelNumber);
      if (!edited) return existing;
      return {
        ...existing,
        title: edited.title,
        durationMinutes: edited.durationMinutes,
        questions: edited.questions,
      };
    });

    const updatedPreview: PdfImportPreviewPayload = {
      ...existingPreview,
      models: updatedModels,
      twinSummary: computeTwinSummary(updatedModels, existingPreview.twinSummary.onlyInModel1),
    };

    const existingCfg = row.topicMetaJson as StoredImportConfig | null;
    const nextCfg: StoredImportConfig = {
      topicMeta: input.topicMeta ?? existingCfg?.topicMeta ?? null,
      preTitle: existingCfg?.preTitle ?? 'النموذج القبلي (Pre-Model)',
      postTitle: existingCfg?.postTitle ?? 'النموذج البعدي (Post-Model)',
      preDurationMinutes: existingCfg?.preDurationMinutes ?? 60,
      postDurationMinutes: existingCfg?.postDurationMinutes ?? 60,
    };

    const updated = await this.prisma.pdfImportJob.update({
      where: { id: jobId },
      data: {
        topicMetaJson: toJson(nextCfg),
        previewJson: toJson(updatedPreview),
      },
    });
    return this.toResponse(updated);
  }

  async applyJob(jobId: string, ownerId: string, input: ApplyPdfImportInput, ip?: string) {
    const row = await this.loadOwnedJobOrThrow(jobId, ownerId);
    if (row.status !== 'READY_FOR_REVIEW') {
      throw new AppError('CONFLICT', {
        messageEn: 'Only jobs in READY_FOR_REVIEW status can be applied.',
      });
    }

    // Check unverified flagged questions
    if (!input.confirmAllReviewed) {
      const unverified = input.models.flatMap((m) =>
        m.questions
          .filter((q) => q.needsTeacherConfirmation && !q.verifiedByTeacher)
          .map((q) => `Model ${m.modelNumber} Q${q.orderIndex}`),
      );
      if (unverified.length > 0) {
        throw new AppError('VALIDATION_ERROR', {
          messageEn: `Please verify flagged questions before applying: ${unverified.join(', ')}`,
          details: { unverified },
        });
      }
    }

    // Strict schema check before opening DB transaction
    const validatedModels = input.models.map((m) => ({
      modelNumber: m.modelNumber,
      title: m.title,
      durationMinutes: m.durationMinutes,
      questions: m.questions.map((q, idx) => {
        let normalizedModelAnswer = q.type === 'ESSAY' ? q.modelAnswer : null;
        if (q.type === 'ESSAY' && normalizedModelAnswer) {
          const steps = normalizedModelAnswer.solutionStepsLatex
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
          const finalAns = normalizedModelAnswer.finalAnswerLatex.trim();
          normalizedModelAnswer = {
            ...normalizedModelAnswer,
            solutionStepsLatex: steps.length > 0 ? steps : finalAns ? [finalAns] : [],
            finalAnswerLatex: finalAns || steps[steps.length - 1] || '',
          };
        }
        const parsed = StrictApplyQuestionSchema.safeParse({
          orderIndex: idx + 1,
          conceptKey: q.conceptKey,
          type: q.type,
          promptLatex: q.promptLatex,
          points: q.points,
          solutionUrl: q.solutionUrl ?? null,
          needsTeacherConfirmation: q.needsTeacherConfirmation && !q.verifiedByTeacher,
          mcqOptions: q.type === 'MCQ' ? q.mcqOptions : undefined,
          modelAnswer: normalizedModelAnswer,
          rubricCriteria: q.type === 'ESSAY' ? q.rubricCriteria : undefined,
        });
        if (!parsed.success) {
          throw new AppError('VALIDATION_ERROR', {
            messageEn: `Invalid question in Model ${m.modelNumber} Q${q.orderIndex}: ${parsed.error.issues[0]?.message ?? 'validation failed'}`,
            details: {
              modelNumber: m.modelNumber,
              orderIndex: q.orderIndex,
              issues: parsed.error.issues,
            },
          });
        }
        validateQuestionPayload(parsed.data);
        return parsed.data;
      }),
    }));

    const existingCfg = row.topicMetaJson as StoredImportConfig | null;
    const requestedTopicId = input.targetTopicId ?? row.topicId ?? undefined;
    const now = new Date();
    const ipHash = hashIp(ip, this.env.IP_HASH_SALT);

    const appliedTopicId = await this.prisma.$transaction(async (tx) => {
      let topicId = requestedTopicId;
      if (topicId) {
        await assertOwnedTopicExists(tx, topicId, ownerId);
      } else {
        const meta = input.topicMeta ??
          existingCfg?.topicMeta ?? {
            title: validatedModels[0]?.title ?? 'Imported Exam Topic',
            description: '',
            correctnessThreshold: 0.6,
          };
        const createdTopic = await tx.topic.create({
          data: {
            ownerId,
            title: meta.title,
            description: meta.description,
            correctnessThreshold: meta.correctnessThreshold,
            examModels: {
              create: [
                {
                  modelNumber: 1,
                  title: existingCfg?.preTitle ?? 'النموذج القبلي (Pre-Model)',
                  durationMinutes: existingCfg?.preDurationMinutes ?? 60,
                  status: 'DRAFT',
                },
                {
                  modelNumber: 2,
                  title: existingCfg?.postTitle ?? 'النموذج البعدي (Post-Model)',
                  durationMinutes: existingCfg?.postDurationMinutes ?? 60,
                  status: 'DRAFT',
                },
              ],
            },
          },
        });
        topicId = createdTopic.id;
      }

      for (const m of validatedModels) {
        let examModel = await tx.examModel.findFirst({
          where: { topicId, modelNumber: m.modelNumber, deletedAt: null },
        });
        if (!examModel) {
          examModel = await tx.examModel.create({
            data: {
              topicId,
              modelNumber: m.modelNumber,
              title: m.title,
              durationMinutes: m.durationMinutes,
              status: 'DRAFT',
            },
          });
        } else {
          examModel = await tx.examModel.update({
            where: { id: examModel.id },
            data: { title: m.title, durationMinutes: m.durationMinutes },
          });
        }

        const existingQuestions = await tx.question.findMany({
          where: { examModelId: examModel.id, deletedAt: null },
          select: { id: true },
        });
        for (const existingQ of existingQuestions) {
          await softDeleteQuestionSubtree(tx, existingQ.id, now);
        }

        for (const q of m.questions) {
          await createQuestionWithChildren(tx, examModel.id, q);
        }
        await recalculateExamTotalPoints(tx, examModel.id);
      }

      await syncTwinQuestionsForTopic(tx, topicId);

      await tx.pdfImportJob.update({
        where: { id: jobId },
        data: {
          status: 'APPLIED',
          currentStage: 'APPLIED',
          appliedTopicId: topicId,
        },
      });

      await tx.auditLog.create({
        data: {
          actorType: 'TEACHER',
          actorId: ownerId,
          action: 'PDF_IMPORT_APPLIED',
          entity: 'Topic',
          entityId: topicId,
          diff: toJson({
            pdfImportJobId: jobId,
            modelsImported: validatedModels.map((m) => m.modelNumber),
          }),
          ipHash,
        },
      });

      return topicId;
    });

    const [updatedJob, fullTopic] = await Promise.all([
      this.prisma.pdfImportJob.findUnique({ where: { id: jobId } }),
      this.prisma.topic.findFirst({
        where: { id: appliedTopicId, deletedAt: null },
        include: TOPIC_FULL_INCLUDE,
      }),
    ]);

    return {
      job: updatedJob ? this.toResponse(updatedJob) : null,
      topic: fullTopic ? serializeTopicWithStatus(fullTopic) : null,
    };
  }
}
