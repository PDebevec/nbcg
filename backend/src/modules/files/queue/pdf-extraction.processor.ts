import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from 'src/core/prisma/prisma.service';
import { SeaweedfsService } from 'src/core/seaweedfs/seaweedfs.service';
import { TikaService } from 'src/core/tika/tika.service';
import { PdfExtractionJobData } from './pdf-extraction-job.types';

const MAX_EXTRACTED_TEXT_LENGTH = 5_000_000;

@Processor('pdf-extraction', { concurrency: 2 })
export class PdfExtractionProcessor extends WorkerHost {
  private readonly logger = new Logger(PdfExtractionProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly seaweedfs: SeaweedfsService,
    private readonly tika: TikaService,
  ) {
    super();
  }

  async process(job: Job<PdfExtractionJobData>): Promise<void> {
    const { fileAttachmentId, originalFid, filename } = job.data;
    this.logger.log(`Extracting text from "${filename}" (${fileAttachmentId})`);

    const pdfBuffer = await this.seaweedfs.download(originalFid);

    let extractedText = await this.tika.extractText(
      pdfBuffer,
      filename,
      job.data.languageCodes,
      job.data.doOcr ?? false,
    );

    if (extractedText.length > MAX_EXTRACTED_TEXT_LENGTH) {
      this.logger.warn(
        `Truncating extracted text for "${filename}": ${extractedText.length} -> ${MAX_EXTRACTED_TEXT_LENGTH} chars`,
      );
      extractedText = extractedText.slice(0, MAX_EXTRACTED_TEXT_LENGTH);
    }

    await this.prisma.fileAttachment.update({
      where: { id: fileAttachmentId },
      data: {
        extractedText: extractedText || null,
        textExtracted: true,
      },
    });

    this.logger.log(`Extraction complete for "${filename}": ${extractedText.length} chars`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<PdfExtractionJobData>, err: Error) {
    const { fileAttachmentId, filename } = job.data;
    const attempts = job.opts.attempts ?? 1;
    if (job.attemptsMade >= attempts) {
      // Final attempt exhausted — textExtracted stays false; recover via POST /files/:fileId/extract
      this.logger.error(
        `Extraction permanently failed for "${filename}" (${fileAttachmentId}) after ${job.attemptsMade} attempts: ${err.message}`,
      );
    } else {
      this.logger.warn(
        `Extraction attempt ${job.attemptsMade}/${attempts} failed for "${filename}" (${fileAttachmentId}): ${err.message}`,
      );
    }
  }
}
