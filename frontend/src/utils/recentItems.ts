import type { ItemType } from 'src/api/admin';

// ---------------------------------------------------------------------------
// "Recently opened" on the dashboard (nice-to-have A3b): the last items the
// signed-in user opened in the editor, kept in this browser only. The backend
// has no "last edited by me" query, so nothing is sent anywhere.
// ---------------------------------------------------------------------------

export interface RecentItem {
  id: string;
  title: string;
  itemType: ItemType | null;
  /** ISO timestamp. */
  openedAt: string;
}

const MAX = 10;

function storageKey(userId: string | undefined): string {
  return `nbcg-admin-recent:${userId ?? 'anonymous'}`;
}

export function recentItems(userId: string | undefined): RecentItem[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey(userId)) ?? '[]');
    return Array.isArray(parsed) ? (parsed as RecentItem[]) : [];
  } catch {
    return [];
  }
}

export function rememberItem(userId: string | undefined, item: Omit<RecentItem, 'openedAt'>): void {
  try {
    const next = [
      { ...item, openedAt: new Date().toISOString() },
      ...recentItems(userId).filter((r) => r.id !== item.id),
    ].slice(0, MAX);
    localStorage.setItem(storageKey(userId), JSON.stringify(next));
  } catch {
    // ignore storage errors (private mode etc.)
  }
}

export function forgetItem(userId: string | undefined, id: string): void {
  try {
    localStorage.setItem(
      storageKey(userId),
      JSON.stringify(recentItems(userId).filter((r) => r.id !== id)),
    );
  } catch {
    // ignore storage errors
  }
}
