#!/usr/bin/env bash
set -euo pipefail
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

fail() {
  printf '%s\n' "FAIL: $*" >&2
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

root_pnpm() {
  (cd / && /usr/bin/env -i HOME=/root NPM_CONFIG_USERCONFIG=/dev/null \
    npm_config_userconfig=/dev/null \
    PATH=/opt/nodejs/current/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    /opt/nodejs/current/bin/pnpm "$@")
}

root_curl() {
  (cd / && /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin \
    /usr/bin/curl --disable --noproxy '*' "$@")
}

pass() {
  printf '%s\n' "PASS: $*"
}

[ "${EUID:-$(id -u)}" -eq 0 ] || fail "run as root"
[ -z "${APT_CONFIG+x}" ] || fail "APT_CONFIG override is forbidden in production verification"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
[ "$SCRIPT_DIR" = /usr/local/lib/resume-ai ] \
  || fail "production host verification must use the root-installed control"
[ -f "$SCRIPT_DIR/open-root-lock.sh" ] && [ ! -L "$SCRIPT_DIR/open-root-lock.sh" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$SCRIPT_DIR/open-root-lock.sh")" = root:root:755:1 ] \
  || fail "installed root lock helper is missing or unsafe"
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
runtime_layout_pending=/opt/resume-ai/state/runtime-layout.pending
runtime_layout_complete=/etc/resume-ai/runtime-layout-bootstrap.env
[ ! -e "$runtime_layout_pending" ] && [ ! -L "$runtime_layout_pending" ] \
  || fail "runtime-layout bootstrap is incomplete"
[ -f "$runtime_layout_complete" ] && [ ! -L "$runtime_layout_complete" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$runtime_layout_complete")" = root:root:400:1 ] \
  || fail "runtime-layout bootstrap completion receipt is missing or unsafe"
root_python - "$runtime_layout_complete" <<'PY'
import datetime
import pathlib
import re
import sys

values = {}
for line in pathlib.Path(sys.argv[1]).read_text(encoding="utf-8").splitlines():
    if "=" not in line:
        raise SystemExit("malformed runtime-layout completion receipt")
    key, value = line.split("=", 1)
    if key in values or key not in {
        "SCHEMA_VERSION", "PHASE", "STARTED_AT",
        "BOOTSTRAP_GENERATION", "BOOTSTRAP_MANIFEST_SHA256",
        "HOST_BASELINE_DIR", "HOST_BASELINE_MANIFEST_SHA256",
        "SOURCE_GENERATION_SHA256", "CONTROL_SPEC_SHA256"
    }:
        raise SystemExit("unknown or duplicate runtime-layout completion field")
    values[key] = value
if set(values) != {
    "SCHEMA_VERSION", "PHASE", "STARTED_AT",
    "BOOTSTRAP_GENERATION", "BOOTSTRAP_MANIFEST_SHA256",
    "HOST_BASELINE_DIR", "HOST_BASELINE_MANIFEST_SHA256",
    "SOURCE_GENERATION_SHA256", "CONTROL_SPEC_SHA256"
} or values["SCHEMA_VERSION"] != "4" or values["PHASE"] != "complete":
    raise SystemExit("runtime-layout completion receipt has the wrong schema or phase")
try:
    started = datetime.datetime.strptime(
        values["STARTED_AT"], "%Y-%m-%dT%H:%M:%SZ"
    ).replace(tzinfo=datetime.timezone.utc)
except ValueError:
    raise SystemExit("runtime-layout completion start time is malformed")
if started > datetime.datetime.now(datetime.timezone.utc):
    raise SystemExit("runtime-layout completion start time is in the future")
for key in ["SOURCE_GENERATION_SHA256", "CONTROL_SPEC_SHA256"]:
    if re.fullmatch(r"[a-f0-9]{64}", values[key]) is None:
        raise SystemExit("runtime-layout completion digest is malformed")
bootstrap = values["BOOTSTRAP_MANIFEST_SHA256"]
if (re.fullmatch(r"[a-f0-9]{64}", bootstrap) is None
        or values["BOOTSTRAP_GENERATION"]
        != f"/var/lib/resume-ai/bootstrap-generations/generation-{bootstrap}"):
    raise SystemExit("runtime-layout completion bootstrap identity is malformed")
if (re.fullmatch(r"/var/backups/resume-ai/prechange/20\d{6}T\d{6}Z",
                 values["HOST_BASELINE_DIR"]) is None
        or re.fullmatch(r"[a-f0-9]{64}", values["HOST_BASELINE_MANIFEST_SHA256"])
        is None):
    raise SystemExit("runtime-layout completion host baseline identity is malformed")
PY
bootstrap_generation="$(awk -F= '$1 == "BOOTSTRAP_GENERATION" { print $2 }' \
  "$runtime_layout_complete")"
bootstrap_manifest_sha256="$(awk -F= '$1 == "BOOTSTRAP_MANIFEST_SHA256" { print $2 }' \
  "$runtime_layout_complete")"
bootstrap_started_at="$(awk -F= '$1 == "STARTED_AT" { print $2 }' \
  "$runtime_layout_complete")"
host_baseline_dir="$(awk -F= '$1 == "HOST_BASELINE_DIR" { print $2 }' \
  "$runtime_layout_complete")"
host_baseline_manifest_sha256="$(awk -F= \
  '$1 == "HOST_BASELINE_MANIFEST_SHA256" { print $2 }' "$runtime_layout_complete")"
bootstrap_copier=/usr/local/lib/resume-ai/create-bootstrap-generation.py
[ -f "$bootstrap_copier" ] && [ ! -L "$bootstrap_copier" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$bootstrap_copier")" = root:root:555:1 ] \
  || fail "fixed bootstrap generation verifier is missing or unsafe"
bootstrap_identity="$(root_python "$bootstrap_copier" verify \
  "$bootstrap_generation" "$bootstrap_manifest_sha256")" \
  || fail "first-root bootstrap generation failed its fixed verifier"
IFS=$'\t' read -r verified_bootstrap_generation verified_bootstrap_manifest \
  verified_bootstrap_started verified_bootstrap_copier <<< "$bootstrap_identity"
[ "$verified_bootstrap_generation:$verified_bootstrap_manifest:$verified_bootstrap_started" \
    = "$bootstrap_generation:$bootstrap_manifest_sha256:$bootstrap_started_at" ] \
  && [[ "$verified_bootstrap_copier" =~ ^[a-f0-9]{64}$ ]] \
  || fail "runtime-layout completion differs from the active bootstrap generation"
baseline_verifier=/usr/local/lib/resume-ai/verify-host-baseline.py
[ -f "$baseline_verifier" ] && [ ! -L "$baseline_verifier" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$baseline_verifier")" = root:root:755:1 ] \
  || fail "fixed host baseline verifier is missing or unsafe"
baseline_identity="$(root_python "$baseline_verifier" "$host_baseline_dir" \
  "$host_baseline_manifest_sha256" "$bootstrap_generation" \
  "$bootstrap_manifest_sha256")" \
  || fail "pre-change host baseline failed its fixed verifier"
IFS=$'\t' read -r verified_baseline_manifest baseline_snapshot_release \
  baseline_snapshot_evidence baseline_snapshot_id baseline_snapshot_sha \
  baseline_bootstrap_started <<< "$baseline_identity"
[ "$verified_baseline_manifest:$baseline_bootstrap_started" \
    = "$host_baseline_manifest_sha256:$bootstrap_started_at" ] \
  || fail "host baseline differs from the runtime-layout bootstrap identity"
[ -z "${OPS_DIR_OVERRIDE+x}" ] \
  || fail "OPS_DIR_OVERRIDE is forbidden in production host verification"
STATE_FILE=/opt/resume-ai/state/active.env
[ -f "$STATE_FILE" ] && [ ! -L "$STATE_FILE" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$STATE_FILE")" = root:resume-ai:640:1 ] \
  || fail "active release state is missing or unsafe"
HOST_STATE_START_SHA256="$(sha256sum "$STATE_FILE" | awk '{print $1}')"

ACTIVE_PORT=""
ACTIVE_RELEASE=""
PREVIOUS_PORT=""
PREVIOUS_RELEASE=""
SWITCHED_AT=""
while IFS='=' read -r state_key state_value || [ -n "$state_key" ]; do
  case "$state_key" in
    ACTIVE_PORT|ACTIVE_RELEASE|PREVIOUS_PORT|PREVIOUS_RELEASE|SWITCHED_AT) printf -v "$state_key" '%s' "$state_value" ;;
    '') ;;
    *) fail "unknown release state key" ;;
  esac
done < "$STATE_FILE"
case "$ACTIVE_PORT:$ACTIVE_RELEASE" in 3000:20??????T??????Z|3001:20??????T??????Z) ;; *) fail "active release state is valid" ;; esac
[[ "$SWITCHED_AT" =~ ^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] \
  || fail "active release switch timestamp is invalid"
[ -L /opt/resume-ai/current ] || fail "current is a symbolic link"
ACTIVE_ROOT="$(readlink -e /opt/resume-ai/current)" \
  || fail "active release cannot be resolved"
[ "$ACTIVE_ROOT" = "/opt/resume-ai/releases/$ACTIVE_RELEASE" ] \
  && [ -d "$ACTIVE_ROOT" ] && [ ! -L "$ACTIVE_ROOT" ] \
  && [ "$(stat -c '%U:%G' "$ACTIVE_ROOT")" = root:resume-ai ] \
  || fail "current points outside the fixed active release"
OPS_DIR="$ACTIVE_ROOT/ops"
[ -d "$OPS_DIR" ] && [ ! -L "$OPS_DIR" ] \
  || fail "fixed active release operations directory is missing or unsafe"
ACTIVE_ROOT_START_ID="$(stat -c '%d:%i:%Y:%Z' "$ACTIVE_ROOT")"
deploy_pending=/opt/resume-ai/state/deploy.pending
PENDING_ACTIVE_VALIDATION=0
case "${ALLOW_PENDING_TRANSACTION:-0}" in
  0)
    [ ! -e "$deploy_pending" ] && [ ! -L "$deploy_pending" ] \
      || fail "a deployment transaction is pending outside an explicitly authorized validation"
    ;;
  1)
    [ -f "$deploy_pending" ] && [ ! -L "$deploy_pending" ] \
      || fail "pending host validation requires one ordinary deploy journal"
    pending_validator=/usr/local/lib/resume-ai/validate-pending-deploy-host-state.py
    [ -f "$pending_validator" ] && [ ! -L "$pending_validator" ] \
      && [ "$(stat -c '%U:%G:%a:%h' "$pending_validator")" = root:root:755:1 ] \
      || fail "installed pending-deploy validator is missing or unsafe"
    runtime_gid="$(getent group resume-ai | cut -d: -f3)"
    [[ "$runtime_gid" =~ ^[1-9][0-9]*$ ]] \
      || fail "resume-ai group identity is unavailable"
    pending_host_phase="$(root_python "$pending_validator" "$STATE_FILE" \
      "$deploy_pending" 0 "$runtime_gid")" \
      || fail "deploy journal is not exactly bound to this pending active release"
    case "$pending_host_phase" in
      nginx_switched|permissions_hardened) PENDING_ACTIVE_VALIDATION=1 ;;
      state_committed) PENDING_ACTIVE_VALIDATION=0 ;;
      *) fail "pending host validator returned an unapproved phase" ;;
    esac
    ;;
  *) fail "ALLOW_PENDING_TRANSACTION must be 0 or 1" ;;
esac

# Before invoking any further installed helper, prove the complete privileged
# control plane is the same source-manifest-bound generation as the fixed
# active release. During a deploy, the generation must be fully installed and
# its own journal must name this same candidate; outside that narrow window no
# control-plane journal is accepted.
CONTROL_SOURCE_MANIFEST="/opt/resume-ai/release-artifacts/$ACTIVE_RELEASE/source-manifest.txt"
CONTROL_SPEC=/usr/local/share/resume-ai/control-plane-files.conf
CONTROL_CANDIDATE_SPEC="$OPS_DIR/config/control-plane-files.conf"
CONTROL_VERIFIER=/usr/local/lib/resume-ai/verify-control-plane-generation.py
for control_source in "$CONTROL_SOURCE_MANIFEST" "$CONTROL_CANDIDATE_SPEC"; do
  [ -f "$control_source" ] && [ ! -L "$control_source" ] \
    && [ "$(stat -c '%U:%h' "$control_source")" = root:1 ] \
    && [ -z "$(find "$control_source" -maxdepth 0 -perm /022 -print -quit)" ] \
    || fail "active control-plane source evidence is unsafe: $control_source"
done
for control_anchor in "$CONTROL_SPEC" "$CONTROL_VERIFIER" \
  /usr/local/lib/resume-ai/install-control-plane-generation.sh \
  /usr/local/lib/resume-ai/recover-control-plane-generation.sh \
  /usr/local/lib/resume-ai/open-root-lock.sh; do
  [ -f "$control_anchor" ] && [ ! -L "$control_anchor" ] \
    && [ "$(stat -c '%U:%G:%h' "$control_anchor")" = root:root:1 ] \
    && [ -z "$(find "$control_anchor" -maxdepth 0 -perm /022 -print -quit)" ] \
    || fail "installed control-plane trust anchor is unsafe: $control_anchor"
done
cmp -s "$CONTROL_CANDIDATE_SPEC" "$CONTROL_SPEC" \
  && cmp -s "$OPS_DIR/bin/verify-control-plane-generation.py" "$CONTROL_VERIFIER" \
  && cmp -s "$OPS_DIR/bin/install-control-plane-generation.sh" \
    /usr/local/lib/resume-ai/install-control-plane-generation.sh \
  && cmp -s "$OPS_DIR/bin/recover-control-plane-generation.sh" \
    /usr/local/lib/resume-ai/recover-control-plane-generation.sh \
  && cmp -s "$OPS_DIR/bin/open-root-lock.sh" /usr/local/lib/resume-ai/open-root-lock.sh \
  || fail "active release attempts an ordinary control-plane trust-anchor upgrade"
CONTROL_GENERATION="$(root_python "$CONTROL_VERIFIER" --mode installed \
  --source-root "$ACTIVE_ROOT" --source-manifest "$CONTROL_SOURCE_MANIFEST" \
  --spec "$CONTROL_SPEC" --candidate-spec "$CONTROL_CANDIDATE_SPEC" \
  --installed-manifest /etc/resume-ai/control-plane-generation.env)" \
  || fail "installed privileged controls differ from the fixed active release"
[[ "$CONTROL_GENERATION" =~ ^[a-f0-9]{64}$ ]] \
  || fail "installed control-plane generation identity is malformed"
control_pending=/opt/resume-ai/state/control-plane.pending
CONTROL_PENDING_START_SHA256=none
if [ "${ALLOW_PENDING_TRANSACTION:-0}" = 1 ]; then
  if [ -e "$control_pending" ] || [ -L "$control_pending" ]; then
    [ "$pending_host_phase" = state_committed ] \
      || fail "installed candidate controls require a state_committed deployment"
    [ -f "$control_pending" ] && [ ! -L "$control_pending" ] \
      && [ "$(stat -c '%U:%G:%a:%h' "$control_pending")" = root:root:600:1 ] \
      || fail "pending control-plane rollback receipt is unsafe"
    CONTROL_PENDING_START_SHA256="$(sha256sum "$control_pending" | awk '{print $1}')"
    read -r pending_stage pending_stage_manifest_sha pending_stage_sums_sha \
      pending_backup pending_backup_sha < <(root_python - \
      "$control_pending" "$ACTIVE_RELEASE" "$CONTROL_GENERATION" <<'PY'
import pathlib
import re
import sys

allowed = {
    "SCHEMA_VERSION", "KIND", "PHASE", "OLD_RELEASE", "NEW_RELEASE",
    "STAGE_DIR", "STAGE_MANIFEST_SHA256", "STAGE_SHA256SUMS_SHA256",
    "BACKUP_DIR", "BACKUP_MANIFEST_SHA256", "GENERATION_SHA256",
}
values = {}
for line in pathlib.Path(sys.argv[1]).read_text(encoding="utf-8").splitlines():
    if "=" not in line:
        raise SystemExit("control-plane journal contains a malformed row")
    key, value = line.split("=", 1)
    if key not in allowed or key in values or not value:
        raise SystemExit("control-plane journal contains an unknown, duplicate, or empty value")
    values[key] = value
release = sys.argv[2]
if (set(values) != allowed or values["SCHEMA_VERSION"] != "3"
        or values["KIND"] not in {"stage", "bootstrap"}
        or values["PHASE"] != "installed" or values["NEW_RELEASE"] != release
        or values["GENERATION_SHA256"] != sys.argv[3]
        or re.fullmatch(r"20[0-9]{6}T[0-9]{6}Z", values["OLD_RELEASE"]) is None
        or values["STAGE_DIR"] != f"/var/lib/resume-ai/control-plane-staging/{release}"
        or re.fullmatch(r"[a-f0-9]{64}", values["STAGE_MANIFEST_SHA256"]) is None
        or re.fullmatch(r"[a-f0-9]{64}", values["STAGE_SHA256SUMS_SHA256"]) is None
        or re.fullmatch(r"/var/backups/resume-ai/control-plane/20[0-9]{6}T[0-9]{6}Z\.[A-Za-z0-9]{6}", values["BACKUP_DIR"]) is None
        or re.fullmatch(r"[a-f0-9]{64}", values["BACKUP_MANIFEST_SHA256"]) is None):
    raise SystemExit("control-plane journal is not an installed receipt for this release")
print(values["STAGE_DIR"], values["STAGE_MANIFEST_SHA256"],
      values["STAGE_SHA256SUMS_SHA256"], values["BACKUP_DIR"],
      values["BACKUP_MANIFEST_SHA256"])
PY
    ) || fail "pending control-plane receipt is malformed"
    [ -d "$pending_stage" ] && [ ! -L "$pending_stage" ] \
      && [ "$(readlink -e -- "$pending_stage")" = "$pending_stage" ] \
      && [ "$(stat -c '%U:%G:%a' "$pending_stage")" = root:root:700 ] \
      && [ "$(sha256sum "$pending_stage/STAGE_MANIFEST" | awk '{print $1}')" = "$pending_stage_manifest_sha" ] \
      && [ "$(sha256sum "$pending_stage/STAGE_SHA256SUMS" | awk '{print $1}')" = "$pending_stage_sums_sha" ] \
      && (cd "$pending_stage" && sha256sum --strict -c STAGE_SHA256SUMS >/dev/null) \
      || fail "pending control-plane shadow is not checksum-complete"
    [ -d "$pending_backup" ] && [ ! -L "$pending_backup" ] \
      && [ "$(readlink -e -- "$pending_backup")" = "$pending_backup" ] \
      && [ "$(stat -c '%U:%G:%a' "$pending_backup")" = root:root:700 ] \
      && [ "$(sha256sum "$pending_backup/BACKUP_SHA256SUMS" | awk '{print $1}')" = "$pending_backup_sha" ] \
      && (cd "$pending_backup" && sha256sum --strict -c BACKUP_SHA256SUMS >/dev/null) \
      || fail "pending control-plane rollback backup is not checksum-complete"
  else
    [ "$pending_host_phase" = state_committed ] \
      || fail "control-plane journal disappeared before the deploy commit decision"
    # A crash after the trusted finalizer removed only the control receipt but
    # before deploy.pending was unlinked is a legitimate forward-recovery
    # state.  The installed-generation proof above remains mandatory.
  fi
else
  [ ! -e "$control_pending" ] && [ ! -L "$control_pending" ] \
    || fail "a control-plane generation remains pending outside deployment validation"
fi
cmp -s "$OPS_DIR/bin/verify-production-host.sh" "$SCRIPT_DIR/verify-production-host.sh" \
  && cmp -s "$OPS_DIR/bin/open-root-lock.sh" "$SCRIPT_DIR/open-root-lock.sh" \
  || fail "host verifier trust anchors differ from the active control generation"
approval_file="/etc/resume-ai/approved-releases/$ACTIVE_RELEASE.env"
[ -f "$approval_file" ] && [ ! -L "$approval_file" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$approval_file")" = root:root:400:1 ] \
  || fail "active root approval is missing or unsafe before evidence verification"
ACTIVE_APPROVAL_SHA256="$(sha256sum "$approval_file" | awk '{print $1}')"
[ -d /var/lib/resume-ai/release-evidence-generations ] \
  && [ ! -L /var/lib/resume-ai/release-evidence-generations ] \
  && [ "$(readlink -e -- /var/lib/resume-ai/release-evidence-generations)" = /var/lib/resume-ai/release-evidence-generations ] \
  && [ "$(stat -c '%U:%G:%a' /var/lib/resume-ai/release-evidence-generations)" = root:root:700 ] \
  || fail "root-private Linux validation generation store is missing or unsafe"
[ -f /usr/local/lib/resume-ai/release-required-tests.json ] \
  && [ ! -L /usr/local/lib/resume-ai/release-required-tests.json ] \
  && [ "$(stat -c '%U:%G:%a:%h' /usr/local/lib/resume-ai/release-required-tests.json)" = root:root:444:1 ] \
  || fail "installed required-test policy is missing or unsafe"
read -r TRUSTED_DEEP_SCAN_ATTESTATION_SHA256 \
  TRUSTED_DEEP_SCAN_PRODUCER_SHA256 \
  TRUSTED_DEEP_SCAN_COMPLETION_SHA256 \
  LINUX_VALIDATION_ATTESTATION_SHA256 \
  REQUIRED_TEST_POLICY_SHA256 < <(root_python - \
  "$approval_file" "$ACTIVE_RELEASE" \
  "/opt/resume-ai/release-artifacts/$ACTIVE_RELEASE/release-manifest.json" \
  "/opt/resume-ai/release-artifacts/$ACTIVE_RELEASE/source-manifest.txt" \
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
        raise SystemExit("root approval contains a malformed row")
    key, value = line.split("=", 1)
    if key not in allowed or key in values or not value:
        raise SystemExit("root approval contains an unknown, duplicate, or empty value")
    values[key] = value
if (set(values) != allowed or values["SCHEMA_VERSION"] != "6"
        or values["RELEASE_ID"] != sys.argv[2]
        or re.fullmatch(r"[a-f0-9]{64}", values["TRUSTED_DEEP_SCAN_ATTESTATION_SHA256"]) is None
        or re.fullmatch(r"[a-f0-9]{64}", values["TRUSTED_DEEP_SCAN_PRODUCER_SHA256"]) is None
        or re.fullmatch(r"[a-f0-9]{64}", values["TRUSTED_DEEP_SCAN_COMPLETION_SHA256"]) is None
        or re.fullmatch(r"[a-f0-9]{64}", values["LINUX_VALIDATION_ATTESTATION_SHA256"]) is None
        or re.fullmatch(r"[a-f0-9]{64}", values["REQUIRED_TEST_POLICY_SHA256"]) is None):
    raise SystemExit("root approval does not bind the trusted Deep Scan generation")

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
    raise SystemExit(f"active release manifest is not strict JSON: {error}")
binding = manifest.get("linuxValidationAttestation") if isinstance(manifest, dict) else None
if (
    not isinstance(binding, dict)
    or set(binding) != {"evidenceMember", "artifactManifestMember", "sha256"}
    or binding.get("evidenceMember") != "linux-validation-attestation.json"
    or binding.get("artifactManifestMember") != "linux-validation-artifact-manifest.txt"
    or binding.get("sha256") != values["LINUX_VALIDATION_ATTESTATION_SHA256"]
):
    raise SystemExit("active release manifest differs from the approved Linux validation generation")
source_policy = None
for line in pathlib.Path(sys.argv[4]).read_text(encoding="utf-8").splitlines():
    match = re.fullmatch(r"([a-f0-9]{64})\t([FL])\t([^\t\r\n]+)", line)
    if match is None:
        raise SystemExit("active source manifest is malformed")
    digest, kind, relative = match.groups()
    if relative == "ops/config/release-required-tests.json":
        if kind != "F" or source_policy is not None:
            raise SystemExit("active source manifest duplicates the required-test policy")
        source_policy = digest
installed_policy = hashlib.sha256(pathlib.Path(sys.argv[5]).read_bytes()).hexdigest()
if source_policy != values["REQUIRED_TEST_POLICY_SHA256"] or installed_policy != source_policy:
    raise SystemExit("required-test policy differs across source, approval, and installed control")
print(values["TRUSTED_DEEP_SCAN_ATTESTATION_SHA256"],
      values["TRUSTED_DEEP_SCAN_PRODUCER_SHA256"],
      values["TRUSTED_DEEP_SCAN_COMPLETION_SHA256"],
      values["LINUX_VALIDATION_ATTESTATION_SHA256"],
      values["REQUIRED_TEST_POLICY_SHA256"])
PY
) || fail "active root approval does not expose every trusted evidence pin"
[ -f /etc/resume-ai/release-evidence-signing.key ] \
  && [ ! -L /etc/resume-ai/release-evidence-signing.key ] \
  && [ "$(stat -c '%U:%G:%a:%h' /etc/resume-ai/release-evidence-signing.key)" = root:root:600:1 ] \
  && [ -f /etc/resume-ai/release-evidence-signing.pub ] \
  && [ ! -L /etc/resume-ai/release-evidence-signing.pub ] \
  && [ "$(stat -c '%U:%G:%a:%h' /etc/resume-ai/release-evidence-signing.pub)" = root:root:644:1 ] \
  && /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin \
    /usr/bin/openssl pkey -pubin -in /etc/resume-ai/release-evidence-signing.pub \
    -text -noout 2>/dev/null | /usr/bin/grep -Fxq 'ED25519 Public-Key:' \
  && /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin \
    /usr/bin/openssl pkey -in /etc/resume-ai/release-evidence-signing.key -pubout \
    2>/dev/null | cmp -s - /etc/resume-ai/release-evidence-signing.pub \
  || fail "Linux validation Ed25519 trust anchor pair is missing, unsafe, or inconsistent"
[ -f /etc/resume-ai/release-evidence-signing.env ] \
  && [ ! -L /etc/resume-ai/release-evidence-signing.env ] \
  && [ "$(stat -c '%U:%G:%a:%h' /etc/resume-ai/release-evidence-signing.env)" = root:root:600:1 ] \
  || fail "Linux validation signing provisioning marker is missing or unsafe"
EVIDENCE_SIGNING_PRIVATE_SHA256="$(sha256sum /etc/resume-ai/release-evidence-signing.key | awk '{print $1}')"
EVIDENCE_SIGNING_PUBLIC_SHA256="$(sha256sum /etc/resume-ai/release-evidence-signing.pub | awk '{print $1}')"
EVIDENCE_SIGNING_MARKER_SHA256="$(sha256sum /etc/resume-ai/release-evidence-signing.env | awk '{print $1}')"
root_node /usr/local/lib/resume-ai/verify-release-evidence.mjs \
  --bundle "/opt/resume-ai/release-artifacts/$ACTIVE_RELEASE" \
  --trusted-generation-attestation-sha256 "$TRUSTED_DEEP_SCAN_ATTESTATION_SHA256" \
  --trusted-generation-producer-sha256 "$TRUSTED_DEEP_SCAN_PRODUCER_SHA256" \
  --trusted-deep-scan-completion-sha256 "$TRUSTED_DEEP_SCAN_COMPLETION_SHA256" \
  || fail "active release evidence failed the same-generation semantic verifier"
pass "root-installed control plane is one fixed release-manifest generation"
[ "$(readlink -e /opt/resume-ai/current)" = "$ACTIVE_ROOT" ] \
  || fail "current points to active release"
pass "atomic current pointer"
/usr/local/lib/resume-ai/validate-app-env.sh production
/usr/local/lib/resume-ai/verify-release-consistency.sh "$STATE_FILE" >/dev/null
pass "state/current/upstream/live PM2/persisted PM2 five-way consistency"

snapshot_evidence="/var/lib/resume-ai/security/cloud-snapshots/$ACTIVE_RELEASE.env"
[ -d /var/lib/resume-ai/security/cloud-snapshots/by-snapshot-id ] \
  && [ ! -L /var/lib/resume-ai/security/cloud-snapshots/by-snapshot-id ] \
  && [ "$(readlink -e -- /var/lib/resume-ai/security/cloud-snapshots/by-snapshot-id)" \
    = /var/lib/resume-ai/security/cloud-snapshots/by-snapshot-id ] \
  && [ "$(stat -c '%U:%G:%a' /var/lib/resume-ai/security/cloud-snapshots/by-snapshot-id)" \
    = root:root:700 ] \
  || fail "global snapshot identity registry is missing or unsafe"
[ ! -e "/var/lib/resume-ai/security/cloud-snapshots/$ACTIVE_RELEASE.pending" ] \
  && [ ! -L "/var/lib/resume-ai/security/cloud-snapshots/$ACTIVE_RELEASE.pending" ] \
  || fail "cloud snapshot remains explicitly pending/not-performed for this release"
[ -f "$snapshot_evidence" ] && [ ! -L "$snapshot_evidence" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$snapshot_evidence")" = root:root:400:1 ] \
  || fail "release-bound cloud snapshot evidence is missing or unsafe"
[ -f /usr/local/lib/resume-ai/record-cloud-snapshot-evidence.py ] \
  && [ ! -L /usr/local/lib/resume-ai/record-cloud-snapshot-evidence.py ] \
  && [ "$(stat -c '%U:%G:%a:%h' /usr/local/lib/resume-ai/record-cloud-snapshot-evidence.py)" = root:root:755:1 ] \
  || fail "fixed cloud snapshot verifier is missing or unsafe"
root_python /usr/local/lib/resume-ai/record-cloud-snapshot-evidence.py \
  --verify-continuity "$snapshot_evidence" "$ACTIVE_RELEASE" "$SWITCHED_AT" >/dev/null \
  || fail "active release lacks post-provision snapshot continuity"
unset snapshot_evidence
pass "root-only post-provision system-disk snapshot evidence is bound to this release"

legacy_environment=/etc/resume-ai/legacy.env
previous_legacy_manifest=""
if [ "$PREVIOUS_RELEASE" != none ]; then
  previous_legacy_manifest="/opt/resume-ai/releases/$PREVIOUS_RELEASE/ops/legacy-adoption.json"
fi
if [ -n "$previous_legacy_manifest" ] \
  && { [ -e "$previous_legacy_manifest" ] || [ -L "$previous_legacy_manifest" ]; }; then
  [ -f "$previous_legacy_manifest" ] && [ ! -L "$previous_legacy_manifest" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$previous_legacy_manifest")" = root:resume-ai:440:1 ] \
    || fail "previous legacy release contract is unsafe"
  [ -f "$legacy_environment" ] && [ ! -L "$legacy_environment" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$legacy_environment")" = root:resume-ai:640:1 ] \
    || fail "previous legacy rollback environment is missing or unsafe"
  cmp -s "/opt/resume-ai/releases/$PREVIOUS_RELEASE/ops/config/legacy-env-keys.conf" \
    /usr/local/share/resume-ai/legacy-env-keys.conf \
    || fail "previous legacy environment policy differs from its root-installed control"
  previous_legacy_snapshot="/var/lib/resume-ai/security/cloud-snapshots/$PREVIOUS_RELEASE.initial-rollback.env"
  [ ! -e "/var/lib/resume-ai/security/cloud-snapshots/$PREVIOUS_RELEASE.initial-rollback.pending" ] \
    && [ ! -L "/var/lib/resume-ai/security/cloud-snapshots/$PREVIOUS_RELEASE.initial-rollback.pending" ] \
    || fail "previous legacy release initial snapshot remains pending"
  [ -f "$previous_legacy_snapshot" ] && [ ! -L "$previous_legacy_snapshot" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$previous_legacy_snapshot")" = root:root:400:1 ] \
    || fail "previous legacy release snapshot evidence is missing or unsafe"
  root_node - "$previous_legacy_manifest" "$PREVIOUS_RELEASE" \
    "$previous_legacy_snapshot" <<'NODE'
const crypto = require("node:crypto");
const fs = require("node:fs");
const [manifestPath, releaseId, snapshotPath] = process.argv.slice(2);
const value = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const snapshot = fs.readFileSync(snapshotPath);
const snapshotHash = crypto.createHash("sha256").update(snapshot).digest("hex");
if (value?.schemaVersion !== 2 || value?.releaseId !== releaseId
    || value?.databaseContract?.kind !== "legacy-delete"
    || value?.databaseContract?.runtimeRequiresDirectDelete !== true
    || value?.databaseContract?.manifestBoundRpcContract !== false
    || !/^lhsnap-[A-Za-z0-9]{6,80}$/u.test(value?.snapshotEvidenceId ?? "")
    || value?.snapshotEvidenceSha256 !== snapshotHash) process.exit(2);
NODE
  read -r previous_legacy_snapshot_id previous_legacy_snapshot_sha < <(root_python - \
    "$previous_legacy_manifest" "$PREVIOUS_RELEASE" <<'PY_LEGACY_HOST_SNAPSHOT'
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
PY_LEGACY_HOST_SNAPSHOT
  ) || fail "previous legacy manifest cannot bind its initial snapshot"
  root_python /usr/local/lib/resume-ai/record-cloud-snapshot-evidence.py \
    --verify-initial-rollback "$previous_legacy_snapshot" "$PREVIOUS_RELEASE" \
    "$previous_legacy_snapshot_id" "$previous_legacy_snapshot_sha" >/dev/null \
    || fail "previous legacy snapshot claim is missing, reused, or inconsistent"
  runuser -u resume-ai -- env -i \
    APP_RELEASE_DIR="/opt/resume-ai/releases/$PREVIOUS_RELEASE" \
    APP_PORT="$PREVIOUS_PORT" APP_PROCESS_NAME="resume-ai-$PREVIOUS_PORT" \
    PATH=/opt/nodejs/current/bin:/usr/bin:/bin \
    /opt/nodejs/current/bin/node -e 'require(process.argv[1])' \
    "/opt/resume-ai/releases/$PREVIOUS_RELEASE/ops/pm2/ecosystem.config.cjs"
  unset previous_legacy_snapshot previous_legacy_snapshot_id previous_legacy_snapshot_sha
  pass "immediate legacy rollback environment and API snapshot evidence remain isolated and exact"
else
  [ ! -e "$legacy_environment" ] && [ ! -L "$legacy_environment" ] \
    || fail "legacy rollback environment remains after the immediate legacy rollback window"
fi

nginx_version="$(nginx -v 2>&1)"
[ "$nginx_version" = "nginx version: nginx/1.30.4" ] || fail "Nginx is exactly 1.30.4"
[ "$(dpkg-query -W -f='${Version}' nginx 2>/dev/null)" = "1.30.4-1~jammy" ] \
  || fail "the installed Nginx package is not the approved official build"
[ ! -e /opt/resume-ai/state/nginx-migration.pending ] \
  || fail "an Nginx package/config migration is still pending recovery"
[ ! -e /opt/resume-ai/state/legacy-adoption.pending ] \
  || fail "a one-time legacy adoption is still pending recovery"
systemctl cat resume-ai-nginx-migration-recovery.service >/dev/null \
  || fail "Nginx migration recovery unit is missing"
systemctl cat resume-ai-legacy-adoption-recovery.service >/dev/null \
  || fail "legacy adoption recovery unit is missing"
for nginx_control in \
  assert-nginx-security-contract.py assert-nginx-package-runtime.sh \
  nginx-migration-recovery-gate.sh read-proc-start-ticks.py \
  recover-nginx-migration.sh finalize-nginx-migration-recovery.sh; do
  [ -f "/usr/local/lib/resume-ai/$nginx_control" ] \
    && [ ! -L "/usr/local/lib/resume-ai/$nginx_control" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "/usr/local/lib/resume-ai/$nginx_control")" = root:root:755:1 ] \
    && cmp -s "$OPS_DIR/bin/$nginx_control" "/usr/local/lib/resume-ai/$nginx_control" \
    || fail "installed Nginx control differs from the fixed active release: $nginx_control"
done
cmp -s "$OPS_DIR/systemd/nginx-resume-ai-recovery.conf" \
  /etc/systemd/system/nginx.service.d/resume-ai-recovery.conf \
  || fail "installed Nginx recovery drop-in differs from the fixed active release"
nginx_review_by="$(awk -F= '$1 == "NGINX_SECURITY_REVIEW_BY" { print $2; count += 1 } END { if (count != 1) exit 2 }' \
  "$OPS_DIR/config/approved-nginx-versions.conf")" \
  || fail "Nginx security review deadline is missing or duplicated"
[[ "$nginx_review_by" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] \
  && [ "$(date -u +%F)" \< "$nginx_review_by" ] \
  || fail "Nginx security review has expired"
mapfile -t approved_nginx_debs < <(find /var/backups/resume-ai/nginx-migration \
  -mindepth 3 -maxdepth 3 -type f -path '*/approved-deb/nginx_1.30.4-1~jammy_amd64.deb' \
  -printf '%p\n' | LC_ALL=C sort)
[ "${#approved_nginx_debs[@]}" -gt 0 ] \
  || fail "no cached official Nginx recovery payload is available"
"$SCRIPT_DIR/assert-nginx-package-runtime.sh" "$OPS_DIR" \
  "${approved_nginx_debs[$((${#approved_nginx_debs[@]} - 1))]}" managed >/dev/null \
  || fail "effective Nginx package/binary/module/config contract differs from the reviewed release"
unset nginx_control nginx_review_by approved_nginx_debs
pass "official Nginx 1.30.4 package, exact modules/config and clean migration journal"

temp_dir="$(mktemp -d /tmp/resume-ai-host-verify.XXXXXX)"
cleanup() { rm -rf -- "$temp_dir"; }
trap cleanup EXIT
nginx_log_files=(
  /var/log/nginx/error.log
  /var/log/nginx/resume-ai-error.log
  /var/log/nginx/resume-ai-access.log
)
if [ -e /var/log/nginx/access.log ]; then
  nginx_log_files+=(/var/log/nginx/access.log)
fi
for nginx_log in "${nginx_log_files[@]}"; do
  [ -f "$nginx_log" ] && [ ! -L "$nginx_log" ] && [ "$(stat -c '%h' "$nginx_log")" = 1 ] \
    || fail "Nginx log is missing or unsafe: $nginx_log"
  stat -c '%d:%i:%s' "$nginx_log" > "$temp_dir/$(basename "$nginx_log").before"
done
/usr/local/lib/resume-ai/render-quota-config.sh \
  "$OPS_DIR/config/quotas.conf" "$temp_dir/generated" >/dev/null
[ ! -e /opt/resume-ai/state/quota-generation.pending ] \
  && [ ! -L /opt/resume-ai/state/quota-generation.pending ] \
  || fail "a quota-generation transaction is incomplete"
[ -z "$(find /var/lib/resume-ai/quota-generations -mindepth 1 -maxdepth 1 \
  -name '.pending.*' -print -quit)" ] \
  || fail "an unjournaled quota-generation staging directory remains"
quota_target_contracts=(
  /etc/resume-ai/quota.env:root:resume-ai:640
  /etc/resume-ai/quota-generation.env:root:root:600
  /etc/nginx/conf.d/00-resume-ai-global.conf:root:root:644
  /etc/nginx/snippets/resume-ai-recommend-quota.inc:root:root:644
  /etc/nginx/snippets/resume-ai-track-quota.inc:root:root:644
)
for quota_contract in "${quota_target_contracts[@]}"; do
  IFS=: read -r quota_target quota_owner quota_group quota_mode <<< "$quota_contract"
  [ -f "$quota_target" ] && [ ! -L "$quota_target" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$quota_target")" = \
      "$quota_owner:$quota_group:$quota_mode:1" ] \
    || fail "installed quota target ownership or mode differs: $quota_target"
done
unset quota_contract quota_target quota_owner quota_group quota_mode quota_target_contracts
[ -f /usr/local/lib/resume-ai/verify-quota-generation.py ] \
  && [ ! -L /usr/local/lib/resume-ai/verify-quota-generation.py ] \
  && [ "$(stat -c '%U:%G:%a:%h' /usr/local/lib/resume-ai/verify-quota-generation.py)" = root:root:755:1 ] \
  && cmp -s "$OPS_DIR/bin/verify-quota-generation.py" \
    /usr/local/lib/resume-ai/verify-quota-generation.py \
  || fail "installed quota-generation verifier differs from the fixed active release"
source_quota_generation="$(root_python /usr/local/lib/resume-ai/verify-quota-generation.py \
  "$temp_dir/generated/quota-generation.env" \
  "$temp_dir/generated/application-quota.env" \
  "$temp_dir/generated/00-resume-ai-global.conf" \
  "$temp_dir/generated/nginx-quota.inc" \
  "$temp_dir/generated/nginx-track-quota.inc")" \
  || fail "active release quota generation is invalid"
[ "$source_quota_generation" = "$(root_python /usr/local/lib/resume-ai/verify-quota-generation.py \
  "$OPS_DIR/generated/quota-generation.env" \
  "$OPS_DIR/generated/application-quota.env" \
  "$OPS_DIR/generated/00-resume-ai-global.conf" \
  "$OPS_DIR/generated/nginx-quota.inc" \
  "$OPS_DIR/generated/nginx-track-quota.inc")" ] \
  && cmp -s "$temp_dir/generated/quota-generation.env" "$OPS_DIR/generated/quota-generation.env" \
  && cmp -s "$temp_dir/generated/application-quota.env" "$OPS_DIR/generated/application-quota.env" \
  && cmp -s "$temp_dir/generated/00-resume-ai-global.conf" "$OPS_DIR/generated/00-resume-ai-global.conf" \
  && cmp -s "$temp_dir/generated/nginx-quota.inc" "$OPS_DIR/generated/nginx-quota.inc" \
  && cmp -s "$temp_dir/generated/nginx-track-quota.inc" "$OPS_DIR/generated/nginx-track-quota.inc" \
  || fail "rendered quota generation differs from frozen source-manifest members"
installed_quota_generation="$(root_python /usr/local/lib/resume-ai/verify-quota-generation.py \
  /etc/resume-ai/quota-generation.env /etc/resume-ai/quota.env \
  /etc/nginx/conf.d/00-resume-ai-global.conf \
  /etc/nginx/snippets/resume-ai-recommend-quota.inc \
  /etc/nginx/snippets/resume-ai-track-quota.inc)" \
  || fail "installed quota generation is invalid or mixed"
[ "$installed_quota_generation" = "$source_quota_generation" ] \
  || fail "installed quota generation differs from the fixed active release"
[ -f /usr/local/lib/resume-ai/assert-pm2-effective-service.sh ] \
  && [ ! -L /usr/local/lib/resume-ai/assert-pm2-effective-service.sh ] \
  && [ "$(stat -c '%U:%G:%a:%h' /usr/local/lib/resume-ai/assert-pm2-effective-service.sh)" = root:root:755:1 ] \
  && cmp -s "$OPS_DIR/bin/assert-pm2-effective-service.sh" \
    /usr/local/lib/resume-ai/assert-pm2-effective-service.sh \
  || fail "installed PM2 effective-policy verifier differs from the active release"
cmp -s "$OPS_DIR/systemd/resume-ai-pm2.service" \
  /etc/systemd/system/resume-ai-pm2.service \
  && cmp -s "$OPS_DIR/systemd/resume-ai-pm2-node-recovery.conf" \
    /etc/systemd/system/resume-ai-pm2.service.d/node-runtime-recovery.conf \
  || fail "installed PM2 systemd policy differs from the active release"
/usr/local/lib/resume-ai/assert-pm2-effective-service.sh >/dev/null \
  || fail "effective PM2 systemd policy differs from the reviewed least-privilege contract"
active_pid="$(runuser -u resume-ai -- env -i HOME=/var/lib/resume-ai PM2_HOME=/var/lib/resume-ai/.pm2 \
  PATH=/opt/nodejs/current/bin:/usr/bin:/bin /opt/nodejs/current/bin/pm2 pid "resume-ai-$ACTIVE_PORT" | tail -n 1)"
[[ "$active_pid" =~ ^[1-9][0-9]*$ ]] && [ -r "/proc/$active_pid/environ" ] \
  || fail "active runtime environment cannot be inspected safely"
[ "$(stat -c '%U' "/proc/$active_pid")" = resume-ai ] \
  || fail "active runtime process is not owned by the dedicated account"
active_pid_start_ticks="$(/usr/local/lib/resume-ai/read-proc-start-ticks.py "$active_pid")" \
  || fail "active runtime process identity cannot be frozen"
for capability_field in CapInh CapPrm CapEff CapBnd CapAmb; do
  capability_value="$(awk -v field="$capability_field:" '$1 == field { print $2; count += 1 } END { if (count != 1) exit 2 }' \
    "/proc/$active_pid/status")" \
    || fail "active runtime $capability_field state cannot be inspected exactly"
  [[ "$capability_value" =~ ^0+$ ]] \
    || fail "active runtime retains Linux capabilities in $capability_field"
done
[ "$(awk '$1 == "NoNewPrivs:" { print $2; count += 1 } END { if (count != 1) exit 2 }' \
    "/proc/$active_pid/status")" = 1 ] \
  || fail "active runtime does not enforce no-new-privileges"
unset capability_field capability_value
root_python - /etc/resume-ai/quota.env "/proc/$active_pid/environ" <<'PY'
import pathlib
import re
import sys

expected = {}
for line in pathlib.Path(sys.argv[1]).read_text(encoding="utf-8").splitlines():
    if not re.fullmatch(r"[A-Z][A-Z0-9_]*=[A-Za-z0-9_./:+-]+", line):
        raise SystemExit("invalid rendered quota environment")
    key, value = line.split("=", 1)
    if key in expected:
        raise SystemExit("duplicate rendered quota key")
    expected[key] = value
runtime = {}
for entry in pathlib.Path(sys.argv[2]).read_bytes().split(b"\0"):
    if not entry or b"=" not in entry:
        continue
    key, value = entry.split(b"=", 1)
    decoded_key = key.decode("ascii", errors="strict")
    if decoded_key in expected:
        runtime[decoded_key] = value.decode("ascii", errors="strict")
if runtime != expected:
    raise SystemExit("live application quota environment differs from the generated quota file")
PY
[ "$(/usr/local/lib/resume-ai/read-proc-start-ticks.py "$active_pid")" = "$active_pid_start_ticks" ] \
  || fail "active runtime changed while its process security/quota state was inspected"
loaded_quota_generation="$(root_curl --proto '=https' --tlsv1.2 -fsS \
  --resolve siyuanjiaxin.com:443:127.0.0.1 --connect-timeout 5 --max-time 10 \
  https://siyuanjiaxin.com/__resume_ai_quota_generation)" \
  || fail "live Nginx quota-generation endpoint is unavailable"
[ "$loaded_quota_generation" = "$installed_quota_generation" ] \
  || fail "live Nginx workers loaded a different quota generation"
unset source_quota_generation installed_quota_generation loaded_quota_generation
pass "single-source quota manifest matches files, live app and live Nginx workers"

LC_ALL=C nginx -T > "$temp_dir/nginx.txt" 2> "$temp_dir/nginx-diagnostics.txt"
[ "$(wc -l < "$temp_dir/nginx-diagnostics.txt")" -eq 2 ] \
  && grep -Fxq 'nginx: the configuration file /etc/nginx/nginx.conf syntax is ok' \
    "$temp_dir/nginx-diagnostics.txt" \
  && grep -Fxq 'nginx: configuration file /etc/nginx/nginx.conf test is successful' \
    "$temp_dir/nginx-diagnostics.txt" \
  || fail "Nginx configuration validation emitted a warning or unexpected diagnostic"
for endpoint in \
  '/api/competitions/recommend/normalize' \
  '/api/ai/competition-clarify' \
  '/api/ai/competition-recommend'; do
  awk -v expected="$endpoint" '$0 ~ "location = " expected " \\{" { found = 1 } END { exit found ? 0 : 1 }' \
    "$temp_dir/nginx.txt" || fail "Nginx endpoint missing: $endpoint"
done
if awk 'tolower($0) ~ /content-security-policy/ { found = 1 } END { exit found ? 0 : 1 }' "$temp_dir/nginx.txt"; then
  fail "Nginx must not own Content-Security-Policy"
fi
log_format_line="$(awk '/^[[:space:]]*log_format resume_ai_json / { print; found += 1 } END { if (found != 1) exit 2 }' "$temp_dir/nginx.txt")" \
  || fail "privacy-preserving JSON access log format is not unique"
case "$log_format_line" in *'$remote_addr'*|*'$remote_port'*|*'$http_x_forwarded_for'*|*'$proxy_add_x_forwarded_for'*|*'$upstream_addr'*) fail "Nginx access log contains a raw client or loopback address" ;; esac
[ "$(grep -Fxc '    access_log off;' "$temp_dir/nginx.txt")" -eq 6 ] \
  || fail "every default/redirect virtual host must explicitly suppress raw-IP access logging"
if grep -Eq '^[[:space:]]*listen[[:space:]]+.*[[:space:]]http2([[:space:]]|;)' \
    "$temp_dir/nginx.txt"; then
  fail "deprecated listen ... http2 syntax remains effective"
fi
[ "$(grep -Fxc '    http2 on;' "$temp_dir/nginx.txt")" -eq 3 ] \
  || fail "every TLS virtual host must enable modern HTTP/2 exactly once"
grep -Fq 'limit_req_log_level info;' "$temp_dir/nginx.txt" \
  && grep -Fq 'error_log /var/log/nginx/resume-ai-error.log crit;' "$temp_dir/nginx.txt" \
  && grep -Fq 'error_log /var/log/nginx/error.log crit;' "$temp_dir/nginx.txt" \
  || fail "raw-IP limit_req messages are not suppressed below the error-log threshold"
pass "Nginx route and CSP ownership"

public_status="$(root_curl --http2 -sS -D "$temp_dir/headers.txt" -o /dev/null \
  -w '%{http_code}' https://siyuanjiaxin.com/)"
[ "$public_status" = 200 ] || fail "public homepage returned HTTP $public_status"
http_version="$(root_curl --http2 -fsS -o /dev/null -w '%{http_version}' https://siyuanjiaxin.com/)"
[ "$http_version" = "2" ] || fail "public endpoint did not negotiate HTTP/2"
for header_name in strict-transport-security x-content-type-options x-frame-options referrer-policy permissions-policy content-security-policy x-request-id; do
  header_count="$(awk -F: -v name="$header_name" 'tolower($1) == name { count += 1 } END { print count + 0 }' "$temp_dir/headers.txt")"
  [ "$header_count" -eq 1 ] || fail "$header_name must appear exactly once"
done
if awk -F: 'tolower($1) == "x-powered-by" { found = 1 } END { exit found ? 0 : 1 }' "$temp_dir/headers.txt"; then
  fail "X-Powered-By is exposed"
fi
csp="$(awk -F': ' 'tolower($1) == "content-security-policy" { sub(/\r$/, "", $2); print $2 }' "$temp_dir/headers.txt")"
script_policy="$(printf '%s\n' "$csp" | sed -E 's/.*script-src[[:space:]]+([^;]*).*/\1/')"
case "$script_policy" in *"'unsafe-inline'"*|*"'unsafe-eval'"*) fail "script CSP contains an unsafe directive" ;; esac
case "$script_policy" in *"'nonce-"*) ;; *) fail "script CSP has no nonce" ;; esac
pass "HTTP/2 and single nonce-based security headers"

expected_contact="$(/usr/local/lib/resume-ai/validate-app-env.sh get NEXT_PUBLIC_CONTACT_EMAIL)"
[ "$expected_contact" = privacy@siyuanjiaxin.com ] || fail "security contact differs from the established privacy mailbox"
security_text="$(root_curl -fsS --proto '=https' --tlsv1.2 https://siyuanjiaxin.com/.well-known/security.txt)"
printf '%s\n' "$security_text" | grep -Fxq "Contact: mailto:$expected_contact" \
  || fail "security.txt contact differs from runtime configuration"
security_expires="$(printf '%s\n' "$security_text" | awk -F': ' '$1 == "Expires" { print $2; count += 1 } END { if (count != 1) exit 2 }')" \
  || fail "security.txt must contain one expiry"
root_python - "$security_expires" <<'PY'
import datetime
import sys
value = datetime.datetime.fromisoformat(sys.argv[1].replace("Z", "+00:00"))
if value <= datetime.datetime.now(datetime.timezone.utc):
    raise SystemExit("security.txt is expired")
PY
for www_url in \
  'http://www.siyuanjiaxin.com/ops-www-redirect-check?source=host-gate' \
  'https://www.siyuanjiaxin.com/ops-www-redirect-check?source=host-gate'; do
  redirect_headers="$temp_dir/www-$(printf '%s' "$www_url" | sha256sum | awk '{print $1}').headers"
  root_curl -fsS --proto-redir '=https' -o /dev/null -D "$redirect_headers" --max-redirs 0 "$www_url" \
    || [ "$?" -eq 22 ] || fail "www redirect request failed"
  awk 'NR == 1 { if ($2 != 301) exit 2 } tolower($1) == "location:" { sub(/\r$/, "", $2); if ($2 == "https://siyuanjiaxin.com/ops-www-redirect-check?source=host-gate") found=1 } END { exit found ? 0 : 3 }' \
    "$redirect_headers" || fail "www did not preserve path/query in its exact 301 apex redirect"
  case "$www_url" in
    https://*)
      for header_name in strict-transport-security x-content-type-options x-frame-options referrer-policy permissions-policy x-request-id; do
        header_count="$(awk -F: -v name="$header_name" 'tolower($1) == name { count += 1 } END { print count + 0 }' "$redirect_headers")"
        [ "$header_count" -eq 1 ] || fail "HTTPS www redirect must emit $header_name exactly once"
      done
      ;;
  esac
done
pass "security.txt and HTTP/HTTPS www compatibility redirect"

assert_empty_444() {
  local label=$1
  shift
  local status exit_status
  set +e
  status="$(root_curl -sk -o /dev/null -w '%{http_code}' "$@" 2>/dev/null)"
  exit_status=$?
  set -e
  [ "$status" = 000 ] && [ "$exit_status" -ne 0 ] || fail "$label was not rejected with an empty 444 response"
}
assert_empty_444 "unknown HTTP Host" --resolve invalid.resume-ai.invalid:80:127.0.0.1 http://invalid.resume-ai.invalid/
assert_empty_444 "unknown HTTPS Host" --resolve invalid.resume-ai.invalid:443:127.0.0.1 https://invalid.resume-ai.invalid/
assert_empty_444 "direct HTTP IP" http://127.0.0.1/
assert_empty_444 "direct HTTPS IP" https://127.0.0.1/
for nginx_log in "${nginx_log_files[@]}"; do
  before_file="$temp_dir/$(basename "$nginx_log").before"
  IFS=: read -r before_device before_inode before_size < "$before_file"
  IFS=: read -r after_device after_inode after_size < <(stat -c '%d:%i:%s' "$nginx_log")
  [ "$before_device:$before_inode" = "$after_device:$after_inode" ] \
    || fail "Nginx log rotated during the raw-address delta check; rerun the gate"
  [ "$after_size" -ge "$before_size" ] || fail "Nginx log shrank during the raw-address delta check"
  tail -c "+$((before_size + 1))" "$nginx_log" > "$temp_dir/$(basename "$nginx_log").delta"
  if grep -Eq '(^|[^0-9])127\.0\.0\.1([^0-9]|$)|(^|[^[:xdigit:]:])::1([^[:xdigit:]:]|$)' \
    "$temp_dir/$(basename "$nginx_log").delta"; then
    fail "Nginx emitted the known raw test address to $(basename "$nginx_log")"
  fi
done
pass "unknown Host and direct-IP rejection on HTTP and HTTPS"

for service_account in resume-ai resume-ai-build resume-ai-verify resume-ai-pgtest resume-ai-dbverify; do
  case "$service_account" in
    resume-ai) expected_account_home=/var/lib/resume-ai ;;
    *) expected_account_home="/var/lib/$service_account" ;;
  esac
  service_uid="$(id -u "$service_account")" \
    && service_gid="$(id -g "$service_account")" \
    || fail "$service_account account is missing"
  IFS=: read -r passwd_name _ passwd_uid passwd_gid _ passwd_home passwd_shell < <(
    getent passwd "$service_account"
  )
  [ "$passwd_name:$passwd_uid:$passwd_gid:$passwd_home" \
      = "$service_account:$service_uid:$service_gid:$expected_account_home" ] \
    && [[ "$service_uid" =~ ^[1-9][0-9]*$ ]] \
    && [[ "$service_gid" =~ ^[1-9][0-9]*$ ]] \
    && [ "$(id -gn "$service_account")" = "$service_account" ] \
    && [ "$(id -G "$service_account")" = "$service_gid" ] \
    && [ -z "$(getent group "$service_account" | cut -d: -f4)" ] \
    && { [ "$passwd_shell" = /usr/sbin/nologin ] || [ "$passwd_shell" = /bin/false ]; } \
    || fail "$service_account is not an exact dedicated non-login identity"
done
while IFS=$'\t' read -r managed_path managed_contract; do
  [ -d "$managed_path" ] && [ ! -L "$managed_path" ] \
    && [ "$(readlink -e -- "$managed_path")" = "$managed_path" ] \
    && [ "$(stat -c '%U:%G:%a' "$managed_path")" = "$managed_contract" ] \
    || fail "managed service-account/scratch directory is unsafe: $managed_path"
done <<'EOF'
/var/lib/resume-ai	root:root:755
/var/lib/resume-ai-build	root:root:555
/var/lib/resume-ai-verify	root:root:555
/var/lib/resume-ai-dbverify	root:root:555
/opt/resume-ai/approval-staging	root:root:700
/opt/resume-ai/deploy-inputs	root:root:700
EOF
pgrep -u "$(id -u resume-ai-build)" >/dev/null 2>&1 && fail "isolated builder has a surviving process"
pgrep -u "$(id -u resume-ai-verify)" >/dev/null 2>&1 && fail "one-shot verifier has a surviving process"
pgrep -u "$(id -u resume-ai-pgtest)" >/dev/null 2>&1 && fail "disposable PostgreSQL identity has a surviving process"
pgrep -u "$(id -u resume-ai-dbverify)" >/dev/null 2>&1 && fail "database verifier identity has a surviving process"
systemctl is-enabled --quiet resume-ai-pm2.service || fail "PM2 systemd unit is not enabled"
systemctl is-active --quiet resume-ai-pm2.service || fail "PM2 systemd unit is not active"
reboot_evidence=/var/lib/resume-ai/security/last-maintenance-reboot.env
[ -f "$reboot_evidence" ] && [ ! -L "$reboot_evidence" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$reboot_evidence")" = root:root:600:1 ] \
  || fail "verified maintenance-reboot evidence is missing or unsafe"
current_boot_id="$(tr -d '\n' < /proc/sys/kernel/random/boot_id)"
before_boot_id="$(awk -F= '$1 == "BEFORE_BOOT_ID" { print $2; count += 1 } END { if (count != 1) exit 2 }' "$reboot_evidence")"
after_boot_id="$(awk -F= '$1 == "AFTER_BOOT_ID" { print $2; count += 1 } END { if (count != 1) exit 2 }' "$reboot_evidence")"
[ "$after_boot_id" = "$current_boot_id" ] && [ "$before_boot_id" != "$after_boot_id" ] \
  && grep -Fxq 'SERVICES_RECOVERED=YES' "$reboot_evidence" \
  || fail "maintenance-reboot evidence does not prove the current boot"
systemctl cat resume-ai-deploy-recovery.service >/dev/null || fail "deployment recovery unit is missing"
nginx_requires=" $(systemctl show nginx.service --property=Requires --value) "
nginx_after=" $(systemctl show nginx.service --property=After --value) "
for recovery_dependency in \
  resume-ai-pm2.service \
  resume-ai-deploy-recovery.service \
  resume-ai-nginx-migration-recovery.service \
  resume-ai-legacy-adoption-recovery.service; do
  case "$nginx_requires" in *" $recovery_dependency "*) ;; *) fail "Nginx does not require $recovery_dependency" ;; esac
  case "$nginx_after" in *" $recovery_dependency "*) ;; *) fail "Nginx is not ordered after $recovery_dependency" ;; esac
done
unset nginx_requires nginx_after recovery_dependency
for runtime_binary in node pm2 pnpm; do
  [ -x "/opt/nodejs/current/bin/$runtime_binary" ] || fail "approved $runtime_binary binary is missing"
done
node_runtime_root="$(readlink -f /opt/nodejs/current)"
[[ "$node_runtime_root" =~ ^/opt/nodejs/node-v[0-9]+\.[0-9]+\.[0-9]+-linux-x64$ ]] \
  && [ -d "$node_runtime_root" ] && [ ! -L "$node_runtime_root" ] \
  && [ -z "$(find "$node_runtime_root" -xdev ! -type l \
    \( ! -user root -o -perm /022 \) -print -quit)" ] \
  || fail "approved Node runtime tree is not root-owned and immutable"
while IFS= read -r -d '' runtime_link; do
  runtime_target="$(readlink -f "$runtime_link")"
  case "$runtime_target" in "$node_runtime_root"/*) ;; *) fail "Node runtime symlink escapes its immutable tree" ;; esac
done < <(find "$node_runtime_root" -xdev -type l -print0)
[ "$(root_node --version)" = v24.20.0 ] || fail "Node 24.20.0 LTS is not active"
[ "$(root_pnpm --version)" = 11.19.0 ] || fail "pnpm 11.19.0 is not active"
pm2_version="$(runuser -u resume-ai -- env -i HOME=/var/lib/resume-ai PM2_HOME=/var/lib/resume-ai/.pm2 \
  PATH=/opt/nodejs/current/bin:/usr/bin:/bin /opt/nodejs/current/bin/pm2 --version | tail -n 1)"
[ "$pm2_version" = 7.0.4 ] || fail "PM2 7.0.4 is not active"
systemctl cat resume-ai-pm2.service | grep -Fq 'ExecStart=/opt/nodejs/current/bin/pm2 resurrect' \
  || fail "PM2 service can fall back to the EOL system Node runtime"
[ ! -e /opt/nodejs/node-runtime.pending ] && [ ! -L /opt/nodejs/node-runtime.pending ] \
  || fail "an interrupted Node runtime migration still requires recovery"
[ ! -e /run/resume-ai-locks/node-runtime.live ] && [ ! -L /run/resume-ai-locks/node-runtime.live ] \
  || fail "a stale Node runtime migration owner marker remains"
pm2_requires=" $(systemctl show resume-ai-pm2.service --property=Requires --value) "
pm2_after=" $(systemctl show resume-ai-pm2.service --property=After --value) "
case "$pm2_requires" in *' resume-ai-node-runtime-recovery.service '*) ;; *) fail "PM2 does not require Node runtime recovery" ;; esac
case "$pm2_after" in *' resume-ai-node-runtime-recovery.service '*) ;; *) fail "PM2 is not ordered after Node runtime recovery" ;; esac
systemctl cat resume-ai-node-runtime-recovery.service \
  | grep -Fq 'ExecCondition=/usr/local/lib/resume-ai/node-runtime-recovery-gate.sh' \
  || fail "Node runtime boot recovery gate is not installed"
unset pm2_requires pm2_after
if grep -RIl --include='*.list' --include='*.sources' 'deb\.nodesource\.com/node_20\.x' \
  /etc/apt/sources.list /etc/apt/sources.list.d 2>/dev/null | grep -q .; then
  fail "obsolete NodeSource 20 channel remains enabled"
fi
latest_node_evidence="$(find /var/backups/resume-ai/node-runtime -mindepth 1 -maxdepth 1 -type d \
  -name '20??????T??????Z' -print | sort | tail -n 1)"
[ -n "$latest_node_evidence" ] && [ ! -L "$latest_node_evidence" ] \
  && [ "$(readlink -e -- "$latest_node_evidence")" = "$latest_node_evidence" ] \
  && [ "$(stat -c '%U:%G:%a' "$latest_node_evidence")" = root:root:700 ] \
  || fail "Node runtime rollback/audit evidence is missing or unsafe"
for evidence_name in runtime-npm-audit.json runtime-installed-dependencies.json \
  node24-installed-files.sha256 node24-installed-tree.jsonl; do
  evidence_file="$latest_node_evidence/$evidence_name"
  [ -s "$evidence_file" ] && [ ! -L "$evidence_file" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$evidence_file")" = root:root:600:1 ] \
    || fail "Node runtime evidence is missing or unsafe: $evidence_name"
done
root_node - "$latest_node_evidence" <<'NODE'
const fs = require("node:fs");
const root = process.argv[2];
const audit = JSON.parse(fs.readFileSync(`${root}/runtime-npm-audit.json`, "utf8"));
const installed = JSON.parse(fs.readFileSync(`${root}/runtime-installed-dependencies.json`, "utf8"));
if (audit?.metadata?.vulnerabilities?.total !== 0) process.exit(2);
if (installed?.dependencies?.pm2?.version !== "7.0.4") process.exit(3);
if (installed?.dependencies?.pnpm?.version !== "11.19.0") process.exit(4);
NODE
(cd /opt/nodejs/current && sha256sum -c "$latest_node_evidence/node24-installed-files.sha256" >/dev/null) \
  || fail "active Node runtime differs from its post-audit file manifest"
node_runtime_target="$(readlink -f /opt/nodejs/current)"
/usr/local/lib/resume-ai/verify-single-link-tree.sh "$node_runtime_target"
/usr/local/lib/resume-ai/create-immutable-tree-manifest.py "$node_runtime_target" \
  > "$temp_dir/node24-observed-tree.jsonl"
cmp -s "$latest_node_evidence/node24-installed-tree.jsonl" \
  "$temp_dir/node24-observed-tree.jsonl" \
  || fail "active Node runtime metadata or links differ from the approved immutable tree"
runuser -u resume-ai -- env -i HOME=/var/lib/resume-ai PM2_HOME=/var/lib/resume-ai/.pm2 \
  PATH=/opt/nodejs/current/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  pm2 describe "resume-ai-$ACTIVE_PORT" >/dev/null || fail "active PM2 process is missing"
if ss -ltnH | awk '$4 ~ /:300[01]$/ && $4 !~ /^127\.0\.0\.1:/ { bad = 1 } END { exit bad ? 0 : 1 }'; then
  fail "an application port is exposed beyond loopback"
fi
pass "dedicated PM2 account, pinned Node 24 toolchain and loopback binding"

/usr/local/lib/resume-ai/assert-ssh-effective-policy.sh >/dev/null \
  || fail "SSH hardening differs from its complete connection-context policy"
authorized_keys=/etc/ssh/authorized_keys/ubuntu
ssh_key_evidence=/etc/resume-ai/approved-ssh-user-key.env
[ ! -e /etc/resume-ai/ssh-key-rotation.pending ] \
  && [ ! -L /etc/resume-ai/ssh-key-rotation.pending ] \
  && [ ! -e /etc/ssh/authorized_keys/ubuntu.next ] \
  && [ ! -L /etc/ssh/authorized_keys/ubuntu.next ] \
  || fail "SSH key rotation remains staged and legacy authorization is not proven revoked"
[ -f "$authorized_keys" ] && [ ! -L "$authorized_keys" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$authorized_keys")" = root:root:600:1 ] \
  || fail "root-owned approved ubuntu authorization is missing or unsafe"
[ -f "$ssh_key_evidence" ] && [ ! -L "$ssh_key_evidence" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$ssh_key_evidence")" = root:root:600:1 ] \
  || fail "approved SSH key evidence is missing or unsafe"
[ -f /etc/resume-ai/approved-ssh-expectations.env ] \
  && [ ! -L /etc/resume-ai/approved-ssh-expectations.env ] \
  && [ "$(stat -c '%U:%G:%a:%h' /etc/resume-ai/approved-ssh-expectations.env)" = root:root:400:1 ] \
  || fail "external SSH fingerprint expectation is missing or unsafe"
cmp -s "$OPS_DIR/ssh/00-resume-ai-hardening.conf" \
  /etc/ssh/sshd_config.d/00-resume-ai-hardening.conf \
  || fail "installed SSH hardening configuration differs from the fixed active release"
awk '
  /\r/ { bad = 1; next }
  /^[[:space:]]*(#.*)?$/ { next }
  $1 != "ssh-ed25519" || NF < 2 { bad = 1; next }
  { keys += 1 }
  END { exit !bad && keys == 1 ? 0 : 1 }
' "$authorized_keys" || fail "authorized_keys differs from the one-key Ed25519 policy"
if grep -Eiq 'ssh-rsa|claude-deploy-siyuan' "$authorized_keys"; then
  fail "a revoked RSA or claude-deploy-siyuan authorization remains"
fi
observed_key_sha256="$(sha256sum "$authorized_keys" | awk '{print $1}')"
observed_key_fingerprint="$(ssh-keygen -E sha256 -lf "$authorized_keys" | awk 'NR == 1 { print $2 } END { if (NR != 1) exit 2 }')" \
  || fail "approved SSH fingerprint cannot be derived"
[ -f /etc/ssh/ssh_host_ed25519_key.pub ] && [ ! -L /etc/ssh/ssh_host_ed25519_key.pub ] \
  && [ "$(stat -c '%U:%G:%a:%h' /etc/ssh/ssh_host_ed25519_key.pub)" = root:root:644:1 ] \
  || fail "server Ed25519 host public key is missing or unsafe"
observed_host_fingerprint="$(ssh-keygen -E sha256 -lf /etc/ssh/ssh_host_ed25519_key.pub | awk 'NR == 1 { print $2 } END { if (NR != 1) exit 2 }')" \
  || fail "server Ed25519 host fingerprint cannot be derived"
expectation_sha256="$(sha256sum /etc/resume-ai/approved-ssh-expectations.env | awk '{print $1}')"
root_python - "$ssh_key_evidence" "$observed_key_sha256" "$observed_key_fingerprint" \
  "$observed_host_fingerprint" "$expectation_sha256" \
  /etc/resume-ai/approved-ssh-expectations.env <<'PY'
import pathlib
import re
import sys

allowed = {"SCHEMA_VERSION", "LOGIN_USER", "AUTHORIZED_KEYS_PATH", "KEY_TYPE", "AUTHORIZED_KEYS_SHA256", "KEY_FINGERPRINT", "HOST_ED25519_FINGERPRINT", "EXPECTATION_SHA256", "VERIFIED_AT", "LEGACY_KEYS_REMOVED", "HOME_AUTHORIZED_KEYS_DISABLED"}
values = {}
for line in pathlib.Path(sys.argv[1]).read_text(encoding="utf-8").splitlines():
    if "=" not in line:
        raise SystemExit("malformed SSH key evidence")
    key, value = line.split("=", 1)
    if key not in allowed or key in values:
        raise SystemExit("unknown or duplicate SSH key evidence")
    values[key] = value
if (set(values) != allowed or values["SCHEMA_VERSION"] != "2"
        or values["LOGIN_USER"] != "ubuntu"
        or values["AUTHORIZED_KEYS_PATH"] != "/etc/ssh/authorized_keys/ubuntu"
        or values["KEY_TYPE"] != "ssh-ed25519" or values["LEGACY_KEYS_REMOVED"] != "YES"
        or values["HOME_AUTHORIZED_KEYS_DISABLED"] != "YES"):
    raise SystemExit("SSH key evidence identity is invalid")
if values["AUTHORIZED_KEYS_SHA256"] != sys.argv[2] or values["KEY_FINGERPRINT"] != sys.argv[3]:
    raise SystemExit("authorized key differs from the separately verified fingerprint")
if values["HOST_ED25519_FINGERPRINT"] != sys.argv[4]:
    raise SystemExit("server Ed25519 host fingerprint changed after pinning")
if values["EXPECTATION_SHA256"] != sys.argv[5]:
    raise SystemExit("SSH evidence differs from the external fingerprint expectation")
if not re.fullmatch(r"20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", values["VERIFIED_AT"]):
    raise SystemExit("SSH key verification timestamp is invalid")
expectation = {}
for line in pathlib.Path(sys.argv[6]).read_text(encoding="utf-8").splitlines():
    if "=" not in line:
        raise SystemExit("malformed external SSH expectation")
    key, value = line.split("=", 1)
    if key not in {"SCHEMA_VERSION", "USER_KEY_FINGERPRINT", "HOST_ED25519_FINGERPRINT", "ISSUED_AT"} or key in expectation:
        raise SystemExit("unknown or duplicate external SSH expectation")
    expectation[key] = value
if (set(expectation) != {"SCHEMA_VERSION", "USER_KEY_FINGERPRINT", "HOST_ED25519_FINGERPRINT", "ISSUED_AT"}
        or expectation["SCHEMA_VERSION"] != "1"
        or expectation["USER_KEY_FINGERPRINT"] != sys.argv[3]
        or expectation["HOST_ED25519_FINGERPRINT"] != sys.argv[4]
        or not re.fullmatch(r"20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", expectation["ISSUED_AT"])):
    raise SystemExit("external SSH expectation does not match the live host/user keys")
PY
home_authorized_keys=/home/ubuntu/.ssh/authorized_keys
[ -f "$home_authorized_keys" ] && [ ! -L "$home_authorized_keys" ] \
  && [ "$(stat -c '%U:%G:%a:%h:%s' "$home_authorized_keys")" = root:root:600:1:0 ] \
  || fail "legacy home-directory authorization was not durably disabled"
unset observed_key_sha256 observed_key_fingerprint observed_host_fingerprint expectation_sha256
pass "SSH hardening, external host/user fingerprints and staged legacy-key revocation"

(
PATH=/usr/sbin:/usr/bin
export PATH
for qcloud_system_directory in /usr /usr/bin /usr/sbin; do
  [ -d "$qcloud_system_directory" ] && [ ! -L "$qcloud_system_directory" ] \
    && [ "$(/usr/bin/stat -c '%U:%G' "$qcloud_system_directory")" = root:root ] \
    && [ -z "$(/usr/bin/find "$qcloud_system_directory" -maxdepth 0 -perm /022 -print -quit)" ] \
    || fail "QCloud verifier command directory is linked or unsafe: $qcloud_system_directory"
done

rc_active="$(systemctl is-active rc-local.service 2>/dev/null || true)"
rc_enabled="$(systemctl is-enabled rc-local.service 2>/dev/null || true)"
[ "$rc_active" = "inactive" ] || fail "rc-local.service is not inactive"
[ "$rc_enabled" = masked ] || fail "rc-local.service is not masked"
[ -L /etc/systemd/system/rc-local.service ] \
  && [ "$(readlink /etc/systemd/system/rc-local.service)" = /dev/null ] \
  || fail "rc-local.service does not have the exact local /dev/null mask"
[ -f /etc/rc.local ] && [ ! -L /etc/rc.local ] \
  && [ "$(stat -c '%U:%G:%a:%h' /etc/rc.local)" = root:root:644:1 ] \
  || fail "/etc/rc.local was not preserved as an inert root-owned file"
[ -L /etc/rc.d/rc.local ] && [ "$(readlink /etc/rc.d/rc.local)" = /etc/rc.local ] \
  || fail "/etc/rc.d/rc.local differs from the preserved inert link"

[ -f /etc/udev/rules.d/80-qcloud-nic.rules ] \
  && [ ! -L /etc/udev/rules.d/80-qcloud-nic.rules ] \
  && [ "$(stat -c '%U:%G:%a:%h' /etc/udev/rules.d/80-qcloud-nic.rules)" = root:root:644:1 ] \
  && cmp -s "$OPS_DIR/udev/80-qcloud-nic.rules" /etc/udev/rules.d/80-qcloud-nic.rules \
  || fail "installed Tencent Cloud udev rule differs from the reviewed PrivateTmp dispatcher"
[ -f /etc/systemd/system/resume-ai-qcloud-network-tuning@.service ] \
  && [ ! -L /etc/systemd/system/resume-ai-qcloud-network-tuning@.service ] \
  && [ "$(stat -c '%U:%G:%a:%h' /etc/systemd/system/resume-ai-qcloud-network-tuning@.service)" = root:root:644:1 ] \
  && cmp -s "$OPS_DIR/systemd/resume-ai-qcloud-network-tuning@.service" \
    /etc/systemd/system/resume-ai-qcloud-network-tuning@.service \
  || fail "installed Tencent Cloud tuning systemd unit differs from the reviewed unit"
[ -f /usr/local/lib/resume-ai/run-qcloud-network-tuning.sh ] \
  && [ ! -L /usr/local/lib/resume-ai/run-qcloud-network-tuning.sh ] \
  && [ "$(stat -c '%U:%G:%a:%h' /usr/local/lib/resume-ai/run-qcloud-network-tuning.sh)" = root:root:755:1 ] \
  && cmp -s "$OPS_DIR/bin/run-qcloud-network-tuning.sh" \
    /usr/local/lib/resume-ai/run-qcloud-network-tuning.sh \
  || fail "installed Tencent Cloud tuning runner differs from the reviewed release"
for installed_control in qcloud-network-control.py rc-local-backup.py; do
  [ -f "/usr/local/lib/resume-ai/$installed_control" ] \
    && [ ! -L "/usr/local/lib/resume-ai/$installed_control" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "/usr/local/lib/resume-ai/$installed_control")" = root:root:755:1 ] \
    && cmp -s "$OPS_DIR/bin/$installed_control" "/usr/local/lib/resume-ai/$installed_control" \
    || fail "installed rc-local/QCloud control differs from the reviewed release: $installed_control"
done
[ -f /usr/local/share/resume-ai/approved-qcloud-network-tuning.conf ] \
  && [ ! -L /usr/local/share/resume-ai/approved-qcloud-network-tuning.conf ] \
  && [ "$(stat -c '%U:%G:%a:%h' /usr/local/share/resume-ai/approved-qcloud-network-tuning.conf)" = root:root:444:1 ] \
  && cmp -s "$OPS_DIR/config/approved-qcloud-network-tuning.conf" \
    /usr/local/share/resume-ai/approved-qcloud-network-tuning.conf \
  || fail "installed Tencent Cloud vendor hash policy differs from the reviewed release"
/usr/local/lib/resume-ai/run-qcloud-network-tuning.sh --verify-only >/dev/null \
  || fail "Tencent Cloud vendor tuning chain differs from its reviewed hashes"
root_python /usr/local/lib/resume-ai/qcloud-network-control.py host-state >/dev/null \
  || fail "QCloud/rc-local effective instance or alternate root execution path is unsafe"
[ ! -e /var/lib/resume-ai/security/rc-local-restore.pending ] \
  && [ ! -L /var/lib/resume-ai/security/rc-local-restore.pending ] \
  || fail "an rc-local restore transaction is incomplete"
[ ! -e /var/lib/resume-ai/security/qcloud-control.pending ] \
  && [ ! -L /var/lib/resume-ai/security/qcloud-control.pending ] \
  || fail "a QCloud control-generation transaction is incomplete"
for qcloud_generation_control in \
  install-qcloud-control-generation.sh recover-qcloud-control-generation.sh; do
  [ -f "/usr/local/lib/resume-ai/$qcloud_generation_control" ] \
    && [ ! -L "/usr/local/lib/resume-ai/$qcloud_generation_control" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "/usr/local/lib/resume-ai/$qcloud_generation_control")" = root:root:755:1 ] \
    && cmp -s "$OPS_DIR/bin/$qcloud_generation_control" \
      "/usr/local/lib/resume-ai/$qcloud_generation_control" \
    || fail "installed QCloud generation control differs from the fixed active release"
done
cmp -s "$OPS_DIR/systemd/resume-ai-qcloud-control-recovery.service" \
  /etc/systemd/system/resume-ai-qcloud-control-recovery.service \
  && systemctl is-enabled --quiet resume-ai-qcloud-control-recovery.service \
  || fail "QCloud control recovery is not installed and enabled exactly"

rc_backup_root=/var/backups/resume-ai/rc-local
[ -d "$rc_backup_root" ] && [ ! -L "$rc_backup_root" ] \
  && [ "$(stat -c '%U:%G:%a' "$rc_backup_root")" = root:root:700 ] \
  || fail "rc-local backup root is missing, linked, or unsafe"
[ -z "$(/usr/bin/find "$rc_backup_root" -mindepth 1 -maxdepth 1 \
  \( ! -type d -o -name '.pending-*' \) -print -quit)" ] \
  || fail "rc-local backup root contains an incomplete or unsafe generation"
mapfile -t rc_backup_generations < <(
  /usr/bin/find "$rc_backup_root" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' \
    | LC_ALL=C /usr/bin/sort
)
[ "${#rc_backup_generations[@]}" -gt 0 ] \
  || fail "no complete rc-local recovery generation exists"
for rc_backup_generation in "${rc_backup_generations[@]}"; do
  root_python /usr/local/lib/resume-ai/rc-local-backup.py verify \
    "$rc_backup_root/$rc_backup_generation" --production >/dev/null \
    || fail "rc-local backup generation is incomplete or unrecoverable: $rc_backup_generation"
done
unset installed_control qcloud_generation_control rc_backup_root rc_backup_generations rc_backup_generation
for fixed_marker in /etc/uuid /usr/local/qcloud/stargate/bin/firstRun; do
  [ ! -e "$fixed_marker" ] || { \
    [ -f "$fixed_marker" ] && [ ! -L "$fixed_marker" ] \
      && [ "$(stat -c '%U:%G:%a:%h' "$fixed_marker")" = root:root:644:1 ]; \
  } || fail "Tencent Cloud marker is writable or unsafe: $fixed_marker"
done
for qcloud_log_root in \
  /usr/local/qcloud/monitor/barad/log \
  /usr/local/qcloud/monitor/barad/admin/log \
  /usr/local/qcloud/barad/log; do
  [ ! -d "$qcloud_log_root" ] || [ -z "$(find "$qcloud_log_root" -xdev -perm /0002 -print -quit)" ] \
    || fail "Tencent Cloud logs remain world-writable: $qcloud_log_root"
done
if [ -e /home/ubuntu/.npm ]; then
  [ -d /home/ubuntu/.npm ] && [ ! -L /home/ubuntu/.npm ] \
    || fail "ubuntu npm cache root is unsafe"
  bad_npm="$(find /home/ubuntu/.npm -xdev \
    \( -type l -o \( -type d \( ! -user ubuntu -o ! -group ubuntu -o ! -perm 0700 \) \) \
      -o \( -type f \( ! -user ubuntu -o ! -group ubuntu -o ! -perm 0600 -o -links +1 \) \) \
      -o \( ! -type d ! -type f \) \) -print -quit)"
  [ -z "$bad_npm" ] || fail "ubuntu npm cache permissions remain unsafe: $bad_npm"
fi
if id lighthouse >/dev/null 2>&1; then
  [ "$(getent passwd lighthouse | cut -d: -f7)" = /usr/sbin/nologin ] \
    && [ "$(passwd -S lighthouse | awk '{print $2}')" = L ] \
    || fail "the reviewed lighthouse account is not locked and non-login"
  case " $(id -nG lighthouse) " in
    *" sudo "*|*" lxd "*|*" docker "*) fail "lighthouse retains a privileged group" ;;
  esac
  if grep -RE '^[[:space:]]*lighthouse[[:space:]].*NOPASSWD:' \
    /etc/sudoers /etc/sudoers.d 2>/dev/null | grep -q .; then
    fail "lighthouse retains passwordless sudo"
  fi
  lighthouse_marker=/var/lib/resume-ai/security/lighthouse-disabled.env
  [ -f "$lighthouse_marker" ] && [ ! -L "$lighthouse_marker" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$lighthouse_marker")" = root:root:600:1 ] \
    && grep -Fxq 'CLOUD_CONSOLE_DEPENDENCY=CONFIRMED_ABSENT' "$lighthouse_marker" \
    || fail "lighthouse cloud-console review evidence is missing or unsafe"
fi
)
pass "rc-local disabled and host/QCloud permission drift removed"

[ ! -e /var/lib/resume-ai/unattended-upgrades.pending ] \
  && [ ! -L /var/lib/resume-ai/unattended-upgrades.pending ] \
  || fail "an unattended-upgrades/source-policy transaction requires recovery"
[ -f /etc/resume-ai/apt-policy.env ] && [ ! -L /etc/resume-ai/apt-policy.env ] \
  && [ "$(stat -c '%U:%G:%a:%h' /etc/resume-ai/apt-policy.env)" = root:root:400:1 ] \
  || fail "root-owned APT/ESM policy evidence is missing or unsafe"
APT_ESM_MODE=
declare -A seen_apt_policy=()
while IFS='=' read -r apt_policy_key apt_policy_value || [ -n "$apt_policy_key" ]; do
  case "$apt_policy_key" in SCHEMA_VERSION|ESM_MODE) ;; *) fail "unknown APT policy key" ;; esac
  [ -z "${seen_apt_policy[$apt_policy_key]:-}" ] && [ -n "$apt_policy_value" ] \
    || fail "duplicate or empty APT policy value"
  seen_apt_policy[$apt_policy_key]=1
  case "$apt_policy_key" in
    SCHEMA_VERSION) [ "$apt_policy_value" = 1 ] || fail "unsupported APT policy schema" ;;
    ESM_MODE) APT_ESM_MODE=$apt_policy_value ;;
  esac
done < /etc/resume-ai/apt-policy.env
case "$APT_ESM_MODE" in
  disabled) apt_esm_arguments=() ;;
  enabled) apt_esm_arguments=(--enable-esm) ;;
  *) fail "APT ESM mode is not explicitly enabled or disabled" ;;
esac

apt-config dump | awk '
  /Unattended-Upgrade::Allowed-Origins/ && /security/ { security = 1 }
  /Unattended-Upgrade::Automatic-Reboot / && /"false"/ { no_reboot = 1 }
  /Unattended-Upgrade::Remove-Unused-Kernel-Packages / && /"false"/ { keep_kernels = 1 }
  /Unattended-Upgrade::Remove-New-Unused-Dependencies / && /"false"/ { keep_new_dependencies = 1 }
  /Unattended-Upgrade::Remove-Unused-Dependencies / && /"false"/ { keep_dependencies = 1 }
  END { exit security && no_reboot && keep_kernels && keep_new_dependencies && keep_dependencies ? 0 : 1 }
' || fail "unattended security updates are misconfigured"
held_system_packages="$(apt-mark showhold)" \
  || fail "APT hold state could not be inspected"
[ -z "$held_system_packages" ] \
  || fail "APT has unreviewed held packages: patch completeness cannot be established"
unset held_system_packages

for apt_control_directory in \
  /etc/apt/apt.conf.d \
  /etc/apt/auth.conf.d \
  /etc/apt/sources.list.d \
  /etc/apt/preferences.d \
  /etc/apt/trusted.gpg.d \
  /etc/apt/keyrings \
  /usr/share/keyrings; do
  [ -d "$apt_control_directory" ] && [ ! -L "$apt_control_directory" ] \
    && [ "$(stat -c '%U:%G:%a' "$apt_control_directory")" = root:root:755 ] \
    || fail "APT control directory is linked or has unsafe permissions: $apt_control_directory"
  while IFS= read -r -d '' apt_control_member; do
    [ -f "$apt_control_member" ] && [ ! -L "$apt_control_member" ] \
      && [ "$(stat -c '%U:%G:%h' "$apt_control_member")" = root:root:1 ] \
      && [ -z "$(find "$apt_control_member" -perm /022 -print -quit)" ] \
      || fail "APT control member is linked, special, or writable by an untrusted account: $apt_control_member"
  done < <(find "$apt_control_directory" -maxdepth 1 -mindepth 1 -print0)
done
for apt_single_control in \
  /etc/apt/apt.conf \
  /etc/apt/auth.conf \
  /etc/apt/preferences \
  /etc/apt/sources.list \
  /etc/apt/trusted.gpg; do
  if [ -e "$apt_single_control" ] || [ -L "$apt_single_control" ]; then
    [ -f "$apt_single_control" ] && [ ! -L "$apt_single_control" ] \
      && [ "$(stat -c '%U:%G:%h' "$apt_single_control")" = root:root:1 ] \
      && [ -z "$(find "$apt_single_control" -perm /022 -print -quit)" ] \
      || fail "APT control file is linked or writable by an untrusted account: $apt_single_control"
  fi
done
apt_effective_config="$(env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin apt-config dump)" \
  || fail "effective APT configuration could not be inspected"
printf '%s\n' "$apt_effective_config" > "$temp_dir/apt-effective.dump"
chmod 0600 "$temp_dir/apt-effective.dump"
/usr/local/lib/resume-ai/assert-apt-effective-config.sh \
  "$OPS_DIR/config/approved-apt-effective.conf" \
  "$temp_dir/apt-effective.dump" >/dev/null
unset apt_control_directory apt_control_member apt_single_control apt_effective_config

apt_source_files=()
if [ -e /etc/apt/sources.list ] || [ -L /etc/apt/sources.list ]; then
  apt_source_files+=(/etc/apt/sources.list)
fi
while IFS= read -r -d '' apt_source_file; do
  apt_source_files+=("$apt_source_file")
done < <(find /etc/apt/sources.list.d -maxdepth 1 \
  \( -name '*.list' -o -name '*.sources' \) -print0)
[ "${#apt_source_files[@]}" -gt 0 ] || fail "APT has no configured source files"
for apt_source_file in "${apt_source_files[@]}"; do
  [ -f "$apt_source_file" ] && [ ! -L "$apt_source_file" ] \
    && [ "$(stat -c '%U:%G:%h' "$apt_source_file")" = root:root:1 ] \
    && [ -z "$(find "$apt_source_file" -perm /022 -print -quit)" ] \
    || fail "APT source file is linked or writable by an untrusted account: $apt_source_file"
done
if grep -Eisq \
  '^[[:space:]]*deb(-src)?[[:space:]]+\[[^]]*((trusted|allow-insecure)[[:space:]]*=[[:space:]]*(yes|true|1))' \
  "${apt_source_files[@]}" \
  || grep -Eisq \
    '^[[:space:]]*(Trusted|Allow-Insecure)[[:space:]]*:[[:space:]]*(yes|true|1)([[:space:]]|$)' \
    "${apt_source_files[@]}"; then
  fail "APT source configuration permits an unauthenticated repository"
fi
if apt-config dump | grep -Eiq \
  'Acquire::(AllowUnauthenticated|AllowInsecureRepositories|AllowDowngradeToInsecureRepositories)[[:space:]]+"(true|yes|1)"'; then
  fail "APT globally permits unauthenticated or insecure repositories"
fi
unset apt_source_file apt_source_files

if ! env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin apt-get indextargets \
  --format '$(SITE)|$(RELEASE)|$(CODENAME)|$(COMPONENT)|$(ARCHITECTURE)|$(IDENTIFIER)|$(CREATED_BY)|$(FILENAME)|$(TRUSTED)' \
  > "$temp_dir/apt-indextargets.txt" 2> "$temp_dir/apt-indextargets.stderr"; then
  fail "active APT index targets could not be enumerated"
fi
[ ! -s "$temp_dir/apt-indextargets.stderr" ] \
  || fail "APT emitted warnings while enumerating active index targets"
chmod 0600 "$temp_dir/apt-indextargets.txt" "$temp_dir/apt-indextargets.stderr"
/usr/local/lib/resume-ai/assert-apt-active-sources.sh \
  "$OPS_DIR/config/approved-apt-sources.conf" \
  "$temp_dir/apt-indextargets.txt" "${apt_esm_arguments[@]}" >/dev/null \
  || fail "Jammy security/update package targets are not all active and authenticated"
root_python /usr/local/lib/resume-ai/assert-apt-trust-contract.py \
  --root / --templates "$OPS_DIR/apt" "${apt_esm_arguments[@]}" >/dev/null \
  || fail "APT sources, Signed-By keys, pins, and architectures differ from policy"
/usr/local/lib/resume-ai/assert-unattended-upgrades-runtime.sh \
  "$OPS_DIR" "$APT_ESM_MODE" >/dev/null \
  || fail "unattended-upgrades files or effective timers differ from policy"

assert_fresh_apt_metadata() {
  local metadata_file=$1 label=$2 now_epoch metadata_epoch metadata_age
  local signed_date signed_epoch signed_age valid_until valid_until_count valid_until_epoch
  now_epoch="$(date -u +%s)"
  [ -f "$metadata_file" ] && [ ! -L "$metadata_file" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$metadata_file")" = root:root:644:1 ] \
    || fail "$label APT metadata is missing, linked, or has unsafe permissions"
  metadata_epoch="$(stat -c '%Y' "$metadata_file")"
  [[ "$metadata_epoch" =~ ^[0-9]+$ ]] || fail "$label APT metadata timestamp is invalid"
  metadata_age=$((now_epoch - metadata_epoch))
  [ "$metadata_age" -ge 0 ] && [ "$metadata_age" -le 86400 ] \
    || fail "$label APT InRelease file was not refreshed successfully within 24 hours"

  [ "$(grep -c '^Date:' "$metadata_file" || true)" -eq 1 ] \
    || fail "$label signed APT metadata must contain exactly one Date field"
  signed_date="$(sed -n 's/^Date:[[:space:]]*//p' "$metadata_file")"
  signed_epoch="$(date -u -d "$signed_date" +%s 2>/dev/null)" \
    || fail "$label signed APT metadata Date is invalid"
  signed_age=$((now_epoch - signed_epoch))
  [ "$signed_age" -ge -300 ] && [ "$signed_age" -le 86400 ] \
    || fail "$label signed APT metadata Date is outside the accepted freshness window"

  valid_until_count="$(grep -c '^Valid-Until:' "$metadata_file" || true)"
  [ "$valid_until_count" -le 1 ] \
    || fail "$label signed APT metadata contains duplicate Valid-Until fields"
  if [ "$valid_until_count" -eq 1 ]; then
    valid_until="$(sed -n 's/^Valid-Until:[[:space:]]*//p' "$metadata_file")"
    valid_until_epoch="$(date -u -d "$valid_until" +%s 2>/dev/null)" \
      || fail "$label signed APT metadata Valid-Until is invalid"
    [ "$valid_until_epoch" -ge "$now_epoch" ] \
      || fail "$label signed APT metadata has expired"
  fi
}
assert_fresh_apt_metadata \
  /var/lib/apt/lists/mirrors.tencentyun.com_ubuntu_dists_jammy-security_InRelease \
  jammy-security
assert_fresh_apt_metadata \
  /var/lib/apt/lists/mirrors.tencentyun.com_ubuntu_dists_jammy-updates_InRelease \
  jammy-updates

apt_simulation="$(apt-get -s dist-upgrade)" \
  || fail "APT upgrade simulation failed; patch state cannot be verified"
if printf '%s\n' "$apt_simulation" \
  | awk '/^Inst / { pending = 1 } END { exit pending ? 0 : 1 }'; then
  fail "APT still has pending package upgrades"
fi
unset apt_simulation apt_esm_arguments APT_ESM_MODE seen_apt_policy
pass "APT security sources and patch level"

[ -f /etc/resume-ai/approved-postgres-runtime.conf ] \
  && [ ! -L /etc/resume-ai/approved-postgres-runtime.conf ] \
  && cmp -s "$OPS_DIR/config/approved-postgres-runtime.conf" \
    /etc/resume-ai/approved-postgres-runtime.conf \
  || fail "installed PostgreSQL security policy differs from the active release"
/usr/local/lib/resume-ai/assert-postgres-security-version.sh \
  "$OPS_DIR/config/approved-postgres-runtime.conf" >/dev/null \
  || fail "PostgreSQL is not the exact approved security revision"
pass "PostgreSQL 14.24 package and live-server security revision"

postgres_host_contract="$(runuser -u postgres -- env -i PATH=/usr/bin:/bin \
  PGHOST=/var/run/postgresql PGUSER=postgres psql --no-psqlrc --tuples-only --no-align \
  --field-separator=$'\t' --command="SELECT inet_server_addr() IS NULL,
    current_setting('data_directory'),(pg_control_system()).system_identifier::text,
    current_setting('data_checksums');")"
IFS=$'\t' read -r postgres_is_local postgres_data_dir postgres_system_id checksums <<< "$postgres_host_contract"
[ "$postgres_is_local" = t ] && [[ "$postgres_data_dir" =~ ^/var/lib/postgresql/[0-9]+/main$ ]] \
  && [[ "$postgres_system_id" =~ ^[0-9]{10,}$ ]] \
  || fail "PostgreSQL host verification reached an unapproved cluster"
[ "$checksums" = "on" ] || fail "PostgreSQL data checksums are disabled"
case "${ALLOW_COMPAT_DELETE:-0}" in 0|1) ;; *) fail "ALLOW_COMPAT_DELETE must be 0 or 1" ;; esac
database_permission_file=/opt/resume-ai/state/database-permissions.env
[ -f "$database_permission_file" ] && [ ! -L "$database_permission_file" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$database_permission_file")" = root:resume-ai:640:1 ] \
  || fail "database permission state is missing or unsafe"
declare -A database_permission_state=()
while IFS='=' read -r permission_key permission_value || [ -n "$permission_key" ]; do
  case "$permission_key" in SCHEMA_VERSION|ACTIVE_RELEASE|DELETE_MODE|CONTRACT_STATUS|MIGRATIONS_MANIFEST_SHA256|TABLE_POLICY_SHA256|FUNCTION_POLICY_SHA256|UPDATED_AT) ;; *) fail "unknown database permission state key" ;; esac
  [ -z "${database_permission_state[$permission_key]:-}" ] || fail "duplicate database permission state key"
  database_permission_state[$permission_key]=$permission_value
done < "$database_permission_file"
[ "${database_permission_state[SCHEMA_VERSION]:-}" = 1 ] \
  && [ "${database_permission_state[ACTIVE_RELEASE]:-}" = "$ACTIVE_RELEASE" ] \
  || fail "database permission state is not bound to the active release"
active_manifest="/opt/resume-ai/release-artifacts/$ACTIVE_RELEASE/release-manifest.json"
if [ "${database_permission_state[CONTRACT_STATUS]:-}" = bound ]; then
  [ -f "$active_manifest" ] && [ ! -L "$active_manifest" ] || fail "active release manifest is missing"
  readarray -t database_contract < <(root_node - "$active_manifest" <<'NODE'
const fs = require("node:fs");
const value = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const contract = value?.databaseContract;
if (contract?.schemaVersion !== 1 || contract?.runtimeRequiresDirectDelete !== false || contract?.functionOwnerRoleSuffix !== "_owner") process.exit(2);
for (const key of ["migrationsManifestSha256", "runtimeTablePolicySha256", "runtimeFunctionPolicySha256"]) {
  if (!/^[a-f0-9]{64}$/u.test(contract[key] ?? "")) process.exit(3);
  console.log(contract[key]);
}
NODE
) || fail "active release database contract is malformed"
  [ "${database_permission_state[MIGRATIONS_MANIFEST_SHA256]:-}" = "${database_contract[0]:-}" ] \
    && [ "${database_permission_state[TABLE_POLICY_SHA256]:-}" = "${database_contract[1]:-}" ] \
    && [ "${database_permission_state[FUNCTION_POLICY_SHA256]:-}" = "${database_contract[2]:-}" ] \
    && [ "$(sha256sum "$OPS_DIR/config/migrations.manifest" | awk '{print $1}')" = "${database_contract[0]:-}" ] \
    && [ "$(sha256sum "$OPS_DIR/postgresql/runtime-table-privileges.conf" | awk '{print $1}')" = "${database_contract[1]:-}" ] \
    && [ "$(sha256sum "$OPS_DIR/postgresql/runtime-function-privileges.conf" | awk '{print $1}')" = "${database_contract[2]:-}" ] \
    || fail "live database authorization files differ from the release manifest contract"
  for installed_policy in runtime-table-privileges.conf runtime-function-privileges.conf; do
    policy_path="/etc/resume-ai/$installed_policy"
    [ -f "$policy_path" ] && [ ! -L "$policy_path" ] \
      && [ "$(stat -c '%U:%G:%a:%h' "$policy_path")" = root:root:644:1 ] \
      || fail "installed database policy is writable or otherwise unsafe: $installed_policy"
  done
  [ "$(sha256sum /etc/resume-ai/runtime-table-privileges.conf | awk '{print $1}')" = "${database_contract[1]:-}" ] \
    && [ "$(sha256sum /etc/resume-ai/runtime-function-privileges.conf | awk '{print $1}')" = "${database_contract[2]:-}" ] \
    || fail "installed database policies differ from the active release contract"
elif [ "${ALLOW_COMPAT_DELETE:-0}" = 1 ] \
  && [ "${database_permission_state[CONTRACT_STATUS]:-}" = legacy-unbound ] \
  && [ "${database_permission_state[MIGRATIONS_MANIFEST_SHA256]:-}" = none ] \
  && [ "${database_permission_state[TABLE_POLICY_SHA256]:-}" = none ] \
  && [ "${database_permission_state[FUNCTION_POLICY_SHA256]:-}" = none ]; then
  if [ -e "$active_manifest" ]; then
    [ -f "$active_manifest" ] && [ ! -L "$active_manifest" ] \
      || fail "legacy release manifest path is unsafe"
    root_node - "$active_manifest" <<'NODE' \
      || fail "legacy-unbound compatibility is forbidden for a contract-aware release"
const fs = require("node:fs");
const value = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
process.exit(value?.databaseContract?.schemaVersion === 1 ? 2 : 0);
NODE
  fi
else
  fail "database permission state lacks an approved release contract"
fi
if [ "${ALLOW_COMPAT_DELETE:-0}" = 1 ]; then
  [ "${database_permission_state[DELETE_MODE]:-}" = legacy-delete ] \
    || fail "compatibility gate requested but database state is not legacy-delete"
  /usr/local/lib/resume-ai/provision-postgres-runtime-role.sh verify-compat >/dev/null
else
  [ "${database_permission_state[DELETE_MODE]:-}" = rpc-only ] \
    || fail "database state is not rpc-only"
  /usr/local/lib/resume-ai/provision-postgres-runtime-role.sh verify >/dev/null
fi
pass "database authorization and migration hashes are release-manifest bound"
/usr/local/lib/resume-ai/provision-postgres-maintenance-role.sh verify >/dev/null
cleanup_sql=/usr/local/share/resume-ai/security-state-cleanup.sql
[ -f "$cleanup_sql" ] && [ ! -L "$cleanup_sql" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$cleanup_sql")" = root:root:444:1 ] \
  || fail "root-installed security-state cleanup SQL is missing or unsafe"
cmp -s "$cleanup_sql" "$OPS_DIR/postgresql/cleanup-security-state.sql" \
  || fail "installed immutable cleanup SQL differs from the active reviewed source"
first_cleanup_statement="$(awk '/^[[:space:]]*(--|$|\\)/ { next } { print; exit }' "$cleanup_sql")"
[ "$first_cleanup_statement" = 'SET ROLE resume_ai_security_maintenance;' ] \
  || fail "maintenance SQL does not drop to the fixed NOLOGIN role first"
cleanup_env=/etc/resume-ai/security-state-cleanup.env
[ -f "$cleanup_env" ] && [ ! -L "$cleanup_env" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$cleanup_env")" = root:postgres:640:1 ] \
  || fail "security-state cleanup identity file is missing or unsafe"
database_identity="$(/usr/local/lib/resume-ai/read-postgres-runtime-identity.sh)"
database_name=${database_identity#*$'\t'}
[[ "$database_name" =~ ^[a-z_][a-z0-9_]{0,62}$ ]] \
  || fail "runtime database name is unsafe"
[ "$(wc -l < "$cleanup_env")" -eq 3 ] \
  && grep -Fxq "PGDATABASE=$database_name" "$cleanup_env" \
  && grep -Fxq 'PGHOST=/var/run/postgresql' "$cleanup_env" \
  && grep -Fxq 'PGUSER=postgres' "$cleanup_env" \
  || fail "security-state cleanup is not bound to the runtime database over local peer auth"
POSTGRES_RUNTIME_DATABASE=$database_name
unset database_identity database_name
systemctl is-enabled --quiet resume-ai-security-state-cleanup.timer \
  || fail "security-state cleanup timer is not enabled"
systemctl is-active --quiet resume-ai-security-state-cleanup.timer \
  || fail "security-state cleanup timer is not active"
cleanup_unit="$(systemctl cat resume-ai-security-state-cleanup.service)"
for expected_unit_line in \
  'User=postgres' \
  'RestrictAddressFamilies=AF_UNIX' \
  'EnvironmentFile=/etc/resume-ai/security-state-cleanup.env' \
  'ExecStart=/usr/local/lib/resume-ai/run-security-state-cleanup.sh' \
  'OnFailure=resume-ai-security-state-cleanup-alert.service'; do
  printf '%s\n' "$cleanup_unit" | grep -Fxq "$expected_unit_line" \
    || fail "security-state cleanup unit lacks: $expected_unit_line"
done
case "$cleanup_unit" in
  *'/opt/resume-ai/current'*|*'node_modules'*|*'/opt/nodejs/'*)
    fail "maintenance unit executes mutable application-release or Node code" ;;
esac
[ -f /usr/local/lib/resume-ai/run-security-state-cleanup.sh ] \
  && [ ! -L /usr/local/lib/resume-ai/run-security-state-cleanup.sh ] \
  && [ "$(stat -c '%U:%G:%a:%h' /usr/local/lib/resume-ai/run-security-state-cleanup.sh)" = root:root:755:1 ] \
  || fail "security-state cleanup runner is missing or mutable"
systemctl cat resume-ai-security-state-cleanup-alert.service \
  | grep -Fq 'ExecStart=/usr/bin/logger --priority daemon.crit --tag resume-ai-security-state-cleanup SECURITY_STATE_CLEANUP_FAILED' \
  || fail "security-state cleanup has no fixed critical failure event"
[ "$(systemctl show resume-ai-security-state-cleanup.service --property=Result --value)" = success ] \
  && [ "$(systemctl show resume-ai-security-state-cleanup.service --property=ExecMainStatus --value)" = 0 ] \
  || fail "the most recent security-state cleanup failed"
cleanup_finished="$(systemctl show resume-ai-security-state-cleanup.service --property=ExecMainExitTimestamp --value)"
[ -n "$cleanup_finished" ] && [ "$cleanup_finished" != n/a ] \
  || fail "security-state cleanup has never completed"
cleanup_age=$(( $(date +%s) - $(date -d "$cleanup_finished" +%s) ))
[ "$cleanup_age" -ge -300 ] && [ "$cleanup_age" -le 172800 ] \
  || fail "the latest security-state cleanup is stale or has an invalid timestamp"
pass "root-immutable daily cleanup drops to an exact NOLOGIN database role"
/usr/local/lib/resume-ai/assert-postgres-ops-runtime.sh "$OPS_DIR" full >/dev/null
pass "PostgreSQL checksums, current RPO and schema3 restore verification"

logrotate -d /etc/logrotate.d/resume-ai >/dev/null 2>&1 || fail "logrotate policy is invalid"
grep -Fq 'pm2 reloadLogs' /etc/logrotate.d/resume-ai || fail "logrotate does not ask PM2 to reopen logs"
pass "application log rotation"

root_node - "$ACTIVE_RELEASE" <<'NODE'
const fs = require("node:fs");
const root = `/opt/resume-ai/releases/${process.argv[2]}`;
const version = (name) => JSON.parse(fs.readFileSync(`${root}/node_modules/${name}/package.json`, "utf8")).version;
if (version("next") !== "15.5.24" || version("sharp") !== "0.35.3") process.exit(2);
for (const forbidden of ["playwright", "@playwright/test", "eslint", "typescript", "vitest"]) {
  if (fs.existsSync(`${root}/node_modules/${forbidden}`)) process.exit(3);
}
NODE
approval_file="/etc/resume-ai/approved-releases/$ACTIVE_RELEASE.env"
[ -f "$approval_file" ] && [ ! -L "$approval_file" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$approval_file")" = root:root:400:1 ] \
  || fail "active source approval is missing or unsafe"
artifact_dir="/opt/resume-ai/release-artifacts/$ACTIVE_RELEASE"
if [ "$PENDING_ACTIVE_VALIDATION" -eq 1 ]; then
  expected_artifact_contract=root:root:700
else
  expected_artifact_contract=root:root:550
fi
[ -d "$artifact_dir" ] && [ ! -L "$artifact_dir" ] \
  && [ "$(readlink -e -- "$artifact_dir")" = "$artifact_dir" ] \
  && [ "$(stat -c '%U:%G:%a' "$artifact_dir")" = "$expected_artifact_contract" ] \
  || fail "active artifact directory does not match its pending/final contract"
root_python - "$artifact_dir" "$PENDING_ACTIVE_VALIDATION" <<'PY'
import os
import pathlib
import re
import stat
import sys

root = pathlib.Path(sys.argv[1])
pending = sys.argv[2] == "1"
bundle = {
    "SHA256SUMS", "source.tar.gz", "source-manifest.txt", "working-tree.patch",
    "working-tree-status.txt", "untracked-source.tar.gz", "untracked-source-paths.txt",
    "validation.log", "e2e-evidence.tar.gz", "e2e-result.json",
    "security-scan-report.txt", "security-scan-result.json", "release-manifest.json",
    "baseline/competition-score-prospective-baseline.json",
}
production = {
    "production-validation.log", "extracted-source-manifest.txt",
    "pnpm-lock-policy.txt", "post-build-source-manifest.txt", "build-output-sha256.txt",
    "project-toolchain-pre-build.json", "project-toolchain-post-build.json",
    "post-preflight-source-manifest.txt", "post-preflight-build-output-sha256.txt",
    "production-dependencies.json", "production-dependencies-sha256.txt",
    "final-frozen-source-manifest.txt",
}
optional = {"deployment-complete.env"}
seen = set()
for directory, directories, files in os.walk(root, followlinks=False):
    for name in [*directories, *files]:
        path = pathlib.Path(directory, name)
        metadata = path.lstat()
        mode = metadata.st_mode
        if (stat.S_ISLNK(mode) or not (stat.S_ISDIR(mode) or stat.S_ISREG(mode))
                or metadata.st_uid != 0 or metadata.st_gid != 0):
            raise SystemExit(f"unsafe immutable artifact member: {path.relative_to(root)}")
        if stat.S_ISREG(mode) and metadata.st_nlink != 1:
            raise SystemExit(f"hard-linked immutable artifact member: {path.relative_to(root)}")
        forbidden_write = 0o022 if pending else 0o222
        if mode & forbidden_write:
            raise SystemExit(f"writable immutable artifact member: {path.relative_to(root)}")
    for name in files:
        seen.add((pathlib.Path(directory, name).relative_to(root)).as_posix())
if not bundle | production <= seen or seen - (bundle | production | optional):
    raise SystemExit("immutable artifact directory has a missing or unapproved member")
if pending and "deployment-complete.env" in seen:
    raise SystemExit("pending artifact must not claim deployment completion")

expected = bundle - {"SHA256SUMS"}
checksum_members = set()
for line in (root / "SHA256SUMS").read_text(encoding="utf-8").splitlines():
    match = re.fullmatch(r"[a-f0-9]{64}  ([A-Za-z0-9._/-]+)", line)
    if not match or match.group(1) in checksum_members:
        raise SystemExit("SHA256SUMS has an unsafe or duplicate member")
    checksum_members.add(match.group(1))
if checksum_members != expected:
    raise SystemExit("SHA256SUMS does not cover the exact immutable bundle set")
PY
(cd "$artifact_dir" && sha256sum --strict -c SHA256SUMS >/dev/null) \
  || fail "active immutable bundle checksum validation failed"
# Runtime hashes below deliberately cover generated output.  Independently
# re-read every approved source member with the installed no-follow verifier so
# an operator, stale service UID, or partial rollback cannot change source and
# then hide behind unchanged .next/node_modules provenance.
root_python /usr/local/lib/resume-ai/verify-release-source-tree.py \
  --source "$ACTIVE_ROOT" --manifest "$artifact_dir/source-manifest.txt" \
  > "$temp_dir/active-source-manifest.txt" \
  || fail "active source tree could not be verified against its approved manifest"
cmp -s "$temp_dir/active-source-manifest.txt" "$artifact_dir/source-manifest.txt" \
  || fail "active source tree differs from its approved manifest"
root_python - "$artifact_dir/project-toolchain-pre-build.json" \
  "$artifact_dir/project-toolchain-post-build.json" \
  "$artifact_dir/source-manifest.txt" \
  /usr/local/lib/resume-ai/release-required-tests.json \
  /usr/local/lib/resume-ai/run-release-evidence.mjs <<'PY'
import datetime
import hashlib
import json
import pathlib
import re
import sys

HEX = re.compile(r"[a-f0-9]{64}")
RECEIPT_KEYS = {
    "schemaVersion", "evidenceType", "status", "createdAt",
    "sourceManifestSha256", "policy", "coordinator", "inputs",
    "runtime", "observedTools",
}
TOOL_KEYS = {
    "id", "packageName", "packagePath", "packageRealPath", "version",
    "packageJsonSha256", "binName", "binTarget", "binRelativePath", "binSha256",
}

def reject_duplicates(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON key: {key}")
        result[key] = value
    return result

def load_json(path):
    return json.loads(
        pathlib.Path(path).read_text(encoding="utf-8"),
        object_pairs_hook=reject_duplicates,
    )

def sha(path):
    state = hashlib.sha256()
    with pathlib.Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            state.update(chunk)
    return state.hexdigest()

def canonical(value):
    if isinstance(value, dict):
        return "{" + ",".join(
            json.dumps(key, ensure_ascii=False, separators=(",", ":"))
            + ":" + canonical(value[key])
            for key in sorted(value)
        ) + "}"
    if isinstance(value, list):
        return "[" + ",".join(canonical(child) for child in value) + "]"
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))

manifest_bytes = pathlib.Path(sys.argv[3]).read_bytes()
manifest_sha = hashlib.sha256(manifest_bytes).hexdigest()
manifest = {}
previous = None
for line in manifest_bytes.decode("utf-8").splitlines():
    match = re.fullmatch(r"([a-f0-9]{64})\t([FL])\t([^\t\r\n]+)", line)
    if match is None or match.group(3) in manifest:
        raise SystemExit("active source manifest is malformed or duplicate")
    encoded = match.group(3).encode("utf-8")
    if previous is not None and encoded <= previous:
        raise SystemExit("active source manifest is not bytewise sorted")
    previous = encoded
    manifest[match.group(3)] = (match.group(1), match.group(2))

policy_path = pathlib.Path(sys.argv[4])
coordinator_path = pathlib.Path(sys.argv[5])
policy_sha = sha(policy_path)
coordinator_sha = sha(coordinator_path)
if manifest.get("ops/config/release-required-tests.json") != (policy_sha, "F"):
    raise SystemExit("installed project-toolchain policy differs from active source")
if manifest.get("scripts/run-release-evidence.mjs") != (coordinator_sha, "F"):
    raise SystemExit("installed project-toolchain coordinator differs from active source")

policy_document = load_json(policy_path)
project_policy = policy_document.get("projectToolchain") if isinstance(policy_document, dict) else None
if not isinstance(project_policy, dict) or project_policy.get("schemaVersion") != 1 \
        or project_policy.get("policyId") != "resume-ai-project-toolchain.v1":
    raise SystemExit("installed project-toolchain policy identity is invalid")
project_policy_sha = hashlib.sha256(canonical(project_policy).encode("utf-8")).hexdigest()
expected_inputs = project_policy.get("inputs")
expected_tools = project_policy.get("tools")
expected_runtime = project_policy.get("runtime")
if not isinstance(expected_inputs, list) or not isinstance(expected_tools, list) \
        or not isinstance(expected_runtime, dict):
    raise SystemExit("installed project-toolchain policy shape is invalid")

def load_receipt(path):
    value = load_json(path)
    if not isinstance(value, dict) or set(value) != RECEIPT_KEYS:
        raise SystemExit("project-toolchain receipt has an unexpected schema")
    if value.get("schemaVersion") != 1 \
            or value.get("evidenceType") != "release-project-toolchain-verification" \
            or value.get("status") != "passed" \
            or value.get("sourceManifestSha256") != manifest_sha:
        raise SystemExit("project-toolchain receipt does not prove this active source")
    timestamp = value.get("createdAt")
    if not isinstance(timestamp, str) or re.fullmatch(
        r"20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z", timestamp
    ) is None:
        raise SystemExit("project-toolchain receipt timestamp is invalid")
    created = datetime.datetime.strptime(timestamp, "%Y-%m-%dT%H:%M:%SZ")
    expected_policy_receipt = {
        "installedPath": "/usr/local/lib/resume-ai/release-required-tests.json",
        "sourceMember": "ops/config/release-required-tests.json",
        "artifactSha256": policy_sha,
        "jsonPointer": "/projectToolchain",
        "policyId": "resume-ai-project-toolchain.v1",
        "sha256": project_policy_sha,
    }
    if value.get("policy") != expected_policy_receipt \
            or value.get("coordinator") != {
                "path": "/usr/local/lib/resume-ai/run-release-evidence.mjs",
                "sha256": coordinator_sha,
            } \
            or value.get("inputs") != expected_inputs:
        raise SystemExit("project-toolchain receipt is not bound to installed controls")
    runtime = value.get("runtime")
    if not isinstance(runtime, dict) or set(runtime) != {"node", "pnpm"}:
        raise SystemExit("project-toolchain receipt runtime is malformed")
    expected_runtime_receipt = {
        "node": {
            "path": expected_runtime.get("node", {}).get("executable"),
            "version": expected_runtime.get("node", {}).get("version"),
            "sha256": sha(expected_runtime.get("node", {}).get("executable", "")),
        },
        "pnpm": {
            "path": expected_runtime.get("pnpm", {}).get("entrypoint"),
            "version": expected_runtime.get("pnpm", {}).get("version"),
            "sha256": sha(expected_runtime.get("pnpm", {}).get("entrypoint", "")),
        },
    }
    if runtime != expected_runtime_receipt:
        raise SystemExit("project-toolchain receipt runtime changed")
    observed = value.get("observedTools")
    if not isinstance(observed, list) or len(observed) != len(expected_tools):
        raise SystemExit("project-toolchain receipt tool count differs from policy")
    for expected, actual in zip(expected_tools, observed):
        if not isinstance(actual, dict) or set(actual) != TOOL_KEYS:
            raise SystemExit("project-toolchain receipt tool schema is invalid")
        for key in ["id", "packageName", "packagePath", "version", "binName", "binTarget"]:
            if actual.get(key) != expected.get(key):
                raise SystemExit("project-toolchain receipt tool identity differs from policy")
        for key in ["packageJsonSha256", "binSha256"]:
            if not isinstance(actual.get(key), str) or HEX.fullmatch(actual[key]) is None:
                raise SystemExit("project-toolchain receipt tool digest is malformed")
        for key in ["packageRealPath", "binRelativePath"]:
            path_value = actual.get(key)
            if not isinstance(path_value, str) or not path_value \
                    or path_value.startswith("/") or ".." in pathlib.PurePosixPath(path_value).parts:
                raise SystemExit("project-toolchain receipt contains an unsafe observed path")
    normalized = dict(value)
    del normalized["createdAt"]
    return created, normalized

before_time, before = load_receipt(sys.argv[1])
after_time, after = load_receipt(sys.argv[2])
if after_time < before_time or after != before:
    raise SystemExit("project-toolchain identity changed across the candidate build")
PY
read -r expected_asset_tree_sha < "$artifact_dir/build-output-sha256.txt"
read -r expected_dependency_tree_sha < "$artifact_dir/production-dependencies-sha256.txt"
[[ "$expected_asset_tree_sha" =~ ^[a-f0-9]{64}$ ]] \
  && [[ "$expected_dependency_tree_sha" =~ ^[a-f0-9]{64}$ ]] \
  || fail "active runtime output digests are malformed"
active_runtime_gid="$(id -g resume-ai)"
[[ "$active_runtime_gid" =~ ^[1-9][0-9]*$ ]] \
  || fail "active runtime group identity is invalid"
active_runtime_cache="/var/cache/resume-ai/$ACTIVE_RELEASE"
active_runtime_cache_link="$ACTIVE_ROOT/.next/cache"
[ -d "$ACTIVE_ROOT/.next" ] && [ ! -L "$ACTIVE_ROOT/.next" ] \
  && [ "$(stat -c '%U:%G:%a' "$ACTIVE_ROOT/.next")" = root:resume-ai:750 ] \
  || fail "active .next parent is not an immutable runtime directory"
[ -L "$active_runtime_cache_link" ] \
  && [ "$(stat -c '%U:%G:%h' "$active_runtime_cache_link")" = root:resume-ai:1 ] \
  && [ "$(readlink -- "$active_runtime_cache_link")" = "$active_runtime_cache" ] \
  && [ "$(readlink -e -- "$active_runtime_cache_link")" = "$active_runtime_cache" ] \
  || fail "active Next cache link does not name the dedicated release cache"
[ -d "$active_runtime_cache" ] && [ ! -L "$active_runtime_cache" ] \
  && [ "$(readlink -e -- "$active_runtime_cache")" = "$active_runtime_cache" ] \
  && [ "$(stat -c '%U:%G:%a' "$active_runtime_cache")" = resume-ai:resume-ai:750 ] \
  || fail "active release cache target is linked, misplaced, or has unsafe ownership"
observed_asset_tree_sha="$(root_python /usr/local/lib/resume-ai/hash-runtime-tree.py \
  --root "$ACTIVE_ROOT/.next" --exclude-relative cache \
  --expected-uid 0 --expected-gid "$active_runtime_gid" \
  --forbid-group-other-write)" \
  || fail "active runtime asset tree could not be validated"
observed_dependency_tree_sha="$(root_python /usr/local/lib/resume-ai/hash-runtime-tree.py \
  --root "$ACTIVE_ROOT/node_modules" \
  --expected-uid 0 --expected-gid "$active_runtime_gid" \
  --forbid-group-other-write)" \
  || fail "active production dependency tree could not be validated"
[ "$observed_asset_tree_sha" = "$expected_asset_tree_sha" ] \
  && [ "$observed_dependency_tree_sha" = "$expected_dependency_tree_sha" ] \
  || fail "active runtime output differs from the release-time content provenance"
root_python - "$approval_file" "$artifact_dir" "$ACTIVE_RELEASE" \
  "$OPS_DIR/config/control-plane-files.conf" \
  "/usr/local/lib/resume-ai/verify-release-evidence.mjs" \
  /usr/local/lib/resume-ai/release-required-tests.json "$SWITCHED_AT" <<'PY'
import datetime
import hashlib
import json
import pathlib
import re
import sys

approval_path = pathlib.Path(sys.argv[1])
root = pathlib.Path(sys.argv[2])
release_id = sys.argv[3]
control_spec = pathlib.Path(sys.argv[4])
evidence_helper = pathlib.Path(sys.argv[5])
required_test_policy = pathlib.Path(sys.argv[6])
switched_at_raw = sys.argv[7]
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
for line in approval_path.read_text(encoding="utf-8").splitlines():
    if "=" not in line:
        raise SystemExit("invalid root release approval")
    key, value = line.split("=", 1)
    if key not in allowed or key in values:
        raise SystemExit("unknown or duplicate root release approval key")
    values[key] = value
if set(values) != allowed or values["SCHEMA_VERSION"] != "6" or values["RELEASE_ID"] != release_id:
    raise SystemExit("root release approval identity mismatch")
for pin in ("TRUSTED_DEEP_SCAN_ATTESTATION_SHA256", "TRUSTED_DEEP_SCAN_PRODUCER_SHA256", "TRUSTED_DEEP_SCAN_COMPLETION_SHA256", "LINUX_VALIDATION_ATTESTATION_SHA256", "REQUIRED_TEST_POLICY_SHA256"):
    if re.fullmatch(r"[a-f0-9]{64}", values[pin]) is None:
        raise SystemExit(f"root release approval pin is malformed: {pin}")

timestamp_pattern = re.compile(r"20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z")
def instant(value, label):
    if not isinstance(value, str) or timestamp_pattern.fullmatch(value) is None:
        raise SystemExit(f"{label} is not strict UTC ISO seconds")
    try:
        parsed = datetime.datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(
            tzinfo=datetime.timezone.utc
        )
    except ValueError:
        raise SystemExit(f"{label} is not a real UTC timestamp")
    if parsed.strftime("%Y-%m-%dT%H:%M:%SZ") != value:
        raise SystemExit(f"{label} is not canonical UTC ISO seconds")
    return parsed

def reject_duplicates(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result

try:
    release_manifest = json.loads(
        (root / "release-manifest.json").read_text(encoding="utf-8"),
        object_pairs_hook=reject_duplicates,
    )
except (OSError, UnicodeError, json.JSONDecodeError, ValueError) as error:
    raise SystemExit(f"active release manifest is not strict JSON: {error}")
if not isinstance(release_manifest, dict) or release_manifest.get("releaseId") != release_id:
    raise SystemExit("active release manifest identity mismatch during freshness verification")
linux_binding = release_manifest.get("linuxValidationAttestation")
if (
    not isinstance(linux_binding, dict)
    or set(linux_binding) != {"evidenceMember", "artifactManifestMember", "sha256"}
    or linux_binding.get("evidenceMember") != "linux-validation-attestation.json"
    or linux_binding.get("artifactManifestMember") != "linux-validation-artifact-manifest.txt"
    or linux_binding.get("sha256") != values["LINUX_VALIDATION_ATTESTATION_SHA256"]
):
    raise SystemExit("active release Linux validation binding differs from root approval")
created_at = instant(release_manifest.get("createdAt"), "release manifest createdAt")
approved_at = instant(values["APPROVED_AT"], "root approval APPROVED_AT")
switched_at = instant(switched_at_raw, "active release SWITCHED_AT")
if created_at > approved_at:
    raise SystemExit("root approval predates release bundle creation")
if approved_at > switched_at:
    raise SystemExit("active release switch predates its root approval")
if (switched_at - approved_at).total_seconds() > 24 * 60 * 60:
    raise SystemExit("active release was first switched more than 24 hours after approval")
for key, member in (
    ("RELEASE_MANIFEST_SHA256", "release-manifest.json"),
    ("SOURCE_MANIFEST_SHA256", "source-manifest.txt"),
    ("SHA256SUMS_SHA256", "SHA256SUMS"),
):
    observed = hashlib.sha256((root / member).read_bytes()).hexdigest()
    if not re.fullmatch(r"[a-f0-9]{64}", values[key]) or values[key] != observed:
        raise SystemExit(f"root release approval hash mismatch: {member}")
for key, path in (
    ("CONTROL_PLANE_SPEC_SHA256", control_spec),
    ("EVIDENCE_HELPER_SHA256", evidence_helper),
    ("REQUIRED_TEST_POLICY_SHA256", required_test_policy),
):
    observed = hashlib.sha256(path.read_bytes()).hexdigest()
    if not re.fullmatch(r"[a-f0-9]{64}", values[key]) or values[key] != observed:
        raise SystemExit(f"root release approval control hash mismatch: {path.name}")
PY
for security_artifact in security-scan-report.txt security-scan-result.json e2e-result.json e2e-evidence.tar.gz; do
  [ -s "$artifact_dir/$security_artifact" ] && [ ! -L "$artifact_dir/$security_artifact" ] \
    || fail "active release evidence is missing: $security_artifact"
done
root_node - "$artifact_dir/release-manifest.json" \
  "$artifact_dir/security-scan-result.json" "$artifact_dir/security-scan-report.txt" \
  "$artifact_dir/source-manifest.txt" "$artifact_dir/source.tar.gz" \
  "$artifact_dir/baseline/competition-score-prospective-baseline.json" \
  "$artifact_dir/e2e-result.json" <<'NODE'
const crypto = require("node:crypto");
const fs = require("node:fs");
const [manifestPath, resultPath, reportPath, sourcePath, archivePath, baselinePath, e2ePath] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
const e2e = JSON.parse(fs.readFileSync(e2ePath, "utf8"));
const hash = (path) => crypto.createHash("sha256").update(fs.readFileSync(path)).digest("hex");
const canonicalJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
  return JSON.stringify(value);
};
if (manifest?.securityScanReport !== "security-scan-report.txt" || manifest?.securityScanResult !== "security-scan-result.json") process.exit(2);
if (manifest?.securityScanReportSha256 !== hash(reportPath) || manifest?.sourceManifestSha256 !== hash(sourcePath)) process.exit(3);
if (manifest?.sourceSha256 !== hash(archivePath)) process.exit(7);
const {artifactSha256, ...baselineWithoutHash} = baseline;
if (artifactSha256 !== crypto.createHash("sha256").update(canonicalJson(baselineWithoutHash)).digest("hex")) process.exit(8);
const boundary = manifest?.prospectiveBaseline;
if (boundary?.bundlePath !== "baseline/competition-score-prospective-baseline.json"
  || boundary?.installPath !== "tests/fixtures/competition-score-prospective-baseline.json"
  || boundary?.outerIntegrityBoundary !== "release-manifest.json"
  || boundary?.byteSha256 !== hash(baselinePath)
  || boundary?.artifactSha256 !== artifactSha256
  || !["bootstrap", "carry-forward"].includes(boundary?.mode)
  || !/^20\d{6}T\d{6}Z$/u.test(boundary?.originReleaseId ?? "")
  || !/^[a-f0-9]{64}$/u.test(boundary?.originSourceArchiveSha256 ?? "")) process.exit(9);
if (baseline?.provenance?.sourceArchiveSha256 !== boundary.originSourceArchiveSha256
  || baseline?.provenance?.releaseId !== boundary.originReleaseId) process.exit(11);
if (boundary.mode === "bootstrap"
  && (boundary.originReleaseId !== manifest.releaseId
    || boundary.originSourceArchiveSha256 !== manifest.sourceSha256)) process.exit(12);
if (boundary.mode === "carry-forward"
  && (manifest?.rollbackRelease === "none"
    || boundary.originReleaseId === manifest.releaseId)) process.exit(13);
if (manifest?.playwrightReportSha256 !== e2e?.playwrightReportSha256 || e2e?.sourceManifestSha256 !== manifest.sourceManifestSha256 || e2e?.status !== "passed") process.exit(10);
if (result?.schemaVersion !== 1 || result?.scanType !== "codex-security-deep-scan" || result?.status !== "passed") process.exit(4);
if (result?.sourceManifestSha256 !== manifest.sourceManifestSha256 || result?.reportSha256 !== manifest.securityScanReportSha256) process.exit(5);
if (result?.validatedOpenFindings !== 0 || result?.untriagedFindings !== 0) process.exit(6);
NODE
root_python - /opt/resume-ai/release-artifacts "$ACTIVE_RELEASE" "$PREVIOUS_RELEASE" \
  "$PENDING_ACTIVE_VALIDATION" <<'PY'
import datetime
import hashlib
import json
import pathlib
import re
import stat
import sys

artifact_root = pathlib.Path(sys.argv[1])
active = sys.argv[2]
previous = sys.argv[3]
pending = sys.argv[4] == "1"

def manifest(release: str):
    if release == "none":
        return None
    path = artifact_root / release / "release-manifest.json"
    if not path.exists():
        return None
    metadata = path.lstat()
    if not stat.S_ISREG(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode):
        raise SystemExit("release manifest path is unsafe")
    value = json.loads(path.read_text(encoding="utf-8"))
    if value.get("releaseId") != release:
        raise SystemExit("release manifest identity mismatch")
    return value

def marker(release: str, rollback: str) -> None:
    directory = artifact_root / release
    manifest_path = directory / "release-manifest.json"
    marker_path = directory / "deployment-complete.env"
    metadata = marker_path.lstat()
    if (not stat.S_ISREG(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode)
            or metadata.st_uid != 0 or metadata.st_gid != 0
            or metadata.st_nlink != 1 or stat.S_IMODE(metadata.st_mode) != 0o400):
        raise SystemExit("deployment completion marker is unsafe")
    values = {}
    for line in marker_path.read_text(encoding="utf-8").splitlines():
        if "=" not in line:
            raise SystemExit("deployment completion marker row is malformed")
        key, value = line.split("=", 1)
        if key not in {"SCHEMA_VERSION", "RELEASE_ID", "COMPLETED_AT", "RELEASE_MANIFEST_SHA256", "ROLLBACK_RELEASE", "APPROVAL_FILE_SHA256"} or key in values:
            raise SystemExit("deployment completion marker has an unknown or duplicate key")
        values[key] = value
    if (set(values) != {"SCHEMA_VERSION", "RELEASE_ID", "COMPLETED_AT", "RELEASE_MANIFEST_SHA256", "ROLLBACK_RELEASE", "APPROVAL_FILE_SHA256"}
            or values["SCHEMA_VERSION"] != "2" or values["RELEASE_ID"] != release
            or values["ROLLBACK_RELEASE"] != rollback
            or not re.fullmatch(r"[a-f0-9]{64}", values["RELEASE_MANIFEST_SHA256"])
            or not re.fullmatch(r"[a-f0-9]{64}", values["APPROVAL_FILE_SHA256"])):
        raise SystemExit("deployment completion marker identity is inconsistent")
    try:
        completed = datetime.datetime.strptime(values["COMPLETED_AT"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=datetime.timezone.utc)
    except ValueError:
        raise SystemExit("deployment completion timestamp is invalid")
    if completed > datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=5):
        raise SystemExit("deployment completion timestamp is in the future")
    observed = hashlib.sha256(manifest_path.read_bytes()).hexdigest()
    if values["RELEASE_MANIFEST_SHA256"] != observed:
        raise SystemExit("deployment completion marker is not bound to its manifest")
    approval_path = pathlib.Path(f"/etc/resume-ai/approved-releases/{release}.env")
    approval_metadata = approval_path.lstat()
    if (not stat.S_ISREG(approval_metadata.st_mode) or stat.S_ISLNK(approval_metadata.st_mode)
            or approval_metadata.st_uid != 0 or approval_metadata.st_gid != 0
            or approval_metadata.st_nlink != 1 or stat.S_IMODE(approval_metadata.st_mode) != 0o400
            or values["APPROVAL_FILE_SHA256"] != hashlib.sha256(approval_path.read_bytes()).hexdigest()):
        raise SystemExit("deployment completion marker is not bound to its immutable root approval")

active_manifest = manifest(active)
previous_manifest = manifest(previous)
if previous == "none":
    if active_manifest is not None and active_manifest.get("rollbackRelease") != "none":
        raise SystemExit("initialized release has a non-empty rollback target")
elif active_manifest is not None and active_manifest.get("rollbackRelease") == previous:
    if not pending:
        marker(active, previous)
elif previous_manifest is not None and previous_manifest.get("rollbackRelease") == active:
    marker(previous, active)
else:
    raise SystemExit("active/previous topology is not bound to a reviewed deployment or rollback record")
PY
pass "active/previous topology and rollback target are manifest-bound"
pass "patched dependencies plus source/E2E/Deep-Scan provenance"

if [ "${RUN_CERTBOT_DRY_RUN:-1}" = "1" ]; then
  certbot renew --dry-run --no-random-sleep-on-renew >/dev/null \
    || fail "Certbot renewal dry run failed"
  pass "Certbot renewal"
fi

[ "$(sha256sum "$STATE_FILE" | awk '{print $1}')" = "$HOST_STATE_START_SHA256" ] \
  && [ "$(readlink -e /opt/resume-ai/current)" = "$ACTIVE_ROOT" ] \
  && [ "$(stat -c '%d:%i:%Y:%Z' "$ACTIVE_ROOT")" = "$ACTIVE_ROOT_START_ID" ] \
  && [ "$(sha256sum "$approval_file" | awk '{print $1}')" = "$ACTIVE_APPROVAL_SHA256" ] \
  || fail "active release generation changed during host verification"
CONTROL_GENERATION_END="$(root_python "$CONTROL_VERIFIER" --mode installed \
  --source-root "$ACTIVE_ROOT" --source-manifest "$CONTROL_SOURCE_MANIFEST" \
  --spec "$CONTROL_SPEC" --candidate-spec "$CONTROL_CANDIDATE_SPEC" \
  --installed-manifest /etc/resume-ai/control-plane-generation.env)" \
  || fail "installed control plane changed during host verification"
[ "$CONTROL_GENERATION_END" = "$CONTROL_GENERATION" ] \
  || fail "control-plane generation changed during the host gate"
if [ "$CONTROL_PENDING_START_SHA256" != none ]; then
  [ -f "$control_pending" ] && [ ! -L "$control_pending" ] \
    && [ "$(sha256sum "$control_pending" | awk '{print $1}')" = "$CONTROL_PENDING_START_SHA256" ] \
    || fail "control-plane rollback receipt changed during the host gate"
else
  [ ! -e "$control_pending" ] && [ ! -L "$control_pending" ] \
    || fail "a control-plane rollback receipt appeared during the host gate"
fi
[ "$(sha256sum /etc/resume-ai/release-evidence-signing.key | awk '{print $1}')" = "$EVIDENCE_SIGNING_PRIVATE_SHA256" ] \
  && [ "$(sha256sum /etc/resume-ai/release-evidence-signing.pub | awk '{print $1}')" = "$EVIDENCE_SIGNING_PUBLIC_SHA256" ] \
  && [ "$(sha256sum /etc/resume-ai/release-evidence-signing.env | awk '{print $1}')" = "$EVIDENCE_SIGNING_MARKER_SHA256" ] \
  && [ "$(stat -c '%U:%G:%a' /var/lib/resume-ai/release-evidence-generations)" = root:root:700 ] \
  || fail "Linux validation trust anchor or generation store changed during the host gate"
unset HOST_STATE_START_SHA256 ACTIVE_ROOT_START_ID CONTROL_SOURCE_MANIFEST \
  CONTROL_SPEC CONTROL_CANDIDATE_SPEC CONTROL_VERIFIER CONTROL_GENERATION \
  CONTROL_GENERATION_END CONTROL_PENDING_START_SHA256 control_pending control_anchor \
  ACTIVE_APPROVAL_SHA256 TRUSTED_DEEP_SCAN_ATTESTATION_SHA256 \
  TRUSTED_DEEP_SCAN_PRODUCER_SHA256 TRUSTED_DEEP_SCAN_COMPLETION_SHA256 \
  LINUX_VALIDATION_ATTESTATION_SHA256 REQUIRED_TEST_POLICY_SHA256 \
  EVIDENCE_SIGNING_PRIVATE_SHA256 EVIDENCE_SIGNING_PUBLIC_SHA256 \
  EVIDENCE_SIGNING_MARKER_SHA256
pass "fixed physical release remained stable for the complete host gate"

printf '%s\n' "All host-level production gates passed for $ACTIVE_RELEASE."
