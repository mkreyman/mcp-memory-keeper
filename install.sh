#!/bin/bash
# Quick installer for memory-keeper MCP server
# Can be run directly from GitHub raw URL

set -e

INSTALL_DIR="${MEMORY_KEEPER_INSTALL_DIR:-$HOME/.local/mcp-servers/memory-keeper}"
REPO_URL="https://github.com/mkreyman/mcp-memory-keeper.git"

echo "Installing memory-keeper MCP server..."

# Create installation directory
mkdir -p "$INSTALL_DIR"

# Clone repository
if [ -d "$INSTALL_DIR/.git" ]; then
    echo "Updating existing installation..."
    cd "$INSTALL_DIR"
    git pull
else
    echo "Cloning memory-keeper..."
    git clone "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi

# Make launcher executable
chmod +x "$INSTALL_DIR/launcher.sh"

echo ""
echo "✅ Memory-keeper installed successfully!"
echo ""
echo "To add to Claude, run:"
echo "claude mcp add memory-keeper \"$INSTALL_DIR/launcher.sh\""
echo ""
echo "Data directory: ~/mcp-data/memory-keeper/"