import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate } from 'react-router-dom';
import { TeacherShell } from '@/components/layouts/TeacherShell';
import { Alert } from '@/components/ui/Alert';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { useTeacherAuth } from '@/hooks/useTeacherAuth';

export default function TeacherDashboardHome() {
  const { t } = useTranslation();
  const meQuery = useTeacherAuth();

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

  const { teacher } = meQuery.data;

  return (
    <TeacherShell teacherName={teacher.displayName}>
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-slate-900">
          {t('teacher.welcome', { name: teacher.displayName })}
        </h1>
        <Alert tone="info">{t('teacher.readyBanner')}</Alert>
        <div className="grid gap-4 md:grid-cols-3">
          <Link to="/teacher/topics" className="block transition hover:shadow-md rounded-xl">
            <Card>
              <CardHeader>
                <CardTitle>{t('teacher.nav.topics')}</CardTitle>
                <CardDescription>{teacher.email}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
          <Card>
            <CardHeader>
              <CardTitle>{t('teacher.nav.cohorts')}</CardTitle>
              <CardDescription>TREATMENT / CONTROL</CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t('teacher.nav.review')}</CardTitle>
              <CardDescription>AI Quality Gate</CardDescription>
            </CardHeader>
          </Card>
        </div>
      </div>
    </TeacherShell>
  );
}
