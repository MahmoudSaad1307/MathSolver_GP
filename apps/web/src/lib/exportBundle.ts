import { apiRequest } from '@/lib/api';

export async function downloadTopicJson(topicId: string): Promise<void> {
  const bundle = await apiRequest<unknown>(`/topics/${topicId}/export`, {
    retryRefresh: true,
  });
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `mathlens-topic-${topicId}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
