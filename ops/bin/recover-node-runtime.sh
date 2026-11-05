#!/usr/bin/env bash
set -Eeuo pipefail
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

fail() {
  printf '%s\n' "ERROR: $*" >&2
  exit 1
}

[ "${EUID:-$(id -u)}" -eq 0 ] || fail "run as root"
[ "$#" -eq 0 ] || fail "Node runtime recovery accepts no arguments"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
. "$SCRIPT_DIR/open-root-lock.sh"
PENDING_FILE=/opt/nodejs/node-runtime.pending
CURRENT_LINK=/opt/nodejs/current
NODE_ROOT=/opt/nodejs
PM2_UNIT=/etc/systemd/system/resume-ai-pm2.service
LOGROTATE_FILE=/etc/logrotate.d/resume-ai
PM2_DUMP=/var/lib/resume-ai/.pm2/dump.pm2

[ -f "$PENDING_FILE" ] && [ ! -L "$PENDING_FILE" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$PENDING_FILE")" = root:root:600:1 ] \
  || fail "Node runtime recovery journal is missing or unsafe"
open_root_lock 8 deploy
open_root_lock 9 node-runtime
set +e
"$SCRIPT_DIR/node-runtime-recovery-gate.sh"
gate_status=$?
set -e
case "$gate_status" in
  0) ;;
  1) fail "a live Node runtime installer still owns the recovery journal" ;;
  *) fail "Node runtime recovery gate rejected the journal" ;;
esac

KIND=
PHASE=
BACKUP_DIR=
PREVIOUS_TARGET=
FINAL_DIR=
UNIT_BACKUP=
LOGROTATE_BACKUP=
PM2_DUMP_BACKUP=
PM2_DUMP_EXISTED=
SERVICE_WAS_ACTIVE=
while IFS='=' read -r key value || [ -n "$key" ]; do
  case "$key" in
    KIND) [ -z "$KIND" ] || fail "duplicate Node journal key"; KIND=$value ;;
    PHASE) [ -z "$PHASE" ] || fail "duplicate Node journal key"; PHASE=$value ;;
    BACKUP_DIR) [ -z "$BACKUP_DIR" ] || fail "duplicate Node journal key"; BACKUP_DIR=$value ;;
    PREVIOUS_TARGET) [ -z "$PREVIOUS_TARGET" ] || fail "duplicate Node journal key"; PREVIOUS_TARGET=$value ;;
    FINAL_DIR) [ -z "$FINAL_DIR" ] || fail "duplicate Node journal key"; FINAL_DIR=$value ;;
    UNIT_BACKUP) [ -z "$UNIT_BACKUP" ] || fail "duplicate Node journal key"; UNIT_BACKUP=$value ;;
    LOGROTATE_BACKUP) [ -z "$LOGROTATE_BACKUP" ] || fail "duplicate Node journal key"; LOGROTATE_BACKUP=$value ;;
    PM2_DUMP_BACKUP) [ -z "$PM2_DUMP_BACKUP" ] || fail "duplicate Node journal key"; PM2_DUMP_BACKUP=$value ;;
    PM2_DUMP_EXISTED) [ -z "$PM2_DUMP_EXISTED" ] || fail "duplicate Node journal key"; PM2_DUMP_EXISTED=$value ;;
    SERVICE_WAS_ACTIVE) [ -z "$SERVICE_WAS_ACTIVE" ] || fail "duplicate Node journal key"; SERVICE_WAS_ACTIVE=$value ;;
    *) fail "unknown Node runtime journal key" ;;
  esac
done < "$PENDING_FILE"

[ "$KIND" = node-runtime ] || fail "Node runtime journal kind is invalid"
case "$PHASE" in prepared|runtime_ready|pointer_switched|unit_installed|service_restarted|sources_disabled|committed) ;; *) fail "Node runtime journal phase is invalid" ;; esac
case "$BACKUP_DIR" in /var/backups/resume-ai/node-runtime/20??????T??????Z) ;; *) fail "Node runtime backup path is invalid" ;; esac
[ -d "$BACKUP_DIR" ] && [ ! -L "$BACKUP_DIR" ] \
  && [ "$(readlink -e -- "$BACKUP_DIR")" = "$BACKUP_DIR" ] \
  && [ "$(stat -c '%U:%G:%a' "$BACKUP_DIR")" = root:root:700 ] \
  || fail "Node runtime rollback evidence is unsafe"
[ "$FINAL_DIR" = /opt/nodejs/node-v24.20.0-linux-x64 ] \
  || fail "Node runtime final directory is outside the reviewed target"
if [ "$PREVIOUS_TARGET" != none ]; then
  [[ "$PREVIOUS_TARGET" =~ ^node-v[0-9]+\.[0-9]+\.[0-9]+-linux-x64$ \
    || "$PREVIOUS_TARGET" =~ ^/opt/nodejs/node-v[0-9]+\.[0-9]+\.[0-9]+-linux-x64$ ]] \
    || fail "previous Node runtime target is unsafe"
fi
case "$UNIT_BACKUP" in none|"$BACKUP_DIR/resume-ai-pm2.service.before") ;; *) fail "PM2 unit backup path is unsafe" ;; esac
case "$LOGROTATE_BACKUP" in none|"$BACKUP_DIR/resume-ai-logrotate.before") ;; *) fail "logrotate backup path is unsafe" ;; esac
case "$PM2_DUMP_BACKUP" in none|"$BACKUP_DIR/dump.pm2.before") ;; *) fail "PM2 dump backup path is unsafe" ;; esac
case "$PM2_DUMP_EXISTED:$SERVICE_WAS_ACTIVE" in [01]:[01]) ;; *) fail "Node runtime journal flags are invalid" ;; esac

for backup_file in "$UNIT_BACKUP" "$LOGROTATE_BACKUP" "$PM2_DUMP_BACKUP"; do
  [ "$backup_file" = none ] && continue
  [ -f "$backup_file" ] && [ ! -L "$backup_file" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$backup_file")" = root:root:600:1 ] \
    || fail "Node runtime rollback member is unsafe"
done

# Stop a possibly half-migrated *running* supervisor before changing its
# interpreter, unit or dump.  At boot the PM2 start job is ordered after this
# recovery unit; cancelling that queued job here could strand an otherwise
# valid rollback, so an inactive/activating unit is left to systemd ordering.
if systemctl is-active --quiet resume-ai-pm2.service; then
  systemctl stop resume-ai-pm2.service
fi
if [ "$PREVIOUS_TARGET" = none ]; then
  [ ! -e "$CURRENT_LINK" ] || [ -L "$CURRENT_LINK" ] \
    || fail "Node current pointer became a non-link"
  [ ! -L "$CURRENT_LINK" ] || unlink "$CURRENT_LINK"
else
  previous_resolved=$PREVIOUS_TARGET
  case "$previous_resolved" in /*) ;; *) previous_resolved="$NODE_ROOT/$previous_resolved" ;; esac
  [ -d "$previous_resolved" ] && [ ! -L "$previous_resolved" ] \
    && [ "$(stat -c '%U:%G' "$previous_resolved")" = root:root ] \
    || fail "previous Node runtime is no longer recoverable"
  [ -x "$SCRIPT_DIR/verify-single-link-tree.sh" ] \
    && [ ! -L "$SCRIPT_DIR/verify-single-link-tree.sh" ] \
    || fail "immutable Node tree verifier is missing during recovery"
  unsafe_previous_member="$(find "$previous_resolved" -xdev ! -type l \
    \( ! -user root -o -perm /022 \) -print -quit)"
  [ -z "$unsafe_previous_member" ] \
    || fail "previous Node runtime contains a non-root or writable member"
  unsafe_previous_link="$(find "$previous_resolved" -xdev -type l ! -user root -print -quit)"
  [ -z "$unsafe_previous_link" ] \
    || fail "previous Node runtime contains a non-root symbolic link"
  "$SCRIPT_DIR/verify-single-link-tree.sh" "$previous_resolved"
  python3 -I - "$previous_resolved" <<'PY' \
    || fail "previous Node runtime contains a nested mount"
import pathlib
import sys

root = pathlib.Path(sys.argv[1]).resolve(strict=True)
mountinfo = pathlib.Path("/proc/self/mountinfo")
if not mountinfo.is_file():
    raise SystemExit(2)
for line in mountinfo.read_text(encoding="utf-8").splitlines():
    fields = line.split()
    if len(fields) < 5:
        raise SystemExit(2)
    mount = pathlib.Path(fields[4].replace("\\040", " ").replace("\\011", "\t")
                         .replace("\\012", "\n").replace("\\134", "\\"))
    try:
        mount.relative_to(root)
    except ValueError:
        continue
    raise SystemExit(1)
PY
  pointer_temp="$NODE_ROOT/.current-recovery.$$"
  [ ! -e "$pointer_temp" ] && [ ! -L "$pointer_temp" ] \
    || fail "Node recovery pointer staging path already exists"
  ln -s "$PREVIOUS_TARGET" "$pointer_temp"
  mv -Tf -- "$pointer_temp" "$CURRENT_LINK"
fi
sync -f "$NODE_ROOT"

if [ "$UNIT_BACKUP" = none ]; then
  [ ! -e "$PM2_UNIT" ] || [ -f "$PM2_UNIT" ] && [ ! -L "$PM2_UNIT" ] \
    || fail "PM2 unit recovery target is unsafe"
  [ ! -e "$PM2_UNIT" ] || unlink "$PM2_UNIT"
else
  install -o root -g root -m 0644 "$UNIT_BACKUP" "$PM2_UNIT"
fi
if [ "$LOGROTATE_BACKUP" = none ]; then
  [ ! -e "$LOGROTATE_FILE" ] || [ -f "$LOGROTATE_FILE" ] && [ ! -L "$LOGROTATE_FILE" ] \
    || fail "logrotate recovery target is unsafe"
  [ ! -e "$LOGROTATE_FILE" ] || unlink "$LOGROTATE_FILE"
else
  install -o root -g root -m 0644 "$LOGROTATE_BACKUP" "$LOGROTATE_FILE"
fi
sync -f /etc/systemd/system
sync -f /etc/logrotate.d

if [ "$PM2_DUMP_EXISTED" -eq 1 ]; then
  install -d -o resume-ai -g resume-ai -m 0750 /var/lib/resume-ai/.pm2
  install -o resume-ai -g resume-ai -m 0600 "$PM2_DUMP_BACKUP" "$PM2_DUMP"
  sync -f "$PM2_DUMP"
  sync -f /var/lib/resume-ai/.pm2
else
  [ ! -e "$PM2_DUMP" ] || [ -f "$PM2_DUMP" ] && [ ! -L "$PM2_DUMP" ] \
    || fail "PM2 dump recovery target is unsafe"
  [ ! -e "$PM2_DUMP" ] || unlink "$PM2_DUMP"
  [ ! -d /var/lib/resume-ai/.pm2 ] || sync -f /var/lib/resume-ai/.pm2
fi

if [ -f "$BACKUP_DIR/nodesource-disabled.map" ]; then
  [ ! -L "$BACKUP_DIR/nodesource-disabled.map" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$BACKUP_DIR/nodesource-disabled.map")" = root:root:600:1 ] \
    || fail "NodeSource recovery map is unsafe"
  while IFS='|' read -r original disabled backup extra || [ -n "$original" ]; do
    [ -n "$original" ] && [ -z "${extra:-}" ] \
      || fail "NodeSource recovery map is malformed"
    [ "$original" = /etc/apt/sources.list ] \
      || [[ "$original" =~ ^/etc/apt/sources\.list\.d/[A-Za-z0-9_.+-]+\.(list|sources)$ ]] \
      || fail "NodeSource source path is not approved"
    [ "$disabled" = "$original.resume-ai-disabled" ] \
      || fail "NodeSource disabled path is not bound to its source"
    case "$backup" in "$BACKUP_DIR"/nodesource/*) ;; *) fail "NodeSource backup path escapes its evidence directory" ;; esac
    [[ "${backup##*/}" =~ ^[A-Za-z0-9_.+-]+$ ]] \
      || fail "NodeSource backup name is invalid"
    if [ -f "$disabled" ] && [ ! -e "$original" ]; then
      [ ! -L "$disabled" ] && [ "$(stat -c '%U:%G:%h' "$disabled")" = root:root:1 ] \
        && [ -z "$(find "$disabled" -maxdepth 0 -perm /022 -print)" ] \
        && cmp -s "$disabled" "$backup" \
        || fail "disabled NodeSource file differs from its protected backup"
      mv -- "$disabled" "$original"
      sync -f "$(dirname "$original")"
    elif [ -e "$disabled" ] || [ ! -e "$original" ]; then
      fail "NodeSource source state cannot be recovered unambiguously"
    fi
  done < "$BACKUP_DIR/nodesource-disabled.map"
fi

systemctl daemon-reload
unlink "$PENDING_FILE"
sync -f "$NODE_ROOT"
if [ "$SERVICE_WAS_ACTIVE" -eq 1 ]; then
  systemctl start --no-block resume-ai-pm2.service
fi
printf '%s\n' "Recovered the previous Node runtime pointer and PM2 controls from $PHASE."
