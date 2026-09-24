import { searchVocabulary } from './vocabulary-search';

const codes = (name: string, q?: string, limit = 5) =>
  searchVocabulary(name, q, limit)!.suggestions.map((s) => s.value.code);

describe('searchVocabulary', () => {
  it('finds Montenegrin by its Montenegrin name, code or English name', () => {
    expect(codes('language', 'crn')).toContain('cnr');
    expect(codes('language', 'cnr')[0]).toBe('cnr');
    expect(codes('language', 'montenegrin')[0]).toBe('cnr');
  });

  it('is accent- and case-insensitive', () => {
    expect(codes('language', 'JUZNOALTAJSKI')).toEqual(['alt']);
  });

  it('puts an exact code before prefix and substring matches', () => {
    const result = codes('language', 'eng', 10);
    expect(result[0]).toBe('eng');
  });

  it('ranks prefix matches before substring matches', () => {
    // "slov…" starts Slovak/Slovenian; other names may only contain it.
    const isPrefix = searchVocabulary('language', 'slov', 50)!.suggestions.map(({ value }) =>
      [String(value.code), value.en, value.cnr].some((t) => t.toLowerCase().startsWith('slov')),
    );
    const firstSubstring = isPrefix.indexOf(false);
    const lastPrefix = isPrefix.lastIndexOf(true);
    expect(lastPrefix).toBeGreaterThanOrEqual(0);
    if (firstSubstring !== -1) expect(firstSubstring).toBeGreaterThan(lastPrefix);
  });

  it('respects limit', () => {
    expect(codes('language', 'a', 2)).toHaveLength(2);
  });

  it('returns whole code objects, including numeric codes', () => {
    expect(searchVocabulary('collectionType', 'serial', 5)!.suggestions).toEqual([
      { value: { code: 4, en: 'Serial collection', cnr: 'Serijska zbirka' } },
    ]);
    expect(codes('collectionType', '3')).toEqual([3]);
  });

  it('lists the first values when q is empty', () => {
    expect(codes('materialType', undefined, 3)).toEqual(['am', 'as', 'aa']);
  });

  it('knows every schema vocabulary and nothing else', () => {
    expect(searchVocabulary('relator', 'aut', 5)!.field).toBe('relator');
    expect(searchVocabulary('nope', 'x', 5)).toBeNull();
    expect(searchVocabulary('toString', 'x', 5)).toBeNull();
    expect(searchVocabulary('__proto__', 'x', 5)).toBeNull();
  });
});
