import crypto from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type {
  StudentAccountMeResponse,
  StudentEnrollmentSummary,
  StudentProfile,
  StudentRegisterInput,
} from '@mathlens/shared';
import type { AppEnv } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import {
  generateOpaqueToken,
  hashIp,
  hashPassword,
  sha256Hex,
  signStudentSessionToken,
  verifyPassword,
} from '../lib/security.js';
import { deriveStudentFlowStep } from './studentFlow.js';

const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface StudentAuthTokensResult extends StudentAccountMeResponse {
  sessionToken: string;
  refreshToken: string;
}

function toStudentProfile(account: {
  id: string;
  email: string;
  displayName: string;
  consentAcceptedAt: Date | null;
}): StudentProfile {
  return {
    id: account.id,
    email: account.email,
    displayName: account.displayName,
    consentAcceptedAt: account.consentAcceptedAt ? account.consentAcceptedAt.toISOString() : null,
    role: 'STUDENT',
  };
}

export class StudentAuthService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly env: AppEnv,
  ) {}

  async register(input: StudentRegisterInput, ip?: string): Promise<StudentAuthTokensResult> {
    const normalizedEmail = input.email.trim().toLowerCase();
    const existing = await this.prisma.studentAccount.findUnique({
      where: { email: normalizedEmail },
    });

    if (existing && existing.deletedAt === null) {
      throw new AppError('EMAIL_ALREADY_REGISTERED');
    }

    const passwordHash = await hashPassword(input.password);
    const consentAcceptedAt = input.consentAccepted !== false ? new Date() : null;

    const account = existing
      ? await this.prisma.studentAccount.update({
          where: { id: existing.id },
          data: {
            passwordHash,
            displayName: input.displayName.trim(),
            consentAcceptedAt,
            deletedAt: null,
          },
        })
      : await this.prisma.studentAccount.create({
          data: {
            email: normalizedEmail,
            passwordHash,
            displayName: input.displayName.trim(),
            consentAcceptedAt,
          },
        });

    const refreshToken = generateOpaqueToken(32);
    const familyId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);

    await this.prisma.studentRefreshToken.create({
      data: {
        accountId: account.id,
        tokenHash: sha256Hex(refreshToken),
        familyId,
        expiresAt,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        actorType: 'STUDENT',
        actorId: account.id,
        action: 'STUDENT_REGISTER',
        entity: 'StudentAccount',
        entityId: account.id,
        ipHash: hashIp(ip, this.env.IP_HASH_SALT),
      },
    });

    const sessionToken = signStudentSessionToken(
      {
        id: account.id,
        cohortId: '',
        accountId: account.id,
        email: account.email,
      },
      this.env,
    );

    return {
      sessionToken,
      refreshToken,
      account: toStudentProfile(account),
      activeEnrollmentId: null,
      enrollments: [],
    };
  }

  async login(email: string, password: string, ip?: string): Promise<StudentAuthTokensResult> {
    const normalizedEmail = email.trim().toLowerCase();
    const account = await this.prisma.studentAccount.findUnique({
      where: { email: normalizedEmail },
    });

    if (!account || account.deletedAt !== null) {
      throw new AppError('INVALID_CREDENTIALS');
    }

    const ok = await verifyPassword(account.passwordHash, password);
    if (!ok) {
      throw new AppError('INVALID_CREDENTIALS');
    }

    const refreshToken = generateOpaqueToken(32);
    const familyId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);

    await this.prisma.studentRefreshToken.create({
      data: {
        accountId: account.id,
        tokenHash: sha256Hex(refreshToken),
        familyId,
        expiresAt,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        actorType: 'STUDENT',
        actorId: account.id,
        action: 'STUDENT_LOGIN',
        entity: 'StudentAccount',
        entityId: account.id,
        ipHash: hashIp(ip, this.env.IP_HASH_SALT),
      },
    });

    const dashboard = await this.getAccountDashboard(account.id);
    const activeEnrollment =
      dashboard.enrollments.find((e) => e.studentId === dashboard.activeEnrollmentId) ?? null;

    const sessionToken = signStudentSessionToken(
      {
        id: activeEnrollment ? activeEnrollment.studentId : account.id,
        cohortId: activeEnrollment ? activeEnrollment.cohortId : '',
        accountId: account.id,
        email: account.email,
      },
      this.env,
    );

    return {
      sessionToken,
      refreshToken,
      ...dashboard,
    };
  }

  async refresh(
    rawRefreshToken: string,
    preferredStudentId?: string | null,
    ip?: string,
  ): Promise<StudentAuthTokensResult> {
    if (!rawRefreshToken) {
      throw new AppError('UNAUTHORIZED');
    }

    const tokenHash = sha256Hex(rawRefreshToken);
    const existing = await this.prisma.studentRefreshToken.findUnique({
      where: { tokenHash },
      include: { account: true },
    });

    if (!existing || existing.account.deletedAt !== null) {
      throw new AppError('UNAUTHORIZED');
    }

    if (existing.revokedAt !== null) {
      await this.prisma.studentRefreshToken.updateMany({
        where: { familyId: existing.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.prisma.auditLog.create({
        data: {
          actorType: 'STUDENT',
          actorId: existing.accountId,
          action: 'STUDENT_REFRESH_TOKEN_REUSE_REVOKED',
          entity: 'StudentRefreshToken',
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
      this.prisma.studentRefreshToken.create({
        data: {
          id: nextTokenId,
          accountId: existing.accountId,
          tokenHash: sha256Hex(nextRefreshToken),
          familyId: existing.familyId,
          expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
        },
      }),
      this.prisma.studentRefreshToken.update({
        where: { id: existing.id },
        data: {
          revokedAt: now,
          replacedById: nextTokenId,
        },
      }),
    ]);

    const dashboard = await this.getAccountDashboard(existing.accountId, preferredStudentId);
    const activeEnrollment =
      dashboard.enrollments.find((e) => e.studentId === dashboard.activeEnrollmentId) ?? null;

    const sessionToken = signStudentSessionToken(
      {
        id: activeEnrollment ? activeEnrollment.studentId : existing.account.id,
        cohortId: activeEnrollment ? activeEnrollment.cohortId : '',
        accountId: existing.account.id,
        email: existing.account.email,
      },
      this.env,
    );

    return {
      sessionToken,
      refreshToken: nextRefreshToken,
      ...dashboard,
    };
  }

  async logout(rawRefreshToken?: string): Promise<void> {
    if (!rawRefreshToken) {
      return;
    }
    const tokenHash = sha256Hex(rawRefreshToken);
    await this.prisma.studentRefreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async getAccountDashboard(
    accountId: string,
    preferredStudentId?: string | null,
  ): Promise<StudentAccountMeResponse> {
    const account = await this.prisma.studentAccount.findUnique({
      where: { id: accountId },
    });

    if (!account || account.deletedAt !== null) {
      throw new AppError('UNAUTHORIZED');
    }

    const rows = await this.prisma.student.findMany({
      where: { accountId: account.id, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      include: {
        cohort: {
          include: {
            topic: {
              include: {
                examModels: {
                  where: { deletedAt: null },
                  select: { id: true, modelNumber: true },
                },
              },
            },
          },
        },
        attempts: {
          include: {
            examModel: { select: { id: true, modelNumber: true } },
          },
        },
        videoSessions: true,
      },
    });

    const validRows = rows.filter(
      (r) => r.cohort.deletedAt === null && r.cohort.topic.deletedAt === null,
    );

    const enrollments: StudentEnrollmentSummary[] = validRows.map((student) => {
      const { cohort } = student;
      const { topic } = cohort;
      const preTestAttempt = student.attempts.find((a) => a.examModel.modelNumber === 1) ?? null;
      const postTestAttempt = student.attempts.find((a) => a.examModel.modelNumber === 2) ?? null;
      const videoSession = student.videoSessions.find((v) => v.topicId === topic.id) ?? null;

      const { step } = deriveStudentFlowStep({
        consentAcceptedAt: student.consentAcceptedAt ?? account.consentAcceptedAt,
        cohort: {
          group: cohort.group,
          requireVideoBeforePost: cohort.requireVideoBeforePost,
          showProvisionalScore: cohort.showProvisionalScore,
          postTestOpensAt: cohort.postTestOpensAt,
        },
        preTestAttempt: preTestAttempt ? { status: preTestAttempt.status } : null,
        postTestAttempt: postTestAttempt ? { status: postTestAttempt.status } : null,
        videoSession: videoSession
          ? {
              startedAt: videoSession.startedAt,
              watchedSeconds: videoSession.watchedSeconds,
              unlockedPostAt: videoSession.unlockedPostAt,
              manualUnlockedById: videoSession.manualUnlockedById,
            }
          : null,
      });

      return {
        studentId: student.id,
        cohortId: cohort.id,
        cohortName: cohort.name,
        joinCode: cohort.joinCode,
        group: cohort.group,
        requireVideoBeforePost: cohort.requireVideoBeforePost,
        topicId: topic.id,
        topicTitle: topic.title,
        step,
        enrolledAt: student.createdAt.toISOString(),
        preTestAttempt: preTestAttempt
          ? {
              id: preTestAttempt.id,
              examModelId: preTestAttempt.examModelId,
              status: preTestAttempt.status,
              totalScore: preTestAttempt.totalScore,
              maxScore: preTestAttempt.maxScore,
              submittedAt: preTestAttempt.submittedAt
                ? preTestAttempt.submittedAt.toISOString()
                : null,
              deadlineAt: preTestAttempt.deadlineAt.toISOString(),
            }
          : null,
        postTestAttempt: postTestAttempt
          ? {
              id: postTestAttempt.id,
              examModelId: postTestAttempt.examModelId,
              status: postTestAttempt.status,
              totalScore: postTestAttempt.totalScore,
              maxScore: postTestAttempt.maxScore,
              submittedAt: postTestAttempt.submittedAt
                ? postTestAttempt.submittedAt.toISOString()
                : null,
              deadlineAt: postTestAttempt.deadlineAt.toISOString(),
            }
          : null,
        videoProgress: {
          watchedSeconds: videoSession?.watchedSeconds ?? 0,
          visitedCount: videoSession?.visitedQuestionIds.length ?? 0,
          requiredCount: 0,
          unlockedPostAt: videoSession?.unlockedPostAt
            ? videoSession.unlockedPostAt.toISOString()
            : null,
        },
      };
    });

    const preferred =
      preferredStudentId && enrollments.some((e) => e.studentId === preferredStudentId)
        ? preferredStudentId
        : (enrollments[0]?.studentId ?? null);

    return {
      account: toStudentProfile(account),
      activeEnrollmentId: preferred,
      enrollments,
    };
  }
}
