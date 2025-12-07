#!/usr/bin/env bash
set -euo pipefail

# check for git
command -v git >/dev/null 2>&1 || { echo "Git not installed"; exit 1; }
# check for docker
command -v docker >/dev/null 2>&1 || { echo "docker not installed"; exit 1; }
# check for node
command -v node >/dev/null 2>&1 || { echo "node not installed"; exit 1; }
# check for npm
command -v npm >/dev/null 2>&1 || { echo "npm not installed"; exit 1; }

cmd_name="${1:-}"
action="${2:-install}"

if [ -z "$cmd_name" ]; then
    echo "Usage:"
    echo "  $0 <command-name>        # install"
    echo "  $0 <command-name> rm     # uninstall"
    exit 1
fi

wrapper="$HOME/.local/bin/$cmd_name"
project_dir="$(pwd)"
run_script="$project_dir/run.sh"

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
        echo "~/.local/bin added to PATH in $SHELL_RC"
        # Update PATH for current session
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
# Ensure run.sh exists
if [ ! -f "$run_script" ]; then
    echo "Error: run.sh not found in $project_dir"
    exit 1
fi

# Create wrapper
cat > "$wrapper" <<EOF
#!/usr/bin/env bash
exec "$run_script" "\$@"
EOF

chmod +x "$wrapper"

echo "Installed command '$cmd_name' — it runs:"
echo "  $run_script"
echo "You can now run '$cmd_name' from anywhere."

echo "Environment is ready!"