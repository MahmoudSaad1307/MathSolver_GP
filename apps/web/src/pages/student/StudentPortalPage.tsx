import type { MeStateResponse } from '@mathlens/shared';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Clock, Lock, LogOut, PlayCircle } from 'lucide-react';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate } from 'react-router-dom';
import { StudentShell } from '@/components/layouts/StudentShell';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { apiRequest } from '@/lib/api';
import { useUiStore } from '@/store/uiStore';

export default function StudentPortalPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const locale = useUiStore((s) => s.locale);

  const stateQuery = useQuery({
    queryKey: ['student', 'state'],
    queryFn: () => apiRequest<MeStateResponse>('/student/me/state'),
    retry: false,
    refetchInterval: (query) => {
      const step = query.state.data?.step;
      return step === 'PRETEST_SUBMITTED' ||
        step === 'PRETEST_GRADING' ||
        step === 'POSTTEST_GRADING'
        ? 3000
        : false;
    },
  });

  if (stateQuery.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-slate-600">
        {t('app.loading')}
      </div>
    );
  }

  if (stateQuery.isError || !stateQuery.data) {
    return <Navigate to="/" replace />;
  }

  const data = stateQuery.data;

  if (data.step === 'CONSENT') {
    return <Navigate to="/student/consent" replace />;
  }

  const handleLeave = async () => {
    await apiRequest('/student/logout', { method: 'POST' }).catch(() => undefined);
    void navigate('/');
  };

  return (
    <StudentShell studentName={data.student.displayName}>
      <div className="mx-auto max-w-xl space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-900">{data.topic.title}</h1>
            <p className="text-xs text-slate-500">{data.student.cohortName}</p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              void handleLeave();
            }}
          >
            <LogOut className="h-4 w-4" />
            <span>{t('student.portal.signOut')}</span>
          </Button>
        </div>

        {data.step === 'PRETEST_IN_PROGRESS' && (
          <Card>
            <CardHeader>
              <CardTitle>{t('teacher.builder.model1')}</CardTitle>
              <CardDescription>{data.topic.title}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button size="lg" className="w-full" onClick={() => void navigate('/student/exam/1')}>
                <PlayCircle className="h-5 w-5" />
                <span>
                  {data.preTestAttempt
                    ? t('student.portal.resumeModel1')
                    : t('student.portal.startModel1')}
                </span>
              </Button>
            </CardContent>
          </Card>
        )}

        {(data.step === 'PRETEST_SUBMITTED' ||
          data.step === 'PRETEST_GRADING' ||
          data.step === 'POSTTEST_GRADING') && (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2 text-brand-700">
                <Clock className="h-5 w-5" />
                <CardTitle>{t('student.portal.pretestGradingTitle')}</CardTitle>
              </div>
              <CardDescription>{t('student.portal.pretestGradingDesc')}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => void stateQuery.refetch()}>
                {t('student.portal.refreshStatus')}
              </Button>
              {(data.step === 'POSTTEST_GRADING' ? data.postTestAttempt?.id : data.preTestAttempt?.id) && (
                <Button
                  variant="primary"
                  onClick={() =>
                    void navigate(
                      `/student/results/${
                        data.step === 'POSTTEST_GRADING'
                          ? data.postTestAttempt?.id
                          : data.preTestAttempt?.id
                      }`,
                    )
                  }
                >
                  {t('results.viewDetails')}
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {(data.step === 'PRETEST_RESULTS' || data.step === 'REMEDIATION') && (
          <Card className="space-y-4">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>{t('student.portal.pretestResultsTitle')}</CardTitle>
                <Badge tone="warning" className="gap-1">
                  <Lock className="h-3.5 w-3.5" />
                  <span>{t('student.portal.posttestLockedTitle')}</span>
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.postTestLockReason && (
                <Alert tone="warning">
                  {locale === 'ar'
                    ? data.postTestLockReason.message_ar
                    : data.postTestLockReason.message_en}
                </Alert>
              )}
              <div className="text-xs text-slate-600" dir="ltr">
                {data.videoProgress.watchedSeconds}s / {data.videoProgress.minWatchSeconds}s
              </div>
              {(data.step === 'REMEDIATION' ||
                data.postTestLockReason?.code === 'VIDEO_INCOMPLETE' ||
                data.postTestLockReason?.code === 'WRONG_SEGMENTS_REQUIRED') && (
                <Button
                  variant="primary"
                  className="w-full"
                  onClick={() => void navigate('/student/remediation')}
                >
                  <PlayCircle className="h-5 w-5" />
                  <span>{t('student.portal.watchRemediation')}</span>
                </Button>
              )}
              {data.preTestAttempt && (
                <Button
                  variant={
                    data.step === 'REMEDIATION' ||
                    data.postTestLockReason?.code === 'VIDEO_INCOMPLETE' ||
                    data.postTestLockReason?.code === 'WRONG_SEGMENTS_REQUIRED'
                      ? 'outline'
                      : 'primary'
                  }
                  className="w-full"
                  onClick={() => void navigate(`/student/results/${data.preTestAttempt?.id}`)}
                >
                  {t('results.viewDetails')}
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {(data.step === 'POSTTEST_UNLOCKED' || data.step === 'POSTTEST_IN_PROGRESS') && (
          <Card>
            <CardHeader>
              <CardTitle>{t('teacher.builder.model2')}</CardTitle>
            </CardHeader>
            <CardContent>
              <Button size="lg" className="w-full" onClick={() => void navigate('/student/exam/2')}>
                <PlayCircle className="h-5 w-5" />
                <span>
                  {data.postTestAttempt
                    ? t('student.portal.resumeModel2')
                    : t('student.portal.startModel2')}
                </span>
              </Button>
            </CardContent>
          </Card>
        )}

        {data.step === 'COMPARISON' && (
          <Card>
            <CardContent className="space-y-3 pt-6">
              <Alert tone="success" className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 shrink-0" />
                <span>{t('student.portal.comparisonReady')}</span>
              </Alert>
              <Button
                size="lg"
                className="w-full"
                onClick={() => void navigate('/student/comparison')}
              >
                {t('student.portal.viewComparison')}
              </Button>
              {data.postTestAttempt && (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => void navigate(`/student/results/${data.postTestAttempt?.id}`)}
                >
                  {t('student.portal.viewModel2Results')}
                </Button>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </StudentShell>
  );
}
