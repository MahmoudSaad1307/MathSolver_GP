import type { StudentAccountMeResponse } from '@mathlens/shared';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api';

export function useStudentAuth(enabled = true) {
  return useQuery({
    queryKey: ['student', 'account'],
    queryFn: () =>
      apiRequest<StudentAccountMeResponse>('/auth/student/me', {
        retryStudentRefresh: true,
      }),
    retry: false,
    enabled,
  });
}
