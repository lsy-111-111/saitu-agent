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
PENDING_FILE=/opt/resume-ai/state/legacy-adoption.pending
[ -e "$PENDING_FILE" ] || exit 0
[ -f "$PENDING_FILE" ] && [ ! -L "$PENDING_FILE" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$PENDING_FILE")" = root:resume-ai:640:1 ] \
  || fail "legacy adoption journal is missing or unsafe"

for command_name in curl flock nginx python3 readlink runuser sha256sum ss sync systemctl; do
  command -v "$command_name" >/dev/null 2>&1 || fail "$command_name is unavailable"
done
[ -x /opt/nodejs/current/bin/node ] && [ -x /opt/nodejs/current/bin/pm2 ] \
  || fail "the approved Node/PM2 runtime is missing"
[ "$(/opt/nodejs/current/bin/node --version)" = v24.20.0 ] \
  || fail "legacy adoption recovery requires Node v24.20.0"
resolved_old_pm2="$(readlink -f /usr/bin/pm2 2>/dev/null || true)"
[ "$resolved_old_pm2" = /usr/lib/node_modules/pm2/bin/pm2 ] \
  && [ -f "$resolved_old_pm2" ] && [ ! -L "$resolved_old_pm2" ] \
  && [ "$(stat -c '%U:%G:%h' "$resolved_old_pm2")" = root:root:1 ] \
  && [ ! -w "$resolved_old_pm2" ] \
  || fail "legacy PM2 control path is no longer the protected observed installation"

readarray -t JOURNAL_VALUES < <(python3 -I - "$PENDING_FILE" <<'PY'
import pathlib
import re
import sys

path = pathlib.Path(sys.argv[1])
expected = [
    "KIND", "PHASE", "RELEASE_ID", "OLD_PID", "OLD_START_TIME_TICKS",
    "OLD_SOURCE", "OLD_PROCESS",
    "OLD_PM2_HOME", "OLD_PORT", "NEW_PORT", "EVIDENCE_DIR", "SOURCE_ARCHIVE_SHA256",
]
values = {}
for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
    if "=" not in line:
        raise SystemExit(f"malformed legacy adoption journal line {number}")
    key, value = line.split("=", 1)
    if key not in expected or key in values or not value or "\n" in value or "\r" in value:
        raise SystemExit(f"invalid legacy adoption journal line {number}")
    values[key] = value
if set(values) != set(expected):
    raise SystemExit("legacy adoption journal is incomplete")
if values["KIND"] != "adopt" or values["PHASE"] not in {
    "initializing", "prepared", "candidate_ready", "nginx_switched", "state_committed", "old_stopped"
}:
    raise SystemExit("legacy adoption journal kind or phase is invalid")
if not re.fullmatch(r"20\d{6}T\d{6}Z", values["RELEASE_ID"]):
    raise SystemExit("legacy release id is invalid")
release = values["RELEASE_ID"]
if not re.fullmatch(r"[1-9][0-9]*", values["OLD_PID"]):
    raise SystemExit("legacy PID is invalid")
if not re.fullmatch(r"[1-9][0-9]*", values["OLD_START_TIME_TICKS"]):
    raise SystemExit("legacy PID start-time identity is invalid")
if values["OLD_SOURCE"] != f"/home/ubuntu/resume-ai-web-releases/{release}":
    raise SystemExit("legacy source path is not release-bound")
if values["OLD_PROCESS"] != "resume-ai" or values["OLD_PM2_HOME"] != "/home/ubuntu/.pm2":
    raise SystemExit("legacy PM2 identity is invalid")
if values["OLD_PORT"] != "3000" or values["NEW_PORT"] != "3001":
    raise SystemExit("legacy adoption ports are invalid")
if values["EVIDENCE_DIR"] != f"/var/backups/resume-ai/legacy-adoption/{release}":
    raise SystemExit("legacy evidence path is invalid")
archive_hash = values["SOURCE_ARCHIVE_SHA256"]
if not re.fullmatch(r"[a-f0-9]{64}", archive_hash):
    raise SystemExit("legacy archive checksum is invalid")
if values["PHASE"] == "initializing" and archive_hash != "0" * 64:
    raise SystemExit("initializing journal must use the explicit pending archive hash")
if values["PHASE"] != "initializing" and archive_hash == "0" * 64:
    raise SystemExit("prepared journal has no durable archive hash")
for key in expected:
    print(values[key])
PY
)
[ "${#JOURNAL_VALUES[@]}" -eq 12 ] || fail "legacy adoption journal parser returned incomplete state"
KIND=${JOURNAL_VALUES[0]}
PHASE=${JOURNAL_VALUES[1]}
RELEASE_ID=${JOURNAL_VALUES[2]}
OLD_PID=${JOURNAL_VALUES[3]}
OLD_START_TIME_TICKS=${JOURNAL_VALUES[4]}
OLD_SOURCE=${JOURNAL_VALUES[5]}
OLD_PROCESS=${JOURNAL_VALUES[6]}
OLD_PM2_HOME=${JOURNAL_VALUES[7]}
OLD_PORT=${JOURNAL_VALUES[8]}
NEW_PORT=${JOURNAL_VALUES[9]}
EVIDENCE_DIR=${JOURNAL_VALUES[10]}
SOURCE_ARCHIVE_SHA256=${JOURNAL_VALUES[11]}

RELEASE_ROOT=/opt/resume-ai/releases
FINAL_RELEASE="$RELEASE_ROOT/$RELEASE_ID"
STAGING_RELEASE="/opt/resume-ai/adoption-staging/$RELEASE_ID"
CACHE_DIR="/var/cache/resume-ai/$RELEASE_ID"
STATE_DIR=/opt/resume-ai/state
STATE_FILE="$STATE_DIR/active.env"
DATABASE_STATE_FILE="$STATE_DIR/database-permissions.env"
CURRENT_LINK=/opt/resume-ai/current
NGINX_UPSTREAM=/etc/nginx/conf.d/10-resume-ai-upstream.conf
PM2_HOME=/var/lib/resume-ai/.pm2
CANDIDATE_PROCESS_NAME=resume-ai-3001
LEGACY_ENV=/etc/resume-ai/legacy.env
LEGACY_ENV_TEMP="/etc/resume-ai/.legacy.env-$RELEASE_ID.tmp"
ASSET_VERIFIER=/usr/local/share/resume-ai/legacy-verify-next-assets.mjs
DATABASE_STATE_WRITER=/usr/local/lib/resume-ai/write-database-permission-state.sh
CONSISTENCY_VERIFIER=/usr/local/lib/resume-ai/verify-release-consistency.sh
PM2_POLICY_VERIFIER=/usr/local/lib/resume-ai/assert-pm2-effective-service.sh
START_TICKS_READER=/usr/local/lib/resume-ai/read-proc-start-ticks.py
SNAPSHOT_VERIFIER=/usr/local/lib/resume-ai/record-cloud-snapshot-evidence.py
for trusted_control in \
  "$ASSET_VERIFIER" "$DATABASE_STATE_WRITER" "$CONSISTENCY_VERIFIER" \
  "$PM2_POLICY_VERIFIER" "$START_TICKS_READER" "$SNAPSHOT_VERIFIER"; do
  [ -f "$trusted_control" ] && [ ! -L "$trusted_control" ] \
    && [ "$(stat -c '%U:%G:%h' "$trusted_control")" = root:root:1 ] \
    && [ -z "$(find "$trusted_control" -maxdepth 0 -perm /022 -print)" ] \
    || fail "trusted legacy recovery control is missing or unsafe: $trusted_control"
done
TEMP_DIR="$(mktemp -d /run/resume-ai-legacy-recovery.XXXXXX)"
NEW_PM2_JSON="$TEMP_DIR/new-pm2.json"
OLD_PM2_JSON="$TEMP_DIR/old-pm2.json"
cleanup() { [ ! -e "$TEMP_DIR" ] || find "$TEMP_DIR" -xdev -depth -delete >/dev/null 2>&1 || true; }
trap cleanup EXIT

open_root_lock 9 deploy
"$PM2_POLICY_VERIFIER" >/dev/null
systemctl is-active --quiet resume-ai-pm2.service \
  || fail "managed PM2 service is not active; refusing to create an unsandboxed daemon"

if [ "$PHASE" = initializing ]; then
  if [ -e "$EVIDENCE_DIR" ] || [ -L "$EVIDENCE_DIR" ]; then
    [ -d "$EVIDENCE_DIR" ] && [ ! -L "$EVIDENCE_DIR" ] \
      && [ "$(stat -c '%U:%G:%a' "$EVIDENCE_DIR")" = root:root:700 ] \
      || fail "partial legacy adoption evidence directory is unsafe"
  fi
  if [ -e "$LEGACY_ENV" ] || [ -L "$LEGACY_ENV" ]; then
    [ -f "$LEGACY_ENV" ] && [ ! -L "$LEGACY_ENV" ] \
      && [ "$(stat -c '%U:%G:%a:%h' "$LEGACY_ENV")" = root:resume-ai:640:1 ] \
      || fail "partially isolated legacy environment is unsafe"
  fi
else
  [ -d "$EVIDENCE_DIR" ] && [ ! -L "$EVIDENCE_DIR" ] \
    && [ "$(stat -c '%U:%G:%a' "$EVIDENCE_DIR")" = root:root:700 ] \
    || fail "legacy adoption evidence directory is missing or unsafe"
  for evidence_file in source.sanitized.tar.gz adopted-source.manifest metadata.env SHA256SUMS; do
    path="$EVIDENCE_DIR/$evidence_file"
    [ -f "$path" ] && [ ! -L "$path" ] \
      && [ "$(stat -c '%U:%G:%a:%h' "$path")" = root:root:600:1 ] \
      || fail "legacy adoption evidence is missing or unsafe: $evidence_file"
  done
  (cd "$EVIDENCE_DIR" && sha256sum -c SHA256SUMS >/dev/null) \
    || fail "legacy adoption evidence checksums do not verify"
  [ "$(sha256sum "$EVIDENCE_DIR/source.sanitized.tar.gz" | awk '{print $1}')" = "$SOURCE_ARCHIVE_SHA256" ] \
    || fail "legacy archive differs from the durable journal"
  [ -f "$LEGACY_ENV" ] && [ ! -L "$LEGACY_ENV" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$LEGACY_ENV")" = root:resume-ai:640:1 ] \
    || fail "isolated legacy environment is missing or unsafe"
fi

pm2_as_app() {
  runuser -u resume-ai -- env -i HOME=/var/lib/resume-ai PM2_HOME="$PM2_HOME" \
    PATH=/opt/nodejs/current/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin "$@"
}

old_pm2_as_ubuntu() {
  runuser -u ubuntu -- env -i HOME=/home/ubuntu PM2_HOME="$OLD_PM2_HOME" \
    PATH=/usr/bin:/bin "$@"
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
      || fail "legacy recovery API did not reject GET at $endpoint (HTTP $status)"
  done
}

wait_for_port() {
  local port=$1 label=$2 deadline=$((SECONDS + 90)) status
  until status="$(curl -sS --connect-timeout 2 --max-time 5 --max-redirs 0 \
    -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/")" \
    && [ "$status" = 200 ]; do
    [ "$SECONDS" -lt "$deadline" ] || fail "$label did not become healthy on port $port"
    sleep 2
  done
}

persist_candidate_pm2() {
  "$PM2_POLICY_VERIFIER" >/dev/null
  systemctl is-active --quiet resume-ai-pm2.service \
    || fail "dedicated PM2 service stopped during legacy recovery"
  pm2_as_app /opt/nodejs/current/bin/pm2 save >/dev/null
  [ -f "$PM2_HOME/dump.pm2" ] && [ ! -L "$PM2_HOME/dump.pm2" ] \
    || fail "candidate PM2 dump is missing or unsafe"
  chown resume-ai:resume-ai "$PM2_HOME/dump.pm2"
  chmod 0600 "$PM2_HOME/dump.pm2"
  sync -f "$PM2_HOME/dump.pm2"
  sync -f "$PM2_HOME"
}

upstream_port() {
  awk '
    /server 127\.0\.0\.1:300[01][[:space:]]/ {
      total += 1
      if ($0 ~ /server 127\.0\.0\.1:3000[[:space:]]/) port = 3000
      if ($0 ~ /server 127\.0\.0\.1:3001[[:space:]]/) port = 3001
    }
    END { if (total != 1) exit 2; print port }
  ' "$NGINX_UPSTREAM"
}

verify_old_pm2_json() {
  LEGACY_SOURCE="$OLD_SOURCE" LEGACY_PID="$OLD_PID" python3 -I - "$1" <<'PY'
import json
import os
import pathlib
import sys

entries = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
matches = [entry for entry in entries if entry.get("name") == "resume-ai"]
if len(entries) != 1 or len(matches) != 1:
    raise SystemExit(2)
environment = matches[0].get("pm2_env") or {}
if environment.get("status") != "online":
    raise SystemExit(3)
if pathlib.Path(environment.get("pm_cwd", "")).resolve() != pathlib.Path(os.environ["LEGACY_SOURCE"]):
    raise SystemExit(4)
expected_exec = pathlib.Path(os.environ["LEGACY_SOURCE"], "node_modules/next/dist/bin/next")
if pathlib.Path(str(environment.get("pm_exec_path", ""))) != expected_exec:
    raise SystemExit(5)
pid = matches[0].get("pid")
if not isinstance(pid, int) or pid != int(os.environ["LEGACY_PID"]):
    raise SystemExit(6)
print(pid)
PY
}

ensure_old_service() {
  [ -d "$OLD_SOURCE" ] && [ ! -L "$OLD_SOURCE" ] \
    && [ "$(stat -c '%U' "$OLD_SOURCE")" = ubuntu ] \
    || fail "legacy source needed for pre-switch recovery is missing"
  [ -d "/proc/$OLD_PID" ] \
    && [ "$(stat -c '%U' "/proc/$OLD_PID")" = ubuntu ] \
    && [ "$("$START_TICKS_READER" "$OLD_PID")" = "$OLD_START_TIME_TICKS" ] \
    && [ "$(readlink -e "/proc/$OLD_PID/cwd")" = "$OLD_SOURCE" ] \
    || fail "exact legacy PID is unavailable; refusing to execute its user-writable PM2 dump"
  old_pm2_as_ubuntu /usr/bin/pm2 jlist > "$OLD_PM2_JSON"
  verify_old_pm2_json "$OLD_PM2_JSON" >/dev/null \
    || fail "running legacy PM2 topology changed; untrusted dump resurrection is forbidden"
  wait_for_port "$OLD_PORT" "unmanaged legacy release"
  current_old_pid="$(verify_old_pm2_json "$OLD_PM2_JSON")"
  [ "$(readlink -e "/proc/$current_old_pid/exe")" = /usr/bin/node ] \
    || fail "restored legacy process is not using the retained system Node executable"
  tr '\0' '\n' < "/proc/$current_old_pid/cmdline" | grep -Fq 'node_modules/next/dist/bin/next' \
    || fail "restored legacy process command line is not the expected Next.js server"
  old_listener="$(ss -H -ltnp 'sport = :3000')"
  [ "$(printf '%s\n' "$old_listener" | awk 'NF { count += 1 } END { print count + 0 }')" -eq 1 ] \
    && printf '%s\n' "$old_listener" | grep -Fq "pid=$current_old_pid," \
    || fail "restored port 3000 is not owned exclusively by the exact legacy PM2 application"
  runuser -u root -- env -i PATH=/opt/nodejs/current/bin:/usr/bin:/bin \
    /opt/nodejs/current/bin/node "$ASSET_VERIFIER" "http://127.0.0.1:$OLD_PORT/" >/dev/null
  verify_api_contract "http://127.0.0.1:$OLD_PORT/"
}

verify_candidate_tree() {
  [ -d "$FINAL_RELEASE" ] && [ ! -L "$FINAL_RELEASE" ] \
    && [ "$(stat -c '%U:%G' "$FINAL_RELEASE")" = root:resume-ai ] \
    || fail "candidate legacy release is missing or unsafe"
  unsafe_member="$(find "$FINAL_RELEASE" -xdev ! -type l \( ! -user root -o -perm /022 \) -print -quit)"
  [ -z "$unsafe_member" ] || fail "candidate legacy release is runtime-writable"
  [ -d "$CACHE_DIR" ] && [ ! -L "$CACHE_DIR" ] \
    && [ "$(readlink -e -- "$CACHE_DIR")" = "$CACHE_DIR" ] \
    && [ "$(stat -c '%U:%G:%a' "$CACHE_DIR")" = resume-ai:resume-ai:750 ] \
    || fail "candidate legacy cache is missing or unsafe"
  [ -L "$FINAL_RELEASE/.next/cache" ] \
    && [ "$(readlink -f "$FINAL_RELEASE/.next/cache")" = "$CACHE_DIR" ] \
    || fail "candidate legacy cache link is invalid"
  /usr/local/lib/resume-ai/create-release-source-manifest.sh "$FINAL_RELEASE" \
    > "$TEMP_DIR/current-source.manifest"
  cmp -s "$TEMP_DIR/current-source.manifest" "$EVIDENCE_DIR/adopted-source.manifest" \
    || fail "candidate source differs from its adoption evidence"
  snapshot_evidence="/var/lib/resume-ai/security/cloud-snapshots/$RELEASE_ID.initial-rollback.env"
  [ ! -e "/var/lib/resume-ai/security/cloud-snapshots/$RELEASE_ID.initial-rollback.pending" ] \
    && [ ! -L "/var/lib/resume-ai/security/cloud-snapshots/$RELEASE_ID.initial-rollback.pending" ] \
    || fail "candidate initial Lighthouse rollback snapshot is still pending"
  [ -f "$snapshot_evidence" ] && [ ! -L "$snapshot_evidence" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$snapshot_evidence")" = root:root:400:1 ] \
    || fail "candidate Lighthouse snapshot evidence is missing or unsafe"
  /opt/nodejs/current/bin/node - "$FINAL_RELEASE/ops/legacy-adoption.json" \
    "$SOURCE_ARCHIVE_SHA256" "$RELEASE_ID" "$snapshot_evidence" <<'NODE'
const crypto = require("node:crypto");
const fs = require("node:fs");
const [manifestPath, sourceHash, releaseId, snapshotPath] = process.argv.slice(2);
const value = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const snapshotHash = crypto.createHash("sha256").update(fs.readFileSync(snapshotPath)).digest("hex");
if (value?.schemaVersion !== 2 || value?.releaseId !== releaseId
    || value?.sourceArchiveSha256 !== sourceHash
    || !/^lhsnap-[A-Za-z0-9]{6,80}$/u.test(value?.snapshotEvidenceId ?? "")
    || value?.snapshotEvidenceSha256 !== snapshotHash) process.exit(2);
if (value?.databaseContract?.kind !== "legacy-delete"
    || value?.databaseContract?.runtimeRequiresDirectDelete !== true
    || value?.databaseContract?.manifestBoundRpcContract !== false) process.exit(3);
NODE
  read -r snapshot_id snapshot_sha < <(python3 -I - \
    "$FINAL_RELEASE/ops/legacy-adoption.json" "$RELEASE_ID" <<'PY_SNAPSHOT_BINDING'
import json
import pathlib
import re
import sys

def strict_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result

try:
    value = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"), object_pairs_hook=strict_object)
except (OSError, UnicodeError, json.JSONDecodeError, ValueError):
    raise SystemExit(2)
snapshot_id = value.get("snapshotEvidenceId") if isinstance(value, dict) else None
snapshot_sha = value.get("snapshotEvidenceSha256") if isinstance(value, dict) else None
if (value.get("schemaVersion") != 2 or value.get("releaseId") != sys.argv[2]
        or re.fullmatch(r"lhsnap-[A-Za-z0-9]{6,80}", snapshot_id or "") is None
        or re.fullmatch(r"[a-f0-9]{64}", snapshot_sha or "") is None):
    raise SystemExit(2)
print(snapshot_id, snapshot_sha)
PY_SNAPSHOT_BINDING
  ) || fail "candidate legacy manifest cannot bind its initial snapshot"
  "$SNAPSHOT_VERIFIER" --verify-initial-rollback "$snapshot_evidence" \
    "$RELEASE_ID" "$snapshot_id" "$snapshot_sha" >/dev/null \
    || fail "candidate legacy snapshot claim is missing, reused, or inconsistent"
  unset snapshot_evidence
}

ensure_candidate() {
  verify_candidate_tree
  pm2_as_app /opt/nodejs/current/bin/pm2 jlist > "$NEW_PM2_JSON"
  if ! /opt/nodejs/current/bin/node - "$NEW_PM2_JSON" "$FINAL_RELEASE" <<'NODE'
const fs = require("node:fs");
const [jsonPath, release] = process.argv.slice(2);
const entries = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
const matches = entries.filter((entry) => entry?.name === "resume-ai-3001");
if (matches.length !== 1) process.exit(2);
const environment = matches[0].pm2_env ?? {};
if (environment.status !== "online" || environment.pm_cwd !== release
    || environment.APP_RELEASE_DIR !== release || String(environment.APP_PORT) !== "3001"
    || environment.exec_interpreter !== "/opt/nodejs/current/bin/node") process.exit(3);
NODE
  then
    pm2_as_app /opt/nodejs/current/bin/pm2 delete "$CANDIDATE_PROCESS_NAME" >/dev/null 2>&1 || true
    pm2_as_app env APP_RELEASE_DIR="$FINAL_RELEASE" APP_PORT="$NEW_PORT" \
      APP_PROCESS_NAME="$CANDIDATE_PROCESS_NAME" /opt/nodejs/current/bin/pm2 start \
      "$FINAL_RELEASE/ops/pm2/ecosystem.config.cjs" --update-env >/dev/null
  fi
  wait_for_port "$NEW_PORT" "managed legacy candidate"
  candidate_pid="$(pm2_as_app /opt/nodejs/current/bin/pm2 pid "$CANDIDATE_PROCESS_NAME" | tail -n 1)"
  [[ "$candidate_pid" =~ ^[1-9][0-9]*$ ]] && [ -d "/proc/$candidate_pid" ] \
    && [ "$(stat -c '%U' "/proc/$candidate_pid")" = resume-ai ] \
    || fail "recovered candidate PID is missing or not owned by resume-ai"
  grep -Eq '(^|:)/system\.slice/resume-ai-pm2\.service$' "/proc/$candidate_pid/cgroup" \
    && grep -Eq '^NoNewPrivs:[[:space:]]+1$' "/proc/$candidate_pid/status" \
    && grep -Eq '^CapEff:[[:space:]]+0+$' "/proc/$candidate_pid/status" \
    && grep -Eq '^CapAmb:[[:space:]]+0+$' "/proc/$candidate_pid/status" \
    || fail "recovered candidate is outside the reviewed PM2 systemd sandbox"
  candidate_listener="$(ss -H -ltnp 'sport = :3001')"
  [ "$(printf '%s\n' "$candidate_listener" | awk 'NF { count += 1 } END { print count + 0 }')" -eq 1 ] \
    && printf '%s\n' "$candidate_listener" | grep -Fq "pid=$candidate_pid," \
    || fail "recovered candidate port is not owned exclusively by its dedicated PM2 PID"
  runuser -u resume-ai -- env -i HOME=/var/lib/resume-ai \
    PATH=/opt/nodejs/current/bin:/usr/bin:/bin \
    /opt/nodejs/current/bin/node "$FINAL_RELEASE/scripts/verify-next-assets.mjs" \
    "http://127.0.0.1:$NEW_PORT/" >/dev/null
  verify_api_contract "http://127.0.0.1:$NEW_PORT/"
  persist_candidate_pm2
}

write_journal() {
  local phase=$1 journal_temp
  journal_temp="$(mktemp "$STATE_DIR/.legacy-adoption-recovery.XXXXXX")"
  cat > "$journal_temp" <<EOF
KIND=$KIND
PHASE=$phase
RELEASE_ID=$RELEASE_ID
OLD_PID=$OLD_PID
OLD_START_TIME_TICKS=$OLD_START_TIME_TICKS
OLD_SOURCE=$OLD_SOURCE
OLD_PROCESS=$OLD_PROCESS
OLD_PM2_HOME=$OLD_PM2_HOME
OLD_PORT=$OLD_PORT
NEW_PORT=$NEW_PORT
EVIDENCE_DIR=$EVIDENCE_DIR
SOURCE_ARCHIVE_SHA256=$SOURCE_ARCHIVE_SHA256
EOF
  chown root:resume-ai "$journal_temp"
  chmod 0640 "$journal_temp"
  mv -f -- "$journal_temp" "$PENDING_FILE"
  sync -f "$PENDING_FILE"
  sync -f "$STATE_DIR"
}

write_managed_state() {
  local upstream_temp current_temp state_temp
  upstream_temp="$(mktemp /etc/nginx/conf.d/.legacy-recovery-upstream.XXXXXX)"
  cat > "$upstream_temp" <<EOF
# Completed by the one-time legacy adoption recovery transaction.
upstream resume_ai_active {
    server 127.0.0.1:$NEW_PORT max_fails=2 fail_timeout=10s;
    keepalive 32;
}
EOF
  chown root:root "$upstream_temp"
  chmod 0644 "$upstream_temp"
  mv -f -- "$upstream_temp" "$NGINX_UPSTREAM"
  sync -f "$NGINX_UPSTREAM"
  sync -f /etc/nginx/conf.d
  nginx -t
  if systemctl is-active --quiet nginx; then systemctl reload nginx; fi

  if [ -e "$CURRENT_LINK" ] || [ -L "$CURRENT_LINK" ]; then
    [ -L "$CURRENT_LINK" ] && [ "$(readlink -f "$CURRENT_LINK")" = "$FINAL_RELEASE" ] \
      || fail "current pointer conflicts with the adoption journal"
  else
    current_temp="/opt/resume-ai/.current-legacy-recovery-$RELEASE_ID"
    [ ! -e "$current_temp" ] && [ ! -L "$current_temp" ] || fail "recovery pointer staging path exists"
    ln -s "releases/$RELEASE_ID" "$current_temp"
    mv -Tf -- "$current_temp" "$CURRENT_LINK"
    sync -f /opt/resume-ai
  fi

  if [ -e "$STATE_FILE" ] || [ -L "$STATE_FILE" ]; then
    [ -f "$STATE_FILE" ] && [ ! -L "$STATE_FILE" ] \
      || fail "existing active state is unsafe"
    grep -Fxq "ACTIVE_PORT=$NEW_PORT" "$STATE_FILE" \
      && grep -Fxq "ACTIVE_RELEASE=$RELEASE_ID" "$STATE_FILE" \
      && grep -Fxq 'PREVIOUS_PORT=none' "$STATE_FILE" \
      && grep -Fxq 'PREVIOUS_RELEASE=none' "$STATE_FILE" \
      || fail "existing active state conflicts with the adoption journal"
  else
    state_temp="$(mktemp "$STATE_DIR/.active.XXXXXX")"
    cat > "$state_temp" <<EOF
ACTIVE_PORT=$NEW_PORT
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
  fi
  "$DATABASE_STATE_WRITER" "$RELEASE_ID" legacy-delete >/dev/null
}

stop_old_service() {
  old_pm2_as_ubuntu /usr/bin/pm2 jlist > "$OLD_PM2_JSON"
  if verify_old_pm2_json "$OLD_PM2_JSON" >/dev/null 2>&1; then
    old_pm2_as_ubuntu /usr/bin/pm2 delete "$OLD_PROCESS" >/dev/null
    old_pm2_as_ubuntu /usr/bin/pm2 save --force >/dev/null
    if [ -f "$OLD_PM2_HOME/dump.pm2" ] && [ ! -L "$OLD_PM2_HOME/dump.pm2" ]; then
      sync -f "$OLD_PM2_HOME/dump.pm2"
      sync -f "$OLD_PM2_HOME"
    fi
  else
    # Absence is idempotent; a same-name process with a different cwd is not.
    if /opt/nodejs/current/bin/node - "$OLD_PM2_JSON" <<'NODE'
const fs = require("node:fs");
const entries = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
process.exit(Array.isArray(entries) && entries.length === 0 ? 0 : 2);
NODE
    then :; else fail "refusing to stop an ambiguous legacy PM2 process"; fi
  fi
  [ -z "$(ss -H -ltn 'sport = :3000')" ] \
    || fail "port 3000 remains occupied after legacy PM2 stop"
}

safe_remove_tree() {
  local target=$1 expected=$2
  [ "$target" = "$expected" ] || fail "unsafe recovery cleanup target"
  if [ -e "$target" ] || [ -L "$target" ]; then
    [ -d "$target" ] && [ ! -L "$target" ] || fail "recovery cleanup target is unsafe"
    python3 -I - "$target" <<'PY' || fail "recovery cleanup target contains a mount point"
import pathlib
import sys

root = pathlib.Path(sys.argv[1]).resolve(strict=True)
mountinfo = pathlib.Path("/proc/self/mountinfo")
if not mountinfo.is_file():
    raise SystemExit(2)
for line in mountinfo.read_text(encoding="utf-8").splitlines():
    fields = line.split()
    if len(fields) < 5:
        raise SystemExit(2)
    mount = pathlib.Path(
        fields[4]
        .replace("\\040", " ")
        .replace("\\011", "\t")
        .replace("\\012", "\n")
        .replace("\\134", "\\")
    )
    try:
        mount.relative_to(root)
    except ValueError:
        continue
    raise SystemExit(1)
PY
    find "$target" -xdev -depth -delete
  fi
}

stop_candidate_pre_switch() {
  local candidate_state
  pm2_as_app /opt/nodejs/current/bin/pm2 jlist > "$NEW_PM2_JSON"
  candidate_state="$(/opt/nodejs/current/bin/node - "$NEW_PM2_JSON" "$FINAL_RELEASE" <<'NODE'
const fs = require("node:fs");
const [jsonPath, release] = process.argv.slice(2);
const entries = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
if (!Array.isArray(entries)) process.exit(2);
if (entries.length === 0) {
  process.stdout.write("absent");
  process.exit(0);
}
if (entries.length !== 1 || entries[0]?.name !== "resume-ai-3001") process.exit(3);
const environment = entries[0].pm2_env ?? {};
if (environment.pm_cwd !== release || environment.APP_RELEASE_DIR !== release
    || String(environment.APP_PORT) !== "3001"
    || environment.exec_interpreter !== "/opt/nodejs/current/bin/node") process.exit(4);
process.stdout.write("present");
NODE
)" || fail "dedicated PM2 home contains an unapproved pre-switch process"
  if [ "$candidate_state" = present ]; then
    pm2_as_app /opt/nodejs/current/bin/pm2 delete "$CANDIDATE_PROCESS_NAME" >/dev/null
  else
    [ "$candidate_state" = absent ] || fail "candidate cleanup parser returned invalid state"
  fi
  pm2_as_app /opt/nodejs/current/bin/pm2 save --force >/dev/null
  if [ -f "$PM2_HOME/dump.pm2" ] && [ ! -L "$PM2_HOME/dump.pm2" ]; then
    chown resume-ai:resume-ai "$PM2_HOME/dump.pm2"
    chmod 0600 "$PM2_HOME/dump.pm2"
    sync -f "$PM2_HOME/dump.pm2"
    sync -f "$PM2_HOME"
  fi
  [ -z "$(ss -H -ltn 'sport = :3001')" ] \
    || fail "candidate listener remained after pre-switch recovery"
}

OBSERVED_UPSTREAM="$(upstream_port)" || fail "managed Nginx upstream is malformed"
case "$PHASE:$OBSERVED_UPSTREAM" in
  initializing:3000|prepared:3000|candidate_ready:3000)
    ensure_old_service
    stop_candidate_pre_switch
    [ ! -e "$STATE_FILE" ] && [ ! -L "$STATE_FILE" ] \
      && [ ! -e "$DATABASE_STATE_FILE" ] && [ ! -L "$DATABASE_STATE_FILE" ] \
      && [ ! -e "$CURRENT_LINK" ] && [ ! -L "$CURRENT_LINK" ] \
      || fail "pre-switch recovery found a partially committed managed state"
    safe_remove_tree "$FINAL_RELEASE" "/opt/resume-ai/releases/$RELEASE_ID"
    safe_remove_tree "$STAGING_RELEASE" "/opt/resume-ai/adoption-staging/$RELEASE_ID"
    safe_remove_tree "$CACHE_DIR" "/var/cache/resume-ai/$RELEASE_ID"
    if [ -e "$LEGACY_ENV_TEMP" ] || [ -L "$LEGACY_ENV_TEMP" ]; then
      [ -f "$LEGACY_ENV_TEMP" ] && [ ! -L "$LEGACY_ENV_TEMP" ] \
        || fail "legacy environment staging file is unsafe"
      case "$(stat -c '%U:%G:%a:%h' "$LEGACY_ENV_TEMP")" in
        root:root:600:1|root:resume-ai:640:1) ;;
        *) fail "legacy environment staging file ownership or mode is unsafe" ;;
      esac
      rm -f -- "$LEGACY_ENV_TEMP"
      sync -f /etc/resume-ai
    fi
    if [ -e "$EVIDENCE_DIR" ] || [ -L "$EVIDENCE_DIR" ]; then
      [ -d "$EVIDENCE_DIR" ] && [ ! -L "$EVIDENCE_DIR" ] \
        && [ "$(stat -c '%U:%G:%a' "$EVIDENCE_DIR")" = root:root:700 ] \
        || fail "partial legacy evidence cannot be quarantined safely"
      aborted="$EVIDENCE_DIR.aborted.$(date -u +%Y%m%dT%H%M%SZ).$$"
      [ ! -e "$aborted" ] || fail "aborted evidence destination already exists"
      mv -- "$EVIDENCE_DIR" "$aborted"
      sync -f "$(dirname "$EVIDENCE_DIR")"
    fi
    rm -f -- "$PENDING_FILE"
    sync -f "$STATE_DIR"
    printf '%s\n' "Recovered pre-switch legacy adoption by preserving the exact old service."
    ;;
  prepared:3001|candidate_ready:3001|nginx_switched:3001|state_committed:3001|old_stopped:3001)
    ensure_candidate
    write_managed_state
    ALLOW_PENDING_LEGACY_ADOPTION=1 "$CONSISTENCY_VERIFIER" "$STATE_FILE" >/dev/null
    write_journal state_committed
    stop_old_service
    write_journal old_stopped
    cat > "$EVIDENCE_DIR/completion.env" <<EOF
COMPLETED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
ACTIVE_PORT=$NEW_PORT
ACTIVE_RELEASE=$RELEASE_ID
DATABASE_MODE=legacy-delete
OLD_PROCESS_STOPPED=1
RECOVERED_AFTER_POWER_LOSS=1
EOF
    chown root:root "$EVIDENCE_DIR/completion.env"
    chmod 0600 "$EVIDENCE_DIR/completion.env"
    sync -f "$EVIDENCE_DIR/completion.env"
    sync -f "$EVIDENCE_DIR"
    ALLOW_PENDING_LEGACY_ADOPTION=1 "$CONSISTENCY_VERIFIER" "$STATE_FILE" >/dev/null
    grep -Fxq "ACTIVE_RELEASE=$RELEASE_ID" "$DATABASE_STATE_FILE" \
      && grep -Fxq 'DELETE_MODE=legacy-delete' "$DATABASE_STATE_FILE" \
      && grep -Fxq 'CONTRACT_STATUS=legacy-unbound' "$DATABASE_STATE_FILE" \
      || fail "recovered legacy database authorization evidence is inconsistent"
    rm -f -- "$PENDING_FILE"
    sync -f "$STATE_DIR"
    "$CONSISTENCY_VERIFIER" "$STATE_FILE" >/dev/null
    printf '%s\n' "Completed the already-switched legacy adoption transaction."
    ;;
  *)
    fail "legacy adoption journal phase conflicts with the observed Nginx upstream"
    ;;
esac
