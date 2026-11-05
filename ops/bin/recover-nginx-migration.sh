#!/usr/bin/env bash
set -Eeuo pipefail
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

fail() {
  printf '%s\n' "ERROR: $*" >&2
  exit 1
}

[ "${EUID:-$(id -u)}" -eq 0 ] || fail "run as root"
[ "$#" -eq 0 ] || fail "Nginx migration recovery accepts no arguments"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
. "$SCRIPT_DIR/open-root-lock.sh"
PENDING_FILE=/opt/resume-ai/state/nginx-migration.pending
[ -e "$PENDING_FILE" ] || exit 0
[ -f "$PENDING_FILE" ] && [ ! -L "$PENDING_FILE" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$PENDING_FILE")" = root:root:600:1 ] \
  || fail "Nginx migration journal is unsafe"
open_root_lock 8 deploy
open_root_lock 9 nginx-migration
open_root_lock 7 apt-dpkg

set +e
/usr/local/lib/resume-ai/nginx-migration-recovery-gate.sh
gate_status=$?
set -e
case "$gate_status" in
  0) ;;
  1) fail "a live Nginx migration still owns the recovery journal" ;;
  *) fail "Nginx migration recovery gate rejected the journal" ;;
esac

BACKUP_DIR=""
SAFE_CONFIG_SHA256=""
APT_CONTRACT_SHA256=""
PHASE=""
declare -A seen=()
while IFS='=' read -r key value || [ -n "$key" ]; do
  case "$key" in BACKUP_DIR|SAFE_CONFIG_SHA256|APT_CONTRACT_SHA256|PHASE) ;; *) fail "unknown Nginx migration journal key" ;; esac
  [ -z "${seen[$key]:-}" ] || fail "duplicate Nginx migration journal key"
  seen[$key]=1
  printf -v "$key" '%s' "$value"
done < "$PENDING_FILE"
case "$BACKUP_DIR" in /var/backups/resume-ai/nginx-migration/20??????T??????Z) ;; *) fail "unsafe Nginx migration backup path" ;; esac
[[ "$SAFE_CONFIG_SHA256" =~ ^[a-f0-9]{64}$ ]] \
  || fail "safe Nginx configuration identity is malformed"
case "$PHASE" in prepared|mutation_started|package_installed|config_installed|service_restarted|recovered_waiting_for_service) ;; *) fail "invalid Nginx migration journal phase" ;; esac
[ -d "$BACKUP_DIR" ] && [ ! -L "$BACKUP_DIR" ] || fail "Nginx migration backup is unavailable"
OFFICIAL_DEB="$BACKUP_DIR/approved-deb/nginx_1.30.4-1~jammy_amd64.deb"
SAFE_CONFIG_ARCHIVE="$BACKUP_DIR/safe-managed-nginx.tar.gz"
EXPECTED_OFFICIAL_SHA256=6e4460183d918f245de67290a56a9ea0d84c39b7135fc87a202d72b3a6942fb2
[ -f "$OFFICIAL_DEB" ] && [ ! -L "$OFFICIAL_DEB" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$OFFICIAL_DEB")" = root:root:600:1 ] \
  && [ "$(sha256sum "$OFFICIAL_DEB" | awk '{print $1}')" = "$EXPECTED_OFFICIAL_SHA256" ] \
  && [ "$(dpkg-deb -f "$OFFICIAL_DEB" Package)" = nginx ] \
  && [ "$(dpkg-deb -f "$OFFICIAL_DEB" Version)" = 1.30.4-1~jammy ] \
  && [ "$(dpkg-deb -f "$OFFICIAL_DEB" Architecture)" = amd64 ] \
  || fail "cached official Nginx recovery package differs from the approved payload"
[ -f "$SAFE_CONFIG_ARCHIVE" ] && [ ! -L "$SAFE_CONFIG_ARCHIVE" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$SAFE_CONFIG_ARCHIVE")" = root:root:600:1 ] \
  && [ "$(sha256sum "$SAFE_CONFIG_ARCHIVE" | awk '{print $1}')" = "$SAFE_CONFIG_SHA256" ] \
  || fail "cached safe Nginx configuration differs from the journal"
[ -x "$SCRIPT_DIR/assert-nginx-package-runtime.sh" ] \
  && [ ! -L "$SCRIPT_DIR/assert-nginx-package-runtime.sh" ] \
  && [ -x "$SCRIPT_DIR/assert-nginx-security-contract.py" ] \
  && [ ! -L "$SCRIPT_DIR/assert-nginx-security-contract.py" ] \
  || fail "installed Nginx recovery contract helpers are missing or linked"

if [ "$PHASE" = prepared ]; then
  [ "$APT_CONTRACT_SHA256" = none ] \
    || fail "pre-mutation Nginx journal has an unexpected APT contract"
  rm -f -- "$PENDING_FILE"
  sync -f /opt/resume-ai/state
  printf '%s\n' "Cleared a pre-mutation Nginx migration journal."
  exit 0
fi
[[ "$APT_CONTRACT_SHA256" =~ ^[a-f0-9]{64}$ ]] \
  || fail "approved Nginx APT contract identity is malformed"
APPROVED_APT="$BACKUP_DIR/approved-apt"
[ -d "$APPROVED_APT" ] && [ ! -L "$APPROVED_APT" ] \
  && [ "$(stat -c '%U:%G:%a' "$APPROVED_APT")" = root:root:700 ] \
  && [ -f "$APPROVED_APT/SHA256SUMS" ] && [ ! -L "$APPROVED_APT/SHA256SUMS" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$APPROVED_APT/SHA256SUMS")" = root:root:600:1 ] \
  && [ "$(sha256sum "$APPROVED_APT/SHA256SUMS" | awk '{print $1}')" = \
    "$APT_CONTRACT_SHA256" ] \
  && (cd "$APPROVED_APT" && sha256sum --strict -c SHA256SUMS >/dev/null) \
  || fail "approved Nginx APT recovery contract differs from the journal"

for backup_member in etc-nginx-before.tar.gz safe-managed-nginx.tar.gz approved-deb/SHA256SUMS; do
  [ -f "$BACKUP_DIR/$backup_member" ] && [ ! -L "$BACKUP_DIR/$backup_member" ] \
    || fail "Nginx recovery evidence is missing: $backup_member"
done
[ "$(cat "$BACKUP_DIR/approved-deb/SHA256SUMS")" = \
  "$EXPECTED_OFFICIAL_SHA256  $(basename "$OFFICIAL_DEB")" ] \
  || fail "official Nginx recovery checksum manifest differs from policy"

python3 - "$BACKUP_DIR/etc-nginx-before.tar.gz" <<'PY'
import pathlib
import posixpath
import sys
import tarfile

with tarfile.open(sys.argv[1], "r:gz") as archive:
    members = archive.getmembers()
    if not members:
        raise SystemExit("Nginx configuration backup is empty")
    names = set()
    symlinks = set()
    for member in members:
        path = pathlib.PurePosixPath(member.name)
        if path.is_absolute() or ".." in path.parts or path.parts[:2] != ("etc", "nginx"):
            raise SystemExit(f"unsafe Nginx backup member: {member.name}")
        canonical = path.as_posix()
        if canonical in names:
            raise SystemExit(f"duplicate Nginx backup member: {member.name}")
        names.add(canonical)
        if not (member.isfile() or member.isdir() or member.issym()):
            raise SystemExit(f"unsupported Nginx backup member: {member.name}")
        if member.issym():
            target = pathlib.PurePosixPath(member.linkname)
            resolved = pathlib.PurePosixPath(posixpath.normpath(str(path.parent / target)))
            if target.is_absolute() or resolved.parts[:2] != ("etc", "nginx"):
                raise SystemExit(f"escaping Nginx backup symlink: {member.name}")
            symlinks.add(canonical)
    for canonical in names:
        parts = pathlib.PurePosixPath(canonical).parts
        for index in range(1, len(parts)):
            if pathlib.PurePosixPath(*parts[:index]).as_posix() in symlinks:
                raise SystemExit(f"Nginx backup member traverses a symlink: {canonical}")
PY

python3 - "$SAFE_CONFIG_ARCHIVE" <<'PY'
import pathlib
import stat
import sys
import tarfile

expected = {
    "etc/nginx", "etc/nginx/conf.d", "etc/nginx/snippets",
    "etc/nginx/nginx.conf", "etc/nginx/mime.types",
    "etc/nginx/conf.d/00-resume-ai-global.conf",
    "etc/nginx/conf.d/10-resume-ai-upstream.conf",
    "etc/nginx/conf.d/20-resume-ai.conf",
    "etc/nginx/snippets/resume-ai-transport-security.conf",
    "etc/nginx/snippets/resume-ai-proxy-common.conf",
    "etc/nginx/snippets/resume-ai-recommend-quota.inc",
    "etc/nginx/snippets/resume-ai-track-quota.inc",
}
with tarfile.open(sys.argv[1], "r:gz") as archive:
    members = archive.getmembers()
    names = set()
    for member in members:
        path = pathlib.PurePosixPath(member.name)
        canonical = path.as_posix().rstrip("/")
        if path.is_absolute() or ".." in path.parts or canonical in names:
            raise SystemExit("unsafe or duplicate managed Nginx archive member")
        names.add(canonical)
        if member.uid != 0 or member.gid != 0 or not (member.isdir() or member.isfile()):
            raise SystemExit("managed Nginx archive has a linked, special, or non-root member")
        expected_mode = 0o755 if member.isdir() else 0o644
        if stat.S_IMODE(member.mode) != expected_mode:
            raise SystemExit("managed Nginx archive member mode differs from policy")
    if names != expected:
        raise SystemExit("managed Nginx archive inventory differs from policy")
PY

nginx_was_active=0
if systemctl is-active --quiet nginx; then
  systemctl stop nginx
  if systemctl is-active --quiet nginx; then
    fail "Nginx remained active while interrupted package/config state was restored"
  fi
  nginx_was_active=1
fi

for source_target in \
  nginx-archive-keyring.gpg:/usr/share/keyrings/nginx-archive-keyring.gpg \
  nginx.list:/etc/apt/sources.list.d/nginx.list \
  99nginx:/etc/apt/preferences.d/99nginx; do
  source="$APPROVED_APT/${source_target%%:*}"
  target=${source_target#*:}
  [ -f "$source" ] && [ ! -L "$source" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$source")" = root:root:644:1 ] \
    && [ "$(readlink -e -- "${target%/*}")" = "${target%/*}" ] \
    || fail "approved Nginx APT recovery member is unsafe"
  temporary="$(mktemp "${target%/*}/.${target##*/}.nginx-approved.XXXXXX")"
  install -o root -g root -m 0644 "$source" "$temporary"
  sync -f "$temporary"
  mv -f -- "$temporary" "$target"
  sync -f "${target%/*}"
done

restore_root="$(mktemp -d /etc/.resume-ai-nginx-restore.XXXXXX)"
tar -C "$restore_root" -xzf "$BACKUP_DIR/etc-nginx-before.tar.gz"
nginx -V > "$BACKUP_DIR/nginx-version-recovery.txt" 2>&1
python3 -I "$SCRIPT_DIR/assert-nginx-security-contract.py" \
  --config-tree "$restore_root/etc/nginx" \
  --version-output "$BACKUP_DIR/nginx-version-recovery.txt" --mode trigger-only \
  >/dev/null || fail "saved Nginx configuration contains a reviewed CVE trigger"
find "$restore_root" -depth -delete

# Keep the old Jammy configuration in place until the exact official 1.30.4
# payload is installed; it remains parseable by the old binary if package
# recovery itself fails.  Only then atomically replace the include tree with
# the journal-bound modern HTTP/2 configuration.
DEBIAN_FRONTEND=noninteractive apt-get install -y \
  -o Dpkg::Options::=--force-confold "$OFFICIAL_DEB" >/dev/null
systemctl daemon-reload
systemctl stop nginx >/dev/null 2>&1 || true
systemctl is-active --quiet nginx \
  && fail "Nginx remained active before the safe recovery config switch"
failed_config="/etc/nginx.failed-recovery-$(date -u +%Y%m%dT%H%M%SZ)-$$"
[ ! -e "$failed_config" ] || fail "failed-config evidence path already exists"
if [ -e /etc/nginx ]; then
  [ -d /etc/nginx ] && [ ! -L /etc/nginx ] \
    || fail "existing Nginx configuration path is unsafe during recovery"
  mv -- /etc/nginx "$failed_config"
fi
[ "$(sha256sum "$SAFE_CONFIG_ARCHIVE" | awk '{print $1}')" = "$SAFE_CONFIG_SHA256" ] \
  || fail "safe Nginx configuration changed before recovery extraction"
tar -C / -xzf "$SAFE_CONFIG_ARCHIVE"
sync -f /etc
ACTIVE_OPS="$(readlink -e /opt/resume-ai/current)/ops" \
  || fail "active release operations directory cannot be resolved during Nginx recovery"
"$SCRIPT_DIR/assert-nginx-package-runtime.sh" "$ACTIVE_OPS" "$OFFICIAL_DEB" managed \
  >/dev/null || fail "recovered Nginx package/config/module contract is not exact"

pending_temp="$(mktemp /opt/resume-ai/state/.nginx-migration-recovered.XXXXXX)"
cat > "$pending_temp" <<EOF
BACKUP_DIR=$BACKUP_DIR
SAFE_CONFIG_SHA256=$SAFE_CONFIG_SHA256
APT_CONTRACT_SHA256=$APT_CONTRACT_SHA256
PHASE=recovered_waiting_for_service
EOF
chown root:root "$pending_temp"
chmod 0600 "$pending_temp"
sync -f "$pending_temp"
mv -f -- "$pending_temp" "$PENDING_FILE"
sync -f /opt/resume-ai/state
if [ "$nginx_was_active" -eq 1 ]; then
  # This recovery unit is ordered Before=nginx.service. A synchronous restart
  # here would wait on this still-running oneshot and deadlock. Queue the start
  # after this oneshot exits.  ExecStartPost owns final runtime validation and
  # clears the durable journal only after the master is serving local TLS.
  systemctl start --no-block nginx
fi
printf '%s\n' "Restored the interrupted Nginx migration with cached official 1.30.4; the start-time finalizer retains authority to clear the journal."
