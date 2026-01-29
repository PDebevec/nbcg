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

docker system prune -f --volumes

docker compose -f docker-compose.yml -f compose/docker-compose.$ENV.yml stop
docker compose -f docker-compose.yml -f compose/docker-compose.$ENV.yml down -v --remove-orphans


STAGE=$(( ${STAGE:-0} - 1 ))

tmp=$(mktemp)
grep -v '^STAGE=' "$ENV_FILE" > "$tmp"
echo "STAGE=$STAGE" >> "$tmp"
mv "$tmp" "$ENV_FILE"

# if [ -f "$PWD/.env" ]; then
#     rm "$PWD/.env"

#     echo "evironment cleared"
# fi
