#!/usr/bin/env bash
set -Eeuo pipefail
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

fail() {
  printf '%s\n' "ERROR: $*" >&2
  exit 1
}

[ "${EUID:-$(id -u)}" -eq 0 ] || fail "run as root in the managed Ubuntu 22.04 host"
[ "$(uname -s)" = Linux ] || fail "this gate requires Linux"
OS_RELEASE_FILE=/etc/os-release
if [ -L "$OS_RELEASE_FILE" ]; then
  [ "$(readlink -e "$OS_RELEASE_FILE")" = /usr/lib/os-release ] \
    || fail "OS identity link has an unapproved target"
  OS_RELEASE_FILE=/usr/lib/os-release
fi
[ -f "$OS_RELEASE_FILE" ] && [ ! -L "$OS_RELEASE_FILE" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$OS_RELEASE_FILE")" = root:root:644:1 ] \
  || fail "Ubuntu release identity is unavailable or unsafe"
. "$OS_RELEASE_FILE"
[ "${ID:-}:${VERSION_ID:-}" = ubuntu:22.04 ] \
  || fail "this runnable gate requires Ubuntu 22.04"
[ "$(uname -m)" = x86_64 ] || fail "the managed APT policy requires amd64/x86_64"
[ -d /run/systemd/system ] || fail "systemd is not the running init system"

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
ACTIVE_ROOT="$(readlink -e /opt/resume-ai/current)" \
  || fail "active release pointer cannot be resolved"
[ "$REPO_ROOT" = "$ACTIVE_ROOT" ] \
  || fail "run the APT Linux/root gate from the active physical release"
[ ! -e /var/lib/resume-ai/unattended-upgrades.pending ] \
  && [ ! -L /var/lib/resume-ai/unattended-upgrades.pending ] \
  || fail "an interrupted APT transaction must be recovered before testing"

bash -n \
  "$REPO_ROOT/ops/bin/assert-apt-active-sources.sh" \
  "$REPO_ROOT/ops/bin/assert-apt-effective-config.sh" \
  "$REPO_ROOT/ops/bin/assert-unattended-upgrades-runtime.sh" \
  "$REPO_ROOT/ops/bin/install-unattended-upgrades.sh" \
  "$REPO_ROOT/ops/bin/recover-unattended-upgrades.sh" \
  "$REPO_ROOT/ops/bin/verify-apt-unattended-jammy.sh"
PYTHONDONTWRITEBYTECODE=1 python3 -m py_compile \
  "$REPO_ROOT/ops/bin/assert-apt-trust-contract.py" \
  "$REPO_ROOT/ops/bin/assert-unattended-upgrades-config.py"
systemd-analyze verify \
  /etc/systemd/system/resume-ai-apt-recovery.service \
  apt-daily.service apt-daily-upgrade.service \
  apt-daily.timer apt-daily-upgrade.timer
systemd-analyze calendar --iterations=3 '*-*-* 06,18:00:00' >/dev/null
systemd-analyze calendar --iterations=3 '*-*-* 07:00:00' >/dev/null

policy_evidence=/etc/resume-ai/apt-policy.env
[ -f "$policy_evidence" ] && [ ! -L "$policy_evidence" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$policy_evidence")" = root:root:400:1 ] \
  || fail "APT policy evidence is unavailable or unsafe"
esm_mode="$(awk -F= '$1 == "ESM_MODE" { print $2; count += 1 } END { if (count != 1) exit 2 }' \
  "$policy_evidence")" || fail "APT ESM policy evidence is malformed"
case "$esm_mode" in
  disabled) esm_argument=() ;;
  enabled) esm_argument=(--enable-esm) ;;
  *) fail "APT ESM policy evidence has an invalid mode" ;;
esac
"$REPO_ROOT/ops/bin/verify-apt-unattended-jammy.sh" \
  "$REPO_ROOT/ops" "${esm_argument[@]}"

TEST_ROOT="$(mktemp -d /run/resume-ai-apt-negative.XXXXXX)"
cleanup() {
  local status=$?
  trap - EXIT
  case "$TEST_ROOT" in /run/resume-ai-apt-negative.*) ;; *) exit "$status" ;; esac
  find "$TEST_ROOT" -xdev -depth -delete >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT
targets="$TEST_ROOT/targets.txt"
policy="$REPO_ROOT/ops/config/approved-apt-sources.conf"
install -o root -g root -m 0600 \
  "$REPO_ROOT/tests/fixtures/apt-indextargets/active.txt" "$targets"

sed 's#/var/lib/apt/lists/nginx.org_packages_ubuntu_dists_jammy_nginx_binary-amd64_Packages#/tmp/fake-Packages#' \
  "$targets" > "$TEST_ROOT/fake-target.txt"
chmod 0600 "$TEST_ROOT/fake-target.txt"
if "$REPO_ROOT/ops/bin/assert-apt-active-sources.sh" \
    "$policy" "$TEST_ROOT/fake-target.txt" >/dev/null 2>&1; then
  fail "a Packages target outside /var/lib/apt/lists was accepted"
fi
cp "$targets" "$TEST_ROOT/unknown-source.txt"
printf '%s\n' \
  'https://deb.nodesource.com/node_20.x|nodistro|nodistro|main|amd64|Packages|Packages|/var/lib/apt/lists/nodesource_Packages|yes' \
  >> "$TEST_ROOT/unknown-source.txt"
chmod 0600 "$TEST_ROOT/unknown-source.txt"
if "$REPO_ROOT/ops/bin/assert-apt-active-sources.sh" \
    "$policy" "$TEST_ROOT/unknown-source.txt" >/dev/null 2>&1; then
  fail "an unknown active NodeSource Packages target was accepted"
fi
ln -s "$targets" "$TEST_ROOT/targets.symlink"
if "$REPO_ROOT/ops/bin/assert-apt-active-sources.sh" \
    "$policy" "$TEST_ROOT/targets.symlink" >/dev/null 2>&1; then
  fail "a symlinked APT target inventory was accepted"
fi
ln "$targets" "$TEST_ROOT/targets.hardlink"
if "$REPO_ROOT/ops/bin/assert-apt-active-sources.sh" \
    "$policy" "$targets" >/dev/null 2>&1; then
  fail "a hard-linked APT target inventory was accepted"
fi
unlink "$TEST_ROOT/targets.hardlink"

apt_config="$TEST_ROOT/apt-config.dump"
env -i PATH="$PATH" apt-config dump > "$apt_config"
chmod 0600 "$apt_config"
printf '%s\n' 'Acquire::AllowInsecureRepositories "true";' \
  >> "$TEST_ROOT/insecure-apt-config.dump"
cat "$apt_config" >> "$TEST_ROOT/insecure-apt-config.dump"
chmod 0600 "$TEST_ROOT/insecure-apt-config.dump"
if "$REPO_ROOT/ops/bin/assert-apt-effective-config.sh" \
    "$REPO_ROOT/ops/config/approved-apt-effective.conf" \
    "$TEST_ROOT/insecure-apt-config.dump" >/dev/null 2>&1; then
  fail "an APT authentication bypass was accepted"
fi
ln -s "$apt_config" "$TEST_ROOT/apt-config.symlink"
if "$REPO_ROOT/ops/bin/assert-apt-effective-config.sh" \
    "$REPO_ROOT/ops/config/approved-apt-effective.conf" \
    "$TEST_ROOT/apt-config.symlink" >/dev/null 2>&1; then
  fail "a symlinked effective APT dump was accepted"
fi
ln "$apt_config" "$TEST_ROOT/apt-config.hardlink"
if "$REPO_ROOT/ops/bin/assert-apt-effective-config.sh" \
    "$REPO_ROOT/ops/config/approved-apt-effective.conf" \
    "$apt_config" >/dev/null 2>&1; then
  fail "a hard-linked effective APT dump was accepted"
fi

grep -Fq 'open_root_lock 8 deploy' "$REPO_ROOT/ops/bin/install-unattended-upgrades.sh"
grep -Fq 'open_root_lock 9 apt-dpkg' "$REPO_ROOT/ops/bin/install-unattended-upgrades.sh"
grep -Fq 'open_root_lock 8 deploy' "$REPO_ROOT/ops/bin/recover-unattended-upgrades.sh"
grep -Fq 'open_root_lock 9 apt-dpkg' "$REPO_ROOT/ops/bin/recover-unattended-upgrades.sh"
grep -Fq 'BACKUP_MANIFEST_SHA256' "$REPO_ROOT/ops/bin/recover-unattended-upgrades.sh"
grep -Fq 'TIMER_STATE_SHA256' "$REPO_ROOT/ops/bin/recover-unattended-upgrades.sh"

[ ! -e /var/lib/resume-ai/unattended-upgrades.pending ] \
  && [ ! -L /var/lib/resume-ai/unattended-upgrades.pending ] \
  || fail "APT negative tests left an interruption journal"
printf '%s\n' "Ubuntu 22.04 APT sources, transaction evidence, timers, and negative gates passed."
trap - EXIT
cleanup
