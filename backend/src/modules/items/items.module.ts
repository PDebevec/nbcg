import { Module } from '@nestjs/common';
import { SeaweedfsModule } from '../../core/seaweedfs/seaweedfs.module';
import { ItemsController } from './items.controller';
import { ItemsService } from './items.service';

@Module({
  imports: [SeaweedfsModule],
  controllers: [ItemsController],
  providers: [ItemsService],
})
export class ItemsModule {}
