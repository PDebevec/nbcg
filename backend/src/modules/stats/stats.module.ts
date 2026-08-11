import { Module } from '@nestjs/common';
import { ItemsModule } from '../items/items.module';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';

@Module({
  // For ItemsService.stats() — the snapshot totals are defined there and
  // extended here, not reimplemented.
  imports: [ItemsModule],
  controllers: [StatsController],
  providers: [StatsService],
})
export class StatsModule {}
