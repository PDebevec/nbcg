import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ChangeAction, ItemType, type Prisma } from '../../../generated/prisma/client';
import type { Actor } from '../../core/auth/actor.type';
import { PrismaService } from '../../core/prisma/prisma.service';
import { RevisionsService } from '../../core/revisions/revisions.service';
import { parentNotFound } from '../../shared/errors/parent-not-found';
import { MetadataValidatorService } from '../schema/metadata-validator.service';

/** The root client or a `$transaction` client — callers pass whichever they hold. */
type Db = PrismaService | Prisma.TransactionClient;

/**
 * The parent's state after a relation write. Every edge row fires
 * `trg_item_relations_children_count`, which bumps the parent's `version` and
 * rewrites its children counts, so the caller is told the resulting version
 * rather than having to re-read it through the CDC-lagged search index.
 */
export interface RelationWriteResult {
  parentId: string;
  version: number;
  childrenInDrafts: number;
  childrenInRecords: number;
}

/** A parent resolved for `POST /items` with `parentIds`. */
export interface ResolvedParent {
  id: string;
  type: ItemType;
  metadata: Record<string, unknown>;
}

@Injectable()
export class RelationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly revisions: RevisionsService,
    private readonly validator: MetadataValidatorService,
  ) {}

  /**
   * Link children to a parent. The edges, the re-check of every child (in its
   * current state, with its parents after the change) and the parent's
   * timeline entry are one transaction: a child the new parent makes invalid
   * (a complete book RECORD under a serial, without issue data) is not linked.
   */
  async connect(
    parentId: string,
    childIds: string[],
    actor: Actor,
  ): Promise<RelationWriteResult> {
    if (childIds.includes(parentId)) {
      throw new BadRequestException('An item cannot be its own child');
    }

    const typeMap = await this.resolveTypes([parentId, ...childIds]);

    const parentType = typeMap.get(parentId);
    if (!parentType) throw parentNotFound([parentId]);

    const missing = childIds.filter((id) => !typeMap.has(id));
    if (missing.length > 0) {
      throw new BadRequestException(`Child IDs not found: ${missing.join(', ')}`);
    }

    // Reject cycles: none of the new children may already be an ancestor of the parent.
    const ancestors = await this.getAncestorIds(parentId);
    const cyclic = childIds.filter((id) => ancestors.has(id));
    if (cyclic.length > 0) {
      throw new BadRequestException(
        `Connecting would create a circular relation: ${cyclic.join(', ')}`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.itemRelation.createMany({
        data: childIds.map((childId) => ({
          parentId,
          parentType,
          childId,
          childType: typeMap.get(childId)!,
        })),
        skipDuplicates: true,
      });

      await this.validator.assertStoredValid(childIds, tx);

      const state = await this.readParentState(tx, parentId, parentType);
      await this.recordRelationChange(tx, ChangeAction.RELATION_ADDED, parentId, childIds, state, actor);
      return state;
    });
  }

  /**
   * Unlink children. Re-checked like `connect`: taking an issue out of its
   * serial makes its own collection type and authors visible again.
   */
  async disconnect(
    parentId: string,
    childIds: string[],
    actor: Actor,
  ): Promise<RelationWriteResult> {
    return this.prisma.$transaction(async (tx) => {
      await tx.itemRelation.deleteMany({
        where: {
          parentId,
          childId: { in: childIds },
        },
      });

      await this.validator.assertStoredValid(childIds, tx);

      const state = await this.readParentState(tx, parentId);
      await this.recordRelationChange(tx, ChangeAction.RELATION_REMOVED, parentId, childIds, state, actor);
      return state;
    });
  }

  /**
   * The parents named in `POST /items` `parentIds`, with their metadata for the
   * save check. Any unknown id → `400 PARENT_NOT_FOUND`, before anything is
   * written.
   */
  async resolveParents(parentIds: string[], db: Db = this.prisma): Promise<ResolvedParent[]> {
    const unique = [...new Set(parentIds)];
    if (unique.length === 0) return [];

    const select = { id: true, metadata: true } as const;
    const [drafts, records] = await Promise.all([
      db.draft.findMany({ where: { id: { in: unique } }, select }),
      db.record.findMany({ where: { id: { in: unique } }, select }),
    ]);
    const byId = new Map<string, ResolvedParent>();
    for (const d of drafts) byId.set(d.id, { id: d.id, type: ItemType.DRAFT, metadata: asRecord(d.metadata) });
    for (const r of records) byId.set(r.id, { id: r.id, type: ItemType.RECORD, metadata: asRecord(r.metadata) });

    const missing = unique.filter((id) => !byId.has(id));
    if (missing.length > 0) throw parentNotFound(missing);
    return unique.map((id) => byId.get(id)!);
  }

  /**
   * Link a brand-new item to its parents inside the caller's create
   * transaction (`POST /items` with `parentIds`). No cycle check: nothing can
   * point at an item that did not exist a moment ago. The caller has already
   * run the save check with these parents.
   */
  async linkNewChild(
    tx: Prisma.TransactionClient,
    childId: string,
    childType: ItemType,
    parents: ResolvedParent[],
    actor: Actor,
  ): Promise<RelationWriteResult[]> {
    if (parents.length === 0) return [];

    await tx.itemRelation.createMany({
      data: parents.map((p) => ({ parentId: p.id, parentType: p.type, childId, childType })),
    });

    const results: RelationWriteResult[] = [];
    for (const parent of parents) {
      // Deleted between resolveParents() and this transaction.
      const state = await this.readParentState(tx, parent.id, parent.type).catch((e) => {
        throw e instanceof NotFoundException ? parentNotFound([parent.id]) : e;
      });
      await this.recordRelationChange(tx, ChangeAction.RELATION_ADDED, parent.id, [childId], state, actor);
      results.push(state);
    }
    return results;
  }

  /**
   * Timeline entry on the parent only — the edge belongs to the parent, and the
   * post-trigger version read back above is exactly the version this change
   * produced. Written in the relation change's own transaction.
   */
  private async recordRelationChange(
    tx: Prisma.TransactionClient,
    action: ChangeAction,
    parentId: string,
    childIds: string[],
    state: RelationWriteResult,
    actor: Actor,
  ): Promise<void> {
    const added = action === ChangeAction.RELATION_ADDED;
    await this.revisions.record(
      {
        itemId: parentId,
        version: state.version,
        action,
        changes: childIds.map((childId) => ({
          path: `children[${childId}]`,
          before: added ? null : childId,
          after: added ? childId : null,
        })),
        actor,
      },
      tx,
    );
  }

  /**
   * Read the parent's version and children counts after the trigger has run.
   * A single primary-key lookup when the caller already knows the parent's
   * table, two in parallel otherwise.
   */
  private async readParentState(
    db: Db,
    parentId: string,
    parentType?: ItemType,
  ): Promise<RelationWriteResult> {
    const select = { version: true, metadata: true } as const;

    let parent: { version: number; metadata: unknown } | null;
    if (parentType === ItemType.DRAFT) {
      parent = await db.draft.findUnique({ where: { id: parentId }, select });
    } else if (parentType === ItemType.RECORD) {
      parent = await db.record.findUnique({ where: { id: parentId }, select });
    } else {
      const [draft, record] = await Promise.all([
        db.draft.findUnique({ where: { id: parentId }, select }),
        db.record.findUnique({ where: { id: parentId }, select }),
      ]);
      parent = draft ?? record;
    }

    if (!parent) throw new NotFoundException(`Parent not found: ${parentId}`);

    const metadata = asRecord(parent.metadata);
    return {
      parentId,
      version: parent.version,
      childrenInDrafts: Number(metadata.childrenInDrafts ?? 0),
      childrenInRecords: Number(metadata.childrenInRecords ?? 0),
    };
  }

  /** All transitive ancestors of an item (parents, grandparents, ...). */
  private async getAncestorIds(id: string): Promise<Set<string>> {
    const rows = await this.prisma.$queryRaw<Array<{ parentId: string }>>`
      WITH RECURSIVE ancestors AS (
        SELECT "parentId" FROM item_relations WHERE "childId" = ${id}
        UNION
        SELECT ir."parentId"
        FROM item_relations ir
        JOIN ancestors a ON ir."childId" = a."parentId"
      )
      SELECT "parentId" FROM ancestors
    `;
    return new Set(rows.map((r) => r.parentId));
  }

  /** Which table each id lives in; unknown ids are simply absent from the map. */
  private async resolveTypes(ids: string[]): Promise<Map<string, ItemType>> {
    const unique = [...new Set(ids)];

    const [drafts, records] = await Promise.all([
      this.prisma.draft.findMany({ where: { id: { in: unique } }, select: { id: true } }),
      this.prisma.record.findMany({ where: { id: { in: unique } }, select: { id: true } }),
    ]);

    const typeMap = new Map<string, ItemType>();
    drafts.forEach((d) => typeMap.set(d.id, ItemType.DRAFT));
    records.forEach((r) => typeMap.set(r.id, ItemType.RECORD));
    return typeMap;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
