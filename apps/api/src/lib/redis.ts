import { Redis } from 'ioredis';
import { normalizeRedisUrl } from '../services/gradingDispatcher.js';
import type { Logger } from './logger.js';

export function createRedisClient(redisUrl: string, logger: Logger): Redis {
  const client = new Redis(normalizeRedisUrl(redisUrl), {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: true,
  });

  client.on('error', (err: Error) => {
    logger.warn({ err: err.message }, 'Redis connection error');
  });

  return client;
}
