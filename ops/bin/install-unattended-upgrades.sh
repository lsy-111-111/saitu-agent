#!/usr/bin/env bash
set -Eeuo pipefail
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

fail() {
  printf '%s\n' "ERROR: $*" >&2
  exit 1
}

[ "${EUID:-$(id -u)}" -eq 0 ] || fail "run as root"
[ "$#" -eq 0 ] || fail "unattended-upgrades installer accepts no arguments"
[ "${ACK_INSTALL_UNATTENDED_UPGRADES:-}" = YES ] \
  || fail "explicit unattended-upgrades acknowledgement is required"
case "${ENABLE_UBUNTU_ESM:-NO}" in
  NO) ESM_MODE=disabled ;;
  YES)
    [ "${ACK_ENABLE_UBUNTU_ESM:-}" = YES ] \
      || fail "ESM needs the separate ACK_ENABLE_UBUNTU_ESM=YES acknowledgement"
    ESM_MODE=enabled
    ;;
  *) fail "ENABLE_UBUNTU_ESM must be NO or YES" ;;
esac

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
if [ "$SCRIPT_DIR" = /usr/local/lib/resume-ai ]; then
  ACTIVE_RELEASE_ROOT="$(readlink -e /opt/resume-ai/current)" \
    || fail "active release is unavailable to the installed APT policy entrypoint"
  case "$ACTIVE_RELEASE_ROOT" in /opt/resume-ai/releases/20??????T??????Z) ;; \
    *) fail "active release path is outside the fixed managed tree" ;; esac
  OPS_DIR="$ACTIVE_RELEASE_ROOT/ops"
else
  OPS_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
fi
. "$SCRIPT_DIR/open-root-lock.sh"
# APT and release operations can both install packages or restart managed
# services. Take the shared deploy lock first and the repository-wide APT/dpkg
# transaction lock second so all project package writers have one lock order.
open_root_lock 8 deploy
open_root_lock 9 apt-dpkg

for command_name in apt-cache apt-config apt-get cmp curl flock gpg mkfifo python3 readlink sha256sum stat sync systemctl timeout unattended-upgrade; do
  command -v "$command_name" >/dev/null 2>&1 || fail "$command_name is unavailable"
done
OS_RELEASE_FILE=/etc/os-release
if [ -L "$OS_RELEASE_FILE" ]; then
  [ "$(readlink -e "$OS_RELEASE_FILE")" = /usr/lib/os-release ] \
    || fail "OS identity link has an unapproved target"
  OS_RELEASE_FILE=/usr/lib/os-release
fi
[ -f "$OS_RELEASE_FILE" ] && [ ! -L "$OS_RELEASE_FILE" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$OS_RELEASE_FILE")" = root:root:644:1 ] \
  || fail "OS identity is unavailable or unsafe"
. "$OS_RELEASE_FILE"
[ "${ID:-}" = ubuntu ] && [ "${VERSION_CODENAME:-}" = jammy ] \
  || fail "unattended-upgrades policy is approved only for Ubuntu Jammy"

STATE_DIR=/var/lib/resume-ai
PENDING_FILE="$STATE_DIR/unattended-upgrades.pending"
BACKUP_ROOT=/var/backups/resume-ai/apt-config
BACKUP_DIR="$BACKUP_ROOT/$(date -u +%Y%m%dT%H%M%SZ)-$$"
RECOVERY_SCRIPT=/usr/local/lib/resume-ai/recover-unattended-upgrades.sh
umask 077
[ -d "$STATE_DIR" ] && [ ! -L "$STATE_DIR" ] \
  && [ "$(readlink -e "$STATE_DIR")" = "$STATE_DIR" ] \
  && [ "$(stat -c '%U:%G:%a' "$STATE_DIR")" = root:root:755 ] \
  || fail "preinstalled root-owned resume-ai state container is unsafe"
if [ ! -e "$BACKUP_ROOT" ] && [ ! -L "$BACKUP_ROOT" ]; then
  install -d -o root -g root -m 0700 "$BACKUP_ROOT"
fi
[ -d "$BACKUP_ROOT" ] && [ ! -L "$BACKUP_ROOT" ] \
  && [ "$(readlink -e "$BACKUP_ROOT")" = "$BACKUP_ROOT" ] \
  && [ "$(stat -c '%U:%G:%a' "$BACKUP_ROOT")" = root:root:700 ] \
  || fail "APT backup root is unsafe"
[ ! -e "$BACKUP_DIR" ] && [ ! -L "$BACKUP_DIR" ] || fail "APT backup path already exists"

atomic_install() {
  local source=$1 destination=$2 mode=$3 directory base temporary
  [ -f "$source" ] && [ ! -L "$source" ] \
    && [ "$(stat -c '%h' "$source")" = 1 ] \
    && [ -z "$(find "$source" -maxdepth 0 -perm /022 -print -quit)" ] \
    || fail "APT control source is missing, linked, shared, or writable: $source"
  directory=${destination%/*}
  base=${destination##*/}
  if [ ! -e "$directory" ] && [ ! -L "$directory" ]; then
    install -d -o root -g root -m 0755 "$directory"
  fi
  [ -d "$directory" ] && [ ! -L "$directory" ] \
    && [ "$(readlink -e "$directory")" = "$directory" ] \
    && [ "$(stat -c '%U' "$directory")" = root ] \
    && [ -z "$(find "$directory" -maxdepth 0 -perm /022 -print -quit)" ] \
    || fail "APT control destination directory is unsafe: $directory"
  if [ -e "$destination" ] || [ -L "$destination" ]; then
    [ -f "$destination" ] && [ ! -L "$destination" ] \
      && [ "$(readlink -e "$destination")" = "$destination" ] \
      && [ "$(stat -c '%U:%G:%h' "$destination")" = root:root:1 ] \
      && [ -z "$(find "$destination" -maxdepth 0 -perm /022 -print -quit)" ] \
      || fail "existing APT control destination is linked, shared, or unsafe: $destination"
  fi
  temporary="$(mktemp "$directory/.${base}.resume-ai.XXXXXX")"
  install -o root -g root -m "$mode" "$source" "$temporary"
  cmp -s "$source" "$temporary" || fail "staged APT control differs from source: $source"
  sync -f "$temporary"
  mv -f -- "$temporary" "$destination"
  sync -f "$directory"
}

# Publish boot recovery controls before the first journal-managed mutation.
if [ ! -e /usr/local/lib/resume-ai ] && [ ! -L /usr/local/lib/resume-ai ]; then
  install -d -o root -g root -m 0755 /usr/local/lib/resume-ai
fi
[ -d /usr/local/lib/resume-ai ] && [ ! -L /usr/local/lib/resume-ai ] \
  && [ "$(readlink -e /usr/local/lib/resume-ai)" = /usr/local/lib/resume-ai ] \
  && [ "$(stat -c '%U:%G:%a' /usr/local/lib/resume-ai)" = root:root:755 ] \
  || fail "installed recovery control directory is unsafe"
atomic_install "$OPS_DIR/bin/open-root-lock.sh" \
  /usr/local/lib/resume-ai/open-root-lock.sh 0755
atomic_install "$OPS_DIR/bin/recover-unattended-upgrades.sh" "$RECOVERY_SCRIPT" 0755
atomic_install "$OPS_DIR/systemd/resume-ai-apt-recovery.service" \
  /etc/systemd/system/resume-ai-apt-recovery.service 0644
atomic_install "$OPS_DIR/systemd/apt-daily-resume-ai-recovery.conf" \
  /etc/systemd/system/apt-daily.service.d/resume-ai-recovery.conf 0644
atomic_install "$OPS_DIR/systemd/apt-daily-upgrade-resume-ai-recovery.conf" \
  /etc/systemd/system/apt-daily-upgrade.service.d/resume-ai-recovery.conf 0644
systemctl daemon-reload

if [ -e "$PENDING_FILE" ] || [ -L "$PENDING_FILE" ]; then
  APT_TRANSACTION_LOCKS_HELD=1 "$RECOVERY_SCRIPT"
fi
[ ! -e "$PENDING_FILE" ] && [ ! -L "$PENDING_FILE" ] \
  || fail "an earlier APT transaction still requires recovery"
# A previous RemainAfterExit=yes generation can remain active across a unit
# reload. Force the new re-runnable oneshot back to inactive before any future
# apt-daily start depends on it.
systemctl stop resume-ai-apt-recovery.service >/dev/null 2>&1 || true

# Reject an existing root hook, alternate APT trust path, or authentication
# bypass before the first apt-get invocation. Merely replacing source files is
# insufficient if an already-active APT hook can execute during update.
preflight_config_dump="$(mktemp /var/tmp/resume-ai-apt-preflight.XXXXXX)"
if ! env -i PATH="$PATH" apt-config dump > "$preflight_config_dump"; then
  find "$preflight_config_dump" -maxdepth 0 -type f -delete >/dev/null 2>&1 || true
  fail "effective APT configuration could not be captured safely"
fi
chmod 0600 "$preflight_config_dump"
if ! "$OPS_DIR/bin/assert-apt-effective-config.sh" \
    "$OPS_DIR/config/approved-apt-effective.conf" "$preflight_config_dump" >/dev/null; then
  find "$preflight_config_dump" -maxdepth 0 -type f -delete >/dev/null 2>&1 || true
  fail "existing effective APT root hooks or trust paths are not approved"
fi
find "$preflight_config_dump" -maxdepth 0 -type f -delete
preflight_config_dump=

# Freeze every package-manager writer before enumerating or copying policy
# files. A timer may fire while these locks are held, but it cannot mutate APT
# or dpkg state; after the durable journal exists the blocked worker is stopped.
native_apt_lock_pid=
native_apt_lock_write_open=0
NATIVE_LOCK_ROOT="$(mktemp -d /var/tmp/resume-ai-apt-install-lock.XXXXXX)"
native_lock_ready="$NATIVE_LOCK_ROOT/ready"
native_lock_control="$NATIVE_LOCK_ROOT/control"
stop_native_apt_lock_holder() {
  if [ -n "${native_apt_lock_pid:-}" ]; then
    if [ "${native_apt_lock_write_open:-0}" -eq 1 ]; then
      printf 'release\n' >&6 2>/dev/null || true
      exec 6>&- || true
    else
      kill "$native_apt_lock_pid" >/dev/null 2>&1 || true
    fi
    wait "$native_apt_lock_pid" 2>/dev/null || true
  fi
  native_apt_lock_pid=
  native_apt_lock_write_open=0
  if [[ "${NATIVE_LOCK_ROOT:-}" == /var/tmp/resume-ai-apt-install-lock.* ]] \
    && [ -d "$NATIVE_LOCK_ROOT" ] && [ ! -L "$NATIVE_LOCK_ROOT" ]; then
    find "$NATIVE_LOCK_ROOT" -xdev -depth -delete >/dev/null 2>&1 || true
  fi
  NATIVE_LOCK_ROOT=
}
trap stop_native_apt_lock_holder EXIT
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
    raise SystemExit("ERROR: native APT/dpkg lock holder lost its authenticated parent")
PY
native_apt_lock_pid=$!
native_apt_lock_ready="$(timeout 10 sh -c 'IFS= read -r line < "$1" && printf "%s" "$line"' sh "$native_lock_ready")" \
  || fail "native APT/dpkg lock holder terminated before readiness"
[ "$native_apt_lock_ready" = ready ] || fail "native APT/dpkg lock holder handshake failed"
exec 6>"$native_lock_control"
native_apt_lock_write_open=1

install -d -o root -g root -m 0700 "$BACKUP_DIR" "$BACKUP_DIR/files"
declare -a targets=(
  /etc/apt/apt.conf.d/20auto-upgrades
  /etc/apt/apt.conf.d/52resume-ai-unattended-upgrades
  /etc/systemd/system/apt-daily.timer.d/resume-ai-schedule.conf
  /etc/systemd/system/apt-daily-upgrade.timer.d/resume-ai-schedule.conf
  /etc/apt/sources.list
  /etc/apt/sources.list.d/resume-ai-ubuntu.sources
  /etc/apt/sources.list.d/nginx.list
  /etc/apt/preferences.d/99resume-ai-ubuntu
  /etc/apt/preferences.d/99nginx
  /etc/apt/preferences.d/ubuntu-pro-esm-apps
  /etc/apt/preferences.d/ubuntu-pro-esm-infra
  /etc/apt/sources.list.d/ubuntu-esm-apps.list
  /etc/apt/sources.list.d/ubuntu-esm-infra.list
  /etc/apt/keyrings/resume-ai-ubuntu-archive-2018.gpg
  /usr/share/keyrings/nginx-archive-keyring.gpg
  /etc/resume-ai/apt-policy.env
)

# Exact policy means unknown and legacy source/pin files are transactionally
# disabled too.  Snapshot their explicit paths so boot recovery can restore
# the pre-change set without a glob, moving symlink, or attacker-controlled
# target.  Filename restrictions are intentionally tighter than APT itself.
declare -A target_seen=()
declare -a existing_source_controls=()
declare -a existing_preference_controls=()
append_target() {
  local target=$1
  [[ "$target" != *$'\n'* && "$target" != *$'\r'* && "$target" != *$'\t'* ]] \
    || fail "APT control path contains a forbidden delimiter"
  [ -z "${target_seen[$target]:-}" ] || return 0
  target_seen[$target]=1
  targets+=("$target")
}

initial_targets=("${targets[@]}")
targets=()
for target in "${initial_targets[@]}"; do append_target "$target"; done
for control_directory in /etc/apt/sources.list.d /etc/apt/preferences.d; do
  [ -d "$control_directory" ] && [ ! -L "$control_directory" ] \
    && [ "$(readlink -e "$control_directory")" = "$control_directory" ] \
    && [ "$(stat -c '%U:%G:%a' "$control_directory")" = root:root:755 ] \
    || fail "APT policy directory is unsafe: $control_directory"
  while IFS= read -r -d '' control_member; do
    control_name=${control_member##*/}
    [[ "$control_name" =~ ^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$ ]] \
      || fail "APT policy member has an unsafe filename: $control_member"
    [ -f "$control_member" ] && [ ! -L "$control_member" ] \
      && [ "$(stat -c '%U:%G:%h' "$control_member")" = root:root:1 ] \
      && [ -z "$(find "$control_member" -maxdepth 0 -perm /022 -print -quit)" ] \
      || fail "APT policy member is linked, special, or writable: $control_member"
    append_target "$control_member"
    if [ "$control_directory" = /etc/apt/sources.list.d ]; then
      existing_source_controls+=("$control_member")
    else
      existing_preference_controls+=("$control_member")
    fi
  done < <(find "$control_directory" -xdev -mindepth 1 -maxdepth 1 -print0)
done

targets_manifest="$BACKUP_DIR/targets.list"
backup_manifest="$BACKUP_DIR/backup-files.tsv"
printf '%s\n' "${targets[@]}" > "$targets_manifest"
: > "$backup_manifest"
chown root:root "$targets_manifest"
chmod 0600 "$targets_manifest" "$backup_manifest"
for target in "${targets[@]}"; do
  name="$(printf '%s' "$target" | sha256sum | awk '{print $1}')"
  if [ -e "$target" ] || [ -L "$target" ]; then
    [ -f "$target" ] && [ ! -L "$target" ] \
      && [ "$(stat -c '%U:%G:%h' "$target")" = root:root:1 ] \
      && [ -z "$(find "$target" -perm /022 -print -quit)" ] \
      || fail "unsafe existing APT control file: $target"
    target_mode="$(stat -c '%a' "$target")"
    [[ "$target_mode" =~ ^[0-7]{3,4}$ ]] \
      && (( (8#$target_mode & 8#022) == 0 )) \
      && (( (8#$target_mode & 8#400) != 0 )) \
      || fail "existing APT control mode is not safely restorable: $target"
    install -o root -g root -m 0600 "$target" "$BACKUP_DIR/files/$name.file"
    target_sha256="$(sha256sum "$BACKUP_DIR/files/$name.file" | awk '{print $1}')"
    printf '%s\n' present > "$BACKUP_DIR/files/$name.state"
    printf '%s\n' "$target_mode" > "$BACKUP_DIR/files/$name.mode"
    printf '%s\n' "$target_sha256" > "$BACKUP_DIR/files/$name.sha256"
    printf 'present\t%s\t%s\t%s\n' \
      "$target" "$target_mode" "$target_sha256" >> "$backup_manifest"
  else
    printf '%s\n' absent > "$BACKUP_DIR/files/$name.state"
    printf 'absent\t%s\t-\t-\n' "$target" >> "$backup_manifest"
  fi
  chown root:root "$BACKUP_DIR/files/$name".*
  chmod 0600 "$BACKUP_DIR/files/$name".*
done
chown root:root "$backup_manifest"
chmod 0600 "$backup_manifest"
timer_manifest="$BACKUP_DIR/timer-state.tsv"
: > "$timer_manifest"
for timer in apt-daily.timer apt-daily-upgrade.timer; do
  systemctl is-enabled "$timer" > "$BACKUP_DIR/$timer.enabled" 2>/dev/null || true
  systemctl is-active "$timer" > "$BACKUP_DIR/$timer.active" 2>/dev/null || true
  chmod 0600 "$BACKUP_DIR/$timer.enabled" "$BACKUP_DIR/$timer.active"
  case "$(cat "$BACKUP_DIR/$timer.enabled")" in enabled|enabled-runtime|disabled|masked|static|indirect) ;; *) fail "unsupported prior $timer enable state" ;; esac
  case "$(cat "$BACKUP_DIR/$timer.active")" in active|activating|inactive|failed|deactivating) ;; *) fail "unsupported prior $timer active state" ;; esac
  printf '%s\t%s\t%s\n' "$timer" \
    "$(cat "$BACKUP_DIR/$timer.enabled")" \
    "$(cat "$BACKUP_DIR/$timer.active")" >> "$timer_manifest"
done
chown root:root "$timer_manifest"
chmod 0600 "$timer_manifest"
while IFS= read -r -d '' backup_member; do sync -f "$backup_member"; done \
  < <(find "$BACKUP_DIR" -type f -print0)
sync -f "$BACKUP_DIR/files"
sync -f "$BACKUP_DIR"
sync -f "$BACKUP_ROOT"
TARGETS_SHA256="$(sha256sum "$targets_manifest" | awk '{print $1}')"
BACKUP_MANIFEST_SHA256="$(sha256sum "$backup_manifest" | awk '{print $1}')"
TIMER_STATE_SHA256="$(sha256sum "$timer_manifest" | awk '{print $1}')"

# Construct both Signed-By keyrings before any policy mutation.  Ubuntu's key
# is exported from Jammy's package-owned archive keyring; nginx.org's reviewed
# bundle is pinned by byte hash and is later parsed again by the independent
# pure-Python fingerprint verifier.
KEY_STAGING="$(mktemp -d /var/tmp/resume-ai-apt-keys.XXXXXX)"
cleanup_key_staging() {
  if [[ "${KEY_STAGING:-}" == /var/tmp/resume-ai-apt-keys.* ]] \
    && [ -d "$KEY_STAGING" ] && [ ! -L "$KEY_STAGING" ]; then
    find "$KEY_STAGING" -xdev -depth -delete >/dev/null 2>&1 || true
  fi
  KEY_STAGING=
}
trap 'stop_native_apt_lock_holder; cleanup_key_staging' EXIT
install -d -o root -g root -m 0700 "$KEY_STAGING/gnupg"
[ -f /usr/share/keyrings/ubuntu-archive-keyring.gpg ] \
  && [ ! -L /usr/share/keyrings/ubuntu-archive-keyring.gpg ] \
  && [ "$(stat -c '%U:%G:%h' /usr/share/keyrings/ubuntu-archive-keyring.gpg)" = root:root:1 ] \
  && [ -z "$(find /usr/share/keyrings/ubuntu-archive-keyring.gpg -perm /022 -print -quit)" ] \
  || fail "package-owned Ubuntu archive keyring is missing or unsafe"
install -o root -g root -m 0600 /usr/share/keyrings/ubuntu-archive-keyring.gpg \
  "$KEY_STAGING/ubuntu-package-keyring.gpg"
GNUPGHOME="$KEY_STAGING/gnupg" gpg --batch --no-default-keyring \
  --keyring "$KEY_STAGING/ubuntu-package-keyring.gpg" \
  --export F6ECB3762474EDA9D21B7022871920D1991BC93C \
  > "$KEY_STAGING/ubuntu-archive-2018.gpg"
[ -s "$KEY_STAGING/ubuntu-archive-2018.gpg" ] \
  || fail "Jammy archive keyring does not contain the exact Ubuntu 2018 key"

nginx_key_sha="$(awk -F= '
  $1 == "NGINX_SIGNING_BUNDLE_SHA256" { value=$2; count += 1 }
  END { if (count != 1 || value !~ /^[a-f0-9]{64}$/) exit 2; print value }
' "$OPS_DIR/config/approved-nginx-versions.conf")" \
  || fail "approved Nginx signing-key hash policy is invalid"
curl -4 --proto '=https' --tlsv1.2 --fail --silent --show-error --location \
  --retry 3 --connect-timeout 10 --max-time 120 \
  --output "$KEY_STAGING/nginx-signing.asc" https://nginx.org/keys/nginx_signing.key
[ "$(sha256sum "$KEY_STAGING/nginx-signing.asc" | awk '{print $1}')" = "$nginx_key_sha" ] \
  || fail "nginx.org signing-key bundle differs from the reviewed byte hash"
GNUPGHOME="$KEY_STAGING/gnupg" gpg --batch --yes --dearmor \
  --output "$KEY_STAGING/nginx-archive-keyring.gpg" "$KEY_STAGING/nginx-signing.asc"
chmod 0600 "$KEY_STAGING/ubuntu-archive-2018.gpg" \
  "$KEY_STAGING/nginx-archive-keyring.gpg"

write_journal() {
  local phase=$1 temporary
  temporary="$(mktemp "$STATE_DIR/.unattended-upgrades.XXXXXX")"
  cat > "$temporary" <<EOF
KIND=unattended-upgrades
PHASE=$phase
BACKUP_DIR=$BACKUP_DIR
ESM_MODE=$ESM_MODE
TARGETS_SHA256=$TARGETS_SHA256
BACKUP_MANIFEST_SHA256=$BACKUP_MANIFEST_SHA256
TIMER_STATE_SHA256=$TIMER_STATE_SHA256
EOF
  chown root:root "$temporary"
  chmod 0600 "$temporary"
  sync -f "$temporary"
  mv -f -- "$temporary" "$PENDING_FILE"
  sync -f "$STATE_DIR"
}

journal_written=0
rollback_on_failure() {
  local exit_status=$?
  trap - ERR EXIT
  set +e
  if [ -n "${config_dump:-}" ]; then
    find "$config_dump" -maxdepth 0 -type f -delete >/dev/null 2>&1 || true
  fi
  stop_native_apt_lock_holder
  cleanup_key_staging
  if [ "$journal_written" -eq 1 ] \
    && { [ -e "$PENDING_FILE" ] || [ -L "$PENDING_FILE" ]; }; then
    if ! APT_TRANSACTION_LOCKS_HELD=1 "$RECOVERY_SCRIPT"; then
      printf '%s\n' "APT rollback was incomplete; durable journal retained and APT services remain recovery-gated." >&2
    fi
  fi
  exit "$exit_status"
}
trap rollback_on_failure ERR EXIT
write_journal prepared
journal_written=1

# Prevent the systemd APT workers from observing a mixed two-file policy. The
# journal is durable before either timer or worker is stopped, so every state
# change has a boot-recoverable predecessor. Native fcntl locks were acquired
# before the backup snapshot, so a worker that fired meanwhile is only blocked.
systemctl stop apt-daily.timer apt-daily-upgrade.timer
systemctl stop apt-daily.service apt-daily-upgrade.service >/dev/null 2>&1 || true
for attempt in $(seq 1 60); do
  daily_worker_state="$(systemctl show apt-daily.service --property=ActiveState --value)"
  upgrade_worker_state="$(systemctl show apt-daily-upgrade.service --property=ActiveState --value)"
  if [[ "$daily_worker_state" =~ ^(inactive|failed)$ ]] \
    && [[ "$upgrade_worker_state" =~ ^(inactive|failed)$ ]]; then
    break
  fi
  [ "$attempt" -lt 60 ] || fail "an APT systemd worker did not quiesce"
  sleep 1
done

safe_unlink_control() {
  local target=$1
  if [ -e "$target" ] || [ -L "$target" ]; then
    [ -f "$target" ] && [ ! -L "$target" ] \
      && [ "$(readlink -e "$target")" = "$target" ] \
      && [ "$(stat -c '%U:%G:%h' "$target")" = root:root:1 ] \
      || fail "refusing to disable unsafe APT policy member: $target"
    unlink "$target"
    sync -f "${target%/*}"
  fi
}

# Disable every legacy/unknown repository and preference, including any
# NodeSource channel, before installing the exact Jammy/nginx.org policy. The
# path inventory and byte backups above make this fully journal-recoverable.
safe_unlink_control /etc/apt/sources.list
for target in "${existing_source_controls[@]}" "${existing_preference_controls[@]}"; do
  safe_unlink_control "$target"
done
if [ ! -e /etc/apt/keyrings ] && [ ! -L /etc/apt/keyrings ]; then
  install -d -o root -g root -m 0755 /etc/apt/keyrings
fi
atomic_install "$KEY_STAGING/ubuntu-archive-2018.gpg" \
  /etc/apt/keyrings/resume-ai-ubuntu-archive-2018.gpg 0644
atomic_install "$KEY_STAGING/nginx-archive-keyring.gpg" \
  /usr/share/keyrings/nginx-archive-keyring.gpg 0644
atomic_install "$OPS_DIR/apt/resume-ai-ubuntu.sources" \
  /etc/apt/sources.list.d/resume-ai-ubuntu.sources 0644
atomic_install "$OPS_DIR/apt/nginx.list" \
  /etc/apt/sources.list.d/nginx.list 0644
atomic_install "$OPS_DIR/apt/99resume-ai-ubuntu" \
  /etc/apt/preferences.d/99resume-ai-ubuntu 0644
atomic_install "$OPS_DIR/apt/99nginx" \
  /etc/apt/preferences.d/99nginx 0644
atomic_install "$OPS_DIR/apt/ubuntu-pro-esm-apps" \
  /etc/apt/preferences.d/ubuntu-pro-esm-apps 0644
atomic_install "$OPS_DIR/apt/ubuntu-pro-esm-infra" \
  /etc/apt/preferences.d/ubuntu-pro-esm-infra 0644
esm_arguments=()
if [ "$ESM_MODE" = enabled ]; then
  atomic_install "$OPS_DIR/apt/ubuntu-esm-apps.list" \
    /etc/apt/sources.list.d/ubuntu-esm-apps.list 0644
  atomic_install "$OPS_DIR/apt/ubuntu-esm-infra.list" \
    /etc/apt/sources.list.d/ubuntu-esm-infra.list 0644
  esm_arguments=(--enable-esm)
fi
printf 'SCHEMA_VERSION=1\nESM_MODE=%s\n' "$ESM_MODE" > "$KEY_STAGING/apt-policy.env"
chmod 0600 "$KEY_STAGING/apt-policy.env"
atomic_install "$KEY_STAGING/apt-policy.env" /etc/resume-ai/apt-policy.env 0400
python3 -I "$OPS_DIR/bin/assert-apt-trust-contract.py" \
  --root / --templates "$OPS_DIR/apt" "${esm_arguments[@]}" >/dev/null
write_journal sources_installed

selected_upgrade="$OPS_DIR/apt/52resume-ai-unattended-upgrades"
if [ "$ESM_MODE" = enabled ]; then
  selected_upgrade="$OPS_DIR/apt/52resume-ai-unattended-upgrades-esm"
fi
atomic_install "$OPS_DIR/apt/20auto-upgrades" \
  /etc/apt/apt.conf.d/20auto-upgrades 0644
atomic_install "$selected_upgrade" \
  /etc/apt/apt.conf.d/52resume-ai-unattended-upgrades 0644
atomic_install "$OPS_DIR/apt/apt-daily.timer.conf" \
  /etc/systemd/system/apt-daily.timer.d/resume-ai-schedule.conf 0644
atomic_install "$OPS_DIR/apt/apt-daily-upgrade.timer.conf" \
  /etc/systemd/system/apt-daily-upgrade.timer.d/resume-ai-schedule.conf 0644
write_journal files_installed

# Release the configuration-phase native locks immediately before apt-get;
# apt-get then acquires the same native lock set for its own update transaction.
stop_native_apt_lock_holder
apt_update_stdout="$KEY_STAGING/apt-update.stdout"
apt_update_stderr="$KEY_STAGING/apt-update.stderr"
if ! LC_ALL=C apt-get update > "$apt_update_stdout" 2> "$apt_update_stderr"; then
  fail "apt-get update rejected the exact managed source policy"
fi
[ ! -s "$apt_update_stderr" ] || fail "apt-get update emitted a source, pin, or trust warning"
targets_dump="$KEY_STAGING/apt-indextargets.txt"
targets_stderr="$KEY_STAGING/apt-indextargets.stderr"
if ! env -i PATH="$PATH" apt-get indextargets \
  --format '$(SITE)|$(RELEASE)|$(CODENAME)|$(COMPONENT)|$(ARCHITECTURE)|$(IDENTIFIER)|$(CREATED_BY)|$(FILENAME)|$(TRUSTED)' \
  > "$targets_dump" 2> "$targets_stderr"; then
  fail "active APT Packages targets could not be enumerated"
fi
[ ! -s "$targets_stderr" ] || fail "APT warned while enumerating exact Packages targets"
"$OPS_DIR/bin/assert-apt-active-sources.sh" \
  "$OPS_DIR/config/approved-apt-sources.conf" "$targets_dump" \
  "${esm_arguments[@]}" >/dev/null

nginx_policy="$KEY_STAGING/nginx-policy.txt"
nginx_policy_stderr="$KEY_STAGING/nginx-policy.stderr"
if ! LC_ALL=C apt-cache policy nginx > "$nginx_policy" 2> "$nginx_policy_stderr"; then
  fail "effective Nginx package policy could not be inspected"
fi
[ ! -s "$nginx_policy_stderr" ] || fail "APT warned while parsing the exact Nginx pin"
[ "$(awk '/^[[:space:]]*Candidate:/ { print $2; count += 1 } END { if (count != 1) exit 2 }' \
    "$nginx_policy")" = 1.30.4-1~jammy ] \
  || fail "effective Nginx APT candidate differs from the exact approved package"

config_dump="$(mktemp /var/tmp/resume-ai-unattended-config.XXXXXX)"
env -i PATH="$PATH" apt-config dump > "$config_dump"
chmod 0600 "$config_dump"
"$OPS_DIR/bin/assert-apt-effective-config.sh" \
  "$OPS_DIR/config/approved-apt-effective.conf" "$config_dump" >/dev/null
python3 -I "$OPS_DIR/bin/assert-unattended-upgrades-config.py" \
  --dump "$config_dump" --esm "$ESM_MODE" >/dev/null
find "$config_dump" -maxdepth 0 -type f -delete
config_dump=
timeout 300 unattended-upgrade --dry-run >/dev/null

systemctl daemon-reload
systemctl enable apt-daily.timer apt-daily-upgrade.timer >/dev/null
systemctl start apt-daily.timer apt-daily-upgrade.timer
write_journal timers_enabled
"$OPS_DIR/bin/assert-unattended-upgrades-runtime.sh" "$OPS_DIR" "$ESM_MODE" >/dev/null
write_journal validated

result_temp="$(mktemp "$BACKUP_DIR/.RESULT.XXXXXX")"
printf 'completed-at=%s\nesm-mode=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$ESM_MODE" > "$result_temp"
chown root:root "$result_temp"
chmod 0600 "$result_temp"
sync -f "$result_temp"
mv -f -- "$result_temp" "$BACKUP_DIR/RESULT"
sync -f "$BACKUP_DIR"
unlink "$PENDING_FILE"
sync -f "$STATE_DIR"
journal_written=0
cleanup_key_staging
trap - ERR EXIT
printf '%s\n' "Installed exact unattended-upgrades policy and timer state; backup: $BACKUP_DIR"
