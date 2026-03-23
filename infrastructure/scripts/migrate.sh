#!/bin/bash

set -euo pipefail  # propagate failures in pipelines

ENV_FILE=".env"
# Load env variables
if [[ -f $ENV_FILE ]]; then
    set -a  # automatically export
    source $ENV_FILE
    set +a
fi

# Function to check if PostgreSQL is ready
check_postgres() {
    docker compose exec db pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}
}

check_backend() {
    curl http://localhost:$BACKEND_PORT/health > /dev/null 2>&1
}

# Loop until PostgreSQL is ready
until check_postgres; do
    echo "Waiting for PostgreSQL to become available..."
    sleep 5
done

echo "PostgreSQL is ready!"

if [ $ENV == 'prod' ]; then
    until check_backend; do
        echo "Waiting for backend to become available..."
        sleep 5
    done

    echo "Migrating database scheme in production."
    docker compose -f docker-compose.yml -f docker-compose.ext.yml exec backend npx prisma migrate deploy
else
    echo "Migrating database scheme in dev env."
    cd backend/ && npx prisma migrate deploy
fi
