import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

export function extractFirstRecordXml(xml: string): string | null {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');

  const recordsNode = doc.getElementsByTagName('records')[0];
  if (!recordsNode) return null;

  const recordNode = recordsNode.getElementsByTagName('record')[0];
  if (!recordNode) return null;

  const serializer = new XMLSerializer();
  const recordXml = serializer.serializeToString(recordNode);

  return `<?xml version="1.0" encoding="utf-8"?>\n${recordXml}`;
}

/**
 * Minimal XML → JSON conversion.
 * You can replace this later with a proper COMARC parser.
 */
export function recordXmlToJson(xml: string): unknown {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');

  const fields = Array.from(doc.getElementsByTagName('*')).map((node) => ({
    tag: node.nodeName,
    value: node.textContent?.trim() ?? null,
  }));

  return { fields };
}
