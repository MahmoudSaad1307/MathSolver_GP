import { zodResolver } from '@hookform/resolvers/zod';
import { TeacherLoginSchema, type TeacherLoginInput, type TeacherProfile } from '@mathlens/shared';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input, Label } from '@/components/ui/Input';
import { ApiClientError, apiRequest } from '@/lib/api';
import { useUiStore } from '@/store/uiStore';

export default function TeacherLoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const locale = useUiStore((s) => s.locale);
  const [serverError, setServerError] = React.useState<string | null>(null);

  const form = useForm<TeacherLoginInput>({
    resolver: zodResolver(TeacherLoginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = async (values: TeacherLoginInput) => {
    setServerError(null);
    try {
      await apiRequest<{ teacher: TeacherProfile }>('/auth/teacher/login', {
        method: 'POST',
        body: JSON.stringify(values),
      });
      void navigate('/teacher');
    } catch (err) {
      if (err instanceof ApiClientError) {
        setServerError(locale === 'ar' ? err.messageAr : err.messageEn);
      } else {
        setServerError(t('errors.network'));
      }
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-8">
      <div className="w-full max-w-md space-y-4">
        <div className="text-center">
          <Link to="/" className="text-sm font-semibold text-brand-700 hover:underline">
            {t('app.name')}
          </Link>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t('teacher.loginTitle')}</CardTitle>
            <CardDescription>{t('teacher.loginSubtitle')}</CardDescription>
          </CardHeader>

          {serverError ? (
            <Alert tone="danger" className="mb-4">
              {serverError}
            </Alert>
          ) : null}

          <form
            onSubmit={(e) => void form.handleSubmit(onSubmit)(e)}
            className="space-y-4"
            noValidate
          >
            <div>
              <Label htmlFor="email">{t('teacher.email')}</Label>
              <Input
                id="email"
                type="email"
                dir="ltr"
                autoComplete="email"
                {...form.register('email')}
              />
              {form.formState.errors.email ? (
                <p className="mt-1 text-xs text-red-600">{form.formState.errors.email.message}</p>
              ) : null}
            </div>

            <div>
              <Label htmlFor="password">{t('teacher.password')}</Label>
              <Input
                id="password"
                type="password"
                dir="ltr"
                autoComplete="current-password"
                {...form.register('password')}
              />
              {form.formState.errors.password ? (
                <p className="mt-1 text-xs text-red-600">
                  {form.formState.errors.password.message}
                </p>
              ) : null}
            </div>

            <Button
              type="submit"
              className="w-full"
              size="lg"
              disabled={form.formState.isSubmitting}
            >
              {form.formState.isSubmitting ? t('app.loading') : t('teacher.signIn')}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
