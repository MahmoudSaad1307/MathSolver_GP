import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useUiStore, applyDocumentDirection } from '@/store/uiStore';

const LandingPage = React.lazy(() => import('@/pages/LandingPage'));
const TeacherLoginPage = React.lazy(() => import('@/pages/teacher/TeacherLoginPage'));
const TeacherDashboardHome = React.lazy(() => import('@/pages/teacher/TeacherDashboardHome'));
const TopicsPage = React.lazy(() => import('@/pages/teacher/TopicsPage'));
const TopicBuilderPage = React.lazy(() => import('@/pages/teacher/TopicBuilderPage'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

export function App() {
  const locale = useUiStore((s) => s.locale);

  React.useEffect(() => {
    applyDocumentDirection(locale);
  }, [locale]);

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <React.Suspense
          fallback={
            <div className="flex min-h-screen items-center justify-center text-sm text-slate-600">
              جارٍ التحميل...
            </div>
          }
        >
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/teacher/login" element={<TeacherLoginPage />} />
            <Route path="/teacher" element={<TeacherDashboardHome />} />
            <Route path="/teacher/topics" element={<TopicsPage />} />
            <Route path="/teacher/topics/:topicId" element={<TopicBuilderPage />} />
            <Route path="/teacher/*" element={<TeacherDashboardHome />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </React.Suspense>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
