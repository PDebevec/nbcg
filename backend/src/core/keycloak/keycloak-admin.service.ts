import { Injectable, Logger } from '@nestjs/common';
import { fetch as undiciFetch } from 'undici';

/**
 * Read-only client for the Keycloak Admin REST API, used by the user-directory
 * sync and nothing else.
 *
 * Raw `undici` rather than `@keycloak/keycloak-admin-client`: three endpoints
 * are needed, and the official client is a large dependency with a history of
 * ESM/CJS friction in CommonJS Nest builds. This follows the house pattern in
 * `tika.service.ts`.
 *
 * The service account holds `view-users` + `view-clients` and nothing more —
 * not `realm-admin`, which is 18 roles including `manage-users` and
 * `impersonation` on an account that only reads.
 */

/** One user as the realm reports them. */
export interface KeycloakUser {
  id: string;
  username: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  enabled?: boolean;
  /** Present only on service accounts. Belt-and-braces — /users already omits them. */
  serviceAccountClientLink?: string;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
}

interface RoleRepresentation {
  name: string;
}

/** Keycloak's own default for `max`. Never assume one page. */
const PAGE_SIZE = 100;

/** Re-mint at 80% of the token's life rather than waiting for a 401. */
const TOKEN_REFRESH_RATIO = 0.8;

@Injectable()
export class KeycloakAdminService {
  private readonly logger = new Logger(KeycloakAdminService.name);

  private readonly baseUrl = process.env.KEYCLOAK_URL ?? 'http://localhost:8082';
  private readonly realm = process.env.KEYCLOAK_REALM ?? 'nbcg';
  private readonly workerClientId = process.env.KEYCLOAK_WORKER_CLIENT_ID ?? 'nbcg-worker';
  private readonly workerSecret = process.env.KEYCLOAK_WORKER_CLIENT_SECRET;
  private readonly apiClientId = process.env.KEYCLOAK_CLIENT_ID ?? 'nbcg-api';

  private token?: { value: string; expiresAt: number };
  /** The `nbcg-api` *internal* UUID, which is not KEYCLOAK_CLIENT_ID. Resolved once. */
  private apiClientUuid?: string;

  private get adminBase(): string {
    return `${this.baseUrl}/admin/realms/${this.realm}`;
  }

  /**
   * Every human user in the realm, paginated to exhaustion.
   *
   * Service accounts are already excluded by Keycloak, so the filtering here is
   * defensive: a `serviceAccountClientLink` or a `service-account-` username
   * must never reach the directory and show up in an assignee picker.
   */
  async listUsers(): Promise<KeycloakUser[]> {
    const users: KeycloakUser[] = [];

    for (let first = 0; ; first += PAGE_SIZE) {
      const page = await this.get<KeycloakUser[]>(
        `/users?briefRepresentation=false&first=${first}&max=${PAGE_SIZE}`,
      );
      users.push(...page.filter((u) => !isServiceAccount(u)));
      // A short page is the last page. Paginating until an *empty* page would
      // cost one extra request per sync for no benefit.
      if (page.length < PAGE_SIZE) break;
    }

    return users;
  }

  /**
   * Effective `nbcg-api` roles for one user — direct AND group-derived, with
   * composites expanded.
   *
   * The `/composite` variant is what makes storing group membership unnecessary:
   * a non-composite call would miss both the roles a user gets from a group and
   * the `records:view:*` roles implied by `records:manage`.
   */
  async listEffectiveApiRoles(userId: string): Promise<string[]> {
    const clientUuid = await this.resolveApiClientUuid();
    const roles = await this.get<RoleRepresentation[]>(
      `/users/${encodeURIComponent(userId)}/role-mappings/clients/${clientUuid}/composite`,
    );
    return roles.map((r) => r.name);
  }

  /**
   * Resolve and cache `nbcg-api`'s internal UUID. Every role-mapping call needs
   * it, and it is not the same value as `KEYCLOAK_CLIENT_ID`.
   *
   * Requires `view-clients`: `view-users` alone gets a 403 here, and the weaker
   * `query-clients` gets a 200 with an empty list, which is worse — it looks
   * like the client does not exist.
   */
  private async resolveApiClientUuid(): Promise<string> {
    if (this.apiClientUuid) return this.apiClientUuid;

    const clients = await this.get<Array<{ id: string; clientId: string }>>(
      `/clients?clientId=${encodeURIComponent(this.apiClientId)}`,
    );
    const uuid = clients[0]?.id;
    if (!uuid) {
      throw new Error(
        `Keycloak client "${this.apiClientId}" not found in realm "${this.realm}". ` +
          'An empty result usually means the service account is missing realm-management:view-clients.',
      );
    }

    this.apiClientUuid = uuid;
    return uuid;
  }

  /**
   * GET with a cached bearer token, retried once on a 401 with a forced re-mint.
   *
   * The retry covers a Keycloak restart, which invalidates a token that has not
   * yet expired by our clock.
   */
  private async get<T>(path: string, retryOn401 = true): Promise<T> {
    const token = await this.accessToken();
    const response = await undiciFetch(`${this.adminBase}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });

    if (response.status === 401 && retryOn401) {
      this.logger.warn(`Admin API 401 on ${path} — re-minting the token and retrying once`);
      this.token = undefined;
      return this.get<T>(path, false);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '(unreadable)');
      throw new Error(`Keycloak Admin API ${path} failed: HTTP ${response.status} — ${body}`);
    }

    return (await response.json()) as T;
  }

  /**
   * Client-credentials token for the worker service account, cached in memory.
   *
   * Minted against the **`nbcg` realm, not `master`**: `realm-management` roles
   * are per-realm and `nbcg-worker` lives in `nbcg`.
   */
  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt) return this.token.value;

    if (!this.workerSecret) {
      throw new Error(
        'KEYCLOAK_WORKER_CLIENT_SECRET is not set — the user directory cannot sync. ' +
          'It must match the nbcg-worker secret in the realm.',
      );
    }

    const response = await undiciFetch(
      `${this.baseUrl}/realms/${this.realm}/protocol/openid-connect/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: this.workerClientId,
          client_secret: this.workerSecret,
        }),
      },
    );

    if (!response.ok) {
      const body = await response.text().catch(() => '(unreadable)');
      throw new Error(
        `Keycloak client_credentials grant failed for "${this.workerClientId}": ` +
          `HTTP ${response.status} — ${body}`,
      );
    }

    const json = (await response.json()) as TokenResponse;
    this.token = {
      value: json.access_token,
      expiresAt: Date.now() + json.expires_in * 1000 * TOKEN_REFRESH_RATIO,
    };
    return this.token.value;
  }
}

function isServiceAccount(user: KeycloakUser): boolean {
  return Boolean(user.serviceAccountClientLink) || user.username.startsWith('service-account-');
}
