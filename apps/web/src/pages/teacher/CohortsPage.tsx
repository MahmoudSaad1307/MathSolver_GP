import { CreateCohortSchema, RandomizeRosterSplitSchema } from '@mathlens/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Plus, Shuffle, Trash2, UsersRound } from 'lucide-react';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import { TeacherShell } from '@/components/layouts/TeacherShell';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input, Label } from '@/components/ui/Input';
import { useTeacherAuth } from '@/hooks/useTeacherAuth';
import { apiRequest, getApiErrorMessage } from '@/lib/api';
import { useUiStore } from '@/store/uiStore';
import type { TopicDetail } from '@/types/content';
import type { CohortListItem, RosterSplitResult } from '@/types/student';

export default function CohortsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const locale = useUiStore((s) => s.locale);
  const meQuery = useTeacherAuth();

  const [showCreate, setShowCreate] = React.useState(false);
  const [name, setName] = React.useState('');
  const [topicId, setTopicId] = React.useState('');
  const [group, setGroup] = React.useState<'TREATMENT' | 'CONTROL'>('TREATMENT');
  const [requireVideoBeforePost, setRequireVideoBeforePost] = React.useState(true);
  const [showProvisionalScore, setShowProvisionalScore] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(null);

  // Randomize roster split tool state
  const [rosterText, setRosterText] = React.useState('');
  const [seedInput, setSeedInput] = React.useState('');
  const [splitError, setSplitError] = React.useState<string | null>(null);
  const [splitResult, setSplitResult] = React.useState<RosterSplitResult | null>(null);

  const cohortsQuery = useQuery({
    queryKey: ['teacher', 'cohorts'],
    queryFn: () => apiRequest<{ cohorts: CohortListItem[] }>('/cohorts', { retryRefresh: true }),
    enabled: Boolean(meQuery.data?.teacher),
  });

  const topicsQuery = useQuery({
    queryKey: ['teacher', 'topics'],
    queryFn: () => apiRequest<{ topics: TopicDetail[] }>('/topics', { retryRefresh: true }),
    enabled: Boolean(meQuery.data?.teacher),
  });

  React.useEffect(() => {
    const firstTopic = topicsQuery.data?.topics[0];
    if (!topicId && firstTopic) {
      setTopicId(firstTopic.id);
    }
  }, [topicId, topicsQuery.data?.topics]);

  const createMutation = useMutation({
    mutationFn: (payload: {
      name: string;
      topicId: string;
      group: 'TREATMENT' | 'CONTROL';
      requireVideoBeforePost: boolean;
      showProvisionalScore: boolean;
    }) =>
      apiRequest<{ cohort: CohortListItem }>('/cohorts', {
        method: 'POST',
        body: JSON.stringify(payload),
        retryRefresh: true,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['teacher', 'cohorts'] });
      setName('');
      setShowCreate(false);
      setFormError(null);
    },
    onError: (err) => {
      setFormError(getApiErrorMessage(err, locale, t('errors.generic')));
    },
  });

  const toggleStatusMutation = useMutation({
    mutationFn: ({ id, nextStatus }: { id: string; nextStatus: 'OPEN' | 'CLOSED' }) =>
      apiRequest<{ cohort: CohortListItem }>(`/cohorts/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
        retryRefresh: true,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['teacher', 'cohorts'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest<void>(`/cohorts/${id}`, {
        method: 'DELETE',
        retryRefresh: true,
      }),
    onSuccess: async () => {
      setConfirmDeleteId(null);
      await queryClient.invalidateQueries({ queryKey: ['teacher', 'cohorts'] });
    },
  });

  const openPostTestMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest<{ cohortId: string; postTestOpensAt: string }>(`/cohorts/${id}/open-posttest`, {
        method: 'POST',
        retryRefresh: true,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['teacher', 'cohorts'] });
    },
  });

  const splitMutation = useMutation({
    mutationFn: (payload: { studentNames: string[]; seed?: number }) =>
      apiRequest<RosterSplitResult>('/cohorts/randomize-split', {
        method: 'POST',
        body: JSON.stringify(payload),
        retryRefresh: true,
      }),
    onSuccess: (res) => {
      setSplitError(null);
      setSplitResult(res);
    },
    onError: (err) => {
      setSplitError(getApiErrorMessage(err, locale, t('errors.generic')));
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

  const handleGroupChange = (nextGroup: 'TREATMENT' | 'CONTROL') => {
    setGroup(nextGroup);
    setRequireVideoBeforePost(nextGroup === 'TREATMENT');
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const parsed = CreateCohortSchema.safeParse({
      name: name.trim(),
      topicId,
      group,
      requireVideoBeforePost,
      showProvisionalScore,
    });
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? t('errors.generic'));
      return;
    }
    createMutation.mutate({
      name: parsed.data.name,
      topicId: parsed.data.topicId,
      group: parsed.data.group,
      requireVideoBeforePost: parsed.data.requireVideoBeforePost ?? requireVideoBeforePost,
      showProvisionalScore: parsed.data.showProvisionalScore ?? showProvisionalScore,
    });
  };

  const handleCopyCode = async (cohort: CohortListItem) => {
    try {
      await navigator.clipboard?.writeText(cohort.joinCode);
    } catch {
      // Ignore clipboard failures in restricted contexts.
    }
    setCopiedId(cohort.id);
    window.setTimeout(() => {
      setCopiedId((curr) => (curr === cohort.id ? null : curr));
    }, 2000);
  };

  const handleRunSplit = (e: React.FormEvent) => {
    e.preventDefault();
    setSplitError(null);
    const studentNames = rosterText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const parsedSeed = seedInput.trim() ? Number(seedInput.trim()) : undefined;
    const parsed = RandomizeRosterSplitSchema.safeParse({
      studentNames,
      ...(parsedSeed !== undefined && Number.isInteger(parsedSeed) ? { seed: parsedSeed } : {}),
    });
    if (!parsed.success) {
      setSplitError(parsed.error.issues[0]?.message ?? t('errors.generic'));
      return;
    }
    splitMutation.mutate({
      studentNames: parsed.data.studentNames,
      seed: parsed.data.seed,
    });
  };

  const cohorts = cohortsQuery.data?.cohorts ?? [];
  const topics = topicsQuery.data?.topics ?? [];

  return (
    <TeacherShell teacherName={meQuery.data.teacher.displayName}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{t('teacher.cohorts.title')}</h1>
            <p className="mt-1 text-sm text-slate-600">{t('teacher.cohorts.subtitle')}</p>
          </div>
          <Button onClick={() => setShowCreate((v) => !v)}>
            <Plus className="h-4 w-4" />
            <span>{t('teacher.cohorts.newCohort')}</span>
          </Button>
        </div>

        {showCreate && (
          <Card>
            <CardHeader>
              <CardTitle>{t('teacher.cohorts.newCohort')}</CardTitle>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={handleCreateSubmit}>
                {formError && <Alert tone="danger">{formError}</Alert>}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="cohort-name">{t('teacher.cohorts.cohortName')}</Label>
                    <Input
                      id="cohort-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="cohort-topic">{t('teacher.cohorts.topic')}</Label>
                    <select
                      id="cohort-topic"
                      value={topicId}
                      onChange={(e) => setTopicId(e.target.value)}
                      className="flex h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
                    >
                      {topics.map((topic) => (
                        <option key={topic.id} value={topic.id}>
                          {topic.title}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="cohort-group">{t('teacher.cohorts.group')}</Label>
                    <select
                      id="cohort-group"
                      value={group}
                      onChange={(e) =>
                        handleGroupChange(e.target.value === 'CONTROL' ? 'CONTROL' : 'TREATMENT')
                      }
                      className="flex h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
                    >
                      <option value="TREATMENT">{t('teacher.cohorts.treatment')}</option>
                      <option value="CONTROL">{t('teacher.cohorts.control')}</option>
                    </select>
                  </div>

                  <div className="flex flex-col justify-center gap-2 pt-2">
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={requireVideoBeforePost}
                        onChange={(e) => setRequireVideoBeforePost(e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300"
                      />
                      <span>{t('teacher.cohorts.requireVideo')}</span>
                    </label>
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={showProvisionalScore}
                        onChange={(e) => setShowProvisionalScore(e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300"
                      />
                      <span>{t('teacher.cohorts.showProvisional')}</span>
                    </label>
                  </div>
                </div>

                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setShowCreate(false)}>
                    {t('app.cancel')}
                  </Button>
                  <Button type="submit" disabled={createMutation.isPending}>
                    {t('app.save')}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {cohortsQuery.isLoading ? (
          <div className="text-sm text-slate-600">{t('app.loading')}</div>
        ) : cohorts.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-slate-600">
              {t('teacher.cohorts.emptyState')}
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {cohorts.map((cohort) => {
              const studentCount = cohort._count?.students ?? 0;
              return (
                <Card key={cohort.id}>
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <CardTitle className="flex items-center gap-2">
                          <UsersRound className="h-4 w-4 text-brand-600" />
                          <span>{cohort.name}</span>
                        </CardTitle>
                        <CardDescription>{cohort.topic?.title ?? cohort.topicId}</CardDescription>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <Badge tone={cohort.group === 'TREATMENT' ? 'info' : 'neutral'}>
                          {cohort.group === 'TREATMENT'
                            ? t('teacher.cohorts.treatment')
                            : t('teacher.cohorts.control')}
                        </Badge>
                        <Badge tone={cohort.status === 'OPEN' ? 'success' : 'warning'}>
                          {cohort.status === 'OPEN'
                            ? t('teacher.cohorts.openStatus')
                            : t('teacher.cohorts.closedStatus')}
                        </Badge>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                      <div>
                        <div className="text-xs text-slate-500">{t('teacher.cohorts.joinCode')}</div>
                        <div
                          dir="ltr"
                          className="font-mono text-lg font-bold tracking-widest text-slate-900"
                        >
                          {cohort.joinCode}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          void handleCopyCode(cohort);
                        }}
                      >
                        {copiedId === cohort.id ? (
                          <Check className="h-4 w-4 text-emerald-600" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                        <span>
                          {copiedId === cohort.id
                            ? t('student.copied')
                            : t('student.copyCode')}
                        </span>
                      </Button>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
                      <span>{t('teacher.cohorts.studentsCount', { count: studentCount })}</span>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={toggleStatusMutation.isPending}
                          onClick={() =>
                            toggleStatusMutation.mutate({
                              id: cohort.id,
                              nextStatus: cohort.status === 'OPEN' ? 'CLOSED' : 'OPEN',
                            })
                          }
                        >
                          {cohort.status === 'OPEN'
                            ? t('teacher.cohorts.toggleClose')
                            : t('teacher.cohorts.toggleOpen')}
                        </Button>

                        {cohort.group === 'CONTROL' && (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={openPostTestMutation.isPending}
                            onClick={() => openPostTestMutation.mutate(cohort.id)}
                          >
                            {t('teacher.cohorts.openPostTestNow')}
                          </Button>
                        )}

                        {confirmDeleteId === cohort.id ? (
                          <>
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={deleteMutation.isPending}
                              onClick={() => deleteMutation.mutate(cohort.id)}
                            >
                              {t('app.delete')}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setConfirmDeleteId(null)}
                            >
                              {t('app.cancel')}
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={t('app.delete')}
                            onClick={() => setConfirmDeleteId(cohort.id)}
                          >
                            <Trash2 className="h-4 w-4 text-red-600" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Random Roster Split Tool */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shuffle className="h-5 w-5 text-brand-600" />
              <span>{t('teacher.cohorts.splitTitle')}</span>
            </CardTitle>
            <CardDescription>{t('teacher.cohorts.splitDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form className="space-y-3" onSubmit={handleRunSplit}>
              {splitError && <Alert tone="danger">{splitError}</Alert>}
              <textarea
                rows={5}
                value={rosterText}
                onChange={(e) => setRosterText(e.target.value)}
                placeholder="أحمد محمد&#10;سارة علي&#10;عمر حسن&#10;مريم طارق"
                className="w-full rounded-lg border border-slate-300 bg-white p-3 text-sm text-slate-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-200"
              />
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-48 space-y-1">
                  <Label htmlFor="split-seed">{t('teacher.cohorts.splitSeed')}</Label>
                  <Input
                    id="split-seed"
                    type="number"
                    dir="ltr"
                    value={seedInput}
                    onChange={(e) => setSeedInput(e.target.value)}
                    placeholder="2026"
                  />
                </div>
                <Button type="submit" disabled={splitMutation.isPending}>
                  <Shuffle className="h-4 w-4" />
                  <span>{t('teacher.cohorts.splitAction')}</span>
                </Button>
              </div>
            </form>

            {splitResult && (
              <div className="space-y-3 border-t border-slate-200 pt-4">
                <div className="text-xs text-slate-500">
                  Seed: <span dir="ltr" className="font-mono font-bold">{splitResult.seedUsed}</span>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-lg border border-brand-200 bg-brand-50/50 p-3">
                    <div className="mb-2 text-sm font-bold text-brand-900">
                      {t('teacher.cohorts.treatment')} ({splitResult.treatment.length})
                    </div>
                    <ul className="list-inside list-disc space-y-1 text-sm text-slate-800">
                      {splitResult.treatment.map((studentName, idx) => (
                        <li key={`${studentName}-${idx}`}>{studentName}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="mb-2 text-sm font-bold text-slate-900">
                      {t('teacher.cohorts.control')} ({splitResult.control.length})
                    </div>
                    <ul className="list-inside list-disc space-y-1 text-sm text-slate-800">
                      {splitResult.control.map((studentName, idx) => (
                        <li key={`${studentName}-${idx}`}>{studentName}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </TeacherShell>
  );
}
