#!/usr/bin/env bash
set -Eeuo pipefail

fail() {
  printf '%s\n' "ERROR: $*" >&2
  exit 1
}

[ "$#" -eq 2 ] \
  || fail "usage: assert-apt-effective-config.sh EXPECTED_ALLOWLIST APT_CONFIG_DUMP"
expected_file=$1
dump_file=$2
case "$expected_file:$dump_file" in /*:/*) ;; *) fail "APT configuration paths must be absolute" ;; esac
for input_file in "$expected_file" "$dump_file"; do
  [ -f "$input_file" ] && [ ! -L "$input_file" ] \
    && [ "$(stat -c '%h' "$input_file")" = 1 ] \
    && [ -z "$(find "$input_file" -perm /022 -print -quit)" ] \
    || fail "APT configuration input is linked or writable by an untrusted account"
done

# These options can bypass archive authentication, TLS identity, release
# freshness, or APT's destructive-operation prompts. They are forbidden even
# though they are not root hook/path rows in the reviewed positive allowlist.
awk '
  BEGIN { bad = 0 }
  {
    lower = tolower($0)
    if (lower ~ /^(acquire::allowinsecurerepositories|acquire::allowweakrepositories|acquire::allowdowngradetoinsecurerepositories|apt::get::allowunauthenticated|apt::get::allow-downgrades|apt::get::allow-remove-essential|apt::get::allow-change-held-packages|apt::get::force-yes) / && lower ~ /"(true|yes|on|1)";/) bad = 1
    if (lower ~ /^acquire::.*::verify-(peer|host) / && lower ~ /"(false|no|off|0)";/) bad = 1
    if (lower ~ /^(acquire::check-date|acquire::check-valid-until) / && lower ~ /"(false|no|off|0)";/) bad = 1
  }
  END { exit bad }
' "$dump_file" \
  || fail "effective APT configuration weakens authentication, freshness, or destructive-operation safety"

normalized_file="$(mktemp "${TMPDIR:-/tmp}/resume-ai-apt-effective.XXXXXX")"
cleanup() { find "$normalized_file" -maxdepth 0 -type f -delete >/dev/null 2>&1 || true; }
trap cleanup EXIT
awk '
  /(Pre-Invoke|Post-Invoke|Pre-Install-Pkgs|::Run::|::Scripts::)/ || /^Dir::Etc( |::)/
' "$dump_file" | LC_ALL=C sort > "$normalized_file"
cmp -s "$normalized_file" "$expected_file" \
  || fail "effective APT root hooks or trust paths differ from the reviewed allowlist"
printf '%s\n' "Effective APT hooks and trust paths match the reviewed allowlist."
