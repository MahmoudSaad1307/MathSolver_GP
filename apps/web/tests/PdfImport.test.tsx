import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PdfImportUploadModal } from '@/components/teacher/PdfImportUploadModal';
import i18n from '@/i18n';
import PdfImportPreviewPage from '@/pages/teacher/PdfImportPreviewPage';
import { useUiStore } from '@/store/uiStore';
import type { PdfImportJobResponse } from '@/types/content';

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function makeReadyJob(): PdfImportJobResponse {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    topicId: null,
    appliedTopicId: null,
    status: 'READY_FOR_REVIEW',
    currentStage: 'READY_FOR_REVIEW',
    progressPct: 100,
    hasPrePdf: true,
    hasPostPdf: true,
    topicMeta: { title: 'Imported Unit', description: '', correctnessThreshold: 0.6 },
    errorCode: null,
    errorMessage: null,
    createdAt: '2026-11-14T10:00:00.000Z',
    updatedAt: '2026-11-14T10:00:10.000Z',
    expiresAt: '2026-11-21T10:00:00.000Z',
    preview: {
      models: [
        {
          modelNumber: 1,
          title: 'Pre Exam',
          durationMinutes: 60,
          pageCount: 2,
          pages: [
            {
              pageNumber: 1,
              role: 'QUESTIONS',
              hasTextLayer: true,
              isBlank: false,
              imageUrl: '/api/v1/pdf-imports/11111111-1111-4111-8111-111111111111/pages/1/1',
            },
            {
              pageNumber: 2,
              role: 'MODEL_ANSWERS',
              hasTextLayer: true,
              isBlank: false,
              imageUrl: '/api/v1/pdf-imports/11111111-1111-4111-8111-111111111111/pages/1/2',
            },
          ],
          questionsFoundCount: 2,
          answersFoundCount: 2,
          matchedCount: 2,
          unmatchedQuestionNumbers: [],
          unmatchedAnswerNumbers: [],
          reportWarnings: [],
          questions: [
            {
              tempId: 'q1',
              orderIndex: 1,
              conceptKey: 'linear-eq',
              type: 'MCQ',
              promptLatex: 'Solve $2x = 8$',
              points: 2,
              solutionUrl: null,
              needsTeacherConfirmation: false,
              mcqOptions: [
                { label: 'A', textLatex: '$2$', isCorrect: false },
                { label: 'B', textLatex: '$4$', isCorrect: true },
                { label: 'C', textLatex: '$6$', isCorrect: false },
                { label: 'D', textLatex: '$8$', isCorrect: false },
              ],
              modelAnswer: null,
              ocrConfidence: 0.96,
              dualOcrAgreed: true,
              sympyStatus: 'VERIFIED',
              sympyDetail: 'Consistent',
              sourceQuestionPages: [1],
              sourceAnswerPages: [2],
              warnings: [],
              verifiedByTeacher: true,
            },
            {
              tempId: 'q2',
              orderIndex: 2,
              conceptKey: 'deriv-x2',
              type: 'ESSAY',
              promptLatex: 'Differentiate $x^2$',
              points: 5,
              solutionUrl: null,
              needsTeacherConfirmation: true,
              modelAnswer: {
                solutionStepsLatex: ['$2x$'],
                finalAnswerLatex: '2x',
                finalAnswerSympy: '2*x',
                commonMistakes: '',
              },
              rubricCriteria: [
                {
                  orderIndex: 1,
                  key: 'method',
                  descriptionEn: 'Rule',
                  descriptionAr: 'القاعدة',
                  maxPoints: 5,
                },
              ],
              ocrConfidence: 0.7,
              dualOcrAgreed: true,
              sympyStatus: 'MISMATCH',
              sympyDetail: 'Mismatch on last step',
              sourceQuestionPages: [1],
              sourceAnswerPages: [2],
              warnings: [
                {
                  code: 'ANSWER_STEP_MISMATCH',
                  severity: 'warning',
                  messageEn: 'Final answer differs from last solution step.',
                  messageAr: 'الإجابة النهائية تختلف عن آخر خطوة في الحل.',
                },
              ],
              verifiedByTeacher: false,
            },
          ],
        },
      ],
      twinSummary: {
        matchedConceptKeys: ['linear-eq'],
        onlyInModel1: ['deriv-x2'],
        onlyInModel2: [],
      },
      telemetry: {
        provider: 'fake',
        secondaryProvider: null,
        totalInputTokens: 300,
        totalOutputTokens: 200,
        totalCostUsd: 0.002,
        latencyMs: 35,
      },
    },
  };
}

describe('PDF import upload & teacher preview UI', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    useUiStore.getState().setLocale('en');
    vi.restoreAllMocks();
  });

  it('validates and uploads Pre-Model PDF via FormData in PdfImportUploadModal', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ job: makeReadyJob() }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const onCreated = vi.fn();
    render(<PdfImportUploadModal onClose={vi.fn()} onJobCreated={onCreated} />);

    // Submitting without files displays error
    fireEvent.click(screen.getByRole('button', { name: /Start OCR & AI Extraction/i }));
    expect(screen.getByText(/Please select at least one PDF file/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/New Topic Title/i), {
      target: { value: 'Derivatives Unit' },
    });
    const fileInput = screen.getByLabelText(/Model 1 \(Pre-Test\) PDF/i);
    const pdfFile = new File(['%PDF-1.4\n'], 'pre.pdf', { type: 'application/pdf' });
    fireEvent.change(fileInput, { target: { files: [pdfFile] } });

    fireEvent.click(screen.getByRole('button', { name: /Start OCR & AI Extraction/i }));

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const callArgs = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(callArgs[0]).toBe('/api/v1/pdf-imports');
    expect(callArgs[1].body).toBeInstanceOf(FormData);
  });

  it('displays KaTeX questions alongside rendered PDF image and gates apply until flagged item is verified', async () => {
    const job = makeReadyJob();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith('/auth/teacher/me')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              teacher: {
                id: 't1',
                email: 't@mathlens.local',
                displayName: 'Teacher',
                role: 'TEACHER',
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      }
      if (url.endsWith(`/pdf-imports/${job.id}`) && (!init?.method || init.method === 'GET')) {
        return Promise.resolve(
          new Response(JSON.stringify({ job }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      if (url.endsWith(`/pdf-imports/${job.id}/apply`)) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              job: { ...job, status: 'APPLIED', appliedTopicId: 'topic-99' },
              topic: { id: 'topic-99' },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      }
      return Promise.resolve(new Response('{}', { status: 404 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <QueryClientProvider client={createQueryClient()}>
        <MemoryRouter initialEntries={[`/teacher/pdf-imports/${job.id}`]}>
          <Routes>
            <Route path="/teacher/pdf-imports/:jobId" element={<PdfImportPreviewPage />} />
            <Route path="/teacher/topics/:topicId" element={<div>TOPIC_BUILDER_DEST</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText(/PDF Extraction Verification Workbench/i)).toBeInTheDocument();
    });

    // Side-by-side PDF image loaded with authenticated proxy URL after jobQuery resolves
    const img = (await screen.findByAltText(/Model 1 Page 1/i)) as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(`/api/v1/pdf-imports/${job.id}/pages/1/1`);

    // Attempting Apply before verifying flagged Q2 stops with warning
    fireEvent.click(screen.getByRole('button', { name: /Confirm & Apply to Topic/i }));
    expect(
      screen.getByText(/1 flagged question\(s\) still need verification/i),
    ).toBeInTheDocument();

    // Verify Q2 and apply successfully
    const verifyBtns = screen.getAllByRole('button', { name: /Mark Verified/i });
    fireEvent.click(verifyBtns[1]!);
    fireEvent.click(screen.getByRole('button', { name: /Confirm & Apply to Topic/i }));

    await waitFor(() => {
      expect(screen.getByText('TOPIC_BUILDER_DEST')).toBeInTheDocument();
    });
  });
});
