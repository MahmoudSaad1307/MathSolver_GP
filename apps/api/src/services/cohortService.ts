import crypto from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type {
  CreateCohortInput,
  RandomizeRosterSplitInput,
  UpdateCohortInput,
} from '@mathlens/shared';
import type { AppEnv } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import { scopedCohortWhere, scopedTopicWhere, writeAuditLog } from '../lib/scoping.js';
import { generateUnambiguousCode } from '../lib/security.js';

function createMulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class CohortService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly env: AppEnv,
  ) {}

  private async generateUniqueJoinCode(): Promise<string> {
    for (let attempt = 0; attempt < 15; attempt += 1) {
      const candidate = generateUnambiguousCode(6);
      const existing = await this.prisma.cohort.findUnique({
        where: { joinCode: candidate },
        select: { id: true },
      });
      if (!existing) {
        return candidate;
      }
    }
    throw new AppError('INTERNAL_ERROR', {
      messageEn: 'Failed to allocate unique cohort join code.',
      messageAr: 'تعذر إنشاء كود فريد للمجموعة. حاول مرة أخرى.',
    });
  }

  async listCohorts(teacherId: string, topicId?: string) {
    return this.prisma.cohort.findMany({
      where: {
        ...scopedCohortWhere(teacherId),
        ...(topicId ? { topicId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: {
        topic: {
          select: { id: true, title: true },
        },
        _count: {
          select: {
            students: { where: { deletedAt: null } },
          },
        },
      },
    });
  }

  async getCohort(teacherId: string, cohortId: string) {
    const cohort = await this.prisma.cohort.findFirst({
      where: {
        id: cohortId,
        ...scopedCohortWhere(teacherId),
      },
      include: {
        topic: {
          select: { id: true, title: true, videoId: true, minWatchSeconds: true },
        },
        students: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            displayName: true,
            resumeCode: true,
            consentAcceptedAt: true,
            createdAt: true,
          },
        },
      },
    });
    if (!cohort) {
      throw new AppError('NOT_FOUND');
    }
    return cohort;
  }

  async createCohort(teacherId: string, input: CreateCohortInput, ip?: string) {
    const topic = await this.prisma.topic.findFirst({
      where: {
        id: input.topicId,
        ...scopedTopicWhere(teacherId),
      },
      select: { id: true },
    });
    if (!topic) {
      throw new AppError('NOT_FOUND');
    }

    const joinCode = await this.generateUniqueJoinCode();
    const requireVideoBeforePost = input.requireVideoBeforePost ?? input.group === 'TREATMENT';

    const cohort = await this.prisma.$transaction(async (tx) => {
      const created = await tx.cohort.create({
        data: {
          topicId: topic.id,
          teacherId,
          name: input.name,
          joinCode,
          group: input.group,
          requireVideoBeforePost,
          requireWrongSegmentVisits: input.requireWrongSegmentVisits,
          showProvisionalScore: input.showProvisionalScore,
          postTestOpensAt: input.postTestOpensAt ? new Date(input.postTestOpensAt) : null,
          status: 'OPEN',
        },
      });

      await writeAuditLog(tx, this.env, {
        actorType: 'TEACHER',
        actorId: teacherId,
        action: 'COHORT_CREATE',
        entity: 'Cohort',
        entityId: created.id,
        diff: { name: created.name, group: created.group, joinCode: created.joinCode },
        ip,
      });

      return created;
    });

    return this.getCohort(teacherId, cohort.id);
  }

  async updateCohort(teacherId: string, cohortId: string, input: UpdateCohortInput, ip?: string) {
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.cohort.findFirst({
        where: { id: cohortId, ...scopedCohortWhere(teacherId) },
        select: { id: true },
      });
      if (!existing) {
        throw new AppError('NOT_FOUND');
      }

      await tx.cohort.update({
        where: { id: existing.id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.group !== undefined ? { group: input.group } : {}),
          ...(input.requireVideoBeforePost !== undefined
            ? { requireVideoBeforePost: input.requireVideoBeforePost }
            : {}),
          ...(input.requireWrongSegmentVisits !== undefined
            ? { requireWrongSegmentVisits: input.requireWrongSegmentVisits }
            : {}),
          ...(input.showProvisionalScore !== undefined
            ? { showProvisionalScore: input.showProvisionalScore }
            : {}),
          ...(input.postTestOpensAt !== undefined
            ? { postTestOpensAt: input.postTestOpensAt ? new Date(input.postTestOpensAt) : null }
            : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
        },
      });

      await writeAuditLog(tx, this.env, {
        actorType: 'TEACHER',
        actorId: teacherId,
        action: 'COHORT_UPDATE',
        entity: 'Cohort',
        entityId: existing.id,
        diff: input,
        ip,
      });
    });

    return this.getCohort(teacherId, cohortId);
  }

  async deleteCohort(teacherId: string, cohortId: string, ip?: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.cohort.findFirst({
        where: { id: cohortId, ...scopedCohortWhere(teacherId) },
        select: { id: true },
      });
      if (!existing) {
        throw new AppError('NOT_FOUND');
      }

      await tx.cohort.update({
        where: { id: existing.id },
        data: { deletedAt: new Date(), status: 'ARCHIVED' },
      });

      await writeAuditLog(tx, this.env, {
        actorType: 'TEACHER',
        actorId: teacherId,
        action: 'COHORT_DELETE',
        entity: 'Cohort',
        entityId: existing.id,
        ip,
      });
    });
  }

  randomizeRosterSplit(input: RandomizeRosterSplitInput): {
    seedUsed: number;
    treatment: string[];
    control: string[];
  } {
    const seedUsed = input.seed ?? crypto.randomInt(1, 2_147_483_647);
    const nextRand = createMulberry32(seedUsed);
    const shuffled = [...input.studentNames];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(nextRand() * (i + 1));
      const tmp = shuffled[i]!;
      shuffled[i] = shuffled[j]!;
      shuffled[j] = tmp;
    }

    const midpoint = Math.ceil(shuffled.length / 2);
    return {
      seedUsed,
      treatment: shuffled.slice(0, midpoint),
      control: shuffled.slice(midpoint),
    };
  }
}
