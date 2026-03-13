#!/usr/bin/env bash

set -euo pipefail # propagate failures in pipelines

check() {
    TOOL="$1"
    if command -v "$TOOL" >/dev/null 2>&1; then
        echo "[OK] $TOOL is installed"
    else
        echo "[ERROR] $TOOL is NOT installed"
        MISSING=1
    fi
}

# Function to check if a folder exists
check_folder() {
    DIR="$1"
    if [ -d "$DIR" ]; then
        echo "[OK] Folder '$DIR' exists"
    else
        echo "[ERROR] Folder '$DIR' does NOT exist"
        MISSING=1
    fi
}

MISSING=0

check python3
check docker
check docker compose
check node
check npx
check npm
check pip
check git
check openssl
check yq

check_folder backend
check_folder frontend
check_folder infrastructure
check_folder infrastructure/docker
check_folder infrastructure/docker/nginx
check_folder infrastructure/docker/pgadmin
check_folder infrastructure/env
check_folder infrastructure/scripts

if [ "$MISSING" -eq 1 ]; then
    echo "[ERROR] Please install requirements before continuing."
    exit 1
else
    echo "[SUCCESS] Everythig is ready."
fi
