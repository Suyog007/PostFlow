#!/usr/bin/env bash
# Runs a PostgreSQL cluster stored entirely inside this project (./.data/pg).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA="$ROOT/.data/pg"
SOCK="$ROOT/.data"
PORT="${POSTFLOW_PG_PORT:-54329}"

case "${1:-start}" in
  start)
    if [ ! -f "$DATA/PG_VERSION" ]; then
      mkdir -p "$DATA"
      initdb -D "$DATA" -U postflow --auth=trust -E UTF8 --no-locale >/dev/null
      echo "Initialized cluster at $DATA"
    fi
    if pg_ctl -D "$DATA" status >/dev/null 2>&1; then
      echo "Postgres already running on port $PORT"
    else
      pg_ctl -D "$DATA" -l "$ROOT/.data/pg.log" \
        -o "-p $PORT -k $SOCK -c listen_addresses=localhost" -w start >/dev/null
      echo "Postgres started on port $PORT"
    fi
    for db in postflow postflow_test; do
      psql -h localhost -p "$PORT" -U postflow -d postgres -tAc \
        "SELECT 1 FROM pg_database WHERE datname='$db'" | grep -q 1 \
        || psql -h localhost -p "$PORT" -U postflow -d postgres -qc "CREATE DATABASE $db"
    done
    ;;
  stop)
    pg_ctl -D "$DATA" -w stop >/dev/null && echo "Postgres stopped"
    ;;
  *)
    echo "usage: db.sh start|stop"; exit 1 ;;
esac
