import type { PublishChecklistResult, QuestionType, ExamStatus } from '@mathlens/shared';

export interface McqOptionItem {
  id: string;
  label: 'A' | 'B' | 'C' | 'D';
  textLatex: string;
  isCorrect: boolean;
}

export interface ModelAnswerItem {
  id: string;
  solutionStepsLatex: string[];
  finalAnswerLatex: string;
  finalAnswerSympy: string | null;
  commonMistakes: string;
  rubricVersion: number;
}

export interface RubricCriterionItem {
  id: string;
  orderIndex: number;
  key: string;
  descriptionEn: string;
  descriptionAr: string;
  maxPoints: number;
}

export interface QuestionItem {
  id: string;
  examModelId: string;
  orderIndex: number;
  conceptKey: string;
  type: QuestionType;
  promptLatex: string;
  points: number;
  solutionUrl?: string | null;
  needsTeacherConfirmation: boolean;
  teacherConfirmedAt: string | null;
  twinQuestionId: string | null;
  mcqOptions: McqOptionItem[];
  modelAnswer: ModelAnswerItem | null;
  rubricCriteria: RubricCriterionItem[];
}

export interface ExamModelItem {
  id: string;
  topicId: string;
  modelNumber: 1 | 2;
  title: string;
  durationMinutes: number;
  totalPoints: number;
  status: ExamStatus;
  pairedWithId: string | null;
  questions: QuestionItem[];
}

export interface TopicDetail {
  id: string;
  title: string;
  description: string;
  correctnessThreshold: number;
  cohortCount?: number;
  examModels: ExamModelItem[];
  publishChecklist: PublishChecklistResult;
  hasPlaceholders: boolean;
  missingVideoCount: number;
  unconfirmedCount: number;
}

export interface ModelImportDiffSummary {
  modelNumber: 1 | 2;
  titleChanged: boolean;
  previousTotalPoints: number;
  nextTotalPoints: number;
  addedOrderIndexes: number[];
  updatedOrderIndexes: number[];
  removedOrderIndexes: number[];
  incomingQuestionCount: number;
}

export interface BundleImportResult {
  dryRun: boolean;
  applied: boolean;
  topicId: string | null;
  diff: {
    mode: 'CREATE_TOPIC' | 'UPDATE_TOPIC';
    topicChanges: Array<{ field: string; before: unknown; after: unknown }>;
    models: [ModelImportDiffSummary, ModelImportDiffSummary];
  };
  topic: TopicDetail | null;
}
