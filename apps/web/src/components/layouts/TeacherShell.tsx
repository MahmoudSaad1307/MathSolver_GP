import {
  BookOpen,
  BarChart3,
  CheckSquare,
  Coins,
  LayoutDashboard,
  LogOut,
  Menu,
  Users,
  UsersRound,
  X,
} from 'lucide-react';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { apiRequest } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/store/uiStore';

interface TeacherShellProps {
  teacherName: string;
  children: React.ReactNode;
}

const navItems = [
  { to: '/teacher', key: 'overview', icon: LayoutDashboard, end: true },
  { to: '/teacher/topics', key: 'topics', icon: BookOpen },
  { to: '/teacher/cohorts', key: 'cohorts', icon: UsersRound },
  { to: '/teacher/students', key: 'students', icon: Users },
  { to: '/teacher/review', key: 'review', icon: CheckSquare },
  { to: '/teacher/analytics', key: 'analytics', icon: BarChart3 },
  { to: '/teacher/usage', key: 'usage', icon: Coins },
] as const;

export function TeacherShell({ teacherName, children }: TeacherShellProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { locale, setLocale, sidebarOpen, setSidebarOpen, toggleSidebar } = useUiStore();

  const handleLogout = async () => {
    await apiRequest('/auth/teacher/logout', { method: 'POST' }).catch(() => undefined);
    void navigate('/teacher/login');
  };

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900">
      <a
        href="#teacher-main"
        className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-brand-700 focus:px-4 focus:py-2 focus:text-white"
      >
        {t('app.skipToContent')}
      </a>

      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/40 backdrop-blur-2xs lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 start-0 z-40 w-64 border-e border-slate-200 bg-white shadow-sm transition-transform lg:static lg:translate-x-0 lg:shadow-none',
          sidebarOpen
            ? 'translate-x-0'
            : locale === 'ar'
              ? 'translate-x-full'
              : '-translate-x-full',
        )}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-4">
          <Link to="/teacher" className="flex items-center gap-2 font-bold text-brand-700">
            <span
              aria-hidden="true"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm text-white"
            >
              ∑
            </span>
            <span>{t('app.name')}</span>
          </Link>
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="rounded-lg p-2 text-slate-600 lg:hidden"
            aria-label="Close navigation"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="space-y-1 p-3" aria-label="Teacher navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={'end' in item ? item.end : false}
                onClick={() => setSidebarOpen(false)}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                    isActive
                      ? 'border-s-4 border-brand-600 bg-brand-50 font-semibold text-brand-700'
                      : 'text-slate-700 hover:bg-slate-100',
                  )
                }
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{t(`teacher.nav.${item.key}`)}</span>
              </NavLink>
            );
          })}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 lg:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={toggleSidebar}
              className="rounded-lg p-2 text-slate-700 hover:bg-slate-100 lg:hidden"
              aria-label="Toggle navigation"
            >
              <Menu className="h-5 w-5" />
            </button>
            <span className="text-sm font-semibold text-slate-800">{teacherName}</span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')}
            >
              {t('teacher.switchLang')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void handleLogout()}>
              <LogOut className="h-4 w-4" />
              <span>{t('teacher.signOut')}</span>
            </Button>
          </div>
        </header>

        <main id="teacher-main" className="flex-1 p-4 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
