import { Controller, Get, Query } from '@nestjs/common';
import { RequireScopes } from '../../core/auth/scopes.decorator';
import { StatsRangeDto, TopItemsQueryDto, UserStatsQueryDto } from './dto/stats-query.dto';
import { StatsService } from './stats.service';

/**
 * Aggregate statistics for the admin dashboard.
 *
 * Same guard as `/api/items/stats` throughout: these responses name who edited
 * what and expose counts for items an anonymous visitor cannot see.
 */
@Controller('stats')
@RequireScopes('records:view:hidden', 'drafts:view:hidden')
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get('overview')
  overview(@Query() dto: StatsRangeDto) {
    return this.statsService.overview(dto.from, dto.to);
  }

  @Get('users')
  users(@Query() dto: UserStatsQueryDto) {
    return this.statsService.users(dto.from, dto.to, dto.limit);
  }

  @Get('items/top')
  topItems(@Query() dto: TopItemsQueryDto) {
    return this.statsService.topItems(dto.from, dto.to, dto.metric, dto.limit);
  }
}
