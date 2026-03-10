#!/usr/bin/env bash

set -euo pipefail

ENVIRONMENT="${1:-}"
ENV_DIR="infrastructure/env"
OUTPUT_FILE=".env"

########################################
# Helpers
########################################

usage() {
  echo "Usage: ./scripts/generate-env.sh [dev|prod]"
  exit 1
}

reset_env_file() {
  rm -f "$OUTPUT_FILE"
  touch "$OUTPUT_FILE"
}

append_file() {
  local file="$1"
  cat "$file" >> "$OUTPUT_FILE"
  echo "" >> "$OUTPUT_FILE"
}

generate_secret() {
  openssl rand -base64 32 | tr -d '\n'
}

append_prod_secrets() {
  cat >> "$OUTPUT_FILE" <<EOF

# ===== GENERATED SECRETS =====
POSTGRES_PASSWORD=$(generate_secret)
KEYCLOAK_POSTGRES_PASSWORD=$(generate_secret)
KEYCLOAK_ADMIN_PASSWORD=$(generate_secret)
PGADMIN_DEFAULT_PASSWORD=$(generate_secret)
OPENSEARCH_INITIAL_ADMIN_PASSWORD=$(generate_secret)
EOF
}

generate_dev() {
  append_file "$ENV_DIR/.env.shared"
  append_file "$ENV_DIR/.env.dev"
  echo "Development .env generated"
}

generate_prod() {
  append_file "$ENV_DIR/.env.shared"
  append_file "$ENV_DIR/.env.prod"
  append_prod_secrets
  echo "Production .env generated"
  echo "Store this file securely and DO NOT commit it."
}

########################################
# Main
########################################

if [[ -z "$ENVIRONMENT" ]]; then
  usage
fi

reset_env_file

echo "Generating .env for environment: $ENVIRONMENT"

case "$ENVIRONMENT" in
  dev)
    echo "ENV=$ENVIRONMENT" >> .env
    generate_dev
    ;;
  prod)
    echo "ENV=$ENVIRONMENT" >> .env
    generate_prod
    ;;
  *)
    usage
    ;;
esac