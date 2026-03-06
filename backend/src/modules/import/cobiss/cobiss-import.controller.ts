import { Controller, Get, Query, Param } from '@nestjs/common';
import { ImportQueueService } from '../shared/import-queue.service';

@Controller('import')
export class CobissImportController {
  constructor(private readonly importQueue: ImportQueueService) {}

  @Get('cobiss')
  async importCobiss(@Query('id') id: string) {
    const ids = id?.split(',').map((v) => v.trim()).filter(Boolean) ?? [];

    if (ids.length === 0) {
      return { error: 'No COBISS ids provided' };
    }

    // Immediately returns — heavy lifting happens in the background
    return this.importQueue.enqueue('cobiss', ids);
    // → { jobId: "42" }
  }
}