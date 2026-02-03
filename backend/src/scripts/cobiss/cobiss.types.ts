export interface CobissFetchResult {
  contentType: string;
  rawXml: string;
  recordXml: string;
  recordJson: unknown;
}

export type Charset = 'utf-8' | string;