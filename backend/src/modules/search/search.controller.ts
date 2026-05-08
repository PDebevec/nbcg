import { Controller, Get, Query } from '@nestjs/common';
import { SearchService } from './search.service';

@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  search(
    @Query('q') q: string,
    @Query('type') type: 'all' | 'records' | 'drafts' = 'all',
    @Query('limit') limit = 20,
  ) {
    return this.searchService.search(q ?? '', type, Number(limit));
  }
}
