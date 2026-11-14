import { Queue, Worker, type Job } from 'bullmq';
import type { Logger } from '../lib/logger.js';
import { parseRedisConnectionOptions } from './gradingDispatcher.js';

export const PDF_IMPORT_QUEUE_NAME = 'mathlens-pdf-import';

export interface PdfImportJobPayload {
  jobId: string;
}

export interface PdfImportDispatcher {
  enqueue(payload: PdfImportJobPayload): Promise<void>;
  close?(): Promise<void>;
}

export class NoopPdfImportDispatcher implements PdfImportDispatcher {
  public readonly enqueued: PdfImportJobPayload[] = [];

  enqueue(payload: PdfImportJobPayload): Promise<void> {
    this.enqueued.push(payload);
    return Promise.resolve();
  }
}

export class BullMqPdfImportDispatcher implements PdfImportDispatcher {
  private readonly queue: Queue<PdfImportJobPayload>;

  constructor(
    redisUrl: string,
    private readonly logger: Logger,
  ) {
    this.queue = new Queue<PdfImportJobPayload>(PDF_IMPORT_QUEUE_NAME, {
      connection: parseRedisConnectionOptions(redisUrl),
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 200,
        removeOnFail: 500,
      },
    });
  }

  async enqueue(payload: PdfImportJobPayload): Promise<void> {
    await this.queue.add('extract-pdf-exam', payload, {
      jobId: payload.jobId,
    });
    this.logger.info({ jobId: payload.jobId }, 'Enqueued PDF import extraction job');
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}

export function createPdfImportWorker(
  redisUrl: string,
  processor: (jobId: string) => Promise<void>,
  logger: Logger,
  concurrency = 2,
): Worker<PdfImportJobPayload> {
  const worker = new Worker<PdfImportJobPayload>(
    PDF_IMPORT_QUEUE_NAME,
    async (job: Job<PdfImportJobPayload>) => {
      await processor(job.data.jobId);
    },
    {
      connection: parseRedisConnectionOptions(redisUrl),
      concurrency,
    },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.data?.jobId, err: err.message }, 'PDF import BullMQ job failed');
  });

  return worker;
}
