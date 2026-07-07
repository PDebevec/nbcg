import { Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import type { ReadStream } from 'fs';
import { Readable } from 'stream';

interface AssignResponse {
  fid: string;
}

// Control-plane calls should fail fast; data transfers of multi-GB files need generous limits.
const CONTROL_TIMEOUT_MS = 10_000;
const TRANSFER_TIMEOUT_MS = 60 * 60 * 1000; // 1 h

@Injectable()
export class SeaweedfsService {
  private readonly logger = new Logger(SeaweedfsService.name);
  private readonly masterUrl = process.env.SEAWEEDFS_MASTER ?? 'http://seaweedfs-master:9333';
  private readonly volumeUrl = process.env.SEAWEEDFS_VOLUME ?? 'http://seaweedfs-volume:8080';

  async upload(stream: ReadStream, filename: string, mimeType: string, sizeBytes: number): Promise<string> {
    const assign = await fetch(`${this.masterUrl}/dir/assign`, {
      signal: AbortSignal.timeout(CONTROL_TIMEOUT_MS),
    });
    if (!assign.ok) {
      const body = await assign.text().catch(() => '(unreadable)');
      this.logger.error(`SeaweedFS assign failed: HTTP ${assign.status} — ${body}`);
      throw new InternalServerErrorException('SeaweedFS assign failed');
    }
    const { fid } = (await assign.json()) as AssignResponse;

    const upload = await fetch(`${this.volumeUrl}/${fid}`, {
      method: 'POST',
      body: stream as any,
      headers: {
        'Content-Type': mimeType,
        'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
        'Content-Length': String(sizeBytes),
      },
      // @ts-expect-error: Node 18+ fetch requires duplex for streaming request bodies
      duplex: 'half',
      signal: AbortSignal.timeout(TRANSFER_TIMEOUT_MS),
    });
    if (!upload.ok) {
      const body = await upload.text().catch(() => '(unreadable)');
      this.logger.error(`SeaweedFS upload failed: HTTP ${upload.status} — ${body}`);
      throw new InternalServerErrorException('SeaweedFS upload failed');
    }

    return fid;
  }

  async download(fid: string): Promise<Buffer> {
    const res = await this.fetchBlob(fid);
    return Buffer.from(await res.arrayBuffer());
  }

  /** Stream a blob without buffering it in memory — required for multi-GB files. */
  async downloadStream(fid: string): Promise<{ stream: Readable; contentLength?: number }> {
    const res = await this.fetchBlob(fid);
    const contentLength = Number(res.headers.get('content-length')) || undefined;
    // res.body is a web ReadableStream; convert to a Node stream for piping into Express.
    const stream = Readable.fromWeb(res.body as never);
    return { stream, contentLength };
  }

  private async fetchBlob(fid: string): Promise<globalThis.Response> {
    const res = await fetch(`${this.volumeUrl}/${fid}`, {
      signal: AbortSignal.timeout(TRANSFER_TIMEOUT_MS),
    });
    if (res.status === 404) {
      throw new NotFoundException(`File not found in storage: ${fid}`);
    }
    if (!res.ok) {
      throw new InternalServerErrorException(`SeaweedFS download failed for fid ${fid}`);
    }
    return res;
  }

  async delete(fid: string): Promise<void> {
    const res = await fetch(`${this.volumeUrl}/${fid}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(CONTROL_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new InternalServerErrorException(`SeaweedFS delete failed for fid ${fid}`);
    }
  }
}
