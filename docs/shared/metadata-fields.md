# RecordMetadata Fields

`RecordMetadata = BaseMetadata & DomainRecord & { _source: 'cobiss' }`

Legend: ✅ already in SEARCH_FIELDS · 🔍 good search candidate · — not useful for search

> Planned additions (`extent`, `issue`, `keywords`, `summaryNote`) and
> per-material-type visibility: [metadata schema v2](plans/metadata-schema-v2.md).
> The web editor's interim visibility map, until then:
> [material-type field visibility](../frontend/plans/material-type-field-visibility.md).

---

## BaseMetadata

| Field | Type | Search |
|-------|------|--------|
| `title` | `string` | ✅ `^3` |
| `collectionType` | `number` | — numeric code |
| `childrenInDrafts` | `number` | — system |
| `childrenInRecords` | `number` | — system |
| `jeGlavnoGradivo` | `boolean` | — system |

---

## Title & Responsibility (200–208)

| Field | Type | COMARC | Search |
|-------|------|--------|--------|
| `title` | `string` | 200/a | ✅ `^3` |
| `subtitle` | `string` | 200/e | ✅ `^2` |
| `parallelTitle` | `string[]` | 200/d | ✅ |
| `titleByAnotherAuthor` | `string` | 200/c | 🔍 |
| `titleInOtherScript` | `string[]` | 518/a | 🔍 |
| `titleMediumDesignation` | `string` | 200/b | — e.g. "electronic resource" |
| `firstResponsibility` | `string` | 200/f | ✅ `^2` |
| `subsequentResponsibility` | `string[]` | 200/g | 🔍 |
| `edition` | `string` | 205/a | — e.g. "2nd edition" |
| `musicEditionStatement` | `string` | 208/a | — |
| `numberingAndDates` | `string` | 207/a | — serials numbering |

---

## Publication (210)

Nested object — search with `metadata.publication.publisher` etc.

| Sub-field | Type | COMARC | Search |
|-----------|------|--------|--------|
| `publication.place` | `string` | 210/a | — |
| `publication.publisher` | `string` | 210/c | 🔍 |
| `publication.year` | `string` | 210/d | — |
| `publication.placeOfManufacture` | `string` | 210/e | — |
| `publication.manufacturerName` | `string` | 210/g | — |

---

## Series (225)

| Field | Type | COMARC | Search |
|-------|------|--------|--------|
| `seriesTitle` | `string` | 225/a | ✅ |
| `seriesSubtitle` | `string` | 225/e | 🔍 |
| `seriesResponsibility` | `string` | 225/f | 🔍 |
| `seriesIssn` | `string` | 225/x | — |
| `seriesVolume` | `string` | 225/v | — |

---

## Authors (700–702)

Array of objects — not top-level `keyof RecordMetadata`, must be written as plain strings.

| Sub-field | Type | Search |
|-----------|------|--------|
| `metadata.authors.familyName` | `string` | ✅ `^2` |
| `metadata.authors.firstName` | `string` | ✅ |
| `metadata.authors.prefix` | `string` | — |
| `metadata.authors.romanNumerals` | `string` | — |
| `metadata.authors.dates` | `string` | — |
| `metadata.authors.role` | `ResolvedCode` | — |

---

## Corporate Bodies (710–712)

Array of objects — plain strings.

| Sub-field | Type | Search |
|-----------|------|--------|
| `metadata.corporateBodies.name` | `string` | 🔍 |

---

## Notes (300)

| Field | Type | COMARC | Search |
|-------|------|--------|--------|
| `notes` | `string[]` | 300/a | ✅ |

---

## Identifiers

| Field | Type | COMARC | Search |
|-------|------|--------|--------|
| `cobissId` | `string` | — | — exact match only |
| `isbn` | `string[]` | 010/a | — exact match only |
| `issn` | `string[]` | 011/a | — exact match only |
| `ismn` | `string[]` | 013/a | — exact match only |
| `documentTypology` | `string` | 001/t | 🔍 |

---

## Coded Fields (ResolvedCode = `{ code, en, cnr }`)

These are objects/arrays. To search human-readable labels use `.en` or `.cnr` sub-paths.

| Field | Type | COMARC | Search |
|-------|------|--------|--------|
| `recordType` | `ResolvedCode` | 001/b | — |
| `bibliographicLevel` | `ResolvedCode` | 001/c | — |
| `materialType` | `ResolvedCode` | 001/b+c | 🔍 `metadata.materialType.en` |
| `language` | `ResolvedCode[]` | 101/a | 🔍 `metadata.language.en` |
| `originalLanguage` | `ResolvedCode[]` | 101/c | — |
| `translationLanguages` | `ResolvedCode[]` | 101/d | — |
| `country` | `ResolvedCode[]` | 102/a | — |

---

## Physical Description

| Field | Type | COMARC | Search |
|-------|------|--------|--------|
| `physicalDescription` | `string` | 215/a | — |
| `otherPhysicalDetails` | `string` | 215/c | — |
| `dimensions` | `string` | 215/d | — |
| `cartographicMathematicalData` | `string` | 206/a | — |

---

## Other

| Field | Type | Search |
|-------|------|--------|
| `electronicLocation[].url` | `string` | — |
| `textualMaterialCodes` | object | — coded flags |
| `publicationDate1` | `string` | — |
| `publicationDate2` | `string` | — |
| `_source` | `'cobiss'` | — |

---

## File Attachments (not on RecordMetadata — pgsync child)

| Field | Search |
|-------|--------|
| `file_attachments.filename` | ✅ |

---

## Current SEARCH_FIELDS summary

```ts
mf('title', 3),                        // metadata.title^3
mf('subtitle', 2),                     // metadata.subtitle^2
mf('firstResponsibility', 2),          // metadata.firstResponsibility^2
'metadata.authors.familyName^2',
'metadata.authors.firstName',
mf('parallelTitle'),                   // metadata.parallelTitle
mf('seriesTitle'),                     // metadata.seriesTitle
mf('notes'),                           // metadata.notes
'file_attachments.filename',
```
