import { Body, Controller, Delete, Param, Patch, Post } from '@nestjs/common';
import { GetPrincipal } from '../../core/auth/get-principal.decorator';
import { ResourceAccessService } from '../../core/auth/resource-access.service';
import type { Principal } from '../../core/auth/principal.type';
import { ItemType } from '../../../generated/prisma/enums';
import { CreateItemDto } from './dto/create-item.dto';
import { DeleteItemsDto } from './dto/delete-items.dto';
import { TransitionItemsDto } from './dto/transition-items.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { ItemsService } from './items.service';

@Controller('items')
export class ItemsController {
  constructor(
    private readonly itemsService: ItemsService,
    private readonly access: ResourceAccessService,
  ) {}

  @Post()
  create(@GetPrincipal() principal: Principal, @Body() dto: CreateItemDto) {
    const collection = dto.targetState === ItemType.RECORD ? 'records' : 'drafts';
    this.access.assertCanManageCollection(principal, collection);
    return this.itemsService.create(
      dto.visibilityStatus,
      dto.targetState,
      dto.metadata,
      principal.sub,
    );
  }

  @Post('transition')
  transition(@GetPrincipal() principal: Principal, @Body() dto: TransitionItemsDto) {
    this.access.assertCanTransition(principal);
    return this.itemsService.transition(dto.ids, dto.targetState);
  }

  @Patch(':id')
  async update(
    @GetPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body() dto: UpdateItemDto = {},
  ) {
    await this.access.assertCanManage(principal, id);
    return this.itemsService.update(id, dto.visibilityStatus, dto.metadata, principal.sub);
  }

  @Delete()
  async delete(@GetPrincipal() principal: Principal, @Body() dto: DeleteItemsDto) {
    await this.access.assertCanManageBatch(principal, dto.ids);
    return this.itemsService.delete(dto.ids);
  }
}
