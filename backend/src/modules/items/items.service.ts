import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ItemType, VisibilityStatus } from '../../../generated/prisma/enums';
import { EDITABLE_BASE_METADATA_SHAPE } from '../../core/types/metadata.types';
import { DOMAIN_RECORD_SHAPE, FieldValidator } from '../import/cobiss/cobiss-util/cobiss.types';
import { PrismaService } from '../../core/prisma/prisma.service';
import { SeaweedfsService } from '../../core/seaweedfs/seaweedfs.service';
import { generateDeterministicId } from '../../shared/util/generateUuidFromCobissId';

// Derived at module load from the type shapes — automatically stays in sync
// with DomainRecord and BaseMetadata. Maps key → sanitizer function.
// Unknown keys are dropped; known keys with wrong types throw 400.
const METADATA_VALIDATORS = new Map<string, FieldValidator>([
  ...Object.entries(EDITABLE_BASE_METADATA_SHAPE),
  ...Object.entries(DOMAIN_RECORD_SHAPE),
]);

// Required metadata field validators.
// Add entries here to enforce more required fields without changing service logic.
const REQUIRED_METADATA_VALIDATORS: Array<{
  key: string;
  validate: (v: unknown) => boolean;
  message: string;
}> = [
  {
    key: 'title',
    validate: (v) => typeof v !== 'string' || v.trim().length > 0,
    message: 'title must not be empty',
  },
];

@Injectable()
export class ItemsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly seaweedfs: SeaweedfsService,
  ) {}

  async stats(): Promise<{
    records: Record<VisibilityStatus, number>;
    drafts: Record<VisibilityStatus, number>;
  }> {
    const [recordGroups, draftGroups] = await Promise.all([
      this.prisma.record.groupBy({ by: ['visibilityStatus'], _count: { _all: true } }),
      this.prisma.draft.groupBy({ by: ['visibilityStatus'], _count: { _all: true } }),
    ]);

    const empty = (): Record<VisibilityStatus, number> => ({
      [VisibilityStatus.PUBLIC]: 0,
      [VisibilityStatus.PRIVATE]: 0,
      [VisibilityStatus.HIDDEN]: 0,
    });

    const records = empty();
    for (const g of recordGroups) records[g.visibilityStatus] = g._count._all;
    const drafts = empty();
    for (const g of draftGroups) drafts[g.visibilityStatus] = g._count._all;

    return { records, drafts };
  }

  async create(
    visibilityStatus: VisibilityStatus,
    targetState: ItemType,
    rawMetadata: Record<string, unknown> | undefined,
    userId: string,
  ) {
    const sanitizedMetadata = this.sanitizeMetadata(rawMetadata ?? {});

    for (const { key, validate, message } of REQUIRED_METADATA_VALIDATORS) {
      if (!sanitizedMetadata[key] || !validate(sanitizedMetadata[key])) {
        throw new BadRequestException(message);
      }
    }

    const cobissId = sanitizedMetadata.cobissId as string | undefined;
    let id: string | undefined;
    let _source: string;

    if (cobissId) {
      id = generateDeterministicId(cobissId);
      const [existingDraft, existingRecord] = await Promise.all([
        this.prisma.draft.findUnique({ where: { id }, select: { id: true } }),
        this.prisma.record.findUnique({ where: { id }, select: { id: true } }),
      ]);
      if (existingDraft || existingRecord) {
        throw new ConflictException('Item with this COBISS ID already exists');
      }
      _source = 'cobiss';
    } else {
      _source = 'nbcg';
    }

    const finalMetadata = {
      collectionType: 0,
      ...sanitizedMetadata,
      _source,
      childrenInDrafts: 0,
      childrenInRecords: 0,
      jeGlavnoGradivo: true,
    };

    const data = {
      ...(id ? { id } : {}),
      visibilityStatus,
      metadata: finalMetadata,
      createdByUserId: userId,
      updatedByUserId: userId,
    };

    if (targetState === ItemType.RECORD) {
      return this.prisma.record.create({ data: data as any });
    }
    return this.prisma.draft.create({ data: data as any });
  }

  async update(
    id: string,
    visibilityStatus: VisibilityStatus | undefined,
    rawMetadata: Record<string, unknown> | undefined,
    userId: string,
    expectedVersion: number,
  ) {
    const metadataUpdate = rawMetadata ? this.sanitizeMetadata(rawMetadata) : undefined;

    // Validate required fields only when they are present in the incoming payload.
    if (metadataUpdate) {
      for (const { key, validate, message } of REQUIRED_METADATA_VALIDATORS) {
        if (key in metadataUpdate && !validate(metadataUpdate[key])) {
          throw new BadRequestException(message);
        }
      }
    }

    const hasMetadataChanges =
      metadataUpdate !== undefined && Object.keys(metadataUpdate).length > 0;

    const [draft, record] = await Promise.all([
      this.prisma.draft.findUnique({ where: { id } }),
      this.prisma.record.findUnique({ where: { id } }),
    ]);

    if (!draft && !record) {
      throw new NotFoundException(`Item not found: ${id}`);
    }

    const existing = draft ?? record!;

    if (existing.version !== expectedVersion) {
      throw new ConflictException(
        `Version conflict: expected ${expectedVersion}, current ${existing.version}. Re-fetch the item and retry.`,
      );
    }

    // Nothing to write. Checked only after the existence and version guards
    // above, so an empty payload is validated exactly as strictly as a real
    // one. Returns the unchanged version to keep the response shape uniform.
    if (!visibilityStatus && !hasMetadataChanges) {
      return { version: existing.version };
    }

    const existingMetadata =
      (existing.metadata as unknown as Record<string, unknown>) ?? {};

    const data: Record<string, unknown> = {
      updatedByUserId: userId,
      version: existing.version + 1,
    };
    if (visibilityStatus) data.visibilityStatus = visibilityStatus;
    if (hasMetadataChanges) {
      data.metadata = { ...existingMetadata, ...metadataUpdate };
    }

    // Use a WHERE clause that includes version to guard against races
    // between the read above and this write.
    if (draft) {
      const result = await this.prisma.draft.updateMany({
        where: { id, version: existing.version },
        data,
      });
      if (result.count === 0) {
        throw new ConflictException(
          'Version conflict: the item was modified by another request. Re-fetch and retry.',
        );
      }
    } else {
      const result = await this.prisma.record.updateMany({
        where: { id, version: existing.version },
        data,
      });
      if (result.count === 0) {
        throw new ConflictException(
          'Version conflict: the item was modified by another request. Re-fetch and retry.',
        );
      }
    }

    return { version: existing.version + 1 };
  }

  async delete(ids: string[]): Promise<void> {
    const attachments = await this.prisma.fileAttachment.findMany({
      where: { OR: [{ draft_id: { in: ids } }, { record_id: { in: ids } }] },
      select: { originalFid: true },
    });

    await this.prisma.$transaction(async (tx) => {
      const [allDrafts, allRecords] = await Promise.all([
        tx.draft.findMany({ where: { id: { in: ids } } }),
        tx.record.findMany({ where: { id: { in: ids } } }),
      ]);

      const draftIds = new Set(allDrafts.map((d) => d.id));
      const recordIds = new Set(allRecords.map((r) => r.id));

      const notFound = ids.filter((id) => !draftIds.has(id) && !recordIds.has(id));
      if (notFound.length > 0) {
        throw new NotFoundException(`Items not found: ${notFound.join(', ')}`);
      }

      // Delete relations first so the DELETE trigger can update parent counts
      // before the items themselves are removed.
      // Note: file_attachments are deleted automatically via ON DELETE CASCADE.
      await tx.itemRelation.deleteMany({
        where: { OR: [{ parentId: { in: ids } }, { childId: { in: ids } }] },
      });

      const fromDrafts = ids.filter((id) => draftIds.has(id));
      const fromRecords = ids.filter((id) => recordIds.has(id));

      if (fromDrafts.length > 0) {
        await tx.draft.deleteMany({ where: { id: { in: fromDrafts } } });
      }
      if (fromRecords.length > 0) {
        await tx.record.deleteMany({ where: { id: { in: fromRecords } } });
      }
    });

    // Delete files from SeaweedFS after DB commit succeeds.
    // If this fails, we get orphaned blobs (wasted storage) but DB stays consistent.
    await Promise.all(attachments.map((a) => this.seaweedfs.delete(a.originalFid).catch(() => {})));
  }

  async transition(
    ids: string[],
    targetState: ItemType,
    userId: string,
  ): Promise<Array<{ id: string; version: number }>> {
    return this.prisma.$transaction(async (tx) => {
      const [allDrafts, allRecords] = await Promise.all([
        tx.draft.findMany({ where: { id: { in: ids } } }),
        tx.record.findMany({ where: { id: { in: ids } } }),
      ]);

      const draftsMap = new Map(allDrafts.map((d) => [d.id, d]));
      const recordsMap = new Map(allRecords.map((r) => [r.id, r]));

      const notFound: string[] = [];
      const conflict: string[] = [];
      const alreadyInState: string[] = [];

      for (const id of ids) {
        const inDraft = draftsMap.has(id);
        const inRecord = recordsMap.has(id);

        if (!inDraft && !inRecord) {
          notFound.push(id);
        } else if (inDraft && inRecord) {
          conflict.push(id);
        } else if (
          (inRecord && targetState === ItemType.RECORD) ||
          (inDraft && targetState === ItemType.DRAFT)
        ) {
          alreadyInState.push(id);
        }
      }

      if (notFound.length > 0) {
        throw new NotFoundException(`Items not found: ${notFound.join(', ')}`);
      }
      if (conflict.length > 0) {
        throw new ConflictException(
          `Items exist in both tables (data corruption): ${conflict.join(', ')}`,
        );
      }
      if (alreadyInState.length > 0) {
        throw new BadRequestException(
          `Items already in state ${targetState}: ${alreadyInState.join(', ')}`,
        );
      }

      const fromDrafts = ids.filter((id) => draftsMap.has(id));
      const fromRecords = ids.filter((id) => recordsMap.has(id));
      const now = new Date();

      if (targetState === ItemType.RECORD) {
        await tx.record.createMany({
          data: fromDrafts.map((id) => {
            const d = draftsMap.get(id)!;
            return {
              id: d.id,
              visibilityStatus: d.visibilityStatus,
              metadata: d.metadata ?? undefined,
              version: d.version + 1,
              createdAt: d.createdAt,
              createdByUserId: d.createdByUserId,
              updatedAt: now,
              updatedByUserId: userId,
            };
          }),
        });
      } else {
        await tx.draft.createMany({
          data: fromRecords.map((id) => {
            const r = recordsMap.get(id)!;
            return {
              id: r.id,
              visibilityStatus: r.visibilityStatus,
              metadata: r.metadata ?? undefined,
              version: r.version + 1,
              createdAt: r.createdAt,
              createdByUserId: r.createdByUserId,
              updatedAt: now,
              updatedByUserId: userId,
            };
          }),
        });
      }

      // Update childType on relations where moved items are children.
      // The UPDATE trigger fires here and atomically swaps childrenInDrafts ↔ childrenInRecords
      // on the affected parent items.
      await tx.itemRelation.updateMany({
        where: { childId: { in: ids } },
        data: { childType: targetState },
      });

      // Update parentType on relations where moved items are parents.
      // No count change needed — parent metadata was copied to the new table.
      await tx.itemRelation.updateMany({
        where: { parentId: { in: ids } },
        data: { parentType: targetState },
      });

      // Re-link file attachments before cascade fires on delete.
      // IDs are identical after transition so record_id/draft_id = id directly.
      // Per-id loop is required because Prisma can't set column = different value per row.
      if (fromDrafts.length > 0 && targetState === ItemType.RECORD) {
        await Promise.all(fromDrafts.map((id) =>
          tx.fileAttachment.updateMany({
            where: { draft_id: id },
            data: { record_id: id, draft_id: null },
          }),
        ));
      }
      if (fromRecords.length > 0 && targetState === ItemType.DRAFT) {
        await Promise.all(fromRecords.map((id) =>
          tx.fileAttachment.updateMany({
            where: { record_id: id },
            data: { draft_id: id, record_id: null },
          }),
        ));
      }

      if (fromDrafts.length > 0) {
        await tx.draft.deleteMany({ where: { id: { in: fromDrafts } } });
      }
      if (fromRecords.length > 0) {
        await tx.record.deleteMany({ where: { id: { in: fromRecords } } });
      }

      // Read the versions back rather than returning the ones written above:
      // a transitioned item that is itself a parent may have been bumped again
      // by the children-count trigger when its children's childType changed.
      return targetState === ItemType.RECORD
        ? tx.record.findMany({ where: { id: { in: ids } }, select: { id: true, version: true } })
        : tx.draft.findMany({ where: { id: { in: ids } }, select: { id: true, version: true } });
    });
  }

  private sanitizeMetadata(
    rawMetadata: Record<string, unknown>,
  ): Record<string, unknown> {
    const entries: [string, unknown][] = [];
    for (const [k, v] of Object.entries(rawMetadata)) {
      const sanitize = METADATA_VALIDATORS.get(k);
      if (!sanitize) continue; // unknown field — silently drop
      try {
        entries.push([k, sanitize(v)]);
      } catch (e) {
        throw new BadRequestException(
          `Invalid value for metadata field "${k}": ${(e as Error).message}`,
        );
      }
    }
    return Object.fromEntries(entries);
  }
}
