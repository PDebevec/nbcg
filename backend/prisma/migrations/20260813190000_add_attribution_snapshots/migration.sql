-- Attribution snapshots: who wrote this row, as they were called at the time.
--
-- The name is captured from the JWT at write time and NEVER updated afterwards.
-- A column that tracked the current Keycloak name would make a single rename
-- re-index every document that person ever touched — pgsync CDC rebuilds the
-- whole document, metadata plus nested extractedText, on any column change to
-- drafts/records. A snapshot is written once, so that cost is never paid.
--
-- No FK to user_profiles (which does not exist yet, and will not gain one): the
-- importer writes the literal id 'system', and a departed user must still
-- resolve to a name.

-- Added nullable so the ALTER succeeds on non-empty tables, then backfilled,
-- then tightened. The placeholders below are honest rather than correct — the
-- real backfill resolves each distinct userId through the Keycloak Admin API
-- and must run before the OpenSearch reindex, or the index ships placeholders.
ALTER TABLE "drafts"  ADD COLUMN "createdByName" TEXT;
ALTER TABLE "drafts"  ADD COLUMN "updatedByName" TEXT;
ALTER TABLE "records" ADD COLUMN "createdByName" TEXT;
ALTER TABLE "records" ADD COLUMN "updatedByName" TEXT;
ALTER TABLE "item_revisions" ADD COLUMN "userName" TEXT;

UPDATE "drafts" SET
  "createdByName" = CASE WHEN "createdByUserId" = 'system' THEN 'System (import)' ELSE 'Unknown user' END,
  "updatedByName" = CASE
    WHEN "updatedByUserId" IS NULL THEN NULL
    WHEN "updatedByUserId" = 'system' THEN 'System (import)'
    ELSE 'Unknown user'
  END;

UPDATE "records" SET
  "createdByName" = CASE WHEN "createdByUserId" = 'system' THEN 'System (import)' ELSE 'Unknown user' END,
  "updatedByName" = CASE
    WHEN "updatedByUserId" IS NULL THEN NULL
    WHEN "updatedByUserId" = 'system' THEN 'System (import)'
    ELSE 'Unknown user'
  END;

UPDATE "item_revisions" SET
  "userName" = CASE WHEN "userId" = 'system' THEN 'System (import)' ELSE 'Unknown user' END;

-- `createdByName` and `userName` mirror the nullability of the id they shadow:
-- an item always has a creator, a revision always has an actor, and an update
-- may not have happened yet.
ALTER TABLE "drafts"  ALTER COLUMN "createdByName" SET NOT NULL;
ALTER TABLE "records" ALTER COLUMN "createdByName" SET NOT NULL;
ALTER TABLE "item_revisions" ALTER COLUMN "userName" SET NOT NULL;
