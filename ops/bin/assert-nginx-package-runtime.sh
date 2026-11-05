#!/usr/bin/env bash
set -Eeuo pipefail
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

fail() {
  printf '%s\n' "ERROR: $*" >&2
  exit 1
}

[ "$#" -eq 3 ] \
  || fail "usage: assert-nginx-package-runtime.sh OPS_DIR APPROVED_DEB trigger-only|managed"
OPS_DIR=$1
APPROVED_DEB=$2
MODE=$3
case "$OPS_DIR:$APPROVED_DEB" in /*:/*) ;; *) fail "Nginx contract paths must be absolute" ;; esac
case "$MODE" in trigger-only|managed) ;; *) fail "invalid Nginx contract mode" ;; esac
for input in "$OPS_DIR" "$APPROVED_DEB"; do
  [ -e "$input" ] && [ ! -L "$input" ] || fail "Nginx contract input is missing or linked: $input"
done
[ -d "$OPS_DIR" ] && [ -f "$APPROVED_DEB" ] && [ "$(stat -c '%h' "$APPROVED_DEB")" = 1 ] \
  || fail "Nginx contract inputs have unsafe types"
POLICY="$OPS_DIR/config/approved-nginx-versions.conf"
EXPECTED_SHA256="$(awk -F= '$1 == "APPROVED_NGINX_PACKAGE_SHA256" { print $2; count += 1 } END { if (count != 1) exit 2 }' "$POLICY")" \
  || fail "approved Nginx checksum policy is missing or duplicated"
[[ "$EXPECTED_SHA256" =~ ^[a-f0-9]{64}$ ]] || fail "approved Nginx checksum is malformed"
[ "$(sha256sum "$APPROVED_DEB" | awk '{print $1}')" = "$EXPECTED_SHA256" ] \
  || fail "cached official Nginx package differs from the approved bytes"
[ "$(dpkg-deb -f "$APPROVED_DEB" Package)" = nginx ] \
  && [ "$(dpkg-deb -f "$APPROVED_DEB" Version)" = 1.30.4-1~jammy ] \
  && [ "$(dpkg-deb -f "$APPROVED_DEB" Architecture)" = amd64 ] \
  || fail "cached official Nginx package metadata differs from policy"
[ "$(dpkg-query -W -f='${Version}' nginx 2>/dev/null)" = 1.30.4-1~jammy ] \
  || fail "installed Nginx package is not the approved revision"

temporary="$(mktemp -d /tmp/resume-ai-nginx-contract.XXXXXX)"
cleanup() { find "$temporary" -xdev -depth -delete >/dev/null 2>&1 || true; }
trap cleanup EXIT

assert_clean_config_diagnostics() {
  local diagnostics=$1
  [ "$(wc -l < "$diagnostics")" -eq 2 ] \
    && grep -Fxq 'nginx: the configuration file /etc/nginx/nginx.conf syntax is ok' "$diagnostics" \
    && grep -Fxq 'nginx: configuration file /etc/nginx/nginx.conf test is successful' "$diagnostics" \
    || fail "Nginx configuration test emitted a warning or unexpected diagnostic"
}

dpkg-deb -x "$APPROVED_DEB" "$temporary/package"
[ -f "$temporary/package/usr/sbin/nginx" ] \
  && cmp -s "$temporary/package/usr/sbin/nginx" /usr/sbin/nginx \
  || fail "installed Nginx executable differs from the approved package payload"

fragment_path="$(systemctl show nginx.service --property=FragmentPath --value)"
case "$fragment_path" in /lib/systemd/system/nginx.service|/usr/lib/systemd/system/nginx.service) ;; \
  *) fail "Nginx systemd fragment path is outside the package contract" ;; esac
package_fragment=
for candidate in \
  "$temporary/package/lib/systemd/system/nginx.service" \
  "$temporary/package/usr/lib/systemd/system/nginx.service"; do
  if [ -f "$candidate" ]; then
    [ -z "$package_fragment" ] || fail "official package contains duplicate Nginx unit fragments"
    package_fragment=$candidate
  fi
done
[ -n "$package_fragment" ] && cmp -s "$package_fragment" "$fragment_path" \
  || fail "installed Nginx systemd fragment differs from the official package"
expected_drop_in=/etc/systemd/system/nginx.service.d/resume-ai-recovery.conf
[ "$(systemctl show nginx.service --property=DropInPaths --value)" = "$expected_drop_in" ] \
  && [ -f "$expected_drop_in" ] && [ ! -L "$expected_drop_in" ] \
  && cmp -s "$OPS_DIR/systemd/nginx-resume-ai-recovery.conf" "$expected_drop_in" \
  || fail "effective Nginx systemd drop-in set differs from the reviewed contract"

nginx -V > "$temporary/version.txt" 2>&1
LC_ALL=C nginx -T > "$temporary/effective.txt" 2> "$temporary/config-diagnostics.txt"
assert_clean_config_diagnostics "$temporary/config-diagnostics.txt"
python3 -I "$OPS_DIR/bin/assert-nginx-security-contract.py" \
  --effective-config "$temporary/effective.txt" --version-output "$temporary/version.txt" --mode "$MODE" \
  >/dev/null

if [ "$MODE" = managed ]; then
  cmp -s "$temporary/package/etc/nginx/mime.types" /etc/nginx/mime.types \
    || fail "installed Nginx MIME configuration differs from the official package"
  cmp -s "$OPS_DIR/nginx/nginx.conf" /etc/nginx/nginx.conf \
    && cmp -s "$OPS_DIR/generated/00-resume-ai-global.conf" /etc/nginx/conf.d/00-resume-ai-global.conf \
    && cmp -s "$OPS_DIR/nginx/20-resume-ai.conf" /etc/nginx/conf.d/20-resume-ai.conf \
    && cmp -s "$OPS_DIR/nginx/resume-ai-transport-security.conf" /etc/nginx/snippets/resume-ai-transport-security.conf \
    && cmp -s "$OPS_DIR/nginx/resume-ai-proxy-common.conf" /etc/nginx/snippets/resume-ai-proxy-common.conf \
    && cmp -s "$OPS_DIR/generated/nginx-quota.inc" /etc/nginx/snippets/resume-ai-recommend-quota.inc \
    && cmp -s "$OPS_DIR/generated/nginx-track-quota.inc" /etc/nginx/snippets/resume-ai-track-quota.inc \
    || fail "installed managed Nginx configuration differs from the active reviewed release"
  upstream_line="$(awk '/^[[:space:]]*server 127\.0\.0\.1:300[01] max_fails=2 fail_timeout=10s;$/ { print; count += 1 } END { if (count != 1) exit 2 }' \
    /etc/nginx/conf.d/10-resume-ai-upstream.conf)" \
    || fail "managed Nginx upstream file is not the exact one-port contract"
  : "$upstream_line"
fi
printf '%s\n' "Nginx package, binary, unit, module and $MODE configuration contracts match."
