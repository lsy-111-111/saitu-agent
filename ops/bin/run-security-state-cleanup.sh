#!/usr/bin/env bash
set -Eeuo pipefail

fail() { printf '%s\n' "ERROR: $*" >&2; exit 1; }
[ "${EUID:-$(id -u)}" -eq "$(id -u postgres)" ] \
  || fail "security-state cleanup runner must execute as the postgres OS identity"
[ "${PGHOST:-}" = /var/run/postgresql ] && [ "${PGUSER:-}" = postgres ] \
  && [[ "${PGDATABASE:-}" =~ ^[a-z_][a-z0-9_]{0,62}$ ]] \
  || fail "cleanup database identity is not the fixed local peer contract"
SQL_FILE=/usr/local/share/resume-ai/security-state-cleanup.sql
[ -f "$SQL_FILE" ] && [ ! -L "$SQL_FILE" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$SQL_FILE")" = root:root:444:1 ] \
  || fail "immutable cleanup SQL is missing or unsafe"

deadline=$((SECONDS + 1200))
batches=0
while [ "$SECONDS" -lt "$deadline" ] && [ "$batches" -lt 10000 ]; do
  output="$(env -i PATH=/usr/bin:/bin PGHOST="$PGHOST" PGUSER="$PGUSER" PGDATABASE="$PGDATABASE" \
    /usr/bin/psql --quiet --no-psqlrc --set=ON_ERROR_STOP=1 --file="$SQL_FILE")" \
    || fail "security-state cleanup batch failed"
  marker="$(printf '%s\n' "$output" | grep -E '^CLEANUP_(COMPLETE|REMAINING|BUSY)$' || true)"
  [ "$(printf '%s\n' "$marker" | sed '/^$/d' | wc -l)" -eq 1 ] \
    || fail "security-state cleanup returned an ambiguous completion marker"
  case "$marker" in
    CLEANUP_COMPLETE) printf '%s\n' "Security-state cleanup completed in $((batches + 1)) batch pass(es)."; exit 0 ;;
    CLEANUP_REMAINING) batches=$((batches + 1)) ;;
    CLEANUP_BUSY) printf '%s\n' "Security-state cleanup is already active; this timer run is complete."; exit 0 ;;
    *) fail "security-state cleanup returned an invalid marker" ;;
  esac
done
fail "security-state cleanup backlog exceeded the bounded 20-minute window"
