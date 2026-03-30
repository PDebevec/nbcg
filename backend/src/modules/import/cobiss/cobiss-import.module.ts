import { Module } from '@nestjs/common';
import { CobissImportController } from './cobiss-import.controller';
import { ImportQueueModule } from '../queue/import-queue.module';

@Module({
  imports: [ImportQueueModule],
  controllers: [CobissImportController],
})
export class CobissImportModule {}