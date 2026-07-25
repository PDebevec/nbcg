import { Body, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { GetPrincipal } from '../../../core/auth/get-principal.decorator';
import { ResourceAccessService } from '../../../core/auth/resource-access.service';
import { RequireScopes } from '../../../core/auth/scopes.decorator';
import type { Principal } from '../../../core/auth/principal.type';
import { ItemType } from '../../../../generated/prisma/enums';
import { ImportQueueService } from '../queue/import-queue.service';
import { CobissImportDto } from './dto/cobiss-import.dto';
import { fetchCobissRecord } from './cobiss-util/cobiss-fetch';
import { generateDeterministicId } from '../../../shared/util/generateUuidFromCobissId';
import { PrismaService } from '../../../core/prisma/prisma.service';

@Controller('import')
export class CobissImportController {
  constructor(
    private readonly importQueue: ImportQueueService,
    private readonly access: ResourceAccessService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Synchronous COBISS preview — fetch + parse without persisting.
   * Returns the normalized metadata, the deterministic item ID, and whether
   * an item with that ID already exists in the database.
   */
  @Get('cobiss/preview/:cobissId')
  @RequireScopes('import:execute')
  async previewCobiss(@Param('cobissId') cobissId: string) {
    const record = await fetchCobissRecord(cobissId);
    if (!record) {
      throw new NotFoundException(`No record found in COBISS for id ${cobissId}`);
    }

    const itemId = generateDeterministicId(cobissId);

    const [existingDraft, existingRecord] = await Promise.all([
      this.prisma.draft.findUnique({ where: { id: itemId }, select: { id: true } }),
      this.prisma.record.findUnique({ where: { id: itemId }, select: { id: true } }),
    ]);

    return {
      cobissId,
      itemId,
      alreadyExists: !!(existingDraft || existingRecord),
      existsAs: existingDraft ? 'DRAFT' : existingRecord ? 'RECORD' : null,
      metadata: record,
    };
  }

  @Post('cobiss')
  @RequireScopes('import:execute')
  async importCobiss(@GetPrincipal() principal: Principal, @Body() dto: CobissImportDto) {
    if (!dto.ids?.length) {
      return { error: 'No COBISS ids provided' };
    }

    // §4.5: import requires import:execute + manage on the target collection
    const collection = dto.target === ItemType.RECORD ? 'records' : 'drafts';
    this.access.assertCanManageCollection(principal, collection);

    return this.importQueue.enqueue('cobiss', dto.ids, dto.target, dto.visibilityStatus);
  }
}
