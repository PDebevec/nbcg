import { Module } from '@nestjs/common';
import { CobissImportController } from './cobiss-import.controller';
import { CobissImportService } from './cobiss-import.service';

@Module({
  controllers: [CobissImportController],
  providers: [CobissImportService],
})
export class CobissImportModule {}