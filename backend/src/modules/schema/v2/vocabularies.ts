import {
  getAllBibliographicLevelCodes,
  getAllBiographyCodes,
  getAllContentTypeCodes,
  getAllCountryCodes,
  getAllExtentUnitCodes,
  getAllIllustrationCodes,
  getAllLanguageCodes,
  getAllLiteraryFormCodes,
  getAllMaterialTypeCodes,
  getAllRecordTypeCodes,
  getAllRelatorCodes,
} from '../../import/cobiss/cobiss-util/cobiss-code-map';
import type { StoreAs, Vocabulary, VocabularyValue } from './schema-v2.types';

/** A list longer than this is searched (`/search/vocabularies/:name`), not inlined. */
export const INLINE_VOCABULARY_MAX = 50;

export interface VocabularyDef {
  values: VocabularyValue[];
  /** What a field using this list stores unless it says otherwise. */
  storeAs: StoreAs;
}

/**
 * Every closed list the v2 schema can reference, by name. One list is shared by
 * every field that uses it — the three language fields point at one `language`.
 */
export const VOCABULARIES: Record<string, VocabularyDef> = {
  materialType:       { values: getAllMaterialTypeCodes(), storeAs: 'resolvedCode' },
  recordType:         { values: getAllRecordTypeCodes(), storeAs: 'resolvedCode' },
  bibliographicLevel: { values: getAllBibliographicLevelCodes(), storeAs: 'resolvedCode' },
  language:           { values: getAllLanguageCodes(), storeAs: 'resolvedCode' },
  country:            { values: getAllCountryCodes(), storeAs: 'resolvedCode' },
  illustration:       { values: getAllIllustrationCodes(), storeAs: 'resolvedCode' },
  contentType:        { values: getAllContentTypeCodes(), storeAs: 'resolvedCode' },
  literaryForm:       { values: getAllLiteraryFormCodes(), storeAs: 'resolvedCode' },
  biography:          { values: getAllBiographyCodes(), storeAs: 'resolvedCode' },
  relator:            { values: getAllRelatorCodes(), storeAs: 'resolvedCode' },
  extentUnit:         { values: getAllExtentUnitCodes(), storeAs: 'code' },
  responsibility: {
    storeAs: 'code',
    values: [
      { code: 'primary', en: 'Primary', cnr: 'Primarna' },
      { code: 'alternative', en: 'Alternative', cnr: 'Alternativna' },
      { code: 'secondary', en: 'Secondary', cnr: 'Sekundarna' },
    ],
  },
  // `metadata.collectionType` on the item. 2 and 5+ are unused today.
  collectionType: {
    storeAs: 'code',
    values: [
      { code: 0, en: 'Not a collection', cnr: 'Nije zbirka' },
      { code: 1, en: 'Primary collection', cnr: 'Primarna zbirka' },
      { code: 3, en: 'Collection', cnr: 'Zbirka' },
      { code: 4, en: 'Serial collection', cnr: 'Serijska zbirka' },
    ],
  },
};

/** The API path that searches a vocabulary — relative to `/api`, like every schema path. */
export function vocabularySearchPath(name: string): string {
  return `/search/vocabularies/${name}?limit=5`;
}

/** How a vocabulary appears in the schema response: whole, or as a search spec. */
export function toSchemaVocabulary(name: string): Vocabulary {
  const { values } = VOCABULARIES[name];
  return values.length <= INLINE_VOCABULARY_MAX
    ? { size: values.length, values }
    : {
        size: values.length,
        search: { path: vocabularySearchPath(name), queryParam: 'q', minChars: 1 },
      };
}

/** Look up one value, e.g. the `pages` unit. Throws on a typo so a bad schema cannot boot. */
export function vocabularyValue(name: string, code: string | number): VocabularyValue {
  const value = VOCABULARIES[name]?.values.find((v) => v.code === code);
  if (!value) throw new Error(`Vocabulary ${name} has no code ${String(code)}`);
  return value;
}
