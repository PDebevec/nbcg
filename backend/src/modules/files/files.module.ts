import { Module } from '@nestjs/common';
import { SeaweedfsModule } from '../../core/seaweedfs/seaweedfs.module';
import { PdfExtractionQueueModule } from './queue/pdf-extraction-queue.module';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';

@Module({
  imports: [SeaweedfsModule, PdfExtractionQueueModule],
  controllers: [FilesController],
  providers: [FilesService],
  exports: [FilesService],
})
export class FilesModule {}
