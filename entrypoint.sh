#!/bin/sh
set -e

# Suppress npm update notices
export NPM_CONFIG_UPDATE_NOTIFIER=false

# Execute the Node.js server which handles both SSE and StreamableHTTP modes
exec node /app/server.js "$@"

