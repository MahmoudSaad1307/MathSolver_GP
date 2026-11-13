import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useUiStore, applyDocumentDirection } from '@/store/uiStore';

const LandingPage = React.lazy(() => import('@/pages/LandingPage'));
const StudentConsentPage = React.lazy(() => import('@/pages/student/StudentConsentPage'));
const StudentPortalPage = React.lazy(() => import('@/pages/student/StudentPortalPage'));
const StudentExamPage = React.lazy(() => import('@/pages/student/StudentExamPage'));
const StudentResultsPage = React.lazy(() => import('@/pages/student/StudentResultsPage'));
const StudentRemediationPage = React.lazy(() => import('@/pages/student/StudentRemediationPage'));
const StudentComparisonPage = React.lazy(() => import('@/pages/student/StudentComparisonPage'));
const TeacherLoginPage = React.lazy(() => import('@/pages/teacher/TeacherLoginPage'));
const TeacherDashboardHome = React.lazy(() => import('@/pages/teacher/TeacherDashboardHome'));
const TopicsPage = React.lazy(() => import('@/pages/teacher/TopicsPage'));
const TopicBuilderPage = React.lazy(() => import('@/pages/teacher/TopicBuilderPage'));
const CohortsPage = React.lazy(() => import('@/pages/teacher/CohortsPage'));
const ReviewQueuePage = React.lazy(() => import('@/pages/teacher/ReviewQueuePage'));
const StudentsPage = React.lazy(() => import('@/pages/teacher/StudentsPage'));
const AnalyticsPage = React.lazy(() => import('@/pages/teacher/AnalyticsPage'));
const UsagePage = React.lazy(() => import('@/pages/teacher/UsagePage'));

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
            <Route path="/student" element={<StudentPortalPage />} />
            <Route path="/student/consent" element={<StudentConsentPage />} />
            <Route path="/student/exam/:modelNumber" element={<StudentExamPage />} />
            <Route path="/student/results/:attemptId" element={<StudentResultsPage />} />
            <Route path="/student/remediation" element={<StudentRemediationPage />} />
            <Route path="/student/comparison" element={<StudentComparisonPage />} />
            <Route path="/teacher/login" element={<TeacherLoginPage />} />
            <Route path="/teacher" element={<TeacherDashboardHome />} />
            <Route path="/teacher/topics" element={<TopicsPage />} />
            <Route path="/teacher/topics/:topicId" element={<TopicBuilderPage />} />
            <Route path="/teacher/cohorts" element={<CohortsPage />} />
            <Route path="/teacher/review" element={<ReviewQueuePage />} />
            <Route path="/teacher/students" element={<StudentsPage />} />
            <Route path="/teacher/analytics" element={<AnalyticsPage />} />
            <Route path="/teacher/usage" element={<UsagePage />} />
            <Route path="/teacher/*" element={<TeacherDashboardHome />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </React.Suspense>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
