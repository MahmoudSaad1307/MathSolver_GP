import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CODE_ALPHABET,
  evaluatePublishChecklist,
  extractYoutubeVideoId,
  isRubricSumValid,
  isValidHttpUrl,
  normalizeSolutionUrl,
  OptionalSolutionUrlSchema,
  SeedTopicBundleSchema,
  StudentJoinSchema,
} from '../src/index.js';

describe('youtube and solution URL helpers', () => {
  it('extracts video ids from supported youtube URLs', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(
      'dQw4w9WgXcQ',
    );
    expect(extractYoutubeVideoId('https://youtu.be/dQw4w9WgXcQ?t=42')).toBe('dQw4w9WgXcQ');
    expect(extractYoutubeVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(extractYoutubeVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('rejects placeholder or invalid youtube URLs', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/watch?v=REPLACE_ME')).toBeNull();
    expect(extractYoutubeVideoId('javascript:alert(1)')).toBeNull();
    expect(extractYoutubeVideoId('not a url')).toBeNull();
  });

  it('validates and normalizes optional question solution URLs', () => {
    expect(isValidHttpUrl('https://example.com/solutions/q1.pdf')).toBe(true);
    expect(isValidHttpUrl('http://localhost:3000/sol')).toBe(true);
    expect(isValidHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isValidHttpUrl('data:text/html,<h1>hi</h1>')).toBe(false);
    expect(isValidHttpUrl('not-a-url')).toBe(false);

    expect(normalizeSolutionUrl('  https://example.com/sol  ')).toBe('https://example.com/sol');
    expect(normalizeSolutionUrl('   ')).toBeNull();
    expect(normalizeSolutionUrl(null)).toBeNull();

    expect(OptionalSolutionUrlSchema.parse('  https://youtu.be/dQw4w9WgXcQ  ')).toBe(
      'https://youtu.be/dQw4w9WgXcQ',
    );
    expect(OptionalSolutionUrlSchema.parse('')).toBeNull();
    expect(OptionalSolutionUrlSchema.parse(null)).toBeNull();
    expect(OptionalSolutionUrlSchema.parse(undefined)).toBeUndefined();
    expect(OptionalSolutionUrlSchema.safeParse('javascript:alert(1)').success).toBe(false);
  });
});

describe('rubric and publish checklist validation', () => {
  it('validates rubric criterion sum against question points', () => {
    expect(isRubricSumValid(10, [{ maxPoints: 3 }, { maxPoints: 7 }])).toBe(true);
    expect(isRubricSumValid(10, [{ maxPoints: 3 }, { maxPoints: 6 }])).toBe(false);
    expect(isRubricSumValid(10, [])).toBe(false);
  });

  it('blocks publishing when placeholders, zero timestamps, or unconfirmed questions remain', () => {
    const res = evaluatePublishChecklist(
      { videoUrl: 'https://www.youtube.com/watch?v=REPLACE_ME' },
      {
        modelNumber: 1,
        questions: [
          {
            orderIndex: 1,
            conceptKey: 'k1',
            type: 'MCQ',
            points: 5,
            videoTimestampSeconds: 0,
            needsTeacherConfirmation: true,
            mcqOptions: [
              { label: 'A', textLatex: '1', isCorrect: true },
              { label: 'B', textLatex: '2', isCorrect: false },
              { label: 'C', textLatex: '3', isCorrect: false },
              { label: 'D', textLatex: '4', isCorrect: false },
            ],
          },
        ],
      },
      {
        modelNumber: 2,
        questions: [
          {
            orderIndex: 1,
            conceptKey: 'k1',
            type: 'MCQ',
            points: 5,
            videoTimestampSeconds: 30,
            needsTeacherConfirmation: false,
            mcqOptions: [
              { label: 'A', textLatex: '1', isCorrect: true },
              { label: 'B', textLatex: '2', isCorrect: false },
              { label: 'C', textLatex: '3', isCorrect: false },
              { label: 'D', textLatex: '4', isCorrect: false },
            ],
          },
        ],
      },
    );
    expect(res.ready).toBe(false);
    expect(res.issues.map((i) => i.code)).toEqual(
      expect.arrayContaining([
        'INVALID_VIDEO_URL',
        'MISSING_TIMESTAMP',
        'NEEDS_TEACHER_CONFIRMATION',
      ]),
    );
  });
});

describe('code alphabet and join validation', () => {
  it('uses an unambiguous 31-character alphabet', () => {
    expect(CODE_ALPHABET.length).toBe(31);
    for (const ambiguous of ['0', 'O', '1', 'I', 'L']) {
      expect(CODE_ALPHABET.includes(ambiguous)).toBe(false);
    }
  });

  it('accepts valid 6-character join codes and rejects ambiguous characters', () => {
    expect(
      StudentJoinSchema.safeParse({ joinCode: 'ab23cd', displayName: 'علي محمد' }).success,
    ).toBe(true);
    expect(
      StudentJoinSchema.safeParse({ joinCode: 'AB01CD', displayName: 'علي محمد' }).success,
    ).toBe(false);
  });
});

describe('seed exam bundle', () => {
  it('validates seed/exams.seed.json with matching rubric sums, twin concepts, and Q3 review flag', () => {
    const raw = readFileSync(new URL('../../../seed/exams.seed.json', import.meta.url), 'utf8');
    const parsed = SeedTopicBundleSchema.parse(JSON.parse(raw));

    expect(parsed.models).toHaveLength(2);
    const [m1, m2] = parsed.models;
    expect(m1.modelNumber).toBe(1);
    expect(m2.modelNumber).toBe(2);
    expect(m1.questions).toHaveLength(10);
    expect(m2.questions).toHaveLength(10);

    for (const model of parsed.models) {
      const total = model.questions.reduce((acc, q) => acc + q.points, 0);
      expect(total).toBe(100);
      for (const q of model.questions) {
        if (q.type === 'ESSAY') {
          expect(q.modelAnswer?.solutionStepsLatex.length).toBeGreaterThan(0);
          expect(isRubricSumValid(q.points, q.rubricCriteria ?? [])).toBe(true);
        } else {
          expect(q.mcqOptions).toHaveLength(4);
          expect(q.mcqOptions?.filter((o) => o.isCorrect)).toHaveLength(1);
        }
      }
    }

    expect(m1.questions.map((q) => q.conceptKey)).toEqual(m2.questions.map((q) => q.conceptKey));
    expect(m1.questions[2]?.needsTeacherConfirmation).toBe(true);
    expect(m2.questions[2]?.needsTeacherConfirmation).toBe(true);

    // Unfilled seed has placeholder video and 0 timestamps so checklist blocks publishing
    const checklist = evaluatePublishChecklist(parsed.topic, m1, m2);
    expect(checklist.ready).toBe(false);
    expect(checklist.issues.some((i) => i.code === 'INVALID_VIDEO_URL')).toBe(true);
    expect(checklist.issues.some((i) => i.code === 'NEEDS_TEACHER_CONFIRMATION')).toBe(true);
  });
});
