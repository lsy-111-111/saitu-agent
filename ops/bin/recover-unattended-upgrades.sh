#!/usr/bin/env bash
set -Eeuo pipefail
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

fail() {
  printf '%s\n' "ERROR: $*" >&2
  exit 1
}

[ "${EUID:-$(id -u)}" -eq 0 ] || fail "run as root"
[ "$#" -eq 0 ] || fail "APT recovery accepts no arguments"
PENDING_FILE=/var/lib/resume-ai/unattended-upgrades.pending
if [ ! -e "$PENDING_FILE" ] && [ ! -L "$PENDING_FILE" ]; then
  exit 0
fi
for command_name in cmp mkfifo python3 readlink sha256sum stat sync systemctl timeout; do
  command -v "$command_name" >/dev/null 2>&1 || fail "$command_name is unavailable"
done
[ -d /var/lib/resume-ai ] && [ ! -L /var/lib/resume-ai ] \
  && [ "$(readlink -e /var/lib/resume-ai)" = /var/lib/resume-ai ] \
  && [ "$(stat -c '%U:%G:%a' /var/lib/resume-ai)" = root:root:755 ] \
  || fail "APT recovery state directory is unsafe"
[ -f "$PENDING_FILE" ] && [ ! -L "$PENDING_FILE" ] \
  && [ "$(readlink -e "$PENDING_FILE")" = "$PENDING_FILE" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$PENDING_FILE")" = root:root:600:1 ] \
  || fail "APT recovery journal is unsafe"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
if [ "${APT_TRANSACTION_LOCKS_HELD:-0}" != 1 ]; then
  . "$SCRIPT_DIR/open-root-lock.sh"
  open_root_lock 8 deploy
  open_root_lock 9 apt-dpkg
fi

declare -A journal=()
while IFS='=' read -r key value || [ -n "$key" ]; do
  case "$key" in
    KIND|PHASE|BACKUP_DIR|ESM_MODE|TARGETS_SHA256|BACKUP_MANIFEST_SHA256|TIMER_STATE_SHA256) ;;
    *) fail "unknown APT recovery journal key" ;;
  esac
  [ -z "${journal[$key]:-}" ] || fail "duplicate APT recovery journal key"
  journal[$key]=$value
done < "$PENDING_FILE"
[ "${journal[KIND]:-}" = unattended-upgrades ] || fail "invalid APT recovery journal kind"
case "${journal[PHASE]:-}" in prepared|sources_installed|files_installed|timers_enabled|validated) ;; *) fail "invalid APT recovery phase" ;; esac
case "${journal[ESM_MODE]:-}" in disabled|enabled) ;; *) fail "invalid APT recovery ESM mode" ;; esac
for digest_key in TARGETS_SHA256 BACKUP_MANIFEST_SHA256 TIMER_STATE_SHA256; do
  [[ "${journal[$digest_key]:-}" =~ ^[a-f0-9]{64}$ ]] \
    || fail "invalid APT recovery evidence digest: $digest_key"
done
BACKUP_DIR=${journal[BACKUP_DIR]:-}
[[ "$BACKUP_DIR" =~ ^/var/backups/resume-ai/apt-config/[0-9]{8}T[0-9]{6}Z-[0-9]+$ ]] \
  && [ -d "$BACKUP_DIR" ] && [ ! -L "$BACKUP_DIR" ] \
  && [ "$(readlink -e "$BACKUP_DIR")" = "$BACKUP_DIR" ] \
  && [ "$(stat -c '%U:%G:%a' "$BACKUP_DIR")" = root:root:700 ] \
  || fail "APT recovery backup path is missing or unsafe"

targets_manifest="$BACKUP_DIR/targets.list"
[ -f "$targets_manifest" ] && [ ! -L "$targets_manifest" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$targets_manifest")" = root:root:600:1 ] \
  || fail "APT recovery target inventory is missing or unsafe"
[ "$(sha256sum "$targets_manifest" | awk '{print $1}')" = "${journal[TARGETS_SHA256]}" ] \
  || fail "APT recovery target inventory digest differs from its journal"
declare -a targets=()
declare -A seen_targets=()
while IFS= read -r target || [ -n "$target" ]; do
  [ -n "$target" ] && [[ "$target" != *$'\t'* && "$target" != *$'\r'* ]] \
    || fail "APT recovery target inventory contains an unsafe row"
  case "$target" in
    /etc/apt/apt.conf.d/20auto-upgrades|/etc/apt/apt.conf.d/52resume-ai-unattended-upgrades|\
    /etc/systemd/system/apt-daily.timer.d/resume-ai-schedule.conf|\
    /etc/systemd/system/apt-daily-upgrade.timer.d/resume-ai-schedule.conf|\
    /etc/apt/sources.list|/etc/apt/keyrings/resume-ai-ubuntu-archive-2018.gpg|\
    /usr/share/keyrings/nginx-archive-keyring.gpg|/etc/resume-ai/apt-policy.env) ;;
    /etc/apt/sources.list.d/*|/etc/apt/preferences.d/*)
      target_name=${target##*/}
      case "$target" in
        /etc/apt/sources.list.d/*) [ "$target" = "/etc/apt/sources.list.d/$target_name" ] \
          || fail "APT recovery source target is not one directory member" ;;
        /etc/apt/preferences.d/*) [ "$target" = "/etc/apt/preferences.d/$target_name" ] \
          || fail "APT recovery pin target is not one directory member" ;;
      esac
      [[ "$target_name" =~ ^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$ ]] \
        || fail "APT recovery inventory has an unsafe policy filename"
      ;;
    *) fail "APT recovery inventory contains an unapproved target: $target" ;;
  esac
  [ -z "${seen_targets[$target]:-}" ] || fail "APT recovery inventory contains a duplicate target"
  seen_targets[$target]=1
  targets+=("$target")
done < "$targets_manifest"
[ "${#targets[@]}" -ge 16 ] || fail "APT recovery target inventory is incomplete"
for required_target in \
  /etc/apt/apt.conf.d/20auto-upgrades \
  /etc/apt/apt.conf.d/52resume-ai-unattended-upgrades \
  /etc/systemd/system/apt-daily.timer.d/resume-ai-schedule.conf \
  /etc/systemd/system/apt-daily-upgrade.timer.d/resume-ai-schedule.conf \
  /etc/apt/sources.list \
  /etc/apt/sources.list.d/resume-ai-ubuntu.sources \
  /etc/apt/sources.list.d/nginx.list \
  /etc/apt/preferences.d/99resume-ai-ubuntu \
  /etc/apt/preferences.d/99nginx \
  /etc/apt/preferences.d/ubuntu-pro-esm-apps \
  /etc/apt/preferences.d/ubuntu-pro-esm-infra \
  /etc/apt/sources.list.d/ubuntu-esm-apps.list \
  /etc/apt/sources.list.d/ubuntu-esm-infra.list \
  /etc/apt/keyrings/resume-ai-ubuntu-archive-2018.gpg \
  /usr/share/keyrings/nginx-archive-keyring.gpg \
  /etc/resume-ai/apt-policy.env; do
  [ -n "${seen_targets[$required_target]:-}" ] \
    || fail "APT recovery target inventory omits a mandatory control"
done

backup_manifest="$BACKUP_DIR/backup-files.tsv"
[ -f "$backup_manifest" ] && [ ! -L "$backup_manifest" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$backup_manifest")" = root:root:600:1 ] \
  || fail "APT recovery file manifest is missing or unsafe"
[ "$(sha256sum "$backup_manifest" | awk '{print $1}')" = \
  "${journal[BACKUP_MANIFEST_SHA256]}" ] \
  || fail "APT recovery file manifest digest differs from its journal"
declare -A backup_states=()
declare -A backup_modes=()
declare -A backup_hashes=()
while IFS=$'\t' read -r backup_state backup_target backup_mode backup_hash extra \
    || [ -n "$backup_state" ]; do
  [ -z "${extra:-}" ] && [ -n "$backup_target" ] \
    || fail "APT recovery file manifest contains a malformed row"
  [ -n "${seen_targets[$backup_target]:-}" ] \
    && [ -z "${backup_states[$backup_target]:-}" ] \
    || fail "APT recovery file manifest contains an unknown or duplicate target"
  case "$backup_state" in
    present)
      [[ "$backup_mode" =~ ^[0-7]{3,4}$ ]] \
        && (( (8#$backup_mode & 8#022) == 0 )) \
        && (( (8#$backup_mode & 8#400) != 0 )) \
        && [[ "$backup_hash" =~ ^[a-f0-9]{64}$ ]] \
        || fail "APT recovery file manifest has unsafe present-file metadata"
      ;;
    absent)
      [ "$backup_mode:$backup_hash" = -:- ] \
        || fail "APT recovery absent-file manifest row has unexpected metadata"
      ;;
    *) fail "APT recovery file manifest has an invalid state" ;;
  esac
  backup_states[$backup_target]=$backup_state
  backup_modes[$backup_target]=$backup_mode
  backup_hashes[$backup_target]=$backup_hash
done < "$backup_manifest"
[ "${#backup_states[@]}" -eq "${#targets[@]}" ] \
  || fail "APT recovery file manifest is incomplete"

timer_manifest="$BACKUP_DIR/timer-state.tsv"
[ -f "$timer_manifest" ] && [ ! -L "$timer_manifest" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$timer_manifest")" = root:root:600:1 ] \
  || fail "APT recovery timer manifest is missing or unsafe"
[ "$(sha256sum "$timer_manifest" | awk '{print $1}')" = \
  "${journal[TIMER_STATE_SHA256]}" ] \
  || fail "APT recovery timer manifest digest differs from its journal"
declare -A timer_enabled_states=()
declare -A timer_active_states=()
while IFS=$'\t' read -r timer_name enabled_state active_state extra \
    || [ -n "$timer_name" ]; do
  [ -z "${extra:-}" ] || fail "APT recovery timer manifest contains a malformed row"
  case "$timer_name" in apt-daily.timer|apt-daily-upgrade.timer) ;; \
    *) fail "APT recovery timer manifest contains an unknown timer" ;;
  esac
  [ -z "${timer_enabled_states[$timer_name]:-}" ] \
    || fail "APT recovery timer manifest contains a duplicate timer"
  case "$enabled_state" in enabled|enabled-runtime|disabled|masked|static|indirect) ;; \
    *) fail "APT recovery timer manifest has an invalid enable state" ;;
  esac
  case "$active_state" in active|activating|inactive|failed|deactivating) ;; \
    *) fail "APT recovery timer manifest has an invalid active state" ;;
  esac
  timer_enabled_states[$timer_name]=$enabled_state
  timer_active_states[$timer_name]=$active_state
done < "$timer_manifest"
[ "${#timer_enabled_states[@]}" -eq 2 ] \
  || fail "APT recovery timer manifest is incomplete"
for timer_name in apt-daily.timer apt-daily-upgrade.timer; do
  for suffix in enabled active; do
    timer_state_file="$BACKUP_DIR/$timer_name.$suffix"
    [ -f "$timer_state_file" ] && [ ! -L "$timer_state_file" ] \
      && [ "$(stat -c '%U:%G:%a:%h' "$timer_state_file")" = root:root:600:1 ] \
      || fail "APT timer recovery evidence is unsafe"
  done
  [ "$(cat "$BACKUP_DIR/$timer_name.enabled")" = \
    "${timer_enabled_states[$timer_name]}" ] \
    && [ "$(cat "$BACKUP_DIR/$timer_name.active")" = \
    "${timer_active_states[$timer_name]}" ] \
    || fail "APT timer state differs from its sealed manifest"
done

atomic_restore() {
  local source=$1 destination=$2 mode=$3 directory base temporary
  directory=${destination%/*}
  base=${destination##*/}
  [ -d "$directory" ] && [ ! -L "$directory" ] \
    && [ "$(readlink -e "$directory")" = "$directory" ] \
    && [ "$(stat -c '%U' "$directory")" = root ] \
    && [ -z "$(find "$directory" -maxdepth 0 -perm /022 -print -quit)" ] \
    || fail "APT recovery destination directory is unsafe"
  if [ -e "$destination" ] || [ -L "$destination" ]; then
    [ -f "$destination" ] && [ ! -L "$destination" ] \
      && [ "$(readlink -e "$destination")" = "$destination" ] \
      && [ "$(stat -c '%U:%G:%h' "$destination")" = root:root:1 ] \
      || fail "APT recovery destination is linked, shared, or not a regular file"
  fi
  temporary="$(mktemp "$directory/.${base}.apt-recovery.XXXXXX")"
  install -o root -g root -m "$mode" "$source" "$temporary"
  sync -f "$temporary"
  mv -f -- "$temporary" "$destination"
  sync -f "$directory"
}

systemctl stop apt-daily.timer apt-daily-upgrade.timer >/dev/null
for attempt in $(seq 1 60); do
  daily_worker_state="$(systemctl show apt-daily.service --property=ActiveState --value)"
  upgrade_worker_state="$(systemctl show apt-daily-upgrade.service --property=ActiveState --value)"
  if [[ "$daily_worker_state" =~ ^(inactive|failed)$ ]] \
    && [[ "$upgrade_worker_state" =~ ^(inactive|failed)$ ]]; then
    break
  fi
  [ "$attempt" -lt 60 ] || fail "an APT worker did not quiesce for recovery"
  sleep 1
done
native_lock_root="$(mktemp -d /var/tmp/resume-ai-apt-recovery-lock.XXXXXX)"
native_lock_ready="$native_lock_root/ready"
native_lock_control="$native_lock_root/control"
native_apt_lock_pid=
native_apt_lock_open=0
cleanup_native_lock() {
  if [ -n "${native_apt_lock_pid:-}" ]; then
    if [ "${native_apt_lock_open:-0}" -eq 1 ]; then
      printf 'release\n' >&6 2>/dev/null || true
      exec 6>&- || true
    else
      kill "$native_apt_lock_pid" >/dev/null 2>&1 || true
    fi
    wait "$native_apt_lock_pid" 2>/dev/null || true
  fi
  if [[ "${native_lock_root:-}" == /var/tmp/resume-ai-apt-recovery-lock.* ]] \
    && [ -d "$native_lock_root" ] && [ ! -L "$native_lock_root" ]; then
    find "$native_lock_root" -xdev -depth -delete >/dev/null 2>&1 || true
  fi
}
trap cleanup_native_lock EXIT
mkfifo -m 0600 "$native_lock_ready" "$native_lock_control"
python3 -I - "$native_lock_ready" "$native_lock_control" <<'PY' &
import fcntl
import os
import stat
import sys

handles = []
message = "ready"
try:
    for path in (
        "/var/lib/dpkg/lock-frontend",
        "/var/lib/dpkg/lock",
        "/var/lib/apt/lists/lock",
        "/var/cache/apt/archives/lock",
    ):
        metadata = os.lstat(path)
        if (
            not stat.S_ISREG(metadata.st_mode)
            or metadata.st_uid != 0
            or metadata.st_nlink != 1
            or metadata.st_mode & 0o022
        ):
            raise OSError(f"unsafe native APT lock metadata: {path}")
        descriptor = os.open(
            path,
            os.O_RDWR | os.O_CLOEXEC | getattr(os, "O_NOFOLLOW", 0),
        )
        opened = os.fstat(descriptor)
        if (opened.st_dev, opened.st_ino) != (metadata.st_dev, metadata.st_ino):
            os.close(descriptor)
            raise OSError(f"native APT lock changed during validation: {path}")
        fcntl.lockf(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        handles.append(descriptor)
except (BlockingIOError, OSError) as error:
    message = f"error:{error}"
with open(sys.argv[1], "w", encoding="utf-8") as ready:
    ready.write(message + "\n")
if message != "ready":
    raise SystemExit(1)
with open(sys.argv[2], "rb", buffering=0) as control:
    command = control.readline()
if command != b"release\n":
    raise SystemExit("ERROR: native APT/dpkg recovery lock holder lost its parent")
PY
native_apt_lock_pid=$!
native_apt_lock_ready="$(timeout 10 sh -c 'IFS= read -r line < "$1" && printf "%s" "$line"' sh "$native_lock_ready")" \
  || fail "native APT/dpkg recovery lock holder terminated before readiness"
[ "$native_apt_lock_ready" = ready ] || fail "native APT/dpkg recovery lock handshake failed"
exec 6>"$native_lock_control"
native_apt_lock_open=1
for target in "${targets[@]}"; do
  name="$(printf '%s' "$target" | sha256sum | awk '{print $1}')"
  state_file="$BACKUP_DIR/files/$name.state"
  [ -f "$state_file" ] && [ ! -L "$state_file" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$state_file")" = root:root:600:1 ] \
    || fail "APT recovery file-state evidence is unsafe"
  [ "$(cat "$state_file")" = "${backup_states[$target]}" ] \
    || fail "APT recovery file state differs from its sealed manifest"
  case "${backup_states[$target]}" in
    present)
      backup="$BACKUP_DIR/files/$name.file"
      mode_file="$BACKUP_DIR/files/$name.mode"
      hash_file="$BACKUP_DIR/files/$name.sha256"
      [ -f "$backup" ] && [ ! -L "$backup" ] \
        && [ "$(stat -c '%U:%G:%a:%h' "$backup")" = root:root:600:1 ] \
        || fail "APT recovery backup member is unsafe"
      for metadata_file in "$mode_file" "$hash_file"; do
        [ -f "$metadata_file" ] && [ ! -L "$metadata_file" ] \
          && [ "$(stat -c '%U:%G:%a:%h' "$metadata_file")" = root:root:600:1 ] \
          || fail "APT recovery backup metadata is unsafe"
      done
      [ "$(cat "$mode_file")" = "${backup_modes[$target]}" ] \
        && [ "$(cat "$hash_file")" = "${backup_hashes[$target]}" ] \
        && [ "$(sha256sum "$backup" | awk '{print $1}')" = "${backup_hashes[$target]}" ] \
        || fail "APT recovery backup bytes or metadata differ from the sealed manifest"
      atomic_restore "$backup" "$target" "${backup_modes[$target]}"
      cmp -s "$backup" "$target" || fail "restored APT file differs from its backup"
      [ "$(stat -c '%U:%G:%a:%h' "$target")" = \
        "root:root:${backup_modes[$target]}:1" ] \
        || fail "restored APT file metadata differs from its backup"
      ;;
    absent)
      if [ -e "$target" ] || [ -L "$target" ]; then
        [ -f "$target" ] && [ ! -L "$target" ] \
          && [ "$(readlink -e "$target")" = "$target" ] \
          && [ "$(stat -c '%U:%G:%h' "$target")" = root:root:1 ] \
          && [ -z "$(find "$target" -maxdepth 0 -perm /022 -print -quit)" ] \
          || fail "refusing to remove unsafe APT target"
        unlink "$target"
        sync -f "${target%/*}"
      fi
      ;;
    *) fail "invalid APT recovery file-state value" ;;
  esac
done
systemctl daemon-reload

printf 'release\n' >&6
exec 6>&-
native_apt_lock_open=0
wait "$native_apt_lock_pid" \
  || fail "native APT/dpkg recovery lock holder did not exit cleanly"
native_apt_lock_pid=
find "$native_lock_root" -xdev -depth -delete
native_lock_root=

for timer in apt-daily.timer apt-daily-upgrade.timer; do
  case "${timer_enabled_states[$timer]}" in
    enabled) systemctl enable "$timer" >/dev/null ;;
    enabled-runtime) systemctl enable --runtime "$timer" >/dev/null ;;
    disabled) systemctl disable "$timer" >/dev/null ;;
    masked) systemctl mask "$timer" >/dev/null ;;
    static|indirect) systemctl disable "$timer" >/dev/null 2>&1 || true ;;
    *) fail "unrestorable prior APT timer enable state" ;;
  esac
  case "${timer_active_states[$timer]}" in
    active|activating) systemctl start "$timer" >/dev/null ;;
    inactive|failed|deactivating) systemctl stop "$timer" >/dev/null 2>&1 || true ;;
    *) fail "unrestorable prior APT timer active state" ;;
  esac
  expected_enabled="${timer_enabled_states[$timer]}"
  [ "$(systemctl is-enabled "$timer" 2>/dev/null || true)" = "$expected_enabled" ] \
    || fail "recovered APT timer enable state differs from its backup"
  case "${timer_active_states[$timer]}" in
    active|activating)
      case "$(systemctl is-active "$timer" 2>/dev/null || true)" in active|activating) ;; *) fail "recovered APT timer is not running" ;; esac
      ;;
    inactive|failed|deactivating)
      case "$(systemctl show "$timer" --property=ActiveState --value)" in inactive|failed) ;; *) fail "recovered APT timer should be stopped" ;; esac
      ;;
  esac
done

result_temp="$(mktemp "$BACKUP_DIR/.RECOVERY.XXXXXX")"
printf 'recovered-at=%s\nphase=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${journal[PHASE]}" > "$result_temp"
chown root:root "$result_temp"
chmod 0600 "$result_temp"
sync -f "$result_temp"
mv -f -- "$result_temp" "$BACKUP_DIR/RECOVERY"
sync -f "$BACKUP_DIR"
unlink "$PENDING_FILE"
sync -f /var/lib/resume-ai
trap - EXIT
printf '%s\n' "Recovered interrupted unattended-upgrades transaction from $BACKUP_DIR."
