import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';

export const USER_SYNC_QUEUE = 'user-sync';

/** The recurring reconcile. A fixed key makes the schedule idempotent. */
const REPEATABLE_JOB_ID = 'user-sync-daily';
const DAILY_MS = 24 * 60 * 60 * 1000;

/**
 * Schedules the directory reconcile.
 *
 * BullMQ rather than `@nestjs/schedule`, for two reasons. `@nestjs/schedule` is
 * not installed while BullMQ, Redis and ioredis already are — and it runs its
 * cron in every process, so two replicas would mean two concurrent full syncs
 * against Keycloak. A repeatable job with a fixed `jobId` is deduplicated
 * through Redis and fires once across the whole deployment.
 */
@Injectable()
export class UserSyncQueueService implements OnModuleInit {
  private readonly logger = new Logger(UserSyncQueueService.name);

  constructor(@InjectQueue(USER_SYNC_QUEUE) private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    // Registering the same repeatable key twice replaces it rather than
    // duplicating, so this is safe on every boot.
    await this.queue.add(
      'reconcile',
      {},
      {
        repeat: { every: DAILY_MS },
        jobId: REPEATABLE_JOB_ID,
        removeOnComplete: { count: 30 },
        removeOnFail: { count: 30 },
      },
    );

    // The startup run is the same job, not a side channel — a fresh deploy
    // populates immediately instead of waiting up to a day. Best-effort: Redis
    // being down must not stop the API from booting.
    try {
      await this.enqueue();
    } catch (err) {
      this.logger.error(
        `Could not enqueue the startup user sync: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Enqueue an immediate reconcile. Used by the startup run and POST /users/sync. */
  async enqueue(): Promise<{ jobId: string }> {
    const job = await this.queue.add(
      'reconcile',
      {},
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 10_000 },
        removeOnComplete: { age: 60 * 60 * 24 },
        removeOnFail: { age: 60 * 60 * 24 * 7 },
      },
    );
    return { jobId: String(job.id) };
  }
}
