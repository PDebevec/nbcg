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

