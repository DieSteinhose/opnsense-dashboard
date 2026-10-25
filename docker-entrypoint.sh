#!/bin/sh
# Starts as root only to make the data directory writable, then drops to an
# unprivileged user (PUID/PGID, default 1000:1000) for the actual process.
set -e

DATA_DIR="${DATA_DIR:-/data}"
PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  # fix ownership when the bind mount was created by Docker as root or files belong to someone else
  if [ -n "$(find "$DATA_DIR" \( ! -user "$PUID" -o ! -group "$PGID" \) 2>/dev/null | head -n 1)" ]; then
    echo "[entrypoint] setting owner of $DATA_DIR to $PUID:$PGID"
    chown -R "$PUID:$PGID" "$DATA_DIR" || echo "[entrypoint] WARNING: could not change owner of $DATA_DIR (NFS/CIFS mount?)"
  fi
  exec su-exec "$PUID:$PGID" "$@"
fi

# started with --user / user: in compose, run as is
exec "$@"
