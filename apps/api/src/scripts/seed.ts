import { loadEnv } from '../config/env.js';
import { createLogger } from '../lib/logger.js';
import { getPrisma } from '../lib/prisma.js';
import { hashPassword } from '../lib/security.js';

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
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
