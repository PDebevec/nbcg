import { Controller, Get, Param } from '@nestjs/common';
import { ImportQueueService } from './shared/import-queue.service';

@Controller('import')
export class ImportController {
  constructor(private readonly importQueue: ImportQueueService) {}

  @Get('jobs/:jobId')
  getJobStatus(@Param('jobId') jobId: string) {
    return this.importQueue.getStatus(jobId);
  }
}