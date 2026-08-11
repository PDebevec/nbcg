import { Controller, Get, Headers, Param, Query } from '@nestjs/common';
import { GetPrincipal } from '../../core/auth/get-principal.decorator';
import type { Principal } from '../../core/auth/principal.type';
import { MetricsService } from '../../core/metrics/metrics.service';
import { SearchService } from './search.service';
import { SearchQueryDto } from './dto/search-query.dto';
import { SuggestQueryDto } from './dto/suggest-query.dto';

@Controller('search')
export class SearchController {
  constructor(
    private readonly searchService: SearchService,
    private readonly metrics: MetricsService,
  ) {}

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
  async getById(
    @GetPrincipal() principal: Principal,
    @Param('id') id: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    const hit = await this.searchService.getById(id, principal);

    // Counted only after the item resolved and passed the visibility check, so
    // a 404 probe can't inflate a counter. Synchronous and in-memory — this
    // must never delay or fail the read, and it deliberately ignores the
    // principal so anonymous traffic (most of it) is counted too.
    this.metrics.recordItemView(id, userAgent);

    return hit;
  }
}
