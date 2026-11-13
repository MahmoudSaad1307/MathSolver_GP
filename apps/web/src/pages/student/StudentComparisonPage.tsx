import { useQuery } from '@tanstack/react-query';
import { ArrowRight, PlayCircle, Printer, TrendingUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
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
import { StudentShell } from '@/components/layouts/StudentShell';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { apiRequest, getApiErrorMessage } from '@/lib/api';
import { useUiStore } from '@/store/uiStore';
import type { StudentComparisonResponse } from '@/types/video';

function getStatusTone(
  status: 'IMPROVED' | 'MAINTAINED_HIGH' | 'NEEDS_REVIEW',
): 'success' | 'info' | 'warning' {
  switch (status) {
    case 'IMPROVED':
      return 'success';
    case 'MAINTAINED_HIGH':
      return 'info';
    default:
      return 'warning';
  }
}

export default function StudentComparisonPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const locale = useUiStore((s) => s.locale);

  const compQuery = useQuery({
    queryKey: ['student', 'comparison'],
    queryFn: () => apiRequest<StudentComparisonResponse>('/student/comparison'),
    retry: false,
  });

  if (compQuery.isLoading) {
    return (
      <StudentShell>
        <div className="py-12 text-center text-sm text-slate-600">{t('app.loading')}</div>
      </StudentShell>
    );
  }

  if (compQuery.isError || !compQuery.data) {
    return (
      <StudentShell>
        <div className="mx-auto max-w-2xl space-y-4">
          <Alert tone="danger">
            {getApiErrorMessage(compQuery.error, locale, t('errors.generic'))}
          </Alert>
          <Button variant="outline" onClick={() => void navigate('/student')}>
            <ArrowRight className="h-4 w-4" />
            <span>{t('results.backToPortal')}</span>
          </Button>
        </div>
      </StudentShell>
    );
  }

  const data = compQuery.data;

  return (
    <StudentShell studentName={data.student.displayName}>
      <div className="mx-auto max-w-4xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void navigate('/student')}
              className="mb-1 px-2"
            >
              <ArrowRight className="h-4 w-4" />
              <span>{t('results.backToPortal')}</span>
            </Button>
            <h1 className="text-xl font-bold text-slate-900">
              {t('comparison.title')} — {data.topic.title}
            </h1>
            <p className="text-xs text-slate-600">{t('comparison.subtitle')}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="h-4 w-4" />
            <span>{t('comparison.printSummary')}</span>
          </Button>
        </div>

        {/* Summary KPI Cards */}
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader>
              <CardDescription>{t('comparison.preTestCard')}</CardDescription>
              <CardTitle className="font-mono text-2xl text-slate-800" dir="ltr">
                {Math.round(data.preTest.percentage)}% ({data.preTest.totalScore}/{data.preTest.maxScore})
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>{t('comparison.postTestCard')}</CardDescription>
              <CardTitle className="font-mono text-2xl text-brand-700" dir="ltr">
                {Math.round(data.postTest.percentage)}% ({data.postTest.totalScore}/{data.postTest.maxScore})
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>{t('comparison.gainCard')}</CardDescription>
              <CardTitle
                className={`flex items-center gap-2 font-mono text-2xl ${
                  data.deltaPercentage >= 0 ? 'text-emerald-700' : 'text-red-700'
                }`}
                dir="ltr"
              >
                <TrendingUp className="h-5 w-5" />
                <span>
                  {data.deltaPercentage >= 0 ? '+' : ''}
                  {Math.round(data.deltaPercentage)}%
                </span>
              </CardTitle>
              {data.normalizedGain !== null && (
                <p className="text-xs text-slate-500" dir="ltr">
                  {t('comparison.hakeGain')}: {data.normalizedGain}
                </p>
              )}
            </CardHeader>
          </Card>
        </div>

        <Alert tone={data.deltaPercentage >= 0 ? 'success' : 'warning'}>{data.summaryAr}</Alert>

        {/* Ethics guarantee: offer remediation video to Control students after post-test */}
        {data.videoOfferAfterPost.recommendedForControl && (
          <Card className="border-brand-300 bg-brand-50/50">
            <CardHeader>
              <CardTitle>{t('comparison.controlEthicsTitle')}</CardTitle>
              <CardDescription>{t('comparison.controlEthicsDesc')}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => void navigate('/student/remediation')}>
                <PlayCircle className="h-4 w-4" />
                <span>{t('comparison.watchNow')}</span>
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Per-concept Bar Chart */}
        {data.concepts.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>{t('comparison.conceptBreakdown')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="h-64 w-full" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.concepts}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="conceptKey" />
                    <YAxis domain={[0, 100]} />
                    <Tooltip />
                    <Legend />
                    <Bar
                      dataKey="prePercentage"
                      name={t('comparison.preTestCard')}
                      fill="#94a3b8"
                      radius={[4, 4, 0, 0]}
                    />
                    <Bar
                      dataKey="postPercentage"
                      name={t('comparison.postTestCard')}
                      fill="#2563eb"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="space-y-2">
                {data.concepts.map((c) => (
                  <div
                    key={c.conceptKey}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-semibold text-slate-900">{c.conceptKey}</span>
                      <Badge tone={getStatusTone(c.status)}>
                        {t(`comparison.status.${c.status}`)}
                      </Badge>
                    </div>
                    <div className="font-mono text-xs text-slate-700" dir="ltr">
                      {Math.round(c.prePercentage)}% -&gt; {Math.round(c.postPercentage)}% (
                      {c.deltaPercentage >= 0 ? '+' : ''}
                      {Math.round(c.deltaPercentage)}%)
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Twin question-by-question table */}
        <Card>
          <CardHeader>
            <CardTitle>{t('comparison.questionPairs')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.twinQuestions.map((pair) => (
              <div
                key={pair.preQuestionId}
                className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm"
              >
                <span className="font-semibold text-slate-800">
                  #{pair.orderIndex} · {pair.conceptKey}
                </span>
                <span className="font-mono text-xs text-slate-700" dir="ltr">
                  M1: {pair.preScore}/{pair.preMax} | M2: {pair.postScore ?? '—'}/{pair.postMax ?? '—'}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </StudentShell>
  );
}
