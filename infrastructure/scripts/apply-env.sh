#!/usr/bin/env bash
set -euo pipefail

ENV_FILE=".env"
# Load env variables
if [[ -f $ENV_FILE ]]; then
    set -a  # automatically export
    source $ENV_FILE
    set +a
fi

# -----------------------------------------------------------------------------
# Function: apply_env_to_file
# Arguments:
#   1 - input file with placeholders like $(VAR_NAME)
#   2 - output file with env values applied
# -----------------------------------------------------------------------------
apply_env_to_file() {
    local input_file="$1"
    local output_file="$2"

    if [[ ! -f "$input_file" ]]; then
        echo "Error: input file '$input_file' does not exist"
        return 1
    fi

    # Replace all $(VAR_NAME) with the actual environment variable
    # - Use envsubst-like behavior, but allow $(VAR) syntax
    # - We temporarily convert $(VAR) -> ${VAR} for envsubst
    sed 's/\$(\([A-Z0-9_]\+\))/${\1}/g' "$input_file" | envsubst > "$output_file"

    echo "Generated $output_file from $input_file"
}

apply_env_to_file "./infrastructure/docker/pgadmin/servers.conf.json" "./infrastructure/docker/pgadmin/servers.json"

