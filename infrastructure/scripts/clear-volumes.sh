#!/usr/bin/env bash
set -euo pipefail

ENV_FILE=".env"
# Load env variables
if [[ -f $ENV_FILE ]]; then
    set -a  # automatically export
    source $ENV_FILE
    set +a
fi

rm -rf "$FILES_DIR"
