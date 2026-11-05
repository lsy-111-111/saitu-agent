#!/usr/bin/env bash
set -Eeuo pipefail
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

fail() {
  printf '%s\n' "ERROR: $*" >&2
  exit 1
}

[ "${EUID:-$(id -u)}" -eq 0 ] || fail "run as root"
[ "${ACK_MIGRATE_NGINX_1_30_4:-}" = "YES" ] \
  || fail "set ACK_MIGRATE_NGINX_1_30_4=YES only after the cloud snapshot"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
OPS_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
. "$SCRIPT_DIR/open-root-lock.sh"
APPROVAL_FILE="$OPS_DIR/config/approved-nginx-versions.conf"
[ -f "$APPROVAL_FILE" ] && [ ! -L "$APPROVAL_FILE" ] && [ "$(stat -c '%h' "$APPROVAL_FILE")" = 1 ] \
  || fail "approved Nginx version policy is missing or unsafe"

declare -A policy=()
while IFS= read -r policy_line || [ -n "$policy_line" ]; do
  case "$policy_line" in ''|'#'*) continue ;; esac
  key=${policy_line%%=*}
  value=${policy_line#*=}
  [[ "$key" =~ ^[A-Z][A-Z0-9_]*$ ]] || fail "invalid Nginx policy key"
  case "$key" in APPROVED_NGINX_VERSION|APPROVED_NGINX_PACKAGE_VERSION|APPROVED_NGINX_PACKAGE_ARCHITECTURE|APPROVED_NGINX_PACKAGE_URL|APPROVED_NGINX_PACKAGE_SHA256|AUTOMATIC_RECOVERY_PACKAGE_VERSION|AUTOMATIC_RECOVERY_PACKAGE_SHA256|NGINX_SECURITY_REVIEW_BY|NGINX_SIGNING_PRIMARY_FINGERPRINTS|NGINX_SIGNING_BUNDLE_SHA256) ;; *) fail "unknown Nginx policy key: $key" ;; esac
  [ -z "${policy[$key]:-}" ] || fail "duplicate Nginx policy key: $key"
  policy[$key]=$value
done < "$APPROVAL_FILE"

APPROVED_VERSION=${policy[APPROVED_NGINX_VERSION]:-}
PACKAGE_VERSION=${policy[APPROVED_NGINX_PACKAGE_VERSION]:-}
PACKAGE_ARCHITECTURE=${policy[APPROVED_NGINX_PACKAGE_ARCHITECTURE]:-}
PACKAGE_URL=${policy[APPROVED_NGINX_PACKAGE_URL]:-}
PACKAGE_SHA256=${policy[APPROVED_NGINX_PACKAGE_SHA256]:-}
RECOVERY_PACKAGE_VERSION=${policy[AUTOMATIC_RECOVERY_PACKAGE_VERSION]:-}
RECOVERY_PACKAGE_SHA256=${policy[AUTOMATIC_RECOVERY_PACKAGE_SHA256]:-}
REVIEW_BY=${policy[NGINX_SECURITY_REVIEW_BY]:-}
EXPECTED_FINGERPRINTS=${policy[NGINX_SIGNING_PRIMARY_FINGERPRINTS]:-}
EXPECTED_KEY_SHA256=${policy[NGINX_SIGNING_BUNDLE_SHA256]:-}
[ "$APPROVED_VERSION" = "1.30.4" ] || fail "this migration accepts Nginx 1.30.4 only"
[ "$PACKAGE_VERSION" = "1.30.4-1~jammy" ] || fail "unexpected approved package version"
[ "$PACKAGE_ARCHITECTURE" = amd64 ] || fail "unexpected approved package architecture"
[ "$PACKAGE_URL" = "https://nginx.org/packages/ubuntu/pool/nginx/n/nginx/nginx_1.30.4-1~jammy_amd64.deb" ] \
  || fail "unexpected approved package URL"
[[ "$PACKAGE_SHA256" =~ ^[a-f0-9]{64}$ ]] || fail "invalid approved package checksum"
[ "$RECOVERY_PACKAGE_VERSION" = "$PACKAGE_VERSION" ] \
  && [ "$RECOVERY_PACKAGE_SHA256" = "$PACKAGE_SHA256" ] \
  || fail "automatic recovery must reinstall the exact approved official payload"
[[ "$EXPECTED_KEY_SHA256" =~ ^[a-f0-9]{64}$ ]] || fail "invalid signing key bundle checksum"
IFS=',' read -r -a expected_primary_fingerprints <<< "$EXPECTED_FINGERPRINTS"
[ "${#expected_primary_fingerprints[@]}" -ge 1 ] || fail "signing fingerprint set is empty"
for expected_fingerprint in "${expected_primary_fingerprints[@]}"; do
  [[ "$expected_fingerprint" =~ ^[A-F0-9]{40}$ ]] || fail "invalid signing fingerprint"
done
[[ "$REVIEW_BY" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || fail "invalid security review date"
[ "$(date -u +%F)" \< "$REVIEW_BY" ] || fail "Nginx security approval expired on $REVIEW_BY"

for command_name in apt-cache apt-get cmp curl dpkg-deb dpkg-query flock getent gpg nginx sha256sum systemctl tar; do
  command -v "$command_name" >/dev/null 2>&1 || fail "$command_name is unavailable"
done
. /etc/os-release
[ "${ID:-}" = "ubuntu" ] && [ "${VERSION_CODENAME:-}" = "jammy" ] \
  || fail "expected Ubuntu jammy"
nginx -t || fail "current Nginx configuration is already invalid"
current_effective_config="$(nginx -T 2>&1)"
ACTIVE_PORT=""
if [ -f /opt/resume-ai/state/active.env ] && [ ! -L /opt/resume-ai/state/active.env ]; then
  [ "$(stat -c '%U:%G:%a:%h' /opt/resume-ai/state/active.env)" = root:resume-ai:640:1 ] \
    || fail "release state ownership or permissions are unsafe"
  ACTIVE_RELEASE=""
  declare -A seen_release_state=()
  while IFS='=' read -r state_key state_value || [ -n "$state_key" ]; do
    case "$state_key" in ACTIVE_PORT|ACTIVE_RELEASE|PREVIOUS_PORT|PREVIOUS_RELEASE|SWITCHED_AT) ;; '') continue ;; *) fail "unknown release state key" ;; esac
    [ -z "${seen_release_state[$state_key]:-}" ] || fail "duplicate release state key: $state_key"
    seen_release_state[$state_key]=1
    case "$state_key" in ACTIVE_PORT) ACTIVE_PORT=$state_value ;; ACTIVE_RELEASE) ACTIVE_RELEASE=$state_value ;; esac
  done < /opt/resume-ai/state/active.env
  case "$ACTIVE_PORT:$ACTIVE_RELEASE" in 3000:20??????T??????Z|3001:20??????T??????Z) ;; *) fail "invalid managed active release state" ;; esac
  [ -L /opt/resume-ai/current ] \
    && [ "$(readlink -f /opt/resume-ai/current)" = "/opt/resume-ai/releases/$ACTIVE_RELEASE" ] \
    || fail "current release pointer disagrees with the active state"
fi
mapfile -t configured_ports < <(printf '%s\n' "$current_effective_config" \
  | awk '/server 127\.0\.0\.1:300[01]([[:space:]]|;)/ { value=$0; sub(/^.*127\.0\.0\.1:/, "", value); sub(/[^0-9].*$/, "", value); print value }' \
  | sort -u)
[ "${#configured_ports[@]}" -eq 1 ] || fail "cannot derive one active application port from current Nginx state"
if [ -z "$ACTIVE_PORT" ]; then
  ACTIVE_PORT=${configured_ports[0]}
else
  [ "${configured_ports[0]}" = "$ACTIVE_PORT" ] || fail "release state and current Nginx active port disagree"
fi
case "$ACTIVE_PORT" in 3000|3001) ;; *) fail "active application port is invalid" ;; esac
active_status="$(curl -sS --output /dev/null --write-out '%{http_code}' \
  --connect-timeout 2 --max-time 5 "http://127.0.0.1:$ACTIVE_PORT/")" \
  || fail "current active application is unhealthy"
[ "$active_status" = 200 ] || fail "current active application did not return HTTP 200"

# Serialize every host mutation under the deployment lock before taking the
# operation-specific lock.  This is the same order used by Node migration and
# recovery, so no two durable journals can mutate Nginx concurrently.
open_root_lock 8 deploy
open_root_lock 9 nginx-migration
# Every project operation that can enter apt/dpkg shares this third lock in
# the global deploy -> operation -> apt-dpkg order.  The native apt locks still
# provide the final exclusion against non-project package managers.
open_root_lock 7 apt-dpkg
PENDING_FILE=/opt/resume-ai/state/nginx-migration.pending
RECOVERY_SCRIPT=/usr/local/lib/resume-ai/recover-nginx-migration.sh
[ -f "$RECOVERY_SCRIPT" ] && [ ! -L "$RECOVERY_SCRIPT" ] && [ -x "$RECOVERY_SCRIPT" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$RECOVERY_SCRIPT")" = root:root:755:1 ] \
  && cmp -s "$SCRIPT_DIR/recover-nginx-migration.sh" "$RECOVERY_SCRIPT" \
  || fail "boot-time Nginx migration recovery is not the exact trusted companion script"
[ -x /usr/local/lib/resume-ai/nginx-migration-recovery-gate.sh ] \
  && [ "$(stat -c '%U:%G:%a:%h' /usr/local/lib/resume-ai/nginx-migration-recovery-gate.sh)" = root:root:755:1 ] \
  && cmp -s "$SCRIPT_DIR/nginx-migration-recovery-gate.sh" \
    /usr/local/lib/resume-ai/nginx-migration-recovery-gate.sh \
  || fail "boot-time Nginx migration recovery gate is not installed or trusted"
[ -x /usr/local/lib/resume-ai/read-proc-start-ticks.py ] \
  && [ "$(stat -c '%U:%G:%a:%h' /usr/local/lib/resume-ai/read-proc-start-ticks.py)" = root:root:755:1 ] \
  && cmp -s "$SCRIPT_DIR/read-proc-start-ticks.py" \
    /usr/local/lib/resume-ai/read-proc-start-ticks.py \
  || fail "boot-time process identity parser is not the exact trusted helper"
[ -x /usr/local/lib/resume-ai/assert-nginx-package-runtime.sh ] \
  && cmp -s "$SCRIPT_DIR/assert-nginx-package-runtime.sh" \
    /usr/local/lib/resume-ai/assert-nginx-package-runtime.sh \
  && [ -x /usr/local/lib/resume-ai/assert-nginx-security-contract.py ] \
  && cmp -s "$SCRIPT_DIR/assert-nginx-security-contract.py" \
    /usr/local/lib/resume-ai/assert-nginx-security-contract.py \
  || fail "installed Nginx security contract helpers differ from this reviewed release"
[ -x /usr/local/lib/resume-ai/finalize-nginx-migration-recovery.sh ] \
  && cmp -s "$SCRIPT_DIR/finalize-nginx-migration-recovery.sh" \
    /usr/local/lib/resume-ai/finalize-nginx-migration-recovery.sh \
  && cmp -s "$OPS_DIR/systemd/nginx-resume-ai-recovery.conf" \
    /etc/systemd/system/nginx.service.d/resume-ai-recovery.conf \
  || fail "installed Nginx recovery finalizer differs from this reviewed release"
[ ! -e "$PENDING_FILE" ] && [ ! -L "$PENDING_FILE" ] \
  || fail "an earlier Nginx migration journal requires recovery"
LIVE_MARKER=/run/resume-ai-locks/nginx-migration.live
set +e
/usr/local/lib/resume-ai/nginx-migration-recovery-gate.sh
gate_status=$?
set -e
[ "$gate_status" -eq 1 ] \
  && [ ! -e "$LIVE_MARKER" ] && [ ! -L "$LIVE_MARKER" ] \
  || fail "Nginx migration runtime ownership is ambiguous"
BACKUP_ROOT=/var/backups/resume-ai/nginx-migration
BACKUP_DIR="$BACKUP_ROOT/$(date -u +%Y%m%dT%H%M%SZ)"
install -d -o root -g root -m 0700 "$BACKUP_DIR" \
  "$BACKUP_DIR/approved-deb" "$BACKUP_DIR/approved-apt" "$BACKUP_DIR/apt-files"
tar -C / -czf "$BACKUP_DIR/etc-nginx-before.tar.gz" etc/nginx
dpkg-query -W -f='${binary:Package}\t${Version}\n' > "$BACKUP_DIR/packages-before.tsv"
systemctl cat nginx --no-pager > "$BACKUP_DIR/nginx-unit-before.txt"
printf '%s\n' "$current_effective_config" > "$BACKUP_DIR/nginx-effective-before.txt"
nginx -V > "$BACKUP_DIR/nginx-version-before.txt" 2>&1
python3 -I "$SCRIPT_DIR/assert-nginx-security-contract.py" \
  --effective-config "$BACKUP_DIR/nginx-effective-before.txt" \
  --version-output "$BACKUP_DIR/nginx-version-before.txt" --mode trigger-only \
  >/dev/null || fail "pre-migration Nginx configuration has a reviewed CVE trigger"

KEYRING=/usr/share/keyrings/nginx-archive-keyring.gpg
SOURCE_LIST=/etc/apt/sources.list.d/nginx.list
PREFERENCES=/etc/apt/preferences.d/99nginx
for apt_file in "$KEYRING" "$SOURCE_LIST" "$PREFERENCES"; do
  apt_name=${apt_file#/}
  apt_name=${apt_name//\//__}
  if [ -e "$apt_file" ] || [ -L "$apt_file" ]; then
    [ -f "$apt_file" ] && [ ! -L "$apt_file" ] && [ "$(stat -c '%h' "$apt_file")" = 1 ] \
      || fail "existing Nginx APT control is unsafe: $apt_file"
    cp -a -- "$apt_file" "$BACKUP_DIR/apt-files/$apt_name"
    printf '%s\n' present > "$BACKUP_DIR/apt-files/$apt_name.state"
  else
    printf '%s\n' absent > "$BACKUP_DIR/apt-files/$apt_name.state"
  fi
done

write_migration_journal() {
  local phase=$1 journal_temp
  journal_temp="$(mktemp /opt/resume-ai/state/.nginx-migration.XXXXXX)"
  cat > "$journal_temp" <<EOF
BACKUP_DIR=$BACKUP_DIR
SAFE_CONFIG_SHA256=$SAFE_CONFIG_SHA256
APT_CONTRACT_SHA256=$APT_CONTRACT_SHA256
PHASE=$phase
EOF
  chown root:root "$journal_temp"
  chmod 0600 "$journal_temp"
  mv -f -- "$journal_temp" "$PENDING_FILE"
  sync -f "$PENDING_FILE"
  sync -f /opt/resume-ai/state
}

OFFICIAL_DEB="$BACKUP_DIR/approved-deb/nginx_1.30.4-1~jammy_amd64.deb"
curl -4 --proto '=https' --tlsv1.2 --fail --silent --show-error --location \
  --retry 3 --connect-timeout 10 --max-time 120 --output "$OFFICIAL_DEB" "$PACKAGE_URL"
[ -f "$OFFICIAL_DEB" ] && [ ! -L "$OFFICIAL_DEB" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$OFFICIAL_DEB")" = root:root:600:1 ] \
  || fail "approved Nginx package payload is unsafe"
[ "$(sha256sum "$OFFICIAL_DEB" | awk '{print $1}')" = "$PACKAGE_SHA256" ] \
  || fail "approved Nginx package checksum mismatch"
[ "$(dpkg-deb -f "$OFFICIAL_DEB" Package)" = nginx ] \
  && [ "$(dpkg-deb -f "$OFFICIAL_DEB" Version)" = "$PACKAGE_VERSION" ] \
  && [ "$(dpkg-deb -f "$OFFICIAL_DEB" Architecture)" = "$PACKAGE_ARCHITECTURE" ] \
  || fail "approved Nginx package metadata differs from policy"
printf '%s  %s\n' "$PACKAGE_SHA256" "$(basename "$OFFICIAL_DEB")" \
  > "$BACKUP_DIR/approved-deb/SHA256SUMS"

# Freeze the exact managed configuration before the first mutation.  Recovery
# never has to choose between the reviewed 1.30.4 binary and an arbitrary old
# include tree, while the original Jammy configuration remains retained as
# read-only forensic/last-resort evidence.
"$OPS_DIR/bin/verify-quota-generation.py" \
  "$OPS_DIR/generated/quota-generation.env" \
  "$OPS_DIR/generated/application-quota.env" \
  "$OPS_DIR/generated/00-resume-ai-global.conf" \
  "$OPS_DIR/generated/nginx-quota.inc" \
  "$OPS_DIR/generated/nginx-track-quota.inc" >/dev/null \
  || fail "reviewed Nginx quota generation is incomplete"
SAFE_CONFIG_ARCHIVE="$BACKUP_DIR/safe-managed-nginx.tar.gz"
safe_build_root="$BACKUP_DIR/.safe-config-build"
package_extract_root="$BACKUP_DIR/.approved-package-extract"
install -d -o root -g root -m 0700 \
  "$safe_build_root/etc/nginx/conf.d" "$safe_build_root/etc/nginx/snippets" \
  "$package_extract_root"
dpkg-deb -x "$OFFICIAL_DEB" "$package_extract_root"
[ -f "$package_extract_root/etc/nginx/mime.types" ] \
  && [ ! -L "$package_extract_root/etc/nginx/mime.types" ] \
  || fail "official Nginx package lacks its MIME configuration"
install -o root -g root -m 0644 "$OPS_DIR/nginx/nginx.conf" \
  "$safe_build_root/etc/nginx/nginx.conf"
install -o root -g root -m 0644 "$package_extract_root/etc/nginx/mime.types" \
  "$safe_build_root/etc/nginx/mime.types"
install -o root -g root -m 0644 "$OPS_DIR/generated/00-resume-ai-global.conf" \
  "$safe_build_root/etc/nginx/conf.d/00-resume-ai-global.conf"
cat > "$safe_build_root/etc/nginx/conf.d/10-resume-ai-upstream.conf" <<EOF
# Preserved transactionally from the verified pre-migration active state.
upstream resume_ai_active {
    server 127.0.0.1:$ACTIVE_PORT max_fails=2 fail_timeout=10s;
    keepalive 32;
}
EOF
install -o root -g root -m 0644 "$OPS_DIR/nginx/20-resume-ai.conf" \
  "$safe_build_root/etc/nginx/conf.d/20-resume-ai.conf"
install -o root -g root -m 0644 "$OPS_DIR/nginx/resume-ai-transport-security.conf" \
  "$safe_build_root/etc/nginx/snippets/resume-ai-transport-security.conf"
install -o root -g root -m 0644 "$OPS_DIR/nginx/resume-ai-proxy-common.conf" \
  "$safe_build_root/etc/nginx/snippets/resume-ai-proxy-common.conf"
install -o root -g root -m 0644 "$OPS_DIR/generated/nginx-quota.inc" \
  "$safe_build_root/etc/nginx/snippets/resume-ai-recommend-quota.inc"
install -o root -g root -m 0644 "$OPS_DIR/generated/nginx-track-quota.inc" \
  "$safe_build_root/etc/nginx/snippets/resume-ai-track-quota.inc"
chmod 0755 "$safe_build_root/etc/nginx" \
  "$safe_build_root/etc/nginx/conf.d" "$safe_build_root/etc/nginx/snippets"
python3 -I "$SCRIPT_DIR/assert-nginx-security-contract.py" \
  --config-tree "$safe_build_root/etc/nginx" \
  --version-output "$BACKUP_DIR/nginx-version-before.txt" --mode staged-managed \
  >/dev/null || fail "staged managed Nginx configuration is not exact and trigger-free"
tar -C "$safe_build_root" -czf "$SAFE_CONFIG_ARCHIVE" etc/nginx
chown root:root "$SAFE_CONFIG_ARCHIVE"
chmod 0600 "$SAFE_CONFIG_ARCHIVE"
SAFE_CONFIG_SHA256="$(sha256sum "$SAFE_CONFIG_ARCHIVE" | awk '{print $1}')"
[[ "$SAFE_CONFIG_SHA256" =~ ^[a-f0-9]{64}$ ]] \
  || fail "safe Nginx configuration archive hash is malformed"
find "$safe_build_root" "$package_extract_root" -xdev -depth -delete
APT_CONTRACT_SHA256=none
sync -f "$BACKUP_DIR/etc-nginx-before.tar.gz"
while IFS= read -r -d '' backup_file; do sync -f "$backup_file"; done \
  < <(find "$BACKUP_DIR" -xdev -type f -print0)
while IFS= read -r backup_directory; do sync -f "$backup_directory"; done \
  < <(find "$BACKUP_DIR" -xdev -depth -type d -print)
write_migration_journal prepared

temp_dir="$(mktemp -d /tmp/resume-ai-nginx-migration.XXXXXX)"
live_marker_owned=0
live_start_time=
install_live_marker() {
  local marker_temp
  [ -d /run/resume-ai-locks ] && [ ! -L /run/resume-ai-locks ] \
    && [ "$(stat -c '%U:%G:%a' /run/resume-ai-locks)" = root:root:700 ] \
    || fail "Nginx migration runtime directory is unsafe"
  [ ! -e "$LIVE_MARKER" ] && [ ! -L "$LIVE_MARKER" ] \
    || fail "another Nginx migration live marker exists"
  live_start_time="$(/usr/local/lib/resume-ai/read-proc-start-ticks.py "$$")" \
    || fail "cannot read this Nginx migration process identity"
  [[ "$live_start_time" =~ ^[1-9][0-9]*$ ]] \
    || fail "cannot bind Nginx migration marker to this process"
  marker_temp="$(mktemp /run/resume-ai-locks/.nginx-migration-live.XXXXXX)"
  cat > "$marker_temp" <<EOF
SCHEMA_VERSION=1
PID=$$
START_TIME_TICKS=$live_start_time
EOF
  chown root:root "$marker_temp"
  chmod 0600 "$marker_temp"
  sync -f "$marker_temp"
  mv -T -- "$marker_temp" "$LIVE_MARKER"
  sync -f /run/resume-ai-locks
  live_marker_owned=1
}
remove_live_marker() {
  [ "$live_marker_owned" -eq 1 ] || return 0
  [ -f "$LIVE_MARKER" ] && [ ! -L "$LIVE_MARKER" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$LIVE_MARKER")" = root:root:600:1 ] \
    && grep -Fxq "PID=$$" "$LIVE_MARKER" \
    && grep -Fxq "START_TIME_TICKS=$live_start_time" "$LIVE_MARKER" \
    || return 1
  rm -f -- "$LIVE_MARKER"
  sync -f /run/resume-ai-locks
  live_marker_owned=0
}
cleanup_temp() {
  remove_live_marker >/dev/null 2>&1 || true
  [ ! -e "$temp_dir" ] || find "$temp_dir" -xdev -depth -delete >/dev/null 2>&1 || true
}
mutation_started=0
rollback_needed=1
publish_approved_apt_contract() {
  local approved_root="$BACKUP_DIR/approved-apt" source_target source target temporary
  [ -f "$approved_root/SHA256SUMS" ] && [ ! -L "$approved_root/SHA256SUMS" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$approved_root/SHA256SUMS")" = root:root:600:1 ] \
    && [ "$(sha256sum "$approved_root/SHA256SUMS" | awk '{print $1}')" = \
      "$APT_CONTRACT_SHA256" ] \
    && (cd "$approved_root" && sha256sum --strict -c SHA256SUMS >/dev/null) \
    || return 1
  for source_target in \
    nginx-archive-keyring.gpg:/usr/share/keyrings/nginx-archive-keyring.gpg \
    nginx.list:/etc/apt/sources.list.d/nginx.list \
    99nginx:/etc/apt/preferences.d/99nginx; do
    source="$approved_root/${source_target%%:*}"
    target=${source_target#*:}
    [ -f "$source" ] && [ ! -L "$source" ] \
      && [ "$(stat -c '%U:%G:%a:%h' "$source")" = root:root:644:1 ] \
      && [ "$(readlink -e -- "${target%/*}")" = "${target%/*}" ] \
      || return 1
    temporary="$(mktemp "${target%/*}/.${target##*/}.nginx-approved.XXXXXX")" \
      || return 1
    install -o root -g root -m 0644 "$source" "$temporary" \
      && sync -f "$temporary" \
      && mv -f -- "$temporary" "$target" \
      && sync -f "${target%/*}" \
      || return 1
  done
}
rollback() {
  local exit_status=$?
  trap - ERR EXIT
  set +e
  if [ "$rollback_needed" -eq 1 ] && [ "$mutation_started" -eq 1 ]; then
    printf '%s\n' "Nginx migration failed; restoring the cached official package and saved configuration." >&2
    # Never automatically downgrade to Ubuntu 1.18.0-6ubuntu14.20: Canonical
    # explicitly reverted the CVE-2026-42533 fix in that revision.  The exact
    # official 1.30.4 payload was cached and fsynced before mutation began.
    package_restored=0
    if [[ "$APT_CONTRACT_SHA256" =~ ^[a-f0-9]{64}$ ]] \
      && publish_approved_apt_contract \
      && [ -f "$OFFICIAL_DEB" ] && [ ! -L "$OFFICIAL_DEB" ] \
      && [ "$(sha256sum "$OFFICIAL_DEB" | awk '{print $1}')" = "$PACKAGE_SHA256" ] \
      && DEBIAN_FRONTEND=noninteractive apt-get install -y \
        -o Dpkg::Options::=--force-confold "$OFFICIAL_DEB" >/dev/null 2>&1; then
      package_restored=1
    fi
    failed_config="/etc/nginx.failed-$(date -u +%Y%m%dT%H%M%SZ)-$$"
    if [ "$package_restored" -eq 1 ] \
      && [ "$(sha256sum "$SAFE_CONFIG_ARCHIVE" | awk '{print $1}')" = "$SAFE_CONFIG_SHA256" ]; then
      if [ -e /etc/nginx ]; then
        [ -d /etc/nginx ] && [ ! -L /etc/nginx ] \
          && mv -- /etc/nginx "$failed_config" \
          || package_restored=0
      fi
    fi
    if [ "$package_restored" -eq 1 ]; then
      tar -C / -xzf "$SAFE_CONFIG_ARCHIVE"
    elif [ ! -e /etc/nginx ] && [ -d "$BACKUP_DIR/etc-nginx-after-package" ] \
      && [ ! -L "$BACKUP_DIR/etc-nginx-after-package" ]; then
      # If reinstalling the exact payload failed after the package-owned tree
      # was moved aside, restore that already-physical directory with rename.
      # Never extract the historical archive onto /: an internal symlink in a
      # legacy include tree must not become a write-through extraction path.
      mv -- "$BACKUP_DIR/etc-nginx-after-package" /etc/nginx
      sync -f /etc
    fi
    systemctl daemon-reload
    if [ "$package_restored" -eq 1 ] \
      && systemctl restart nginx >/dev/null 2>&1 \
      && systemctl is-active --quiet nginx \
      && /usr/local/lib/resume-ai/assert-nginx-package-runtime.sh \
        "$OPS_DIR" "$OFFICIAL_DEB" managed >/dev/null 2>&1; then
      rm -f -- "$PENDING_FILE"
      sync -f /opt/resume-ai/state
    else
      nginx -t >/dev/null 2>&1 && systemctl restart nginx >/dev/null 2>&1 || true
      printf '%s\n' \
        "Nginx automatic recovery did not reach the exact safe final state; retaining the durable journal." >&2
    fi
  elif [ "$mutation_started" -eq 0 ]; then
    rm -f -- "$PENDING_FILE"
    sync -f /opt/resume-ai/state
  fi
  cleanup_temp
  exit "$exit_status"
}
trap rollback ERR EXIT
curl --proto '=https' --tlsv1.2 --fail --silent --show-error --location \
  https://nginx.org/keys/nginx_signing.key --output "$temp_dir/nginx_signing.key"
[ "$(sha256sum "$temp_dir/nginx_signing.key" | awk '{print $1}')" = "$EXPECTED_KEY_SHA256" ] \
  || fail "official Nginx signing key bundle checksum changed"
mapfile -t primary_fingerprints < <(gpg --batch --show-keys --with-colons "$temp_dir/nginx_signing.key" \
  | awk -F: '$1 == "pub" { want = 1; next } want && $1 == "fpr" { print $10; want = 0 }' \
  | sort -u)
mapfile -t expected_primary_fingerprints < <(printf '%s\n' "${expected_primary_fingerprints[@]}" | sort -u)
[ "${#primary_fingerprints[@]}" -eq "${#expected_primary_fingerprints[@]}" ] \
  && [ "$(printf '%s\n' "${primary_fingerprints[@]}")" = "$(printf '%s\n' "${expected_primary_fingerprints[@]}")" ] \
  || fail "official key bundle primary-key members differ from the exact approved set"
gpg --batch --yes --dearmor --output "$temp_dir/nginx-archive-keyring.gpg" \
  "$temp_dir/nginx_signing.key"
install -o root -g root -m 0644 "$temp_dir/nginx-archive-keyring.gpg" \
  "$BACKUP_DIR/approved-apt/nginx-archive-keyring.gpg"
install -o root -g root -m 0644 "$OPS_DIR/apt/nginx.list" \
  "$BACKUP_DIR/approved-apt/nginx.list"
install -o root -g root -m 0644 "$OPS_DIR/apt/99nginx" \
  "$BACKUP_DIR/approved-apt/99nginx"
(
  cd "$BACKUP_DIR/approved-apt"
  sha256sum 99nginx nginx-archive-keyring.gpg nginx.list > SHA256SUMS
)
chmod 0600 "$BACKUP_DIR/approved-apt/SHA256SUMS"
APT_CONTRACT_SHA256="$(sha256sum "$BACKUP_DIR/approved-apt/SHA256SUMS" | awk '{print $1}')"
[[ "$APT_CONTRACT_SHA256" =~ ^[a-f0-9]{64}$ ]] \
  || fail "approved Nginx APT contract identity is malformed"
while IFS= read -r -d '' approved_apt_member; do
  sync -f "$approved_apt_member"
done < <(find "$BACKUP_DIR/approved-apt" -xdev -type f -print0)
sync -f "$BACKUP_DIR/approved-apt"
install_live_marker
write_migration_journal mutation_started
mutation_started=1
publish_approved_apt_contract \
  || fail "approved Nginx APT contract could not be published atomically"
cmp -s "$OPS_DIR/apt/nginx.list" "$SOURCE_LIST" \
  && cmp -s "$OPS_DIR/apt/99nginx" "$PREFERENCES" \
  || fail "installed Nginx APT policy differs from the reviewed templates"

apt-get update
targets_file="$temp_dir/apt-indextargets.txt"
targets_stderr="$temp_dir/apt-indextargets.stderr"
if ! env -i PATH="$PATH" apt-get indextargets \
  --format '$(SITE)|$(RELEASE)|$(CODENAME)|$(COMPONENT)|$(ARCHITECTURE)|$(IDENTIFIER)|$(CREATED_BY)|$(FILENAME)|$(TRUSTED)' \
  > "$targets_file" 2> "$targets_stderr"; then
  fail "active APT Packages targets could not be enumerated after Nginx policy installation"
fi
[ ! -s "$targets_stderr" ] || fail "APT warned while enumerating exact Packages targets"
"$OPS_DIR/bin/assert-apt-active-sources.sh" \
  "$OPS_DIR/config/approved-apt-sources.conf" "$targets_file" >/dev/null \
  || fail "active APT Packages targets differ from the exact Jammy/nginx.org policy"
python3 -I "$OPS_DIR/bin/assert-apt-trust-contract.py" \
  --root / --templates "$OPS_DIR/apt" >/dev/null \
  || fail "APT source, key and pin trust contract is not exact"
candidate="$(apt-cache policy nginx | awk '/Candidate:/ { print $2; exit }')"
[ "$candidate" = "$PACKAGE_VERSION" ] || fail "APT candidate is $candidate, expected $PACKAGE_VERSION"
apt-cache madison nginx | awk -v version="$PACKAGE_VERSION" '$3 == version { found=1 } END { exit found ? 0 : 1 }' \
  || fail "approved Nginx package is absent from signed APT metadata"

SIGNED_APT_DEB_DIR="$temp_dir/signed-apt-deb"
install -d -o root -g root -m 0700 "$SIGNED_APT_DEB_DIR"
(cd "$SIGNED_APT_DEB_DIR" && apt-get download "nginx=$PACKAGE_VERSION" >/dev/null)
mapfile -d '' -t signed_apt_debs \
  < <(find "$SIGNED_APT_DEB_DIR" -maxdepth 1 -type f -name '*.deb' -print0)
[ "${#signed_apt_debs[@]}" -eq 1 ] || fail "signed APT metadata did not resolve one Nginx payload"
cmp -s "$OFFICIAL_DEB" "${signed_apt_debs[0]}" \
  || fail "signed APT payload differs from the exact reviewed Nginx package bytes"

simulation="$BACKUP_DIR/apt-simulation.txt"
DEBIAN_FRONTEND=noninteractive apt-get -s install "$OFFICIAL_DEB" > "$simulation"
while IFS= read -r installed_package; do
  [ "$installed_package" = nginx ] \
    || fail "APT simulation would install or upgrade an unapproved package: $installed_package"
done < <(awk '$1 == "Inst" { print $2 }' "$simulation")
while IFS= read -r removed_package; do
  case "$removed_package" in
    nginx-common|nginx-core|libnginx-mod-http-geoip2|libnginx-mod-http-image-filter|libnginx-mod-http-xslt-filter|libnginx-mod-mail|libnginx-mod-stream|libnginx-mod-stream-geoip2) ;;
    *) fail "APT simulation would remove unapproved package: $removed_package" ;;
  esac
done < <(awk '$1 == "Remv" { print $2 }' "$simulation")
awk '$1 == "Remv" && $2 == "python3-certbot-nginx" { bad=1 } END { exit bad ? 0 : 1 }' "$simulation" \
  && fail "APT simulation would remove Certbot's Nginx integration"

if ! getent group nginx >/dev/null 2>&1; then groupadd --system nginx; fi
if ! id nginx >/dev/null 2>&1; then
  useradd --system --gid nginx --home-dir /nonexistent --no-create-home \
    --shell /usr/sbin/nologin --comment "NGINX service" nginx
fi
for temp_name in client_temp proxy_temp fastcgi_temp uwsgi_temp scgi_temp; do
  install -d -o nginx -g nginx -m 0700 "/var/cache/nginx/$temp_name"
done
DEBIAN_FRONTEND=noninteractive apt-get install -y \
  -o Dpkg::Options::=--force-confold "$OFFICIAL_DEB"
write_migration_journal package_installed
[ "$(nginx -v 2>&1)" = "nginx version: nginx/$APPROVED_VERSION" ] \
  || fail "installed Nginx binary is not approved"
[ "$(dpkg-query -W -f='${Version}' nginx)" = "$PACKAGE_VERSION" ] \
  || fail "installed Nginx package version is not approved"

[ -d /etc/nginx ] && [ ! -L /etc/nginx ] \
  || fail "package-installed Nginx configuration directory is unsafe"
package_config_evidence="$BACKUP_DIR/etc-nginx-after-package"
[ ! -e "$package_config_evidence" ] && [ ! -L "$package_config_evidence" ] \
  || fail "package configuration evidence destination already exists"
mv -- /etc/nginx "$package_config_evidence"
sync -f "$BACKUP_DIR"
tar -C / -xzf "$SAFE_CONFIG_ARCHIVE"
sync -f /etc
"/usr/local/lib/resume-ai/assert-nginx-package-runtime.sh" \
  "$OPS_DIR" "$OFFICIAL_DEB" managed >/dev/null \
  || fail "staged Nginx package/config/module contract did not pass"
write_migration_journal config_installed

systemctl restart nginx
systemctl is-active --quiet nginx || fail "Nginx did not restart"
[ -f "$PENDING_FILE" ] && [ ! -L "$PENDING_FILE" ] \
  && [ -f "$LIVE_MARKER" ] && [ ! -L "$LIVE_MARKER" ] \
  || fail "normal Nginx restart incorrectly activated boot recovery"
[ "$(nginx -v 2>&1)" = "nginx version: nginx/$APPROVED_VERSION" ] \
  && [ "$(dpkg-query -W -f='${Version}' nginx)" = "$PACKAGE_VERSION" ] \
  || fail "Nginx changed revision while restarting"
migrated_tls_status="$(curl -sS --output /dev/null --write-out '%{http_code}' \
  --proto '=https' --tlsv1.2 --resolve siyuanjiaxin.com:443:127.0.0.1 \
  --connect-timeout 5 --max-time 10 https://siyuanjiaxin.com/)" \
  || fail "the migrated local TLS virtual host is unhealthy"
[ "$migrated_tls_status" = 200 ] \
  || fail "the migrated local TLS virtual host did not return HTTP 200"
write_migration_journal service_restarted
dpkg-query -W python3-certbot-nginx >/dev/null 2>&1 || fail "Certbot Nginx integration is missing"
certbot plugins 2>/dev/null | grep -Eq '^[[:space:]]*\*[[:space:]]+nginx[[:space:]]*$' \
  || fail "Certbot does not expose its Nginx plugin after migration"
/usr/local/lib/resume-ai/assert-nginx-package-runtime.sh \
  "$OPS_DIR" "$OFFICIAL_DEB" managed >/dev/null \
  || fail "final Nginx package/config/module contract did not pass"

rollback_needed=0
printf '%s\n' "completed" > "$BACKUP_DIR/RESULT"
chmod 0600 "$BACKUP_DIR/RESULT"
sync -f "$BACKUP_DIR/RESULT"
sync -f "$BACKUP_DIR"
rm -f -- "$PENDING_FILE"
sync -f /opt/resume-ai/state
remove_live_marker || fail "Nginx migration live marker could not be durably cleared"
trap cleanup_temp EXIT
printf '%s\n' "Installed official Nginx $APPROVED_VERSION transactionally; automatic recovery reuses the exact cached official package: $BACKUP_DIR"
