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

export interface FakeTopicRow {
  id: string;
  ownerId: string;
  title: string;
  description: string;
  videoUrl: string;
  videoId: string | null;
  minWatchSeconds: number;
  correctnessThreshold: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface FakeExamModelRow {
  id: string;
  topicId: string;
  modelNumber: number;
  title: string;
  durationMinutes: number;
  totalPoints: number;
  status: 'DRAFT' | 'PUBLISHED';
  pairedWithId: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface FakeQuestionRow {
  id: string;
  examModelId: string;
  orderIndex: number;
  conceptKey: string;
  type: 'MCQ' | 'ESSAY';
  promptLatex: string;
  points: number;
  videoTimestampSeconds: number;
  needsTeacherConfirmation: boolean;
  teacherConfirmedAt: Date | null;
  twinQuestionId: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface FakeMcqOptionRow {
  id: string;
  questionId: string;
  label: string;
  textLatex: string;
  isCorrect: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface FakeModelAnswerRow {
  id: string;
  questionId: string;
  solutionStepsLatex: string[];
  finalAnswerLatex: string;
  finalAnswerSympy: string | null;
  commonMistakes: string;
  rubricVersion: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface FakeRubricCriterionRow {
  id: string;
  questionId: string;
  orderIndex: number;
  key: string;
  descriptionEn: string;
  descriptionAr: string;
  maxPoints: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface FakeCohortRow {
  id: string;
  topicId: string;
  teacherId: string;
  name: string;
  joinCode: string;
  group: 'TREATMENT' | 'CONTROL';
  deletedAt: Date | null;
}

export function createInMemoryPrisma(seedUsers: FakeUserRow[] = []) {
  const users: FakeUserRow[] = [...seedUsers];
  const refreshTokens: FakeRefreshTokenRow[] = [];
  const auditLogs: FakeAuditRow[] = [];
  const topics: FakeTopicRow[] = [];
  const examModels: FakeExamModelRow[] = [];
  const questions: FakeQuestionRow[] = [];
  const mcqOptions: FakeMcqOptionRow[] = [];
  const modelAnswers: FakeModelAnswerRow[] = [];
  const rubricCriteria: FakeRubricCriterionRow[] = [];
  const cohorts: FakeCohortRow[] = [];

  const hydrateQuestion = (q: FakeQuestionRow, include?: Record<string, unknown>) => {
    const out: Record<string, unknown> = { ...q };
    if (include?.examModel) {
      out.examModel = examModels.find((m) => m.id === q.examModelId) ?? null;
    }
    if (include?.mcqOptions) {
      out.mcqOptions = mcqOptions
        .filter((o) => o.questionId === q.id && o.deletedAt === null)
        .sort((a, b) => a.label.localeCompare(b.label));
    }
    if (include?.modelAnswer) {
      out.modelAnswer = modelAnswers.find((m) => m.questionId === q.id) ?? null;
    }
    if (include?.rubricCriteria) {
      out.rubricCriteria = rubricCriteria
        .filter((c) => c.questionId === q.id && c.deletedAt === null)
        .sort((a, b) => a.orderIndex - b.orderIndex);
    }
    return out;
  };

  const hydrateExamModel = (m: FakeExamModelRow, include?: Record<string, unknown>) => {
    const out: Record<string, unknown> = { ...m };
    if (include?.topic) {
      out.topic = topics.find((t) => t.id === m.topicId) ?? null;
    }
    if (include?.questions) {
      const qInc = (include.questions as { include?: Record<string, unknown> }).include;
      out.questions = questions
        .filter((q) => q.examModelId === m.id && q.deletedAt === null)
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .map((q) => hydrateQuestion(q, qInc));
    }
    return out;
  };

  const hydrateTopic = (t: FakeTopicRow, include?: Record<string, unknown>) => {
    const out: Record<string, unknown> = { ...t };
    if (include?.examModels) {
      const mInc = (include.examModels as { include?: Record<string, unknown> }).include;
      out.examModels = examModels
        .filter((m) => m.topicId === t.id && m.deletedAt === null)
        .sort((a, b) => a.modelNumber - b.modelNumber)
        .map((m) => hydrateExamModel(m, mInc));
    }
    if (include?._count) {
      out._count = {
        cohorts: cohorts.filter((c) => c.topicId === t.id && c.deletedAt === null).length,
      };
    }
    return out;
  };

  const mock = {
    _state: {
      users,
      refreshTokens,
      auditLogs,
      topics,
      examModels,
      questions,
      mcqOptions,
      modelAnswers,
      rubricCriteria,
      cohorts,
    },
    $queryRaw: async () => [{ '?column?': 1 }],
    $transaction: async <T>(
      arg: Array<Promise<T>> | ((tx: typeof mock) => Promise<T>),
    ): Promise<T | T[]> => {
      if (typeof arg === 'function') {
        return arg(mock);
      }
      return Promise.all(arg);
    },
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
    topic: {
      findMany: async ({
        where,
        include,
      }: {
        where?: { ownerId?: string; deletedAt?: null };
        include?: Record<string, unknown>;
      }) => {
        return topics
          .filter(
            (t) =>
              (where?.ownerId === undefined || t.ownerId === where.ownerId) &&
              (where?.deletedAt === undefined || t.deletedAt === where.deletedAt),
          )
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .map((t) => hydrateTopic(t, include));
      },
      findFirst: async ({
        where,
        include,
      }: {
        where: { id?: string; ownerId?: string; deletedAt?: null; title?: string };
        include?: Record<string, unknown>;
      }) => {
        const found = topics.find(
          (t) =>
            (where.id === undefined || t.id === where.id) &&
            (where.ownerId === undefined || t.ownerId === where.ownerId) &&
            (where.title === undefined || t.title === where.title) &&
            (where.deletedAt === undefined || t.deletedAt === where.deletedAt),
        );
        return found ? hydrateTopic(found, include) : null;
      },
      create: async ({ data }: { data: Partial<FakeTopicRow> & { ownerId: string; title: string; videoUrl: string } }) => {
        const now = new Date();
        const row: FakeTopicRow = {
          id: data.id ?? crypto.randomUUID(),
          ownerId: data.ownerId,
          title: data.title,
          description: data.description ?? '',
          videoUrl: data.videoUrl,
          videoId: data.videoId ?? null,
          minWatchSeconds: data.minWatchSeconds ?? 300,
          correctnessThreshold: data.correctnessThreshold ?? 0.6,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        };
        topics.push(row);
        return row;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<FakeTopicRow>;
      }) => {
        const row = topics.find((t) => t.id === where.id);
        if (!row) throw new Error('Topic not found');
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      },
    },
    examModel: {
      findMany: async ({
        where,
        include,
        select,
      }: {
        where?: { topicId?: string; deletedAt?: null };
        include?: Record<string, unknown>;
        select?: Record<string, unknown>;
      }) => {
        const hydration = include ?? (select?.questions ? { questions: select.questions } : undefined);
        return examModels
          .filter(
            (m) =>
              (where?.topicId === undefined || m.topicId === where.topicId) &&
              (where?.deletedAt === undefined || m.deletedAt === where.deletedAt),
          )
          .sort((a, b) => a.modelNumber - b.modelNumber)
          .map((m) => hydrateExamModel(m, hydration));
      },
      findFirst: async ({
        where,
        include,
      }: {
        where: { id?: string; deletedAt?: null; topic?: { ownerId?: string; deletedAt?: null } };
        include?: Record<string, unknown>;
      }) => {
        const found = examModels.find((m) => {
          if (where.id !== undefined && m.id !== where.id) return false;
          if (where.deletedAt !== undefined && m.deletedAt !== where.deletedAt) return false;
          if (where.topic) {
            const topic = topics.find((t) => t.id === m.topicId);
            if (!topic) return false;
            if (where.topic.ownerId !== undefined && topic.ownerId !== where.topic.ownerId) {
              return false;
            }
            if (where.topic.deletedAt !== undefined && topic.deletedAt !== where.topic.deletedAt) {
              return false;
            }
          }
          return true;
        });
        return found ? hydrateExamModel(found, include) : null;
      },
      create: async ({ data }: { data: Partial<FakeExamModelRow> & { topicId: string; modelNumber: number; title: string } }) => {
        const now = new Date();
        const row: FakeExamModelRow = {
          id: data.id ?? crypto.randomUUID(),
          topicId: data.topicId,
          modelNumber: data.modelNumber,
          title: data.title,
          durationMinutes: data.durationMinutes ?? 60,
          totalPoints: data.totalPoints ?? 0,
          status: data.status ?? 'DRAFT',
          pairedWithId: data.pairedWithId ?? null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        };
        examModels.push(row);
        return row;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<FakeExamModelRow>;
      }) => {
        const row = examModels.find((m) => m.id === where.id);
        if (!row) throw new Error('ExamModel not found');
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { topicId?: string; deletedAt?: null };
        data: Partial<FakeExamModelRow>;
      }) => {
        let count = 0;
        for (const row of examModels) {
          if (
            (where.topicId === undefined || row.topicId === where.topicId) &&
            (where.deletedAt === undefined || row.deletedAt === where.deletedAt)
          ) {
            Object.assign(row, data, { updatedAt: new Date() });
            count += 1;
          }
        }
        return { count };
      },
    },
    question: {
      findMany: async ({
        where,
      }: {
        where?: { examModelId?: string; deletedAt?: null };
      }) => {
        return questions
          .filter(
            (q) =>
              (where?.examModelId === undefined || q.examModelId === where.examModelId) &&
              (where?.deletedAt === undefined || q.deletedAt === where.deletedAt),
          )
          .sort((a, b) => a.orderIndex - b.orderIndex);
      },
      findFirst: async ({
        where,
        include,
      }: {
        where: {
          id?: string;
          deletedAt?: null;
          examModel?: { deletedAt?: null; topic?: { ownerId?: string; deletedAt?: null } };
        };
        include?: Record<string, unknown>;
      }) => {
        const found = questions.find((q) => {
          if (where.id !== undefined && q.id !== where.id) return false;
          if (where.deletedAt !== undefined && q.deletedAt !== where.deletedAt) return false;
          if (where.examModel) {
            const em = examModels.find((m) => m.id === q.examModelId);
            if (!em) return false;
            if (where.examModel.deletedAt !== undefined && em.deletedAt !== where.examModel.deletedAt) {
              return false;
            }
            if (where.examModel.topic) {
              const t = topics.find((x) => x.id === em.topicId);
              if (!t) return false;
              if (where.examModel.topic.ownerId !== undefined && t.ownerId !== where.examModel.topic.ownerId) {
                return false;
              }
              if (where.examModel.topic.deletedAt !== undefined && t.deletedAt !== where.examModel.topic.deletedAt) {
                return false;
              }
            }
          }
          return true;
        });
        return found ? hydrateQuestion(found, include) : null;
      },
      create: async ({
        data,
      }: {
        data: Partial<FakeQuestionRow> & {
          examModelId: string;
          orderIndex: number;
          conceptKey: string;
          type: 'MCQ' | 'ESSAY';
          promptLatex: string;
          points: number;
        };
      }) => {
        const now = new Date();
        const row: FakeQuestionRow = {
          id: data.id ?? crypto.randomUUID(),
          examModelId: data.examModelId,
          orderIndex: data.orderIndex,
          conceptKey: data.conceptKey,
          type: data.type,
          promptLatex: data.promptLatex,
          points: data.points,
          videoTimestampSeconds: data.videoTimestampSeconds ?? 0,
          needsTeacherConfirmation: data.needsTeacherConfirmation ?? false,
          teacherConfirmedAt: data.teacherConfirmedAt ?? null,
          twinQuestionId: data.twinQuestionId ?? null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        };
        questions.push(row);
        return row;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<FakeQuestionRow>;
      }) => {
        const row = questions.find((q) => q.id === where.id);
        if (!row) throw new Error('Question not found');
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { examModelId?: string | { in: string[] }; deletedAt?: null };
        data: Partial<FakeQuestionRow>;
      }) => {
        let count = 0;
        for (const row of questions) {
          const matchesExam =
            where.examModelId === undefined ||
            (typeof where.examModelId === 'string'
              ? row.examModelId === where.examModelId
              : where.examModelId.in.includes(row.examModelId));
          const matchesDeleted =
            where.deletedAt === undefined || row.deletedAt === where.deletedAt;
          if (matchesExam && matchesDeleted) {
            Object.assign(row, data, { updatedAt: new Date() });
            count += 1;
          }
        }
        return { count };
      },
    },
    mcqOption: {
      createMany: async ({
        data,
      }: {
        data: Array<{ questionId: string; label: string; textLatex: string; isCorrect: boolean }>;
      }) => {
        const now = new Date();
        for (const item of data) {
          mcqOptions.push({
            id: crypto.randomUUID(),
            questionId: item.questionId,
            label: item.label,
            textLatex: item.textLatex,
            isCorrect: item.isCorrect,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          });
        }
        return { count: data.length };
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { questionId?: string; deletedAt?: null };
        data: Partial<FakeMcqOptionRow>;
      }) => {
        let count = 0;
        for (const row of mcqOptions) {
          if (
            (where.questionId === undefined || row.questionId === where.questionId) &&
            (where.deletedAt === undefined || row.deletedAt === where.deletedAt)
          ) {
            Object.assign(row, data, { updatedAt: new Date() });
            count += 1;
          }
        }
        return { count };
      },
    },
    modelAnswer: {
      create: async ({
        data,
      }: {
        data: Omit<FakeModelAnswerRow, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>;
      }) => {
        const now = new Date();
        const row: FakeModelAnswerRow = {
          id: crypto.randomUUID(),
          ...data,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        };
        modelAnswers.push(row);
        return row;
      },
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { questionId: string };
        create: Omit<FakeModelAnswerRow, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>;
        update: Partial<FakeModelAnswerRow>;
      }) => {
        const existing = modelAnswers.find((m) => m.questionId === where.questionId);
        if (existing) {
          Object.assign(existing, update, { updatedAt: new Date() });
          return existing;
        }
        const now = new Date();
        const row: FakeModelAnswerRow = {
          id: crypto.randomUUID(),
          ...create,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        };
        modelAnswers.push(row);
        return row;
      },
      update: async ({
        where,
        data,
      }: {
        where: { questionId: string };
        data: Partial<FakeModelAnswerRow>;
      }) => {
        const existing = modelAnswers.find((m) => m.questionId === where.questionId);
        if (!existing) throw new Error('ModelAnswer not found');
        Object.assign(existing, data, { updatedAt: new Date() });
        return existing;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { questionId?: string; deletedAt?: null };
        data: Partial<FakeModelAnswerRow>;
      }) => {
        let count = 0;
        for (const row of modelAnswers) {
          if (
            (where.questionId === undefined || row.questionId === where.questionId) &&
            (where.deletedAt === undefined || row.deletedAt === where.deletedAt)
          ) {
            Object.assign(row, data, { updatedAt: new Date() });
            count += 1;
          }
        }
        return { count };
      },
    },
    rubricCriterion: {
      createMany: async ({
        data,
      }: {
        data: Array<{
          questionId: string;
          orderIndex: number;
          key: string;
          descriptionEn: string;
          descriptionAr: string;
          maxPoints: number;
        }>;
      }) => {
        const now = new Date();
        for (const item of data) {
          rubricCriteria.push({
            id: crypto.randomUUID(),
            ...item,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          });
        }
        return { count: data.length };
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { questionId?: string; deletedAt?: null };
        data: Partial<FakeRubricCriterionRow>;
      }) => {
        let count = 0;
        for (const row of rubricCriteria) {
          if (
            (where.questionId === undefined || row.questionId === where.questionId) &&
            (where.deletedAt === undefined || row.deletedAt === where.deletedAt)
          ) {
            Object.assign(row, data, { updatedAt: new Date() });
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
      topics: FakeTopicRow[];
      examModels: FakeExamModelRow[];
      questions: FakeQuestionRow[];
      mcqOptions: FakeMcqOptionRow[];
      modelAnswers: FakeModelAnswerRow[];
      rubricCriteria: FakeRubricCriterionRow[];
      cohorts: FakeCohortRow[];
    };
  };
}

export const createInMemoryAuthPrisma = createInMemoryPrisma;
