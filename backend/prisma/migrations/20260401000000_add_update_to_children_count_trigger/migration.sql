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

  ELSIF TG_OP = 'DELETE' THEN
    v_delta       := -1;
    v_parent_type := OLD."parentType";
    v_child_type  := OLD."childType";
    v_parent_id   := OLD."parentId";

  ELSIF TG_OP = 'UPDATE' THEN
    -- Only a childType change affects parent counts.
    -- A parentType change means the parent item itself moved tables;
    -- its metadata (including counts) is copied over during the transition.
    IF OLD."childType" = NEW."childType" THEN
      RETURN NULL;
    END IF;

    DECLARE
      v_old_field TEXT := CASE OLD."childType"
        WHEN 'DRAFT'  THEN 'childrenInDrafts'
        ELSE               'childrenInRecords'
      END;
      v_new_field TEXT := CASE NEW."childType"
        WHEN 'DRAFT'  THEN 'childrenInDrafts'
        ELSE               'childrenInRecords'
      END;
      v_pid TEXT := NEW."parentId";
      v_ptype TEXT := NEW."parentType";
    BEGIN
      IF v_ptype = 'DRAFT' THEN
        UPDATE drafts
        SET metadata = jsonb_set(
          jsonb_set(
            metadata,
            ARRAY[v_old_field],
            to_jsonb(GREATEST(0, COALESCE((metadata ->> v_old_field)::int, 0) - 1))
          ),
          ARRAY[v_new_field],
          to_jsonb(COALESCE((metadata ->> v_new_field)::int, 0) + 1)
        )
        WHERE id = v_pid;
      ELSE
        UPDATE records
        SET metadata = jsonb_set(
          jsonb_set(
            metadata,
            ARRAY[v_old_field],
            to_jsonb(GREATEST(0, COALESCE((metadata ->> v_old_field)::int, 0) - 1))
          ),
          ARRAY[v_new_field],
          to_jsonb(COALESCE((metadata ->> v_new_field)::int, 0) + 1)
        )
        WHERE id = v_pid;
      END IF;
    END;

    RETURN NULL;
  END IF;

  -- Shared path for INSERT and DELETE
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
AFTER INSERT OR DELETE OR UPDATE ON item_relations
FOR EACH ROW EXECUTE FUNCTION fn_update_children_counts();
