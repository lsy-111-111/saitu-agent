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
[ "$#" -eq 0 ] || fail "control-plane recovery accepts no arguments"
command -v udevadm >/dev/null 2>&1 || fail "udevadm is unavailable"

TRUSTED_ROOT=/usr/local/lib/resume-ai
TRUSTED_RECOVERY="$TRUSTED_ROOT/recover-control-plane-generation.sh"
TRUSTED_INSTALLER="$TRUSTED_ROOT/install-control-plane-generation.sh"
TRUSTED_VERIFIER="$TRUSTED_ROOT/verify-control-plane-generation.py"
TRUSTED_LOCK="$TRUSTED_ROOT/open-root-lock.sh"
TRUSTED_SPEC=/usr/local/share/resume-ai/control-plane-files.conf
assert_trust_anchor() {
  local path=$1 mode=$2
  [ -f "$path" ] && [ ! -L "$path" ] \
    && [ "$(readlink -e -- "$path")" = "$path" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$path")" = "root:root:$mode:1" ] \
    || fail "installed recovery trust anchor is missing or unsafe: $path"
}
assert_trust_anchor "$TRUSTED_RECOVERY" 755
assert_trust_anchor "$TRUSTED_INSTALLER" 755
assert_trust_anchor "$TRUSTED_VERIFIER" 755
assert_trust_anchor "$TRUSTED_LOCK" 755
assert_trust_anchor "$TRUSTED_SPEC" 444
[ "$(readlink -e -- "$TRUSTED_RECOVERY")" = "$(readlink -e -- "${BASH_SOURCE[0]}")" ] \
  || fail "control-plane recovery must use the installed trust anchor"
. "$TRUSTED_LOCK"

deploy_lock=/run/resume-ai-locks/deploy.lock
control_lock=/run/resume-ai-locks/control-plane.lock
if [ -e /proc/$$/fd/9 ] \
  && [ "$(readlink /proc/$$/fd/9)" = "$deploy_lock" ] \
  && [ "$(stat -Lc '%d:%i' /proc/$$/fd/9)" = "$(stat -c '%d:%i' "$deploy_lock")" ] \
  && flock -n 9; then
  if [ -e /proc/$$/fd/8 ]; then
    [ "$(readlink /proc/$$/fd/8)" = "$control_lock" ] \
      && [ "$(stat -Lc '%d:%i' /proc/$$/fd/8)" = "$(stat -c '%d:%i' "$control_lock")" ] \
      && flock -n 8 \
      || fail "inherited descriptor 8 is not the held control-plane lock"
  else
    open_root_lock 8 control-plane
  fi
else
  open_root_lock 9 deploy
  open_root_lock 8 control-plane
fi

STATE_DIR=/opt/resume-ai/state
PENDING="$STATE_DIR/control-plane.pending"
INSTALLED_MANIFEST=/etc/resume-ai/control-plane-generation.env
[ -e "$PENDING" ] || exit 0
[ -f "$PENDING" ] && [ ! -L "$PENDING" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$PENDING")" = root:root:600:1 ] \
  || fail "control-plane recovery journal is unsafe"
declare -A journal=()
while IFS='=' read -r key value || [ -n "$key" ]; do
  case "$key" in
    SCHEMA_VERSION|KIND|PHASE|OLD_RELEASE|NEW_RELEASE|STAGE_DIR|STAGE_MANIFEST_SHA256|STAGE_SHA256SUMS_SHA256|BACKUP_DIR|BACKUP_MANIFEST_SHA256|GENERATION_SHA256) ;;
    *) fail "unknown control-plane recovery journal key" ;;
  esac
  [ -z "${journal[$key]:-}" ] && [ -n "$value" ] \
    || fail "duplicate or empty control-plane recovery journal value"
  journal[$key]=$value
done < "$PENDING"
[ "${#journal[@]}" -eq 11 ] && [ "${journal[SCHEMA_VERSION]:-}" = 3 ] \
  && [[ "${journal[KIND]:-}" =~ ^(bootstrap|stage)$ ]] \
  && [[ "${journal[PHASE]:-}" =~ ^(staged|prepared|installing|installed)$ ]] \
  && [[ "${journal[OLD_RELEASE]:-}" =~ ^20[0-9]{6}T[0-9]{6}Z$ ]] \
  && [[ "${journal[NEW_RELEASE]:-}" =~ ^20[0-9]{6}T[0-9]{6}Z$ ]] \
  && [ "${journal[OLD_RELEASE]}" != "${journal[NEW_RELEASE]}" -o "${journal[KIND]}" = bootstrap ] \
  && [ "${journal[STAGE_DIR]:-}" = "/var/lib/resume-ai/control-plane-staging/${journal[NEW_RELEASE]}" ] \
  && [[ "${journal[STAGE_MANIFEST_SHA256]:-}" =~ ^[a-f0-9]{64}$ ]] \
  && [[ "${journal[STAGE_SHA256SUMS_SHA256]:-}" =~ ^[a-f0-9]{64}$ ]] \
  && [[ "${journal[GENERATION_SHA256]:-}" =~ ^[a-f0-9]{64}$ ]] \
  || fail "control-plane recovery journal is malformed"

OLD_RELEASE=${journal[OLD_RELEASE]}
NEW_RELEASE=${journal[NEW_RELEASE]}
PHASE=${journal[PHASE]}
STAGE_DIR=${journal[STAGE_DIR]}
[ -d "$STAGE_DIR" ] && [ ! -L "$STAGE_DIR" ] \
  && [ "$(readlink -e -- "$STAGE_DIR")" = "$STAGE_DIR" ] \
  && [ "$(stat -c '%U:%G:%a' "$STAGE_DIR")" = root:root:700 ] \
  || fail "control-plane recovery shadow stage is unsafe"
for stage_file in trusted-spec.conf STAGE_MANIFEST control-plane-generation.env STAGE_SHA256SUMS; do
  [ -f "$STAGE_DIR/$stage_file" ] && [ ! -L "$STAGE_DIR/$stage_file" ] \
    && [ "$(stat -c '%U:%G:%h' "$STAGE_DIR/$stage_file")" = root:root:1 ] \
    || fail "control-plane recovery shadow metadata is unsafe: $stage_file"
done
[ "$(sha256sum "$STAGE_DIR/STAGE_MANIFEST" | awk '{print $1}')" = "${journal[STAGE_MANIFEST_SHA256]}" ] \
  && [ "$(sha256sum "$STAGE_DIR/STAGE_SHA256SUMS" | awk '{print $1}')" = "${journal[STAGE_SHA256SUMS_SHA256]}" ] \
  && (cd "$STAGE_DIR" && sha256sum --strict -c STAGE_SHA256SUMS >/dev/null) \
  && cmp -s "$STAGE_DIR/trusted-spec.conf" "$TRUSTED_SPEC" \
  && grep -Fxq "RELEASE_ID=$NEW_RELEASE" "$STAGE_DIR/control-plane-generation.env" \
  && grep -Fxq "GENERATION_SHA256=${journal[GENERATION_SHA256]}" "$STAGE_DIR/control-plane-generation.env" \
  || fail "control-plane recovery shadow stage differs from its journal"

declare -a spec_rows=() manifest_rows=()
mapfile -t spec_rows < <(awk -F '\t' '!/^($|#)/ { print }' "$TRUSTED_SPEC")
mapfile -t manifest_rows < <(awk -F '\t' '!/^($|#)/ { print }' "$STAGE_DIR/STAGE_MANIFEST")
[ "${#spec_rows[@]}" -eq "${#manifest_rows[@]}" ] && [ "${#spec_rows[@]}" -ge 50 ] \
  || fail "control-plane recovery shadow member count differs"
for index in "${!spec_rows[@]}"; do
  IFS=$'\t' read -r mode relative target extra <<< "${spec_rows[$index]}"
  IFS=$'\t' read -r digest staged_mode staged_relative staged_target payload_name staged_extra \
    <<< "${manifest_rows[$index]}"
  [ -z "$extra$staged_extra" ] && [[ "$mode" =~ ^0[45-7][0-7]{2}$ ]] \
    && [[ "$digest" =~ ^[a-f0-9]{64}$ ]] && [ "$staged_mode" = "$mode" ] \
    && [ "$staged_relative" = "$relative" ] && [ "$staged_target" = "$target" ] \
    && [ "$payload_name" = "payload/$(printf '%04d' "$index")" ] \
    && [ -f "$STAGE_DIR/$payload_name" ] && [ ! -L "$STAGE_DIR/$payload_name" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$STAGE_DIR/$payload_name")" = root:root:600:1 ] \
    && [ "$(sha256sum "$STAGE_DIR/$payload_name" | awk '{print $1}')" = "$digest" ] \
    || fail "control-plane recovery shadow row is malformed"
done

ACTIVE_RELEASE="$(awk -F= '$1 == "ACTIVE_RELEASE" { print $2; count += 1 } END { if (count != 1) exit 2 }' \
  "$STATE_DIR/active.env")" || fail "active release is unavailable during control recovery"
case "$ACTIVE_RELEASE" in 20??????T??????Z) ;; *) fail "active release is malformed during control recovery" ;; esac

RECOVERY_DIRECTION=
APPROVAL_FILE_SHA256=
REQUIRED_TEST_POLICY_SHA256=
DEPLOY_PENDING="$STATE_DIR/deploy.pending"
APPROVAL_FILE="/etc/resume-ai/approved-releases/$NEW_RELEASE.env"
[ -f "$DEPLOY_PENDING" ] && [ ! -L "$DEPLOY_PENDING" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$DEPLOY_PENDING")" = root:resume-ai:640:1 ] \
  || fail "control-plane recovery requires the durable deployment journal"
[ -f "$APPROVAL_FILE" ] && [ ! -L "$APPROVAL_FILE" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$APPROVAL_FILE")" = root:root:400:1 ] \
  || fail "control-plane recovery approval is missing or unsafe"
read -r RECOVERY_DIRECTION APPROVAL_FILE_SHA256 REQUIRED_TEST_POLICY_SHA256 < <(root_python - \
  "$DEPLOY_PENDING" "$APPROVAL_FILE" "${journal[KIND]}" \
  "$OLD_RELEASE" "$NEW_RELEASE" "$ACTIVE_RELEASE" <<'PY'
import hashlib
import datetime
import pathlib
import re
import sys

deploy_allowed = {
    "KIND", "PHASE", "OLD_ACTIVE_PORT", "OLD_ACTIVE_RELEASE",
    "OLD_PREVIOUS_PORT", "OLD_PREVIOUS_RELEASE", "NEW_PORT", "NEW_RELEASE",
    "NEW_PREVIOUS_PORT", "NEW_PREVIOUS_RELEASE", "APPROVAL_FILE_SHA256",
}
deploy = {}
for line in pathlib.Path(sys.argv[1]).read_text(encoding="utf-8").splitlines():
    if "=" not in line:
        raise SystemExit(2)
    key, value = line.split("=", 1)
    if key not in deploy_allowed or key in deploy or not value:
        raise SystemExit(2)
    deploy[key] = value
if set(deploy) != deploy_allowed:
    raise SystemExit(2)

approval_allowed = {
    "SCHEMA_VERSION", "RELEASE_ID", "RELEASE_MANIFEST_SHA256",
    "SOURCE_MANIFEST_SHA256", "SHA256SUMS_SHA256",
    "CONTROL_PLANE_SPEC_SHA256", "EVIDENCE_HELPER_SHA256",
    "TRUSTED_DEEP_SCAN_ATTESTATION_SHA256",
    "TRUSTED_DEEP_SCAN_PRODUCER_SHA256",
    "TRUSTED_DEEP_SCAN_COMPLETION_SHA256",
    "LINUX_VALIDATION_ATTESTATION_SHA256",
    "REQUIRED_TEST_POLICY_SHA256", "APPROVED_AT",
}
approval_path = pathlib.Path(sys.argv[2])
approval = {}
approval_bytes = approval_path.read_bytes()
for line in approval_bytes.decode("utf-8").splitlines():
    if "=" not in line:
        raise SystemExit(2)
    key, value = line.split("=", 1)
    if key not in approval_allowed or key in approval or not value:
        raise SystemExit(2)
    approval[key] = value
approval_hash = hashlib.sha256(approval_bytes).hexdigest()
if (set(approval) != approval_allowed or approval["SCHEMA_VERSION"] != "6"
        or approval["RELEASE_ID"] != sys.argv[5]
        or deploy["APPROVAL_FILE_SHA256"] != approval_hash
        or any(re.fullmatch(r"[a-f0-9]{64}", approval[key]) is None for key in (
            "RELEASE_MANIFEST_SHA256", "SOURCE_MANIFEST_SHA256", "SHA256SUMS_SHA256",
            "CONTROL_PLANE_SPEC_SHA256", "EVIDENCE_HELPER_SHA256",
            "TRUSTED_DEEP_SCAN_ATTESTATION_SHA256",
            "TRUSTED_DEEP_SCAN_PRODUCER_SHA256",
            "TRUSTED_DEEP_SCAN_COMPLETION_SHA256",
            "LINUX_VALIDATION_ATTESTATION_SHA256",
            "REQUIRED_TEST_POLICY_SHA256",
        ))):
    raise SystemExit(2)
try:
    approved_at = datetime.datetime.strptime(
        approval["APPROVED_AT"], "%Y-%m-%dT%H:%M:%SZ"
    )
except ValueError:
    raise SystemExit(2)
if approved_at.strftime("%Y-%m-%dT%H:%M:%SZ") != approval["APPROVED_AT"]:
    raise SystemExit(2)

control_kind, old_release, new_release, active_release = sys.argv[3:7]
if deploy["NEW_RELEASE"] != new_release:
    raise SystemExit(2)
release_pattern = r"20[0-9]{6}T[0-9]{6}Z"
def valid_port_release(port, release, *, allow_none=False):
    if allow_none and port == release == "none":
        return True
    return port in {"3000", "3001"} and re.fullmatch(release_pattern, release) is not None

if not valid_port_release(deploy["NEW_PORT"], deploy["NEW_RELEASE"]):
    raise SystemExit(2)
phase = deploy["PHASE"]
if control_kind == "bootstrap":
    if not (
        deploy["KIND"] == "initialize"
        and phase == "state_committed"
        and old_release == new_release == active_release
        and deploy["OLD_ACTIVE_PORT"] == "none"
        and deploy["OLD_ACTIVE_RELEASE"] == "none"
        and deploy["OLD_PREVIOUS_PORT"] == "none"
        and deploy["OLD_PREVIOUS_RELEASE"] == "none"
        and deploy["NEW_PREVIOUS_PORT"] == "none"
        and deploy["NEW_PREVIOUS_RELEASE"] == "none"
    ):
        raise SystemExit(2)
    direction = "forward"
else:
    if (deploy["KIND"] not in {"deploy", "rollback"}
            or deploy["OLD_ACTIVE_RELEASE"] != old_release
            or active_release not in {old_release, new_release}
            or not valid_port_release(deploy["OLD_ACTIVE_PORT"], deploy["OLD_ACTIVE_RELEASE"])
            or not valid_port_release(
                deploy["OLD_PREVIOUS_PORT"], deploy["OLD_PREVIOUS_RELEASE"], allow_none=True
            )
            or deploy["NEW_PREVIOUS_PORT"] != deploy["OLD_ACTIVE_PORT"]
            or deploy["NEW_PREVIOUS_RELEASE"] != deploy["OLD_ACTIVE_RELEASE"]
            or deploy["NEW_PORT"] == deploy["OLD_ACTIVE_PORT"]):
        raise SystemExit(2)
    if deploy["KIND"] == "rollback":
        if (deploy["OLD_PREVIOUS_RELEASE"] == "none"
                or deploy["NEW_PORT"] != deploy["OLD_PREVIOUS_PORT"]
                or deploy["NEW_RELEASE"] != deploy["OLD_PREVIOUS_RELEASE"]
                or phase in {"publishing", "hardening_started", "permissions_hardened"}):
            raise SystemExit(2)
    elif (new_release in {old_release, deploy["OLD_PREVIOUS_RELEASE"]}
            or phase == "publishing" and active_release != old_release):
        raise SystemExit(2)
    if phase == "state_committed" or (
        deploy["KIND"] == "deploy"
        and phase in {"hardening_started", "permissions_hardened"}
    ):
        direction = "forward"
        if active_release != new_release:
            raise SystemExit(2)
    elif phase in {"publishing", "prepared", "nginx_switched", "rollback_decided"}:
        direction = "rollback"
    else:
        raise SystemExit(2)
print(direction, approval_hash, approval["REQUIRED_TEST_POLICY_SHA256"])
PY
) || fail "deployment journal and schema-6 approval do not decide control recovery"
case "$RECOVERY_DIRECTION:$APPROVAL_FILE_SHA256:$REQUIRED_TEST_POLICY_SHA256" in
  forward:[a-f0-9][a-f0-9]*:[a-f0-9][a-f0-9]*|rollback:[a-f0-9][a-f0-9]*:[a-f0-9][a-f0-9]*) ;;
  *) fail "control-plane recovery decision is malformed" ;;
esac
[[ "$APPROVAL_FILE_SHA256" =~ ^[a-f0-9]{64}$ ]] \
  || fail "control-plane recovery approval digest is malformed"
[[ "$REQUIRED_TEST_POLICY_SHA256" =~ ^[a-f0-9]{64}$ ]] \
  || fail "control-plane recovery required-test policy digest is malformed"
[ "$(sha256sum "$APPROVAL_FILE" | awk '{print $1}')" = "$APPROVAL_FILE_SHA256" ] \
  || fail "control-plane recovery approval changed after its decision"
NEW_SOURCE_MANIFEST="/opt/resume-ai/release-artifacts/$NEW_RELEASE/source-manifest.txt"
[ -f "$NEW_SOURCE_MANIFEST" ] && [ ! -L "$NEW_SOURCE_MANIFEST" ] \
  && [ "$(stat -c '%U:%h' "$NEW_SOURCE_MANIFEST")" = root:1 ] \
  && [ -z "$(find "$NEW_SOURCE_MANIFEST" -maxdepth 0 -perm /022 -print -quit)" ] \
  || fail "control-plane recovery source manifest is missing or unsafe"
observed_required_test_policy_sha="$(root_python - "$NEW_SOURCE_MANIFEST" <<'PY'
import pathlib
import re
import sys

observed = None
for line in pathlib.Path(sys.argv[1]).read_text(encoding="utf-8").splitlines():
    match = re.fullmatch(r"([a-f0-9]{64})\t([FL])\t([^\t\r\n]+)", line)
    if match is None:
        raise SystemExit(2)
    digest, kind, relative = match.groups()
    if relative == "ops/config/release-required-tests.json":
        if kind != "F" or observed is not None:
            raise SystemExit(2)
        observed = digest
if observed is None:
    raise SystemExit(2)
print(observed)
PY
)" || fail "control-plane recovery source manifest lacks one required-test policy row"
[ "$observed_required_test_policy_sha" = "$REQUIRED_TEST_POLICY_SHA256" ] \
  || fail "control-plane recovery source policy differs from root approval"
stage_required_test_policy_sha="$(awk -F '\t' '
  $3 == "ops/config/release-required-tests.json" && $4 == "/usr/local/lib/resume-ai/release-required-tests.json" {
    value = $1; count += 1
  }
  END { if (count != 1) exit 2; print value }
' "$STAGE_DIR/STAGE_MANIFEST")" \
  || fail "control-plane recovery shadow lacks one required-test policy row"
[ "$stage_required_test_policy_sha" = "$REQUIRED_TEST_POLICY_SHA256" ] \
  || fail "control-plane recovery shadow policy differs from root approval"

assert_installed_required_test_policy() {
  [ -f /usr/local/lib/resume-ai/release-required-tests.json ] \
    && [ ! -L /usr/local/lib/resume-ai/release-required-tests.json ] \
    && [ "$(stat -c '%U:%G:%a:%h' /usr/local/lib/resume-ai/release-required-tests.json)" = root:root:444:1 ] \
    && [ "$(sha256sum /usr/local/lib/resume-ai/release-required-tests.json | awk '{print $1}')" = "$REQUIRED_TEST_POLICY_SHA256" ] \
    || fail "forward-recovered required-test policy differs from root approval"
}

cleanup_stage_and_journal() {
  unlink "$PENDING"
  sync -f "$STATE_DIR"
  find "$STAGE_DIR" -xdev -depth -delete
  sync -f /var/lib/resume-ai/control-plane-staging
}

write_installed_journal() {
  local temporary
  temporary="$(mktemp "$STATE_DIR/.control-plane-recovery.XXXXXX")"
  cat > "$temporary" <<EOF
SCHEMA_VERSION=3
KIND=${journal[KIND]}
PHASE=installed
OLD_RELEASE=$OLD_RELEASE
NEW_RELEASE=$NEW_RELEASE
STAGE_DIR=$STAGE_DIR
STAGE_MANIFEST_SHA256=${journal[STAGE_MANIFEST_SHA256]}
STAGE_SHA256SUMS_SHA256=${journal[STAGE_SHA256SUMS_SHA256]}
BACKUP_DIR=${journal[BACKUP_DIR]}
BACKUP_MANIFEST_SHA256=${journal[BACKUP_MANIFEST_SHA256]}
GENERATION_SHA256=${journal[GENERATION_SHA256]}
EOF
  chown root:root "$temporary"
  chmod 0600 "$temporary"
  sync -f "$temporary"
  mv -f -- "$temporary" "$PENDING"
  sync -f "$STATE_DIR"
}

if [ "$PHASE" = staged ]; then
  if [ "$RECOVERY_DIRECTION" = rollback ]; then
    cleanup_stage_and_journal
    printf '%s\n' "Discarded uncommitted control-plane shadow for $NEW_RELEASE."
    exit 0
  fi
  ACK_CONTROL_PLANE_GENERATION=YES "$TRUSTED_INSTALLER" commit \
    "/opt/resume-ai/releases/$NEW_RELEASE" \
    "/opt/resume-ai/release-artifacts/$NEW_RELEASE/source-manifest.txt"
  assert_installed_required_test_policy
  exit 0
fi

BACKUP_DIR=${journal[BACKUP_DIR]}
case "$BACKUP_DIR" in /var/backups/resume-ai/control-plane/20??????T??????Z.??????) ;; *) fail "invalid control-plane backup path" ;; esac
[[ "${journal[BACKUP_MANIFEST_SHA256]:-}" =~ ^[a-f0-9]{64}$ ]] \
  || fail "invalid control-plane backup manifest identity"
[ -d "$BACKUP_DIR" ] && [ ! -L "$BACKUP_DIR" ] \
  && [ "$(readlink -e -- "$BACKUP_DIR")" = "$BACKUP_DIR" ] \
  && [ "$(stat -c '%U:%G:%a' "$BACKUP_DIR")" = root:root:700 ] \
  || fail "control-plane backup directory is unsafe"
BACKUP_MANIFEST="$BACKUP_DIR/BACKUP_SHA256SUMS"
[ -f "$BACKUP_MANIFEST" ] && [ ! -L "$BACKUP_MANIFEST" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$BACKUP_MANIFEST")" = root:root:600:1 ] \
  && [ "$(sha256sum "$BACKUP_MANIFEST" | awk '{print $1}')" = "${journal[BACKUP_MANIFEST_SHA256]}" ] \
  && (cd "$BACKUP_DIR" && sha256sum --strict -c BACKUP_SHA256SUMS >/dev/null) \
  || fail "control-plane backup members differ from the durable manifest"

assert_target_directory() {
  local directory=$1
  [ -d "$directory" ] && [ ! -L "$directory" ] \
    && [ "$(readlink -e -- "$directory")" = "$directory" ] \
    && [ "$(stat -c '%U' "$directory")" = root ] \
    && [ -z "$(find "$directory" -maxdepth 0 -perm /022 -print -quit)" ] \
    || fail "control-plane recovery target directory is unsafe: $directory"
}

assert_backup_target() {
  local target=$1 identity state backup
  identity="$(printf '%s' "$target" | sha256sum | awk '{print $1}')"
  state="$BACKUP_DIR/$identity.state"
  [ -f "$state" ] && [ ! -L "$state" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$state")" = root:root:600:1 ] \
    || fail "control-plane backup state is missing or unsafe"
  case "$(cat "$state")" in
    present)
      backup="$BACKUP_DIR/$identity.file"
      [ -f "$backup" ] && [ ! -L "$backup" ] \
        && [ "$(stat -c '%U:%G:%h' "$backup")" = root:root:1 ] \
        && [ -z "$(find "$backup" -maxdepth 0 -perm /022 -print -quit)" ] \
        || fail "control-plane backup payload is missing or unsafe"
      ;;
    absent) ;;
    *) fail "invalid control-plane backup state" ;;
  esac
}

restore_target() {
  local target=$1 identity state backup temporary
  identity="$(printf '%s' "$target" | sha256sum | awk '{print $1}')"
  state="$BACKUP_DIR/$identity.state"
  case "$(cat "$state")" in
    present)
      backup="$BACKUP_DIR/$identity.file"
      temporary="$(mktemp "${target%/*}/.${target##*/}.restore.XXXXXX")"
      cp -a -- "$backup" "$temporary"
      sync -f "$temporary"
      mv -f -- "$temporary" "$target"
      sync -f "${target%/*}"
      ;;
    absent)
      if [ -e "$target" ] || [ -L "$target" ]; then
        [ -f "$target" ] && [ ! -L "$target" ] && [ "$(stat -c '%h' "$target")" = 1 ] \
          || fail "refusing to remove an unsafe control-plane target"
        unlink "$target"
        sync -f "${target%/*}"
      fi
      ;;
  esac
}

if [ "$RECOVERY_DIRECTION" = forward ]; then
  [ "$ACTIVE_RELEASE" = "$NEW_RELEASE" ] \
    || fail "forward control recovery is not the active release"
  while IFS=$'\t' read -r digest mode relative target payload_name extra || [ -n "$digest" ]; do
    case "$digest" in ''|'#'*) continue ;; esac
    [ -z "$extra" ] || fail "malformed forward control-plane row"
    assert_target_directory "${target%/*}"
    temporary="$(mktemp "${target%/*}/.${target##*/}.forward.XXXXXX")"
    install -o root -g root -m "$mode" "$STAGE_DIR/$payload_name" "$temporary"
    [ "$(sha256sum "$temporary" | awk '{print $1}')" = "$digest" ] \
      || fail "forward recovery payload differs: $target"
    sync -f "$temporary"
    mv -f -- "$temporary" "$target"
    sync -f "${target%/*}"
  done < "$STAGE_DIR/STAGE_MANIFEST"
  temporary="$(mktemp /etc/resume-ai/.control-plane-generation.XXXXXX)"
  install -o root -g root -m 0400 "$STAGE_DIR/control-plane-generation.env" "$temporary"
  sync -f "$temporary"
  mv -f -- "$temporary" "$INSTALLED_MANIFEST"
  sync -f /etc/resume-ai
  systemctl daemon-reload
  udevadm control --reload
  while IFS=$'\t' read -r digest mode relative target payload_name extra || [ -n "$digest" ]; do
    case "$digest" in ''|'#'*) continue ;; esac
    [ -z "$extra" ] && [ -f "$target" ] && [ ! -L "$target" ] \
      && [ "$(stat -c '%U:%G:%a:%h' "$target")" = "root:root:${mode#0}:1" ] \
      && [ "$(sha256sum "$target" | awk '{print $1}')" = "$digest" ] \
      || fail "forward-recovered control differs: $target"
  done < "$STAGE_DIR/STAGE_MANIFEST"
  cmp -s "$STAGE_DIR/control-plane-generation.env" "$INSTALLED_MANIFEST" \
    || fail "forward-recovered generation manifest differs"
  assert_installed_required_test_policy
  write_installed_journal
  [ -f "$DEPLOY_PENDING" ] && [ ! -L "$DEPLOY_PENDING" ] \
    || fail "forward-recovered controls require the durable deployment journal before finalization"
  printf '%s\n' "Recovered rollbackable control-plane generation $NEW_RELEASE; deployment validation remains pending."
  exit 0
fi

[ "$RECOVERY_DIRECTION" = rollback ] \
  || fail "control-plane recovery direction is invalid"
for row in "${manifest_rows[@]}"; do
  IFS=$'\t' read -r digest mode relative target payload_name extra <<< "$row"
  assert_target_directory "${target%/*}"
  assert_backup_target "$target"
done
assert_target_directory "${INSTALLED_MANIFEST%/*}"
assert_backup_target "$INSTALLED_MANIFEST"
for row in "${manifest_rows[@]}"; do
  IFS=$'\t' read -r digest mode relative target payload_name extra <<< "$row"
  restore_target "$target"
done
restore_target "$INSTALLED_MANIFEST"
systemctl daemon-reload
udevadm control --reload
manifest_identity="$(printf '%s' "$INSTALLED_MANIFEST" | sha256sum | awk '{print $1}')"
case "$(cat "$BACKUP_DIR/$manifest_identity.state")" in
  present)
    root_python "$TRUSTED_VERIFIER" --mode installed \
      --source-root "/opt/resume-ai/releases/$OLD_RELEASE" \
      --source-manifest "/opt/resume-ai/release-artifacts/$OLD_RELEASE/source-manifest.txt" \
      --spec "$TRUSTED_SPEC" \
      --candidate-spec "/opt/resume-ai/releases/$OLD_RELEASE/ops/config/control-plane-files.conf" \
      --installed-manifest "$INSTALLED_MANIFEST" >/dev/null \
      || fail "restored controls do not match the old generation"
    ;;
  absent)
    [ ! -e "$INSTALLED_MANIFEST" ] && [ ! -L "$INSTALLED_MANIFEST" ] \
      || fail "bootstrap rollback did not restore an absent generation marker"
    ;;
  *) fail "invalid backed-up generation manifest state" ;;
esac
cleanup_stage_and_journal
printf '%s\n' "Restored control-plane generation $OLD_RELEASE."
