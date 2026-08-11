-- Change history + usage counters.
--
-- Neither table is listed in infrastructure/docker/pgsync/schema.json, and they
-- must stay that way: pgsync CDC re-indexes a whole document (metadata plus
-- nested extractedText, which can be megabytes) whenever a watched row changes.
-- A view counter on drafts/records would do that on every page view.

-- CreateEnum
CREATE TYPE "ChangeAction" AS ENUM (
  'CREATE',
  'UPDATE',
  'PUBLISH',
  'UNPUBLISH',
  'VISIBILITY_CHANGE',
  'FILE_ADDED',
  'FILE_REMOVED',
  'RELATION_ADDED',
  'RELATION_REMOVED',
  'DELETE'
);

-- CreateEnum
CREATE TYPE "MetricKind" AS ENUM ('VIEW', 'DOWNLOAD');

-- CreateTable
-- No FK to drafts/records on purpose: an item's history outlives the item, and
-- a foreign key here would either block a delete or cascade the history away.
CREATE TABLE "item_revisions" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "action" "ChangeAction" NOT NULL,
    "changes" JSONB,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "item_revisions_itemId_createdAt_idx" ON "item_revisions"("itemId", "createdAt");
CREATE INDEX "item_revisions_userId_createdAt_idx" ON "item_revisions"("userId", "createdAt");
CREATE INDEX "item_revisions_action_createdAt_idx" ON "item_revisions"("action", "createdAt");

-- CreateTable
CREATE TABLE "item_metrics_daily" (
    "itemId" TEXT NOT NULL,
    "metric" "MetricKind" NOT NULL,
    "day" DATE NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "item_metrics_daily_pkey" PRIMARY KEY ("itemId", "metric", "day")
);

-- CreateIndex
CREATE INDEX "item_metrics_daily_day_idx" ON "item_metrics_daily"("day");
CREATE INDEX "item_metrics_daily_itemId_metric_idx" ON "item_metrics_daily"("itemId", "metric");

-- CreateTable
CREATE TABLE "file_metrics_daily" (
    "fileId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "metric" "MetricKind" NOT NULL,
    "day" DATE NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "file_metrics_daily_pkey" PRIMARY KEY ("fileId", "metric", "day")
);

-- CreateIndex
CREATE INDEX "file_metrics_daily_day_idx" ON "file_metrics_daily"("day");
CREATE INDEX "file_metrics_daily_itemId_metric_idx" ON "file_metrics_daily"("itemId", "metric");

-- Backfill: a synthetic CREATE for every item catalogued before this migration,
-- so the timeline is not blank for the entire existing catalogue. Attributed to
-- the item's own createdByUserId and dated to its createdAt, which is the most
-- truthful reconstruction available — everything between then and now is lost
-- and is not invented here.
INSERT INTO "item_revisions" ("id", "itemId", "version", "action", "changes", "userId", "createdAt")
SELECT gen_random_uuid()::text, "id", "version", 'CREATE'::"ChangeAction", NULL::jsonb, "createdByUserId", "createdAt"
FROM "drafts"
UNION ALL
SELECT gen_random_uuid()::text, "id", "version", 'CREATE'::"ChangeAction", NULL::jsonb, "createdByUserId", "createdAt"
FROM "records";
