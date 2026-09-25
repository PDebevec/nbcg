import { Module } from '@nestjs/common';
import { ItemsModule } from '../items/items.module';
import { UsersModule } from '../users/users.module';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  // For UsersService: name resolution and the advisory assignability check. The
  // directory has exactly one reader for the same reason it has exactly one
  // writer, so TasksService never touches prisma.userProfile itself.
  //
  // For ItemsService: completing a REVIEW_PUBLISH task publishes through
  // transition(), the same path as every other publish. No cycle — ItemsModule
  // writes tasks through Prisma + TaskHistoryService and never imports this.
  imports: [UsersModule, ItemsModule],
  controllers: [TasksController],
  providers: [TasksService],
})
export class TasksModule {}
