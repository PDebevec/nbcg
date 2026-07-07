import { BadRequestException, Injectable } from '@nestjs/common';
import { ItemType } from '../../../generated/prisma/client';
import { PrismaService } from 'src/core/prisma/prisma.service';

@Injectable()
export class RelationsService {
  constructor(private readonly prisma: PrismaService) {}

  async connect(parentId: string, childIds: string[]): Promise<void> {
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
  }

  async disconnect(parentId: string, childIds: string[]): Promise<void> {
    await this.prisma.itemRelation.deleteMany({
      where: {
        parentId,
        childId: { in: childIds },
      },
    });
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
