# Rebuilding the OpenSearch indices

Needed after a mapping change in `infrastructure/docker/pgsync/schema.json`
(pgsync only creates mappings when an index does not exist). Verified
2026-07-06 with pgsync 7.0.1; dev container names shown.

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
