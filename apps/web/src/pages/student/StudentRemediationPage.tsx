import type { VideoHeartbeatInput } from '@mathlens/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  ExternalLink,
  PlayCircle,
} from 'lucide-react';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { StudentShell } from '@/components/layouts/StudentShell';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { apiRequest, getApiErrorMessage } from '@/lib/api';
import { useUiStore } from '@/store/uiStore';
import type { StudentVideoStateResponse, VideoHeartbeatResponse } from '@/types/video';

interface YtPlayerInstance {
  getCurrentTime?: () => number;
  getPlaybackRate?: () => number;
  seekTo?: (seconds: number, allowSeekAhead?: boolean) => void;
  pauseVideo?: () => void;
  destroy?: () => void;
}

declare global {
  interface Window {
    YT?: {
      Player: new (
        element: HTMLElement | string,
        options: {
          videoId: string;
          playerVars?: Record<string, string | number>;
          events?: {
            onReady?: () => void;
            onStateChange?: (event: { data: number }) => void;
            onError?: (event: { data: number }) => void;
          };
        },
      ) => YtPlayerInstance;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

export default function StudentRemediationPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const locale = useUiStore((s) => s.locale);
  const [searchParams] = useSearchParams();

  const initialQuestionId = searchParams.get('q') ?? undefined;

  const [selectedQuestionId, setSelectedQuestionId] = React.useState<string | undefined>(
    initialQuestionId,
  );
  const [playerErrorCode, setPlayerErrorCode] = React.useState<number | null>(null);
  const [liveProgress, setLiveProgress] = React.useState<{
    watchedSeconds: number;
    visitedCount: number;
    requiredCount: number;
    unlocked: boolean;
    fraudWarning: string | null;
  } | null>(null);

  const playerHostRef = React.useRef<HTMLDivElement | null>(null);
  const playerRef = React.useRef<YtPlayerInstance | null>(null);
  const intervalRef = React.useRef<number | null>(null);
  const initialClickSentRef = React.useRef(false);

  const stateQuery = useQuery({
    queryKey: ['student', 'video-state'],
    queryFn: () => apiRequest<StudentVideoStateResponse>('/student/video/state'),
    retry: false,
  });

  const heartbeatMutation = useMutation({
    mutationFn: (payload: VideoHeartbeatInput) =>
      apiRequest<VideoHeartbeatResponse>('/student/video/heartbeat', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: async (res) => {
      setLiveProgress({
        watchedSeconds: res.watchedSeconds,
        visitedCount: res.visitedCount,
        requiredCount: res.requiredCount,
        unlocked: res.unlocked,
        fraudWarning: res.fraudWarning,
      });
      if (res.unlocked) {
        await queryClient.invalidateQueries({ queryKey: ['student', 'state'] });
      }
      await queryClient.invalidateQueries({ queryKey: ['student', 'video-state'] });
    },
  });

  const alertMutation = useMutation({
    mutationFn: (errorCode: number) =>
      apiRequest('/student/video/alert', {
        method: 'POST',
        body: JSON.stringify({ errorCode }),
      }),
  });

  const activeSegment = React.useMemo(() => {
    const segments = stateQuery.data?.wrongQuestionSegments ?? [];
    if (selectedQuestionId) {
      const match = segments.find((s) => s.questionId === selectedQuestionId);
      if (match) return match;
    }
    return segments[0] ?? null;
  }, [stateQuery.data?.wrongQuestionSegments, selectedQuestionId]);

  const activeQuestionId = activeSegment?.questionId;
  const activeVideoId = activeSegment?.videoId ?? null;

  const sendEvent = React.useCallback(
    (type: VideoHeartbeatInput['type'], position: number, questionId?: string) => {
      const rate = playerRef.current?.getPlaybackRate?.() ?? 1;
      const targetQId = questionId ?? activeQuestionId;
      heartbeatMutation.mutate({
        type,
        position: Math.max(0, Math.round(position * 10) / 10),
        playbackRate: rate,
        tabVisible: document.visibilityState !== 'hidden',
        clientTs: new Date().toISOString(),
        ...(targetQId ? { questionId: targetQId } : {}),
      });
    },
    [heartbeatMutation, activeQuestionId],
  );

  // Record initial deep-link click if student navigated from a question result button
  React.useEffect(() => {
    if (!stateQuery.data || initialClickSentRef.current) return;
    if (initialQuestionId) {
      initialClickSentRef.current = true;
      setSelectedQuestionId(initialQuestionId);
      sendEvent('QUESTION_LINK_CLICK', 0, initialQuestionId);
    }
  }, [stateQuery.data, initialQuestionId, sendEvent]);

  // Initialize YouTube IFrame API player for the active question's videoId
  React.useEffect(() => {
    const videoId = activeVideoId;
    const host = playerHostRef.current;
    if (!videoId || !host) return;

    const mountPlayer = () => {
      if (!window.YT?.Player || !playerHostRef.current) return;
      playerRef.current = new window.YT.Player(playerHostRef.current, {
        videoId,
        playerVars: {
          origin: window.location.origin,
          start: 0,
          rel: 0,
          modestbranding: 1,
        },
        events: {
          onStateChange: (ev) => {
            const pos = playerRef.current?.getCurrentTime?.() ?? 0;
            if (ev.data === 1) {
              // PLAYING
              sendEvent('PLAY', pos);
              if (intervalRef.current !== null) {
                window.clearInterval(intervalRef.current);
              }
              intervalRef.current = window.setInterval(() => {
                const nowPos = playerRef.current?.getCurrentTime?.() ?? pos;
                sendEvent('HEARTBEAT', nowPos);
              }, 5000);
            } else if (ev.data === 2) {
              // PAUSED
              if (intervalRef.current !== null) {
                window.clearInterval(intervalRef.current);
                intervalRef.current = null;
              }
              sendEvent('PAUSE', pos);
            } else if (ev.data === 0) {
              // ENDED
              if (intervalRef.current !== null) {
                window.clearInterval(intervalRef.current);
                intervalRef.current = null;
              }
              sendEvent('ENDED', pos);
            }
          },
          onError: (ev) => {
            setPlayerErrorCode(ev.data);
            alertMutation.mutate(ev.data);
          },
        },
      });
    };

    if (window.YT?.Player) {
      mountPlayer();
    } else {
      window.onYouTubeIframeAPIReady = mountPlayer;
      const existing = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
      if (!existing) {
        const script = document.createElement('script');
        script.src = 'https://www.youtube.com/iframe_api';
        script.async = true;
        document.body.appendChild(script);
      }
    }

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        playerRef.current?.pauseVideo?.();
        if (intervalRef.current !== null) {
          window.clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        const pos = playerRef.current?.getCurrentTime?.() ?? 0;
        sendEvent('PAUSE', pos);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      playerRef.current?.destroy?.();
      playerRef.current = null;
    };
  }, [activeVideoId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (stateQuery.isLoading) {
    return (
      <StudentShell>
        <div className="py-12 text-center text-sm text-slate-600">{t('app.loading')}</div>
      </StudentShell>
    );
  }

  if (stateQuery.isError || !stateQuery.data) {
    return (
      <StudentShell>
        <div className="mx-auto max-w-2xl space-y-4">
          <Alert tone="danger">
            {getApiErrorMessage(stateQuery.error, locale, t('errors.generic'))}
          </Alert>
          <Button variant="outline" onClick={() => void navigate('/student')}>
            <ArrowRight className="h-4 w-4" />
            <span>{t('results.backToPortal')}</span>
          </Button>
        </div>
      </StudentShell>
    );
  }

  const state = stateQuery.data;
  const watchedSeconds = liveProgress?.watchedSeconds ?? state.watchedSeconds;
  const visitedCount = liveProgress?.visitedCount ?? state.visitedCount;
  const requiredCount = liveProgress?.requiredCount ?? state.requiredCount;
  const remainingQuestions = Math.max(0, requiredCount - visitedCount);
  const unlocked = liveProgress?.unlocked ?? state.unlocked;
  const fraudWarning = liveProgress?.fraudWarning ?? null;
  const pct =
    requiredCount > 0 ? Math.min(100, Math.round((visitedCount / requiredCount) * 100)) : 100;

  return (
    <StudentShell>
      <div className="mx-auto max-w-4xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void navigate('/student')}
              className="mb-1 px-2"
            >
              <ArrowRight className="h-4 w-4" />
              <span>{t('results.backToPortal')}</span>
            </Button>
            <h1 className="text-xl font-bold text-slate-900">
              {t('remediation.title')} — {state.topic.title}
            </h1>
            <p className="text-xs text-slate-600">{t('remediation.subtitle')}</p>
          </div>
        </div>

        {/* Watch Progress Bar */}
        <Card>
          <CardContent className="space-y-3 pt-5">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <div className="flex items-center gap-2 font-semibold text-slate-800">
                <Clock className="h-4 w-4 text-brand-700" />
                <span>{t('remediation.progressLabel')}</span>
              </div>
              <span className="font-mono font-bold text-brand-700" dir="ltr">
                {visitedCount} / {requiredCount} ({pct}%) · {watchedSeconds}s
              </span>
            </div>

            <div className="h-3 w-full overflow-hidden rounded-full bg-slate-200">
              <div className="h-full bg-brand-600 transition-all" style={{ width: `${pct}%` }} />
            </div>

            {unlocked ? (
              <Alert tone="success" className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 font-semibold">
                  <CheckCircle2 className="h-5 w-5" />
                  <span>{t('remediation.unlockedBanner')}</span>
                </div>
                {!state.postTestCompleted && (
                  <Button onClick={() => void navigate('/student/exam/2')}>
                    <PlayCircle className="h-4 w-4" />
                    <span>{t('remediation.startPostTest')}</span>
                  </Button>
                )}
              </Alert>
            ) : (
              <div className="text-xs text-slate-600">
                {t('remediation.remainingQuestionsLabel', { count: remainingQuestions })}
              </div>
            )}

            {fraudWarning && (
              <Alert tone="warning" className="py-2 text-xs">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>{t('remediation.fraudWarning')}</span>
                </div>
              </Alert>
            )}
          </CardContent>
        </Card>

        {playerErrorCode !== null && (
          <Alert tone="danger">
            {t('remediation.playerErrorBanner', { code: playerErrorCode })}
          </Alert>
        )}

        {/* YouTube Player Host */}
        <Card>
          <CardContent className="pt-5">
            <div className="aspect-video w-full overflow-hidden rounded-xl bg-slate-900">
              <div
                ref={playerHostRef}
                data-testid="youtube-player-host"
                className="h-full w-full"
              />
            </div>
          </CardContent>
        </Card>

        {/* Per-Question Explanation Videos for Wrong Questions */}
        {state.wrongQuestionSegments.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>{t('remediation.wrongSegmentsTitle')}</CardTitle>
              <CardDescription>{state.topic.title}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {state.wrongQuestionSegments.map((seg) => (
                <div key={seg.questionId} className="inline-flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant={seg.visited ? 'outline' : 'primary'}
                    onClick={() => {
                      setSelectedQuestionId(seg.questionId);
                      sendEvent('QUESTION_LINK_CLICK', 0, seg.questionId);
                    }}
                  >
                    <PlayCircle className="h-3.5 w-3.5" />
                    <span>
                      #{seg.orderIndex} · {seg.conceptKey}
                    </span>
                    <Badge tone={seg.visited ? 'success' : 'warning'} className="ms-1">
                      {seg.visited
                        ? t('remediation.segmentVisited')
                        : t('remediation.segmentPending')}
                    </Badge>
                  </Button>
                  {seg.solutionUrl && (
                    <a
                      href={seg.solutionUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => {
                        setSelectedQuestionId(seg.questionId);
                        sendEvent('QUESTION_LINK_CLICK', 0, seg.questionId);
                      }}
                      className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-brand-700 hover:bg-slate-50"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      <span>{t('results.viewSolutionLink')}</span>
                    </a>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </StudentShell>
  );
}
