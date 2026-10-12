# NBCG

## Digitalna biblioteka | Digital Library

Digitalna biblioteka Narodne biblioteke Crne Gore "Đurđe Crnojević"
| Digital library of the National Library of Montenegro "Đurđe Crnojević"

---

## What this project is / Šta je ovaj projekat

NBCG is the system for the digital processing, storage, and publication of library material.
Cataloguers and editors enter records into drafts, which after review are published as records in the catalogue.
Publications are role-protected: only authorised staff can see drafts, hidden, and private records.
Data from the COBISS network (IZUM) can be imported as draft items.

NBCG je sistem za digitalnu obradu, čuvanje i objavljivanje bibliotečke građe.
Katalogizatori i urednici unose zapise u nacrte, koji nakon recenzije postaju objavljeni zapisi u katalogu.
Publikacija je zaštićena ulogama — samo ovlašćeni članovi osoblja vide nacrte, sakrivene i tajne zapise.
Podaci iz COBISS mreže (IZUM) mogu se uvesti kao polazni nacrti.

---

## Quick start (development) / Brzi početak (razvoj)

```sh
make check ENV=dev    # prerequisites
make setup ENV=dev    # generate .env files + render configuration
make up               # start containers
make migrate          # run Prisma migrations
make app A=start T=backend
make app A=start T=frontend
```

The dev stack is then on http://localhost:3080.
(`make help` lists every target — see [Infrastructure CLI docs](docs/infrastructure/infrastructure-cli.md).
The old `make qs` target no longer exists; the full sequence and port map are in [dev environment docs](docs/shared/dev-environment.md).)

Razvojno okruženje je na http://localhost:3080.
(`make help` nabraja sve ciljeve — vidi [dokumentaciju infrastrukturne CLI](docs/infrastructure/infrastructure-cli.md).
Stari cilj `make qs` više ne postoji; puna sekvensa i mapa portova su u [dokumentaciji o razvojnom okruženju](docs/shared/dev-environment.md).)

---

## Management / Upravljanje

The `infrastructure` CLI supersedes the old `.sh` scripts. Run it via npm or via Makefile:

```sh
cd infrastructure && npm run cli
# or:
make up | make down | make restart | make build | make pull | make logs | make migrate | make health
make docker A=start SVC="db redis"   # scoped to specific services
```

The deploy procedure is: `git pull` → `make cli` → run remaining steps.
Task state is now fingerprinted against the environment, code, and configuration templates,
so the CLI recognises when something must be re-run.

Infrastrukturna CLI je zamijenila stare `.sh` skripte. Pokreće se preko npm-a ili Makefile-a:

```sh
cd infrastructure && npm run cli
# ili:
make up | make down | make restart | make build | make pull | make logs | make migrate | make health
make docker A=start SVC="db redis"   # ograničeno na odabrane usluge
```

Procedura deploy-a je: `git pull` → `make cli` → pokreni preostale korake.
Stanje zadataka je sada potpisano (fingerprinted) prema okruženju, kodu i šablonima
konfiguracijskih fajlova, pa CLI prepoznaje kada nešto mora biti ponovo pokrenuto.

---

## Configuration / Konfiguracija

Configuration is rendered from `master.config.template.json` and the environment
(`env/.env.dev`, `env/.env.prod`):

```sh
make config A=diff   # diff between master.config.json and the template
make config A=merge  # apply changes from the template
```

The production configuration is maintained separately from development.
Secrets and passwords are never committed.

Konfiguracija se renderuje od `master.config.template.json` i okruženja
(`env/.env.dev`, `env/.env.prod`):

```sh
make config A=diff   # razlika između master.config.json i šablona
make config A=merge  # primjeni promjene iz šablona
```

Proizvodna konfiguracija se održava odvojeno od razvojne; tajne ključeve i lozinke nikada ne komitovati.

---

## Technology stack / Tehnološki stack

### Docker images / Docker slike

| Service | Image | Notes |
|---|---|---|
| Nginx | `nginx:1.29.5-perl` | reverse proxy; serves the static frontend build |
| PostgreSQL | `postgres:18.3` | main database |
| Valkey | `valkey/valkey:9.2` | cache and job queues |
| OpenSearch | `opensearchproject/opensearch:3.5.0` + Dashboards | search index; replication via pgsync |
| Keycloak | `quay.io/keycloak/keycloak:26.5.4` | authentication and authorisation |
| pgAdmin | `dpage/pgadmin4:9.12.0` | database administration (not exposed) |
| SeaweedFS | `chrislusf/seaweedfs:4.23` | file storage |

Nginx | `nginx:1.29.5-perl` | reverse proxy; serve statičnog frontend builda
PostgreSQL | `postgres:18.3` | glavna baza podataka
Valkey | `valkey/valkey:9.2` | keš i redovi poslova
OpenSearch | `opensearchproject/opensearch:3.5.0` + Dashboards | indeks za pretragu; replikacija preko pgsync
Keycloak | `quay.io/keycloak/keycloak:26.5.4` | autentifikacija i autorizacija
pgAdmin | `dpage/pgadmin4:9.12.0` | administracija baze (nije izloženo)
SeaweedFS | `chrislusf/seaweedfs:4.23` | skladištenje fajlova

### Frontend / Frontend

- Vue.js 3 + Quasar 2
- Pinia (state), Vue Router 4
- Keycloak JS adapter
- vue-i18n (English and Montenegrin)

Vue.js 3 + Quasar 2
Pinia (stanje), Vue Router 4
Keycloak JS adapter
vue-i18n (engleski i crnogorski)

### Backend / Backend

- NestJS 11
- Prisma (ORM)
- ioredis (Redis client)
- Passport + JWT (authentication), keycloak-connect
- BullMQ (job queues)

NestJS 11
Prisma (ORM)
ioredis (klijent za keš)
Passport + JWT (autentifikacija), keycloak-connect
BullMQ (redovi poslova)

### Infrastructure / Infrastruktura

- Custom CLI (`infrastructure/`) — setup, configuration rendering, container management, deploy procedure

Vlastita CLI (`infrastructure/`) — postavke, renderovanje konfiguracija, upravljanje kontejnerima, procedura deploy-a

---

## Roles and permissions / Uloge i dozvole

The system relies on Keycloak scopes rather than hardcoded roles:

- **cataloguer** — can edit drafts, cannot publish
- **editor** — can publish records
- **administrator** — full access to the admin area

The step-by-step procedure (task flow): create item → *General* → *Fix metadata* → *Review* → *Publish* (or *Return* to a previous stage).

Sistem se oslanja na Keycloak opsege (scopes), a ne na hardkodirane uloge:

- **katalogizator** — može da uređuje nacrte, ne može da objavi
- **urednik** — može da objavljuje zapise
- **administrator** — puni pristup administrativnom dijelu

Korak po korak procedura (tok zadataka): kreiranje zapisa → *General* → *Fiksiranje podataka* → *Recenzija* → *Objavi* (ili *Vrati* na prethodnu fazu).

---

## Documentation / Dokumentacija

Everything written about the project lives in `docs/`:

```text
docs/
├── README.md              ← you are here: index + status of every plan
├── shared/                → cross-cutting: architecture, domain, roles, client contracts
│   └── plans/             → shared contracts between backend, web and archive app
├── backend/               → NestJS API: reference, development, plans, history
├── frontend/              → Vue/Quasar app: overview, plans, history
└── infrastructure/        → docker, Keycloak, nginx, CLI, operations
```

Key references:

- [shared/architecture.md](docs/shared/architecture.md) — what the pieces are and how data flows
- [shared/domain-glossary.md](docs/shared/domain-glossary.md) — terms (en / cnr / sl)
- [shared/roles-and-permissions.md](docs/shared/roles-and-permissions.md) — scopes, groups, personas
- [shared/metadata-fields.md](docs/shared/metadata-fields.md) — every metadata field and COMARC codes
- [shared/license-audit.md](docs/shared/license-audit.md) — licenses of every dependency
- [shared/security-review.md](docs/shared/security-review.md) — audit findings
- [shared/content-rights.md](docs/shared/content-rights.md) — content copyright, COBISS/IZUM terms
- [shared/dev-environment.md](docs/shared/dev-environment.md) — bringing the dev stack up
- [backend/reference.md](docs/backend/reference.md) — tables, endpoints, business rules
- [backend/development.md](docs/backend/development.md) — run, build, test, database
- [frontend/overview.md](docs/frontend/overview.md) — structure, admin area
- [infrastructure/infrastructure-cli.md](docs/infrastructure/infrastructure-cli.md) — CLI, production, certificates, Keycloak routing

Sve što je zabilježeno o projektu nalazi se u `docs/`:

```text
docs/
├── README.md              ← ovo: indeks i status svakog plana
├── shared/                → prečko-predmetno: arhitektura, domena, uloge, ugovori između klijenata
│   └── plans/             → zajednički ugovori između backenda, weba i arhivske aplikacije
├── backend/               → NestJS API: referenca, razvoj, planovi, historija
├── frontend/              → Vue/Quasar aplikacija: pregled, planovi, historija
└── infrastructure/        → docker, Keycloak, nginx, CLI, operacije
```

Ključne reference:

- [shared/architecture.md](docs/shared/architecture.md) — šta su komponente i kako podaci teku
- [shared/domain-glossary.md](docs/shared/domain-glossary.md) — termini (en / cnr / sl)
- [shared/roles-and-permissions.md](docs/shared/roles-and-permissions.md) — opsezi, grupe, uloge
- [shared/metadata-fields.md](docs/shared/metadata-fields.md) — svako polje podataka i COMARC kodovi
- [shared/license-audit.md](docs/shared/license-audit.md) — licence svih zavisnosti
- [shared/security-review.md](docs/shared/security-review.md) — nalazi revizije
- [shared/content-rights.md](docs/shared/content-rights.md) — autorska prava sadržaja, COBISS/IZUM uslovi
- [shared/dev-environment.md](docs/shared/dev-environment.md) — pokretanje razvojnog okruženja
- [backend/reference.md](docs/backend/reference.md) — tabele, endpointi, poslovna pravila
- [backend/development.md](docs/backend/development.md) — pokretanje, build, testovi, baza
- [frontend/overview.md](docs/frontend/overview.md) — struktura, administracija
- [infrastructure/infrastructure-cli.md](docs/infrastructure/infrastructure-cli.md) — CLI, produkcija, certifikati, Keycloak rutiranje

---

## License / Licenca

This product was developed by a company on behalf of the National Library of
Montenegro, and copyright belongs to the Library. The planned license is
**Apache-2.0** — it permits free use, modification, and commercial use without
requiring derivative works to remain open source. Until the license file is
added to the repository, all rights are reserved.

Ovaj proizvod je razvila firma po nalogu Narodne biblioteke Crne Gore, i autorska prava pripadaju Biblioteci. Planirana licenca je **Apache-2.0** — dozvoljava slobodnu upotrebu, modificiranje i komercijalnu upotrebu, bez obaveze da izvedeni radovi ostanu otvoreni. Dok se fajl licence ne doda u repozitorijum, sva prava su zadržana.

Dependencies are all permissive (MIT, Apache-2.0, BSD, ISC) except `Valkey` (BSD-3-Clause). See [license-audit.md](docs/shared/license-audit.md). PM2 (AGPL-3.0) is not used in production; it is only a dev-only process manager.

Sve zavisnosti su permissive licence (MIT, Apache-2.0, BSD, ISC), osim `Valkey` (BSD-3-Clause). Detalje vidi u [license-audit.md](docs/shared/license-audit.md). PM2 (AGPL-3.0) se ne koristi u produkciji; to je samo proces manager za razvojno okruženje.

---

## Security / Bezbjednost

Findings are listed in [security-review.md](docs/shared/security-review.md):

- **CRITICAL** — file downloads (`GET /api/files/:id/download?inline=1`) echo the MIME type declared by the uploader, which can enable HTML execution on the API origin.
- **HIGH** — the database password is printed to stdout on every production boot (`backend/prisma.config.ts:6`); OpenSearch Dashboards is unauthenticated in production.

Svi nalazi su navedeni u [security-review.md](docs/shared/security-review.md):

- **CRITICAL** — preuzimanje fajlova (`GET /api/files/:id/download?inline=1`) vraća MIME tip koji je odredio onaj koji je učitao, što može omogućiti izvršavanje HTML-a na domenu API-ja.
- **HIGH** — lozinka baze se ispisuje na stdout pri svakom podizanju u produkciji (`backend/prisma.config.ts:6`); OpenSearch Dashboards je neautentifikovan u produkciji.

---

## Backups / Sigurnosne kopije

Automatic backups are run via cron (`infrastructure/scripts/backup.sh` and
`restore.sh` — see [infrastructure-audit.md](docs/infrastructure/infrastructure-audit.md)).
Backup data is never committed to the repository.

Automatske sigurnosne kopije se vrše preko krontaba (`infrastructure/scripts/backup.sh` i
`restore.sh` — vidi [infrastructure-audit.md](docs/infrastructure/infrastructure-audit.md)).
Podaci sigurnosnih kopija se nikada ne komituju u repozitorijum.

---

## Contributing / Doprinose

When you start new work:

1. Create a plan in the appropriate `plans/` folder (or `shared/plans/` for changes that span several parts, with an impact table).
2. Add a row to the "Status board" in [docs/README.md](docs/README.md).
3. When done, move the document to `history/`, update the board, and fold permanent information (endpoints, tables, rules) into the reference documentation.

Kada počinjete sa novim radom:

1. Kreirajte plan u odgovarajućoj `plans/` podfasci (ili `shared/plans/` za promjene koje se tiču više dijelova, uz tabelu uticaja).
2. Dodajte red u tabelu "Status tabloa" u [docs/README.md](docs/README.md).
3. Kada je gotovo, premjestite dokument u `history/`, ažurirajte tablo i prebacite trajne informacije (endpointi, tabele, pravila) u referentnu dokumentaciju.

---

## Contact / Kontakt

National Library of Montenegro "Đurđe Crnojević" — Digital Library.
Narodna biblioteka Crne Gore "Đurđe Crnojević" — Digitalna biblioteka.
