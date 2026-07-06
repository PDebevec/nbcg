import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Res,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as os from 'os';
import type { Response } from 'express';
import { GetPrincipal } from '../../core/auth/get-principal.decorator';
import { ResourceAccessService } from '../../core/auth/resource-access.service';
import type { Principal } from '../../core/auth/principal.type';
import { FilesService } from './files.service';
import { ReextractDto, UploadFilesDto } from './dto/upload-files.dto';

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
    return this.filesService.upload(itemId, files, body.doOCR ?? false);
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
  ) {
    await this.access.assertCanViewFile(principal, fileId);
    const { buffer, mimeType, filename } = await this.filesService.download(fileId);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.send(buffer);
  }

  @Delete(':fileId')
  async delete(@GetPrincipal() principal: Principal, @Param('fileId') fileId: string) {
    await this.access.assertCanManageFile(principal, fileId);
    return this.filesService.delete(fileId);
  }
}
