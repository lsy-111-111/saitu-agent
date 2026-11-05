#!/usr/bin/env bash
set -Eeuo pipefail
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

fail() {
  printf '%s\n' "ERROR: $*" >&2
  exit 1
}

root_python() {
  (cd / && /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin \
    /usr/bin/python3 -I "$@")
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
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
. "$SCRIPT_DIR/open-root-lock.sh"

# deploy-release invokes recovery while already holding this exact descriptor;
# boot/manual recovery must acquire it itself.  Retaining the inherited open
# file description avoids a self-deadlock without trusting an environment flag.
deploy_lock_path=/run/resume-ai-locks/deploy.lock
if [ -e "/proc/$$/fd/9" ]; then
  [ "$(readlink "/proc/$$/fd/9")" = "$deploy_lock_path" ] \
    && [ "$(stat -Lc '%d:%i' "/proc/$$/fd/9")" = "$(stat -c '%d:%i' "$deploy_lock_path")" ] \
    && flock -n 9 \
    || fail "inherited descriptor 9 is not the held Resume AI deploy lock"
else
  open_root_lock 9 deploy
fi

PENDING_FILE=/opt/resume-ai/state/deploy.pending
[ -e "$PENDING_FILE" ] || exit 0
[ -f "$PENDING_FILE" ] && [ ! -L "$PENDING_FILE" ] || fail "deployment journal is not an ordinary file"
[ "$(stat -c '%U:%G:%a:%h' "$PENDING_FILE")" = "root:resume-ai:640:1" ] \
  || fail "deployment journal ownership, link count, or mode is invalid"

declare -A journal=()
while IFS='=' read -r key value || [ -n "$key" ]; do
    case "$key" in KIND|PHASE|OLD_ACTIVE_PORT|OLD_ACTIVE_RELEASE|OLD_PREVIOUS_PORT|OLD_PREVIOUS_RELEASE|NEW_PORT|NEW_RELEASE|NEW_PREVIOUS_PORT|NEW_PREVIOUS_RELEASE|APPROVAL_FILE_SHA256) ;; *) fail "invalid deployment journal key: $key" ;; esac
  [ -z "${journal[$key]:-}" ] || fail "duplicate deployment journal key: $key"
  journal[$key]=$value
done < "$PENDING_FILE"

KIND=${journal[KIND]:-}
PHASE=${journal[PHASE]:-}
OLD_ACTIVE_PORT=${journal[OLD_ACTIVE_PORT]:-}
OLD_ACTIVE_RELEASE=${journal[OLD_ACTIVE_RELEASE]:-}
OLD_PREVIOUS_PORT=${journal[OLD_PREVIOUS_PORT]:-}
OLD_PREVIOUS_RELEASE=${journal[OLD_PREVIOUS_RELEASE]:-}
NEW_PORT=${journal[NEW_PORT]:-}
NEW_RELEASE=${journal[NEW_RELEASE]:-}
NEW_PREVIOUS_PORT=${journal[NEW_PREVIOUS_PORT]:-}
NEW_PREVIOUS_RELEASE=${journal[NEW_PREVIOUS_RELEASE]:-}
APPROVAL_FILE_SHA256=${journal[APPROVAL_FILE_SHA256]:-}
case "$KIND" in deploy|rollback|initialize) ;; *) fail "invalid deployment transaction kind" ;; esac
case "$PHASE" in publishing|prepared|nginx_switched|hardening_started|permissions_hardened|state_committed|rollback_decided) ;; *) fail "invalid deployment journal phase" ;; esac
[ "$KIND" = deploy ] || [ "$PHASE" != publishing ] \
  || fail "publishing is valid only for a deploy transaction"
[ "$KIND" = deploy ] || case "$PHASE" in
  hardening_started|permissions_hardened) fail "$PHASE is valid only for a deploy transaction" ;;
esac
case "$NEW_PORT:$NEW_RELEASE" in 3000:20??????T??????Z|3001:20??????T??????Z) ;; *) fail "invalid new active state" ;; esac
case "$NEW_PREVIOUS_PORT:$NEW_PREVIOUS_RELEASE" in none:none|3000:20??????T??????Z|3001:20??????T??????Z) ;; *) fail "invalid new previous state" ;; esac
if [ "$KIND" = initialize ]; then
  [ "$OLD_ACTIVE_PORT:$OLD_ACTIVE_RELEASE:$OLD_PREVIOUS_PORT:$OLD_PREVIOUS_RELEASE" = none:none:none:none ] \
    || fail "initialization journal contains an old managed state"
  [ "$NEW_PREVIOUS_PORT:$NEW_PREVIOUS_RELEASE" = none:none ] || fail "initialization cannot have a previous release"
else
  case "$OLD_ACTIVE_PORT:$OLD_ACTIVE_RELEASE" in 3000:20??????T??????Z|3001:20??????T??????Z) ;; *) fail "invalid old active state" ;; esac
  case "$OLD_PREVIOUS_PORT:$OLD_PREVIOUS_RELEASE" in none:none|3000:20??????T??????Z|3001:20??????T??????Z) ;; *) fail "invalid old previous state" ;; esac
  [ "$NEW_PREVIOUS_PORT:$NEW_PREVIOUS_RELEASE" = "$OLD_ACTIVE_PORT:$OLD_ACTIVE_RELEASE" ] \
    || fail "new previous state must preserve the old active release"
fi
[ "$OLD_ACTIVE_PORT" = none ] || [ "$OLD_ACTIVE_PORT" != "$NEW_PORT" ] || fail "transaction ports overlap"
[[ "$APPROVAL_FILE_SHA256" =~ ^[a-f0-9]{64}$ ]] \
  || fail "deployment journal approval digest is invalid"
APPROVAL_FILE="/etc/resume-ai/approved-releases/$NEW_RELEASE.env"
[ -f "$APPROVAL_FILE" ] && [ ! -L "$APPROVAL_FILE" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$APPROVAL_FILE")" = root:root:400:1 ] \
  && [ "$(sha256sum "$APPROVAL_FILE" | awk '{print $1}')" = "$APPROVAL_FILE_SHA256" ] \
  || fail "deployment journal is not bound to its immutable root approval"

RELEASE_ROOT=/opt/resume-ai/releases
ARTIFACT_ROOT=/opt/resume-ai/release-artifacts
BUILD_ROOT=/opt/resume-ai/build-staging
VERIFY_ROOT=/opt/resume-ai/verify-staging
CACHE_ROOT=/var/cache/resume-ai
STATE_DIR=/opt/resume-ai/state
STATE_FILE="$STATE_DIR/active.env"
CURRENT_LINK=/opt/resume-ai/current
NGINX_UPSTREAM=/etc/nginx/conf.d/10-resume-ai-upstream.conf
PM2_HOME=/var/lib/resume-ai/.pm2
NODE_BIN=/opt/nodejs/current/bin/node
for release in "$NEW_RELEASE" "$OLD_ACTIVE_RELEASE" "$OLD_PREVIOUS_RELEASE"; do
  [ "$release" = none ] && continue
  if [ "$PHASE" = publishing ] && [ "$release" = "$NEW_RELEASE" ]; then continue; fi
  [ -d "$RELEASE_ROOT/$release" ] || fail "journal release is missing: $release"
done
umask 077

safe_remove_uncommitted_tree() {
  local root=$1 release_id=$2 member="$1/$2"
  [ ! -e "$member" ] && [ ! -L "$member" ] && return 0
  case "$member" in "$root"/20??????T??????Z) ;; *) return 1 ;; esac
  [ -d "$member" ] && [ ! -L "$member" ] || return 1
  root_python - "$member" <<'PY' || return 1
import pathlib
import sys

root = pathlib.Path(sys.argv[1]).resolve(strict=True)
mountinfo = pathlib.Path("/proc/self/mountinfo")
if not mountinfo.is_file():
    raise SystemExit(1)
for line in mountinfo.read_text(encoding="utf-8").splitlines():
    fields = line.split()
    if len(fields) < 5:
        raise SystemExit(1)
    mount = pathlib.Path(fields[4].replace("\\040", " ").replace("\\011", "\t").replace("\\012", "\n").replace("\\134", "\\"))
    try:
        mount.relative_to(root)
    except ValueError:
        continue
    raise SystemExit(1)
PY
  find "$member" -xdev -depth -delete || return 1
  [ ! -e "$member" ] && [ ! -L "$member" ]
}

if [ "$PHASE" = publishing ]; then
  [ "$KIND" = deploy ] && [ "$NEW_RELEASE" != "$OLD_ACTIVE_RELEASE" ] \
    && [ "$NEW_RELEASE" != "$OLD_PREVIOUS_RELEASE" ] \
    || fail "publishing journal targets a protected release"
  for managed_root in "$RELEASE_ROOT" "$ARTIFACT_ROOT" "$CACHE_ROOT" "$BUILD_ROOT" "$VERIFY_ROOT"; do
    [ -d "$managed_root" ] && [ ! -L "$managed_root" ] \
      || fail "managed release root is unsafe during publishing recovery"
    safe_remove_uncommitted_tree "$managed_root" "$NEW_RELEASE" \
      || fail "uncommitted release tree could not be removed safely: $managed_root/$NEW_RELEASE"
    sync -f "$managed_root"
  done
  rm -f -- "$PENDING_FILE"
  sync -f "$STATE_DIR"
  printf '%s\n' "Recovered interrupted release publication for $NEW_RELEASE without changing traffic."
  exit 0
fi

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

authorize_database_for_release() {
  local release=$1
  if release_requires_direct_delete "$release"; then
    if ! /usr/local/lib/resume-ai/provision-postgres-runtime-role.sh verify-compat >/dev/null 2>&1; then
      ACK_POSTGRES_LEGACY_DELETE=YES \
        /usr/local/lib/resume-ai/provision-postgres-runtime-role.sh \
          grant-legacy-delete "$release" >/dev/null
    fi
    /usr/local/lib/resume-ai/provision-postgres-runtime-role.sh verify-compat >/dev/null
    RECOVERED_DATABASE_MODE=legacy-delete
  else
    if ! /usr/local/lib/resume-ai/provision-postgres-runtime-role.sh verify >/dev/null 2>&1; then
      ACK_POSTGRES_RUNTIME_HARDENING=YES \
        /usr/local/lib/resume-ai/provision-postgres-runtime-role.sh reconcile >/dev/null
    fi
    /usr/local/lib/resume-ai/provision-postgres-runtime-role.sh verify >/dev/null
    RECOVERED_DATABASE_MODE=rpc-only
  fi
  /usr/local/lib/resume-ai/provision-postgres-maintenance-role.sh verify >/dev/null
  /usr/local/lib/resume-ai/configure-security-state-cleanup.sh >/dev/null
}

record_database_state() {
  local release=$1
  /usr/local/lib/resume-ai/write-database-permission-state.sh \
    "$release" "$RECOVERED_DATABASE_MODE" >/dev/null
}

recover_control_plane_for_final_state() {
  if [ -e "$STATE_DIR/control-plane.pending" ] \
    || [ -L "$STATE_DIR/control-plane.pending" ]; then
    /usr/local/lib/resume-ai/recover-control-plane-generation.sh
  fi
}

finalize_control_plane_for_release() {
  local release=$1
  if [ -e "$STATE_DIR/control-plane.pending" ] \
    || [ -L "$STATE_DIR/control-plane.pending" ]; then
    ACK_CONTROL_PLANE_GENERATION=YES \
      /usr/local/lib/resume-ai/install-control-plane-generation.sh finalize \
      "$RELEASE_ROOT/$release" \
      "$ARTIFACT_ROOT/$release/source-manifest.txt"
  fi
}

verify_committed_deploy_database() {
  /usr/local/lib/resume-ai/backup-postgres.sh daily >/dev/null
  /usr/local/lib/resume-ai/verify-postgres-restore.sh >/dev/null
  /usr/local/lib/resume-ai/verify-production-database-readonly.sh >/dev/null
}

verify_release_evidence_semantics() {
  local release=$1 bundle="$ARTIFACT_ROOT/$1"
  local approval="/etc/resume-ai/approved-releases/$1.env"
  local attestation_pin producer_pin completion_pin linux_validation_pin required_test_policy_pin
  [ -d "$bundle" ] && [ ! -L "$bundle" ] \
    || fail "recovered release evidence directory is missing or unsafe"
  [ -f "$approval" ] && [ ! -L "$approval" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$approval")" = root:root:400:1 ] \
    && [ "$(sha256sum "$approval" | awk '{print $1}')" = "$APPROVAL_FILE_SHA256" ] \
    || fail "recovered release approval differs from its durable journal"
  [ -f /usr/local/lib/resume-ai/release-required-tests.json ] \
    && [ ! -L /usr/local/lib/resume-ai/release-required-tests.json ] \
    && [ "$(stat -c '%U:%G:%a:%h' /usr/local/lib/resume-ai/release-required-tests.json)" = root:root:444:1 ] \
    || fail "recovery required-test policy is missing or unsafe"
  read -r attestation_pin producer_pin completion_pin linux_validation_pin \
    required_test_policy_pin < <(root_python - \
    "$approval" "$release" "$bundle/release-manifest.json" \
    "$bundle/source-manifest.txt" \
    /usr/local/lib/resume-ai/release-required-tests.json <<'PY'
import hashlib
import json
import pathlib
import re
import sys

allowed = {
    "SCHEMA_VERSION", "RELEASE_ID", "RELEASE_MANIFEST_SHA256",
    "SOURCE_MANIFEST_SHA256", "SHA256SUMS_SHA256",
    "CONTROL_PLANE_SPEC_SHA256", "EVIDENCE_HELPER_SHA256",
    "TRUSTED_DEEP_SCAN_ATTESTATION_SHA256", "TRUSTED_DEEP_SCAN_PRODUCER_SHA256",
    "TRUSTED_DEEP_SCAN_COMPLETION_SHA256",
    "LINUX_VALIDATION_ATTESTATION_SHA256",
    "REQUIRED_TEST_POLICY_SHA256",
    "APPROVED_AT",
}

values = {}
for line in pathlib.Path(sys.argv[1]).read_text(encoding="utf-8").splitlines():
    if "=" not in line:
        raise SystemExit("release approval contains a malformed row")
    key, value = line.split("=", 1)
    if key not in allowed or key in values or not value:
        raise SystemExit("release approval contains an unknown, duplicate, or empty value")
    values[key] = value
if (set(values) != allowed or values["SCHEMA_VERSION"] != "6"
        or values["RELEASE_ID"] != sys.argv[2]
        or re.fullmatch(r"[a-f0-9]{64}", values["TRUSTED_DEEP_SCAN_ATTESTATION_SHA256"]) is None
        or re.fullmatch(r"[a-f0-9]{64}", values["TRUSTED_DEEP_SCAN_PRODUCER_SHA256"]) is None
        or re.fullmatch(r"[a-f0-9]{64}", values["TRUSTED_DEEP_SCAN_COMPLETION_SHA256"]) is None
        or re.fullmatch(r"[a-f0-9]{64}", values["LINUX_VALIDATION_ATTESTATION_SHA256"]) is None
        or re.fullmatch(r"[a-f0-9]{64}", values["REQUIRED_TEST_POLICY_SHA256"]) is None):
    raise SystemExit("release approval lacks an independently trusted evidence pin")

def reject_duplicates(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result

try:
    manifest = json.loads(
        pathlib.Path(sys.argv[3]).read_text(encoding="utf-8"),
        object_pairs_hook=reject_duplicates,
    )
except (OSError, UnicodeError, json.JSONDecodeError, ValueError) as error:
    raise SystemExit(f"recovered release manifest is not strict JSON: {error}")
binding = manifest.get("linuxValidationAttestation") if isinstance(manifest, dict) else None
if (
    not isinstance(binding, dict)
    or set(binding) != {"evidenceMember", "artifactManifestMember", "sha256"}
    or binding.get("evidenceMember") != "linux-validation-attestation.json"
    or binding.get("artifactManifestMember") != "linux-validation-artifact-manifest.txt"
    or binding.get("sha256") != values["LINUX_VALIDATION_ATTESTATION_SHA256"]
):
    raise SystemExit("recovered release manifest differs from the approved Linux validation generation")
source_policy = None
for line in pathlib.Path(sys.argv[4]).read_text(encoding="utf-8").splitlines():
    match = re.fullmatch(r"([a-f0-9]{64})\t([FL])\t([^\t\r\n]+)", line)
    if match is None:
        raise SystemExit("recovered source manifest is malformed")
    digest, kind, relative = match.groups()
    if relative == "ops/config/release-required-tests.json":
        if kind != "F" or source_policy is not None:
            raise SystemExit("recovered source manifest duplicates the required-test policy")
        source_policy = digest
installed_policy = hashlib.sha256(pathlib.Path(sys.argv[5]).read_bytes()).hexdigest()
if source_policy != values["REQUIRED_TEST_POLICY_SHA256"] or installed_policy != source_policy:
    raise SystemExit("recovered required-test policy differs from source, approval, or installed control")
print(values["TRUSTED_DEEP_SCAN_ATTESTATION_SHA256"],
      values["TRUSTED_DEEP_SCAN_PRODUCER_SHA256"],
      values["TRUSTED_DEEP_SCAN_COMPLETION_SHA256"],
      values["LINUX_VALIDATION_ATTESTATION_SHA256"],
      values["REQUIRED_TEST_POLICY_SHA256"])
PY
  ) || fail "recovered release approval cannot authorize evidence verification"
  [ -f /etc/resume-ai/release-evidence-signing.pub ] \
    && [ ! -L /etc/resume-ai/release-evidence-signing.pub ] \
    && [ "$(stat -c '%U:%G:%a:%h' /etc/resume-ai/release-evidence-signing.pub)" = root:root:644:1 ] \
    || fail "recovery Linux validation public trust anchor is missing or unsafe"
  root_node /usr/local/lib/resume-ai/verify-release-evidence.mjs \
    --bundle "$bundle" \
    --trusted-generation-attestation-sha256 "$attestation_pin" \
    --trusted-generation-producer-sha256 "$producer_pin" \
    --trusted-deep-scan-completion-sha256 "$completion_pin" \
    || fail "recovered release evidence failed the installed semantic verifier"
}

verify_release_snapshot_continuity() {
  local release=$1 evidence switched_at
  evidence="/var/lib/resume-ai/security/cloud-snapshots/$release.env"
  [ -f "$evidence" ] && [ ! -L "$evidence" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$evidence")" = root:root:400:1 ] \
    || fail "recovery post-provision snapshot evidence is missing or unsafe"
  [ ! -e "/var/lib/resume-ai/security/cloud-snapshots/$release.pending" ] \
    && [ ! -L "/var/lib/resume-ai/security/cloud-snapshots/$release.pending" ] \
    || fail "recovery cannot finalize while the cloud snapshot is pending"
  [ -f /usr/local/lib/resume-ai/record-cloud-snapshot-evidence.py ] \
    && [ ! -L /usr/local/lib/resume-ai/record-cloud-snapshot-evidence.py ] \
    && [ "$(stat -c '%U:%G:%a:%h' /usr/local/lib/resume-ai/record-cloud-snapshot-evidence.py)" = root:root:755:1 ] \
    || fail "recovery fixed cloud snapshot verifier is missing or unsafe"
  switched_at="$(root_python - "$STATE_FILE" "$release" <<'PY_SNAPSHOT_STATE'
import datetime
import pathlib
import re
import sys

allowed = {"ACTIVE_PORT", "ACTIVE_RELEASE", "PREVIOUS_PORT", "PREVIOUS_RELEASE", "SWITCHED_AT"}
values = {}
for line in pathlib.Path(sys.argv[1]).read_text(encoding="utf-8").splitlines():
    if "=" not in line:
        raise SystemExit(2)
    key, value = line.split("=", 1)
    if key not in allowed or key in values or not value:
        raise SystemExit(2)
    values[key] = value
if (set(values) != allowed or values["ACTIVE_RELEASE"] != sys.argv[2]
        or re.fullmatch(r"20\d{6}T\d{6}Z", values["ACTIVE_RELEASE"]) is None):
    raise SystemExit(2)
try:
    datetime.datetime.strptime(values["SWITCHED_AT"], "%Y-%m-%dT%H:%M:%SZ")
except ValueError:
    raise SystemExit(2)
print(values["SWITCHED_AT"])
PY_SNAPSHOT_STATE
  )" || fail "recovery active state cannot bind snapshot continuity"
  root_python /usr/local/lib/resume-ai/record-cloud-snapshot-evidence.py \
    --verify-continuity "$evidence" "$release" "$switched_at" >/dev/null \
    || fail "recovery active release lacks post-provision snapshot continuity"
}

verify_release_snapshot_pre_switch() {
  local release=$1 managed_mode=${2:-fresh}
  local approval legacy_manifest evidence snapshot_id snapshot_sha verifier_mode
  approval="/etc/resume-ai/approved-releases/$release.env"
  legacy_manifest="$RELEASE_ROOT/$release/ops/legacy-adoption.json"
  [ -f /usr/local/lib/resume-ai/record-cloud-snapshot-evidence.py ] \
    && [ ! -L /usr/local/lib/resume-ai/record-cloud-snapshot-evidence.py ] \
    && [ "$(stat -c '%U:%G:%a:%h' /usr/local/lib/resume-ai/record-cloud-snapshot-evidence.py)" = root:root:755:1 ] \
    || fail "recovery fixed cloud snapshot verifier is missing or unsafe"
  if [ -e "$approval" ] || [ -L "$approval" ]; then
    [ -f "$approval" ] && [ ! -L "$approval" ] \
      && [ "$(stat -c '%U:%G:%a:%h' "$approval")" = root:root:400:1 ] \
      && [ ! -e "$legacy_manifest" ] && [ ! -L "$legacy_manifest" ] \
      || fail "recovery release snapshot class is ambiguous or unsafe"
    evidence="/var/lib/resume-ai/security/cloud-snapshots/$release.env"
    [ ! -e "/var/lib/resume-ai/security/cloud-snapshots/$release.pending" ] \
      && [ ! -L "/var/lib/resume-ai/security/cloud-snapshots/$release.pending" ] \
      && [ -f "$evidence" ] && [ ! -L "$evidence" ] \
      && [ "$(stat -c '%U:%G:%a:%h' "$evidence")" = root:root:400:1 ] \
      || fail "managed recovery target lacks safe final snapshot evidence"
    case "$managed_mode" in
      fresh) verifier_mode=--verify-pre-switch ;;
      rollback) verifier_mode=--verify-rollback-target ;;
      *) fail "unknown managed recovery snapshot mode" ;;
    esac
    root_python /usr/local/lib/resume-ai/record-cloud-snapshot-evidence.py \
      "$verifier_mode" "$evidence" "$release" >/dev/null \
      || fail "managed recovery target failed its purpose-specific snapshot gate"
    return 0
  fi
  [ -f "$legacy_manifest" ] && [ ! -L "$legacy_manifest" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$legacy_manifest")" = root:resume-ai:440:1 ] \
    || fail "recovery target has neither managed approval nor exact legacy contract"
  read -r snapshot_id snapshot_sha < <(root_python - "$legacy_manifest" "$release" <<'PY_LEGACY_SNAPSHOT'
import json
import pathlib
import re
import sys

def strict_object(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError("duplicate JSON key")
        value[key] = item
    return value

try:
    value = json.loads(
        pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"),
        object_pairs_hook=strict_object,
    )
except (OSError, UnicodeError, json.JSONDecodeError, ValueError):
    raise SystemExit(2)
snapshot_id = value.get("snapshotEvidenceId") if isinstance(value, dict) else None
snapshot_sha = value.get("snapshotEvidenceSha256") if isinstance(value, dict) else None
if (value.get("schemaVersion") != 2 or value.get("releaseId") != sys.argv[2]
        or re.fullmatch(r"lhsnap-[A-Za-z0-9]{6,80}", snapshot_id or "") is None
        or re.fullmatch(r"[a-f0-9]{64}", snapshot_sha or "") is None):
    raise SystemExit(2)
print(snapshot_id, snapshot_sha)
PY_LEGACY_SNAPSHOT
  ) || fail "legacy recovery contract cannot bind initial rollback evidence"
  evidence="/var/lib/resume-ai/security/cloud-snapshots/$release.initial-rollback.env"
  [ ! -e "/var/lib/resume-ai/security/cloud-snapshots/$release.initial-rollback.pending" ] \
    && [ ! -L "/var/lib/resume-ai/security/cloud-snapshots/$release.initial-rollback.pending" ] \
    && [ -f "$evidence" ] && [ ! -L "$evidence" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$evidence")" = root:root:400:1 ] \
    || fail "legacy recovery target lacks safe initial rollback evidence"
  root_python /usr/local/lib/resume-ai/record-cloud-snapshot-evidence.py \
    --verify-initial-rollback "$evidence" "$release" "$snapshot_id" "$snapshot_sha" >/dev/null \
    || fail "legacy recovery target failed its initial rollback snapshot gate"
}

pm2_as_app() {
  runuser -u resume-ai -- env -i HOME=/var/lib/resume-ai PM2_HOME="$PM2_HOME" \
    PATH=/opt/nodejs/current/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin "$@"
}

start_release_process() {
  local release=$1
  local port=$2
  local process_name="resume-ai-$port"
  pm2_as_app pm2 delete "$process_name" >/dev/null 2>&1 || true
  pm2_as_app env APP_RELEASE_DIR="$RELEASE_ROOT/$release" APP_PORT="$port" \
    APP_PROCESS_NAME="$process_name" pm2 start \
    "$RELEASE_ROOT/$release/ops/pm2/ecosystem.config.cjs" --update-env >/dev/null
}

wait_for_release() {
  local port=$1 release=$2 status
  local deadline=$((SECONDS + 90))
  until status="$(root_curl -sS --connect-timeout 2 --max-time 5 --max-redirs 0 \
    -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/")" && [ "$status" = 200 ]; do
    [ "$SECONDS" -lt "$deadline" ] || fail "recovered release did not become healthy on port $port"
    sleep 2
  done
  [ -f "$RELEASE_ROOT/$release/scripts/verify-next-assets.mjs" ] \
    && [ ! -L "$RELEASE_ROOT/$release/scripts/verify-next-assets.mjs" ] \
    || fail "recovered release asset verifier is missing or unsafe"
  runuser -u resume-ai -- env -i HOME=/var/lib/resume-ai \
    PATH=/opt/nodejs/current/bin:/usr/bin:/bin \
    "$NODE_BIN" "$RELEASE_ROOT/$release/scripts/verify-next-assets.mjs" \
      "http://127.0.0.1:$port/"
}

persist_pm2() {
  pm2_as_app pm2 save >/dev/null
  [ -f "$PM2_HOME/dump.pm2" ] || fail "PM2 did not write its recovery dump"
  chmod 0600 "$PM2_HOME/dump.pm2"
  sync -f "$PM2_HOME/dump.pm2"
  sync -f "$PM2_HOME"
}

write_deployment_complete_marker() {
  local release=$1 rollback_release=$2 artifact_dir="$ARTIFACT_ROOT/$1"
  local manifest="$ARTIFACT_ROOT/$1/release-manifest.json" marker marker_temp manifest_hash
  [ -d "$artifact_dir" ] && [ ! -L "$artifact_dir" ] \
    && [ -f "$manifest" ] && [ ! -L "$manifest" ] \
    || fail "recovered deployment artifacts are missing or unsafe"
  root_node -e '
    const fs = require("node:fs");
    const [path, release, rollback] = process.argv.slice(1);
    const value = JSON.parse(fs.readFileSync(path, "utf8"));
    if (value?.releaseId !== release || value?.rollbackRelease !== rollback) process.exit(2);
  ' "$manifest" "$release" "$rollback_release" \
    || fail "recovered release manifest has the wrong rollback target"
  manifest_hash="$(sha256sum "$manifest" | awk '{print $1}')"
  marker="$artifact_dir/deployment-complete.env"
  if [ -e "$marker" ] || [ -L "$marker" ]; then
    [ -f "$marker" ] && [ ! -L "$marker" ] \
      && [ "$(stat -c '%U:%G:%a:%h' "$marker")" = root:root:400:1 ] \
      || fail "existing deployment completion marker is inconsistent"
    root_python - "$marker" "$release" "$rollback_release" "$manifest_hash" \
      "$APPROVAL_FILE_SHA256" <<'PY' \
      || fail "existing deployment completion marker is inconsistent"
import datetime
import pathlib
import re
import sys

path = pathlib.Path(sys.argv[1])
allowed = {"SCHEMA_VERSION", "RELEASE_ID", "COMPLETED_AT", "RELEASE_MANIFEST_SHA256", "ROLLBACK_RELEASE", "APPROVAL_FILE_SHA256"}
values = {}
for line in path.read_text(encoding="utf-8").splitlines():
    if "=" not in line:
        raise SystemExit(2)
    key, value = line.split("=", 1)
    if key not in allowed or key in values or not value:
        raise SystemExit(2)
    values[key] = value
if (set(values) != allowed or values["SCHEMA_VERSION"] != "2"
        or values["RELEASE_ID"] != sys.argv[2]
        or values["ROLLBACK_RELEASE"] != sys.argv[3]
        or values["RELEASE_MANIFEST_SHA256"] != sys.argv[4]
        or values["APPROVAL_FILE_SHA256"] != sys.argv[5]
        or re.fullmatch(r"[a-f0-9]{64}", values["RELEASE_MANIFEST_SHA256"]) is None):
    raise SystemExit(2)
try:
    completed = datetime.datetime.strptime(values["COMPLETED_AT"], "%Y-%m-%dT%H:%M:%SZ").replace(
        tzinfo=datetime.timezone.utc
    )
except ValueError:
    raise SystemExit(2)
if completed > datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=5):
    raise SystemExit(2)
PY
    return 0
  fi
  marker_temp="$(mktemp "$artifact_dir/.deployment-complete.XXXXXX")"
  cat > "$marker_temp" <<EOF
SCHEMA_VERSION=2
RELEASE_ID=$release
COMPLETED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
RELEASE_MANIFEST_SHA256=$manifest_hash
ROLLBACK_RELEASE=$rollback_release
APPROVAL_FILE_SHA256=$APPROVAL_FILE_SHA256
EOF
  chown root:root "$marker_temp"
  chmod 0400 "$marker_temp"
  sync -f "$marker_temp"
  mv -- "$marker_temp" "$marker"
  sync -f "$artifact_dir"
  sync -f "$ARTIFACT_ROOT"
}

seal_deployment_artifact() {
  local release=$1 artifact_dir="$ARTIFACT_ROOT/$1" member
  case "$artifact_dir" in /opt/resume-ai/release-artifacts/20??????T??????Z) ;; *) fail "unsafe artifact sealing target" ;; esac
  [ -d "$artifact_dir" ] && [ ! -L "$artifact_dir" ] \
    && [ "$(readlink -e -- "$artifact_dir")" = "$artifact_dir" ] \
    && [[ "$(stat -c '%U:%G:%a' "$artifact_dir")" =~ ^root:root:(700|550)$ ]] \
    || fail "deployment artifact cannot be sealed safely"
  chmod -R a-w "$artifact_dir"
  chmod 0550 "$artifact_dir"
  while IFS= read -r -d '' member; do sync -f "$member"; done \
    < <(find "$artifact_dir" -xdev -type f -print0)
  while IFS= read -r -d '' member; do sync -f "$member"; done \
    < <(find "$artifact_dir" -xdev -depth -type d -print0)
  sync -f "$ARTIFACT_ROOT"
}

write_recovery_journal_phase() {
  local phase=$1 journal_temp
  journal_temp="$(mktemp "$STATE_DIR/.deploy-recovery.XXXXXX")"
  cat > "$journal_temp" <<EOF
KIND=$KIND
PHASE=$phase
OLD_ACTIVE_PORT=$OLD_ACTIVE_PORT
OLD_ACTIVE_RELEASE=$OLD_ACTIVE_RELEASE
OLD_PREVIOUS_PORT=$OLD_PREVIOUS_PORT
OLD_PREVIOUS_RELEASE=$OLD_PREVIOUS_RELEASE
NEW_PORT=$NEW_PORT
NEW_RELEASE=$NEW_RELEASE
NEW_PREVIOUS_PORT=$NEW_PREVIOUS_PORT
NEW_PREVIOUS_RELEASE=$NEW_PREVIOUS_RELEASE
APPROVAL_FILE_SHA256=$APPROVAL_FILE_SHA256
EOF
  chown root:resume-ai "$journal_temp"
  chmod 0640 "$journal_temp"
  sync -f "$journal_temp"
  mv -f -- "$journal_temp" "$PENDING_FILE"
  sync -f "$STATE_DIR"
  PHASE=$phase
}

write_managed_state() {
  local active_port=$1 active_release=$2 previous_port=$3 previous_release=$4 comment=$5
  local upstream_temp current_temp state_temp
  upstream_temp="$(mktemp /etc/nginx/conf.d/.resume-ai-upstream.XXXXXX)"
  cat > "$upstream_temp" <<EOF
# $comment
upstream resume_ai_active {
    server 127.0.0.1:$active_port max_fails=2 fail_timeout=10s;
    keepalive 32;
}
EOF
  chown root:root "$upstream_temp"
  chmod 0644 "$upstream_temp"
  mv -f -- "$upstream_temp" "$NGINX_UPSTREAM"
  sync -f "$NGINX_UPSTREAM"
  sync -f /etc/nginx/conf.d

  current_temp="/opt/resume-ai/.current-recovery-$$"
  rm -f -- "$current_temp"
  ln -s "releases/$active_release" "$current_temp"
  mv -Tf -- "$current_temp" "$CURRENT_LINK"
  sync -f /opt/resume-ai

  state_temp="$(mktemp "$STATE_DIR/.active.XXXXXX")"
  cat > "$state_temp" <<EOF
ACTIVE_PORT=$active_port
ACTIVE_RELEASE=$active_release
PREVIOUS_PORT=$previous_port
PREVIOUS_RELEASE=$previous_release
SWITCHED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF
  chown root:resume-ai "$state_temp"
  chmod 0640 "$state_temp"
  mv -f -- "$state_temp" "$STATE_FILE"
  sync -f "$STATE_FILE"
  sync -f "$STATE_DIR"
  nginx -t
  if systemctl is-active --quiet nginx; then systemctl reload nginx; fi
}

if [ "$PHASE" = state_committed ] && [ -f "$STATE_FILE" ]; then
  if grep -Fxq "ACTIVE_PORT=$NEW_PORT" "$STATE_FILE" \
    && grep -Fxq "ACTIVE_RELEASE=$NEW_RELEASE" "$STATE_FILE" \
    && grep -Fxq "PREVIOUS_PORT=$NEW_PREVIOUS_PORT" "$STATE_FILE" \
    && grep -Fxq "PREVIOUS_RELEASE=$NEW_PREVIOUS_RELEASE" "$STATE_FILE"; then
    verify_release_snapshot_continuity "$NEW_RELEASE"
    recover_control_plane_for_final_state
    if [ "$KIND" = initialize ] \
      && [ ! -e /etc/resume-ai/control-plane-generation.env ] \
      && [ ! -L /etc/resume-ai/control-plane-generation.env ]; then
      ACK_CONTROL_PLANE_GENERATION=YES \
        /usr/local/lib/resume-ai/install-control-plane-generation.sh bootstrap \
        "$RELEASE_ROOT/$NEW_RELEASE" \
        "$ARTIFACT_ROOT/$NEW_RELEASE/source-manifest.txt"
    fi
    authorize_database_for_release "$NEW_RELEASE"
    start_release_process "$NEW_RELEASE" "$NEW_PORT"
    wait_for_release "$NEW_PORT" "$NEW_RELEASE"
    persist_pm2
    ALLOW_PENDING_TRANSACTION=1 "$SCRIPT_DIR/verify-release-consistency.sh" \
      "$STATE_FILE" >/dev/null
    record_database_state "$NEW_RELEASE"
    [ "$KIND" != deploy ] || verify_committed_deploy_database
    [ "$KIND" != deploy ] \
      || write_deployment_complete_marker "$NEW_RELEASE" "$NEW_PREVIOUS_RELEASE"
    if [ "$KIND" = deploy ]; then
      verify_release_evidence_semantics "$NEW_RELEASE"
      seal_deployment_artifact "$NEW_RELEASE"
      ALLOW_PENDING_TRANSACTION=1 RUN_CERTBOT_DRY_RUN=0 \
        "$SCRIPT_DIR/verify-production-host.sh" >/dev/null
    elif [ "$KIND" = rollback ] || [ "$KIND" = initialize ]; then
      ALLOW_PENDING_TRANSACTION=1 RUN_CERTBOT_DRY_RUN=0 \
        "$SCRIPT_DIR/verify-production-host.sh" >/dev/null
    fi
    finalize_control_plane_for_release "$NEW_RELEASE"
    systemctl start resume-ai-security-state-cleanup.service
    rm -f -- "$PENDING_FILE"
    sync -f "$STATE_DIR"
    "$SCRIPT_DIR/verify-release-consistency.sh" "$STATE_FILE" >/dev/null
    if [ "$KIND" = deploy ] || [ "$KIND" = rollback ] || [ "$KIND" = initialize ]; then
      RUN_CERTBOT_DRY_RUN=0 "$SCRIPT_DIR/verify-production-host.sh" >/dev/null
    fi
    printf '%s\n' "Recovered committed $KIND transaction for $NEW_RELEASE."
    exit 0
  fi
fi

if [ "$KIND" = deploy ] \
  && { [ "$PHASE" = hardening_started ] || [ "$PHASE" = permissions_hardened ]; }; then
  # Both phases are written only after the new release completed its full soak.
  # Finish the atomic DELETE revocation and commit the new topology; returning
  # to a legacy release after this point could make its direct DELETE calls fail.
  verify_release_snapshot_continuity "$NEW_RELEASE"
  authorize_database_for_release "$NEW_RELEASE"
  [ "$RECOVERED_DATABASE_MODE" = rpc-only ] \
    || fail "post-soak deploy recovery did not reach the rpc-only contract"
  start_release_process "$NEW_RELEASE" "$NEW_PORT"
  wait_for_release "$NEW_PORT" "$NEW_RELEASE"
  persist_pm2
  write_managed_state "$NEW_PORT" "$NEW_RELEASE" \
    "$NEW_PREVIOUS_PORT" "$NEW_PREVIOUS_RELEASE" \
    "Completed post-soak database hardening from /opt/resume-ai/state/deploy.pending."
  record_database_state "$NEW_RELEASE"
  write_recovery_journal_phase state_committed
  recovered_release=$NEW_RELEASE
elif [ "$KIND" = initialize ]; then
  # There is no managed prior state to restore. The adopted release was health
  # checked and persisted before this journal was written, so recovery safely
  # completes the initialization transaction.
  verify_release_snapshot_pre_switch "$NEW_RELEASE" fresh
  authorize_database_for_release "$NEW_RELEASE"
  [ "$RECOVERED_DATABASE_MODE" = rpc-only ] \
    || fail "initialization recovery requires a manifest-bound rpc-only release"
  start_release_process "$NEW_RELEASE" "$NEW_PORT"
  wait_for_release "$NEW_PORT" "$NEW_RELEASE"
  persist_pm2
  write_managed_state "$NEW_PORT" "$NEW_RELEASE" none none \
    "Recovered initialization from /opt/resume-ai/state/deploy.pending."
  record_database_state "$NEW_RELEASE"
  recovered_release=$NEW_RELEASE
else
  # Any non-committed deploy/rollback transaction returns to its exact old
  # active/previous topology before Nginx may start. Database compatibility is
  # restored first; a failed ACL transaction therefore cannot expose traffic
  # to a release whose required DELETE contract is absent.
  verify_release_snapshot_pre_switch "$OLD_ACTIVE_RELEASE" rollback
  if [ "$OLD_PREVIOUS_RELEASE" != none ]; then
    verify_release_snapshot_pre_switch "$OLD_PREVIOUS_RELEASE" rollback
  fi
  authorize_database_for_release "$OLD_ACTIVE_RELEASE"
  start_release_process "$OLD_ACTIVE_RELEASE" "$OLD_ACTIVE_PORT"
  pm2_as_app pm2 delete "resume-ai-$NEW_PORT" >/dev/null 2>&1 || true
  if [ "$OLD_PREVIOUS_RELEASE" != none ]; then
    start_release_process "$OLD_PREVIOUS_RELEASE" "$OLD_PREVIOUS_PORT"
  fi
  wait_for_release "$OLD_ACTIVE_PORT" "$OLD_ACTIVE_RELEASE"
  persist_pm2
  write_managed_state "$OLD_ACTIVE_PORT" "$OLD_ACTIVE_RELEASE" \
    "$OLD_PREVIOUS_PORT" "$OLD_PREVIOUS_RELEASE" \
    "Recovered incomplete $KIND transaction from /opt/resume-ai/state/deploy.pending."
  record_database_state "$OLD_ACTIVE_RELEASE"
  recovered_release=$OLD_ACTIVE_RELEASE
fi

recover_control_plane_for_final_state
if [ -f "/etc/resume-ai/approved-releases/$recovered_release.env" ] \
  && [ ! -L "/etc/resume-ai/approved-releases/$recovered_release.env" ]; then
  verify_release_snapshot_continuity "$recovered_release"
else
  # This is the deliberate emergency legacy rollback exception. It never
  # falls back from a managed approval: the pre-switch helper requires the
  # exact root-owned legacy manifest and its hash-bound initial snapshot.
  verify_release_snapshot_pre_switch "$recovered_release"
fi
if [ "$KIND" = initialize ] \
  && { [ ! -e /etc/resume-ai/control-plane-generation.env ] \
    && [ ! -L /etc/resume-ai/control-plane-generation.env ]; }; then
  ACK_CONTROL_PLANE_GENERATION=YES \
    /usr/local/lib/resume-ai/install-control-plane-generation.sh bootstrap \
    "$RELEASE_ROOT/$NEW_RELEASE" \
    "$ARTIFACT_ROOT/$NEW_RELEASE/source-manifest.txt"
fi
systemctl start resume-ai-security-state-cleanup.service
ALLOW_PENDING_TRANSACTION=1 "$SCRIPT_DIR/verify-release-consistency.sh" "$STATE_FILE" >/dev/null
[ "$KIND" != deploy ] || [ "$recovered_release" != "$NEW_RELEASE" ] \
  || write_deployment_complete_marker "$NEW_RELEASE" "$NEW_PREVIOUS_RELEASE"
if [ "$KIND" = deploy ] && [ "$recovered_release" = "$NEW_RELEASE" ]; then
  verify_committed_deploy_database
  verify_release_evidence_semantics "$NEW_RELEASE"
  seal_deployment_artifact "$NEW_RELEASE"
  ALLOW_PENDING_TRANSACTION=1 RUN_CERTBOT_DRY_RUN=0 \
    "$SCRIPT_DIR/verify-production-host.sh" >/dev/null
elif [ "$KIND" = deploy ]; then
  for managed_root in "$RELEASE_ROOT" "$ARTIFACT_ROOT" "$CACHE_ROOT" "$BUILD_ROOT" "$VERIFY_ROOT"; do
    safe_remove_uncommitted_tree "$managed_root" "$NEW_RELEASE" \
      || fail "rolled-back deploy left an unsafe uncommitted tree: $managed_root/$NEW_RELEASE"
    sync -f "$managed_root"
  done
fi
if { [ "$KIND" = rollback ] || [ "$KIND" = initialize ]; } \
  && [ "$recovered_release" = "$NEW_RELEASE" ]; then
  ALLOW_PENDING_TRANSACTION=1 RUN_CERTBOT_DRY_RUN=0 \
    "$SCRIPT_DIR/verify-production-host.sh" >/dev/null
fi
if [ "$recovered_release" = "$NEW_RELEASE" ]; then
  finalize_control_plane_for_release "$NEW_RELEASE"
fi
rm -f -- "$PENDING_FILE"
sync -f "$STATE_DIR"
"$SCRIPT_DIR/verify-release-consistency.sh" "$STATE_FILE" >/dev/null
if { [ "$KIND" = deploy ] && [ "$recovered_release" = "$NEW_RELEASE" ]; } \
  || [ "$KIND" = rollback ] || [ "$KIND" = initialize ]; then
  RUN_CERTBOT_DRY_RUN=0 "$SCRIPT_DIR/verify-production-host.sh" >/dev/null
fi
printf '%s\n' "Recovered $KIND transaction to $recovered_release."
