#!/usr/bin/env bash

set -euo pipefail  # propagate failures in pipelines

# ==============================
# Load environment
# ==============================

ENV_FILE=".env"

if [ ! -f "$ENV_FILE" ]; then
    echo "[ERROR] .env file not found"
    exit 1
fi

set -a
. "$ENV_FILE"
set +a

if [ -z "$RESTIC_REPO" ] || [ -z "$RESTIC_PASSWORD" ]; then
    echo "[ERROR] RESTIC_REPO or RESTIC_PASSWORD not set in .env"
    exit 1
fi

DATE=$(date +%Y-%m-%d_%H-%M-%S)
LOG_FILE="/var/log/library_backup.log"

# ==============================
# Helper: run restic container
# ==============================

run_restic() {
    docker run --rm \
        -e RESTIC_PASSWORD="$RESTIC_PASSWORD" \
        -v "$RESTIC_REPO":/repo \
        -v "$1":/data:ro \
        restic/restic \
        -r /repo backup /data
}

# ==============================
# Backup Functions
# ==============================

backup_volume() {
    VOLUME_NAME="$1"

    echo "[INFO] Backing up volume: $VOLUME_NAME"

    docker run --rm \
        -e RESTIC_PASSWORD="$RESTIC_PASSWORD" \
        -v "$RESTIC_REPO":/repo \
        -v "$VOLUME_NAME":/data:ro \
        restic/restic \
        -r /repo backup /data --tag "$VOLUME_NAME"
}

# ==============================
# Initialize repo if needed
# ==============================

if [ ! -d "$RESTIC_REPO" ]; then
    echo "[INFO] Creating restic repository..."
    mkdir -p "$RESTIC_REPO"

    docker run --rm \
        -e RESTIC_PASSWORD="$RESTIC_PASSWORD" \
        -v "$RESTIC_REPO":/repo \
        restic/restic \
        -r /repo init
fi

# ==============================
# Stop stack
# ==============================

echo "[INFO] Stopping stack..."
docker compose -f "$COMPOSE_FILE" stop

# ==============================
# Backup volumes (ADD HERE)
# ==============================

backup_volume postgres_data
backup_volume minio_data
backup_volume opensearch_data
backup_volume keycloak_data

# ==============================
# Retention Policy
# ==============================

echo "[INFO] Applying retention policy..."

docker run --rm \
    -e RESTIC_PASSWORD="$RESTIC_PASSWORD" \
    -v "$RESTIC_REPO":/repo \
    restic/restic \
    -r /repo forget --keep-daily 7 --keep-weekly 4 --prune

# ==============================
# Start stack
# ==============================

# echo "[INFO] Starting stack..."
# docker compose -f "$COMPOSE_FILE" up -d

echo "[SUCCESS] Backup completed at $DATE"