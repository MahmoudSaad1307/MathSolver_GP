import { ReviewReasonSchema } from '@mathlens/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  History,
  Pin,
  RefreshCw,
  RotateCw,
  SkipForward,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import { MathBlock } from '@/components/MathBlock';
import { TeacherShell } from '@/components/layouts/TeacherShell';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input, Label } from '@/components/ui/Input';
import { useTeacherAuth } from '@/hooks/useTeacherAuth';
import { apiRequest, getApiErrorMessage } from '@/lib/api';
import { useUiStore } from '@/store/uiStore';
import type { TopicDetail } from '@/types/content';
import type { ReviewQueueItem, ReviewQueueResponse } from '@/types/review';
import type { CohortListItem } from '@/types/student';

const REVIEW_REASONS = ReviewReasonSchema.options;

export default function ReviewQueuePage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const locale = useUiStore((s) => s.locale);
  const meQuery = useTeacherAuth();

  const [topicFilter, setTopicFilter] = React.useState('');
  const [cohortFilter, setCohortFilter] = React.useState('');
  const [reasonFilter, setReasonFilter] = React.useState('');
  const [includeResolved, setIncludeResolved] = React.useState(false);

  const [currentIndex, setCurrentIndex] = React.useState(0);
  const [selectedImageIdx, setSelectedImageIdx] = React.useState(0);
  const [zoom, setZoom] = React.useState(1);
  const [rotation, setRotation] = React.useState(0);
  const [feedbackMsg, setFeedbackMsg] = React.useState<string | null>(null);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  const [criteriaDraft, setCriteriaDraft] = React.useState<Record<string, number>>({});
  const [commentsDraft, setCommentsDraft] = React.useState<Record<string, string>>({});
  const [explanationDraft, setExplanationDraft] = React.useState('');
  const [noteDraft, setNoteDraft] = React.useState('');
  const firstCriterionInputRef = React.useRef<HTMLInputElement | null>(null);

  const topicsQuery = useQuery({
    queryKey: ['teacher', 'topics'],
    queryFn: () => apiRequest<{ topics: TopicDetail[] }>('/topics', { retryRefresh: true }),
    enabled: Boolean(meQuery.data?.teacher),
  });

  const cohortsQuery = useQuery({
    queryKey: ['teacher', 'cohorts'],
    queryFn: () => apiRequest<{ cohorts: CohortListItem[] }>('/cohorts', { retryRefresh: true }),
    enabled: Boolean(meQuery.data?.teacher),
  });

  const queueQuery = useQuery({
    queryKey: ['teacher', 'review-queue', topicFilter, cohortFilter, reasonFilter, includeResolved],
    queryFn: () => {
      const params = new URLSearchParams();
      if (topicFilter) params.set('topicId', topicFilter);
      if (cohortFilter) params.set('cohortId', cohortFilter);
      if (reasonFilter) params.set('reason', reasonFilter);
      if (includeResolved) params.set('includeResolved', 'true');
      const qs = params.toString();
      return apiRequest<ReviewQueueResponse>(`/review-queue${qs ? `?${qs}` : ''}`, {
        retryRefresh: true,
      });
    },
    enabled: Boolean(meQuery.data?.teacher),
  });

  const items = React.useMemo(() => queueQuery.data?.items ?? [], [queueQuery.data]);
  const safeIdx = Math.min(currentIndex, Math.max(0, items.length - 1));
  const currentItem: ReviewQueueItem | undefined = items[safeIdx];

  React.useEffect(() => {
    if (!currentItem) return;
    const scores: Record<string, number> = {};
    const comments: Record<string, string> = {};
    for (const crit of currentItem.effectiveCriteria) {
      scores[crit.criterionId] = crit.effectiveAwarded;
      comments[crit.criterionId] = crit.commentAr;
    }
    setCriteriaDraft(scores);
    setCommentsDraft(comments);
    setExplanationDraft(currentItem.effectiveExplanationAr);
    setNoteDraft('');
    setSelectedImageIdx(0);
    setZoom(1);
    setRotation(0);
    setErrorMsg(null);
  }, [currentItem?.answerId, currentItem?.latestResult?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const submitGradeMutation = useMutation({
    mutationFn: async (vars: {
      item: ReviewQueueItem;
      criteriaScores: Array<{ criterionId: string; awarded: number; commentAr?: string }>;
      errorExplanationAr?: string;
      note?: string;
    }) => {
      const payload = {
        criteriaScores: vars.criteriaScores,
        errorExplanationAr: vars.errorExplanationAr?.trim() || undefined,
        note: vars.note?.trim() || undefined,
      };
      if (vars.item.latestResult) {
        return apiRequest(`/grading-results/${vars.item.latestResult.id}/override`, {
          method: 'POST',
          body: JSON.stringify(payload),
          retryRefresh: true,
        });
      }
      return apiRequest(`/answers/${vars.item.answerId}/manual-grade`, {
        method: 'POST',
        body: JSON.stringify(payload),
        retryRefresh: true,
      });
    },
    onSuccess: async () => {
      setErrorMsg(null);
      setFeedbackMsg(t('app.save'));
      await queryClient.invalidateQueries({ queryKey: ['teacher', 'review-queue'] });
    },
    onError: (err) => {
      setErrorMsg(getApiErrorMessage(err, locale, t('errors.generic')));
    },
  });

  const retranscribeMutation = useMutation({
    mutationFn: async (answerId: string) =>
      apiRequest(`/answers/${answerId}/retranscribe`, {
        method: 'POST',
        retryRefresh: true,
      }),
    onSuccess: async () => {
      setErrorMsg(null);
      setFeedbackMsg(t('review.retranscribeQueued'));
      await queryClient.invalidateQueries({ queryKey: ['teacher', 'review-queue'] });
    },
    onError: (err) => {
      setErrorMsg(getApiErrorMessage(err, locale, t('errors.generic')));
    },
  });

  const pinMutation = useMutation({
    mutationFn: async (vars: { imageId: string; pinned: boolean }) =>
      apiRequest(`/answer-images/${vars.imageId}/pin`, {
        method: 'PATCH',
        body: JSON.stringify({ pinned: vars.pinned }),
        retryRefresh: true,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['teacher', 'review-queue'] });
    },
    onError: (err) => {
      setErrorMsg(getApiErrorMessage(err, locale, t('errors.generic')));
    },
  });

  const handleApproveAi = React.useCallback(() => {
    if (!currentItem || submitGradeMutation.isPending) return;
    submitGradeMutation.mutate({
      item: currentItem,
      criteriaScores: currentItem.effectiveCriteria.map((c) => ({
        criterionId: c.criterionId,
        awarded: c.aiAwarded,
        commentAr: c.commentAr || undefined,
      })),
      errorExplanationAr: currentItem.latestResult?.errorExplanationAr || explanationDraft,
      note: 'AI grade confirmed',
    });
  }, [currentItem, explanationDraft, submitGradeMutation]);

  // Keyboard shortcuts: J (next), K (prev), A (approve AI), E (focus criteria edit)
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (items.length === 0) return;

      const key = e.key.toLowerCase();
      if (key === 'j') {
        e.preventDefault();
        setCurrentIndex((prev) => (prev + 1 < items.length ? prev + 1 : 0));
      } else if (key === 'k') {
        e.preventDefault();
        setCurrentIndex((prev) => (prev - 1 >= 0 ? prev - 1 : items.length - 1));
      } else if (key === 'a') {
        e.preventDefault();
        handleApproveAi();
      } else if (key === 'e') {
        e.preventDefault();
        firstCriterionInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [items.length, handleApproveAi]);

  if (meQuery.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-slate-600">
        {t('app.loading')}
      </div>
    );
  }

  if (meQuery.isError || !meQuery.data?.teacher) {
    return <Navigate to="/teacher/login" replace />;
  }

  const liveTotal = currentItem
    ? Math.round(
        currentItem.effectiveCriteria.reduce((acc, c) => {
          const val = criteriaDraft[c.criterionId] ?? c.effectiveAwarded;
          const clamped = Math.max(0, Math.min(c.maxPoints, val));
          return acc + clamped;
        }, 0) * 100,
      ) / 100
    : 0;

  const activeImage = currentItem?.images[selectedImageIdx] ?? currentItem?.images[0];

  return (
    <TeacherShell teacherName={meQuery.data.teacher.displayName}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{t('review.title')}</h1>
            <p className="mt-1 text-sm text-slate-600">{t('review.subtitle')}</p>
            <p className="mt-1 text-xs text-slate-500">{t('review.shortcutsHint')}</p>
          </div>
          <Badge tone={queueQuery.data?.pendingCount ? 'warning' : 'success'}>
            {t('review.pendingCount', { count: queueQuery.data?.pendingCount ?? 0 })}
          </Badge>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 pt-4">
            <select
              aria-label={t('review.filterTopic')}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              value={topicFilter}
              onChange={(e) => {
                setTopicFilter(e.target.value);
                setCurrentIndex(0);
              }}
            >
              <option value="">{t('review.filterTopic')}</option>
              {(topicsQuery.data?.topics ?? []).map((topic) => (
                <option key={topic.id} value={topic.id}>
                  {topic.title}
                </option>
              ))}
            </select>

            <select
              aria-label={t('review.filterCohort')}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              value={cohortFilter}
              onChange={(e) => {
                setCohortFilter(e.target.value);
                setCurrentIndex(0);
              }}
            >
              <option value="">{t('review.filterCohort')}</option>
              {(cohortsQuery.data?.cohorts ?? []).map((cohort) => (
                <option key={cohort.id} value={cohort.id}>
                  {cohort.name}
                </option>
              ))}
            </select>

            <select
              aria-label={t('review.filterReason')}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              value={reasonFilter}
              onChange={(e) => {
                setReasonFilter(e.target.value);
                setCurrentIndex(0);
              }}
            >
              <option value="">{t('review.filterReason')}</option>
              {REVIEW_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>

            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={includeResolved}
                onChange={(e) => {
                  setIncludeResolved(e.target.checked);
                  setCurrentIndex(0);
                }}
              />
              <span>{t('review.showResolved')}</span>
            </label>
          </CardContent>
        </Card>

        {feedbackMsg && <Alert tone="success">{feedbackMsg}</Alert>}
        {errorMsg && <Alert tone="danger">{errorMsg}</Alert>}

        {items.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-slate-600">
              {t('review.emptyQueue')}
            </CardContent>
          </Card>
        ) : (
          currentItem && (
            <div className="space-y-4">
              {/* Navigation bar */}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-bold text-slate-900">
                    {currentItem.student.displayName}
                  </span>
                  <span className="text-slate-400">·</span>
                  <span className="text-slate-600">{currentItem.cohort.name}</span>
                  <span className="text-slate-400">·</span>
                  <span className="text-slate-600">
                    {currentItem.examModel.title} (#{currentItem.question.orderIndex})
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-slate-500" dir="ltr">
                    {safeIdx + 1} / {items.length}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setCurrentIndex((prev) => (prev - 1 >= 0 ? prev - 1 : items.length - 1))
                    }
                  >
                    <ChevronRight className="h-4 w-4" />
                    <span>{t('review.prevItem')}</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setCurrentIndex((prev) => (prev + 1 < items.length ? prev + 1 : 0))
                    }
                  >
                    <span>{t('review.nextItem')}</span>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Split Workspace */}
              <div className="grid gap-5 lg:grid-cols-2">
                {/* Left: Photo + Transcription + Model Answer */}
                <div className="space-y-4">
                  <Card>
                    <CardHeader>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <CardTitle>
                          #{currentItem.question.orderIndex} · {currentItem.question.conceptKey}
                        </CardTitle>
                        <div className="flex flex-wrap gap-1">
                          {currentItem.reviewReasons.map((reason) => (
                            <Badge key={reason} tone="warning">
                              {reason}
                            </Badge>
                          ))}
                        </div>
                      </div>
                      <div className="pt-1 text-sm text-slate-600">
                        <MathBlock
                          text={currentItem.question.promptLatex}
                          forceLtr
                          className="mt-2 text-slate-900"
                        />
                      </div>
                    </CardHeader>

                    <CardContent className="space-y-3">
                      {currentItem.misreadReportedAt && (
                        <Alert tone="warning" className="text-xs">
                          <div className="flex items-center gap-2 font-bold">
                            <AlertTriangle className="h-4 w-4 shrink-0" />
                            <span>{t('review.studentMisreadAlert')}</span>
                          </div>
                          {currentItem.misreadNote && (
                            <p className="mt-1 text-slate-700">{currentItem.misreadNote}</p>
                          )}
                        </Alert>
                      )}

                      {activeImage && (
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-1">
                              <Button
                                size="sm"
                                variant="outline"
                                aria-label={t('review.zoomIn')}
                                onClick={() => setZoom((z) => Math.min(2.5, z + 0.25))}
                              >
                                <ZoomIn className="h-4 w-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                aria-label={t('review.zoomOut')}
                                onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
                              >
                                <ZoomOut className="h-4 w-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                aria-label={t('review.rotate')}
                                onClick={() => setRotation((r) => (r + 90) % 360)}
                              >
                                <RotateCw className="h-4 w-4" />
                              </Button>
                            </div>

                            <Button
                              size="sm"
                              variant={activeImage.pinnedByTeacher ? 'primary' : 'outline'}
                              disabled={pinMutation.isPending}
                              onClick={() =>
                                pinMutation.mutate({
                                  imageId: activeImage.id,
                                  pinned: !activeImage.pinnedByTeacher,
                                })
                              }
                            >
                              <Pin className="h-3.5 w-3.5" />
                              <span>
                                {activeImage.pinnedByTeacher
                                  ? t('review.unpinImage')
                                  : t('review.pinImage')}
                              </span>
                            </Button>
                          </div>

                          <div className="overflow-auto rounded-lg border border-slate-200 bg-slate-100 p-2 text-center">
                            <img
                              src={activeImage.signedUrl}
                              alt={t('results.studentPhoto')}
                              className="mx-auto max-h-96 object-contain transition-transform"
                              style={{
                                transform: `scale(${zoom}) rotate(${rotation}deg)`,
                              }}
                            />
                          </div>

                          {currentItem.images.length > 1 && (
                            <div className="flex gap-2">
                              {currentItem.images.map((img, i) => (
                                <Button
                                  key={img.id}
                                  size="sm"
                                  variant={i === selectedImageIdx ? 'primary' : 'outline'}
                                  onClick={() => setSelectedImageIdx(i)}
                                >
                                  #{i + 1}
                                </Button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {currentItem.latestResult &&
                        currentItem.latestResult.transcribedLines.length > 0 && (
                          <div className="space-y-1.5 rounded-lg border border-slate-200 bg-slate-50 p-3">
                            <div className="text-xs font-semibold text-slate-600">
                              {t('results.aiTranscription')}
                            </div>
                            {currentItem.latestResult.transcribedLines.map((line) => (
                              <div
                                key={line.lineNumber}
                                className="flex items-center gap-2 text-sm"
                              >
                                <span className="font-mono text-xs text-slate-400" dir="ltr">
                                  L{line.lineNumber}
                                </span>
                                <MathBlock text={`$${line.textLatex}$`} forceLtr />
                              </div>
                            ))}
                          </div>
                        )}

                      {currentItem.question.modelAnswer && (
                        <div className="space-y-1.5 rounded-lg border border-brand-200 bg-brand-50/50 p-3">
                          <div className="text-xs font-bold text-brand-900">
                            {t('review.modelAnswer')}
                          </div>
                          {currentItem.question.modelAnswer.solutionStepsLatex.map((step, idx) => (
                            <MathBlock key={idx} text={step} forceLtr className="text-sm" />
                          ))}
                          <div className="border-t border-brand-200 pt-1 text-xs font-semibold text-brand-900">
                            <MathBlock
                              text={`Final: $${currentItem.question.modelAnswer.finalAnswerLatex}$`}
                              forceLtr
                            />
                          </div>
                          {currentItem.question.solutionUrl && (
                            <div className="pt-1">
                              <a
                                href={currentItem.question.solutionUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline"
                              >
                                <ExternalLink className="h-3 w-3" />
                                <span>{t('teacher.builder.solutionLink')}</span>
                              </a>
                            </div>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>

                {/* Right: Rubric Checklist + Actions + Override History */}
                <div className="space-y-4">
                  <Card>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <CardTitle>{t('review.criteriaChecklist')}</CardTitle>
                        <div className="text-sm font-bold text-brand-700" dir="ltr">
                          {t('review.liveTotal')}: {liveTotal} / {currentItem.question.points}
                        </div>
                      </div>
                    </CardHeader>

                    <CardContent className="space-y-4">
                      <form
                        className="space-y-4"
                        onSubmit={(e) => {
                          e.preventDefault();
                          submitGradeMutation.mutate({
                            item: currentItem,
                            criteriaScores: currentItem.effectiveCriteria.map((c) => ({
                              criterionId: c.criterionId,
                              awarded: criteriaDraft[c.criterionId] ?? c.effectiveAwarded,
                              commentAr: commentsDraft[c.criterionId] || undefined,
                            })),
                            errorExplanationAr: explanationDraft,
                            note: noteDraft,
                          });
                        }}
                      >
                        <div className="space-y-3">
                          {currentItem.effectiveCriteria.map((crit, cIdx) => {
                            const scoreVal =
                              criteriaDraft[crit.criterionId] ?? crit.effectiveAwarded;
                            return (
                              <div
                                key={crit.criterionId}
                                className="space-y-2 rounded-lg border border-slate-200 p-3"
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div>
                                    <div className="text-sm font-semibold text-slate-900">
                                      {locale === 'ar' ? crit.descriptionAr : crit.descriptionEn}
                                    </div>
                                    <div className="text-xs text-slate-500">
                                      {t('review.aiAwarded', {
                                        score: `${crit.aiAwarded}/${crit.maxPoints}`,
                                      })}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-1.5" dir="ltr">
                                    <Input
                                      ref={cIdx === 0 ? firstCriterionInputRef : undefined}
                                      type="number"
                                      step="0.5"
                                      min={0}
                                      max={crit.maxPoints}
                                      aria-label={crit.descriptionAr}
                                      className="w-20 text-center font-mono"
                                      value={scoreVal}
                                      onChange={(e) => {
                                        const num = Number(e.target.value);
                                        setCriteriaDraft((prev) => ({
                                          ...prev,
                                          [crit.criterionId]: Number.isFinite(num) ? num : 0,
                                        }));
                                      }}
                                    />
                                    <span className="text-xs text-slate-500">
                                      / {crit.maxPoints}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        <div className="space-y-1.5">
                          <Label htmlFor="review-explanation">{t('review.explanationAr')}</Label>
                          <textarea
                            id="review-explanation"
                            rows={3}
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                            value={explanationDraft}
                            onChange={(e) => setExplanationDraft(e.target.value)}
                          />
                        </div>

                        <div className="space-y-1.5">
                          <Label htmlFor="review-note">{t('review.teacherNoteLabel')}</Label>
                          <Input
                            id="review-note"
                            value={noteDraft}
                            onChange={(e) => setNoteDraft(e.target.value)}
                          />
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <Button type="submit" disabled={submitGradeMutation.isPending}>
                            <Check className="h-4 w-4" />
                            <span>{t('review.saveGrade')}</span>
                          </Button>

                          {currentItem.latestResult && (
                            <Button
                              type="button"
                              variant="outline"
                              disabled={submitGradeMutation.isPending}
                              onClick={handleApproveAi}
                            >
                              <span>{t('review.approveAi')}</span>
                            </Button>
                          )}

                          <Button
                            type="button"
                            variant="outline"
                            disabled={retranscribeMutation.isPending}
                            onClick={() => retranscribeMutation.mutate(currentItem.answerId)}
                          >
                            <RefreshCw className="h-4 w-4" />
                            <span>{t('review.retranscribe')}</span>
                          </Button>

                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() =>
                              setCurrentIndex((prev) => (prev + 1 < items.length ? prev + 1 : 0))
                            }
                          >
                            <SkipForward className="h-4 w-4" />
                            <span>{t('review.skipItem')}</span>
                          </Button>
                        </div>
                      </form>

                      {currentItem.overrideHistory.length > 0 && (
                        <div className="space-y-2 border-t border-slate-200 pt-3">
                          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                            <History className="h-3.5 w-3.5" />
                            <span>{t('review.overrideHistory')}</span>
                          </div>
                          <div className="space-y-1.5">
                            {currentItem.overrideHistory.map((ov) => (
                              <div
                                key={ov.id}
                                className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs"
                              >
                                <div className="flex justify-between font-semibold">
                                  <span dir="ltr">{ov.newTotal} pts</span>
                                  <span className="text-slate-500" dir="ltr">
                                    {new Date(ov.createdAt).toLocaleString()}
                                  </span>
                                </div>
                                {ov.note && <p className="mt-0.5 text-slate-600">{ov.note}</p>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </div>
            </div>
          )
        )}
      </div>
    </TeacherShell>
  );
}
