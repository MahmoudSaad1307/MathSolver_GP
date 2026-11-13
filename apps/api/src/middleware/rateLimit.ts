import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';
import { RedisStore, type RedisReply } from 'rate-limit-redis';
import type { Redis } from 'ioredis';
import { ERROR_CATALOG } from '@mathlens/shared';

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  prefix: string;
  redis?: Redis;
}

export function createRateLimiter(options: RateLimitOptions): RateLimitRequestHandler {
  const { windowMs, max, prefix, redis } = options;

  return rateLimit({
    windowMs,
    max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: {
      error: {
        code: 'RATE_LIMITED',
        message_ar: ERROR_CATALOG.RATE_LIMITED.message_ar,
        message_en: ERROR_CATALOG.RATE_LIMITED.message_en,
      },
    },
    ...(redis
      ? {
          store: new RedisStore({
            prefix: `rl:${prefix}:`,
            sendCommand: (...args: string[]) =>
              redis.call(args[0]!, ...args.slice(1)) as Promise<RedisReply>,
          }),
        }
      : {}),
  });
}
