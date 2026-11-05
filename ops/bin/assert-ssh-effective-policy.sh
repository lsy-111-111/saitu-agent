#!/usr/bin/env bash
set -Eeuo pipefail

fail() {
  printf '%s\n' "ERROR: $*" >&2
  exit 1
}

[ "$#" -le 1 ] || fail "usage: assert-ssh-effective-policy.sh [test-config]"
main_config=${1:-/etc/ssh/sshd_config}
[ -f "$main_config" ] && [ ! -L "$main_config" ] \
  || fail "SSH main configuration is missing or linked"
sshd_bin="$(command -v sshd || true)"
[ -n "$sshd_bin" ] || fail "sshd is unavailable"

config_files=("$main_config")
if [ "$main_config" = /etc/ssh/sshd_config ]; then
  [ "$(stat -c '%U:%G:%h' "$main_config")" = root:root:1 ] \
    && [ -z "$(find "$main_config" -perm /022 -print -quit)" ] \
    || fail "SSH main configuration ownership or permissions are unsafe"
  shopt -s nullglob
  dropins=(/etc/ssh/sshd_config.d/*.conf)
  shopt -u nullglob
  config_files+=("${dropins[@]}")
  for config_file in "${dropins[@]}"; do
    [ -f "$config_file" ] && [ ! -L "$config_file" ] \
      && [ "$(stat -c '%U:%G:%h' "$config_file")" = root:root:1 ] \
      && [ -z "$(find "$config_file" -perm /022 -print -quit)" ] \
      || fail "SSH drop-in ownership or permissions are unsafe: $config_file"
  done
  awk '
    BEGIN { count = 0 }
    /^[[:space:]]*#/ || /^[[:space:]]*$/ { next }
    tolower($1) == "include" {
      if (NF != 2 || $2 != "/etc/ssh/sshd_config.d/*.conf") bad = 1
      count += 1
    }
    END { exit !bad && count == 1 ? 0 : 1 }
  ' "$main_config" || fail "SSH includes differ from the one reviewed drop-in directory"
  if [ "${#dropins[@]}" -gt 0 ] && awk '
    /^[[:space:]]*#/ || /^[[:space:]]*$/ { next }
    tolower($1) == "include" { found = 1 }
    END { exit found ? 0 : 1 }
  ' "${dropins[@]}"; then
    fail "nested SSH includes are forbidden"
  fi
fi

# Context-sensitive Match blocks can reopen authentication or forwarding after
# a context-free `sshd -T` check.  This host has one reviewed SSH login user, so
# Match is intentionally forbidden and every effective check still supplies a
# complete connection context.
if awk '
  /^[[:space:]]*#/ || /^[[:space:]]*$/ { next }
  tolower($1) == "match" { found = 1 }
  END { exit found ? 0 : 1 }
' "${config_files[@]}"; then
  fail "context-sensitive SSH Match rules are forbidden"
fi

"$sshd_bin" -t -f "$main_config"
required_settings=(
  'allowusers ubuntu'
  'authenticationmethods publickey'
  'pubkeyauthentication yes'
  'passwordauthentication no'
  'kbdinteractiveauthentication no'
  'permitemptypasswords no'
  'permitrootlogin no'
  'x11forwarding no'
  'allowagentforwarding no'
  'allowtcpforwarding no'
  'allowstreamlocalforwarding no'
  'disableforwarding yes'
  'permittunnel no'
  'gatewayports no'
  'permitopen none'
  'permitlisten none'
  'permituserenvironment no'
  'authorizedkeysfile /etc/ssh/authorized_keys/%u'
  'authorizedkeyscommand none'
  'maxauthtries 3'
  'maxsessions 3'
  'logingracetime 30'
  'maxstartups 10:30:30'
)
connection_contexts=(
  'user=ubuntu,host=siyuanjiaxin.com,addr=203.0.113.10,laddr=106.53.0.134,lport=22'
  'user=ubuntu,host=106.53.0.134,addr=198.51.100.20,laddr=106.53.0.134,lport=22'
  'user=root,host=siyuanjiaxin.com,addr=203.0.113.10,laddr=106.53.0.134,lport=22'
)
for connection_spec in "${connection_contexts[@]}"; do
  effective_config="$("$sshd_bin" -T -f "$main_config" -C "$connection_spec")"
  for required_setting in "${required_settings[@]}"; do
    printf '%s\n' "$effective_config" \
      | awk -v expected="$required_setting" '$0 == expected { found = 1 } END { exit found ? 0 : 1 }' \
      || fail "effective SSH policy differs for $connection_spec: $required_setting"
  done
done

printf '%s\n' "SSH effective policy is exact for ubuntu, alternate source context, and root."
