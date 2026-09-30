import { ValidationPipe } from '@nestjs/common';
import { SearchQueryDto } from './dto/search-query.dto';
import { buildFilterClauses, FILTER_FIELDS, filterParams, type FilterValue } from './filter-fields';

/** A valid raw value per format — a new `FilterValue` needs one here. */
const SAMPLE: Record<FilterValue, string> = { string: 'x', integer: '1', year: '1990' };

describe('filter registry', () => {
  it('declares every filter param on SearchQueryDto, so the ValidationPipe keeps it', async () => {
    // The options main.ts uses: whitelist strips undeclared params without an error
    const pipe = new ValidationPipe({ whitelist: true, transform: true });
    const query = Object.fromEntries(filterParams().map((p) => [p, '1']));
    const dto = await pipe.transform(query, { type: 'query', metatype: SearchQueryDto });
    expect(filterParams().filter((p) => !(p in dto))).toEqual([]);
  });

  it('reads each param in one filter only', () => {
    const params = filterParams();
    expect(params.filter((p, i) => params.indexOf(p) !== i)).toEqual([]);
  });

  it.each(Object.entries(FILTER_FIELDS))('%s builds one clause on its path', (name, field) => {
    const sample = SAMPLE[field.value ?? 'string'];
    const clauses = buildFilterClauses(field.kind === 'range' ? { [field.params.from]: sample } : { [name]: sample });
    expect(clauses).toHaveLength(1);
    expect(JSON.stringify(clauses[0])).toContain(`"${field.path}"`);
  });

  it('builds nothing for missing or blank values', () => {
    expect(buildFilterClauses({})).toEqual([]);
    expect(buildFilterClauses({ collectionType: '', isbn: '  ', language: ' , ,', yearFrom: '' })).toEqual([]);
  });

  it('trims list values and skips blanks between commas', () => {
    expect(buildFilterClauses({ language: ' Slovenian , ,English ' })).toEqual([
      { terms: { 'metadata.language.en.keyword': ['Slovenian', 'English'] } },
    ]);
  });

  it('keeps registry order when several filters are given', () => {
    const clauses = buildFilterClauses({ isbn: '978-86-7', collectionType: '4' });
    expect(clauses).toEqual([
      { terms: { 'metadata.collectionType': [4] } },
      { term: { 'metadata.isbn.normalized': '978-86-7' } },
    ]);
  });

  it('accepts a range whose ends are equal', () => {
    expect(buildFilterClauses({ yearFrom: '1990', yearTo: '1990' })).toEqual([
      { range: { 'metadata.publication.year.years': { gte: '1990', lte: '1990' } } },
    ]);
  });

  it.each([
    ['>0', { gt: 0 }],
    ['>=1', { gte: 1 }],
    ['<5', { lt: 5 }],
    ['<=4', { lte: 4 }],
    ['> 0', { gt: 0 }],
  ])('turns collectionType=%s into a range', (raw, range) => {
    expect(buildFilterClauses({ collectionType: raw })).toEqual([{ range: { 'metadata.collectionType': range } }]);
  });

  it('rejects a comparison inside a list, without an operand, or on a format with no order', () => {
    expect(() => buildFilterClauses({ collectionType: '>0,1' })).toThrow('a comparison stands alone');
    expect(() => buildFilterClauses({ collectionType: '1,<=3' })).toThrow('a comparison stands alone');
    expect(() => buildFilterClauses({ collectionType: '>=' })).toThrow('expected a whole number after >=');
    expect(() => buildFilterClauses({ collectionType: '>x' })).toThrow('Invalid collectionType "x"');
    expect(() => buildFilterClauses({ language: '>English' })).toThrow('text cannot be compared');
  });

  it('names the param and the value that did not parse', () => {
    expect(() => buildFilterClauses({ yearTo: '20x0' })).toThrow('Invalid yearTo "20x0": expected a 4-digit year (YYYY)');
    expect(() => buildFilterClauses({ collectionType: '1,3.5' })).toThrow(
      'Invalid collectionType "3.5": expected a whole number',
    );
  });
});
