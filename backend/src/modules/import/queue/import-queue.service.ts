import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Queue } from 'bullmq';
import { ImportJobData, ImportJobProgress, ImportSource } from './import-job.types';

@Injectable()
export class ImportQueueService {
  constructor(@InjectQueue('import-queue') private readonly queue: Queue) {}

  async enqueue(source: ImportSource, ids: string[]): Promise<{ jobId: string }> {
    const job = await this.queue.add(
      source, // job name = source, lets the processor route correctly
      {
        source,
        ids,
        requestedAt: new Date().toISOString(),
      } satisfies ImportJobData,
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { age: 60 * 60 * 24 }, // keep 24h
        removeOnFail: { age: 60 * 60 * 24 * 7 },
      },
    );

    return { jobId: String(job.id) };
  }

  async getStatus(jobId: string) {
    const job = await this.queue.getJob(jobId);
    if (!job) throw new NotFoundException(`Job ${jobId} not found`);

    const state = await job.getState();
    const progress = job.progress as ImportJobProgress | undefined;

    return {
      jobId,
      source: (job.data as ImportJobData).source,
      state,           // 'waiting' | 'active' | 'completed' | 'failed' | 'delayed'
      requestedAt: (job.data as ImportJobData).requestedAt,
      progress: progress ?? null,
      failedReason: job.failedReason ?? null,
      finishedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
    };
  }
}