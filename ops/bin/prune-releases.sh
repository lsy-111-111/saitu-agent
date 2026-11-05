#!/usr/bin/env bash
set -euo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin

fail() {
  printf '%s\n' "ERROR: $*" >&2
  exit 1
}

[ "${EUID:-$(id -u)}" -eq 0 ] || fail "run as root"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
. "$SCRIPT_DIR/open-root-lock.sh"
RELEASE_ROOT=/opt/resume-ai/releases
ARTIFACT_ROOT=/opt/resume-ai/release-artifacts
CACHE_ROOT=/var/cache/resume-ai
STATE_FILE=/opt/resume-ai/state/active.env
RETAIN_RELEASES="${RETAIN_RELEASES:-3}"
case "$RETAIN_RELEASES" in *[!0-9]*) fail "RETAIN_RELEASES must be an integer" ;; esac
[ "$RETAIN_RELEASES" -ge 3 ] || fail "at least three releases must be retained"
for managed_root in "$RELEASE_ROOT" "$ARTIFACT_ROOT" "$CACHE_ROOT"; do
  [ -d "$managed_root" ] && [ ! -L "$managed_root" ] \
    || fail "managed release root does not exist or is unsafe: $managed_root"
done

command -v flock >/dev/null 2>&1 || fail "flock is unavailable"
open_root_lock 9 deploy

ACTIVE_RELEASE=""
PREVIOUS_RELEASE=""
[ -f "$STATE_FILE" ] && [ ! -L "$STATE_FILE" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$STATE_FILE")" = root:resume-ai:640:1 ] \
  || fail "active release state is missing or unsafe"
for pending_file in \
  /opt/resume-ai/state/deploy.pending \
  /opt/resume-ai/state/legacy-adoption.pending \
  /opt/resume-ai/state/nginx-migration.pending; do
  [ ! -e "$pending_file" ] && [ ! -L "$pending_file" ] \
    || fail "refusing to prune while a release transaction is pending: $pending_file"
done
declare -A seen_state=()
while IFS='=' read -r state_key state_value || [ -n "$state_key" ]; do
  case "$state_key" in
    ACTIVE_RELEASE|PREVIOUS_RELEASE)
      [ -z "${seen_state[$state_key]:-}" ] || fail "duplicate active state key: $state_key"
      seen_state[$state_key]=1
      printf -v "$state_key" '%s' "$state_value"
      ;;
    ACTIVE_PORT|PREVIOUS_PORT|SWITCHED_AT|'') ;;
    *) fail "unknown active state key: $state_key" ;;
  esac
done < "$STATE_FILE"
case "$ACTIVE_RELEASE" in 20??????T??????Z) ;; *) fail "active release identifier is invalid" ;; esac
case "$PREVIOUS_RELEASE" in none|20??????T??????Z) ;; *) fail "previous release identifier is invalid" ;; esac

release_ids=()
while IFS= read -r artifact_path; do
  release_id=${artifact_path##*/}
  marker="$artifact_path/deployment-complete.env"
  if [ -e "$marker" ] || [ -L "$marker" ]; then
    [ -f "$marker" ] && [ ! -L "$marker" ] \
      && [ "$(stat -c '%U:%G:%a:%h' "$marker")" = root:root:400:1 ] \
      || fail "deployment completion marker is unsafe: $marker"
    marker_release="$(awk -F= '$1 == "RELEASE_ID" { print $2; count += 1 } END { if (count != 1) exit 2 }' "$marker")" \
      || fail "deployment completion marker identity is malformed: $marker"
    marker_schema="$(awk -F= '$1 == "SCHEMA_VERSION" { print $2; count += 1 } END { if (count != 1) exit 2 }' "$marker")" \
      || fail "deployment completion marker schema is malformed: $marker"
    marker_hash="$(awk -F= '$1 == "RELEASE_MANIFEST_SHA256" { print $2; count += 1 } END { if (count != 1) exit 2 }' "$marker")" \
      || fail "deployment completion marker hash is malformed: $marker"
    marker_rollback="$(awk -F= '$1 == "ROLLBACK_RELEASE" { print $2; count += 1 } END { if (count != 1) exit 2 }' "$marker")" \
      || fail "deployment completion marker rollback target is malformed: $marker"
    [ "$marker_schema" = 1 ] && [ "$marker_release" = "$release_id" ] \
      && [[ "$marker_hash" =~ ^[a-f0-9]{64}$ ]] \
      && [[ "$marker_rollback" =~ ^20[0-9]{6}T[0-9]{6}Z$ ]] \
      && [ "$marker_hash" = "$(sha256sum "$artifact_path/release-manifest.json" | awk '{print $1}')" ] \
      || fail "deployment completion marker is not bound to its immutable release: $marker"
    grep -Fxq "\"rollbackRelease\": \"$marker_rollback\"," "$artifact_path/release-manifest.json" \
      || fail "deployment completion marker rollback target differs from its manifest"
    [ "$(awk 'END { print NR }' "$marker")" -eq 5 ] \
      && grep -Eq '^COMPLETED_AT=[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$' "$marker" \
      || fail "deployment completion marker contains unexpected rows: $marker"
    [ -d "$RELEASE_ROOT/$release_id" ] && [ ! -L "$RELEASE_ROOT/$release_id" ] \
      && [ -d "$CACHE_ROOT/$release_id" ] && [ ! -L "$CACHE_ROOT/$release_id" ] \
      || fail "completed release is missing its source or cache tree: $release_id"
    release_ids+=("$release_id")
  fi
done < <(find "$ARTIFACT_ROOT" -mindepth 1 -maxdepth 1 -type d -name '20??????T??????Z' -print | sort)

declare -A keep_ids=()
keep_ids[$ACTIVE_RELEASE]=1
[ "$PREVIOUS_RELEASE" = none ] || keep_ids[$PREVIOUS_RELEASE]=1
for ((index=${#release_ids[@]} - 1; index >= 0; index--)); do
  [ "${#keep_ids[@]}" -ge "$RETAIN_RELEASES" ] && break
  keep_ids[${release_ids[$index]}]=1
done

delete_release_member() {
  local root=$1 release_id=$2 member="$1/$2"
  case "$member" in "$root"/20??????T??????Z) ;; *) fail "refusing unsafe release member: $member" ;; esac
  [ -d "$member" ] && [ ! -L "$member" ] || fail "release member is not an ordinary directory: $member"
  python3 -I - "$member" <<'PY' || fail "release member contains a mount point: $member"
import pathlib
import sys

root = pathlib.Path(sys.argv[1]).resolve(strict=True)
for line in pathlib.Path("/proc/self/mountinfo").read_text(encoding="utf-8").splitlines():
    fields = line.split()
    if len(fields) < 5:
        raise SystemExit(2)
    mount = pathlib.Path(
        fields[4].replace("\\040", " ").replace("\\011", "\t").replace("\\012", "\n").replace("\\134", "\\")
    )
    try:
        mount.relative_to(root)
    except ValueError:
        continue
    raise SystemExit(1)
PY
  find "$member" -xdev -depth -delete
  [ ! -e "$member" ] && [ ! -L "$member" ] \
    || fail "release member could not be removed without crossing a filesystem boundary: $member"
}

for managed_root in "$RELEASE_ROOT" "$ARTIFACT_ROOT" "$CACHE_ROOT"; do
  while IFS= read -r member; do
    release_id=${member##*/}
    [ -z "${keep_ids[$release_id]:-}" ] || continue
    delete_release_member "$managed_root" "$release_id"
    printf '%s\n' "Pruned $managed_root/$release_id"
  done < <(find "$managed_root" -mindepth 1 -maxdepth 1 -type d -name '20??????T??????Z' -print | sort)
  while IFS= read -r unsafe_member; do
    fail "managed release root contains an unsafe non-directory or symlink member: $unsafe_member"
  done < <(find "$managed_root" -mindepth 1 -maxdepth 1 -name '20??????T??????Z' ! -type d -print)
done

printf '%s\n' "Retained ${#keep_ids[@]} protected release ID(s) across source, artifacts, and cache."
