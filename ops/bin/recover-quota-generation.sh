#!/usr/bin/env bash
set -Eeuo pipefail
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

fail() {
  printf '%s\n' "ERROR: $*" >&2
  exit 1
}

[ "${EUID:-$(id -u)}" -eq 0 ] || fail "run as root"
[ "$#" -eq 0 ] || fail "quota-generation recovery accepts no arguments"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
. "$SCRIPT_DIR/open-root-lock.sh"
open_root_lock 8 deploy
open_root_lock 9 quota-generation

PENDING_FILE=/opt/resume-ai/state/quota-generation.pending
[ -e "$PENDING_FILE" ] || exit 0
[ -f "$PENDING_FILE" ] && [ ! -L "$PENDING_FILE" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$PENDING_FILE")" = root:root:600:1 ] \
  || fail "quota-generation journal is unsafe"
systemctl is-active --quiet nginx.service \
  && fail "stop Nginx before recovering a quota generation"
systemctl is-active --quiet resume-ai-pm2.service \
  && fail "stop PM2 before recovering a quota generation"

declare -A journal=()
while IFS='=' read -r key value || [ -n "$key" ]; do
  case "$key" in SCHEMA_VERSION|BACKUP_DIR|BACKUP_MANIFEST_SHA256|GENERATION_SHA256|PHASE) ;; *) fail "unknown quota journal key" ;; esac
  [ -z "${journal[$key]:-}" ] || fail "duplicate quota journal key"
  journal[$key]=$value
done < "$PENDING_FILE"
BACKUP_DIR=${journal[BACKUP_DIR]:-}
BACKUP_MANIFEST_SHA256=${journal[BACKUP_MANIFEST_SHA256]:-}
GENERATION_SHA256=${journal[GENERATION_SHA256]:-}
PHASE=${journal[PHASE]:-}
[ "${journal[SCHEMA_VERSION]:-}" = 2 ] || fail "invalid quota journal schema"
case "$BACKUP_DIR" in /var/backups/resume-ai/quota-generations/20??????T??????Z) ;; *) fail "invalid quota backup path" ;; esac
[[ "$GENERATION_SHA256" =~ ^[a-f0-9]{64}$ ]] || fail "invalid quota journal generation"
case "$PHASE" in prepared|files_installed|runtime_verified) ;; *) fail "invalid quota journal phase" ;; esac
[ -d "$BACKUP_DIR" ] && [ ! -L "$BACKUP_DIR" ] \
  && [ "$(readlink -e -- "$BACKUP_DIR")" = "$BACKUP_DIR" ] \
  && [ "$(stat -c '%U:%G:%a' "$BACKUP_DIR")" = root:root:700 ] \
  || fail "quota backup directory is unsafe"
[[ "$BACKUP_MANIFEST_SHA256" =~ ^[a-f0-9]{64}$ ]] \
  || fail "invalid quota backup manifest identity"
BACKUP_MANIFEST="$BACKUP_DIR/BACKUP_SHA256SUMS"
[ -f "$BACKUP_MANIFEST" ] && [ ! -L "$BACKUP_MANIFEST" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$BACKUP_MANIFEST")" = root:root:600:1 ] \
  && [ "$(sha256sum "$BACKUP_MANIFEST" | awk '{print $1}')" = \
    "$BACKUP_MANIFEST_SHA256" ] \
  && (cd "$BACKUP_DIR" && sha256sum --strict -c BACKUP_SHA256SUMS >/dev/null) \
  || fail "quota backup members differ from the durable manifest"

targets=(
  /etc/resume-ai/quota.env
  /etc/nginx/conf.d/00-resume-ai-global.conf
  /etc/nginx/snippets/resume-ai-recommend-quota.inc
  /etc/nginx/snippets/resume-ai-track-quota.inc
  /etc/resume-ai/quota-generation.env
)
owners=(root:resume-ai root:root root:root root:root root:root)
modes=(0640 0644 0644 0644 0600)

# Preflight the complete restore set before replacing any live member.
for index in "${!targets[@]}"; do
  target=${targets[$index]}
  target_name=${target#/}
  target_name=${target_name//\//__}
  [ -d "${target%/*}" ] && [ ! -L "${target%/*}" ] \
    && [ "$(readlink -e -- "${target%/*}")" = "${target%/*}" ] \
    && [ "$(stat -c '%U' "${target%/*}")" = root ] \
    && [ -z "$(find "${target%/*}" -maxdepth 0 -perm /022 -print -quit)" ] \
    || fail "quota recovery target directory is unsafe or traverses a link: ${target%/*}"
  state_file="$BACKUP_DIR/$target_name.state"
  [ -f "$state_file" ] && [ ! -L "$state_file" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$state_file")" = root:root:600:1 ] \
    || fail "quota backup state is unsafe: $target"
  case "$(cat "$state_file")" in
    present)
      backup_file="$BACKUP_DIR/$target_name"
      [ -f "$backup_file" ] && [ ! -L "$backup_file" ] \
        && [ "$(stat -c '%U:%G:%a:%h' "$backup_file")" = \
          "${owners[$index]}:${modes[$index]#0}:1" ] \
        || fail "quota backup member is unsafe: $target"
      ;;
    absent) ;;
    *) fail "invalid quota backup state: $target" ;;
  esac
done

for index in "${!targets[@]}"; do
  target=${targets[$index]}
  target_name=${target#/}
  target_name=${target_name//\//__}
  case "$(cat "$BACKUP_DIR/$target_name.state")" in
    present)
      backup_file="$BACKUP_DIR/$target_name"
      temporary="$(mktemp "${target%/*}/.${target##*/}.restore.XXXXXX")"
      cp -a -- "$backup_file" "$temporary"
      sync -f "$temporary"
      mv -f -- "$temporary" "$target"
      sync -f "${target%/*}"
      ;;
    absent)
      if [ -e "$target" ] || [ -L "$target" ]; then
        [ -f "$target" ] && [ ! -L "$target" ] && [ "$(stat -c '%h' "$target")" = 1 ] \
          || fail "refusing to remove an unsafe quota target: $target"
        unlink "$target"
        sync -f "${target%/*}"
      fi
      ;;
  esac
done

if [ -f /etc/resume-ai/quota-generation.env ]; then
  python3 -I "$SCRIPT_DIR/verify-quota-generation.py" \
    /etc/resume-ai/quota-generation.env /etc/resume-ai/quota.env \
    /etc/nginx/conf.d/00-resume-ai-global.conf \
    /etc/nginx/snippets/resume-ai-recommend-quota.inc \
    /etc/nginx/snippets/resume-ai-track-quota.inc >/dev/null \
    || fail "restored quota generation is inconsistent"
fi
nginx -t >/dev/null || fail "restored quota generation leaves an invalid Nginx configuration"
printf 'recovered=%s\nfailed_generation=%s\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$GENERATION_SHA256" \
  > "$BACKUP_DIR/RECOVERY_RESULT"
chmod 0600 "$BACKUP_DIR/RECOVERY_RESULT"
sync -f "$BACKUP_DIR/RECOVERY_RESULT"
sync -f "$BACKUP_DIR"
unlink "$PENDING_FILE"
sync -f /opt/resume-ai/state
printf '%s\n' "Recovered the previous quota generation."
