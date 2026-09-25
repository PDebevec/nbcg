import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import {
  buildContext,
  checkMetadata,
  type ConstraintViolation,
  type ItemState,
  type MissingField,
  type TargetState,
} from './rules/evaluate';
import { SchemaService } from './schema.service';

/** The root client or a `$transaction` client — callers pass whichever they hold. */
type Reader = PrismaService | Prisma.TransactionClient;

export interface ItemToValidate {
  /** `null` for an item that does not exist yet (`POST /items`). */
  id: string | null;
  metadata: unknown;
  /** Where the item is now — rules may depend on it (`cobissId` is read-only once it exists). */
  itemState: ItemState;
  /** The state the write leaves it in: whose rules apply. */
  targetState: TargetState;
  /**
   * The parents' metadata when the caller already has it (`POST /items` with
   * `parentIds`). Omitted → loaded from `item_relations` for an existing item,
   * `[]` for a new one.
   */
  parents?: Array<Record<string, unknown>>;
}

export interface ValidationResult {
  id: string | null;
  /** The rules the item was checked against. */
  state: TargetState;
  ok: boolean;
  missing: MissingField[];
  violations: ConstraintViolation[];
}

/**
 * The save check: every visible + required field filled, every value within
 * its constraints, evaluated with the item's own context (material type,
 * collectionType, parents, target state). The same `checkMetadata` the editors
 * run before they let the user save, so the two cannot disagree.
 *
 * Run on every write that leaves item metadata behind: create, PATCH with
 * metadata, transition (both directions), relation connect/disconnect.
 * Deliberately NOT on the COBISS import worker (it only reports warnings).
 */
@Injectable()
export class MetadataValidatorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly schema: SchemaService,
  ) {}

  async validate(items: ItemToValidate[], db: Reader = this.prisma): Promise<ValidationResult[]> {
    const parentsOf = await this.loadParents(
      items.filter((i) => i.id !== null && !i.parents).map((i) => i.id!),
      db,
    );
    return items.map((item) =>
      this.check(item, item.parents ?? (item.id ? (parentsOf.get(item.id) ?? []) : [])),
    );
  }

  /** No database: the caller already knows the parents' metadata (`[]` for none). */
  check(item: ItemToValidate, parents: Array<Record<string, unknown>>): ValidationResult {
    const metadata = asRecord(item.metadata);
    const result = checkMetadata(
      this.schema.getRecordSchemaV2(),
      metadata,
      buildContext(metadata, parents, item.itemState, item.targetState),
    );
    return {
      id: item.id,
      state: item.targetState,
      ok: result.missing.length === 0 && result.violations.length === 0,
      ...result,
    };
  }

  /**
   * Throws `400 METADATA_VALIDATION_FAILED` naming every item that fails, why,
   * and whose rules it failed (`state`). All-or-nothing: one bad item in a bulk
   * write stops the whole batch.
   */
  async assertValid(items: ItemToValidate[], db: Reader = this.prisma): Promise<void> {
    const failed = (await this.validate(items, db)).filter((r) => !r.ok);
    if (failed.length === 0) return;

    const one = items.length === 1;
    const message = failed.every((r) => r.state === 'RECORD')
      ? `${failed.length} of ${items.length} ${one ? 'item is' : 'items are'} not ready to publish`
      : `${failed.length} of ${items.length} ${one ? 'item' : 'items'} cannot be saved`;

    throw new BadRequestException({
      statusCode: 400,
      code: 'METADATA_VALIDATION_FAILED',
      message,
      items: failed.map(({ id, state, missing, violations }) => ({ id, state, missing, violations })),
    });
  }

  /**
   * Re-check existing items as they are stored, each in its current state, with
   * the parents `db` sees — inside a relation change's transaction that is the
   * parents *after* the change. Unknown ids are skipped.
   */
  async assertStoredValid(ids: string[], db: Reader = this.prisma): Promise<void> {
    if (ids.length === 0) return;
    const unique = [...new Set(ids)];
    const [drafts, records] = await Promise.all([
      db.draft.findMany({ where: { id: { in: unique } }, select: { id: true, metadata: true } }),
      db.record.findMany({ where: { id: { in: unique } }, select: { id: true, metadata: true } }),
    ]);
    const stored = (rows: Array<{ id: string; metadata: unknown }>, state: 'DRAFT' | 'RECORD') =>
      rows.map((r) => ({ id: r.id, metadata: r.metadata, itemState: state, targetState: state }));

    await this.assertValid([...stored(drafts, 'DRAFT'), ...stored(records, 'RECORD')], db);
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
