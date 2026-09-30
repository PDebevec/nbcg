# Rebuilding the OpenSearch indices

Needed after a mapping or index-settings change in
`infrastructure/docker/pgsync/schema.json` (pgsync only creates mappings and
settings when an index does not exist). Verified 2026-07-06 with pgsync 7.0.1,
again 2026-09-25 for the analyzer change below; dev container names shown.

1. Delete the indices:
   ```bash
   curl -XDELETE 'localhost:9200/records,drafts'
   ```
2. Delete pgsync's Redis checkpoints — without this, pgsync will not re-send
   existing rows:
   ```bash
   docker exec nbcg-redis-1 redis-cli del queue:nbcg_records:meta queue:nbcg_drafts:meta
   ```
3. Recreate pgsync (from the repo root):
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.ext.yml up -d --force-recreate pgsync
   ```
4. Check with `_count` — **not** `_cat/indices`:
   ```bash
   curl 'localhost:9200/records,drafts/_count'
   ```
   Nested `file_attachments` are separate Lucene documents, so `_cat/indices`
   `docs.count` reads far higher than the Postgres row count (25 vs 11 records on
   2026-08-13) and looks like duplication when nothing is wrong.

Small datasets re-sync in seconds.

## Index settings: the accent-folding analyzer (2026-09-25)

Each index entry in `schema.json` has a `setting` block, which pgsync sends as
`settings.index` when it creates the index. Both indices define a `default`
analyzer (`standard` tokenizer, `lowercase`, `asciifolding` with
`preserve_original`), so every text field matches `Niksic` ↔ `Nikšić` (metadata
schema v2 B12). Changing it needs the full reindex above. **Production: still
to do** — part of the schema v2 rollout wipe
([backend plan, Deploy notes](../backend/plans/metadata-schema-v2.md#deploy-notes)).
Check a live index:

```bash
curl 'localhost:9200/records/_settings' | grep -o '"analysis":{[^}]*}[^}]*}'
curl -XPOST 'localhost:9200/records/_analyze' -H 'Content-Type: application/json' -d '{"text":"Nikšić"}'
# -> tokens "niksic" and "nikšić"
```

## Filter sub-fields: ISBN/ISSN and years (2026-09-29)

The search filters ([reference → Search](../backend/reference.md#search)) match
two kinds of sub-field, declared under `metadata` in `transform.mapping`, with
their analysis in the same `setting` block as above:

| Sub-field | Built by | Holds |
|---|---|---|
| `metadata.isbn.normalized`, `metadata.issn.normalized` | `identifier` normalizer: char filter `identifier_separators` (drops whitespace and every dash, `[\s\p{Pd}]`) + `lowercase` | the whole number: `978-9940-34-341-5` → `9789940343415`, `2049–363X` → `2049363x` |
| `metadata.publication.year.years` | `years` analyzer: pattern tokenizer `four_digit_years`, `(?<!\d)\d{4}(?!\d)` | only the 4-digit years: `1884-1885` → `1884`, `1885`; `[ca. 1850?]` → `1850`; `c1995` → `1995`; `s. a.` → none |

The main fields keep their dynamic shape (`text` + `.keyword`), so search,
suggest and `fields` projections behave as before. Why: the dynamic `text`
mapping split `978-9940-34-341-5` into `978`, `9940`, … so an exact ISBN filter
matched nothing, and a year range compared words as text, so `ca` or `s`
counted as later than any year. Done on dev with the full reindex above;
**production: still to do** (same procedure). Check a live index:

```bash
curl 'localhost:9200/records/_mapping/field/metadata.isbn,metadata.publication.year'
curl -XPOST 'localhost:9200/records/_analyze' -H 'Content-Type: application/json' \
  -d '{"field":"metadata.publication.year.years","text":"[ca. 1850?]"}'   # -> "1850"
```

## Adding a mapping for a field that does not exist yet — no reindex

A reindex is only needed to **change** a field's mapping. A field that no
document has used yet can be declared in place: add it to `schema.json` (so new
environments get it) **and** put the same mapping on the live indices once:

```bash
curl -XPUT 'localhost:9200/records,drafts/_mapping' -H 'Content-Type: application/json' \
  -d '{"properties":{"metadata":{"properties":{"issue":{"properties":{"date":{"type":"keyword"}}}}}}}'
curl 'localhost:9200/records,drafts/_mapping/field/metadata.issue.date'   # check
```

That exact command is a **one-off deploy step for metadata schema v2**
(`metadata.issue.date` as `keyword`, 2026-09-24): done on dev, still to run on
production. Run it before the first item with an `issue` is saved; afterwards
dynamic mapping would already have picked a type and only a reindex could
change it. pgsync passes `properties` inside a `transform.mapping` entry
through unchanged, for `object` fields as for `nested` ones.

## Declaring a nested child

To map a child table as `nested`, put
`"childLabel": { "type": "nested", "properties": { …leaf mappings… } }` in the
**root** node's `transform.mapping`. A parent-level entry overwrites the
auto-built child subtree (`properties` is an allowed parameter there). A
`transform.mapping` on the child node itself is overwritten — leave it out.
`file_attachments` is done this way today.
