import { Global, Module } from '@nestjs/common';
import { TaskHistoryService } from './task-history.service';

@Global() // tasks writes it, and so does the publish observer inside ItemsService
@Module({
  providers: [TaskHistoryService],
  exports: [TaskHistoryService],
})
export class TaskHistoryModule {}
