import { Body, Controller, Post } from '@nestjs/common';
import { GetPrincipal } from '../../../core/auth/get-principal.decorator';
import { ResourceAccessService } from '../../../core/auth/resource-access.service';
import { RequireScopes } from '../../../core/auth/scopes.decorator';
import type { Principal } from '../../../core/auth/principal.type';
import { ItemType } from '../../../../generated/prisma/enums';
import { ImportQueueService } from '../queue/import-queue.service';
import { CobissImportDto } from './dto/cobiss-import.dto';

@Controller('import')
export class CobissImportController {
  constructor(
    private readonly importQueue: ImportQueueService,
    private readonly access: ResourceAccessService,
  ) {}

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
