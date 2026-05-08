import { Injectable, NotFoundException } from '@nestjs/common';
import { FileType } from '../../../generated/prisma/enums';
import { PrismaService } from '../../core/prisma/prisma.service';
import { SeaweedfsService } from '../../core/seaweedfs/seaweedfs.service';

const MIME_TO_FILE_TYPE: Record<string, FileType> = {
  'image/jpeg': FileType.IMAGE,
  'image/png': FileType.IMAGE,
  'application/pdf': FileType.PDF,
};

@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly seaweedfs: SeaweedfsService,
  ) {}

  async upload(itemId: string, files: Express.Multer.File[]) {
    const itemType = await this.resolveItem(itemId);

    const created = await Promise.all(
      (files ?? []).map(async (file) => {
        const fileType = MIME_TO_FILE_TYPE[file.mimetype] ?? FileType.UNKNOWN;
        const fid = await this.seaweedfs.upload(file.buffer, file.originalname, file.mimetype);

        return this.prisma.fileAttachment.create({
          data: {
            ...(itemType === 'draft' ? { draft_id: itemId } : { record_id: itemId }),
            fileType,
            originalFid: fid,
            filename: file.originalname,
            mimeType: file.mimetype,
            sizeBytes: file.size,
          },
        });
      }),
    );

    // PDF queue will be wired here in step 5 (PdfExtractionModule)

    return created;
  }

  async listByItem(itemId: string) {
    await this.resolveItem(itemId);
    return this.prisma.fileAttachment.findMany({
      where: { OR: [{ draft_id: itemId }, { record_id: itemId }] },
    });
  }

  async download(fileId: string): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
    const file = await this.prisma.fileAttachment.findUnique({ where: { id: fileId } });
    if (!file) throw new NotFoundException(`File not found: ${fileId}`);

    const buffer = await this.seaweedfs.download(file.originalFid);
    return { buffer, mimeType: file.mimeType, filename: file.filename };
  }

  async delete(fileId: string): Promise<void> {
    const file = await this.prisma.fileAttachment.findUnique({ where: { id: fileId } });
    if (!file) throw new NotFoundException(`File not found: ${fileId}`);

    await this.seaweedfs.delete(file.originalFid);
    await this.prisma.fileAttachment.delete({ where: { id: fileId } });

    // OpenSearch file_texts cleanup will be added in step 5 (SearchModule) — best-effort, non-throwing
  }

  private async resolveItem(itemId: string): Promise<'draft' | 'record'> {
    const [draft, record] = await Promise.all([
      this.prisma.draft.findUnique({ where: { id: itemId }, select: { id: true } }),
      this.prisma.record.findUnique({ where: { id: itemId }, select: { id: true } }),
    ]);
    if (!draft && !record) throw new NotFoundException(`Item not found: ${itemId}`);
    return draft ? 'draft' : 'record';
  }
}
