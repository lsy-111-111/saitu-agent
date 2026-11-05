#!/usr/bin/env bash
set -euo pipefail
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH

fail() { printf '%s\n' "FAIL: $*" >&2; exit 1; }
[ "${EUID:-$(id -u)}" -eq 0 ] || fail "run as root in a disposable Ubuntu 22.04 VM"
[ "$(uname -s)" = Linux ] || fail "this gate requires a disposable Ubuntu 22.04 Linux VM"
. /etc/os-release
[ "${ID:-}:${VERSION_ID:-}" = ubuntu:22.04 ] \
  || fail "this gate requires disposable Ubuntu 22.04"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd -P)"
SOURCE_COPIER="$REPO_ROOT/ops/bin/create-bootstrap-generation.py"
GENERATOR="$REPO_ROOT/ops/bin/generate-bootstrap-source-manifest.py"
MANIFEST="$REPO_ROOT/bootstrap-source-manifest.txt"
INSTALLED_COPIER=/usr/local/lib/resume-ai/create-bootstrap-generation.py
ACTIVE_RECEIPT=/var/lib/resume-ai/bootstrap-generation.env
[ ! -e "$ACTIVE_RECEIPT" ] && [ ! -L "$ACTIVE_RECEIPT" ] \
  || fail "disposable VM already has a bootstrap generation"

manifest_sha="$(python3 -I "$GENERATOR" check "$REPO_ROOT" "$MANIFEST")"
copier_sha="$(sha256sum "$SOURCE_COPIER" | awk '{print $1}')"
[[ "$manifest_sha:$copier_sha" =~ ^[a-f0-9]{64}:[a-f0-9]{64}$ ]] \
  || fail "canonical bootstrap digests are malformed"
install -d -o root -g root -m 0755 /usr/local/lib/resume-ai
if [ -e "$INSTALLED_COPIER" ] || [ -L "$INSTALLED_COPIER" ]; then
  [ -f "$INSTALLED_COPIER" ] && [ ! -L "$INSTALLED_COPIER" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$INSTALLED_COPIER")" = root:root:555:1 ] \
    && [ "$(sha256sum "$INSTALLED_COPIER" | awk '{print $1}')" = "$copier_sha" ] \
    || fail "existing fixed bootstrap copier differs from the reviewed test byte"
else
  install -o root -g root -m 0555 "$SOURCE_COPIER" "$INSTALLED_COPIER"
  sync -f "$INSTALLED_COPIER"
  sync -f /usr/local/lib/resume-ai
fi

generation="$(python3 -I "$INSTALLED_COPIER" create "$REPO_ROOT" "$MANIFEST" \
  "$manifest_sha" "$copier_sha")"
[ "$generation" = "/var/lib/resume-ai/bootstrap-generations/generation-$manifest_sha" ] \
  || fail "bootstrap generation path is not content addressed"
python3 -I "$INSTALLED_COPIER" verify "$generation" "$manifest_sha" >/dev/null

# The coordination inode is persistent, but verify also safely recreates an
# absent root-only lock (the same state seen after legacy /run-based versions
# or a partial bootstrap cleanup).
BOOTSTRAP_LOCK=/usr/local/lib/resume-ai/.bootstrap-generation.lock
[ -f "$BOOTSTRAP_LOCK" ] && [ ! -L "$BOOTSTRAP_LOCK" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$BOOTSTRAP_LOCK")" = root:root:600:1 ] \
  || fail "bootstrap generation lock is unsafe"
rm -f -- "$BOOTSTRAP_LOCK"
python3 -I "$INSTALLED_COPIER" verify "$generation" "$manifest_sha" >/dev/null
[ -f "$BOOTSTRAP_LOCK" ] && [ ! -L "$BOOTSTRAP_LOCK" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$BOOTSTRAP_LOCK")" = root:root:600:1 ] \
  || fail "bootstrap verifier did not safely recreate its missing lock"

# The worktree copy may never publish even a pending initial-snapshot marker;
# initial writes are code-level gated to the active, fully verified generation.
worktree_snapshot="$REPO_ROOT/ops/bin/record-cloud-snapshot-evidence.py"
worktree_pending=/var/lib/resume-ai/security/cloud-snapshots/20260101T010000Z.initial-rollback.pending
if ACK_RECORD_CLOUD_SNAPSHOT_EVIDENCE=PENDING_INITIAL_PRE_CHANGE_ROLLBACK \
    python3 -I "$worktree_snapshot" --pending-initial-rollback \
      20260101T010000Z /var/lib/resume-ai/security/cloud-snapshots; then
  fail "worktree snapshot helper wrote initial evidence outside the bootstrap generation"
fi
[ ! -e "$worktree_pending" ] && [ ! -L "$worktree_pending" ] \
  || fail "rejected worktree snapshot helper left a pending marker"

# Direct root execution of a candidate entry is rejected before it can capture
# or mutate host state.
candidate_entry="$(mktemp /tmp/resume-ai-candidate-entry.XXXXXX)"
install -m 0755 "$REPO_ROOT/ops/bin/capture-host-baseline.sh" "$candidate_entry"
if ACK_CAPTURE_HOST_BASELINE=YES "$candidate_entry"; then
  fail "candidate baseline entry bypassed the active bootstrap generation"
fi
rm -f -- "$candidate_entry"

# An independent expected manifest hash defeats a fully self-consistent
# candidate replacement, rather than merely detecting a malformed row.
tampered_root="$(mktemp -d /tmp/resume-ai-bootstrap-source.XXXXXX)"
while IFS=$'\t' read -r kind mode size digest relative; do
  [ "$kind" = FILE ] || continue
  install -d "$(dirname "$tampered_root/$relative")"
  cp -- "$REPO_ROOT/$relative" "$tampered_root/$relative"
done < "$MANIFEST"
printf '%s\n' '# candidate root command' >> \
  "$tampered_root/ops/bin/capture-host-baseline.sh"
python3 -I "$GENERATOR" generate "$tampered_root" \
  > "$tampered_root/bootstrap-source-manifest.txt"
if python3 -I "$INSTALLED_COPIER" create "$tampered_root" \
    "$tampered_root/bootstrap-source-manifest.txt" "$manifest_sha" "$copier_sha"; then
  fail "tampered bootstrap manifest was accepted"
fi
find "$tampered_root" -xdev -depth -delete

# Exact inventory and no-follow reads reject each non-ordinary source form
# before the active generation or receipt can be touched.
unsafe_root="$(mktemp -d /tmp/resume-ai-bootstrap-unsafe.XXXXXX)"
while IFS=$'\t' read -r kind mode size digest relative; do
  [ "$kind" = FILE ] || continue
  install -d "$(dirname "$unsafe_root/$relative")"
  cp -- "$REPO_ROOT/$relative" "$unsafe_root/$relative"
done < "$MANIFEST"
cp -- "$MANIFEST" "$unsafe_root/bootstrap-source-manifest.txt"
ln "$unsafe_root/ops/bin/capture-host-baseline.sh" "$unsafe_root/hardlink-outside"
if python3 -I "$INSTALLED_COPIER" create "$unsafe_root" "$unsafe_root/bootstrap-source-manifest.txt" \
    "$manifest_sha" "$copier_sha" 2>/dev/null; then
  fail "hardlinked bootstrap source member was accepted"
fi
rm -f -- "$unsafe_root/hardlink-outside"
rm -f -- "$unsafe_root/ops/bin/capture-host-baseline.sh"
ln -s /bin/true "$unsafe_root/ops/bin/capture-host-baseline.sh"
if python3 -I "$INSTALLED_COPIER" create "$unsafe_root" "$unsafe_root/bootstrap-source-manifest.txt" \
    "$manifest_sha" "$copier_sha" 2>/dev/null; then
  fail "linked bootstrap source member was accepted"
fi
rm -f -- "$unsafe_root/ops/bin/capture-host-baseline.sh"
mkfifo "$unsafe_root/ops/bin/capture-host-baseline.sh"
if python3 -I "$INSTALLED_COPIER" create "$unsafe_root" "$unsafe_root/bootstrap-source-manifest.txt" \
    "$manifest_sha" "$copier_sha" 2>/dev/null; then
  fail "special bootstrap source member was accepted"
fi
find "$unsafe_root" -xdev -depth -delete

# A valid abandoned private stage is cleaned under the fixed lock; a symlink
# using the reserved namespace is rejected rather than followed.
stale_stage=/var/lib/resume-ai/bootstrap-generations/.generation-11111111-1111-4111-8111-111111111111
install -d -o root -g root -m 0700 "$stale_stage"
python3 -I "$INSTALLED_COPIER" create "$REPO_ROOT" "$MANIFEST" \
  "$manifest_sha" "$copier_sha" >/dev/null
[ ! -e "$stale_stage" ] && [ ! -L "$stale_stage" ] \
  || fail "strict abandoned bootstrap stage was not cleaned"
linked_stage=/var/lib/resume-ai/bootstrap-generations/.generation-22222222-2222-4222-8222-222222222222
ln -s /tmp "$linked_stage"
if python3 -I "$INSTALLED_COPIER" create "$REPO_ROOT" "$MANIFEST" \
    "$manifest_sha" "$copier_sha"; then
  fail "linked abandoned bootstrap stage was accepted"
fi
unlink "$linked_stage"

printf '%s\n' "First-root bootstrap generation Linux gate passed."
