import { extractYoutubeVideoId, UpdateTopicSchema } from '@mathlens/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Download,
  ExternalLink,
  FileUp,
  Link2,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useParams } from 'react-router-dom';
import { TeacherShell } from '@/components/layouts/TeacherShell';
import { MathBlock } from '@/components/MathBlock';
import { ImportBundleModal } from '@/components/teacher/ImportBundleModal';
import { QuestionEditorModal } from '@/components/teacher/QuestionEditorModal';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input, Label } from '@/components/ui/Input';
import { useTeacherAuth } from '@/hooks/useTeacherAuth';
import { apiRequest, getApiErrorMessage } from '@/lib/api';
import { downloadTopicJson } from '@/lib/exportBundle';
import { useUiStore } from '@/store/uiStore';
import type { ExamModelItem, QuestionItem, TopicDetail } from '@/types/content';

export default function TopicBuilderPage() {
  const { topicId } = useParams<{ topicId: string }>();
  const { t } = useTranslation();
  const locale = useUiStore((s) => s.locale);
  const queryClient = useQueryClient();
  const meQuery = useTeacherAuth();

  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [correctnessThreshold, setCorrectnessThreshold] = React.useState(0.6);
  const [bannerFeedback, setBannerFeedback] = React.useState<{
    tone: 'success' | 'danger';
    text: string;
  } | null>(null);

  const [editingModalState, setEditingModalState] = React.useState<{
    examId: string;
    nextOrderIndex: number;
    question?: QuestionItem | null;
  } | null>(null);
  const [showImport, setShowImport] = React.useState(false);

  const topicQuery = useQuery({
    queryKey: ['teacher', 'topic', topicId],
    queryFn: () =>
      apiRequest<{ topic: TopicDetail }>(`/topics/${topicId ?? ''}`, { retryRefresh: true }),
    enabled: Boolean(meQuery.data?.teacher && topicId),
  });

  const topic = topicQuery.data?.topic;

  React.useEffect(() => {
    if (topic) {
      setTitle(topic.title);
      setDescription(topic.description);
      setCorrectnessThreshold(topic.correctnessThreshold);
    }
  }, [topic]);

  const refreshTopic = () => {
    void queryClient.invalidateQueries({ queryKey: ['teacher', 'topic', topicId] });
    void queryClient.invalidateQueries({ queryKey: ['teacher', 'topics'] });
  };

  const updateTopicMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiRequest<{ topic: TopicDetail }>(`/topics/${topicId ?? ''}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
        retryRefresh: true,
      }),
    onSuccess: () => {
      setBannerFeedback({
        tone: 'success',
        text: locale === 'ar' ? 'تم حفظ إعدادات الموضوع.' : 'Topic settings saved.',
      });
      refreshTopic();
    },
    onError: (err) => {
      setBannerFeedback({
        tone: 'danger',
        text: getApiErrorMessage(err, locale, t('errors.generic')),
      });
    },
  });

  const publishMutation = useMutation({
    mutationFn: ({ examId, publish }: { examId: string; publish: boolean }) =>
      apiRequest(`/exams/${examId}/${publish ? 'publish' : 'unpublish'}`, {
        method: 'POST',
        retryRefresh: true,
      }),
    onSuccess: () => {
      setBannerFeedback({
        tone: 'success',
        text: locale === 'ar' ? 'تم تحديث حالة النشر بنجاح.' : 'Exam publish status updated.',
      });
      refreshTopic();
    },
    onError: (err) => {
      setBannerFeedback({
        tone: 'danger',
        text: getApiErrorMessage(err, locale, t('errors.generic')),
      });
    },
  });

  const confirmQuestionMutation = useMutation({
    mutationFn: (questionId: string) =>
      apiRequest(`/questions/${questionId}/confirm`, {
        method: 'POST',
        retryRefresh: true,
      }),
    onSuccess: () => {
      refreshTopic();
    },
    onError: (err) => {
      setBannerFeedback({
        tone: 'danger',
        text: getApiErrorMessage(err, locale, t('errors.generic')),
      });
    },
  });

  const deleteQuestionMutation = useMutation({
    mutationFn: (questionId: string) =>
      apiRequest<void>(`/questions/${questionId}`, {
        method: 'DELETE',
        retryRefresh: true,
      }),
    onSuccess: () => {
      refreshTopic();
    },
  });

  if (meQuery.isLoading || topicQuery.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-slate-600">
        {t('app.loading')}
      </div>
    );
  }

  if (meQuery.isError || !meQuery.data) {
    return <Navigate to="/teacher/login" replace />;
  }

  if (!topic) {
    return <Navigate to="/teacher/topics" replace />;
  }

  const placeholderReasons: string[] = [];
  if (topic.missingVideoCount > 0) {
    placeholderReasons.push(
      t('teacher.builder.missingQuestionVideos', { count: topic.missingVideoCount }),
    );
  }
  if (topic.unconfirmedCount > 0) {
    placeholderReasons.push(t('teacher.builder.needsConfirm', { count: topic.unconfirmedCount }));
  }

  const handleSaveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    setBannerFeedback(null);
    const parsed = UpdateTopicSchema.safeParse({
      title,
      description,
      correctnessThreshold: Number(correctnessThreshold),
    });
    if (!parsed.success) {
      setBannerFeedback({
        tone: 'danger',
        text: parsed.error.issues[0]?.message ?? t('errors.generic'),
      });
      return;
    }
    updateTopicMutation.mutate(parsed.data);
  };

  const renderExamColumn = (model: ExamModelItem) => (
    <Card key={model.id} className="flex flex-col">
      <CardHeader className="border-b border-slate-100">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-lg">
              {model.modelNumber === 1 ? t('teacher.builder.model1') : t('teacher.builder.model2')}
            </CardTitle>
            <p className="mt-0.5 text-xs text-slate-500">{model.title}</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone="info">
              {t('teacher.builder.totalPoints', { total: model.totalPoints })}
            </Badge>
            <Badge tone={model.status === 'PUBLISHED' ? 'success' : 'neutral'}>
              {model.status === 'PUBLISHED'
                ? t('teacher.topics.published')
                : t('teacher.topics.draft')}
            </Badge>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <Button
            size="sm"
            onClick={() =>
              setEditingModalState({
                examId: model.id,
                nextOrderIndex: model.questions.length + 1,
                question: null,
              })
            }
          >
            <Plus className="h-3.5 w-3.5" />
            <span>{t('teacher.builder.addQuestion')}</span>
          </Button>

          {model.status === 'DRAFT' ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={!topic.publishChecklist.ready || publishMutation.isPending}
              onClick={() => publishMutation.mutate({ examId: model.id, publish: true })}
            >
              {t('teacher.builder.publish')}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={publishMutation.isPending}
              onClick={() => publishMutation.mutate({ examId: model.id, publish: false })}
            >
              {t('teacher.builder.unpublish')}
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-3 pt-4">
        {model.questions.map((q) => {
          const ytId = extractYoutubeVideoId(q.solutionUrl ?? '');

          return (
            <div
              key={q.id}
              className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-2.5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex h-6 min-w-[24px] items-center justify-center rounded bg-slate-900 px-1.5 text-xs font-bold text-white">
                    {q.orderIndex}
                  </span>
                  <Badge tone="neutral">{q.type}</Badge>
                  <Badge tone="info" dir="ltr">
                    {q.conceptKey}
                  </Badge>
                  <Badge tone="neutral">
                    {q.points} {t('app.points')}
                  </Badge>
                  <Badge tone={q.twinQuestionId ? 'success' : 'warning'} className="gap-1">
                    <Link2 className="h-3 w-3" />
                    <span>
                      {q.twinQuestionId
                        ? t('teacher.builder.twinMatched')
                        : t('teacher.builder.twinMissing')}
                    </span>
                  </Badge>
                  {q.needsTeacherConfirmation && (
                    <Badge tone="danger">{t('teacher.builder.needsConfirmBadge')}</Badge>
                  )}
                </div>

                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={t('app.edit')}
                    onClick={() =>
                      setEditingModalState({
                        examId: model.id,
                        nextOrderIndex: q.orderIndex,
                        question: q,
                      })
                    }
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={t('app.delete')}
                    onClick={() => deleteQuestionMutation.mutate(q.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-red-600" />
                  </Button>
                </div>
              </div>

              <div className="rounded-lg bg-white p-2.5 border border-slate-200">
                <MathBlock text={q.promptLatex} />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={q.solutionUrl ? 'success' : 'warning'} dir="ltr">
                    {ytId
                      ? `YT: ${ytId}`
                      : q.solutionUrl
                        ? t('teacher.builder.openSolutionUrl')
                        : t('teacher.builder.noQuestionVideo')}
                  </Badge>
                  {q.solutionUrl && (
                    <a
                      href={q.solutionUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-semibold text-brand-700 hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" />
                      <span>{t('teacher.builder.solutionLink')}</span>
                    </a>
                  )}
                </div>

                {q.needsTeacherConfirmation && (
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={confirmQuestionMutation.isPending}
                    onClick={() => confirmQuestionMutation.mutate(q.id)}
                  >
                    <ShieldCheck className="h-3.5 w-3.5" />
                    <span>{t('teacher.builder.confirmQuestion')}</span>
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );

  const model1 = topic.examModels.find((m) => m.modelNumber === 1);
  const model2 = topic.examModels.find((m) => m.modelNumber === 2);

  return (
    <TeacherShell teacherName={meQuery.data.teacher.displayName}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              to="/teacher/topics"
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <ArrowRight className="h-4 w-4 rtl:rotate-0 ltr:rotate-180" />
              <span>{t('teacher.builder.backToTopics')}</span>
            </Link>
            <h1 className="text-xl font-bold text-slate-900">{topic.title}</h1>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setShowImport(true)}>
              <FileUp className="h-4 w-4" />
              <span>{t('teacher.builder.importOverTopic')}</span>
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                void downloadTopicJson(topic.id);
              }}
            >
              <Download className="h-4 w-4" />
              <span>{t('teacher.topics.exportJson')}</span>
            </Button>
          </div>
        </div>

        {topic.hasPlaceholders && (
          <Alert tone="warning" className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {t('teacher.builder.placeholderBanner', {
                reasons: placeholderReasons.join(' · '),
              })}
            </span>
          </Alert>
        )}

        {bannerFeedback && <Alert tone={bannerFeedback.tone}>{bannerFeedback.text}</Alert>}

        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>{t('teacher.builder.topicSettings')}</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSaveSettings} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="builder-title">{t('teacher.topics.topicTitle')}</Label>
                    <Input
                      id="builder-title"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="builder-thresh">
                      {t('teacher.topics.correctnessThreshold')}
                    </Label>
                    <Input
                      id="builder-thresh"
                      type="number"
                      min={0.1}
                      max={1}
                      step={0.05}
                      dir="ltr"
                      value={correctnessThreshold}
                      onChange={(e) => setCorrectnessThreshold(Number(e.target.value))}
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="builder-desc">{t('teacher.topics.topicDesc')}</Label>
                  <Input
                    id="builder-desc"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>

                <div className="flex justify-end">
                  <Button type="submit" disabled={updateTopicMutation.isPending}>
                    {updateTopicMutation.isPending
                      ? t('app.loading')
                      : t('teacher.builder.saveSettings')}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('teacher.builder.checklistTitle')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5 text-xs">
              {topic.publishChecklist.ready ? (
                <Alert tone="success" className="flex items-center gap-2 text-xs">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span>{t('teacher.builder.checklistReady')}</span>
                </Alert>
              ) : (
                <ul className="space-y-1.5 text-amber-900">
                  {topic.publishChecklist.issues.map((issue, idx) => (
                    <li key={idx} className="rounded-lg bg-amber-50 p-2 border border-amber-200">
                      {locale === 'ar' ? issue.message_ar : issue.message_en}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {model1 && renderExamColumn(model1)}
          {model2 && renderExamColumn(model2)}
        </div>
      </div>

      {editingModalState && (
        <QuestionEditorModal
          examId={editingModalState.examId}
          nextOrderIndex={editingModalState.nextOrderIndex}
          initialQuestion={editingModalState.question}
          onClose={() => setEditingModalState(null)}
          onSaved={() => {
            setEditingModalState(null);
            refreshTopic();
          }}
        />
      )}

      {showImport && (
        <ImportBundleModal
          targetTopicId={topic.id}
          onClose={() => setShowImport(false)}
          onImported={() => {
            setShowImport(false);
            refreshTopic();
          }}
        />
      )}
    </TeacherShell>
  );
}
