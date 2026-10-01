# Frontend: Public portal redesign

## Status: all five steps BUILT 2026-10-01 (shell, home, catalogue, record, small pages); Profile / 403 / 404 keep the old look

Design canvas: https://claude.ai/artifact/B7Z4xp7gdbbjhoiZdsiZu3 ("NBCG Public Redesign": home, catalogue, record; parked
catalogue options B, C, A1–A3). Built page by page, each step reviewed by the user before the next one starts.
Corrections to the canvas may still come; they are applied to the page they concern.

## Steps

- [x] **1 Shell** — `MainLayout.vue`: 72px header on the surface colour with a hairline border; logo, Home / About us /
  Terms of use / Contact as text links (active = navy, 3px bar); admins get an "Administration" link in the menu; on the
  right `ME / EN` as plain text (`LanguageLinks.vue`), then "Log in" or the account name with a Profile / Log out menu.
  Below 1024px one menu button. Footer in navy: logo + mission, navigation (Home, Catalogue, Advanced search, About us,
  Terms of use, Contact), contact with address / phone / e-mail and social buttons, a bottom row with the year and Terms
  of use. Shared pieces: `.site-container` (1280px + 24px gutters, `app.sass`), navy tokens (`$navy-deep`, `$gold`,
  `$on-navy*`) and `$serif` in `quasar.variables.sass`, `setLocale()` + `LANGUAGES` in `boot/i18n.ts`. The whole site now
  uses Source Sans 3 (Inter dropped). The catalogue gets a one-line footer (`meta.compactFooter` on its route).
  - Left out on purpose: the canvas footer has "Collections" and "Accessibility" links — no such pages exist.
- [x] **2 Home** (`IndexPage.vue`, canvas notes s1, s2) — navy hero with the serif title, one wide search box (material
  dropdown, text, Search), full-text checkbox and Advanced search under it, often-searched chips, a facts line; eight
  collection tiles with counts; themes as a mosaic (large image tile, two wide colour tiles with a description, small
  tiles); recently added as six light cards in two columns (fitted cover, type chip, year, serif title, creator); shorter
  About with three facts.
  - Counts come from `GET /search/suggest?field=materialType&type=records` (one request; counts per English label) and
    the hero's record total from the newest-items search. Tiles filter by English labels per W2 of
    [search filters](search-filters.md): books `Book`; newspapers and magazines both `Journal / Serial`; manuscripts
    `Music manuscript,Manuscript map`; maps `Printed map,Manuscript map,Map serial`; posters and photographs both
    `Graphic` (no type of their own); audiovisual the three sound / video types. Switch to codes once D1 is decided.
  - Themes are static placeholders (picsum images, no counts, every tile opens `/catalog`) until curated collections
    exist. Often-searched chips are a static list too (no search statistics yet).
  - "See everything new" opens `/catalog?sort=newest`. Recently added is hidden when there are no public records.
  - Dev data caveat: all records are PRIVATE, so a visitor sees 0 records and no Recently added; log in to see them.
  - Removed: the banner photo, the 3-D carousel, `index.fullTextOn/Off`, the broken `Monograph` / `Serial publication` /
    `Manuscript` search types (now `Book`, `Journal / Serial`, maps). `index.aboutP1–P4` stay for `AboutPage.vue`.
- [x] **3 Catalogue** (`CatalogPage.vue`, Catalogue board + filter direction 3, notes s3, s4) — navy search band
  (text, full-text checkbox, Search; submits to the URL), "Refine" column without a box
  (`components/catalog/CatalogFilterPanel.vue`): Material type and Period open, Language, Author, Publisher and
  Collection closed with their choice as caption; active filters as removable chips with Clear all; serif title with
  "N results for “q” · showing a–b"; sort, grid / list toggle (remembered per browser); 3:4 cover cards with the type
  chip, creator or "place: publisher", year and extent or "Not yet scanned"; `q-pagination` with Previous / Next.
  Below 1024px the Refine column becomes a side dialog behind a "Refine" button.
  - State lives in the URL (`utils/catalogQuery.ts`): `q`, `fullText=1`, `title`, `author`, `publisher`,
    `materialType`, `language`, `collectionType`, `yearFrom`, `yearTo`, `sort`, `page`. The search checkbox sends the
    text as `fullText` (scanned text) instead of `q` (metadata). `collectionType` is the W3 filter of
    [search filters](search-filters.md) (`>0` collections, `0` single items).
  - Counts next to Material type and Language come from `/search/suggest` and are for the whole catalogue, not the
    current search (the API has no facets). Period has no counts.
  - Left out, no API for it: the "Availability" group (has scans / has OCR) and "Place of publication". The header's
    search row, `useCatalogSearch` and the `MultiSelect*Filter` components are gone.
- [x] **4 Record** (`RecordDetailPage.vue`, Record board, notes s5, s6) — breadcrumb (Home / Catalogue / material type /
  title) and "Back to results"; title block first: type chip and kind caption (issue / serial / collection), serif
  title, subtitle · place: publisher, date; fact chips (year, languages, countries, extent · dimensions, "Full text
  searchable" when a file has extracted text); Download (selected file, else the first PDF) and Copy link.
  `FileViewer.vue` rebuilt: dark rounded box, one toolbar (file name and size; zoom, rotate, open in new tab, full
  screen), thumbnail strip on the left (horizontal under 700px). Below: "About this item" as a label / value list
  (title, subtitle, responsibility, authors, publisher, year, issue, numbering, language, country, extent, ISSN /
  ISBN), "All metadata" as expanders (Bibliographic details, Notes open by default, Classification, Identifiers and
  links), "Cite this item" with Copy. Sidebar: Files (type box, name, size, download), Part of (parents via
  `parent_relations`, one `GET /search/:id` each), Record (permanent link, COBISS ID, added date, Rights → terms,
  Report a problem → mailto). Bottom: other issues of the same title (`GET /search/:parentId/children`, first 6,
  current one highlighted, "All N issues" opens the parent) and, on a collection, its first 12 items.
  - No page controls for PDFs: the browser's PDF viewer in the iframe has its own. Compact footer like the catalogue.
  - `summaryNote` now shows (Bibliographic details → Summary), which closes the "no Summary on the record page" issue.
- [x] **5 Small pages** (About, Terms, Contact, Advanced search boards, note s13) — shared `PageHead` (breadcrumb,
  serif title, lead), `LinkCard`, and `css/public.sass` (`.pub-page`, `.pub-grid`, `.pub-card`, `.pub-prose`,
  `.pub-facts`). About: the four paragraphs with two subheadings, three facts in a navy card, links to the catalogue
  and contact. Terms: numbered sections, "In short" with two can-do and one cannot, consent link card (no "Last
  updated" line: no date to show). Contact: phone / e-mail / address cards, social buttons, a map tile and "Visit the
  library" card both linking to Google Maps (no embedded map; no working hours: unknown). Advanced search: Title,
  Author, Publisher (typeahead), Subject or keyword (`q`), Material type, Language, Collection, year range with quick
  periods, full-text checkbox (keyword goes to `fullText`), Clear / Search, "How it works" card; sends `title` and
  `author` as their own params (before, they were glued into `q`).
  - Still on the old look: Profile, 403, 404 (no artboards; small).
