import { Injectable } from '@nestjs/common';
import { fetchCobissRecord } from 'src/shared/cobiss/cobiss-fetch';
import { DomainRecord } from 'src/shared/cobiss/cobiss.types';

@Injectable()
export class CobissImportService {
  async importByIds(ids: string[]) {
    const timestamp = new Date().toISOString();
    const results: { id: string; record?: DomainRecord | null }[] = [];

    for (const id of ids) {
      const record = await fetchCobissRecord(id);

      console.log('COBISS IMPORT', {
        timestamp,
        id,
        success: Boolean(record),
      });

      results.push({ id, record });
    }

    return {
      timestamp,
      results,
    };
  }
}