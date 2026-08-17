import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  // For UsersService: name resolution and the advisory assignability check. The
  // directory has exactly one reader for the same reason it has exactly one
  // writer, so TasksService never touches prisma.userProfile itself.
  imports: [UsersModule],
  controllers: [TasksController],
  providers: [TasksService],
})
export class TasksModule {}
