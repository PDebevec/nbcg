import { Injectable, InternalServerErrorException } from '@nestjs/common';

interface AssignResponse {
  fid: string;
}

@Injectable()
export class SeaweedfsService {
  private readonly masterUrl = process.env.SEAWEEDFS_MASTER ?? 'http://seaweedfs-master:9333';
  private readonly volumeUrl = process.env.SEAWEEDFS_VOLUME ?? 'http://seaweedfs-volume:8080';

  async upload(buffer: Buffer, filename: string, mimeType: string): Promise<string> {
    const assign = await fetch(`${this.masterUrl}/dir/assign`);
    if (!assign.ok) {
      throw new InternalServerErrorException('SeaweedFS assign failed');
    }
    const { fid } = (await assign.json()) as AssignResponse;

    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(buffer)], { type: mimeType }), filename);

    const upload = await fetch(`${this.volumeUrl}/${fid}`, { method: 'POST', body: form });
    if (!upload.ok) {
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
