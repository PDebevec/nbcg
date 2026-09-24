# Glossary

Terms as used in code, in the UI (`en` / `cnr` — Montenegrin), and in
conversation (Slovenian, in brackets where it differs).

| Code / API | UI en | UI cnr | Meaning |
|---|---|---|---|
| item | item | građa / jedinica | one catalogued unit; lives in `drafts` or `records` (sl. *gradivo*) |
| `DRAFT` | draft | nacrt | work in progress, never public-by-default (sl. *osnutek*) |
| `RECORD` | record | zapis | published item (sl. *zapis*) |
| transition | publish / return to draft | objavi / vrati u nacrt | move DRAFT ↔ RECORD; same id |
| `visibilityStatus` | visibility | vidljivost | `PUBLIC`, `PRIVATE` (staff/logged-in by scope), `HIDDEN` |
| `collectionType` | collection type | tip zbirke | `0` not a collection, `1` primary, `3` collection, `4` serial collection (sl. *zbirka*, *serijska zbirka*) |
| parent / child | | | an `item_relations` edge: a collection and its member, a serial and its issue (sl. *podzbirka* for a child collection) |
| `materialType` | material type | vrsta građe | 2-letter COBISS code = `recordType` + `bibliographicLevel`, e.g. `am` book, `as` journal, `em` printed map, `gm` video, `cm` printed music (sl. *tip gradiva*) |
| `recordType` | | | 1st letter: `a`/`b` text, `c`/`d` music, `e`/`f` maps, `g` video/projected, `i`/`j` sound, `k` graphics, `l` electronic, `m` multimedia, `r` 3-D object |
| `bibliographicLevel` | | | 2nd letter: `m` monograph, `s` serial, `a` analytic (article), `i` integrating, `c` collection |
| `ResolvedCode` | | | `{ code, en, cnr }` — how every coded value is stored, so it displays without a lookup |
| COBISS | | | the national union catalogue system; items can be imported by COBISS id |
| COMARC/B | | | the COBISS bibliographic format (UNIMARC-based) the metadata follows; field numbers like 200/a, 210/c |
| extent | number of pages / duration | broj strana / trajanje | `metadata.extent` `{ value, unit }` — a `quantity`: the number is typed, the unit (`pages`, `minutes`, `sheets`, …) follows the material type (sl. *št. strani*, *dolžina*) — [schema v2](plans/metadata-schema-v2.md) |
| issue | issue | broj / sveska | `metadata.issue` `{ volume, number, date }` on an item whose parent is a serial collection (sl. *št. časopisa*) |
| scale | scale | razmjera | `cartographicMathematicalData` (206) for maps; required to publish a map (sl. *kartografsko merilo*) |
| keywords | keywords | ključne riječi | `metadata.keywords`, COMARC 610 free keywords (sl. *ključne besede*) |
| task | task | zadatak | a staff handoff about one item (sl. *task*, *naloga*) |
| `kind` → stage | stage | faza | `GENERAL`, `FIX_METADATA`, `REVIEW_PUBLISH` |
| return with notes | return | vrati | send a task back one step with a reason |
| reassign | reassign | predaj drugom | same stage, different person |
| cataloguer | cataloguer | katalogizator | staff who edit drafts, cannot publish |
| editor | editor | urednik | staff who can publish |
| archive app | | | the desktop app archive staff use at the client (`nbcg-dc`) — [archive-app.md](archive-app.md) |

Note: the UI labels above are indicative; the source of truth for UI strings is
`frontend/src/i18n/*/index.ts` (and, after schema v2, the schema's labels).
