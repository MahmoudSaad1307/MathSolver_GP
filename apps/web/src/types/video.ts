import type { CohortGroup } from '@mathlens/shared';

export interface WrongQuestionSegmentView {
  questionId: string;
  orderIndex: number;
  conceptKey: string;
  timestampSeconds: number;
  solutionUrl?: string | null;
  score: number;
  maxScore: number;
  visited: boolean;
}

export interface StudentVideoStateResponse {
  topic: {
    id: string;
    title: string;
    videoUrl: string;
    videoId: string | null;
    minWatchSeconds: number;
  };
  cohort: {
    id: string;
    group: CohortGroup;
    requireVideoBeforePost: boolean;
    requireWrongSegmentVisits: boolean;
  };
  watchedSeconds: number;
  minWatchSeconds: number;
  remainingSeconds: number;
  lastPosition: number;
  visitedQuestionIds: string[];
  wrongQuestionSegments: WrongQuestionSegmentView[];
  wrongSegmentsIncomplete: boolean;
  unlocked: boolean;
  unlockedPostAt: string | null;
  manualUnlocked: boolean;
  postTestCompleted: boolean;
  postTestLockReason: {
    code: string;
    message_ar: string;
    message_en: string;
  } | null;
}

export interface VideoHeartbeatResponse {
  watchedSeconds: number;
  minWatchSeconds: number;
  remainingSeconds: number;
  lastPosition: number;
  visitedQuestionIds: string[];
  wrongQuestionSegments: WrongQuestionSegmentView[];
  wrongSegmentsIncomplete: boolean;
  unlocked: boolean;
  unlockedPostAt: string | null;
  fraudWarning: string | null;
}

export interface StudentComparisonResponse {
  student: {
    id: string;
    displayName: string;
    group: CohortGroup;
  };
  topic: {
    id: string;
    title: string;
    videoId: string | null;
    minWatchSeconds: number;
  };
  preTest: {
    attemptId: string;
    status: string;
    totalScore: number;
    maxScore: number;
    percentage: number;
    submittedAt: string | null;
  };
  postTest: {
    attemptId: string;
    status: string;
    totalScore: number;
    maxScore: number;
    percentage: number;
    submittedAt: string | null;
  };
  deltaPoints: number;
  deltaPercentage: number;
  normalizedGain: number | null;
  summaryAr: string;
  concepts: Array<{
    conceptKey: string;
    preScore: number;
    preMax: number;
    prePercentage: number;
    postScore: number;
    postMax: number;
    postPercentage: number;
    deltaPercentage: number;
    status: 'IMPROVED' | 'MAINTAINED_HIGH' | 'NEEDS_REVIEW';
  }>;
  twinQuestions: Array<{
    conceptKey: string;
    orderIndex: number;
    preQuestionId: string;
    postQuestionId: string | null;
    preScore: number;
    preMax: number;
    postScore: number | null;
    postMax: number | null;
  }>;
  videoOfferAfterPost: {
    available: boolean;
    watchedSeconds: number;
    minWatchSeconds: number;
    recommendedForControl: boolean;
  };
}
