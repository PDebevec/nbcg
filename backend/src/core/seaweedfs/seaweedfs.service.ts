import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import type { ReadStream } from 'fs';

interface AssignResponse {
  fid: string;
}

@Injectable()
export class SeaweedfsService {
  private readonly logger = new Logger(SeaweedfsService.name);
  private readonly masterUrl = process.env.SEAWEEDFS_MASTER ?? 'http://seaweedfs-master:9333';
  private readonly volumeUrl = process.env.SEAWEEDFS_VOLUME ?? 'http://seaweedfs-volume:8080';

  async upload(stream: ReadStream, filename: string, mimeType: string, sizeBytes: number): Promise<string> {
    const assign = await fetch(`${this.masterUrl}/dir/assign`);
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
    });
    if (!upload.ok) {
      const body = await upload.text().catch(() => '(unreadable)');
      this.logger.error(`SeaweedFS upload failed: HTTP ${upload.status} — ${body}`);
      throw new InternalServerErrorException('SeaweedFS upload failed');
    }

    return fid;
  }

  async download(fid: string): Promise<Buffer> {
    const res = await fetch(`${this.volumeUrl}/${fid}`);
    if (!res.ok) {
      throw new InternalServerErrorException(`SeaweedFS download failed for fid ${fid}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }

  async delete(fid: string): Promise<void> {
    const res = await fetch(`${this.volumeUrl}/${fid}`, { method: 'DELETE' });
    if (!res.ok) {
      throw new InternalServerErrorException(`SeaweedFS delete failed for fid ${fid}`);
    }
  }
}
