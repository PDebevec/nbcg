-- Convert timestamp columns to `timestamp with time zone`.
--
-- Prisma has always written UTC into these `timestamp without time zone`
-- columns, but the offset was not stored, so pgsync copied an offset-less
-- string into OpenSearch `_source`. Per ECMAScript, a date-time string with no
-- offset parses as *local* time, so every JS client reading a search hit's
-- createdAt/updatedAt was skewed by its own UTC offset.
--
-- `AT TIME ZONE 'UTC'` reinterprets each stored naive value as the UTC instant
-- it always was, so the conversion is lossless and does not shift any row.

ALTER TABLE "drafts"
  ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC';

ALTER TABLE "records"
  ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC';

ALTER TABLE "file_attachments"
  ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';

ALTER TABLE "item_relations"
  ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
