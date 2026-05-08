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
}
