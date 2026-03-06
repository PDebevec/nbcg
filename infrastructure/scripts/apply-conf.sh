#!/usr/bin/env bash
set -euo pipefail

CONFIG="./config.yml"
ENV_FILE="./.env"

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

# Read values from YAML
HOST_FRONTEND=$(yq -r '.hostnames.frontend' $CONFIG)$(yq -r '.hostnames.fqdn' $CONFIG)
HOST_API=$(yq -r '.hostnames.api' $CONFIG)$(yq -r '.hostnames.fqdn' $CONFIG)
HOST_AUTH=$(yq -r '.hostnames.keycloak' $CONFIG)$(yq -r '.hostnames.fqdn' $CONFIG)
HOST_SEARCH=$(yq -r '.hostnames.opensearch' $CONFIG)$(yq -r '.hostnames.fqdn' $CONFIG)

EXTERNAL_PGADMIN=$(yq -r '.ports.pgadmin' $CONFIG)
EXTERNAL_DB=$(yq -r '.ports.metadata-db' $CONFIG)
EXTERNAL_KEYCLOAK_DB=$(yq -r '.ports.keycloak-db' $CONFIG)
EXTERNAL_KEYCLOAK=$(yq -r '.ports.keycloak' $CONFIG)
EXTERNAL_OPENSEARCH_NODE_P1=$(yq -r '.ports.opensearch-node-p1' $CONFIG)
EXTERNAL_OPENSEARCH_NODE_P2=$(yq -r '.ports.opensearch-node-p2' $CONFIG)
EXTERNAL_OPENSEARCH_DASHBOARDS=$(yq -r '.ports.opensearch-dashboards' $CONFIG)

# Replace or add
set_env "HOST_FRONTEND" "$HOST_FRONTEND"
set_env "HOST_API" "$HOST_API"
set_env "HOST_AUTH" "$HOST_AUTH"
set_env "HOST_SEARCH" "$HOST_SEARCH"

set_env "EXTERNAL_PGADMIN" "$EXTERNAL_PGADMIN"
set_env "EXTERNAL_DB" "$EXTERNAL_DB"
set_env "EXTERNAL_KEYCLOAK_DB" "$EXTERNAL_KEYCLOAK_DB"
set_env "EXTERNAL_KEYCLOAK" "$EXTERNAL_KEYCLOAK"
set_env "EXTERNAL_OPENSEARCH_NODE_P1" "$EXTERNAL_OPENSEARCH_NODE_P1"
set_env "EXTERNAL_OPENSEARCH_NODE_P2" "$EXTERNAL_OPENSEARCH_NODE_P2"
set_env "EXTERNAL_OPENSEARCH_DASHBOARDS" "$EXTERNAL_OPENSEARCH_DASHBOARDS"
