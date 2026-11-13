const STORAGE_KEY = 'mathlens_pending_autosaves_v1';

export interface PendingMcqAutosave {
  attemptId: string;
  questionId: string;
  selectedOptionId: string | null;
  queuedAt: number;
}

function readQueue(): PendingMcqAutosave[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as PendingMcqAutosave[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(items: PendingMcqAutosave[]): void {
  try {
    if (items.length === 0) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    }
  } catch {
    // Ignore storage quota errors cleanly.
  }
}

export function enqueueMcqAutosave(item: PendingMcqAutosave): PendingMcqAutosave[] {
  const existing = readQueue().filter(
    (entry) => !(entry.attemptId === item.attemptId && entry.questionId === item.questionId),
  );
  const next = [...existing, item];
  writeQueue(next);
  return next;
}

export function removeQueuedMcqAutosave(attemptId: string, questionId: string): number {
  const next = readQueue().filter(
    (entry) => !(entry.attemptId === attemptId && entry.questionId === questionId),
  );
  writeQueue(next);
  return next.length;
}

export function getQueuedAutosaveCount(attemptId?: string): number {
  const items = readQueue();
  if (!attemptId) return items.length;
  return items.filter((entry) => entry.attemptId === attemptId).length;
}

export async function flushQueuedMcqAutosaves(
  attemptId: string,
  sender: (entry: PendingMcqAutosave) => Promise<void>,
): Promise<number> {
  const all = readQueue();
  const mine = all.filter((entry) => entry.attemptId === attemptId);
  const remaining = all.filter((entry) => entry.attemptId !== attemptId);

  for (const entry of mine) {
    try {
      await sender(entry);
    } catch {
      remaining.push(entry);
    }
  }

  writeQueue(remaining);
  return remaining.filter((entry) => entry.attemptId === attemptId).length;
}
