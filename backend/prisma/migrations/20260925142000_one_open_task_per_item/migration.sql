-- Task workflow v2: at most one OPEN task per item.
--
-- Aborts, naming the items, if any item already has more than one open task.
-- Resolve those by hand (cancel all but one through the API) and re-run —
-- cancelling someone's task automatically is not a migration's call.
--
-- Know the outcome in advance:
--   SELECT "itemId", count(*) FROM tasks WHERE status = 'OPEN' GROUP BY 1 HAVING count(*) > 1;
DO $$
DECLARE
  dupes text;
BEGIN
  SELECT string_agg("itemId" || ' (' || n || ' open)', ', ')
    INTO dupes
    FROM (SELECT "itemId", count(*) AS n FROM "tasks" WHERE "status" = 'OPEN' GROUP BY 1 HAVING count(*) > 1) d;
  IF dupes IS NOT NULL THEN
    RAISE EXCEPTION 'Items with more than one OPEN task: %. Cancel all but one per item, then re-run.', dupes;
  END IF;
END $$;

-- CreateIndex (declared in schema.prisma: @@unique(..., where: { status: "OPEN" }), preview feature partialIndexes)
CREATE UNIQUE INDEX "tasks_one_open_per_item" ON "tasks"("itemId") WHERE ("status" = 'OPEN');
