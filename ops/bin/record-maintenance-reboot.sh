#!/usr/bin/env bash
set -Eeuo pipefail

fail() {
  printf '%s\n' "ERROR: $*" >&2
  exit 1
}

[ "${EUID:-$(id -u)}" -eq 0 ] || fail "run as root"
MODE=${1:-}
case "$MODE" in prepare|verify) [ "$#" -eq 1 ] || fail "unexpected argument" ;; *) fail "usage: record-maintenance-reboot.sh prepare|verify" ;; esac
[ "${ACK_MAINTENANCE_REBOOT_EVIDENCE:-}" = YES ] \
  || fail "set ACK_MAINTENANCE_REBOOT_EVIDENCE=YES for the approved maintenance reboot"

EVIDENCE_DIR=/var/lib/resume-ai/security
PENDING_FILE="$EVIDENCE_DIR/maintenance-reboot.pending"
EVIDENCE_FILE="$EVIDENCE_DIR/last-maintenance-reboot.env"
STATE_FILE=/opt/resume-ai/state/active.env
boot_id="$(tr -d '\n' < /proc/sys/kernel/random/boot_id)"
[[ "$boot_id" =~ ^[a-f0-9-]{36}$ ]] || fail "kernel boot ID is malformed"
umask 077
install -d -o root -g root -m 0700 "$EVIDENCE_DIR"

if [ "$MODE" = prepare ]; then
  [ -f "$STATE_FILE" ] && [ ! -L "$STATE_FILE" ] || fail "managed release state is unavailable"
  active_release="$(awk -F= '$1 == "ACTIVE_RELEASE" { print $2; count += 1 } END { if (count != 1) exit 2 }' "$STATE_FILE")"
  case "$active_release" in 20??????T??????Z) ;; *) fail "active release is invalid" ;; esac
  pending_temp="$(mktemp "$EVIDENCE_DIR/.maintenance-reboot.XXXXXX")"
  cat > "$pending_temp" <<EOF
SCHEMA_VERSION=1
BEFORE_BOOT_ID=$boot_id
ACTIVE_RELEASE=$active_release
REQUESTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF
  chown root:root "$pending_temp"
  chmod 0600 "$pending_temp"
  mv -f -- "$pending_temp" "$PENDING_FILE"
  rm -f -- "$EVIDENCE_FILE"
  sync -f "$PENDING_FILE"
  sync -f "$EVIDENCE_DIR"
  printf '%s\n' "Recorded pre-reboot boot ID. Reboot through the approved maintenance workflow, then run verify."
  exit 0
fi

[ -f "$PENDING_FILE" ] && [ ! -L "$PENDING_FILE" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$PENDING_FILE")" = root:root:600:1 ] \
  || fail "pre-reboot evidence is missing or unsafe"
declare -A pending=()
while IFS='=' read -r key value || [ -n "$key" ]; do
  case "$key" in SCHEMA_VERSION|BEFORE_BOOT_ID|ACTIVE_RELEASE|REQUESTED_AT) ;; *) fail "unexpected pre-reboot evidence key" ;; esac
  [ -z "${pending[$key]:-}" ] || fail "duplicate pre-reboot evidence key"
  pending[$key]=$value
done < "$PENDING_FILE"
[ "${pending[SCHEMA_VERSION]:-}" = 1 ] || fail "pre-reboot evidence schema is invalid"
[[ "${pending[BEFORE_BOOT_ID]:-}" =~ ^[a-f0-9-]{36}$ ]] || fail "recorded boot ID is malformed"
[ "${pending[BEFORE_BOOT_ID]}" != "$boot_id" ] || fail "boot ID did not change; no reboot has occurred"
grep -Fxq "ACTIVE_RELEASE=${pending[ACTIVE_RELEASE]}" "$STATE_FILE" \
  || fail "active release changed outside the maintenance reboot evidence workflow"
systemctl is-active --quiet resume-ai-pm2.service || fail "PM2 did not recover after reboot"
systemctl is-active --quiet nginx.service || fail "Nginx did not recover after reboot"
/usr/local/lib/resume-ai/verify-release-consistency.sh "$STATE_FILE" >/dev/null
evidence_temp="$(mktemp "$EVIDENCE_DIR/.last-maintenance-reboot.XXXXXX")"
cat > "$evidence_temp" <<EOF
SCHEMA_VERSION=1
BEFORE_BOOT_ID=${pending[BEFORE_BOOT_ID]}
AFTER_BOOT_ID=$boot_id
ACTIVE_RELEASE=${pending[ACTIVE_RELEASE]}
REQUESTED_AT=${pending[REQUESTED_AT]}
VERIFIED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
SERVICES_RECOVERED=YES
EOF
chown root:root "$evidence_temp"
chmod 0600 "$evidence_temp"
mv -f -- "$evidence_temp" "$EVIDENCE_FILE"
rm -f -- "$PENDING_FILE"
sync -f "$EVIDENCE_FILE"
sync -f "$EVIDENCE_DIR"
printf '%s\n' "Verified a real maintenance reboot and durable application recovery."
