import { Controller, Get, Header, Req, Res } from '@nestjs/common';
import { createHash } from 'crypto';
import type { Request, Response } from 'express';
import { SchemaService } from './schema.service';

// v1 (`GET /schema/record?level=main|child`) was removed on 2026-09-26 (schema
// v2 B7), once the archive app ran on v2.
@Controller('schema')
export class SchemaController {
  private cached: { etag: string; body: object } | null = null;

  constructor(private readonly schemaService: SchemaService) {}

  // `no-cache` = store it, but revalidate every time (a cheap 304), so a
  // deploy never leaves a client on a stale schema.
  @Get('v2/record')
  @Header('Cache-Control', 'no-cache')
  getRecordSchemaV2(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    if (!this.cached) {
      const body = this.schemaService.getRecordSchemaV2();
      const etag = `"${createHash('md5').update(JSON.stringify(body)).digest('hex')}"`;
      this.cached = { etag, body };
    }

    const { etag, body } = this.cached;
    res.setHeader('ETag', etag);

    if (req.headers['if-none-match'] === etag) {
      res.status(304);
      return;
    }

    return body;
  }
}
