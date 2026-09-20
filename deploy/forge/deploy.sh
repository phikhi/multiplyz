#!/usr/bin/env bash
# Forge deployment hook. Run from the freshly checked-out release.
set -euo pipefail

release_path="${FORGE_RELEASE_PATH:-${1:-$PWD}}"
cd "$release_path"

test -f package.json || { echo "package.json absent dans $release_path" >&2; exit 1; }
test "${NODE_MAJOR:-$(node -p 'process.versions.node.split(`.`)[0]')}" = "22" || {
  echo "Node 22 requis" >&2
  exit 1
}

pnpm install --frozen-lockfile
node node_modules/next/dist/bin/next build --webpack
node --env-file=.env scripts/forge-preflight.mjs --runtime > preflight.json
