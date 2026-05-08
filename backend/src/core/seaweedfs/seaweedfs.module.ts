import { Module } from '@nestjs/common';
import { SeaweedfsService } from './seaweedfs.service';

@Module({
  providers: [SeaweedfsService],
  exports: [SeaweedfsService],
})
export class SeaweedfsModule {}
