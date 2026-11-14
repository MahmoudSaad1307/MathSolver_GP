import { CreateTopicSchema } from '@mathlens/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Download, FileUp, FolderOpen, Plus, Trash2 } from 'lucide-react';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { TeacherShell } from '@/components/layouts/TeacherShell';
import { ImportBundleModal } from '@/components/teacher/ImportBundleModal';
import { PdfImportUploadModal } from '@/components/teacher/PdfImportUploadModal';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input, Label } from '@/components/ui/Input';
import { useTeacherAuth } from '@/hooks/useTeacherAuth';
import { apiRequest, getApiErrorMessage } from '@/lib/api';
import { downloadTopicJson } from '@/lib/exportBundle';
import { useUiStore } from '@/store/uiStore';
import type { TopicDetail } from '@/types/content';

export default function TopicsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const locale = useUiStore((s) => s.locale);
  const meQuery = useTeacherAuth();

  const [showCreate, setShowCreate] = React.useState(false);
  const [showImport, setShowImport] = React.useState(false);
  const [showPdfImport, setShowPdfImport] = React.useState(false);
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [formError, setFormError] = React.useState<string | null>(null);

  const topicsQuery = useQuery({
    queryKey: ['teacher', 'topics'],
    queryFn: () => apiRequest<{ topics: TopicDetail[] }>('/topics', { retryRefresh: true }),
    enabled: Boolean(meQuery.data?.teacher),
  });

  const createMutation = useMutation({
    mutationFn: (payload: { title: string; description: string; correctnessThreshold?: number }) =>
      apiRequest<{ topic: TopicDetail }>('/topics', {
        method: 'POST',
        body: JSON.stringify(payload),
        retryRefresh: true,
      }),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['teacher', 'topics'] });
      void navigate(`/teacher/topics/${res.topic.id}`);
    },
    onError: (err) => {
      setFormError(getApiErrorMessage(err, locale, t('errors.generic')));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (topicId: string) =>
      apiRequest<void>(`/topics/${topicId}`, {
        method: 'DELETE',
        retryRefresh: true,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['teacher', 'topics'] });
    },
  });

  if (meQuery.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-slate-600">
        {t('app.loading')}
      </div>
    );
  }

  if (meQuery.isError || !meQuery.data) {
    return <Navigate to="/teacher/login" replace />;
  }

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const parsed = CreateTopicSchema.safeParse({
      title,
      description,
    });
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? t('errors.generic'));
      return;
    }
    createMutation.mutate(parsed.data);
  };

  const topics = topicsQuery.data?.topics ?? [];

  return (
    <TeacherShell teacherName={meQuery.data.teacher.displayName}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{t('teacher.topics.title')}</h1>
            <p className="mt-1 text-sm text-slate-600">{t('teacher.topics.subtitle')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setShowPdfImport(true)}>
              <FileUp className="h-4 w-4" />
              <span>{t('teacher.topics.importPdf')}</span>
            </Button>
            <Button variant="outline" onClick={() => setShowImport(true)}>
              <FileUp className="h-4 w-4" />
              <span>{t('teacher.topics.importJson')}</span>
            </Button>
            <Button onClick={() => setShowCreate((prev) => !prev)}>
              <Plus className="h-4 w-4" />
              <span>{t('teacher.topics.newTopic')}</span>
            </Button>
          </div>
        </div>

        {showCreate && (
          <Card>
            <CardHeader>
              <CardTitle>{t('teacher.topics.newTopic')}</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCreateSubmit} className="space-y-4">
                {formError && <Alert tone="danger">{formError}</Alert>}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="topic-title">{t('teacher.topics.topicTitle')}</Label>
                    <Input
                      id="topic-title"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="topic-desc">{t('teacher.topics.topicDesc')}</Label>
                    <Input
                      id="topic-desc"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setShowCreate(false)}>
                    {t('app.cancel')}
                  </Button>
                  <Button type="submit" disabled={createMutation.isPending}>
                    {createMutation.isPending ? t('app.loading') : t('teacher.topics.createTopic')}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {topicsQuery.isLoading && (
          <div className="py-12 text-center text-sm text-slate-500">{t('app.loading')}</div>
        )}

        {!topicsQuery.isLoading && topics.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center text-sm text-slate-600">
              {t('teacher.topics.emptyState')}
            </CardContent>
          </Card>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          {topics.map((topic) => {
            const m1 = topic.examModels.find((m) => m.modelNumber === 1);
            const m2 = topic.examModels.find((m) => m.modelNumber === 2);

            return (
              <Card key={topic.id} className="flex flex-col justify-between">
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <CardTitle className="text-lg">{topic.title}</CardTitle>
                    {topic.hasPlaceholders && (
                      <Badge tone="warning" className="gap-1">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        <span>{t('teacher.topics.placeholderBadge')}</span>
                      </Badge>
                    )}
                  </div>
                  {topic.description && (
                    <CardDescription className="line-clamp-2">{topic.description}</CardDescription>
                  )}
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap gap-2 text-xs">
                    {m1 && (
                      <Badge tone={m1.status === 'PUBLISHED' ? 'success' : 'neutral'}>
                        {t('teacher.builder.model1')}:{' '}
                        {m1.status === 'PUBLISHED'
                          ? t('teacher.topics.published')
                          : t('teacher.topics.draft')}{' '}
                        ({m1.questions.length} Q · {m1.totalPoints} {t('app.points')})
                      </Badge>
                    )}
                    {m2 && (
                      <Badge tone={m2.status === 'PUBLISHED' ? 'success' : 'neutral'}>
                        {t('teacher.builder.model2')}:{' '}
                        {m2.status === 'PUBLISHED'
                          ? t('teacher.topics.published')
                          : t('teacher.topics.draft')}{' '}
                        ({m2.questions.length} Q · {m2.totalPoints} {t('app.points')})
                      </Badge>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
                    <Link
                      to={`/teacher/topics/${topic.id}`}
                      className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-brand-600 px-3.5 text-sm font-semibold text-white hover:bg-brand-700"
                    >
                      <FolderOpen className="h-4 w-4" />
                      <span>{t('teacher.topics.openBuilder')}</span>
                    </Link>

                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          void downloadTopicJson(topic.id);
                        }}
                      >
                        <Download className="h-3.5 w-3.5" />
                        <span>{t('teacher.topics.exportJson')}</span>
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={t('app.delete')}
                        onClick={() => deleteMutation.mutate(topic.id)}
                      >
                        <Trash2 className="h-4 w-4 text-red-600" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {showImport && (
        <ImportBundleModal
          onClose={() => setShowImport(false)}
          onImported={(res) => {
            setShowImport(false);
            void queryClient.invalidateQueries({ queryKey: ['teacher', 'topics'] });
            if (res.topicId) {
              void navigate(`/teacher/topics/${res.topicId}`);
            }
          }}
        />
      )}

      {showPdfImport && (
        <PdfImportUploadModal
          onClose={() => setShowPdfImport(false)}
          onJobCreated={(jobId) => {
            setShowPdfImport(false);
            void navigate(`/teacher/pdf-imports/${jobId}`);
          }}
        />
      )}
    </TeacherShell>
  );
}
