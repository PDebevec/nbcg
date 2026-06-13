import { Controller, Get, Param } from '@nestjs/common';
import { RequireScopes } from '../../core/auth/scopes.decorator';
import { ImportQueueService } from './queue/import-queue.service';

@Controller('import')
export class ImportController {
  constructor(private readonly importQueue: ImportQueueService) {}

  @Get('jobs/:jobId')
  @RequireScopes('import:execute')
  getJobStatus(@Param('jobId') jobId: string) {
    return this.importQueue.getStatus(jobId);
  }
}
