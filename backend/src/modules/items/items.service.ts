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
  constructor(private readonly prisma: PrismaService) {}

  async create(
    visibilityStatus: VisibilityStatus,
    targetState: ItemType,
    rawMetadata: Record<string, unknown> | undefined,
  ): Promise<void> {
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
      createdByUserId: 'user',
      updatedByUserId: 'user',
    };

    if (targetState === ItemType.RECORD) {
      await this.prisma.record.create({ data: data as any });
    } else {
      await this.prisma.draft.create({ data: data as any });
    }
  }

  async update(
    id: string,
    visibilityStatus: VisibilityStatus | undefined,
    rawMetadata: Record<string, unknown> | undefined,
  ): Promise<void> {
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

    // Nothing to update — return success without touching the DB.
    if (!visibilityStatus && !hasMetadataChanges) {
      return;
    }

    const [draft, record] = await Promise.all([
      this.prisma.draft.findUnique({ where: { id } }),
      this.prisma.record.findUnique({ where: { id } }),
    ]);

    if (!draft && !record) {
      throw new NotFoundException(`Item not found: ${id}`);
    }

    const existing = draft ?? record!;
    const existingMetadata =
      (existing.metadata as unknown as Record<string, unknown>) ?? {};

    const data: Record<string, unknown> = { updatedByUserId: 'user' };
    if (visibilityStatus) data.visibilityStatus = visibilityStatus;
    if (hasMetadataChanges) {
      data.metadata = { ...existingMetadata, ...metadataUpdate };
    }

    if (draft) {
      await this.prisma.draft.update({ where: { id }, data });
    } else {
      await this.prisma.record.update({ where: { id }, data });
    }
  }

  async delete(ids: string[]): Promise<void> {
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
  }

  async transition(ids: string[], targetState: ItemType): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
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
              createdAt: d.createdAt,
              createdByUserId: d.createdByUserId,
              updatedAt: now,
              updatedByUserId: d.updatedByUserId,
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
              createdAt: r.createdAt,
              createdByUserId: r.createdByUserId,
              updatedAt: now,
              updatedByUserId: r.updatedByUserId,
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

      if (fromDrafts.length > 0) {
        await tx.draft.deleteMany({ where: { id: { in: fromDrafts } } });
      }
      if (fromRecords.length > 0) {
        await tx.record.deleteMany({ where: { id: { in: fromRecords } } });
      }
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
