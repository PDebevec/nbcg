# RecordMetadata Fields

`RecordMetadata = BaseMetadata & DomainRecord & { _source: 'cobiss' }`

Legend: ✅ already in SEARCH_FIELDS · 🔍 good search candidate · — not useful for search

> Which field is shown / required for which material type, labels in en + cnr,
> how each is edited: `GET /api/schema/v2/record` ([metadata schema v2](plans/metadata-schema-v2.md),
> backend done 2026-09-24). Schema v2 added `extent`, `issue`, `keywords` and
> `summaryNote` (below). The web editor still uses its interim visibility map
> until it switches to v2: [material-type field visibility](../frontend/plans/material-type-field-visibility.md).
>
> **Required fields (since 2026-09-25, checked on every write):** a **draft**
> needs `title`, `materialType`, `collectionType` (set to 0 when not sent), a
> `name` in each `corporateBodies` entry and a `url` in each
> `electronicLocation` entry; a **record** also needs the publish fields below
> where they apply — `extent`, `cartographicMathematicalData` (maps),
> `issue.number` + `issue.date` (an issue of a serial).

---

## BaseMetadata

| Field | Type | Search |
|-------|------|--------|
| `title` | `string` | ✅ `^3` |
| `collectionType` | `number` | — numeric code |
| `childrenInDrafts` | `number` | — system |
| `childrenInRecords` | `number` | — system |

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
| `numberingAndDates` | `string` | 207/a | — the serial's own numbering ("God. 1, br. 1 (1944)-"); an issue uses `issue` |

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
| `summaryNote` | `string` | 330/a | 🔍 — schema v2; the API used to drop it silently |

---

## Subject (610)

| Field | Type | COMARC | Search |
|-------|------|--------|--------|
| `keywords` | `string[]` | 610/a (all occurrences) | 🔍 — schema v2; suggest field `keywords` |

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
| `physicalDescription` | `string` | 215/a | — free text, e.g. `"253 str."` |
| `extent` | `{ value: number, unit: string }` | — (NBCG) | — schema v2: the number from 215/a, unit `pages`/`sheets`/`volumes`/`items`/`minutes`; caption and unit follow the material type. Required to publish books, video and sound (not collections). COBISS import fills it from 215/a when the unit fits the type (2026-09-25) |
| `otherPhysicalDetails` | `string` | 215/c | — |
| `dimensions` | `string` | 215/d | — |
| `cartographicMathematicalData` | `string` | 206/a | — map scale; required to publish a map (not an issue of a serial) |

---

## Serial issue (NBCG)

Shown only on an item whose parent is a serial collection (`collectionType` 4);
`number` and `date` are then required to publish (not for a draft). No COMARC
source.

| Field | Type | Search |
|-------|------|--------|
| `issue.volume` | `string` | — |
| `issue.number` | `string` | — |
| `issue.date` | `string` `YYYY` / `YYYY-MM` / `YYYY-MM-DD` | — mapped `keyword` in OpenSearch (sortable, prefix-queryable) |

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
