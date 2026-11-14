import * as Sentry from '@sentry/node';
import { loadEnv } from './config/env.js';
import { createLogger } from './lib/logger.js';
import { getPrisma } from './lib/prisma.js';
import { HttpAiServiceClient } from './services/aiClient.js';
import { createGradingWorker, createRetentionWorker } from './services/gradingDispatcher.js';
import {
  BullMqPdfImportDispatcher,
  createPdfImportWorker,
} from './services/pdfImportDispatcher.js';
import { PdfImportService } from './services/pdfImportService.js';
import { createStorageAdapter } from './services/storage/index.js';

async function main() {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL);

  if (env.SENTRY_DSN) {
    Sentry.init({ dsn: env.SENTRY_DSN, environment: env.NODE_ENV });
  }

  const prisma = getPrisma();
  await prisma.$connect();

  const storage = createStorageAdapter(env);
  const aiClient = new HttpAiServiceClient(env);
  const pdfImportDispatcher = new BullMqPdfImportDispatcher(env.REDIS_URL, logger);
  const pdfImportService = new PdfImportService({
    prisma,
    env,
    storage,
    aiClient,
    dispatcher: pdfImportDispatcher,
  });

  const grading = createGradingWorker({
    prisma,
    env,
    storage,
    logger,
  });
  const pdfImportWorker = createPdfImportWorker(
    env.REDIS_URL,
    (jobId) => pdfImportService.processJob(jobId),
    logger,
  );
  const retention = await createRetentionWorker({
    prisma,
    env,
    storage,
    logger,
  });

  logger.info(
    { concurrency: env.GRADING_CONCURRENCY },
    'MathLens grading, PDF import & retention worker started',
  );

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down grading & retention worker');
    await retention.close();
    await pdfImportWorker.close();
    await pdfImportDispatcher.close?.().catch(() => undefined);
    await grading.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Fatal grading worker startup error:', err);
  process.exit(1);
});
