import { zodResolver } from '@hookform/resolvers/zod';
import {
  StudentJoinSchema,
  StudentResumeSchema,
  type StudentJoinInput,
  type StudentJoinResponse,
  type StudentResumeInput,
} from '@mathlens/shared';
import { Check, Copy, Printer } from 'lucide-react';
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

  const [mode, setMode] = React.useState<'join' | 'resume'>('join');
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [joinedStudent, setJoinedStudent] = React.useState<StudentJoinResponse['student'] | null>(
    null,
  );
  const [copied, setCopied] = React.useState(false);

  const joinForm = useForm<StudentJoinInput>({
    resolver: zodResolver(StudentJoinSchema),
    defaultValues: { joinCode: '', displayName: '' },
  });

  const resumeForm = useForm<StudentResumeInput>({
    resolver: zodResolver(StudentResumeSchema),
    defaultValues: { resumeCode: '' },
  });

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
      <StudentShell studentName={joinedStudent.displayName}>
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
              {t('landing.joinTitle')}
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

        <Card className="bg-slate-100/70">
          <p className="mb-2 text-xs font-semibold text-slate-600">معاينة عرض المعادلات (LTR):</p>
          <MathBlock text="If $y = x^{\sin x}$, find $\frac{dy}{dx}$." />
        </Card>
      </div>
    </StudentShell>
  );
}
