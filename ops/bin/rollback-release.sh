#!/usr/bin/env bash
set -Eeuo pipefail

fail() {
  printf '%s\n' "ERROR: $*" >&2
  exit 1
}

root_node() {
  (cd / && /usr/bin/env -i PATH=/opt/nodejs/current/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    /opt/nodejs/current/bin/node "$@")
}

root_python() {
  (cd / && /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin \
    /usr/bin/python3 -I "$@")
}

root_curl() {
  (cd / && /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin \
    /usr/bin/curl --disable --noproxy '*' "$@")
}

[ "${EUID:-$(id -u)}" -eq 0 ] || fail "run as root"
[ "${ACK_PRODUCTION_ROLLBACK:-}" = YES ] \
  || fail "set ACK_PRODUCTION_ROLLBACK=YES to switch to the recorded previous release"
[ "$#" -eq 0 ] || fail "this rollback command accepts no arguments"

RELEASE_ROOT=/opt/resume-ai/releases
ARTIFACT_ROOT=/opt/resume-ai/release-artifacts
STATE_DIR=/opt/resume-ai/state
STATE_FILE="$STATE_DIR/active.env"
PENDING_FILE="$STATE_DIR/deploy.pending"
CURRENT_LINK=/opt/resume-ai/current
NGINX_UPSTREAM=/etc/nginx/conf.d/10-resume-ai-upstream.conf
PM2_HOME=/var/lib/resume-ai/.pm2
NODE_BIN=/opt/nodejs/current/bin/node
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
. "$SCRIPT_DIR/open-root-lock.sh"
for protected_path in "$STATE_FILE" "$NGINX_UPSTREAM"; do
  [ -f "$protected_path" ] && [ ! -L "$protected_path" ] && [ "$(stat -c '%h' "$protected_path")" = 1 ] \
    || fail "protected release state is missing or unsafe: $protected_path"
done
[ -L "$CURRENT_LINK" ] || fail "current pointer is not a symbolic link"
[ -x "$NODE_BIN" ] || fail "approved Node runtime is unavailable"

open_root_lock 9 deploy
if [ -e "$PENDING_FILE" ]; then "$SCRIPT_DIR/recover-deployment-state.sh"; fi
"$SCRIPT_DIR/verify-release-consistency.sh" "$STATE_FILE" >/dev/null
umask 077

ACTIVE_PORT=""
ACTIVE_RELEASE=""
PREVIOUS_PORT=""
PREVIOUS_RELEASE=""
declare -A seen_state=()
while IFS='=' read -r state_key state_value || [ -n "$state_key" ]; do
  case "$state_key" in ACTIVE_PORT|ACTIVE_RELEASE|PREVIOUS_PORT|PREVIOUS_RELEASE|SWITCHED_AT) ;; '') continue ;; *) fail "unknown active state key: $state_key" ;; esac
  [ -z "${seen_state[$state_key]:-}" ] || fail "duplicate active state key: $state_key"
  seen_state[$state_key]=1
  case "$state_key" in ACTIVE_PORT|ACTIVE_RELEASE|PREVIOUS_PORT|PREVIOUS_RELEASE) printf -v "$state_key" '%s' "$state_value" ;; esac
done < "$STATE_FILE"
case "$ACTIVE_PORT:$ACTIVE_RELEASE" in 3000:20??????T??????Z|3001:20??????T??????Z) ;; *) fail "invalid active state" ;; esac
case "$PREVIOUS_PORT:$PREVIOUS_RELEASE" in 3000:20??????T??????Z|3001:20??????T??????Z) ;; *) fail "no valid previous release is recorded" ;; esac
[ "$ACTIVE_PORT" != "$PREVIOUS_PORT" ] || fail "active and previous ports overlap"
[ -d "$RELEASE_ROOT/$PREVIOUS_RELEASE" ] || fail "previous release directory is missing"
APPROVAL_FILE="/etc/resume-ai/approved-releases/$PREVIOUS_RELEASE.env"
[ -f "$APPROVAL_FILE" ] && [ ! -L "$APPROVAL_FILE" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$APPROVAL_FILE")" = root:root:400:1 ] \
  || fail "rollback target root approval is missing or unsafe"
APPROVAL_FILE_SHA256="$(sha256sum "$APPROVAL_FILE" | awk '{print $1}')"
ROLLBACK_SNAPSHOT="/var/lib/resume-ai/security/cloud-snapshots/$PREVIOUS_RELEASE.env"
[ ! -e "/var/lib/resume-ai/security/cloud-snapshots/$PREVIOUS_RELEASE.pending" ] \
  && [ ! -L "/var/lib/resume-ai/security/cloud-snapshots/$PREVIOUS_RELEASE.pending" ] \
  && [ -f "$ROLLBACK_SNAPSHOT" ] && [ ! -L "$ROLLBACK_SNAPSHOT" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$ROLLBACK_SNAPSHOT")" = root:root:400:1 ] \
  && [ -f /usr/local/lib/resume-ai/record-cloud-snapshot-evidence.py ] \
  && [ ! -L /usr/local/lib/resume-ai/record-cloud-snapshot-evidence.py ] \
  && [ "$(stat -c '%U:%G:%a:%h' /usr/local/lib/resume-ai/record-cloud-snapshot-evidence.py)" = root:root:755:1 ] \
  || fail "rollback target post-provision snapshot evidence is missing, pending, or unsafe"
root_python /usr/local/lib/resume-ai/record-cloud-snapshot-evidence.py \
  --verify-rollback-target "$ROLLBACK_SNAPSHOT" "$PREVIOUS_RELEASE" >/dev/null \
  || fail "rollback target failed its immutable snapshot continuity gate"

pm2_as_app() {
  runuser -u resume-ai -- env -i HOME=/var/lib/resume-ai PM2_HOME="$PM2_HOME" \
    PATH=/opt/nodejs/current/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin "$@"
}

start_release_process() {
  local release=$1 port=$2 process_name="resume-ai-$2"
  pm2_as_app pm2 delete "$process_name" >/dev/null 2>&1 || true
  pm2_as_app env APP_RELEASE_DIR="$RELEASE_ROOT/$release" APP_PORT="$port" \
    APP_PROCESS_NAME="$process_name" pm2 start \
    "$RELEASE_ROOT/$release/ops/pm2/ecosystem.config.cjs" --update-env >/dev/null
}

release_requires_direct_delete() {
  local release=$1 manifest="$ARTIFACT_ROOT/$1/release-manifest.json"
  [ -f "$manifest" ] && [ ! -L "$manifest" ] || return 0
  root_node -e '
    const fs = require("node:fs");
    const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    process.exit(value?.databaseContract?.schemaVersion === 1
      && value.databaseContract.runtimeRequiresDirectDelete === false ? 0 : 1);
  ' "$manifest" && return 1
  return 0
}

authorize_rollback_target() {
  if release_requires_direct_delete "$PREVIOUS_RELEASE"; then
    if ! /usr/local/lib/resume-ai/provision-postgres-runtime-role.sh verify-compat >/dev/null 2>&1; then
      ACK_POSTGRES_LEGACY_DELETE=YES \
        /usr/local/lib/resume-ai/provision-postgres-runtime-role.sh \
          grant-legacy-delete "$PREVIOUS_RELEASE" >/dev/null
    fi
    /usr/local/lib/resume-ai/provision-postgres-runtime-role.sh verify-compat >/dev/null
    TARGET_DATABASE_MODE=legacy-delete
  else
    if ! /usr/local/lib/resume-ai/provision-postgres-runtime-role.sh verify >/dev/null 2>&1; then
      ACK_POSTGRES_RUNTIME_HARDENING=YES \
        /usr/local/lib/resume-ai/provision-postgres-runtime-role.sh reconcile >/dev/null
    fi
    /usr/local/lib/resume-ai/provision-postgres-runtime-role.sh verify >/dev/null
    TARGET_DATABASE_MODE=rpc-only
  fi
  /usr/local/lib/resume-ai/provision-postgres-maintenance-role.sh verify >/dev/null
}

verify_invalid_api_contract() {
  local base_url=$1 endpoint status
  for endpoint in \
    /api/competitions/recommend/normalize \
    /api/ai/competition-clarify \
    /api/ai/competition-recommend; do
    status="$(root_curl -sS --connect-timeout 5 --max-time 10 -o /dev/null -w '%{http_code}' \
      -H 'Content-Type: application/json' --data-binary '{}' "${base_url%/}$endpoint")"
    case "$status" in 400|401|403|405|415|422) ;;
      *) fail "rollback API contract did not fail closed at $endpoint (HTTP $status)" ;;
    esac
  done
}

write_journal() {
  local phase=$1 journal_temp
  journal_temp="$(mktemp "$STATE_DIR/.rollback-pending.XXXXXX")"
  cat > "$journal_temp" <<EOF
KIND=rollback
PHASE=$phase
OLD_ACTIVE_PORT=$ACTIVE_PORT
OLD_ACTIVE_RELEASE=$ACTIVE_RELEASE
OLD_PREVIOUS_PORT=$PREVIOUS_PORT
OLD_PREVIOUS_RELEASE=$PREVIOUS_RELEASE
NEW_PORT=$PREVIOUS_PORT
NEW_RELEASE=$PREVIOUS_RELEASE
NEW_PREVIOUS_PORT=$ACTIVE_PORT
NEW_PREVIOUS_RELEASE=$ACTIVE_RELEASE
APPROVAL_FILE_SHA256=$APPROVAL_FILE_SHA256
EOF
  chown root:resume-ai "$journal_temp"
  chmod 0640 "$journal_temp"
  mv -f -- "$journal_temp" "$PENDING_FILE"
  sync -f "$PENDING_FILE"
  sync -f "$STATE_DIR"
}

journal_written=0
recover_on_failure() {
  local exit_status=$?
  trap - ERR EXIT
  set +e
  if [ "$journal_written" -eq 1 ]; then
    "$SCRIPT_DIR/recover-deployment-state.sh" >/dev/null 2>&1 \
      || printf '%s\n' "Rollback interrupted; durable journal retained for boot recovery." >&2
  fi
  exit "$exit_status"
}
trap recover_on_failure ERR EXIT

start_release_process "$PREVIOUS_RELEASE" "$PREVIOUS_PORT"
previous_url="http://127.0.0.1:$PREVIOUS_PORT/"
deadline=$((SECONDS + 90))
until previous_status="$(root_curl -sS --connect-timeout 2 --max-time 5 \
  -o /dev/null -w '%{http_code}' "$previous_url")" && [ "$previous_status" = 200 ]; do
  [ "$SECONDS" -lt "$deadline" ] || fail "previous release did not become healthy within 90 seconds"
  sleep 2
done
runuser -u resume-ai -- env -i HOME=/var/lib/resume-ai \
  PATH=/opt/nodejs/current/bin:/usr/bin:/bin \
  "$NODE_BIN" "$RELEASE_ROOT/$PREVIOUS_RELEASE/scripts/verify-next-assets.mjs" "$previous_url"
verify_invalid_api_contract "$previous_url"
pm2_as_app pm2 save >/dev/null
[ -f "$PM2_HOME/dump.pm2" ] || fail "PM2 recovery dump was not written"
chmod 0600 "$PM2_HOME/dump.pm2"
sync -f "$PM2_HOME/dump.pm2"
sync -f "$PM2_HOME"

write_journal prepared
journal_written=1
ACK_CONTROL_PLANE_GENERATION=YES \
  /usr/local/lib/resume-ai/install-control-plane-generation.sh stage \
  "$RELEASE_ROOT/$PREVIOUS_RELEASE" \
  "$ARTIFACT_ROOT/$PREVIOUS_RELEASE/source-manifest.txt"
authorize_rollback_target
upstream_temp="$(mktemp /etc/nginx/conf.d/.resume-ai-upstream.XXXXXX)"
cat > "$upstream_temp" <<EOF
# Managed atomically by ops/bin/rollback-release.sh.
upstream resume_ai_active {
    server 127.0.0.1:$PREVIOUS_PORT max_fails=2 fail_timeout=10s;
    keepalive 32;
}
EOF
chown root:root "$upstream_temp"
chmod 0644 "$upstream_temp"
mv -f -- "$upstream_temp" "$NGINX_UPSTREAM"
sync -f "$NGINX_UPSTREAM"
sync -f /etc/nginx/conf.d
nginx -t
systemctl reload nginx
write_journal nginx_switched

current_temp="/opt/resume-ai/.current-rollback-$PREVIOUS_RELEASE"
[ ! -e "$current_temp" ] || fail "rollback pointer staging path already exists"
ln -s "releases/$PREVIOUS_RELEASE" "$current_temp"
mv -Tf -- "$current_temp" "$CURRENT_LINK"
sync -f /opt/resume-ai
state_temp="$(mktemp "$STATE_DIR/.active.XXXXXX")"
cat > "$state_temp" <<EOF
ACTIVE_PORT=$PREVIOUS_PORT
ACTIVE_RELEASE=$PREVIOUS_RELEASE
PREVIOUS_PORT=$ACTIVE_PORT
PREVIOUS_RELEASE=$ACTIVE_RELEASE
SWITCHED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF
chown root:resume-ai "$state_temp"
chmod 0640 "$state_temp"
mv -f -- "$state_temp" "$STATE_FILE"
sync -f "$STATE_FILE"
sync -f "$STATE_DIR"
/usr/local/lib/resume-ai/write-database-permission-state.sh \
  "$PREVIOUS_RELEASE" "$TARGET_DATABASE_MODE"
/usr/local/lib/resume-ai/configure-security-state-cleanup.sh
systemctl start resume-ai-security-state-cleanup.service

ALLOW_PENDING_TRANSACTION=1 "$SCRIPT_DIR/verify-release-consistency.sh" "$STATE_FILE" >/dev/null
PUBLIC_URL=https://siyuanjiaxin.com/
rollback_headers="$(mktemp /run/resume-ai-rollback-headers.XXXXXX)"
public_status="$(root_curl -sS --proto '=https' --tlsv1.2 --connect-timeout 5 --max-time 10 \
  --max-redirs 0 -D "$rollback_headers" -o /dev/null -w '%{http_code}' "$PUBLIC_URL")"
[ "$public_status" = 200 ] || fail "rollback public homepage returned HTTP $public_status"
runuser -u resume-ai -- env -i HOME=/var/lib/resume-ai \
  PATH=/opt/nodejs/current/bin:/usr/bin:/bin \
  "$NODE_BIN" "$RELEASE_ROOT/$PREVIOUS_RELEASE/scripts/verify-next-assets.mjs" "$PUBLIC_URL"
verify_invalid_api_contract https://siyuanjiaxin.com/
for required_header in strict-transport-security content-security-policy x-request-id; do
  [ "$(awk -F: -v name="$required_header" 'tolower($1) == name { count += 1 } END { print count + 0 }' "$rollback_headers")" -eq 1 ] \
    || fail "rollback response lacks one $required_header"
done
rm -f -- "$rollback_headers"
write_journal state_committed
ALLOW_PENDING_TRANSACTION=1 "$SCRIPT_DIR/verify-release-consistency.sh" "$STATE_FILE" >/dev/null
# Install the rollback generation while retaining both journals until an exact
# same-generation host gate succeeds.  A failure therefore recovers forward to
# this deliberately selected rollback target without creating mixed controls.
ACK_CONTROL_PLANE_GENERATION=YES \
  /usr/local/lib/resume-ai/install-control-plane-generation.sh commit \
  "$RELEASE_ROOT/$PREVIOUS_RELEASE" \
  "$ARTIFACT_ROOT/$PREVIOUS_RELEASE/source-manifest.txt"
ALLOW_PENDING_TRANSACTION=1 "$SCRIPT_DIR/verify-release-consistency.sh" "$STATE_FILE" >/dev/null
ALLOW_PENDING_TRANSACTION=1 RUN_CERTBOT_DRY_RUN=0 \
  /usr/local/lib/resume-ai/verify-production-host.sh >/dev/null
ACK_CONTROL_PLANE_GENERATION=YES \
  /usr/local/lib/resume-ai/install-control-plane-generation.sh finalize \
  "$RELEASE_ROOT/$PREVIOUS_RELEASE" \
  "$ARTIFACT_ROOT/$PREVIOUS_RELEASE/source-manifest.txt"
journal_written=0
rm -f -- "$PENDING_FILE"
sync -f "$STATE_DIR"
"$SCRIPT_DIR/verify-release-consistency.sh" "$STATE_FILE" >/dev/null
RUN_CERTBOT_DRY_RUN=0 /usr/local/lib/resume-ai/verify-production-host.sh >/dev/null
trap - ERR EXIT
printf '%s\n' "Rolled back from $ACTIVE_RELEASE to $PREVIOUS_RELEASE on port $PREVIOUS_PORT."
