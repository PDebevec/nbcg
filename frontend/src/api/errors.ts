import type { ConstraintViolation, Label, MissingField } from 'src/utils/schemaRules';
import type { ItemType } from './admin';

// ---------------------------------------------------------------------------
// The API's error bodies, read off an axios error. The backend's 400/403
// messages are written for the user, so `apiErrorMessage` surfaces them
// verbatim; the two coded errors below get their own UI.
// ---------------------------------------------------------------------------

interface ErrorBody {
  message?: string | string[];
  code?: string;
  [key: string]: unknown;
}

function body(err: unknown): ErrorBody | undefined {
  return (err as { response?: { data?: ErrorBody } })?.response?.data;
}

export function apiErrorStatus(err: unknown): number | undefined {
  return (err as { response?: { status?: number } })?.response?.status;
}

export function apiErrorMessage(err: unknown): string | undefined {
  const message = body(err)?.message;
  if (Array.isArray(message)) return message.join(' ');
  return message ? String(message) : undefined;
}

// ── 400 METADATA_VALIDATION_FAILED (metadata schema v2, every write) ───────

export interface ValidationItem {
  /** `null` for a `POST /items` that created nothing. */
  id: string | null;
  /** Whose rules the item failed. */
  state: ItemType;
  missing: MissingField[];
  violations: ConstraintViolation[];
}

export interface ValidationFailure {
  message: string;
  items: ValidationItem[];
}

/** The failure when `err` is a `400 METADATA_VALIDATION_FAILED`, otherwise `undefined`. */
export function validationFailure(err: unknown): ValidationFailure | undefined {
  const data = body(err);
  if (data?.code !== 'METADATA_VALIDATION_FAILED' || !Array.isArray(data.items)) return undefined;
  return {
    message: apiErrorMessage(err) ?? '',
    items: data.items as ValidationItem[],
  };
}

// ── 409 ITEM_HAS_OPEN_TASK (task workflow v2: one open task per item) ──────

/** The id of the task in the way when `err` is a `409 ITEM_HAS_OPEN_TASK`. */
export function openTaskConflict(err: unknown): string | undefined {
  const data = body(err);
  if (data?.code !== 'ITEM_HAS_OPEN_TASK') return undefined;
  return typeof data.taskId === 'string' ? data.taskId : undefined;
}

export type { ConstraintViolation, Label, MissingField };
