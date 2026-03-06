#!/usr/bin/env bash
set -euo pipefail

ENV_FILE=".env"
# Load env variables
if [[ -f $ENV_FILE ]]; then
    set -a  # automatically export
    source $ENV_FILE
    set +a
fi

BACKEND_ENV="backend/.env"
FRONTEND_ENV="frontend/.env"

touch $BACKEND_ENV
touch $FRONTEND_ENV

set_env() {
    local env="$1"
    local key="$2"
    local value="$3"

    if grep -qE "^$key=" "$env" 2>/dev/null; then
        # Key exists → replace
        sed -i "s|^$key=.*|$key=$value|" "$env"
    else
        # Key does not exist → append
        echo "$key=$value" >> "$env"
    fi
}

set_env $BACKEND_ENV "DATABASE_URL" "$POSTGRES_USER:$POSTGRES_PASSWORD@$HOSTNAME:$POSTGRES_PORT/$POSTGRES_DB"