#!/usr/bin/env bash
set -euo pipefail

CONFIG="config.template.yml"

if [[ -f $CONFIG ]]; then
    cp $CONFIG 'config.yml'
else
    echo "config template file is missing!"
    exit 1
fi

ENV_FILE=".env"
# Load env variables
if [[ -f $ENV_FILE ]]; then
    set -a  # automatically export
    source $ENV_FILE
    set +a
fi

# Function to set or replace a key in .env file
set_env() {
    local key="$1"
    local value="$2"

    if grep -qE "^$key=" "$ENV_FILE" 2>/dev/null; then
        # Key exists → replace
        sed -i "s|^$key=.*|$key=$value|" "$ENV_FILE"
    else
        # Key does not exist → append
        echo "$key=$value" >> "$ENV_FILE"
    fi
}

# Ensure .env file exists
touch "$ENV_FILE"

set_env "BASE_DIR" "$(yq -r '.zfs.base' $CONFIG)"
set_env "FILES_DIR" "$(yq -r '.zfs.base' $CONFIG)files/"
set_env "BACKUP_DIR" "$(yq -r '.zfs.base' $CONFIG)backup/"

if [ "$ENV" = "prod" ]; then
    # Replace or add
    set_env "HOST_FRONTEND" "$(yq -r '.hostnames.frontend' $CONFIG)$(yq -r '.hostnames.fqdn' $CONFIG)"
    set_env "HOST_API" "$(yq -r '.hostnames.api' $CONFIG)$(yq -r '.hostnames.fqdn' $CONFIG)"
    set_env "HOST_AUTH" "$(yq -r '.hostnames.keycloak' $CONFIG)$(yq -r '.hostnames.fqdn' $CONFIG)"
    set_env "HOST_SEARCH" "$(yq -r '.hostnames.opensearch' $CONFIG)$(yq -r '.hostnames.fqdn' $CONFIG)"
elif [ "$ENV" = "dev" ]; then
    set_env "EXTERNAL_PGADMIN" "$(yq -r '.ports.pgadmin' $CONFIG)"
    set_env "EXTERNAL_POSTGRES" "$(yq -r '.ports.metadata-db' $CONFIG)"
    set_env "EXTERNAL_REDIS" "$(yq -r '.ports.redis-db' $CONFIG)"
    set_env "EXTERNAL_KEYCLOAK_DB" "$(yq -r '.ports.keycloak-db' $CONFIG)"
    set_env "EXTERNAL_KEYCLOAK" "$(yq -r '.ports.keycloak' $CONFIG)"
    set_env "EXTERNAL_OPENSEARCH_NODE_P1" "$(yq -r '.ports.opensearch-node-p1' $CONFIG)"
    set_env "EXTERNAL_OPENSEARCH_NODE_P2" "$(yq -r '.ports.opensearch-node-p2' $CONFIG)"
    set_env "EXTERNAL_OPENSEARCH_DASHBOARDS" "$(yq -r '.ports.opensearch-dashboards' $CONFIG)"
else
    echo "ENV variable incorectly set. Must be =dev or =prod"
    exit 1
fi
