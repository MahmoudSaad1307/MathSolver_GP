import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Unlock } from 'lucide-react';
import { Button } from '../ui/Button';
import { apiRequest, getApiErrorMessage } from '../../lib/api';

interface UnlockPostTestButtonProps {
  studentId: string;
}

/** Allows a teacher to manually unlock Model 2 for an individual student. */
export function UnlockPostTestButton({ studentId }: UnlockPostTestButtonProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'en' ? 'en' : 'ar';
  const queryClient = useQueryClient();
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      apiRequest<{ studentId: string; unlockedPostAt: string }>(
        `/students/${studentId}/unlock-posttest`,
        {
          method: 'POST',
          body: JSON.stringify({}),
          retryRefresh: true,
        },
      ),
    onSuccess: async () => {
      setErrorMessage(null);
      setStatusMessage(t('students.unlockSuccess'));
      await queryClient.invalidateQueries({ queryKey: ['teacher', 'students'] });
      await queryClient.invalidateQueries({ queryKey: ['teacher', 'student', studentId] });
    },
    onError: (err) => {
      setStatusMessage(null);
      setErrorMessage(getApiErrorMessage(err, locale, t('errors.generic')));
    },
  });

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="secondary"
        disabled={mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        <Unlock className="h-4 w-4" />
        <span>{t('students.unlockPostTestNow')}</span>
      </Button>
      {statusMessage && <span className="text-xs text-emerald-700">{statusMessage}</span>}
      {errorMessage && <span className="text-xs text-red-600">{errorMessage}</span>}
    </div>
  );
}
