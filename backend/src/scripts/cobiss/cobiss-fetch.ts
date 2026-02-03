import { extractFirstRecordXml, recordXmlToJson } from './cobiss-parser';
import { CobissFetchResult } from './cobiss.types';

const COBISS_ENDPOINT =
  'https://ws.cobiss.net/sru_rest/search/COBCG';

async function safeFetch(url: string): Promise<{ contentType: string; body: string } | null> {
  try {
    const res = await fetch(url);

    if (!res.ok) {
      console.error('COBISS fetch failed:', res.status, res.statusText);
      return null;
    }

    return {
      contentType: res.headers.get('content-type') ?? 'application/octet-stream',
      body: await res.text(),
    };
  } catch (err) {
    console.error('Fetch error:', err);
    return null;
  }
}

export async function fetchCobissRecord(
  cobissId: number | string,
): Promise<CobissFetchResult | null> {
  const url =
    `${COBISS_ENDPOINT}?query=+ID = ${cobissId}` +
    '&operation=searchRetrieve' +
    '&recordSchema=info:srw/schema/1/comarc' +
    '&recordPacking=XML' +
    '&availableDBs=COBCG' +
    '&x-info-2-auth1.0-authenticationToken=1638350850';

  const response = await safeFetch(url);
  if (!response) return null;

  const recordXml = extractFirstRecordXml(response.body);
  if (!recordXml) return null;

  const recordJson = recordXmlToJson(recordXml);

  return {
    contentType: response.contentType,
    rawXml: response.body,
    recordXml,
    recordJson,
  };
}
