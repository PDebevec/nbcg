import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ImportJobData, ImportJobProgress } from './import-job.types';
import { fetchCobissRecord } from 'src/shared/cobiss/cobiss-fetch';
import { PrismaService } from 'src/prisma/prisma.service';

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
    const title = record.title ?? `[No title] COBISS:${id}`;

    await this.prisma.record.upsert({
      where: {
        externalId: id,
      },
      update: {
        title,
        sourceMetadata: record as any,
        updatedAt: new Date(),
      },
      create: {
        externalId: id,
        title,
        sourceMetadata: record as any,

        // Required fields from your schema that we don't have yet —
        // you'll want to flesh these out later as your import matures
        visibilityStatus: 'PRIVATE',
        workflowStatus: 'DRAFT',
        recordTypeId: await this.getDefaultRecordTypeId(),
        createdByUserId: 'system',
      },
    });
  }

  // Looks up (or creates) a fallback "unknown" record type
  // Replace this once you have a proper record type seeding strategy
  private async getDefaultRecordTypeId(): Promise<string> {
    const existing = await this.prisma.recordType.findUnique({
      where: { code: 'unknown' },
    });

    if (existing) return existing.id;

    const created = await this.prisma.recordType.create({
      data: { code: 'unknown', label: 'Unknown' },
    });

    return created.id;
  }
}