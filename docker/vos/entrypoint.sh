#!/bin/sh
set -eu
if [ "$(id -u)" = 0 ]; then
    mkdir -p /data/dbx
    chown -R 10001:10001 /data/dbx
    exec gosu 10001:10001 "$0" "$@"
fi
exec node /app/vos/gateway.mjs
