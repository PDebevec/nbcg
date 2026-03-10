import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ImportJobData, ImportJobProgress } from './import-job.types';
import { fetchCobissRecord } from 'src/shared/cobiss/cobiss-fetch';
import { PrismaService } from 'src/prisma/prisma.service';
import { randomUUID } from 'node:crypto';
import { generateDeterministicId } from 'src/shared/util/generateUuidFromCobissId';

const BATCH_SIZE = 5;

@Processor('import-queue', { concurrency: 3 })
export class ImportQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(ImportQueueProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job<ImportJobData>): Promise<void> {
    const { source, ids } = job.data;

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
            await this.processRecord(source, id);
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

  private async processRecord(source: string, id: string): Promise<void> {
    switch (source) {
      case 'cobiss': return this.processCobissRecord(id);
      default: throw new Error(`Unknown import source: ${source}`);
    }
  }

  private async processCobissRecord(id: string): Promise<void> {
    const record = await fetchCobissRecord(id);
    if (!record) throw new Error(`No data returned from COBISS for id ${id}`);

    // record.title can be undefined if COBISS has no 200/a field — fall back to the id
    record.title = record.title ?? `[No title] COBISS:${id}`;

    const recordId = generateDeterministicId(id);

    // Prepare metadata with data object
    // collectionType comes from COBISS record, default to 0 if not present
    const collectionType = 0;
    
    const metadata= JSON.parse(JSON.stringify({
      ...record, // all the COBISS data
      collectionType: collectionType,
      childrenNumber: 0, // Will be updated by triggers when relations are created
      jeGlavnoGradivo: true, // Will be updated by triggers when relations are created
    }));

    await this.prisma.record.upsert({
      where: {
        id: recordId, // or use a unique field from COBISS like: cobissId: id
      },
      update: {
        visibilityStatus: 'PUBLIC', // or determine from record
        metadata: metadata,
        updatedAt: new Date(),
        updatedByUserId: 'system', // or get from context
      },
      create: {
        id: recordId,
        visibilityStatus: 'PUBLIC', // or determine from record
        metadata: metadata,
        createdByUserId: 'system', // or get from context
        updatedByUserId: 'system',
      },
    });

    // If you need to create relations after inserting the record:
    // await this.createRecordRelations(recordId, record.parentIds, record.childIds);
  }

}