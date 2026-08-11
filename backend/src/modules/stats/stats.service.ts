import { BadRequestException, Injectable } from '@nestjs/common';
import { ChangeAction, MetricKind } from '../../../generated/prisma/enums';
import { PrismaService } from '../../core/prisma/prisma.service';
import { ItemsService } from '../items/items.service';

/** Widest window a single query may span. Keeps a stray `from=1970-01-01` off the metrics table. */
const MAX_RANGE_DAYS = 366;
const DEFAULT_RANGE_DAYS = 30;

export interface DayCount {
  day: string;
  count: number;
}

interface RawDayAction {
  day: string;
  action: string;
  count: number;
}

interface RawDayMetric {
  day: string;
  metric: string;
  count: number;
}

/**
 * Inclusive UTC day window, `YYYY-MM-DD`. Echoed back on every response so a
 * caller that relied on the defaults knows what it actually got.
 */
export interface StatsRange {
  from: string;
  to: string;
}

/** One row of `/api/stats/users`. */
export interface UserTotals {
  userId: string;
  created: number;
  published: number;
  /** Everything that isn't a create, publish or delete — metadata edits, visibility flips, file and relation writes. */
  edited: number;
  deleted: number;
  total: number;
}

@Injectable()
export class StatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly items: ItemsService,
  ) {}

  /**
   * Snapshot totals plus created/published/edited over time and usage over time.
   *
   * Totals come from `ItemsService.stats()` rather than being recomputed here —
   * one definition of "how many records are there", extended with a time
   * dimension rather than duplicated.
   */
  async overview(fromRaw?: string, toRaw?: string) {
    const range = resolveRange(fromRaw, toRaw);

    const [totals, activity, usage] = await Promise.all([
      this.items.stats(),
      this.prisma.$queryRaw<RawDayAction[]>`
        SELECT to_char("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
               action::text AS action,
               COUNT(*)::int AS count
        FROM item_revisions
        WHERE "createdAt" >= ${range.from}::date
          AND "createdAt" < (${range.to}::date + INTERVAL '1 day')
        GROUP BY 1, 2
        ORDER BY 1
      `,
      this.prisma.$queryRaw<RawDayMetric[]>`
        SELECT to_char(day, 'YYYY-MM-DD') AS day,
               metric::text AS metric,
               SUM(count)::int AS count
        FROM item_metrics_daily
        WHERE day BETWEEN ${range.from}::date AND ${range.to}::date
        GROUP BY 1, 2
        ORDER BY 1
      `,
    ]);

    const series = (action: ChangeAction): DayCount[] =>
      activity.filter((r) => r.action === action).map((r) => ({ day: r.day, count: r.count }));
    const metricSeries = (metric: MetricKind): DayCount[] =>
      usage.filter((r) => r.metric === metric).map((r) => ({ day: r.day, count: r.count }));

    const created = series(ChangeAction.CREATE);
    const published = series(ChangeAction.PUBLISH);
    const updated = series(ChangeAction.UPDATE);
    const deleted = series(ChangeAction.DELETE);
    const views = metricSeries(MetricKind.VIEW);
    const downloads = metricSeries(MetricKind.DOWNLOAD);

    return {
      range,
      totals,
      activity: {
        totals: {
          created: sum(created),
          published: sum(published),
          updated: sum(updated),
          deleted: sum(deleted),
        },
        created,
        published,
        updated,
        deleted,
      },
      usage: {
        totals: { views: sum(views), downloads: sum(downloads) },
        views,
        downloads,
      },
    };
  }

  /**
   * Per-cataloguer productivity for the period.
   *
   * `userId` is the raw Keycloak sub. Resolving it to a display name needs the
   * `user_profiles` cache from the Task Delegation work, which does not exist
   * yet — until it does, the frontend has to map these itself.
   */
  async users(fromRaw?: string, toRaw?: string, limit = 50) {
    const range = resolveRange(fromRaw, toRaw);

    const rows = await this.prisma.$queryRaw<
      Array<{ userId: string; action: string; count: number }>
    >`
      SELECT "userId", action::text AS action, COUNT(*)::int AS count
      FROM item_revisions
      WHERE "createdAt" >= ${range.from}::date
        AND "createdAt" < (${range.to}::date + INTERVAL '1 day')
      GROUP BY 1, 2
    `;

    const byUser = new Map<string, UserTotals>();

    for (const row of rows) {
      let entry = byUser.get(row.userId);
      if (!entry) {
        entry = { userId: row.userId, created: 0, published: 0, edited: 0, deleted: 0, total: 0 };
        byUser.set(row.userId, entry);
      }
      switch (row.action) {
        case ChangeAction.CREATE:
          entry.created += row.count;
          break;
        case ChangeAction.PUBLISH:
          entry.published += row.count;
          break;
        case ChangeAction.DELETE:
          entry.deleted += row.count;
          break;
        default:
          // Everything else — metadata edits, visibility flips, file and
          // relation writes — is "touched the item" for productivity purposes.
          entry.edited += row.count;
      }
      entry.total += row.count;
    }

    const users = [...byUser.values()].sort((a, b) => b.total - a.total).slice(0, limit);
    return { range, limit, users };
  }

  /** Most viewed / most downloaded items, plus the individual files behind the downloads. */
  async topItems(fromRaw?: string, toRaw?: string, metric?: MetricKind, limit = 10) {
    const range = resolveRange(fromRaw, toRaw);
    const wantViews = !metric || metric === MetricKind.VIEW;
    const wantDownloads = !metric || metric === MetricKind.DOWNLOAD;

    const [mostViewed, mostDownloaded, topFiles] = await Promise.all([
      wantViews ? this.topByMetric(range, MetricKind.VIEW, limit) : Promise.resolve([]),
      wantDownloads ? this.topByMetric(range, MetricKind.DOWNLOAD, limit) : Promise.resolve([]),
      wantDownloads ? this.topFiles(range, limit) : Promise.resolve([]),
    ]);

    return { range, limit, mostViewed, mostDownloaded, topFiles };
  }

  private async topByMetric(range: StatsRange, metric: MetricKind, limit: number) {
    const rows = await this.prisma.$queryRaw<Array<{ itemId: string; count: number }>>`
      SELECT "itemId", SUM(count)::int AS count
      FROM item_metrics_daily
      WHERE metric = ${metric}::"MetricKind"
        AND day BETWEEN ${range.from}::date AND ${range.to}::date
      GROUP BY 1
      ORDER BY 2 DESC
      LIMIT ${limit}
    `;

    return this.withTitles(rows);
  }

  private async topFiles(range: StatsRange, limit: number) {
    const rows = await this.prisma.$queryRaw<
      Array<{ fileId: string; itemId: string; count: number }>
    >`
      SELECT "fileId", "itemId", SUM(count)::int AS count
      FROM file_metrics_daily
      WHERE metric = ${MetricKind.DOWNLOAD}::"MetricKind"
        AND day BETWEEN ${range.from}::date AND ${range.to}::date
      GROUP BY 1, 2
      ORDER BY 3 DESC
      LIMIT ${limit}
    `;
    if (rows.length === 0) return [];

    const files = await this.prisma.fileAttachment.findMany({
      where: { id: { in: rows.map((r) => r.fileId) } },
      select: { id: true, filename: true },
    });
    const names = new Map(files.map((f) => [f.id, f.filename]));

    // A file whose row is gone was deleted after being downloaded — the count
    // is still true, so it is reported rather than dropped.
    return rows.map((r) => ({
      fileId: r.fileId,
      itemId: r.itemId,
      filename: names.get(r.fileId) ?? null,
      count: r.count,
    }));
  }

  /**
   * Attach titles to a ranked list. Bounded by `limit`, so this is a small
   * lookup and not a join over the whole metrics table.
   */
  private async withTitles(rows: Array<{ itemId: string; count: number }>) {
    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.itemId);
    const select = { id: true, metadata: true } as const;
    const [drafts, records] = await Promise.all([
      this.prisma.draft.findMany({ where: { id: { in: ids } }, select }),
      this.prisma.record.findMany({ where: { id: { in: ids } }, select }),
    ]);

    const titles = new Map<string, { title: string | null; itemType: 'DRAFT' | 'RECORD' }>();
    for (const d of drafts) titles.set(d.id, { title: titleOf(d.metadata), itemType: 'DRAFT' });
    for (const r of records) titles.set(r.id, { title: titleOf(r.metadata), itemType: 'RECORD' });

    // A deleted item keeps its counts — reported with a null title rather than
    // silently dropped, so the numbers still add up.
    return rows.map((r) => ({
      itemId: r.itemId,
      title: titles.get(r.itemId)?.title ?? null,
      itemType: titles.get(r.itemId)?.itemType ?? null,
      count: r.count,
    }));
  }
}

function titleOf(metadata: unknown): string | null {
  const title = (metadata as Record<string, unknown> | null)?.title;
  return typeof title === 'string' ? title : null;
}

function sum(series: DayCount[]): number {
  return series.reduce((acc, d) => acc + d.count, 0);
}

/**
 * Default to the last 30 days and reject anything wider than a year.
 *
 * Without the cap a single request can scan the whole metrics table, and these
 * endpoints are reachable by any admin refreshing a dashboard.
 */
function resolveRange(fromRaw?: string, toRaw?: string): StatsRange {
  const to = toRaw ?? utcDay(new Date());
  const from = fromRaw ?? utcDay(addDays(new Date(`${to}T00:00:00Z`), -(DEFAULT_RANGE_DAYS - 1)));

  const fromMs = Date.parse(`${from}T00:00:00Z`);
  const toMs = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
    throw new BadRequestException('from and to must be valid YYYY-MM-DD dates');
  }
  if (fromMs > toMs) {
    throw new BadRequestException(`from (${from}) must not be after to (${to})`);
  }

  const days = Math.floor((toMs - fromMs) / 86_400_000) + 1;
  if (days > MAX_RANGE_DAYS) {
    throw new BadRequestException(
      `Range too wide: ${days} days requested, maximum is ${MAX_RANGE_DAYS}`,
    );
  }

  return { from, to };
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}
