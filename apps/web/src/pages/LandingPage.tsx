import { zodResolver } from '@hookform/resolvers/zod';
import {
  StudentJoinSchema,
  StudentLoginSchema,
  StudentRegisterSchema,
  StudentResumeSchema,
  type StudentAccountMeResponse,
  type StudentJoinInput,
  type StudentJoinResponse,
  type StudentLoginInput,
  type StudentRegisterInput,
  type StudentResumeInput,
} from '@mathlens/shared';
import { Check, Copy, KeyRound, LogIn, Printer, UserPlus } from 'lucide-react';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { StudentShell } from '@/components/layouts/StudentShell';
import { MathBlock } from '@/components/MathBlock';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input, Label } from '@/components/ui/Input';
import { apiRequest, getApiErrorMessage } from '@/lib/api';
import { useUiStore } from '@/store/uiStore';

export default function LandingPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const locale = useUiStore((s) => s.locale);

  const [accountTab, setAccountTab] = React.useState<'login' | 'register'>('login');
  const [accountError, setAccountError] = React.useState<string | null>(null);
  const [accountSubmitting, setAccountSubmitting] = React.useState(false);

  const [mode, setMode] = React.useState<'join' | 'resume'>('join');
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [joinedStudent, setJoinedStudent] = React.useState<StudentJoinResponse['student'] | null>(
    null,
  );
  const [copied, setCopied] = React.useState(false);

  const loginForm = useForm<StudentLoginInput>({
    resolver: zodResolver(StudentLoginSchema),
    defaultValues: { email: '', password: '' },
  });

  const registerForm = useForm<StudentRegisterInput>({
    resolver: zodResolver(StudentRegisterSchema),
    defaultValues: { displayName: '', email: '', password: '', consentAccepted: true },
  });

  const joinForm = useForm<StudentJoinInput>({
    resolver: zodResolver(StudentJoinSchema),
    defaultValues: { joinCode: '', displayName: '' },
  });

  const resumeForm = useForm<StudentResumeInput>({
    resolver: zodResolver(StudentResumeSchema),
    defaultValues: { resumeCode: '' },
  });

  const onStudentLoginSubmit = async (data: StudentLoginInput) => {
    setAccountError(null);
    setAccountSubmitting(true);
    try {
      await apiRequest<StudentAccountMeResponse>('/auth/student/login', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      void navigate('/student');
    } catch (err) {
      setAccountError(getApiErrorMessage(err, locale, t('errors.generic')));
    } finally {
      setAccountSubmitting(false);
    }
  };

  const onStudentRegisterSubmit = async (data: StudentRegisterInput) => {
    setAccountError(null);
    setAccountSubmitting(true);
    try {
      await apiRequest<StudentAccountMeResponse>('/auth/student/register', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      void navigate('/student');
    } catch (err) {
      setAccountError(getApiErrorMessage(err, locale, t('errors.generic')));
    } finally {
      setAccountSubmitting(false);
    }
  };

  const onJoinSubmit = async (data: StudentJoinInput) => {
    setErrorMsg(null);
    setSubmitting(true);
    try {
      const res = await apiRequest<StudentJoinResponse>('/student/join', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      setJoinedStudent(res.student);
    } catch (err) {
      setErrorMsg(getApiErrorMessage(err, locale, t('errors.generic')));
    } finally {
      setSubmitting(false);
    }
  };

  const onResumeSubmit = async (data: StudentResumeInput) => {
    setErrorMsg(null);
    setSubmitting(true);
    try {
      await apiRequest<StudentJoinResponse>('/student/resume', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      void navigate('/student');
    } catch (err) {
      setErrorMsg(getApiErrorMessage(err, locale, t('errors.generic')));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopyCode = async () => {
    if (!joinedStudent) return;
    await navigator.clipboard?.writeText(joinedStudent.resumeCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  if (joinedStudent) {
    return (
      <StudentShell studentName={joinedStudent.displayName} studentEmail={joinedStudent.email}>
        <Card className="mx-auto max-w-lg space-y-5 text-center">
          <CardHeader>
            <CardTitle className="text-xl text-brand-700">{t('student.resumeCardTitle')}</CardTitle>
            <CardDescription>{t('student.resumeCardSubtitle')}</CardDescription>
          </CardHeader>

          <div
            dir="ltr"
            className="mx-auto rounded-2xl border-2 border-brand-600 bg-brand-50 px-6 py-4 font-mono text-3xl font-extrabold tracking-[0.35em] text-brand-900 select-all"
          >
            {joinedStudent.resumeCode}
          </div>

          <div className="flex flex-wrap justify-center gap-3 print:hidden">
            <Button
              variant="outline"
              onClick={() => {
                void handleCopyCode();
              }}
            >
              {copied ? (
                <Check className="h-4 w-4 text-emerald-600" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
              <span>{copied ? t('student.copied') : t('student.copyCode')}</span>
            </Button>
            <Button variant="outline" onClick={() => window.print()}>
              <Printer className="h-4 w-4" />
              <span>{t('student.printCode')}</span>
            </Button>
          </div>

          <Button
            size="lg"
            className="w-full print:hidden"
            onClick={() => {
              void navigate('/student/consent');
            }}
          >
            {t('student.continueToConsent')}
          </Button>
        </Card>
      </StudentShell>
    );
  }

  return (
    <StudentShell>
      <div className="space-y-6">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold text-slate-900">{t('app.name')}</h1>
          <p className="text-sm text-slate-600">{t('app.subtitle')}</p>
        </div>

        {/* Primary Student Account Card (Email + Password) */}
        <Card className="border-brand-200 shadow-sm">
          <div className="mb-4 flex flex-wrap gap-2 border-b border-slate-200 pb-3">
            <Button
              variant={accountTab === 'login' ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => {
                setAccountTab('login');
                setAccountError(null);
              }}
            >
              <LogIn className="h-4 w-4" />
              <span>{t('landing.loginTab')}</span>
            </Button>
            <Button
              variant={accountTab === 'register' ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => {
                setAccountTab('register');
                setAccountError(null);
              }}
            >
              <UserPlus className="h-4 w-4" />
              <span>{t('landing.registerTab')}</span>
            </Button>
          </div>

          {accountError ? (
            <Alert tone="danger" className="mb-4">
              {accountError}
            </Alert>
          ) : null}

          {accountTab === 'login' ? (
            <form
              onSubmit={(e) => void loginForm.handleSubmit(onStudentLoginSubmit)(e)}
              className="space-y-4"
            >
              <CardHeader className="mb-2">
                <CardTitle>{t('landing.loginTitle')}</CardTitle>
                <CardDescription>{t('landing.loginDesc')}</CardDescription>
              </CardHeader>

              <div>
                <Label htmlFor="studentLoginEmail">{t('landing.email')}</Label>
                <Input
                  id="studentLoginEmail"
                  type="email"
                  dir="ltr"
                  autoComplete="email"
                  placeholder="student@example.com"
                  {...loginForm.register('email')}
                />
                {loginForm.formState.errors.email ? (
                  <p className="mt-1 text-xs text-red-600">
                    {loginForm.formState.errors.email.message}
                  </p>
                ) : null}
              </div>

              <div>
                <Label htmlFor="studentLoginPassword">{t('landing.password')}</Label>
                <Input
                  id="studentLoginPassword"
                  type="password"
                  dir="ltr"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  {...loginForm.register('password')}
                />
                {loginForm.formState.errors.password ? (
                  <p className="mt-1 text-xs text-red-600">
                    {loginForm.formState.errors.password.message}
                  </p>
                ) : null}
              </div>

              <Button type="submit" className="w-full" size="lg" disabled={accountSubmitting}>
                <LogIn className="h-4 w-4" />
                <span>{accountSubmitting ? t('app.loading') : t('landing.loginButton')}</span>
              </Button>
            </form>
          ) : (
            <form
              onSubmit={(e) => void registerForm.handleSubmit(onStudentRegisterSubmit)(e)}
              className="space-y-4"
            >
              <CardHeader className="mb-2">
                <CardTitle>{t('landing.registerTitle')}</CardTitle>
                <CardDescription>{t('landing.registerDesc')}</CardDescription>
              </CardHeader>

              <div>
                <Label htmlFor="studentRegisterName">{t('landing.displayName')}</Label>
                <Input
                  id="studentRegisterName"
                  placeholder="عبدالله محمد العتيبي"
                  {...registerForm.register('displayName')}
                />
                {registerForm.formState.errors.displayName ? (
                  <p className="mt-1 text-xs text-red-600">
                    {registerForm.formState.errors.displayName.message}
                  </p>
                ) : null}
              </div>

              <div>
                <Label htmlFor="studentRegisterEmail">{t('landing.email')}</Label>
                <Input
                  id="studentRegisterEmail"
                  type="email"
                  dir="ltr"
                  autoComplete="email"
                  placeholder="student@example.com"
                  {...registerForm.register('email')}
                />
                {registerForm.formState.errors.email ? (
                  <p className="mt-1 text-xs text-red-600">
                    {registerForm.formState.errors.email.message}
                  </p>
                ) : null}
              </div>

              <div>
                <Label htmlFor="studentRegisterPassword">{t('landing.password')}</Label>
                <Input
                  id="studentRegisterPassword"
                  type="password"
                  dir="ltr"
                  autoComplete="new-password"
                  placeholder="••••••••"
                  {...registerForm.register('password')}
                />
                {registerForm.formState.errors.password ? (
                  <p className="mt-1 text-xs text-red-600">
                    {registerForm.formState.errors.password.message}
                  </p>
                ) : null}
              </div>

              <label className="flex items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600"
                  {...registerForm.register('consentAccepted')}
                />
                <span>{t('landing.consentInline')}</span>
              </label>

              <Button type="submit" className="w-full" size="lg" disabled={accountSubmitting}>
                <UserPlus className="h-4 w-4" />
                <span>{accountSubmitting ? t('app.loading') : t('landing.registerButton')}</span>
              </Button>
            </form>
          )}
        </Card>

        {/* Quick Cohort Code / Resume Code Card */}
        <Card>
          <div className="mb-4 flex gap-2 border-b border-slate-200 pb-3">
            <Button
              variant={mode === 'join' ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => {
                setMode('join');
                setErrorMsg(null);
              }}
            >
              <KeyRound className="h-4 w-4" />
              <span>{t('landing.joinTitle')}</span>
            </Button>
            <Button
              variant={mode === 'resume' ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => {
                setMode('resume');
                setErrorMsg(null);
              }}
            >
              {t('landing.resumeTitle')}
            </Button>
          </div>

          {errorMsg ? (
            <Alert tone="danger" className="mb-4">
              {errorMsg}
            </Alert>
          ) : null}

          {mode === 'join' ? (
            <form
              onSubmit={(e) => void joinForm.handleSubmit(onJoinSubmit)(e)}
              className="space-y-4"
            >
              <CardHeader className="mb-2">
                <CardTitle>{t('landing.joinTitle')}</CardTitle>
                <CardDescription>{t('landing.joinDesc')}</CardDescription>
              </CardHeader>

              <div>
                <Label htmlFor="joinCode">{t('landing.cohortCode')}</Label>
                <Input
                  id="joinCode"
                  dir="ltr"
                  className="font-mono uppercase tracking-widest"
                  maxLength={6}
                  placeholder="A7K9M2"
                  {...joinForm.register('joinCode')}
                />
                {joinForm.formState.errors.joinCode ? (
                  <p className="mt-1 text-xs text-red-600">
                    {joinForm.formState.errors.joinCode.message}
                  </p>
                ) : null}
              </div>

              <div>
                <Label htmlFor="displayName">{t('landing.displayName')}</Label>
                <Input
                  id="displayName"
                  placeholder="يوسف محمد"
                  {...joinForm.register('displayName')}
                />
                {joinForm.formState.errors.displayName ? (
                  <p className="mt-1 text-xs text-red-600">
                    {joinForm.formState.errors.displayName.message}
                  </p>
                ) : null}
              </div>

              <Button type="submit" className="w-full" size="lg" disabled={submitting}>
                {submitting ? t('app.loading') : t('landing.joinButton')}
              </Button>
            </form>
          ) : (
            <form
              onSubmit={(e) => void resumeForm.handleSubmit(onResumeSubmit)(e)}
              className="space-y-4"
            >
              <CardHeader className="mb-2">
                <CardTitle>{t('landing.resumeTitle')}</CardTitle>
              </CardHeader>
              <div>
                <Label htmlFor="resumeCode">{t('landing.resumeCode')}</Label>
                <Input
                  id="resumeCode"
                  dir="ltr"
                  className="font-mono uppercase tracking-widest"
                  maxLength={6}
                  placeholder="K4M8P2"
                  {...resumeForm.register('resumeCode')}
                />
                {resumeForm.formState.errors.resumeCode ? (
                  <p className="mt-1 text-xs text-red-600">
                    {resumeForm.formState.errors.resumeCode.message}
                  </p>
                ) : null}
              </div>

              <Button type="submit" className="w-full" size="lg" disabled={submitting}>
                {submitting ? t('app.loading') : t('landing.resumeButton')}
              </Button>
            </form>
          )}
        </Card>

        <div className="grid gap-3 sm:grid-cols-3">
          <Card className="border-slate-200/80 bg-white/90">
            <div className="space-y-1.5">
              <div className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-brand-50 font-mono text-xs font-bold text-brand-700">
                01
              </div>
              <h3 className="text-sm font-bold text-slate-900">
                {t('ux.landing.feature1Title')}
              </h3>
              <p className="text-xs leading-relaxed text-slate-600">
                {t('ux.landing.feature1Desc')}
              </p>
            </div>
          </Card>

          <Card className="border-slate-200/80 bg-white/90">
            <div className="space-y-1.5">
              <div className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50 font-mono text-xs font-bold text-emerald-700">
                02
              </div>
              <h3 className="text-sm font-bold text-slate-900">
                {t('ux.landing.feature2Title')}
              </h3>
              <p className="text-xs leading-relaxed text-slate-600">
                {t('ux.landing.feature2Desc')}
              </p>
            </div>
          </Card>

          <Card className="border-slate-200/80 bg-white/90">
            <div className="space-y-1.5">
              <div className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-amber-50 font-mono text-xs font-bold text-amber-700">
                03
              </div>
              <h3 className="text-sm font-bold text-slate-900">
                {t('ux.landing.feature3Title')}
              </h3>
              <p className="text-xs leading-relaxed text-slate-600">
                {t('ux.landing.feature3Desc')}
              </p>
            </div>
          </Card>
        </div>

        <Card className="bg-slate-100/70">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold text-slate-600">{t('ux.journey.title')}:</p>
            <MathBlock text="If $y = x^{\sin x}$, find $\frac{dy}{dx}$." />
          </div>
        </Card>
      </div>
    </StudentShell>
  );
}
