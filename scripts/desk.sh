#!/usr/bin/env bash
# Runs the whole desk in one terminal: Postgres, the web app, and the worker.
# Ctrl-C stops the web app and the worker together (Postgres keeps running).
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

bash scripts/db.sh start
npx tsx scripts/migrate.ts

if [ ! -f ".next/BUILD_ID" ]; then
  echo "No production build found — building first (one-time, a few seconds)…"
  npm run build
fi

cleanup() {
  echo ""
  echo "Stopping web app and worker…"
  kill "$WEB_PID" "$WORKER_PID" 2>/dev/null
  wait "$WEB_PID" "$WORKER_PID" 2>/dev/null
  echo "Desk stopped. Postgres is still running (npm run db:stop to stop it)."
}
trap cleanup INT TERM EXIT

npm start 2>&1 | sed -u 's/^/[web]    /' &
WEB_PID=$!
npm run worker 2>&1 | sed -u 's/^/[worker] /' &
WORKER_PID=$!

echo ""
echo "PostFlow is running:"
echo "  web     http://localhost:3000"
echo "  worker  discovery + scheduled publishing (keep this terminal open)"
echo "Ctrl-C stops everything."
wait -n "$WEB_PID" "$WORKER_PID"
