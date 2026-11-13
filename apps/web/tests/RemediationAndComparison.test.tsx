import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { UnlockPostTestButton } from '@/components/teacher/UnlockPostTestButton';
import StudentComparisonPage from '@/pages/student/StudentComparisonPage';
import StudentRemediationPage from '@/pages/student/StudentRemediationPage';
import type {
  StudentComparisonResponse,
  StudentVideoStateResponse,
  VideoHeartbeatResponse,
} from '@/types/video';

interface MockYtConfig {
  videoId?: string;
  events?: {
    onReady?: (ev: { target: MockYtPlayerInstance }) => void;
    onStateChange?: (ev: { data: number; target: MockYtPlayerInstance }) => void;
    onError?: (ev: { data: number; target: MockYtPlayerInstance }) => void;
  };
}

interface MockYtPlayerInstance {
  config: MockYtConfig;
  currentTime: number;
  playbackRate: number;
  getCurrentTime: ReturnType<typeof vi.fn>;
  getPlaybackRate: ReturnType<typeof vi.fn>;
  seekTo: ReturnType<typeof vi.fn>;
  playVideo: ReturnType<typeof vi.fn>;
  pauseVideo: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}

function renderWithProviders(ui: React.ReactElement, initialEntries = ['/student/remediation']) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={initialEntries}>
          <Routes>
            <Route path="/student/remediation" element={ui} />
            <Route path="/student/comparison" element={ui} />
            <Route path="/teacher/students" element={ui} />
            <Route path="/student/exam/:modelNumber" element={<div>MODEL_2_EXAM</div>} />
            <Route path="/student" element={<div>STUDENT_PORTAL</div>} />
          </Routes>
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

describe('Phase 6: Student Remediation & Comparison', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let latestPlayer: MockYtPlayerInstance | null = null;
  let originalHiddenDescriptor: PropertyDescriptor | undefined;
  let originalVisibilityDescriptor: PropertyDescriptor | undefined;

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    localStorage.setItem('mathlens_student_token', 'stu-tok');
    originalHiddenDescriptor = Object.getOwnPropertyDescriptor(document, 'hidden');
    originalVisibilityDescriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState');

    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };

    latestPlayer = null;
    const PlayerMock = vi.fn(function (
      this: MockYtPlayerInstance,
      _el: unknown,
      config: MockYtConfig,
    ) {
      const instance: MockYtPlayerInstance = {
        config,
        currentTime: 0,
        playbackRate: 1,
        getCurrentTime: vi.fn(() => instance.currentTime),
        getPlaybackRate: vi.fn(() => instance.playbackRate),
        seekTo: vi.fn((sec: number) => {
          instance.currentTime = sec;
        }),
        playVideo: vi.fn(),
        pauseVideo: vi.fn(),
        destroy: vi.fn(),
      };
      latestPlayer = instance;
      queueMicrotask(() => {
        config.events?.onReady?.({ target: instance });
      });
      return instance;
    });

    (window as unknown as { YT: unknown }).YT = {
      Player: PlayerMock,
      PlayerState: {
        UNSTARTED: -1,
        ENDED: 0,
        PLAYING: 1,
        PAUSED: 2,
        BUFFERING: 3,
        CUED: 5,
      },
    };

    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    if (originalHiddenDescriptor) {
      Object.defineProperty(document, 'hidden', originalHiddenDescriptor);
    }
    if (originalVisibilityDescriptor) {
      Object.defineProperty(document, 'visibilityState', originalVisibilityDescriptor);
    }
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('seeks initial timestamp, sends PLAY/HEARTBEAT, pauses on hidden tab, unlocks Model 2, and reports player alert', async () => {
    const initialState: StudentVideoStateResponse = {
      topic: {
        id: 'top-1',
        title: 'Logarithmic Differentiation',
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        videoId: 'dQw4w9WgXcQ',
        minWatchSeconds: 300,
      },
      cohort: {
        id: 'coh-1',
        group: 'TREATMENT',
        requireVideoBeforePost: true,
        requireWrongSegmentVisits: true,
      },
      watchedSeconds: 120,
      minWatchSeconds: 300,
      remainingSeconds: 180,
      lastPosition: 120,
      visitedQuestionIds: [],
      wrongQuestionSegments: [
        {
          questionId: 'q-2',
          orderIndex: 2,
          conceptKey: 'log-diff',
          timestampSeconds: 150,
          score: 1,
          maxScore: 4,
          visited: false,
        },
      ],
      wrongSegmentsIncomplete: true,
      unlockedPostAt: null,
      unlocked: false,
      manualUnlocked: false,
      postTestCompleted: false,
      postTestLockReason: null,
    };

    const heartbeatResult: VideoHeartbeatResponse = {
      watchedSeconds: 300,
      minWatchSeconds: 300,
      remainingSeconds: 0,
      lastPosition: 155,
      visitedQuestionIds: ['q-2'],
      wrongQuestionSegments: [],
      wrongSegmentsIncomplete: false,
      unlockedPostAt: '2026-11-13T10:00:00Z',
      unlocked: true,
      fraudWarning: null,
    };

    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/student/video/state')) {
        return new Response(JSON.stringify(initialState), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/student/video/heartbeat')) {
        return new Response(JSON.stringify(heartbeatResult), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/student/video/alert')) {
        return new Response(JSON.stringify({ recorded: true }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`Unexpected fetch: ${url} (${init?.method ?? 'GET'})`);
    });

    renderWithProviders(<StudentRemediationPage />, ['/student/remediation?t=150&q=q-2']);

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /Logarithmic Differentiation/ }),
      ).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(latestPlayer).not.toBeNull();
    });

    await waitFor(() => {
      const hbCalls = fetchMock.mock.calls.filter(([u]) =>
        String(u).includes('/student/video/heartbeat'),
      );
      expect(hbCalls.length).toBeGreaterThanOrEqual(1);
    });

    // Click wrong-question jump button to ensure seekTo(150, true) + QUESTION_LINK_CLICK fire
    const segmentBtn = screen.getByRole('button', { name: /log-diff/i });
    fireEvent.click(segmentBtn);
    await waitFor(() => {
      expect(latestPlayer?.seekTo).toHaveBeenCalledWith(150, true);
    });

    // Simulate player state PLAYING then 5s tick
    vi.useFakeTimers({ shouldAdvanceTime: true });
    act(() => {
      latestPlayer!.currentTime = 155;
      latestPlayer!.config.events?.onStateChange?.({ data: 1, target: latestPlayer! });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_100);
    });

    const hbBodies = fetchMock.mock.calls
      .filter(([u]) => String(u).includes('/student/video/heartbeat'))
      .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);
    expect(hbBodies.some((b) => b.type === 'PLAY')).toBe(true);
    expect(hbBodies.some((b) => b.type === 'HEARTBEAT')).toBe(true);

    // Tab visibility change pauses video when hidden
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => {
      const pauseOrPausedCalls =
        (latestPlayer?.pauseVideo.mock.calls.length ?? 0) +
        fetchMock.mock.calls.filter(
          ([u, init]) =>
            String(u).includes('/student/video/heartbeat') &&
            String(init?.body ?? '').includes('"PAUSE"'),
        ).length;
      expect(pauseOrPausedCalls).toBeGreaterThanOrEqual(1);
    });

    // Player error reports alert
    act(() => {
      latestPlayer!.config.events?.onError?.({ data: 150, target: latestPlayer! });
    });
    await waitFor(() => {
      const alertCalls = fetchMock.mock.calls.filter(([u]) =>
        String(u).includes('/student/video/alert'),
      );
      expect(alertCalls.length).toBeGreaterThanOrEqual(1);
    });

    vi.useRealTimers();
    const unlockBtn = screen.getByRole('button', { name: /Model 2|Start Model 2/i });
    expect(unlockBtn).not.toBeDisabled();
    fireEvent.click(unlockBtn);
    await waitFor(() => {
      expect(screen.getByText('MODEL_2_EXAM')).toBeInTheDocument();
    });
  });

  it('renders pre/post comparison with Hake gain, concepts, twin table, and control ethics offer', async () => {
    const comparison: StudentComparisonResponse = {
      student: { id: 'stu-1', displayName: 'Omar', group: 'CONTROL' },
      topic: {
        id: 'top-1',
        title: 'Logarithms',
        videoId: 'dQw4w9WgXcQ',
        minWatchSeconds: 300,
      },
      preTest: {
        attemptId: 'att-1',
        status: 'FINAL',
        totalScore: 6,
        maxScore: 20,
        percentage: 30,
        submittedAt: '2026-11-10T10:00:00Z',
      },
      postTest: {
        attemptId: 'att-2',
        status: 'FINAL',
        totalScore: 16,
        maxScore: 20,
        percentage: 80,
        submittedAt: '2026-11-13T10:00:00Z',
      },
      deltaPoints: 10,
      deltaPercentage: 50,
      normalizedGain: 0.7143,
      summaryAr: 'تحسن ملحوظ بمقدار 50 نقطة مئوية.',
      twinQuestions: [
        {
          conceptKey: 'log-diff',
          orderIndex: 1,
          preQuestionId: 'q1-1',
          postQuestionId: 'q2-1',
          preScore: 2,
          preMax: 10,
          postScore: 9,
          postMax: 10,
        },
      ],
      concepts: [
        {
          conceptKey: 'log-diff',
          preScore: 2,
          preMax: 10,
          prePercentage: 20,
          postScore: 9,
          postMax: 10,
          postPercentage: 90,
          deltaPercentage: 70,
          status: 'IMPROVED',
        },
        {
          conceptKey: 'chain-rule',
          preScore: 4,
          preMax: 10,
          prePercentage: 40,
          postScore: 7,
          postMax: 10,
          postPercentage: 70,
          deltaPercentage: 30,
          status: 'IMPROVED',
        },
      ],
      videoOfferAfterPost: {
        available: true,
        watchedSeconds: 0,
        minWatchSeconds: 300,
        recommendedForControl: true,
      },
    };

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(comparison), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    renderWithProviders(<StudentComparisonPage />, ['/student/comparison']);

    await waitFor(() => {
      expect(screen.getByText(/Logarithms/)).toBeInTheDocument();
    });

    expect(screen.getByText(/30\s*%\s*\(\s*6\s*\/\s*20\s*\)/)).toBeInTheDocument();
    expect(screen.getByText(/80\s*%\s*\(\s*16\s*\/\s*20\s*\)/)).toBeInTheDocument();
    expect(screen.getByText(/تحسن ملحوظ بمقدار 50 نقطة مئوية/)).toBeInTheDocument();
    expect(screen.getAllByText('log-diff').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/0\.7143/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Watch Remediation Video/i })).toBeInTheDocument();
  });

  it('calls POST /students/:id/unlock-posttest when UnlockPostTestButton is clicked', async () => {
    localStorage.setItem('mathlens_teacher_token', 'teacher-tok');
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ studentId: 'stu-9', unlockedPostAt: '2026-11-13T12:00:00Z' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    renderWithProviders(<UnlockPostTestButton studentId="stu-9" />, ['/teacher/students']);

    const btn = screen.getByRole('button', { name: /Unlock Model 2 now/i });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(screen.getByText(/Model 2 unlocked for this student/i)).toBeInTheDocument();
    });

    const unlockCall = fetchMock.mock.calls.find(([u]) =>
      String(u).includes('/students/stu-9/unlock-posttest'),
    );
    expect(unlockCall).toBeTruthy();
  });
});
