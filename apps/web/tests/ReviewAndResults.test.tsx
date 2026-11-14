import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import StudentResultsPage from '../src/pages/student/StudentResultsPage';
import ReviewQueuePage from '../src/pages/teacher/ReviewQueuePage';
import StudentsPage from '../src/pages/teacher/StudentsPage';
import type {
  ReviewQueueResponse,
  StudentAttemptResults,
  TeacherStudentDetailResponse,
  TeacherStudentRow,
} from '../src/types/review';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function buildResultsPayload(
  overrides: Partial<StudentAttemptResults['attempt']> = {},
): StudentAttemptResults {
  return {
    attempt: {
      id: 'att-1',
      examModelId: 'model-1',
      modelNumber: 1,
      title: 'نموذج 1 — التفاضل',
      status: 'GRADED',
      startedAt: '2026-11-13T10:00:00.000Z',
      submittedAt: '2026-11-13T10:25:00.000Z',
      maxScore: 20,
      totalScore: 10,
      percentage: 50,
      scoreHidden: false,
      isProvisional: false,
      scoreSource: 'MIXED',
      ...overrides,
    },
    topic: {
      id: 'topic-1',
      title: 'قواعد الاشتقاق',
      correctnessThreshold: 0.6,
    },
    cohort: {
      id: 'cohort-1',
      group: 'TREATMENT',
      requireVideoBeforePost: true,
      showProvisionalScore: false,
    },
    statusCounts: {
      totalQuestions: 2,
      gradedCount: 2,
      gradingCount: 0,
      needsReviewCount: 0,
    },
    questions: [
      {
        questionId: 'q-mcq',
        answerId: 'ans-mcq',
        orderIndex: 1,
        conceptKey: 'power-rule',
        type: 'MCQ',
        promptLatex: 'What is $\\frac{d}{dx}(x^3)$?',
        points: 5,
        solutionUrl: 'https://example.com/solutions/q-mcq',
        statusChip: 'GRADED',
        score: 0,
        isCorrect: false,
        belowThreshold: true,
        mcqOptions: [
          { id: 'opt-1', label: 'A', textLatex: '$x^2$' },
          { id: 'opt-2', label: 'B', textLatex: '$3x^2$' },
        ],
        selectedOptionId: 'opt-1',
        images: [],
        transcribedLines: [],
        firstErrorStep: null,
        errorType: null,
        errorExplanationAr: null,
        hintAr: null,
        teacherNote: null,
        criteriaBreakdown: [],
        misreadReportedAt: null,
        misreadNote: null,
      },
      {
        questionId: 'q-essay',
        answerId: 'ans-essay',
        orderIndex: 2,
        conceptKey: 'chain-rule',
        type: 'ESSAY',
        promptLatex: 'Differentiate $y = \\ln(2x+1)$.',
        points: 15,
        statusChip: 'GRADED',
        score: 10,
        isCorrect: true,
        belowThreshold: false,
        mcqOptions: [],
        selectedOptionId: null,
        images: [
          {
            id: 'img-1',
            signedUrl: '/api/v1/storage/local?key=test.jpg&exp=999999&sig=abc',
            width: 800,
            height: 600,
          },
        ],
        transcribedLines: [
          {
            lineNumber: 1,
            textLatex: 'u = 2x + 1',
            confidence: 0.96,
            hasUnsure: false,
            illegible: false,
            crossedOut: false,
          },
          {
            lineNumber: 2,
            textLatex: "y' = \\frac{1}{2x+1}",
            confidence: 0.89,
            hasUnsure: false,
            illegible: false,
            crossedOut: false,
          },
        ],
        firstErrorStep: 2,
        errorType: 'rule_misuse',
        errorExplanationAr: 'أخطأت في الخطوة 2: نسيت ضرب البسط في 2.',
        hintAr: 'استخدم قاعدة السلسلة.',
        teacherNote: null,
        criteriaBreakdown: [
          {
            criterionId: 'c1',
            key: 'chain',
            descriptionEn: 'Chain',
            descriptionAr: 'مشتقة الداخل',
            awardedPoints: 5,
            maxPoints: 10,
            commentAr: '',
          },
        ],
        misreadReportedAt: null,
        misreadNote: null,
      },
    ],
  };
}

describe('Phase 5 Student Results, Teacher Review Queue & Roster UI', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders StudentResultsPage with first error highlight, timestamp jump link, and 1-tap misread report', async () => {
    let misreadReported = false;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url =
        typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString();
      if (url.includes('/report-misread')) {
        misreadReported = true;
        return new Response(JSON.stringify({ attemptStatus: 'NEEDS_REVIEW' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const payload = buildResultsPayload(
        misreadReported
          ? { status: 'NEEDS_REVIEW', scoreHidden: true, totalScore: null, percentage: null }
          : {},
      );
      if (misreadReported) {
        payload.questions[1]!.misreadReportedAt = '2026-11-13T10:30:00.000Z';
      }
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    render(
      <QueryClientProvider client={makeQueryClient()}>
        <MemoryRouter initialEntries={['/student/results/att-1']}>
          <Routes>
            <Route path="/student/results/:attemptId" element={<StudentResultsPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText(/10 \/ 20/)).toBeInTheDocument();
    expect(screen.getByTestId('first-error-step-2')).toBeInTheDocument();
    expect(screen.getAllByText(/شاهد الشرح/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('link', { name: 'حل السؤال' })).toHaveAttribute(
      'href',
      'https://example.com/solutions/q-mcq',
    );
    expect(screen.getByText(/أخطأت في الخطوة 2/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /الذكاء الاصطناعي قرأ خطي غلط/ }));
    fireEvent.change(screen.getByPlaceholderText(/اختياري/), {
      target: { value: 'كتبت 2 في البسط' },
    });
    fireEvent.click(screen.getByRole('button', { name: /إرسال للمراجعة/ }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/student/answers/ans-essay/report-misread'),
        expect.objectContaining({ method: 'POST' }),
      );
    });
    expect(await screen.findByText(/تم إرسال البلاغ للمعلم/)).toBeInTheDocument();
  });

  it('renders ReviewQueuePage with zoom/rotate/pin, criterion clamp preview, override submit, and override history', async () => {
    const queueData: ReviewQueueResponse = {
      pendingCount: 1,
      totalCount: 1,
      items: [
        {
          answerId: 'ans-essay',
          attemptId: 'att-1',
          attemptStatus: 'NEEDS_REVIEW',
          submittedAt: '2026-11-13T10:25:00.000Z',
          isPendingReview: true,
          misreadReportedAt: '2026-11-13T10:30:00.000Z',
          misreadNote: 'البسط يحتوي على 2',
          reviewReasons: ['STUDENT_REPORTED_MISREAD'],
          student: { id: 'stu-1', displayName: 'سلمى عادل' },
          cohort: { id: 'coh-1', name: 'تجريبي أ', group: 'TREATMENT' },
          topic: { id: 'top-1', title: 'الاشتقاق' },
          examModel: { id: 'mod-1', modelNumber: 1, title: 'نموذج 1' },
          question: {
            id: 'q-2',
            orderIndex: 2,
            conceptKey: 'chain-rule',
            promptLatex: "Find $y'$",
            points: 15,
            modelAnswer: {
              solutionStepsLatex: ["$y'=2/(2x+1)$"],
              finalAnswerLatex: '\\frac{2}{2x+1}',
              finalAnswerSympy: '2/(2*x+1)',
              commonMistakes: '',
            },
          },
          images: [
            {
              id: 'img-1',
              signedUrl: '/api/v1/storage/local?key=sample.jpg',
              width: 800,
              height: 600,
              pinnedByTeacher: false,
            },
          ],
          latestResult: {
            id: 'gr-1',
            version: 1,
            provider: 'anthropic',
            modelName: 'claude-sonnet-4',
            aiTotal: 10,
            finalAnswerCorrect: false,
            firstErrorStep: 2,
            errorType: 'rule_misuse',
            errorExplanationAr: 'نقص معامل 2',
            hintAr: 'راجع السلسلة',
            confidence: 0.72,
            needsReview: true,
            reviewReasons: ['STUDENT_REPORTED_MISREAD'],
            transcribedLines: [
              {
                lineNumber: 1,
                textLatex: "y'=1/(2x+1)",
                confidence: 0.72,
                hasUnsure: false,
                illegible: false,
                crossedOut: false,
              },
            ],
            createdAt: '2026-11-13T10:26:00.000Z',
          },
          effectiveCriteria: [
            {
              criterionId: 'crit-1',
              key: 'chain',
              descriptionEn: 'Chain',
              descriptionAr: 'قاعدة السلسلة',
              maxPoints: 10,
              aiAwarded: 5,
              effectiveAwarded: 5,
              commentAr: '',
            },
            {
              criterionId: 'crit-2',
              key: 'denom',
              descriptionEn: 'Denom',
              descriptionAr: 'المقام',
              maxPoints: 5,
              aiAwarded: 5,
              effectiveAwarded: 5,
              commentAr: '',
            },
          ],
          effectiveTotal: 10,
          effectiveExplanationAr: 'نقص معامل 2',
          overrideHistory: [
            {
              id: 'ov-old',
              newTotal: 12,
              newExplanationAr: 'مراجعة سابقة',
              note: 'تعديل تجريبي',
              createdAt: '2026-11-13T10:28:00.000Z',
            },
          ],
        },
      ],
    };

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url =
        typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString();
      if (url.includes('/auth/teacher/me')) {
        return new Response(
          JSON.stringify({
            teacher: { id: 't-1', email: 't@ml.local', displayName: 'أ. ندى', role: 'TEACHER' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/topics')) {
        return new Response(JSON.stringify({ topics: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/cohorts')) {
        return new Response(JSON.stringify({ cohorts: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/grading-results/gr-1/override')) {
        return new Response(JSON.stringify({ override: { newTotal: 15 } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/answer-images/img-1/pin')) {
        return new Response(JSON.stringify({ image: { id: 'img-1', pinnedByTeacher: true } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(queueData), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    render(
      <QueryClientProvider client={makeQueryClient()}>
        <MemoryRouter initialEntries={['/teacher/review']}>
          <Routes>
            <Route path="/teacher/review" element={<ReviewQueuePage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('سلمى عادل')).toBeInTheDocument();
    expect(screen.getByText(/البسط يحتوي على 2/)).toBeInTheDocument();
    expect(screen.getByText(/تعديل تجريبي/)).toBeInTheDocument();

    const firstInput = screen.getByLabelText('قاعدة السلسلة');
    fireEvent.change(firstInput, { target: { value: '10' } });
    expect(screen.getByText(/المجموع المحسوب: 15 \/ 15/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /تثبيت الصورة/ }));
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/answer-images/img-1/pin'),
        expect.objectContaining({ method: 'PATCH' }),
      );
    });

    fireEvent.click(screen.getByRole('button', { name: /حفظ واعتماد الدرجة/ }));
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/grading-results/gr-1/override'),
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  it('renders StudentsPage roster table and student detail timeline', async () => {
    const roster: TeacherStudentRow[] = [
      {
        id: 'stu-1',
        displayName: 'كريم أشرف',
        resumeCode: 'KA45PQ',
        consentAcceptedAt: '2026-11-13T09:00:00.000Z',
        createdAt: '2026-11-13T09:00:00.000Z',
        cohort: { id: 'coh-1', name: 'تجريبي', group: 'TREATMENT', joinCode: 'AB12CD' },
        topic: { id: 'top-1', title: 'الاشتقاق' },
        currentStep: 'PRETEST_RESULTS',
        pendingReviewCount: 0,
        scoreGain: 25,
        preTest: {
          attemptId: 'att-1',
          status: 'FINAL',
          totalScore: 10,
          maxScore: 20,
          percentage: 50,
          submittedAt: '2026-11-13T09:30:00.000Z',
        },
        postTest: {
          attemptId: 'att-2',
          status: 'FINAL',
          totalScore: 15,
          maxScore: 20,
          percentage: 75,
          submittedAt: '2026-11-13T10:30:00.000Z',
        },
        videoProgress: {
          watchedSeconds: 320,
          visitedCount: 2,
          unlockedPostAt: '2026-11-13T10:00:00.000Z',
          manualUnlocked: false,
        },
      },
    ];

    const detail: TeacherStudentDetailResponse = {
      student: {
        id: 'stu-1',
        displayName: 'كريم أشرف',
        resumeCode: 'KA45PQ',
        consentAcceptedAt: '2026-11-13T09:00:00.000Z',
        createdAt: '2026-11-13T09:00:00.000Z',
      },
      cohort: { id: 'coh-1', name: 'تجريبي', group: 'TREATMENT', joinCode: 'AB12CD' },
      topic: { id: 'top-1', title: 'الاشتقاق' },
      videoProgress: {
        watchedSeconds: 320,
        lastPosition: 320,
        unlockedPostAt: '2026-11-13T10:00:00.000Z',
        manualUnlocked: false,
      },
      attempts: [
        {
          id: 'att-1',
          modelNumber: 1,
          title: 'نموذج 1',
          status: 'FINAL',
          startedAt: '2026-11-13T09:00:00.000Z',
          submittedAt: '2026-11-13T09:30:00.000Z',
          totalScore: 10,
          maxScore: 20,
          percentage: 50,
          scoreSource: 'MIXED',
          answers: [],
        },
      ],
    };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url =
        typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString();
      if (url.includes('/auth/teacher/me')) {
        return new Response(
          JSON.stringify({
            teacher: { id: 't-1', email: 't@ml.local', displayName: 'أ. ندى', role: 'TEACHER' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/cohorts')) {
        return new Response(JSON.stringify({ cohorts: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/students/stu-1')) {
        return new Response(JSON.stringify(detail), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ students: roster }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    render(
      <QueryClientProvider client={makeQueryClient()}>
        <MemoryRouter initialEntries={['/teacher/students']}>
          <Routes>
            <Route path="/teacher/students" element={<StudentsPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('كريم أشرف')).toBeInTheDocument();
    expect(screen.getByText('+25%')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /التفاصيل/ }));
    expect(await screen.findByTestId('student-detail-panel')).toBeInTheDocument();
    expect(screen.getByText(/نموذج 1 \(M1\)/)).toBeInTheDocument();
  });
});
