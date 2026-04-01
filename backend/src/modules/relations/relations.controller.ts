import { Body, Controller, Post } from '@nestjs/common';
import { ModifyRelationsDto } from './dto/modify-relations.dto';
import { RelationsService } from './relations.service';

@Controller('relations')
export class RelationsController {
  constructor(private readonly relationsService: RelationsService) {}

  @Post('connect')
  connect(@Body() dto: ModifyRelationsDto) {
    return this.relationsService.connect(dto.parentId, dto.childIds);
  }

  @Post('disconnect')
  disconnect(@Body() dto: ModifyRelationsDto) {
    return this.relationsService.disconnect(dto.parentId, dto.childIds);
  }
}
