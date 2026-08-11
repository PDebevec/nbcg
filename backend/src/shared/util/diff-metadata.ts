import type { FieldChange } from '../../core/types/revision.types';

/**
 * Deep-diff two metadata blobs into a flat list of `{ path, before, after }`.
 *
 * Arrays are compared **positionally and not reorder-normalised**: moving an
 * author from index 0 to index 1 is a real edit and shows up as one. That does
 * mean a reorder is reported as two field changes rather than one "moved"
 * entry — accepted, because the alternative (identity-matching array elements)
 * guesses, and a guess that silently merges two edits is worse on a timeline
 * than a verbose but literal one.
 *
 * A missed or mis-attributed diff here is cosmetic; it never leaves anything
 * downstream stale, which is why this heuristic is fine here and was not fine
 * for `version`.
 */
export function diffMetadata(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): FieldChange[] {
  const changes: FieldChange[] = [];
  walk(before ?? {}, after ?? {}, '', changes);
  return changes;
}

/** Fields rewritten by the children-count trigger, not by a human edit. */
const IGNORED_ROOT_KEYS = new Set(['childrenInDrafts', 'childrenInRecords']);

/** Guard against a pathological blob producing thousands of rows. */
const MAX_CHANGES = 200;

function walk(before: unknown, after: unknown, path: string, out: FieldChange[]): void {
  if (out.length >= MAX_CHANGES) return;
  if (before === after) return;

  const bothObjects = isPlainObject(before) && isPlainObject(after);
  const bothArrays = Array.isArray(before) && Array.isArray(after);

  if (bothArrays) {
    const len = Math.max(before.length, after.length);
    for (let i = 0; i < len; i++) {
      walk(before[i], after[i], `${path}[${i}]`, out);
    }
    return;
  }

  if (bothObjects) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) {
      if (path === '' && IGNORED_ROOT_KEYS.has(key)) continue;
      walk(before[key], after[key], path === '' ? key : `${path}.${key}`, out);
    }
    return;
  }

  // Leaf, or a type change (scalar -> object): record the whole node.
  if (!deepEqual(before, after)) {
    out.push({ path, before: normalise(before), after: normalise(after) });
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** `undefined` is not valid JSON — a removed field is stored as null. */
function normalise(v: unknown): unknown {
  return v === undefined ? null : v;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  return JSON.stringify(a) === JSON.stringify(b);
}
