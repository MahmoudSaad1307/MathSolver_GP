import crypto from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

export interface FakeUserRow {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
  role: 'TEACHER';
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface FakeRefreshTokenRow {
  id: string;
  userId: string;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedById: string | null;
  createdAt: Date;
}

export interface FakeAuditRow {
  id: string;
  actorType: string;
  actorId: string;
  action: string;
  entity: string;
  entityId: string;
  diff?: unknown;
  ipHash: string;
  ts: Date;
}

export function createInMemoryAuthPrisma(seedUsers: FakeUserRow[] = []) {
  const users: FakeUserRow[] = [...seedUsers];
  const refreshTokens: FakeRefreshTokenRow[] = [];
  const auditLogs: FakeAuditRow[] = [];

  const mock = {
    _state: { users, refreshTokens, auditLogs },
    $queryRaw: async () => [{ '?column?': 1 }],
    $transaction: async <T>(ops: Array<Promise<T>>) => Promise.all(ops),
    user: {
      findUnique: async ({ where }: { where: { email?: string; id?: string } }) => {
        if (where.email) {
          return users.find((u) => u.email === where.email) ?? null;
        }
        if (where.id) {
          return users.find((u) => u.id === where.id) ?? null;
        }
        return null;
      },
    },
    refreshToken: {
      create: async ({
        data,
      }: {
        data: Omit<FakeRefreshTokenRow, 'id' | 'revokedAt' | 'replacedById' | 'createdAt'> & {
          id?: string;
        };
      }) => {
        const row: FakeRefreshTokenRow = {
          id: data.id ?? crypto.randomUUID(),
          userId: data.userId,
          tokenHash: data.tokenHash,
          familyId: data.familyId,
          expiresAt: data.expiresAt,
          revokedAt: null,
          replacedById: null,
          createdAt: new Date(),
        };
        refreshTokens.push(row);
        return row;
      },
      findUnique: async ({
        where,
        include,
      }: {
        where: { tokenHash: string };
        include?: { user?: boolean };
      }) => {
        const found = refreshTokens.find((t) => t.tokenHash === where.tokenHash);
        if (!found) return null;
        if (include?.user) {
          const user = users.find((u) => u.id === found.userId);
          return user ? { ...found, user } : null;
        }
        return found;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<FakeRefreshTokenRow>;
      }) => {
        const row = refreshTokens.find((t) => t.id === where.id);
        if (!row) throw new Error('Token not found');
        Object.assign(row, data);
        return row;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { userId?: string; familyId?: string; tokenHash?: string; revokedAt?: null };
        data: Partial<FakeRefreshTokenRow>;
      }) => {
        let count = 0;
        for (const row of refreshTokens) {
          const matchesUser = where.userId === undefined || row.userId === where.userId;
          const matchesFamily = where.familyId === undefined || row.familyId === where.familyId;
          const matchesHash = where.tokenHash === undefined || row.tokenHash === where.tokenHash;
          const matchesRevoked = where.revokedAt === undefined || row.revokedAt === where.revokedAt;
          if (matchesUser && matchesFamily && matchesHash && matchesRevoked) {
            Object.assign(row, data);
            count += 1;
          }
        }
        return { count };
      },
    },
    auditLog: {
      create: async ({ data }: { data: Omit<FakeAuditRow, 'id' | 'ts'> }) => {
        const row: FakeAuditRow = {
          id: crypto.randomUUID(),
          ts: new Date(),
          ...data,
        };
        auditLogs.push(row);
        return row;
      },
    },
  };

  return mock as unknown as PrismaClient & {
    _state: {
      users: FakeUserRow[];
      refreshTokens: FakeRefreshTokenRow[];
      auditLogs: FakeAuditRow[];
    };
  };
}
