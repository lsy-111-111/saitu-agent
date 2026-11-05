#!/usr/bin/env bash
set -Eeuo pipefail
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH
fail() { printf '%s\n' "ERROR: $*" >&2; exit 1; }
[ "${EUID:-$(id -u)}" -eq 0 ] || fail "run as root"
[ "$#" -eq 0 ] || fail "QCloud control recovery accepts no arguments"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
. "$SCRIPT_DIR/open-root-lock.sh"
open_root_lock 8 deploy
open_root_lock 9 qcloud-control
STATE_DIR=/var/lib/resume-ai/security
PENDING_FILE="$STATE_DIR/qcloud-control.pending"
[ -e "$PENDING_FILE" ] || exit 0
[ -f "$PENDING_FILE" ] && [ ! -L "$PENDING_FILE" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$PENDING_FILE")" = root:root:600:1 ] \
  || fail "QCloud control journal is unsafe"
declare -A values=()
while IFS='=' read -r key value || [ -n "$key" ]; do
  case "$key" in SCHEMA_VERSION|BACKUP_DIR|BACKUP_MANIFEST_SHA256|GENERATION_SHA256|PHASE) ;; *) fail "unknown QCloud journal key" ;; esac
  [ -z "${values[$key]:-}" ] || fail "duplicate QCloud journal key"
  values[$key]=$value
done < "$PENDING_FILE"
[ "${values[SCHEMA_VERSION]:-}" = 2 ] || fail "invalid QCloud journal schema"
BACKUP_DIR=${values[BACKUP_DIR]:-}
case "$BACKUP_DIR" in /var/backups/resume-ai/qcloud-control/20??????T??????Z) ;; *) fail "invalid QCloud backup path" ;; esac
[[ "${values[GENERATION_SHA256]:-}" =~ ^[a-f0-9]{64}$ ]] || fail "invalid QCloud generation"
[[ "${values[BACKUP_MANIFEST_SHA256]:-}" =~ ^[a-f0-9]{64}$ ]] \
  || fail "invalid QCloud backup manifest identity"
case "${values[PHASE]:-}" in prepared|installed) ;; *) fail "invalid QCloud journal phase" ;; esac
[ -d "$BACKUP_DIR" ] && [ ! -L "$BACKUP_DIR" ] \
  && [ "$(readlink -e -- "$BACKUP_DIR")" = "$BACKUP_DIR" ] \
  && [ "$(stat -c '%U:%G:%a' "$BACKUP_DIR")" = root:root:700 ] \
  || fail "QCloud backup directory is unsafe"
BACKUP_MANIFEST="$BACKUP_DIR/BACKUP_SHA256SUMS"
[ -f "$BACKUP_MANIFEST" ] && [ ! -L "$BACKUP_MANIFEST" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$BACKUP_MANIFEST")" = root:root:600:1 ] \
  && [ "$(sha256sum "$BACKUP_MANIFEST" | awk '{print $1}')" = \
    "${values[BACKUP_MANIFEST_SHA256]}" ] \
  && (cd "$BACKUP_DIR" && sha256sum --strict -c BACKUP_SHA256SUMS >/dev/null) \
  || fail "QCloud backup members differ from the durable manifest"
targets=(
  /usr/local/lib/resume-ai/qcloud-network-control.py
  /usr/local/lib/resume-ai/rc-local-backup.py
  /usr/local/lib/resume-ai/run-qcloud-network-tuning.sh
  /etc/systemd/system/resume-ai-qcloud-network-tuning@.service
  /etc/udev/rules.d/80-qcloud-nic.rules
  /usr/local/share/resume-ai/approved-qcloud-network-tuning.conf
)
modes=(0755 0755 0755 0644 0644 0444)
for target in "${targets[@]}"; do
  [ -d "${target%/*}" ] && [ ! -L "${target%/*}" ] \
    && [ "$(readlink -e -- "${target%/*}")" = "${target%/*}" ] \
    && [ "$(stat -c '%U' "${target%/*}")" = root ] \
    && [ -z "$(find "${target%/*}" -maxdepth 0 -perm /022 -print -quit)" ] \
    || fail "QCloud recovery target directory is unsafe or traverses a link"
done
# Verify the complete rollback payload before the first target replacement.
for index in "${!targets[@]}"; do
  target=${targets[$index]}
  backup_name=${target#/}
  backup_name=${backup_name//\//__}
  state="$BACKUP_DIR/$backup_name.state"
  [ -f "$state" ] && [ ! -L "$state" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$state")" = root:root:600:1 ] \
    || fail "QCloud backup state is unsafe"
  case "$(cat "$state")" in
    present)
      backup="$BACKUP_DIR/$backup_name"
      [ -f "$backup" ] && [ ! -L "$backup" ] \
        && [ "$(stat -c '%U:%G:%a:%h' "$backup")" = \
          "root:root:${modes[$index]#0}:1" ] \
        || fail "QCloud backup payload is unsafe"
      ;;
    absent) ;;
    *) fail "invalid QCloud backup state" ;;
  esac
done
for index in "${!targets[@]}"; do
  target=${targets[$index]}
  backup_name=${target#/}
  backup_name=${backup_name//\//__}
  state="$BACKUP_DIR/$backup_name.state"
  [ -f "$state" ] && [ ! -L "$state" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$state")" = root:root:600:1 ] \
    || fail "QCloud backup state is unsafe"
  case "$(cat "$state")" in
    present)
      backup="$BACKUP_DIR/$backup_name"
      [ -f "$backup" ] && [ ! -L "$backup" ] && [ "$(stat -c '%U:%h' "$backup")" = root:1 ] \
        || fail "QCloud backup payload is unsafe"
      temporary="$(mktemp "${target%/*}/.${target##*/}.restore.XXXXXX")"
      cp -a -- "$backup" "$temporary"
      sync -f "$temporary"
      mv -f -- "$temporary" "$target"
      sync -f "${target%/*}"
      [ "$(stat -c '%U:%G:%a:%h' "$target")" = \
        "root:root:${modes[$index]#0}:1" ] \
        || fail "restored QCloud target ownership or mode differs"
      ;;
    absent)
      if [ -e "$target" ] || [ -L "$target" ]; then
        [ -f "$target" ] && [ ! -L "$target" ] && [ "$(stat -c '%h' "$target")" = 1 ] \
          || fail "QCloud recovery target is unsafe"
        unlink "$target"
        sync -f "${target%/*}"
      fi
      ;;
    *) fail "invalid QCloud backup state" ;;
  esac
done
systemctl daemon-reload
udevadm control --reload
unlink "$PENDING_FILE"
sync -f "$STATE_DIR"
printf '%s\n' "Recovered the previous QCloud control generation."
