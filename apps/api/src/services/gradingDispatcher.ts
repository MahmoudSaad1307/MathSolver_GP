import { Queue, Worker, type ConnectionOptions, type Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import type { AppEnv } from '../config/env.js';
import type { Logger } from '../lib/logger.js';
import { gradingQueueDepthGauge } from '../lib/metrics.js';
import { HttpAiServiceClient, type AiServiceClient } from './aiClient.js';
import { GradingOrchestrator } from './gradingOrchestrator.js';
import { RetentionService } from './retentionService.js';
import type { StorageAdapter } from './storage/index.js';

export const GRADING_QUEUE_NAME = 'mathlens-grading';
export const GRADING_DLQ_NAME = 'mathlens-grading-dlq';
export const RETENTION_QUEUE_NAME = 'mathlens-retention';

export interface EssayGradingJobPayload {
  attemptId: string;
  answerId: string;
  studentId: string;
  forceRefresh?: boolean;
}

export interface GradingDispatcher {
  enqueueEssayGrading(payload: EssayGradingJobPayload): Promise<void>;
  close?(): Promise<void>;
}

export class NoopGradingDispatcher implements GradingDispatcher {
  enqueueEssayGrading(_payload: EssayGradingJobPayload): Promise<void> {
    return Promise.resolve();
  }
}

export function normalizeRedisUrl(redisUrl: string): string {
  try {
    const parsed = new URL(redisUrl);
    if (parsed.protocol === 'redis:' && parsed.hostname.endsWith('.upstash.io')) {
      parsed.protocol = 'rediss:';
      return parsed.toString();
    }
  } catch {
    // Keep raw URL so caller surfaces normal connection error
  }
  return redisUrl;
}

export function parseRedisConnectionOptions(redisUrl: string): ConnectionOptions {
  const normalized = normalizeRedisUrl(redisUrl);
  const parsed = new URL(normalized);
  const dbStr = parsed.pathname.replace(/^\//, '');
  const dbNum = dbStr ? Number(dbStr) : 0;
  return {
    host: parsed.hostname || 'localhost',
    port: parsed.port ? Number(parsed.port) : 6379,
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    db: Number.isInteger(dbNum) ? dbNum : 0,
    maxRetriesPerRequest: null,
    ...(parsed.protocol === 'rediss:' ? { tls: {} } : {}),
  };
}

export class BullMqGradingDispatcher implements GradingDispatcher {
  private readonly queue: Queue<EssayGradingJobPayload>;

  constructor(
    redisUrl: string,
    private readonly logger: Logger,
  ) {
    this.queue = new Queue<EssayGradingJobPayload>(GRADING_QUEUE_NAME, {
      connection: parseRedisConnectionOptions(redisUrl),
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: 500,
        removeOnFail: 500,
      },
    });

    this.queue.on('error', (err) => {
      this.logger.warn({ err: err.message }, 'BullMQ queue error');
    });
  }

  async enqueueEssayGrading(payload: EssayGradingJobPayload): Promise<void> {
    const jobId = payload.forceRefresh
      ? `grade-${payload.answerId}-${Date.now()}`
      : `grade-${payload.answerId}`;

    await this.queue.add('grade-essay', payload, { jobId });
    const counts = await this.queue.getJobCounts('waiting', 'active', 'delayed').catch(() => null);
    if (counts) {
      gradingQueueDepthGauge.set(
        (counts.waiting ?? 0) + (counts.active ?? 0) + (counts.delayed ?? 0),
      );
    }
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}

export function createGradingWorker(params: {
  prisma: PrismaClient;
  env: AppEnv;
  storage: StorageAdapter;
  logger: Logger;
  aiClient?: AiServiceClient;
}): {
  worker: Worker<EssayGradingJobPayload>;
  dlq: Queue<EssayGradingJobPayload & { failedReason: string }>;
  close: () => Promise<void>;
} {
  const { prisma, env, storage, logger, aiClient = new HttpAiServiceClient(env) } = params;
  const connection = parseRedisConnectionOptions(env.REDIS_URL);
  const orchestrator = new GradingOrchestrator(prisma, env, storage, aiClient, logger);

  const dlq = new Queue<EssayGradingJobPayload & { failedReason: string }>(GRADING_DLQ_NAME, {
    connection,
  });

  const worker = new Worker<EssayGradingJobPayload>(
    GRADING_QUEUE_NAME,
    async (job: Job<EssayGradingJobPayload>) => {
      return orchestrator.processEssayGradingJob(job.data);
    },
    {
      connection,
      concurrency: env.GRADING_CONCURRENCY,
      drainDelay: 15,
      stalledInterval: 300_000,
    },
  );

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id, answerId: job.data.answerId }, 'Essay grading job completed');
  });

  worker.on('failed', (job, err) => {
    void (async () => {
      logger.error(
        { jobId: job?.id, answerId: job?.data.answerId, err: err.message },
        'Essay grading job failed',
      );
      if (!job) return;
      const maxAttempts = job.opts.attempts ?? 3;
      if (job.attemptsMade >= maxAttempts) {
        await dlq
          .add('dead-letter', { ...job.data, failedReason: err.message })
          .catch(() => undefined);

        const existingAnswer = await prisma.answer.findFirst({
          where: { id: job.data.answerId },
          include: {
            question: {
              include: {
                modelAnswer: true,
                rubricCriteria: { where: { deletedAt: null }, orderBy: { orderIndex: 'asc' } },
              },
            },
            gradingResults: { orderBy: { version: 'desc' }, take: 1 },
          },
        });
        if (existingAnswer) {
          const nextVersion = (existingAnswer.gradingResults[0]?.version ?? 0) + 1;
          await orchestrator.persistFallbackResult({
            answerId: existingAnswer.id,
            attemptId: job.data.attemptId,
            version: nextVersion,
            rubricVersion: existingAnswer.question.modelAnswer?.rubricVersion ?? 1,
            criteria: existingAnswer.question.rubricCriteria,
            reason: 'AI_SERVICE_FAILED',
            explanationAr:
              'تعذر إتمام التصحيح الآلي بعد عدة محاولات؛ السؤال في انتظار مراجعة المعلم.',
            errorCode: err.message,
          });
        }
      }
    })();
  });

  return {
    worker,
    dlq,
    close: async () => {
      await worker.close();
      await dlq.close();
    },
  };
}

/**
 * Registers the repeatable nightly retention cleanup job (02:00 UTC daily)
 * and starts its BullMQ worker.
 */
export async function createRetentionWorker(params: {
  prisma: PrismaClient;
  env: AppEnv;
  storage: StorageAdapter;
  logger: Logger;
}): Promise<{
  queue: Queue;
  worker: Worker;
  close: () => Promise<void>;
}> {
  const { prisma, env, storage, logger } = params;
  const connection = parseRedisConnectionOptions(env.REDIS_URL);
  const retentionService = new RetentionService(prisma, env, storage, logger);

  const queue = new Queue(RETENTION_QUEUE_NAME, { connection });
  await queue.add(
    'nightly-retention',
    {},
    {
      repeat: { pattern: '0 2 * * *' },
      jobId: 'nightly-retention',
      removeOnComplete: 30,
      removeOnFail: 30,
    },
  );

  const worker = new Worker(
    RETENTION_QUEUE_NAME,
    async () => {
      const summary = await retentionService.purgeExpiredImages();
      logger.info(summary, 'Nightly retention purge completed');
      return summary;
    },
    {
      connection,
      concurrency: 1,
      drainDelay: 30,
      stalledInterval: 600_000,
    },
  );

  worker.on('failed', (_job, err) => {
    logger.error({ err: err.message }, 'Nightly retention purge failed');
  });

  return {
    queue,
    worker,
    close: async () => {
      await worker.close();
      await queue.close();
    },
  };
}
