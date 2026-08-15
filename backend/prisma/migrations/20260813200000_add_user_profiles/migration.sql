-- Local shadow of the Keycloak realm's human users, for cross-user queries:
-- the assignee picker, the "created by" filter dropdown, and resolving a
-- userId to a *current* name in aggregates.
--
-- Deliberately NOT in the read path for rendering a name (that is the snapshot
-- on the row) and NOT in the write path for creating an item. It is also not an
-- authorization source — every permission decision reads the JWT.
--
-- No FK from drafts/records/item_revisions to this table: the importer writes
-- the literal id 'system', and a departed user must still resolve to a name.
-- Rows here are never hard-deleted, which is what makes that resolution work.
--
-- Not listed in infrastructure/docker/pgsync/schema.json, and must stay that
-- way: the daily sync rewrites every row, and a tracked table would re-index
-- documents on each run.
CREATE TABLE "user_profiles" (
    "userId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "displayName" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "canPublish" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMPTZ(3),
    "syncedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("userId")
);

-- Serves the picker's only real query: assignable users who can publish.
CREATE INDEX "user_profiles_canPublish_enabled_deletedAt_idx"
  ON "user_profiles"("canPublish", "enabled", "deletedAt");
