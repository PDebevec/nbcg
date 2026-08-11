import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { MetricKind } from '../../../generated/prisma/enums';
import { isBotUserAgent } from '../../shared/util/bot-detection';
import { PrismaService } from '../prisma/prisma.service';

/**
 * How long hits sit in memory before being written. A crash loses at most this
 * much counting, which is an acceptable trade for not issuing a write per view.
 */
const FLUSH_INTERVAL_MS = Number(process.env.METRICS_FLUSH_INTERVAL_MS ?? 2000);

/** Safety valve: flush early rather than grow the buffer without bound. */
const MAX_BUFFERED_KEYS = 5000;

/**
 * Usage counters for items and files.
 *
 * Three rules shape this, all from the task's design notes:
 *
 * 1. **Never block or fail the read.** Every public method is synchronous and
 *    only touches an in-memory map; the database write happens on a timer. A
 *    counter problem can therefore never turn a successful page view into a 500.
 * 2. **Anonymous hits count.** Nothing here reads the principal — most public
 *    traffic has none.
 * 3. **No raw IPs, ever.** This is a public library site. Counting is per
 *    item/day only; there is no visitor identity stored anywhere.
 */
@Injectable()
export class MetricsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MetricsService.name);

  /** key: `itemId\0metric\0day` -> hits */
  private itemBuffer = new Map<string, number>();
  /** key: `fileId\0itemId\0metric\0day` -> hits */
  private fileBuffer = new Map<string, number>();

  private timer?: NodeJS.Timeout;
  private flushing = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
    // Don't hold the event loop open just for the counter timer.
    this.timer.unref?.();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.flush();
  }

  /** An item detail page was opened. Search-result appearances are not views. */
  recordItemView(itemId: string, userAgent?: string): void {
    if (isBotUserAgent(userAgent)) return;
    this.bumpItem(itemId, MetricKind.VIEW);
  }

  /**
   * A file was downloaded. Counts on the file *and* on its parent item, so a
   * record with 30 scans downloaded in full reads as 30 item downloads and one
   * per scan — "which record is popular" and "which scan is popular" are
   * different questions and both get an answer.
   */
  recordDownload(itemId: string, fileId: string, userAgent?: string): void {
    if (isBotUserAgent(userAgent)) return;
    this.bumpItem(itemId, MetricKind.DOWNLOAD);
    this.bump(this.fileBuffer, `${fileId}\0${itemId}\0${MetricKind.DOWNLOAD}\0${today()}`);
  }

  /** Write everything buffered so far. Safe to call concurrently. */
  async flush(): Promise<void> {
    if (this.flushing) return;
    if (this.itemBuffer.size === 0 && this.fileBuffer.size === 0) return;

    this.flushing = true;
    // Swap the buffers out first: hits arriving during the write land in the
    // new maps and are picked up by the next flush instead of being lost.
    const items = this.itemBuffer;
    const files = this.fileBuffer;
    this.itemBuffer = new Map();
    this.fileBuffer = new Map();

    try {
      if (items.size > 0) await this.writeItemCounts(items);
      if (files.size > 0) await this.writeFileCounts(files);
    } catch (err) {
      // Counts for this window are dropped rather than retried — a retry queue
      // for view counters is not worth the failure modes it introduces.
      this.logger.error(
        `Failed to flush usage counters (${items.size} item + ${files.size} file rows dropped)`,
        err instanceof Error ? err.stack : String(err),
      );
    } finally {
      this.flushing = false;
    }
  }

  private bumpItem(itemId: string, metric: MetricKind): void {
    this.bump(this.itemBuffer, `${itemId}\0${metric}\0${today()}`);
  }

  private bump(buffer: Map<string, number>, key: string): void {
    buffer.set(key, (buffer.get(key) ?? 0) + 1);
    if (buffer.size >= MAX_BUFFERED_KEYS) void this.flush();
  }

  private async writeItemCounts(buffer: Map<string, number>): Promise<void> {
    const params: unknown[] = [];
    const tuples: string[] = [];
    for (const [key, count] of buffer) {
      const [itemId, metric, day] = key.split('\0');
      const i = params.length;
      tuples.push(`($${i + 1}, $${i + 2}::"MetricKind", $${i + 3}::date, $${i + 4}::int)`);
      params.push(itemId, metric, day, count);
    }

    await this.prisma.$executeRawUnsafe(
      `INSERT INTO item_metrics_daily ("itemId", metric, day, count)
       VALUES ${tuples.join(', ')}
       ON CONFLICT ("itemId", metric, day)
       DO UPDATE SET count = item_metrics_daily.count + EXCLUDED.count`,
      ...params,
    );
  }

  private async writeFileCounts(buffer: Map<string, number>): Promise<void> {
    const params: unknown[] = [];
    const tuples: string[] = [];
    for (const [key, count] of buffer) {
      const [fileId, itemId, metric, day] = key.split('\0');
      const i = params.length;
      tuples.push(
        `($${i + 1}, $${i + 2}, $${i + 3}::"MetricKind", $${i + 4}::date, $${i + 5}::int)`,
      );
      params.push(fileId, itemId, metric, day, count);
    }

    await this.prisma.$executeRawUnsafe(
      `INSERT INTO file_metrics_daily ("fileId", "itemId", metric, day, count)
       VALUES ${tuples.join(', ')}
       ON CONFLICT ("fileId", metric, day)
       DO UPDATE SET count = file_metrics_daily.count + EXCLUDED.count`,
      ...params,
    );
  }
}

/**
 * The bucket a hit belongs to, in UTC.
 *
 * Taken when the hit is recorded rather than at flush time — otherwise a flush
 * that straddles midnight would file the previous day's views under today.
 */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}
