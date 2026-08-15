import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { UserSyncService } from '../user-sync.service';
import { USER_SYNC_QUEUE } from './user-sync-queue.service';

/**
 * Concurrency 1: two overlapping full reconciles would race on the same rows
 * for no gain, and the whole job is six HTTP calls for the current realm.
 */
@Processor(USER_SYNC_QUEUE, { concurrency: 1 })
export class UserSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(UserSyncProcessor.name);

  constructor(private readonly sync: UserSyncService) {
    super();
  }

  async process(): Promise<void> {
    await this.sync.reconcile();
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error) {
    const attempts = job.opts.attempts ?? 1;
    if (job.attemptsMade >= attempts) {
      // A stale directory is cosmetic — nothing authorizes off this table — so a
      // failed sync is loud but not fatal. GET /users/sync/status carries the
      // error so a week of silent failures is visible.
      this.logger.error(
        `User directory sync permanently failed after ${job.attemptsMade} attempts: ${err.message}`,
      );
    } else {
      this.logger.warn(
        `User directory sync attempt ${job.attemptsMade}/${attempts} failed: ${err.message}`,
      );
    }
  }
}
