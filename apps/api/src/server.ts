import * as Sentry from '@sentry/node';
import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createLogger } from './lib/logger.js';
import { getPrisma } from './lib/prisma.js';
import { createRedisClient } from './lib/redis.js';
import { BullMqGradingDispatcher } from './services/gradingDispatcher.js';
import { BullMqPdfImportDispatcher } from './services/pdfImportDispatcher.js';

async function main() {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL);

  if (env.SENTRY_DSN) {
    Sentry.init({ dsn: env.SENTRY_DSN, environment: env.NODE_ENV });
  }

  const prisma = getPrisma();
  await prisma.$connect();

  const redis = createRedisClient(env.REDIS_URL, logger);
  await redis.connect().catch((err: Error) => {
    logger.warn({ err: err.message }, 'Redis initial connect deferred');
  });

  const gradingDispatcher = new BullMqGradingDispatcher(env.REDIS_URL, logger);
  const pdfImportDispatcher = new BullMqPdfImportDispatcher(env.REDIS_URL, logger);
  const app = createApp({ env, prisma, logger, redis, gradingDispatcher, pdfImportDispatcher });

  const server = app.listen(env.API_PORT, () => {
    logger.info({ port: env.API_PORT }, 'MathLens API listening');
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutting down API gracefully');
    server.close(() => {
      void (async () => {
        await gradingDispatcher.close?.().catch(() => undefined);
        await pdfImportDispatcher.close?.().catch(() => undefined);
        await redis.quit().catch(() => undefined);
        await prisma.$disconnect();
        process.exit(0);
      })();
    });
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Fatal API startup error:', err);
  process.exit(1);
});
