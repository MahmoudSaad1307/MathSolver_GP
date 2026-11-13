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
  requireVideoBeforePost: boolean;
  requireWrongSegmentVisits: boolean;
  showProvisionalScore: boolean;
  postTestOpensAt: Date | null;
  status: 'OPEN' | 'CLOSED' | 'ARCHIVED';
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface FakeStudentRow {
  id: string;
  cohortId: string;
  displayName: string;
  resumeCode: string;
  consentAcceptedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface FakeAttemptRow {
  id: string;
  studentId: string;
  examModelId: string;
  status: 'IN_PROGRESS' | 'SUBMITTED' | 'GRADING' | 'GRADED' | 'NEEDS_REVIEW' | 'FINAL';
  startedAt: Date;
  submittedAt: Date | null;
  deadlineAt: Date;
  totalScore: number | null;
  maxScore: number;
  percentage: number | null;
  scoreSource: 'AUTO' | 'AI' | 'TEACHER_OVERRIDE' | 'MIXED' | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FakeAnswerRow {
  id: string;
  attemptId: string;
  questionId: string;
  selectedOptionId: string | null;
  isCorrect: boolean | null;
  score: number | null;
  maxScore: number;
  misreadReportedAt: Date | null;
  misreadNote: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FakeAnswerImageRow {
  id: string;
  answerId: string;
  storageKey: string;
  sha256: string;
  width: number;
  height: number;
  bytes: number;
  pinnedByTeacher: boolean;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FakeVideoSessionRow {
  id: string;
  studentId: string;
  topicId: string;
  startedAt: Date;
  watchedSeconds: number;
  lastPosition: number;
  completedAt: Date | null;
  unlockedPostAt: Date | null;
  manualUnlockedById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FakeGradingResultRow {
  id: string;
  answerId: string;
  version: number;
  provider: string;
  modelName: string;
  promptVersion: string;
  rubricVersion: number;
  imageHash: string;
  transcriptionJson: unknown;
  gradingJson: unknown;
  criteriaScores: unknown;
  aiTotal: number;
  finalAnswerCorrect: boolean | null;
  firstErrorStep: number | null;
  errorType: string;
  errorExplanationAr: string;
  hintAr: string;
  confidence: number;
  sympyCheck: unknown;
  needsReview: boolean;
  reviewReasons: string[];
  rawOutput: string;
  latencyMs: number;
  costUsd: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface FakeTeacherOverrideRow {
  id: string;
  gradingResultId: string;
  teacherId: string;
  newCriteriaScores: unknown;
  newTotal: number;
  newExplanationAr: string | null;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FakeAiUsageRow {
  id: string;
  answerId: string | null;
  provider: string;
  modelName: string;
  operation: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  success: boolean;
  errorCode: string | null;
  createdAt: Date;
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
  const students: FakeStudentRow[] = [];
  const attempts: FakeAttemptRow[] = [];
  const answers: FakeAnswerRow[] = [];
  const answerImages: FakeAnswerImageRow[] = [];
  const videoSessions: FakeVideoSessionRow[] = [];
  const gradingResults: FakeGradingResultRow[] = [];
  const teacherOverrides: FakeTeacherOverrideRow[] = [];
  const aiUsages: FakeAiUsageRow[] = [];

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
      students,
      attempts,
      answers,
      answerImages,
      videoSessions,
      gradingResults,
      teacherOverrides,
      aiUsages,
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
        where?: { topicId?: string | { in: string[] }; deletedAt?: null };
        include?: Record<string, unknown>;
        select?: Record<string, unknown>;
      }) => {
        const hydration = include ?? (select?.questions ? { questions: select.questions } : undefined);
        return examModels
          .filter((m) => {
            const matchesTopic =
              where?.topicId === undefined ||
              (typeof where.topicId === 'string'
                ? m.topicId === where.topicId
                : where.topicId.in.includes(m.topicId));
            const matchesDeleted =
              where?.deletedAt === undefined || m.deletedAt === where.deletedAt;
            return matchesTopic && matchesDeleted;
          })
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
        where?: { examModelId?: string | { in: string[] }; deletedAt?: null };
      }) => {
        return questions
          .filter((q) => {
            const matchesModel =
              where?.examModelId === undefined ||
              (typeof where.examModelId === 'string'
                ? q.examModelId === where.examModelId
                : where.examModelId.in.includes(q.examModelId));
            const matchesDeleted =
              where?.deletedAt === undefined || q.deletedAt === where.deletedAt;
            return matchesModel && matchesDeleted;
          })
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
    cohort: {
      findMany: async ({
        where,
      }: {
        where?: { teacherId?: string; topicId?: string; deletedAt?: null };
      }) => {
        return cohorts
          .filter(
            (c) =>
              (where?.teacherId === undefined || c.teacherId === where.teacherId) &&
              (where?.topicId === undefined || c.topicId === where.topicId) &&
              (where?.deletedAt === undefined || c.deletedAt === where.deletedAt),
          )
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .map((c) => {
            const topic = topics.find((t) => t.id === c.topicId);
            return {
              ...c,
              topic: topic ? { id: topic.id, title: topic.title } : null,
              _count: {
                students: students.filter((s) => s.cohortId === c.id && s.deletedAt === null)
                  .length,
              },
            };
          });
      },
      findUnique: async ({ where }: { where: { joinCode?: string; id?: string } }) => {
        return (
          cohorts.find(
            (c) =>
              (where.joinCode === undefined || c.joinCode === where.joinCode) &&
              (where.id === undefined || c.id === where.id),
          ) ?? null
        );
      },
      findFirst: async ({
        where,
      }: {
        where: { id?: string; teacherId?: string; deletedAt?: null };
      }) => {
        const found = cohorts.find(
          (c) =>
            (where.id === undefined || c.id === where.id) &&
            (where.teacherId === undefined || c.teacherId === where.teacherId) &&
            (where.deletedAt === undefined || c.deletedAt === where.deletedAt),
        );
        if (!found) return null;
        const topic = topics.find((t) => t.id === found.topicId);
        return {
          ...found,
          topic: topic
            ? {
                id: topic.id,
                title: topic.title,
                videoId: topic.videoId,
                minWatchSeconds: topic.minWatchSeconds,
              }
            : null,
          students: students
            .filter((s) => s.cohortId === found.id && s.deletedAt === null)
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
        };
      },
      create: async ({
        data,
      }: {
        data: Partial<FakeCohortRow> & {
          topicId: string;
          teacherId: string;
          name: string;
          joinCode: string;
          group: 'TREATMENT' | 'CONTROL';
        };
      }) => {
        const now = new Date();
        const row: FakeCohortRow = {
          id: data.id ?? crypto.randomUUID(),
          topicId: data.topicId,
          teacherId: data.teacherId,
          name: data.name,
          joinCode: data.joinCode,
          group: data.group,
          requireVideoBeforePost: data.requireVideoBeforePost ?? true,
          requireWrongSegmentVisits: data.requireWrongSegmentVisits ?? false,
          showProvisionalScore: data.showProvisionalScore ?? false,
          postTestOpensAt: data.postTestOpensAt ?? null,
          status: data.status ?? 'OPEN',
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        };
        cohorts.push(row);
        return row;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<FakeCohortRow>;
      }) => {
        const row = cohorts.find((c) => c.id === where.id);
        if (!row) throw new Error('Cohort not found');
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      },
    },
    student: {
      findUnique: async ({
        where,
        include,
      }: {
        where: { resumeCode?: string; id?: string };
        include?: { cohort?: boolean };
      }) => {
        const found = students.find(
          (s) =>
            (where.resumeCode === undefined || s.resumeCode === where.resumeCode) &&
            (where.id === undefined || s.id === where.id),
        );
        if (!found) return null;
        if (include?.cohort) {
          return { ...found, cohort: cohorts.find((c) => c.id === found.cohortId) ?? null };
        }
        return found;
      },
      findFirst: async ({
        where,
        include,
      }: {
        where: { id?: string; deletedAt?: null };
        include?: Record<string, unknown>;
      }) => {
        const found = students.find(
          (s) =>
            (where.id === undefined || s.id === where.id) &&
            (where.deletedAt === undefined || s.deletedAt === where.deletedAt),
        );
        if (!found) return null;
        const out: Record<string, unknown> = { ...found };
        if (include?.cohort) {
          const cohort = cohorts.find((c) => c.id === found.cohortId);
          if (cohort) {
            const topic = topics.find((t) => t.id === cohort.topicId);
            out.cohort = {
              ...cohort,
              topic: topic
                ? hydrateTopic(topic, {
                    examModels: {
                      include: {
                        questions: { where: { deletedAt: null } },
                      },
                    },
                  })
                : null,
            };
          } else {
            out.cohort = null;
          }
        }
        if (include?.attempts) {
          out.attempts = attempts
            .filter((a) => a.studentId === found.id)
            .map((a) => ({
              ...a,
              examModel: examModels.find((m) => m.id === a.examModelId) ?? null,
            }));
        }
        if (include?.videoSessions) {
          out.videoSessions = videoSessions.filter((v) => v.studentId === found.id);
        }
        return out;
      },
      create: async ({
        data,
      }: {
        data: { cohortId: string; displayName: string; resumeCode: string };
      }) => {
        const now = new Date();
        const row: FakeStudentRow = {
          id: crypto.randomUUID(),
          cohortId: data.cohortId,
          displayName: data.displayName,
          resumeCode: data.resumeCode,
          consentAcceptedAt: null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        };
        students.push(row);
        return row;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<FakeStudentRow>;
      }) => {
        const row = students.find((s) => s.id === where.id);
        if (!row) throw new Error('Student not found');
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      },
    },
    attempt: {
      findFirst: async ({
        where,
        include,
      }: {
        where: { id?: string; studentId?: string };
        include?: Record<string, unknown>;
      }) => {
        const found = attempts.find(
          (a) =>
            (where.id === undefined || a.id === where.id) &&
            (where.studentId === undefined || a.studentId === where.studentId),
        );
        if (!found) return null;
        const out: Record<string, unknown> = { ...found };
        if (include?.examModel) {
          const m = examModels.find((x) => x.id === found.examModelId);
          out.examModel = m
            ? hydrateExamModel(m, {
                questions: { include: { mcqOptions: true } },
              })
            : null;
        }
        if (include?.answers) {
          out.answers = answers
            .filter((ans) => ans.attemptId === found.id)
            .map((ans) => {
              const q = questions.find((x) => x.id === ans.questionId);
              const ansGrading = gradingResults
                .filter((g) => g.answerId === ans.id)
                .sort((a, b) => b.version - a.version)
                .map((g) => ({
                  ...g,
                  overrides: teacherOverrides
                    .filter((o) => o.gradingResultId === g.id)
                    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
                }));
              return {
                ...ans,
                question: q ? hydrateQuestion(q, { mcqOptions: true }) : null,
                images: answerImages
                  .filter((img) => img.answerId === ans.id && img.deletedAt === null)
                  .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
                gradingResults: ansGrading,
              };
            });
        }
        return out;
      },
      create: async ({
        data,
      }: {
        data: {
          studentId: string;
          examModelId: string;
          status: FakeAttemptRow['status'];
          startedAt: Date;
          deadlineAt: Date;
          maxScore: number;
        };
      }) => {
        const now = new Date();
        const row: FakeAttemptRow = {
          id: crypto.randomUUID(),
          studentId: data.studentId,
          examModelId: data.examModelId,
          status: data.status,
          startedAt: data.startedAt,
          submittedAt: null,
          deadlineAt: data.deadlineAt,
          totalScore: null,
          maxScore: data.maxScore,
          percentage: null,
          scoreSource: null,
          createdAt: now,
          updatedAt: now,
        };
        attempts.push(row);
        return row;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<FakeAttemptRow>;
      }) => {
        const row = attempts.find((a) => a.id === where.id);
        if (!row) throw new Error('Attempt not found');
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      },
    },
    answer: {
      findFirst: async ({
        where,
      }: {
        where: {
          id?: string;
          attemptId?: string;
          questionId?: string;
          attempt?: { studentId?: string };
          OR?: Array<{ id?: string; questionId?: string }>;
        };
      }) => {
        const found = answers.find((ans) => {
          const att = attempts.find((a) => a.id === ans.attemptId);
          if (!att) return false;
          if (where.attempt?.studentId && att.studentId !== where.attempt.studentId) return false;
          if (where.id && ans.id !== where.id) return false;
          if (where.attemptId && ans.attemptId !== where.attemptId) return false;
          if (where.questionId && ans.questionId !== where.questionId) return false;
          if (where.OR) {
            const matchesOr = where.OR.some(
              (cond) =>
                (cond.id !== undefined && ans.id === cond.id) ||
                (cond.questionId !== undefined && ans.questionId === cond.questionId),
            );
            if (!matchesOr) return false;
          }
          return true;
        });
        if (!found) return null;
        const att = attempts.find((a) => a.id === found.attemptId)!;
        const m = examModels.find((x) => x.id === att.examModelId);
        const top = m ? topics.find((x) => x.id === m.topicId) : null;
        const q = questions.find((x) => x.id === found.questionId)!;
        const ansGrading = gradingResults
          .filter((g) => g.answerId === found.id)
          .sort((a, b) => b.version - a.version)
          .map((g) => ({
            ...g,
            overrides: teacherOverrides
              .filter((o) => o.gradingResultId === g.id)
              .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
          }));
        return {
          ...found,
          attempt: {
            ...att,
            examModel: m ? { ...m, topic: top } : null,
          },
          question: hydrateQuestion(q, {
            mcqOptions: true,
            modelAnswer: true,
            rubricCriteria: true,
          }),
          images: answerImages
            .filter((img) => img.answerId === found.id && img.deletedAt === null)
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
          gradingResults: ansGrading,
        };
      },
      createMany: async ({
        data,
      }: {
        data: Array<{
          attemptId: string;
          questionId: string;
          selectedOptionId: string | null;
          maxScore: number;
        }>;
      }) => {
        const now = new Date();
        for (const item of data) {
          answers.push({
            id: crypto.randomUUID(),
            attemptId: item.attemptId,
            questionId: item.questionId,
            selectedOptionId: item.selectedOptionId,
            isCorrect: null,
            score: null,
            maxScore: item.maxScore,
            misreadReportedAt: null,
            misreadNote: null,
            createdAt: now,
            updatedAt: now,
          });
        }
        return { count: data.length };
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<FakeAnswerRow>;
      }) => {
        const row = answers.find((a) => a.id === where.id);
        if (!row) throw new Error('Answer not found');
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      },
    },
    answerImage: {
      findFirst: async ({
        where,
      }: {
        where: {
          id?: string;
          deletedAt?: null;
          answer?: { attempt?: { studentId?: string } };
        };
      }) => {
        const found = answerImages.find((img) => {
          if (where.id && img.id !== where.id) return false;
          if (where.deletedAt !== undefined && img.deletedAt !== where.deletedAt) return false;
          if (where.answer?.attempt?.studentId) {
            const ans = answers.find((a) => a.id === img.answerId);
            const att = ans ? attempts.find((x) => x.id === ans.attemptId) : undefined;
            if (!att || att.studentId !== where.answer.attempt.studentId) return false;
          }
          return true;
        });
        if (!found) return null;
        const ans = answers.find((a) => a.id === found.answerId)!;
        const att = attempts.find((a) => a.id === ans.attemptId)!;
        return {
          ...found,
          answer: {
            ...ans,
            attempt: att,
          },
        };
      },
      create: async ({
        data,
      }: {
        data: {
          answerId: string;
          storageKey: string;
          sha256: string;
          width: number;
          height: number;
          bytes: number;
        };
      }) => {
        const now = new Date();
        const row: FakeAnswerImageRow = {
          id: crypto.randomUUID(),
          ...data,
          pinnedByTeacher: false,
          deletedAt: null,
          createdAt: now,
          updatedAt: now,
        };
        answerImages.push(row);
        return row;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<FakeAnswerImageRow>;
      }) => {
        const row = answerImages.find((img) => img.id === where.id);
        if (!row) throw new Error('AnswerImage not found');
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      },
    },
    gradingResult: {
      count: async ({
        where,
      }: {
        where?: { createdAt?: { gte?: Date }; answer?: { attempt?: { studentId?: string } } };
      }) => {
        return gradingResults.filter((g) => {
          if (where?.createdAt?.gte && g.createdAt < where.createdAt.gte) return false;
          if (where?.answer?.attempt?.studentId) {
            const ans = answers.find((a) => a.id === g.answerId);
            const att = ans ? attempts.find((x) => x.id === ans.attemptId) : undefined;
            if (!att || att.studentId !== where.answer.attempt.studentId) return false;
          }
          return true;
        }).length;
      },
      create: async ({ data }: { data: Omit<FakeGradingResultRow, 'id' | 'createdAt' | 'updatedAt'> }) => {
        const now = new Date();
        const row: FakeGradingResultRow = {
          id: crypto.randomUUID(),
          ...data,
          createdAt: now,
          updatedAt: now,
        };
        gradingResults.push(row);
        return row;
      },
      findFirst: async ({
        where,
        orderBy,
      }: {
        where?: { id?: string; answerId?: string };
        orderBy?: { version?: 'asc' | 'desc' };
      }) => {
        let matched = gradingResults.filter(
          (g) =>
            (where?.id === undefined || g.id === where.id) &&
            (where?.answerId === undefined || g.answerId === where.answerId),
        );
        if (orderBy?.version === 'desc') {
          matched = [...matched].sort((a, b) => b.version - a.version);
        }
        return matched[0] ?? null;
      },
      findMany: async ({
        where,
        orderBy,
      }: {
        where?: {
          answerId?: string | { in: string[] };
          needsReview?: boolean;
        };
        orderBy?: { version?: 'asc' | 'desc' };
      }) => {
        let matched = gradingResults.filter((g) => {
          if (where?.needsReview !== undefined && g.needsReview !== where.needsReview) return false;
          if (where?.answerId !== undefined) {
            const ok =
              typeof where.answerId === 'string'
                ? g.answerId === where.answerId
                : where.answerId.in.includes(g.answerId);
            if (!ok) return false;
          }
          return true;
        });
        if (orderBy?.version === 'desc') {
          matched = [...matched].sort((a, b) => b.version - a.version);
        }
        return matched;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<FakeGradingResultRow>;
      }) => {
        const row = gradingResults.find((g) => g.id === where.id);
        if (!row) throw new Error('GradingResult not found');
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      },
    },
    teacherOverride: {
      create: async ({ data }: { data: Omit<FakeTeacherOverrideRow, 'id' | 'createdAt' | 'updatedAt'> }) => {
        const now = new Date();
        const row: FakeTeacherOverrideRow = {
          id: crypto.randomUUID(),
          ...data,
          createdAt: now,
          updatedAt: now,
        };
        teacherOverrides.push(row);
        return row;
      },
      findMany: async ({
        where,
        orderBy,
      }: {
        where?: { gradingResultId?: string | { in: string[] } };
        orderBy?: { createdAt?: 'asc' | 'desc' };
      }) => {
        let matched = teacherOverrides.filter((o) => {
          if (where?.gradingResultId === undefined) return true;
          return typeof where.gradingResultId === 'string'
            ? o.gradingResultId === where.gradingResultId
            : where.gradingResultId.in.includes(o.gradingResultId);
        });
        if (orderBy?.createdAt === 'desc') {
          matched = [...matched].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        }
        return matched;
      },
    },
    aiUsage: {
      create: async ({ data }: { data: Omit<FakeAiUsageRow, 'id' | 'createdAt'> }) => {
        const row: FakeAiUsageRow = {
          id: crypto.randomUUID(),
          ...data,
          createdAt: new Date(),
        };
        aiUsages.push(row);
        return row;
      },
      aggregate: async ({ where }: { where?: { createdAt?: { gte?: Date } } }) => {
        const matched = aiUsages.filter(
          (u) => !where?.createdAt?.gte || u.createdAt >= where.createdAt.gte,
        );
        const sumCost = matched.reduce((acc, u) => acc + u.costUsd, 0);
        return { _sum: { costUsd: sumCost } };
      },
    },
  };

  const matchId = (val: string, filter?: string | { in: string[] }) =>
    filter === undefined ? true : typeof filter === 'string' ? val === filter : filter.in.includes(val);

  Object.assign(mock.mcqOption, {
    findMany: async ({ where }: { where?: { questionId?: string | { in: string[] }; deletedAt?: null } }) =>
      mcqOptions.filter(
        (o) =>
          matchId(o.questionId, where?.questionId) &&
          (where?.deletedAt === undefined || o.deletedAt === where.deletedAt),
      ),
  });

  Object.assign(mock.modelAnswer, {
    findFirst: async ({ where }: { where?: { questionId?: string; deletedAt?: null } }) =>
      modelAnswers.find(
        (m) =>
          (where?.questionId === undefined || m.questionId === where.questionId) &&
          (where?.deletedAt === undefined || m.deletedAt === where.deletedAt),
      ) ?? null,
    findMany: async ({ where }: { where?: { questionId?: string | { in: string[] }; deletedAt?: null } }) =>
      modelAnswers.filter(
        (m) =>
          matchId(m.questionId, where?.questionId) &&
          (where?.deletedAt === undefined || m.deletedAt === where.deletedAt),
      ),
  });

  Object.assign(mock.rubricCriterion, {
    findMany: async ({ where }: { where?: { questionId?: string | { in: string[] }; deletedAt?: null } }) =>
      rubricCriteria
        .filter(
          (c) =>
            matchId(c.questionId, where?.questionId) &&
            (where?.deletedAt === undefined || c.deletedAt === where.deletedAt),
        )
        .sort((a, b) => a.orderIndex - b.orderIndex),
  });

  Object.assign(mock.student, {
    findMany: async ({ where }: { where?: { cohortId?: string | { in: string[] }; deletedAt?: null } }) =>
      students
        .filter(
          (s) =>
            matchId(s.cohortId, where?.cohortId) &&
            (where?.deletedAt === undefined || s.deletedAt === where.deletedAt),
        )
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
  });

  Object.assign(mock.attempt, {
    findMany: async ({ where }: { where?: { studentId?: string | { in: string[] } } }) =>
      attempts.filter((a) => matchId(a.studentId, where?.studentId)),
  });

  Object.assign(mock.answer, {
    findMany: async ({ where }: { where?: { attemptId?: string | { in: string[] } } }) =>
      answers.filter((a) => matchId(a.attemptId, where?.attemptId)),
  });

  Object.assign(mock.answerImage, {
    findMany: async ({
      where,
    }: {
      where?: { answerId?: string | { in: string[] }; deletedAt?: null };
    }) =>
      answerImages
        .filter(
          (img) =>
            matchId(img.answerId, where?.answerId) &&
            (where?.deletedAt === undefined || img.deletedAt === where.deletedAt),
        )
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
  });

  const mutableMock = mock as unknown as Record<string, Record<string, unknown>>;
  const videoSessionObj = (mutableMock.videoSession ??= {});
  Object.assign(videoSessionObj, {
    findMany: async ({
      where,
    }: {
      where?: { studentId?: string | { in: string[] }; topicId?: string };
    }) =>
      videoSessions.filter(
        (v) =>
          matchId(v.studentId, where?.studentId) &&
          (where?.topicId === undefined || v.topicId === where.topicId),
      ),
  });

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
      students: FakeStudentRow[];
      attempts: FakeAttemptRow[];
      answers: FakeAnswerRow[];
      answerImages: FakeAnswerImageRow[];
      videoSessions: FakeVideoSessionRow[];
      gradingResults: FakeGradingResultRow[];
      teacherOverrides: FakeTeacherOverrideRow[];
      aiUsages: FakeAiUsageRow[];
    };
  };
}

export const createInMemoryAuthPrisma = createInMemoryPrisma;
