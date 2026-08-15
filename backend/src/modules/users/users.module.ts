import { Module } from '@nestjs/common';
import { UserSyncQueueModule } from './queue/user-sync-queue.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [UserSyncQueueModule],
  controllers: [UsersController],
  providers: [UsersService],
  // For StatsService, which resolves current names for its aggregates.
  exports: [UsersService],
})
export class UsersModule {}
