import { useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock,
  Lock,
  Send,
  WifiOff,
} from 'lucide-react';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { MathBlock } from '@/components/MathBlock';
import { StudentShell } from '@/components/layouts/StudentShell';
import { EssayUploadWidget } from '@/components/student/EssayUploadWidget';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { ApiClientError, apiRequest, getApiErrorMessage } from '@/lib/api';
import {
  enqueueMcqAutosave,
  flushQueuedMcqAutosaves,
  getQueuedAutosaveCount,
  removeQueuedMcqAutosave,
} from '@/lib/offlineQueue';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/store/uiStore';
import type { StudentAttemptImage, StudentExamAttempt, StudentExamQuestion } from '@/types/student';

function formatCountdown(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function isQuestionAnswered(question: StudentExamQuestion): boolean {
  if (question.type === 'MCQ') {
    return Boolean(question.selectedOptionId);
  }
  return question.images.length > 0;
}

export default function StudentExamPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const locale = useUiStore((s) => s.locale);
  const { modelNumber: modelParam } = useParams<{ modelNumber?: string }>();
  const modelNumber: 1 | 2 = modelParam === '2' ? 2 : 1;

  const [attempt, setAttempt] = React.useState<StudentExamAttempt | null>(null);
  const [clockOffsetMs, setClockOffsetMs] = React.useState(0);
  const [remainingSeconds, setRemainingSeconds] = React.useState<number | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [unauthorized, setUnauthorized] = React.useState(false);
  const [needsConsent, setNeedsConsent] = React.useState(false);
  const [lockedMessage, setLockedMessage] = React.useState<string | null>(null);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  const [currentIndex, setCurrentIndex] = React.useState(0);
  const [pendingOfflineCount, setPendingOfflineCount] = React.useState(0);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  const autoSubmittedRef = React.useRef(false);

  React.useEffect(() => {
    let active = true;
    autoSubmittedRef.current = false;
    setLoading(true);
    setErrorMsg(null);
    setLockedMessage(null);
    setUnauthorized(false);
    setNeedsConsent(false);
    setCurrentIndex(0);

    void apiRequest<{ attempt: StudentExamAttempt }>('/student/attempts', {
      method: 'POST',
      body: JSON.stringify({ modelNumber }),
    })
      .then((res) => {
        if (!active) return;
        const loaded = res.attempt;
        if (loaded.status !== 'IN_PROGRESS') {
          void queryClient.invalidateQueries({ queryKey: ['student', 'state'] });
          void navigate('/student', { replace: true });
          return;
        }
        const offset = Date.parse(loaded.serverNow) - Date.now();
        setClockOffsetMs(offset);
        setRemainingSeconds(
          Math.max(0, Math.floor((Date.parse(loaded.deadlineAt) - (Date.now() + offset)) / 1000)),
        );
        setAttempt(loaded);
        setPendingOfflineCount(getQueuedAutosaveCount(loaded.id));
      })
      .catch((err: unknown) => {
        if (!active) return;
        if (err instanceof ApiClientError) {
          if (err.status === 401) {
            setUnauthorized(true);
            return;
          }
          if (err.code === 'CONSENT_REQUIRED') {
            setNeedsConsent(true);
            return;
          }
          if (err.code === 'POSTTEST_LOCKED') {
            setLockedMessage(
              getApiErrorMessage(err, locale, t('student.portal.posttestLockedTitle')),
            );
            return;
          }
        }
        setErrorMsg(getApiErrorMessage(err, locale, t('errors.generic')));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [locale, modelNumber, navigate, queryClient, t]);

  const submitAttempt = React.useCallback(
    async (attemptId: string) => {
      setSubmitting(true);
      setErrorMsg(null);
      try {
        // Best-effort flush before final submission
        await flushQueuedMcqAutosaves(attemptId, async (entry) => {
          await apiRequest(`/student/attempts/${entry.attemptId}/answers/${entry.questionId}`, {
            method: 'PUT',
            body: JSON.stringify({ selectedOptionId: entry.selectedOptionId }),
          });
        });

        await apiRequest(`/student/attempts/${attemptId}/submit`, {
          method: 'POST',
        });
        await queryClient.invalidateQueries({ queryKey: ['student', 'state'] });
        void navigate('/student', { replace: true });
      } catch (err) {
        setErrorMsg(getApiErrorMessage(err, locale, t('errors.generic')));
        setConfirmOpen(false);
        setSubmitting(false);
      }
    },
    [locale, navigate, queryClient, t],
  );

  // Server-synced countdown tick
  React.useEffect(() => {
    if (!attempt || attempt.status !== 'IN_PROGRESS') return;

    const updateTick = () => {
      const next = Math.max(
        0,
        Math.floor((Date.parse(attempt.deadlineAt) - (Date.now() + clockOffsetMs)) / 1000),
      );
      setRemainingSeconds(next);
      if (next === 0 && !autoSubmittedRef.current) {
        autoSubmittedRef.current = true;
        void submitAttempt(attempt.id);
      }
    };

    updateTick();
    const timer = window.setInterval(updateTick, 1000);
    return () => window.clearInterval(timer);
  }, [attempt, clockOffsetMs, submitAttempt]);

  // Flush offline autosave queue when connection returns or attempt loads
  React.useEffect(() => {
    if (!attempt) return;
    const attemptId = attempt.id;

    const flush = async () => {
      const remaining = await flushQueuedMcqAutosaves(attemptId, async (entry) => {
        await apiRequest(`/student/attempts/${entry.attemptId}/answers/${entry.questionId}`, {
          method: 'PUT',
          body: JSON.stringify({ selectedOptionId: entry.selectedOptionId }),
        });
      });
      setPendingOfflineCount(remaining);
    };

    if (getQueuedAutosaveCount(attemptId) > 0 && navigator.onLine !== false) {
      void flush();
    }

    const onOnline = () => {
      void flush();
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [attempt]);

  const handleSelectMcq = async (questionId: string, optionId: string) => {
    if (!attempt || submitting) return;

    setAttempt((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        questions: prev.questions.map((q) =>
          q.id === questionId ? { ...q, selectedOptionId: optionId } : q,
        ),
      };
    });

    try {
      await apiRequest(`/student/attempts/${attempt.id}/answers/${questionId}`, {
        method: 'PUT',
        body: JSON.stringify({ selectedOptionId: optionId }),
      });
      removeQueuedMcqAutosave(attempt.id, questionId);
      setPendingOfflineCount(getQueuedAutosaveCount(attempt.id));
    } catch (err) {
      if (err instanceof ApiClientError && err.status >= 400 && err.status < 500) {
        setErrorMsg(getApiErrorMessage(err, locale, t('errors.generic')));
        return;
      }
      enqueueMcqAutosave({
        attemptId: attempt.id,
        questionId,
        selectedOptionId: optionId,
        queuedAt: Date.now(),
      });
      setPendingOfflineCount(getQueuedAutosaveCount(attempt.id));
    }
  };

  const handleEssayImagesChanged = (questionId: string, nextImages: StudentAttemptImage[]) => {
    setAttempt((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        questions: prev.questions.map((q) =>
          q.id === questionId ? { ...q, images: nextImages } : q,
        ),
      };
    });
  };

  if (unauthorized) {
    return <Navigate to="/" replace />;
  }

  if (needsConsent) {
    return <Navigate to="/student/consent" replace />;
  }

  if (loading) {
    return (
      <StudentShell>
        <div className="flex min-h-[50vh] items-center justify-center text-sm text-slate-600">
          {t('app.loading')}
        </div>
      </StudentShell>
    );
  }

  if (lockedMessage) {
    return (
      <StudentShell>
        <Card className="mx-auto max-w-lg">
          <CardHeader>
            <div className="flex items-center gap-2 text-amber-700">
              <Lock className="h-5 w-5" />
              <CardTitle>{t('student.portal.posttestLockedTitle')}</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert tone="warning">{lockedMessage}</Alert>
            <Button variant="outline" className="w-full" onClick={() => void navigate('/student')}>
              {t('student.portal.refreshStatus')}
            </Button>
          </CardContent>
        </Card>
      </StudentShell>
    );
  }

  if (!attempt || attempt.questions.length === 0) {
    return (
      <StudentShell>
        <div className="mx-auto max-w-lg space-y-4">
          <Alert tone="danger">{errorMsg ?? t('errors.generic')}</Alert>
          <Button variant="outline" onClick={() => void navigate('/student')}>
            {t('student.portal.refreshStatus')}
          </Button>
        </div>
      </StudentShell>
    );
  }

  const questions = attempt.questions;
  const activeQuestion = questions[Math.min(currentIndex, questions.length - 1)];
  const answeredCount = questions.filter(isQuestionAnswered).length;
  const unansweredNumbers = questions
    .map((q, idx) => (isQuestionAnswered(q) ? null : idx + 1))
    .filter((num): num is number => num !== null);

  const secLeft = remainingSeconds ?? 0;
  const showFiveMinWarn = secLeft > 60 && secLeft <= 300;
  const showOneMinWarn = secLeft > 0 && secLeft <= 60;
  const PrevIcon = locale === 'ar' ? ArrowRight : ArrowLeft;
  const NextIcon = locale === 'ar' ? ArrowLeft : ArrowRight;

  return (
    <StudentShell>
      <div className="space-y-4">
        {/* Sticky Server-Synced Exam Header */}
        <div className="sticky top-2 z-20 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <Badge tone="info">
                  {t('student.exam.modelLabel', { num: attempt.modelNumber })}
                </Badge>
                <span className="text-sm font-bold text-slate-900">{attempt.title}</span>
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {t('student.exam.questionProgress', {
                  current: currentIndex + 1,
                  total: questions.length,
                })}{' '}
                · ({answeredCount}/{questions.length})
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div
                aria-label={t('student.exam.remainingTime')}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-bold',
                  showOneMinWarn
                    ? 'border-red-300 bg-red-50 text-red-700'
                    : showFiveMinWarn
                      ? 'border-amber-300 bg-amber-50 text-amber-800'
                      : 'border-slate-200 bg-slate-50 text-slate-900',
                )}
              >
                <Clock className="h-4 w-4" />
                <span dir="ltr" className="tabular-nums">
                  {formatCountdown(secLeft)}
                </span>
              </div>
              <Button size="sm" onClick={() => setConfirmOpen(true)} disabled={submitting}>
                <Send className="h-4 w-4" />
                <span>{t('student.exam.submitExam')}</span>
              </Button>
            </div>
          </div>

          <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full bg-brand-600 transition-all"
              style={{ width: `${Math.round((answeredCount / questions.length) * 100)}%` }}
            />
          </div>
        </div>

        {showFiveMinWarn && <Alert tone="warning">{t('student.exam.fiveMinWarning')}</Alert>}
        {showOneMinWarn && (
          <Alert tone="danger">
            <div className="flex items-center gap-2 font-bold">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{t('student.exam.oneMinWarning')}</span>
            </div>
          </Alert>
        )}
        {pendingOfflineCount > 0 && (
          <Alert tone="warning">
            <div className="flex items-center gap-2">
              <WifiOff className="h-4 w-4 shrink-0" />
              <span>{t('student.exam.offlineSaved')}</span>
            </div>
          </Alert>
        )}
        {errorMsg && <Alert tone="danger">{errorMsg}</Alert>}

        {/* Question Navigator */}
        <Card>
          <CardContent className="p-3">
            <div className="mb-2 text-xs font-semibold text-slate-600">
              {t('student.exam.questionNav')}
            </div>
            <div className="flex flex-wrap gap-2">
              {questions.map((q, idx) => {
                const answered = isQuestionAnswered(q);
                const isActive = idx === currentIndex;
                return (
                  <button
                    key={q.id}
                    type="button"
                    aria-label={`${idx + 1}`}
                    aria-current={isActive ? 'step' : undefined}
                    onClick={() => setCurrentIndex(idx)}
                    className={cn(
                      'inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border text-sm font-bold tabular-nums transition',
                      isActive
                        ? 'border-brand-700 bg-brand-600 text-white shadow-sm'
                        : answered
                          ? 'border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100'
                          : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
                    )}
                  >
                    {idx + 1}
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Active Question Card */}
        {activeQuestion && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base">
                  {t('student.exam.questionProgress', {
                    current: currentIndex + 1,
                    total: questions.length,
                  })}
                </CardTitle>
                <Badge tone="neutral">
                  {activeQuestion.type === 'MCQ'
                    ? t('teacher.questionEditor.mcq')
                    : t('teacher.questionEditor.essay')}{' '}
                  · <span className="tabular-nums">{activeQuestion.points}</span>
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 text-base text-slate-900">
                <MathBlock text={activeQuestion.promptLatex} forceLtr disableCopy />
              </div>

              {activeQuestion.type === 'MCQ' ? (
                <div
                  className="space-y-3"
                  role="radiogroup"
                  aria-label={`Question ${currentIndex + 1}`}
                >
                  {activeQuestion.mcqOptions.map((opt) => {
                    const selected = activeQuestion.selectedOptionId === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => {
                          void handleSelectMcq(activeQuestion.id, opt.id);
                        }}
                        className={cn(
                          'flex min-h-[54px] w-full items-center gap-3 rounded-xl border-2 px-4 py-3 text-start transition',
                          selected
                            ? 'border-brand-600 bg-brand-50 text-brand-950 shadow-sm'
                            : 'border-slate-200 bg-white text-slate-900 hover:border-slate-300 hover:bg-slate-50',
                        )}
                      >
                        <span
                          dir="ltr"
                          className={cn(
                            'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold',
                            selected ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700',
                          )}
                        >
                          {opt.label}
                        </span>
                        <div className="min-w-0 flex-1">
                          <MathBlock text={opt.textLatex} forceLtr disableCopy />
                        </div>
                        {selected && <CheckCircle2 className="h-5 w-5 shrink-0 text-brand-600" />}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <EssayUploadWidget
                  answerId={activeQuestion.answerId ?? activeQuestion.id}
                  images={activeQuestion.images}
                  disabled={submitting}
                  onChanged={(nextImages) =>
                    handleEssayImagesChanged(activeQuestion.id, nextImages)
                  }
                />
              )}

              <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
                <Button
                  variant="outline"
                  disabled={currentIndex === 0}
                  onClick={() => setCurrentIndex((idx) => Math.max(0, idx - 1))}
                >
                  <PrevIcon className="h-4 w-4" />
                  <span>{t('student.exam.previous')}</span>
                </Button>

                {currentIndex < questions.length - 1 ? (
                  <Button
                    onClick={() =>
                      setCurrentIndex((idx) => Math.min(questions.length - 1, idx + 1))
                    }
                  >
                    <span>{t('student.exam.next')}</span>
                    <NextIcon className="h-4 w-4" />
                  </Button>
                ) : (
                  <Button onClick={() => setConfirmOpen(true)} disabled={submitting}>
                    <Send className="h-4 w-4" />
                    <span>{t('student.exam.submitExam')}</span>
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Submit Confirmation Dialog */}
      {confirmOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="submit-confirm-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
        >
          <Card className="w-full max-w-md shadow-xl">
            <CardHeader>
              <CardTitle id="submit-confirm-title">
                {t('student.exam.confirmSubmitTitle')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-slate-600">{t('student.exam.confirmSubmitWarning')}</p>

              {unansweredNumbers.length > 0 ? (
                <Alert tone="warning">
                  <div className="font-bold">{t('student.exam.unansweredList')}</div>
                  <div className="mt-2 flex flex-wrap gap-1.5" dir="ltr">
                    {unansweredNumbers.map((num) => (
                      <button
                        key={num}
                        type="button"
                        onClick={() => {
                          setCurrentIndex(num - 1);
                          setConfirmOpen(false);
                        }}
                        className="rounded-md bg-amber-200 px-2.5 py-1 text-xs font-bold text-amber-950 hover:bg-amber-300"
                      >
                        #{num}
                      </button>
                    ))}
                  </div>
                </Alert>
              ) : (
                <Alert tone="success">{t('student.exam.allAnswered')}</Alert>
              )}

              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  variant="outline"
                  disabled={submitting}
                  onClick={() => setConfirmOpen(false)}
                >
                  {t('app.cancel')}
                </Button>
                <Button
                  disabled={submitting}
                  onClick={() => {
                    void submitAttempt(attempt.id);
                  }}
                >
                  <Send className="h-4 w-4" />
                  <span>{t('student.exam.confirmSubmitBtn')}</span>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </StudentShell>
  );
}
