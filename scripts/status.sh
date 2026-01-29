#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="$PWD/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE"
  exit 1
fi

set -a
. "$ENV_FILE"
set +a

if [ ! $STAGE = 2 ]; then
    echo 'make create befor starting services'
    exit 2
fi

##### DOCKER #####
docker compose ps -a