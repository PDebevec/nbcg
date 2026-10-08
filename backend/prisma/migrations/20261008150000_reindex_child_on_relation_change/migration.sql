-- Reindex the CHILD document when a relation changes.
--
-- pgsync indexes `item_relations` as `parent_relations` on the child's
-- document, but cannot map a change in that table back to the child: for a
-- non-root node it looks the root document up by the node's primary-key names
-- (`parentId`, `childId`) in the document's `_meta.records` area, which only
-- holds `id`. It works for `file_attachments` only because that table's key is
-- also called `id`. So a link made or removed after the initial sync never
-- reached the index: the parent's counters went up (the parent row changes),
-- but the child did not show up in the collection.
--
-- This trigger sends the notification pgsync's own `table_notify()` would send
-- for an UPDATE of the child's row, without changing the row: pgsync then
-- re-reads the whole child document, relations included. The payload mirrors
-- `table_notify()` (pgsync 7): primary key in `new` / `old`, the index the
-- table feeds, and the relation row's xmin for pgsync's checkpoint.

CREATE OR REPLACE FUNCTION fn_reindex_relation_child()
RETURNS TRIGGER AS $$
DECLARE
  v_child_id   TEXT;
  v_child_type TEXT;
  v_table      TEXT;
  v_xmin       BIGINT;
  v_key        JSON;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_child_id   := OLD."childId";
    v_child_type := OLD."childType";
    v_xmin       := OLD.xmin::TEXT::BIGINT;
  ELSE
    v_child_id   := NEW."childId";
    v_child_type := NEW."childType";
    v_xmin       := NEW.xmin::TEXT::BIGINT;
  END IF;

  v_table := CASE v_child_type WHEN 'DRAFT' THEN 'drafts' ELSE 'records' END;

  -- The child itself is being deleted (the relation goes with it): nothing to reindex.
  IF v_table = 'drafts' THEN
    IF NOT EXISTS (SELECT 1 FROM drafts WHERE id = v_child_id) THEN RETURN NULL; END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM records WHERE id = v_child_id) THEN RETURN NULL; END IF;
  END IF;

  v_key := JSON_BUILD_OBJECT('id', v_child_id);

  PERFORM PG_NOTIFY(
    CURRENT_DATABASE(),
    JSON_BUILD_OBJECT(
      'xmin', v_xmin,
      'new', v_key,
      'old', v_key,
      'indices', ARRAY[v_table],
      'tg_op', 'UPDATE',
      'table', v_table,
      'schema', TG_TABLE_SCHEMA
    )::TEXT
  );

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_item_relations_reindex_child ON item_relations;

CREATE TRIGGER trg_item_relations_reindex_child
AFTER INSERT OR DELETE OR UPDATE ON item_relations
FOR EACH ROW EXECUTE FUNCTION fn_reindex_relation_child();
