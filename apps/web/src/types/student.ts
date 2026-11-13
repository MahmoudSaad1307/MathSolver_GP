import type { AttemptStatus, CohortGroup, CohortStatus, QuestionType } from '@mathlens/shared';

export interface StudentAttemptImage {
  id: string;
  width: number;
  height: number;
  bytes: number;
  signedUrl: string;
}

export interface StudentExamOption {
  id: string;
  label: 'A' | 'B' | 'C' | 'D';
  textLatex: string;
}

export interface StudentExamQuestion {
  id: string;
  answerId: string | null;
  orderIndex: number;
  type: QuestionType;
  promptLatex: string;
  points: number;
  mcqOptions: StudentExamOption[];
  selectedOptionId: string | null;
  images: StudentAttemptImage[];
}

export interface StudentExamAttempt {
  id: string;
  examModelId: string;
  modelNumber: 1 | 2;
  title: string;
  durationMinutes: number;
  status: AttemptStatus;
  startedAt: string;
  submittedAt: string | null;
  deadlineAt: string;
  serverNow: string;
  maxScore: number;
  questions: StudentExamQuestion[];
}

export interface CohortListItem {
  id: string;
  topicId: string;
  name: string;
  joinCode: string;
  group: CohortGroup;
  requireVideoBeforePost: boolean;
  requireWrongSegmentVisits: boolean;
  showProvisionalScore: boolean;
  postTestOpensAt: string | null;
  status: CohortStatus;
  topic: { id: string; title: string } | null;
  _count?: { students: number };
}

export interface RosterSplitResult {
  seedUsed: number;
  treatment: string[];
  control: string[];
}
