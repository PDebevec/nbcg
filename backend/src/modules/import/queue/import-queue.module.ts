import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { SchemaModule } from '../../schema/schema.module';
import { ImportQueueProcessor } from './import-queue.processor';
import { ImportQueueService } from './import-queue.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'import-queue'
    }),
    SchemaModule,
  ],
  providers: [ImportQueueService, ImportQueueProcessor],
  exports: [ImportQueueService],
})
export class ImportQueueModule {}