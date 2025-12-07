#!/usr/bin/env bash
set -euo pipefail

# Ensure at least one argument
if [ $# -lt 1 ]; then
    echo "Usage: $0 <action>"
    echo "Actions: create, start, stop, restart, clean, env"
    exit 1
fi

ACTION="$1"

# Determine the compose file from environment variable
if [ -z "${NDCG_COMPOSE_FILE:-}" ]; then
    # Fallback if the wrapper didn't set it
    DOCKER_DIR="$(dirname "$0")/docker"
    NDCG_COMPOSE_FILE="$DOCKER_DIR/docker-compose.yml"
fi

if [ ! -f "$NDCG_COMPOSE_FILE" ]; then
    echo "Error: Docker compose file not found: $NDCG_COMPOSE_FILE"
    exit 1
fi

# Environment check
if [ "$ACTION" = "env" ]; then
    BASENAME=$(basename "$NDCG_COMPOSE_FILE")
    if [[ "$BASENAME" == *"prod"* ]]; then
        echo "Current environment: prod"
    else
        echo "Current environment: dev"
    fi
    exit 0
fi

# Run docker-compose commands from the compose file's directory
DOCKER_DIR="$(dirname "$NDCG_COMPOSE_FILE")"
pushd "$DOCKER_DIR" >/dev/null

########################################
# Section 1: Create containers
########################################
if [ "$ACTION" = "create" ]; then
    echo "Building and creating containers using $(basename "$NDCG_COMPOSE_FILE")..."
    docker compose -f "$NDCG_COMPOSE_FILE" create
    popd >/dev/null
    exit 0
fi

########################################
# Section 2: Start containers
########################################
if [ "$ACTION" = "start" ]; then
    echo "Starting containers using $(basename "$NDCG_COMPOSE_FILE")..."
    docker compose -f "$NDCG_COMPOSE_FILE" start
    popd >/dev/null
    exit 0
fi

########################################
# Section 3: Stop containers
########################################
if [ "$ACTION" = "stop" ]; then
    echo "Stopping containers using $(basename "$NDCG_COMPOSE_FILE")..."
    docker compose -f "$NDCG_COMPOSE_FILE" stop
    popd >/dev/null
    exit 0
fi

########################################
# Section 4: Restart containers
########################################
if [ "$ACTION" = "restart" ]; then
    echo "Restarting containers using $(basename "$NDCG_COMPOSE_FILE")..."
    docker compose -f "$NDCG_COMPOSE_FILE" restart
    popd >/dev/null
    exit 0
fi

########################################
# Section 5: Clean everything
########################################
if [ "$ACTION" = "clean" ]; then
    echo "Stopping containers and removing all volumes using $(basename "$NDCG_COMPOSE_FILE")..."
    docker compose -f "$NDCG_COMPOSE_FILE" down -v --remove-orphans
    popd >/dev/null
    echo "All containers, volumes, and orphaned data removed."
    exit 0
fi

popd >/dev/null
# Unknown action
echo "Unknown action: $ACTION"
echo "Valid actions: create, start, stop, restart, clean, env"
exit 1
