#!/usr/bin/env bash
set -Eeuo pipefail
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

fail() {
  printf '%s\n' "ERROR: $*" >&2
  exit 1
}

[ "${EUID:-$(id -u)}" -eq 0 ] || fail "run as root"
[ "$#" -eq 0 ] || fail "PM2 effective-policy verifier accepts no arguments"

unit=resume-ai-pm2.service
fragment=/etc/systemd/system/resume-ai-pm2.service
dropin=/etc/systemd/system/resume-ai-pm2.service.d/node-runtime-recovery.conf
for policy_file in "$fragment" "$dropin"; do
  [ -f "$policy_file" ] && [ ! -L "$policy_file" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$policy_file")" = root:root:644:1 ] \
    || fail "PM2 policy file is missing or unsafe: $policy_file"
done

property() {
  systemctl show "$unit" --property="$1" --value
}

[ "$(property FragmentPath)" = "$fragment" ] \
  || fail "PM2 FragmentPath is not the reviewed unit"
[ "$(property DropInPaths)" = "$dropin" ] \
  || fail "PM2 has an unreviewed or missing systemd drop-in"
[ "$(property User)" = resume-ai ] && [ "$(property Group)" = resume-ai ] \
  || fail "PM2 effective service identity is not resume-ai"
[ "$(property NoNewPrivileges)" = yes ] \
  && [ "$(property ProtectSystem)" = strict ] \
  && [ "$(property ProtectHome)" = yes ] \
  && [ "$(property PrivateTmp)" = yes ] \
  && [ "$(property PrivateDevices)" = yes ] \
  && [ "$(property RestrictSUIDSGID)" = yes ] \
  && [ "$(property LockPersonality)" = yes ] \
  || fail "PM2 effective sandbox differs from the reviewed policy"
[ -z "$(property CapabilityBoundingSet)" ] \
  && [ -z "$(property AmbientCapabilities)" ] \
  || fail "PM2 effective service retains Linux capabilities"

read_write_paths="$(property ReadWritePaths)"
set -- $read_write_paths
[ "$#" -eq 3 ] \
  && case " $read_write_paths " in *' /var/lib/resume-ai '*) : ;; *) false ;; esac \
  && case " $read_write_paths " in *' /var/log/resume-ai '*) : ;; *) false ;; esac \
  && case " $read_write_paths " in *' /var/cache/resume-ai '*) : ;; *) false ;; esac \
  || fail "PM2 effective writable paths differ from the reviewed set"

address_families="$(property RestrictAddressFamilies)"
set -- $address_families
[ "$#" -eq 3 ] \
  && case " $address_families " in *' AF_UNIX '*) : ;; *) false ;; esac \
  && case " $address_families " in *' AF_INET '*) : ;; *) false ;; esac \
  && case " $address_families " in *' AF_INET6 '*) : ;; *) false ;; esac \
  || fail "PM2 effective address families differ from the reviewed set"

exec_start="$(property ExecStart)"
exec_stop="$(property ExecStop)"
exec_reload="$(property ExecReload)"
case "$exec_start" in
  *'path=/opt/nodejs/current/bin/pm2 ; argv[]=/opt/nodejs/current/bin/pm2 resurrect ;'*) ;;
  *) fail "PM2 effective ExecStart differs from the reviewed command" ;;
esac
case "$exec_stop" in
  *'path=/opt/nodejs/current/bin/pm2 ; argv[]=/opt/nodejs/current/bin/pm2 kill ;'*) ;;
  *) fail "PM2 effective ExecStop differs from the reviewed command" ;;
esac
case "$exec_reload" in
  *'path=/opt/nodejs/current/bin/pm2 ; argv[]=/opt/nodejs/current/bin/pm2 reload all --update-env ;'*) ;;
  *) fail "PM2 effective ExecReload differs from the reviewed command" ;;
esac

printf '%s\n' "PM2 effective systemd policy is exact."
