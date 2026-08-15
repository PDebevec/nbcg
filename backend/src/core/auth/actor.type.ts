import { SYSTEM_USER_ID, SYSTEM_USER_NAME } from '../../shared/util/display-name';
import type { Principal } from './principal.type';

/**
 * Who to attribute a write to.
 *
 * The pair travels together because it is stored together: every write site
 * persists BOTH the id and the name onto the row, and the name is a **snapshot**
 * — captured once from the token and never updated when the user is renamed in
 * Keycloak. That is deliberate. A row records who wrote it as they were called
 * then, which is why a rename in Keycloak costs nothing here (no rename storm
 * through pgsync) and why attribution works for a user the directory sync has
 * never seen.
 *
 * Consequence, stated plainly: a genuine correction — a typo fixed in Keycloak —
 * does not propagate, and needs the admin backfill script keyed on `userId`.
 *
 * Aggregates must NOT group by `userName`: a person renamed halfway through
 * would split into two rows. Group by `userId` and resolve the current name
 * from `user_profiles` instead.
 */
export interface Actor {
  userId: string;
  userName: string;
}

/** Attribution for a request, taken from the JWT. Never consults the database. */
export function actorOf(principal: Principal): Actor {
  return { userId: principal.sub, userName: principal.displayName };
}

/**
 * The COBISS importer runs on a queue with no principal. Without this, every
 * item catalogued via import looks like it appeared from nowhere.
 */
export const SYSTEM_ACTOR: Actor = {
  userId: SYSTEM_USER_ID,
  userName: SYSTEM_USER_NAME,
};
