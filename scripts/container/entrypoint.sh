#!/bin/sh
# Container entrypoint for the Campo Digital API image.
#
# The image runs as the non-root `campo` user by default, and then this
# script only execs the command. Hosts that mount a persistent volume
# root-owned (Railway does, and documents RAILWAY_RUN_UID=0 as the remedy)
# start the container as root instead: in that case, and only then, make
# the configured object-store root writable by `campo` and drop privileges
# before the application starts. The API process never runs as root.
set -eu

if [ "$(id -u)" = "0" ]; then
    if [ -n "${CAMPO_OBJECT_STORE_ROOT:-}" ]; then
        mkdir -p "$CAMPO_OBJECT_STORE_ROOT"
        chown campo:campo "$CAMPO_OBJECT_STORE_ROOT"
    fi
    # setpriv changes identity, not environment: without this HOME stays
    # /root, which `campo` cannot write (uv's cache lives under it).
    HOME="$(getent passwd campo | cut -d: -f6)"
    export HOME
    exec setpriv --reuid=campo --regid=campo --init-groups -- "$@"
fi

exec "$@"
