import { normalizeForMatch, rankNormalized } from '../../../shared/util/text-match';
import type { VocabularyValue } from './schema-v2.types';
import { VOCABULARIES } from './vocabularies';

export interface VocabularySearchResult {
  field: string;
  /** Same shape as `/search/suggest`, minus `count`, so a client needs one parser. */
  suggestions: Array<{ value: VocabularyValue }>;
}

interface Entry {
  value: VocabularyValue;
  haystacks: string[];
}

// Built on first use per vocabulary and kept: the lists are static code.
const index = new Map<string, Entry[]>();

function entriesOf(name: string): Entry[] {
  let entries = index.get(name);
  if (!entries) {
    entries = VOCABULARIES[name].values.map((value) => ({
      value,
      haystacks: [String(value.code), value.en, value.cnr].map(normalizeForMatch),
    }));
    index.set(name, entries);
  }
  return entries;
}

/**
 * Search a controlled vocabulary — the code list itself, not OpenSearch, so a
 * language nobody has used yet can still be picked. Matches `code`, `en` and
 * `cnr`, accent- and case-insensitively: exact first, then prefix, then
 * substring, registry order within each. `null` for an unknown vocabulary.
 */
export function searchVocabulary(
  name: string,
  q: string | undefined,
  limit: number,
): VocabularySearchResult | null {
  if (!Object.hasOwn(VOCABULARIES, name)) return null;
  const ranked = rankNormalized(entriesOf(name), q ? normalizeForMatch(q) : '', (e) => e.haystacks, limit);
  return { field: name, suggestions: ranked.map((e) => ({ value: e.value })) };
}
