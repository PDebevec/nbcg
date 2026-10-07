# NBCG
Digital Library for National Library of Montenegro "Đurđe Crnojević"

## Using
### dockers
- Nginx
- PostgreSQL
- redis
- OpenSearch
- keycloak
### frontend
- Vue.js
- Quasar
### backend
- NestJS
- Prisma

# Quick start

```sh
make check ENV=dev    # prerequisites
make setup ENV=dev    # generate .env files + render config
make up               # containers
make migrate          # prisma migrations
make app A=start T=backend
make app A=start T=frontend
```

The dev stack is then on http://localhost:3080. (`make help` lists every
target — see [the infrastructure CLI docs](docs/infrastructure/infrastructure-cli.md).
The old `make qs` target no longer exists; the full sequence and the port map
are in [docs/shared/dev-environment.md](docs/shared/dev-environment.md).)

# Documentation

Everything else — architecture, API reference, roles, plans — is in [`docs/`](docs/README.md).
