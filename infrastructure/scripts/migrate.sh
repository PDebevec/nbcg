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
    docker exec nbcg-db-1 pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}
}

# Loop until PostgreSQL is ready
until check_postgres; do
    echo "Waiting for PostgreSQL to become available..."
    sleep 5
done

echo "PostgreSQL is ready!"

# Execute the desired command
# docker compose -f docker-compose.yml -f docker-compose.ext.yml exec backend npx prisma migrate deploy
cd backend/ && npx prisma migrate deploy
