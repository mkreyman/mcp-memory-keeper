#!/bin/bash
# Self-contained memory-keeper launcher that handles installation and updates
# This script can be used directly with Claude MCP configuration

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="${MEMORY_KEEPER_INSTALL_DIR:-$HOME/.local/mcp-servers/memory-keeper}"
DATA_DIR="${DATA_DIR:-$HOME/mcp-data/memory-keeper}"
REPO_URL="https://github.com/mkreyman/mcp-memory-keeper.git"

# If running from a cloned repo, use that instead of installing
if [ -f "$SCRIPT_DIR/package.json" ] && [ -d "$SCRIPT_DIR/.git" ]; then
    INSTALL_DIR="$SCRIPT_DIR"
    echo "Using local repository at $INSTALL_DIR" >&2
else
    # Ensure installation directory exists
    mkdir -p "$INSTALL_DIR"
    
    # Check if memory-keeper is installed
    if [ ! -d "$INSTALL_DIR/.git" ]; then
        echo "First time setup: Installing memory-keeper..." >&2
        cd "$INSTALL_DIR"
        git clone "$REPO_URL" . >&2
        npm install >&2
        npm run build >&2
        echo "Memory-keeper installation complete!" >&2
    fi
fi

# Ensure data directory exists
mkdir -p "$DATA_DIR"

# Check if we need to rebuild (e.g., after switching between environments)
BUILD_MARKER="$INSTALL_DIR/.build-marker-$(uname -s)-$(uname -m)"
if [ ! -f "$BUILD_MARKER" ]; then
    echo "Rebuilding native modules for $(uname -s) $(uname -m)..." >&2
    cd "$INSTALL_DIR"
    npm rebuild better-sqlite3 >&2
    touch "$BUILD_MARKER"
    # Clean up old build markers
    find "$INSTALL_DIR" -name ".build-marker-*" ! -name "$(basename "$BUILD_MARKER")" -delete 2>/dev/null
    echo "Native modules rebuilt!" >&2
fi

# Ensure the project is built
if [ ! -d "$INSTALL_DIR/dist" ]; then
    echo "Building memory-keeper..." >&2
    cd "$INSTALL_DIR"
    npm run build >&2
fi

# Optional: Check for updates (set MEMORY_KEEPER_AUTO_UPDATE=1 to enable)
if [ "${MEMORY_KEEPER_AUTO_UPDATE}" = "1" ] && [ -d "$INSTALL_DIR/.git" ]; then
    echo "Checking for updates..." >&2
    cd "$INSTALL_DIR"
    git pull >&2
    npm install >&2
    npm run build >&2
fi

# Change to data directory and run
cd "$DATA_DIR"
exec node "$INSTALL_DIR/dist/index.js" "$@"