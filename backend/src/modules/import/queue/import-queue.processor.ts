import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ImportJobData, ImportJobProgress } from './import-job.types';
import { fetchCobissRecord } from 'src/modules/import/cobiss/cobiss-util/cobiss-fetch';
import { PrismaService } from 'src/core/prisma/prisma.service';
import { generateDeterministicId } from 'src/shared/util/generateUuidFromCobissId';
import type { CobissMetadata } from 'src/core/types/metadata.types';
import { ItemType, VisibilityStatus } from '../../../../generated/prisma/enums';

const BATCH_SIZE = 5;

@Processor('import-queue', { concurrency: 3 })
export class ImportQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(ImportQueueProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job<ImportJobData>): Promise<void> {
    const { source, ids, target, visibilityStatus } = job.data;

    const progress: ImportJobProgress = {
      total: ids.length,
      processed: 0,
      succeeded: 0,
      failed: 0,
      errors: [],
    };

    await job.updateProgress(progress);

    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const batch = ids.slice(i, i + BATCH_SIZE);

      await Promise.all(
        batch.map(async (id) => {
          try {
            await this.processRecord(source, id, target, visibilityStatus);
            progress.succeeded++;
          } catch (err: any) {
            progress.failed++;
            progress.errors.push({ id, reason: err?.message ?? 'Unknown error' });
            this.logger.warn(`[${source}] Failed ${id}: ${err?.message}`);
          } finally {
            progress.processed++;
            await job.updateProgress(progress);
          }
        }),
      );
    }
  }

  private async processRecord(
    source: string,
    id: string,
    target: ItemType,
    visibilityStatus: VisibilityStatus,
  ): Promise<void> {
    switch (source) {
      case 'cobiss': return this.processCobissRecord(id, target, visibilityStatus);
      default: throw new Error(`Unknown import source: ${source}`);
    }
  }

  private async processCobissRecord(
    id: string,
    target: ItemType,
    visibilityStatus: VisibilityStatus,
  ): Promise<void> {
    const record = await fetchCobissRecord(id);
    if (!record) throw new Error(`No data returned from COBISS for id ${id}`);

    record.title = record.title ?? `[No title] COBISS:${id}`;

    const recordId = generateDeterministicId(id);

    await this.checkNoConflict(recordId, target);

    const metadata: CobissMetadata = {
      ...record,
      _source: 'cobiss',
      title: record.title,
      collectionType: 0,
      childrenInDrafts: 0,
      childrenInRecords: 0,
      jeGlavnoGradivo: true,
    };

    if (target === ItemType.RECORD) {
      await this.prisma.record.upsert({
        where: { id: recordId },
        update: { visibilityStatus, metadata, updatedAt: new Date(), updatedByUserId: 'system' },
        create: { id: recordId, visibilityStatus, metadata, createdByUserId: 'system', updatedByUserId: 'system' },
      });
    } else {
      await this.prisma.draft.upsert({
        where: { id: recordId },
        update: { visibilityStatus, metadata, updatedAt: new Date(), updatedByUserId: 'system' },
        create: { id: recordId, visibilityStatus, metadata, createdByUserId: 'system', updatedByUserId: 'system' },
      });
    }
  }

  /**
   * Ensures the given id does not already exist in the opposite table.
   * An id must live in exactly one table — mixing tables would break ItemRelation resolution.
   */
  private async checkNoConflict(id: string, target: ItemType): Promise<void> {
    if (target === ItemType.RECORD) {
      const existsAsDraft = await this.prisma.draft.findUnique({ where: { id }, select: { id: true } });
      if (existsAsDraft) {
        throw new Error(
          `ID ${id} already exists as a draft. Resolve or publish the draft before importing as a record.`,
        );
      }
    } else {
      const existsAsRecord = await this.prisma.record.findUnique({ where: { id }, select: { id: true } });
      if (existsAsRecord) {
        throw new Error(
          `ID ${id} already exists as a published record. Cannot import over a record as a draft.`,
        );
      }
    }
  }
}
