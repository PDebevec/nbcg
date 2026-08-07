import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { GetPrincipal } from '../../core/auth/get-principal.decorator';
import { ResourceAccessService } from '../../core/auth/resource-access.service';
import type { Principal } from '../../core/auth/principal.type';
import { ModifyRelationsDto } from './dto/modify-relations.dto';
import { RelationsService } from './relations.service';

@Controller('relations')
export class RelationsController {
  constructor(
    private readonly relationsService: RelationsService,
    private readonly access: ResourceAccessService,
  ) {}

  @Post('connect')
  async connect(@GetPrincipal() principal: Principal, @Body() dto: ModifyRelationsDto) {
    await this.access.assertCanManage(principal, dto.parentId);
    return this.relationsService.connect(dto.parentId, dto.childIds);
  }

  // 200, not the previous 204 — the response now carries the parent's
  // post-write version, and a 204 must not have a body.
  @Post('disconnect')
  @HttpCode(200)
  async disconnect(@GetPrincipal() principal: Principal, @Body() dto: ModifyRelationsDto) {
    await this.access.assertCanManage(principal, dto.parentId);
    return this.relationsService.disconnect(dto.parentId, dto.childIds);
  }
}
