import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as os from 'os';
import type { Response } from 'express';
import { GetPrincipal } from '../../core/auth/get-principal.decorator';
import { ResourceAccessService } from '../../core/auth/resource-access.service';
import type { Principal } from '../../core/auth/principal.type';
import { FilesService } from './files.service';
import { ReextractDto, ReplaceFileDto, SetTextDto, UploadFilesDto } from './dto/upload-files.dto';

/**
 * Build an RFC 6266 Content-Disposition value.
 *
 * `encodeURIComponent` alone is not enough: it leaves `!'()*` raw, and `'` is
 * the delimiter inside an RFC 5987 ext-value, so a filename like `Don't.pdf`
 * would produce a header the client parses wrongly. Those are escaped here.
 * A plain ASCII `filename=` is emitted first as a fallback for old clients.
 */
function contentDisposition(disposition: 'inline' | 'attachment', filename: string): string {
  const encoded = encodeURIComponent(filename).replace(
    /['()!*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  );
  // Non-ASCII stripped rather than transliterated — this value is only ever the
  // fallback, and `filename*` carries the real name for anything modern.
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

@Controller('files')
export class FilesController {
  constructor(
    private readonly filesService: FilesService,
    private readonly access: ResourceAccessService,
  ) {}

  @Post('upload/:itemId')
  @UseInterceptors(FilesInterceptor('files', 10, {
    storage: diskStorage({ destination: os.tmpdir() }),
    limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2 GB hard cap
    // Multer defaults this to latin1, which turns a Cyrillic filename into
    // mojibake. That also breaks the extractedTexts lookup below, since it is
    // keyed by filename — the text would be dropped on an otherwise-201 upload.
    defParamCharset: 'utf8',
  }))
  async upload(
    @GetPrincipal() principal: Principal,
    @Param('itemId') itemId: string,
    @UploadedFiles() files: Express.Multer.File[],
    @Body() body: UploadFilesDto,
  ) {
    // Multer has already written temp files to disk — clean them up if the request is rejected
    try {
      await this.access.assertCanManage(principal, itemId);
    } catch (err) {
      await this.filesService.cleanupTempFiles(files);
      throw err;
    }
    return this.filesService.upload(itemId, files, body.doOCR ?? false, body.extractedTexts, body.role);
  }

  @Put(':fileId')
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({ destination: os.tmpdir() }),
    limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2 GB hard cap
    defParamCharset: 'utf8', // see the note on the upload endpoint above
  }))
  async replace(
    @GetPrincipal() principal: Principal,
    @Param('fileId') fileId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: ReplaceFileDto,
  ) {
    try {
      await this.access.assertCanManageFile(principal, fileId);
    } catch (err) {
      await this.filesService.cleanupTempFiles(file ? [file] : undefined);
      throw err;
    }
    if (!file) {
      throw new BadRequestException('No file provided — send multipart form data with a "file" field');
    }
    return this.filesService.replace(fileId, file, body.doOCR ?? false, body.extractedText);
  }

  @Put(':fileId/text')
  async setText(
    @GetPrincipal() principal: Principal,
    @Param('fileId') fileId: string,
    @Body() body: SetTextDto,
  ) {
    await this.access.assertCanManageFile(principal, fileId);
    return this.filesService.setText(fileId, body.text);
  }

  @Post(':fileId/extract')
  async reextract(
    @GetPrincipal() principal: Principal,
    @Param('fileId') fileId: string,
    @Body() body: ReextractDto,
  ) {
    await this.access.assertCanManageFile(principal, fileId);
    return this.filesService.reextract(fileId, body.doOCR ?? true);
  }

  @Get(':itemId')
  async list(@GetPrincipal() principal: Principal, @Param('itemId') itemId: string) {
    await this.access.assertCanView(principal, itemId);
    return this.filesService.listByItem(itemId);
  }

  @Get(':fileId/download')
  async download(
    @GetPrincipal() principal: Principal,
    @Param('fileId') fileId: string,
    @Res() res: Response,
    @Query('inline') inline?: string,
  ) {
    await this.access.assertCanViewFile(principal, fileId);
    const { stream, contentLength, mimeType, filename } = await this.filesService.download(fileId);
    const disposition = inline === '1' ? 'inline' : 'attachment';
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', contentDisposition(disposition, filename));
    if (contentLength) res.setHeader('Content-Length', contentLength);
    stream.on('error', () => {
      // Storage stream broke mid-transfer — nothing to do but terminate the response.
      res.destroy();
    });
    // If the client disconnects, stop pulling from storage.
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  }

  @Delete(':fileId')
  async delete(@GetPrincipal() principal: Principal, @Param('fileId') fileId: string) {
    await this.access.assertCanManageFile(principal, fileId);
    return this.filesService.delete(fileId);
  }
}
