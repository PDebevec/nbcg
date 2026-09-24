import { Module } from '@nestjs/common';
import { PublishValidatorService } from './publish-validator.service';
import { SchemaController } from './schema.controller';
import { SchemaService } from './schema.service';

@Module({
  controllers: [SchemaController],
  providers: [SchemaService, PublishValidatorService],
  exports: [PublishValidatorService], // items (publish) and the import worker (warnings)
})
export class SchemaModule {}
