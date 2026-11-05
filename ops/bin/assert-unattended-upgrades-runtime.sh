#!/usr/bin/env bash
set -Eeuo pipefail
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

fail() {
  printf '%s\n' "ERROR: $*" >&2
  exit 1
}

[ "$#" -eq 2 ] || fail "usage: $0 OPS_DIR disabled|enabled"
OPS_DIR=$1
ESM_MODE=$2
case "$OPS_DIR:$ESM_MODE" in /*:disabled|/*:enabled) ;; *) fail "invalid unattended runtime assertion arguments" ;; esac
[ -d "$OPS_DIR" ] && [ ! -L "$OPS_DIR" ] || fail "operations directory is missing or linked"
for command_name in apt-config cmp readlink stat systemctl; do
  command -v "$command_name" >/dev/null 2>&1 || fail "$command_name is unavailable"
done

assert_installed_control() {
  local control=$1 expected_mode=$2
  [ -f "$control" ] && [ ! -L "$control" ] \
    && [ "$(readlink -e "$control")" = "$control" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$control")" = "root:root:${expected_mode}:1" ] \
    || fail "installed unattended-upgrades control is linked, shared, or has unsafe metadata: $control"
}

expected_upgrade="$OPS_DIR/apt/52resume-ai-unattended-upgrades"
if [ "$ESM_MODE" = enabled ]; then
  expected_upgrade="$OPS_DIR/apt/52resume-ai-unattended-upgrades-esm"
fi
for control in \
  /etc/apt/apt.conf.d/20auto-upgrades \
  /etc/apt/apt.conf.d/52resume-ai-unattended-upgrades \
  /etc/systemd/system/apt-daily.timer.d/resume-ai-schedule.conf \
  /etc/systemd/system/apt-daily-upgrade.timer.d/resume-ai-schedule.conf \
  /etc/systemd/system/resume-ai-apt-recovery.service \
  /etc/systemd/system/apt-daily.service.d/resume-ai-recovery.conf \
  /etc/systemd/system/apt-daily-upgrade.service.d/resume-ai-recovery.conf; do
  assert_installed_control "$control" 644
done
cmp -s "$OPS_DIR/apt/20auto-upgrades" /etc/apt/apt.conf.d/20auto-upgrades \
  || fail "installed APT periodic configuration differs from source"
cmp -s "$expected_upgrade" /etc/apt/apt.conf.d/52resume-ai-unattended-upgrades \
  || fail "installed unattended-upgrades policy differs from the selected source"
cmp -s "$OPS_DIR/apt/apt-daily.timer.conf" \
  /etc/systemd/system/apt-daily.timer.d/resume-ai-schedule.conf \
  || fail "apt-daily timer override differs from source"
cmp -s "$OPS_DIR/apt/apt-daily-upgrade.timer.conf" \
  /etc/systemd/system/apt-daily-upgrade.timer.d/resume-ai-schedule.conf \
  || fail "apt-daily-upgrade timer override differs from source"
cmp -s "$OPS_DIR/systemd/resume-ai-apt-recovery.service" \
  /etc/systemd/system/resume-ai-apt-recovery.service \
  || fail "APT boot recovery unit differs from source"
cmp -s "$OPS_DIR/systemd/apt-daily-resume-ai-recovery.conf" \
  /etc/systemd/system/apt-daily.service.d/resume-ai-recovery.conf \
  || fail "apt-daily recovery ordering differs from source"
cmp -s "$OPS_DIR/systemd/apt-daily-upgrade-resume-ai-recovery.conf" \
  /etc/systemd/system/apt-daily-upgrade.service.d/resume-ai-recovery.conf \
  || fail "apt-daily-upgrade recovery ordering differs from source"

dump_file="$(mktemp /var/tmp/resume-ai-unattended-config.XXXXXX)"
cleanup() { find "$dump_file" -maxdepth 0 -type f -delete >/dev/null 2>&1 || true; }
trap cleanup EXIT
env -i PATH="$PATH" apt-config dump > "$dump_file"
chmod 0600 "$dump_file"
"$OPS_DIR/bin/assert-apt-effective-config.sh" \
  "$OPS_DIR/config/approved-apt-effective.conf" "$dump_file" >/dev/null
python3 -I "$OPS_DIR/bin/assert-unattended-upgrades-config.py" \
  --dump "$dump_file" --esm "$ESM_MODE" >/dev/null

assert_timer() {
  local timer=$1 trigger=$2 override=$3 expected_calendar=$4
  local property observed_dropins fragment calendar calendar_count next_elapse
  for property in LoadState UnitFileState ActiveState SubState; do
    case "$property" in
      LoadState) expected=loaded ;;
      UnitFileState) expected=enabled ;;
      ActiveState) expected=active ;;
      SubState) expected=waiting ;;
    esac
    [ "$(systemctl show "$timer" --property="$property" --value)" = "$expected" ] \
      || fail "$timer effective $property is not $expected"
  done
  [ "$(systemctl show "$timer" --property=Triggers --value)" = "$trigger" ] \
    || fail "$timer has an unexpected trigger set"
  observed_dropins="$(systemctl show "$timer" --property=DropInPaths --value)"
  [ "$observed_dropins" = "$override" ] || fail "$timer has an unknown or missing drop-in"
  fragment="$(systemctl show "$timer" --property=FragmentPath --value)"
  case "$fragment" in /lib/systemd/system/"$timer"|/usr/lib/systemd/system/"$timer") ;; *) fail "$timer fragment path is unapproved" ;; esac
  calendar="$(systemctl show "$timer" --property=TimersCalendar --value)"
  case "$calendar" in *"$expected_calendar"*) ;; *) fail "$timer effective calendar is not exact" ;; esac
  calendar_count="$(printf '%s\n' "$calendar" | grep -o 'OnCalendar=' | wc -l)"
  [ "$calendar_count" -eq 1 ] || fail "$timer has more than one effective calendar trigger"
  [ -z "$(systemctl show "$timer" --property=TimersMonotonic --value)" ] \
    || fail "$timer has an unapproved monotonic trigger"
  [ "$(systemctl show "$timer" --property=Persistent --value)" = yes ] \
    || fail "$timer is not persistent"
  [ "$(systemctl show "$timer" --property=FixedRandomDelay --value)" = yes ] \
    || fail "$timer random delay is not stable"
  [ "$(systemctl show "$timer" --property=RandomizedDelayUSec --value)" = 1h ] \
    || fail "$timer randomized delay is not one hour"
  [ "$(systemctl show "$timer" --property=AccuracyUSec --value)" = 1min ] \
    || fail "$timer accuracy window is not one minute"
  for property in WakeSystem OnClockChange OnTimezoneChange; do
    [ "$(systemctl show "$timer" --property="$property" --value)" = no ] \
      || fail "$timer enables an unapproved wake or clock trigger: $property"
  done
  [ "$(systemctl show "$timer" --property=RemainAfterElapse --value)" = yes ] \
    || fail "$timer does not retain its elapsed state"
  next_elapse="$(systemctl show "$timer" --property=NextElapseUSecRealtime --value)"
  [ -n "$next_elapse" ] && [ "$next_elapse" != n/a ] || fail "$timer has no next realtime activation"
}

assert_timer apt-daily.timer apt-daily.service \
  /etc/systemd/system/apt-daily.timer.d/resume-ai-schedule.conf \
  '*-*-* 06,18:00:00'
assert_timer apt-daily-upgrade.timer apt-daily-upgrade.service \
  /etc/systemd/system/apt-daily-upgrade.timer.d/resume-ai-schedule.conf \
  '*-*-* 07:00:00'
for service in apt-daily.service apt-daily-upgrade.service; do
  expected_dropin="/etc/systemd/system/$service.d/resume-ai-recovery.conf"
  [ "$(systemctl show "$service" --property=DropInPaths --value)" = "$expected_dropin" ] \
    || fail "$service has an unknown or missing effective drop-in"
  fragment="$(systemctl show "$service" --property=FragmentPath --value)"
  case "$fragment" in /lib/systemd/system/"$service"|/usr/lib/systemd/system/"$service") ;; \
    *) fail "$service fragment path is unapproved" ;;
  esac
  requires=" $(systemctl show "$service" --property=Requires --value) "
  after=" $(systemctl show "$service" --property=After --value) "
  case "$requires" in *' resume-ai-apt-recovery.service '*) ;; *) fail "$service does not require APT recovery" ;; esac
  case "$after" in *' resume-ai-apt-recovery.service '*) ;; *) fail "$service is not ordered after APT recovery" ;; esac
done

[ "$(systemctl show resume-ai-apt-recovery.service --property=LoadState --value)" = loaded ] \
  || fail "APT recovery unit is not loaded"
[ "$(systemctl show resume-ai-apt-recovery.service --property=FragmentPath --value)" = \
  /etc/systemd/system/resume-ai-apt-recovery.service ] \
  || fail "APT recovery unit has an unapproved fragment"
[ -z "$(systemctl show resume-ai-apt-recovery.service --property=DropInPaths --value)" ] \
  || fail "APT recovery unit has an unapproved drop-in"
[ "$(systemctl show resume-ai-apt-recovery.service --property=Type --value)" = oneshot ] \
  && [ "$(systemctl show resume-ai-apt-recovery.service --property=RemainAfterExit --value)" = no ] \
  || fail "APT recovery must be a re-runnable oneshot gate"
[ "$(systemctl show resume-ai-apt-recovery.service --property=ActiveState --value)" = inactive ] \
  || fail "APT recovery gate must be inactive so each apt-daily start re-runs it"
recovery_before=" $(systemctl show resume-ai-apt-recovery.service --property=Before --value) "
case "$recovery_before" in *' apt-daily.service '*) ;; *) fail "APT recovery is not ordered before apt-daily" ;; esac
case "$recovery_before" in *' apt-daily-upgrade.service '*) ;; *) fail "APT recovery is not ordered before apt-daily-upgrade" ;; esac
printf '%s\n' "Unattended-upgrades files and effective timers match the exact runtime contract."
