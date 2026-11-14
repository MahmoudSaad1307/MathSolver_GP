import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  ExternalLink,
  Eye,
  Loader2,
  Maximize2,
  RefreshCw,
  Search,
  Users,
  Video,
  X,
} from 'lucide-react';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { MathBlock } from '@/components/MathBlock';
import { TeacherShell } from '@/components/layouts/TeacherShell';
import { UnlockPostTestButton } from '@/components/teacher/UnlockPostTestButton';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { useTeacherAuth } from '@/hooks/useTeacherAuth';
import { apiRequest, getApiErrorMessage } from '@/lib/api';
import { useUiStore } from '@/store/uiStore';
import type { TeacherStudentDetailResponse, TeacherStudentRow } from '@/types/review';
import type { CohortListItem } from '@/types/student';

type StageFilter = 'ALL' | 'PRETEST' | 'REMEDIATION' | 'POSTTEST' | 'COMPARISON';

export default function StudentsPage() {
  const { t } = useTranslation();
  const locale = useUiStore((s) => s.locale);
  const meQuery = useTeacherAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const [cohortFilter, setCohortFilter] = React.useState(() => searchParams.get('cohortId') ?? '');
  const [stageFilter, setStageFilter] = React.useState<StageFilter>('ALL');
  const [search, setSearch] = React.useState('');
  const [selectedStudentId, setSelectedStudentId] = React.useState<string | null>(
    () => searchParams.get('studentId') ?? null,
  );
  const [activeAttemptModel, setActiveAttemptModel] = React.useState<'ALL' | 1 | 2>('ALL');
  const [copiedCode, setCopiedCode] = React.useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = React.useState<string | null>(null);

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

  // Close drawer on Escape
  React.useEffect(() => {
    if (!selectedStudentId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (lightboxUrl) {
          setLightboxUrl(null);
        } else {
          setSelectedStudentId(null);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedStudentId, lightboxUrl]);

  const handleSelectStudent = (studentId: string) => {
    setSelectedStudentId(studentId);
    setActiveAttemptModel('ALL');
    const next = new URLSearchParams(searchParams);
    next.set('studentId', studentId);
    setSearchParams(next, { replace: true });
  };

  const handleCloseDetail = () => {
    setSelectedStudentId(null);
    const next = new URLSearchParams(searchParams);
    next.delete('studentId');
    setSearchParams(next, { replace: true });
  };

  const handleCopyCode = (code: string) => {
    void navigator.clipboard?.writeText(code);
    setCopiedCode(code);
    window.setTimeout(() => setCopiedCode(null), 1800);
  };

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

  const allStudents = studentsQuery.data?.students ?? [];
  const students =
    stageFilter === 'ALL'
      ? allStudents
      : allStudents.filter((s) => {
          if (stageFilter === 'PRETEST') {
            return (
              s.currentStep === 'PRETEST_IN_PROGRESS' ||
              s.currentStep === 'PRETEST_SUBMITTED' ||
              s.currentStep === 'PRETEST_GRADING' ||
              s.currentStep === 'PRETEST_RESULTS'
            );
          }
          if (stageFilter === 'POSTTEST') {
            return (
              s.currentStep === 'POSTTEST_UNLOCKED' ||
              s.currentStep === 'POSTTEST_IN_PROGRESS' ||
              s.currentStep === 'POSTTEST_GRADING'
            );
          }
          return s.currentStep === stageFilter;
        });

  const completedBothCount = allStudents.filter((s) => s.currentStep === 'COMPARISON').length;
  const inRemediationCount = allStudents.filter((s) => s.currentStep === 'REMEDIATION').length;
  const needsReviewStudentsCount = allStudents.filter((s) => s.pendingReviewCount > 0).length;

  const selectedIndex = selectedStudentId
    ? students.findIndex((s) => s.id === selectedStudentId)
    : -1;
  const prevStudent = selectedIndex > 0 ? students[selectedIndex - 1] : null;
  const nextStudent =
    selectedIndex >= 0 && selectedIndex < students.length - 1 ? students[selectedIndex + 1] : null;
  const selectedRow = allStudents.find((s) => s.id === selectedStudentId) ?? null;

  const detail = detailQuery.data;
  const visibleAttempts = (detail?.attempts ?? []).filter(
    (att) => activeAttemptModel === 'ALL' || att.modelNumber === activeAttemptModel,
  );

  return (
    <TeacherShell teacherName={meQuery.data.teacher.displayName}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{t('students.title')}</h1>
            <p className="mt-1 text-sm text-slate-600">{t('students.subtitle')}</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void studentsQuery.refetch();
              if (selectedStudentId) void detailQuery.refetch();
            }}
            disabled={studentsQuery.isFetching}
          >
            <RefreshCw className={`h-4 w-4 ${studentsQuery.isFetching ? 'animate-spin' : ''}`} />
            <span>{t('common.retry')}</span>
          </Button>
        </div>

        {/* KPI Summary Strip */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="border-slate-200/90">
            <CardContent className="flex items-center justify-between pt-4">
              <div>
                <div className="text-xs font-semibold text-slate-500">
                  {t('ux.teacher.totalStudentsKpi')}
                </div>
                <div className="mt-1 font-mono text-2xl font-bold text-slate-900" dir="ltr">
                  {allStudents.length}
                </div>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                <Users className="h-5 w-5" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200/90">
            <CardContent className="flex items-center justify-between pt-4">
              <div>
                <div className="text-xs font-semibold text-slate-500">
                  {t('ux.teacher.completedBothKpi')}
                </div>
                <div className="mt-1 font-mono text-2xl font-bold text-emerald-700" dir="ltr">
                  {completedBothCount}
                </div>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
                <CheckCircle2 className="h-5 w-5" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200/90">
            <CardContent className="flex items-center justify-between pt-4">
              <div>
                <div className="text-xs font-semibold text-slate-500">
                  {t('ux.teacher.inRemediationKpi')}
                </div>
                <div className="mt-1 font-mono text-2xl font-bold text-sky-700" dir="ltr">
                  {inRemediationCount}
                </div>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 text-sky-700">
                <Video className="h-5 w-5" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200/90">
            <CardContent className="flex items-center justify-between pt-4">
              <div>
                <div className="text-xs font-semibold text-slate-500">
                  {t('ux.teacher.needsReviewKpi')}
                </div>
                <div className="mt-1 font-mono text-2xl font-bold text-amber-700" dir="ltr">
                  {needsReviewStudentsCount}
                </div>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
                <Clock className="h-5 w-5" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Search, Cohort & Stage Filters */}
        <Card>
          <CardContent className="space-y-3 pt-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative min-w-[220px] flex-1">
                <Search className="pointer-events-none absolute start-3 top-2.5 h-4 w-4 text-slate-400" />
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
                className="min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand-600 focus:outline-none"
                value={cohortFilter}
                onChange={(e) => {
                  setCohortFilter(e.target.value);
                  const next = new URLSearchParams(searchParams);
                  if (e.target.value) {
                    next.set('cohortId', e.target.value);
                  } else {
                    next.delete('cohortId');
                  }
                  setSearchParams(next, { replace: true });
                }}
              >
                <option value="">{t('students.allCohorts')}</option>
                {(cohortsQuery.data?.cohorts ?? []).map((cohort) => (
                  <option key={cohort.id} value={cohort.id}>
                    {cohort.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-2.5">
              {(
                [
                  { id: 'ALL', label: t('ux.teacher.filterAllStages') },
                  { id: 'PRETEST', label: 'PRETEST' },
                  { id: 'REMEDIATION', label: 'REMEDIATION' },
                  { id: 'POSTTEST', label: 'POSTTEST' },
                  { id: 'COMPARISON', label: 'COMPARISON' },
                ] as const
              ).map((pill) => (
                <button
                  key={pill.id}
                  type="button"
                  onClick={() => setStageFilter(pill.id)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                    stageFilter === pill.id
                      ? 'bg-brand-600 text-white shadow-xs'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {pill.label}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {studentsQuery.isLoading ? (
          <Card>
            <CardContent className="flex items-center justify-center gap-2 py-12 text-sm text-slate-600">
              <Loader2 className="h-4 w-4 animate-spin text-brand-600" />
              <span>{t('app.loading')}</span>
            </CardContent>
          </Card>
        ) : students.length === 0 ? (
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
                    <th className="py-2.5 pe-3 text-start font-semibold">
                      {t('students.colName')}
                    </th>
                    <th className="px-3 py-2.5 text-start font-semibold">
                      {t('students.colCohort')}
                    </th>
                    <th className="px-3 py-2.5 text-start font-semibold">
                      {t('students.colStep')}
                    </th>
                    <th className="px-3 py-2.5 text-start font-semibold">{t('students.colPre')}</th>
                    <th className="px-3 py-2.5 text-start font-semibold">
                      {t('students.colVideo')}
                    </th>
                    <th className="px-3 py-2.5 text-start font-semibold">
                      {t('students.colPost')}
                    </th>
                    <th className="px-3 py-2.5 text-start font-semibold">
                      {t('students.colGain')}
                    </th>
                    <th className="py-2.5 ps-3 text-end font-semibold" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {students.map((s) => {
                    const isSelected = selectedStudentId === s.id;
                    const isRowLoading = isSelected && detailQuery.isFetching;
                    return (
                      <tr
                        key={s.id}
                        onClick={() => handleSelectStudent(s.id)}
                        className={`cursor-pointer transition-colors ${
                          isSelected ? 'bg-brand-50/70' : 'hover:bg-slate-50'
                        }`}
                      >
                        <td className="py-3 pe-3 font-medium text-slate-900">
                          <div className="font-semibold">{s.displayName}</div>
                          {s.email ? (
                            <div className="text-xs text-slate-500" dir="ltr">
                              {s.email}
                            </div>
                          ) : null}
                          <div className="font-mono text-xs text-slate-500" dir="ltr">
                            {s.resumeCode}
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <div className="mb-1 text-xs font-medium text-slate-700">
                            {s.cohort.name}
                          </div>
                          <Badge tone={s.cohort.group === 'TREATMENT' ? 'info' : 'neutral'}>
                            {s.cohort.group}
                          </Badge>
                        </td>
                        <td className="px-3 py-3">
                          <Badge
                            tone={
                              s.pendingReviewCount > 0
                                ? 'warning'
                                : s.currentStep === 'COMPARISON'
                                  ? 'success'
                                  : 'neutral'
                            }
                          >
                            {s.currentStep}
                          </Badge>
                        </td>
                        <td className="px-3 py-3 font-mono text-xs font-semibold" dir="ltr">
                          {s.preTest?.percentage !== null && s.preTest?.percentage !== undefined
                            ? `${Math.round(s.preTest.percentage)}%`
                            : '—'}
                        </td>
                        <td className="px-3 py-3 font-mono text-xs text-slate-600" dir="ltr">
                          {s.videoProgress.watchedSeconds}s
                          {s.videoProgress.visitedCount > 0
                            ? ` (${s.videoProgress.visitedCount} Qs)`
                            : ''}
                        </td>
                        <td className="px-3 py-3 font-mono text-xs font-semibold" dir="ltr">
                          {s.postTest?.percentage !== null && s.postTest?.percentage !== undefined
                            ? `${Math.round(s.postTest.percentage)}%`
                            : '—'}
                        </td>
                        <td className="px-3 py-3 font-mono text-xs font-bold" dir="ltr">
                          {s.scoreGain !== null ? (
                            <span
                              className={
                                s.scoreGain > 0
                                  ? 'text-emerald-700'
                                  : s.scoreGain < 0
                                    ? 'text-red-600'
                                    : 'text-slate-700'
                              }
                            >
                              {s.scoreGain >= 0 ? '+' : ''}
                              {s.scoreGain}%
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td
                          className="py-3 ps-3 text-end"
                          onClick={(e) => {
                            e.stopPropagation();
                          }}
                        >
                          <Button
                            size="sm"
                            variant={isSelected ? 'primary' : 'outline'}
                            onClick={() => handleSelectStudent(s.id)}
                          >
                            {isRowLoading ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Eye className="h-3.5 w-3.5" />
                            )}
                            <span>{t('students.viewTimeline')}</span>
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}

        {/* Slide-Over Modal / Detail Panel (always visible in viewport when a student is selected) */}
        {selectedStudentId && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-end bg-slate-900/50 backdrop-blur-xs p-2 sm:p-4"
            role="dialog"
            aria-modal="true"
            aria-label={
              detail?.student.displayName ?? selectedRow?.displayName ?? t('students.viewTimeline')
            }
            onClick={handleCloseDetail}
          >
            <div
              className="max-h-[94vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <Card
                data-testid={detail ? 'student-detail-panel' : 'student-detail-loading'}
                className="border-0 shadow-none"
              >
                <CardHeader className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur-xs">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <CardTitle className="text-xl">
                          {detail?.student.displayName ?? selectedRow?.displayName ?? '—'}
                        </CardTitle>
                        {(detail?.cohort.group ?? selectedRow?.cohort.group) && (
                          <Badge
                            tone={
                              (detail?.cohort.group ?? selectedRow?.cohort.group) === 'TREATMENT'
                                ? 'info'
                                : 'neutral'
                            }
                          >
                            {detail?.cohort.group ?? selectedRow?.cohort.group}
                          </Badge>
                        )}
                        {selectedRow?.currentStep && (
                          <Badge tone="neutral">{selectedRow.currentStep}</Badge>
                        )}
                      </div>
                      <CardDescription className="flex flex-wrap items-center gap-2 text-xs sm:text-sm">
                        <span>
                          {detail?.cohort.name ?? selectedRow?.cohort.name ?? ''}
                          {detail?.topic.title ? ` · ${detail.topic.title}` : ''}
                        </span>
                        {(detail?.student.email ?? selectedRow?.email) ? (
                          <span className="font-mono text-slate-500" dir="ltr">
                            · {detail?.student.email ?? selectedRow?.email}
                          </span>
                        ) : null}
                        {(detail?.student.resumeCode ?? selectedRow?.resumeCode) ? (
                          <button
                            type="button"
                            onClick={() =>
                              handleCopyCode(
                                (detail?.student.resumeCode ?? selectedRow?.resumeCode)!,
                              )
                            }
                            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-xs font-semibold text-slate-700 hover:bg-slate-100"
                            dir="ltr"
                          >
                            <span>{detail?.student.resumeCode ?? selectedRow?.resumeCode}</span>
                            {copiedCode ===
                            (detail?.student.resumeCode ?? selectedRow?.resumeCode) ? (
                              <Check className="h-3 w-3 text-emerald-600" />
                            ) : (
                              <Copy className="h-3 w-3 text-slate-400" />
                            )}
                          </button>
                        ) : null}
                      </CardDescription>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {/* Prev / Next student quick switcher */}
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!prevStudent}
                          onClick={() => prevStudent && handleSelectStudent(prevStudent.id)}
                          aria-label={t('ux.teacher.prevStudent')}
                          title={t('ux.teacher.prevStudent')}
                        >
                          <ChevronRight className="h-4 w-4 rtl:rotate-0 ltr:rotate-180" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!nextStudent}
                          onClick={() => nextStudent && handleSelectStudent(nextStudent.id)}
                          aria-label={t('ux.teacher.nextStudent')}
                          title={t('ux.teacher.nextStudent')}
                        >
                          <ChevronLeft className="h-4 w-4 rtl:rotate-0 ltr:rotate-180" />
                        </Button>
                      </div>

                      <UnlockPostTestButton studentId={selectedStudentId} />

                      <Button size="sm" variant="ghost" onClick={handleCloseDetail}>
                        <X className="h-4 w-4" />
                        <span>{t('students.closeDetail')}</span>
                      </Button>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="space-y-5 pt-5">
                  {/* Summary metrics row from selectedRow / detail */}
                  <div className="grid gap-3 sm:grid-cols-4">
                    <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
                      <div className="text-xs font-semibold text-slate-500">
                        {t('students.colPre')}
                      </div>
                      <div className="mt-1 font-mono text-lg font-bold text-slate-900" dir="ltr">
                        {selectedRow?.preTest?.percentage !== null &&
                        selectedRow?.preTest?.percentage !== undefined
                          ? `${Math.round(selectedRow.preTest.percentage)}%`
                          : '—'}
                      </div>
                      {selectedRow?.preTest && (
                        <div className="font-mono text-xs text-slate-500" dir="ltr">
                          {selectedRow.preTest.totalScore ?? '—'} / {selectedRow.preTest.maxScore}
                        </div>
                      )}
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
                      <div className="text-xs font-semibold text-slate-500">
                        {t('students.colVideo')}
                      </div>
                      <div className="mt-1 font-mono text-lg font-bold text-slate-900" dir="ltr">
                        {detail?.videoProgress.watchedSeconds ??
                          selectedRow?.videoProgress.watchedSeconds ??
                          0}
                        s
                      </div>
                      <div className="text-xs text-slate-500" dir="ltr">
                        {selectedRow?.videoProgress.visitedCount
                          ? `${selectedRow.videoProgress.visitedCount} Qs`
                          : detail?.videoProgress.unlockedPostAt
                            ? 'Unlocked'
                            : '—'}
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
                      <div className="text-xs font-semibold text-slate-500">
                        {t('students.colPost')}
                      </div>
                      <div className="mt-1 font-mono text-lg font-bold text-slate-900" dir="ltr">
                        {selectedRow?.postTest?.percentage !== null &&
                        selectedRow?.postTest?.percentage !== undefined
                          ? `${Math.round(selectedRow.postTest.percentage)}%`
                          : '—'}
                      </div>
                      {selectedRow?.postTest && (
                        <div className="font-mono text-xs text-slate-500" dir="ltr">
                          {selectedRow.postTest.totalScore ?? '—'} / {selectedRow.postTest.maxScore}
                        </div>
                      )}
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
                      <div className="text-xs font-semibold text-slate-500">
                        {t('students.colGain')}
                      </div>
                      <div
                        className={`mt-1 font-mono text-lg font-bold ${
                          (selectedRow?.scoreGain ?? 0) > 0
                            ? 'text-emerald-700'
                            : (selectedRow?.scoreGain ?? 0) < 0
                              ? 'text-red-600'
                              : 'text-slate-900'
                        }`}
                        dir="ltr"
                      >
                        {selectedRow?.scoreGain !== null && selectedRow?.scoreGain !== undefined
                          ? `${selectedRow.scoreGain >= 0 ? '+' : ''}${selectedRow.scoreGain}%`
                          : '—'}
                      </div>
                    </div>
                  </div>

                  {/* Loading State */}
                  {detailQuery.isLoading && (
                    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-slate-200 bg-slate-50 py-12 text-sm text-slate-600">
                      <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
                      <span>{t('ux.teacher.loadingDetail')}</span>
                    </div>
                  )}

                  {/* Error State */}
                  {detailQuery.isError && (
                    <Alert
                      tone="danger"
                      className="flex flex-wrap items-center justify-between gap-3"
                    >
                      <span>
                        {getApiErrorMessage(detailQuery.error, locale, t('ux.teacher.errorDetail'))}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void detailQuery.refetch()}
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        <span>{t('common.retry')}</span>
                      </Button>
                    </Alert>
                  )}

                  {/* Attempts Detail Content */}
                  {detail && (
                    <div className="space-y-4">
                      {detail.attempts.length > 1 && (
                        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 pb-3">
                          {(
                            [
                              { id: 'ALL', label: t('ux.results.filterAll') },
                              { id: 1, label: `${t('students.colPre')} (M1)` },
                              { id: 2, label: `${t('students.colPost')} (M2)` },
                            ] as const
                          ).map((tab) => (
                            <button
                              key={String(tab.id)}
                              type="button"
                              onClick={() => setActiveAttemptModel(tab.id)}
                              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                                activeAttemptModel === tab.id
                                  ? 'bg-brand-600 text-white'
                                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                              }`}
                            >
                              {tab.label}
                            </button>
                          ))}
                        </div>
                      )}

                      {visibleAttempts.map((att) => (
                        <div
                          key={att.id}
                          className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-xs"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                            <div>
                              <span className="text-base font-bold text-slate-900">
                                {att.title} (M{att.modelNumber})
                              </span>
                              {att.submittedAt && (
                                <div className="text-xs text-slate-500" dir="ltr">
                                  {new Date(att.submittedAt).toLocaleString(
                                    locale === 'ar' ? 'ar-EG' : 'en-US',
                                  )}
                                </div>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge
                                tone={
                                  att.status === 'GRADED' || att.status === 'FINAL'
                                    ? 'success'
                                    : att.status === 'NEEDS_REVIEW'
                                      ? 'warning'
                                      : 'neutral'
                                }
                              >
                                {att.status}
                              </Badge>
                              {att.percentage !== null && att.percentage !== undefined && (
                                <Badge tone="info" dir="ltr">
                                  {Math.round(att.percentage)}%
                                </Badge>
                              )}
                              <span
                                className="font-mono text-sm font-bold text-slate-900"
                                dir="ltr"
                              >
                                {att.totalScore ?? '—'} / {att.maxScore}
                              </span>
                            </div>
                          </div>

                          <div className="space-y-2.5">
                            {att.answers.map((ans) => {
                              const isFullScore =
                                ans.score !== null && ans.maxScore > 0 && ans.score >= ans.maxScore;
                              const isZeroScore = ans.score === 0;
                              const needsReview =
                                Boolean(ans.latestGrading?.needsReview) ||
                                Boolean(ans.misreadReportedAt);

                              return (
                                <div
                                  key={ans.answerId}
                                  className={`rounded-xl border p-3 text-xs transition-colors ${
                                    needsReview
                                      ? 'border-amber-300 bg-amber-50/40'
                                      : isFullScore
                                        ? 'border-emerald-200 bg-emerald-50/30'
                                        : 'border-slate-200 bg-slate-50/70'
                                  }`}
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-2 font-semibold">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      <span className="text-slate-900">
                                        #{ans.orderIndex} · {ans.type} ({ans.conceptKey})
                                      </span>
                                      {ans.misreadReportedAt && (
                                        <Badge tone="warning">
                                          <AlertTriangle className="me-1 inline h-3 w-3" />
                                          {t('ux.teacher.misreadReportedBadge')}
                                        </Badge>
                                      )}
                                      {ans.latestGrading && (
                                        <Badge
                                          tone={
                                            ans.latestGrading.confidence >= 0.8
                                              ? 'success'
                                              : 'warning'
                                          }
                                          dir="ltr"
                                        >
                                          AI {Math.round(ans.latestGrading.confidence * 100)}%
                                        </Badge>
                                      )}
                                    </div>

                                    <div className="flex items-center gap-2">
                                      {needsReview && (
                                        <Link
                                          to="/teacher/review"
                                          className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900 hover:bg-amber-200"
                                        >
                                          <span>{t('ux.teacher.openReviewQueue')}</span>
                                          <ExternalLink className="h-3 w-3" />
                                        </Link>
                                      )}
                                      <span
                                        className={`rounded-md px-2 py-0.5 font-mono text-xs font-bold ${
                                          isFullScore
                                            ? 'bg-emerald-100 text-emerald-800'
                                            : isZeroScore
                                              ? 'bg-red-100 text-red-800'
                                              : 'bg-slate-200 text-slate-800'
                                        }`}
                                        dir="ltr"
                                      >
                                        {ans.score ?? '—'} / {ans.maxScore}
                                      </span>
                                    </div>
                                  </div>

                                  <MathBlock
                                    text={ans.promptLatex}
                                    forceLtr
                                    className="mt-2 rounded-lg bg-white/80 p-2 text-xs text-slate-900"
                                  />

                                  {ans.misreadNote && (
                                    <p className="mt-1.5 rounded-md bg-amber-100/70 px-2.5 py-1.5 text-amber-950">
                                      {ans.misreadNote}
                                    </p>
                                  )}

                                  {ans.latestGrading?.errorExplanationAr && (
                                    <p className="mt-1.5 text-slate-700">
                                      {ans.latestGrading.errorExplanationAr}
                                    </p>
                                  )}

                                  {ans.images.length > 0 && (
                                    <div className="mt-2.5 space-y-1.5">
                                      <div className="text-[11px] font-semibold text-slate-500">
                                        {t('ux.teacher.handwrittenPhotos')} ({ans.images.length})
                                      </div>
                                      <div className="flex flex-wrap gap-2">
                                        {ans.images.map((img, idx) =>
                                          img.signedUrl ? (
                                            <button
                                              key={img.id}
                                              type="button"
                                              onClick={() => setLightboxUrl(img.signedUrl)}
                                              className="group relative h-20 w-28 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xs"
                                            >
                                              <img
                                                src={img.signedUrl}
                                                alt={`Solution ${idx + 1}`}
                                                className="h-full w-full object-cover transition-transform group-hover:scale-105"
                                              />
                                              <span className="absolute bottom-1 end-1 rounded bg-slate-900/75 p-1 text-white">
                                                <Maximize2 className="h-3 w-3" />
                                              </span>
                                            </button>
                                          ) : null,
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* Full-size Image Lightbox */}
        {lightboxUrl && (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/85 p-4"
            role="dialog"
            aria-modal="true"
            onClick={() => setLightboxUrl(null)}
          >
            <button
              type="button"
              onClick={() => setLightboxUrl(null)}
              aria-label={t('app.close')}
              className="fixed end-4 top-4 rounded-full bg-white/90 p-2 text-slate-900 hover:bg-white"
            >
              <X className="h-5 w-5" />
            </button>
            <img
              src={lightboxUrl}
              alt="Student handwritten solution"
              className="max-h-[90vh] max-w-full rounded-xl shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        )}
      </div>
    </TeacherShell>
  );
}
