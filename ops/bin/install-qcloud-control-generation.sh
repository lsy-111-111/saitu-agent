#!/usr/bin/env bash
set -Eeuo pipefail
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

fail() { printf '%s\n' "ERROR: $*" >&2; exit 1; }
[ "${EUID:-$(id -u)}" -eq 0 ] || fail "run as root"
[ "$#" -eq 0 ] || fail "QCloud control installer accepts no arguments"
[ "${ACK_INSTALL_QCLOUD_CONTROL_GENERATION:-}" = YES ] \
  || fail "explicit QCloud control-generation acknowledgement is required"
umask 077
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
if [ "$SCRIPT_DIR" = /usr/local/lib/resume-ai ]; then
  ACTIVE_RELEASE_ROOT="$(readlink -e /opt/resume-ai/current)" \
    || fail "active release is unavailable to the installed QCloud entrypoint"
  case "$ACTIVE_RELEASE_ROOT" in /opt/resume-ai/releases/20??????T??????Z) ;; \
    *) fail "active release path is outside the fixed managed tree" ;; esac
  OPS_DIR="$ACTIVE_RELEASE_ROOT/ops"
else
  OPS_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
  SOURCE_RELEASE_ROOT="$(cd -- "$OPS_DIR/.." && pwd -P)"
  case "$SOURCE_RELEASE_ROOT" in /opt/resume-ai/releases/20??????T??????Z) ;; \
    *) fail "source invocation must come from the fixed active managed release" ;; esac
  [ "$(readlink -e /opt/resume-ai/current)" = "$SOURCE_RELEASE_ROOT" ] \
    || fail "source invocation is not the active release"
fi
[ -d "$OPS_DIR" ] && [ ! -L "$OPS_DIR" ] \
  && [ "$(stat -c '%U' "$OPS_DIR")" = root ] \
  && [ -z "$(find "$OPS_DIR" -maxdepth 0 -perm /022 -print -quit)" ] \
  || fail "active QCloud source is not one root-frozen operations directory"
. "$SCRIPT_DIR/open-root-lock.sh"
open_root_lock 8 deploy
open_root_lock 9 qcloud-control

STATE_DIR=/var/lib/resume-ai/security
PENDING_FILE="$STATE_DIR/qcloud-control.pending"
BACKUP_ROOT=/var/backups/resume-ai/qcloud-control
[ ! -e "$PENDING_FILE" ] && [ ! -L "$PENDING_FILE" ] \
  || fail "an earlier QCloud control transaction requires recovery"
install -d -o root -g root -m 0700 "$STATE_DIR" "$BACKUP_ROOT"
[ "$(readlink -e -- "$STATE_DIR")" = "$STATE_DIR" ] \
  && [ "$(stat -c '%U:%G:%a' "$STATE_DIR")" = root:root:700 ] \
  && [ "$(readlink -e -- "$BACKUP_ROOT")" = "$BACKUP_ROOT" ] \
  && [ "$(stat -c '%U:%G:%a' "$BACKUP_ROOT")" = root:root:700 ] \
  || fail "QCloud state or backup root is unsafe or traverses a link"
BACKUP_DIR="$BACKUP_ROOT/$(date -u +%Y%m%dT%H%M%SZ)"
[ ! -e "$BACKUP_DIR" ] && [ ! -L "$BACKUP_DIR" ] \
  || fail "QCloud control backup generation already exists"
install -d -o root -g root -m 0700 "$BACKUP_DIR"

sources=(
  "$OPS_DIR/bin/qcloud-network-control.py"
  "$OPS_DIR/bin/rc-local-backup.py"
  "$OPS_DIR/bin/run-qcloud-network-tuning.sh"
  "$OPS_DIR/systemd/resume-ai-qcloud-network-tuning@.service"
  "$OPS_DIR/udev/80-qcloud-nic.rules"
  "$OPS_DIR/config/approved-qcloud-network-tuning.conf"
)
targets=(
  /usr/local/lib/resume-ai/qcloud-network-control.py
  /usr/local/lib/resume-ai/rc-local-backup.py
  /usr/local/lib/resume-ai/run-qcloud-network-tuning.sh
  /etc/systemd/system/resume-ai-qcloud-network-tuning@.service
  /etc/udev/rules.d/80-qcloud-nic.rules
  /usr/local/share/resume-ai/approved-qcloud-network-tuning.conf
)
modes=(0755 0755 0755 0644 0644 0444)

generation_input="$BACKUP_DIR/generation-input.tsv"
for index in "${!sources[@]}"; do
  source=${sources[$index]}
  target=${targets[$index]}
  [ -f "$source" ] && [ ! -L "$source" ] \
    && [ "$(stat -c '%U:%h' "$source")" = root:1 ] \
    && [ -z "$(find "$source" -maxdepth 0 -perm /022 -print -quit)" ] \
    || fail "QCloud source control is missing or unsafe: $source"
  [ -d "${target%/*}" ] && [ ! -L "${target%/*}" ] \
    && [ "$(readlink -e -- "${target%/*}")" = "${target%/*}" ] \
    && [ "$(stat -c '%U' "${target%/*}")" = root ] \
    && [ -z "$(find "${target%/*}" -maxdepth 0 -perm /022 -print -quit)" ] \
    || fail "QCloud target directory is unsafe: ${target%/*}"
  printf '%s\t%s\t%s\t%s\n' \
    "$(sha256sum "$source" | awk '{print $1}')" "${modes[$index]}" \
    "${source#"$OPS_DIR"/}" "$target" >> "$generation_input"
  backup_name=${target#/}
  backup_name=${backup_name//\//__}
  if [ -e "$target" ] || [ -L "$target" ]; then
    [ -f "$target" ] && [ ! -L "$target" ] && [ "$(stat -c '%h' "$target")" = 1 ] \
      || fail "installed QCloud target is unsafe: $target"
    [ "$(stat -c '%U:%G:%a' "$target")" = "root:root:${modes[$index]#0}" ] \
      || fail "installed QCloud target ownership or mode differs: $target"
    cp -a -- "$target" "$BACKUP_DIR/$backup_name"
    printf '%s\n' present > "$BACKUP_DIR/$backup_name.state"
  else
    printf '%s\n' absent > "$BACKUP_DIR/$backup_name.state"
  fi
done
GENERATION_SHA256="$(sha256sum "$generation_input" | awk '{print $1}')"
BACKUP_MANIFEST="$BACKUP_DIR/BACKUP_SHA256SUMS"
: > "$BACKUP_MANIFEST"
(cd "$BACKUP_DIR" && sha256sum generation-input.tsv) >> "$BACKUP_MANIFEST"
for index in "${!targets[@]}"; do
  target=${targets[$index]}
  backup_name=${target#/}
  backup_name=${backup_name//\//__}
  (cd "$BACKUP_DIR" && sha256sum "$backup_name.state") >> "$BACKUP_MANIFEST"
  if [ "$(cat "$BACKUP_DIR/$backup_name.state")" = present ]; then
    (cd "$BACKUP_DIR" && sha256sum "$backup_name") >> "$BACKUP_MANIFEST"
  fi
done
chmod 0600 "$generation_input" "$BACKUP_MANIFEST" "$BACKUP_DIR"/*.state
BACKUP_MANIFEST_SHA256="$(sha256sum "$BACKUP_MANIFEST" | awk '{print $1}')"
[[ "$BACKUP_MANIFEST_SHA256" =~ ^[a-f0-9]{64}$ ]] \
  || fail "QCloud backup manifest identity is invalid"
(cd "$BACKUP_DIR" && sha256sum --strict -c BACKUP_SHA256SUMS >/dev/null) \
  || fail "QCloud backup manifest does not verify before publication"
while IFS= read -r -d '' backup_file; do sync -f "$backup_file"; done \
  < <(find "$BACKUP_DIR" -xdev -type f -print0)
sync -f "$BACKUP_DIR"
sync -f "$BACKUP_ROOT"

write_journal() {
  local phase=$1 temporary
  temporary="$(mktemp "$STATE_DIR/.qcloud-control.XXXXXX")"
  printf 'SCHEMA_VERSION=2\nBACKUP_DIR=%s\nBACKUP_MANIFEST_SHA256=%s\nGENERATION_SHA256=%s\nPHASE=%s\n' \
    "$BACKUP_DIR" "$BACKUP_MANIFEST_SHA256" "$GENERATION_SHA256" "$phase" > "$temporary"
  chown root:root "$temporary"
  chmod 0600 "$temporary"
  sync -f "$temporary"
  mv -f -- "$temporary" "$PENDING_FILE"
  sync -f "$STATE_DIR"
}

rollback() {
  local status=$? index target backup_name temporary restored=1
  trap - ERR EXIT
  set +e
  [ -f "$BACKUP_MANIFEST" ] && [ ! -L "$BACKUP_MANIFEST" ] \
    && [ "$(sha256sum "$BACKUP_MANIFEST" | awk '{print $1}')" = "$BACKUP_MANIFEST_SHA256" ] \
    && (cd "$BACKUP_DIR" && sha256sum --strict -c BACKUP_SHA256SUMS >/dev/null) \
    || restored=0
  if [ "$restored" -eq 0 ]; then
    printf '%s\n' "QCloud backup manifest is invalid; refusing a partial rollback and retaining the journal." >&2
    exit "$status"
  fi
  for target in "${targets[@]}"; do
    [ -d "${target%/*}" ] && [ ! -L "${target%/*}" ] \
      && [ "$(readlink -e -- "${target%/*}")" = "${target%/*}" ] \
      && [ "$(stat -c '%U' "${target%/*}")" = root ] \
      && [ -z "$(find "${target%/*}" -maxdepth 0 -perm /022 -print -quit)" ] \
      || restored=0
  done
  for index in "${!targets[@]}"; do
    target=${targets[$index]}
    backup_name=${target#/}
    backup_name=${backup_name//\//__}
    case "$(cat "$BACKUP_DIR/$backup_name.state" 2>/dev/null)" in
      present)
        [ -f "$BACKUP_DIR/$backup_name" ] && [ ! -L "$BACKUP_DIR/$backup_name" ] \
          && [ "$(stat -c '%U:%G:%a:%h' "$BACKUP_DIR/$backup_name")" = \
            "root:root:${modes[$index]#0}:1" ] \
          || restored=0
        ;;
      absent) ;;
      *) restored=0 ;;
    esac
  done
  if [ "$restored" -eq 0 ]; then
    printf '%s\n' "QCloud target directories are unsafe; refusing a partial rollback and retaining the journal." >&2
    exit "$status"
  fi
  for index in "${!targets[@]}"; do
    target=${targets[$index]}
    backup_name=${target#/}
    backup_name=${backup_name//\//__}
    case "$(cat "$BACKUP_DIR/$backup_name.state" 2>/dev/null)" in
      present)
        temporary="$(mktemp "${target%/*}/.${target##*/}.restore.XXXXXX")" || restored=0
        [ "$restored" -eq 0 ] || { cp -a -- "$BACKUP_DIR/$backup_name" "$temporary" \
          && sync -f "$temporary" && mv -f -- "$temporary" "$target"; } || restored=0
        ;;
      absent)
        if [ -e "$target" ] || [ -L "$target" ]; then
          [ -f "$target" ] && [ ! -L "$target" ] && [ "$(stat -c '%h' "$target")" = 1 ] \
            && unlink "$target" || restored=0
        fi
        ;;
      *) restored=0 ;;
    esac
    sync -f "${target%/*}" || restored=0
    if [ -e "$target" ]; then
      [ -f "$target" ] && [ ! -L "$target" ] \
        && [ "$(stat -c '%U:%G:%a:%h' "$target")" = \
          "root:root:${modes[$index]#0}:1" ] \
        || restored=0
    fi
  done
  systemctl daemon-reload || restored=0
  udevadm control --reload || restored=0
  if [ "$restored" -eq 1 ]; then
    unlink "$PENDING_FILE" 2>/dev/null || true
    sync -f "$STATE_DIR" || true
  else
    printf '%s\n' "QCloud control rollback incomplete; journal retained." >&2
  fi
  exit "$status"
}
trap rollback ERR EXIT
write_journal prepared
for index in "${!targets[@]}"; do
  source=${sources[$index]}
  target=${targets[$index]}
  temporary="$(mktemp "${target%/*}/.${target##*/}.qcloud.XXXXXX")"
  install -o root -g root -m "${modes[$index]}" "$source" "$temporary"
  cmp -s "$source" "$temporary" || fail "QCloud staged control differs: $target"
  sync -f "$temporary"
  mv -f -- "$temporary" "$target"
  sync -f "${target%/*}"
  [ "$(stat -c '%U:%G:%a:%h' "$target")" = "root:root:${modes[$index]#0}:1" ] \
    || fail "published QCloud target ownership or mode differs: $target"
done
write_journal installed
systemctl daemon-reload
udevadm control --reload
for index in "${!targets[@]}"; do
  cmp -s "${sources[$index]}" "${targets[$index]}" \
    || fail "installed QCloud generation is mixed"
done
/usr/local/lib/resume-ai/run-qcloud-network-tuning.sh --verify-only >/dev/null
python3 -I /usr/local/lib/resume-ai/qcloud-network-control.py host-state >/dev/null
printf 'completed=%s\ngeneration=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  "$GENERATION_SHA256" > "$BACKUP_DIR/RESULT"
chmod 0600 "$BACKUP_DIR/RESULT"
sync -f "$BACKUP_DIR/RESULT"
sync -f "$BACKUP_DIR"
unlink "$PENDING_FILE"
sync -f "$STATE_DIR"
trap - ERR EXIT
printf '%s\n' "Installed QCloud control generation $GENERATION_SHA256."
