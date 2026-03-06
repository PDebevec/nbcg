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
	cd backend && npx prisma generate
	cd backend && npm run build
	cd backend && npm audit fix

front-end:
	cd frontend && npm ci

#####
# startup scripts
#####
init-dev:
	make env ENV=dev
	make apply-conf
	make end-env
	make apply-env
	make docker ENV=dev
	make backend/
	make frontend/
	make create

init-prod:
	make env ENV=prod
	make apply-conf
	make end-env
	make apply-env
	make docker ENV=prod
	make cert-gen
	make create

#####
# quich create
#####
qc:
	make init-dev

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
	rm backend/.env
	rm frontend/.env
	rm -f infrastructure/docker/nginx/certs/*
	rm -f infrastructure/docker/pgadmin/servers.json

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