import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TopicBuilderPage from '../src/pages/teacher/TopicBuilderPage';
import TopicsPage from '../src/pages/teacher/TopicsPage';
import type { TopicDetail } from '../src/types/content';

function buildSampleTopic(overrides: Partial<TopicDetail> = {}): TopicDetail {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    title: 'Derivatives of Exponential & Log Functions',
    description: 'Twin pre/post exam',
    correctnessThreshold: 0.6,
    hasPlaceholders: true,
    missingVideoCount: 1,
    unconfirmedCount: 1,
    publishChecklist: {
      ready: false,
      issues: [
        {
          code: 'NEEDS_TEACHER_CONFIRMATION',
          modelNumber: 1,
          questionOrderIndex: 3,
          message_ar: 'النموذج 1 - السؤال 3: يحتاج لمراجعة وتأكيد المدرس قبل النشر.',
          message_en: 'Model 1 Q3: requires teacher confirmation before publishing.',
        },
      ],
    },
    examModels: [
      {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        topicId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        modelNumber: 1,
        title: 'Model 1',
        durationMinutes: 60,
        totalPoints: 15,
        status: 'DRAFT',
        pairedWithId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        questions: [
          {
            id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
            examModelId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            orderIndex: 3,
            conceptKey: 'exp-tangent',
            type: 'ESSAY',
            promptLatex: 'Find tangent slope of $y = e^{2x}$ at $x=0$.',
            points: 15,
            solutionUrl: 'https://example.com/solutions/m1-q3',
            needsTeacherConfirmation: true,
            teacherConfirmedAt: null,
            twinQuestionId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
            mcqOptions: [],
            modelAnswer: {
              id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
              solutionStepsLatex: ['$y^{\\prime}(0) = 2$'],
              finalAnswerLatex: '$2$',
              finalAnswerSympy: '2',
              commonMistakes: '',
              rubricVersion: 1,
            },
            rubricCriteria: [
              {
                id: '11111111-2222-4333-8444-555555555555',
                orderIndex: 1,
                key: 'slope',
                descriptionEn: 'Slope calculation',
                descriptionAr: 'حساب الميل',
                maxPoints: 15,
              },
            ],
          },
        ],
      },
      {
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        topicId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        modelNumber: 2,
        title: 'Model 2',
        durationMinutes: 60,
        totalPoints: 15,
        status: 'DRAFT',
        pairedWithId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        questions: [
          {
            id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
            examModelId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            orderIndex: 3,
            conceptKey: 'exp-tangent',
            type: 'MCQ',
            promptLatex: 'Slope of $e^{3x}$ at $x=0$?',
            points: 15,
            solutionUrl: 'https://example.com/solutions/m2-q3',
            needsTeacherConfirmation: false,
            teacherConfirmedAt: '2026-11-13T00:00:00.000Z',
            twinQuestionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
            mcqOptions: [
              { id: '1', label: 'A', textLatex: '$1$', isCorrect: false },
              { id: '2', label: 'B', textLatex: '$3$', isCorrect: true },
              { id: '3', label: 'C', textLatex: '$e$', isCorrect: false },
              { id: '4', label: 'D', textLatex: '$0$', isCorrect: false },
            ],
            modelAnswer: null,
            rubricCriteria: [],
          },
        ],
      },
    ],
    ...overrides,
  };
}

function renderWithQuery(ui: React.ReactElement, initialEntries: string[]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={initialEntries}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Teacher Topics & Builder pages', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders TopicsPage with placeholder badge and new topic toggle', async () => {
    const sample = buildSampleTopic();
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/auth/teacher/me')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              teacher: {
                id: '11111111-1111-4111-8111-111111111111',
                email: 't@mathlens.local',
                displayName: 'أ. أحمد',
                role: 'TEACHER',
              },
            }),
            { status: 200 },
          ),
        );
      }
      if (url.endsWith('/topics')) {
        return Promise.resolve(new Response(JSON.stringify({ topics: [sample] }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({}), { status: 404 }));
    });

    renderWithQuery(<TopicsPage />, ['/teacher/topics']);

    expect(
      await screen.findByText('Derivatives of Exponential & Log Functions'),
    ).toBeInTheDocument();
    expect(screen.getByText('يحتاج استكمال البيانات')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'موضوع جديد' }));
    expect(screen.getByRole('button', { name: 'إنشاء الموضوع والنموذجين' })).toBeInTheDocument();
  });

  it('renders TopicBuilderPage side-by-side models, warning banner, confirm button, and question modal', async () => {
    const sample = buildSampleTopic();
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/auth/teacher/me')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              teacher: {
                id: '11111111-1111-4111-8111-111111111111',
                email: 't@mathlens.local',
                displayName: 'أ. أحمد',
                role: 'TEACHER',
              },
            }),
            { status: 200 },
          ),
        );
      }
      if (url.includes(`/topics/${sample.id}`)) {
        return Promise.resolve(new Response(JSON.stringify({ topic: sample }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({}), { status: 404 }));
    });

    renderWithQuery(
      <Routes>
        <Route path="/teacher/topics/:topicId" element={<TopicBuilderPage />} />
      </Routes>,
      [`/teacher/topics/${sample.id}`],
    );

    expect(await screen.findByText('النموذج 1 (القبلي)')).toBeInTheDocument();
    expect(screen.getByText('النموذج 2 (البعدي)')).toBeInTheDocument();
    expect(screen.getByText('تأكيد المعلم لهذا السؤال')).toBeInTheDocument();
    const solutionLinks = screen.getAllByRole('link', { name: 'رابط الحل' });
    expect(solutionLinks).toHaveLength(2);
    expect(solutionLinks[0]).toHaveAttribute('href', 'https://example.com/solutions/m1-q3');
    expect(solutionLinks[1]).toHaveAttribute('href', 'https://example.com/solutions/m2-q3');

    // Opening Add Question modal renders live KaTeX preview, solution URL input & rubric editor
    fireEvent.click(screen.getAllByRole('button', { name: 'إضافة سؤال' })[0]!);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('ترتيب السؤال')).toBeInTheDocument();
    const solutionInput = screen.getByLabelText('رابط فيديو شرح السؤال');
    expect(solutionInput).toBeInTheDocument();
    fireEvent.change(solutionInput, { target: { value: 'https://example.com/new-solution' } });
    expect(screen.getByRole('link', { name: 'فتح الرابط' })).toHaveAttribute(
      'href',
      'https://example.com/new-solution',
    );
  });
});
