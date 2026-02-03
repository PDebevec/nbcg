import { Module } from '@nestjs/common';
import { CobissImportModule } from './cobiss/cobiss-import.module';

@Module({
  imports: [CobissImportModule],
})
export class ImportModule {}