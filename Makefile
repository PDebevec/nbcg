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
# generate backend and frontend env
#####

#####
# apply config
#####
apply-conf:
	./infrastructure/scripts/apply-conf.sh

#####
# apply config
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
# startup scripts
#####
init-dev:
	make env ENV=dev
	make docker ENV=dev
	make apply-conf
	make apply-env
	make create

init-prod:
	make env ENV=prod
	make docker ENV=prod
	make apply-conf
	make apply-env
	make cert-gen
	make create

#####
# quich start
#####
qs:
	make init-dev
	make start

#####
# docker create and start
#####
create:
	docker compose -f docker-compose.yml -f docker-compose.ext.yml create

up:
	docker compose -f docker-compose.yml -f docker-compose.ext.yml up -d

#####
# handle services
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

clear:
	rm docker-compose.yml
	rm docker-compose.ext.yml
	rm .env
	rm -f infrastructure/docker/nginx/certs/*

qd:
	make down-v
	make clear

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