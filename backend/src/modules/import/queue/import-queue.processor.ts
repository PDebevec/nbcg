import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ImportJobData, ImportJobProgress } from './import-job.types';
import { fetchCobissRecord } from '../cobiss/cobiss-util/cobiss-fetch';
import { SYSTEM_ACTOR } from '../../../core/auth/actor.type';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { RevisionsService } from '../../../core/revisions/revisions.service';
import { MetadataValidatorService } from '../../schema/metadata-validator.service';
import { generateDeterministicId } from '../../../shared/util/generateUuidFromCobissId';
import type { CobissMetadata } from '../../../core/types/metadata.types';
import { ChangeAction, ItemType, VisibilityStatus } from '../../../../generated/prisma/enums';

const BATCH_SIZE = 5;

@Processor('import-queue', { concurrency: 3 })
export class ImportQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(ImportQueueProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly revisions: RevisionsService,
    private readonly validator: MetadataValidatorService,
  ) {
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
      warnings: [],
    };

    await job.updateProgress(progress);

    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const batch = ids.slice(i, i + BATCH_SIZE);

      await Promise.all(
        batch.map(async (id) => {
          try {
            const warning = await this.processRecord(source, id, target, visibilityStatus);
            progress.succeeded++;
            if (warning) progress.warnings!.push({ id, reason: warning });
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
  ): Promise<string | null> {
    switch (source) {
      case 'cobiss': return this.processCobissRecord(id, target, visibilityStatus);
      default: throw new Error(`Unknown import source: ${source}`);
    }
  }

  private async processCobissRecord(
    id: string,
    target: ItemType,
    visibilityStatus: VisibilityStatus,
  ): Promise<string | null> {
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

    const data = {
      id: recordId,
      visibilityStatus,
      metadata,
      createdByUserId: SYSTEM_ACTOR.userId,
      createdByName: SYSTEM_ACTOR.userName,
      updatedByUserId: SYSTEM_ACTOR.userId,
      updatedByName: SYSTEM_ACTOR.userName,
    };

    // Imported items open their timeline the same way hand-created ones do,
    // attributed to "system" — otherwise everything catalogued via COBISS looks
    // like it appeared from nowhere.
    await this.prisma.$transaction(async (tx) => {
      if (target === ItemType.RECORD) {
        const existing = await tx.record.findUnique({ where: { id: recordId }, select: { id: true } });
        if (existing) throw new Error(`Record ${recordId} (COBISS:${id}) already exists. Skipping.`);
        await tx.record.create({ data });
      } else {
        const existing = await tx.draft.findUnique({ where: { id: recordId }, select: { id: true } });
        if (existing) throw new Error(`Draft ${recordId} (COBISS:${id}) already exists. Skipping.`);
        await tx.draft.create({ data });
      }

      await this.revisions.record(
        { itemId: recordId, version: 0, action: ChangeAction.CREATE, actor: SYSTEM_ACTOR },
        tx,
      );
    });

    return this.saveWarning(recordId, metadata, target);
  }

  /**
   * Imports bypass the save check on purpose (COBISS is the catalogue of
   * record); this says what a hand-made item in the same state would have
   * needed, or null. A new import has no parents yet.
   */
  private saveWarning(recordId: string, metadata: CobissMetadata, target: ItemType): string | null {
    const result = this.validator.check({ id: recordId, metadata, itemState: 'NEW', targetState: target }, []);
    if (result.ok) return null;
    const problems = [
      ...result.missing.map((m) => `missing ${m.path}`),
      ...result.violations.map((v) => `${v.path} breaks ${v.constraint}`),
    ];
    const state = target === ItemType.RECORD ? 'a record' : 'a draft';
    return `Imported as ${state}, but would not pass validation: ${problems.join(', ')}`;
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
