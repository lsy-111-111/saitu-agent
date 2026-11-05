#!/usr/bin/bash
set -euo pipefail

PATH=/usr/sbin:/usr/bin
export PATH

fail() {
  printf '%s\n' "ERROR: $*" >&2
  exit 1
}

[ "${EUID:-$(/usr/bin/id -u)}" -eq 0 ] || fail "run as root"
[ "${ACK_DISABLE_RC_LOCAL:-}" = "YES" ] || fail "explicit rc-local disable acknowledgement is required"
for system_directory in /usr /usr/bin /usr/sbin; do
  [ -d "$system_directory" ] && [ ! -L "$system_directory" ] \
    && [ "$(/usr/bin/stat -c '%U:%G' "$system_directory")" = root:root ] \
    && [ -z "$(/usr/bin/find "$system_directory" -maxdepth 0 -perm /022 -print -quit)" ] \
    || fail "system command directory is linked or unsafe: $system_directory"
done
SCRIPT_DIR="$(cd -- "$(/usr/bin/dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
OPS_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
SOURCE_POLICY="$OPS_DIR/config/approved-qcloud-network-tuning.conf"
SOURCE_RULE="$OPS_DIR/udev/80-qcloud-nic.rules"
SOURCE_RUNNER="$SCRIPT_DIR/run-qcloud-network-tuning.sh"
SOURCE_UNIT="$OPS_DIR/systemd/resume-ai-qcloud-network-tuning@.service"
SOURCE_CONTROL_HELPER="$SCRIPT_DIR/qcloud-network-control.py"
SOURCE_BACKUP_TOOL="$SCRIPT_DIR/rc-local-backup.py"

assert_trusted_source_chain() {
  local current=$1
  while :; do
    [ -d "$current" ] && [ ! -L "$current" ] \
      && [ "$(/usr/bin/stat -c '%U' "$current")" = root ] \
      && [ -z "$(/usr/bin/find "$current" -maxdepth 0 -perm /022 -print -quit)" ] \
      || fail "reviewed source directory is linked or writable: $current"
    [ "$current" = / ] && break
    current="$(/usr/bin/dirname -- "$current")"
  done
}
assert_trusted_source_chain "$OPS_DIR"

declare -A REVIEWED_SOURCE_SHA256=()
for reviewed_source in \
  "$SOURCE_POLICY" "$SOURCE_RULE" "$SOURCE_RUNNER" "$SOURCE_UNIT" \
  "$SOURCE_CONTROL_HELPER" "$SOURCE_BACKUP_TOOL"; do
  [ -f "$reviewed_source" ] && [ ! -L "$reviewed_source" ] \
    && [ "$(/usr/bin/stat -c '%U:%h' "$reviewed_source")" = root:1 ] \
    && [ -z "$(/usr/bin/find "$reviewed_source" -maxdepth 0 -perm /022 -print -quit)" ] \
    || fail "reviewed rc-local/QCloud source is linked or unsafe: $reviewed_source"
  REVIEWED_SOURCE_SHA256["$reviewed_source"]="$(/usr/bin/sha256sum "$reviewed_source" | /usr/bin/awk '{print $1}')"
done

[ -f /etc/rc.local ] && [ ! -L /etc/rc.local ] \
  && [ "$(stat -c '%U:%G:%h' /etc/rc.local)" = root:root:1 ] \
  || fail "/etc/rc.local is missing, linked, or unsafe"
[ -L /etc/rc.d/rc.local ] && [ "$(readlink /etc/rc.d/rc.local)" = /etc/rc.local ] \
  || fail "/etc/rc.d/rc.local is not the preserved exact link to /etc/rc.local"
[ -f /etc/udev/rules.d/80-qcloud-nic.rules ] \
  && [ ! -L /etc/udev/rules.d/80-qcloud-nic.rules ] \
  && [ "$(stat -c '%U:%G:%a:%h' /etc/udev/rules.d/80-qcloud-nic.rules)" = root:root:644:1 ] \
  || fail "Tencent Cloud udev network tuning rule is missing or unsafe"

BACKUP_ROOT=/var/backups/resume-ai/rc-local
umask 077
if [ -e "$BACKUP_ROOT" ] || [ -L "$BACKUP_ROOT" ]; then
  [ -d "$BACKUP_ROOT" ] && [ ! -L "$BACKUP_ROOT" ] \
    && [ "$(stat -c '%U:%G:%a' "$BACKUP_ROOT")" = root:root:700 ] \
    || fail "rc-local backup root is linked or unsafe"
else
  install -d -o root -g root -m 0700 "$BACKUP_ROOT"
  sync -f "$(/usr/bin/dirname -- "$BACKUP_ROOT")"
fi
backup_timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_PENDING="$(mktemp -d "$BACKUP_ROOT/.pending-$backup_timestamp.XXXXXXXX")"
chown root:root "$BACKUP_PENDING"
chmod 0700 "$BACKUP_PENDING"
cleanup_pending_backup() {
  local pending=${BACKUP_PENDING:-} pending_parent pending_name
  [ -n "$pending" ] || return 0
  pending_parent="$(/usr/bin/dirname -- "$pending")"
  pending_name="$(/usr/bin/basename -- "$pending")"
  [ "$pending_parent" = "$BACKUP_ROOT" ] \
    && [[ "$pending_name" =~ ^\.pending-20[0-9]{6}T[0-9]{6}Z\.[A-Za-z0-9]{8}$ ]] \
    && [ -d "$pending" ] && [ ! -L "$pending" ] \
    && [ "$(stat -c '%U:%G:%a' "$pending")" = root:root:700 ] \
    || fail "refusing to clean an unexpected rc-local pending backup path"
  /usr/bin/rm -rf --one-file-system -- "$pending"
  sync -f "$BACKUP_ROOT"
}
trap cleanup_pending_backup EXIT
BACKUP_ID="${BACKUP_PENDING##*/.pending-}"
case "$BACKUP_ID" in
  20??????T??????Z.[A-Za-z0-9][A-Za-z0-9][A-Za-z0-9][A-Za-z0-9][A-Za-z0-9][A-Za-z0-9][A-Za-z0-9][A-Za-z0-9]) ;;
  *) fail "generated rc-local backup ID is invalid" ;;
esac
BACKUP_DIR="$BACKUP_ROOT/$BACKUP_ID"
[ ! -e "$BACKUP_DIR" ] && [ ! -L "$BACKUP_DIR" ] \
  || fail "final rc-local backup directory already exists"
systemctl status rc-local.service > "$BACKUP_PENDING/rc-local-status.txt" 2>&1 || true
chown root:root "$BACKUP_PENDING/rc-local-status.txt"
chmod 0600 "$BACKUP_PENDING/rc-local-status.txt"
/usr/bin/python3 -I "$SOURCE_BACKUP_TOOL" create "$BACKUP_PENDING" "$BACKUP_ID"
/usr/bin/python3 -I "$SOURCE_BACKUP_TOOL" verify "$BACKUP_PENDING" \
  --expected-backup-id "$BACKUP_ID" --production >/dev/null
sync -f "$BACKUP_PENDING"
mv -T -- "$BACKUP_PENDING" "$BACKUP_DIR"
sync -f "$BACKUP_ROOT"
BACKUP_PENDING=
trap - EXIT
/usr/bin/python3 -I "$SOURCE_BACKUP_TOOL" verify "$BACKUP_DIR" --production >/dev/null

atomic_install() {
  local source=$1 destination=$2 owner=$3 group=$4 mode=$5 destination_dir temp source_before expected_sha256
  destination_dir="$(/usr/bin/dirname -- "$destination")"
  assert_trusted_source_chain "$destination_dir"
  expected_sha256="${REVIEWED_SOURCE_SHA256[$source]:-}"
  [ -n "$expected_sha256" ] || fail "atomic install source was not frozen during preflight"
  source_before="$(stat -c '%d:%i:%s:%Y:%Z' "$source")"
  [ "$(sha256sum "$source" | awk '{print $1}')" = "$expected_sha256" ] \
    || fail "reviewed source changed before atomic install: $source"
  temp="$(mktemp "$destination_dir/.$(/usr/bin/basename -- "$destination").XXXXXX")"
  install -o "$owner" -g "$group" -m "$mode" "$source" "$temp"
  [ "$(sha256sum "$temp" | awk '{print $1}')" = "$expected_sha256" ] \
    || fail "atomic install copy differs from the frozen source: $source"
  [ "$(stat -c '%d:%i:%s:%Y:%Z' "$source")" = "$source_before" ] \
    && [ "$(sha256sum "$source" | awk '{print $1}')" = "$expected_sha256" ] \
    || fail "reviewed source changed during atomic install: $source"
  sync -f "$temp"
  mv -T -f -- "$temp" "$destination"
  sync -f "$destination_dir"
}

atomic_install "$SOURCE_CONTROL_HELPER" \
  /usr/local/lib/resume-ai/qcloud-network-control.py root root 0755
atomic_install "$SOURCE_BACKUP_TOOL" \
  /usr/local/lib/resume-ai/rc-local-backup.py root root 0755
atomic_install "$SOURCE_POLICY" \
  /usr/local/share/resume-ai/approved-qcloud-network-tuning.conf root root 0444
atomic_install "$SOURCE_RUNNER" \
  /usr/local/lib/resume-ai/run-qcloud-network-tuning.sh root root 0755
/usr/local/lib/resume-ai/run-qcloud-network-tuning.sh --verify-only >/dev/null
atomic_install "$SOURCE_UNIT" \
  /etc/systemd/system/resume-ai-qcloud-network-tuning@.service root root 0644
atomic_install "$SOURCE_RULE" \
  /etc/udev/rules.d/80-qcloud-nic.rules root root 0644

# Preserve the legacy script byte-for-byte but make it non-executable. The
# local unit is replaced only after a durable backup with an explicit /dev/null
# mask; the recursive script itself is never sourced, repaired, or run.
chmod 0644 /etc/rc.local
systemctl stop rc-local.service >/dev/null 2>&1 || true
if [ -e /etc/systemd/system/rc-local.service ] || [ -L /etc/systemd/system/rc-local.service ]; then
  [ ! -d /etc/systemd/system/rc-local.service ] \
    || fail "rc-local.service override is unexpectedly a directory"
  unlink /etc/systemd/system/rc-local.service
fi
ln -s /dev/null /etc/systemd/system/rc-local.service
sync -f /etc/systemd/system
systemctl daemon-reload
udevadm control --reload
systemctl reset-failed rc-local.service >/dev/null 2>&1 || true
[ "$(systemctl is-active rc-local.service 2>/dev/null || true)" = "inactive" ] \
  || fail "rc-local.service is not inactive"
enablement="$(systemctl is-enabled rc-local.service 2>/dev/null || true)"
[ "$enablement" = masked ] || fail "rc-local.service is not masked"
[ -L /etc/systemd/system/rc-local.service ] \
  && [ "$(readlink /etc/systemd/system/rc-local.service)" = /dev/null ] \
  || fail "rc-local.service does not have the exact local /dev/null mask"
[ "$(stat -c '%U:%G:%a:%h' /etc/rc.local)" = root:root:644:1 ] \
  || fail "/etc/rc.local was not preserved as a non-executable root file"
cmp -s "$SOURCE_RULE" /etc/udev/rules.d/80-qcloud-nic.rules \
  && cmp -s "$SOURCE_UNIT" /etc/systemd/system/resume-ai-qcloud-network-tuning@.service \
  && cmp -s "$SOURCE_RUNNER" /usr/local/lib/resume-ai/run-qcloud-network-tuning.sh \
  && cmp -s "$SOURCE_CONTROL_HELPER" /usr/local/lib/resume-ai/qcloud-network-control.py \
  && cmp -s "$SOURCE_BACKUP_TOOL" /usr/local/lib/resume-ai/rc-local-backup.py \
  && cmp -s "$SOURCE_POLICY" /usr/local/share/resume-ai/approved-qcloud-network-tuning.conf \
  || fail "installed QCloud network tuning controls differ from the reviewed release"
/usr/bin/python3 -I "$SOURCE_CONTROL_HELPER" host-state >/dev/null \
  || fail "QCloud/rc-local retains an unreviewed effective execution path"
/usr/bin/python3 -I /usr/local/lib/resume-ai/rc-local-backup.py verify \
  "$BACKUP_DIR" --production >/dev/null \
  || fail "completed rc-local migration backup is no longer recoverable"
printf '%s\n' \
  "rc-local.service is inactive and masked. A complete recoverable backup was frozen at $BACKUP_DIR; QCloud NIC tuning now runs only from stable reviewed descriptors behind PrivateTmp."
