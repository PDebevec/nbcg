import { Module } from '@nestjs/common';
import { MetadataValidatorService } from './metadata-validator.service';
import { SchemaController } from './schema.controller';
import { SchemaService } from './schema.service';

@Module({
  controllers: [SchemaController],
  providers: [SchemaService, MetadataValidatorService],
  // items (every write), relations (re-check children) and the import worker (warnings)
  exports: [MetadataValidatorService],
})
export class SchemaModule {}
