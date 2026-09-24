# Roles and permissions

Authentication is Keycloak (realm `nbcg`); the web app logs in through the
public client `nbcg-web`. Authorization is by **client roles of `nbcg-api`**,
which arrive in the JWT and are called **scopes** everywhere in the code
(`principal.scopes` in the backend, `useAuthz()` in the frontend).

## Scopes

| Scope | Includes (composite) | Allows |
|---|---|---|
| `records:view:public` | | see PUBLIC records (anonymous callers get this level too) |
| `records:view:private` | `records:view:public` | + PRIVATE records |
| `records:view:hidden` | `records:view:private` | + HIDDEN records |
| `drafts:view:public` / `:private` / `:hidden` | same chain | the same for drafts |
| `records:manage` | `records:view:hidden` | create/edit/delete records |
| `drafts:manage` | `drafts:view:hidden` | create/edit/delete drafts |
| `import:execute` | | COBISS import and preview |
| `users:manage` | | trigger the user-directory sync (only in `nbcg-realm.conf.json`; the older `nbcg-realm.json` lacks it) |

Derived capabilities (not roles):

| Capability | Rule | Used for |
|---|---|---|
| **staff** | `drafts:manage` OR `records:manage` | tasks, user directory, attribution names |
| **publish / transition** | `records:manage` AND `drafts:manage` | DRAFT ↔ RECORD (`assertCanTransition`) |
| **admin area** | `drafts:view:hidden` AND `records:view:hidden` | the `/admin` route guard |

`@RequireScopes()` in the backend is AND-only; "any of" rules are service
calls (`assertIsStaff`). The frontend's `useAuthz()` only shapes the UI — the
API's 401/403 is always the authority.

## Groups → personas

Roles are granted through groups under `/nbcg` in the realm template
`infrastructure/docker/keycloak/nbcg-realm.conf.json`. The dev test users
`admin`, `editor`, `cataloguer`, `reader` (password = username) are members of
the matching group; the API test suite uses them.

| Group | `nbcg-api` roles | Can publish | Staff |
|---|---|---|---|
| `admins` | `import:execute`, `drafts:manage`, `records:manage`, `users:manage` (+ `realm-admin`) | ✔ | ✔ |
| `editors` | `import:execute`, `drafts:manage`, `records:manage` | ✔ | ✔ |
| `cataloguers` | `import:execute`, `drafts:manage`, `records:view:hidden` | ✘ | ✔ |
| `readers` | `records:view:private` | ✘ | ✘ |
| anonymous | — (public records only) | ✘ | ✘ |

So a cataloguer can **see** hidden records but not edit them, and can import
from COBISS.

Terminology trap: the group called **editors publishes**, the group called
**cataloguers does not**. Never key logic or tests off a group name — use the
scopes. The worker service account `nbcg-worker` holds `import:execute`,
`drafts:manage`, `records:manage` plus realm-management `view-users` and
`view-clients` for the directory sync.

## Rules worth knowing

- A hidden or not-visible item returns **404, not 403**, so existence cannot be
  probed (`assertCanView`).
- Attribution names (`createdByName`, …) are stripped for non-staff callers,
  both in the OpenSearch query and again before the response.
- `user_profiles.canPublish` is a **UI hint** (up to a day stale); it must never
  gate a real permission — publishing checks the token.
- Task assignment checks against the directory are advisory for the same reason.

Details: [backend reference — Users, Attribution](../backend/reference.md#user-directory).
