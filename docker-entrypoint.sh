#!/bin/sh
# Starts as root only to make the data directory writable, then drops to an
# unprivileged user (PUID/PGID, default 1000:1000) for the actual process.
# If the directory cannot be handed over (NFS/CIFS shares, LXC, dropped
# capabilities) but root can write to it, it keeps running as root instead.
set -e

DATA_DIR="${DATA_DIR:-/data}"
PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

can_write() {
  probe="$DATA_DIR/.write-test.$$"
  if [ "$1" = "root" ]; then
    (touch "$probe" && rm -f "$probe") 2>/dev/null
  else
    su-exec "$PUID:$PGID" sh -c "touch '$probe' && rm -f '$probe'" 2>/dev/null
  fi
}

diagnose() {
  echo "[entrypoint] $DATA_DIR: $(ls -ldn "$DATA_DIR" 2>&1)"
  echo "[entrypoint] mount: $(awk -v d="$DATA_DIR" '$2 == d { print $1, $3, $4 }' /proc/mounts)"
}

if [ "$(id -u)" != "0" ]; then
  # started with --user / user: in compose, run as is
  exec "$@"
fi

mkdir -p "$DATA_DIR" 2>/dev/null || true

# fix ownership when the bind mount was created by Docker as root or files belong to someone else
if [ -n "$(find "$DATA_DIR" \( ! -user "$PUID" -o ! -group "$PGID" \) 2>/dev/null | head -n 1)" ]; then
  echo "[entrypoint] setting owner of $DATA_DIR to $PUID:$PGID"
  chown -R "$PUID:$PGID" "$DATA_DIR" 2>/dev/null || echo "[entrypoint] could not change the owner of $DATA_DIR"
fi

if can_write user; then
  exec su-exec "$PUID:$PGID" "$@"
fi

if can_write root; then
  echo "[entrypoint] WARNING: $DATA_DIR is not writable for $PUID:$PGID, running as root instead"
  diagnose
  exec "$@"
fi

echo "[entrypoint] ERROR: $DATA_DIR is not writable, not even for root"
diagnose
echo "[entrypoint] Use a named volume (see docs/SETUP.md) or fix the permissions of the host directory."
exit 1
