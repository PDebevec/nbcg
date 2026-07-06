import { Injectable } from '@nestjs/common';
import { Client } from '@opensearch-project/opensearch';

@Injectable()
export class OpenSearchService {
  readonly client: Client;

  constructor() {
    this.client = new Client({
      node: process.env.OPENSEARCH_URL ?? 'http://localhost:9200',
    });
  }

  async search(index: string | string[], body: Record<string, unknown>) {
    const response = await this.client.search({ index, body });
    return response.body;
  }

  async getById(id: string, indices = ['records', 'drafts']): Promise<{ index: string; source: Record<string, unknown> } | null> {
    for (const index of indices) {
      try {
        // extractedText can be megabytes per attachment — never return it to clients
        const response = await this.client.get({
          index,
          id,
          _source_excludes: ['file_attachments.extractedText'],
        });
        if (response.body.found) {
          return { index, source: response.body._source as Record<string, unknown> };
        }
      } catch {
        // not found in this index — try next
      }
    }
    return null;
  }
}
