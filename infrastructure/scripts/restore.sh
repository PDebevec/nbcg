#!/usr/bin/env bash
# restore.sh
# Restore Docker volumes using restic

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

COMPOSE_FILE=${COMPOSE_FILE:-docker-compose.yml}

# ==============================
# Helper: restore volume
# ==============================
restore_volume() {
    VOLUME_NAME="$1"
    echo "[INFO] Restoring volume: $VOLUME_NAME"

    # Remove existing volume
    docker volume rm "$VOLUME_NAME" >/dev/null 2>&1 || true
    docker volume create "$VOLUME_NAME" >/dev/null 2>&1

    # Restore latest snapshot from restic
    docker run --rm \
        -e RESTIC_PASSWORD="$RESTIC_PASSWORD" \
        -v "$RESTIC_REPO":/repo \
        -v "$VOLUME_NAME":/data \
        restic/restic \
        -r /repo restore latest --target /data --tag "$VOLUME_NAME"
}

# ==============================
# Stop stack
# ==============================
echo "[INFO] Stopping stack..."
docker compose -f "$COMPOSE_FILE" down

# ==============================
# Restore Volumes
# ==============================
# Add your volumes here
restore_volume postgres_data
restore_volume minio_data
restore_volume opensearch_data

# ==============================
# Start stack
# ==============================
echo "[INFO] Starting stack..."
docker compose -f "$COMPOSE_FILE" up -d

echo "[SUCCESS] Restore completed."