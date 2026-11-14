import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCheck, Loader2, Save, ZoomIn, ZoomOut } from 'lucide-react';
import * as React from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { TeacherShell } from '@/components/layouts/TeacherShell';
import { PdfQuestionPreviewCard } from '@/components/teacher/PdfQuestionPreviewCard';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input, Label } from '@/components/ui/Input';
import { useTeacherAuth } from '@/hooks/useTeacherAuth';
import { apiRequest, getApiErrorMessage } from '@/lib/api';
import { useUiStore } from '@/store/uiStore';
import type {
  ExtractedModelPreview,
  ExtractedQuestionPreview,
  PdfImportJobResponse,
} from '@/types/content';

export default function PdfImportPreviewPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const locale = useUiStore((s) => s.locale);
  const meQuery = useTeacherAuth();

  const [modelsState, setModelsState] = React.useState<ExtractedModelPreview[]>([]);
  const [activeTab, setActiveTab] = React.useState<'m1' | 'm2' | 'twins'>('m1');
  const [flaggedOnly, setFlaggedOnly] = React.useState(false);
  const [viewerModel, setViewerModel] = React.useState<1 | 2>(1);
  const [viewerPage, setViewerPage] = React.useState<number>(1);
  const [zoom, setZoom] = React.useState(1);
  const [savingDraft, setSavingDraft] = React.useState(false);
  const [applying, setApplying] = React.useState(false);
  const [actionError, setActionError] = React.useState('');
  const [actionSuccess, setActionSuccess] = React.useState('');

  const jobQuery = useQuery({
    queryKey: ['teacher', 'pdf-import', jobId],
    queryFn: () => apiRequest<{ job: PdfImportJobResponse }>(`/pdf-imports/${jobId}`),
    enabled: Boolean(meQuery.data?.teacher && jobId),
    refetchInterval: (query) => {
      const st = query.state.data?.job.status;
      return st === 'QUEUED' || st === 'PROCESSING' ? 1800 : false;
    },
  });

  const job = jobQuery.data?.job;

  React.useEffect(() => {
    if (!job?.preview?.models.length || modelsState.length > 0) return;
    setModelsState(job.preview.models);
    const firstModel = job.preview.models[0]!;
    setActiveTab(firstModel.modelNumber === 1 ? 'm1' : 'm2');
    setViewerModel(firstModel.modelNumber);
    setViewerPage(firstModel.pages[0]?.pageNumber ?? 1);
  }, [job, modelsState.length]);

  if (meQuery.isLoading) {
    return <div className="p-8 text-center text-slate-600">{t('common.loading')}</div>;
  }
  if (!meQuery.data?.teacher) {
    return <Navigate to="/teacher/login" replace />;
  }

  function updateQuestion(modelNumber: 1 | 2, updatedQ: ExtractedQuestionPreview) {
    setModelsState((prev) =>
      prev.map((m) =>
        m.modelNumber !== modelNumber
          ? m
          : {
              ...m,
              questions: m.questions.map((q) => (q.tempId === updatedQ.tempId ? updatedQ : q)),
            },
      ),
    );
  }

  function verifyAllClearItems() {
    setModelsState((prev) =>
      prev.map((m) => ({
        ...m,
        questions: m.questions.map((q) =>
          !q.needsTeacherConfirmation ? { ...q, verifiedByTeacher: true } : q,
        ),
      })),
    );
  }

  function handleInspectPage(modelNum: 1 | 2, pageNum: number) {
    setViewerModel(modelNum);
    setViewerPage(pageNum);
  }

  async function handleSaveDraft() {
    if (!jobId || modelsState.length === 0) return;
    setActionError('');
    setActionSuccess('');
    setSavingDraft(true);
    try {
      await apiRequest<{ job: PdfImportJobResponse }>(`/pdf-imports/${jobId}/draft`, {
        method: 'PUT',
        body: JSON.stringify({
          models: modelsState.map((m) => ({
            modelNumber: m.modelNumber,
            title: m.title,
            durationMinutes: m.durationMinutes,
            questions: m.questions,
          })),
        }),
      });
      setActionSuccess(t('pdfImport.draftSaved'));
    } catch (err) {
      setActionError(getApiErrorMessage(err, locale, t('errors.generic')));
    } finally {
      setSavingDraft(false);
    }
  }

  async function handleApply(confirmAllReviewed = false) {
    if (!jobId || modelsState.length === 0) return;
    setActionError('');
    setActionSuccess('');

    const unverifiedCount = modelsState.reduce(
      (acc, m) =>
        acc + m.questions.filter((q) => q.needsTeacherConfirmation && !q.verifiedByTeacher).length,
      0,
    );
    if (!confirmAllReviewed && unverifiedCount > 0) {
      setActionError(t('pdfImport.unverifiedBlock', { count: unverifiedCount }));
      return;
    }

    setApplying(true);
    try {
      const res = await apiRequest<{
        job: PdfImportJobResponse;
        topic: { id: string } | null;
      }>(`/pdf-imports/${jobId}/apply`, {
        method: 'POST',
        body: JSON.stringify({
          targetTopicId: job?.topicId ?? undefined,
          confirmAllReviewed,
          models: modelsState.map((m) => ({
            modelNumber: m.modelNumber,
            title: m.title,
            durationMinutes: m.durationMinutes,
            questions: m.questions,
          })),
        }),
      });
      await queryClient.invalidateQueries({ queryKey: ['teacher', 'topics'] });
      setActionSuccess(t('pdfImport.appliedBanner'));
      const destinationId = res.topic?.id ?? res.job.appliedTopicId;
      if (destinationId) {
        void navigate(`/teacher/topics/${destinationId}`);
      } else {
        void navigate('/teacher/topics');
      }
    } catch (err) {
      setActionError(getApiErrorMessage(err, locale, t('errors.generic')));
    } finally {
      setApplying(false);
    }
  }

  const allQuestions = modelsState.flatMap((m) => m.questions);
  const totalQuestions = allQuestions.length;
  const totalMatched = modelsState.reduce((acc, m) => acc + m.matchedCount, 0);
  const totalFlagged = allQuestions.filter(
    (q) => q.needsTeacherConfirmation && !q.verifiedByTeacher,
  ).length;
  const totalSympyVerified = allQuestions.filter((q) => q.sympyStatus === 'VERIFIED').length;

  const model1 = modelsState.find((m) => m.modelNumber === 1);
  const model2 = modelsState.find((m) => m.modelNumber === 2);
  const activeModel =
    activeTab === 'm1' ? (model1 ?? modelsState[0]) : activeTab === 'm2' ? model2 : undefined;

  const viewerModelObj = modelsState.find((m) => m.modelNumber === viewerModel) ?? modelsState[0];
  const viewerPages = viewerModelObj?.pages ?? [];
  const currentPageMeta =
    viewerPages.find((p) => p.pageNumber === viewerPage) ?? viewerPages[0] ?? null;

  return (
    <TeacherShell teacherName={meQuery.data.teacher.displayName}>
      <div className="space-y-5">
        {/* Top bar */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link
              to="/teacher/topics"
              className="mb-1 inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>{t('pdfImport.backToTopics')}</span>
            </Link>
            <h1 className="text-2xl font-bold text-slate-900">{t('pdfImport.previewTitle')}</h1>
            <p className="mt-1 text-sm text-slate-600">{t('pdfImport.previewSubtitle')}</p>
          </div>
          {modelsState.length > 0 && job?.status === 'READY_FOR_REVIEW' && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={verifyAllClearItems}>
                <CheckCheck className="h-4 w-4" />
                <span>{t('pdfImport.verifyAllClear')}</span>
              </Button>
              <Button
                variant="outline"
                onClick={() => void handleSaveDraft()}
                disabled={savingDraft}
              >
                <Save className="h-4 w-4" />
                <span>{t('pdfImport.saveDraft')}</span>
              </Button>
              <Button onClick={() => void handleApply(false)} disabled={applying}>
                {applying ? t('pdfImport.applying') : t('pdfImport.confirmAndApply')}
              </Button>
            </div>
          )}
        </div>

        {/* Loading / polling / failed states */}
        {jobQuery.isLoading && (
          <Card>
            <CardContent className="flex items-center gap-3 py-8 text-slate-600">
              <Loader2 className="h-5 w-5 animate-spin text-brand-600" />
              <span>{t('common.loading')}</span>
            </CardContent>
          </Card>
        )}

        {job && (job.status === 'QUEUED' || job.status === 'PROCESSING') && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Loader2 className="h-5 w-5 animate-spin text-brand-600" />
                <span>{t('pdfImport.processingTitle')}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="h-3 w-full overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full bg-brand-600 transition-all duration-500"
                  style={{ width: `${Math.max(8, job.progressPct)}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-sm text-slate-700">
                <span>{t(`pdfImport.stage_${job.currentStage}`, job.currentStage)}</span>
                <span className="font-mono font-semibold">{job.progressPct}%</span>
              </div>
            </CardContent>
          </Card>
        )}

        {job && job.status === 'FAILED' && (
          <Alert tone="danger">
            <div className="font-bold">{t('pdfImport.failedTitle')}</div>
            <div className="mt-1 text-sm">{job.errorMessage ?? job.errorCode}</div>
          </Alert>
        )}

        {actionError && <Alert tone="danger">{actionError}</Alert>}
        {actionSuccess && <Alert tone="success">{actionSuccess}</Alert>}

        {/* Main Workbench */}
        {modelsState.length > 0 && (
          <>
            {/* Summary metrics */}
            <div className="grid gap-3 sm:grid-cols-4">
              <Card className="p-4">
                <div className="text-xs font-medium text-slate-500">
                  {t('pdfImport.totalQuestions')}
                </div>
                <div className="mt-1 text-2xl font-bold text-slate-900">{totalQuestions}</div>
              </Card>
              <Card className="p-4">
                <div className="text-xs font-medium text-slate-500">
                  {t('pdfImport.matchedAnswers')}
                </div>
                <div className="mt-1 text-2xl font-bold text-slate-900">{totalMatched}</div>
              </Card>
              <Card className="p-4">
                <div className="text-xs font-medium text-slate-500">
                  {t('pdfImport.flaggedCount')}
                </div>
                <div
                  className={`mt-1 text-2xl font-bold ${
                    totalFlagged > 0 ? 'text-amber-700' : 'text-emerald-700'
                  }`}
                >
                  {totalFlagged}
                </div>
              </Card>
              <Card className="p-4">
                <div className="text-xs font-medium text-slate-500">
                  {t('pdfImport.sympyVerifiedCount')}
                </div>
                <div className="mt-1 text-2xl font-bold text-emerald-700">{totalSympyVerified}</div>
              </Card>
            </div>

            {/* Tabs & filter bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
              <div className="flex flex-wrap gap-2">
                {model1 && (
                  <Button
                    variant={activeTab === 'm1' ? 'primary' : 'outline'}
                    size="sm"
                    onClick={() => {
                      setActiveTab('m1');
                      setViewerModel(1);
                      setViewerPage(1);
                    }}
                  >
                    {t('pdfImport.tabModel1')} ({model1.questions.length})
                  </Button>
                )}
                {model2 && (
                  <Button
                    variant={activeTab === 'm2' ? 'primary' : 'outline'}
                    size="sm"
                    onClick={() => {
                      setActiveTab('m2');
                      setViewerModel(2);
                      setViewerPage(1);
                    }}
                  >
                    {t('pdfImport.tabModel2')} ({model2.questions.length})
                  </Button>
                )}
                <Button
                  variant={activeTab === 'twins' ? 'primary' : 'outline'}
                  size="sm"
                  onClick={() => setActiveTab('twins')}
                >
                  {t('pdfImport.tabTwins')}
                </Button>
              </div>

              {activeTab !== 'twins' && (
                <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={flaggedOnly}
                    onChange={(e) => setFlaggedOnly(e.target.checked)}
                  />
                  <span>{t('pdfImport.flaggedOnly')}</span>
                </label>
              )}
            </div>

            {activeTab === 'twins' && job?.preview ? (
              <div className="grid gap-4 md:grid-cols-3">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">{t('pdfImport.twinMatched')}</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-wrap gap-1.5">
                    {job.preview.twinSummary.matchedConceptKeys.length === 0 ? (
                      <span className="text-sm text-slate-500">{t('pdfImport.twinNone')}</span>
                    ) : (
                      job.preview.twinSummary.matchedConceptKeys.map((k) => (
                        <Badge key={k} tone="success">
                          {k}
                        </Badge>
                      ))
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">{t('pdfImport.twinOnlyM1')}</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-wrap gap-1.5">
                    {job.preview.twinSummary.onlyInModel1.length === 0 ? (
                      <span className="text-sm text-slate-500">{t('pdfImport.twinNone')}</span>
                    ) : (
                      job.preview.twinSummary.onlyInModel1.map((k) => (
                        <Badge key={k} tone="warning">
                          {k}
                        </Badge>
                      ))
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">{t('pdfImport.twinOnlyM2')}</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-wrap gap-1.5">
                    {job.preview.twinSummary.onlyInModel2.length === 0 ? (
                      <span className="text-sm text-slate-500">{t('pdfImport.twinNone')}</span>
                    ) : (
                      job.preview.twinSummary.onlyInModel2.map((k) => (
                        <Badge key={k} tone="warning">
                          {k}
                        </Badge>
                      ))
                    )}
                  </CardContent>
                </Card>
              </div>
            ) : activeModel ? (
              <div className="grid gap-6 lg:grid-cols-12">
                {/* Left pane: extracted questions */}
                <div className="space-y-4 lg:col-span-7">
                  {activeModel.reportWarnings.map((rw, idx) => (
                    <Alert key={idx} tone="warning">
                      {locale === 'ar' ? rw.messageAr : rw.messageEn}
                    </Alert>
                  ))}

                  <Card className="p-4">
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="sm:col-span-2">
                        <Label>
                          {activeModel.modelNumber === 1
                            ? t('pdfImport.preModelTitle')
                            : t('pdfImport.postModelTitle')}
                        </Label>
                        <Input
                          value={activeModel.title}
                          onChange={(e) => {
                            const nextTitle = e.target.value;
                            setModelsState((prev) =>
                              prev.map((m) =>
                                m.modelNumber === activeModel.modelNumber
                                  ? { ...m, title: nextTitle }
                                  : m,
                              ),
                            );
                          }}
                        />
                      </div>
                      <div>
                        <Label>{t('pdfImport.durationMinutes')}</Label>
                        <Input
                          type="number"
                          min="5"
                          max="300"
                          value={activeModel.durationMinutes}
                          onChange={(e) => {
                            const dur = Math.max(5, Number(e.target.value) || 60);
                            setModelsState((prev) =>
                              prev.map((m) =>
                                m.modelNumber === activeModel.modelNumber
                                  ? { ...m, durationMinutes: dur }
                                  : m,
                              ),
                            );
                          }}
                        />
                      </div>
                    </div>
                  </Card>

                  {(() => {
                    const visibleQuestions = flaggedOnly
                      ? activeModel.questions.filter(
                          (q) => q.needsTeacherConfirmation && !q.verifiedByTeacher,
                        )
                      : activeModel.questions;
                    if (visibleQuestions.length === 0) {
                      return <Alert tone="info">{t('pdfImport.noQuestionsFilter')}</Alert>;
                    }
                    return visibleQuestions.map((q) => (
                      <PdfQuestionPreviewCard
                        key={q.tempId}
                        modelNumber={activeModel.modelNumber}
                        question={q}
                        locale={locale}
                        onChange={(updated) => updateQuestion(activeModel.modelNumber, updated)}
                        onInspectPage={handleInspectPage}
                      />
                    ));
                  })()}
                </div>

                {/* Right pane: sticky PDF page viewer */}
                <div className="lg:col-span-5">
                  <Card className="sticky top-4 p-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="text-sm font-bold text-slate-900">
                          {t('pdfImport.pdfViewerTitle')}
                        </h3>
                        {currentPageMeta && (
                          <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-600">
                            <span>
                              {t('pdfImport.pageOf', {
                                page: currentPageMeta.pageNumber,
                                total: viewerPages.length,
                              })}
                            </span>
                            <Badge tone="neutral">{currentPageMeta.role}</Badge>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setZoom((z) => Math.max(0.75, z - 0.25))}
                          aria-label="Zoom out"
                        >
                          <ZoomOut className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setZoom((z) => Math.min(1.75, z + 0.25))}
                          aria-label="Zoom in"
                        >
                          <ZoomIn className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>

                    {/* Page selector chips */}
                    <div className="mb-3 flex flex-wrap gap-1.5">
                      {viewerPages.map((pg) => (
                        <button
                          key={pg.pageNumber}
                          type="button"
                          onClick={() => setViewerPage(pg.pageNumber)}
                          className={`rounded-md border px-2.5 py-1 text-xs font-semibold ${
                            pg.pageNumber === currentPageMeta?.pageNumber
                              ? 'border-brand-600 bg-brand-600 text-white'
                              : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          {pg.pageNumber}
                        </button>
                      ))}
                    </div>

                    <div className="max-h-[70vh] overflow-auto rounded-lg border border-slate-200 bg-slate-100 p-2">
                      {currentPageMeta?.imageUrl ? (
                        <img
                          src={currentPageMeta.imageUrl}
                          alt={`Model ${viewerModel} Page ${currentPageMeta.pageNumber}`}
                          className="mx-auto rounded bg-white shadow-sm transition-transform"
                          style={{ width: `${Math.round(zoom * 100)}%`, maxWidth: 'none' }}
                        />
                      ) : (
                        <div className="p-8 text-center text-sm text-slate-500">
                          {t('pdfImport.noPageSelected')}
                        </div>
                      )}
                    </div>
                  </Card>
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </TeacherShell>
  );
}
