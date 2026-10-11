#!/usr/bin/env bash
# One-click setup for novix-open.
#   ./install.sh            -> build UI + start on http://127.0.0.1:8081
#   ./install.sh --no-start -> build only
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

command -v node >/dev/null 2>&1 || { echo "node >= 18 is required (found none)."; exit 1; }
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 18 ] || { echo "node >= 18 required, found $(node -v)"; exit 1; }

if [ ! -f .env ]; then
  cp .env.example .env
  echo "→ created .env from .env.example (edit it to add your LLM key)"
fi

echo "→ syncing contracts"
node ops/sync-contracts.mjs

echo "→ installing UI dependencies"
(cd app && npm install --no-audit --no-fund)

echo "→ building UI"
(cd app && npm run build)

if [ "${1:-}" = "--no-start" ]; then
  echo "✓ build complete. Start with: node server/serve.mjs"
  exit 0
fi

echo "→ starting server on http://127.0.0.1:8081"
exec node server/serve.mjs
