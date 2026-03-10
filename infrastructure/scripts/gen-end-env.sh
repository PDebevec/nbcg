#!/usr/bin/env bash
set -euo pipefail

ENV_FILE=".env"
CONFIG="config.yml"

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

if [ "$ENV" = "prod" ]; then
    set_env $BACKEND_ENV "DATABASE_URL" "postgres://$POSTGRES_USER:$POSTGRES_PASSWORD@$POSTGRES_HOSTNAME:$INTERNAL_POSTGRES/$POSTGRES_DB"
    set_env $BACKEND_ENV "POSTGRES_USER" "$POSTGRES_USER"
    set_env $BACKEND_ENV "POSTGRES_PASSWORD" "$POSTGRES_PASSWORD"
    set_env $BACKEND_ENV "POSTGRES_HOSTNAME" "$POSTGRES_HOSTNAME"
    set_env $BACKEND_ENV "POSTGRES_PORT" "$INTERNAL_POSTGRES"
    set_env $BACKEND_ENV "POSTGRES_DB" "$POSTGRES_DB"
    set_env $BACKEND_ENV "REDIS_HOST" "$REDIS_HOSTNAME"
    set_env $BACKEND_ENV "REDIS_PORT" "$INTERNAL_REDIS"
    set_env $BACKEND_ENV "KEYCLOAK_PORT" "$INTERNAL_KEYCLOAK"
    set_env $BACKEND_ENV "KEYCLOAK_ADMIN" "$KEYCLOAK_ADMIN"
    set_env $BACKEND_ENV "KEYCLOAK_ADMIN_PASSWORD" "$KEYCLOAK_ADMIN_PASSWORD"
    set_env $BACKEND_ENV "OPENSEARCH_NODE_P1" "$INTERNAL_OPENSEARCH_NODE_P1"
    set_env $BACKEND_ENV "OPENSEARCH_HOSTNAME" "$OPENSEARCH_HOSTNAME"
    set_env $BACKEND_ENV "NODE_ENV" "production"
    set_env $BACKEND_ENV "COBISS_TOKEN" "$(yq -r '.external.cobiss-token' $CONFIG)"
elif [ "$ENV" = "dev" ]; then
    set_env $BACKEND_ENV "DATABASE_URL" "postgres://$POSTGRES_USER:$POSTGRES_PASSWORD@$HOSTNAME:$EXTERNAL_POSTGRES/$POSTGRES_DB"
    set_env $BACKEND_ENV "POSTGRES_USER" "$POSTGRES_USER"
    set_env $BACKEND_ENV "POSTGRES_PASSWORD" "$POSTGRES_PASSWORD"
    set_env $BACKEND_ENV "POSTGRES_HOSTNAME" "$HOSTNAME"
    set_env $BACKEND_ENV "POSTGRES_PORT" "$EXTERNAL_POSTGRES"
    set_env $BACKEND_ENV "POSTGRES_DB" "$POSTGRES_DB"
    set_env $BACKEND_ENV "REDIS_HOST" "$HOSTNAME"
    set_env $BACKEND_ENV "REDIS_PORT" "$EXTERNAL_REDIS"
    set_env $BACKEND_ENV "KEYCLOAK_PORT" "$EXTERNAL_KEYCLOAK"
    set_env $BACKEND_ENV "KEYCLOAK_ADMIN" "$KEYCLOAK_ADMIN"
    set_env $BACKEND_ENV "KEYCLOAK_ADMIN_PASSWORD" "$KEYCLOAK_ADMIN_PASSWORD"
    set_env $BACKEND_ENV "OPENSEARCH_NODE_P1" "$EXTERNAL_OPENSEARCH_NODE_P1"
    set_env $BACKEND_ENV "OPENSEARCH_HOSTNAME" "$HOSTNAME"
    set_env $BACKEND_ENV "NODE_ENV" "development"
else
    exho "ENV is ont set correctly!"
    exit 1
fi
