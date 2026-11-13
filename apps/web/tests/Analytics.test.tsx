import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import AnalyticsPage from '@/pages/teacher/AnalyticsPage';
import UsagePage from '@/pages/teacher/UsagePage';
import type { TeacherAnalyticsResponse, TeacherUsageResponse } from '@/types/analytics';

function renderTeacherPage(ui: React.ReactElement, initialPath: string) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route path="/teacher/analytics" element={ui} />
            <Route path="/teacher/usage" element={ui} />
            <Route path="/teacher/login" element={<div>TEACHER_LOGIN</div>} />
          </Routes>
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

describe('Phase 7: Teacher Analytics & AI Cost Usage UI', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    URL.revokeObjectURL = vi.fn();
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders AnalyticsPage with formal stats, McNemar Holm table, reliability, and CSV/XLSX downloads', async () => {
    const analyticsPayload: TeacherAnalyticsResponse = {
      filters: { topicId: null, cohortId: null },
      topics: [{ id: 'top-1', title: 'Logarithmic Differentiation' }],
      cohorts: [
        {
          id: 'coh-1',
          name: 'Class 3A',
          group: 'TREATMENT',
          topicId: 'top-1',
          topicTitle: 'Logarithmic Differentiation',
          studentsCount: 15,
          preCompletedCount: 15,
          postCompletedCount: 14,
          pairedCount: 14,
          preAvgPct: 45,
          postAvgPct: 82,
          deltaPct: 37,
          hakeGain: 0.6727,
          avgWatchedSeconds: 290,
        },
      ],
      summary: {
        totalStudents: 25,
        pairedStudents: 24,
        treatmentPairedCount: 14,
        controlPairedCount: 10,
        preMeanPct: 44,
        postMeanPct: 72,
        deltaMeanPct: 28,
        hakeMeanGain: 0.5,
        totalEssayGraded: 20,
        totalOverrides: 2,
        overrideRate: 0.1,
      },
      concepts: [
        {
          conceptKey: 'log-diff',
          preCount: 24,
          postCount: 24,
          preAvgPct: 40,
          postAvgPct: 84,
          deltaPct: 44,
          preWrongPostCorrect: 12,
          preCorrectPostWrong: 1,
          bothCorrect: 9,
          bothWrong: 2,
        },
      ],
      questions: [
        {
          conceptKey: 'log-diff',
          orderIndex: 1,
          preQuestionId: 'q1',
          postQuestionId: 'q2',
          preAvgPct: 40,
          postAvgPct: 84,
          deltaPct: 44,
          preCorrectRate: 0.4,
          postCorrectRate: 0.85,
        },
      ],
      distributions: [
        { rangeLabel: '0-24%', preCount: 3, postCount: 0 },
        { rangeLabel: '25-49%', preCount: 12, postCount: 2 },
        { rangeLabel: '50-74%', preCount: 8, postCount: 7 },
        { rangeLabel: '75-100%', preCount: 1, postCount: 15 },
      ],
      formalStats: {
        pairedScope: 'TREATMENT',
        paired: {
          n: 14,
          pre_mean: 45,
          pre_sd: 9,
          pre_median: 44,
          pre_iqr: 12,
          post_mean: 82,
          post_sd: 7,
          post_median: 83,
          post_iqr: 10,
          mean_diff: 37,
          sd_diff: 6,
          median_diff: 36,
          shapiro: { statistic: 0.96, p_value: 0.62, normal: true },
          paired_t: { statistic: 11.4, p_value: 0.0001, df: 13 },
          wilcoxon: { statistic: 1, p_value: 0.0002 },
          cohens_dz: { estimate: 1.92, ci_low: 1.35, ci_high: 2.55 },
          hake_gain: { mean_gain: 0.67, per_student_gains: [0.67] },
          outlier_indices: [],
          warnings: ['SMALL_SAMPLE'],
          recommended_test: 'WILCOXON',
          interpretation_ar: 'تحسن كبير ذو دلالة إحصائية.',
          interpretation_en: 'Statistically significant paired improvement.',
        },
        between: {
          group_comparison: {
            treatment_n: 14,
            control_n: 10,
            treatment_gain_mean: 37,
            treatment_gain_sd: 6,
            control_gain_mean: 9,
            control_gain_sd: 5,
            welch_t: { statistic: 10.2, p_value: 0.0001, df: 21.4 },
            mann_whitney: { statistic: 138, p_value: 0.0001 },
            hedges_g: { estimate: 2.8, ci_low: 1.9, ci_high: 3.7 },
            did: {
              estimate: 28,
              se: 2.4,
              t_stat: 11.6,
              p_value: 0.0001,
              ci_low: 23.2,
              ci_high: 32.8,
              clustered_by_student: true,
            },
          },
          mcnemar: [
            {
              concept_key: 'log-diff',
              order_index: 1,
              b_improved: 12,
              c_regressed: 1,
              p_value: 0.0034,
              p_adjusted_holm: 0.0034,
              significant: true,
            },
          ],
          reliability: {
            n: 20,
            mae: 0.25,
            exact_agreement_rate: 0.85,
            within_one_agreement_rate: 0.95,
            override_rate: 0.1,
            cohens_kappa: 0.81,
            quadratic_weighted_kappa: 0.91,
          },
          warnings: ['SMALL_GROUP_SAMPLE'],
          interpretation_ar: 'أثر سببي موجب لفيديو الشرح.',
          interpretation_en: 'Significant DiD gain attributable to remediation video.',
        },
        statsUnavailable: false,
        statsError: null,
      },
    };

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/auth/teacher/me')) {
        return new Response(
          JSON.stringify({
            teacher: {
              id: 't1',
              email: 't@mathlens.test',
              displayName: 'Mr. Tarek',
              role: 'TEACHER',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/analytics')) {
        return new Response(JSON.stringify(analyticsPayload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/export.xlsx')) {
        return new Response(new Blob(['xlsx-bytes']), {
          status: 200,
          headers: {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': 'attachment; filename="class-3a.xlsx"',
          },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    renderTeacherPage(<AnalyticsPage />, '/teacher/analytics');

    await waitFor(() => {
      expect(screen.getByText('Experiment Analytics & Formal Statistics')).toBeInTheDocument();
    });

    expect(screen.getByText('Statistically significant paired improvement.')).toBeInTheDocument();
    expect(
      screen.getByText('Significant DiD gain attributable to remediation video.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Significant (Holm)')).toBeInTheDocument();
    expect(screen.getByText('0.910')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'XLSX' }));
    await waitFor(() => {
      const exportCall = fetchMock.mock.calls.find(([u]) => String(u).includes('/export.xlsx'));
      expect(exportCall).toBeTruthy();
    });
  });

  it('renders UsagePage with daily cap progress, latency percentiles, breakdown table, and days selector', async () => {
    const usagePayload: TeacherUsageResponse = {
      days: 30,
      dailyCapUsd: 25,
      todayCostUsd: 1.25,
      capRemainingUsd: 23.75,
      summary: {
        totalCalls: 42,
        successCalls: 40,
        failedCalls: 2,
        totalCostUsd: 2.15,
        avgLatencyMs: 650,
        p95LatencyMs: 1420,
        totalInputTokens: 25000,
        totalOutputTokens: 8000,
      },
      daily: [
        { date: '2026-11-12', calls: 20, successCalls: 19, costUsd: 0.9, avgLatencyMs: 620 },
        { date: '2026-11-13', calls: 22, successCalls: 21, costUsd: 1.25, avgLatencyMs: 680 },
      ],
      breakdown: [
        {
          provider: 'groq',
          modelName: 'llama-3.2-90b-vision',
          operation: 'grade_essay',
          calls: 42,
          successRate: 0.9524,
          inputTokens: 25000,
          outputTokens: 8000,
          costUsd: 2.15,
          avgLatencyMs: 650,
        },
      ],
      recentCalls: [
        {
          id: 'u-1',
          provider: 'groq',
          modelName: 'llama-3.2-90b-vision',
          operation: 'grade_essay',
          costUsd: 0.05,
          latencyMs: 610,
          success: true,
          errorCode: null,
          createdAt: '2026-11-13T10:00:00Z',
        },
      ],
    };

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/auth/teacher/me')) {
        return new Response(
          JSON.stringify({
            teacher: {
              id: 't1',
              email: 't@mathlens.test',
              displayName: 'Mr. Tarek',
              role: 'TEACHER',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/usage')) {
        return new Response(JSON.stringify(usagePayload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    renderTeacherPage(<UsagePage />, '/teacher/usage');

    await waitFor(() => {
      expect(screen.getByText('AI Grading Cost & Telemetry')).toBeInTheDocument();
    });

    expect(screen.getByText('$1.2500 / $25.00')).toBeInTheDocument();
    expect(screen.getByText('650ms / 1420ms')).toBeInTheDocument();
    expect(screen.getAllByText('llama-3.2-90b-vision').length).toBeGreaterThanOrEqual(1);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: '7' } });
    await waitFor(() => {
      const sevenDayCall = fetchMock.mock.calls.find(([u]) => String(u).includes('/usage?days=7'));
      expect(sevenDayCall).toBeTruthy();
    });
  });
});
