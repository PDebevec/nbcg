import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { SchemaModule } from '../schema/schema.module';
import { RelationsController } from './relations.controller';
import { RelationsService } from './relations.service';

@Module({
  // SchemaModule: every relation change re-checks the children it touches.
  imports: [PrismaModule, SchemaModule],
  controllers: [RelationsController],
  providers: [RelationsService],
  exports: [RelationsService], // items: POST /items links `parentIds` in its own transaction
})
export class RelationsModule {}
