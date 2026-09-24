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
make setup ENV=dev    # the whole setup pipeline
make cli              # or: interactive menus
```

(`make help` lists every target — see [the infrastructure CLI docs](docs/infrastructure/infrastructure-cli.md). The old `make qs` target no longer exists.)

# Documentation

Everything else — architecture, API reference, roles, plans — is in [`docs/`](docs/README.md).
