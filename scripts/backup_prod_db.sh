#!/usr/bin/env bash
# Copy the production database to this machine with pg_dump, encrypted.
#
# Two ways in (see products/transelect/docs/deployment.md "Manual database
# backup"):
#
#   scripts/backup_prod_db.sh --ssh
#       Runs pg_dump inside the PostGIS17 container over `railway ssh`. No
#       Railway setting changes and the database is never exposed publicly.
#       This is the default way (`make prod-dump`).
#
#   DATABASE_PUBLIC_URL='postgresql://…' scripts/backup_prod_db.sh
#       Through Railway's TCP proxy, which must be enabled first and disabled
#       after. The URL is read from the environment only: never pass it as an
#       argument (shell history) and never write it to a file in the
#       repository.
#
# Backups go to $CAMPO_BACKUP_DIR (default ~/campo-digital-backups), outside
# the repository, because they contain client data. They are encrypted with
# `age` and a passphrase you type (asked twice); keep the passphrase in your
# password manager. CAMPO_BACKUP_PLAIN=1 skips the encryption.

set -euo pipefail

DB_SERVICE="${CAMPO_DB_SERVICE:-PostGIS17}"

backup_dir="${CAMPO_BACKUP_DIR:-$HOME/campo-digital-backups}"
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
case "$(realpath -m "$backup_dir")/" in
  "$repo_root"/*)
    echo "CAMPO_BACKUP_DIR is inside the repository; backups hold client data." >&2
    exit 2
    ;;
esac

if [[ "${CAMPO_BACKUP_PLAIN:-}" != "1" ]] && ! command -v age > /dev/null; then
  echo "age is not installed (sudo apt install age), or set CAMPO_BACKUP_PLAIN=1." >&2
  exit 2
fi

mkdir -p "$backup_dir"
chmod 700 "$backup_dir"
umask 077

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="$backup_dir/campo-digital-prod-$stamp.dump"
partial="$target.partial"
trap 'rm -f "$partial"' EXIT

if [[ "${1:-}" == "--ssh" ]]; then
  # The dump is written and checked inside the container, its sha256 goes to
  # stderr, and the bytes come back on stdout (railway ssh passes binary
  # output unchanged, checked 2026-10-17). The container's PGHOST points at
  # the private network, so use the local socket.
  remote='set -e
f=$(mktemp)
trap "rm -f $f" EXIT
pg_dump -h /var/run/postgresql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  --format=custom --no-owner --no-privileges --file="$f"
pg_restore --list "$f" > /dev/null
echo "remote-sha256 $(sha256sum "$f" | cut -d" " -f1)" >&2
cat "$f"'
  log="$(mktemp)"
  railway ssh --service "$DB_SERVICE" -- sh -c "$remote" > "$partial" 2> "$log" || {
    cat "$log" >&2
    rm -f "$log"
    exit 1
  }
  expected="$(grep -o 'remote-sha256 [0-9a-f]\{64\}' "$log" | cut -d' ' -f2 || true)"
  rm -f "$log"
  actual="$(sha256sum "$partial" | cut -d' ' -f1)"
  if [[ -z "$expected" || "$expected" != "$actual" ]]; then
    echo "The copy does not match the container's dump (sha256); not kept." >&2
    exit 1
  fi
elif [[ -n "${DATABASE_PUBLIC_URL:-}" ]]; then
  # The Railway TCP proxy crosses the public internet: refuse to send client
  # data unencrypted.
  export PGSSLMODE="${PGSSLMODE:-require}"
  pg_dump --format=custom --no-owner --no-privileges \
    --dbname="$DATABASE_PUBLIC_URL" --file="$partial"
  # A dump pg_restore can list is complete and readable.
  pg_restore --list "$partial" > /dev/null
else
  echo "Use --ssh (recommended), or set DATABASE_PUBLIC_URL for the TCP proxy." >&2
  exit 2
fi

if [[ "${CAMPO_BACKUP_PLAIN:-}" == "1" ]]; then
  mv "$partial" "$target"
else
  target="$target.age"
  age --passphrase --output "$target.partial" "$partial"
  mv "$target.partial" "$target"
fi

echo "Backup written: $target ($(du -h "$target" | cut -f1))"
