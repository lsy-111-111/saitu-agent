#!/usr/bin/env bash
set -Eeuo pipefail
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

fail() {
  printf '%s\n' "ERROR: $*" >&2
  exit 1
}

[ "${EUID:-$(id -u)}" -eq 0 ] || fail "run as root"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
. "$SCRIPT_DIR/open-root-lock.sh"
[ "${ACK_LEGACY_ADOPTION:-}" = YES ] \
  || fail "set ACK_LEGACY_ADOPTION=YES for the reviewed one-time adoption"
[ "${CLOUD_SNAPSHOT_CONFIRMED:-}" = YES ] \
  || fail "set CLOUD_SNAPSHOT_CONFIRMED=YES only after the system-disk snapshot is usable"
[ "$#" -eq 2 ] || fail "usage: adopt-legacy-release.sh LEGACY_PM2_PID RELEASE_ID"
LEGACY_PID=$1
RELEASE_ID=$2
[[ "$LEGACY_PID" =~ ^[1-9][0-9]*$ ]] || fail "legacy PID must be a positive integer"
case "$RELEASE_ID" in 20??????T??????Z) ;; *) fail "invalid legacy release id" ;; esac
[[ "${CLOUD_SNAPSHOT_ID:-}" =~ ^lhsnap-[A-Za-z0-9]{6,80}$ ]] \
  || fail "CLOUD_SNAPSHOT_ID must identify one verified Lighthouse snapshot"
SNAPSHOT_EVIDENCE="/var/lib/resume-ai/security/cloud-snapshots/$RELEASE_ID.initial-rollback.env"
[ ! -e "/var/lib/resume-ai/security/cloud-snapshots/$RELEASE_ID.initial-rollback.pending" ] \
  && [ ! -L "/var/lib/resume-ai/security/cloud-snapshots/$RELEASE_ID.initial-rollback.pending" ] \
  || fail "the initial pre-change Lighthouse rollback snapshot is still pending/not-performed"
[ -f "$SNAPSHOT_EVIDENCE" ] && [ ! -L "$SNAPSHOT_EVIDENCE" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$SNAPSHOT_EVIDENCE")" = root:root:400:1 ] \
  || fail "initial pre-change Lighthouse rollback evidence is missing or unsafe"
python3 -I - "$SNAPSHOT_EVIDENCE" "$RELEASE_ID" "$CLOUD_SNAPSHOT_ID" <<'PY'
import datetime
import pathlib
import re
import sys

allowed = {
    "SCHEMA_VERSION", "PROVIDER", "REGION", "INSTANCE_ID", "SYSTEM_DISK_ID",
    "SYSTEM_DISK_ZONE", "SYSTEM_DISK_STATE", "SYSTEM_DISK_ATTACHED",
    "SNAPSHOT_ID", "SNAPSHOT_STATUS", "SNAPSHOT_PERCENT", "RELEASE_ID",
    "CAPTURED_AT", "VERIFIED_AT", "RESTORE_SCOPE", "VERIFICATION_SOURCE",
    "SNAPSHOT_RESPONSE_SHA256", "DISKS_RESPONSE_SHA256", "SNAPSHOT_REQUEST_ID",
    "DISKS_REQUEST_ID", "SNAPSHOT_NAME",
}
values = {}
for line in pathlib.Path(sys.argv[1]).read_text(encoding="utf-8").splitlines():
    if "=" not in line:
        raise SystemExit("cloud snapshot evidence contains a malformed row")
    key, value = line.split("=", 1)
    if key not in allowed or key in values or not value:
        raise SystemExit("cloud snapshot evidence contains an unknown, duplicate, or empty value")
    values[key] = value
if (set(values) != allowed or values["SCHEMA_VERSION"] != "3"
        or values["PROVIDER"] != "tencent-lighthouse"
        or values["REGION"] != "ap-guangzhou"
        or values["INSTANCE_ID"] != "lhins-aw4n6o9t"
        or values["RELEASE_ID"] != sys.argv[2] or values["SNAPSHOT_ID"] != sys.argv[3]
        or values["SNAPSHOT_NAME"] != f"resume-ai-initial-rollback-{sys.argv[2]}"
        or values["SNAPSHOT_STATUS"] != "NORMAL" or values["SNAPSHOT_PERCENT"] != "100"
        or values["RESTORE_SCOPE"] != "system-disk"
        or values["VERIFICATION_SOURCE"] != "tencent-lighthouse-api-describe"
        or values["SYSTEM_DISK_STATE"] != "ATTACHED"
        or values["SYSTEM_DISK_ATTACHED"] != "true"
        or re.fullmatch(r"ap-guangzhou-[1-9][0-9]*", values["SYSTEM_DISK_ZONE"]) is None
        or re.fullmatch(r"lhdisk-[A-Za-z0-9]{6,80}", values["SYSTEM_DISK_ID"]) is None
        or re.fullmatch(r"lhsnap-[A-Za-z0-9]{6,80}", values["SNAPSHOT_ID"]) is None
        or any(re.fullmatch(r"[a-f0-9]{64}", values[key]) is None for key in (
            "SNAPSHOT_RESPONSE_SHA256", "DISKS_RESPONSE_SHA256"))
        or any(re.fullmatch(r"[A-Za-z0-9-]{8,128}", values[key]) is None for key in (
            "SNAPSHOT_REQUEST_ID", "DISKS_REQUEST_ID"))):
    raise SystemExit("cloud snapshot evidence identity/status contract is invalid")
def parse(value):
    return datetime.datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(
        tzinfo=datetime.timezone.utc
    )
captured = parse(values["CAPTURED_AT"])
verified = parse(values["VERIFIED_AT"])
now = datetime.datetime.now(datetime.timezone.utc)
if (captured > verified or verified > now + datetime.timedelta(minutes=5)
        or now - verified > datetime.timedelta(hours=24)
        or verified - captured > datetime.timedelta(hours=24)):
    raise SystemExit("Lighthouse snapshot evidence is stale or temporally inconsistent")
PY
SNAPSHOT_EVIDENCE_ID="$(stat -c '%d:%i:%s:%Y:%Z' "$SNAPSHOT_EVIDENCE")"
SNAPSHOT_EVIDENCE_SHA256="$(sha256sum "$SNAPSHOT_EVIDENCE" | awk '{print $1}')"
[[ "$SNAPSHOT_EVIDENCE_SHA256" =~ ^[a-f0-9]{64}$ ]] \
  || fail "release-bound Lighthouse evidence hash is malformed"
[ -f /usr/local/lib/resume-ai/record-cloud-snapshot-evidence.py ] \
  && [ ! -L /usr/local/lib/resume-ai/record-cloud-snapshot-evidence.py ] \
  && [ "$(stat -c '%U:%G:%a:%h' /usr/local/lib/resume-ai/record-cloud-snapshot-evidence.py)" = root:root:755:1 ] \
  || fail "fixed Lighthouse evidence verifier is missing or unsafe"
/usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin \
  /usr/bin/python3 -I /usr/local/lib/resume-ai/record-cloud-snapshot-evidence.py \
  --verify-initial-rollback "$SNAPSHOT_EVIDENCE" "$RELEASE_ID" \
  "$CLOUD_SNAPSHOT_ID" "$SNAPSHOT_EVIDENCE_SHA256" >/dev/null \
  || fail "initial Lighthouse rollback evidence failed its global identity gate"

for command_name in curl flock nginx python3 readlink runuser sha256sum ss sync systemctl tar; do
  command -v "$command_name" >/dev/null 2>&1 || fail "$command_name is unavailable"
done
[ -x /opt/nodejs/current/bin/node ] && [ -x /opt/nodejs/current/bin/pm2 ] \
  || fail "the approved Node runtime is not installed"
[ "$(/opt/nodejs/current/bin/node --version)" = v24.20.0 ] \
  || fail "legacy adoption requires the pinned Node v24.20.0 runtime"
id resume-ai >/dev/null 2>&1 || fail "the resume-ai runtime account is missing"
id ubuntu >/dev/null 2>&1 || fail "the legacy ubuntu account is missing"

RELEASE_ROOT=/opt/resume-ai/releases
STAGING_ROOT=/opt/resume-ai/adoption-staging
FINAL_RELEASE="$RELEASE_ROOT/$RELEASE_ID"
STAGING_RELEASE="$STAGING_ROOT/$RELEASE_ID"
STATE_DIR=/opt/resume-ai/state
STATE_FILE="$STATE_DIR/active.env"
DATABASE_STATE_FILE="$STATE_DIR/database-permissions.env"
PENDING_FILE="$STATE_DIR/legacy-adoption.pending"
DEPLOY_PENDING_FILE="$STATE_DIR/deploy.pending"
CURRENT_LINK=/opt/resume-ai/current
NGINX_UPSTREAM=/etc/nginx/conf.d/10-resume-ai-upstream.conf
PM2_HOME=/var/lib/resume-ai/.pm2
LEGACY_PM2_HOME=/home/ubuntu/.pm2
LEGACY_PROCESS_NAME=resume-ai
LEGACY_PORT=3000
CANDIDATE_PORT=3001
CANDIDATE_PROCESS_NAME=resume-ai-3001
LEGACY_ENV_SOURCE="/home/ubuntu/resume-ai-web-releases/$RELEASE_ID/.env.local"
LEGACY_ENV_TARGET=/etc/resume-ai/legacy.env
EVIDENCE_ROOT=/var/backups/resume-ai/legacy-adoption
EVIDENCE_DIR="$EVIDENCE_ROOT/$RELEASE_ID"
SOURCE_ARCHIVE="$EVIDENCE_DIR/source.sanitized.tar.gz"
SOURCE_FILE_LIST="$EVIDENCE_DIR/source-members.list0"
LEGACY_POLICY=/usr/local/share/resume-ai/legacy-env-keys.conf
LEGACY_ECOSYSTEM=/usr/local/share/resume-ai/legacy-ecosystem.config.cjs
ASSET_VERIFIER=/usr/local/share/resume-ai/legacy-verify-next-assets.mjs
RECOVERY_SCRIPT=/usr/local/lib/resume-ai/recover-legacy-adoption.sh
SOURCE_MANIFEST_TOOL=/usr/local/lib/resume-ai/create-release-source-manifest.sh
IMMUTABLE_MANIFEST_TOOL=/usr/local/lib/resume-ai/create-immutable-tree-manifest.py
SECRET_SCANNER=/usr/local/lib/resume-ai/scan-release-secrets.sh
LEGACY_SNAPSHOT_HELPER=/usr/local/lib/resume-ai/snapshot-legacy-release.py
DATABASE_STATE_WRITER=/usr/local/lib/resume-ai/write-database-permission-state.sh
CONSISTENCY_VERIFIER=/usr/local/lib/resume-ai/verify-release-consistency.sh
PM2_POLICY_VERIFIER=/usr/local/lib/resume-ai/assert-pm2-effective-service.sh
START_TICKS_READER=/usr/local/lib/resume-ai/read-proc-start-ticks.py
HOST_BASELINE_DIR=${HOST_BASELINE_DIR:-}
HOST_BASELINE_MANIFEST_SHA256=${HOST_BASELINE_MANIFEST_SHA256:-}
PUBLIC_URL=https://siyuanjiaxin.com/

for directory in "$RELEASE_ROOT" "$STAGING_ROOT" "$STATE_DIR" "$PM2_HOME" /etc/resume-ai; do
  [ -d "$directory" ] && [ ! -L "$directory" ] || fail "runtime layout is missing or unsafe: $directory"
done
for trusted_control in \
  "$LEGACY_POLICY" "$LEGACY_ECOSYSTEM" "$ASSET_VERIFIER" "$RECOVERY_SCRIPT" \
  "$SOURCE_MANIFEST_TOOL" "$IMMUTABLE_MANIFEST_TOOL" "$SECRET_SCANNER" \
  "$DATABASE_STATE_WRITER" "$CONSISTENCY_VERIFIER" "$PM2_POLICY_VERIFIER" \
  "$START_TICKS_READER"; do
  [ -f "$trusted_control" ] && [ ! -L "$trusted_control" ] \
    && [ "$(stat -c '%U:%G:%h' "$trusted_control")" = root:root:1 ] \
    && [ -z "$(find "$trusted_control" -maxdepth 0 -perm /022 -print)" ] \
    || fail "trusted adoption control is missing or unsafe: $trusted_control"
done
[ -f "$LEGACY_SNAPSHOT_HELPER" ] && [ ! -L "$LEGACY_SNAPSHOT_HELPER" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$LEGACY_SNAPSHOT_HELPER")" = root:root:755:1 ] \
  || fail "trusted legacy snapshot helper is missing or unsafe"
[ -f "$NGINX_UPSTREAM" ] && [ ! -L "$NGINX_UPSTREAM" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$NGINX_UPSTREAM")" = root:root:644:1 ] \
  || fail "managed Nginx upstream is missing or unsafe"
[ ! -e "$STATE_FILE" ] && [ ! -L "$STATE_FILE" ] \
  || fail "managed release state already exists; legacy adoption is no longer valid"
[ ! -e "$DATABASE_STATE_FILE" ] && [ ! -L "$DATABASE_STATE_FILE" ] \
  || fail "database permission state already exists; legacy adoption is no longer valid"
[ ! -e "$CURRENT_LINK" ] && [ ! -L "$CURRENT_LINK" ] \
  || fail "the managed current pointer already exists"
[ ! -e "$DEPLOY_PENDING_FILE" ] && [ ! -L "$DEPLOY_PENDING_FILE" ] \
  || fail "a managed release transaction is pending"
[ ! -e "$PENDING_FILE" ] && [ ! -L "$PENDING_FILE" ] \
  || fail "a legacy adoption journal already exists; run recover-legacy-adoption.sh"
[ ! -e "$FINAL_RELEASE" ] && [ ! -e "$STAGING_RELEASE" ] \
  || fail "legacy adoption destination already exists"
[ ! -e "$EVIDENCE_DIR" ] || fail "legacy adoption evidence already exists"

case "$HOST_BASELINE_DIR" in
  /var/backups/resume-ai/prechange/20??????T??????Z) ;;
  *) fail "HOST_BASELINE_DIR must name the protected pre-change host baseline" ;;
esac
[ -d "$HOST_BASELINE_DIR" ] && [ ! -L "$HOST_BASELINE_DIR" ] \
  && [ "$(stat -c '%U:%G:%a' "$HOST_BASELINE_DIR")" = root:root:700 ] \
  || fail "host baseline directory is missing or unsafe"
for baseline_file in SHA256SUMS bootstrap-boundary.env source-SHA256SUMS legacy-runtime.manifest.jsonl \
  system-config.tar.gz nginx-effective.txt postgres-backup.txt; do
  baseline_path="$HOST_BASELINE_DIR/$baseline_file"
  [ -f "$baseline_path" ] && [ ! -L "$baseline_path" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$baseline_path")" = root:root:600:1 ] \
    || fail "required host baseline evidence is missing or unsafe: $baseline_file"
done
(cd "$HOST_BASELINE_DIR" && sha256sum -c SHA256SUMS >/dev/null) \
  || fail "host baseline checksums do not verify"
[ -s "$HOST_BASELINE_DIR/postgres-backup.txt" ] \
  || fail "host baseline does not identify a pre-change PostgreSQL backup"
[[ "$HOST_BASELINE_MANIFEST_SHA256" =~ ^[a-f0-9]{64}$ ]] \
  || fail "HOST_BASELINE_MANIFEST_SHA256 must be the independently retained baseline digest"
BOOTSTRAP_RECEIPT=/var/lib/resume-ai/bootstrap-generation.env
[ -f "$BOOTSTRAP_RECEIPT" ] && [ ! -L "$BOOTSTRAP_RECEIPT" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$BOOTSTRAP_RECEIPT")" = root:root:400:1 ] \
  || fail "active bootstrap receipt is missing or unsafe"
bootstrap_generation="$(awk -F= '$1 == "GENERATION_PATH" { print $2 }' "$BOOTSTRAP_RECEIPT")"
bootstrap_manifest="$(awk -F= '$1 == "BOOTSTRAP_MANIFEST_SHA256" { print $2 }' "$BOOTSTRAP_RECEIPT")"
BASELINE_VERIFIER=/usr/local/lib/resume-ai/verify-host-baseline.py
[ -f "$BASELINE_VERIFIER" ] && [ ! -L "$BASELINE_VERIFIER" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$BASELINE_VERIFIER")" = root:root:755:1 ] \
  || fail "fixed host baseline verifier is missing or unsafe"
baseline_identity="$(/usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin \
  /usr/bin/python3 -I "$BASELINE_VERIFIER" "$HOST_BASELINE_DIR" \
  "$HOST_BASELINE_MANIFEST_SHA256" "$bootstrap_generation" \
  "$bootstrap_manifest")" \
  || fail "host baseline failed its fixed semantic verifier"
IFS=$'\t' read -r verified_baseline_manifest baseline_snapshot_release \
  baseline_snapshot_path baseline_snapshot_id baseline_snapshot_sha \
  baseline_bootstrap_started <<< "$baseline_identity"
[ "$verified_baseline_manifest:$baseline_snapshot_release:$baseline_snapshot_path:$baseline_snapshot_id:$baseline_snapshot_sha" \
    = "$HOST_BASELINE_MANIFEST_SHA256:$RELEASE_ID:$SNAPSHOT_EVIDENCE:$CLOUD_SNAPSHOT_ID:$SNAPSHOT_EVIDENCE_SHA256" ] \
  || fail "legacy adoption snapshot differs from its protected host baseline"

open_root_lock 9 deploy

TEMP_DIR="$(mktemp -d /run/resume-ai-legacy-adoption.XXXXXX)"
OLD_PM2_JSON="$TEMP_DIR/legacy-pm2.json"
NEW_PM2_JSON="$TEMP_DIR/managed-pm2.json"
LIVE_SOURCE_SUMS="$TEMP_DIR/live-source-SHA256SUMS"
SNAPSHOT_SOURCE_SUMS="$TEMP_DIR/snapshot-source-SHA256SUMS"
LEGACY_SNAPSHOT_ROOT="$STAGING_ROOT/.source-snapshot-$RELEASE_ID.$$"
ARCHIVE_SOURCE="$LEGACY_SNAPSHOT_ROOT/source"
ENV_METADATA="$TEMP_DIR/legacy-env-metadata.env"
ENV_TEMP="/etc/resume-ai/.legacy.env-$RELEASE_ID.tmp"
JOURNAL_WRITTEN=0
ADOPTION_COMMITTED=0
SOURCE_ARCHIVE_SHA256=0000000000000000000000000000000000000000000000000000000000000000
[ ! -e "$ENV_TEMP" ] && [ ! -L "$ENV_TEMP" ] \
  || fail "legacy environment staging file already exists; run adoption recovery"

safe_remove_staging() {
  if [[ "$STAGING_RELEASE" == /opt/resume-ai/adoption-staging/20??????T??????Z ]] \
    && [ -d "$STAGING_RELEASE" ] && [ ! -L "$STAGING_RELEASE" ]; then
    find "$STAGING_RELEASE" -xdev -depth -delete >/dev/null 2>&1 || true
  fi
}

cleanup_temporary_files() {
  if [[ "$ENV_TEMP" == /etc/resume-ai/.legacy.env-20??????T??????Z.tmp ]]; then
    rm -f -- "$ENV_TEMP" >/dev/null 2>&1 || true
  fi
  [ ! -e "$TEMP_DIR" ] || find "$TEMP_DIR" -xdev -depth -delete >/dev/null 2>&1 || true
  if [[ "$LEGACY_SNAPSHOT_ROOT" == /opt/resume-ai/adoption-staging/.source-snapshot-20??????T??????Z.[1-9]* ]] \
    && [ -d "$LEGACY_SNAPSHOT_ROOT" ] && [ ! -L "$LEGACY_SNAPSHOT_ROOT" ]; then
    find "$LEGACY_SNAPSHOT_ROOT" -xdev -depth -delete >/dev/null 2>&1 || true
  fi
}

recover_on_failure() {
  local exit_status=$?
  trap - ERR EXIT
  set +e
  cleanup_temporary_files
  if [ "$ADOPTION_COMMITTED" -eq 1 ]; then
    printf '%s\n' "Legacy adoption committed, but a final read-only check failed; managed state and evidence were preserved." >&2
  elif [ "$JOURNAL_WRITTEN" -eq 1 ] && [ -e "$PENDING_FILE" ]; then
    if ! systemctl is-active --quiet resume-ai-pm2.service; then
      "$PM2_POLICY_VERIFIER" >/dev/null 2>&1 \
        && systemctl start resume-ai-pm2.service >/dev/null 2>&1 \
        || printf '%s\n' "Managed PM2 could not start; boot recovery retains the journal and remains fail-closed." >&2
    fi
    flock -u 9 >/dev/null 2>&1 || true
    "$RECOVERY_SCRIPT" >/dev/null 2>&1 \
      || printf '%s\n' "Legacy adoption interrupted; the durable journal was retained for boot recovery." >&2
  else
    safe_remove_staging
    if [ -d "$EVIDENCE_DIR" ] && [ ! -L "$EVIDENCE_DIR" ]; then
      aborted="$EVIDENCE_ROOT/$RELEASE_ID.aborted.$(date -u +%Y%m%dT%H%M%SZ).$$"
      mv -- "$EVIDENCE_DIR" "$aborted" >/dev/null 2>&1 || true
      sync -f "$EVIDENCE_ROOT" >/dev/null 2>&1 || true
    fi
  fi
  exit "$exit_status"
}
trap recover_on_failure ERR EXIT

old_pm2_as_ubuntu() {
  runuser -u ubuntu -- env -i HOME=/home/ubuntu PM2_HOME="$LEGACY_PM2_HOME" \
    PATH=/usr/bin:/bin "$@"
}

pm2_as_app() {
  runuser -u resume-ai -- env -i HOME=/var/lib/resume-ai PM2_HOME="$PM2_HOME" \
    PATH=/opt/nodejs/current/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin "$@"
}

assert_legacy_pid_identity() {
  [ -d "/proc/$LEGACY_PID" ] \
    && [ "$(stat -c '%U' "/proc/$LEGACY_PID")" = ubuntu ] \
    && [ "$("$START_TICKS_READER" "$LEGACY_PID")" = "$LEGACY_START_TIME_TICKS" ] \
    && [ "$(readlink -e "/proc/$LEGACY_PID/cwd")" = "$LEGACY_SOURCE" ] \
    || fail "legacy PID identity changed during adoption"
}

fsync_tree() {
  local tree=$1 member
  while IFS= read -r -d '' member; do sync -f "$member"; done \
    < <(find "$tree" -xdev -type f -print0)
  while IFS= read -r -d '' member; do sync -f "$member"; done \
    < <(find "$tree" -xdev -depth -type d -print0)
}

write_journal() {
  local phase=$1 journal_temp
  journal_temp="$(mktemp "$STATE_DIR/.legacy-adoption.XXXXXX")"
  cat > "$journal_temp" <<EOF
KIND=adopt
PHASE=$phase
RELEASE_ID=$RELEASE_ID
OLD_PID=$LEGACY_PID
OLD_START_TIME_TICKS=$LEGACY_START_TIME_TICKS
OLD_SOURCE=$LEGACY_SOURCE
OLD_PROCESS=$LEGACY_PROCESS_NAME
OLD_PM2_HOME=$LEGACY_PM2_HOME
OLD_PORT=$LEGACY_PORT
NEW_PORT=$CANDIDATE_PORT
EVIDENCE_DIR=$EVIDENCE_DIR
SOURCE_ARCHIVE_SHA256=$SOURCE_ARCHIVE_SHA256
EOF
  chown root:resume-ai "$journal_temp"
  chmod 0640 "$journal_temp"
  mv -f -- "$journal_temp" "$PENDING_FILE"
  sync -f "$PENDING_FILE"
  sync -f "$STATE_DIR"
}

resolved_old_pm2="$(readlink -f /usr/bin/pm2 2>/dev/null || true)"
case "$resolved_old_pm2" in /usr/lib/node_modules/pm2/bin/pm2) ;; *) fail "legacy PM2 control path is not the observed root installation" ;; esac
[ -f "$resolved_old_pm2" ] && [ ! -L "$resolved_old_pm2" ] \
  && [ "$(stat -c '%U:%G:%h' "$resolved_old_pm2")" = root:root:1 ] \
  && [ ! -w "$resolved_old_pm2" ] \
  || fail "legacy PM2 control is writable or not root-owned"

[ -d "/proc/$LEGACY_PID" ] || fail "the expected legacy PID is not running"
[ "$(stat -c '%U' "/proc/$LEGACY_PID")" = ubuntu ] \
  || fail "the expected legacy PID is not owned by ubuntu"
LEGACY_START_TIME_TICKS="$("$START_TICKS_READER" "$LEGACY_PID")"
[[ "$LEGACY_START_TIME_TICKS" =~ ^[1-9][0-9]*$ ]] \
  || fail "legacy PID start-time identity is invalid"
LEGACY_SOURCE="$(readlink -e "/proc/$LEGACY_PID/cwd")" \
  || fail "the expected legacy PID cwd cannot be resolved"
[ "$LEGACY_SOURCE" = "/home/ubuntu/resume-ai-web-releases/$RELEASE_ID" ] \
  || fail "legacy PID cwd does not match the explicitly approved release id"
LEGACY_SOURCE_DEVICE="$(stat -Lc '%d' "/proc/$LEGACY_PID/cwd")"
LEGACY_SOURCE_INODE="$(stat -Lc '%i' "/proc/$LEGACY_PID/cwd")"
[[ "$LEGACY_SOURCE_DEVICE:$LEGACY_SOURCE_INODE" =~ ^[0-9]+:[1-9][0-9]*$ ]] \
  || fail "legacy PID cwd identity is invalid"
[ -d "$LEGACY_SOURCE" ] && [ ! -L "$LEGACY_SOURCE" ] \
  && [ "$(stat -c '%U' "$LEGACY_SOURCE")" = ubuntu ] \
  && [ "$(stat -c '%d:%i' "$LEGACY_SOURCE")" = "$LEGACY_SOURCE_DEVICE:$LEGACY_SOURCE_INODE" ] \
  || fail "legacy source directory is missing, linked, or not ubuntu-owned"
[ "$LEGACY_ENV_SOURCE" = "$LEGACY_SOURCE/.env.local" ] \
  || fail "legacy environment source binding is inconsistent"

old_pm2_as_ubuntu /usr/bin/pm2 jlist > "$OLD_PM2_JSON"
chmod 0600 "$OLD_PM2_JSON"
LEGACY_SOURCE="$LEGACY_SOURCE" LEGACY_PID="$LEGACY_PID" \
python3 -I - "$OLD_PM2_JSON" <<'PY'
import json
import os
import pathlib
import sys

entries = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
matches = [entry for entry in entries if entry.get("name") == "resume-ai"]
if len(entries) != 1 or len(matches) != 1:
    raise SystemExit("legacy PM2 must contain exactly one resume-ai application")
entry = matches[0]
environment = entry.get("pm2_env") or {}
if entry.get("pid") != int(os.environ["LEGACY_PID"]):
    raise SystemExit("legacy PM2 PID differs from the explicit adoption PID")
if environment.get("status") != "online":
    raise SystemExit("legacy PM2 application is not online")
if pathlib.Path(environment.get("pm_cwd", "")).resolve() != pathlib.Path(os.environ["LEGACY_SOURCE"]):
    raise SystemExit("legacy PM2 cwd differs from /proc/PID/cwd")
expected_exec = pathlib.Path(os.environ["LEGACY_SOURCE"], "node_modules/next/dist/bin/next")
if pathlib.Path(str(environment.get("pm_exec_path", ""))) != expected_exec:
    raise SystemExit("legacy PM2 executable is not the Next.js entrypoint")
PY
[ "$(readlink -e "/proc/$LEGACY_PID/exe")" = /usr/bin/node ] \
  || fail "legacy PID is not using the retained root-owned system Node executable"
tr '\0' '\n' < "/proc/$LEGACY_PID/cmdline" | grep -Fq 'node_modules/next/dist/bin/next' \
  || fail "legacy PID command line is not the expected Next.js server"
legacy_status="$(curl -sS --connect-timeout 2 --max-time 5 -o /dev/null \
  -w '%{http_code}' "http://127.0.0.1:$LEGACY_PORT/")" \
  && [ "$legacy_status" = 200 ] \
  || fail "legacy service is not healthy on port 3000 (HTTP ${legacy_status:-000})"
legacy_listener="$(ss -H -ltnp 'sport = :3000')"
[ "$(printf '%s\n' "$legacy_listener" | awk 'NF { count += 1 } END { print count + 0 }')" -eq 1 ] \
  && printf '%s\n' "$legacy_listener" | grep -Fq "pid=$LEGACY_PID," \
  || fail "port 3000 is not owned exclusively by the explicit legacy PID"
if ! awk '
  /server 127\.0\.0\.1:300[01][[:space:]]/ {
    total += 1
    if ($0 ~ /server 127\.0\.0\.1:3000[[:space:]]/) matched += 1
  }
  END { exit total == 1 && matched == 1 ? 0 : 1 }
' "$NGINX_UPSTREAM"; then
  fail "Nginx is not bound exclusively to the unmanaged port 3000"
fi

# Prove that the explicitly supplied host baseline was captured from this
# exact sanitized source view.  This never reads or hashes .env.local.
(
  cd "$LEGACY_SOURCE"
  find . -type f \
    ! -path './node_modules/*' \
    ! -path './.next*/*' \
    ! -path './artifacts/*' \
    ! -path './.git/*' \
    ! -name '.env*' \
    ! -name '*.pem' \
    ! -name '*.key' \
    ! -name '*secret*' \
    ! -name '*credential*' \
    ! -name '*密钥*' \
    -print0 | sort -z | xargs -0 sha256sum
) > "$LIVE_SOURCE_SUMS"
cmp -s "$LIVE_SOURCE_SUMS" "$HOST_BASELINE_DIR/source-SHA256SUMS" \
  || fail "host baseline source hashes do not bind to the running legacy cwd"
assert_legacy_pid_identity

# This is the first durable mutation.  Power loss from this point onward is
# recoverable even if the environment copy, archive, or candidate is only
# partially prepared.  The all-zero archive hash is valid only in this phase.
write_journal initializing
JOURNAL_WRITTEN=1

install -d -o root -g root -m 0700 "$EVIDENCE_ROOT" "$EVIDENCE_DIR"
cp --preserve=mode,timestamps "$NGINX_UPSTREAM" "$EVIDENCE_DIR/nginx-upstream.before"
chown root:root "$EVIDENCE_DIR/nginx-upstream.before"
chmod 0600 "$EVIDENCE_DIR/nginx-upstream.before"
python3 -I - "$OLD_PM2_JSON" "$EVIDENCE_DIR/legacy-pm2-sanitized.json" <<'PY'
import json
import pathlib
import sys

entries = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
entry = next(value for value in entries if value.get("name") == "resume-ai")
environment = entry.get("pm2_env") or {}
safe = {
    "name": entry.get("name"),
    "pid": entry.get("pid"),
    "status": environment.get("status"),
    "cwd": environment.get("pm_cwd"),
    "execPath": environment.get("pm_exec_path"),
    "port": 3000,
}
pathlib.Path(sys.argv[2]).write_text(json.dumps(safe, sort_keys=True) + "\n", encoding="utf-8")
PY
chmod 0600 "$EVIDENCE_DIR/legacy-pm2-sanitized.json"

# Validate and atomically isolate the existing secret file.  Evidence contains
# only its source inode metadata and the hash of the exact key *set*; neither
# values nor a content hash are written outside /etc/resume-ai/legacy.env.
LEGACY_SOURCE_UID="$(id -u ubuntu)" \
python3 -I - "$LEGACY_ENV_SOURCE" "$LEGACY_POLICY" "$LEGACY_ENV_TARGET" \
  "$ENV_TEMP" "$ENV_METADATA" "$LEGACY_SOURCE_DEVICE" "$LEGACY_SOURCE_INODE" <<'PY'
import grp
import hashlib
import os
import pathlib
import re
import stat
import sys

source_path, policy_path, target_path, temp_path, metadata_path = map(pathlib.Path, sys.argv[1:6])
expected_source_identity = (int(sys.argv[6]), int(sys.argv[7]))
policy_meta = policy_path.lstat()
if (not stat.S_ISREG(policy_meta.st_mode) or policy_meta.st_uid != 0
        or policy_meta.st_gid != 0 or policy_meta.st_nlink != 1
        or stat.S_IMODE(policy_meta.st_mode) != 0o440):
    raise SystemExit("legacy key policy is unsafe")
keys = []
for raw in policy_path.read_text(encoding="utf-8").splitlines():
    if not raw or raw.startswith("#"):
        continue
    if not re.fullmatch(r"[A-Z][A-Z0-9_]*", raw) or raw in keys:
        raise SystemExit("legacy key policy is malformed")
    keys.append(raw)
if len(keys) != 31:
    raise SystemExit("legacy key policy does not contain the exact 31 observed keys")

source_directory = os.open(
    source_path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
)
try:
    source_directory_metadata = os.fstat(source_directory)
    if (source_directory_metadata.st_dev, source_directory_metadata.st_ino) != expected_source_identity:
        raise SystemExit("legacy environment path no longer belongs to the running cwd inode")
    descriptor = os.open(
        source_path.name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=source_directory
    )
    try:
        before = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1:
            raise SystemExit("legacy .env.local is not one ordinary file")
        if before.st_uid != int(os.environ["LEGACY_SOURCE_UID"]) or stat.S_IMODE(before.st_mode) != 0o600:
            raise SystemExit("legacy .env.local ownership or mode differs from the observed 0600 file")
        if before.st_size > 128 * 1024:
            raise SystemExit("legacy .env.local is unexpectedly large")
        chunks = []
        remaining = before.st_size + 1
        while remaining:
            chunk = os.read(descriptor, remaining)
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        raw = b"".join(chunks)
        after = os.fstat(descriptor)
    finally:
        os.close(descriptor)
finally:
    os.close(source_directory)
if (before.st_dev, before.st_ino, before.st_mode, before.st_uid, before.st_gid,
        before.st_nlink, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (
    after.st_dev, after.st_ino, after.st_mode, after.st_uid, after.st_gid,
        after.st_nlink, after.st_size, after.st_mtime_ns, after.st_ctime_ns
):
    raise SystemExit("legacy .env.local changed while it was read")
if len(raw) != before.st_size or b"\0" in raw or b"\r" in raw:
    raise SystemExit("legacy .env.local contains unsupported data")
if b"$" in raw:
    raise SystemExit("legacy .env.local uses dotenv expansion and needs a separately reviewed compatibility parser")
text = raw.decode("utf-8", errors="strict")
observed = []
for line_number, line in enumerate(text.split("\n"), 1):
    if not line or line.startswith("#"):
        continue
    match = re.fullmatch(r"([A-Z][A-Z0-9_]*)=(.*)", line)
    if not match or match.group(1) in observed:
        raise SystemExit(f"invalid or duplicate legacy environment line {line_number}")
    observed.append(match.group(1))
if set(observed) != set(keys) or len(observed) != len(keys):
    raise SystemExit("legacy .env.local keys differ from the exact reviewed production set")

target_gid = grp.getgrnam("resume-ai").gr_gid
if target_path.exists() or target_path.is_symlink():
    target_meta = target_path.lstat()
    if (not stat.S_ISREG(target_meta.st_mode) or target_meta.st_nlink != 1
            or target_meta.st_uid != 0 or target_meta.st_gid != target_gid
            or stat.S_IMODE(target_meta.st_mode) != 0o640):
        raise SystemExit("existing isolated legacy environment is unsafe")
    target_descriptor = os.open(target_path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        chunks = []
        remaining = before.st_size + 1
        while remaining:
            chunk = os.read(target_descriptor, remaining)
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        existing = b"".join(chunks)
    finally:
        os.close(target_descriptor)
    if existing != raw:
        raise SystemExit("existing isolated legacy environment differs from the running release")
else:
    output = os.open(temp_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        view = memoryview(raw)
        while view:
            written = os.write(output, view)
            if written <= 0:
                raise SystemExit("short write while isolating legacy environment")
            view = view[written:]
        os.fsync(output)
        os.fchown(output, 0, target_gid)
        os.fchmod(output, 0o640)
        os.fsync(output)
    finally:
        os.close(output)
    os.replace(temp_path, target_path)
    directory = os.open(target_path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)

key_hash = hashlib.sha256(("\n".join(sorted(keys)) + "\n").encode()).hexdigest()
pathlib.Path(metadata_path).write_text(
    "\n".join([
        f"SOURCE_ENV_DEVICE={before.st_dev}",
        f"SOURCE_ENV_INODE={before.st_ino}",
        f"SOURCE_ENV_SIZE={before.st_size}",
        f"SOURCE_ENV_MTIME_NS={before.st_mtime_ns}",
        f"ENV_KEY_SET_SHA256={key_hash}",
    ]) + "\n",
    encoding="ascii",
)
PY
install -o root -g root -m 0600 "$ENV_METADATA" "$EVIDENCE_DIR/legacy-env-metadata.env"
ENV_KEY_SET_SHA256="$(awk -F= '$1 == "ENV_KEY_SET_SHA256" { print $2 }' "$ENV_METADATA")"
[[ "$ENV_KEY_SET_SHA256" =~ ^[a-f0-9]{64}$ ]] || fail "legacy environment key-set hash is malformed"

# The legacy ubuntu account and its running process remain untrusted until the
# final switch.  Freeze one stable no-follow generation before tar or any
# candidate verifier reads it; the helper rejects path swaps, byte changes,
# mounts, escaping links and special files while excluding secrets/caches.
[ ! -e "$LEGACY_SNAPSHOT_ROOT" ] && [ ! -L "$LEGACY_SNAPSHOT_ROOT" ] \
  || fail "legacy source snapshot staging path already exists"
install -d -o root -g root -m 0700 "$LEGACY_SNAPSHOT_ROOT"
"$LEGACY_SNAPSHOT_HELPER" "$LEGACY_SOURCE" "$LEGACY_SNAPSHOT_ROOT" \
  "$LEGACY_SOURCE_DEVICE" "$LEGACY_SOURCE_INODE"
[ -d "$ARCHIVE_SOURCE" ] && [ ! -L "$ARCHIVE_SOURCE" ] \
  && [ "$(stat -c '%U:%G:%a' "$ARCHIVE_SOURCE")" = root:root:500 ] \
  || fail "stable legacy source snapshot was not created safely"
(
  cd "$ARCHIVE_SOURCE"
  find . -type f \
    ! -path './node_modules/*' \
    ! -path './.next*/*' \
    ! -path './artifacts/*' \
    ! -path './.git/*' \
    ! -name '.env*' \
    ! -name '*.pem' \
    ! -name '*.key' \
    ! -name '*secret*' \
    ! -name '*credential*' \
    ! -name '*密钥*' \
    -print0 | sort -z | xargs -0 sha256sum
) > "$SNAPSHOT_SOURCE_SUMS"
cmp -s "$SNAPSHOT_SOURCE_SUMS" "$HOST_BASELINE_DIR/source-SHA256SUMS" \
  || fail "stable legacy snapshot differs from the reviewed host baseline"
"$IMMUTABLE_MANIFEST_TOOL" "$ARCHIVE_SOURCE" > "$TEMP_DIR/legacy-runtime.manifest.jsonl"
cmp -s "$TEMP_DIR/legacy-runtime.manifest.jsonl" \
  "$HOST_BASELINE_DIR/legacy-runtime.manifest.jsonl" \
  || fail "legacy build/runtime bytes differ from the stable pre-change baseline"

# Build a reviewed, NUL-delimited member list instead of recursively copying
# the live tree.  .env*, package-manager credentials and runtime cache/log
# paths never enter the sanitized archive.
python3 -I - "$ARCHIVE_SOURCE" "$SOURCE_FILE_LIST" <<'PY'
from __future__ import annotations

import os
import pathlib
import stat
import sys

root = pathlib.Path(sys.argv[1]).resolve(strict=True)
output = pathlib.Path(sys.argv[2])
excluded_directories = {".git", "artifacts", "coverage", "logs", "playwright-report", "test-results", "tmp"}
secret_names = {".netrc", ".npmrc", ".pypirc", ".yarnrc", "credentials.json", "secrets.env", "api密钥.rtfd"}
secret_suffixes = {".jks", ".key", ".keystore", ".p12", ".pem", ".pfx"}
members: list[str] = []

def excluded(relative: pathlib.PurePosixPath, is_directory: bool) -> bool:
    name = relative.name
    lowered = name.lower()
    if name == ".env" or name.startswith(".env.") or name.startswith(".env.local"):
        return True
    if (name in secret_names or name.startswith("id_ed25519") or name.startswith("id_rsa")
            or "secret" in lowered or "credential" in lowered or "密钥" in name):
        return True
    if pathlib.PurePosixPath(name).suffix.lower() in secret_suffixes:
        return True
    if is_directory and (name in excluded_directories or relative.as_posix() == ".next/cache"):
        return True
    return False

for current, directory_names, file_names in os.walk(root, topdown=True, followlinks=False):
    current_path = pathlib.Path(current)
    kept_directories: list[str] = []
    for name in sorted(directory_names):
        candidate = current_path / name
        relative = pathlib.PurePosixPath(candidate.relative_to(root).as_posix())
        if "\n" in relative.as_posix() or "\r" in relative.as_posix():
            raise SystemExit("newline is forbidden in legacy release member names")
        if excluded(relative, True):
            continue
        metadata = candidate.lstat()
        if stat.S_ISLNK(metadata.st_mode):
            target = candidate.resolve(strict=False)
            if root != target and root not in target.parents:
                raise SystemExit(f"legacy symlink escapes the source tree: {relative}")
            members.append(relative.as_posix())
        elif stat.S_ISDIR(metadata.st_mode):
            members.append(relative.as_posix())
            kept_directories.append(name)
        else:
            raise SystemExit(f"unsupported legacy directory member: {relative}")
    directory_names[:] = kept_directories

    for name in sorted(file_names):
        candidate = current_path / name
        relative = pathlib.PurePosixPath(candidate.relative_to(root).as_posix())
        if "\n" in relative.as_posix() or "\r" in relative.as_posix():
            raise SystemExit("newline is forbidden in legacy release member names")
        if excluded(relative, False):
            continue
        metadata = candidate.lstat()
        if stat.S_ISLNK(metadata.st_mode):
            target = candidate.resolve(strict=False)
            if root != target and root not in target.parents:
                raise SystemExit(f"legacy symlink escapes the source tree: {relative}")
        elif not stat.S_ISREG(metadata.st_mode):
            raise SystemExit(f"special file is forbidden in the legacy release: {relative}")
        members.append(relative.as_posix())

if not members:
    raise SystemExit("legacy release member list is empty")
with output.open("wb") as handle:
    for member in sorted(set(members)):
        handle.write(member.encode("utf-8") + b"\0")
    handle.flush()
    os.fsync(handle.fileno())
PY
chmod 0600 "$SOURCE_FILE_LIST"
(
  cd "$ARCHIVE_SOURCE"
  tar --format=posix --numeric-owner --hard-dereference --no-recursion \
    --verbatim-files-from --null \
    --files-from="$SOURCE_FILE_LIST" -czf "$SOURCE_ARCHIVE"
)
chmod 0600 "$SOURCE_ARCHIVE"

python3 -I - "$SOURCE_ARCHIVE" "$SOURCE_FILE_LIST" <<'PY'
import pathlib
import posixpath
import sys
import tarfile

archive = pathlib.Path(sys.argv[1])
expected = {
    value.decode("utf-8")
    for value in pathlib.Path(sys.argv[2]).read_bytes().split(b"\0")
    if value
}
observed = set()
with tarfile.open(archive, "r:gz") as handle:
    for member in handle.getmembers():
        normalized = member.name.removeprefix("./").rstrip("/")
        path = pathlib.PurePosixPath(normalized)
        if (not normalized or path.is_absolute() or ".." in path.parts
                or normalized in observed or normalized not in expected):
            raise SystemExit(f"unsafe or unexpected legacy archive member: {member.name}")
        if not (member.isfile() or member.isdir() or member.issym()):
            raise SystemExit(f"unsupported legacy archive member type: {member.name}")
        if member.issym():
            target = pathlib.PurePosixPath(member.linkname)
            resolved = pathlib.PurePosixPath(posixpath.normpath(str(path.parent / target)))
            if target.is_absolute() or not resolved.parts or resolved.parts[0] == "..":
                raise SystemExit(f"legacy archive link escapes the tree: {member.name}")
        observed.add(normalized)
if observed != expected:
    raise SystemExit("legacy archive members differ from the reviewed member list")
PY
SOURCE_ARCHIVE_SHA256="$(sha256sum "$SOURCE_ARCHIVE" | awk '{print $1}')"
[[ "$SOURCE_ARCHIVE_SHA256" =~ ^[a-f0-9]{64}$ ]] || fail "legacy source archive hash is malformed"

install -d -o root -g root -m 0700 "$STAGING_RELEASE"
tar --extract --gzip --file="$SOURCE_ARCHIVE" --directory="$STAGING_RELEASE" \
  --no-same-owner --no-same-permissions --delay-directory-restore
[ -d "$STAGING_RELEASE/.next" ] && [ -d "$STAGING_RELEASE/node_modules" ] \
  || fail "sanitized legacy release lacks its built Next.js runtime"
[ -e "$STAGING_RELEASE/node_modules/next/dist/bin/next" ] \
  || fail "sanitized legacy release lacks the Next.js executable"
unsafe_env_member="$(find "$STAGING_RELEASE" -xdev -name '.env*' -print -quit)"
[ -z "$unsafe_env_member" ] || fail "an environment file entered the sanitized release"
python3 -I - "$STAGING_RELEASE" <<'PY'
import os
import pathlib
import stat
import sys

root = pathlib.Path(sys.argv[1]).resolve(strict=True)
for current, directory_names, file_names in os.walk(root, topdown=True, followlinks=False):
    current_path = pathlib.Path(current)
    for name in [*directory_names, *file_names]:
        candidate = current_path / name
        metadata = candidate.lstat()
        relative = candidate.relative_to(root).as_posix()
        if stat.S_ISLNK(metadata.st_mode):
            target = candidate.resolve(strict=False)
            if root != target and root not in target.parents:
                raise SystemExit(f"release symlink escapes the copied tree: {relative}")
        elif stat.S_ISREG(metadata.st_mode):
            if metadata.st_nlink != 1:
                raise SystemExit(f"hard-linked file is forbidden in the copied release: {relative}")
        elif not stat.S_ISDIR(metadata.st_mode):
            raise SystemExit(f"special file is forbidden in the copied release: {relative}")
PY

install -d -o root -g resume-ai -m 0550 \
  "$STAGING_RELEASE/ops" "$STAGING_RELEASE/ops/pm2" "$STAGING_RELEASE/ops/config" \
  "$STAGING_RELEASE/scripts"
install -o root -g resume-ai -m 0440 "$LEGACY_ECOSYSTEM" \
  "$STAGING_RELEASE/ops/pm2/ecosystem.config.cjs"
install -o root -g resume-ai -m 0440 "$LEGACY_POLICY" \
  "$STAGING_RELEASE/ops/config/legacy-env-keys.conf"
install -o root -g resume-ai -m 0550 "$ASSET_VERIFIER" \
  "$STAGING_RELEASE/scripts/verify-next-assets.mjs"

# Search the complete copied tree, including .next and node_modules, for the
# actual non-public values from legacy.env.  Values remain in the verifier's
# memory and are never written to stdout, evidence, or a process argument.
runuser -u root -- env -i PATH=/opt/nodejs/current/bin:/usr/bin:/bin \
  /opt/nodejs/current/bin/node - "$LEGACY_ENV_TARGET" "$STAGING_RELEASE" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const { parseEnv } = require("node:util");
const [environmentPath, releasePath] = process.argv.slice(2);
let parsedEnvironment;
try {
  parsedEnvironment = parseEnv(fs.readFileSync(environmentPath, "utf8"));
} catch {
  throw new Error("legacy environment could not be parsed for value-leak verification");
}
const sensitiveKeys = [
  "AI_API_KEY",
  "AI_CONVERSATION_SIGNING_SECRET",
  "AI_CONSENT_SALT",
  "DATABASE_URL",
  "MODERATION_ADMIN_TOKEN",
  "DISCUSSION_IDENTITY_CODES",
  "DISCUSSION_IP_SALT"
];
const needles = [];
for (const key of sensitiveKeys) {
  const value = parsedEnvironment[key] ?? "";
  if (!value) continue;
  if (Buffer.byteLength(value) < 8) throw new Error(`${key} is too short for safe value-leak verification`);
  needles.push({ key, value: Buffer.from(value) });
  if (key === "DATABASE_URL") {
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error("DATABASE_URL is not a valid URL");
    }
    for (const credential of [parsed.username, parsed.password]) {
      if (!credential) continue;
      let decodedCredential;
      try {
        decodedCredential = decodeURIComponent(credential);
      } catch {
        throw new Error("DATABASE_URL contains invalid credential encoding");
      }
      for (const candidate of new Set([credential, decodedCredential])) {
        if (Buffer.byteLength(candidate) < 8) {
          throw new Error("DATABASE_URL credential is too short for safe value-leak verification");
        }
        needles.push({ key, value: Buffer.from(candidate) });
      }
    }
  }
}

const root = fs.realpathSync(releasePath);
const stack = [root];
let maxNeedle = Math.max(1, ...needles.map(({ value }) => value.length));
while (stack.length > 0) {
  const directory = stack.pop();
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    const stats = fs.lstatSync(candidate);
    if (stats.isSymbolicLink()) {
      const target = fs.realpathSync.native(candidate);
      if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
        throw new Error("copied release contains an escaping symlink");
      }
      continue;
    }
    if (stats.isDirectory()) {
      stack.push(candidate);
      continue;
    }
    if (!stats.isFile() || stats.nlink !== 1) {
      throw new Error("copied release contains a special or hard-linked file");
    }
    const descriptor = fs.openSync(candidate, "r");
    try {
      const buffer = Buffer.allocUnsafe(1024 * 1024 + maxNeedle);
      let carry = 0;
      let offset = 0;
      while (true) {
        const count = fs.readSync(descriptor, buffer, carry, 1024 * 1024, offset);
        if (count === 0) break;
        const searchable = buffer.subarray(0, carry + count);
        for (const needle of needles) {
          if (searchable.indexOf(needle.value) !== -1) {
            throw new Error(`${needle.key} value is present in a copied release file`);
          }
        }
        carry = Math.min(maxNeedle - 1, searchable.length);
        searchable.copy(buffer, 0, searchable.length - carry);
        offset += count;
      }
    } finally {
      fs.closeSync(descriptor);
    }
  }
}
NODE

CONTROL_ECOSYSTEM_SHA256="$(sha256sum "$LEGACY_ECOSYSTEM" | awk '{print $1}')"
CONTROL_POLICY_SHA256="$(sha256sum "$LEGACY_POLICY" | awk '{print $1}')"
CONTROL_ASSET_SHA256="$(sha256sum "$ASSET_VERIFIER" | awk '{print $1}')"
[ "$(stat -c '%d:%i:%s:%Y:%Z' "$SNAPSHOT_EVIDENCE")" = "$SNAPSHOT_EVIDENCE_ID" ] \
  && [ "$(sha256sum "$SNAPSHOT_EVIDENCE" | awk '{print $1}')" = "$SNAPSHOT_EVIDENCE_SHA256" ] \
  || fail "release-bound Lighthouse evidence changed during adoption"
SOURCE_ARCHIVE_SHA256="$SOURCE_ARCHIVE_SHA256" ENV_KEY_SET_SHA256="$ENV_KEY_SET_SHA256" \
CONTROL_ECOSYSTEM_SHA256="$CONTROL_ECOSYSTEM_SHA256" \
CONTROL_POLICY_SHA256="$CONTROL_POLICY_SHA256" CONTROL_ASSET_SHA256="$CONTROL_ASSET_SHA256" \
RELEASE_ID="$RELEASE_ID" CLOUD_SNAPSHOT_ID="$CLOUD_SNAPSHOT_ID" \
CLOUD_SNAPSHOT_EVIDENCE_SHA256="$SNAPSHOT_EVIDENCE_SHA256" \
HOST_BASELINE_ID="$(basename "$HOST_BASELINE_DIR")" \
python3 -I - "$STAGING_RELEASE/ops/legacy-adoption.json" <<'PY'
import json
import os
import pathlib
import sys

value = {
    "schemaVersion": 2,
    "releaseId": os.environ["RELEASE_ID"],
    "sourceArchiveSha256": os.environ["SOURCE_ARCHIVE_SHA256"],
    "legacyEnvironmentKeySetSha256": os.environ["ENV_KEY_SET_SHA256"],
    "controls": {
        "ecosystemSha256": os.environ["CONTROL_ECOSYSTEM_SHA256"],
        "environmentPolicySha256": os.environ["CONTROL_POLICY_SHA256"],
        "assetVerifierSha256": os.environ["CONTROL_ASSET_SHA256"],
    },
    "databaseContract": {
        "kind": "legacy-delete",
        "runtimeRequiresDirectDelete": True,
        "manifestBoundRpcContract": False,
    },
    "snapshotEvidenceId": os.environ["CLOUD_SNAPSHOT_ID"],
    "snapshotEvidenceSha256": os.environ["CLOUD_SNAPSHOT_EVIDENCE_SHA256"],
    "hostBaselineId": os.environ["HOST_BASELINE_ID"],
}
pathlib.Path(sys.argv[1]).write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY
chown root:resume-ai "$STAGING_RELEASE/ops/legacy-adoption.json"
chmod 0440 "$STAGING_RELEASE/ops/legacy-adoption.json"

"$SECRET_SCANNER" --source-tree "$STAGING_RELEASE"
"$SECRET_SCANNER" --full "$STAGING_RELEASE/.next"
"$SOURCE_MANIFEST_TOOL" "$STAGING_RELEASE" > "$EVIDENCE_DIR/adopted-source.manifest"
chmod 0600 "$EVIDENCE_DIR/adopted-source.manifest"
ADOPTED_SOURCE_SHA256="$(sha256sum "$EVIDENCE_DIR/adopted-source.manifest" | awk '{print $1}')"

SOURCE_ROOT_DEVICE=$LEGACY_SOURCE_DEVICE
SOURCE_ROOT_INODE=$LEGACY_SOURCE_INODE
SOURCE_ROOT_UID="$(id -u ubuntu)"
cat > "$EVIDENCE_DIR/metadata.env" <<EOF
SCHEMA_VERSION=1
RELEASE_ID=$RELEASE_ID
LEGACY_PID=$LEGACY_PID
LEGACY_START_TIME_TICKS=$LEGACY_START_TIME_TICKS
LEGACY_CWD=$LEGACY_SOURCE
SOURCE_ROOT_DEVICE=$SOURCE_ROOT_DEVICE
SOURCE_ROOT_INODE=$SOURCE_ROOT_INODE
SOURCE_ROOT_UID=$SOURCE_ROOT_UID
SOURCE_ARCHIVE_SHA256=$SOURCE_ARCHIVE_SHA256
ADOPTED_SOURCE_MANIFEST_SHA256=$ADOPTED_SOURCE_SHA256
ENV_KEY_SET_SHA256=$ENV_KEY_SET_SHA256
CLOUD_SNAPSHOT_ID=$CLOUD_SNAPSHOT_ID
CLOUD_SNAPSHOT_EVIDENCE_SHA256=$SNAPSHOT_EVIDENCE_SHA256
HOST_BASELINE_ID=$(basename "$HOST_BASELINE_DIR")
HOST_BASELINE_MANIFEST_SHA256=$HOST_BASELINE_MANIFEST_SHA256
EOF
chown root:root "$EVIDENCE_DIR/metadata.env"
chmod 0600 "$EVIDENCE_DIR/metadata.env"
(
  cd "$EVIDENCE_DIR"
  find . -maxdepth 1 -type f ! -name SHA256SUMS -print0 \
    | sort -z | xargs -0 sha256sum > SHA256SUMS
  sha256sum -c SHA256SUMS >/dev/null
)
chmod 0600 "$EVIDENCE_DIR/SHA256SUMS"
fsync_tree "$EVIDENCE_DIR"
sync -f "$EVIDENCE_ROOT"

# Freeze every runtime member before the untrusted legacy code is ever started
# by the dedicated account.  Only .next/cache points to a separate writable
# per-release directory.
chown -R root:resume-ai "$STAGING_RELEASE"
find "$STAGING_RELEASE" -xdev -type l -exec chown -h root:resume-ai {} +
find "$STAGING_RELEASE" -xdev -type d -exec chmod 0550 {} +
find "$STAGING_RELEASE" -xdev -type f -perm /111 -exec chmod 0550 {} +
find "$STAGING_RELEASE" -xdev -type f ! -perm /111 -exec chmod 0440 {} +
install -d -o resume-ai -g resume-ai -m 0750 "/var/cache/resume-ai/$RELEASE_ID"
if [ -e "$STAGING_RELEASE/.next/cache" ] || [ -L "$STAGING_RELEASE/.next/cache" ]; then
  fail "legacy source archive unexpectedly retained .next/cache"
fi
ln -s "/var/cache/resume-ai/$RELEASE_ID" "$STAGING_RELEASE/.next/cache"
unsafe_frozen_member="$(find "$STAGING_RELEASE" -xdev ! -type l \
  \( ! -user root -o -perm /022 \) -print -quit)"
[ -z "$unsafe_frozen_member" ] \
  || fail "frozen legacy release contains a non-root or runtime-writable member"

fsync_tree "$STAGING_RELEASE"
sync -f "/var/cache/resume-ai/$RELEASE_ID"
sync -f /var/cache/resume-ai
sync -f "$STAGING_ROOT"

write_journal prepared
mv -- "$STAGING_RELEASE" "$FINAL_RELEASE"
sync -f "$FINAL_RELEASE"
sync -f "$RELEASE_ROOT"

# A pending adoption is an explicit empty-trust boot state.  Start the PM2
# daemon through the reviewed systemd unit before any CLI command can create an
# unsandboxed user daemon; every candidate process must remain in that cgroup.
"$PM2_POLICY_VERIFIER" >/dev/null
systemctl start resume-ai-pm2.service
systemctl is-active --quiet resume-ai-pm2.service \
  || fail "dedicated PM2 systemd service did not become active before candidate start"
pm2_as_app /opt/nodejs/current/bin/pm2 jlist > "$NEW_PM2_JSON"
/opt/nodejs/current/bin/node - "$NEW_PM2_JSON" <<'NODE'
const fs = require("node:fs");
const entries = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (!Array.isArray(entries) || entries.length !== 0) process.exit(2);
NODE
[ -z "$(ss -H -ltn 'sport = :3001')" ] \
  || fail "dedicated candidate port is unexpectedly occupied before adoption"
pm2_as_app env APP_RELEASE_DIR="$FINAL_RELEASE" APP_PORT="$CANDIDATE_PORT" \
  APP_PROCESS_NAME="$CANDIDATE_PROCESS_NAME" /opt/nodejs/current/bin/pm2 start \
  "$FINAL_RELEASE/ops/pm2/ecosystem.config.cjs" --update-env >/dev/null

wait_for_candidate() {
  local deadline=$((SECONDS + 90)) candidate_status
  until candidate_status="$(curl -sS --connect-timeout 2 --max-time 5 -o /dev/null \
    -w '%{http_code}' "http://127.0.0.1:$CANDIDATE_PORT/")" \
    && [ "$candidate_status" = 200 ]; do
    [ "$SECONDS" -lt "$deadline" ] || fail "legacy candidate did not become healthy on port 3001"
    sleep 2
  done
}

verify_api_contract() {
  local base_url=$1 endpoint status
  for endpoint in \
    /api/competitions/recommend/normalize \
    /api/ai/competition-clarify \
    /api/ai/competition-recommend; do
    status="$(curl -sS --request GET --connect-timeout 5 --max-time 10 \
      -o /dev/null -w '%{http_code}' "${base_url%/}$endpoint")"
    [ "$status" = 405 ] \
      || fail "legacy candidate API did not reject GET at $endpoint (HTTP $status)"
  done
}

persist_candidate_pm2() {
  "$PM2_POLICY_VERIFIER" >/dev/null
  systemctl is-active --quiet resume-ai-pm2.service \
    || fail "dedicated PM2 systemd service stopped during adoption"
  pm2_as_app /opt/nodejs/current/bin/pm2 save >/dev/null
  [ -f "$PM2_HOME/dump.pm2" ] && [ ! -L "$PM2_HOME/dump.pm2" ] \
    || fail "candidate PM2 dump is missing or unsafe"
  chown resume-ai:resume-ai "$PM2_HOME/dump.pm2"
  chmod 0600 "$PM2_HOME/dump.pm2"
  sync -f "$PM2_HOME/dump.pm2"
  sync -f "$PM2_HOME"
}

wait_for_candidate
candidate_pid="$(pm2_as_app /opt/nodejs/current/bin/pm2 pid "$CANDIDATE_PROCESS_NAME" | tail -n 1)"
[[ "$candidate_pid" =~ ^[1-9][0-9]*$ ]] && [ -d "/proc/$candidate_pid" ] \
  && [ "$(stat -c '%U' "/proc/$candidate_pid")" = resume-ai ] \
  || fail "candidate PM2 PID is missing or not owned by resume-ai"
grep -Eq '(^|:)/system\.slice/resume-ai-pm2\.service$' "/proc/$candidate_pid/cgroup" \
  && grep -Eq '^NoNewPrivs:[[:space:]]+1$' "/proc/$candidate_pid/status" \
  && grep -Eq '^CapEff:[[:space:]]+0+$' "/proc/$candidate_pid/status" \
  && grep -Eq '^CapAmb:[[:space:]]+0+$' "/proc/$candidate_pid/status" \
  || fail "candidate process is outside the reviewed PM2 systemd sandbox"
candidate_listener="$(ss -H -ltnp 'sport = :3001')"
[ "$(printf '%s\n' "$candidate_listener" | awk 'NF { count += 1 } END { print count + 0 }')" -eq 1 ] \
  && printf '%s\n' "$candidate_listener" | grep -Fq "pid=$candidate_pid," \
  || fail "candidate port 3001 is not owned exclusively by its dedicated PM2 PID"
runuser -u resume-ai -- env -i HOME=/var/lib/resume-ai \
  PATH=/opt/nodejs/current/bin:/usr/bin:/bin \
  /opt/nodejs/current/bin/node "$FINAL_RELEASE/scripts/verify-next-assets.mjs" \
  "http://127.0.0.1:$CANDIDATE_PORT/" >/dev/null
verify_api_contract "http://127.0.0.1:$CANDIDATE_PORT/"
persist_candidate_pm2
write_journal candidate_ready

upstream_temp="$(mktemp /etc/nginx/conf.d/.legacy-adoption-upstream.XXXXXX)"
cat > "$upstream_temp" <<EOF
# Managed atomically by the one-time legacy adoption transaction.
upstream resume_ai_active {
    server 127.0.0.1:$CANDIDATE_PORT max_fails=2 fail_timeout=10s;
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

current_temp="/opt/resume-ai/.current-legacy-adoption-$RELEASE_ID"
[ ! -e "$current_temp" ] && [ ! -L "$current_temp" ] \
  || fail "legacy adoption current-pointer staging path already exists"
ln -s "releases/$RELEASE_ID" "$current_temp"
mv -Tf -- "$current_temp" "$CURRENT_LINK"
sync -f /opt/resume-ai
state_temp="$(mktemp "$STATE_DIR/.active.XXXXXX")"
cat > "$state_temp" <<EOF
ACTIVE_PORT=$CANDIDATE_PORT
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
"$DATABASE_STATE_WRITER" "$RELEASE_ID" legacy-delete >/dev/null
ALLOW_PENDING_LEGACY_ADOPTION=1 "$CONSISTENCY_VERIFIER" "$STATE_FILE" >/dev/null
runuser -u resume-ai -- env -i HOME=/var/lib/resume-ai PATH=/opt/nodejs/current/bin:/usr/bin:/bin \
  /opt/nodejs/current/bin/node "$FINAL_RELEASE/scripts/verify-next-assets.mjs" "$PUBLIC_URL" >/dev/null
verify_api_contract "$PUBLIC_URL"
write_journal state_committed

# The unmanaged process is deliberately stopped only after Nginx, current,
# active.env, database mode and the dedicated PM2 dump agree on the candidate.
assert_legacy_pid_identity
old_pm2_as_ubuntu /usr/bin/pm2 jlist > "$OLD_PM2_JSON"
LEGACY_SOURCE="$LEGACY_SOURCE" LEGACY_PID="$LEGACY_PID" python3 -I - "$OLD_PM2_JSON" <<'PY'
import json
import os
import pathlib
import sys

entries = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
matches = [entry for entry in entries if entry.get("name") == "resume-ai"]
if len(entries) != 1 or len(matches) != 1:
    raise SystemExit("legacy PM2 process disappeared or became ambiguous before final stop")
if matches[0].get("pid") != int(os.environ["LEGACY_PID"]):
    raise SystemExit("legacy PM2 PID changed before its explicitly authorized stop")
environment = matches[0].get("pm2_env") or {}
if pathlib.Path(environment.get("pm_cwd", "")).resolve() != pathlib.Path(os.environ["LEGACY_SOURCE"]):
    raise SystemExit("refusing to stop a legacy PM2 process with a different cwd")
expected_exec = pathlib.Path(os.environ["LEGACY_SOURCE"], "node_modules/next/dist/bin/next")
if pathlib.Path(str(environment.get("pm_exec_path", ""))) != expected_exec:
    raise SystemExit("refusing to stop a legacy PM2 process with a different executable")
PY
old_pm2_as_ubuntu /usr/bin/pm2 delete "$LEGACY_PROCESS_NAME" >/dev/null
old_pm2_as_ubuntu /usr/bin/pm2 save --force >/dev/null
if [ -f "$LEGACY_PM2_HOME/dump.pm2" ] && [ ! -L "$LEGACY_PM2_HOME/dump.pm2" ]; then
  sync -f "$LEGACY_PM2_HOME/dump.pm2"
  sync -f "$LEGACY_PM2_HOME"
fi
for ((_attempt = 0; _attempt < 50; _attempt += 1)); do
  [ ! -d "/proc/$LEGACY_PID" ] && break
  sleep 0.1
done
[ ! -d "/proc/$LEGACY_PID" ] || fail "legacy PID remained alive after its exact PM2 process was removed"
[ -z "$(ss -H -ltn 'sport = :3000')" ] || \
  fail "port 3000 remains occupied after stopping the legacy process"
write_journal old_stopped

cat > "$EVIDENCE_DIR/completion.env" <<EOF
COMPLETED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
ACTIVE_PORT=$CANDIDATE_PORT
ACTIVE_RELEASE=$RELEASE_ID
DATABASE_MODE=legacy-delete
OLD_PROCESS_STOPPED=1
EOF
chown root:root "$EVIDENCE_DIR/completion.env"
chmod 0600 "$EVIDENCE_DIR/completion.env"
sync -f "$EVIDENCE_DIR/completion.env"
sync -f "$EVIDENCE_DIR"
ALLOW_PENDING_LEGACY_ADOPTION=1 "$CONSISTENCY_VERIFIER" "$STATE_FILE" >/dev/null
grep -Fxq "ACTIVE_RELEASE=$RELEASE_ID" "$DATABASE_STATE_FILE" \
  && grep -Fxq 'DELETE_MODE=legacy-delete' "$DATABASE_STATE_FILE" \
  && grep -Fxq 'CONTRACT_STATUS=legacy-unbound' "$DATABASE_STATE_FILE" \
  || fail "legacy database authorization evidence is inconsistent"
rm -f -- "$PENDING_FILE"
sync -f "$STATE_DIR"
ADOPTION_COMMITTED=1
JOURNAL_WRITTEN=0
"$CONSISTENCY_VERIFIER" "$STATE_FILE" >/dev/null

cleanup_temporary_files
trap - ERR EXIT
printf '%s\n' "Adopted legacy release $RELEASE_ID on managed port 3001; evidence: $EVIDENCE_DIR"
