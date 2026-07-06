import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TikaModule } from 'src/core/tika/tika.module';
import { SeaweedfsModule } from 'src/core/seaweedfs/seaweedfs.module';
import { PdfExtractionProcessor } from './pdf-extraction.processor';
import { PdfExtractionQueueService } from './pdf-extraction-queue.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'pdf-extraction' }),
    TikaModule,
    SeaweedfsModule,
  ],
  providers: [PdfExtractionQueueService, PdfExtractionProcessor],
  exports: [PdfExtractionQueueService],
})
export class PdfExtractionQueueModule {}
