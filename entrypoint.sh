#!/bin/sh
set -e

# Default arguments and port
MCP_ARGS=""
# Use MCP_PORT from environment or default to 8931
INTERNAL_PORT=${MCP_PORT:-8931}

# Add --headless if HEADLESS environment variable is true
if [ "$HEADLESS" = "true" ]; then
  MCP_ARGS="$MCP_ARGS --headless"
fi

# Add --port if MCP_PORT is set (for SSE connection)
# This allows SSE connection even when HEADLESS=true
if [ -n "$MCP_PORT" ]; then
  MCP_ARGS="$MCP_ARGS --port $INTERNAL_PORT"
fi

# Add --isolated if ISOLATED environment variable is true
if [ "$ISOLATED" = "true" ]; then
  MCP_ARGS="$MCP_ARGS --isolated"
fi

# Add --no-sandbox if NOSANDBOX environment variable is true
if [ "$NOSANDBOX" = "true" ]; then
  MCP_ARGS="$MCP_ARGS --no-sandbox"
fi

# Add --viewport-size if VIEWPORT_SIZE environment variable is set
if [ -n "$VIEWPORT_SIZE" ]; then
  MCP_ARGS="$MCP_ARGS --viewport-size $VIEWPORT_SIZE"
fi

echo "Starting @playwright/mcp with args: $MCP_ARGS $@"
echo "Internal MCP port (if using SSE): $INTERNAL_PORT"
echo -n "@playwright/mcp " && npx -y @playwright/mcp --version

# Execute @playwright/mcp using npx, passing arguments ($@)
exec npx @playwright/mcp $MCP_ARGS "$@"
