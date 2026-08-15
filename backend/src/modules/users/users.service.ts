import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import type { Principal } from '../../core/auth/principal.type';
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
  /** Staff-only — see {@link UsersService.canSeeContactDetails}. */
  email?: string | null;
}

/**
 * Read side of the user directory. Never writes: `user_profiles` has exactly one
 * writer, `UserSyncService`.
 */
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Email is withheld below the same bar that gates attribution
   * (`drafts:manage` or `records:manage`). Seeing *who exists* is normal for any
   * authenticated user of an internal tool — a picker needs it. Seeing how to
   * contact them is a step further, and nothing in the app needs it below that
   * bar.
   */
  private canSeeContactDetails(principal: Principal): boolean {
    return principal.scopes.has('drafts:manage') || principal.scopes.has('records:manage');
  }

  async list(dto: UsersQueryDto, principal: Principal): Promise<{ total: number; users: UserProfileView[] }> {
    const active = dto.active ?? true;
    const where = {
      ...(dto.capability === 'publish' ? { canPublish: true } : {}),
      ...(active ? { enabled: true, deletedAt: null } : {}),
      ...(dto.q?.trim()
        ? {
            OR: [
              { displayName: { contains: dto.q.trim(), mode: 'insensitive' as const } },
              { username: { contains: dto.q.trim(), mode: 'insensitive' as const } },
              { email: { contains: dto.q.trim(), mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [total, rows] = await Promise.all([
      this.prisma.userProfile.count({ where }),
      this.prisma.userProfile.findMany({
        where,
        orderBy: { displayName: 'asc' },
        take: dto.limit ?? 100,
      }),
    ]);

    const withEmail = this.canSeeContactDetails(principal);
    return { total, users: rows.map((r) => toView(r, withEmail)) };
  }

  async get(userId: string, principal: Principal): Promise<UserProfileView> {
    const row = await this.prisma.userProfile.findUnique({ where: { userId } });
    if (!row) throw new NotFoundException(`User not found in the directory: ${userId}`);
    return toView(row, this.canSeeContactDetails(principal));
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

function toView(row: UserProfileRow, withEmail: boolean): UserProfileView {
  return {
    userId: row.userId,
    username: row.username,
    displayName: row.displayName,
    canPublish: row.canPublish,
    isActive: row.enabled && row.deletedAt === null,
    enabled: row.enabled,
    deletedAt: row.deletedAt,
    ...(withEmail ? { email: row.email } : {}),
  };
}
