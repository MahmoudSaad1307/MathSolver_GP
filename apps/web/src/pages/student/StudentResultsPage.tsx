import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Flag,
  PlayCircle,
  Send,
} from 'lucide-react';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { MathBlock } from '@/components/MathBlock';
import { StudentShell } from '@/components/layouts/StudentShell';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { apiRequest, getApiErrorMessage } from '@/lib/api';
import { useUiStore } from '@/store/uiStore';
import type { StudentAttemptQuestionResult, StudentAttemptResults } from '@/types/review';

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function getChipTone(
  chip: StudentAttemptQuestionResult['statusChip'],
): 'info' | 'success' | 'warning' | 'neutral' {
  switch (chip) {
    case 'GRADED':
    case 'OVERRIDDEN':
      return 'success';
    case 'NEEDS_REVIEW':
      return 'warning';
    case 'GRADING':
      return 'info';
    default:
      return 'neutral';
  }
}

export default function StudentResultsPage() {
  const { attemptId } = useParams<{ attemptId: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const locale = useUiStore((s) => s.locale);

  const [openMisreadAnswerId, setOpenMisreadAnswerId] = React.useState<string | null>(null);
  const [misreadNotes, setMisreadNotes] = React.useState<Record<string, string>>({});
  const [misreadError, setMisreadError] = React.useState<string | null>(null);

  const pollCounterRef = React.useRef(0);

  const resultsQuery = useQuery({
    queryKey: ['student', 'attempt-results', attemptId],
    queryFn: () =>
      apiRequest<StudentAttemptResults>(`/student/attempts/${attemptId}/results`),
    enabled: Boolean(attemptId),
    retry: false,
    refetchInterval: (query) => {
      const status = query.state.data?.attempt.status;
      if (status === 'SUBMITTED' || status === 'GRADING') {
        pollCounterRef.current += 1;
        return Math.min(3000 * Math.pow(1.25, Math.min(pollCounterRef.current - 1, 5)), 15000);
      }
      pollCounterRef.current = 0;
      return false;
    },
  });

  const misreadMutation = useMutation({
    mutationFn: async (vars: { answerId: string; note?: string }) =>
      apiRequest(`/student/answers/${vars.answerId}/report-misread`, {
        method: 'POST',
        body: JSON.stringify({ note: vars.note }),
      }),
    onSuccess: async () => {
      setMisreadError(null);
      setOpenMisreadAnswerId(null);
      await queryClient.invalidateQueries({ queryKey: ['student', 'attempt-results', attemptId] });
      await queryClient.invalidateQueries({ queryKey: ['student', 'state'] });
    },
    onError: (err) => {
      setMisreadError(getApiErrorMessage(err, locale, t('errors.generic')));
    },
  });

  if (!attemptId) {
    return <Navigate to="/student" replace />;
  }

  if (resultsQuery.isLoading) {
    return (
      <StudentShell>
        <div className="py-12 text-center text-sm text-slate-600">{t('app.loading')}</div>
      </StudentShell>
    );
  }

  if (resultsQuery.isError || !resultsQuery.data) {
    return (
      <StudentShell>
        <div className="mx-auto max-w-2xl space-y-4">
          <Alert tone="danger">
            {getApiErrorMessage(resultsQuery.error, locale, t('errors.generic'))}
          </Alert>
          <Button variant="outline" onClick={() => void navigate('/student')}>
            <ArrowRight className="h-4 w-4" />
            <span>{t('results.backToPortal')}</span>
          </Button>
        </div>
      </StudentShell>
    );
  }

  const { attempt, topic, statusCounts, questions } = resultsQuery.data;

  return (
    <StudentShell>
      <div className="mx-auto max-w-4xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
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
              {t('results.title')} — {attempt.title}
            </h1>
            <p className="text-xs text-slate-500">{topic.title}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge tone="success">
              {t('results.statusChip.GRADED')}: {statusCounts.gradedCount}
            </Badge>
            {statusCounts.gradingCount > 0 && (
              <Badge tone="info">
                {t('results.statusChip.GRADING')}: {statusCounts.gradingCount}
              </Badge>
            )}
            {statusCounts.needsReviewCount > 0 && (
              <Badge tone="warning">
                {t('results.statusChip.NEEDS_REVIEW')}: {statusCounts.needsReviewCount}
              </Badge>
            )}
          </div>
        </div>

        {/* Overall Score Card */}
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-5">
            {attempt.scoreHidden ? (
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-amber-700 font-bold">
                  <Clock className="h-5 w-5" />
                  <span>{t('results.scorePendingTitle')}</span>
                </div>
                <p className="text-xs text-slate-600">{t('results.scorePendingDesc')}</p>
              </div>
            ) : (
              <div className="space-y-1">
                <div className="text-xs text-slate-500">{t('results.totalScoreLabel')}</div>
                <div className="flex items-baseline gap-3" dir="ltr">
                  <span className="text-3xl font-extrabold text-brand-700">
                    {attempt.totalScore ?? 0} / {attempt.maxScore}
                  </span>
                  <span className="text-lg font-bold text-slate-600">
                    ({Math.round(attempt.percentage ?? 0)}%)
                  </span>
                </div>
                {attempt.isProvisional && (
                  <Alert tone="warning" className="mt-2 py-1.5 text-xs">
                    {t('results.provisionalBanner')}
                  </Alert>
                )}
              </div>
            )}

            {topic.videoId && (
              <Button
                variant="primary"
                onClick={() => void navigate('/student/remediation')}
              >
                <PlayCircle className="h-4 w-4" />
                <span>{t('results.watchExplanation')}</span>
              </Button>
            )}
          </CardContent>
        </Card>

        {misreadError && <Alert tone="danger">{misreadError}</Alert>}

        {/* Per-question detailed feedback */}
        <div className="space-y-4">
          {questions.map((q) => {
            const misreadOpen = openMisreadAnswerId === q.answerId;
            return (
              <Card key={q.questionId} data-testid={`result-question-${q.orderIndex}`}>
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <CardTitle>
                        #{q.orderIndex} · {q.type}
                      </CardTitle>
                      <Badge tone="neutral">{q.conceptKey}</Badge>
                      <Badge tone={getChipTone(q.statusChip)}>
                        {t(`results.statusChip.${q.statusChip}`)}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-bold text-slate-800" dir="ltr">
                        {q.score !== null ? `${q.score} / ${q.points}` : `— / ${q.points}`}
                      </span>
                      {q.belowThreshold && topic.videoId && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            void navigate(
                              `/student/remediation?t=${q.videoTimestampSeconds}&q=${q.questionId}`,
                            )
                          }
                        >
                          <PlayCircle className="h-3.5 w-3.5" />
                          <span>
                            {t('results.watchExplanation')} ({formatTimestamp(q.videoTimestampSeconds)})
                          </span>
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="pt-1 text-sm text-slate-600">
                    <MathBlock text={q.promptLatex} forceLtr className="mt-2 text-slate-900" />
                  </div>
                </CardHeader>

                <CardContent className="space-y-4">
                  {q.type === 'MCQ' && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        {q.isCorrect ? (
                          <Badge tone="success" className="gap-1">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            <span>{t('results.mcqCorrect')}</span>
                          </Badge>
                        ) : (
                          <Badge tone="danger" className="gap-1">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            <span>{t('results.mcqWrong')}</span>
                          </Badge>
                        )}
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {q.mcqOptions.map((opt) => {
                          const selected = opt.id === q.selectedOptionId;
                          return (
                            <div
                              key={opt.id}
                              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                                selected
                                  ? q.isCorrect
                                    ? 'border-emerald-400 bg-emerald-50'
                                    : 'border-red-300 bg-red-50'
                                  : 'border-slate-200 bg-white'
                              }`}
                            >
                              <span className="font-mono text-xs font-bold">{opt.label}.</span>
                              <MathBlock text={opt.textLatex} forceLtr />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {q.type === 'ESSAY' && (
                    <div className="space-y-4">
                      {q.errorExplanationAr && (
                        <Alert tone={q.belowThreshold ? 'warning' : 'info'}>
                          <div className="space-y-1">
                            <div className="font-bold">{t('results.aiFeedback')}</div>
                            <p className="text-sm">{q.errorExplanationAr}</p>
                            {q.hintAr && (
                              <p className="text-xs text-slate-600">
                                <strong>{t('results.aiHint')}: </strong>
                                {q.hintAr}
                              </p>
                            )}
                            {q.teacherNote && (
                              <p className="text-xs font-medium text-brand-800">
                                <strong>{t('results.teacherNote')}: </strong>
                                {q.teacherNote}
                              </p>
                            )}
                          </div>
                        </Alert>
                      )}

                      {q.criteriaBreakdown.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {q.criteriaBreakdown.map((crit) => (
                            <div
                              key={crit.key}
                              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs"
                            >
                              <span className="font-semibold">
                                {locale === 'ar' ? crit.descriptionAr : crit.descriptionEn}
                              </span>{' '}
                              <span dir="ltr" className="font-mono font-bold text-brand-700">
                                ({crit.awardedPoints}/{crit.maxPoints})
                              </span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Side-by-side photo & AI transcription */}
                      {(q.images.length > 0 || q.transcribedLines.length > 0) && (
                        <div className="grid gap-4 md:grid-cols-2">
                          <div className="space-y-2">
                            <div className="text-xs font-semibold text-slate-600">
                              {t('results.studentPhoto')}
                            </div>
                            <div className="grid gap-2">
                              {q.images.map((img, idx) => (
                                <img
                                  key={img.id}
                                  src={img.signedUrl}
                                  alt={`${t('results.studentPhoto')} ${idx + 1}`}
                                  className="max-h-72 w-full rounded-lg border border-slate-200 object-contain bg-slate-50"
                                />
                              ))}
                            </div>
                          </div>

                          <div className="space-y-2">
                            <div className="text-xs font-semibold text-slate-600">
                              {t('results.aiTranscription')}
                            </div>
                            <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                              {q.transcribedLines.map((line) => {
                                const isFirstError = q.firstErrorStep === line.lineNumber;
                                return (
                                  <div
                                    key={line.lineNumber}
                                    data-testid={
                                      isFirstError
                                        ? `first-error-step-${line.lineNumber}`
                                        : undefined
                                    }
                                    className={`rounded-md border p-2 ${
                                      isFirstError
                                        ? 'border-red-400 bg-red-50'
                                        : 'border-slate-200 bg-white'
                                    }`}
                                  >
                                    <div className="mb-1 flex items-center justify-between text-[11px]">
                                      <span className="font-mono text-slate-500" dir="ltr">
                                        L{line.lineNumber}
                                      </span>
                                      <div className="flex items-center gap-1">
                                        {isFirstError && (
                                          <Badge tone="danger">
                                            {t('results.firstErrorStep', {
                                              step: line.lineNumber,
                                            })}
                                          </Badge>
                                        )}
                                        {line.hasUnsure && <Badge tone="warning">?</Badge>}
                                      </div>
                                    </div>
                                    <MathBlock text={`$${line.textLatex}$`} forceLtr />
                                  </div>
                                );
                              })}
                            </div>

                            {q.answerId && (
                              <div className="pt-1">
                                {q.misreadReportedAt ? (
                                  <Alert tone="info" className="py-2 text-xs">
                                    {t('results.misreadSent')}
                                  </Alert>
                                ) : (
                                  <div className="space-y-2">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() =>
                                        setOpenMisreadAnswerId(misreadOpen ? null : q.answerId)
                                      }
                                    >
                                      <Flag className="h-3.5 w-3.5" />
                                      <span>{t('results.reportMisreadBtn')}</span>
                                    </Button>

                                    {misreadOpen && (
                                      <form
                                        className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3"
                                        onSubmit={(e) => {
                                          e.preventDefault();
                                          if (!q.answerId) return;
                                          misreadMutation.mutate({
                                            answerId: q.answerId,
                                            note: misreadNotes[q.answerId],
                                          });
                                        }}
                                      >
                                        <Input
                                          value={misreadNotes[q.answerId] ?? ''}
                                          onChange={(e) =>
                                            setMisreadNotes((prev) => ({
                                              ...prev,
                                              [q.answerId!]: e.target.value,
                                            }))
                                          }
                                          placeholder={t('results.misreadNotePlaceholder')}
                                          aria-label={t('results.misreadNotePlaceholder')}
                                        />
                                        <div className="flex gap-2">
                                          <Button
                                            type="submit"
                                            size="sm"
                                            disabled={misreadMutation.isPending}
                                          >
                                            <Send className="h-3.5 w-3.5" />
                                            <span>{t('results.submitMisread')}</span>
                                          </Button>
                                          <Button
                                            type="button"
                                            size="sm"
                                            variant="ghost"
                                            onClick={() => setOpenMisreadAnswerId(null)}
                                          >
                                            {t('app.cancel')}
                                          </Button>
                                        </div>
                                      </form>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </StudentShell>
  );
}
