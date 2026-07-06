import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { PdfExtractionJobData } from './pdf-extraction-job.types';

@Injectable()
export class PdfExtractionQueueService {
  constructor(@InjectQueue('pdf-extraction') private readonly queue: Queue) {}

  async enqueue(data: PdfExtractionJobData): Promise<void> {
    await this.queue.add('extract-text', data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { age: 60 * 60 * 24 },
      removeOnFail: { age: 60 * 60 * 24 * 7 },
    });
  }
}
