#!/bin/sh
set -e

# Fix ownership on volume mounts that default to root.
# The Dockerfile chown only affects the image layer — mounted volumes
# override it, so we fix permissions at runtime before dropping to appuser.
if [ "$(id -u)" = "0" ]; then
  chown -R appuser:appgroup /data/cache 2>/dev/null || true
  exec gosu appuser "$@"
else
  exec "$@"
fi
