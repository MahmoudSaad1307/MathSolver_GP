import type { MeStateResponse } from '@mathlens/shared';
import { ShieldCheck } from 'lucide-react';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate } from 'react-router-dom';
import { StudentShell } from '@/components/layouts/StudentShell';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { apiRequest, getApiErrorMessage } from '@/lib/api';
import { useUiStore } from '@/store/uiStore';

export default function StudentConsentPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const locale = useUiStore((s) => s.locale);

  const [loadingState, setLoadingState] = React.useState(true);
  const [studentName, setStudentName] = React.useState<string | undefined>();
  const [alreadyAccepted, setAlreadyAccepted] = React.useState(false);
  const [unauth, setUnauth] = React.useState(false);
  const [accepted, setAccepted] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  React.useEffect(() => {
    void apiRequest<MeStateResponse>('/student/me/state', {
      retryStudentRefresh: true,
    })
      .then((state) => {
        setStudentName(state.student.displayName);
        if (state.student.consentAcceptedAt) {
          setAlreadyAccepted(true);
        }
      })
      .catch(() => setUnauth(true))
      .finally(() => setLoadingState(false));
  }, []);

  if (loadingState) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-slate-600">
        {t('app.loading')}
      </div>
    );
  }

  if (unauth) {
    return <Navigate to="/" replace />;
  }

  if (alreadyAccepted) {
    return <Navigate to="/student" replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accepted) return;
    setErrorMsg(null);
    setSaving(true);
    try {
      await apiRequest<MeStateResponse>('/student/consent', {
        method: 'POST',
        body: JSON.stringify({ accepted: true }),
        retryStudentRefresh: true,
      });
      void navigate('/student/exam/1');
    } catch (err) {
      setErrorMsg(getApiErrorMessage(err, locale, t('errors.generic')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <StudentShell studentName={studentName}>
      <Card className="mx-auto max-w-xl">
        <CardHeader>
          <div className="flex items-center gap-2 text-brand-700">
            <ShieldCheck className="h-6 w-6" />
            <CardTitle>{t('student.consentTitle')}</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              void handleSubmit(e);
            }}
            className="space-y-4"
          >
            {errorMsg && <Alert tone="danger">{errorMsg}</Alert>}

            <ul className="list-disc space-y-2 ps-5 text-sm leading-relaxed text-slate-700">
              <li>{t('student.consentPoint1')}</li>
              <li>{t('student.consentPoint2')}</li>
              <li>{t('student.consentPoint3')}</li>
            </ul>

            <label className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm font-semibold text-slate-800">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
                className="h-5 w-5"
              />
              <span>{t('student.consentCheckbox')}</span>
            </label>

            <Button type="submit" size="lg" className="w-full" disabled={!accepted || saving}>
              {saving ? t('app.loading') : t('student.consentSubmit')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </StudentShell>
  );
}
