import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import {
  buildContext,
  checkMetadata,
  type ConstraintViolation,
  type ItemState,
  type MissingField,
} from './rules/evaluate';
import { SchemaService } from './schema.service';

/** The root client or a `$transaction` client — callers pass whichever they hold. */
type Reader = PrismaService | Prisma.TransactionClient;

export interface ItemToValidate {
  /** `null` for an item that does not exist yet (`POST /items` straight to RECORD). */
  id: string | null;
  metadata: unknown;
  /** Where the item is now — rules may depend on it (`cobissId` is read-only once it exists). */
  itemState: ItemState;
}

export interface ValidationResult {
  id: string | null;
  ok: boolean;
  missing: MissingField[];
  violations: ConstraintViolation[];
}

/**
 * The publish check: every visible + required field filled, every value within
 * its constraints, evaluated with the item's own context (material type,
 * collectionType, parents). The same `checkMetadata` the web editor runs for
 * its "cannot be published yet" summary, so the two cannot disagree.
 *
 * Run on every path that makes an item a RECORD. Deliberately NOT on draft
 * saves, PATCH of an existing record, or the COBISS import worker.
 */
@Injectable()
export class PublishValidatorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly schema: SchemaService,
  ) {}

  async validate(items: ItemToValidate[], db: Reader = this.prisma): Promise<ValidationResult[]> {
    const parentsOf = await this.loadParents(
      items.map((i) => i.id).filter((id): id is string => id !== null),
      db,
    );
    return items.map((item) => this.check(item, item.id ? (parentsOf.get(item.id) ?? []) : []));
  }

  /** No database: the caller already knows the parents' metadata (`[]` for none). */
  check(item: ItemToValidate, parents: Array<Record<string, unknown>>): ValidationResult {
    const metadata = asRecord(item.metadata);
    const result = checkMetadata(
      this.schema.getRecordSchemaV2(),
      metadata,
      buildContext(metadata, parents, item.itemState),
    );
    return {
      id: item.id,
      ok: result.missing.length === 0 && result.violations.length === 0,
      ...result,
    };
  }

  /**
   * Throws `400 PUBLISH_VALIDATION_FAILED` naming every item that fails and
   * why. All-or-nothing: one bad item in a bulk publish stops the whole batch.
   */
  async assertPublishable(items: ItemToValidate[], db: Reader = this.prisma): Promise<void> {
    const failed = (await this.validate(items, db)).filter((r) => !r.ok);
    if (failed.length === 0) return;

    const noun = items.length === 1 ? 'item is' : 'items are';
    throw new BadRequestException({
      statusCode: 400,
      code: 'PUBLISH_VALIDATION_FAILED',
      message: `${failed.length} of ${items.length} ${noun} not ready to publish`,
      items: failed.map(({ id, missing, violations }) => ({ id, missing, violations })),
    });
  }

  /** childId → metadata of each of its parents, in one round trip per table. */
  private async loadParents(
    childIds: string[],
    db: Reader,
  ): Promise<Map<string, Array<Record<string, unknown>>>> {
    const byChild = new Map<string, Array<Record<string, unknown>>>();
    if (childIds.length === 0) return byChild;

    const relations = await db.itemRelation.findMany({
      where: { childId: { in: childIds } },
      select: { childId: true, parentId: true },
    });
    if (relations.length === 0) return byChild;

    const parentIds = [...new Set(relations.map((r) => r.parentId))];
    const [drafts, records] = await Promise.all([
      db.draft.findMany({ where: { id: { in: parentIds } }, select: { id: true, metadata: true } }),
      db.record.findMany({ where: { id: { in: parentIds } }, select: { id: true, metadata: true } }),
    ]);
    const metadataOf = new Map<string, Record<string, unknown>>(
      [...drafts, ...records].map((p) => [p.id, asRecord(p.metadata)]),
    );

    for (const { childId, parentId } of relations) {
      const list = byChild.get(childId) ?? [];
      // A relation to a vanished parent counts as a parent with no collectionType.
      list.push(metadataOf.get(parentId) ?? {});
      byChild.set(childId, list);
    }
    return byChild;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
