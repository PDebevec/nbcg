import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ItemType } from '../../../generated/prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';

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

@Injectable()
export class RelationsService {
  constructor(private readonly prisma: PrismaService) {}

  async connect(parentId: string, childIds: string[]): Promise<RelationWriteResult> {
    if (childIds.includes(parentId)) {
      throw new BadRequestException('An item cannot be its own child');
    }

    const typeMap = await this.resolveTypes([parentId, ...childIds]);

    const parentType = typeMap.get(parentId);
    if (!parentType) throw new BadRequestException(`Parent not found: ${parentId}`);

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

    await this.prisma.itemRelation.createMany({
      data: childIds.map((childId) => ({
        parentId,
        parentType,
        childId,
        childType: typeMap.get(childId)!,
      })),
      skipDuplicates: true,
    });

    return this.readParentState(parentId, parentType);
  }

  async disconnect(parentId: string, childIds: string[]): Promise<RelationWriteResult> {
    await this.prisma.itemRelation.deleteMany({
      where: {
        parentId,
        childId: { in: childIds },
      },
    });

    return this.readParentState(parentId);
  }

  /**
   * Read the parent's version and children counts after the trigger has run.
   * A single primary-key lookup when the caller already knows the parent's
   * table, two in parallel otherwise.
   */
  private async readParentState(
    parentId: string,
    parentType?: ItemType,
  ): Promise<RelationWriteResult> {
    const select = { version: true, metadata: true } as const;

    let parent: { version: number; metadata: unknown } | null;
    if (parentType === ItemType.DRAFT) {
      parent = await this.prisma.draft.findUnique({ where: { id: parentId }, select });
    } else if (parentType === ItemType.RECORD) {
      parent = await this.prisma.record.findUnique({ where: { id: parentId }, select });
    } else {
      const [draft, record] = await Promise.all([
        this.prisma.draft.findUnique({ where: { id: parentId }, select }),
        this.prisma.record.findUnique({ where: { id: parentId }, select }),
      ]);
      parent = draft ?? record;
    }

    if (!parent) throw new NotFoundException(`Parent not found: ${parentId}`);

    const metadata = (parent.metadata as Record<string, unknown> | null) ?? {};
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

  private async resolveTypes(ids: string[]): Promise<Map<string, ItemType>> {
    const unique = [...new Set(ids)];

    const [drafts, records] = await Promise.all([
      this.prisma.draft.findMany({ where: { id: { in: unique } }, select: { id: true } }),
      this.prisma.record.findMany({ where: { id: { in: unique } }, select: { id: true } }),
    ]);

    const typeMap = new Map<string, ItemType>();
    drafts.forEach((d) => typeMap.set(d.id, ItemType.DRAFT));
    records.forEach((r) => typeMap.set(r.id, ItemType.RECORD));

    const missing = unique.filter((id) => !typeMap.has(id));
    if (missing.length > 0) {
      throw new BadRequestException(`IDs not found: ${missing.join(', ')}`);
    }

    return typeMap;
  }
}
