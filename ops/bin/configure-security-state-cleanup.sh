#!/usr/bin/env bash
set -Eeuo pipefail

fail() {
  printf '%s\n' "ERROR: $*" >&2
  exit 1
}

[ "${EUID:-$(id -u)}" -eq 0 ] || fail "run as root"
[ "$#" -eq 0 ] || fail "this helper accepts no arguments"

IDENTITY_READER=/usr/local/lib/resume-ai/read-postgres-runtime-identity.sh
ENV_FILE=/etc/resume-ai/security-state-cleanup.env
for protected_file in "$IDENTITY_READER" /usr/local/lib/resume-ai/validate-app-env.sh \
  /usr/local/lib/resume-ai/provision-postgres-maintenance-role.sh; do
  [ -f "$protected_file" ] && [ ! -L "$protected_file" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$protected_file")" = root:root:755:1 ] \
    || fail "trusted database identity control is missing or unsafe: $protected_file"
done
[ -f /usr/local/share/resume-ai/security-state-cleanup.sql ] \
  && [ ! -L /usr/local/share/resume-ai/security-state-cleanup.sql ] \
  && [ "$(stat -c '%U:%G:%a:%h' /usr/local/share/resume-ai/security-state-cleanup.sql)" = root:root:444:1 ] \
  || fail "immutable maintenance SQL is missing or unsafe"

database_identity="$($IDENTITY_READER)" \
  || fail "the runtime database identity is not approved for local maintenance"
runtime_role=${database_identity%%$'\t'*}
database_name=${database_identity#*$'\t'}
[[ "$runtime_role" =~ ^[a-z_][a-z0-9_]{0,62}$ ]] || fail "runtime database role is invalid"
[[ "$database_name" =~ ^[a-z_][a-z0-9_]{0,62}$ ]] || fail "runtime database name is invalid"
[ "$runtime_role" != postgres ] || fail "the application runtime must not use the postgres role"
unset database_identity runtime_role
/usr/local/lib/resume-ai/provision-postgres-maintenance-role.sh verify >/dev/null

install -d -o root -g root -m 0755 /etc/resume-ai
env_temp="$(mktemp /etc/resume-ai/.security-state-cleanup.XXXXXX)"
cleanup() {
  if [ -n "${env_temp:-}" ] && [ -e "$env_temp" ]; then
    rm -f -- "$env_temp"
  fi
}
trap cleanup EXIT
cat > "$env_temp" <<EOF
PGDATABASE=$database_name
PGHOST=/var/run/postgresql
PGUSER=postgres
EOF
chown root:postgres "$env_temp"
chmod 0640 "$env_temp"
mv -f -- "$env_temp" "$ENV_FILE"
env_temp=""
sync -f "$ENV_FILE"
sync -f /etc/resume-ai

[ ! -L "$ENV_FILE" ] && [ -f "$ENV_FILE" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$ENV_FILE")" = root:postgres:640:1 ] \
  || fail "maintenance environment file was not installed safely"
[ "$(wc -l < "$ENV_FILE")" -eq 3 ] \
  && grep -Fxq "PGDATABASE=$database_name" "$ENV_FILE" \
  && grep -Fxq 'PGHOST=/var/run/postgresql' "$ENV_FILE" \
  && grep -Fxq 'PGUSER=postgres' "$ENV_FILE" \
  || fail "maintenance environment file differs from the approved local peer identity"

# The timer is enabled by the layout installer but starts only after its
# root-owned database identity exists, avoiding a Persistent= catch-up run
# against a missing EnvironmentFile during first installation.
systemctl start resume-ai-security-state-cleanup.timer
systemctl is-active --quiet resume-ai-security-state-cleanup.timer

printf '%s\n' "Configured immutable local PostgreSQL maintenance for database $database_name."
