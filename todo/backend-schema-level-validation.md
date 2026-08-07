# Backend: `GET /api/schema/record` does not validate `?level`

## Status: TODO — P2 (silent wrong answer; small, contained fix)

Found during `nbcg-dc` Epic 10 (Settings → "Refresh metadata schema"), 2026-08-07.
Live-verified against the dev backend on `http://localhost:3000`.

## What happens today

`SchemaController.getRecordSchema` declares the query param with a TypeScript
union:

```ts
// backend/src/modules/schema/schema.controller.ts
@Get('record')
getRecordSchema(
  @Query('level') level: 'main' | 'child' | undefined,
  …
)
```

That annotation is erased at runtime and there is no pipe or DTO behind it, so
Nest hands through whatever string arrived. It reaches:

```ts
// backend/src/modules/schema/schema.service.ts
getRecordSchema(level?: 'main' | 'child') {
  const fields = level
    ? ALL_FIELDS.filter(f => f.levels.includes(level))   // ← no match for junk
    : ALL_FIELDS;
  return { fields };
}
```

An unrecognised `level` matches no field, so the endpoint answers **`200 OK` with
`{ "fields": [] }`** instead of rejecting the request.

**Measured 2026-08-07:**

| Request | Result |
| --- | --- |
| `?level=main` | `200`, 41 fields, ETag `"53aad73e…"` |
| `?level=child` | `200`, 31 fields, ETag `"ba501a6d…"` |
| *(no param)* | `200`, 41 fields |
| `?level=` (empty) | `200`, 41 fields — empty string is falsy, so it means "all" |
| **`?level=bogus`** | **`200`, 0 fields**, ETag `"e143675e…"` |
| **`?level=MAIN`** | **`200`, 0 fields** — same ETag; the match is case-sensitive |

`?level=MAIN` is the one that makes this worth fixing: it is an ordinary client
typo, not a hostile input, and the response is a valid-looking success.

## Why it matters

The endpoint is the **single source of truth for the record form's fields**, and
it is served with `Cache-Control: public, max-age=86400` + a strong ETag. So a
client that mistypes `level` once gets an empty field list *and is told to cache
it for 24 hours*. In `nbcg-dc` that renders the metadata editor as a form with no
fields — and because the archive persists its schema copy for offline use, the
empty schema survives a restart. The failure is silent at every layer: no 4xx, no
warning, a well-formed body, a valid ETag.

It also makes an empty schema indistinguishable from a genuine transient fault,
so a client cannot tell "you asked wrong" from "the backend is briefly unhappy".

`nbcg-dc` has guarded its own side (`services/api/schema.ts` refuses to let an
empty field list replace a non-empty cached one), so **this is not blocking the
archive**. It is filed because the next client — the website frontend, or anyone
consuming the schema — will hit the same trap with no guard.

## Second-order: the ETag cache grows with request input

Same controller, and the same fix closes it:

```ts
private etagCache = new Map<string, { etag: string; body: object }>();
…
const cacheKey = level ?? '__all__';
if (!this.etagCache.has(cacheKey)) {
  … this.etagCache.set(cacheKey, { etag, body });
}
```

The controller is a singleton and the `Map` is never evicted, so **every distinct
`?level=` string permanently adds an entry** for the lifetime of the process. The
route is anonymous-OK, so the key space is effectively "any string a caller
sends" rather than the three values the endpoint actually has. Each entry is
small (an md5 string plus a `{ fields: [] }` object), so this is slow memory
growth rather than an immediate hazard — but it is unbounded, and it is only
reachable *because* `level` is unvalidated. Rejecting invalid values caps the
cache at three keys by construction.

*(Read from the code — accumulation is not observable over HTTP, unlike the
response behaviour in the table above.)*

## The fix

Validate the param and let Nest's global `ValidationPipe` reject the rest. Either:

```ts
@Query('level', new ParseEnumPipe(['main', 'child'], { optional: true }))
level?: 'main' | 'child',
```

or a small DTO, which also documents the endpoint for Swagger:

```ts
class RecordSchemaQuery {
  @IsOptional() @IsIn(['main', 'child'])
  level?: 'main' | 'child';
}
```

Decide one behaviour for an unrecognised value and keep it:

- **`400`** — preferred. It matches how the rest of the API treats bad input
  (`?limit>100` on search is a `400`) and turns a silent empty form into an
  obvious client error.
- *Or* **coerce to the unfiltered set** (treat unknown like absent). Acceptable,
  but it hides the client's mistake — and note that `?level=` (empty string)
  already behaves this way today, so the two paths would at least agree.

Whichever is chosen, please also decide whether `level` should be
**case-insensitive**. `?level=Main` failing while `?level=main` works is a
reasonable thing to keep strict, but right now it fails *silently*, which is the
worst of both.

## Acceptance

- `GET /api/schema/record?level=bogus` and `?level=MAIN` no longer return
  `200 { fields: [] }` — they return `400` (or the full field set, if coercion is
  chosen instead).
- `?level=main` / `?level=child` / no param are unchanged: 41 / 31 / 41 fields,
  same ETag + `Cache-Control` behaviour, `If-None-Match` still yields `304`.
- The controller's ETag cache can only ever hold the three legitimate keys.
