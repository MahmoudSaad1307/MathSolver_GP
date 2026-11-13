import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SeedTopicBundleSchema } from '@mathlens/shared';
import { loadEnv } from '../config/env.js';
import { createLogger } from '../lib/logger.js';
import { getPrisma } from '../lib/prisma.js';
import { hashPassword } from '../lib/security.js';
import { ExamImportExportService } from '../services/examImportExportService.js';

async function main() {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL);
  const prisma = getPrisma();

  const email = env.SEED_TEACHER_EMAIL.trim().toLowerCase();
  const passwordHash = await hashPassword(env.SEED_TEACHER_PASSWORD);

  const teacher = await prisma.user.upsert({
    where: { email },
    update: {
      displayName: env.SEED_TEACHER_NAME,
    },
    create: {
      email,
      passwordHash,
      displayName: env.SEED_TEACHER_NAME,
      role: 'TEACHER',
    },
  });

  logger.info({ teacherId: teacher.id, email: teacher.email }, 'Seeded default teacher');

  const seedFile = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../seed/exams.seed.json',
  );
  const rawSeed = await readFile(seedFile, 'utf8');
  const bundle = SeedTopicBundleSchema.parse(JSON.parse(rawSeed) as unknown);
  const importService = new ExamImportExportService(prisma, env);
  const seedResult = await importService.seedTopicBundleIfMissing(teacher.id, bundle);

  logger.info(
    { teacherId: teacher.id, topicId: seedResult.topicId, seeded: seedResult.seeded },
    seedResult.seeded ? 'Seeded default exam topic bundle' : 'Default exam topic already present',
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
