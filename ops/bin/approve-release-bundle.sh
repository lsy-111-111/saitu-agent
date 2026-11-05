#!/usr/bin/env bash
set -Eeuo pipefail
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

fail() {
  printf '%s\n' "ERROR: $*" >&2
  exit 1
}

[ "${EUID:-$(id -u)}" -eq 0 ] || fail "run as root"
[ "${ACK_APPROVE_RELEASE_BUNDLE:-}" = YES ] \
  || fail "set ACK_APPROVE_RELEASE_BUNDLE=YES only after source/E2E review"
[ "${TRUSTED_DEEP_SCAN_ATTESTATION_SHA256:-}" != "" ] \
  && [[ "$TRUSTED_DEEP_SCAN_ATTESTATION_SHA256" =~ ^[a-f0-9]{64}$ ]] \
  || fail "set the exact root-helper TRUSTED_DEEP_SCAN_ATTESTATION_SHA256 after independent review"
[ "${TRUSTED_DEEP_SCAN_PRODUCER_SHA256:-}" != "" ] \
  && [[ "$TRUSTED_DEEP_SCAN_PRODUCER_SHA256" =~ ^[a-f0-9]{64}$ ]] \
  || fail "set the exact installed-helper TRUSTED_DEEP_SCAN_PRODUCER_SHA256 after independent review"
[ "${TRUSTED_DEEP_SCAN_COMPLETION_SHA256:-}" != "" ] \
  && [[ "$TRUSTED_DEEP_SCAN_COMPLETION_SHA256" =~ ^[a-f0-9]{64}$ ]] \
  || fail "set the exact sealed-manifest TRUSTED_DEEP_SCAN_COMPLETION_SHA256 after the one formal scan"
[ "${TRUSTED_REQUIRED_TEST_POLICY_SHA256:-}" != "" ] \
  && [[ "$TRUSTED_REQUIRED_TEST_POLICY_SHA256" =~ ^[a-f0-9]{64}$ ]] \
  || fail "set the independently reviewed TRUSTED_REQUIRED_TEST_POLICY_SHA256"
[ "$#" -eq 2 ] || fail "usage: approve-release-bundle.sh BUNDLE_DIR REVIEWED_SOURCE_MANIFEST"
[ -f /usr/local/lib/resume-ai/open-root-lock.sh ] \
  && [ ! -L /usr/local/lib/resume-ai/open-root-lock.sh ] \
  && [ "$(stat -c '%U:%G:%a:%h' /usr/local/lib/resume-ai/open-root-lock.sh)" = root:root:755:1 ] \
  || fail "installed root lock helper is missing or unsafe"
. /usr/local/lib/resume-ai/open-root-lock.sh
open_root_lock 9 deploy
BUNDLE_DIR=$1
REVIEWED_MANIFEST=$2
case "$BUNDLE_DIR:$REVIEWED_MANIFEST" in /*:/*) ;; *) fail "paths must be absolute" ;; esac
[ -d "$BUNDLE_DIR" ] && [ ! -L "$BUNDLE_DIR" ] || fail "release bundle must be an ordinary directory"
[ -f "$REVIEWED_MANIFEST" ] && [ ! -L "$REVIEWED_MANIFEST" ] \
  && [ "$(stat -c '%h' "$REVIEWED_MANIFEST")" = 1 ] \
  || fail "reviewed source manifest is missing, linked, or unsafe"
cd /

# Freeze every caller-owned byte once into a private root snapshot. All
# approval parsing, comparisons and hashes below use only this generation.
SNAPSHOT_PARENT=/opt/resume-ai/approval-staging
/usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin /usr/bin/python3 -I - \
  "$SNAPSHOT_PARENT" <<'PY'
import pathlib
import stat
import sys

target = pathlib.Path(sys.argv[1])
if str(target) != "/opt/resume-ai/approval-staging":
    raise SystemExit("approval staging path is not fixed")
for ancestor in reversed((target, *target.parents[:-1])):
    metadata = ancestor.lstat()
    if not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != 0 or metadata.st_gid != 0 or metadata.st_mode & 0o022:
        raise SystemExit(f"unsafe approval staging ancestor: {ancestor}")
metadata = target.lstat()
if stat.S_IMODE(metadata.st_mode) != 0o700:
    raise SystemExit("approval staging root must be mode 0700")
PY
SNAPSHOT_DIR="$(mktemp -d "$SNAPSHOT_PARENT/approval.XXXXXX")"
cleanup_snapshot() {
  local status=$?
  trap - EXIT
  if [[ "$SNAPSHOT_DIR" == /opt/resume-ai/approval-staging/approval.* ]] \
    && [ -d "$SNAPSHOT_DIR" ] && [ ! -L "$SNAPSHOT_DIR" ]; then
    find "$SNAPSHOT_DIR" -xdev -depth -delete >/dev/null 2>&1 || true
  fi
  exit "$status"
}
trap cleanup_snapshot EXIT
SNAPSHOT_HELPER=/usr/local/lib/resume-ai/snapshot-release-bundle.py
[ -f "$SNAPSHOT_HELPER" ] && [ ! -L "$SNAPSHOT_HELPER" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$SNAPSHOT_HELPER")" = root:root:755:1 ] \
  || fail "installed root-owned release snapshot helper is missing or unsafe"
/usr/bin/python3 -I "$SNAPSHOT_HELPER" \
  "$BUNDLE_DIR" "$SNAPSHOT_DIR" "$REVIEWED_MANIFEST"
chown -R root:root "$SNAPSHOT_DIR"
BUNDLE_DIR="$SNAPSHOT_DIR/bundle"
REVIEWED_MANIFEST="$SNAPSHOT_DIR/reviewed-source-manifest.txt"
for artifact in release-manifest.json SHA256SUMS source-manifest.txt; do
  [ -f "$BUNDLE_DIR/$artifact" ] && [ ! -L "$BUNDLE_DIR/$artifact" ] \
    || fail "bundle approval member is missing or unsafe: $artifact"
done
cmp -s "$REVIEWED_MANIFEST" "$BUNDLE_DIR/source-manifest.txt" \
  || fail "bundle source does not match the independently reviewed SHA allowlist"

read -r CONTROL_PLANE_SPEC_SHA256 EVIDENCE_HELPER_SHA256 \
  REQUIRED_TEST_POLICY_SOURCE_SHA256 < <(/usr/bin/python3 -I - \
  "$BUNDLE_DIR/source-manifest.txt" <<'PY'
import pathlib
import re
import sys

wanted = {
    "ops/config/control-plane-files.conf": None,
    "ops/bin/verify-release-evidence.mjs": None,
    "ops/config/release-required-tests.json": None,
}
for line in pathlib.Path(sys.argv[1]).read_text(encoding="utf-8").splitlines():
    match = re.fullmatch(r"([a-f0-9]{64})\t([FL])\t([^\t\r\n]+)", line)
    if match is None:
        raise SystemExit(2)
    digest, kind, relative = match.groups()
    if relative in wanted:
        if kind != "F" or wanted[relative] is not None:
            raise SystemExit(2)
        wanted[relative] = digest
if any(value is None for value in wanted.values()):
    raise SystemExit(2)
print(wanted["ops/config/control-plane-files.conf"],
      wanted["ops/bin/verify-release-evidence.mjs"],
      wanted["ops/config/release-required-tests.json"])
PY
) || fail "source manifest does not bind the control-plane/evidence helpers"
[[ "$CONTROL_PLANE_SPEC_SHA256:$EVIDENCE_HELPER_SHA256:$REQUIRED_TEST_POLICY_SOURCE_SHA256" =~ ^[a-f0-9]{64}:[a-f0-9]{64}:[a-f0-9]{64}$ ]] \
  || fail "control-plane approval hashes are malformed"
[ "$REQUIRED_TEST_POLICY_SOURCE_SHA256" = "$TRUSTED_REQUIRED_TEST_POLICY_SHA256" ] \
  || fail "reviewed source required-test policy differs from the independent administrator pin"
EVIDENCE_HELPER=/usr/local/lib/resume-ai/verify-release-evidence.mjs
[ -f "$EVIDENCE_HELPER" ] && [ ! -L "$EVIDENCE_HELPER" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$EVIDENCE_HELPER")" = root:root:755:1 ] \
  && [ "$(sha256sum "$EVIDENCE_HELPER" | awk '{print $1}')" = "$EVIDENCE_HELPER_SHA256" ] \
  || fail "installed semantic evidence verifier is not the reviewed release generation"
REQUIRED_TEST_POLICY=/usr/local/lib/resume-ai/release-required-tests.json
[ -f "$REQUIRED_TEST_POLICY" ] && [ ! -L "$REQUIRED_TEST_POLICY" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$REQUIRED_TEST_POLICY")" = root:root:444:1 ] \
  && [ "$(sha256sum "$REQUIRED_TEST_POLICY" | awk '{print $1}')" = "$REQUIRED_TEST_POLICY_SOURCE_SHA256" ] \
  || fail "installed required-test policy is not the reviewed release generation"
[ -x /opt/nodejs/current/bin/node ] \
  && [ "$(/usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin /opt/nodejs/current/bin/node --version)" = v24.20.0 ] \
  || fail "approved Node runtime is unavailable for semantic evidence verification"
[ -f /etc/resume-ai/release-evidence-signing.pub ] \
  && [ ! -L /etc/resume-ai/release-evidence-signing.pub ] \
  && [ "$(stat -c '%U:%G:%a:%h' /etc/resume-ai/release-evidence-signing.pub)" = root:root:644:1 ] \
  || fail "fixed Linux validation public trust anchor is missing or unsafe"
/usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin \
  /opt/nodejs/current/bin/node "$EVIDENCE_HELPER" \
  --bundle "$BUNDLE_DIR" \
  --trusted-generation-attestation-sha256 "$TRUSTED_DEEP_SCAN_ATTESTATION_SHA256" \
  --trusted-generation-producer-sha256 "$TRUSTED_DEEP_SCAN_PRODUCER_SHA256" \
  --trusted-deep-scan-completion-sha256 "$TRUSTED_DEEP_SCAN_COMPLETION_SHA256" \
  || fail "release evidence failed the frozen semantic verifier"

# Independently bind the signed Linux generation into the root approval.  The
# semantic verifier checks the Ed25519 signature; this data-only pass prevents
# a later deploy/recovery path from substituting a different tar member or
# manifest object while retaining the three unrelated Deep Scan pins.
read -r LINUX_VALIDATION_ATTESTATION_SHA256 \
  REQUIRED_TEST_POLICY_EVIDENCE_SHA256 < <(/usr/bin/env -i \
  PATH=/usr/sbin:/usr/bin:/sbin:/bin /usr/bin/python3 -I - \
  "$BUNDLE_DIR/release-manifest.json" "$BUNDLE_DIR/e2e-evidence.tar.gz" <<'PY'
import hashlib
import json
import pathlib
import re
import tarfile
import sys

target = "linux-validation-attestation.json"
policy_target = "release-required-tests.json"

def reject_duplicates(pairs):
    value = {}
    for key, member in pairs:
        if key in value:
            raise ValueError("duplicate JSON key")
        value[key] = member
    return value

def normalized(name):
    while name.startswith("./"):
        name = name[2:]
    if name in {"", "."}:
        return None
    path = pathlib.PurePosixPath(name)
    if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        raise SystemExit("evidence archive contains an unsafe member name")
    return path.as_posix()

manifest = json.loads(
    pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"),
    object_pairs_hook=reject_duplicates,
)
binding = manifest.get("linuxValidationAttestation") if isinstance(manifest, dict) else None
if (
    not isinstance(binding, dict)
    or set(binding) != {"evidenceMember", "artifactManifestMember", "sha256"}
    or binding.get("evidenceMember") != target
    or binding.get("artifactManifestMember") != "linux-validation-artifact-manifest.txt"
    or re.fullmatch(r"[a-f0-9]{64}", binding.get("sha256", "")) is None
):
    raise SystemExit("release manifest Linux validation binding is invalid")
with tarfile.open(sys.argv[2], mode="r:gz") as archive:
    members = archive.getmembers()
    matches = [member for member in members if normalized(member.name) == target]
    if len(matches) != 1:
        raise SystemExit("Linux validation attestation member is missing or duplicated")
    member = matches[0]
    if not member.isfile() or member.size <= 0 or member.size > 1024 * 1024:
        raise SystemExit("Linux validation attestation member is unsafe")
    stream = archive.extractfile(member)
    if stream is None:
        raise SystemExit("Linux validation attestation member cannot be read")
    payload = stream.read(1024 * 1024 + 1)
    policy_matches = [member for member in members if normalized(member.name) == policy_target]
    if len(policy_matches) != 1:
        raise SystemExit("required-test policy evidence member is missing or duplicated")
    policy_member = policy_matches[0]
    if not policy_member.isfile() or policy_member.size <= 0 or policy_member.size > 1024 * 1024:
        raise SystemExit("required-test policy evidence member is unsafe")
    policy_stream = archive.extractfile(policy_member)
    if policy_stream is None:
        raise SystemExit("required-test policy evidence member cannot be read")
    policy_payload = policy_stream.read(1024 * 1024 + 1)
if len(payload) != member.size or len(payload) > 1024 * 1024:
    raise SystemExit("Linux validation attestation member size changed")
observed = hashlib.sha256(payload).hexdigest()
if observed != binding["sha256"]:
    raise SystemExit("Linux validation attestation differs from the release manifest")
if len(policy_payload) != policy_member.size or len(policy_payload) > 1024 * 1024:
    raise SystemExit("required-test policy evidence member size changed")
print(observed, hashlib.sha256(policy_payload).hexdigest())
PY
) || fail "signed Linux validation and required-test policy are not independently bound to the bundle"
[[ "$LINUX_VALIDATION_ATTESTATION_SHA256" =~ ^[a-f0-9]{64}$ ]] \
  || fail "signed Linux validation approval hash is malformed"
[ "$REQUIRED_TEST_POLICY_EVIDENCE_SHA256" = "$REQUIRED_TEST_POLICY_SOURCE_SHA256" ] \
  || fail "required-test policy evidence differs from the reviewed source row"
REQUIRED_TEST_POLICY_SHA256=$TRUSTED_REQUIRED_TEST_POLICY_SHA256

read -r RELEASE_ID RELEASE_CREATED_AT < <(/usr/bin/python3 -I - \
  "$BUNDLE_DIR/release-manifest.json" <<'PY'
import datetime
import json
import sys

value = json.load(open(sys.argv[1], encoding="utf-8"))
release_id = value.get("releaseId")
created_raw = value.get("createdAt")
if not isinstance(release_id, str) or not isinstance(created_raw, str):
    raise SystemExit(2)
try:
    created = datetime.datetime.strptime(created_raw, "%Y-%m-%dT%H:%M:%SZ").replace(
        tzinfo=datetime.timezone.utc
    )
except ValueError as error:
    raise SystemExit(2) from error
age = (datetime.datetime.now(datetime.timezone.utc) - created).total_seconds()
if age < -300 or age > 24 * 60 * 60:
    raise SystemExit("release bundle is not within the 24-hour approval window")
print(release_id, created_raw)
PY
) || fail "release bundle identity or freshness is invalid"
case "$RELEASE_ID" in 20??????T??????Z) ;; *) fail "invalid release ID" ;; esac

APPROVAL_DIR=/etc/resume-ai/approved-releases
install -d -o root -g root -m 0700 "$APPROVAL_DIR"
APPROVAL_FILE="$APPROVAL_DIR/$RELEASE_ID.env"
[ ! -e "$APPROVAL_FILE" ] && [ ! -L "$APPROVAL_FILE" ] || fail "release approval already exists"
approval_temp="$(mktemp "$APPROVAL_DIR/.approval.XXXXXX")"
cat > "$approval_temp" <<EOF
SCHEMA_VERSION=6
RELEASE_ID=$RELEASE_ID
RELEASE_MANIFEST_SHA256=$(sha256sum "$BUNDLE_DIR/release-manifest.json" | awk '{print $1}')
SOURCE_MANIFEST_SHA256=$(sha256sum "$BUNDLE_DIR/source-manifest.txt" | awk '{print $1}')
SHA256SUMS_SHA256=$(sha256sum "$BUNDLE_DIR/SHA256SUMS" | awk '{print $1}')
CONTROL_PLANE_SPEC_SHA256=$CONTROL_PLANE_SPEC_SHA256
EVIDENCE_HELPER_SHA256=$EVIDENCE_HELPER_SHA256
TRUSTED_DEEP_SCAN_ATTESTATION_SHA256=$TRUSTED_DEEP_SCAN_ATTESTATION_SHA256
TRUSTED_DEEP_SCAN_PRODUCER_SHA256=$TRUSTED_DEEP_SCAN_PRODUCER_SHA256
TRUSTED_DEEP_SCAN_COMPLETION_SHA256=$TRUSTED_DEEP_SCAN_COMPLETION_SHA256
LINUX_VALIDATION_ATTESTATION_SHA256=$LINUX_VALIDATION_ATTESTATION_SHA256
REQUIRED_TEST_POLICY_SHA256=$REQUIRED_TEST_POLICY_SHA256
APPROVED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF
chown root:root "$approval_temp"
chmod 0400 "$approval_temp"
mv -- "$approval_temp" "$APPROVAL_FILE"
sync -f "$APPROVAL_FILE"
sync -f "$APPROVAL_DIR"
trap - EXIT
find "$SNAPSHOT_DIR" -xdev -depth -delete
printf '%s\n' "Approved frozen release evidence for $RELEASE_ID."
