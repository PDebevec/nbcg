import { Body, Controller, Post } from '@nestjs/common';
import { ImportQueueService } from '../queue/import-queue.service';
import { CobissImportDto } from './dto/cobiss-import.dto';

@Controller('import')
export class CobissImportController {
  constructor(private readonly importQueue: ImportQueueService) {}

  @Post('cobiss')
  async importCobiss(@Body() dto: CobissImportDto) {
    if (!dto.ids?.length) {
      return { error: 'No COBISS ids provided' };
    }

    return this.importQueue.enqueue('cobiss', dto.ids, dto.target, dto.visibilityStatus);
  }
}
