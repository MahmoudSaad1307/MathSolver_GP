import { zodResolver } from '@hookform/resolvers/zod';
import {
  StudentJoinSchema,
  StudentResumeSchema,
  type StudentJoinInput,
  type StudentResumeInput,
} from '@mathlens/shared';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { StudentShell } from '@/components/layouts/StudentShell';
import { MathBlock } from '@/components/MathBlock';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input, Label } from '@/components/ui/Input';

export default function LandingPage() {
  const { t } = useTranslation();
  const [mode, setMode] = React.useState<'join' | 'resume'>('join');
  const [statusMessage, setStatusMessage] = React.useState<string | null>(null);

  const joinForm = useForm<StudentJoinInput>({
    resolver: zodResolver(StudentJoinSchema),
    defaultValues: { joinCode: '', displayName: '' },
  });

  const resumeForm = useForm<StudentResumeInput>({
    resolver: zodResolver(StudentResumeSchema),
    defaultValues: { resumeCode: '' },
  });

  const onJoinSubmit = (_data: StudentJoinInput) => {
    setStatusMessage('سيتم تفعيل الانضمام المباشر للمجموعات في المرحلة الثالثة.');
  };

  const onResumeSubmit = (_data: StudentResumeInput) => {
    setStatusMessage('سيتم تفعيل استرجاع الجلسة في المرحلة الثالثة.');
  };

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
              onClick={() => setMode('join')}
            >
              {t('landing.joinTitle')}
            </Button>
            <Button
              variant={mode === 'resume' ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => setMode('resume')}
            >
              {t('landing.resumeTitle')}
            </Button>
          </div>

          {statusMessage ? (
            <Alert tone="info" className="mb-4">
              {statusMessage}
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

              <Button type="submit" className="w-full" size="lg">
                {t('landing.joinButton')}
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

              <Button type="submit" className="w-full" size="lg">
                {t('landing.resumeButton')}
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
