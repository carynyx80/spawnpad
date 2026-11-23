#!/usr/bin/env bash
# Install dependencies in every Spawnpad package (each package is self-contained).
set -euo pipefail
cd "$(dirname "$0")/.."
for d in packages/ring packages/sdk packages/mcp services/verifier apps/api apps/web demo; do
  if [ -f "$d/package.json" ]; then
    echo "==> $d"
    (cd "$d" && npm install --no-audit --no-fund)
  fi
done
