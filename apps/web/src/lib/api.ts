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
  options: RequestInit & { retryRefresh?: boolean; retryStudentRefresh?: boolean } = {},
): Promise<T> {
  const { retryRefresh = false, retryStudentRefresh = false, headers, ...rest } = options;
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
  } else if (res.status === 401 && retryStudentRefresh) {
    const refreshRes = await rawFetch('/auth/student/refresh', { method: 'POST' });
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

/** Downloads a binary file (CSV/XLSX) from the API using session cookies and token refresh retry. */
export async function apiDownload(path: string, fallbackFilename: string): Promise<void> {
  let res = await rawFetch(path, { method: 'GET' });
  if (res.status === 401) {
    const refreshRes = await rawFetch('/auth/teacher/refresh', { method: 'POST' });
    if (refreshRes.ok) {
      res = await rawFetch(path, { method: 'GET' });
    }
  }
  if (!res.ok) {
    throw new Error(`Export failed with HTTP ${res.status}`);
  }
  const blob = await res.blob();
  const disp = res.headers.get('Content-Disposition') ?? '';
  const match = disp.match(/filename="?([^"]+)"?/i);
  const filename = match?.[1] ?? fallbackFilename;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function getApiErrorMessage(err: unknown, locale: 'ar' | 'en', fallback: string): string {
  if (err instanceof ApiClientError) {
    return locale === 'ar' ? err.messageAr : err.messageEn;
  }
  return fallback;
}
