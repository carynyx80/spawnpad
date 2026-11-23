#!/usr/bin/env bash
# Typecheck every package. Packages without a tsconfig get explicit flags.
set -uo pipefail
cd "$(dirname "$0")/.."
FLAGS="--noEmit --target ES2022 --module ESNext --moduleResolution Bundler --strict --skipLibCheck --types node --allowImportingTsExtensions --esModuleInterop"
fail=0
run() { echo "==> $1"; (cd "$1" && eval "$2") || fail=1; }
run services/verifier "npx tsc --noEmit"
run packages/sdk "npx tsc --noEmit"
run packages/mcp "npx tsc --noEmit"
run apps/web "npx tsc --noEmit -p ."
run demo "npx tsc --noEmit && npx tsc $FLAGS seed.ts"
run packages/ring "npx tsc $FLAGS src/index.ts src/selftest.ts"
run apps/api "npx tsc $FLAGS src/server.ts"
exit $fail
