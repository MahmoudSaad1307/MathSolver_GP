import { useQuery } from '@tanstack/react-query';
import { Eye, Search, X } from 'lucide-react';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import { MathBlock } from '@/components/MathBlock';
import { TeacherShell } from '@/components/layouts/TeacherShell';
import { Badge } from '@/components/ui/Badge';
import { UnlockPostTestButton } from '@/components/teacher/UnlockPostTestButton';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { useTeacherAuth } from '@/hooks/useTeacherAuth';
import { apiRequest } from '@/lib/api';
import type { TeacherStudentDetailResponse, TeacherStudentRow } from '@/types/review';
import type { CohortListItem } from '@/types/student';

export default function StudentsPage() {
  const { t } = useTranslation();
  const meQuery = useTeacherAuth();

  const [cohortFilter, setCohortFilter] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [selectedStudentId, setSelectedStudentId] = React.useState<string | null>(null);

  const cohortsQuery = useQuery({
    queryKey: ['teacher', 'cohorts'],
    queryFn: () => apiRequest<{ cohorts: CohortListItem[] }>('/cohorts', { retryRefresh: true }),
    enabled: Boolean(meQuery.data?.teacher),
  });

  const studentsQuery = useQuery({
    queryKey: ['teacher', 'students', cohortFilter, search],
    queryFn: () => {
      const params = new URLSearchParams();
      if (cohortFilter) params.set('cohortId', cohortFilter);
      if (search.trim()) params.set('search', search.trim());
      const qs = params.toString();
      return apiRequest<{ students: TeacherStudentRow[] }>(`/students${qs ? `?${qs}` : ''}`, {
        retryRefresh: true,
      });
    },
    enabled: Boolean(meQuery.data?.teacher),
  });

  const detailQuery = useQuery({
    queryKey: ['teacher', 'student-detail', selectedStudentId],
    queryFn: () =>
      apiRequest<TeacherStudentDetailResponse>(`/students/${selectedStudentId}`, {
        retryRefresh: true,
      }),
    enabled: Boolean(meQuery.data?.teacher && selectedStudentId),
  });

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

  const students = studentsQuery.data?.students ?? [];

  return (
    <TeacherShell teacherName={meQuery.data.teacher.displayName}>
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('students.title')}</h1>
          <p className="mt-1 text-sm text-slate-600">{t('students.subtitle')}</p>
        </div>

        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 pt-4">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="pointer-events-none absolute top-2.5 start-3 h-4 w-4 text-slate-400" />
              <Input
                className="ps-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('students.searchPlaceholder')}
                aria-label={t('students.searchPlaceholder')}
              />
            </div>
            <select
              aria-label={t('students.allCohorts')}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              value={cohortFilter}
              onChange={(e) => setCohortFilter(e.target.value)}
            >
              <option value="">{t('students.allCohorts')}</option>
              {(cohortsQuery.data?.cohorts ?? []).map((cohort) => (
                <option key={cohort.id} value={cohort.id}>
                  {cohort.name}
                </option>
              ))}
            </select>
          </CardContent>
        </Card>

        {students.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-slate-600">
              {t('students.emptyState')}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="overflow-x-auto pt-4">
              <table className="w-full text-start text-sm">
                <thead className="border-b border-slate-200 text-xs text-slate-500">
                  <tr>
                    <th className="py-2 text-start font-semibold">{t('students.colName')}</th>
                    <th className="py-2 text-start font-semibold">{t('students.colCohort')}</th>
                    <th className="py-2 text-start font-semibold">{t('students.colStep')}</th>
                    <th className="py-2 text-start font-semibold">{t('students.colPre')}</th>
                    <th className="py-2 text-start font-semibold">{t('students.colVideo')}</th>
                    <th className="py-2 text-start font-semibold">{t('students.colPost')}</th>
                    <th className="py-2 text-start font-semibold">{t('students.colGain')}</th>
                    <th className="py-2 text-end font-semibold" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {students.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50">
                      <td className="py-2.5 font-medium text-slate-900">
                        <div>{s.displayName}</div>
                        <div className="font-mono text-xs text-slate-500" dir="ltr">
                          {s.resumeCode}
                        </div>
                      </td>
                      <td className="py-2.5">
                        <div className="text-xs text-slate-700">{s.cohort.name}</div>
                        <Badge tone={s.cohort.group === 'TREATMENT' ? 'info' : 'neutral'}>
                          {s.cohort.group}
                        </Badge>
                      </td>
                      <td className="py-2.5">
                        <Badge tone={s.pendingReviewCount > 0 ? 'warning' : 'neutral'}>
                          {s.currentStep}
                        </Badge>
                      </td>
                      <td className="py-2.5 font-mono text-xs" dir="ltr">
                        {s.preTest?.percentage !== null && s.preTest?.percentage !== undefined
                          ? `${Math.round(s.preTest.percentage)}%`
                          : '—'}
                      </td>
                      <td className="py-2.5 font-mono text-xs" dir="ltr">
                        {s.videoProgress.watchedSeconds}s / {s.videoProgress.minWatchSeconds}s
                      </td>
                      <td className="py-2.5 font-mono text-xs" dir="ltr">
                        {s.postTest?.percentage !== null && s.postTest?.percentage !== undefined
                          ? `${Math.round(s.postTest.percentage)}%`
                          : '—'}
                      </td>
                      <td className="py-2.5 font-mono text-xs font-bold" dir="ltr">
                        {s.scoreGain !== null ? `${s.scoreGain >= 0 ? '+' : ''}${s.scoreGain}%` : '—'}
                      </td>
                      <td className="py-2.5 text-end">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setSelectedStudentId(s.id)}
                        >
                          <Eye className="h-3.5 w-3.5" />
                          <span>{t('students.viewTimeline')}</span>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}

        {selectedStudentId && detailQuery.data && (
          <Card data-testid="student-detail-panel">
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle>{detailQuery.data.student.displayName}</CardTitle>
                  <CardDescription>
                    {detailQuery.data.cohort.name} · {detailQuery.data.topic.title}
                  </CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <UnlockPostTestButton studentId={detailQuery.data.student.id} />
                  <Button size="sm" variant="ghost" onClick={() => setSelectedStudentId(null)}>
                    <X className="h-4 w-4" />
                    <span>{t('students.closeDetail')}</span>
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {detailQuery.data.attempts.map((att) => (
                <div key={att.id} className="space-y-2 rounded-lg border border-slate-200 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-bold text-slate-900">
                      {att.title} (M{att.modelNumber})
                    </span>
                    <div className="flex items-center gap-2">
                      <Badge tone="neutral">{att.status}</Badge>
                      <span className="font-mono text-xs font-bold" dir="ltr">
                        {att.totalScore ?? '—'} / {att.maxScore}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {att.answers.map((ans) => (
                      <div
                        key={ans.answerId}
                        className="rounded border border-slate-100 bg-slate-50 px-3 py-2 text-xs"
                      >
                        <div className="flex items-center justify-between font-semibold">
                          <span>
                            #{ans.orderIndex} · {ans.type} ({ans.conceptKey})
                          </span>
                          <span className="font-mono" dir="ltr">
                            {ans.score ?? '—'} / {ans.maxScore}
                          </span>
                        </div>
                        <MathBlock text={ans.promptLatex} forceLtr className="mt-1 text-xs" />
                        {ans.latestGrading?.errorExplanationAr && (
                          <p className="mt-1 text-slate-600">
                            {ans.latestGrading.errorExplanationAr}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </TeacherShell>
  );
}
