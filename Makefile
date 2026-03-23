.PHONY: $(shell grep -E '^[a-zA-Z0-9_-]+:' Makefile | cut -d: -f1)

ENV ?= dev

#####
# check system requirements
#####
check-requirements:
	./infrastructure/scripts/check-requirements.sh

#####
# generate env
#####
env:
	./infrastructure/scripts/generate-env.sh ${ENV}

#####
# generate env for frontend and backend, only specific to those
#####
end-env:
	./infrastructure/scripts/gen-end-env.sh

#####
# copy config file
#####
config:
	cp config.template.yml config.yml

#####
# apply config
#####
apply-conf:
	./infrastructure/scripts/apply-conf.sh

#####
# apply env
#####
apply-env:
	./infrastructure/scripts/apply-env.sh

#####
# copy docker to base dir
#####
docker:
	cp infrastructure/docker/docker-compose.yml .
	cp infrastructure/docker/docker-compose.${ENV}.yml ./docker-compose.ext.yml

#####
# initialize backend and frontend env
#####
back-end:
	cd backend && npm ci

front-end:
	cd frontend && npm ci

#####
# startup scripts
#####
init-dev:
	$(MAKE) env ENV=dev
	$(MAKE) config
	$(MAKE) apply-conf
	$(MAKE) end-env
	$(MAKE) apply-env
	$(MAKE) docker ENV=dev
	$(MAKE) back-end
	$(MAKE) front-end
	$(MAKE) create

init-prod:
	$(MAKE) env ENV=prod
	$(MAKE) config
	$(MAKE) apply-conf
	$(MAKE) end-env
	$(MAKE) apply-env
	$(MAKE) docker ENV=prod
	$(MAKE) cert-gen
	$(MAKE) create

migrate:
	./infrastructure/scripts/migrate.sh

#####
# quich create
#####
qc:
	$(MAKE) init-dev

#####
# quich start
#####
qs:
	$(MAKE) init-dev
	$(MAKE) start
	$(MAKE) migrate

#####
# docker create and start
#####
create:
	docker compose -f docker-compose.yml -f docker-compose.ext.yml create

up:
	docker compose -f docker-compose.yml -f docker-compose.ext.yml up -d

#####
# handle docker services
#####
start:
	docker compose -f docker-compose.yml -f docker-compose.ext.yml start

stop:
	docker compose -f docker-compose.yml -f docker-compose.ext.yml stop

restart:
	docker compose -f docker-compose.yml -f docker-compose.ext.yml restart

ps:
	docker compose ps -a

#####
# destroy
#####
down:
	docker compose -f docker-compose.yml -f docker-compose.ext.yml down

down-v:
	docker compose -f docker-compose.yml -f docker-compose.ext.yml down -v
	./infrastructure/scripts/clear-volumes.sh

clear:
	$(MAKE) down
	rm -f docker-compose.yml
	rm -f docker-compose.ext.yml
	rm -f .env
	rm -f backend/.env
	rm -f frontend/.env
	rm -f infrastructure/docker/nginx/certs/*
	rm -f infrastructure/docker/pgadmin/servers.json
	rm -f config.yml

qd:
	$(MAKE) down-v
	$(MAKE) clear

#####
# generate self signed certificate
#####
cert-gen:
	./infrastructure/scripts/cert-gen.sh

#####
# backup script for cron job
#####
cron-backup:
	./infrastructure/scripts/backup.sh

#####
# restore script for cron job
#####
cron-restore:
	./infrastructure/scripts/restore.sh