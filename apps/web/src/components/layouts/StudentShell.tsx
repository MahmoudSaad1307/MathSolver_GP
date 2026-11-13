import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

export function StudentShell({
  studentName,
  children,
}: {
  studentName?: string;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-brand-700 focus:px-4 focus:py-2 focus:text-white"
      >
        {t('app.skipToContent')}
      </a>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Link to="/" className="flex items-center gap-2 font-bold text-brand-700">
            <span
              aria-hidden="true"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm text-white"
            >
              ∑
            </span>
            <span>{t('app.name')}</span>
          </Link>
          <div className="flex items-center gap-3">
            {studentName && (
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                {studentName}
              </span>
            )}
            <Link
              to="/teacher/login"
              className="text-xs font-semibold text-slate-600 hover:text-brand-700"
            >
              {t('landing.teacherLink')}
            </Link>
          </div>
        </div>
      </header>
      <main id="main-content" className="mx-auto max-w-3xl px-4 py-6">
        {children}
      </main>
    </div>
  );
}
