import {
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
import type { Response } from 'express';
import { FilesService } from './files.service';

@Controller('files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post('upload/:itemId')
  @UseInterceptors(FilesInterceptor('files'))
  upload(@Param('itemId') itemId: string, @UploadedFiles() files: Express.Multer.File[]) {
    return this.filesService.upload(itemId, files);
  }

  @Get(':itemId')
  list(@Param('itemId') itemId: string) {
    return this.filesService.listByItem(itemId);
  }

  @Get(':fileId/download')
  async download(@Param('fileId') fileId: string, @Res() res: Response) {
    const { buffer, mimeType, filename } = await this.filesService.download(fileId);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.send(buffer);
  }

  @Delete(':fileId')
  delete(@Param('fileId') fileId: string) {
    return this.filesService.delete(fileId);
  }
}
