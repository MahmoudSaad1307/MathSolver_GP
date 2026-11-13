import type { AttemptStatus, CohortGroup, StudentFlowStep } from '@mathlens/shared';

export interface PostTestLockReason {
  code: string;
  message_ar: string;
  message_en: string;
}

export interface GateEvaluationInput {
  cohort: {
    group: CohortGroup;
    requireVideoBeforePost: boolean;
    showProvisionalScore: boolean;
    postTestOpensAt: Date | null;
  };
  topic: {
    minWatchSeconds: number;
  };
  preTestAttempt: {
    status: AttemptStatus;
  } | null;
  videoSession: {
    startedAt?: Date | null;
    watchedSeconds: number;
    unlockedPostAt: Date | null;
    manualUnlockedById: string | null;
  } | null;
  wrongSegmentsIncomplete?: boolean;
  now?: Date;
}

export function evaluatePostTestGate(input: GateEvaluationInput): {
  unlocked: boolean;
  reason: PostTestLockReason | null;
} {
  const { cohort, topic, preTestAttempt, videoSession, now = new Date() } = input;

  if (!preTestAttempt) {
    return {
      unlocked: false,
      reason: {
        code: 'PRETEST_REQUIRED',
        message_ar: 'يجب إكمال الاختبار القبلي (النموذج 1) أولاً.',
        message_en: 'You must complete Model 1 (pre-test) first.',
      },
    };
  }

  if (preTestAttempt.status === 'IN_PROGRESS') {
    return {
      unlocked: false,
      reason: {
        code: 'PRETEST_NOT_SUBMITTED',
        message_ar: 'يرجى إنهاء وتسليم النموذج 1 قبل فتح النموذج 2.',
        message_en: 'Please submit Model 1 before unlocking Model 2.',
      },
    };
  }

  if (preTestAttempt.status === 'SUBMITTED' || preTestAttempt.status === 'GRADING') {
    return {
      unlocked: false,
      reason: {
        code: 'PRETEST_GRADING_PENDING',
        message_ar: 'النموذج 1 قيد التصحيح الآن. سيتم فتح الخطوة التالية فور الانتهاء.',
        message_en: 'Model 1 is still being graded.',
      },
    };
  }

  if (preTestAttempt.status === 'NEEDS_REVIEW' && !cohort.showProvisionalScore) {
    return {
      unlocked: false,
      reason: {
        code: 'PRETEST_AWAITING_REVIEW',
        message_ar: 'بعض إجابات النموذج 1 بانتظار مراجعة المعلم قبل المتابعة.',
        message_en: 'Some Model 1 answers await teacher review before continuing.',
      },
    };
  }

  if (videoSession?.manualUnlockedById || videoSession?.unlockedPostAt) {
    return { unlocked: true, reason: null };
  }

  if (cohort.requireVideoBeforePost) {
    const watched = videoSession?.watchedSeconds ?? 0;
    if (watched < topic.minWatchSeconds) {
      return {
        unlocked: false,
        reason: {
          code: 'VIDEO_WATCH_INCOMPLETE',
          message_ar: `يجب مشاهدة فيديو الشرح لمدة ${topic.minWatchSeconds} ثانية على الأقل لفتح النموذج 2.`,
          message_en: `Watch at least ${topic.minWatchSeconds} seconds of the remediation video to unlock Model 2.`,
        },
      };
    }
    if (input.wrongSegmentsIncomplete) {
      return {
        unlocked: false,
        reason: {
          code: 'WRONG_SEGMENTS_REQUIRED',
          message_ar: 'يرجى الانتقال ومشاهدة أجزاء الشرح الخاصة بالأسئلة التي أخطأت فيها.',
          message_en: 'Please visit the explanation segments for the questions you missed.',
        },
      };
    }
  } else if (cohort.postTestOpensAt && now.getTime() < cohort.postTestOpensAt.getTime()) {
    return {
      unlocked: false,
      reason: {
        code: 'CONTROL_WAIT_SCHEDULED_TIME',
        message_ar: 'سيُفتح النموذج 2 في الموعد المحدد من المعلم.',
        message_en: 'Model 2 is scheduled to open later by your teacher.',
      },
    };
  }

  return { unlocked: true, reason: null };
}

export function deriveStudentFlowStep(
  params: GateEvaluationInput & {
    consentAcceptedAt: Date | null;
    postTestAttempt: { status: AttemptStatus } | null;
  },
): { step: StudentFlowStep; postTestLockReason: PostTestLockReason | null } {
  if (!params.consentAcceptedAt) {
    return { step: 'CONSENT', postTestLockReason: null };
  }

  const gate = evaluatePostTestGate(params);

  if (params.postTestAttempt) {
    switch (params.postTestAttempt.status) {
      case 'IN_PROGRESS':
        return { step: 'POSTTEST_IN_PROGRESS', postTestLockReason: null };
      case 'SUBMITTED':
      case 'GRADING':
        return { step: 'POSTTEST_GRADING', postTestLockReason: null };
      case 'NEEDS_REVIEW':
        return {
          step: params.cohort.showProvisionalScore ? 'COMPARISON' : 'POSTTEST_GRADING',
          postTestLockReason: null,
        };
      case 'GRADED':
      case 'FINAL':
        return { step: 'COMPARISON', postTestLockReason: null };
    }
  }

  if (!params.preTestAttempt || params.preTestAttempt.status === 'IN_PROGRESS') {
    return { step: 'PRETEST_IN_PROGRESS', postTestLockReason: gate.reason };
  }

  if (params.preTestAttempt.status === 'SUBMITTED') {
    return { step: 'PRETEST_SUBMITTED', postTestLockReason: gate.reason };
  }

  if (
    params.preTestAttempt.status === 'GRADING' ||
    (params.preTestAttempt.status === 'NEEDS_REVIEW' && !params.cohort.showProvisionalScore)
  ) {
    return { step: 'PRETEST_GRADING', postTestLockReason: gate.reason };
  }

  if (gate.unlocked) {
    return { step: 'POSTTEST_UNLOCKED', postTestLockReason: null };
  }

  if (gate.reason?.code === 'VIDEO_WATCH_INCOMPLETE' && params.videoSession?.startedAt) {
    return { step: 'REMEDIATION', postTestLockReason: gate.reason };
  }

  return { step: 'PRETEST_RESULTS', postTestLockReason: gate.reason };
}
