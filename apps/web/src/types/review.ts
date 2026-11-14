import type {
  AttemptStatus,
  CohortGroup,
  GradingErrorType,
  QuestionType,
  ReviewReason,
  ScoreSource,
  StudentFlowStep,
} from '@mathlens/shared';

export interface TranscribedLineView {
  lineNumber: number;
  textLatex: string;
  confidence: number;
  hasUnsure: boolean;
  illegible: boolean;
  crossedOut: boolean;
}

export interface StudentResultCriterionView {
  criterionId: string;
  key: string;
  descriptionEn: string;
  descriptionAr: string;
  awardedPoints: number;
  maxPoints: number;
  commentAr: string;
}

export type StudentQuestionStatusChip = 'GRADING' | 'GRADED' | 'NEEDS_REVIEW' | 'OVERRIDDEN';

export interface StudentAttemptQuestionResult {
  questionId: string;
  answerId: string | null;
  orderIndex: number;
  conceptKey: string;
  type: QuestionType;
  promptLatex: string;
  points: number;
  solutionUrl?: string | null;
  statusChip: StudentQuestionStatusChip;
  score: number | null;
  isCorrect: boolean | null;
  belowThreshold: boolean;
  mcqOptions: Array<{
    id: string;
    label: string;
    textLatex: string;
  }>;
  selectedOptionId: string | null;
  images: Array<{
    id: string;
    signedUrl: string;
    width: number;
    height: number;
  }>;
  transcribedLines: TranscribedLineView[];
  firstErrorStep: number | null;
  errorType: GradingErrorType | null;
  errorExplanationAr: string | null;
  hintAr: string | null;
  teacherNote: string | null;
  criteriaBreakdown: StudentResultCriterionView[];
  misreadReportedAt: string | null;
  misreadNote: string | null;
}

export interface StudentAttemptResults {
  attempt: {
    id: string;
    examModelId: string;
    modelNumber: number;
    title: string;
    status: AttemptStatus;
    startedAt: string;
    submittedAt: string | null;
    maxScore: number;
    totalScore: number | null;
    percentage: number | null;
    scoreHidden: boolean;
    isProvisional: boolean;
    scoreSource: ScoreSource | null;
  };
  topic: {
    id: string;
    title: string;
    correctnessThreshold: number;
  };
  cohort: {
    id: string;
    group: CohortGroup;
    requireVideoBeforePost: boolean;
    showProvisionalScore: boolean;
  };
  statusCounts: {
    totalQuestions: number;
    gradedCount: number;
    gradingCount: number;
    needsReviewCount: number;
  };
  questions: StudentAttemptQuestionResult[];
}

export interface ReviewQueueItem {
  answerId: string;
  attemptId: string;
  attemptStatus: AttemptStatus;
  submittedAt: string | null;
  isPendingReview: boolean;
  misreadReportedAt: string | null;
  misreadNote: string | null;
  reviewReasons: ReviewReason[];
  student: {
    id: string;
    displayName: string;
  };
  cohort: {
    id: string;
    name: string;
    group: CohortGroup;
  };
  topic: {
    id: string;
    title: string;
  };
  examModel: {
    id: string;
    modelNumber: number;
    title: string;
  };
  question: {
    id: string;
    orderIndex: number;
    conceptKey: string;
    promptLatex: string;
    points: number;
    solutionUrl?: string | null;
    modelAnswer: {
      solutionStepsLatex: string[];
      finalAnswerLatex: string;
      finalAnswerSympy: string | null;
      commonMistakes: string;
    } | null;
  };
  images: Array<{
    id: string;
    signedUrl: string;
    width: number;
    height: number;
    pinnedByTeacher: boolean;
  }>;
  latestResult: {
    id: string;
    version: number;
    provider: string;
    modelName: string;
    aiTotal: number;
    finalAnswerCorrect: boolean;
    firstErrorStep: number | null;
    errorType: GradingErrorType | null;
    errorExplanationAr: string;
    hintAr: string;
    confidence: number;
    needsReview: boolean;
    reviewReasons: string[];
    transcribedLines: TranscribedLineView[];
    createdAt: string;
  } | null;
  effectiveCriteria: Array<{
    criterionId: string;
    key: string;
    descriptionEn: string;
    descriptionAr: string;
    maxPoints: number;
    aiAwarded: number;
    effectiveAwarded: number;
    commentAr: string;
  }>;
  effectiveTotal: number;
  effectiveExplanationAr: string;
  overrideHistory: Array<{
    id: string;
    newTotal: number;
    newExplanationAr: string | null;
    note: string | null;
    createdAt: string;
  }>;
}

export interface ReviewQueueResponse {
  items: ReviewQueueItem[];
  pendingCount: number;
  totalCount: number;
}

export interface TeacherStudentRow {
  id: string;
  displayName: string;
  resumeCode: string;
  consentAcceptedAt: string | null;
  createdAt: string;
  cohort: {
    id: string;
    name: string;
    group: CohortGroup;
    joinCode: string;
  };
  topic: {
    id: string;
    title: string;
  };
  currentStep: StudentFlowStep;
  pendingReviewCount: number;
  scoreGain: number | null;
  preTest: {
    attemptId: string;
    status: AttemptStatus;
    totalScore: number | null;
    maxScore: number;
    percentage: number | null;
    submittedAt: string | null;
  } | null;
  postTest: {
    attemptId: string;
    status: AttemptStatus;
    totalScore: number | null;
    maxScore: number;
    percentage: number | null;
    submittedAt: string | null;
  } | null;
  videoProgress: {
    watchedSeconds: number;
    visitedCount: number;
    unlockedPostAt: string | null;
    manualUnlocked: boolean;
  };
}

export interface TeacherStudentDetailResponse {
  student: {
    id: string;
    displayName: string;
    resumeCode: string;
    consentAcceptedAt: string | null;
    createdAt: string;
  };
  cohort: {
    id: string;
    name: string;
    group: CohortGroup;
    joinCode: string;
  };
  topic: {
    id: string;
    title: string;
  };
  videoProgress: {
    watchedSeconds: number;
    lastPosition: number;
    unlockedPostAt: string | null;
    manualUnlocked: boolean;
  };
  attempts: Array<{
    id: string;
    modelNumber: number;
    title: string;
    status: AttemptStatus;
    startedAt: string;
    submittedAt: string | null;
    totalScore: number | null;
    maxScore: number;
    percentage: number | null;
    scoreSource: ScoreSource | null;
    answers: Array<{
      answerId: string;
      questionId: string;
      orderIndex: number;
      conceptKey: string;
      type: QuestionType;
      promptLatex: string;
      score: number | null;
      maxScore: number;
      isCorrect: boolean | null;
      misreadReportedAt: string | null;
      misreadNote: string | null;
      images: Array<{
        id: string;
        signedUrl: string;
        pinnedByTeacher: boolean;
      }>;
      latestGrading: {
        id: string;
        aiTotal: number;
        confidence: number;
        needsReview: boolean;
        reviewReasons: string[];
        errorExplanationAr: string;
        overriddenTotal: number | null;
      } | null;
    }>;
  }>;
}
