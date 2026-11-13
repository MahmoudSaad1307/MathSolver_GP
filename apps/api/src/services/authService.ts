import crypto from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { TeacherProfile } from '@mathlens/shared';
import type { AppEnv } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import {
  generateOpaqueToken,
  hashIp,
  sha256Hex,
  signTeacherAccessToken,
  verifyPassword,
} from '../lib/security.js';

const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface AuthTokensResult {
  accessToken: string;
  refreshToken: string;
  teacher: TeacherProfile;
}

export class TeacherAuthService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly env: AppEnv,
  ) {}

  async login(email: string, password: string, ip?: string): Promise<AuthTokensResult> {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user || user.deletedAt !== null) {
      throw new AppError('INVALID_CREDENTIALS');
    }

    const ok = await verifyPassword(user.passwordHash, password);
    if (!ok) {
      throw new AppError('INVALID_CREDENTIALS');
    }

    const refreshToken = generateOpaqueToken(32);
    const familyId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256Hex(refreshToken),
        familyId,
        expiresAt,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        actorType: 'TEACHER',
        actorId: user.id,
        action: 'TEACHER_LOGIN',
        entity: 'User',
        entityId: user.id,
        ipHash: hashIp(ip, this.env.IP_HASH_SALT),
      },
    });

    const accessToken = signTeacherAccessToken(
      { id: user.id, email: user.email, role: 'TEACHER' },
      this.env,
    );

    return {
      accessToken,
      refreshToken,
      teacher: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: 'TEACHER',
      },
    };
  }

  async refresh(rawRefreshToken: string, ip?: string): Promise<AuthTokensResult> {
    if (!rawRefreshToken) {
      throw new AppError('UNAUTHORIZED');
    }

    const tokenHash = sha256Hex(rawRefreshToken);
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!existing || existing.user.deletedAt !== null) {
      throw new AppError('UNAUTHORIZED');
    }

    // Reuse detection: if an already-revoked token is replayed, revoke the entire family
    if (existing.revokedAt !== null) {
      await this.prisma.refreshToken.updateMany({
        where: { familyId: existing.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.prisma.auditLog.create({
        data: {
          actorType: 'TEACHER',
          actorId: existing.userId,
          action: 'REFRESH_TOKEN_REUSE_REVOKED',
          entity: 'RefreshToken',
          entityId: existing.id,
          ipHash: hashIp(ip, this.env.IP_HASH_SALT),
        },
      });
      throw new AppError('UNAUTHORIZED');
    }

    if (existing.expiresAt.getTime() <= Date.now()) {
      throw new AppError('UNAUTHORIZED');
    }

    const nextRefreshToken = generateOpaqueToken(32);
    const nextTokenId = crypto.randomUUID();
    const now = new Date();

    await this.prisma.$transaction([
      this.prisma.refreshToken.create({
        data: {
          id: nextTokenId,
          userId: existing.userId,
          tokenHash: sha256Hex(nextRefreshToken),
          familyId: existing.familyId,
          expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
        },
      }),
      this.prisma.refreshToken.update({
        where: { id: existing.id },
        data: {
          revokedAt: now,
          replacedById: nextTokenId,
        },
      }),
    ]);

    const accessToken = signTeacherAccessToken(
      { id: existing.user.id, email: existing.user.email, role: 'TEACHER' },
      this.env,
    );

    return {
      accessToken,
      refreshToken: nextRefreshToken,
      teacher: {
        id: existing.user.id,
        email: existing.user.email,
        displayName: existing.user.displayName,
        role: 'TEACHER',
      },
    };
  }

  async logout(rawRefreshToken?: string): Promise<void> {
    if (!rawRefreshToken) {
      return;
    }
    const tokenHash = sha256Hex(rawRefreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async logoutAll(userId: string, ip?: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.prisma.auditLog.create({
      data: {
        actorType: 'TEACHER',
        actorId: userId,
        action: 'TEACHER_LOGOUT_ALL',
        entity: 'User',
        entityId: userId,
        ipHash: hashIp(ip, this.env.IP_HASH_SALT),
      },
    });
  }

  async getProfile(userId: string): Promise<TeacherProfile> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user || user.deletedAt !== null) {
      throw new AppError('UNAUTHORIZED');
    }
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: 'TEACHER',
    };
  }
}
