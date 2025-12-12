#!/usr/bin/env bash
set -euo pipefail

########################################
# Ensure requirements
########################################
command -v git >/dev/null 2>&1 || { echo "Git not installed"; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "Docker not installed"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "Node not installed"; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "npm not installed"; exit 1; }
command -v npx >/dev/null 2>&1 || { echo "npx not installed"; exit 1; }

########################################
# Parse arguments
########################################
if [ $# -lt 1 ]; then
    echo "Usage:"
    echo "  $0 <dev|prod> [command]         # initialize + install command"
    echo "  $0 rm <command>                 # remove installed command"
    exit 1
fi

MODE="$1"
CMD="${2:-}"

ENV_FILE=".env.environment"
PROJECT_DIR="$(pwd)"
RUN_SCRIPT="$PROJECT_DIR/run.sh"

DOCKER_DIR="./docker"
VOLUME_DIR="$DOCKER_DIR/volumes"

########################################
# Command uninstallation
########################################
if [ "$MODE" = "rm" ]; then
    if [ -z "$CMD" ]; then
        echo "Error: rm requires a command name."
        echo "Usage: $0 rm <command>"
        exit 1
    fi

    WRAPPER="$HOME/.local/bin/$CMD"

    if [ -f "$WRAPPER" ]; then
        rm -f "$WRAPPER"
        echo "Removed command '$CMD'."
    else
        echo "Command '$CMD' not found; nothing to remove."
    fi

    exit 0
fi

########################################
# Validate environment mode
########################################
if [[ "$MODE" != "dev" && "$MODE" != "prod" ]]; then
    echo "Error: environment must be 'dev' or 'prod'."
    exit 1
fi

########################################
# Prevent double initialization
########################################
if [ -f "$ENV_FILE" ]; then
    EXISTING_ENV=$(cat "$ENV_FILE")

    if [ "$EXISTING_ENV" != "$MODE" ]; then
        echo "ERROR: already initialized for '$EXISTING_ENV'."
        echo "Cannot reinitialize as '$MODE'. Delete $ENV_FILE to force."
        exit 1
    fi
else
    echo "$MODE" > "$ENV_FILE"
    mkdir -p "$VOLUME_DIR"
    echo "Environment '$MODE' initialized."
fi

########################################
# Optional: install command
########################################
if [ -n "$CMD" ]; then
    WRAPPER="$HOME/.local/bin/$CMD"

    # Ensure directory exists
    mkdir -p "$HOME/.local/bin"

    # Add PATH if needed
    if [[ ":$PATH:" != *":$HOME/.local/bin:"* ]]; then
        if [ -n "${BASH_VERSION:-}" ]; then
            echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.bashrc"
        elif [ -n "${ZSH_VERSION:-}" ]; then
            echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.zshrc"
        fi
        export PATH="$HOME/.local/bin:$PATH"
    fi

    # Prevent overwrite with different environment
    if [ -f "$WRAPPER" ]; then
        BAKED_ENV=$(grep -oP '(?<=NDCG_ENV=").*?(?=")' "$WRAPPER" || echo "")

        if [ "$BAKED_ENV" != "$MODE" ]; then
            echo "Error: command already installed for '$BAKED_ENV'."
            exit 1
        else
            echo "Command '$CMD' already installed for '$MODE'. Nothing to do."
            exit 0
        fi
    fi

    ########################################
    # Install
    ########################################
    if [ ! -f "$RUN_SCRIPT" ]; then
        echo "Error: run.sh not found in $PROJECT_DIR"
        exit 1
    fi

    ########################################
    # Install frontend + backend dependencies
    ########################################
    
    ########## FRONTEND ##########
    FRONTEND_DIR="$PROJECT_DIR/frontend"

    if [ -d "$FRONTEND_DIR" ]; then
        echo "Installing frontend dependencies..."
        ( cd "$FRONTEND_DIR" && npm install )

        if [ "$MODE" = "prod" ]; then
            echo "Building frontend for production..."
            ( cd "$FRONTEND_DIR" && npx quasar build )
        else
            echo "Frontend initialized for development environment (no build)."
        fi
    else
        echo "Error: frontend directory not found."
        exit 1
    fi

    ####### backedn npm install in kar koli druzga je treba se
    # # # # if [ -d "$project_dir/backend" ]; then
    # # # #     echo "Installing backend dependencies..."
    # # # #     ( cd "$project_dir/backend" && npm install )
    # # # # else
    # # # #     echo "Warning: backend directory not found — skipping npm install"
    # # # # fi

    ########################################
    # Create wrapper
    ########################################
    cat > "$WRAPPER" <<EOF
#!/usr/bin/env bash
export NDCG_ENV="$MODE"
exec "$RUN_SCRIPT" "\$@"
EOF

    chmod +x "$WRAPPER"
    echo "Installed command '$CMD' (env=$MODE)"
fi

echo "Initialization complete."