import { Controller, Get, Param, Query } from '@nestjs/common';
import { GetPrincipal } from '../../core/auth/get-principal.decorator';
import type { Principal } from '../../core/auth/principal.type';
import { SearchService } from './search.service';
import { SearchQueryDto } from './dto/search-query.dto';
import { SuggestQueryDto } from './dto/suggest-query.dto';

@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  search(@GetPrincipal() principal: Principal, @Query() dto: SearchQueryDto) {
    return this.searchService.search(dto, principal);
  }

  // Must be above :id to avoid "suggest" being captured as an id param
  @Get('suggest')
  suggest(@GetPrincipal() principal: Principal, @Query() dto: SuggestQueryDto) {
    return this.searchService.suggest(dto, principal);
  }

  @Get(':id/children')
  getChildren(
    @GetPrincipal() principal: Principal,
    @Param('id') id: string,
    @Query() dto: SearchQueryDto,
  ) {
    return this.searchService.getChildren(id, dto, principal);
  }

  @Get(':id')
  getById(@GetPrincipal() principal: Principal, @Param('id') id: string) {
    return this.searchService.getById(id, principal);
  }
}
