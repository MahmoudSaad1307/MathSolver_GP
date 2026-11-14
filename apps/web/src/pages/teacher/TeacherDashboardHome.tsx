import { useQuery } from '@tanstack/react-query';
import { BarChart3, BookOpen, CheckSquare, Coins, Eye, Users, UsersRound } from 'lucide-react';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate } from 'react-router-dom';
import { TeacherShell } from '@/components/layouts/TeacherShell';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { useTeacherAuth } from '@/hooks/useTeacherAuth';
import { apiRequest } from '@/lib/api';
import type { TopicDetail } from '@/types/content';
import type { TeacherStudentRow } from '@/types/review';
import type { CohortListItem } from '@/types/student';

export default function TeacherDashboardHome() {
  const { t } = useTranslation();
  const meQuery = useTeacherAuth();

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

  const studentsQuery = useQuery({
    queryKey: ['teacher', 'students', '', ''],
    queryFn: () =>
      apiRequest<{ students: TeacherStudentRow[] }>('/students', { retryRefresh: true }),
    enabled: Boolean(meQuery.data?.teacher),
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

  const { teacher } = meQuery.data;
  const topicsCount = topicsQuery.data?.topics.length ?? null;
  const cohortsCount = cohortsQuery.data?.cohorts.length ?? null;
  const studentsList = studentsQuery.data?.students ?? [];
  const pendingReviewsCount = studentsList.reduce((acc, s) => acc + s.pendingReviewCount, 0);

  return (
    <TeacherShell teacherName={teacher.displayName}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            {t('teacher.welcome', { name: teacher.displayName })}
          </h1>
          <p className="mt-1 text-xs text-slate-500" dir="ltr">
            {teacher.email}
          </p>
        </div>

        <Alert tone="info">{t('teacher.readyBanner')}</Alert>

        {/* Quick Navigation & Live KPI Cards */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Link to="/teacher/topics" className="group block rounded-xl transition hover:shadow-md">
            <Card className="h-full border-slate-200 transition-colors group-hover:border-brand-400">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <BookOpen className="h-5 w-5 text-brand-600" />
                    <span>{t('teacher.nav.topics')}</span>
                  </CardTitle>
                  {topicsCount !== null && (
                    <Badge tone="info" dir="ltr">
                      {topicsCount}
                    </Badge>
                  )}
                </div>
                <CardDescription>{teacher.email}</CardDescription>
              </CardHeader>
            </Card>
          </Link>

          <Link to="/teacher/cohorts" className="group block rounded-xl transition hover:shadow-md">
            <Card className="h-full border-slate-200 transition-colors group-hover:border-brand-400">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <UsersRound className="h-5 w-5 text-brand-600" />
                    <span>{t('teacher.nav.cohorts')}</span>
                  </CardTitle>
                  {cohortsCount !== null && (
                    <Badge tone="info" dir="ltr">
                      {cohortsCount}
                    </Badge>
                  )}
                </div>
                <CardDescription>TREATMENT / CONTROL</CardDescription>
              </CardHeader>
            </Card>
          </Link>

          <Link to="/teacher/review" className="group block rounded-xl transition hover:shadow-md">
            <Card className="h-full border-slate-200 transition-colors group-hover:border-brand-400">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <CheckSquare className="h-5 w-5 text-amber-600" />
                    <span>{t('teacher.nav.review')}</span>
                  </CardTitle>
                  {studentsQuery.data && (
                    <Badge tone={pendingReviewsCount > 0 ? 'warning' : 'success'} dir="ltr">
                      {pendingReviewsCount}
                    </Badge>
                  )}
                </div>
                <CardDescription>AI Quality Gate</CardDescription>
              </CardHeader>
            </Card>
          </Link>

          <Link
            to="/teacher/students"
            className="group block rounded-xl transition hover:shadow-md"
          >
            <Card className="h-full border-slate-200 transition-colors group-hover:border-brand-400">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <Users className="h-5 w-5 text-emerald-600" />
                    <span>{t('teacher.nav.students')}</span>
                  </CardTitle>
                  {studentsQuery.data && (
                    <Badge tone="neutral" dir="ltr">
                      {studentsList.length}
                    </Badge>
                  )}
                </div>
                <CardDescription>{t('students.subtitle')}</CardDescription>
              </CardHeader>
            </Card>
          </Link>

          <Link
            to="/teacher/analytics"
            className="group block rounded-xl transition hover:shadow-md"
          >
            <Card className="h-full border-slate-200 transition-colors group-hover:border-brand-400">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5 text-brand-600" />
                  <span>{t('teacher.nav.analytics')}</span>
                </CardTitle>
                <CardDescription>{t('analytics.subtitle')}</CardDescription>
              </CardHeader>
            </Card>
          </Link>

          <Link to="/teacher/usage" className="group block rounded-xl transition hover:shadow-md">
            <Card className="h-full border-slate-200 transition-colors group-hover:border-brand-400">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Coins className="h-5 w-5 text-slate-600" />
                  <span>{t('teacher.nav.usage')}</span>
                </CardTitle>
                <CardDescription>{t('usage.subtitle')}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        </div>

        {/* 4-Step Teacher Experimental Workflow Guide */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('ux.teacher.workflowTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {(
                [
                  {
                    step: '01',
                    title: t('ux.teacher.workflowStep1'),
                    desc: t('ux.teacher.workflowStep1Desc'),
                    to: '/teacher/topics',
                  },
                  {
                    step: '02',
                    title: t('ux.teacher.workflowStep2'),
                    desc: t('ux.teacher.workflowStep2Desc'),
                    to: '/teacher/cohorts',
                  },
                  {
                    step: '03',
                    title: t('ux.teacher.workflowStep3'),
                    desc: t('ux.teacher.workflowStep3Desc'),
                    to: '/teacher/students',
                  },
                  {
                    step: '04',
                    title: t('ux.teacher.workflowStep4'),
                    desc: t('ux.teacher.workflowStep4Desc'),
                    to: '/teacher/analytics',
                  },
                ] as const
              ).map((item) => (
                <Link
                  key={item.step}
                  to={item.to}
                  className="group rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 transition-colors hover:border-brand-400 hover:bg-brand-50/40"
                >
                  <div className="mb-1.5 inline-flex h-6 w-6 items-center justify-center rounded-md bg-brand-600 font-mono text-xs font-bold text-white">
                    {item.step}
                  </div>
                  <div className="text-sm font-bold text-slate-900 group-hover:text-brand-700">
                    {item.title}
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-slate-600">{item.desc}</p>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Recent Students Preview Table with working Details link */}
        {studentsList.length > 0 && (
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">{t('ux.teacher.recentStudentsTitle')}</CardTitle>
                <Link
                  to="/teacher/students"
                  className="text-xs font-semibold text-brand-700 hover:underline"
                >
                  {t('ux.teacher.viewAllStudents')} ({studentsList.length})
                </Link>
              </div>
            </CardHeader>
            <CardContent className="overflow-x-auto pt-2">
              <table className="w-full text-start text-sm">
                <thead className="border-b border-slate-200 text-xs text-slate-500">
                  <tr>
                    <th className="py-2 text-start font-semibold">{t('students.colName')}</th>
                    <th className="py-2 text-start font-semibold">{t('students.colCohort')}</th>
                    <th className="py-2 text-start font-semibold">{t('students.colStep')}</th>
                    <th className="py-2 text-start font-semibold">{t('students.colPre')}</th>
                    <th className="py-2 text-start font-semibold">{t('students.colPost')}</th>
                    <th className="py-2 text-end font-semibold" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {studentsList.slice(0, 5).map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50">
                      <td className="py-2.5 font-medium text-slate-900">
                        <div>{s.displayName}</div>
                        <div className="font-mono text-xs text-slate-500" dir="ltr">
                          {s.resumeCode}
                        </div>
                      </td>
                      <td className="py-2.5 text-xs text-slate-700">{s.cohort.name}</td>
                      <td className="py-2.5">
                        <Badge tone="neutral">{s.currentStep}</Badge>
                      </td>
                      <td className="py-2.5 font-mono text-xs" dir="ltr">
                        {s.preTest?.percentage !== null && s.preTest?.percentage !== undefined
                          ? `${Math.round(s.preTest.percentage)}%`
                          : '—'}
                      </td>
                      <td className="py-2.5 font-mono text-xs" dir="ltr">
                        {s.postTest?.percentage !== null && s.postTest?.percentage !== undefined
                          ? `${Math.round(s.postTest.percentage)}%`
                          : '—'}
                      </td>
                      <td className="py-2.5 text-end">
                        <Link
                          to={`/teacher/students?studentId=${s.id}`}
                          className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          <span>{t('students.viewTimeline')}</span>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </div>
    </TeacherShell>
  );
}
