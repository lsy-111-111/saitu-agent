#!/usr/bin/env bash
set -euo pipefail
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

fail() { printf '%s\n' "FAIL: $*" >&2; exit 1; }
[ "${EUID:-$(id -u)}" -eq 0 ] || fail "run as root in a disposable Ubuntu 22.04 VM"
[ "$(uname -s)" = Linux ] || fail "this gate requires a disposable Ubuntu 22.04 Linux VM"
. /etc/os-release
[ "${ID:-}:${VERSION_ID:-}" = ubuntu:22.04 ] || fail "this gate requires disposable Ubuntu 22.04"
case "${APPROVED_NGINX_DEB:-}" in /*) ;; *) fail "set APPROVED_NGINX_DEB to the reviewed official package" ;; esac
[ -f "$APPROVED_NGINX_DEB" ] && [ ! -L "$APPROVED_NGINX_DEB" ] \
  || fail "approved Nginx package is missing or linked"
[ "$(sha256sum "$APPROVED_NGINX_DEB" | awk '{print $1}')" = \
  6e4460183d918f245de67290a56a9ea0d84c39b7135fc87a202d72b3a6942fb2 ] \
  || fail "approved Nginx package checksum differs"
[ "$(dpkg-deb -f "$APPROVED_NGINX_DEB" Version)" = 1.30.4-1~jammy ] \
  || fail "approved Nginx package version differs"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd -P)"
FIXTURE="$(mktemp -d /tmp/resume-ai-nginx-1.30.4.XXXXXX)"
cleanup() { find "$FIXTURE" -xdev -depth -delete >/dev/null 2>&1 || true; }
trap cleanup EXIT
dpkg-deb -x "$APPROVED_NGINX_DEB" "$FIXTURE/package"
NGINX="$FIXTURE/package/usr/sbin/nginx"
[ -x "$NGINX" ] || fail "official package Nginx binary is unavailable"
install -d -m 0700 "$FIXTURE/conf/conf.d" "$FIXTURE/conf/snippets" \
  "$FIXTURE/log" "$FIXTURE/temp/client" "$FIXTURE/temp/proxy" \
  "$FIXTURE/temp/fastcgi" "$FIXTURE/temp/uwsgi" "$FIXTURE/temp/scgi"
cp "$FIXTURE/package/etc/nginx/mime.types" "$FIXTURE/conf/mime.types"
cp "$REPO_ROOT/ops/generated/00-resume-ai-global.conf" "$FIXTURE/conf/conf.d/00-resume-ai-global.conf"
cp "$REPO_ROOT/ops/nginx/20-resume-ai.conf" "$FIXTURE/conf/conf.d/20-resume-ai.conf"
cp "$REPO_ROOT/ops/nginx/resume-ai-transport-security.conf" "$FIXTURE/conf/snippets/"
cp "$REPO_ROOT/ops/nginx/resume-ai-proxy-common.conf" "$FIXTURE/conf/snippets/"
cp "$REPO_ROOT/ops/generated/nginx-quota.inc" "$FIXTURE/conf/snippets/resume-ai-recommend-quota.inc"
cp "$REPO_ROOT/ops/generated/nginx-track-quota.inc" "$FIXTURE/conf/snippets/resume-ai-track-quota.inc"
cat > "$FIXTURE/conf/conf.d/10-resume-ai-upstream.conf" <<'EOF'
upstream resume_ai_active { server 127.0.0.1:3000; }
EOF
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=siyuanjiaxin.com \
  -keyout "$FIXTURE/key.pem" -out "$FIXTURE/cert.pem" >/dev/null 2>&1
sed -i \
  -e "s#/etc/nginx#$FIXTURE/conf#g" \
  -e "s#/etc/letsencrypt/live/siyuanjiaxin.com/fullchain.pem#$FIXTURE/cert.pem#g" \
  -e "s#/etc/letsencrypt/live/siyuanjiaxin.com/privkey.pem#$FIXTURE/key.pem#g" \
  -e "s#/var/log/nginx#$FIXTURE/log#g" \
  "$FIXTURE/conf/conf.d/20-resume-ai.conf"
cat > "$FIXTURE/conf/nginx.conf" <<EOF
user root;
pid $FIXTURE/nginx.pid;
error_log $FIXTURE/log/error.log crit;
events { worker_connections 32; }
http {
  include $FIXTURE/conf/mime.types;
  client_body_temp_path $FIXTURE/temp/client;
  proxy_temp_path $FIXTURE/temp/proxy;
  fastcgi_temp_path $FIXTURE/temp/fastcgi;
  uwsgi_temp_path $FIXTURE/temp/uwsgi;
  scgi_temp_path $FIXTURE/temp/scgi;
  include $FIXTURE/conf/conf.d/*.conf;
}
EOF

if ! LC_ALL=C "$NGINX" -t -c "$FIXTURE/conf/nginx.conf" \
    > "$FIXTURE/test.stdout" 2> "$FIXTURE/test.stderr"; then
  sed -n '1,20p' "$FIXTURE/test.stderr" >&2
  fail "official Nginx 1.30.4 rejected the managed configuration"
fi
if grep -Eiq '\[warn\]|warning|deprecated' "$FIXTURE/test.stderr"; then
  sed -n '1,20p' "$FIXTURE/test.stderr" >&2
  fail "official Nginx 1.30.4 emitted a configuration warning"
fi
grep -Fxq '    http2 on;' "$FIXTURE/conf/conf.d/20-resume-ai.conf" \
  || fail "modern HTTP/2 directive is absent"
! grep -Eq 'listen[^;]*[[:space:]]http2([[:space:]]|;)' \
  "$FIXTURE/conf/conf.d/20-resume-ai.conf" \
  || fail "deprecated listen HTTP/2 parameter remains"
printf '%s\n' "Official Nginx 1.30.4 zero-warning configuration gate passed."
