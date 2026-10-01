# Frontend: Public portal redesign

## Status: step 1 (shell: header + footer) and step 2 (home) BUILT 2026-10-01; steps 3–5 TODO

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
  uses Source Sans 3 (Inter dropped). The catalogue's search row still hangs under the header until step 3.
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
- [ ] **3 Catalogue** (`CatalogPage.vue`, option A + notes s3, s4, s7) — navy search band with material tiles, filter card
  with counts, active-filter chips, Best match card, fixed 3:4 covers, grid / list toggle, text pagination. Removes the
  search row from the header (`useCatalogSearch` goes away or moves into the page).
- [ ] **4 Record** (`RecordDetailPage.vue`, notes s5, s6) — title block first, viewer with a file strip, "About this item"
  as label / value, the rest in expanders, right column with files, Part of, permanent link, rights, cite.
- [ ] **5 Small pages** — About, Terms, Contact, Advanced search, Profile, 403, 404: no artboards; align with the new
  style only (`.site-container`, serif titles, eyebrows).
