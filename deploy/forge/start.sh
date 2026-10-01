#!/usr/bin/env bash
# Working directory: active app release; .env supplied by Forge.
set -euo pipefail
node --env-file=.env scripts/forge-preflight.mjs --runtime >/dev/null
exec node --env-file=.env node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3217
