import type { PrismaClient } from '@prisma/client';
import { AppError } from '../lib/errors.js';

function roundTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

export type ConceptProgressStatus = 'IMPROVED' | 'MAINTAINED_HIGH' | 'NEEDS_REVIEW';

export interface ConceptComparisonItem {
  conceptKey: string;
  preScore: number;
  preMax: number;
  prePercentage: number;
  postScore: number;
  postMax: number;
  postPercentage: number;
  deltaPercentage: number;
  status: ConceptProgressStatus;
}

export class ComparisonService {
  constructor(private readonly prisma: PrismaClient) {}

  async getStudentComparison(studentId: string) {
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      include: { cohort: true },
    });
    if (!student || student.deletedAt !== null || !student.cohort || student.cohort.deletedAt !== null) {
      throw new AppError('NOT_FOUND');
    }

    const topic = await this.prisma.topic.findFirst({
      where: { id: student.cohort.topicId, deletedAt: null },
    });
    if (!topic) {
      throw new AppError('NOT_FOUND');
    }

    const [examModels, attempts, videoSessions] = await Promise.all([
      this.prisma.examModel.findMany({ where: { topicId: topic.id, deletedAt: null } }),
      this.prisma.attempt.findMany({ where: { studentId: student.id } }),
      this.prisma.videoSession.findMany({ where: { studentId: student.id, topicId: topic.id } }),
    ]);

    const model1 = examModels.find((m) => m.modelNumber === 1) ?? null;
    const model2 = examModels.find((m) => m.modelNumber === 2) ?? null;
    const preAttempt = model1 ? attempts.find((a) => a.examModelId === model1.id) ?? null : null;
    const postAttempt = model2 ? attempts.find((a) => a.examModelId === model2.id) ?? null : null;

    if (!preAttempt || !postAttempt || postAttempt.status === 'IN_PROGRESS') {
      throw new AppError('CONFLICT', {
        messageEn: 'Complete Model 2 before viewing the before/after comparison.',
        messageAr: 'يجب إكمال النموذج الثاني قبل عرض مقارنة الأداء.',
      });
    }

    const showProvisional = student.cohort.showProvisionalScore;
    const postReady =
      postAttempt.status === 'GRADED' ||
      postAttempt.status === 'FINAL' ||
      (postAttempt.status === 'NEEDS_REVIEW' && showProvisional);

    if (!postReady) {
      throw new AppError('CONFLICT', {
        messageEn: 'Model 2 grading is still in progress or awaiting teacher review.',
        messageAr: 'لا تزال نتائج النموذج الثاني قيد التصحيح أو مراجعة المعلم.',
      });
    }

    const modelIds = [model1?.id, model2?.id].filter((id): id is string => Boolean(id));
    const [questions, preAnswers, postAnswers] = await Promise.all([
      modelIds.length
        ? this.prisma.question.findMany({
            where: { examModelId: { in: modelIds }, deletedAt: null },
            orderBy: { orderIndex: 'asc' },
          })
        : Promise.resolve([]),
      this.prisma.answer.findMany({ where: { attemptId: preAttempt.id } }),
      this.prisma.answer.findMany({ where: { attemptId: postAttempt.id } }),
    ]);

    const preQ = questions.filter((q) => q.examModelId === model1?.id);
    const postQ = questions.filter((q) => q.examModelId === model2?.id);

    const preAnsMap = new Map(preAnswers.map((a) => [a.questionId, a]));
    const postAnsMap = new Map(postAnswers.map((a) => [a.questionId, a]));

    const conceptAccum = new Map<
      string,
      { preScore: number; preMax: number; postScore: number; postMax: number }
    >();

    for (const q of preQ) {
      const curr = conceptAccum.get(q.conceptKey) ?? {
        preScore: 0,
        preMax: 0,
        postScore: 0,
        postMax: 0,
      };
      const ans = preAnsMap.get(q.id);
      curr.preScore += ans?.score ?? 0;
      curr.preMax += q.points;
      conceptAccum.set(q.conceptKey, curr);
    }

    for (const q of postQ) {
      const curr = conceptAccum.get(q.conceptKey) ?? {
        preScore: 0,
        preMax: 0,
        postScore: 0,
        postMax: 0,
      };
      const ans = postAnsMap.get(q.id);
      curr.postScore += ans?.score ?? 0;
      curr.postMax += q.points;
      conceptAccum.set(q.conceptKey, curr);
    }

    const concepts: ConceptComparisonItem[] = Array.from(conceptAccum.entries()).map(
      ([conceptKey, data]) => {
        const prePct = data.preMax > 0 ? roundTwo((data.preScore / data.preMax) * 100) : 0;
        const postPct = data.postMax > 0 ? roundTwo((data.postScore / data.postMax) * 100) : 0;
        const deltaPct = roundTwo(postPct - prePct);

        let status: ConceptProgressStatus = 'NEEDS_REVIEW';
        if (deltaPct > 5 && postPct >= 50) {
          status = 'IMPROVED';
        } else if (postPct >= 80) {
          status = 'MAINTAINED_HIGH';
        }

        return {
          conceptKey,
          preScore: roundTwo(data.preScore),
          preMax: roundTwo(data.preMax),
          prePercentage: prePct,
          postScore: roundTwo(data.postScore),
          postMax: roundTwo(data.postMax),
          postPercentage: postPct,
          deltaPercentage: deltaPct,
          status,
        };
      },
    );

    const postById = new Map(postQ.map((q) => [q.id, q]));
    const twinQuestions = preQ.map((q1) => {
      const q2 =
        (q1.twinQuestionId ? postById.get(q1.twinQuestionId) : undefined) ??
        postQ.find((candidate) => candidate.twinQuestionId === q1.id) ??
        postQ.find(
          (candidate) =>
            candidate.conceptKey === q1.conceptKey && candidate.orderIndex === q1.orderIndex,
        ) ??
        null;

      const a1 = preAnsMap.get(q1.id);
      const a2 = q2 ? postAnsMap.get(q2.id) : undefined;

      return {
        conceptKey: q1.conceptKey,
        orderIndex: q1.orderIndex,
        preQuestionId: q1.id,
        postQuestionId: q2?.id ?? null,
        preScore: a1?.score ?? 0,
        preMax: q1.points,
        postScore: a2?.score ?? null,
        postMax: q2?.points ?? null,
      };
    });

    const preTotal = preAttempt.totalScore ?? 0;
    const postTotal = postAttempt.totalScore ?? 0;
    const prePercentage =
      preAttempt.percentage ??
      (preAttempt.maxScore > 0 ? roundTwo((preTotal / preAttempt.maxScore) * 100) : 0);
    const postPercentage =
      postAttempt.percentage ??
      (postAttempt.maxScore > 0 ? roundTwo((postTotal / postAttempt.maxScore) * 100) : 0);

    const deltaPoints = roundTwo(postTotal - preTotal);
    const deltaPercentage = roundTwo(postPercentage - prePercentage);
    const normalizedGain =
      prePercentage >= 100
        ? null
        : Math.round(((postPercentage - prePercentage) / (100 - prePercentage)) * 1000) / 1000;

    const improvedConcepts = concepts
      .filter((c) => c.status === 'IMPROVED' || c.status === 'MAINTAINED_HIGH')
      .map((c) => c.conceptKey);
    const reviewConcepts = concepts
      .filter((c) => c.status === 'NEEDS_REVIEW')
      .map((c) => c.conceptKey);

    let summaryAr = '';
    if (deltaPercentage > 0) {
      summaryAr = `أحسنت! ارتفع أداؤك بمقدار +${deltaPercentage}% من ${Math.round(prePercentage)}% في النموذج الأول إلى ${Math.round(postPercentage)}% في النموذج الثاني.`;
    } else if (deltaPercentage === 0) {
      summaryAr = `حافظت على نفس المستوى (${Math.round(postPercentage)}%) بين النموذجين.`;
    } else {
      summaryAr = `انخفضت الدرجة بمقدار ${Math.abs(deltaPercentage)}% (${Math.round(prePercentage)}% ← ${Math.round(postPercentage)}%). ننصح بمراجعة فيديو الشرح للتركيز على النقاط المتبقية.`;
    }
    if (improvedConcepts.length > 0) {
      summaryAr += ` المفاهيم المتقنة: ${improvedConcepts.join('، ')}.`;
    }
    if (reviewConcepts.length > 0) {
      summaryAr += ` مفاهيم تحتاج لمراجعة إضافية: ${reviewConcepts.join('، ')}.`;
    }

    const videoSession = videoSessions[0] ?? null;
    const watchedSeconds = videoSession?.watchedSeconds ?? 0;

    return {
      student: {
        id: student.id,
        displayName: student.displayName,
        group: student.cohort.group,
      },
      topic: {
        id: topic.id,
        title: topic.title,
        videoId: topic.videoId,
        minWatchSeconds: topic.minWatchSeconds,
      },
      preTest: {
        attemptId: preAttempt.id,
        status: preAttempt.status,
        totalScore: preTotal,
        maxScore: preAttempt.maxScore,
        percentage: prePercentage,
        submittedAt: preAttempt.submittedAt ? preAttempt.submittedAt.toISOString() : null,
      },
      postTest: {
        attemptId: postAttempt.id,
        status: postAttempt.status,
        totalScore: postTotal,
        maxScore: postAttempt.maxScore,
        percentage: postPercentage,
        submittedAt: postAttempt.submittedAt ? postAttempt.submittedAt.toISOString() : null,
      },
      deltaPoints,
      deltaPercentage,
      normalizedGain,
      summaryAr,
      concepts,
      twinQuestions,
      videoOfferAfterPost: {
        available: Boolean(topic.videoId),
        watchedSeconds,
        minWatchSeconds: topic.minWatchSeconds,
        recommendedForControl:
          student.cohort.group === 'CONTROL' &&
          Boolean(topic.videoId) &&
          watchedSeconds < topic.minWatchSeconds,
      },
    };
  }
}
