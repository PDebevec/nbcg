import { Module } from '@nestjs/common';
import { TikaService } from './tika.service';

@Module({
  providers: [TikaService],
  exports: [TikaService],
})
export class TikaModule {}
