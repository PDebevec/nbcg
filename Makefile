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

########## DESTROY ##########
destroy:
	./scripts/destroy.sh
