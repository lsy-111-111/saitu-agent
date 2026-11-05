#!/usr/bin/env bash
set -Eeuo pipefail

fail() {
  printf '%s\n' "ERROR: $*" >&2
  exit 1
}

[ "${EUID:-$(id -u)}" -eq 0 ] || fail "run as root"
STATE_FILE=${1:-/opt/resume-ai/state/active.env}
RELEASE_ROOT=/opt/resume-ai/releases
CURRENT_LINK=/opt/resume-ai/current
NGINX_UPSTREAM=/etc/nginx/conf.d/10-resume-ai-upstream.conf
PM2_HOME=/var/lib/resume-ai/.pm2

for protected_file in "$STATE_FILE" "$NGINX_UPSTREAM"; do
  [ -f "$protected_file" ] && [ ! -L "$protected_file" ] \
    || fail "protected state is missing or not an ordinary file: $protected_file"
  [ "$(stat -c '%h' "$protected_file")" = 1 ] || fail "protected state is hard-linked: $protected_file"
done
[ "$(stat -c '%U:%G:%a' "$STATE_FILE")" = "root:resume-ai:640" ] \
  || fail "active state ownership or mode is invalid"
[ "$(stat -c '%U:%G:%a' "$NGINX_UPSTREAM")" = "root:root:644" ] \
  || fail "Nginx upstream ownership or mode is invalid"
[ -L "$CURRENT_LINK" ] || fail "current pointer is not a symbolic link"
if [ -e /opt/resume-ai/state/deploy.pending ] && [ "${ALLOW_PENDING_TRANSACTION:-0}" != 1 ]; then
  fail "an incomplete deployment transaction remains"
fi
if [ -e /opt/resume-ai/state/legacy-adoption.pending ] \
  && [ "${ALLOW_PENDING_LEGACY_ADOPTION:-0}" != 1 ]; then
  fail "an incomplete legacy adoption transaction remains"
fi

declare -A state=()
while IFS='=' read -r key value || [ -n "$key" ]; do
  case "$key" in ACTIVE_PORT|ACTIVE_RELEASE|PREVIOUS_PORT|PREVIOUS_RELEASE|SWITCHED_AT) ;; '') continue ;; *) fail "unknown active state key: $key" ;; esac
  [ -z "${state[$key]:-}" ] || fail "duplicate active state key: $key"
  state[$key]=$value
done < "$STATE_FILE"

ACTIVE_PORT=${state[ACTIVE_PORT]:-}
ACTIVE_RELEASE=${state[ACTIVE_RELEASE]:-}
PREVIOUS_PORT=${state[PREVIOUS_PORT]:-}
PREVIOUS_RELEASE=${state[PREVIOUS_RELEASE]:-}
case "$ACTIVE_PORT:$ACTIVE_RELEASE" in 3000:20??????T??????Z|3001:20??????T??????Z) ;; *) fail "invalid active state" ;; esac
case "$PREVIOUS_PORT:$PREVIOUS_RELEASE" in none:none|3000:20??????T??????Z|3001:20??????T??????Z) ;; *) fail "invalid previous state" ;; esac
[[ "${state[SWITCHED_AT]:-}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] \
  || fail "invalid switch timestamp"
if [ "$PREVIOUS_PORT" != none ]; then [ "$ACTIVE_PORT" != "$PREVIOUS_PORT" ] || fail "release ports overlap"; fi
[ "$(readlink -f "$CURRENT_LINK")" = "$RELEASE_ROOT/$ACTIVE_RELEASE" ] \
  || fail "current pointer disagrees with active state"

if ! awk -v expected="$ACTIVE_PORT" '
  /server 127\.0\.0\.1:300[01][[:space:]]/ {
    total += 1
    if ($0 ~ ("server 127\\.0\\.0\\.1:" expected "[[:space:]]")) matched += 1
  }
  END { exit total == 1 && matched == 1 ? 0 : 1 }
' "$NGINX_UPSTREAM"; then
  fail "Nginx upstream disagrees with active state"
fi

check_release_immutable() {
  local release=$1
  local release_dir="$RELEASE_ROOT/$release"
  [ -d "$release_dir" ] && [ ! -L "$release_dir" ] || fail "release directory is missing or unsafe: $release"
  [ "$(stat -c '%U:%G' "$release_dir")" = "root:resume-ai" ] || fail "release root ownership is invalid: $release"
  unsafe_member="$(find "$release_dir" -xdev ! -type l \( ! -user root -o -perm /022 \) -print -quit)"
  [ -z "$unsafe_member" ] || fail "runtime-writable or non-root release member exists: $release"
  python3 - "$release_dir" <<'PY'
import os
import pathlib
import sys

root = pathlib.Path(sys.argv[1]).resolve()
for directory, dirs, files in os.walk(root, followlinks=False):
    for name in [*dirs, *files]:
        candidate = pathlib.Path(directory, name)
        if not candidate.is_symlink():
            continue
        relative = candidate.relative_to(root).as_posix()
        target = candidate.resolve(strict=False)
        if relative == ".next/cache":
            expected = pathlib.Path("/var/cache/resume-ai", root.name).resolve(strict=False)
            if target != expected:
                raise SystemExit("release cache link has an unexpected target")
        elif root != target and root not in target.parents:
            raise SystemExit(f"release symlink escapes the immutable tree: {relative}")
PY
  local cache_dir="/var/cache/resume-ai/$release"
  [ -d "$cache_dir" ] && [ ! -L "$cache_dir" ] || fail "runtime cache is missing: $release"
  [ "$(readlink -e -- "$cache_dir")" = "$cache_dir" ] \
    && [ "$(stat -c '%U:%G:%a' "$cache_dir")" = "resume-ai:resume-ai:750" ] \
    || fail "runtime cache ownership or mode is invalid: $release"
}

check_release_immutable "$ACTIVE_RELEASE"
if [ "$PREVIOUS_RELEASE" != none ]; then check_release_immutable "$PREVIOUS_RELEASE"; fi

[ -f "$PM2_HOME/dump.pm2" ] && [ ! -L "$PM2_HOME/dump.pm2" ] || fail "PM2 dump is missing or unsafe"
[ "$(stat -c '%U:%G:%a:%h' "$PM2_HOME/dump.pm2")" = "resume-ai:resume-ai:600:1" ] \
  || fail "PM2 dump ownership or mode is invalid"
temp_dir="$(mktemp -d /tmp/resume-ai-release-consistency.XXXXXX)"
cleanup() { rm -rf -- "$temp_dir"; }
trap cleanup EXIT
runuser -u resume-ai -- env -i HOME=/var/lib/resume-ai PM2_HOME="$PM2_HOME" \
  PATH=/opt/nodejs/current/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  pm2 jlist > "$temp_dir/live.json"

/opt/nodejs/current/bin/node "$SCRIPT_DIR/verify-pm2-topology.mjs" \
  "$temp_dir/live.json" "$PM2_HOME/dump.pm2" "$RELEASE_ROOT" \
  "$ACTIVE_PORT" "$ACTIVE_RELEASE" "$PREVIOUS_PORT" "$PREVIOUS_RELEASE" \
  /etc/resume-ai/app.env /etc/resume-ai/quota.env

printf '%s\n' "$ACTIVE_RELEASE:$ACTIVE_PORT:$PREVIOUS_RELEASE:$PREVIOUS_PORT"
