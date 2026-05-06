#!/usr/bin/env bash
set -euo pipefail

CONFIG="config.yml"

if [[ ! -f $CONFIG ]]; then 
    if [[ -f "config.template.yml" ]]; then
        cp config.template.yml $CONFIG
    else
        echo "config template file is missing!"
        exit 1
    fi
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

# get variable from confg
BASE_DIR="$(yq -r '.zfs.base' "$CONFIG")"
FILES_DIR="${BASE_DIR}files/"
BACKUP_DIR="${BASE_DIR}backup/"

# Create directories if they don't exist
mkdir -p "$BASE_DIR" "$FILES_DIR" "$BACKUP_DIR"

# Set direcotry env variables
set_env "BASE_DIR" "$BASE_DIR"
set_env "FILES_DIR" "$FILES_DIR"
set_env "BACKUP_DIR" "$BACKUP_DIR"

# set SeaWeedFS env variables
set_env "EXTERNAL_SEAWEEDFS_MASTER_P1" "$(yq -r '.ports.seaweedfs-master-p1' $CONFIG)"
set_env "EXTERNAL_SEAWEEDFS_MASTER_P2" "$(yq -r '.ports.seaweedfs-master-p2' $CONFIG)"
set_env "EXTERNAL_SEAWEEDFS_MASTER_P3" "$(yq -r '.ports.seaweedfs-master-p3' $CONFIG)"
set_env "EXTERNAL_SEAWEEDFS_VOLUME_P1" "$(yq -r '.ports.seaweedfs-volume-p1' $CONFIG)"
set_env "EXTERNAL_SEAWEEDFS_VOLUME_P2" "$(yq -r '.ports.seaweedfs-volume-p2' $CONFIG)"
set_env "EXTERNAL_SEAWEEDFS_VOLUME_P3" "$(yq -r '.ports.seaweedfs-volume-p3' $CONFIG)"
set_env "EXTERNAL_SEAWEEDFS_FILER_P1" "$(yq -r '.ports.seaweedfs-filer-p1' $CONFIG)"
set_env "EXTERNAL_SEAWEEDFS_FILER_P2" "$(yq -r '.ports.seaweedfs-filer-p2' $CONFIG)"
set_env "EXTERNAL_SEAWEEDFS_FILER_P3" "$(yq -r '.ports.seaweedfs-filer-p3' $CONFIG)"
set_env "EXTERNAL_SEAWEEDFS_S3_P1" "$(yq -r '.ports.seaweedfs-s3-p1' $CONFIG)"
set_env "EXTERNAL_SEAWEEDFS_S3_P2" "$(yq -r '.ports.seaweedfs-s3-p2' $CONFIG)"
set_env "EXTERNAL_SEAWEEDFS_WEBDAV" "$(yq -r '.ports.seaweedfs-webdav' $CONFIG)"

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
