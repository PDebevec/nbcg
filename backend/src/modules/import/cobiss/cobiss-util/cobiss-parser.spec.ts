import { recordXmlToJson } from './cobiss-parser';

const record = (datafields: string) =>
  `<?xml version="1.0" encoding="utf-8"?><record>${datafields}</record>`;

const field = (tag: string, ...subfields: Array<[string, string]>) =>
  `<datafield tag="${tag}" ind1=" " ind2=" ">${subfields
    .map(([code, value]) => `<subfield code="${code}">${value}</subfield>`)
    .join('')}</datafield>`;

describe('recordXmlToJson — metadata schema v2 fields', () => {
  it('reads 610/a from every occurrence as keywords', () => {
    const json = recordXmlToJson(
      record(field('200', ['a', 'T']) + field('610', ['a', 'Crna Gora'], ['a', 'istorija']) + field('610', ['a', 'Njegoš'])),
    );
    expect(json.keywords).toEqual(['Crna Gora', 'istorija', 'Njegoš']);
  });

  it('reads 330/a as summaryNote, joining repeated summaries', () => {
    const json = recordXmlToJson(record(field('330', ['a', 'First.']) + field('330', ['a', 'Second.'])));
    expect(json.summaryNote).toBe('First.\n\nSecond.');
  });

  it('leaves both out when the record has neither', () => {
    const json = recordXmlToJson(record(field('200', ['a', 'T'])));
    expect(json).not.toHaveProperty('keywords');
    expect(json).not.toHaveProperty('summaryNote');
  });
});
