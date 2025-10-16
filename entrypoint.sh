#!/bin/sh
set -e

# Default arguments and port
MCP_ARGS=""
# Use MCP_PORT from environment or default to 8931
INTERNAL_PORT=${MCP_PORT:-8931}
# Use MCP_HOST from environment or default to :: (IPv6 all interfaces, also accepts IPv4)
MCP_HOST=${MCP_HOST:-::}

# Add --headless if HEADLESS environment variable is true
if [ "$HEADLESS" = "true" ]; then
  MCP_ARGS="$MCP_ARGS --headless"
fi

# Add --port if MCP_PORT is set (for SSE connection)
# This allows SSE connection even when HEADLESS=true
if [ -n "$MCP_PORT" ]; then
  MCP_ARGS="$MCP_ARGS --port $INTERNAL_PORT"
fi

# Add --host if MCP_HOST is set (for binding to specific interface)
# Default is :: to accept connections from all interfaces (IPv4 and IPv6)
if [ -n "$MCP_HOST" ]; then
  MCP_ARGS="$MCP_ARGS --host $MCP_HOST"
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

echo "=========================================="
echo "🎭 Playwright MCP Server"
echo "=========================================="
echo "Version: $(npx --silent -y @playwright/mcp --version 2>/dev/null | grep -oP '\d+\.\d+\.\d+' || echo '0.0.32')"
echo "Host: $MCP_HOST"
echo "Port: $INTERNAL_PORT"
echo ""

# Format URL based on host
if [ "$MCP_HOST" = "::" ] || [ "$MCP_HOST" = "0.0.0.0" ]; then
  echo "🌐 Server URL (SSE): http://localhost:$INTERNAL_PORT/sse"
  echo "   Alternative:      http://127.0.0.1:$INTERNAL_PORT/sse"
  if [ "$MCP_HOST" = "::" ]; then
    echo "   IPv6:             http://[::1]:$INTERNAL_PORT/sse"
  fi
else
  # Show specific host
  if echo "$MCP_HOST" | grep -q ":"; then
    # IPv6 address
    echo "🌐 Server URL (SSE): http://[$MCP_HOST]:$INTERNAL_PORT/sse"
  else
    # IPv4 address or hostname
    echo "🌐 Server URL (SSE): http://$MCP_HOST:$INTERNAL_PORT/sse"
  fi
fi

echo ""
echo "Arguments: $MCP_ARGS"
echo "=========================================="
echo ""

# Execute @playwright/mcp using npx, passing arguments ($@)
# Suppress npm update notices
export NPM_CONFIG_UPDATE_NOTIFIER=false
exec npx --silent @playwright/mcp $MCP_ARGS "$@"
