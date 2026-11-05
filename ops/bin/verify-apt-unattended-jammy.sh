#!/usr/bin/env bash
set -Eeuo pipefail
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

fail() {
  printf '%s\n' "ERROR: $*" >&2
  exit 1
}

[ "${EUID:-$(id -u)}" -eq 0 ] || fail "run the Jammy APT gate as root"
case "$#" in
  1) esm_argument=() ; esm_mode=disabled ;;
  2)
    [ "$2" = --enable-esm ] || fail "the only optional argument is --enable-esm"
    esm_argument=(--enable-esm)
    esm_mode=enabled
    ;;
  *) fail "usage: $0 ABSOLUTE_OPS_DIR [--enable-esm]" ;;
esac
OPS_DIR=$1
case "$OPS_DIR" in /*) ;; *) fail "operations directory must be absolute" ;; esac
[ -d "$OPS_DIR" ] && [ ! -L "$OPS_DIR" ] || fail "operations directory is missing or linked"
OS_RELEASE_FILE=/etc/os-release
if [ -L "$OS_RELEASE_FILE" ]; then
  [ "$(readlink -e "$OS_RELEASE_FILE")" = /usr/lib/os-release ] \
    || fail "OS identity link has an unapproved target"
  OS_RELEASE_FILE=/usr/lib/os-release
fi
[ -f "$OS_RELEASE_FILE" ] && [ ! -L "$OS_RELEASE_FILE" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$OS_RELEASE_FILE")" = root:root:644:1 ] \
  || fail "OS identity is unavailable or unsafe"
. "$OS_RELEASE_FILE"
[ "${ID:-}" = ubuntu ] && [ "${VERSION_CODENAME:-}" = jammy ] \
  || fail "this runnable gate requires Ubuntu Jammy"
[ "$(uname -m)" = x86_64 ] || fail "APT policy is approved only for amd64/x86_64"
[ ! -e /var/lib/resume-ai/unattended-upgrades.pending ] \
  && [ ! -L /var/lib/resume-ai/unattended-upgrades.pending ] \
  || fail "an unattended-upgrades recovery journal remains"
[ -f /etc/resume-ai/apt-policy.env ] && [ ! -L /etc/resume-ai/apt-policy.env ] \
  && [ "$(stat -c '%U:%G:%a:%h' /etc/resume-ai/apt-policy.env)" = root:root:400:1 ] \
  && [ "$(wc -l < /etc/resume-ai/apt-policy.env)" -eq 2 ] \
  && grep -Fxq 'SCHEMA_VERSION=1' /etc/resume-ai/apt-policy.env \
  && [ "$(grep -c '^ESM_MODE=' /etc/resume-ai/apt-policy.env)" -eq 1 ] \
  && grep -Fxq "ESM_MODE=$esm_mode" /etc/resume-ai/apt-policy.env \
  || fail "root-owned APT policy evidence differs from the requested ESM mode"

for installed_pair in \
  "$OPS_DIR/bin/assert-apt-active-sources.sh:/usr/local/lib/resume-ai/assert-apt-active-sources.sh" \
  "$OPS_DIR/bin/assert-apt-effective-config.sh:/usr/local/lib/resume-ai/assert-apt-effective-config.sh" \
  "$OPS_DIR/bin/assert-apt-trust-contract.py:/usr/local/lib/resume-ai/assert-apt-trust-contract.py" \
  "$OPS_DIR/bin/assert-unattended-upgrades-config.py:/usr/local/lib/resume-ai/assert-unattended-upgrades-config.py" \
  "$OPS_DIR/bin/assert-unattended-upgrades-runtime.sh:/usr/local/lib/resume-ai/assert-unattended-upgrades-runtime.sh" \
  "$OPS_DIR/bin/recover-unattended-upgrades.sh:/usr/local/lib/resume-ai/recover-unattended-upgrades.sh" \
  "$OPS_DIR/bin/open-root-lock.sh:/usr/local/lib/resume-ai/open-root-lock.sh" \
  "$OPS_DIR/systemd/resume-ai-apt-recovery.service:/etc/systemd/system/resume-ai-apt-recovery.service" \
  "$OPS_DIR/systemd/apt-daily-resume-ai-recovery.conf:/etc/systemd/system/apt-daily.service.d/resume-ai-recovery.conf" \
  "$OPS_DIR/systemd/apt-daily-upgrade-resume-ai-recovery.conf:/etc/systemd/system/apt-daily-upgrade.service.d/resume-ai-recovery.conf"; do
  source_file=${installed_pair%%:*}
  installed_file=${installed_pair#*:}
  cmp -s "$source_file" "$installed_file" || fail "installed APT recovery control differs from active source"
done

targets_file="$(mktemp /var/tmp/resume-ai-apt-targets.XXXXXX)"
stderr_file="$(mktemp /var/tmp/resume-ai-apt-targets-stderr.XXXXXX)"
config_file="$(mktemp /var/tmp/resume-ai-apt-config.XXXXXX)"
policy_file="$(mktemp /var/tmp/resume-ai-nginx-policy.XXXXXX)"
policy_stderr="$(mktemp /var/tmp/resume-ai-nginx-policy-stderr.XXXXXX)"
dry_run_stdout="$(mktemp /var/tmp/resume-ai-unattended-dry-run.XXXXXX)"
dry_run_stderr="$(mktemp /var/tmp/resume-ai-unattended-dry-run-stderr.XXXXXX)"
cleanup() {
  find "$targets_file" "$stderr_file" "$config_file" "$policy_file" \
    "$policy_stderr" "$dry_run_stdout" "$dry_run_stderr" \
    -maxdepth 0 -type f -delete >/dev/null 2>&1 || true
}
trap cleanup EXIT
env -i PATH="$PATH" apt-config dump > "$config_file"
chmod 0600 "$config_file"
"$OPS_DIR/bin/assert-apt-effective-config.sh" \
  "$OPS_DIR/config/approved-apt-effective.conf" "$config_file" >/dev/null
if ! env -i PATH="$PATH" apt-get indextargets \
  --format '$(SITE)|$(RELEASE)|$(CODENAME)|$(COMPONENT)|$(ARCHITECTURE)|$(IDENTIFIER)|$(CREATED_BY)|$(FILENAME)|$(TRUSTED)' \
  > "$targets_file" 2> "$stderr_file"; then
  fail "active APT Packages targets could not be enumerated"
fi
[ ! -s "$stderr_file" ] || fail "APT warned while enumerating Packages targets"
chmod 0600 "$targets_file" "$stderr_file"
"$OPS_DIR/bin/assert-apt-active-sources.sh" \
  "$OPS_DIR/config/approved-apt-sources.conf" "$targets_file" "${esm_argument[@]}" >/dev/null
python3 -I "$OPS_DIR/bin/assert-apt-trust-contract.py" \
  --root / --templates "$OPS_DIR/apt" "${esm_argument[@]}" >/dev/null
if ! LC_ALL=C apt-cache policy nginx > "$policy_file" 2> "$policy_stderr"; then
  fail "effective Nginx package policy could not be inspected"
fi
[ ! -s "$policy_stderr" ] || fail "APT warned while parsing the exact Nginx pin"
[ "$(awk '/^[[:space:]]*Candidate:/ { print $2; count += 1 } END { if (count != 1) exit 2 }' \
    "$policy_file")" = 1.30.4-1~jammy ] \
  || fail "effective Nginx APT candidate differs from the exact approved package"
"$OPS_DIR/bin/assert-unattended-upgrades-runtime.sh" "$OPS_DIR" "$esm_mode" >/dev/null
if ! timeout 300 unattended-upgrade --dry-run \
    > "$dry_run_stdout" 2> "$dry_run_stderr"; then
  fail "unattended-upgrade dry run rejected the exact security policy"
fi
[ ! -s "$dry_run_stderr" ] || fail "unattended-upgrade dry run emitted a warning"
printf '%s\n' "Ubuntu Jammy APT and unattended-upgrades acceptance gates passed."
