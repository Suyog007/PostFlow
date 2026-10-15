#!/usr/bin/env bash
# Local Postgres cluster stored in ./.data/pg (development and tests only).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA="$ROOT/.data/pg"; SOCK="$ROOT/.data"; PORT="${POSTFLOW_PG_PORT:-54329}"
BIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | tail -1 || true)"; [ -n "$BIN" ] && export PATH="$BIN:$PATH"
case "${1:-start}" in
  start)
    if [ ! -f "$DATA/PG_VERSION" ]; then mkdir -p "$DATA"; initdb -D "$DATA" -U postflow --auth=trust -E UTF8 --no-locale >/dev/null; fi
    if ! pg_ctl -D "$DATA" status >/dev/null 2>&1; then
      pg_ctl -D "$DATA" -l "$ROOT/.data/pg.log" -o "-p $PORT -k $SOCK -c listen_addresses=localhost" -w start >/dev/null
    fi
    for d in postflow postflow_test; do
      psql -h localhost -p "$PORT" -U postflow -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$d'" | grep -q 1 \
        || psql -h localhost -p "$PORT" -U postflow -d postgres -qc "CREATE DATABASE $d"
    done; echo "Postgres on :$PORT" ;;
  stop) pg_ctl -D "$DATA" -w stop >/dev/null && echo stopped ;;
esac
