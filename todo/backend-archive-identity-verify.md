# Backend: Identity / token-verify endpoint (Test connection)

## Status: TODO

## Why we need it

The desktop **archive** has a Settings → **Test connection** action: it must
verify the configured API token and report **who** the token authenticates as
(email) and **what access** it has (write or not), or a clear **401** if the
token is rejected. This both reassures the operator during setup and lets the
app **gate write actions** (upload/publish) when the token lacks write scope.

Today there is **no endpoint that returns the caller's identity**. Every route
is protected and the Keycloak principal already carries the email + roles, but
the archive has nothing to call to echo them back — so "Test connection" can
only guess from an arbitrary request's success/failure.

## Current State

- `KeycloakJwtStrategy` (`backend/src/core/auth/keycloak.strategy.ts`) builds the
  principal from the JWT: `{ username: preferred_username, email,
  scopes: resource_access[clientId].roles }`.
- `principal.type.ts` — the `Principal` shape (`email?`, scopes/roles).
- `get-principal.decorator.ts` — `@GetPrincipal()` param decorator exposes it to
  controllers; `scopes.guard.ts` already reads `user.email` + scopes for gating.
- **No controller returns the principal.** There is no `/auth/verify`, `/me`,
  `/whoami`, or identity route anywhere.

## Changes Needed

- Add a small authenticated endpoint — `GET /api/auth/verify` (or `/api/me`) —
  behind the normal auth guard, that returns the current principal's **email**,
  **username**, and **scopes/roles**, plus a derived **access level** (e.g.
  `write` if the principal holds the write scope, else `read`).
- An invalid/expired/missing token must return **401** (already the guard's
  behavior) so the archive can show "token rejected".
- Read-only, no side effects. Cheap enough to call on demand from Settings.

## Tasks

- [ ] New `auth` (or `identity`) controller: `GET /api/auth/verify` returning
      `{ email, username, scopes, accessLevel }` from `@GetPrincipal()`.
- [ ] Derive `accessLevel` from the write scope the upload/publish routes require.
- [ ] Confirm the guard returns 401 (not 403) for a missing/invalid token on this
      route, so Test connection distinguishes "rejected" cleanly.
- [ ] Register the controller in `app.module.ts`.
- [ ] Archive: wire Settings → **Test connection** to this endpoint; show
      `authenticated as <email> (<accessLevel>)` or the 401 message; use
      `accessLevel` to gate upload.

## Key Files

- `backend/src/core/auth/keycloak.strategy.ts` — principal (email + roles)
- `backend/src/core/auth/principal.type.ts` — `Principal` shape
- `backend/src/core/auth/get-principal.decorator.ts` — `@GetPrincipal()`
- `backend/src/core/auth/scopes.guard.ts` / `scopes.decorator.ts` — scope gating
- `backend/src/app.module.ts` — register the new controller
