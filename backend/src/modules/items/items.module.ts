import { Module } from '@nestjs/common';
import { SeaweedfsModule } from '../../core/seaweedfs/seaweedfs.module';
import { SchemaModule } from '../schema/schema.module';
import { ItemsController } from './items.controller';
import { ItemsService } from './items.service';

@Module({
  imports: [SeaweedfsModule, SchemaModule],
  controllers: [ItemsController],
  providers: [ItemsService],
  exports: [ItemsService], // StatsModule extends stats() rather than duplicating it
})
export class ItemsModule {}
