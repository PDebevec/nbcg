# Frontend: Task Delegation

## Status: TODO — backend is DONE and live

Reacts to [Task Delegation](backend-task-delegation-plan.md) and
[the `tasks` + `task_history` rewrite](backend-task-history-rewrite.md), both
shipped 2026-08-16. Every endpoint below was called live while writing this
document; the JSON is captured output, not a sketch.

**Nothing is broken today.** All of this is additive — there is no task UI to
migrate. One thing does need checking rather than adding: `/api/users` is now
staff-only, which matters if anything ever starts calling it (nothing does yet).

## The feature in one paragraph

A cataloguer finishes a draft and files a task: *"this is ready, please publish
it"*, assigned to a publisher. The publisher either publishes it — which closes
the task automatically — or **returns** it with notes to whoever asked, who fixes
it and sends it back. One task ping-pongs for its whole life. Everything that
happens to it lands in an append-only log, which survives even the deletion of
the item it was about.

---

## 1. Current state of the frontend

Checked 2026-08-16, so you can trust these as starting points:

- **No task UI of any kind.** Nothing to migrate.
- **`src/api/` has only `admin.ts` and `search.ts`.** There is still **no
  `users.ts`** — [the directory catch-up task](frontend-user-directory-and-attribution.md)
  called for one and it was never built. Build it here; that task can drop it.
- **`src/composables/useAuthz.ts`** exposes `hasScope`, `hasAllScopes`,
  and `useAuthz()` → `{ canAccessAdmin, canManageRecords, canManageDrafts,
  canTransition, canImport }`. There is **no "holds any of" helper** — see the
  trap in §6.
- **`auth.roles`** (`src/services/keycloak.ts`) already holds the `nbcg-api`
  client roles, so every UI decision below is local — no extra request.
- **Admin routes** live under `/admin` with
  `meta: { requiresAuth: true, scopes: ['drafts:view:hidden', 'records:view:hidden'] }`,
  and children add their own `meta.scopes`.
- **i18n** is `src/i18n/en-US/index.ts` and `src/i18n/me/index.ts`, one flat
  default-export object keyed by area (`nav`, `common`, `index`, …). Both files
  must gain every new key.
- **Axios** is `src/boot/axios.ts`, `baseURL: '/api'` — so call `/tasks`, not
  `/api/tasks`.

---

## 2. What to build

| Screen | Where | Gist |
|---|---|---|
| **"Assign for review"** | item edit page | kind → searchable person picker → file the task |
| **"My tasks" inbox** | new `/admin/tasks` | what is waiting on me, and what I filed |
| **Task detail** | `/admin/tasks/:id` | state, the log, comment box, return-with-notes |
| **Open-task badge** | item list rows | one extra request per page |
| **Item task history** | item edit page, a tab | what happened around this record |

---

## 3. The API contract

All paths are relative to the axios `baseURL` of `/api`.

### Shared types

```ts
export type TaskKind = 'REVIEW_PUBLISH' | 'FIX_METADATA' | 'GENERAL';
export type TaskStatus =
  | 'OPEN' | 'IN_PROGRESS' | 'RETURNED' | 'COMPLETED' | 'CANCELLED';
export type TaskAction =
  | 'CREATED' | 'ASSIGNED' | 'STATUS_CHANGED' | 'RETURNED'
  | 'COMMENTED' | 'UPDATED' | 'CLOSED_ON_PUBLISH';

/** Same shape as item revision diffs. */
export interface FieldChange {
  path: string;
  before: unknown;
  after: unknown;
}

export interface TaskHistoryEntry {
  id: string;
  action: TaskAction;
  /** The return reason or the comment body. */
  note: string | null;
  changes: FieldChange[] | null;
  userId: string;
  /** A SNAPSHOT — render as-is, never re-resolve. See §6. */
  userName: string;
  createdAt: string;
}

export interface Task {
  id: string;
  itemId: string;
  /** Resolved server-side at read time. `null` only if the item vanished. */
  itemType: 'DRAFT' | 'RECORD' | null;
  kind: TaskKind;
  title: string;
  description: string | null;
  status: TaskStatus;
  assignedToUserId: string;
  /** CURRENT name from the directory — safe to display. */
  assignedToName: string;
  createdByUserId: string;
  createdByName: string;
  dueAt: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  /** Detail read only. Oldest first; comments and events interleaved. */
  history?: TaskHistoryEntry[];
  /** Detail read only. Prefill for "return to". Can be null. */
  returnTo?: { userId: string; displayName: string } | null;
}
```

### `POST /tasks` → 201

```jsonc
// request
{ "itemId": "cmsv…", "kind": "REVIEW_PUBLISH",
  "title": "Ready for review", "description": "Checked against COBISS.",
  "assignedToUserId": "f6bf0426-…", "dueAt": null }
```
```jsonc
// response — a Task, with no `history` and no `returnTo`
{
  "id": "cmsvpwfcx007yqrta7xstwxhk",
  "itemId": "cmsvpwfb1007wqrtawc92bwrj",
  "itemType": "DRAFT",
  "kind": "REVIEW_PUBLISH",
  "title": "Ready for review",
  "description": "Checked against COBISS.",
  "status": "OPEN",
  "assignedToUserId": "f6bf0426-17b4-4a73-b527-368d5f462990",
  "assignedToName": "editor editor",
  "createdByUserId": "1d8c42ad-6ec1-46f5-aa0c-95310bbcd498",
  "createdByName": "cataloguer cataloguer",
  "dueAt": null,
  "createdAt": "2026-08-16T11:24:30.272Z",
  "updatedAt": "2026-08-16T11:24:30.272Z",
  "completedAt": null
}
```

`kind` defaults to `GENERAL` if omitted. `title` is 1–200 chars, `description`
≤ 5000.

### `GET /tasks` → 200

Query: `assignedTo` · `createdBy` (both accept the literal `me`) · `itemId` ·
`itemIds` (comma-separated, **max 200**) · `status` · `kind` · `limit` (default
50, max 200) · `offset`.

```jsonc
{ "total": 1, "tasks": [ /* Task[], no history, no returnTo */ ] }
```

Sorted `createdAt` **descending**. All staff see all tasks — `assignedTo=me` is a
filter, not a wall, and that is deliberate: the point is being able to see who a
draft is waiting on.

### `GET /tasks/:id` → 200

Same object **plus** `history[]` (oldest first) and `returnTo`:

```jsonc
{
  "…": "…all Task fields…",
  "history": [
    {
      "id": "cmsvpwfcz007zqrtac9vo8g67",
      "action": "CREATED",
      "note": "Checked against COBISS.",
      "changes": [
        { "path": "kind", "before": null, "after": "REVIEW_PUBLISH" },
        { "path": "assignedToUserId", "before": null, "after": "f6bf0426-…" }
      ],
      "userId": "1d8c42ad-…",
      "userName": "cataloguer cataloguer",
      "createdAt": "2026-08-16T11:24:30.275Z"
    }
  ],
  "returnTo": { "userId": "1d8c42ad-…", "displayName": "cataloguer cataloguer" }
}
```

### `PATCH /tasks/:id` → 200

Every field optional: `status`, `kind`, `assignedToUserId`, `title`,
`description`, `dueAt`, **`note`**.

`note` does not go onto the task — it lands on the history row this PATCH
writes. That is how a return reason is recorded, and why it must travel in the
same request. Returns the updated `Task` (no `history`, no `returnTo` — re-fetch
the detail if you need them).

**Who may PATCH:** the assignee, the creator, or anyone with `records:manage`.
Anyone else gets 403.

A PATCH that changes nothing still returns 200 but writes no history row, so
idempotent saves are safe.

### `POST /tasks/:id/comments` → 201

```jsonc
// request
{ "body": "Looking at it now." }
// response — a TaskHistoryEntry, NOT a task
{
  "id": "cmsvpx0fx0082qrtawfsspxpr",
  "action": "COMMENTED",
  "note": "Looking at it now.",
  "changes": null,
  "userId": "f6bf0426-…",
  "userName": "editor editor",
  "createdAt": "2026-08-16T11:24:57.597Z"
}
```

Append it to your local `history[]` — no need to re-fetch.

### `GET /tasks/item/:itemId/history` → 200

Query: `limit` (default 50, max 200) · `offset`. Sorted **descending**.

```jsonc
{ "total": 4,
  "history": [ { /* TaskHistoryEntry */, "taskId": "cmsv…" } ] }
```

Entries carry `taskId` here because they span every task ever filed against the
item — **including tasks that no longer exist.** This is the audit view.

Gated differently from the rest: `records:view:hidden` **and**
`drafts:view:hidden`, exactly like `GET /items/:id/history`. The cataloguer
passes; a reader gets 403. Since `/admin` already requires both, anyone on an
admin page can call it.

### `GET /users` → 200 — the person picker

```jsonc
// GET /users?capability=publish&q=ed&limit=5
{ "total": 1,
  "users": [ {
    "userId": "f6bf0426-17b4-4a73-b527-368d5f462990",
    "username": "editor",
    "displayName": "editor editor",
    "canPublish": true,
    "isActive": true,
    "enabled": true,
    "deletedAt": null,
    "email": "editor@nbcg.com"
  } ] }
```

- `capability=publish` — can publish (`records:manage` AND `drafts:manage`).
- `capability=staff` — can write (`records:manage` **OR** `drafts:manage`).
- `q` — case-insensitive substring over display name, username and email.
- `active` — defaults `true`; pass `false` to include departed/suspended.
- `limit` — default 100, max 500.

`capability` and `q` compose: it filters to the capability, then searches within
it. `email` is always present now — the endpoint is staff-only, so there is no
conditional branch to handle.

---

## 4. The rules the GUI must respect

The server enforces all of these. Mirror them so the user does not meet a 400.

### The assignee guard, keyed on `(kind, status)`

| kind | status | Assignee must |
|---|---|---|
| `REVIEW_PUBLISH` | `OPEN`, `IN_PROGRESS` | be able to **publish** |
| `REVIEW_PUBLISH` | `RETURNED` | be able to **write** |
| `FIX_METADATA`, `GENERAL` | any | be able to **write** |
| *(all)* | *(all)* | be in the directory and active |

So the picker's `capability` depends on **both** the kind and the status it will
land in:

```ts
function pickerCapability(kind: TaskKind, status: TaskStatus): 'publish' | 'staff' {
  const needsPublisher =
    kind === 'REVIEW_PUBLISH' && (status === 'OPEN' || status === 'IN_PROGRESS');
  return needsPublisher ? 'publish' : 'staff';
}
```

Filing a `REVIEW_PUBLISH` → `capability=publish`. **Returning** one →
`capability=staff`, because a returned task goes to whoever must fix it, who
usually cannot publish. Getting this backwards is the easiest mistake here.

### Returning is one atomic request

`status: 'RETURNED'` **must** carry a different `assignedToUserId` in the same
PATCH. Either alone is a 400:

```ts
await patchTask(id, {
  status: 'RETURNED',
  assignedToUserId: returnTo.userId,
  note: 'The author field is wrong.',
});
```

Prefill the picker from the detail read's `returnTo` — it is the requester, and
it already accounts for the case where they have left or are the one holding the
task. It can be `null`; show an empty picker then, not an error.

### Status transitions

- `CANCELLED` is **terminal.** Any status change on a cancelled task is 400 —
  disable the control rather than letting them try.
- `COMPLETED` is **not** terminal. Reopening is legitimate (a publish went out
  wrong), so keep the status control live on a completed task.
- `completedAt` is set on entering `COMPLETED` and cleared on leaving it. Do not
  set it yourself; it is not a writable field.
- There is **no `expectedVersion`** on tasks. Unlike items, no 409 handling is
  needed — do not copy the `isVersionConflict` pattern from `admin.ts`.

### Publishing closes review tasks by itself

Publishing an item — through the normal transition action, bulk publish, import,
anything — closes every open/in-progress/returned `REVIEW_PUBLISH` task on it and
appends a `CLOSED_ON_PUBLISH` entry naming the publisher.

**Consequence:** after any publish, task state on screen is stale. Refetch the
badge/inbox, or the user will see an open task for something already published.
`FIX_METADATA` and `GENERAL` are untouched.

### Errors, with real messages

| Status | When | Body `message` |
|---|---|---|
| 401 | not logged in | — |
| 403 | logged in without `drafts:manage` or `records:manage` | `Requires drafts:manage or records:manage` |
| 403 | PATCH by someone who is not assignee/creator/`records:manage` | `Only the assignee, the creator or records:manage may edit a task` |
| 404 | task not found, **or** item not visible to the caller | `Task not found: …` / `Item not found: …` |
| 400 | wrong capability for `(kind, status)` | `A REVIEW_PUBLISH task in status OPEN needs an assignee who can publish (records:manage and drafts:manage). If their roles changed recently, run POST /api/users/sync.` |
| 400 | `RETURNED` without a new assignee | `Returning a task must reassign it: send status and assignedToUserId together.` |
| 400 | status change on a `CANCELLED` task | `A cancelled task cannot change status. Open a new task instead.` |
| 400 | assignee unknown to the directory | `Not a known user: …. If they were just added to Keycloak, run POST /api/users/sync.` |

Standard Nest shape: `{ message, error, statusCode }`. **Surface `message`
verbatim** for the 400s — they are written to tell the user what to do, including
the `users/sync` hint for a stale directory. Do not replace them with a generic
"something went wrong".

---

## 5. Rendering the history

`history[]` is one chronological stream mixing human comments and system events.
Render `COMMENTED` as a message and everything else as an event, so a task never
looks like it changed by itself.

```
10:02  cataloguer cataloguer   CREATED            assigned to editor editor
10:14  editor editor           COMMENTED          "Looking at it now."
11:32  editor editor           RETURNED  → cataloguer cataloguer
                                                  "The author field is wrong."
11:47  cataloguer cataloguer   STATUS_CHANGED     RETURNED → OPEN, to editor editor
12:05  editor editor           CLOSED_ON_PUBLISH  OPEN → COMPLETED
```

**One user action is one row.** A return is a single `RETURNED` entry whose
`changes` holds *both* the status and the assignee move — do not expect a
separate `ASSIGNED` row, and do not render one.

`changes[].after` for `assignedToUserId` is a **raw user id**. To show a name,
either read it off the task (for the current assignee) or resolve it via
`GET /users/:id`. Do not display the bare UUID.

`CLOSED_ON_PUBLISH` is attributed to the real publisher, never to a "system"
user — render the name, and let the action label carry the "automatic" meaning.

---

## 6. Traps

### `userName` on history is frozen; names on the task are live

This is the one thing most likely to be got wrong, and it is deliberate on both
sides:

| Field | Behaviour |
|---|---|
| `task.assignedToName`, `task.createdByName` | **current** name, re-resolved every read |
| `history[].userName` | **snapshot**, frozen at write time |

So if someone is renamed in Keycloak, the task header updates and the log does
not. That is correct: a live work item must show who someone *is now*, while
"Ana Novak returned this" must keep saying that forever. **Never re-resolve
`history[].userName` through the directory** — you would be rewriting history,
and the backend has a test asserting it does not happen.

### The router guard is AND-only; the API's bar is OR

`meta.scopes` is checked with `hasAllScopes`, so it **cannot express**
`drafts:manage OR records:manage` — the same limitation the backend hit with
`@RequireScopes`, which is why it uses a service call instead.

In practice `/admin` already requires `drafts:view:hidden` AND
`records:view:hidden`, which every current staff persona holds and `reader` does
not — so nesting the task routes under `/admin` with **no extra `meta.scopes`**
is right. Do not add `scopes: ['drafts:manage', 'records:manage']`; that would
demand both and lock out the cataloguer, who is the feature's main user.

For showing/hiding controls, add the missing helper:

```ts
// src/composables/useAuthz.ts
export function hasAnyScope(...scopes: string[]): boolean {
  return scopes.some((s) => auth.roles.includes(s));
}
// in useAuthz():
const isStaff = computed(() => hasAnyScope('drafts:manage', 'records:manage'));
```

`canTransition` already exists and is exactly "can publish" — reuse it rather
than re-deriving.

Treat all of this as UI shaping only. The route guard is a near-enough gate; the
API's 403 is the authority.

### Do not cache the user list

Fetch per keystroke (debounced) with `limit=5`. The directory is synced from
Keycloak daily and a cached picker will offer people who have left. Same rule as
in [the directory catch-up task](frontend-user-directory-and-attribution.md).

### Filter by id, display the name

`assignedToUserId` is what you send. `assignedToName` is display only. A person
renamed in Keycloak keeps the same id, so filtering by name would silently break.

### `GET /users` is staff-only now

It returns 403 below `drafts:manage`/`records:manage`, where it used to return a
filtered list. Nothing in the frontend calls it yet, so nothing breaks — but the
`users.ts` client you are about to write must not be used on any page a reader
can reach.

### The badge is one request per page, not per row

```ts
const ids = rows.map((r) => r.id).join(',');       // ≤ 200
const { tasks } = await listTasks({ itemIds: ids, status: 'OPEN' });
const flagged = new Set(tasks.map((t) => t.itemId));
```

There is no `openTaskCount` on items and there will not be — `drafts`/`records`
are CDC-tracked, so a counter there would re-index the whole document on every
task change. It also means **you cannot search or facet on "has an open task"**;
the badge only decorates a page you already fetched.

### `itemType` can be `null`

Only if an item vanished outside the normal delete path. Render defensively;
don't assume `'DRAFT' | 'RECORD'`.

---

## 7. Suggested file layout

```
src/api/tasks.ts        Task/TaskHistoryEntry types + the 6 calls
src/api/users.ts        UserProfile type, listUsers(), getUser()
src/pages/admin/AdminTasksPage.vue        inbox
src/pages/admin/AdminTaskDetailPage.vue   detail + log + actions
src/components/admin/AssigneePicker.vue   debounced q-select over /users
src/components/admin/TaskHistoryList.vue  the log renderer
src/components/admin/TaskStatusBadge.vue  status chip (cf. VisibilityBadge.vue)
```

Routes under the existing `/admin` block, no extra `meta.scopes`:

```ts
{ path: 'tasks', component: () => import('pages/admin/AdminTasksPage.vue') },
{ path: 'tasks/:id', component: () => import('pages/admin/AdminTaskDetailPage.vue') },
```

`AssigneePicker` should take `kind` and `status` as props and derive
`capability` itself — that keeps the one rule in §4 in a single place.

### i18n

Both `src/i18n/en-US/index.ts` and `src/i18n/me/index.ts` need a `tasks` block:
the kind labels, status labels, **action labels for all seven `TaskAction`
values**, the screen copy, and the empty states. Nothing may fall back to
rendering a raw enum.

---

## 8. What NOT to build

- **`GET /tasks/assignable-users`** — does not exist and will not. The picker is
  `GET /users?capability=…&q=…`, in its own module, because the directory
  outlives task delegation.
- **A "publish this task" button that bypasses the transition endpoint.** There
  is no task-driven publish endpoint. Publish the item the normal way; the
  observer closes the task.
- **A separate comments list.** Comments are history rows. One stream.
- **Optimistic-concurrency handling.** No `expectedVersion` on tasks.
- **Anything that reopens tasks on unpublish.** `RECORD → DRAFT` deliberately
  leaves completed tasks completed.

---

## 9. Estimate

| Piece | Hours |
|---|---|
| `api/tasks.ts` + `api/users.ts` + types | 1.5 |
| `AssigneePicker` (debounced, capability-aware) | 1.5–2 |
| "Assign for review" on the item edit page | 1.5 |
| Inbox page (filters, empty states) | 2–2.5 |
| Detail page + history renderer + return-with-notes | 3–4 |
| Open-task badge on the item list | 1 |
| Item task-history tab | 1 |
| i18n both locales | 1 |
| **Total** | **12.5–14.5** |

The detail page carries the real work: it is the only screen with more than one
action, and the return flow is the only one with a rule the user can get wrong.

## Key files

- `backend/BACKEND_REFERENCE.md` — "Tasks (delegation)" and "Users (directory)"
- `backend/test/api-test-suite.sh` §18 — every rule above, as executable examples
- `frontend/src/composables/useAuthz.ts` — needs `hasAnyScope` / `isStaff`
- `frontend/src/api/admin.ts` — the client conventions to copy
- `frontend/src/router/routes.ts` — the `/admin` block to extend
- `frontend/src/components/admin/VisibilityBadge.vue` — precedent for a status chip
