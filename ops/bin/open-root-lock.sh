#!/usr/bin/env bash
# Sourced by root-only operational scripts.  /run/lock is commonly writable by
# unprivileged users, so application locks live below a private directory and
# are opened only after their inode contract is verified.

open_root_lock() {
  local lock_fd=${1:-}
  local lock_name=${2:-}
  local lock_root=/run/resume-ai-locks
  local lock_path

  [ "${EUID:-$(id -u)}" -eq 0 ] || fail "root lock requested by a non-root process"
  [[ "$lock_fd" =~ ^[3-9]$ ]] || fail "invalid root lock descriptor"
  [[ "$lock_name" =~ ^[a-z0-9][a-z0-9-]{0,62}$ ]] || fail "invalid root lock name"
  umask 077

  if [ ! -e "$lock_root" ] && [ ! -L "$lock_root" ]; then
    install -d -o root -g root -m 0700 "$lock_root"
  fi
  [ -d "$lock_root" ] && [ ! -L "$lock_root" ] \
    && [ "$(readlink -e -- "$lock_root")" = "$lock_root" ] \
    && [ "$(stat -c '%U:%G:%a' "$lock_root")" = root:root:700 ] \
    || fail "private root lock directory is unsafe"

  lock_path="$lock_root/$lock_name.lock"
  if [ ! -e "$lock_path" ] && [ ! -L "$lock_path" ]; then
    install -o root -g root -m 0600 /dev/null "$lock_path"
  fi
  [ -f "$lock_path" ] && [ ! -L "$lock_path" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$lock_path")" = root:root:600:1 ] \
    || fail "private root lock file is unsafe: $lock_name"

  eval "exec ${lock_fd}<>\"${lock_path}\""
  flock -n "$lock_fd" || fail "another $lock_name operation is running"
}
