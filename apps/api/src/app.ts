import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import type { AppEnv } from './config/env.js';
import { AppError } from './lib/errors.js';
import type { Logger } from './lib/logger.js';
import { createErrorHandler } from './middleware/errorHandler.js';
import { requestIdMiddleware } from './middleware/requestId.js';
import { createAnalyticsRouter } from './routes/analytics.js';
import { createCohortsRouter } from './routes/cohorts.js';
import { createHealthRouter } from './routes/health.js';
import { createReviewRouter } from './routes/review.js';
import { createStorageRouter } from './routes/storage.js';
import { createStudentRouter } from './routes/student.js';
import { createStudentAuthRouter } from './routes/studentAuth.js';
import { createStudentResultsRouter } from './routes/studentResults.js';
import { createStudentVideoRouter } from './routes/studentVideo.js';
import { createTeacherAuthRouter } from './routes/teacherAuth.js';
import { createTeacherContentRouter } from './routes/topics.js';
import { createPdfImportsRouter } from './routes/pdfImports.js';
import {
  HttpAiServiceClient,
  type AiServiceClient,
  type StatsServiceClient,
} from './services/aiClient.js';
import {
  NoopPdfImportDispatcher,
  type PdfImportDispatcher,
} from './services/pdfImportDispatcher.js';
import { NoopGradingDispatcher, type GradingDispatcher } from './services/gradingDispatcher.js';
import {
  createStorageAdapter,
  createVirusScanner,
  type StorageAdapter,
  type VirusScanner,
} from './services/storage/index.js';

export interface CreateAppDeps {
  env: AppEnv;
  prisma: PrismaClient;
  logger: Logger;
  redis?: Redis;
  storage?: StorageAdapter;
  virusScanner?: VirusScanner;
  gradingDispatcher?: GradingDispatcher;
  pdfImportDispatcher?: PdfImportDispatcher;
  aiClient?: AiServiceClient;
  statsClient?: StatsServiceClient;
}

export function createApp({
  env,
  prisma,
  logger,
  redis,
  storage = createStorageAdapter(env),
  virusScanner = createVirusScanner(env),
  gradingDispatcher = new NoopGradingDispatcher(),
  pdfImportDispatcher = new NoopPdfImportDispatcher(),
  aiClient = new HttpAiServiceClient(env),
  statsClient = new HttpAiServiceClient(env),
}: CreateAppDeps): Express {
  const app = express();

  if (env.TRUST_PROXY) {
    app.set('trust proxy', 1);
  }

  app.disable('x-powered-by');
  app.use(requestIdMiddleware);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.requestId ?? 'unknown',
      autoLogging: env.NODE_ENV !== 'test',
    }),
  );

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          frameSrc: ['https://www.youtube.com', 'https://www.youtube-nocookie.com'],
          imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
          scriptSrc: ["'self'", 'https://www.youtube.com', 'https://s.ytimg.com'],
          styleSrc: ["'self'", "'unsafe-inline'"],
          connectSrc: ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );

  const allowedOrigins = new Set(
    env.CORS_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

  app.use(
    cors({
      origin(origin, cb) {
        if (!origin || allowedOrigins.has(origin)) {
          cb(null, true);
          return;
        }
        cb(new AppError('FORBIDDEN', { messageEn: 'Origin not allowed by CORS' }));
      },
      credentials: true,
    }),
  );

  app.use(compression());
  app.use(cookieParser());
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: false, limit: '256kb' }));

  // Health & Prometheus metrics
  app.use(createHealthRouter(prisma, redis));

  // API v1 routes
  const v1 = express.Router();
  v1.use('/auth/teacher', createTeacherAuthRouter(prisma, env, redis));
  v1.use('/auth/student', createStudentAuthRouter(prisma, env, redis));
  v1.use('/cohorts', createCohortsRouter(prisma, env, storage));
  v1.use(
    '/student',
    createStudentRouter({
      prisma,
      env,
      storage,
      virusScanner,
      gradingDispatcher,
      redis,
    }),
  );
  v1.use('/student', createStudentResultsRouter({ prisma, env, storage }));
  v1.use('/student', createStudentVideoRouter({ prisma, env }));
  v1.use('/storage', createStorageRouter(storage, env));
  v1.use(
    '/pdf-imports',
    createPdfImportsRouter({
      prisma,
      env,
      storage,
      virusScanner,
      aiClient,
      pdfImportDispatcher,
    }),
  );
  v1.use('/', createTeacherContentRouter(prisma, env));
  v1.use('/', createReviewRouter({ prisma, env, storage, gradingDispatcher }));
  v1.use('/', createAnalyticsRouter({ prisma, env, statsClient }));

  app.use('/api/v1', v1);

  app.use((_req, _res, next) => {
    next(new AppError('NOT_FOUND'));
  });

  app.use(createErrorHandler(logger));

  return app;
}
