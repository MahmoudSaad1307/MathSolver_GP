import { useQuery } from '@tanstack/react-query';
import { BarChart3, Download, FileSpreadsheet, TrendingUp } from 'lucide-react';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { TeacherShell } from '@/components/layouts/TeacherShell';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { useTeacherAuth } from '@/hooks/useTeacherAuth';
import { apiDownload, apiRequest } from '@/lib/api';
import type { TeacherAnalyticsResponse } from '@/types/analytics';

function fmtPct(value: number | null): string {
  return value === null ? '—' : `${value}%`;
}

function fmtSigned(value: number | null, suffix = '%'): string {
  if (value === null) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value}${suffix}`;
}

export default function AnalyticsPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'en' ? 'en' : 'ar';
  const meQuery = useTeacherAuth();

  const [topicId, setTopicId] = React.useState('');
  const [cohortId, setCohortId] = React.useState('');
  const [exportError, setExportError] = React.useState<string | null>(null);
  const [exportingKey, setExportingKey] = React.useState<string | null>(null);

  const queryStr = React.useMemo(() => {
    const params = new URLSearchParams();
    if (topicId) params.set('topicId', topicId);
    if (cohortId) params.set('cohortId', cohortId);
    const s = params.toString();
    return s ? `/analytics?${s}` : '/analytics';
  }, [topicId, cohortId]);

  const analyticsQuery = useQuery({
    queryKey: ['teacher', 'analytics', topicId, cohortId],
    enabled: meQuery.isSuccess,
    queryFn: () =>
      apiRequest<TeacherAnalyticsResponse>(queryStr, {
        retryRefresh: true,
      }),
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

  const handleDownload = async (targetCohortId: string, format: 'csv' | 'xlsx') => {
    const key = `${targetCohortId}:${format}`;
    setExportError(null);
    setExportingKey(key);
    try {
      await apiDownload(
        `/cohorts/${targetCohortId}/export.${format}`,
        `cohort-${targetCohortId}.${format}`,
      );
    } catch {
      setExportError(t('analytics.exportFailed'));
    } finally {
      setExportingKey(null);
    }
  };

  const data = analyticsQuery.data;
  const paired = data?.formalStats.paired;
  const between = data?.formalStats.between;
  const mcnemarMap = new Map((between?.mcnemar ?? []).map((m) => [m.concept_key, m]));

  return (
    <TeacherShell teacherName={meQuery.data.teacher.displayName}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
              <BarChart3 className="h-5 w-5 text-brand-700" />
              <span>{t('analytics.title')}</span>
            </h1>
            <p className="text-sm text-slate-600">{t('analytics.subtitle')}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label={t('analytics.allTopics')}
              className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 text-sm"
              value={topicId}
              onChange={(e) => {
                setTopicId(e.target.value);
                setCohortId('');
              }}
            >
              <option value="">{t('analytics.allTopics')}</option>
              {(data?.topics ?? []).map((topic) => (
                <option key={topic.id} value={topic.id}>
                  {topic.title}
                </option>
              ))}
            </select>

            <select
              aria-label={t('analytics.allCohorts')}
              className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 text-sm"
              value={cohortId}
              onChange={(e) => setCohortId(e.target.value)}
            >
              <option value="">{t('analytics.allCohorts')}</option>
              {(data?.cohorts ?? []).map((cohort) => (
                <option key={cohort.id} value={cohort.id}>
                  {cohort.name}
                </option>
              ))}
            </select>

            {cohortId && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={exportingKey === `${cohortId}:csv`}
                  onClick={() => void handleDownload(cohortId, 'csv')}
                >
                  <Download className="h-4 w-4" />
                  <span>{t('analytics.exportCsv')}</span>
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={exportingKey === `${cohortId}:xlsx`}
                  onClick={() => void handleDownload(cohortId, 'xlsx')}
                >
                  <FileSpreadsheet className="h-4 w-4" />
                  <span>{t('analytics.exportXlsx')}</span>
                </Button>
              </>
            )}
          </div>
        </div>

        {exportError && <Alert tone="danger">{exportError}</Alert>}

        {analyticsQuery.isLoading && (
          <div className="py-12 text-center text-sm text-slate-600">{t('app.loading')}</div>
        )}

        {data && (
          <>
            {data.formalStats.statsUnavailable && (
              <Alert tone="warning">{t('analytics.statsUnavailable')}</Alert>
            )}

            {/* KPI Summary Row */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>{t('analytics.pairedStudents')}</CardDescription>
                  <CardTitle className="font-mono text-2xl" dir="ltr">
                    {data.summary.pairedStudents} / {data.summary.totalStudents}
                  </CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>{t('analytics.preAverage')}</CardDescription>
                  <CardTitle className="font-mono text-2xl" dir="ltr">
                    {fmtPct(data.summary.preMeanPct)}
                  </CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>{t('analytics.postAverage')}</CardDescription>
                  <CardTitle className="font-mono text-2xl text-brand-700" dir="ltr">
                    {fmtPct(data.summary.postMeanPct)}
                  </CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>{t('analytics.meanDelta')}</CardDescription>
                  <CardTitle className="font-mono text-2xl text-emerald-700" dir="ltr">
                    {fmtSigned(data.summary.deltaMeanPct)}
                  </CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>{t('analytics.hakeGain')}</CardDescription>
                  <CardTitle className="font-mono text-2xl" dir="ltr">
                    {data.summary.hakeMeanGain === null
                      ? '—'
                      : data.summary.hakeMeanGain.toFixed(2)}
                  </CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>{t('analytics.overrideRate')}</CardDescription>
                  <CardTitle className="font-mono text-2xl" dir="ltr">
                    {Math.round(data.summary.overrideRate * 100)}%
                  </CardTitle>
                </CardHeader>
              </Card>
            </div>

            {data.summary.totalStudents === 0 && (
              <Alert tone="info">{t('analytics.emptyState')}</Alert>
            )}

            {/* Formal Statistics Cards */}
            {(paired || between) && (
              <div className="grid gap-4 lg:grid-cols-3">
                {paired && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">{t('analytics.pairedSection')}</CardTitle>
                      <CardDescription dir="ltr">n = {paired.n}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      <Alert tone="info">
                        {locale === 'ar' ? paired.interpretation_ar : paired.interpretation_en}
                      </Alert>
                      <dl className="space-y-1.5 text-xs">
                        <div className="flex justify-between gap-2">
                          <dt className="text-slate-600">{t('analytics.shapiro')}</dt>
                          <dd className="font-mono" dir="ltr">
                            {paired.shapiro.p_value !== null
                              ? `p = ${paired.shapiro.p_value.toFixed(4)} (${
                                  paired.shapiro.normal
                                    ? t('analytics.normalYes')
                                    : t('analytics.normalNo')
                                })`
                              : '—'}
                          </dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt className="text-slate-600">{t('analytics.pairedT')}</dt>
                          <dd className="font-mono" dir="ltr">
                            {paired.paired_t.statistic !== null
                              ? `t(${paired.paired_t.df}) = ${paired.paired_t.statistic.toFixed(2)}, p = ${paired.paired_t.p_value?.toFixed(4)}`
                              : '—'}
                          </dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt className="text-slate-600">{t('analytics.wilcoxon')}</dt>
                          <dd className="font-mono" dir="ltr">
                            {paired.wilcoxon.p_value !== null
                              ? `W = ${paired.wilcoxon.statistic}, p = ${paired.wilcoxon.p_value.toFixed(4)}`
                              : '—'}
                          </dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt className="text-slate-600">{t('analytics.cohensDz')}</dt>
                          <dd className="font-mono font-semibold" dir="ltr">
                            {paired.cohens_dz.estimate.toFixed(2)} [
                            {paired.cohens_dz.ci_low.toFixed(2)},{' '}
                            {paired.cohens_dz.ci_high.toFixed(2)}]
                          </dd>
                        </div>
                      </dl>
                      {paired.warnings.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {paired.warnings.map((w) => (
                            <Badge key={w} tone="warning">
                              {w}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                {between?.group_comparison && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <TrendingUp className="h-4 w-4 text-emerald-700" />
                        <span>{t('analytics.betweenSection')}</span>
                      </CardTitle>
                      <CardDescription dir="ltr">
                        Treat n={between.group_comparison.treatment_n} vs Ctrl n=
                        {between.group_comparison.control_n}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      <Alert tone="success">
                        {locale === 'ar' ? between.interpretation_ar : between.interpretation_en}
                      </Alert>
                      <dl className="space-y-1.5 text-xs">
                        <div className="flex justify-between gap-2">
                          <dt className="text-slate-600">{t('analytics.didEstimate')}</dt>
                          <dd className="font-mono font-semibold text-emerald-700" dir="ltr">
                            {fmtSigned(
                              Number(between.group_comparison.did.estimate.toFixed(2)),
                              '',
                            )}{' '}
                            [{between.group_comparison.did.ci_low.toFixed(1)},{' '}
                            {between.group_comparison.did.ci_high.toFixed(1)}] (p=
                            {between.group_comparison.did.p_value.toFixed(4)})
                          </dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt className="text-slate-600">{t('analytics.welchT')}</dt>
                          <dd className="font-mono" dir="ltr">
                            t = {between.group_comparison.welch_t.statistic?.toFixed(2) ?? '—'}, p ={' '}
                            {between.group_comparison.welch_t.p_value?.toFixed(4) ?? '—'}
                          </dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt className="text-slate-600">{t('analytics.mannWhitney')}</dt>
                          <dd className="font-mono" dir="ltr">
                            U = {between.group_comparison.mann_whitney.statistic ?? '—'}, p ={' '}
                            {between.group_comparison.mann_whitney.p_value?.toFixed(4) ?? '—'}
                          </dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt className="text-slate-600">{t('analytics.hedgesG')}</dt>
                          <dd className="font-mono font-semibold" dir="ltr">
                            {between.group_comparison.hedges_g.estimate.toFixed(2)} [
                            {between.group_comparison.hedges_g.ci_low.toFixed(2)},{' '}
                            {between.group_comparison.hedges_g.ci_high.toFixed(2)}]
                          </dd>
                        </div>
                      </dl>
                    </CardContent>
                  </Card>
                )}

                {between?.reliability && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">
                        {t('analytics.reliabilitySection')}
                      </CardTitle>
                      <CardDescription dir="ltr">n = {between.reliability.n}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2 text-xs">
                      <dl className="space-y-1.5">
                        <div className="flex justify-between gap-2">
                          <dt className="text-slate-600">{t('analytics.exactAgreement')}</dt>
                          <dd className="font-mono font-semibold" dir="ltr">
                            {Math.round(between.reliability.exact_agreement_rate * 100)}%
                          </dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt className="text-slate-600">{t('analytics.withinOne')}</dt>
                          <dd className="font-mono" dir="ltr">
                            {Math.round(between.reliability.within_one_agreement_rate * 100)}%
                          </dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt className="text-slate-600">{t('analytics.mae')}</dt>
                          <dd className="font-mono" dir="ltr">
                            {between.reliability.mae.toFixed(3)}
                          </dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt className="text-slate-600">{t('analytics.cohensKappa')}</dt>
                          <dd className="font-mono" dir="ltr">
                            {between.reliability.cohens_kappa.toFixed(3)}
                          </dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt className="text-slate-600">{t('analytics.weightedKappa')}</dt>
                          <dd className="font-mono font-semibold" dir="ltr">
                            {between.reliability.quadratic_weighted_kappa.toFixed(3)}
                          </dd>
                        </div>
                      </dl>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}

            {/* Charts */}
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t('analytics.distributionChart')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-64 w-full" dir="ltr">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data.distributions}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="rangeLabel" />
                        <YAxis allowDecimals={false} />
                        <Tooltip />
                        <Legend />
                        <Bar dataKey="preCount" name="Pre" fill="#94a3b8" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="postCount" name="Post" fill="#0f766e" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t('analytics.conceptChart')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-64 w-full" dir="ltr">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data.concepts}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="conceptKey" />
                        <YAxis domain={[0, 100]} />
                        <Tooltip />
                        <Legend />
                        <Bar
                          dataKey="preAvgPct"
                          name="Pre %"
                          fill="#94a3b8"
                          radius={[4, 4, 0, 0]}
                        />
                        <Bar
                          dataKey="postAvgPct"
                          name="Post %"
                          fill="#2563eb"
                          radius={[4, 4, 0, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Cohorts + Export Actions Table */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t('analytics.cohortsTable')}</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full text-start text-sm">
                  <thead className="border-b border-slate-200 text-xs text-slate-600">
                    <tr>
                      <th className="py-2 pe-3 text-start">{t('teacher.cohorts.cohortName')}</th>
                      <th className="py-2 pe-3 text-start">{t('teacher.cohorts.group')}</th>
                      <th className="py-2 pe-3 text-start">{t('analytics.pairedStudents')}</th>
                      <th className="py-2 pe-3 text-start">{t('analytics.preAverage')}</th>
                      <th className="py-2 pe-3 text-start">{t('analytics.postAverage')}</th>
                      <th className="py-2 pe-3 text-start">{t('analytics.meanDelta')}</th>
                      <th className="py-2 text-end">Export</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.cohorts.map((c) => (
                      <tr key={c.id}>
                        <td className="py-2 pe-3 font-medium text-slate-900">
                          {c.name}
                          <div className="text-xs text-slate-500">{c.topicTitle}</div>
                        </td>
                        <td className="py-2 pe-3">
                          <Badge tone={c.group === 'TREATMENT' ? 'info' : 'neutral'}>
                            {c.group}
                          </Badge>
                        </td>
                        <td className="py-2 pe-3 font-mono" dir="ltr">
                          {c.pairedCount} / {c.studentsCount}
                        </td>
                        <td className="py-2 pe-3 font-mono" dir="ltr">
                          {fmtPct(c.preAvgPct)}
                        </td>
                        <td className="py-2 pe-3 font-mono" dir="ltr">
                          {fmtPct(c.postAvgPct)}
                        </td>
                        <td
                          className="py-2 pe-3 font-mono font-semibold text-emerald-700"
                          dir="ltr"
                        >
                          {fmtSigned(c.deltaPct)}
                        </td>
                        <td className="py-2 text-end">
                          <div className="flex justify-end gap-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={exportingKey === `${c.id}:csv`}
                              onClick={() => void handleDownload(c.id, 'csv')}
                            >
                              {t('analytics.exportCsv')}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={exportingKey === `${c.id}:xlsx`}
                              onClick={() => void handleDownload(c.id, 'xlsx')}
                            >
                              {t('analytics.exportXlsx')}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            {/* Concepts & McNemar Table */}
            {data.concepts.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t('analytics.conceptsTable')}</CardTitle>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <table className="w-full text-start text-sm">
                    <thead className="border-b border-slate-200 text-xs text-slate-600">
                      <tr>
                        <th className="py-2 pe-3 text-start">Concept</th>
                        <th className="py-2 pe-3 text-start">{t('analytics.preAverage')}</th>
                        <th className="py-2 pe-3 text-start">{t('analytics.postAverage')}</th>
                        <th className="py-2 pe-3 text-start">{t('analytics.meanDelta')}</th>
                        <th className="py-2 pe-3 text-start">Discordant (+ / -)</th>
                        <th className="py-2 text-start">McNemar Holm p</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.concepts.map((concept) => {
                        const mc = mcnemarMap.get(concept.conceptKey);
                        return (
                          <tr key={concept.conceptKey}>
                            <td className="py-2 pe-3 font-mono font-semibold text-slate-900">
                              {concept.conceptKey}
                            </td>
                            <td className="py-2 pe-3 font-mono" dir="ltr">
                              {concept.preAvgPct}%
                            </td>
                            <td className="py-2 pe-3 font-mono" dir="ltr">
                              {concept.postAvgPct}%
                            </td>
                            <td
                              className="py-2 pe-3 font-mono font-semibold text-emerald-700"
                              dir="ltr"
                            >
                              {fmtSigned(concept.deltaPct)}
                            </td>
                            <td className="py-2 pe-3 font-mono" dir="ltr">
                              +{concept.preWrongPostCorrect} / -{concept.preCorrectPostWrong}
                            </td>
                            <td className="py-2">
                              {mc ? (
                                <div className="flex items-center gap-2" dir="ltr">
                                  <span className="font-mono text-xs">
                                    p = {mc.p_adjusted_holm.toFixed(4)}
                                  </span>
                                  <Badge tone={mc.significant ? 'success' : 'neutral'}>
                                    {mc.significant
                                      ? t('analytics.significant')
                                      : t('analytics.notSignificant')}
                                  </Badge>
                                </div>
                              ) : (
                                '—'
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            )}

            {/* Paired Twin Questions */}
            {data.questions.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t('analytics.questionsTable')}</CardTitle>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <table className="w-full text-start text-sm">
                    <thead className="border-b border-slate-200 text-xs text-slate-600">
                      <tr>
                        <th className="py-2 pe-3 text-start">#</th>
                        <th className="py-2 pe-3 text-start">Concept</th>
                        <th className="py-2 pe-3 text-start">{t('analytics.preAverage')}</th>
                        <th className="py-2 pe-3 text-start">{t('analytics.postAverage')}</th>
                        <th className="py-2 text-start">{t('analytics.meanDelta')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.questions.map((q) => (
                        <tr key={`${q.preQuestionId}-${q.orderIndex}`}>
                          <td className="py-2 pe-3 font-mono" dir="ltr">
                            #{q.orderIndex}
                          </td>
                          <td className="py-2 pe-3 font-mono">{q.conceptKey}</td>
                          <td className="py-2 pe-3 font-mono" dir="ltr">
                            {q.preAvgPct}%
                          </td>
                          <td className="py-2 pe-3 font-mono" dir="ltr">
                            {fmtPct(q.postAvgPct)}
                          </td>
                          <td className="py-2 font-mono font-semibold text-emerald-700" dir="ltr">
                            {fmtSigned(q.deltaPct)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </TeacherShell>
  );
}
