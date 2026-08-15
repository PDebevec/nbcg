import { Module } from '@nestjs/common';
import { ItemsModule } from '../items/items.module';
import { UsersModule } from '../users/users.module';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';

@Module({
  // ItemsService.stats() — the snapshot totals are defined there and extended
  // here, not reimplemented. UsersService — to resolve a userId to the name that
  // person goes by now, which aggregates must not take from the row snapshots.
  imports: [ItemsModule, UsersModule],
  controllers: [StatsController],
  providers: [StatsService],
})
export class StatsModule {}
