import { extractYoutubeVideoId } from '@mathlens/shared';

export function formatSecondsToMmSs(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function parseMmSsToSeconds(raw: string): number | null {
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) {
    const val = Number(trimmed);
    return Number.isFinite(val) && val >= 0 ? val : null;
  }
  const match = /^(\d{1,3}):([0-5]\d)$/.exec(trimmed);
  if (!match) {
    return null;
  }
  const mins = Number(match[1]);
  const secs = Number(match[2]);
  return mins * 60 + secs;
}

export function buildYoutubePreviewUrl(videoUrl: string, seconds: number): string | null {
  const videoId = extractYoutubeVideoId(videoUrl);
  if (!videoId) {
    return null;
  }
  const safeSec = Math.max(0, Math.floor(seconds));
  return `https://www.youtube.com/watch?v=${videoId}&t=${safeSec}s`;
}
