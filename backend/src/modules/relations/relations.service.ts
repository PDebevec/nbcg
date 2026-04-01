import { BadRequestException, Injectable } from '@nestjs/common';
import { ItemType } from '../../../generated/prisma/client';
import { PrismaService } from 'src/core/prisma/prisma.service';

@Injectable()
export class RelationsService {
  constructor(private readonly prisma: PrismaService) {}

  async connect(parentId: string, childIds: string[]): Promise<void> {
    const typeMap = await this.resolveTypes([parentId, ...childIds]);

    const parentType = typeMap.get(parentId);
    if (!parentType) throw new BadRequestException(`Parent not found: ${parentId}`);

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
