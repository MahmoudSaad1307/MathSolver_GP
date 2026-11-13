import dotenv from 'dotenv';
import path from 'node:path';
import { z } from 'zod';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TRUST_PROXY: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  STUDENT_JWT_SECRET: z.string().min(32),
  VIDEO_UNLOCK_HMAC_SECRET: z.string().min(32),
  IP_HASH_SALT: z.string().min(16),
  COOKIE_SECURE: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  CORS_ORIGINS: z.string().default('http://localhost:5173,http://localhost:8080'),
  AI_SERVICE_URL: z.string().url().default('http://localhost:8000'),
  AI_INTERNAL_KEY: z.string().min(16),
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).default(45000),
  GRADING_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(3),
  AI_DAILY_CAP_USD: z.coerce.number().min(0).default(25),
  AI_STUDENT_DAILY_CALL_CAP: z.coerce.number().int().min(1).default(20),
  STORAGE_DRIVER: z.enum(['s3', 'local']).default('s3'),
  S3_ENDPOINT: z.string().default('http://localhost:9000'),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('mathlens-answers'),
  S3_ACCESS_KEY: z.string().default('minioadmin'),
  S3_SECRET_KEY: z.string().default('minioadmin_change_me'),
  S3_FORCE_PATH_STYLE: z
    .string()
    .optional()
    .transform((v) => v !== 'false' && v !== '0'),
  LOCAL_STORAGE_DIR: z.string().default('./storage-dev'),
  RETENTION_DAYS: z.coerce.number().int().min(1).default(30),
  MAX_IMAGE_BYTES: z.coerce.number().int().min(1024).default(8_388_608),
  MAX_IMAGES_PER_ANSWER: z.coerce.number().int().min(1).max(5).default(2),
  VIRUS_SCAN_DRIVER: z.enum(['noop', 'clamav']).default('noop'),
  CLAMAV_HOST: z.string().default('localhost'),
  CLAMAV_PORT: z.coerce.number().int().default(3310),
  SEED_TEACHER_EMAIL: z.string().email().default('teacher@mathlens.local'),
  SEED_TEACHER_PASSWORD: z.string().min(8).default('TeacherPass123!'),
  SEED_TEACHER_NAME: z.string().default('أ. أحمد محمود'),
  SENTRY_DSN: z.string().optional().default(''),
});

export type AppEnv = z.infer<typeof EnvSchema>;

export function loadEnv(overrides: Record<string, string | undefined> = {}): AppEnv {
  const merged = { ...process.env, ...overrides };
  const parsed = EnvSchema.safeParse(merged);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid API environment configuration: ${issues}`);
  }
  return parsed.data;
}
