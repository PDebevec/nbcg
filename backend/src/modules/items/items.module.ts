import { Module } from '@nestjs/common';
import { SeaweedfsModule } from '../../core/seaweedfs/seaweedfs.module';
import { RelationsModule } from '../relations/relations.module';
import { SchemaModule } from '../schema/schema.module';
import { ItemsController } from './items.controller';
import { ItemsService } from './items.service';

@Module({
  imports: [SeaweedfsModule, SchemaModule, RelationsModule],
  controllers: [ItemsController],
  providers: [ItemsService],
  exports: [ItemsService], // StatsModule extends stats() rather than duplicating it
})
export class ItemsModule {}
