import { Controller, Get, Param, Query } from '@nestjs/common';
import { SearchService } from './search.service';
import { SearchQueryDto } from './dto/search-query.dto';

@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  search(@Query() dto: SearchQueryDto) {
    return this.searchService.search(dto);
  }

  @Get(':id/children')
  getChildren(@Param('id') id: string, @Query() dto: SearchQueryDto) {
    return this.searchService.getChildren(id, dto);
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.searchService.getById(id);
  }
}
