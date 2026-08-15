import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createReadStream } from 'fs';
import { unlink } from 'fs/promises';
import {
  ChangeAction,
  FileRole,
  FileType,
  TextExtractionStatus,
} from '../../../generated/prisma/enums';
import type { Actor } from '../../core/auth/actor.type';
import { PrismaService } from '../../core/prisma/prisma.service';
import { RevisionsService } from '../../core/revisions/revisions.service';
import { SeaweedfsService } from '../../core/seaweedfs/seaweedfs.service';

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
    private readonly revisions: RevisionsService,
  ) {}

  /** Best-effort removal of Multer temp files (e.g. when the request is rejected before upload). */
  async cleanupTempFiles(files: Express.Multer.File[] | undefined): Promise<void> {
    await Promise.all(
      (files ?? []).map((f) => (f.path ? unlink(f.path).catch(() => undefined) : undefined)),
    );
  }

  async upload(itemId: string, files: Express.Multer.File[], actor: Actor, extractedTextsJson?: string, role?: FileRole) {
    if (!files?.length) {
      throw new BadRequestException('No files provided — send multipart form data with a "files" field');
    }

    // Parse the optional extracted-texts map: { "filename.pdf": "text..." }
    let extractedTexts: Record<string, string> | undefined;
    if (extractedTextsJson) {
      try {
        extractedTexts = JSON.parse(extractedTextsJson);
        if (typeof extractedTexts !== 'object' || extractedTexts === null || Array.isArray(extractedTexts)) {
          throw new Error('not an object');
        }
      } catch {
        throw new BadRequestException('extractedTexts must be a JSON object mapping filenames to text strings');
      }

      // A key that matches no uploaded part is almost always a client bug (a
      // stale name, or a filename mangled in transit). Silently dropping the
      // text and still answering 201 hides real data loss, so reject up front —
      // before anything is written to storage, so there is nothing to roll back.
      const uploaded = new Set(files.map((f) => f.originalname));
      const unmatched = Object.keys(extractedTexts).filter((name) => !uploaded.has(name));
      if (unmatched.length > 0) {
        await this.cleanupTempFiles(files);
        throw new BadRequestException(
          `extractedTexts contains keys matching no uploaded file: ${unmatched.join(', ')}. ` +
            `Uploaded filenames: ${[...uploaded].join(', ')}`,
        );
      }
    }

    let itemType: 'draft' | 'record';
    try {
      itemType = await this.resolveItem(itemId);
    } catch (err) {
      await this.cleanupTempFiles(files);
      throw err;
    }

    const created = await Promise.all(
      files.map(async (file) => {
        const fileType = MIME_TO_FILE_TYPE[file.mimetype] ?? FileType.UNKNOWN;
        const stream = createReadStream(file.path);
        let fid: string;
        try {
          fid = await this.seaweedfs.upload(stream, file.originalname, file.mimetype, file.size);
        } finally {
          stream.destroy();
          await unlink(file.path).catch(() => undefined);
        }

        // Check if the client supplied pre-extracted text for this file
        const suppliedText = extractedTexts?.[file.originalname];
        const hasSuppliedText = suppliedText !== undefined;

        try {
          return await this.prisma.fileAttachment.create({
            data: {
              ...(itemType === 'draft' ? { draft_id: itemId } : { record_id: itemId }),
              fileType,
              ...(role ? { role } : {}),
              originalFid: fid,
              filename: file.originalname,
              mimeType: file.mimetype,
              sizeBytes: file.size,
              // If text was supplied, store it immediately and mark extraction status
              ...(hasSuppliedText ? {
                extractedText: suppliedText || null,
                textExtractionStatus: this.classifyText(suppliedText),
              } : {}),
            },
          });
        } catch (err) {
          // DB insert failed after the blob was stored — remove it so it doesn't orphan.
          await this.seaweedfs.delete(fid).catch(() => {});
          throw err;
        }
      }),
    );

    // File writes don't bump the item's version, so the revision records the
    // version the item already has. Not transactional: the blobs are stored and
    // the rows committed by now, so a history failure is logged and swallowed
    // rather than turning a successful upload into a 500.
    const version = await this.revisions.currentVersion(itemId);
    await this.revisions.recordDetached(
      created.map((f) => ({
        itemId,
        version,
        action: ChangeAction.FILE_ADDED,
        changes: [{ path: `files[${f.id}]`, before: null, after: f.filename }],
        actor,
      })),
    );

    return created;
  }

  /**
   * Replace an existing attachment's blob (and optionally its text) in place.
   * The attachment id stays stable — only the underlying file content changes.
   */
  async replace(fileId: string, file: Express.Multer.File, actor: Actor, extractedText?: string) {
    const existing = await this.prisma.fileAttachment.findUnique({ where: { id: fileId } });
    if (!existing) {
      await unlink(file.path).catch(() => undefined);
      throw new NotFoundException(`File not found: ${fileId}`);
    }

    const fileType = MIME_TO_FILE_TYPE[file.mimetype] ?? FileType.UNKNOWN;
    const stream = createReadStream(file.path);
    let fid: string;
    try {
      fid = await this.seaweedfs.upload(stream, file.originalname, file.mimetype, file.size);
    } finally {
      stream.destroy();
      await unlink(file.path).catch(() => undefined);
    }

    const hasSuppliedText = extractedText !== undefined;
    const oldFid = existing.originalFid;

    let updated;
    try {
      updated = await this.prisma.fileAttachment.update({
        where: { id: fileId },
        data: {
          originalFid: fid,
          filename: file.originalname,
          mimeType: file.mimetype,
          sizeBytes: file.size,
          fileType,
          ...(hasSuppliedText ? {
            extractedText: extractedText || null,
            textExtractionStatus: this.classifyText(extractedText),
          } : {
            // No text supplied — reset extraction status
            extractedText: null,
            textExtractionStatus: TextExtractionStatus.NOT_EXTRACTED,
          }),
        },
      });
    } catch (err) {
      // DB update failed — remove the newly uploaded blob
      await this.seaweedfs.delete(fid).catch(() => {});
      throw err;
    }

    // DB row updated — now safe to delete the old blob (orphan-safe ordering)
    await this.seaweedfs.delete(oldFid).catch(() => {});

    // Content swapped under a stable attachment id — an UPDATE on the item, not
    // an add or a remove.
    const parentId = existing.draft_id ?? existing.record_id;
    if (parentId) {
      await this.revisions.recordDetached({
        itemId: parentId,
        version: await this.revisions.currentVersion(parentId),
        action: ChangeAction.UPDATE,
        changes: [{ path: `files[${fileId}]`, before: existing.filename, after: file.originalname }],
        actor,
      });
    }

    return updated;
  }

  async listByItem(itemId: string) {
    await this.resolveItem(itemId);
    return this.prisma.fileAttachment.findMany({
      where: { OR: [{ draft_id: itemId }, { record_id: itemId }] },
      // extractedText can be megabytes — never return it in list responses
      omit: { extractedText: true },
    });
  }

  /**
   * Returns a stream so multi-GB files are never buffered in server memory.
   * `itemId` comes back too so the caller can attribute the download to the
   * parent record without a second lookup.
   */
  async download(fileId: string) {
    const file = await this.prisma.fileAttachment.findUnique({ where: { id: fileId } });
    if (!file) throw new NotFoundException(`File not found: ${fileId}`);

    const { stream, contentLength } = await this.seaweedfs.downloadStream(file.originalFid);
    return {
      stream,
      contentLength,
      mimeType: file.mimeType,
      filename: file.filename,
      itemId: file.draft_id ?? file.record_id,
    };
  }

  async delete(fileId: string, actor: Actor): Promise<void> {
    const file = await this.prisma.fileAttachment.findUnique({ where: { id: fileId } });
    if (!file) throw new NotFoundException(`File not found: ${fileId}`);

    await this.prisma.fileAttachment.delete({ where: { id: fileId } });

    const parentId = file.draft_id ?? file.record_id;
    if (parentId) {
      await this.revisions.recordDetached({
        itemId: parentId,
        version: await this.revisions.currentVersion(parentId),
        action: ChangeAction.FILE_REMOVED,
        changes: [{ path: `files[${fileId}]`, before: file.filename, after: null }],
        actor,
      });
    }

    // Delete from storage after DB commit — orphaned blob is harmless, missing DB row is not.
    // OpenSearch cleanup happens automatically via PGSync when the row is deleted.
    await this.seaweedfs.delete(file.originalFid).catch(() => {});
  }

  /**
   * Set (or replace) extracted text on an existing file attachment.
   * Useful for the archive to push OCR text after the initial upload.
   */
  async setText(fileId: string, text: string): Promise<{ updated: true }> {
    const file = await this.prisma.fileAttachment.findUnique({ where: { id: fileId } });
    if (!file) throw new NotFoundException(`File not found: ${fileId}`);

    await this.prisma.fileAttachment.update({
      where: { id: fileId },
      data: {
        extractedText: text || null,
        textExtractionStatus: this.classifyText(text),
      },
    });
    return { updated: true };
  }

  /** Classify extracted text as EXTRACTED, GARBAGE, or NO_TEXT. */
  private classifyText(text: string | undefined | null): TextExtractionStatus {
    if (!text) return TextExtractionStatus.NO_TEXT;
    if (this.looksGarbled(text)) return TextExtractionStatus.GARBAGE;
    return TextExtractionStatus.EXTRACTED;
  }

  /**
   * Detects broken font-to-Unicode mappings in embedded PDF text.
   * Two signals:
   * 1. Symbols/digits sandwiched between letters within words
   *    (e.g. "&4Н1*егпед", "(5гб(1псће", "®фгШеб")
   * 2. Latin and Cyrillic mixed within the same word
   *    (e.g. "итМГепђе" next to "Schilderung" in the same passage)
   */
  private looksGarbled(text: string): boolean {
    const words = text.slice(0, 5000).split(/\s+/).filter(w => w.length >= 3);
    if (words.length < 10) return false;

    const LATIN = /[a-zA-ZÀ-ɏ]/;
    const CYRILLIC = /[Ѐ-ӿ]/;
    // Symbols/digits that should never appear mid-word
    const SYMBOL = /[0-9*&@#$®©™§¶†‡°±×÷()\[\]|<>^~`]/;

    let suspicious = 0;
    let latinWords = 0;
    let cyrillicWords = 0;

    for (const word of words) {
      const hasLatin = LATIN.test(word);
      const hasCyrillic = CYRILLIC.test(word);

      if (hasLatin) latinWords++;
      if (hasCyrillic) cyrillicWords++;

      // Mixed scripts within a single word
      if (hasLatin && hasCyrillic) {
        suspicious++;
        continue;
      }

      // Strip leading/trailing punctuation, then check for symbols between letters
      const inner = word.replace(/^[^\p{L}\d]+|[^\p{L}\d]+$/gu, '');
      if (inner.length < 3) continue;
      if (/\p{L}/u.test(inner) && SYMBOL.test(inner) && /\p{L}.*[0-9*&@#$®©™§()\[\]|<>^~`].*\p{L}/u.test(inner)) {
        suspicious++;
      }
    }

    // Also flag if document has significant presence of both scripts (>15% each)
    // which suggests font encoding mapped Latin glyphs to Cyrillic codepoints
    const total = words.length;
    const bothScripts = latinWords / total > 0.15 && cyrillicWords / total > 0.15;

    return suspicious / total > 0.1 || bothScripts;
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
