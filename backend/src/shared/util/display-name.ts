/**
 * One formatting rule for a human's name, applied at write time.
 *
 * Used by the JWT strategy (which snapshots the name onto every item and
 * revision it writes) and, later, by the user-directory sync (which precomputes
 * `UserProfile.displayName`). Both must agree: a snapshot written from a token
 * and a directory row written from the Admin API describe the same person, and
 * a cosmetic disagreement between the two reads as a data bug.
 */

/** `item_revisions.userId` written by the COBISS importer — no Keycloak user behind it. */
export const SYSTEM_USER_ID = 'system';

/** What {@link SYSTEM_USER_ID} renders as. */
export const SYSTEM_USER_NAME = 'System (import)';

/** For a `userId` that resolves to nobody — a pre-attribution row, or a hard-deleted realm user. */
export const UNKNOWN_USER_NAME = 'Unknown user';

export interface NameParts {
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
}

/**
 * "First Last", falling back to the username, falling back to
 * {@link UNKNOWN_USER_NAME}. Never returns an empty string — a blank byline is
 * worse than an honest placeholder.
 */
export function formatDisplayName(parts: NameParts): string {
  const full = [parts.firstName, parts.lastName]
    .map((v) => v?.trim())
    .filter(Boolean)
    .join(' ');
  return full || parts.username?.trim() || UNKNOWN_USER_NAME;
}
