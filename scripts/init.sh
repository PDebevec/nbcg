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
    printf "This will override current ENVironment file! Continue? (Y/n): "
    read confirm || exit 1

    case "${confirm:-}" in
        ""|y|Y)
            ;;
        *)
            exit 1
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
    
ENV=dev
EOF

##### PRODUCTION #####
elif [ $1 == "prod" ]; then
    echo "PRODuction"

    ##### ENV #####
    cp "$PWD/env/.env.template" "$PWD/.env"
    cat >> "$PWD/.env" << EOF

ENV=prod

OPENSEARCH_SECURITY_SSL_HTTP_ENABLED=true
OPENSEARCH_SECURITY_SSL_TRANSPORT_ENABLED=true

POSTGRES_PASSWORD=$(tr -dc 'A-Za-z0-9!?%=' < /dev/urandom | head -c 16)
PGADMIN_DEFAULT_PASSWORD=$(tr -dc 'A-Za-z0-9!?%=' < /dev/urandom | head -c 16)
MINIO_ROOT_PASSWORD=$(tr -dc 'A-Za-z0-9!?%=' < /dev/urandom | head -c 16)
OPENSEARCH_INITIAL_ADMIN_PASSWORD=$(tr -dc 'A-Za-z0-9!?%=' < /dev/urandom | head -c 16)
KEYCLOAK_PASSWORD=$(tr -dc 'A-Za-z0-9!?%=' < /dev/urandom | head -c 16)
EOF

    ##### DOCKER #####
    cat >> "$PWD/.env" <<EOF
    
DOCKER_FILES=docker-compose.prod.yml
EOF
    
else
    echo "Incorrect environment specified or non given!"
fi

cd "$PWD/frontend"
npm install

cd "$PWD/backend"
npm install
