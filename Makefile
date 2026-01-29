.PHONY: init start stop restart reset logs


########## AFTER GIT PULL ##########
init:
	./scripts/init.sh $(ENV)

########## BUILD / CREATE ##########
create:
	./scripts/create.sh

########## START ##########
start:
	./scripts/start.sh

########## STOP ##########
stop:
	./scripts/stop.sh

########## RESTART ##########
restart:
	./scripts/restart.sh

########## STATUS ##########
status:
	./scripts/status.sh

########## DESTROY ##########
destroy:
	./scripts/destroy.sh

########## RELOAD ##########
reload:
	./scripts/destroy.sh
	./scripts/create.sh
	./scripts/start.sh

########## QUICKSTART ##########
qs:
	./scripts/init.sh dev
	./scripts/create.sh
	./scripts/start.sh
