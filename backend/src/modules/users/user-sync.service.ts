import { Injectable, Logger } from '@nestjs/common';
import { KeycloakAdminService } from '../../core/keycloak/keycloak-admin.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { formatDisplayName } from '../../shared/util/display-name';

/**
 * The capability behind `canPublish`. Keyed off the scopes a transition actually
 * requires (`assertCanTransition`), never off a group name — `editors` can
 * publish and `cataloguers` cannot, which is the opposite of how it sounds.
 */
const PUBLISH_SCOPES = ['records:manage', 'drafts:manage'] as const;

export interface SyncResult {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  /** Users the realm reported. */
  seen: number;
  upserted: number;
  /** Rows marked absent by this run. */
  markedDeleted: number;
  /** Rows that had come back and were un-marked. */
  restored: number;
}

export interface SyncStatus {
  lastRun: SyncResult | null;
  lastError: { at: string; message: string } | null;
  running: boolean;
  profileCount: number;
}

/**
 * Reconciles `user_profiles` against the Keycloak realm.
 *
 * **This is the only code in the system permitted to write `user_profiles`.**
 * A user appears in that table because they exist in Keycloak *and* a sync ran
 * — never as a side effect of request traffic.
 */
@Injectable()
export class UserSyncService {
  private readonly logger = new Logger(UserSyncService.name);

  /**
   * Last run and last failure, in memory. A sync that has been silently failing
   * for a week is otherwise invisible until the picker is mysteriously empty.
   * Lost on restart, which is acceptable: the startup run repopulates it within
   * seconds.
   */
  private lastRun: SyncResult | null = null;
  private lastError: { at: string; message: string } | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly keycloak: KeycloakAdminService,
  ) {}

  async status(): Promise<SyncStatus> {
    return {
      lastRun: this.lastRun,
      lastError: this.lastError,
      running: this.running,
      profileCount: await this.prisma.userProfile.count(),
    };
  }

  /**
   * Full reconcile.
   *
   * Enumeration and role resolution happen first and completely. Only a run that
   * got through both, with a non-empty roster, is allowed to reconcile absences
   * — if enumeration 403s or dies halfway, the users we did not see are not
   * gone, and marking them deleted would empty the assignee picker during a
   * Keycloak restart.
   */
  async reconcile(): Promise<SyncResult> {
    const startedAt = new Date();
    this.running = true;

    try {
      const users = await this.keycloak.listUsers();

      // Step 2 is N+1 by design: at 5-50 users it is a handful of requests a
      // day. Past ~200 users, resolve roles once per group
      // (/groups/{id}/role-mappings/clients/{cid}/composite + /groups/{id}/members)
      // and union per user — that is the only reason to reintroduce the group walk.
      const roster = await Promise.all(
        users.map(async (user) => {
          const scopes = await this.keycloak.listEffectiveApiRoles(user.id);
          return { user, scopes };
        }),
      );

      const syncedAt = new Date();
      for (const { user, scopes } of roster) {
        const data = {
          username: user.username,
          firstName: user.firstName ?? null,
          lastName: user.lastName ?? null,
          email: user.email ?? null,
          displayName: formatDisplayName({
            firstName: user.firstName,
            lastName: user.lastName,
            username: user.username,
          }),
          scopes,
          canPublish: PUBLISH_SCOPES.every((s) => scopes.includes(s)),
          enabled: user.enabled ?? true,
          syncedAt,
        };

        await this.prisma.userProfile.upsert({
          where: { userId: user.id },
          create: { userId: user.id, ...data },
          update: data,
        });
      }

      // Everything below this line depends on the roster being complete.
      let markedDeleted = 0;
      let restored = 0;
      if (roster.length > 0) {
        const present = roster.map(({ user }) => user.id);

        const gone = await this.prisma.userProfile.updateMany({
          where: { userId: { notIn: present }, deletedAt: null },
          data: { deletedAt: syncedAt },
        });
        markedDeleted = gone.count;

        const back = await this.prisma.userProfile.updateMany({
          where: { userId: { in: present }, deletedAt: { not: null } },
          data: { deletedAt: null },
        });
        restored = back.count;
      } else {
        // Cannot happen against a real realm — every realm has at least the
        // user whose token triggered the sync. Guarded anyway, because the
        // alternative is deleting the whole directory.
        this.logger.warn('Roster came back empty — skipping absence reconciliation');
      }

      const finishedAt = new Date();
      const result: SyncResult = {
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        seen: roster.length,
        upserted: roster.length,
        markedDeleted,
        restored,
      };

      this.lastRun = result;
      this.lastError = null;
      this.logger.log(
        `User directory synced: ${result.seen} seen, ${markedDeleted} marked absent, ` +
          `${restored} restored, ${result.durationMs}ms`,
      );
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.lastError = { at: new Date().toISOString(), message };
      // Deliberately does NOT touch deletedAt on the way out — see the doc above.
      this.logger.error(`User directory sync failed: ${message}`);
      throw err;
    } finally {
      this.running = false;
    }
  }
}
