import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LandingPage from '../src/pages/LandingPage';
import StudentConsentPage from '../src/pages/student/StudentConsentPage';
import StudentExamPage from '../src/pages/student/StudentExamPage';
import StudentPortalPage from '../src/pages/student/StudentPortalPage';
import CohortsPage from '../src/pages/teacher/CohortsPage';
import { applyDocumentDirection } from '../src/store/uiStore';
import type { StudentExamAttempt } from '../src/types/student';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function buildExamAttempt(secondsRemaining = 240): StudentExamAttempt {
  const serverNow = Date.parse('2026-11-13T10:00:00.000Z');
  const deadlineAt = new Date(serverNow + secondsRemaining * 1000).toISOString();
  return {
    id: '11111111-1111-4111-8111-111111111111',
    examModelId: '22222222-2222-4222-8222-222222222222',
    modelNumber: 1,
    title: 'Model 1',
    durationMinutes: 60,
    status: 'IN_PROGRESS',
    startedAt: '2026-11-13T09:04:00.000Z',
    submittedAt: null,
    deadlineAt,
    serverNow: new Date(serverNow).toISOString(),
    maxScore: 20,
    questions: [
      {
        id: '33333333-3333-4333-8333-333333333333',
        answerId: '44444444-4444-4444-8444-444444444444',
        orderIndex: 1,
        type: 'MCQ',
        promptLatex: 'What is $\\frac{d}{dx}(e^{2x})$?',
        points: 5,
        selectedOptionId: null,
        images: [],
        mcqOptions: [
          { id: '55555555-5555-4555-8555-555555555551', label: 'A', textLatex: '$e^{2x}$' },
          { id: '55555555-5555-4555-8555-555555555552', label: 'B', textLatex: '$2e^{2x}$' },
          { id: '55555555-5555-4555-8555-555555555553', label: 'C', textLatex: '$2e^x$' },
          { id: '55555555-5555-4555-8555-555555555554', label: 'D', textLatex: '$e^x$' },
        ],
      },
      {
        id: '66666666-6666-4666-8666-666666666666',
        answerId: '77777777-7777-4777-8777-777777777777',
        orderIndex: 2,
        type: 'ESSAY',
        promptLatex: 'Differentiate $y = \\ln(3x+1)$.',
        points: 15,
        selectedOptionId: null,
        images: [],
        mcqOptions: [],
      },
    ],
  };
}

describe('Phase 3 Student Exam & Cohorts UI', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('shows printable resumeCode card after joining on LandingPage', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          student: {
            id: '11111111-1111-4111-8111-111111111111',
            displayName: 'عمر حسن',
            resumeCode: 'R7K3MP',
            cohortId: '22222222-2222-4222-8222-222222222222',
            cohortName: 'Group A',
            group: 'TREATMENT',
          },
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    render(
      <QueryClientProvider client={makeQueryClient()}>
        <MemoryRouter initialEntries={['/']}>
          <LandingPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.change(screen.getByLabelText(/كود المجموعة/), { target: { value: 'A7K9M2' } });
    fireEvent.change(screen.getByLabelText(/الاسم/), { target: { value: 'عمر حسن' } });
    fireEvent.click(screen.getByRole('button', { name: /انضم للمجموعة/ }));

    expect(await screen.findByText('R7K3MP')).toBeInTheDocument();
    expect(screen.getByText(/احتفظ بهذا الكود للرجوع/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/student/join'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('requires privacy consent checkbox before proceeding on StudentConsentPage', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/student/me/state')) {
        return new Response(
          JSON.stringify({
            step: 'CONSENT',
            student: {
              id: '11111111-1111-4111-8111-111111111111',
              displayName: 'سارة علي',
              resumeCode: 'K2M4NP',
              consentAcceptedAt: null,
              cohortId: '22222222-2222-4222-8222-222222222222',
              cohortName: 'Group A',
              group: 'TREATMENT',
            },
            topic: {
              id: '33333333-3333-4333-8333-333333333333',
              title: 'Log Derivatives',
              videoId: 'dQw4w9WgXcQ',
              minWatchSeconds: 300,
            },
            preTestAttempt: null,
            postTestAttempt: null,
            videoSession: null,
            postTestLockReason: null,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ step: 'PRETEST_IN_PROGRESS' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    render(
      <QueryClientProvider client={makeQueryClient()}>
        <MemoryRouter initialEntries={['/student/consent']}>
          <Routes>
            <Route path="/student/consent" element={<StudentConsentPage />} />
            <Route path="/student/exam/1" element={<div>Exam Loaded</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const submitBtn = await screen.findByRole('button', { name: /أوافق — ابدأ الاختبار/ });
    expect(submitBtn).toBeDisabled();

    fireEvent.click(screen.getByRole('checkbox'));
    expect(submitBtn).not.toBeDisabled();

    fireEvent.click(submitBtn);
    await waitFor(() => {
      expect(screen.getByText('Exam Loaded')).toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/student/consent'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('supports mobile RTL StudentExamPage: synced timer warning, offline MCQ queue fallback, essay tips, and submit confirm', async () => {
    window.innerWidth = 390;
    applyDocumentDirection('ar');
    expect(document.documentElement.dir).toBe('rtl');

    const attempt = buildExamAttempt(240);
    let failAutosaveOnce = true;

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/student/attempts') && init?.method === 'POST') {
        return new Response(JSON.stringify({ attempt }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/answers/')) {
        if (failAutosaveOnce) {
          failAutosaveOnce = false;
          throw new TypeError('Failed to fetch');
        }
        return new Response(
          JSON.stringify({
            answerId: '44444444-4444-4444-8444-444444444444',
            questionId: attempt.questions[0]?.id,
            selectedOptionId: '55555555-5555-4555-8555-555555555552',
            savedAt: new Date().toISOString(),
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.endsWith('/submit')) {
        return new Response(
          JSON.stringify({
            attemptId: attempt.id,
            status: 'SUBMITTED',
            totalScore: 5,
            maxScore: 20,
            percentage: 25,
            submittedAt: new Date().toISOString(),
            pendingEssayCount: 1,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 404 });
    });

    render(
      <QueryClientProvider client={makeQueryClient()}>
        <MemoryRouter initialEntries={['/student/exam/1']}>
          <Routes>
            <Route path="/student/exam/:modelNumber" element={<StudentExamPage />} />
            <Route path="/student" element={<div>Student Portal</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // Timer 5-minute warning banner visible
    expect(await screen.findByText(/متبقٍ أقل من 5 دقائق/)).toBeInTheDocument();

    // Select MCQ option B while network fails -> triggers offline saved alert
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(4);
    fireEvent.click(radios[1]!);

    expect(await screen.findByText(/انقطع الاتصال: تم حفظ اختياراتك محلياً/)).toBeInTheDocument();

    // Switch to Q2 (ESSAY) and verify photo tips appear
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    expect(await screen.findByText(/نصائح لتصوير واضح/)).toBeInTheDocument();

    // Open confirm submit modal and verify unanswered essay #2 is listed
    fireEvent.click(screen.getAllByRole('button', { name: /تسليم الاختبار/ })[0]!);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '#2' })).toBeInTheDocument();

    // Confirm final submit
    fireEvent.click(screen.getByRole('button', { name: /تأكيد التسليم النهائي/ }));
    await waitFor(() => {
      expect(screen.getByText('Student Portal')).toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/student/attempts/${attempt.id}/submit`),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('renders join codes and runs randomized roster split on CohortsPage', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/auth/teacher/me')) {
        return new Response(
          JSON.stringify({
            teacher: {
              id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              email: 't@example.com',
              displayName: 'أ. محمد',
              role: 'TEACHER',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.endsWith('/topics')) {
        return new Response(
          JSON.stringify({
            topics: [{ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', title: 'Derivatives' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.endsWith('/cohorts')) {
        return new Response(
          JSON.stringify({
            cohorts: [
              {
                id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
                topicId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
                name: 'Class 3B',
                joinCode: 'ABCD23',
                group: 'TREATMENT',
                requireVideoBeforePost: true,
                requireWrongSegmentVisits: false,
                showProvisionalScore: false,
                postTestOpensAt: null,
                status: 'OPEN',
                topic: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', title: 'Derivatives' },
                _count: { students: 12 },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.endsWith('/cohorts/randomize-split')) {
        return new Response(
          JSON.stringify({
            seedUsed: 42,
            treatment: ['علي', 'منة'],
            control: ['زياد', 'نور'],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 404 });
    });

    render(
      <QueryClientProvider client={makeQueryClient()}>
        <MemoryRouter initialEntries={['/teacher/cohorts']}>
          <CohortsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('Class 3B')).toBeInTheDocument();
    expect(screen.getByText('ABCD23')).toBeInTheDocument();
    expect(screen.getByText('12 طالب')).toBeInTheDocument();

    const textarea = screen.getByPlaceholderText(/أحمد محمد/);
    fireEvent.change(textarea, { target: { value: 'علي\nمنة\nزياد\nنور' } });
    fireEvent.change(screen.getByLabelText(/بذرة العشوائية/), { target: { value: '42' } });
    fireEvent.click(screen.getByRole('button', { name: /تقسيم عشوائي الآن/ }));

    expect(await screen.findByText('زياد')).toBeInTheDocument();
    expect(screen.getByText('علي')).toBeInTheDocument();
  });

  it('supports student account login, entering a quiz code, and displaying saved exams on StudentPortalPage', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/auth/student/login') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({
            account: {
              id: 'aaaaaaaa-1111-4111-8111-111111111111',
              email: 'sara@student.mathlens.local',
              displayName: 'سارة الغامدي',
              consentAcceptedAt: '2026-11-13T09:00:00.000Z',
              role: 'STUDENT',
            },
            activeEnrollmentId: 'bbbbbbbb-1111-4111-8111-111111111111',
            enrollments: [
              {
                studentId: 'bbbbbbbb-1111-4111-8111-111111111111',
                cohortId: 'cccccccc-1111-4111-8111-111111111111',
                cohortName: 'الشعبة أ — المجموعة التجريبية',
                joinCode: 'EXP234',
                group: 'TREATMENT',
                requireVideoBeforePost: true,
                topicId: 'dddddddd-1111-4111-8111-111111111111',
                topicTitle: 'تفاضل الدوال الأسية واللوغاريتمية',
                step: 'PRETEST_IN_PROGRESS',
                enrolledAt: '2026-11-13T09:00:00.000Z',
                preTestAttempt: {
                  id: 'eeeeeeee-1111-4111-8111-111111111111',
                  examModelId: 'ffffffff-1111-4111-8111-111111111111',
                  status: 'GRADED',
                  totalScore: 85,
                  maxScore: 100,
                  submittedAt: '2026-11-13T09:40:00.000Z',
                  deadlineAt: '2026-11-13T10:00:00.000Z',
                },
                postTestAttempt: null,
                videoProgress: {
                  watchedSeconds: 120,
                  visitedCount: 1,
                  requiredCount: 2,
                  unlockedPostAt: null,
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.endsWith('/auth/student/me')) {
        return new Response(
          JSON.stringify({
            account: {
              id: 'aaaaaaaa-1111-4111-8111-111111111111',
              email: 'sara@student.mathlens.local',
              displayName: 'سارة الغامدي',
              consentAcceptedAt: '2026-11-13T09:00:00.000Z',
              role: 'STUDENT',
            },
            activeEnrollmentId: 'bbbbbbbb-1111-4111-8111-111111111111',
            enrollments: [
              {
                studentId: 'bbbbbbbb-1111-4111-8111-111111111111',
                cohortId: 'cccccccc-1111-4111-8111-111111111111',
                cohortName: 'الشعبة أ — المجموعة التجريبية',
                joinCode: 'EXP234',
                group: 'TREATMENT',
                requireVideoBeforePost: true,
                topicId: 'dddddddd-1111-4111-8111-111111111111',
                topicTitle: 'تفاضل الدوال الأسية واللوغاريتمية',
                step: 'PRETEST_IN_PROGRESS',
                enrolledAt: '2026-11-13T09:00:00.000Z',
                preTestAttempt: {
                  id: 'eeeeeeee-1111-4111-8111-111111111111',
                  examModelId: 'ffffffff-1111-4111-8111-111111111111',
                  status: 'GRADED',
                  totalScore: 85,
                  maxScore: 100,
                  submittedAt: '2026-11-13T09:40:00.000Z',
                  deadlineAt: '2026-11-13T10:00:00.000Z',
                },
                postTestAttempt: null,
                videoProgress: {
                  watchedSeconds: 120,
                  visitedCount: 1,
                  requiredCount: 2,
                  unlockedPostAt: null,
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.endsWith('/student/me/state')) {
        return new Response(
          JSON.stringify({
            step: 'PRETEST_IN_PROGRESS',
            student: {
              id: 'bbbbbbbb-1111-4111-8111-111111111111',
              accountId: 'aaaaaaaa-1111-4111-8111-111111111111',
              email: 'sara@student.mathlens.local',
              displayName: 'سارة الغامدي',
              cohortId: 'cccccccc-1111-4111-8111-111111111111',
              cohortName: 'الشعبة أ — المجموعة التجريبية',
              group: 'TREATMENT',
              requireVideoBeforePost: true,
              consentAcceptedAt: '2026-11-13T09:00:00.000Z',
            },
            topic: {
              id: 'dddddddd-1111-4111-8111-111111111111',
              title: 'تفاضل الدوال الأسية واللوغاريتمية',
            },
            preTestAttempt: null,
            postTestAttempt: null,
            postTestLockReason: null,
            videoProgress: {
              watchedSeconds: 0,
              visitedCount: 0,
              requiredCount: 0,
              unlockedPostAt: null,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.endsWith('/student/join-quiz') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({
            student: {
              id: 'bbbbbbbb-1111-4111-8111-111111111111',
              accountId: 'aaaaaaaa-1111-4111-8111-111111111111',
              email: 'sara@student.mathlens.local',
              displayName: 'سارة الغامدي',
              resumeCode: 'SAR235',
              cohortId: 'cccccccc-1111-4111-8111-111111111111',
              cohortName: 'الشعبة أ — المجموعة التجريبية',
              group: 'TREATMENT',
            },
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 404 });
    });

    render(
      <QueryClientProvider client={makeQueryClient()}>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/student" element={<StudentPortalPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.change(screen.getByLabelText(/البريد الإلكتروني/), {
      target: { value: 'sara@student.mathlens.local' },
    });
    fireEvent.change(screen.getByLabelText(/كلمة المرور/), {
      target: { value: 'StudentPass123!' },
    });
    fireEvent.click(screen.getByRole('button', { name: /دخول إلى الحساب/ }));

    expect(await screen.findByText(/إدخال كود الاختبار/)).toBeInTheDocument();
    expect(screen.getByText(/اختباراتي وسجل التقدم المحفوظ في الحساب/)).toBeInTheDocument();
    expect(screen.getByText('85 / 100 (GRADED)')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/EXP234/), {
      target: { value: 'EXP234' },
    });
    fireEvent.click(screen.getByRole('button', { name: /فتح الاختبار/ }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/student/join-quiz'),
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });
});
