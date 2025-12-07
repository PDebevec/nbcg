#!/usr/bin/env bash
set -euo pipefail

########################################
# Ensure requirements
########################################
command -v git >/dev/null 2>&1 || { echo "Git not installed"; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "docker not installed"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "node not installed"; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "npm not installed"; exit 1; }


########################################
# INSTALL custom command for run.sh
########################################
cmd_name="${1:-}"
action="${2:-install}"
env="${3:-dev}"  # optional third argument: 'dev' (default) or 'prod'

if [ -z "$cmd_name" ]; then
    echo "Usage:"
    echo "  $0 <command-name> [rm] [dev|prod]"
    exit 1
fi

wrapper="$HOME/.local/bin/$cmd_name"
project_dir="$(pwd)"
run_script="$project_dir/run.sh"

# Check if the command already exists
if [ -f "$wrapper" ]; then
    # Read the environment baked in
    EXISTING_ENV=$(grep -oP '(?<=NDCG_COMPOSE_FILE=").*' "$wrapper" | grep -oP '(?<=docker-compose).*\.yml' || echo "")
    if [[ "$EXISTING_ENV" == *"prod"* ]]; then
        EXISTING_ENV="prod"
    else
        EXISTING_ENV="dev"
    fi

    if [ "$action" != "rm" ]; then
        if [ "$EXISTING_ENV" = "$env" ]; then
            echo "Command '$cmd_name' is already installed with environment '$env'. Nothing to do."
            exit 1
        else
            echo "Error: Command '$cmd_name' already exists with environment '$EXISTING_ENV'. Cannot install with environment '$env'."
            exit 1
        fi
    fi
fi

########################################
# Ensure ~/.local/bin exists
########################################
mkdir -p "$HOME/.local/bin"

########################################
# Ensure ~/.local/bin is in PATH
########################################
if [[ ":$PATH:" != *":$HOME/.local/bin:"* ]]; then
    SHELL_RC=""
    if [ -n "${BASH_VERSION:-}" ]; then
        SHELL_RC="$HOME/.bashrc"
    elif [ -n "${ZSH_VERSION:-}" ]; then
        SHELL_RC="$HOME/.zshrc"
    fi

    if [ -n "$SHELL_RC" ]; then
        echo "export PATH=\"\$HOME/.local/bin:\$PATH\"" >> "$SHELL_RC"
        export PATH="$HOME/.local/bin:$PATH"
    else
        echo "Warning: Could not detect shell rc file. Add ~/.local/bin to PATH manually."
    fi
fi

########################################
# Uninstall (remove command)
########################################
if [ "$action" = "rm" ]; then
    if [ -f "$wrapper" ]; then
        rm -f "$wrapper"
        echo "Removed command '$cmd_name' from ~/.local/bin"
    else
        echo "Command '$cmd_name' does not exist, nothing to remove."
    fi
    exit 0
fi

########################################
# Install
########################################
if [ ! -f "$run_script" ]; then
    echo "Error: run.sh not found in $project_dir"
    exit 1
fi

# Create wrapper with environment baked in
cat > "$wrapper" <<EOF
#!/usr/bin/env bash
# Default docker compose files
COMPOSE_DIR="\$(dirname "$run_script")/docker"
COMPOSE_DEV="\$COMPOSE_DIR/docker-compose.yml"
COMPOSE_PROD="\$COMPOSE_DIR/docker-compose.prod.yml"

# Select compose file based on environment
if [ "$env" = "prod" ]; then
    SELECTED_COMPOSE="\$COMPOSE_PROD"
else
    SELECTED_COMPOSE="\$COMPOSE_DEV"
fi

# Run the main run.sh with the selected compose file baked in
export NDCG_COMPOSE_FILE="\$SELECTED_COMPOSE"

exec "$run_script" "\$@"
EOF

chmod +x "$wrapper"

echo "Installed command '$cmd_name' — it runs:"
echo "  $run_script"
echo "Environment: $env"
echo "You can now run '$cmd_name' from anywhere."