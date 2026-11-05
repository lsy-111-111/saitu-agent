#!/usr/bin/env bash
set -Eeuo pipefail
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

fail() {
  printf '%s\n' "ERROR: $*" >&2
  exit 1
}

[ "${EUID:-$(id -u)}" -eq 0 ] || fail "run as root"
[ "$#" -eq 0 ] || fail "Nginx recovery finalizer accepts no arguments"
PENDING_FILE=/opt/resume-ai/state/nginx-migration.pending
[ -e "$PENDING_FILE" ] || exit 0
[ -f "$PENDING_FILE" ] && [ ! -L "$PENDING_FILE" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$PENDING_FILE")" = root:root:600:1 ] \
  || fail "Nginx migration journal is unsafe during start finalization"
grep -Fxq 'PHASE=recovered_waiting_for_service' "$PENDING_FILE" || exit 0

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
. "$SCRIPT_DIR/open-root-lock.sh"
open_root_lock 8 deploy
open_root_lock 9 nginx-migration

BACKUP_DIR=
SAFE_CONFIG_SHA256=
APT_CONTRACT_SHA256=
PHASE=
declare -A seen=()
while IFS='=' read -r key value || [ -n "$key" ]; do
  case "$key" in BACKUP_DIR|SAFE_CONFIG_SHA256|APT_CONTRACT_SHA256|PHASE) ;; *) fail "unknown Nginx finalizer journal key" ;; esac
  [ -z "${seen[$key]:-}" ] || fail "duplicate Nginx finalizer journal key"
  seen[$key]=1
  printf -v "$key" '%s' "$value"
done < "$PENDING_FILE"
[ "$PHASE" = recovered_waiting_for_service ] || exit 0
case "$BACKUP_DIR" in /var/backups/resume-ai/nginx-migration/20??????T??????Z) ;; \
  *) fail "unsafe Nginx finalizer backup path" ;; esac
OFFICIAL_DEB="$BACKUP_DIR/approved-deb/nginx_1.30.4-1~jammy_amd64.deb"
[ -f "$OFFICIAL_DEB" ] && [ ! -L "$OFFICIAL_DEB" ] \
  || fail "cached official Nginx package is unavailable during finalization"
SAFE_CONFIG_ARCHIVE="$BACKUP_DIR/safe-managed-nginx.tar.gz"
[[ "$SAFE_CONFIG_SHA256" =~ ^[a-f0-9]{64}$ ]] \
  && [ -f "$SAFE_CONFIG_ARCHIVE" ] && [ ! -L "$SAFE_CONFIG_ARCHIVE" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$SAFE_CONFIG_ARCHIVE")" = root:root:600:1 ] \
  && [ "$(sha256sum "$SAFE_CONFIG_ARCHIVE" | awk '{print $1}')" = "$SAFE_CONFIG_SHA256" ] \
  || fail "safe Nginx configuration archive differs from the durable journal"
APPROVED_APT="$BACKUP_DIR/approved-apt"
[[ "$APT_CONTRACT_SHA256" =~ ^[a-f0-9]{64}$ ]] \
  && [ -d "$APPROVED_APT" ] && [ ! -L "$APPROVED_APT" ] \
  && [ -f "$APPROVED_APT/SHA256SUMS" ] && [ ! -L "$APPROVED_APT/SHA256SUMS" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$APPROVED_APT/SHA256SUMS")" = root:root:600:1 ] \
  && [ "$(sha256sum "$APPROVED_APT/SHA256SUMS" | awk '{print $1}')" = \
    "$APT_CONTRACT_SHA256" ] \
  && (cd "$APPROVED_APT" && sha256sum --strict -c SHA256SUMS >/dev/null) \
  && cmp -s "$APPROVED_APT/nginx-archive-keyring.gpg" \
    /usr/share/keyrings/nginx-archive-keyring.gpg \
  && cmp -s "$APPROVED_APT/nginx.list" /etc/apt/sources.list.d/nginx.list \
  && cmp -s "$APPROVED_APT/99nginx" /etc/apt/preferences.d/99nginx \
  || fail "installed Nginx APT contract differs from the durable recovery generation"
ACTIVE_ROOT="$(readlink -e /opt/resume-ai/current)" \
  || fail "active release cannot be resolved during Nginx finalization"
case "$ACTIVE_ROOT" in /opt/resume-ai/releases/20??????T??????Z) ;; \
  *) fail "active release path is outside the managed tree" ;; esac
ACTIVE_OPS="$ACTIVE_ROOT/ops"
[ -x "$SCRIPT_DIR/assert-nginx-package-runtime.sh" ] \
  && cmp -s "$ACTIVE_OPS/bin/assert-nginx-package-runtime.sh" \
    "$SCRIPT_DIR/assert-nginx-package-runtime.sh" \
  || fail "installed Nginx runtime verifier differs from the active release"

nginx -t >/dev/null
main_pid="$(systemctl show nginx.service --property=MainPID --value)"
[[ "$main_pid" =~ ^[1-9][0-9]*$ ]] && kill -0 "$main_pid" 2>/dev/null \
  || fail "Nginx master process is not live during start finalization"
"$SCRIPT_DIR/assert-nginx-package-runtime.sh" "$ACTIVE_OPS" "$OFFICIAL_DEB" managed \
  >/dev/null || fail "started Nginx does not match the exact safe recovery contract"
status="$(curl --proto '=https' --tlsv1.2 -sS -o /dev/null -w '%{http_code}' \
  --resolve siyuanjiaxin.com:443:127.0.0.1 --connect-timeout 5 --max-time 10 \
  https://siyuanjiaxin.com/)" \
  || fail "recovered Nginx local TLS endpoint is unavailable"
[ "$status" = 200 ] || fail "recovered Nginx local TLS endpoint returned HTTP $status"

result_temp="$(mktemp "$BACKUP_DIR/.RECOVERY_RESULT.XXXXXX")"
printf 'recovered-safe=%s\npackage=nginx_1.30.4-1~jammy_amd64.deb\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$result_temp"
chown root:root "$result_temp"
chmod 0600 "$result_temp"
sync -f "$result_temp"
mv -f -- "$result_temp" "$BACKUP_DIR/RECOVERY_RESULT"
sync -f "$BACKUP_DIR"
unlink "$PENDING_FILE"
sync -f /opt/resume-ai/state
printf '%s\n' "Nginx recovery reached the exact safe running state; durable journal cleared."
