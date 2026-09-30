import type { ComposerTranslation } from 'vue-i18n';

// ---------------------------------------------------------------------------
// Formatting helpers for the admin area: day-first dates in both UI languages,
// relative times ("2 h ago") with the full timestamp kept for a tooltip,
// grouped numbers and avatar initials.
// ---------------------------------------------------------------------------

/** BCP 47 tag for Intl, per app locale ('me' is not one). */
export function dateLocale(appLocale: string): string {
  return appLocale === 'me' ? 'sr-Latn-ME' : 'en-GB';
}

/** "22 Sep 2026, 10:41" */
export function formatDateTime(iso: string | null | undefined, appLocale: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(dateLocale(appLocale), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "22 Sep 2026" */
export function formatDate(iso: string | null | undefined, appLocale: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(dateLocale(appLocale), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * "just now", "10 min ago", "2 h ago", "Yesterday", "3 d ago", then a short
 * date ("12 Sep", with the year once it is not this one).
 */
export function formatRelative(
  iso: string | null | undefined,
  appLocale: string,
  t: ComposerTranslation,
  now: number = Date.now(),
): string {
  if (!iso) return '—';
  const date = new Date(iso);
  const time = date.getTime();
  if (Number.isNaN(time)) return '—';

  const diff = now - time;
  if (diff < MINUTE) return t('admin.time.justNow');
  if (diff < HOUR) return t('admin.time.minutes', { n: Math.floor(diff / MINUTE) });

  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  if (time >= startOfToday.getTime()) return t('admin.time.hours', { n: Math.floor(diff / HOUR) });
  if (time >= startOfToday.getTime() - DAY) return t('admin.time.yesterday');

  const days = Math.ceil((startOfToday.getTime() - time) / DAY);
  if (days <= 6) return t('admin.time.days', { n: days });

  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString(dateLocale(appLocale), {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/** 1284 → "1 284" (narrow no-break space, the same in both languages). */
export function formatCount(value: number): string {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** "Marko Đurović" → "MĐ"; a single word gives its first two letters. */
export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]!.charAt(0) + parts[parts.length - 1]!.charAt(0)).toUpperCase();
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
