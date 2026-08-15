#####
# Entry point for the infrastructure CLI.
#
# Every target here is a thin call into infrastructure/package.json's npm
# scripts, which are themselves aliases for infrastructure/scripts/run.js.
# The CLI stays runnable directly (`cd infrastructure && npm run ...`) — this
# file exists so you never have to change directory first.
#
# The legacy `scripts/*.sh` flow is no longer wired up here. Those scripts are
# still on disk and still runnable by hand; the CLI supersedes them.
#####

ENV   ?= dev
INFRA := infrastructure
NPM   := npm --prefix $(INFRA) --silent

.PHONY: help deps cli list check setup step config clear app docker \
        up down down-v stop restart create ps build pull logs migrate health \
        cron-backup cron-restore

#####
# npm dependencies for the CLI itself. `touch` keeps the directory newer than
# package.json so this only reruns when the manifest actually changes.
#####
deps: $(INFRA)/node_modules

$(INFRA)/node_modules: $(INFRA)/package.json
	npm --prefix $(INFRA) install
	@touch $@

#####
# interactive menus
#####
cli: deps
	$(NPM) run cli

#####
# setup pipeline
#   make check ENV=prod
#   make setup ENV=prod
#   make step STEP=config ENV=dev
#   make step STEP=env ENV=prod FLAGS=--rotate
#####
list: deps
	$(NPM) run list

check: deps
	$(NPM) run check -- $(ENV)

setup: deps
	$(NPM) run setup -- $(ENV)

step: deps
	$(NPM) run step -- $(STEP) $(ENV) $(FLAGS)

#####
# master.config.json vs its template
#   make config A=diff
#   make config A=merge
#####
config: deps
	$(NPM) run config -- $(A)

#####
# remove generated artifacts
#   make clear T=list
#   make clear T=volumes FLAGS=--yes
#####
clear: deps
	$(NPM) run clear -- $(T) $(FLAGS)

#####
# pm2-managed frontend / backend (dev only)
#   make app A=start T=backend
#####
app: deps
	$(NPM) run app -- $(A) $(T)

#####
# any docker action, optionally scoped to services
#   make docker A=up SVC="db redis"
#####
docker: deps
	$(NPM) run docker -- $(A) $(SVC)

#####
# shortcuts for the common docker actions. $@ is the target name, which is
# also the CLI action name — so `make up SVC=db` is `docker -- up db`.
#####
up down down-v stop restart create ps build pull logs migrate health: deps
	$(NPM) run docker -- $@ $(SVC)

#####
# cron jobs. Kept as shell scripts: the CLI has no equivalent for these.
#####
cron-backup:
	./infrastructure/scripts/backup.sh

cron-restore:
	./infrastructure/scripts/restore.sh

help:
	@echo "make cli                          interactive menus"
	@echo "make check|setup ENV=dev|prod     prerequisites / whole pipeline"
	@echo "make step STEP=<key> [ENV=] [FLAGS=--force]"
	@echo "make list                         every step and action, with status"
	@echo "make config A=diff|merge          master.config.json vs template"
	@echo "make clear T=<target> [FLAGS=--yes]"
	@echo "make app A=<action> T=frontend|backend"
	@echo "make docker A=<action> [SVC=\"db redis\"]"
	@echo "make up|down|down-v|stop|restart|create|ps|build|pull|logs|migrate|health [SVC=]"
	@echo "make cron-backup|cron-restore"
