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

set_env $BACKEND_ENV "DATABASE_URL" "postgres://$POSTGRES_USER:$POSTGRES_PASSWORD@$POSTGRES_HOSTNAME:$EXTERNAL_POSTGRES/$POSTGRES_DB"
set_env $BACKEND_ENV "POSTGRES_USER" "$POSTGRES_USER"
set_env $BACKEND_ENV "POSTGRES_PASSWORD" "$POSTGRES_PASSWORD"
set_env $BACKEND_ENV "POSTGRES_HOSTNAME" "$POSTGRES_HOSTNAME"
set_env $BACKEND_ENV "POSTGRES_PORT" "$EXTERNAL_POSTGRES"
set_env $BACKEND_ENV "POSTGRES_DB" "$POSTGRES_DB"
set_env $BACKEND_ENV "REDIS_HOST" "redis"
set_env $BACKEND_ENV "REDIS_PORT" "$EXTERNAL_REDIS"
set_env $BACKEND_ENV "KEYCLOAK_PORT" "$EXTERNAL_KEYCLOAK"
set_env $BACKEND_ENV "KEYCLOAK_ADMIN" "$KEYCLOAK_ADMIN"
set_env $BACKEND_ENV "KEYCLOAK_ADMIN_PASSWORD" "$KEYCLOAK_ADMIN_PASSWORD"
set_env $BACKEND_ENV "NODE_ENV" "development"