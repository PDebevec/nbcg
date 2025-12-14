#!/usr/bin/env bash
set -euo pipefail

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
BACKEND_DIR="../backend"

case "$ACTION" in

    create)
        echo "Creating & building Docker containers..."
        docker compose -f "$NDCG_COMPOSE_FILE" create

        if [ "$ENV" = "prod" ]; then
            echo "Building frontend..."
            pushd "$FRONTEND_DIR" >/dev/null
            npx quasar build || true
            popd >/dev/null

            echo "Building backend..."
            pushd "$BACKEND_DIR" >/dev/null
            npm run build || true
            popd >/dev/null
        fi

        ;;

    start)
        echo "Starting Docker containers..."
        docker compose -f "$NDCG_COMPOSE_FILE" start

        if [ "$ENV" = "dev" ]; then
            echo "Starting frontend (Quasar dev) using PM2..."
            pushd "$FRONTEND_DIR" >/dev/null
            pm2 start frontend || {
                pm2 start "npx quasar dev" --name frontend
            } || true
            popd >/dev/null

            pushd "$BACKEND_DIR" >/dev/null
            pm2 start backend || {
                pm2 start "node ./dist/index.js" --name backend
            } || true
            popd >/dev/null
        fi

        ;;

    stop)
        echo "Stopping Docker containers..."
        docker compose -f "$NDCG_COMPOSE_FILE" stop

        if [ "$ENV" = "dev" ]; then
            echo "Stopping frontend (PM2 Quasar)..."
            pushd "$FRONTEND_DIR" >/dev/null
            pm2 stop frontend 2>/dev/null || echo "Frontend not running"
            popd >/dev/null

            pushd "$BACKEND_DIR" >/dev/null
            pm2 stop backend || echo "Backend not running"
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

            pm2 restart backend 2>/dev/null || {
                echo "Backend was not running — starting it now"
                pushd "$BACKEND_DIR" >/dev/null
                pm2 start "node ./dist/index.js" --name quasar-dev
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
            pm2 stop frontend 2>/dev/null || echo "Frontend not running"
            pm2 delete frontend 2>/dev/null || true
            popd >/dev/null

            echo "Stopping frontend (PM2 Quasar)..."
            pushd "$BACKEND_DIR" >/dev/null
            pm2 stop backend 2>/dev/null || echo "Frontend not running"
            pm2 delete backend 2>/dev/null || true
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
