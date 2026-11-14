import { zodResolver } from '@hookform/resolvers/zod';
import {
  StudentEnterQuizCodeSchema,
  type MeStateResponse,
  type StudentEnterQuizCodeInput,
  type StudentJoinResponse,
} from '@mathlens/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BookOpen,
  CheckCircle2,
  Clock,
  FileCheck2,
  KeyRound,
  Lock,
  LogOut,
  PlayCircle,
} from 'lucide-react';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate } from 'react-router-dom';
import { StudentShell } from '@/components/layouts/StudentShell';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input, Label } from '@/components/ui/Input';
import { useStudentAuth } from '@/hooks/useStudentAuth';
import { apiRequest, getApiErrorMessage } from '@/lib/api';
import { useUiStore } from '@/store/uiStore';

export default function StudentPortalPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const locale = useUiStore((s) => s.locale);

  const [quizCodeError, setQuizCodeError] = React.useState<string | null>(null);
  const [joiningQuiz, setJoiningQuiz] = React.useState(false);
  const [switchingId, setSwitchingId] = React.useState<string | null>(null);

  const accountQuery = useStudentAuth();

  const stateQuery = useQuery({
    queryKey: ['student', 'state'],
    queryFn: () =>
      apiRequest<MeStateResponse>('/student/me/state', {
        retryStudentRefresh: true,
      }),
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

  const quizCodeForm = useForm<StudentEnterQuizCodeInput>({
    resolver: zodResolver(StudentEnterQuizCodeSchema),
    defaultValues: { joinCode: '' },
  });

  const onEnterQuizCode = async (input: StudentEnterQuizCodeInput) => {
    setQuizCodeError(null);
    setJoiningQuiz(true);
    try {
      await apiRequest<StudentJoinResponse>('/student/join-quiz', {
        method: 'POST',
        body: JSON.stringify(input),
        retryStudentRefresh: true,
      });
      quizCodeForm.reset({ joinCode: '' });
      await Promise.all([accountQuery.refetch(), stateQuery.refetch()]);
    } catch (err) {
      setQuizCodeError(getApiErrorMessage(err, locale, t('errors.generic')));
    } finally {
      setJoiningQuiz(false);
    }
  };

  const handleSelectEnrollment = async (enrollmentId: string) => {
    setSwitchingId(enrollmentId);
    try {
      const nextState = await apiRequest<MeStateResponse>(
        `/student/enrollments/${enrollmentId}/select`,
        {
          method: 'POST',
          retryStudentRefresh: true,
        },
      );
      queryClient.setQueryData(['student', 'state'], nextState);
      await accountQuery.refetch();
    } finally {
      setSwitchingId(null);
    }
  };

  if (accountQuery.isLoading && stateQuery.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-slate-600">
        {t('app.loading')}
      </div>
    );
  }

  const accountData = accountQuery.data ?? null;
  const data = stateQuery.data ?? null;

  if (!accountData && !data) {
    if (accountQuery.isLoading || stateQuery.isLoading) {
      return (
        <div className="flex min-h-screen items-center justify-center text-sm text-slate-600">
          {t('app.loading')}
        </div>
      );
    }
    return <Navigate to="/" replace />;
  }

  if (data?.step === 'CONSENT') {
    return <Navigate to="/student/consent" replace />;
  }

  const handleLeave = async () => {
    await Promise.all([
      apiRequest('/auth/student/logout', { method: 'POST' }).catch(() => undefined),
      apiRequest('/student/logout', { method: 'POST' }).catch(() => undefined),
    ]);
    queryClient.removeQueries({ queryKey: ['student'] });
    void navigate('/');
  };

  const displayName = accountData?.account.displayName ?? data?.student.displayName ?? '';
  const displayEmail = accountData?.account.email ?? data?.student.email ?? null;
  const enrollments = accountData?.enrollments ?? [];
  const activeStudentId = data?.student.id ?? accountData?.activeEnrollmentId ?? null;

  return (
    <StudentShell studentName={displayName} studentEmail={displayEmail}>
      <div className="mx-auto max-w-2xl space-y-6">
        {/* Account / Header Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-xs">
          <div>
            <h1 className="text-lg font-bold text-slate-900">
              {data ? data.topic.title : displayName}
            </h1>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              {data ? <span>{data.student.cohortName}</span> : null}
              {displayEmail ? (
                <span className="font-mono text-slate-600" dir="ltr">
                  {displayEmail}
                </span>
              ) : null}
            </div>
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

        {/* Enter Quiz Code Card (shown for logged-in student accounts) */}
        {accountData && (
          <Card className="border-brand-200 bg-brand-50/30">
            <CardHeader>
              <div className="flex items-center gap-2 text-brand-700">
                <KeyRound className="h-5 w-5" />
                <CardTitle>{t('student.portal.enterQuizCodeTitle')}</CardTitle>
              </div>
              <CardDescription>{t('student.portal.enterQuizCodeDesc')}</CardDescription>
            </CardHeader>
            <CardContent>
              {quizCodeError ? (
                <Alert tone="danger" className="mb-3">
                  {quizCodeError}
                </Alert>
              ) : null}
              <form
                onSubmit={(e) => void quizCodeForm.handleSubmit(onEnterQuizCode)(e)}
                className="flex flex-col gap-3 sm:flex-row sm:items-start"
              >
                <div className="flex-1">
                  <Label htmlFor="portalQuizCode" className="sr-only">
                    {t('landing.cohortCode')}
                  </Label>
                  <Input
                    id="portalQuizCode"
                    dir="ltr"
                    maxLength={6}
                    className="font-mono uppercase tracking-widest bg-white"
                    placeholder={t('student.portal.enterQuizCodePlaceholder')}
                    {...quizCodeForm.register('joinCode')}
                  />
                  {quizCodeForm.formState.errors.joinCode ? (
                    <p className="mt-1 text-xs text-red-600">
                      {quizCodeForm.formState.errors.joinCode.message}
                    </p>
                  ) : null}
                </div>
                <Button type="submit" disabled={joiningQuiz}>
                  <KeyRound className="h-4 w-4" />
                  <span>
                    {joiningQuiz ? t('app.loading') : t('student.portal.enterQuizCodeButton')}
                  </span>
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        {/* Active Quiz Workflow Card */}
        {data && (
          <div className="space-y-4">
            {data.step === 'PRETEST_IN_PROGRESS' && (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle>{t('teacher.builder.model1')}</CardTitle>
                    <Badge tone="info">{t('student.portal.activeQuizBadge')}</Badge>
                  </div>
                  <CardDescription>{data.topic.title}</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button
                    size="lg"
                    className="w-full"
                    onClick={() => void navigate('/student/exam/1')}
                  >
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
                  {(data.step === 'POSTTEST_GRADING'
                    ? data.postTestAttempt?.id
                    : data.preTestAttempt?.id) && (
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
                    {data.videoProgress.watchedSeconds}s · {data.videoProgress.visitedCount} /{' '}
                    {data.videoProgress.requiredCount}
                  </div>
                  {(data.step === 'REMEDIATION' ||
                    data.postTestLockReason?.code === 'VIDEO_WATCH_INCOMPLETE' ||
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
                  <Button
                    size="lg"
                    className="w-full"
                    onClick={() => void navigate('/student/exam/2')}
                  >
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
        )}

        {/* Saved Quizzes & Exam History in Student Account */}
        {accountData && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-brand-700" />
              <h2 className="text-base font-bold text-slate-900">
                {t('student.portal.savedQuizzesTitle')}
              </h2>
            </div>

            {enrollments.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-sm text-slate-600">
                  {t('student.portal.savedQuizzesEmpty')}
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {enrollments.map((item) => {
                  const isActive = item.studentId === activeStudentId;
                  return (
                    <Card
                      key={item.studentId}
                      className={isActive ? 'border-brand-500 ring-1 ring-brand-500' : ''}
                    >
                      <CardHeader>
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <CardTitle className="text-base">{item.topicTitle}</CardTitle>
                            <CardDescription>
                              {item.cohortName} ·{' '}
                              <span className="font-mono font-semibold" dir="ltr">
                                {item.joinCode}
                              </span>
                            </CardDescription>
                          </div>
                          <div className="flex items-center gap-2">
                            {isActive && (
                              <Badge tone="info">{t('student.portal.activeQuizBadge')}</Badge>
                            )}
                            <Badge tone="neutral">{item.step}</Badge>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs">
                            <div className="font-semibold text-slate-700">
                              {t('student.portal.model1Score')}
                            </div>
                            <div className="mt-1 font-mono text-slate-900" dir="ltr">
                              {item.preTestAttempt
                                ? item.preTestAttempt.totalScore !== null &&
                                  item.preTestAttempt.maxScore !== null
                                  ? `${item.preTestAttempt.totalScore} / ${item.preTestAttempt.maxScore} (${item.preTestAttempt.status})`
                                  : item.preTestAttempt.status
                                : t('student.portal.notStarted')}
                            </div>
                          </div>

                          <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs">
                            <div className="font-semibold text-slate-700">
                              {t('student.portal.model2Score')}
                            </div>
                            <div className="mt-1 font-mono text-slate-900" dir="ltr">
                              {item.postTestAttempt
                                ? item.postTestAttempt.totalScore !== null &&
                                  item.postTestAttempt.maxScore !== null
                                  ? `${item.postTestAttempt.totalScore} / ${item.postTestAttempt.maxScore} (${item.postTestAttempt.status})`
                                  : item.postTestAttempt.status
                                : t('student.portal.notStarted')}
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          {!isActive && (
                            <Button
                              size="sm"
                              variant="primary"
                              disabled={switchingId === item.studentId}
                              onClick={() => {
                                void handleSelectEnrollment(item.studentId);
                              }}
                            >
                              <PlayCircle className="h-4 w-4" />
                              <span>{t('student.portal.switchQuizButton')}</span>
                            </Button>
                          )}

                          {item.preTestAttempt &&
                            item.preTestAttempt.status !== 'IN_PROGRESS' && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  void navigate(`/student/results/${item.preTestAttempt!.id}`)
                                }
                              >
                                <FileCheck2 className="h-4 w-4" />
                                <span>{t('student.portal.viewModel1Results')}</span>
                              </Button>
                            )}

                          {item.postTestAttempt &&
                            item.postTestAttempt.status !== 'IN_PROGRESS' && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  void navigate(`/student/results/${item.postTestAttempt!.id}`)
                                }
                              >
                                <FileCheck2 className="h-4 w-4" />
                                <span>{t('student.portal.viewModel2Results')}</span>
                              </Button>
                            )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </StudentShell>
  );
}
