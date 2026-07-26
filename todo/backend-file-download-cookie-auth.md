# Backend: Cookie Auth for File Downloads

## Status: TODO

## Why we need it

Covers and attachment downloads on the frontend use browser-native loads
(`<img :src>`, `<a :href>` → `GET /api/files/:fileId/download`). The browser
sends these requests itself, **without the `Authorization` header** — the
keycloak axios interceptor only applies to axios calls. The backend therefore
sees an anonymous principal and (correctly) returns 404 `Item not found` for
files whose parent item is PRIVATE/HIDDEN.

Symptom: an admin uploads an image to a PRIVATE record → the cover never
renders on the record page and the download button returns
`404 Item not found: <recordId>`.

Rejected alternative — fetching files as blobs via axios: the app is designed
for multi-GB files (2 GB upload cap, streaming download endpoint), and blobs
buffer the whole file in browser RAM, lose HTTP caching for covers, and spread
object-URL plumbing across every page that shows an image.

## Design

Accept the access token from a cookie **only on the file download endpoint**.
Everything else stays Bearer-only.

### Backend

- Auth guard/middleware: for `GET /files/:fileId/download` (and nothing else),
  if there is no `Authorization` header, read the token from a cookie
  (e.g. `nbcg_at`) and validate it exactly like a Bearer token.
  Header wins when both are present.
- No other endpoint may accept the cookie — that keeps CSRF a non-issue:
  the only cookie-authenticated route is an idempotent GET with no side
  effects, and visibility checks (`assertCanViewFile`) are unchanged.
- Needs `cookie-parser` (or manual `Cookie` header parsing in the guard).

### Frontend

- `services/keycloak.ts`: whenever the token is obtained/refreshed
  (`getValidToken()` / `onAuthRefreshSuccess`), mirror it into the cookie:
  `document.cookie = 'nbcg_at=<token>; Path=/api/files; SameSite=Lax; Secure'`.
  Clear the cookie on logout.
- `Path=/api/files` keeps the cookie from being sent with every API request.
- Setting it from JS is no weaker than the status quo — the token already
  lives in JS memory; HttpOnly is not achievable nor needed here.

### Token expiry

Access tokens are short-lived (~5 min). The cookie is refreshed by the same
code path that refreshes the in-memory token, so it is fresh whenever the SPA
is active. A stale-tab `<img>` load may 401/404 — acceptable; a page refresh
fixes it.

## Implementation steps

1. Backend: extend the auth guard (or add a scoped middleware) to fall back
   to the `nbcg_at` cookie for `GET /files/:fileId/download` only.
2. Frontend: cookie sync in `services/keycloak.ts` (set on init + refresh,
   clear on logout).
3. Verify: PRIVATE record as admin — cover renders, attachment download
   streams; same URLs as anonymous still 404.

## Acceptance criteria

- [ ] Logged-in user with view rights sees covers and can download files of
      PRIVATE/HIDDEN items via plain `<img>`/`<a>` links.
- [ ] Anonymous requests to the same URLs still return 404.
- [ ] Cookie is sent only under `/api/files`, and only the download GET
      accepts it (mutating file endpoints reject cookie-only auth).
- [ ] Cookie is cleared on logout.
