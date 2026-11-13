import type { ActorType, Prisma, PrismaClient } from '@prisma/client';
import type { AppEnv } from '../config/env.js';
import { scopedTopicWhere } from './prisma.js';
import { hashIp } from './security.js';

export { scopedTopicWhere };

export type PrismaTx = Prisma.TransactionClient | PrismaClient;

/** Ownership scope filter for teacher-owned Cohorts (excludes soft-deleted rows). */
export function scopedCohortWhere(teacherId: string) {
  return {
    teacherId,
    deletedAt: null,
  } as const;
}

export async function writeAuditLog(
  tx: PrismaTx,
  env: AppEnv,
  params: {
    actorType: ActorType;
    actorId: string;
    action: string;
    entity: string;
    entityId: string;
    diff?: unknown;
    ip?: string;
  },
): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorType: params.actorType,
      actorId: params.actorId,
      action: params.action,
      entity: params.entity,
      entityId: params.entityId,
      ...(params.diff !== undefined ? { diff: params.diff as Prisma.InputJsonValue } : {}),
      ipHash: hashIp(params.ip, env.IP_HASH_SALT),
    },
  });
}
