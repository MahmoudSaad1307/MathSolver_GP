import { extractYoutubeVideoId } from './youtube.js';
import type { QuestionType } from '../enums.js';

export interface ValidatableMcqOption {
  label: string;
  textLatex: string;
  isCorrect: boolean;
}

export interface ValidatableRubricCriterion {
  key: string;
  maxPoints: number;
}

export interface ValidatableQuestion {
  id?: string;
  orderIndex: number;
  conceptKey: string;
  type: QuestionType;
  points: number;
  videoTimestampSeconds: number;
  solutionUrl?: string | null;
  needsTeacherConfirmation: boolean;
  mcqOptions?: ValidatableMcqOption[];
  modelAnswer?: {
    solutionStepsLatex: string[];
    finalAnswerLatex: string;
  } | null;
  rubricCriteria?: ValidatableRubricCriterion[];
}

export interface ValidatableExamModel {
  modelNumber: 1 | 2;
  questions: ValidatableQuestion[];
}

export interface ValidatableTopic {
  videoUrl: string;
  videoId?: string | null;
}

export interface ChecklistIssue {
  code:
    | 'INVALID_VIDEO_URL'
    | 'MISSING_MODEL'
    | 'EMPTY_MODEL'
    | 'MISSING_TIMESTAMP'
    | 'NEEDS_TEACHER_CONFIRMATION'
    | 'INVALID_MCQ_OPTIONS'
    | 'MISSING_MODEL_ANSWER'
    | 'RUBRIC_SUM_MISMATCH'
    | 'CONCEPT_MISMATCH';
  modelNumber?: 1 | 2;
  questionOrderIndex?: number;
  message_ar: string;
  message_en: string;
}

export interface PublishChecklistResult {
  ready: boolean;
  issues: ChecklistIssue[];
}

const POINTS_EPSILON = 1e-6;

export function sumRubricPoints(criteria: ReadonlyArray<{ maxPoints: number }>): number {
  return criteria.reduce((acc, c) => acc + c.maxPoints, 0);
}

export function isRubricSumValid(
  questionPoints: number,
  criteria: ReadonlyArray<{ maxPoints: number }>,
): boolean {
  if (criteria.length === 0 || questionPoints <= 0) {
    return false;
  }
  const sum = sumRubricPoints(criteria);
  return Math.abs(sum - questionPoints) <= POINTS_EPSILON;
}

export function validateQuestionForPublish(
  modelNumber: 1 | 2,
  q: ValidatableQuestion,
): ChecklistIssue[] {
  const issues: ChecklistIssue[] = [];

  if (q.videoTimestampSeconds <= 0) {
    issues.push({
      code: 'MISSING_TIMESTAMP',
      modelNumber,
      questionOrderIndex: q.orderIndex,
      message_ar: `النموذج ${modelNumber} - السؤال ${q.orderIndex}: يرجى تحديد الطابع الزمني لشرح السؤال في الفيديو.`,
      message_en: `Model ${modelNumber} Q${q.orderIndex}: videoTimestampSeconds must be greater than 0.`,
    });
  }

  if (q.needsTeacherConfirmation) {
    issues.push({
      code: 'NEEDS_TEACHER_CONFIRMATION',
      modelNumber,
      questionOrderIndex: q.orderIndex,
      message_ar: `النموذج ${modelNumber} - السؤال ${q.orderIndex}: يحتاج لمراجعة وتأكيد المدرس قبل النشر.`,
      message_en: `Model ${modelNumber} Q${q.orderIndex}: requires teacher confirmation before publishing.`,
    });
  }

  if (q.type === 'MCQ') {
    const opts = q.mcqOptions ?? [];
    const correctCount = opts.filter((o) => o.isCorrect).length;
    const labels = new Set(opts.map((o) => o.label));
    if (opts.length !== 4 || labels.size !== 4 || correctCount !== 1) {
      issues.push({
        code: 'INVALID_MCQ_OPTIONS',
        modelNumber,
        questionOrderIndex: q.orderIndex,
        message_ar: `النموذج ${modelNumber} - السؤال ${q.orderIndex}: يجب أن يحتوي سؤال الاختيار من متعدد على 4 خيارات مميزة وإجابة صحيحة واحدة فقط.`,
        message_en: `Model ${modelNumber} Q${q.orderIndex}: MCQ must have 4 distinct options and exactly 1 correct answer.`,
      });
    }
  } else {
    if (
      !q.modelAnswer ||
      q.modelAnswer.solutionStepsLatex.length === 0 ||
      !q.modelAnswer.finalAnswerLatex.trim()
    ) {
      issues.push({
        code: 'MISSING_MODEL_ANSWER',
        modelNumber,
        questionOrderIndex: q.orderIndex,
        message_ar: `النموذج ${modelNumber} - السؤال ${q.orderIndex}: نموذج الإجابة غير مكتمل.`,
        message_en: `Model ${modelNumber} Q${q.orderIndex}: essay model answer is incomplete.`,
      });
    }
    const criteria = q.rubricCriteria ?? [];
    if (!isRubricSumValid(q.points, criteria)) {
      issues.push({
        code: 'RUBRIC_SUM_MISMATCH',
        modelNumber,
        questionOrderIndex: q.orderIndex,
        message_ar: `النموذج ${modelNumber} - السؤال ${q.orderIndex}: مجموع درجات معايير التصحيح (${sumRubricPoints(criteria)}) لا يساوي درجة السؤال (${q.points}).`,
        message_en: `Model ${modelNumber} Q${q.orderIndex}: rubric sum (${sumRubricPoints(criteria)}) does not equal question points (${q.points}).`,
      });
    }
  }

  return issues;
}

export function evaluatePublishChecklist(
  topic: ValidatableTopic,
  model1: ValidatableExamModel | null | undefined,
  model2: ValidatableExamModel | null | undefined,
): PublishChecklistResult {
  const issues: ChecklistIssue[] = [];

  if (!extractYoutubeVideoId(topic.videoUrl)) {
    issues.push({
      code: 'INVALID_VIDEO_URL',
      message_ar: 'رابط فيديو يوتيوب غير صالح أو لا يزال نصاً مؤقتاً.',
      message_en: 'Topic YouTube video URL is invalid or still a placeholder.',
    });
  }

  for (const [num, model] of [
    [1, model1],
    [2, model2],
  ] as const) {
    if (!model) {
      issues.push({
        code: 'MISSING_MODEL',
        modelNumber: num,
        message_ar: `النموذج ${num} غير موجود.`,
        message_en: `Model ${num} is missing.`,
      });
      continue;
    }
    if (model.questions.length === 0) {
      issues.push({
        code: 'EMPTY_MODEL',
        modelNumber: num,
        message_ar: `النموذج ${num} لا يحتوي على أي أسئلة.`,
        message_en: `Model ${num} has no questions.`,
      });
      continue;
    }
    for (const q of model.questions) {
      issues.push(...validateQuestionForPublish(num, q));
    }
  }

  if (model1 && model2 && model1.questions.length > 0 && model2.questions.length > 0) {
    const concepts1 = new Set(model1.questions.map((q) => q.conceptKey));
    const concepts2 = new Set(model2.questions.map((q) => q.conceptKey));
    const missingIn2 = [...concepts1].filter((c) => !concepts2.has(c));
    const missingIn1 = [...concepts2].filter((c) => !concepts1.has(c));
    if (missingIn1.length > 0 || missingIn2.length > 0) {
      issues.push({
        code: 'CONCEPT_MISMATCH',
        message_ar: 'المفاهيم (conceptKey) غير متطابقة بالكامل بين النموذج الأول والنموذج الثاني.',
        message_en: `Concept keys mismatch between models (missing in M1: ${missingIn1.join(', ')}; missing in M2: ${missingIn2.join(', ')}).`,
      });
    }
  }

  return {
    ready: issues.length === 0,
    issues,
  };
}
