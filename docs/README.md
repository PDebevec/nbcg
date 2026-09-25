# NBCG documentation

Everything written down about the project lives here. Replaces the old `todo/`
folder and the scattered `.md` files (moved 2026-09-23).

```text
docs/
├── README.md                ← you are here: index + status of every plan
├── shared/                  cross-cutting: architecture, domain, roles, contracts between clients
│   └── plans/               contracts that backend, web and archive app all build against
├── backend/                 NestJS API: reference, development, plans, history
├── frontend/                Vue/Quasar app: overview, plans, history
└── infrastructure/          docker, Keycloak, nginx, CLI, operations
```

Conventions: `plans/` = not done yet (TODO / PLANNED / DEFERRED / needs a
decision); `history/` = done or superseded, kept for the reasoning. A plan that
touches several parts has one **shared contract** in `shared/plans/` plus one
file per side, each with an "Impact on the other side" table. Docs are in
English.

## Start here

| | |
|---|---|
| [shared/architecture.md](shared/architecture.md) | what the pieces are and how data flows |
| [shared/domain-glossary.md](shared/domain-glossary.md) | draft/record, collectionType, material type codes, task stages — en / cnr / sl |
| [shared/roles-and-permissions.md](shared/roles-and-permissions.md) | scopes, groups, personas, "404 not 403" |
| [shared/metadata-fields.md](shared/metadata-fields.md) | every metadata field, COMARC code, search boosts |
| [shared/archive-app.md](shared/archive-app.md) | the desktop archive app and what it depends on |
| [shared/license-audit.md](shared/license-audit.md) | licenses of every dependency (2026-09-04) |
| [backend/reference.md](backend/reference.md) | tables, endpoints, business rules — the big one |
| [backend/development.md](backend/development.md) | run, build, test, DB, the two "don't do this" traps |
| [frontend/overview.md](frontend/overview.md) | structure, admin area, known issues |
| [infrastructure/infrastructure-cli.md](infrastructure/infrastructure-cli.md) | setup CLI, production, certificates, Keycloak routing |
| [infrastructure/opensearch-reindex.md](infrastructure/opensearch-reindex.md) | rebuilding indices after a mapping change |

## Plans — status board

### Active

| Plan | Parts | Status |
|---|---|---|
| **Metadata schema v2** — dynamic fields by material type / collection / parent, typeahead hints, searchable vocabularies, labels, draft/record validation on save · [contract](shared/plans/metadata-schema-v2.md) · [backend](backend/plans/metadata-schema-v2.md) · [web](frontend/plans/metadata-schema-v2.md) · [archive app](shared/plans/metadata-schema-v2-archive-app.md) | backend, web, archive app | backend B1–B6 DONE 2026-09-24 (dev) · **B8–B12 OPEN** — decided 2026-09-25 with the archive app review: draft/record rules (`targetState`), every save checked, `parentIds` on create, main/child switch dropped · then web F1–F5 + archive app · B7 (drop v1) last. No release ordering: all data is test data |
| **Task workflow v2** — stages instead of statuses, one open task per item, return = previous person + stage, complete REVIEW = publish · [contract](shared/plans/task-workflow-v2.md) · [backend](backend/plans/task-workflow-v2.md) · [web](frontend/plans/task-workflow-v2.md) | backend, web (deploy together) | BACKEND DONE 2026-09-25 (dev, not deployed) · web open |
| [Material-type field visibility in the item editor](frontend/plans/material-type-field-visibility.md): type picked first, only that type's fields shown, the rest folded into "Other fields"; static map now, schema v2 rules later | web | TODO 2026-09-23 |
| [Usage metrics outlive their items](backend/plans/usage-metrics-orphans.md) — deleted items in "most viewed" | backend | TODO, needs a decision |
| [Collection view types](frontend/plans/collection-views.md) — per-`collectionType` layouts | web | PLANNING, needs input |
| [Admin nice-to-have](frontend/plans/admin-nice-to-have.md) — 16 small workflow ideas | web | DECIDED 2026-09-24: A1, A2, A3b, A4, A5, A6, A8, A9 accepted and on the canvas; rest rejected or deferred (B1–B5) |
| [Move `user_profiles` out of `public`](backend/plans/postgres-schema-split.md) | backend | DEFERRED (not rejected) |
| [Production incident follow-ups](infrastructure/plans/infrastructure-todo.md) — `10.10.11.1:443`, worker client secret | infrastructure | see doc |
| [Backend → Keycloak internal routing](infrastructure/plans/keycloak-internal-routing-fix.md) — bare-IP hostname breaks JWKS + user sync | infrastructure | plan; check against commit `9705fbc` |

Suggested order: metadata schema v2 backend B8–B12 → wipe + a few example
items (backend plan's deploy notes) → archive app migration and web F1–F5 (the
web's task workflow v2 alongside; its dialog uses the same validation error) →
retire schema v1. The web-only material-type visibility plan can run
alongside; its §3b folds into web F1.

### Done / superseded (in `history/`)

| Doc | Done |
|---|---|
| [User directory + attribution snapshots](backend/history/user-directory-sync.md) | 2026-08-13 |
| [Task delegation — background](backend/history/task-delegation.md) · [implementation plan](backend/history/task-delegation-plan.md) | 2026-08-16 |
| [`tasks` + `task_history` rewrite](backend/history/task-history-rewrite.md) | 2026-08-16 |
| [Synchronous COBISS preview](backend/history/archive-cobiss-preview.md) | done (archive app wired, confirmed 2026-09-25) |
| [Task delegation UI](frontend/history/task-delegation.md) | 2026-09-22 |
| Frontend attribution + user directory catch-up | 2026-08-17 (file removed when done) |
| [Material-type field visibility](backend/history/material-type-field-visibility.md) | superseded by metadata schema v2 |

## Adding a doc

- New work → `plans/` of the part it belongs to (or `shared/plans/` + one file
  per side if it spans several), with a `## Status:` line near the top, and a
  row in the board above.
- When done, move it to `history/`, update the board, and fold anything
  permanent (endpoints, tables, rules) into `backend/reference.md` or the
  relevant overview — a plan is not a reference.
