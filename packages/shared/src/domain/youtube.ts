const YOUTUBE_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;

/**
 * Extracts a canonical 11-character YouTube video ID from standard watch,
 * short, embed, or shorts URLs. Returns null for placeholders or invalid URLs.
 */
export function extractYoutubeVideoId(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.includes('REPLACE_ME')) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return null;
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  let candidate: string | null = null;

  if (host === 'youtu.be') {
    candidate = parsed.pathname.split('/').filter(Boolean)[0] ?? null;
  } else if (
    host === 'youtube.com' ||
    host === 'm.youtube.com' ||
    host === 'youtube-nocookie.com'
  ) {
    if (parsed.pathname === '/watch') {
      candidate = parsed.searchParams.get('v');
    } else {
      const segments = parsed.pathname.split('/').filter(Boolean);
      if (
        segments.length >= 2 &&
        (segments[0] === 'embed' || segments[0] === 'shorts' || segments[0] === 'live')
      ) {
        candidate = segments[1] ?? null;
      }
    }
  }

  if (!candidate || !YOUTUBE_ID_REGEX.test(candidate)) {
    return null;
  }

  return candidate;
}

export function isPlaceholderVideoUrl(rawUrl: string): boolean {
  return !extractYoutubeVideoId(rawUrl);
}

/**
 * Validates that a URL is a non-empty http:// or https:// URL within length bounds.
 * Rejects javascript:, data:, file:, or malformed URLs.
 */
export function isValidHttpUrl(rawUrl: string): boolean {
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.length > 1000) {
    return false;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }

  return parsed.protocol === 'https:' || parsed.protocol === 'http:';
}

/**
 * Normalizes an optional solution URL string by trimming whitespace and
 * converting empty strings to null.
 */
export function normalizeSolutionUrl(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) {
    return null;
  }
  const trimmed = rawUrl.trim();
  return trimmed.length > 0 ? trimmed : null;
}
