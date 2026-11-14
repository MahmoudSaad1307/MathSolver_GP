import {
  ApplyPdfImportSchema,
  PdfImportTopicMetaSchema,
  SavePdfDraftSchema,
} from '@mathlens/shared';
import type { PrismaClient } from '@prisma/client';
import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import { z } from 'zod';
import type { AppEnv } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import { requireTeacher } from '../middleware/auth.js';
import { getParamId, getTeacherId, UuidParamSchema } from '../middleware/requestHelpers.js';
import { asyncHandler, validateBody, validateParams } from '../middleware/validate.js';
import type { AiServiceClient } from '../services/aiClient.js';
import type { PdfImportDispatcher } from '../services/pdfImportDispatcher.js';
import { PdfImportService, type UploadedPdfFile } from '../services/pdfImportService.js';
import type { StorageAdapter, VirusScanner } from '../services/storage/types.js';

export interface PdfImportsRouterDeps {
  prisma: PrismaClient;
  env: AppEnv;
  storage: StorageAdapter;
  virusScanner?: VirusScanner;
  aiClient: AiServiceClient;
  pdfImportDispatcher: PdfImportDispatcher;
}

const PageParamSchema = z.object({
  id: z.string().uuid(),
  modelNumber: z.enum(['1', '2']),
  pageNumber: z.string().regex(/^\d+$/),
});

const CreatePdfUploadBodySchema = z.object({
  topicId: z.string().uuid().optional(),
  preTitle: z.string().trim().min(1).max(200).optional(),
  postTitle: z.string().trim().min(1).max(200).optional(),
  preDurationMinutes: z.coerce.number().int().min(5).max(300).optional(),
  postDurationMinutes: z.coerce.number().int().min(5).max(300).optional(),
  topicMeta: z.string().optional(),
  topicTitle: z.string().trim().min(2).max(200).optional(),
  topicDescription: z.string().trim().max(2000).optional(),
  correctnessThreshold: z.coerce.number().min(0.1).max(1).optional(),
});

function createPdfMulterMiddleware(env: AppEnv): RequestHandler {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: env.MAX_PDF_BYTES,
      files: 2,
    },
  }).fields([
    { name: 'prePdf', maxCount: 1 },
    { name: 'postPdf', maxCount: 1 },
  ]);

  return (req, res, next) => {
    upload(req, res, (err: unknown) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return next(
            new AppError('PDF_TOO_LARGE', {
              messageEn: `PDF file exceeds limit of ${env.MAX_PDF_BYTES} bytes.`,
            }),
          );
        }
        return next(new AppError('PDF_INVALID', { messageEn: err.message }));
      }
      return next(err);
    });
  };
}

function toUploadedPdf(file?: Express.Multer.File): UploadedPdfFile | undefined {
  if (!file) return undefined;
  return {
    buffer: file.buffer,
    originalname: file.originalname,
    mimetype: file.mimetype,
  };
}

export function createPdfImportsRouter(deps: PdfImportsRouterDeps): Router {
  const router = Router();
  const service = new PdfImportService({
    prisma: deps.prisma,
    env: deps.env,
    storage: deps.storage,
    virusScanner: deps.virusScanner,
    aiClient: deps.aiClient,
    dispatcher: deps.pdfImportDispatcher,
  });

  router.use(requireTeacher(deps.env));

  router.post(
    '/',
    createPdfMulterMiddleware(deps.env),
    asyncHandler(async (req, res) => {
      const ownerId = getTeacherId(req);
      const parsedBody = CreatePdfUploadBodySchema.safeParse(req.body);
      if (!parsedBody.success) {
        throw new AppError('VALIDATION_ERROR', { details: parsedBody.error.flatten() });
      }

      const files = (req.files ?? {}) as Record<string, Express.Multer.File[] | undefined>;
      const preFile = toUploadedPdf(files.prePdf?.[0]);
      const postFile = toUploadedPdf(files.postPdf?.[0]);

      let topicMeta = undefined;
      if (parsedBody.data.topicMeta) {
        let decodedJson: unknown;
        try {
          decodedJson = JSON.parse(parsedBody.data.topicMeta);
        } catch {
          throw new AppError('VALIDATION_ERROR', { messageEn: 'topicMeta must be valid JSON.' });
        }
        const metaParsed = PdfImportTopicMetaSchema.safeParse(decodedJson);
        if (!metaParsed.success) {
          throw new AppError('VALIDATION_ERROR', { details: metaParsed.error.flatten() });
        }
        topicMeta = metaParsed.data;
      } else if (parsedBody.data.topicTitle) {
        topicMeta = PdfImportTopicMetaSchema.parse({
          title: parsedBody.data.topicTitle,
          description: parsedBody.data.topicDescription ?? '',
          correctnessThreshold: parsedBody.data.correctnessThreshold ?? 0.6,
        });
      }

      const job = await service.createJob({
        ownerId,
        topicId: parsedBody.data.topicId,
        preFile,
        postFile,
        preTitle: parsedBody.data.preTitle,
        postTitle: parsedBody.data.postTitle,
        preDurationMinutes: parsedBody.data.preDurationMinutes,
        postDurationMinutes: parsedBody.data.postDurationMinutes,
        topicMeta,
      });

      res.status(202).json({ job });
    }),
  );

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const ownerId = getTeacherId(req);
      const jobs = await service.listJobs(ownerId);
      res.status(200).json({ jobs });
    }),
  );

  router.get(
    '/:id',
    validateParams(UuidParamSchema),
    asyncHandler(async (req, res) => {
      const ownerId = getTeacherId(req);
      const id = getParamId(req, 'id');
      const job = await service.getJob(id, ownerId);
      res.status(200).json({ job });
    }),
  );

  router.get(
    '/:id/pages/:modelNumber/:pageNumber',
    validateParams(PageParamSchema),
    asyncHandler(async (req, res) => {
      const ownerId = getTeacherId(req);
      const { id, modelNumber, pageNumber } = req.params as {
        id: string;
        modelNumber: '1' | '2';
        pageNumber: string;
      };
      const pageNum = Number(pageNumber);
      if (!Number.isInteger(pageNum) || pageNum < 1 || pageNum > 200) {
        throw new AppError('VALIDATION_ERROR', { messageEn: 'Invalid page number.' });
      }
      const result = await service.getPageImage(id, ownerId, modelNumber === '1' ? 1 : 2, pageNum);
      res.setHeader('Content-Type', result.contentType);
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.status(200).send(result.buffer);
    }),
  );

  router.put(
    '/:id/draft',
    validateParams(UuidParamSchema),
    validateBody(SavePdfDraftSchema),
    asyncHandler(async (req, res) => {
      const ownerId = getTeacherId(req);
      const id = getParamId(req, 'id');
      const job = await service.saveDraft(
        id,
        ownerId,
        req.body as z.infer<typeof SavePdfDraftSchema>,
      );
      res.status(200).json({ job });
    }),
  );

  router.post(
    '/:id/apply',
    validateParams(UuidParamSchema),
    validateBody(ApplyPdfImportSchema),
    asyncHandler(async (req, res) => {
      const ownerId = getTeacherId(req);
      const id = getParamId(req, 'id');
      const result = await service.applyJob(
        id,
        ownerId,
        req.body as z.infer<typeof ApplyPdfImportSchema>,
        req.ip,
      );
      res.status(200).json(result);
    }),
  );

  return router;
}
