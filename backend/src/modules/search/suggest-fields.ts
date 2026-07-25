/**
 * Allowlist of fields supported by the /search/suggest endpoint.
 *
 * Each entry defines how to query and aggregate OpenSearch for that field type.
 * Adding a new suggestable field is just a new entry here.
 */

export type SuggestFieldType = 'string' | 'resolvedCode' | 'author';

export interface SuggestFieldConfig {
  type: SuggestFieldType;
  /** OpenSearch field path (under metadata.*) to match text against */
  matchPath: string;
  /** Path to the .keyword sub-field for terms aggregation */
  keywordPath: string;
  /**
   * For resolvedCode: additional match paths (e.g. .cnr) for the prefix query,
   * and source includes for the top_hits sub-aggregation.
   */
  resolvedCode?: {
    matchPaths: string[];       // all paths to match_phrase_prefix against
    codePath: string;           // .code.keyword for the terms agg bucket key
    sourceIncludes: string[];   // fields to pull from top_hits
  };
  /**
   * For author: multi-field search and two-level aggregation config.
   */
  author?: {
    searchFields: string[];
    primaryAggField: string;    // familyName.keyword
    secondaryAggField: string;  // firstName.keyword
    sourceIncludes: string[];
  };
}

export const SUGGEST_FIELDS: Record<string, SuggestFieldConfig> = {
  // ── Simple string fields ──
  title: {
    type: 'string',
    matchPath: 'metadata.title',
    keywordPath: 'metadata.title.keyword',
  },
  subtitle: {
    type: 'string',
    matchPath: 'metadata.subtitle',
    keywordPath: 'metadata.subtitle.keyword',
  },
  seriesTitle: {
    type: 'string',
    matchPath: 'metadata.seriesTitle',
    keywordPath: 'metadata.seriesTitle.keyword',
  },
  publisher: {
    type: 'string',
    matchPath: 'metadata.publication.publisher',
    keywordPath: 'metadata.publication.publisher.keyword',
  },
  place: {
    type: 'string',
    matchPath: 'metadata.publication.place',
    keywordPath: 'metadata.publication.place.keyword',
  },
  firstResponsibility: {
    type: 'string',
    matchPath: 'metadata.firstResponsibility',
    keywordPath: 'metadata.firstResponsibility.keyword',
  },
  edition: {
    type: 'string',
    matchPath: 'metadata.edition',
    keywordPath: 'metadata.edition.keyword',
  },
  notes: {
    type: 'string',
    matchPath: 'metadata.notes',
    keywordPath: 'metadata.notes.keyword',
  },

  // ── ResolvedCode fields ──
  language: {
    type: 'resolvedCode',
    matchPath: 'metadata.language.en',
    keywordPath: 'metadata.language.code.keyword',
    resolvedCode: {
      matchPaths: ['metadata.language.en', 'metadata.language.cnr'],
      codePath: 'metadata.language.code.keyword',
      sourceIncludes: ['metadata.language'],
    },
  },
  originalLanguage: {
    type: 'resolvedCode',
    matchPath: 'metadata.originalLanguage.en',
    keywordPath: 'metadata.originalLanguage.code.keyword',
    resolvedCode: {
      matchPaths: ['metadata.originalLanguage.en', 'metadata.originalLanguage.cnr'],
      codePath: 'metadata.originalLanguage.code.keyword',
      sourceIncludes: ['metadata.originalLanguage'],
    },
  },
  materialType: {
    type: 'resolvedCode',
    matchPath: 'metadata.materialType.en',
    keywordPath: 'metadata.materialType.code.keyword',
    resolvedCode: {
      matchPaths: ['metadata.materialType.en', 'metadata.materialType.cnr'],
      codePath: 'metadata.materialType.code.keyword',
      sourceIncludes: ['metadata.materialType'],
    },
  },
  country: {
    type: 'resolvedCode',
    matchPath: 'metadata.country.en',
    keywordPath: 'metadata.country.code.keyword',
    resolvedCode: {
      matchPaths: ['metadata.country.en', 'metadata.country.cnr'],
      codePath: 'metadata.country.code.keyword',
      sourceIncludes: ['metadata.country'],
    },
  },
  recordType: {
    type: 'resolvedCode',
    matchPath: 'metadata.recordType.en',
    keywordPath: 'metadata.recordType.code.keyword',
    resolvedCode: {
      matchPaths: ['metadata.recordType.en', 'metadata.recordType.cnr'],
      codePath: 'metadata.recordType.code.keyword',
      sourceIncludes: ['metadata.recordType'],
    },
  },
  bibliographicLevel: {
    type: 'resolvedCode',
    matchPath: 'metadata.bibliographicLevel.en',
    keywordPath: 'metadata.bibliographicLevel.code.keyword',
    resolvedCode: {
      matchPaths: ['metadata.bibliographicLevel.en', 'metadata.bibliographicLevel.cnr'],
      codePath: 'metadata.bibliographicLevel.code.keyword',
      sourceIncludes: ['metadata.bibliographicLevel'],
    },
  },

  // ── Author (composite) ──
  author: {
    type: 'author',
    matchPath: 'metadata.authors.familyName',
    keywordPath: 'metadata.authors.familyName.keyword',
    author: {
      searchFields: ['metadata.authors.familyName', 'metadata.authors.firstName'],
      primaryAggField: 'metadata.authors.familyName.keyword',
      secondaryAggField: 'metadata.authors.firstName.keyword',
      sourceIncludes: ['metadata.authors'],
    },
  },
};
