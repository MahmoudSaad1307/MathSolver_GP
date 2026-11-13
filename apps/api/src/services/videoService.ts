import type { Prisma, PrismaClient } from '@prisma/client';
import type { VideoHeartbeatInput } from '@mathlens/shared';
import type { AppEnv } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import { writeAuditLog } from '../lib/scoping.js';
import { signVideoUnlock } from '../lib/security.js';
import { deriveStudentFlowStep } from './studentFlow.js';

export type WatchInterval = [number, number];

function toJson(val: unknown): Prisma.InputJsonValue {
  return val as Prisma.InputJsonValue;
}

export function parseIntervals(raw: unknown): WatchInterval[] {
  if (!Array.isArray(raw)) return [];
  const parsed: WatchInterval[] = [];
  for (const entry of raw) {
    if (
      Array.isArray(entry) &&
      entry.length === 2 &&
      typeof entry[0] === 'number' &&
      typeof entry[1] === 'number' &&
      Number.isFinite(entry[0]) &&
      Number.isFinite(entry[1]) &&
      entry[1] > entry[0]
    ) {
      parsed.push([Math.max(0, entry[0]), Math.max(0, entry[1])]);
    }
  }
  return normalizeIntervals(parsed);
}

export function normalizeIntervals(intervals: WatchInterval[]): WatchInterval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals]
    .map(([a, b]): WatchInterval => [Math.max(0, a), Math.max(a, b)])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);

  if (sorted.length === 0) return [];
  const merged: WatchInterval[] = [sorted[0]!];
  for (let i = 1; i < sorted.length; i += 1) {
    const [start, end] = sorted[i]!;
    const last = merged[merged.length - 1]!;
    if (start <= last[1] + 0.5) {
      last[1] = Math.max(last[1], end);
    } else {
      merged.push([start, end]);
    }
  }
  return merged.map(([a, b]): WatchInterval => [
    Math.round(a * 100) / 100,
    Math.round(b * 100) / 100,
  ]);
}

export function mergeWatchSegment(
  existing: WatchInterval[],
  startSec: number,
  endSec: number,
): { intervals: WatchInterval[]; totalSeconds: number } {
  const safeStart = Math.max(0, startSec);
  const safeEnd = Math.max(safeStart, endSec);
  const next =
    safeEnd > safeStart
      ? normalizeIntervals([...existing, [safeStart, safeEnd]])
      : normalizeIntervals(existing);
  const totalSeconds = Math.round(next.reduce((acc, [a, b]) => acc + (b - a), 0));
  return { intervals: next, totalSeconds };
}

function intervalCoversTimestamp(intervals: WatchInterval[], timestampSec: number): boolean {
  if (timestampSec <= 0) return true;
  return intervals.some(([start, end]) => end >= timestampSec && start <= timestampSec + 15);
}

export interface WrongQuestionSegment {
  questionId: string;
  orderIndex: number;
  conceptKey: string;
  timestampSeconds: number;
  score: number;
  maxScore: number;
  visited: boolean;
}

export class VideoService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly env: AppEnv,
  ) {}

  private async loadStudentVideoContext(studentId: string) {
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      include: { cohort: true },
    });
    if (
      !student ||
      student.deletedAt !== null ||
      !student.cohort ||
      student.cohort.deletedAt !== null
    ) {
      throw new AppError('NOT_FOUND');
    }

    const topic = await this.prisma.topic.findFirst({
      where: { id: student.cohort.topicId, deletedAt: null },
    });
    if (!topic) {
      throw new AppError('NOT_FOUND');
    }

    const [examModels, attempts, sessions] = await Promise.all([
      this.prisma.examModel.findMany({ where: { topicId: topic.id, deletedAt: null } }),
      this.prisma.attempt.findMany({ where: { studentId: student.id } }),
      this.prisma.videoSession.findMany({ where: { studentId: student.id, topicId: topic.id } }),
    ]);

    const model1 = examModels.find((m) => m.modelNumber === 1) ?? null;
    const model2 = examModels.find((m) => m.modelNumber === 2) ?? null;
    const preTestAttempt = model1
      ? (attempts.find((a) => a.examModelId === model1.id) ?? null)
      : null;
    const postTestAttempt = model2
      ? (attempts.find((a) => a.examModelId === model2.id) ?? null)
      : null;

    const model1Questions = model1
      ? await this.prisma.question.findMany({
          where: { examModelId: model1.id, deletedAt: null },
          orderBy: { orderIndex: 'asc' },
        })
      : [];

    const preTestAnswers = preTestAttempt
      ? await this.prisma.answer.findMany({ where: { attemptId: preTestAttempt.id } })
      : [];

    return {
      student,
      cohort: student.cohort,
      topic,
      model1,
      model2,
      preTestAttempt,
      postTestAttempt,
      model1Questions,
      preTestAnswers,
      videoSession: sessions[0] ?? null,
    };
  }

  private computeWrongSegments(
    model1Questions: Array<{
      id: string;
      orderIndex: number;
      conceptKey: string;
      points: number;
      videoTimestampSeconds: number;
    }>,
    preTestAnswers: Array<{ questionId: string; isCorrect: boolean | null; score: number | null }>,
    threshold: number,
    visitedQuestionIds: string[],
    intervals: WatchInterval[],
  ): WrongQuestionSegment[] {
    const answerByQ = new Map(preTestAnswers.map((a) => [a.questionId, a]));
    const visitedSet = new Set(visitedQuestionIds);

    const segments: WrongQuestionSegment[] = [];
    for (const q of model1Questions) {
      const ans = answerByQ.get(q.id);
      if (!ans) continue;
      const numericScore = ans.score ?? 0;
      const isWrong = ans.isCorrect === false || numericScore < q.points * threshold;
      if (!isWrong) continue;

      const visited =
        visitedSet.has(q.id) || intervalCoversTimestamp(intervals, q.videoTimestampSeconds);

      segments.push({
        questionId: q.id,
        orderIndex: q.orderIndex,
        conceptKey: q.conceptKey,
        timestampSeconds: q.videoTimestampSeconds,
        score: numericScore,
        maxScore: q.points,
        visited,
      });
    }
    return segments;
  }

  async getVideoState(studentId: string) {
    const ctx = await this.loadStudentVideoContext(studentId);
    const intervals = parseIntervals(ctx.videoSession?.watchedIntervals);
    const visitedQuestionIds = ctx.videoSession?.visitedQuestionIds ?? [];
    const wrongQuestionSegments = this.computeWrongSegments(
      ctx.model1Questions,
      ctx.preTestAnswers,
      ctx.topic.correctnessThreshold,
      visitedQuestionIds,
      intervals,
    );

    const wrongSegmentsIncomplete =
      ctx.cohort.requireWrongSegmentVisits && wrongQuestionSegments.some((s) => !s.visited);

    const flow = deriveStudentFlowStep({
      cohort: {
        group: ctx.cohort.group,
        requireVideoBeforePost: ctx.cohort.requireVideoBeforePost,
        showProvisionalScore: ctx.cohort.showProvisionalScore,
        postTestOpensAt: ctx.cohort.postTestOpensAt,
      },
      topic: { minWatchSeconds: ctx.topic.minWatchSeconds },
      consentAcceptedAt: ctx.student.consentAcceptedAt,
      preTestAttempt: ctx.preTestAttempt ? { status: ctx.preTestAttempt.status } : null,
      postTestAttempt: ctx.postTestAttempt ? { status: ctx.postTestAttempt.status } : null,
      videoSession: ctx.videoSession
        ? {
            startedAt: ctx.videoSession.startedAt,
            watchedSeconds: ctx.videoSession.watchedSeconds,
            unlockedPostAt: ctx.videoSession.unlockedPostAt,
            manualUnlockedById: ctx.videoSession.manualUnlockedById,
          }
        : null,
      wrongSegmentsIncomplete,
    });

    const watchedSeconds = ctx.videoSession?.watchedSeconds ?? 0;

    return {
      topic: {
        id: ctx.topic.id,
        title: ctx.topic.title,
        videoUrl: ctx.topic.videoUrl,
        videoId: ctx.topic.videoId,
        minWatchSeconds: ctx.topic.minWatchSeconds,
      },
      cohort: {
        id: ctx.cohort.id,
        group: ctx.cohort.group,
        requireVideoBeforePost: ctx.cohort.requireVideoBeforePost,
        requireWrongSegmentVisits: ctx.cohort.requireWrongSegmentVisits,
      },
      watchedSeconds,
      minWatchSeconds: ctx.topic.minWatchSeconds,
      remainingSeconds: Math.max(0, ctx.topic.minWatchSeconds - watchedSeconds),
      lastPosition: ctx.videoSession?.lastPosition ?? 0,
      visitedQuestionIds,
      wrongQuestionSegments,
      wrongSegmentsIncomplete,
      unlocked: flow.postTestLockReason === null || flow.step === 'POSTTEST_UNLOCKED',
      unlockedPostAt: ctx.videoSession?.unlockedPostAt
        ? ctx.videoSession.unlockedPostAt.toISOString()
        : null,
      manualUnlocked: Boolean(ctx.videoSession?.manualUnlockedById),
      postTestCompleted: Boolean(
        ctx.postTestAttempt && ctx.postTestAttempt.status !== 'IN_PROGRESS',
      ),
      postTestLockReason: flow.postTestLockReason,
    };
  }

  async recordHeartbeat(studentId: string, input: VideoHeartbeatInput, now = new Date()) {
    const ctx = await this.loadStudentVideoContext(studentId);
    if (!ctx.topic.videoId) {
      throw new AppError('CONFLICT', {
        messageEn: 'This topic has no configured remediation video.',
        messageAr: 'لا يوجد فيديو شرح مرتبط بهذا الموضوع.',
      });
    }

    const session =
      ctx.videoSession ??
      (await this.prisma.videoSession.create({
        data: {
          studentId: ctx.student.id,
          topicId: ctx.topic.id,
          startedAt: now,
          watchedSeconds: 0,
          watchedIntervals: toJson([]),
          visitedQuestionIds: [],
          lastPosition: 0,
          lastHeartbeatAt: null,
        },
      }));

    let intervals = parseIntervals(session.watchedIntervals);
    let watchedSeconds = session.watchedSeconds;
    const visitedSet = new Set(session.visitedQuestionIds);
    let nextLastPosition = session.lastPosition;
    let nextLastHeartbeatAt = session.lastHeartbeatAt;
    let fraudWarning: string | null = null;

    if (input.type === 'QUESTION_LINK_CLICK' && input.questionId) {
      const validQ = ctx.model1Questions.some((q) => q.id === input.questionId);
      if (validQ) {
        visitedSet.add(input.questionId);
      }
      nextLastPosition = Math.max(0, input.position);
      nextLastHeartbeatAt = now;
    } else if (input.type === 'SEEK' || input.type === 'PLAY' || input.type === 'PAUSE') {
      // Never credit seek jump delta toward watchedSeconds; simply reset anchor.
      nextLastPosition = Math.max(0, input.position);
      nextLastHeartbeatAt = now;
    } else if (input.type === 'PLAYER_ERROR') {
      await this.prisma.videoAlert.create({
        data: {
          topicId: ctx.topic.id,
          cohortId: ctx.cohort.id,
          errorCode: input.playerErrorCode ?? 0,
        },
      });
    } else if (input.type === 'HEARTBEAT' || input.type === 'ENDED') {
      if (!input.tabVisible) {
        fraudWarning = 'TAB_HIDDEN';
      } else if (input.playbackRate > 1.5 || input.playbackRate < 0.5) {
        fraudWarning = 'PLAYBACK_RATE_TOO_HIGH';
        nextLastPosition = Math.max(0, input.position);
        nextLastHeartbeatAt = now;
      } else {
        const prevPos = session.lastPosition;
        const deltaPos = input.position - prevPos;
        const wallElapsedSec = session.lastHeartbeatAt
          ? Math.max(0.5, (now.getTime() - session.lastHeartbeatAt.getTime()) / 1000)
          : 7.5;
        const maxAllowedDelta = Math.min(7.5, wallElapsedSec * input.playbackRate + 2.5);

        if (deltaPos > 0 && deltaPos <= maxAllowedDelta) {
          const merged = mergeWatchSegment(intervals, prevPos, input.position);
          intervals = merged.intervals;
          watchedSeconds = merged.totalSeconds;
        } else if (deltaPos > maxAllowedDelta) {
          fraudWarning = 'SEEK_JUMP_IGNORED';
        }
        nextLastPosition = Math.max(0, input.position);
        nextLastHeartbeatAt = now;
      }
    }

    const nextVisitedIds = Array.from(visitedSet);
    const wrongQuestionSegments = this.computeWrongSegments(
      ctx.model1Questions,
      ctx.preTestAnswers,
      ctx.topic.correctnessThreshold,
      nextVisitedIds,
      intervals,
    );
    const wrongSegmentsIncomplete =
      ctx.cohort.requireWrongSegmentVisits && wrongQuestionSegments.some((s) => !s.visited);

    const preTestReady =
      ctx.preTestAttempt !== null &&
      (ctx.preTestAttempt.status === 'GRADED' ||
        ctx.preTestAttempt.status === 'FINAL' ||
        (ctx.preTestAttempt.status === 'NEEDS_REVIEW' && ctx.cohort.showProvisionalScore));

    let unlockedPostAt = session.unlockedPostAt;
    let completedAt = session.completedAt;
    let unlockSignature = session.unlockSignature;

    if (
      !unlockedPostAt &&
      preTestReady &&
      watchedSeconds >= ctx.topic.minWatchSeconds &&
      !wrongSegmentsIncomplete
    ) {
      unlockedPostAt = now;
      completedAt = now;
      unlockSignature = signVideoUnlock(
        ctx.student.id,
        ctx.topic.id,
        now.toISOString(),
        this.env.VIDEO_UNLOCK_HMAC_SECRET,
      );
    }

    const updatedSession = await this.prisma.videoSession.update({
      where: { id: session.id },
      data: {
        watchedSeconds,
        watchedIntervals: toJson(intervals),
        visitedQuestionIds: nextVisitedIds,
        lastPosition: nextLastPosition,
        lastHeartbeatAt: nextLastHeartbeatAt,
        completedAt,
        unlockedPostAt,
        unlockSignature,
      },
    });

    const parsedClientTs = Date.parse(input.clientTs);
    await this.prisma.videoEvent.create({
      data: {
        videoSessionId: session.id,
        type: input.type,
        position: Math.max(0, input.position),
        playbackRate: input.playbackRate,
        clientTs: Number.isNaN(parsedClientTs) ? now : new Date(parsedClientTs),
        serverTs: now,
        questionId:
          input.questionId && ctx.model1Questions.some((q) => q.id === input.questionId)
            ? input.questionId
            : null,
        metadata: toJson({
          tabVisible: input.tabVisible,
          fraudWarning,
        }),
      },
    });

    return {
      watchedSeconds: updatedSession.watchedSeconds,
      minWatchSeconds: ctx.topic.minWatchSeconds,
      remainingSeconds: Math.max(0, ctx.topic.minWatchSeconds - updatedSession.watchedSeconds),
      lastPosition: updatedSession.lastPosition,
      visitedQuestionIds: nextVisitedIds,
      wrongQuestionSegments,
      wrongSegmentsIncomplete,
      unlocked: Boolean(updatedSession.unlockedPostAt || updatedSession.manualUnlockedById),
      unlockedPostAt: updatedSession.unlockedPostAt
        ? updatedSession.unlockedPostAt.toISOString()
        : null,
      fraudWarning,
    };
  }

  async reportPlayerAlert(studentId: string, errorCode: number, ip?: string) {
    const ctx = await this.loadStudentVideoContext(studentId);
    const alert = await this.prisma.videoAlert.create({
      data: {
        topicId: ctx.topic.id,
        cohortId: ctx.cohort.id,
        errorCode,
      },
    });

    await writeAuditLog(this.prisma, this.env, {
      actorType: 'STUDENT',
      actorId: studentId,
      action: 'VIDEO_PLAYER_ERROR',
      entity: 'VideoAlert',
      entityId: alert.id,
      diff: { topicId: ctx.topic.id, cohortId: ctx.cohort.id, errorCode },
      ip,
    });

    return { alertId: alert.id, errorCode };
  }

  async openCohortPostTestNow(teacherId: string, cohortId: string, ip?: string) {
    const cohort = await this.prisma.cohort.findFirst({
      where: { id: cohortId, teacherId, deletedAt: null },
    });
    if (!cohort) {
      throw new AppError('NOT_FOUND');
    }

    const now = new Date();
    const updated = await this.prisma.cohort.update({
      where: { id: cohort.id },
      data: { postTestOpensAt: now },
    });

    await writeAuditLog(this.prisma, this.env, {
      actorType: 'TEACHER',
      actorId: teacherId,
      action: 'TEACHER_OPEN_COHORT_POSTTEST',
      entity: 'Cohort',
      entityId: cohort.id,
      diff: { postTestOpensAt: now.toISOString() },
      ip,
    });

    return {
      cohortId: updated.id,
      postTestOpensAt: now.toISOString(),
    };
  }

  async manualUnlockStudentPostTest(
    teacherId: string,
    studentId: string,
    note: string | undefined,
    ip?: string,
  ) {
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      include: { cohort: true },
    });
    if (
      !student ||
      student.deletedAt !== null ||
      !student.cohort ||
      student.cohort.deletedAt !== null ||
      student.cohort.teacherId !== teacherId
    ) {
      throw new AppError('NOT_FOUND');
    }

    const now = new Date();
    const sig = signVideoUnlock(
      student.id,
      student.cohort.topicId,
      now.toISOString(),
      this.env.VIDEO_UNLOCK_HMAC_SECRET,
    );

    const session = await this.prisma.videoSession.upsert({
      where: {
        studentId_topicId: {
          studentId: student.id,
          topicId: student.cohort.topicId,
        },
      },
      create: {
        studentId: student.id,
        topicId: student.cohort.topicId,
        startedAt: now,
        watchedSeconds: 0,
        watchedIntervals: toJson([]),
        visitedQuestionIds: [],
        lastPosition: 0,
        unlockedPostAt: now,
        unlockSignature: sig,
        manualUnlockedById: teacherId,
        manualUnlockNote: note?.trim() || null,
      },
      update: {
        unlockedPostAt: now,
        unlockSignature: sig,
        manualUnlockedById: teacherId,
        manualUnlockNote: note?.trim() || null,
      },
    });

    await writeAuditLog(this.prisma, this.env, {
      actorType: 'TEACHER',
      actorId: teacherId,
      action: 'TEACHER_MANUAL_UNLOCK_POSTTEST',
      entity: 'Student',
      entityId: student.id,
      diff: { videoSessionId: session.id, note: note?.trim() || null },
      ip,
    });

    return {
      studentId: student.id,
      unlockedPostAt: now.toISOString(),
      manualUnlockedById: teacherId,
    };
  }
}
