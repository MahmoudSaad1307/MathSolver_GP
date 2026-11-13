import { describe, expect, it } from 'vitest';
import { deriveStudentFlowStep, evaluatePostTestGate } from '../src/services/studentFlow.js';

describe('studentFlow state machine & post-test gate', () => {
  const baseCohort = {
    group: 'TREATMENT' as const,
    requireVideoBeforePost: true,
    showProvisionalScore: false,
    postTestOpensAt: null,
  };

  it('locks post-test until pre-test finishes and review rules allow', () => {
    expect(
      evaluatePostTestGate({
        cohort: baseCohort,
        topic: { minWatchSeconds: 180 },
        preTestAttempt: null,
        videoSession: null,
      }).reason?.code,
    ).toBe('PRETEST_REQUIRED');

    expect(
      evaluatePostTestGate({
        cohort: baseCohort,
        topic: { minWatchSeconds: 180 },
        preTestAttempt: { status: 'IN_PROGRESS' },
        videoSession: null,
      }).reason?.code,
    ).toBe('PRETEST_NOT_SUBMITTED');

    expect(
      evaluatePostTestGate({
        cohort: baseCohort,
        topic: { minWatchSeconds: 180 },
        preTestAttempt: { status: 'GRADING' },
        videoSession: null,
      }).reason?.code,
    ).toBe('PRETEST_GRADING_PENDING');

    expect(
      evaluatePostTestGate({
        cohort: baseCohort,
        topic: { minWatchSeconds: 180 },
        preTestAttempt: { status: 'NEEDS_REVIEW' },
        videoSession: null,
      }).reason?.code,
    ).toBe('PRETEST_AWAITING_REVIEW');
  });

  it('enforces video watch gate for TREATMENT and scheduled time gate for CONTROL', () => {
    // TREATMENT blocked under minWatchSeconds
    expect(
      evaluatePostTestGate({
        cohort: baseCohort,
        topic: { minWatchSeconds: 180 },
        preTestAttempt: { status: 'GRADED' },
        videoSession: { watchedSeconds: 100, unlockedPostAt: null, manualUnlockedById: null },
      }).reason?.code,
    ).toBe('VIDEO_WATCH_INCOMPLETE');

    // Manual teacher unlock overrides video requirement
    expect(
      evaluatePostTestGate({
        cohort: baseCohort,
        topic: { minWatchSeconds: 180 },
        preTestAttempt: { status: 'GRADED' },
        videoSession: {
          watchedSeconds: 0,
          unlockedPostAt: null,
          manualUnlockedById: '11111111-1111-4111-8111-111111111111',
        },
      }).unlocked,
    ).toBe(true);

    // CONTROL waits for postTestOpensAt if set in future, unlocks after
    const now = new Date('2026-11-13T12:00:00Z');
    const controlCohort = {
      group: 'CONTROL' as const,
      requireVideoBeforePost: false,
      showProvisionalScore: true,
      postTestOpensAt: new Date('2026-11-14T12:00:00Z'),
    };
    expect(
      evaluatePostTestGate({
        cohort: controlCohort,
        topic: { minWatchSeconds: 180 },
        preTestAttempt: { status: 'NEEDS_REVIEW' },
        videoSession: null,
        now,
      }).reason?.code,
    ).toBe('CONTROL_WAIT_SCHEDULED_TIME');

    expect(
      evaluatePostTestGate({
        cohort: { ...controlCohort, postTestOpensAt: new Date('2026-11-13T11:00:00Z') },
        topic: { minWatchSeconds: 180 },
        preTestAttempt: { status: 'FINAL' },
        videoSession: null,
        now,
      }).unlocked,
    ).toBe(true);
  });

  it('derives every step accurately across student journey', () => {
    const common = {
      cohort: baseCohort,
      topic: { minWatchSeconds: 180 },
      videoSession: null,
    };

    expect(
      deriveStudentFlowStep({
        ...common,
        consentAcceptedAt: null,
        preTestAttempt: null,
        postTestAttempt: null,
      }).step,
    ).toBe('CONSENT');

    expect(
      deriveStudentFlowStep({
        ...common,
        consentAcceptedAt: new Date(),
        preTestAttempt: { status: 'IN_PROGRESS' },
        postTestAttempt: null,
      }).step,
    ).toBe('PRETEST_IN_PROGRESS');

    expect(
      deriveStudentFlowStep({
        ...common,
        consentAcceptedAt: new Date(),
        preTestAttempt: { status: 'SUBMITTED' },
        postTestAttempt: null,
      }).step,
    ).toBe('PRETEST_SUBMITTED');

    expect(
      deriveStudentFlowStep({
        ...common,
        consentAcceptedAt: new Date(),
        preTestAttempt: { status: 'GRADING' },
        postTestAttempt: null,
      }).step,
    ).toBe('PRETEST_GRADING');

    expect(
      deriveStudentFlowStep({
        ...common,
        consentAcceptedAt: new Date(),
        preTestAttempt: { status: 'GRADED' },
        postTestAttempt: null,
      }).step,
    ).toBe('PRETEST_RESULTS');

    expect(
      deriveStudentFlowStep({
        ...common,
        videoSession: {
          startedAt: new Date(),
          watchedSeconds: 60,
          unlockedPostAt: null,
          manualUnlockedById: null,
        },
        consentAcceptedAt: new Date(),
        preTestAttempt: { status: 'GRADED' },
        postTestAttempt: null,
      }).step,
    ).toBe('REMEDIATION');

    expect(
      deriveStudentFlowStep({
        ...common,
        videoSession: {
          startedAt: new Date(),
          watchedSeconds: 180,
          unlockedPostAt: new Date(),
          manualUnlockedById: null,
        },
        consentAcceptedAt: new Date(),
        preTestAttempt: { status: 'FINAL' },
        postTestAttempt: null,
      }).step,
    ).toBe('POSTTEST_UNLOCKED');

    expect(
      deriveStudentFlowStep({
        ...common,
        consentAcceptedAt: new Date(),
        preTestAttempt: { status: 'FINAL' },
        postTestAttempt: { status: 'IN_PROGRESS' },
      }).step,
    ).toBe('POSTTEST_IN_PROGRESS');

    expect(
      deriveStudentFlowStep({
        ...common,
        consentAcceptedAt: new Date(),
        preTestAttempt: { status: 'FINAL' },
        postTestAttempt: { status: 'GRADING' },
      }).step,
    ).toBe('POSTTEST_GRADING');

    expect(
      deriveStudentFlowStep({
        ...common,
        consentAcceptedAt: new Date(),
        preTestAttempt: { status: 'FINAL' },
        postTestAttempt: { status: 'FINAL' },
      }).step,
    ).toBe('COMPARISON');
  });
});
