#!/usr/bin/env bash
# Runs the API end-to-end tests against a throwaway API instance so the dev database on :4100 is never touched.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
PORT="${E2E_PORT:-4199}"
VERIFIER_PID=""
if ! curl -sf http://localhost:4200/pubkey >/dev/null; then
  (cd "$ROOT/services/verifier" && npx tsx src/server.ts >"$TMP/verifier.log" 2>&1) & VERIFIER_PID=$!
  for _ in $(seq 1 30); do curl -sf http://localhost:4200/pubkey >/dev/null && break; sleep 0.5; done
fi
(cd "$ROOT/apps/api" && DATA_DIR="$TMP" RING_DATA_DIR="$TMP" API_PORT="$PORT" npx tsx src/server.ts >"$TMP/api.log" 2>&1) & API_PID=$!
cleanup() { kill "$API_PID" 2>/dev/null || true; [ -n "$VERIFIER_PID" ] && kill "$VERIFIER_PID" 2>/dev/null || true; rm -rf "$TMP"; }
trap cleanup EXIT
for _ in $(seq 1 40); do curl -sf "http://localhost:$PORT/health" >/dev/null && break; sleep 0.5; done
cd "$ROOT/apps/api" && API_URL="http://localhost:$PORT" npx tsx src/e2e.ts
