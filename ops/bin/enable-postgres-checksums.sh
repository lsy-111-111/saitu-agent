#!/usr/bin/env bash
set -Eeuo pipefail
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

fail() {
  printf '%s\n' "ERROR: $*" >&2
  exit 1
}

[ "${EUID:-$(id -u)}" -eq 0 ] || fail "run as root"
[ "${ACK_POSTGRES_CHECKSUM_DOWNTIME:-}" = "YES" ] \
  || fail "set ACK_POSTGRES_CHECKSUM_DOWNTIME=YES for the verified maintenance window"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
. "$SCRIPT_DIR/open-root-lock.sh"
deploy_lock_path=/run/resume-ai-locks/deploy.lock
if [ -e "/proc/$$/fd/9" ]; then
  [ "$(readlink "/proc/$$/fd/9")" = "$deploy_lock_path" ] \
    && [ "$(stat -Lc '%d:%i' "/proc/$$/fd/9")" = "$(stat -c '%d:%i' "$deploy_lock_path")" ] \
    && flock -n 9 \
    || fail "inherited descriptor 9 is not the held Resume AI deploy lock"
else
  open_root_lock 9 deploy
fi
role_lock_path=/run/resume-ai-locks/postgres-role-hardening.lock
if [ -e "/proc/$$/fd/6" ]; then
  [ "$(readlink "/proc/$$/fd/6")" = "$role_lock_path" ] \
    && [ "$(stat -Lc '%d:%i' "/proc/$$/fd/6")" = "$(stat -c '%d:%i' "$role_lock_path")" ] \
    && flock -n 6 \
    || fail "inherited descriptor 6 is not the held PostgreSQL role-hardening lock"
else
  open_root_lock 6 postgres-role-hardening
fi
"$SCRIPT_DIR/assert-postgres-security-version.sh" \
  /etc/resume-ai/approved-postgres-runtime.conf >/dev/null
for required_command in flock pg_lsclusters readlink runuser stat systemctl; do
  command -v "$required_command" >/dev/null 2>&1 || fail "$required_command is unavailable"
done
postgres_peer() {
  runuser -u postgres -- env -i PATH=/usr/bin:/bin PGHOST=/var/run/postgresql PGUSER=postgres "$@"
}

clusters=()
while IFS= read -r cluster_line; do clusters+=("$cluster_line"); done \
  < <(pg_lsclusters --no-header | awk '$4 == "online" { print $1 " " $2 " " $6 }')
[ "${#clusters[@]}" -eq 1 ] || fail "exactly one online PostgreSQL cluster is required"
read -r PG_VERSION PG_CLUSTER PG_DATA <<< "${clusters[0]}"
case "$PG_VERSION" in *[!0-9.]*) fail "invalid PostgreSQL version" ;; esac
case "$PG_CLUSTER" in *[!A-Za-z0-9_-]*) fail "invalid PostgreSQL cluster name" ;; esac
case "$PG_DATA" in /var/lib/postgresql/*) ;; *) fail "unexpected PostgreSQL data directory" ;; esac
CHECKSUM_BINARY="/usr/lib/postgresql/$PG_VERSION/bin/pg_checksums"
[ -x "$CHECKSUM_BINARY" ] || fail "pg_checksums binary is missing"

peer_contract="$(postgres_peer psql --no-psqlrc --tuples-only --no-align --field-separator=$'\t' \
  --command="SELECT inet_server_addr() IS NULL,current_setting('data_directory'),
    (pg_control_system()).system_identifier::text,current_setting('data_checksums');")"
IFS=$'\t' read -r peer_is_local peer_data_dir peer_system_id current_setting <<< "$peer_contract"
[ "$peer_is_local" = t ] && [ "$peer_data_dir" = "$PG_DATA" ] \
  && [[ "$peer_system_id" =~ ^[0-9]{10,}$ ]] \
  || fail "checksum maintenance is not bound to the approved local peer cluster"
if [ "$current_setting" = "on" ]; then
  "$(dirname -- "${BASH_SOURCE[0]}")/backup-postgres.sh" daily
  "$SCRIPT_DIR/verify-postgres-restore.sh"
  active_root="$(readlink -e /opt/resume-ai/current)" \
    || fail "active release pointer cannot be resolved"
  "$SCRIPT_DIR/assert-postgres-ops-runtime.sh" "$active_root/ops" full
  printf '%s\n' "PostgreSQL data checksums are enabled; a fresh daily backup and current-contract restore verification passed."
  exit 0
fi

"$(dirname -- "${BASH_SOURCE[0]}")/backup-postgres.sh" predeploy
service_name="postgresql@$PG_VERSION-$PG_CLUSTER.service"
cluster_stopped=0
restart_cluster() {
  local exit_status=$?
  trap - EXIT
  if [ "$cluster_stopped" -eq 1 ]; then
    systemctl start "$service_name" || true
  fi
  exit "$exit_status"
}
trap restart_cluster EXIT

systemctl stop "$service_name"
cluster_stopped=1
"$CHECKSUM_BINARY" --enable --progress --pgdata="$PG_DATA"
systemctl start "$service_name"
cluster_stopped=0
result="$(postgres_peer psql --no-psqlrc --tuples-only --no-align --command='SHOW data_checksums;')"
[ "$result" = "on" ] || fail "PostgreSQL did not report data checksums enabled"
"$SCRIPT_DIR/assert-postgres-security-version.sh" \
  /etc/resume-ai/approved-postgres-runtime.conf >/dev/null
"$(dirname -- "${BASH_SOURCE[0]}")/backup-postgres.sh" daily
"$SCRIPT_DIR/verify-postgres-restore.sh"
active_root="$(readlink -e /opt/resume-ai/current)" \
  || fail "active release pointer cannot be resolved"
"$SCRIPT_DIR/assert-postgres-ops-runtime.sh" "$active_root/ops" full
trap - EXIT
printf '%s\n' "PostgreSQL data checksums are enabled for $PG_VERSION/$PG_CLUSTER; backup and current-contract restore evidence passed."
