import { Worker } from 'bullmq';
import { loadEnv } from './config/env.js';
import { createLogger } from './lib/logger.js';
import { getPrisma } from './lib/prisma.js';
import { createRedisClient } from './lib/redis.js';

async function main() {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL);
  const prisma = getPrisma();
  await prisma.$connect();

  const redis = createRedisClient(env.REDIS_URL, logger);
  await redis.connect();

  const gradingWorker = new Worker(
    'grading',
    (job) => {
      logger.info({ jobId: job.id, name: job.name }, 'Grading worker job received');
      return Promise.resolve();
    },
    {
      connection: redis,
      concurrency: env.GRADING_CONCURRENCY,
    },
  );

  gradingWorker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err: err.message }, 'Grading job failed');
  });

  logger.info({ concurrency: env.GRADING_CONCURRENCY }, 'MathLens worker started');

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down worker gracefully');
    await gradingWorker.close();
    await redis.quit();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Fatal worker startup error:', err);
  process.exit(1);
});
