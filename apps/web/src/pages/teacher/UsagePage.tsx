import { useQuery } from '@tanstack/react-query';
import { Coins } from 'lucide-react';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { TeacherShell } from '@/components/layouts/TeacherShell';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { useTeacherAuth } from '@/hooks/useTeacherAuth';
import { apiRequest } from '@/lib/api';
import type { TeacherUsageResponse } from '@/types/analytics';

export default function UsagePage() {
  const { t } = useTranslation();
  const meQuery = useTeacherAuth();
  const [days, setDays] = React.useState(30);

  const usageQuery = useQuery({
    queryKey: ['teacher', 'usage', days],
    enabled: meQuery.isSuccess,
    queryFn: () =>
      apiRequest<TeacherUsageResponse>(`/usage?days=${days}`, {
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

  const data = usageQuery.data;
  const capPct =
    data && data.dailyCapUsd > 0
      ? Math.min(100, Math.round((data.todayCostUsd / data.dailyCapUsd) * 100))
      : 0;

  return (
    <TeacherShell teacherName={meQuery.data.teacher.displayName}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
              <Coins className="h-5 w-5 text-brand-700" />
              <span>{t('usage.title')}</span>
            </h1>
            <p className="text-sm text-slate-600">{t('usage.subtitle')}</p>
          </div>

          <select
            aria-label={t('usage.lastDays', { days })}
            className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 text-sm"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            {[7, 30, 90].map((d) => (
              <option key={d} value={d}>
                {t('usage.lastDays', { days: d })}
              </option>
            ))}
          </select>
        </div>

        {usageQuery.isLoading && (
          <div className="py-12 text-center text-sm text-slate-600">{t('app.loading')}</div>
        )}

        {data && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>{t('usage.dailyCap')}</CardDescription>
                  <CardTitle className="font-mono text-xl" dir="ltr">
                    ${data.todayCostUsd.toFixed(4)} / ${data.dailyCapUsd.toFixed(2)}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200" dir="ltr">
                    <div className="h-full bg-brand-600" style={{ width: `${capPct}%` }} />
                  </div>
                  <p className="text-xs text-slate-500">
                    {t('usage.capRemaining', { amount: data.capRemainingUsd.toFixed(4) })}
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>{t('usage.totalSpend')}</CardDescription>
                  <CardTitle className="font-mono text-2xl" dir="ltr">
                    ${data.summary.totalCostUsd.toFixed(4)}
                  </CardTitle>
                </CardHeader>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>{t('usage.totalCalls')}</CardDescription>
                  <CardTitle className="font-mono text-2xl" dir="ltr">
                    {data.summary.successCalls} / {data.summary.totalCalls}
                  </CardTitle>
                </CardHeader>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>{t('usage.latency')}</CardDescription>
                  <CardTitle className="font-mono text-xl" dir="ltr">
                    {data.summary.avgLatencyMs}ms / {data.summary.p95LatencyMs}ms
                  </CardTitle>
                </CardHeader>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>{t('usage.tokens')}</CardDescription>
                  <CardTitle className="font-mono text-xl" dir="ltr">
                    {data.summary.totalInputTokens + data.summary.totalOutputTokens}
                  </CardTitle>
                </CardHeader>
              </Card>
            </div>

            {data.summary.totalCalls === 0 ? (
              <Alert tone="info">{t('usage.emptyState')}</Alert>
            ) : (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">{t('usage.dailyChart')}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-64 w-full" dir="ltr">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={data.daily}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="date" />
                          <YAxis />
                          <Tooltip />
                          <Bar
                            dataKey="costUsd"
                            name="Cost ($)"
                            fill="#0f766e"
                            radius={[4, 4, 0, 0]}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">{t('usage.breakdownTable')}</CardTitle>
                  </CardHeader>
                  <CardContent className="overflow-x-auto">
                    <table className="w-full text-start text-sm">
                      <thead className="border-b border-slate-200 text-xs text-slate-600">
                        <tr>
                          <th className="py-2 pe-3 text-start">Provider</th>
                          <th className="py-2 pe-3 text-start">Model</th>
                          <th className="py-2 pe-3 text-start">Operation</th>
                          <th className="py-2 pe-3 text-start">Calls</th>
                          <th className="py-2 pe-3 text-start">Success</th>
                          <th className="py-2 pe-3 text-start">Latency</th>
                          <th className="py-2 text-start">Cost ($)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {data.breakdown.map((b) => (
                          <tr key={`${b.provider}-${b.modelName}-${b.operation}`}>
                            <td className="py-2 pe-3 font-medium">{b.provider}</td>
                            <td className="py-2 pe-3 font-mono text-xs">{b.modelName}</td>
                            <td className="py-2 pe-3 font-mono text-xs">{b.operation}</td>
                            <td className="py-2 pe-3 font-mono" dir="ltr">
                              {b.calls}
                            </td>
                            <td className="py-2 pe-3 font-mono" dir="ltr">
                              {Math.round(b.successRate * 100)}%
                            </td>
                            <td className="py-2 pe-3 font-mono" dir="ltr">
                              {b.avgLatencyMs}ms
                            </td>
                            <td className="py-2 font-mono font-semibold" dir="ltr">
                              ${b.costUsd.toFixed(4)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">{t('usage.recentTable')}</CardTitle>
                  </CardHeader>
                  <CardContent className="overflow-x-auto">
                    <table className="w-full text-start text-sm">
                      <thead className="border-b border-slate-200 text-xs text-slate-600">
                        <tr>
                          <th className="py-2 pe-3 text-start">Provider / Model</th>
                          <th className="py-2 pe-3 text-start">Operation</th>
                          <th className="py-2 pe-3 text-start">Status</th>
                          <th className="py-2 pe-3 text-start">Latency</th>
                          <th className="py-2 text-start">Cost ($)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {data.recentCalls.map((call) => (
                          <tr key={call.id}>
                            <td className="py-2 pe-3 font-mono text-xs">
                              {call.provider} · {call.modelName}
                            </td>
                            <td className="py-2 pe-3 font-mono text-xs">{call.operation}</td>
                            <td className="py-2 pe-3">
                              <Badge tone={call.success ? 'success' : 'danger'}>
                                {call.success ? 'OK' : (call.errorCode ?? 'ERROR')}
                              </Badge>
                            </td>
                            <td className="py-2 pe-3 font-mono" dir="ltr">
                              {call.latencyMs}ms
                            </td>
                            <td className="py-2 font-mono" dir="ltr">
                              ${call.costUsd.toFixed(4)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              </>
            )}
          </>
        )}
      </div>
    </TeacherShell>
  );
}
