import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createReadStream } from 'fs';
import { unlink } from 'fs/promises';
import { FileType } from '../../../generated/prisma/enums';
import { PrismaService } from '../../core/prisma/prisma.service';
import { SeaweedfsService } from '../../core/seaweedfs/seaweedfs.service';
import { PdfExtractionQueueService } from './queue/pdf-extraction-queue.service';

const MIME_TO_FILE_TYPE: Record<string, FileType> = {
  'image/jpeg': FileType.IMAGE,
  'image/png': FileType.IMAGE,
  'application/pdf': FileType.PDF,
};

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly seaweedfs: SeaweedfsService,
    private readonly pdfQueue: PdfExtractionQueueService,
  ) {}

  /** Best-effort removal of Multer temp files (e.g. when the request is rejected before upload). */
  async cleanupTempFiles(files: Express.Multer.File[] | undefined): Promise<void> {
    await Promise.all(
      (files ?? []).map((f) => (f.path ? unlink(f.path).catch(() => undefined) : undefined)),
    );
  }

  async upload(itemId: string, files: Express.Multer.File[], doOcr = false) {
    let itemType: 'draft' | 'record';
    try {
      itemType = await this.resolveItem(itemId);
    } catch (err) {
      await this.cleanupTempFiles(files);
      throw err;
    }

    const created = await Promise.all(
      (files ?? []).map(async (file) => {
        const fileType = MIME_TO_FILE_TYPE[file.mimetype] ?? FileType.UNKNOWN;
        const stream = createReadStream(file.path);
        let fid: string;
        try {
          fid = await this.seaweedfs.upload(stream, file.originalname, file.mimetype, file.size);
        } finally {
          stream.destroy();
          await unlink(file.path).catch(() => undefined);
        }

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

    // Best-effort: files are already stored at this point, so a queue failure
    // (e.g. Redis down) must not fail the request — extraction can be
    // re-triggered later via POST /files/:fileId/extract.
    const pdfs = created.filter((f) => f.mimeType === 'application/pdf');
    if (pdfs.length > 0) {
      try {
        const languageCodes = await this.getItemLanguageCodes(itemId, itemType);
        for (const file of pdfs) {
          await this.pdfQueue.enqueue({
            fileAttachmentId: file.id,
            originalFid: file.originalFid,
            filename: file.filename,
            languageCodes,
            doOcr,
          });
        }
      } catch (err) {
        this.logger.error(
          `Failed to enqueue PDF extraction for item ${itemId} — upload succeeded, extraction must be re-triggered`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }

    return created;
  }

  /** Re-enqueue text extraction for an already-uploaded PDF attachment. Defaults to OCR — that's what the endpoint is for. */
  async reextract(fileId: string, doOcr = true): Promise<{ enqueued: true }> {
    const file = await this.prisma.fileAttachment.findUnique({ where: { id: fileId } });
    if (!file) throw new NotFoundException(`File not found: ${fileId}`);
    if (file.mimeType !== 'application/pdf') {
      throw new BadRequestException(`Text extraction is only supported for PDFs, got ${file.mimeType}`);
    }

    const itemId = file.draft_id ?? file.record_id;
    const languageCodes = itemId
      ? await this.getItemLanguageCodes(itemId, file.draft_id ? 'draft' : 'record')
      : [];

    await this.pdfQueue.enqueue({
      fileAttachmentId: file.id,
      originalFid: file.originalFid,
      filename: file.filename,
      languageCodes,
      doOcr,
    });
    return { enqueued: true };
  }

  async listByItem(itemId: string) {
    await this.resolveItem(itemId);
    return this.prisma.fileAttachment.findMany({
      where: { OR: [{ draft_id: itemId }, { record_id: itemId }] },
      // extractedText can be megabytes — never return it in list responses
      omit: { extractedText: true },
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

    await this.prisma.fileAttachment.delete({ where: { id: fileId } });
    // Delete from storage after DB commit — orphaned blob is harmless, missing DB row is not.
    await this.seaweedfs.delete(file.originalFid).catch(() => {});

    // OpenSearch file_texts cleanup will be added in step 5 (SearchModule) — best-effort, non-throwing
  }

  private async getItemLanguageCodes(itemId: string, itemType: 'draft' | 'record'): Promise<string[]> {
    const item = itemType === 'draft'
      ? await this.prisma.draft.findUnique({ where: { id: itemId }, select: { metadata: true } })
      : await this.prisma.record.findUnique({ where: { id: itemId }, select: { metadata: true } });

    const metadata = item?.metadata as Record<string, unknown> | null;
    const languages = metadata?.language as Array<{ code?: string }> | undefined;
    if (!languages?.length) return [];

    return languages.map(l => l.code).filter((c): c is string => !!c);
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
