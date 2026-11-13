import * as Sentry from '@sentry/node';
import { loadEnv } from './config/env.js';
import { createLogger } from './lib/logger.js';
import { getPrisma } from './lib/prisma.js';
import { createGradingWorker, createRetentionWorker } from './services/gradingDispatcher.js';
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
  const grading = createGradingWorker({
    prisma,
    env,
    storage,
    logger,
  });
  const retention = await createRetentionWorker({
    prisma,
    env,
    storage,
    logger,
  });

  logger.info(
    { concurrency: env.GRADING_CONCURRENCY },
    'MathLens grading & retention worker started',
  );

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down grading & retention worker');
    await retention.close();
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
