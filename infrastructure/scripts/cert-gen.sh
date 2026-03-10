#!/usr/bin/env bash

set -euo pipefail  # stop on errors, undefined vars, or failed pipelines

set -a
source ".env"
set +a

ENV=${ENV:-dev}  # fallback to dev if not set

generate_cert() {
    local TARGET_DIR="$1"
    local CN="$2"
    local DAYS_VALID="${3:-365}"  # default 1 year

    local KEY_FILE="$TARGET_DIR/server.key"
    local CERT_FILE="$TARGET_DIR/server.crt"

    echo "=== Creating certificate directory: $TARGET_DIR ==="
    if [ ! -d "$TARGET_DIR" ]; then
        mkdir -p "$TARGET_DIR"
        echo "[OK] Created $TARGET_DIR"
    else
        echo "[OK] Directory already exists"
    fi

    echo "=== Generating private key ==="
    openssl genrsa -out "$KEY_FILE" 4096
    echo "[OK] Key generated at $KEY_FILE"

    echo "=== Generating self-signed certificate ==="
    openssl req -new -x509 \
        -key "$KEY_FILE" \
        -out "$CERT_FILE" \
        -days "$DAYS_VALID" \
        -subj "/C=ME/ST=State/L=City/O=NBCG/OU=IT/CN=$CN"
    echo "[OK] Certificate generated at $CERT_FILE"

    chmod 600 "$KEY_FILE"
    chmod 644 "$CERT_FILE"

    echo "[SUCCESS] Certificate ready:"
    echo "  Key:  $KEY_FILE"
    echo "  Cert: $CERT_FILE"
}

generate_cert "infrastructure/docker/nginx/certs/" "nbcg.local"

# Decide paths based on environment
if [ "$ENV" = "prod" ]; then
    generate_cert "infrastructure/docker/keycloak/" "kc.nbcg.local"
fi
