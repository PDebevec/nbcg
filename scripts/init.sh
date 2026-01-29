#!/usr/bin/env bash
set -euo pipefail

########################################
# Ensure requirements
########################################
command -v git >/dev/null 2>&1 || { echo "Git not installed"; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "Docker not installed"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "Node not installed"; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "npm not installed"; exit 1; }
command -v npx >/dev/null 2>&1 || { echo "npx not installed"; exit 1; }


##### pull latest git changes ####
# command git pull >/dev/null 2>&1 || { echo "git pull errored"; exit 1; }

if [ -f "$PWD/.env" ]; then
    ENV_FILE="$PWD/.env"

    if [ ! -f "$ENV_FILE" ]; then
        echo "Missing $ENV_FILE"
        exit 1
    fi

    set -a
    . "$ENV_FILE"
    set +a

    if [ $STAGE  -gt 1 ]; then
        echo 'Make destroy before making new environment'
        exit 2
    fi

    printf "This will override current ENVironment file! Continue? (Y/n): "
    read confirm || exit 3

    case "${confirm:-}" in
        ""|y|Y)
            ;;
        *)
            exit 4
            ;;
    esac
fi

##### DEVELOPMENT #####
if [ $1 == "dev" ]; then
    echo "DEVelopment"
    
    ##### ENV #####
    cp "$PWD/env/.env.template" "$PWD/.env"
    cat "$PWD/env/.env.dev" >> "$PWD/.env"

    ##### DOCKER #####
    cat >> "$PWD/.env" <<EOF

STAGE=1

ENV=dev
EOF

##### PRODUCTION #####
elif [ $1 == "prod" ]; then
    echo "PRODuction"

    ##### ENV #####
    cp "$PWD/env/.env.template" "$PWD/.env"
    cat >> "$PWD/.env" << EOF

STAGE=1

ENV=prod

OPENSEARCH_SECURITY_SSL_HTTP_ENABLED=true
OPENSEARCH_SECURITY_SSL_TRANSPORT_ENABLED=true

POSTGRES_PASSWORD=$(tr -dc 'A-Za-z0-9!?%=' < /dev/urandom | head -c 16)
PGADMIN_DEFAULT_PASSWORD=$(tr -dc 'A-Za-z0-9!?%=' < /dev/urandom | head -c 16)
MINIO_ROOT_PASSWORD=$(tr -dc 'A-Za-z0-9!?%=' < /dev/urandom | head -c 16)
OPENSEARCH_INITIAL_ADMIN_PASSWORD=$(tr -dc 'A-Za-z0-9!?%=' < /dev/urandom | head -c 16)
KEYCLOAK_PASSWORD=$(tr -dc 'A-Za-z0-9!?%=' < /dev/urandom | head -c 16)
EOF
    
else
    echo "Incorrect environment specified or non given!"
fi

git pull
