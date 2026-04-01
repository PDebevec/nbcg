DROP TRIGGER IF EXISTS trg_item_relations_children_count ON item_relations;
DROP FUNCTION IF EXISTS fn_update_children_counts();

CREATE OR REPLACE FUNCTION fn_update_children_counts()
RETURNS TRIGGER AS $$
DECLARE
  v_field       TEXT;
  v_delta       INT;
  v_parent_type TEXT;
  v_child_type  TEXT;
  v_parent_id   TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_delta       := 1;
    v_parent_type := NEW."parentType";
    v_child_type  := NEW."childType";
    v_parent_id   := NEW."parentId";
  ELSE -- DELETE
    v_delta       := -1;
    v_parent_type := OLD."parentType";
    v_child_type  := OLD."childType";
    v_parent_id   := OLD."parentId";
  END IF;

  v_field := CASE v_child_type
    WHEN 'DRAFT'  THEN 'childrenInDrafts'
    WHEN 'RECORD' THEN 'childrenInRecords'
  END;

  IF v_parent_type = 'DRAFT' THEN
    UPDATE drafts
    SET metadata = jsonb_set(
      metadata,
      ARRAY[v_field],
      to_jsonb(GREATEST(0, COALESCE((metadata ->> v_field)::int, 0) + v_delta))
    )
    WHERE id = v_parent_id;
  ELSE
    UPDATE records
    SET metadata = jsonb_set(
      metadata,
      ARRAY[v_field],
      to_jsonb(GREATEST(0, COALESCE((metadata ->> v_field)::int, 0) + v_delta))
    )
    WHERE id = v_parent_id;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_item_relations_children_count
AFTER INSERT OR DELETE ON item_relations
FOR EACH ROW EXECUTE FUNCTION fn_update_children_counts();
