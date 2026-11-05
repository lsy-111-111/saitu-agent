#!/usr/bin/env bash
set -Eeuo pipefail

fail() {
  printf '%s\n' "ERROR: $*" >&2
  exit 1
}

[ "${EUID:-$(id -u)}" -eq 0 ] || fail "run as root"
[ "${ACK_HARDEN_HOST_FILES:-}" = YES ] \
  || fail "set ACK_HARDEN_HOST_FILES=YES after the cloud snapshot exists"
[ "$#" -eq 0 ] || fail "this command accepts no arguments"
umask 077

harden_fixed_marker() {
  local path=$1
  [ -e "$path" ] || return 0
  [ -f "$path" ] && [ ! -L "$path" ] && [ "$(stat -c '%h' "$path")" = 1 ] \
    || fail "unsafe Tencent Cloud marker: $path"
  chown root:root "$path"
  chmod 0644 "$path"
}

harden_fixed_marker /etc/uuid
harden_fixed_marker /usr/local/qcloud/stargate/bin/firstRun

for qcloud_log_root in \
  /usr/local/qcloud/monitor/barad/log \
  /usr/local/qcloud/monitor/barad/admin/log \
  /usr/local/qcloud/barad/log; do
  [ -e "$qcloud_log_root" ] || continue
  [ -d "$qcloud_log_root" ] && [ ! -L "$qcloud_log_root" ] \
    || fail "unsafe Tencent Cloud log root: $qcloud_log_root"
  unsafe_log_member="$(find "$qcloud_log_root" -xdev \( -type l -o \( ! -type d ! -type f \) \) -print -quit)"
  [ -z "$unsafe_log_member" ] || fail "unsafe Tencent Cloud log member: $unsafe_log_member"
  find "$qcloud_log_root" -xdev -type d -perm /0002 -exec chmod o-w {} +
  find "$qcloud_log_root" -xdev -type f -perm /0002 -exec chmod o-w {} +
done

ubuntu_home="$(getent passwd ubuntu | awk -F: 'NR==1 { print $6 }')"
[ "$ubuntu_home" = /home/ubuntu ] || fail "ubuntu home directory is unexpected"
ubuntu_npm="$ubuntu_home/.npm"
if [ -e "$ubuntu_npm" ]; then
  [ -d "$ubuntu_npm" ] && [ ! -L "$ubuntu_npm" ] \
    || fail "ubuntu npm cache root is unsafe"
  unsafe_npm_member="$(find "$ubuntu_npm" -xdev \( -type l -o \( ! -type d ! -type f \) -o \( -type f -links +1 \) \) -print -quit)"
  [ -z "$unsafe_npm_member" ] || fail "ubuntu npm cache has a link or special file: $unsafe_npm_member"
  find "$ubuntu_npm" -xdev -type d -exec chown ubuntu:ubuntu {} + -exec chmod 0700 {} +
  find "$ubuntu_npm" -xdev -type f -exec chown ubuntu:ubuntu {} + -exec chmod 0600 {} +
fi

if id lighthouse >/dev/null 2>&1; then
  if [ "${ACK_DISABLE_LIGHTHOUSE:-}" = YES ]; then
    [ "${CLOUD_CONSOLE_LIGHTHOUSE_DEPENDENCY:-}" = CONFIRMED_ABSENT ] \
      || fail "cloud-console Lighthouse dependency must be confirmed absent"
    [ "$(passwd -S lighthouse | awk '{print $2}')" = L ] \
      || fail "lighthouse must already be locked before sudo removal"
    pgrep -u "$(id -u lighthouse)" >/dev/null 2>&1 \
      && fail "lighthouse still has a running process"
    for key_path in /home/lighthouse/.ssh/authorized_keys /home/lighthouse/.ssh/authorized_keys2; do
      [ ! -s "$key_path" ] || fail "lighthouse still has an authorized key"
    done
    if grep -RE '^[[:space:]]*lighthouse[[:space:]].*NOPASSWD:' /etc/sudoers.d 2>/dev/null | grep -q .; then
      fail "lighthouse has an additional sudoers.d grant requiring separate review"
    fi
    sudoers_count="$(awk '$0 ~ /^[[:space:]]*lighthouse[[:space:]]+ALL=\(ALL\)[[:space:]]+NOPASSWD:[[:space:]]+ALL[[:space:]]*$/ { count += 1 } END { print count + 0 }' /etc/sudoers)"
    case "$sudoers_count" in 0|1) ;; *) fail "ambiguous lighthouse sudoers entries" ;; esac
    review_id="$(date -u +%Y%m%dT%H%M%SZ)"
    review_root=/var/backups/resume-ai/host-permissions
    review_dir="$review_root/$review_id"
    [ ! -e "$review_dir" ] || fail "host-permission backup already exists"
    install -d -o root -g root -m 0700 "$review_root" "$review_dir"
    cp --preserve=mode,ownership,timestamps /etc/sudoers "$review_dir/sudoers.before"
    chmod 0600 "$review_dir/sudoers.before"
    sync -f "$review_dir/sudoers.before"
    sync -f "$review_dir"
    original_shell="$(getent passwd lighthouse | cut -d: -f7)"
    [[ "$original_shell" == /* ]] || fail "lighthouse shell is unsafe"
    original_privileged_groups=()
    for privileged_group in sudo lxd docker; do
      if getent group "$privileged_group" >/dev/null 2>&1 \
        && case " $(id -nG lighthouse) " in *" $privileged_group "*) true ;; *) false ;; esac; then
        original_privileged_groups+=("$privileged_group")
      fi
    done
    lighthouse_mutation_started=0
    sudoers_temp="$(mktemp /etc/.sudoers.resume-ai.XXXXXX)"
    rollback_lighthouse() {
      local status=$?
      trap - EXIT
      rm -f -- "${sudoers_temp:-}"
      rm -f -- "${marker:-}" "${marker_temp:-}"
      if [ "${lighthouse_mutation_started:-0}" -eq 1 ]; then
        install -o root -g root -m 0440 "$review_dir/sudoers.before" /etc/sudoers >/dev/null 2>&1 || true
        usermod --shell "$original_shell" lighthouse >/dev/null 2>&1 || true
        for privileged_group in "${original_privileged_groups[@]}"; do
          gpasswd -a lighthouse "$privileged_group" >/dev/null 2>&1 || true
        done
      fi
      exit "$status"
    }
    trap rollback_lighthouse EXIT
    awk '$0 !~ /^[[:space:]]*lighthouse[[:space:]]+ALL=\(ALL\)[[:space:]]+NOPASSWD:[[:space:]]+ALL[[:space:]]*$/' \
      /etc/sudoers > "$sudoers_temp"
    chown root:root "$sudoers_temp"
    chmod 0440 "$sudoers_temp"
    visudo -cf "$sudoers_temp" >/dev/null
    lighthouse_mutation_started=1
    mv -f -- "$sudoers_temp" /etc/sudoers
    sudoers_temp=""
    sync -f /etc/sudoers
    sync -f /etc
    usermod --shell /usr/sbin/nologin lighthouse
    usermod --lock lighthouse
    for privileged_group in sudo lxd docker; do
      if getent group "$privileged_group" >/dev/null 2>&1; then
        case " $(id -nG lighthouse) " in
          *" $privileged_group "*) gpasswd -d lighthouse "$privileged_group" >/dev/null ;;
        esac
      fi
    done
    install -d -o root -g root -m 0700 /var/lib/resume-ai/security
    marker=/var/lib/resume-ai/security/lighthouse-disabled.env
    marker_temp="$(mktemp /var/lib/resume-ai/security/.lighthouse.XXXXXX)"
    cat > "$marker_temp" <<EOF
SCHEMA_VERSION=1
REVIEWED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
CLOUD_CONSOLE_DEPENDENCY=CONFIRMED_ABSENT
SUDOERS_BACKUP=$review_dir/sudoers.before
EOF
    chown root:root "$marker_temp"
    chmod 0600 "$marker_temp"
    mv -f -- "$marker_temp" "$marker"
    sync -f "$marker"
    sync -f /var/lib/resume-ai/security
    lighthouse_mutation_started=0
    trap - EXIT
  else
    printf '%s\n' "lighthouse remains unchanged; confirm the cloud-console dependency, then rerun with ACK_DISABLE_LIGHTHOUSE=YES." >&2
  fi
fi

printf '%s\n' "Conservative host file-permission hardening completed."
