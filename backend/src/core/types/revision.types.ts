/**
 * One changed field in an `item_revisions.changes` array.
 *
 * `path` is a dotted/indexed path into the item's metadata as produced by
 * `diffMetadata()` — e.g. `title`, `authors[0].familyName`. A handful of
 * synthetic paths describe things that do not live in metadata:
 *
 *   `visibilityStatus`  — PUBLIC/PRIVATE/HIDDEN change
 *   `itemType`          — DRAFT/RECORD on publish/unpublish
 *   `files[<fileId>]`   — attachment added, removed or replaced
 *   `children[<id>]`    — relation connected or disconnected
 */
export interface FieldChange {
  path: string;
  before: unknown;
  after: unknown;
}

export type FieldChangeList = FieldChange[];
