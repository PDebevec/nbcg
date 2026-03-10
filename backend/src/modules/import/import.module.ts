import { Module } from '@nestjs/common';
import { ImportController } from './import.controller';
import { ImportQueueModule } from './shared/import-queue.module';
import { CobissImportModule } from './cobiss/cobiss-import.module';

@Module({
  imports: [ImportQueueModule, CobissImportModule],
  controllers: [ImportController],
})
export class ImportModule {}