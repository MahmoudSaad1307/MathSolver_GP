import type { ApiErrorResponse } from '@mathlens/shared';

const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api/v1';

export class ApiClientError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly messageAr: string;
  public readonly messageEn: string;
  public readonly details?: unknown;

  constructor(status: number, body: ApiErrorResponse['error']) {
    super(body.message_en);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = body.code;
    this.messageAr = body.message_ar;
    this.messageEn = body.message_en;
    this.details = body.details;
  }
}

async function rawFetch(path: string, init: RequestInit): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    ...init,
    credentials: 'include',
  });
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit & { retryRefresh?: boolean } = {},
): Promise<T> {
  const { retryRefresh = false, headers, ...rest } = options;
  const finalHeaders = new Headers(headers);
  if (
    !(rest.body instanceof FormData) &&
    rest.body !== undefined &&
    !finalHeaders.has('Content-Type')
  ) {
    finalHeaders.set('Content-Type', 'application/json');
  }

  let res = await rawFetch(path, { ...rest, headers: finalHeaders });

  if (res.status === 401 && retryRefresh) {
    const refreshRes = await rawFetch('/auth/teacher/refresh', { method: 'POST' });
    if (refreshRes.ok) {
      res = await rawFetch(path, { ...rest, headers: finalHeaders });
    }
  }

  if (!res.ok) {
    let parsed: ApiErrorResponse | null = null;
    try {
      parsed = (await res.json()) as ApiErrorResponse;
    } catch {
      parsed = null;
    }
    if (parsed?.error) {
      throw new ApiClientError(res.status, parsed.error);
    }
    throw new ApiClientError(res.status, {
      code: 'INTERNAL_ERROR',
      message_ar: 'حدث خطأ غير متوقع.',
      message_en: `Request failed with status ${res.status}`,
    });
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return (await res.json()) as T;
}

export function getApiErrorMessage(err: unknown, locale: 'ar' | 'en', fallback: string): string {
  if (err instanceof ApiClientError) {
    return locale === 'ar' ? err.messageAr : err.messageEn;
  }
  return fallback;
}
