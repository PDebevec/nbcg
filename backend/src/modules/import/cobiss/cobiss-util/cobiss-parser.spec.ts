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

describe('215/a → extent (metadata schema v2)', () => {
  const withType = (recordType: string, level: string, extent: string) =>
    recordXmlToJson(record(field('001', ['b', recordType], ['c', level]) + field('215', ['a', extent])));

  it('reads pages for a book and keeps 215/a as written', () => {
    const json = withType('a', 'm', 'XII, 253 str.');
    expect(json.extent).toEqual({ value: 253, unit: 'pages' });
    expect(json.physicalDescription).toBe('XII, 253 str.');
  });

  it.each([
    ['a', '253 str.', { value: 253, unit: 'pages' }],
    ['a', '[4], 120, [8] str.', { value: 120, unit: 'pages' }],
    ['a', '[16] str.', { value: 16, unit: 'pages' }],
    ['a', '1 knjiga (253 str.)', { value: 253, unit: 'pages' }],
    ['c', '24 str.', { value: 24, unit: 'pages' }],
    ['g', '1 video disk (95 min)', { value: 95, unit: 'minutes' }],
    ['g', '1 video disk (1 h 35 min)', { value: 95, unit: 'minutes' }],
    ['j', '1 CD (ca 60 min)', { value: 60, unit: 'minutes' }],
    ['i', '1 audio kaseta (2 sata)', { value: 120, unit: 'minutes' }],
    ['e', '1 zemljovid', { value: 1, unit: 'sheets' }],
    ['e', '1 geogr. karta', { value: 1, unit: 'sheets' }],
    ['e', '1 atlas (24 lista)', { value: 24, unit: 'sheets' }],
    ['k', '1 fotografija', { value: 1, unit: 'sheets' }],
  ])('%s: "%s"', (recordType, text, expected) => {
    expect(withType(recordType, 'm', text).extent).toEqual(expected);
  });

  it.each([
    ['a', '2 sv.', 'volumes, not pages'],
    ['a', '1 zemljovid', 'no page count in a book'],
    ['g', '253 str.', 'pages on a video'],
    ['e', '120 str.', 'pages on a map'],
    ['j', '1 CD', 'no duration'],
    ['l', '1 CD-ROM', 'an electronic resource has no extent'],
    ['r', '1 predmet', 'nor has a 3-D object'],
  ])('%s: "%s" → none (%s)', (recordType, text) => {
    expect(withType(recordType, 'm', text)).not.toHaveProperty('extent');
  });

  it('needs the record type to know the unit', () => {
    expect(recordXmlToJson(record(field('215', ['a', '253 str.'])))).not.toHaveProperty('extent');
  });
});
