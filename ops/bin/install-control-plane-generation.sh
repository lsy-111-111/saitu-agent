#!/usr/bin/env bash
set -Eeuo pipefail
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

fail() { printf '%s\n' "ERROR: $*" >&2; exit 1; }
root_python() {
  (cd / && /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin \
    /usr/bin/python3 -I "$@")
}
[ "${EUID:-$(id -u)}" -eq 0 ] || fail "run as root"
[ "$#" -eq 3 ] || fail "usage: install-control-plane-generation.sh bootstrap|stage|commit|finalize SOURCE_ROOT SOURCE_MANIFEST"
ACTION=$1
SOURCE_ROOT=$2
SOURCE_MANIFEST=$3
case "$ACTION:$SOURCE_ROOT:$SOURCE_MANIFEST" in
  bootstrap:/*:/*|stage:/*:/*|commit:/*:/*|finalize:/*:/*) ;;
  *) fail "invalid action or non-absolute control-plane paths" ;;
esac
[ "${ACK_CONTROL_PLANE_GENERATION:-}" = YES ] \
  || fail "explicit control-plane generation acknowledgement is required"
command -v udevadm >/dev/null 2>&1 || fail "udevadm is unavailable"
umask 077

# These files are deliberately outside the ordinary control generation. They
# are established or upgraded only by the separately acknowledged runtime
# bootstrap, never by a release candidate which they are parsing.
TRUSTED_ROOT=/usr/local/lib/resume-ai
TRUSTED_VERIFIER="$TRUSTED_ROOT/verify-control-plane-generation.py"
TRUSTED_INSTALLER="$TRUSTED_ROOT/install-control-plane-generation.sh"
TRUSTED_RECOVERY="$TRUSTED_ROOT/recover-control-plane-generation.sh"
TRUSTED_LOCK="$TRUSTED_ROOT/open-root-lock.sh"
TRUSTED_SPEC=/usr/local/share/resume-ai/control-plane-files.conf

assert_trust_anchor() {
  local path=$1 mode=$2
  [ -f "$path" ] && [ ! -L "$path" ] \
    && [ "$(readlink -e -- "$path")" = "$path" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$path")" = "root:root:$mode:1" ] \
    || fail "installed control-plane trust anchor is missing or unsafe: $path"
}
assert_trust_anchor "$TRUSTED_VERIFIER" 755
assert_trust_anchor "$TRUSTED_INSTALLER" 755
assert_trust_anchor "$TRUSTED_RECOVERY" 755
assert_trust_anchor "$TRUSTED_LOCK" 755
assert_trust_anchor "$TRUSTED_SPEC" 444
[ "$(readlink -e -- "$TRUSTED_INSTALLER")" = "$(readlink -e -- "${BASH_SOURCE[0]}")" ] \
  || fail "control-plane installation must use the installed trust anchor"
. "$TRUSTED_LOCK"

deploy_lock=/run/resume-ai-locks/deploy.lock
if [ -e /proc/$$/fd/9 ] \
  && [ "$(readlink /proc/$$/fd/9)" = "$deploy_lock" ] \
  && [ "$(stat -Lc '%d:%i' /proc/$$/fd/9)" = "$(stat -c '%d:%i' "$deploy_lock")" ] \
  && flock -n 9; then
  if [ -e /proc/$$/fd/8 ]; then
    [ "$(readlink /proc/$$/fd/8)" = /run/resume-ai-locks/control-plane.lock ] \
      && [ "$(stat -Lc '%d:%i' /proc/$$/fd/8)" = "$(stat -c '%d:%i' /run/resume-ai-locks/control-plane.lock)" ] \
      && flock -n 8 \
      || fail "inherited descriptor 8 is not the held control-plane lock"
  else
    open_root_lock 8 control-plane
  fi
else
  open_root_lock 9 deploy
  open_root_lock 8 control-plane
fi

case "$SOURCE_ROOT" in /opt/resume-ai/releases/20??????T??????Z) ;; *) fail "source root is outside the managed release tree" ;; esac
RELEASE_ID=${SOURCE_ROOT##*/}
[ "$SOURCE_MANIFEST" = "/opt/resume-ai/release-artifacts/$RELEASE_ID/source-manifest.txt" ] \
  || fail "source manifest is not the immutable artifact for this release"
CANDIDATE_SPEC="$SOURCE_ROOT/ops/config/control-plane-files.conf"
for source_control in "$SOURCE_MANIFEST" "$CANDIDATE_SPEC"; do
  [ -f "$source_control" ] && [ ! -L "$source_control" ] \
    && [ "$(stat -c '%U:%h' "$source_control")" = root:1 ] \
    && [ -z "$(find "$source_control" -maxdepth 0 -perm /022 -print -quit)" ] \
    || fail "control-plane source evidence is unsafe: $source_control"
done

# Reject trust-anchor drift before creating a shadow directory, backup, or
# target. A malicious candidate verifier/spec therefore has neither execution
# nor write reach. Explicit upgrades use install-runtime-layout.sh with the
# separate ACK_CONTROL_PLANE_TRUST_ANCHOR_UPGRADE acknowledgement.
for anchor_pair in \
  "ops/bin/open-root-lock.sh:$TRUSTED_LOCK" \
  "ops/bin/verify-control-plane-generation.py:$TRUSTED_VERIFIER" \
  "ops/bin/install-control-plane-generation.sh:$TRUSTED_INSTALLER" \
  "ops/bin/recover-control-plane-generation.sh:$TRUSTED_RECOVERY" \
  "ops/config/control-plane-files.conf:$TRUSTED_SPEC"; do
  candidate_relative=${anchor_pair%%:*}
  installed_anchor=${anchor_pair#*:}
  candidate_anchor="$SOURCE_ROOT/$candidate_relative"
  [ -f "$candidate_anchor" ] && [ ! -L "$candidate_anchor" ] \
    && cmp -s "$candidate_anchor" "$installed_anchor" \
    || fail "candidate attempts an ordinary control-plane trust-anchor upgrade: $candidate_relative"
done

GENERATION="$(root_python "$TRUSTED_VERIFIER" --mode source \
  --source-root "$SOURCE_ROOT" --source-manifest "$SOURCE_MANIFEST" \
  --spec "$TRUSTED_SPEC" --candidate-spec "$CANDIDATE_SPEC")" \
  || fail "control-plane source generation is not trusted-spec/source-manifest bound"
[[ "$GENERATION" =~ ^[a-f0-9]{64}$ ]] || fail "control-plane source generation is malformed"

STATE_DIR=/opt/resume-ai/state
PENDING="$STATE_DIR/control-plane.pending"
INSTALLED_MANIFEST=/etc/resume-ai/control-plane-generation.env
STAGE_ROOT=/var/lib/resume-ai/control-plane-staging
BACKUP_ROOT=/var/backups/resume-ai/control-plane
for physical_root in "$STATE_DIR" /var/lib/resume-ai /var/backups/resume-ai; do
  [ -d "$physical_root" ] && [ ! -L "$physical_root" ] \
    && [ "$(readlink -e -- "$physical_root")" = "$physical_root" ] \
    || fail "control-plane transaction root is unsafe: $physical_root"
done

assert_target_directory() {
  local directory=$1
  [ -d "$directory" ] && [ ! -L "$directory" ] \
    && [ "$(readlink -e -- "$directory")" = "$directory" ] \
    && [ "$(stat -c '%U' "$directory")" = root ] \
    && [ -z "$(find "$directory" -maxdepth 0 -perm /022 -print -quit)" ] \
    || fail "control-plane target directory is unsafe or traverses a link: $directory"
}

read_active_release() {
  awk -F= '$1 == "ACTIVE_RELEASE" { print $2; count += 1 } END { if (count != 1) exit 2 }' \
    "$STATE_DIR/active.env"
}

verify_installed_release() {
  local release=$1 root="/opt/resume-ai/releases/$1"
  local source_manifest="/opt/resume-ai/release-artifacts/$1/source-manifest.txt"
  root_python "$TRUSTED_VERIFIER" --mode installed \
    --source-root "$root" --source-manifest "$source_manifest" \
    --spec "$TRUSTED_SPEC" --candidate-spec "$root/ops/config/control-plane-files.conf" \
    --installed-manifest "$INSTALLED_MANIFEST" >/dev/null
}

write_journal() {
  local kind=$1 phase=$2 old_release=$3 stage_dir=$4
  local stage_manifest_sha=$5 stage_sums_sha=$6 backup_dir=$7 backup_manifest_sha=$8
  local temporary
  temporary="$(mktemp "$STATE_DIR/.control-plane.XXXXXX")"
  cat > "$temporary" <<EOF
SCHEMA_VERSION=3
KIND=$kind
PHASE=$phase
OLD_RELEASE=$old_release
NEW_RELEASE=$RELEASE_ID
STAGE_DIR=$stage_dir
STAGE_MANIFEST_SHA256=$stage_manifest_sha
STAGE_SHA256SUMS_SHA256=$stage_sums_sha
BACKUP_DIR=$backup_dir
BACKUP_MANIFEST_SHA256=$backup_manifest_sha
GENERATION_SHA256=$GENERATION
EOF
  chown root:root "$temporary"
  chmod 0600 "$temporary"
  sync -f "$temporary"
  mv -f -- "$temporary" "$PENDING"
  sync -f "$STATE_DIR"
}

validate_stage() {
  local stage_dir=$1 expected_manifest_sha=$2 expected_sums_sha=$3
  [ -d "$stage_dir" ] && [ ! -L "$stage_dir" ] \
    && [ "$(readlink -e -- "$stage_dir")" = "$stage_dir" ] \
    && [ "$(stat -c '%U:%G:%a' "$stage_dir")" = root:root:700 ] \
    || fail "control-plane shadow stage is unsafe"
  for staged_control in trusted-spec.conf STAGE_MANIFEST control-plane-generation.env STAGE_SHA256SUMS; do
    [ -f "$stage_dir/$staged_control" ] && [ ! -L "$stage_dir/$staged_control" ] \
      && [ "$(stat -c '%U:%G:%h' "$stage_dir/$staged_control")" = root:root:1 ] \
      || fail "control-plane shadow metadata is unsafe: $staged_control"
  done
  [ "$(sha256sum "$stage_dir/STAGE_MANIFEST" | awk '{print $1}')" = "$expected_manifest_sha" ] \
    && [ "$(sha256sum "$stage_dir/STAGE_SHA256SUMS" | awk '{print $1}')" = "$expected_sums_sha" ] \
    && (cd "$stage_dir" && sha256sum --strict -c STAGE_SHA256SUMS >/dev/null) \
    || fail "control-plane shadow stage differs from its durable checksum contract"
  cmp -s "$stage_dir/trusted-spec.conf" "$TRUSTED_SPEC" \
    || fail "control-plane shadow allowlist differs from the installed trust anchor"
  grep -Fxq "RELEASE_ID=$RELEASE_ID" "$stage_dir/control-plane-generation.env" \
    && grep -Fxq "GENERATION_SHA256=$GENERATION" "$stage_dir/control-plane-generation.env" \
    || fail "control-plane shadow generation identity differs"

  local -a spec_rows=() manifest_rows=()
  mapfile -t spec_rows < <(awk -F '\t' '!/^($|#)/ { print }' "$TRUSTED_SPEC")
  mapfile -t manifest_rows < <(awk -F '\t' '!/^($|#)/ { print }' "$stage_dir/STAGE_MANIFEST")
  [ "${#spec_rows[@]}" -eq "${#manifest_rows[@]}" ] \
    || fail "control-plane shadow member count differs from the allowlist"
  local index mode relative target extra digest staged_mode staged_relative staged_target payload_name staged_extra payload
  for index in "${!spec_rows[@]}"; do
    IFS=$'\t' read -r mode relative target extra <<< "${spec_rows[$index]}"
    IFS=$'\t' read -r digest staged_mode staged_relative staged_target payload_name staged_extra \
      <<< "${manifest_rows[$index]}"
    [ -z "$extra$staged_extra" ] && [[ "$mode" =~ ^0[45-7][0-7]{2}$ ]] \
      && [[ "$digest" =~ ^[a-f0-9]{64}$ ]] && [ "$staged_mode" = "$mode" ] \
      && [ "$staged_relative" = "$relative" ] && [ "$staged_target" = "$target" ] \
      && [ "$payload_name" = "payload/$(printf '%04d' "$index")" ] \
      || fail "control-plane shadow row differs from the installed allowlist"
    payload="$stage_dir/$payload_name"
    [ -f "$payload" ] && [ ! -L "$payload" ] \
      && [ "$(stat -c '%U:%G:%a:%h' "$payload")" = root:root:600:1 ] \
      && [ "$(sha256sum "$payload" | awk '{print $1}')" = "$digest" ] \
      && cmp -s "$payload" "$SOURCE_ROOT/$relative" \
      || fail "control-plane shadow payload differs from the frozen candidate: $relative"
  done
}

stage_generation() {
  local kind=$1 old_release=$2 stage_dir="$STAGE_ROOT/$RELEASE_ID"
  [ ! -e "$PENDING" ] && [ ! -L "$PENDING" ] \
    || fail "an earlier control-plane generation requires recovery"
  install -d -o root -g root -m 0700 "$STAGE_ROOT"
  [ "$(readlink -e -- "$STAGE_ROOT")" = "$STAGE_ROOT" ] \
    && [ "$(stat -c '%U:%G:%a' "$STAGE_ROOT")" = root:root:700 ] \
    || fail "control-plane shadow root is unsafe"
  [ ! -e "$stage_dir" ] && [ ! -L "$stage_dir" ] \
    || fail "control-plane shadow stage already exists"
  install -d -o root -g root -m 0700 "$stage_dir" "$stage_dir/payload"
  install -o root -g root -m 0400 "$TRUSTED_SPEC" "$stage_dir/trusted-spec.conf"
  : > "$stage_dir/STAGE_MANIFEST"
  chmod 0600 "$stage_dir/STAGE_MANIFEST"
  local index=0 mode relative target extra digest payload_name
  while IFS=$'\t' read -r mode relative target extra || [ -n "$mode" ]; do
    case "$mode" in ''|'#'*) continue ;; esac
    [ -z "$extra" ] && [[ "$mode" =~ ^0[45-7][0-7]{2}$ ]] \
      || fail "malformed installed control-plane allowlist row"
    payload_name="payload/$(printf '%04d' "$index")"
    install -o root -g root -m 0600 "$SOURCE_ROOT/$relative" "$stage_dir/$payload_name"
    cmp -s "$SOURCE_ROOT/$relative" "$stage_dir/$payload_name" \
      || fail "control-plane shadow copy differs: $relative"
    digest="$(sha256sum "$stage_dir/$payload_name" | awk '{print $1}')"
    printf '%s\t%s\t%s\t%s\t%s\n' "$digest" "$mode" "$relative" "$target" "$payload_name" \
      >> "$stage_dir/STAGE_MANIFEST"
    index=$((index + 1))
  done < "$TRUSTED_SPEC"
  [ "$index" -ge 50 ] || fail "control-plane allowlist is unexpectedly incomplete"
  root_python "$TRUSTED_VERIFIER" --mode manifest \
    --source-root "$SOURCE_ROOT" --source-manifest "$SOURCE_MANIFEST" \
    --spec "$TRUSTED_SPEC" --candidate-spec "$CANDIDATE_SPEC" \
    > "$stage_dir/control-plane-generation.env"
  chown root:root "$stage_dir/control-plane-generation.env"
  chmod 0400 "$stage_dir/control-plane-generation.env"
  (
    cd "$stage_dir"
    find . -xdev -type f ! -name STAGE_SHA256SUMS \
      -printf '%P\0' | LC_ALL=C sort -z | xargs -0 sha256sum
  ) > "$stage_dir/STAGE_SHA256SUMS"
  chmod 0600 "$stage_dir/STAGE_SHA256SUMS"
  while IFS= read -r -d '' staged_file; do sync -f "$staged_file"; done \
    < <(find "$stage_dir" -xdev -type f -print0)
  sync -f "$stage_dir/payload"
  sync -f "$stage_dir"
  sync -f "$STAGE_ROOT"
  local stage_manifest_sha stage_sums_sha
  stage_manifest_sha="$(sha256sum "$stage_dir/STAGE_MANIFEST" | awk '{print $1}')"
  stage_sums_sha="$(sha256sum "$stage_dir/STAGE_SHA256SUMS" | awk '{print $1}')"
  validate_stage "$stage_dir" "$stage_manifest_sha" "$stage_sums_sha"
  write_journal "$kind" staged "$old_release" "$stage_dir" \
    "$stage_manifest_sha" "$stage_sums_sha" none none
  printf '%s\n' "Staged control-plane shadow $GENERATION for $RELEASE_ID without changing live controls."
}

load_pending() {
  local expected_phase=$1
  [ -f "$PENDING" ] && [ ! -L "$PENDING" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$PENDING")" = root:root:600:1 ] \
    || fail "staged control-plane journal is missing or unsafe"
  declare -gA journal=()
  local key value
  while IFS='=' read -r key value || [ -n "$key" ]; do
    case "$key" in
      SCHEMA_VERSION|KIND|PHASE|OLD_RELEASE|NEW_RELEASE|STAGE_DIR|STAGE_MANIFEST_SHA256|STAGE_SHA256SUMS_SHA256|BACKUP_DIR|BACKUP_MANIFEST_SHA256|GENERATION_SHA256) ;;
      *) fail "unknown control-plane journal key" ;;
    esac
    [ -z "${journal[$key]:-}" ] && [ -n "$value" ] \
      || fail "duplicate or empty control-plane journal value"
    journal[$key]=$value
  done < "$PENDING"
  [ "${#journal[@]}" -eq 11 ] && [ "${journal[SCHEMA_VERSION]:-}" = 3 ] \
    && [[ "${journal[KIND]:-}" =~ ^(bootstrap|stage)$ ]] \
    && [ "${journal[PHASE]:-}" = "$expected_phase" ] \
    && [ "${journal[NEW_RELEASE]:-}" = "$RELEASE_ID" ] \
    && [ "${journal[GENERATION_SHA256]:-}" = "$GENERATION" ] \
    && [[ "${journal[OLD_RELEASE]:-}" =~ ^20[0-9]{6}T[0-9]{6}Z$ ]] \
    && [ "${journal[STAGE_DIR]:-}" = "$STAGE_ROOT/$RELEASE_ID" ] \
    && [[ "${journal[STAGE_MANIFEST_SHA256]:-}" =~ ^[a-f0-9]{64}$ ]] \
    && [[ "${journal[STAGE_SHA256SUMS_SHA256]:-}" =~ ^[a-f0-9]{64}$ ]] \
    || fail "$expected_phase control-plane journal is malformed or differs from the requested target"
  if [ "$expected_phase" = staged ]; then
    [ "${journal[BACKUP_DIR]:-}" = none ] \
      && [ "${journal[BACKUP_MANIFEST_SHA256]:-}" = none ] \
      || fail "staged control-plane journal unexpectedly names a live backup"
  else
    case "${journal[BACKUP_DIR]:-}" in
      /var/backups/resume-ai/control-plane/20??????T??????Z.??????) ;;
      *) fail "installed control-plane journal has an invalid backup path" ;;
    esac
    [[ "${journal[BACKUP_MANIFEST_SHA256]:-}" =~ ^[a-f0-9]{64}$ ]] \
      || fail "installed control-plane journal has an invalid backup digest"
  fi
}

backup_target() {
  local target=$1 backup_dir=$2 identity state
  identity="$(printf '%s' "$target" | sha256sum | awk '{print $1}')"
  state="$backup_dir/$identity.state"
  if [ -e "$target" ] || [ -L "$target" ]; then
    [ -f "$target" ] && [ ! -L "$target" ] \
      && [ "$(stat -c '%U:%G:%h' "$target")" = root:root:1 ] \
      || fail "installed control-plane target is unsafe: $target"
    cp -a -- "$target" "$backup_dir/$identity.file"
    printf '%s\n' present > "$state"
  else
    printf '%s\n' absent > "$state"
  fi
  chmod 0600 "$state"
}

commit_generation() {
  load_pending staged
  local stage_dir=${journal[STAGE_DIR]} old_release=${journal[OLD_RELEASE]}
  validate_stage "$stage_dir" "${journal[STAGE_MANIFEST_SHA256]}" \
    "${journal[STAGE_SHA256SUMS_SHA256]}"
  [ "$(readlink -e /opt/resume-ai/current)" = "$SOURCE_ROOT" ] \
    || fail "control-plane commit target is not the fixed active release"

  install -d -o root -g root -m 0700 "$BACKUP_ROOT"
  [ "$(readlink -e -- "$BACKUP_ROOT")" = "$BACKUP_ROOT" ] \
    && [ "$(stat -c '%U:%G:%a' "$BACKUP_ROOT")" = root:root:700 ] \
    || fail "control-plane backup root is unsafe"
  local backup_dir
  backup_dir="$(mktemp -d "$BACKUP_ROOT/$RELEASE_ID.XXXXXX")"
  chown root:root "$backup_dir"
  chmod 0700 "$backup_dir"
  local mode relative target extra
  while IFS=$'\t' read -r mode relative target extra || [ -n "$mode" ]; do
    case "$mode" in ''|'#'*) continue ;; esac
    [ -z "$extra" ] && [[ "$mode" =~ ^0[45-7][0-7]{2}$ ]] \
      || fail "malformed trusted control-plane row before backup"
    assert_target_directory "${target%/*}"
    backup_target "$target" "$backup_dir"
  done < "$stage_dir/trusted-spec.conf"
  assert_target_directory "${INSTALLED_MANIFEST%/*}"
  backup_target "$INSTALLED_MANIFEST" "$backup_dir"
  (
    cd "$backup_dir"
    find . -xdev -mindepth 1 -maxdepth 1 -type f ! -name BACKUP_SHA256SUMS \
      -printf '%P\0' | LC_ALL=C sort -z | xargs -0 sha256sum
  ) > "$backup_dir/BACKUP_SHA256SUMS"
  chmod 0600 "$backup_dir/BACKUP_SHA256SUMS"
  local backup_manifest_sha
  backup_manifest_sha="$(sha256sum "$backup_dir/BACKUP_SHA256SUMS" | awk '{print $1}')"
  (cd "$backup_dir" && sha256sum --strict -c BACKUP_SHA256SUMS >/dev/null) \
    || fail "control-plane backup does not verify before publication"
  while IFS= read -r -d '' backup_file; do sync -f "$backup_file"; done \
    < <(find "$backup_dir" -xdev -type f -print0)
  sync -f "$backup_dir"
  sync -f "$BACKUP_ROOT"
  write_journal "${journal[KIND]}" prepared "$old_release" "$stage_dir" \
    "${journal[STAGE_MANIFEST_SHA256]}" "${journal[STAGE_SHA256SUMS_SHA256]}" \
    "$backup_dir" "$backup_manifest_sha"

  restore_on_failure() {
    local status=$?
    trap - ERR EXIT
    set +e
    "$TRUSTED_RECOVERY" >/dev/null 2>&1 \
      || printf '%s\n' "Control-plane recovery incomplete; durable journal retained." >&2
    exit "$status"
  }
  trap restore_on_failure ERR EXIT
  write_journal "${journal[KIND]}" installing "$old_release" "$stage_dir" \
    "${journal[STAGE_MANIFEST_SHA256]}" "${journal[STAGE_SHA256SUMS_SHA256]}" \
    "$backup_dir" "$backup_manifest_sha"

  local digest payload_name staged_extra temporary directory
  while IFS=$'\t' read -r digest mode relative target payload_name staged_extra || [ -n "$digest" ]; do
    case "$digest" in ''|'#'*) continue ;; esac
    [ -z "$staged_extra" ] && [[ "$digest" =~ ^[a-f0-9]{64}$ ]] \
      || fail "malformed control-plane shadow row during commit"
    directory=${target%/*}
    assert_target_directory "$directory"
    temporary="$(mktemp "$directory/.${target##*/}.control.XXXXXX")"
    install -o root -g root -m "$mode" "$stage_dir/$payload_name" "$temporary"
    [ "$(sha256sum "$temporary" | awk '{print $1}')" = "$digest" ] \
      || fail "installed control temporary differs: $target"
    sync -f "$temporary"
    mv -f -- "$temporary" "$target"
    sync -f "$directory"
  done < "$stage_dir/STAGE_MANIFEST"

  temporary="$(mktemp /etc/resume-ai/.control-plane-generation.XXXXXX)"
  install -o root -g root -m 0400 "$stage_dir/control-plane-generation.env" "$temporary"
  sync -f "$temporary"
  mv -f -- "$temporary" "$INSTALLED_MANIFEST"
  sync -f /etc/resume-ai
  systemctl daemon-reload
  udevadm control --reload

  while IFS=$'\t' read -r digest mode relative target payload_name staged_extra || [ -n "$digest" ]; do
    case "$digest" in ''|'#'*) continue ;; esac
    [ -z "$staged_extra" ] && [ -f "$target" ] && [ ! -L "$target" ] \
      && [ "$(stat -c '%U:%G:%a:%h' "$target")" = "root:root:${mode#0}:1" ] \
      && [ "$(sha256sum "$target" | awk '{print $1}')" = "$digest" ] \
      || fail "committed control differs from the shadow generation: $target"
  done < "$stage_dir/STAGE_MANIFEST"
  cmp -s "$stage_dir/control-plane-generation.env" "$INSTALLED_MANIFEST" \
    || fail "installed control-plane manifest differs from the shadow generation"
  write_journal "${journal[KIND]}" installed "$old_release" "$stage_dir" \
    "${journal[STAGE_MANIFEST_SHA256]}" "${journal[STAGE_SHA256SUMS_SHA256]}" \
    "$backup_dir" "$backup_manifest_sha"
  trap - ERR EXIT
  printf '%s\n' "Installed rollbackable control-plane generation $GENERATION for $RELEASE_ID without executing candidate controls."
}

finalize_generation() {
  load_pending installed
  local stage_dir=${journal[STAGE_DIR]} backup_dir=${journal[BACKUP_DIR]}
  validate_stage "$stage_dir" "${journal[STAGE_MANIFEST_SHA256]}" \
    "${journal[STAGE_SHA256SUMS_SHA256]}"
  [ -d "$backup_dir" ] && [ ! -L "$backup_dir" ] \
    && [ "$(readlink -e -- "$backup_dir")" = "$backup_dir" ] \
    && [ "$(stat -c '%U:%G:%a' "$backup_dir")" = root:root:700 ] \
    && [ -f "$backup_dir/BACKUP_SHA256SUMS" ] \
    && [ ! -L "$backup_dir/BACKUP_SHA256SUMS" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$backup_dir/BACKUP_SHA256SUMS")" = root:root:600:1 ] \
    && [ "$(sha256sum "$backup_dir/BACKUP_SHA256SUMS" | awk '{print $1}')" = "${journal[BACKUP_MANIFEST_SHA256]}" ] \
    && (cd "$backup_dir" && sha256sum --strict -c BACKUP_SHA256SUMS >/dev/null) \
    || fail "control-plane rollback receipt is incomplete before finalization"
  [ "$(readlink -e /opt/resume-ai/current)" = "$SOURCE_ROOT" ] \
    || fail "control-plane finalize target is not the fixed active release"
  verify_installed_release "$RELEASE_ID" \
    || fail "control-plane finalize requires the exact installed candidate generation"

  local deploy_pending="$STATE_DIR/deploy.pending"
  [ -f "$deploy_pending" ] && [ ! -L "$deploy_pending" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$deploy_pending")" = root:resume-ai:640:1 ] \
    || fail "control-plane finalize requires the durable deployment journal"
  root_python - "$deploy_pending" "$RELEASE_ID" <<'PY'
import pathlib
import hashlib
import stat
import sys

allowed = {
    "KIND", "PHASE", "OLD_ACTIVE_PORT", "OLD_ACTIVE_RELEASE",
    "OLD_PREVIOUS_PORT", "OLD_PREVIOUS_RELEASE", "NEW_PORT", "NEW_RELEASE",
    "NEW_PREVIOUS_PORT", "NEW_PREVIOUS_RELEASE", "APPROVAL_FILE_SHA256",
}
values = {}
for line in pathlib.Path(sys.argv[1]).read_text(encoding="utf-8").splitlines():
    if "=" not in line:
        raise SystemExit("deployment journal contains a malformed row")
    key, value = line.split("=", 1)
    if key not in allowed or key in values or not value:
        raise SystemExit("deployment journal contains an unknown, duplicate, or empty value")
    values[key] = value
if (set(values) != allowed or values["KIND"] not in {"deploy", "rollback", "initialize"}
        or values["PHASE"] != "state_committed" or values["NEW_RELEASE"] != sys.argv[2]
        or __import__("re").fullmatch(r"[a-f0-9]{64}", values["APPROVAL_FILE_SHA256"]) is None):
    raise SystemExit("deployment journal does not authorize control-plane finalization")
approval = pathlib.Path(f"/etc/resume-ai/approved-releases/{sys.argv[2]}.env")
metadata = approval.lstat()
if (not stat.S_ISREG(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode)
        or metadata.st_uid != 0 or metadata.st_gid != 0 or metadata.st_nlink != 1
        or stat.S_IMODE(metadata.st_mode) != 0o400
        or hashlib.sha256(approval.read_bytes()).hexdigest() != values["APPROVAL_FILE_SHA256"]):
    raise SystemExit("deployment journal approval changed before control-plane finalization")
PY

  # Finalization does not alter a live control byte.  It only retires the
  # rollback receipt after a same-generation host gate has succeeded while the
  # state_committed deployment journal remains durable.
  unlink "$PENDING"
  sync -f "$STATE_DIR"
  find "$stage_dir" -xdev -depth -delete
  sync -f "$STAGE_ROOT"
  verify_installed_release "$RELEASE_ID" \
    || fail "control-plane generation changed while its rollback receipt was finalized"
  printf '%s\n' "Finalized control-plane generation $GENERATION for $RELEASE_ID."
}

ACTIVE_RELEASE="$(read_active_release)" || fail "active release identity is unavailable"
case "$ACTIVE_RELEASE" in 20??????T??????Z) ;; *) fail "active release identity is invalid" ;; esac
case "$ACTION" in
  stage)
    [ "$ACTIVE_RELEASE" != "$RELEASE_ID" ] \
      || fail "refusing to stage the already active control generation"
    if [ -f "$INSTALLED_MANIFEST" ] && [ ! -L "$INSTALLED_MANIFEST" ]; then
      verify_installed_release "$ACTIVE_RELEASE" \
        || fail "installed controls do not match the currently active release"
    else
      [ ! -e "$INSTALLED_MANIFEST" ] && [ ! -L "$INSTALLED_MANIFEST" ] \
        || fail "existing control-plane generation marker is unsafe"
      [ "${ACK_ADOPT_UNMANAGED_CONTROL_PLANE:-}" = YES ] \
        || fail "first control-plane adoption requires ACK_ADOPT_UNMANAGED_CONTROL_PLANE=YES"
    fi
    stage_generation stage "$ACTIVE_RELEASE"
    ;;
  commit)
    commit_generation
    ;;
  finalize)
    finalize_generation
    ;;
  bootstrap)
    [ "$ACTIVE_RELEASE" = "$RELEASE_ID" ] \
      || fail "control-plane bootstrap must target the fixed active release"
    [ ! -e "$INSTALLED_MANIFEST" ] && [ ! -L "$INSTALLED_MANIFEST" ] \
      || fail "control-plane bootstrap requires an absent generation manifest"
    stage_generation bootstrap "$ACTIVE_RELEASE"
    commit_generation
    ;;
esac
