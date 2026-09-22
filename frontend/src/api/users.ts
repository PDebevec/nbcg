import { api } from 'src/boot/axios';

// ---------------------------------------------------------------------------
// User directory — mirrors backend users.controller.ts / users.service.ts
//
// Do not cache the list client-side: it is a single indexed read over one row
// per staff member, and the directory is already up to one sync interval
// behind. Fetch it when the picker opens.
// ---------------------------------------------------------------------------

export interface UserProfile {
  userId: string;
  username: string;
  displayName: string;
  /**
   * Hint only, up to 24h stale — use it to filter the picker or grey out an
   * option, never to decide whether an action is allowed. The backend enforces
   * on the token and returns a correct 403 regardless.
   */
  canPublish: boolean;
  isActive: boolean;
  enabled: boolean;
  deletedAt: string | null;
  /** Always present: the endpoint is staff-only, so there is no conditional branch. */
  email: string | null;
}

/** What a picker needs to show and send — lets a prefill (a task's `returnTo`, the current assignee) skip a directory read. */
export type PickedUser = Pick<UserProfile, 'userId' | 'displayName'>;

export interface UserListResult {
  total: number;
  users: UserProfile[];
}

export interface UserSyncResult {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  seen: number;
  upserted: number;
  markedDeleted: number;
  restored: number;
}

export interface UserSyncStatus {
  lastRun: UserSyncResult | null;
  lastError: { at: string; message: string } | null;
  running: boolean;
  profileCount: number;
}

/**
 * The whole endpoint is staff-only (403 below drafts:manage / records:manage).
 * Never call it from a page a reader can reach.
 */
export async function listUsers(params?: {
  /**
   * `publish` = records:manage AND drafts:manage (can publish).
   * `staff` = records:manage OR drafts:manage (can write).
   * Composes with `q`: filters to the capability, then searches within it.
   */
  capability?: 'publish' | 'staff';
  /** Defaults to true server-side — a picker showing departed staff is a bug */
  active?: boolean;
  /** Case-insensitive substring over display name, username and email */
  q?: string;
  limit?: number;
}): Promise<UserListResult> {
  const { data } = await api.get<UserListResult>('/users', { params });
  return data;
}

export async function getUser(userId: string): Promise<UserProfile> {
  const { data } = await api.get<UserProfile>(`/users/${userId}`);
  return data;
}

/** Ask the sync job to run now. Requires users:manage. */
export async function triggerUserSync(): Promise<{ jobId: string }> {
  const { data } = await api.post<{ jobId: string }>('/users/sync');
  return data;
}

/** Requires users:manage. */
export async function getUserSyncStatus(): Promise<UserSyncStatus> {
  const { data } = await api.get<UserSyncStatus>('/users/sync/status');
  return data;
}
