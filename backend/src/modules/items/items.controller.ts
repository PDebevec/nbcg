import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { GetPrincipal } from '../../core/auth/get-principal.decorator';
import { RequireScopes } from '../../core/auth/scopes.decorator';
import { ResourceAccessService } from '../../core/auth/resource-access.service';
import type { Principal } from '../../core/auth/principal.type';
import { ItemType } from '../../../generated/prisma/enums';
import { CreateItemDto } from './dto/create-item.dto';
import { DeleteItemsDto } from './dto/delete-items.dto';
import { HistoryQueryDto } from './dto/history-query.dto';
import { TransitionItemsDto } from './dto/transition-items.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { ItemsService } from './items.service';

@Controller('items')
export class ItemsController {
  constructor(
    private readonly itemsService: ItemsService,
    private readonly access: ResourceAccessService,
  ) {}

 @Get('stats')
  @RequireScopes('records:view:hidden', 'drafts:view:hidden')
  stats() {
    return this.itemsService.stats();
  }

  // Same guard as /items/stats: a timeline names who edited what and when, so
  // it is admin-only regardless of whether the item itself is public.
  // Two segments, so it can never be captured by the 'stats' route above.
  @Get(':id/history')
  @RequireScopes('records:view:hidden', 'drafts:view:hidden')
  history(@Param('id') id: string, @Query() dto: HistoryQueryDto) {
    return this.itemsService.history(id, dto.limit ?? 50, dto.offset ?? 0);
  }

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
    return this.itemsService.transition(dto.ids, dto.targetState, principal.sub);
  }

  @Patch(':id')
  async update(
    @GetPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body() dto: UpdateItemDto,
  ) {
    await this.access.assertCanManage(principal, id);
    return this.itemsService.update(
      id,
      dto.visibilityStatus,
      dto.metadata,
      principal.sub,
      dto.expectedVersion,
    );
  }

  @Delete()
  async delete(@GetPrincipal() principal: Principal, @Body() dto: DeleteItemsDto) {
    await this.access.assertCanManageBatch(principal, dto.ids);
    return this.itemsService.delete(dto.ids, principal.sub);
  }
}
