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
  /** Staff-only — absent below drafts:manage / records:manage. */
  email?: string | null;
}

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

export async function listUsers(params?: {
  /** `publish` = records:manage AND drafts:manage */
  capability?: 'publish';
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
