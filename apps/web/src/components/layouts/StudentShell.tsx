import { Globe, User } from 'lucide-react';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useUiStore } from '@/store/uiStore';

export function StudentShell({
  studentName,
  studentEmail,
  children,
}: {
  studentName?: string;
  studentEmail?: string | null;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const { locale, setLocale } = useUiStore();

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-brand-700 focus:px-4 focus:py-2 focus:text-white"
      >
        {t('app.skipToContent')}
      </a>
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/95 backdrop-blur-xs">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <Link to="/" className="flex items-center gap-2.5 font-bold text-brand-700">
            <span
              aria-hidden="true"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm text-white shadow-xs"
            >
              ∑
            </span>
            <span className="text-base">{t('app.name')}</span>
          </Link>
          <div className="flex items-center gap-2 sm:gap-3">
            {studentName && (
              <Link
                to="/student"
                className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:border-brand-300 hover:bg-brand-50/50 hover:text-brand-700"
              >
                <User className="h-3.5 w-3.5 text-brand-600" />
                <span>{studentName}</span>
                {studentEmail ? (
                  <span className="hidden text-slate-500 sm:inline" dir="ltr">
                    ({studentEmail})
                  </span>
                ) : null}
              </Link>
            )}
            <button
              type="button"
              onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')}
              className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100"
              aria-label={t('teacher.switchLang')}
            >
              <Globe className="h-3.5 w-3.5 text-slate-500" />
              <span>{t('teacher.switchLang')}</span>
            </button>
            <Link
              to="/teacher/login"
              className="text-xs font-semibold text-slate-600 transition-colors hover:text-brand-700"
            >
              {t('landing.teacherLink')}
            </Link>
          </div>
        </div>
      </header>
      <main id="main-content" className="mx-auto max-w-4xl px-4 py-6">
        {children}
      </main>
    </div>
  );
}
