#!/usr/bin/bash
set -Eeuo pipefail

PATH=/usr/sbin:/usr/bin
export PATH

fail() {
  printf '%s\n' "ERROR: $*" >&2
  exit 1
}

[ "${EUID:-$(/usr/bin/id -u)}" -eq 0 ] \
  || fail "QCloud network tuning validation must run as root"
[ "$#" -eq 1 ] || fail "usage: $0 INTERFACE|--verify-only"
case "$1" in
  --verify-only|eth[0-9]*) ;;
  *) fail "untrusted network interface name" ;;
esac
if [ "$1" != --verify-only ] && [[ ! "$1" =~ ^eth[0-9]+$ ]]; then
  fail "untrusted network interface name"
fi

for system_directory in /usr /usr/bin /usr/sbin; do
  [ -d "$system_directory" ] && [ ! -L "$system_directory" ] \
    && [ "$(/usr/bin/stat -c '%U:%G' "$system_directory")" = root:root ] \
    && [ -z "$(/usr/bin/find "$system_directory" -maxdepth 0 -perm /022 -print -quit)" ] \
    || fail "system command directory is linked or unsafe: $system_directory"
done

CONTROL_HELPER=/usr/local/lib/resume-ai/qcloud-network-control.py
for trusted_directory in /usr/local /usr/local/lib /usr/local/lib/resume-ai; do
  [ -d "$trusted_directory" ] && [ ! -L "$trusted_directory" ] \
    && [ "$(/usr/bin/stat -c '%U:%G' "$trusted_directory")" = root:root ] \
    && [ -z "$(/usr/bin/find "$trusted_directory" -maxdepth 0 -perm /022 -print -quit)" ] \
    || fail "QCloud control directory is linked or unsafe: $trusted_directory"
done
[ -f "$CONTROL_HELPER" ] && [ ! -L "$CONTROL_HELPER" ] \
  && [ "$(/usr/bin/stat -c '%U:%G:%a:%h' "$CONTROL_HELPER")" = root:root:755:1 ] \
  || fail "installed QCloud stable-object helper is missing, linked, or unsafe"

exec /usr/bin/python3 -I "$CONTROL_HELPER" vendor "$1"
