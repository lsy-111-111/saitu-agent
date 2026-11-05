#!/usr/bin/env bash
set -euo pipefail
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

fail() { printf '%s\n' "FAIL: $*" >&2; exit 1; }
[ "${EUID:-$(id -u)}" -eq 0 ] || fail "run as root in a disposable Ubuntu 22.04 VM"
[ "$(uname -s)" = Linux ] || fail "this gate requires a disposable Ubuntu 22.04 Linux VM"
. /etc/os-release
[ "${ID:-}:${VERSION_ID:-}" = ubuntu:22.04 ] || fail "this gate requires disposable Ubuntu 22.04"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd -P)"
SOURCE_COPIER="$REPO_ROOT/ops/bin/create-bootstrap-generation.py"
GENERATOR="$REPO_ROOT/ops/bin/generate-bootstrap-source-manifest.py"
BOOTSTRAP_MANIFEST="$REPO_ROOT/bootstrap-source-manifest.txt"
INSTALLED_COPIER=/usr/local/lib/resume-ai/create-bootstrap-generation.py
MANAGED_HELPER=/usr/local/lib/resume-ai/record-cloud-snapshot-evidence.py
FIXTURE="$(mktemp -d /tmp/resume-ai-cloud-evidence.XXXXXX)"
SIGNING_DIR=/etc/resume-ai
SIGNING_MARKER=$SIGNING_DIR/release-evidence-signing.env
SIGNING_PUBLIC=$SIGNING_DIR/release-evidence-signing.pub
RUNTIME_MARKER=$SIGNING_DIR/runtime-layout-bootstrap.env
APPROVAL_DIR=$SIGNING_DIR/approved-releases
FINAL_ROOT=/var/lib/resume-ai/security/cloud-snapshots
CREATED_SIGNING=0
CREATED_RUNTIME_MARKER=0
CREATED_FINAL_ROOT=0
CREATED_REGISTRY=0
CREATED_APPROVAL_DIR=0
FINAL_RELEASE=20260101T000000Z
COPIED_RELEASE=20260101T000001Z
OLD_RELEASE=20260101T000002Z
RACE_RELEASE=20260101T000003Z

cleanup() {
  rm -f -- \
    "$FINAL_ROOT/$FINAL_RELEASE.env" "$FINAL_ROOT/$FINAL_RELEASE.pending" \
    "$FINAL_ROOT/$COPIED_RELEASE.env" "$FINAL_ROOT/$COPIED_RELEASE.pending" \
    "$FINAL_ROOT/$OLD_RELEASE.env" "$FINAL_ROOT/$OLD_RELEASE.pending" \
    "$FINAL_ROOT/$RACE_RELEASE.env" "$FINAL_ROOT/$RACE_RELEASE.pending" \
    "$FINAL_ROOT/$RACE_RELEASE.initial-rollback.env" \
    "$FINAL_ROOT/$RACE_RELEASE.initial-rollback.pending" \
    "$FINAL_ROOT/$COPIED_RELEASE.initial-rollback.env" \
    "$FINAL_ROOT/$COPIED_RELEASE.initial-rollback.pending" \
    "$FINAL_ROOT/$OLD_RELEASE.initial-rollback.env" \
    "$FINAL_ROOT/$OLD_RELEASE.initial-rollback.pending"
  rm -f -- "$APPROVAL_DIR/$FINAL_RELEASE.env" "$APPROVAL_DIR/$OLD_RELEASE.env"
  if [ "$CREATED_APPROVAL_DIR" -eq 1 ] \
    && [ -d "$APPROVAL_DIR" ] \
    && [ -z "$(find "$APPROVAL_DIR" -mindepth 1 -print -quit)" ]; then
    rmdir -- "$APPROVAL_DIR" >/dev/null 2>&1 || true
  fi
  rm -f -- "$FINAL_ROOT/by-snapshot-id/lhsnap-initial01.env" \
    "$FINAL_ROOT/by-snapshot-id/lhsnap-final001.env" \
    "$FINAL_ROOT/by-snapshot-id/lhsnap-tooearly1.env" \
    "$FINAL_ROOT/by-snapshot-id/lhsnap-valid02.env" \
    "$FINAL_ROOT/by-snapshot-id/lhsnap-race0001.env"
  if [ "$CREATED_REGISTRY" -eq 1 ] \
    && [ -d "$FINAL_ROOT/by-snapshot-id" ] \
    && [ -z "$(find "$FINAL_ROOT/by-snapshot-id" -mindepth 1 -print -quit)" ]; then
    rmdir -- "$FINAL_ROOT/by-snapshot-id" >/dev/null 2>&1 || true
  fi
  if [ "$CREATED_SIGNING" -eq 1 ]; then
    rm -f -- "$SIGNING_MARKER" "$SIGNING_PUBLIC"
    sync -f "$SIGNING_DIR" >/dev/null 2>&1 || true
  fi
  if [ "$CREATED_RUNTIME_MARKER" -eq 1 ]; then
    rm -f -- "$RUNTIME_MARKER"
    sync -f "$SIGNING_DIR" >/dev/null 2>&1 || true
  fi
  if [ "$CREATED_FINAL_ROOT" -eq 1 ] \
    && [ -d "$FINAL_ROOT" ] && [ ! -L "$FINAL_ROOT" ] \
    && [ -z "$(find "$FINAL_ROOT" -mindepth 1 -print -quit)" ]; then
    rmdir -- "$FINAL_ROOT" >/dev/null 2>&1 || true
  fi
  find "$FIXTURE" -xdev -depth -delete >/dev/null 2>&1 || true
}
trap cleanup EXIT

manifest_sha="$(python3 -I "$GENERATOR" check "$REPO_ROOT" "$BOOTSTRAP_MANIFEST")"
copier_sha="$(sha256sum "$SOURCE_COPIER" | awk '{print $1}')"
install -d -o root -g root -m 0755 /usr/local/lib/resume-ai
if [ -e "$INSTALLED_COPIER" ] || [ -L "$INSTALLED_COPIER" ]; then
  [ -f "$INSTALLED_COPIER" ] && [ ! -L "$INSTALLED_COPIER" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$INSTALLED_COPIER")" = root:root:555:1 ] \
    && [ "$(sha256sum "$INSTALLED_COPIER" | awk '{print $1}')" = "$copier_sha" ] \
    || fail "existing fixed bootstrap copier differs from this reviewed fixture"
else
  install -o root -g root -m 0555 "$SOURCE_COPIER" "$INSTALLED_COPIER"
  sync -f "$INSTALLED_COPIER"
  sync -f /usr/local/lib/resume-ai
fi
bootstrap_generation="$(python3 -I "$INSTALLED_COPIER" create "$REPO_ROOT" \
  "$BOOTSTRAP_MANIFEST" "$manifest_sha" "$copier_sha")"
BOOTSTRAP_HELPER="$bootstrap_generation/ops/bin/record-cloud-snapshot-evidence.py"

if [ ! -e "$SIGNING_MARKER" ]; then
  [ ! -e "$SIGNING_PUBLIC" ] && [ ! -L "$SIGNING_PUBLIC" ] \
    || fail "refusing to overwrite an existing signing public key"
  install -d -o root -g root -m 0755 "$SIGNING_DIR"
  openssl genpkey -algorithm Ed25519 -out "$FIXTURE/signing.key" >/dev/null 2>&1
  openssl pkey -in "$FIXTURE/signing.key" -pubout -out "$SIGNING_PUBLIC"
  chown root:root "$SIGNING_PUBLIC"
  chmod 0644 "$SIGNING_PUBLIC"
  signing_public_sha="$(sha256sum "$SIGNING_PUBLIC" | awk '{print $1}')"
  provisioned_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  marker_temp="$(mktemp "$SIGNING_DIR/.release-evidence-signing.env.XXXXXX")"
  printf '%s\n' SCHEMA_VERSION=1 "PROVISIONED_AT=$provisioned_at" \
    "PUBLIC_KEY_SHA256=$signing_public_sha" > "$marker_temp"
  chown root:root "$marker_temp"
  chmod 0600 "$marker_temp"
  sync -f "$marker_temp"
  mv -- "$marker_temp" "$SIGNING_MARKER"
  sync -f "$SIGNING_DIR"
  CREATED_SIGNING=1
else
  [ -f "$SIGNING_MARKER" ] && [ ! -L "$SIGNING_MARKER" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$SIGNING_MARKER")" = root:root:600:1 ] \
    && [ -f "$SIGNING_PUBLIC" ] && [ ! -L "$SIGNING_PUBLIC" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$SIGNING_PUBLIC")" = root:root:644:1 ] \
    || fail "existing signing trust anchor is unsafe"
fi
provisioned_at="$(awk -F= '$1 == "PROVISIONED_AT" { print $2 }' "$SIGNING_MARKER")"
[[ "$provisioned_at" =~ ^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] \
  || fail "fixture signing marker lacks one provisioning timestamp"
if [ ! -d "$APPROVAL_DIR" ]; then
  install -d -o root -g root -m 0700 "$APPROVAL_DIR"
  CREATED_APPROVAL_DIR=1
fi
for release in "$FINAL_RELEASE" "$OLD_RELEASE"; do
  approval="$APPROVAL_DIR/$release.env"
  [ ! -e "$approval" ] && [ ! -L "$approval" ] \
    || fail "disposable fixture release approval already exists"
  printf '%s\n' \
    SCHEMA_VERSION=6 \
    "RELEASE_ID=$release" \
    "RELEASE_MANIFEST_SHA256=$(printf '1%.0s' {1..64})" \
    "SOURCE_MANIFEST_SHA256=$(printf '2%.0s' {1..64})" \
    "SHA256SUMS_SHA256=$(printf '3%.0s' {1..64})" \
    "CONTROL_PLANE_SPEC_SHA256=$(printf '4%.0s' {1..64})" \
    "EVIDENCE_HELPER_SHA256=$(printf '5%.0s' {1..64})" \
    "TRUSTED_DEEP_SCAN_ATTESTATION_SHA256=$(printf '6%.0s' {1..64})" \
    "TRUSTED_DEEP_SCAN_PRODUCER_SHA256=$(printf '7%.0s' {1..64})" \
    "TRUSTED_DEEP_SCAN_COMPLETION_SHA256=$(printf '8%.0s' {1..64})" \
    "LINUX_VALIDATION_ATTESTATION_SHA256=$(printf '9%.0s' {1..64})" \
    "REQUIRED_TEST_POLICY_SHA256=$(printf 'a%.0s' {1..64})" \
    "APPROVED_AT=$provisioned_at" > "$approval"
  chown root:root "$approval"
  chmod 0400 "$approval"
done

if [ ! -d "$FINAL_ROOT" ]; then
  install -d -o root -g root -m 0700 "$FINAL_ROOT"
  CREATED_FINAL_ROOT=1
fi
[ -d "$FINAL_ROOT" ] && [ ! -L "$FINAL_ROOT" ] \
  && [ "$(readlink -e -- "$FINAL_ROOT")" = "$FINAL_ROOT" ] \
  && [ "$(stat -c '%U:%G:%a' "$FINAL_ROOT")" = root:root:700 ] \
  || fail "fixed snapshot evidence root is unsafe"
if [ ! -d "$FINAL_ROOT/by-snapshot-id" ]; then
  install -d -o root -g root -m 0700 "$FINAL_ROOT/by-snapshot-id"
  CREATED_REGISTRY=1
fi
[ -d "$FINAL_ROOT/by-snapshot-id" ] && [ ! -L "$FINAL_ROOT/by-snapshot-id" ] \
  && [ "$(readlink -e -- "$FINAL_ROOT/by-snapshot-id")" = "$FINAL_ROOT/by-snapshot-id" ] \
  && [ "$(stat -c '%U:%G:%a' "$FINAL_ROOT/by-snapshot-id")" = root:root:700 ] \
  || fail "fixed global snapshot identity registry is unsafe"
BOOTSTRAP_RECEIPT=/var/lib/resume-ai/bootstrap-generation.env
bootstrap_manifest_sha=$manifest_sha
bootstrap_started_at="$(awk -F= '$1 == "STARTED_AT" { print $2 }' "$BOOTSTRAP_RECEIPT")"
[ "$(awk -F= '$1 == "GENERATION_PATH" { print $2 }' "$BOOTSTRAP_RECEIPT")" \
    = "$bootstrap_generation" ] \
  && [ "$(awk -F= '$1 == "BOOTSTRAP_MANIFEST_SHA256" { print $2 }' \
    "$BOOTSTRAP_RECEIPT")" = "$bootstrap_manifest_sha" ] \
  || fail "active bootstrap receipt differs from the fixture generation"
for release in "$FINAL_RELEASE" "$COPIED_RELEASE" "$OLD_RELEASE" "$RACE_RELEASE"; do
  [ ! -e "$FINAL_ROOT/$release.env" ] && [ ! -L "$FINAL_ROOT/$release.env" ] \
    || fail "disposable fixture release collides with existing evidence"
done

write_snapshot() {
  local snapshot_id=$1 created_at=$2 snapshot_name=$3
  printf '%s\n' \
    "{\"Response\":{\"TotalCount\":1,\"SnapshotSet\":[{\"SnapshotId\":\"$snapshot_id\",\"SnapshotName\":\"$snapshot_name\",\"DiskId\":\"lhdisk-system01\",\"DiskUsage\":\"SYSTEM_DISK\",\"SnapshotState\":\"NORMAL\",\"Percent\":100,\"CreatedTime\":\"$created_at\"}],\"RequestId\":\"snapshot-request-0001\"}}" \
    > "$FIXTURE/snapshot.json"
  chmod 0400 "$FIXTURE/snapshot.json"
}

write_disk() {
  local zone=$1 state=$2 attached=$3
  printf '%s\n' \
    "{\"Response\":{\"TotalCount\":1,\"DiskSet\":[{\"DiskId\":\"lhdisk-system01\",\"InstanceId\":\"lhins-aw4n6o9t\",\"Zone\":\"$zone\",\"DiskUsage\":\"SYSTEM_DISK\",\"DiskState\":\"$state\",\"Attached\":$attached}],\"RequestId\":\"disks-request-0001\"}}" \
    > "$FIXTURE/disks.json"
  chmod 0400 "$FIXTURE/disks.json"
}

write_disk ap-guangzhou-6 ATTACHED true
write_snapshot lhsnap-initial01 "$bootstrap_started_at" \
  "resume-ai-initial-rollback-$COPIED_RELEASE"
ACK_RECORD_CLOUD_SNAPSHOT_EVIDENCE=PENDING_INITIAL_PRE_CHANGE_ROLLBACK \
  python3 -I "$BOOTSTRAP_HELPER" --pending-initial-rollback "$COPIED_RELEASE" "$FINAL_ROOT"
ACK_RECORD_CLOUD_SNAPSHOT_EVIDENCE=INITIAL_PRE_CHANGE_ROLLBACK \
  python3 -I "$BOOTSTRAP_HELPER" --api-initial-rollback \
    "$FIXTURE/snapshot.json" "$FIXTURE/disks.json" "$COPIED_RELEASE" "$FINAL_ROOT"
initial_evidence="$FINAL_ROOT/$COPIED_RELEASE.initial-rollback.env"
grep -Fxq SCHEMA_VERSION=3 "$initial_evidence"
[ ! -e "$FINAL_ROOT/$COPIED_RELEASE.initial-rollback.pending" ] \
  || fail "initial pending marker survived successful finalization"

# Publish the bootstrap start boundary only after the initial snapshot.  The
# real installer captures this timestamp before any account/service/control
# mutation and preserves it through its pending transaction receipt.
[ ! -e "$RUNTIME_MARKER" ] && [ ! -L "$RUNTIME_MARKER" ] \
  || fail "disposable fixture already has a runtime-layout completion marker"
runtime_started_at=$bootstrap_started_at
runtime_marker_temp="$(mktemp "$SIGNING_DIR/.runtime-layout-bootstrap.XXXXXX")"
printf '%s\n' \
  SCHEMA_VERSION=4 PHASE=complete "STARTED_AT=$runtime_started_at" \
  "BOOTSTRAP_GENERATION=/var/lib/resume-ai/bootstrap-generations/generation-$bootstrap_manifest_sha" \
  "BOOTSTRAP_MANIFEST_SHA256=$bootstrap_manifest_sha" \
  "HOST_BASELINE_DIR=/var/backups/resume-ai/prechange/20260101T000000Z" \
  "HOST_BASELINE_MANIFEST_SHA256=$(printf 'f%.0s' {1..64})" \
  "SOURCE_GENERATION_SHA256=$(printf 'b%.0s' {1..64})" \
  "CONTROL_SPEC_SHA256=$(printf 'c%.0s' {1..64})" > "$runtime_marker_temp"
chown root:root "$runtime_marker_temp"
chmod 0400 "$runtime_marker_temp"
sync -f "$runtime_marker_temp"
mv -- "$runtime_marker_temp" "$RUNTIME_MARKER"
sync -f "$SIGNING_DIR"
CREATED_RUNTIME_MARKER=1
if [ -e "$MANAGED_HELPER" ] || [ -L "$MANAGED_HELPER" ]; then
  [ -f "$MANAGED_HELPER" ] && [ ! -L "$MANAGED_HELPER" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$MANAGED_HELPER")" = root:root:755:1 ] \
    && cmp -s "$BOOTSTRAP_HELPER" "$MANAGED_HELPER" \
    || fail "existing managed snapshot helper differs from the bootstrap generation"
else
  install -o root -g root -m 0755 "$BOOTSTRAP_HELPER" "$MANAGED_HELPER"
  sync -f "$MANAGED_HELPER"
  sync -f /usr/local/lib/resume-ai
fi
initial_sha256="$(sha256sum "$initial_evidence" | awk '{print $1}')"
python3 -I "$MANAGED_HELPER" --verify-initial-rollback \
  "$initial_evidence" "$COPIED_RELEASE" lhsnap-initial01 "$initial_sha256" >/dev/null

# One real API SnapshotId may never be rebound to another release/purpose.
write_snapshot lhsnap-initial01 "$bootstrap_started_at" \
  "resume-ai-initial-rollback-$OLD_RELEASE"
if ACK_RECORD_CLOUD_SNAPSHOT_EVIDENCE=INITIAL_PRE_CHANGE_ROLLBACK \
    python3 -I "$BOOTSTRAP_HELPER" --api-initial-rollback \
      "$FIXTURE/snapshot.json" "$FIXTURE/disks.json" "$OLD_RELEASE" "$FINAL_ROOT"; then
  fail "one API snapshot identity was laundered across two releases"
fi

write_snapshot lhsnap-final001 "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  "resume-ai-post-provision-$FINAL_RELEASE"
ACK_RECORD_CLOUD_SNAPSHOT_EVIDENCE=PENDING_POST_PROVISION_CONTINUITY \
  python3 -I "$MANAGED_HELPER" --pending "$FINAL_RELEASE" "$FINAL_ROOT"
ACK_RECORD_CLOUD_SNAPSHOT_EVIDENCE=POST_PROVISION_CONTINUITY \
  python3 -I "$MANAGED_HELPER" --api \
    "$FIXTURE/snapshot.json" "$FIXTURE/disks.json" "$FINAL_RELEASE" "$FINAL_ROOT"
final_evidence="$FINAL_ROOT/$FINAL_RELEASE.env"
grep -Fxq SCHEMA_VERSION=4 "$final_evidence"
grep -Fxq EVIDENCE_PURPOSE=post-provision-continuity "$final_evidence"
[ ! -e "$FINAL_ROOT/$FINAL_RELEASE.pending" ] \
  || fail "final continuity pending marker survived successful finalization"
python3 -I "$MANAGED_HELPER" --verify-pre-switch "$final_evidence" "$FINAL_RELEASE" >/dev/null
python3 -I "$MANAGED_HELPER" --verify-continuity \
  "$final_evidence" "$FINAL_RELEASE" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >/dev/null

# A schema-3 initial receipt cannot be copied into the final fixed basename.
cp -- "$initial_evidence" "$FINAL_ROOT/$COPIED_RELEASE.env"
chown root:root "$FINAL_ROOT/$COPIED_RELEASE.env"
chmod 0400 "$FINAL_ROOT/$COPIED_RELEASE.env"
if python3 -I "$MANAGED_HELPER" --verify-continuity \
    "$FINAL_ROOT/$COPIED_RELEASE.env" "$COPIED_RELEASE" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"; then
  fail "renamed initial rollback evidence was accepted as final continuity proof"
fi

# A snapshot one second before the durable signing marker must be rejected.
provisioned_epoch="$(date -u -d "$provisioned_at" +%s)"
before_provisioning="$(date -u -d "@$((provisioned_epoch - 1))" +%Y-%m-%dT%H:%M:%SZ)"
write_snapshot lhsnap-tooearly1 "$before_provisioning" \
  "resume-ai-post-provision-$OLD_RELEASE"
if ACK_RECORD_CLOUD_SNAPSHOT_EVIDENCE=POST_PROVISION_CONTINUITY \
    python3 -I "$MANAGED_HELPER" --api \
      "$FIXTURE/snapshot.json" "$FIXTURE/disks.json" "$OLD_RELEASE" "$FINAL_ROOT"; then
  fail "pre-provision snapshot was accepted as final continuity proof"
fi

write_snapshot snap-wrongtype "$bootstrap_started_at" \
  "resume-ai-initial-rollback-$OLD_RELEASE"
if ACK_RECORD_CLOUD_SNAPSHOT_EVIDENCE=INITIAL_PRE_CHANGE_ROLLBACK \
    python3 -I "$BOOTSTRAP_HELPER" --api-initial-rollback \
      "$FIXTURE/snapshot.json" "$FIXTURE/disks.json" "$OLD_RELEASE" "$FINAL_ROOT"; then
  fail "wrong snapshot type was accepted"
fi
write_snapshot lhsnap-valid02 "$bootstrap_started_at" \
  "resume-ai-initial-rollback-$OLD_RELEASE"
write_disk ap-shanghai-1 ATTACHED true
if ACK_RECORD_CLOUD_SNAPSHOT_EVIDENCE=INITIAL_PRE_CHANGE_ROLLBACK \
    python3 -I "$BOOTSTRAP_HELPER" --api-initial-rollback \
      "$FIXTURE/snapshot.json" "$FIXTURE/disks.json" "$OLD_RELEASE" "$FINAL_ROOT"; then
  fail "wrong region was accepted"
fi
write_disk ap-guangzhou-6 UNATTACHED false
if ACK_RECORD_CLOUD_SNAPSHOT_EVIDENCE=INITIAL_PRE_CHANGE_ROLLBACK \
    python3 -I "$BOOTSTRAP_HELPER" --api-initial-rollback \
      "$FIXTURE/snapshot.json" "$FIXTURE/disks.json" "$OLD_RELEASE" "$FINAL_ROOT"; then
  fail "unattached disk was accepted"
fi

# A newly captured snapshot cannot be relabelled as the pre-change rollback
# point after the durable runtime-layout transaction boundary.
runtime_started_epoch="$(date -u -d "$runtime_started_at" +%s)"
after_bootstrap="$(date -u -d "@$((runtime_started_epoch + 1))" +%Y-%m-%dT%H:%M:%SZ)"
write_disk ap-guangzhou-6 ATTACHED true
write_snapshot lhsnap-valid02 "$after_bootstrap" \
  "resume-ai-initial-rollback-$OLD_RELEASE"
if ACK_RECORD_CLOUD_SNAPSHOT_EVIDENCE=INITIAL_PRE_CHANGE_ROLLBACK \
    python3 -I "$BOOTSTRAP_HELPER" --api-initial-rollback \
      "$FIXTURE/snapshot.json" "$FIXTURE/disks.json" "$OLD_RELEASE" "$FINAL_ROOT"; then
  fail "post-bootstrap snapshot was accepted as initial rollback evidence"
fi

# Concurrent publishers for the same fixed identity cannot overwrite one
# another. Exactly one process may publish the claim/evidence pair.
write_disk ap-guangzhou-6 ATTACHED true
write_snapshot lhsnap-race0001 "$bootstrap_started_at" \
  "resume-ai-initial-rollback-$RACE_RELEASE"
set +e
( ACK_RECORD_CLOUD_SNAPSHOT_EVIDENCE=INITIAL_PRE_CHANGE_ROLLBACK \
    python3 -I "$BOOTSTRAP_HELPER" --api-initial-rollback \
      "$FIXTURE/snapshot.json" "$FIXTURE/disks.json" "$RACE_RELEASE" "$FINAL_ROOT" ) &
first_pid=$!
( ACK_RECORD_CLOUD_SNAPSHOT_EVIDENCE=INITIAL_PRE_CHANGE_ROLLBACK \
    python3 -I "$BOOTSTRAP_HELPER" --api-initial-rollback \
      "$FIXTURE/snapshot.json" "$FIXTURE/disks.json" "$RACE_RELEASE" "$FINAL_ROOT" ) &
second_pid=$!
wait "$first_pid"; first_status=$?
wait "$second_pid"; second_status=$?
set -e
[ $(( (first_status == 0) + (second_status == 0) )) -eq 1 ] \
  || fail "concurrent snapshot publishers did not have exactly one winner"

printf '%s\n' "Cloud snapshot dual-purpose API-evidence gate passed."
