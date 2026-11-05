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

root_curl() {
  (cd / && /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin \
    /usr/bin/curl --disable --noproxy '*' "$@")
}

[ "${EUID:-$(id -u)}" -eq 0 ] || fail "run as root"
[ "${ACK_INITIALIZE_RELEASE_STATE:-}" = YES ] \
  || fail "set ACK_INITIALIZE_RELEASE_STATE=YES after the adopted process is healthy"
[ "$#" -eq 2 ] || fail "usage: initialize-release-state.sh RELEASE_ID PORT"
RELEASE_ID=$1
ACTIVE_PORT=$2
case "$RELEASE_ID" in 20??????T??????Z) ;; *) fail "invalid release id" ;; esac
case "$ACTIVE_PORT" in 3000|3001) ;; *) fail "port must be 3000 or 3001" ;; esac

RELEASE_ROOT=/opt/resume-ai/releases
STATE_DIR=/opt/resume-ai/state
STATE_FILE="$STATE_DIR/active.env"
PENDING_FILE="$STATE_DIR/deploy.pending"
CURRENT_LINK=/opt/resume-ai/current
NGINX_UPSTREAM=/etc/nginx/conf.d/10-resume-ai-upstream.conf
PM2_HOME=/var/lib/resume-ai/.pm2
ARTIFACT_MANIFEST="/opt/resume-ai/release-artifacts/$RELEASE_ID/release-manifest.json"
SOURCE_MANIFEST="/opt/resume-ai/release-artifacts/$RELEASE_ID/source-manifest.txt"
APPROVAL_FILE="/etc/resume-ai/approved-releases/$RELEASE_ID.env"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
. "$SCRIPT_DIR/open-root-lock.sh"
RELEASE_DIR="$RELEASE_ROOT/$RELEASE_ID"
[ -d "$RELEASE_DIR" ] && [ ! -L "$RELEASE_DIR" ] || fail "adopted release directory is missing or unsafe"
[ -f "$APPROVAL_FILE" ] && [ ! -L "$APPROVAL_FILE" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$APPROVAL_FILE")" = root:root:400:1 ] \
  || fail "adopted release root approval is missing or unsafe"
APPROVAL_FILE_SHA256="$(sha256sum "$APPROVAL_FILE" | awk '{print $1}')"
[ "$(stat -c '%U:%G' "$RELEASE_DIR")" = root:resume-ai ] || fail "adopted release is not root-owned"
unsafe_member="$(find "$RELEASE_DIR" -xdev ! -type l \( ! -user root -o -perm /022 \) -print -quit)"
[ -z "$unsafe_member" ] || fail "adopted release is writable by its runtime account"
[ -d "/var/cache/resume-ai/$RELEASE_ID" ] \
  && [ ! -L "/var/cache/resume-ai/$RELEASE_ID" ] \
  && [ "$(readlink -e -- "/var/cache/resume-ai/$RELEASE_ID")" = "/var/cache/resume-ai/$RELEASE_ID" ] \
  && [ "$(stat -c '%U:%G:%a' "/var/cache/resume-ai/$RELEASE_ID")" = resume-ai:resume-ai:750 ] \
  || fail "adopted release cache is missing or unsafe"
for contract_file in \
  "$ARTIFACT_MANIFEST" \
  "$RELEASE_DIR/ops/config/migrations.manifest" \
  "$RELEASE_DIR/ops/postgresql/runtime-table-privileges.conf" \
  "$RELEASE_DIR/ops/postgresql/runtime-function-privileges.conf"; do
  [ -f "$contract_file" ] && [ ! -L "$contract_file" ] \
    || fail "adopted release lacks a manifest-bound database contract: $contract_file"
done
root_node - "$ARTIFACT_MANIFEST" "$RELEASE_DIR" <<'NODE'
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const [manifestPath, releaseRoot] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const contract = manifest?.databaseContract;
if (contract?.schemaVersion !== 1 || contract?.runtimeRequiresDirectDelete !== false || contract?.functionOwnerRoleSuffix !== "_owner") process.exit(2);
const hash = (relative) => crypto.createHash("sha256").update(fs.readFileSync(path.join(releaseRoot, relative))).digest("hex");
for (const [key, relative] of [
  ["migrationsManifestSha256", "ops/config/migrations.manifest"],
  ["runtimeTablePolicySha256", "ops/postgresql/runtime-table-privileges.conf"],
  ["runtimeFunctionPolicySha256", "ops/postgresql/runtime-function-privileges.conf"]
]) {
  if (!/^[a-f0-9]{64}$/u.test(contract[key] ?? "") || contract[key] !== hash(relative)) process.exit(3);
}
NODE
[ ! -e "$STATE_FILE" ] && [ ! -L "$STATE_FILE" ] || fail "release state is already initialized"
[ ! -e "$PENDING_FILE" ] && [ ! -L "$PENDING_FILE" ] || fail "another release transaction is pending"

open_root_lock 9 deploy
umask 077
install -d -o root -g resume-ai -m 0750 "$STATE_DIR"

pm2_as_app() {
  runuser -u resume-ai -- env -i HOME=/var/lib/resume-ai PM2_HOME="$PM2_HOME" \
    PATH=/opt/nodejs/current/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin "$@"
}
root_curl -fsS --connect-timeout 2 --max-time 5 "http://127.0.0.1:$ACTIVE_PORT/" >/dev/null \
  || fail "adopted release is not healthy"
runuser -u resume-ai -- env -i HOME=/var/lib/resume-ai PATH=/opt/nodejs/current/bin:/usr/bin:/bin \
  /opt/nodejs/current/bin/node "$RELEASE_DIR/scripts/verify-next-assets.mjs" "http://127.0.0.1:$ACTIVE_PORT/"
pm2_as_app pm2 save >/dev/null
chmod 0600 "$PM2_HOME/dump.pm2"
sync -f "$PM2_HOME/dump.pm2"
sync -f "$PM2_HOME"
/usr/local/lib/resume-ai/provision-postgres-runtime-role.sh verify >/dev/null
/usr/local/lib/resume-ai/provision-postgres-maintenance-role.sh verify >/dev/null
/usr/local/lib/resume-ai/configure-security-state-cleanup.sh

write_journal() {
  local phase=$1 journal_temp
  journal_temp="$(mktemp "$STATE_DIR/.initialize-pending.XXXXXX")"
  cat > "$journal_temp" <<EOF
KIND=initialize
PHASE=$phase
OLD_ACTIVE_PORT=none
OLD_ACTIVE_RELEASE=none
OLD_PREVIOUS_PORT=none
OLD_PREVIOUS_RELEASE=none
NEW_PORT=$ACTIVE_PORT
NEW_RELEASE=$RELEASE_ID
NEW_PREVIOUS_PORT=none
NEW_PREVIOUS_RELEASE=none
APPROVAL_FILE_SHA256=$APPROVAL_FILE_SHA256
EOF
  chown root:resume-ai "$journal_temp"
  chmod 0640 "$journal_temp"
  mv -f -- "$journal_temp" "$PENDING_FILE"
  sync -f "$PENDING_FILE"
  sync -f "$STATE_DIR"
}

journal_written=0
leave_recovery_journal() {
  local status=$?
  trap - ERR EXIT
  if [ "$journal_written" -eq 1 ]; then
    printf '%s\n' "Initialization interrupted; durable journal retained for automatic recovery." >&2
  fi
  exit "$status"
}
trap leave_recovery_journal ERR EXIT

write_journal prepared
journal_written=1
upstream_temp="$(mktemp /etc/nginx/conf.d/.resume-ai-upstream.XXXXXX)"
cat > "$upstream_temp" <<EOF
# Managed atomically by ops/bin/initialize-release-state.sh.
upstream resume_ai_active {
    server 127.0.0.1:$ACTIVE_PORT max_fails=2 fail_timeout=10s;
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

current_temp="/opt/resume-ai/.current-$RELEASE_ID"
rm -f -- "$current_temp"
ln -s "releases/$RELEASE_ID" "$current_temp"
mv -Tf -- "$current_temp" "$CURRENT_LINK"
sync -f /opt/resume-ai
state_temp="$(mktemp "$STATE_DIR/.active.XXXXXX")"
cat > "$state_temp" <<EOF
ACTIVE_PORT=$ACTIVE_PORT
ACTIVE_RELEASE=$RELEASE_ID
PREVIOUS_PORT=none
PREVIOUS_RELEASE=none
SWITCHED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF
chown root:resume-ai "$state_temp"
chmod 0640 "$state_temp"
mv -f -- "$state_temp" "$STATE_FILE"
sync -f "$STATE_FILE"
sync -f "$STATE_DIR"
systemctl start resume-ai-security-state-cleanup.service
/usr/local/lib/resume-ai/write-database-permission-state.sh "$RELEASE_ID" rpc-only
write_journal state_committed

ACK_CONTROL_PLANE_GENERATION=YES \
  /usr/local/lib/resume-ai/install-control-plane-generation.sh bootstrap \
  "$RELEASE_DIR" "$SOURCE_MANIFEST"

ALLOW_PENDING_TRANSACTION=1 "$SCRIPT_DIR/verify-release-consistency.sh" "$STATE_FILE" >/dev/null
ALLOW_PENDING_TRANSACTION=1 RUN_CERTBOT_DRY_RUN=0 \
  /usr/local/lib/resume-ai/verify-production-host.sh >/dev/null
ACK_CONTROL_PLANE_GENERATION=YES \
  /usr/local/lib/resume-ai/install-control-plane-generation.sh finalize \
  "$RELEASE_DIR" "$SOURCE_MANIFEST"
rm -f -- "$PENDING_FILE"
sync -f "$STATE_DIR"
journal_written=0
"$SCRIPT_DIR/verify-release-consistency.sh" "$STATE_FILE" >/dev/null
RUN_CERTBOT_DRY_RUN=0 /usr/local/lib/resume-ai/verify-production-host.sh >/dev/null
trap - ERR EXIT
printf '%s\n' "Initialized durable five-way release state at $RELEASE_ID on port $ACTIVE_PORT."
