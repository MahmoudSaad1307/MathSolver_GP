import { loadEnv, type AppEnv } from '../../src/config/env.js';

export function createTestEnv(): AppEnv {
  return loadEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: 'postgresql://mathlens:test@localhost:5432/mathlens_test',
    JWT_ACCESS_SECRET: 'test_access_secret_at_least_32_characters_long',
    JWT_REFRESH_SECRET: 'test_refresh_secret_at_least_32_characters_long',
    STUDENT_JWT_SECRET: 'test_student_secret_at_least_32_characters_long',
    VIDEO_UNLOCK_HMAC_SECRET: 'test_unlock_secret_at_least_32_characters_long',
    IP_HASH_SALT: 'test_ip_salt_at_least_32_chars',
    AI_INTERNAL_KEY: 'test_internal_key_at_least_32_chars',
    CORS_ORIGINS: 'http://localhost:5173',
    COOKIE_SECURE: 'false',
  });
}
