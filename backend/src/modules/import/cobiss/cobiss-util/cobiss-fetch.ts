import "dotenv/config";
import { Logger } from '@nestjs/common';
import { extractFirstRecordXml, recordXmlToJson } from './cobiss-parser';
import { DomainRecord } from './cobiss.types';

const logger = new Logger('CobissFetch');

const COBISS_ENDPOINT =
  'https://ws.cobiss.net/sru_rest/search/COBCG';

const FETCH_TIMEOUT_MS = 30_000;

async function safeFetch(url: string): Promise<{ contentType: string; body: string } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });

    if (!res.ok) {
      logger.error(`COBISS fetch failed: ${res.status} ${res.statusText}`);
      return null;
    }

    return {
      contentType: res.headers.get('content-type') ?? 'application/octet-stream',
      body: await res.text(),
    };
  } catch (err) {
    logger.error('Fetch error:', err);
    return null;
  }
}

export async function fetchCobissRecord(
  cobissId: string,
): Promise<DomainRecord | null> {
  const url =
    `${COBISS_ENDPOINT}?query=+ID = ${cobissId}` +
    '&operation=searchRetrieve' +
    '&recordSchema=info:srw/schema/1/comarc' +
    '&recordPacking=XML' +
    '&availableDBs=COBCG' +
    `&x-info-2-auth1.0-authenticationToken=${process.env.COBISS_TOKEN}`
  ;

  const response = await safeFetch(url);
  if (!response) return null;

  const recordXml = extractFirstRecordXml(response.body);
  if (!recordXml) return null;

  const recordJson = recordXmlToJson(recordXml, cobissId);

  return recordJson;
}