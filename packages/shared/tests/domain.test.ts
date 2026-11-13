import { describe, expect, it } from 'vitest';
import {
  CODE_ALPHABET,
  evaluatePublishChecklist,
  extractYoutubeVideoId,
  isRubricSumValid,
  StudentJoinSchema,
} from '../src/index.js';

describe('youtube helper', () => {
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
