import { Controller, Get, Query } from '@nestjs/common';
import { CobissImportService } from './cobiss-import.service';

@Controller('import/cobiss')
export class CobissImportController {
  constructor(private readonly service: CobissImportService) {}

  @Get()
  async importCobiss(@Query('id') id: string) {
    const ids = id?.split(',').map((v) => v.trim()).filter(Boolean) ?? [];

    if (ids.length === 0) {
      return {
        error: 'No COBISS ids provided',
      };
    }

    return this.service.importByIds(ids);
  }
}