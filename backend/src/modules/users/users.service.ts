import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { SYSTEM_USER_ID, SYSTEM_USER_NAME, UNKNOWN_USER_NAME } from '../../shared/util/display-name';
import type { UsersQueryDto } from './dto/users-query.dto';

/**
 * What a caller sees. `isActive` is derived rather than stored: "suspended, still
 * on staff" (`enabled: false`) and "gone from the realm" (`deletedAt` set) are
 * different facts with different UI and different reversibility, but almost
 * every consumer only wants the conjunction.
 */
export interface UserProfileView {
  userId: string;
  username: string;
  displayName: string;
  canPublish: boolean;
  isActive: boolean;
  enabled: boolean;
  deletedAt: Date | null;
  /**
   * Unconditional. The endpoint is gated on `assertIsStaff`, so everyone who can
   * reach it is internal staff who can see each other in Keycloak anyway — the
   * conditional-email branch this replaced was dead weight every call site still
   * had to reason about.
   */
  email: string | null;
}

/**
 * Read side of the user directory. Never writes: `user_profiles` has exactly one
 * writer, `UserSyncService`.
 */
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(dto: UsersQueryDto): Promise<{ total: number; users: UserProfileView[] }> {
    const active = dto.active ?? true;
    const q = dto.q?.trim();

    // An AND array rather than spread fragments. Nothing was broken by the
    // spread — `canPublish` and the `q` OR are different keys and got ANDed
    // correctly — but `capability=staff` also wants an OR, and a second OR key
    // would have overwritten the first instead of combining. Filter to the
    // capability, then search within it; any number of fragments now compose.
    const where: Prisma.UserProfileWhereInput = {
      AND: [
        ...(dto.capability === 'publish' ? [{ canPublish: true }] : []),
        ...(dto.capability === 'staff'
          ? [
              {
                OR: [
                  { scopes: { has: 'drafts:manage' } },
                  { scopes: { has: 'records:manage' } },
                ],
              },
            ]
          : []),
        ...(active ? [{ enabled: true, deletedAt: null }] : []),
        ...(q
          ? [
              {
                OR: [
                  { displayName: { contains: q, mode: 'insensitive' as const } },
                  { username: { contains: q, mode: 'insensitive' as const } },
                  { email: { contains: q, mode: 'insensitive' as const } },
                ],
              },
            ]
          : []),
      ],
    };

    const [total, rows] = await Promise.all([
      this.prisma.userProfile.count({ where }),
      this.prisma.userProfile.findMany({
        where,
        orderBy: { displayName: 'asc' },
        take: dto.limit ?? 100,
      }),
    ]);

    return { total, users: rows.map(toView) };
  }

  async get(userId: string): Promise<UserProfileView> {
    const row = await this.prisma.userProfile.findUnique({ where: { userId } });
    if (!row) throw new NotFoundException(`User not found in the directory: ${userId}`);
    return toView(row);
  }

  /**
   * Assignability facts for one user, for the task assignee guard.
   *
   * `null` means the directory has never seen this id — treat as unassignable
   * rather than as "no capabilities", because the two want different messages.
   *
   * ADVISORY ONLY. Everything here comes from a directory that is up to one sync
   * interval (24h) stale, so it can reject an assignment the assignee's own
   * token would in fact permit; `POST /api/users/sync` fixes that instantly.
   * Never gate a real permission on this — the authoritative publish check is
   * `ResourceAccessService.assertCanTransition()`, reading the JWT.
   */
  async assignability(
    userId: string,
  ): Promise<{ isActive: boolean; canPublish: boolean; canWrite: boolean } | null> {
    const row = await this.prisma.userProfile.findUnique({
      where: { userId },
      select: { canPublish: true, enabled: true, deletedAt: true, scopes: true },
    });
    if (!row) return null;

    return {
      isActive: row.enabled && row.deletedAt === null,
      canPublish: row.canPublish,
      // Read off the raw `scopes` column, which is exactly what it was stored
      // for: "a future capability question needs no migration and no resync".
      canWrite: row.scopes.includes('drafts:manage') || row.scopes.includes('records:manage'),
    };
  }

  /**
   * Resolve ids to *current* display names, for aggregates.
   *
   * Aggregates must not use the snapshot names on the rows they group: a person
   * renamed halfway through would appear as two contributors. They group by
   * `userId` and call this instead.
   *
   * Every id resolves to something. A departed user still resolves because
   * directory rows are never hard-deleted — that is the payoff for `deletedAt`
   * over a real delete.
   */
  async resolveNames(userIds: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(userIds)];
    const names = new Map<string, string>();
    if (unique.length === 0) return names;

    const rows = await this.prisma.userProfile.findMany({
      where: { userId: { in: unique } },
      select: { userId: true, displayName: true },
    });
    for (const row of rows) names.set(row.userId, row.displayName);

    for (const id of unique) {
      if (names.has(id)) continue;
      names.set(id, id === SYSTEM_USER_ID ? SYSTEM_USER_NAME : UNKNOWN_USER_NAME);
    }
    return names;
  }
}

interface UserProfileRow {
  userId: string;
  username: string;
  displayName: string;
  canPublish: boolean;
  enabled: boolean;
  deletedAt: Date | null;
  email: string | null;
}

function toView(row: UserProfileRow): UserProfileView {
  return {
    userId: row.userId,
    username: row.username,
    displayName: row.displayName,
    canPublish: row.canPublish,
    isActive: row.enabled && row.deletedAt === null,
    enabled: row.enabled,
    deletedAt: row.deletedAt,
    email: row.email,
  };
}
