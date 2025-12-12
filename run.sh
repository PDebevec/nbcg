#!/usr/bin/env bash
set -euo pipefail

########################################
# Validate project directory structure
########################################

PROJECT_ROOT="$(dirname "$(realpath "$0")")"

cd "$PROJECT_ROOT"

# Required files
REQUIRED_FILES=(
    "run.sh"
    ".env.environment"
)

# Required directories
REQUIRED_DIRS=(
    "docker"
    "frontend"
)

# Check files
for file in "${REQUIRED_FILES[@]}"; do
    if [ ! -f "$PROJECT_ROOT/$file" ]; then
        echo "ERROR: Required file missing: $file"
        echo "Make sure you are running this script from the project root."
        exit 1
    fi
done

# Check directories
for dir in "${REQUIRED_DIRS[@]}"; do
    if [ ! -d "$PROJECT_ROOT/$dir" ]; then
        echo "ERROR: Required directory missing: $dir/"
        echo "Make sure you are running this script from the project root."
        exit 1
    fi
done

########################################
# Validate args
########################################
if [ $# -lt 1 ]; then
    echo "Usage: $0 <action>"
    echo ""
    echo "Docker actions:  create, start, stop, restart, clean"
    echo "Environment:     env"
    exit 1
fi

ACTION="$1"

########################################
# Resolve environment & compose file
########################################
# If wrapper didn't set NDCG_COMPOSE_FILE, fallback to dev
if [ -z "${NDCG_COMPOSE_FILE:-}" ]; then
    DOCKER_DIR="$(dirname "$0")/docker"
    NDCG_COMPOSE_FILE="$DOCKER_DIR/docker-compose.yml"
fi

if [ ! -f "$NDCG_COMPOSE_FILE" ]; then
    echo "Error: Docker compose file not found: $NDCG_COMPOSE_FILE"
    exit 1
fi

# Determine environment from compose file
ENV="dev"
if [[ "$(basename "$NDCG_COMPOSE_FILE")" == *prod* ]]; then
    ENV="prod"
fi

########################################
# Environment info
########################################
if [ "$ACTION" = "env" ]; then
    echo "Current environment: $ENV"
    exit 0
fi

########################################
# Switch to docker directory
########################################
DOCKER_DIR="$(dirname "$NDCG_COMPOSE_FILE")"
pushd "$DOCKER_DIR" >/dev/null

echo "Using compose file: $(basename "$NDCG_COMPOSE_FILE")"

############################################################
# DOCKER + FRONTEND ACTIONS
############################################################
FRONTEND_DIR="../frontend"

case "$ACTION" in

    create)
        echo "Creating & building Docker containers..."
        docker compose -f "$NDCG_COMPOSE_FILE" create
        ;;

    start)
        echo "Starting Docker containers..."
        docker compose -f "$NDCG_COMPOSE_FILE" start

        if [ "$ENV" = "dev" ]; then
            echo "Starting frontend (Quasar dev) using PM2..."
            pushd "$FRONTEND_DIR" >/dev/null

            # Start Quasar dev in background under PM2
            pm2 start "npx quasar dev" --name quasar-dev || true

            popd >/dev/null
        fi
        ;;

    stop)
        echo "Stopping Docker containers..."
        docker compose -f "$NDCG_COMPOSE_FILE" stop

        if [ "$ENV" = "dev" ]; then
            echo "Stopping frontend (PM2 Quasar)..."
            pushd "$FRONTEND_DIR" >/dev/null
            pm2 stop quasar-dev 2>/dev/null || echo "Frontend not running"
            popd >/dev/null
        fi
        ;;

    restart)
        echo "Restarting Docker containers..."
        docker compose -f "$NDCG_COMPOSE_FILE" restart

        if [ "$ENV" = "dev" ]; then
            echo "Restarting frontend (PM2 Quasar)..."
            pm2 restart quasar-dev 2>/dev/null || {
                echo "Frontend was not running — starting it now"
                pushd "$FRONTEND_DIR" >/dev/null
                pm2 start "npx quasar dev" --name quasar-dev
                popd >/dev/null
            }
        fi
        ;;

    clean)
        echo "Removing Docker containers, volumes & orphans..."
        docker compose -f "$NDCG_COMPOSE_FILE" down -v --remove-orphans
        echo "Docker environment fully cleaned."

        if [ "$ENV" = "dev" ]; then
            echo "Stopping frontend (PM2 Quasar)..."
            pushd "$FRONTEND_DIR" >/dev/null
            pm2 stop quasar-dev 2>/dev/null || echo "Frontend not running"
            pm2 delete quasar-dev 2>/dev/null || true
            popd >/dev/null
        fi
        ;;

    *)
        echo "Unknown action: $ACTION"
        echo "Valid docker actions: create, start, stop, restart, clean, env"
        exit 1
        ;;
esac

popd >/dev/null
exit 0
