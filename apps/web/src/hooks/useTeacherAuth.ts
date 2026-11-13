import type { TeacherProfile } from '@mathlens/shared';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api';

export function useTeacherAuth() {
  return useQuery({
    queryKey: ['teacher', 'me'],
    queryFn: () =>
      apiRequest<{ teacher: TeacherProfile }>('/auth/teacher/me', {
        retryRefresh: true,
      }),
    retry: false,
  });
}
