import { Controller, Get, Header, Query, Req, Res } from '@nestjs/common';
import { createHash } from 'crypto';
import type { Request, Response } from 'express';
import { RecordSchemaQueryDto } from './dto/record-schema-query.dto';
import { SchemaService } from './schema.service';

@Controller('schema')
export class SchemaController {
  private etagCache = new Map<string, { etag: string; body: object }>();

  constructor(private readonly schemaService: SchemaService) {}

  @Get('record')
  @Header('Cache-Control', 'public, max-age=86400')
  getRecordSchema(
    @Query() query: RecordSchemaQueryDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    // `level` is validated to `main` | `child` | undefined, so the cache
    // is bounded to three keys no matter what a caller sends.
    const { level } = query;
    const cacheKey = level ?? '__all__';

    if (!this.etagCache.has(cacheKey)) {
      const body = this.schemaService.getRecordSchema(level);
      const etag = `"${createHash('md5').update(JSON.stringify(body)).digest('hex')}"`;
      this.etagCache.set(cacheKey, { etag, body });
    }

    const { etag, body } = this.etagCache.get(cacheKey)!;
    res.setHeader('ETag', etag);

    if (req.headers['if-none-match'] === etag) {
      res.status(304);
      return;
    }

    return body;
  }
}
