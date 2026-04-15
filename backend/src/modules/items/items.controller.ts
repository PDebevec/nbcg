import { Body, Controller, Delete, Param, Patch, Post } from '@nestjs/common';
import { CreateItemDto } from './dto/create-item.dto';
import { DeleteItemsDto } from './dto/delete-items.dto';
import { TransitionItemsDto } from './dto/transition-items.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { ItemsService } from './items.service';

@Controller('items')
export class ItemsController {
  constructor(private readonly itemsService: ItemsService) {}

  @Post()
  create(@Body() dto: CreateItemDto) {
    return this.itemsService.create(dto.visibilityStatus, dto.targetState, dto.metadata);
  }

  @Post('transition')
  transition(@Body() dto: TransitionItemsDto) {
    return this.itemsService.transition(dto.ids, dto.targetState);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateItemDto = {}) {
    return this.itemsService.update(id, dto.visibilityStatus, dto.metadata);
  }

  @Delete()
  delete(@Body() dto: DeleteItemsDto) {
    return this.itemsService.delete(dto.ids);
  }
}
