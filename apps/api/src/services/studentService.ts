import type { PrismaClient } from '@prisma/client';
import type {
  MeStateResponse,
  StudentJoinInput,
  StudentJoinResponse,
  StudentResumeInput,
} from '@mathlens/shared';
import type { AppEnv } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import { writeAuditLog } from '../lib/scoping.js';
import { generateUnambiguousCode, signStudentSessionToken } from '../lib/security.js';
import type { GradingDispatcher } from './gradingDispatcher.js';
import type { StorageAdapter } from './storage/index.js';
import { deriveStudentFlowStep, evaluatePostTestGate } from './studentFlow.js';

export class StudentService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly env: AppEnv,
    private readonly storage: StorageAdapter,
    private readonly gradingDispatcher: GradingDispatcher,
  ) {}

  private async generateUniqueResumeCode(): Promise<string> {
    for (let attempt = 0; attempt < 15; attempt += 1) {
      const candidate = generateUnambiguousCode(6);
      const existing = await this.prisma.student.findUnique({
        where: { resumeCode: candidate },
        select: { id: true },
      });
      if (!existing) {
        return candidate;
      }
    }
    throw new AppError('INTERNAL_ERROR', {
      messageEn: 'Failed to allocate unique student resume code.',
      messageAr: 'تعذر إنشاء كود استرجاع للطالب. حاول مرة أخرى.',
    });
  }

  async joinQuizWithAccount(
    accountId: string,
    joinCode: string,
    ip?: string,
  ): Promise<{ token: string } & StudentJoinResponse> {
    const account = await this.prisma.studentAccount.findUnique({
      where: { id: accountId },
    });
    if (!account || account.deletedAt !== null) {
      throw new AppError('UNAUTHORIZED');
    }

    const cohort = await this.prisma.cohort.findUnique({
      where: { joinCode: joinCode.toUpperCase() },
    });
    if (!cohort || cohort.deletedAt !== null) {
      throw new AppError('INVALID_COHORT_CODE');
    }

    const existing = await this.prisma.student.findFirst({
      where: {
        accountId: account.id,
        cohortId: cohort.id,
        deletedAt: null,
      },
    });

    if (existing) {
      const updated = await this.prisma.student.update({
        where: { id: existing.id },
        data: {
          consentAcceptedAt: existing.consentAcceptedAt ?? account.consentAcceptedAt ?? new Date(),
        },
      });

      const token = signStudentSessionToken(
        {
          id: updated.id,
          cohortId: cohort.id,
          accountId: account.id,
          email: account.email,
        },
        this.env,
      );

      return {
        token,
        student: {
          id: updated.id,
          accountId: account.id,
          email: account.email,
          displayName: updated.displayName,
          resumeCode: updated.resumeCode,
          cohortId: cohort.id,
          cohortName: cohort.name,
          group: cohort.group,
        },
      };
    }

    if (cohort.status !== 'OPEN') {
      throw new AppError('COHORT_CLOSED');
    }

    const resumeCode = await this.generateUniqueResumeCode();

    const student = await this.prisma.$transaction(async (tx) => {
      const created = await tx.student.create({
        data: {
          accountId: account.id,
          cohortId: cohort.id,
          displayName: account.displayName,
          resumeCode,
          consentAcceptedAt: account.consentAcceptedAt ?? new Date(),
        },
      });

      await writeAuditLog(tx, this.env, {
        actorType: 'STUDENT',
        actorId: created.id,
        action: 'STUDENT_JOIN',
        entity: 'Student',
        entityId: created.id,
        diff: { cohortId: cohort.id, accountId: account.id },
        ip,
      });

      return created;
    });

    const token = signStudentSessionToken(
      {
        id: student.id,
        cohortId: cohort.id,
        accountId: account.id,
        email: account.email,
      },
      this.env,
    );

    return {
      token,
      student: {
        id: student.id,
        accountId: account.id,
        email: account.email,
        displayName: student.displayName,
        resumeCode: student.resumeCode,
        cohortId: cohort.id,
        cohortName: cohort.name,
        group: cohort.group,
      },
    };
  }

  async selectEnrollment(
    accountId: string,
    enrollmentId: string,
  ): Promise<{ token: string; state: MeStateResponse }> {
    const student = await this.prisma.student.findFirst({
      where: {
        id: enrollmentId,
        accountId,
        deletedAt: null,
      },
      include: {
        cohort: true,
        account: true,
      },
    });

    if (!student || student.cohort.deletedAt !== null) {
      throw new AppError('NOT_FOUND');
    }

    await this.prisma.student.update({
      where: { id: student.id },
      data: {
        consentAcceptedAt: student.consentAcceptedAt ?? student.account?.consentAcceptedAt ?? null,
      },
    });

    const token = signStudentSessionToken(
      {
        id: student.id,
        cohortId: student.cohortId,
        accountId,
        email: student.account?.email,
      },
      this.env,
    );

    const state = await this.getState(student.id);
    return { token, state };
  }

  async join(
    input: StudentJoinInput,
    ip?: string,
    accountId?: string,
  ): Promise<{ token: string } & StudentJoinResponse> {
    if (accountId) {
      return this.joinQuizWithAccount(accountId, input.joinCode, ip);
    }

    if (!input.displayName || input.displayName.trim().length < 2) {
      throw new AppError('VALIDATION_ERROR', {
        messageEn: 'Display name is required when joining without an account.',
        messageAr: 'الاسم مطلوب عند الانضمام بدون حساب مسجل.',
      });
    }

    const cohort = await this.prisma.cohort.findUnique({
      where: { joinCode: input.joinCode.toUpperCase() },
    });
    if (!cohort || cohort.deletedAt !== null) {
      throw new AppError('INVALID_COHORT_CODE');
    }
    if (cohort.status !== 'OPEN') {
      throw new AppError('COHORT_CLOSED');
    }

    const resumeCode = await this.generateUniqueResumeCode();
    const displayName = input.displayName.trim();

    const student = await this.prisma.$transaction(async (tx) => {
      const created = await tx.student.create({
        data: {
          cohortId: cohort.id,
          displayName,
          resumeCode,
        },
      });

      await writeAuditLog(tx, this.env, {
        actorType: 'STUDENT',
        actorId: created.id,
        action: 'STUDENT_JOIN',
        entity: 'Student',
        entityId: created.id,
        diff: { cohortId: cohort.id },
        ip,
      });

      return created;
    });

    const token = signStudentSessionToken({ id: student.id, cohortId: cohort.id }, this.env);

    return {
      token,
      student: {
        id: student.id,
        accountId: null,
        email: null,
        displayName: student.displayName,
        resumeCode: student.resumeCode,
        cohortId: cohort.id,
        cohortName: cohort.name,
        group: cohort.group,
      },
    };
  }

  async resume(
    input: StudentResumeInput,
    ip?: string,
  ): Promise<{ token: string } & StudentJoinResponse> {
    const student = await this.prisma.student.findUnique({
      where: { resumeCode: input.resumeCode.toUpperCase() },
      include: { cohort: true, account: true },
    });

    if (!student || student.deletedAt !== null || student.cohort.deletedAt !== null) {
      throw new AppError('INVALID_RESUME_CODE');
    }

    await writeAuditLog(this.prisma, this.env, {
      actorType: 'STUDENT',
      actorId: student.id,
      action: 'STUDENT_RESUME',
      entity: 'Student',
      entityId: student.id,
      ip,
    });

    const token = signStudentSessionToken(
      {
        id: student.id,
        cohortId: student.cohortId,
        accountId: student.accountId ?? undefined,
        email: student.account?.email ?? undefined,
      },
      this.env,
    );

    return {
      token,
      student: {
        id: student.id,
        accountId: student.accountId ?? null,
        email: student.account?.email ?? null,
        displayName: student.displayName,
        resumeCode: student.resumeCode,
        cohortId: student.cohort.id,
        cohortName: student.cohort.name,
        group: student.cohort.group,
      },
    };
  }

  async acceptConsent(studentId: string, ip?: string): Promise<MeStateResponse> {
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, deletedAt: null },
      select: { id: true, accountId: true, consentAcceptedAt: true },
    });
    if (!student) {
      throw new AppError('NOT_FOUND');
    }

    if (!student.consentAcceptedAt) {
      const now = new Date();
      await this.prisma.$transaction(async (tx) => {
        await tx.student.update({
          where: { id: student.id },
          data: { consentAcceptedAt: now },
        });
        if (student.accountId) {
          await tx.studentAccount.update({
            where: { id: student.accountId },
            data: { consentAcceptedAt: now },
          });
        }
        await writeAuditLog(tx, this.env, {
          actorType: 'STUDENT',
          actorId: student.id,
          action: 'STUDENT_CONSENT',
          entity: 'Student',
          entityId: student.id,
          ip,
        });
      });
    }

    return this.getState(studentId);
  }

  async getState(studentId: string): Promise<MeStateResponse> {
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, deletedAt: null },
      include: {
        account: true,
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

    if (!student || student.cohort.deletedAt !== null || student.cohort.topic.deletedAt !== null) {
      throw new AppError('NOT_FOUND');
    }

    const { cohort } = student;
    const { topic } = cohort;
    const preTestAttempt = student.attempts.find((a) => a.examModel.modelNumber === 1) ?? null;
    const postTestAttempt = student.attempts.find((a) => a.examModel.modelNumber === 2) ?? null;
    const videoSession = student.videoSessions.find((v) => v.topicId === topic.id) ?? null;
    const effectiveConsent =
      student.consentAcceptedAt ?? student.account?.consentAcceptedAt ?? null;

    const { step, postTestLockReason } = deriveStudentFlowStep({
      consentAcceptedAt: effectiveConsent,
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
      step,
      student: {
        id: student.id,
        accountId: student.accountId ?? null,
        email: student.account?.email ?? null,
        displayName: student.displayName,
        cohortId: cohort.id,
        cohortName: cohort.name,
        group: cohort.group,
        requireVideoBeforePost: cohort.requireVideoBeforePost,
        consentAcceptedAt: effectiveConsent ? effectiveConsent.toISOString() : null,
      },
      topic: {
        id: topic.id,
        title: topic.title,
      },
      preTestAttempt: preTestAttempt
        ? {
            id: preTestAttempt.id,
            examModelId: preTestAttempt.examModelId,
            status: preTestAttempt.status,
            deadlineAt: preTestAttempt.deadlineAt.toISOString(),
          }
        : null,
      postTestAttempt: postTestAttempt
        ? {
            id: postTestAttempt.id,
            examModelId: postTestAttempt.examModelId,
            status: postTestAttempt.status,
            deadlineAt: postTestAttempt.deadlineAt.toISOString(),
          }
        : null,
      postTestLockReason,
      videoProgress: {
        watchedSeconds: videoSession?.watchedSeconds ?? 0,
        visitedCount: videoSession?.visitedQuestionIds.length ?? 0,
        requiredCount: 0,
        unlockedPostAt: videoSession?.unlockedPostAt
          ? videoSession.unlockedPostAt.toISOString()
          : null,
      },
    };
  }

  async startOrGetAttempt(studentId: string, modelNumber: 1 | 2, ip?: string) {
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, deletedAt: null },
      include: {
        cohort: {
          include: {
            topic: {
              include: {
                examModels: {
                  where: { deletedAt: null },
                  include: {
                    questions: {
                      where: { deletedAt: null },
                      orderBy: { orderIndex: 'asc' },
                    },
                  },
                },
              },
            },
          },
        },
        attempts: {
          include: { examModel: { select: { modelNumber: true } } },
        },
        videoSessions: true,
      },
    });

    if (!student || student.cohort.deletedAt !== null) {
      throw new AppError('NOT_FOUND');
    }

    if (!student.consentAcceptedAt) {
      throw new AppError('CONSENT_REQUIRED');
    }

    const { cohort } = student;
    const { topic } = cohort;
    const targetModel = topic.examModels.find((m) => m.modelNumber === modelNumber);

    if (!targetModel || targetModel.status !== 'PUBLISHED') {
      throw new AppError('CONFLICT', {
        messageEn: `Model ${modelNumber} is not published yet.`,
        messageAr: `النموذج ${modelNumber} غير متاح للحل بعد.`,
      });
    }

    if (modelNumber === 2) {
      const preTestAttempt = student.attempts.find((a) => a.examModel.modelNumber === 1) ?? null;
      const videoSession = student.videoSessions.find((v) => v.topicId === topic.id) ?? null;
      const gate = evaluatePostTestGate({
        cohort: {
          group: cohort.group,
          requireVideoBeforePost: cohort.requireVideoBeforePost,
          showProvisionalScore: cohort.showProvisionalScore,
          postTestOpensAt: cohort.postTestOpensAt,
        },
        preTestAttempt: preTestAttempt ? { status: preTestAttempt.status } : null,
        videoSession: videoSession
          ? {
              startedAt: videoSession.startedAt,
              watchedSeconds: videoSession.watchedSeconds,
              unlockedPostAt: videoSession.unlockedPostAt,
              manualUnlockedById: videoSession.manualUnlockedById,
            }
          : null,
      });

      if (!gate.unlocked) {
        throw new AppError('POSTTEST_LOCKED', {
          messageAr: gate.reason?.message_ar,
          messageEn: gate.reason?.message_en,
          details: gate.reason,
        });
      }
    }

    const existing = student.attempts.find((a) => a.examModelId === targetModel.id);
    if (existing) {
      return this.getAttempt(studentId, existing.id);
    }

    const startedAt = new Date();
    const deadlineAt = new Date(startedAt.getTime() + targetModel.durationMinutes * 60_000);
    const activeQuestions = targetModel.questions;
    const maxScore = activeQuestions.reduce((acc, q) => acc + q.points, 0);

    const createdAttemptId = await this.prisma.$transaction(async (tx) => {
      const attempt = await tx.attempt.create({
        data: {
          studentId: student.id,
          examModelId: targetModel.id,
          status: 'IN_PROGRESS',
          startedAt,
          deadlineAt,
          maxScore,
        },
      });

      if (activeQuestions.length > 0) {
        await tx.answer.createMany({
          data: activeQuestions.map((q) => ({
            attemptId: attempt.id,
            questionId: q.id,
            selectedOptionId: null,
            maxScore: q.points,
          })),
        });
      }

      await writeAuditLog(tx, this.env, {
        actorType: 'STUDENT',
        actorId: student.id,
        action: 'ATTEMPT_START',
        entity: 'Attempt',
        entityId: attempt.id,
        diff: { modelNumber, examModelId: targetModel.id, deadlineAt: deadlineAt.toISOString() },
        ip,
      });

      return attempt.id;
    });

    return this.getAttempt(studentId, createdAttemptId);
  }

  async getAttempt(studentId: string, attemptId: string) {
    const attempt = await this.prisma.attempt.findFirst({
      where: {
        id: attemptId,
        studentId,
      },
      include: {
        examModel: {
          include: {
            questions: {
              where: { deletedAt: null },
              orderBy: { orderIndex: 'asc' },
              include: {
                mcqOptions: {
                  where: { deletedAt: null },
                  orderBy: { label: 'asc' },
                },
              },
            },
          },
        },
        answers: {
          include: {
            images: {
              where: { deletedAt: null },
              orderBy: { createdAt: 'asc' },
            },
          },
        },
      },
    });

    if (!attempt) {
      throw new AppError('NOT_FOUND');
    }

    const answerByQuestionId = new Map(attempt.answers.map((a) => [a.questionId, a]));

    const questions = await Promise.all(
      attempt.examModel.questions.map(async (q) => {
        const answer = answerByQuestionId.get(q.id);
        const images = answer
          ? await Promise.all(
              answer.images.map(async (img) => ({
                id: img.id,
                width: img.width,
                height: img.height,
                bytes: img.bytes,
                signedUrl: await this.storage.getSignedUrl(img.storageKey, 300),
              })),
            )
          : [];

        return {
          id: q.id,
          answerId: answer?.id ?? null,
          orderIndex: q.orderIndex,
          type: q.type,
          promptLatex: q.promptLatex,
          points: q.points,
          // Answer key (isCorrect) and modelAnswer/rubric are strictly stripped from exam payload.
          mcqOptions: q.mcqOptions.map((o) => ({
            id: o.id,
            label: o.label,
            textLatex: o.textLatex,
          })),
          selectedOptionId: answer?.selectedOptionId ?? null,
          images,
        };
      }),
    );

    return {
      id: attempt.id,
      examModelId: attempt.examModelId,
      modelNumber: attempt.examModel.modelNumber,
      title: attempt.examModel.title,
      durationMinutes: attempt.examModel.durationMinutes,
      status: attempt.status,
      startedAt: attempt.startedAt.toISOString(),
      submittedAt: attempt.submittedAt ? attempt.submittedAt.toISOString() : null,
      deadlineAt: attempt.deadlineAt.toISOString(),
      serverNow: new Date().toISOString(),
      maxScore: attempt.maxScore,
      questions,
    };
  }

  async saveMcqAnswer(params: {
    studentId: string;
    targetId: string;
    attemptId?: string;
    selectedOptionId: string | null;
  }) {
    const { studentId, targetId, attemptId, selectedOptionId } = params;

    const answer = await this.prisma.answer.findFirst({
      where: attemptId
        ? { attemptId, questionId: targetId, attempt: { studentId } }
        : {
            attempt: { studentId },
            OR: [{ id: targetId }, { questionId: targetId }],
          },
      include: {
        attempt: true,
        question: {
          include: {
            mcqOptions: { where: { deletedAt: null } },
          },
        },
      },
    });

    if (!answer) {
      throw new AppError('NOT_FOUND');
    }

    if (answer.attempt.status !== 'IN_PROGRESS') {
      throw new AppError('ALREADY_SUBMITTED');
    }

    if (Date.now() > answer.attempt.deadlineAt.getTime()) {
      throw new AppError('EXAM_DEADLINE_EXPIRED');
    }

    if (answer.question.type !== 'MCQ') {
      throw new AppError('VALIDATION_ERROR', {
        messageEn: 'MCQ option selection applies only to MCQ questions.',
        messageAr: 'تحديد الاختيار متاح فقط لأسئلة الاختيار من متعدد.',
      });
    }

    if (selectedOptionId !== null) {
      const validOpt = answer.question.mcqOptions.some((o) => o.id === selectedOptionId);
      if (!validOpt) {
        throw new AppError('VALIDATION_ERROR', {
          messageEn: 'Selected option does not belong to this question.',
          messageAr: 'الخيار المحدد لا يتبع لهذا السؤال.',
        });
      }
    }

    const updated = await this.prisma.answer.update({
      where: { id: answer.id },
      data: { selectedOptionId },
    });

    return {
      answerId: updated.id,
      questionId: updated.questionId,
      selectedOptionId: updated.selectedOptionId,
      savedAt: new Date().toISOString(),
    };
  }

  async submitAttempt(studentId: string, attemptId: string, ip?: string) {
    const attempt = await this.prisma.attempt.findFirst({
      where: { id: attemptId, studentId },
      include: {
        answers: {
          include: {
            question: {
              include: {
                mcqOptions: { where: { deletedAt: null } },
              },
            },
            images: { where: { deletedAt: null } },
          },
        },
      },
    });

    if (!attempt) {
      throw new AppError('NOT_FOUND');
    }

    if (attempt.status !== 'IN_PROGRESS') {
      return {
        attemptId: attempt.id,
        status: attempt.status,
        totalScore: attempt.totalScore,
        maxScore: attempt.maxScore,
        percentage: attempt.percentage,
        submittedAt: attempt.submittedAt?.toISOString() ?? null,
        pendingEssayCount: 0,
      };
    }

    const now = new Date();
    const pendingEssayAnswerIds: string[] = [];

    const finalized = await this.prisma.$transaction(async (tx) => {
      let runningTotal = 0;

      for (const ans of attempt.answers) {
        if (ans.question.type === 'MCQ') {
          const correctOption = ans.question.mcqOptions.find((o) => o.isCorrect);
          const isCorrect = Boolean(correctOption) && ans.selectedOptionId === correctOption?.id;
          const score = isCorrect ? ans.maxScore : 0;
          runningTotal += score;
          await tx.answer.update({
            where: { id: ans.id },
            data: { isCorrect, score },
          });
        } else if (ans.images.length === 0) {
          // Empty essay submission receives 0 synchronously without invoking AI.
          await tx.answer.update({
            where: { id: ans.id },
            data: { isCorrect: false, score: 0 },
          });
        } else {
          pendingEssayAnswerIds.push(ans.id);
        }
      }

      const allComplete = pendingEssayAnswerIds.length === 0;
      const percentage =
        allComplete && attempt.maxScore > 0
          ? Number(((runningTotal / attempt.maxScore) * 100).toFixed(2))
          : null;

      const updatedAttempt = await tx.attempt.update({
        where: { id: attempt.id },
        data: {
          status: allComplete ? 'GRADED' : 'GRADING',
          submittedAt: now,
          totalScore: allComplete ? runningTotal : null,
          percentage,
          scoreSource: allComplete ? 'AUTO' : null,
        },
      });

      await writeAuditLog(tx, this.env, {
        actorType: 'STUDENT',
        actorId: studentId,
        action: 'ATTEMPT_SUBMIT',
        entity: 'Attempt',
        entityId: attempt.id,
        diff: {
          status: updatedAttempt.status,
          pendingEssayCount: pendingEssayAnswerIds.length,
        },
        ip,
      });

      return updatedAttempt;
    });

    for (const answerId of pendingEssayAnswerIds) {
      await this.gradingDispatcher.enqueueEssayGrading({
        attemptId: attempt.id,
        answerId,
        studentId,
      });
    }

    return {
      attemptId: finalized.id,
      status: finalized.status,
      totalScore: finalized.totalScore,
      maxScore: finalized.maxScore,
      percentage: finalized.percentage,
      submittedAt: finalized.submittedAt?.toISOString() ?? null,
      pendingEssayCount: pendingEssayAnswerIds.length,
    };
  }
}
