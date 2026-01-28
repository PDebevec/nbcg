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

if [ $ENV == "prod" ]; then
    docker compose -f compose/docker-compose.prod.yml stop
    docker compose -f compose/docker-compose.prod.yml down -v --remove-orphans
else
    docker compose -f compose/docker-compose.prod.yml -f compose/docker-compose.dev.yml stop
    docker compose -f compose/docker-compose.prod.yml -f compose/docker-compose.dev.yml down -v --remove-orphans
fi


if [ -f "$PWD/.env" ]; then
    rm "$PWD/.env"

    echo "No evironment!"
fi
