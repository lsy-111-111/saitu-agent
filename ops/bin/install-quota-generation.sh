#!/usr/bin/env bash
set -Eeuo pipefail
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

fail() {
  printf '%s\n' "ERROR: $*" >&2
  exit 1
}

[ "${EUID:-$(id -u)}" -eq 0 ] || fail "run as root"
[ "$#" -eq 0 ] || fail "quota generation installer accepts no arguments"
[ "${ACK_INSTALL_QUOTA_GENERATION:-}" = YES ] \
  || fail "explicit quota-generation acknowledgement is required"
umask 077
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
if [ "$SCRIPT_DIR" = /usr/local/lib/resume-ai ]; then
  ACTIVE_RELEASE_ROOT="$(readlink -e /opt/resume-ai/current)" \
    || fail "active release is unavailable to the installed quota entrypoint"
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
  || fail "active quota source is not one root-frozen operations directory"
. "$SCRIPT_DIR/open-root-lock.sh"
open_root_lock 8 deploy
open_root_lock 9 quota-generation
for quota_source in \
  "$OPS_DIR/config/quotas.conf" \
  "$OPS_DIR/generated/quota-generation.env" \
  "$OPS_DIR/generated/application-quota.env" \
  "$OPS_DIR/generated/00-resume-ai-global.conf" \
  "$OPS_DIR/generated/nginx-quota.inc" \
  "$OPS_DIR/generated/nginx-track-quota.inc"; do
  [ -f "$quota_source" ] && [ ! -L "$quota_source" ] \
    && [ "$(stat -c '%U:%h' "$quota_source")" = root:1 ] \
    && [ -z "$(find "$quota_source" -maxdepth 0 -perm /022 -print -quit)" ] \
    || fail "frozen quota source is missing, linked, or writable: $quota_source"
done

STATE_DIR=/opt/resume-ai/state
PENDING_FILE="$STATE_DIR/quota-generation.pending"
BACKUP_ROOT=/var/backups/resume-ai/quota-generations
GENERATION_ROOT=/var/lib/resume-ai/quota-generations
[ ! -e "$PENDING_FILE" ] && [ ! -L "$PENDING_FILE" ] \
  || fail "an earlier quota-generation transaction requires recovery"
install -d -o root -g root -m 0700 "$BACKUP_ROOT" "$GENERATION_ROOT"
[ "$(readlink -e -- "$BACKUP_ROOT")" = "$BACKUP_ROOT" ] \
  && [ "$(stat -c '%U:%G:%a' "$BACKUP_ROOT")" = root:root:700 ] \
  && [ "$(readlink -e -- "$GENERATION_ROOT")" = "$GENERATION_ROOT" ] \
  && [ "$(stat -c '%U:%G:%a' "$GENERATION_ROOT")" = root:root:700 ] \
  || fail "quota backup or generation root is unsafe or traverses a link"
staging="$(mktemp -d "$GENERATION_ROOT/.pending.XXXXXXXX")"
cleanup_preflight_staging() {
  case "$staging" in "$GENERATION_ROOT"/.pending.[A-Za-z0-9]*) ;; *) return 1 ;; esac
  [ ! -e "$staging" ] || { [ -d "$staging" ] && [ ! -L "$staging" ] \
    && find "$staging" -xdev -depth -delete; }
}
trap cleanup_preflight_staging EXIT
backup_id="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="$BACKUP_ROOT/$backup_id"
[ ! -e "$BACKUP_DIR" ] && [ ! -L "$BACKUP_DIR" ] \
  || fail "quota-generation backup already exists"
install -d -o root -g root -m 0700 "$BACKUP_DIR"
"$SCRIPT_DIR/render-quota-config.sh" "$OPS_DIR/config/quotas.conf" "$staging" >/dev/null
GENERATION="$(python3 -I "$SCRIPT_DIR/verify-quota-generation.py" \
  "$staging/quota-generation.env" "$staging/application-quota.env" \
  "$staging/00-resume-ai-global.conf" "$staging/nginx-quota.inc" \
  "$staging/nginx-track-quota.inc")" \
  || fail "candidate quota generation is invalid"
[[ "$GENERATION" =~ ^[a-f0-9]{64}$ ]] || fail "candidate quota generation identity is invalid"
SOURCE_GENERATION="$(python3 -I "$SCRIPT_DIR/verify-quota-generation.py" \
  "$OPS_DIR/generated/quota-generation.env" \
  "$OPS_DIR/generated/application-quota.env" \
  "$OPS_DIR/generated/00-resume-ai-global.conf" \
  "$OPS_DIR/generated/nginx-quota.inc" \
  "$OPS_DIR/generated/nginx-track-quota.inc")" \
  || fail "release-manifest member quota generation is invalid"
[ "$SOURCE_GENERATION" = "$GENERATION" ] \
  && cmp -s "$staging/application-quota.env" "$OPS_DIR/generated/application-quota.env" \
  && cmp -s "$staging/00-resume-ai-global.conf" "$OPS_DIR/generated/00-resume-ai-global.conf" \
  && cmp -s "$staging/nginx-quota.inc" "$OPS_DIR/generated/nginx-quota.inc" \
  && cmp -s "$staging/nginx-track-quota.inc" "$OPS_DIR/generated/nginx-track-quota.inc" \
  && cmp -s "$staging/quota-generation.env" "$OPS_DIR/generated/quota-generation.env" \
  || fail "rendered quota generation differs from the frozen release members"

targets=(
  /etc/resume-ai/quota.env
  /etc/nginx/conf.d/00-resume-ai-global.conf
  /etc/nginx/snippets/resume-ai-recommend-quota.inc
  /etc/nginx/snippets/resume-ai-track-quota.inc
  /etc/resume-ai/quota-generation.env
)
sources=(
  "$staging/application-quota.env"
  "$staging/00-resume-ai-global.conf"
  "$staging/nginx-quota.inc"
  "$staging/nginx-track-quota.inc"
  "$staging/quota-generation.env"
)
owners=(root:resume-ai root:root root:root root:root root:root)
modes=(0640 0644 0644 0644 0600)
for index in "${!targets[@]}"; do
  target=${targets[$index]}
  target_directory=${target%/*}
  [ -d "$target_directory" ] && [ ! -L "$target_directory" ] \
    && [ "$(readlink -e -- "$target_directory")" = "$target_directory" ] \
    && [ "$(stat -c '%U' "$target_directory")" = root ] \
    && [ -z "$(find "$target_directory" -maxdepth 0 -perm /022 -print -quit)" ] \
    || fail "quota target directory is unsafe: $target_directory"
  target_name=${target#/}
  target_name=${target_name//\//__}
  if [ -e "$target" ] || [ -L "$target" ]; then
    [ -f "$target" ] && [ ! -L "$target" ] && [ "$(stat -c '%h' "$target")" = 1 ] \
      || fail "existing quota target is unsafe: $target"
    [ "$(stat -c '%U:%G:%a' "$target")" = \
      "${owners[$index]}:${modes[$index]#0}" ] \
      || fail "existing quota target ownership or mode differs: $target"
    cp -a -- "$target" "$BACKUP_DIR/$target_name"
    printf '%s\n' present > "$BACKUP_DIR/$target_name.state"
  else
    printf '%s\n' absent > "$BACKUP_DIR/$target_name.state"
  fi
done
BACKUP_MANIFEST="$BACKUP_DIR/BACKUP_SHA256SUMS"
(
  cd "$BACKUP_DIR"
  find . -xdev -mindepth 1 -maxdepth 1 -type f ! -name BACKUP_SHA256SUMS \
    -printf '%P\0' | LC_ALL=C sort -z | xargs -0 sha256sum
) > "$BACKUP_MANIFEST"
chmod 0600 "$BACKUP_MANIFEST" "$BACKUP_DIR"/*.state
BACKUP_MANIFEST_SHA256="$(sha256sum "$BACKUP_MANIFEST" | awk '{print $1}')"
[[ "$BACKUP_MANIFEST_SHA256" =~ ^[a-f0-9]{64}$ ]] \
  || fail "quota backup manifest identity is malformed"
(cd "$BACKUP_DIR" && sha256sum --strict -c BACKUP_SHA256SUMS >/dev/null) \
  || fail "quota backup manifest does not verify before publication"
while IFS= read -r -d '' member; do sync -f "$member"; done \
  < <(find "$BACKUP_DIR" -xdev -type f -print0)
sync -f "$BACKUP_DIR"
sync -f "$BACKUP_ROOT"

write_journal() {
  local phase=$1 temporary
  temporary="$(mktemp "$STATE_DIR/.quota-generation.XXXXXX")"
  cat > "$temporary" <<EOF
SCHEMA_VERSION=2
BACKUP_DIR=$BACKUP_DIR
BACKUP_MANIFEST_SHA256=$BACKUP_MANIFEST_SHA256
GENERATION_SHA256=$GENERATION
PHASE=$phase
EOF
  chown root:root "$temporary"
  chmod 0600 "$temporary"
  sync -f "$temporary"
  mv -f -- "$temporary" "$PENDING_FILE"
  sync -f "$STATE_DIR"
}

rollback() {
  local exit_status=$? index target target_name restore_temp restored=1
  trap - ERR EXIT
  set +e
  [ -f "$BACKUP_MANIFEST" ] && [ ! -L "$BACKUP_MANIFEST" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$BACKUP_MANIFEST")" = root:root:600:1 ] \
    && [ "$(sha256sum "$BACKUP_MANIFEST" | awk '{print $1}')" = "$BACKUP_MANIFEST_SHA256" ] \
    && (cd "$BACKUP_DIR" && sha256sum --strict -c BACKUP_SHA256SUMS >/dev/null) \
    || restored=0
  for index in "${!targets[@]}"; do
    target=${targets[$index]}
    target_name=${target#/}
    target_name=${target_name//\//__}
    [ -d "${target%/*}" ] && [ ! -L "${target%/*}" ] \
      && [ "$(readlink -e -- "${target%/*}")" = "${target%/*}" ] \
      && [ "$(stat -c '%U' "${target%/*}")" = root ] \
      && [ -z "$(find "${target%/*}" -maxdepth 0 -perm /022 -print -quit)" ] \
      && [ -f "$BACKUP_DIR/$target_name.state" ] \
      && [ ! -L "$BACKUP_DIR/$target_name.state" ] \
      && [ "$(stat -c '%U:%G:%a:%h' "$BACKUP_DIR/$target_name.state")" = root:root:600:1 ] \
      || restored=0
    if [ "$(cat "$BACKUP_DIR/$target_name.state" 2>/dev/null)" = present ]; then
      [ -f "$BACKUP_DIR/$target_name" ] && [ ! -L "$BACKUP_DIR/$target_name" ] \
        && [ "$(stat -c '%U:%G:%a:%h' "$BACKUP_DIR/$target_name")" = \
          "${owners[$index]}:${modes[$index]#0}:1" ] \
        || restored=0
    fi
  done
  if [ "$restored" -eq 0 ]; then
    printf '%s\n' "Quota backup or target preflight is invalid; refusing a partial rollback and retaining the journal." >&2
    find "$staging" -xdev -depth -delete >/dev/null 2>&1 || true
    exit "$exit_status"
  fi
  for index in "${!targets[@]}"; do
    target=${targets[$index]}
    target_name=${target#/}
    target_name=${target_name//\//__}
    case "$(cat "$BACKUP_DIR/$target_name.state" 2>/dev/null)" in
      present)
        restore_temp="$(mktemp "${target%/*}/.${target##*/}.restore.XXXXXX")" || restored=0
        if [ "$restored" -eq 1 ]; then
          cp -a -- "$BACKUP_DIR/$target_name" "$restore_temp" \
            && sync -f "$restore_temp" \
            && mv -f -- "$restore_temp" "$target" \
            || restored=0
        fi
        ;;
      absent)
        if [ -e "$target" ] || [ -L "$target" ]; then
          [ -f "$target" ] && [ ! -L "$target" ] && [ "$(stat -c '%h' "$target")" = 1 ] \
            && unlink "$target" || restored=0
        fi
        ;;
      *) restored=0 ;;
    esac
    sync -f "$(dirname "$target")" || restored=0
  done
  if [ "$restored" -eq 1 ]; then
    python3 -I "$SCRIPT_DIR/verify-quota-generation.py" \
      /etc/resume-ai/quota-generation.env /etc/resume-ai/quota.env \
      /etc/nginx/conf.d/00-resume-ai-global.conf \
      /etc/nginx/snippets/resume-ai-recommend-quota.inc \
      /etc/nginx/snippets/resume-ai-track-quota.inc >/dev/null \
      || restored=0
  fi
  if [ "$restored" -eq 1 ] && nginx -t >/dev/null 2>&1; then
    if systemctl is-active --quiet nginx; then systemctl reload nginx || restored=0; fi
    if systemctl is-active --quiet resume-ai-pm2.service; then
      systemctl restart resume-ai-pm2.service || restored=0
    fi
  else
    restored=0
  fi
  if [ "$restored" -eq 1 ]; then
    unlink "$PENDING_FILE" 2>/dev/null || true
    sync -f "$STATE_DIR" || true
  else
    printf '%s\n' "Quota rollback was incomplete; retaining the durable journal." >&2
  fi
  find "$staging" -xdev -depth -delete >/dev/null 2>&1 || true
  exit "$exit_status"
}
trap rollback ERR EXIT
write_journal prepared

for index in "${!targets[@]}"; do
  source=${sources[$index]}
  target=${targets[$index]}
  owner=${owners[$index]%:*}
  group=${owners[$index]#*:}
  mode=${modes[$index]}
  directory=${target%/*}
  temporary="$(mktemp "$directory/.${target##*/}.quota.XXXXXX")"
  install -o "$owner" -g "$group" -m "$mode" "$source" "$temporary"
  cmp -s "$source" "$temporary" || fail "quota target staging copy differs: $target"
  sync -f "$temporary"
  mv -f -- "$temporary" "$target"
  sync -f "$directory"
  [ "$(stat -c '%U:%G:%a:%h' "$target")" = \
    "${owners[$index]}:${modes[$index]#0}:1" ] \
    || fail "published quota target ownership or mode differs: $target"
done
write_journal files_installed
python3 -I "$SCRIPT_DIR/verify-quota-generation.py" \
  /etc/resume-ai/quota-generation.env /etc/resume-ai/quota.env \
  /etc/nginx/conf.d/00-resume-ai-global.conf \
  /etc/nginx/snippets/resume-ai-recommend-quota.inc \
  /etc/nginx/snippets/resume-ai-track-quota.inc \
  | grep -Fxq "$GENERATION" || fail "installed quota generation is mixed"
nginx -t
if systemctl is-active --quiet nginx; then systemctl reload nginx; fi
if systemctl is-active --quiet resume-ai-pm2.service; then
  systemctl restart resume-ai-pm2.service
  active_port="$(awk -F= '$1 == "ACTIVE_PORT" { print $2; count += 1 } END { if (count != 1) exit 2 }' \
    /opt/resume-ai/state/active.env)" || fail "active application port is unavailable"
  active_pid="$(runuser -u resume-ai -- env -i HOME=/var/lib/resume-ai PM2_HOME=/var/lib/resume-ai/.pm2 \
    PATH=/opt/nodejs/current/bin:/usr/bin:/bin /opt/nodejs/current/bin/pm2 pid "resume-ai-$active_port" | tail -n 1)"
  [[ "$active_pid" =~ ^[1-9][0-9]*$ ]] \
    && [ -d "/proc/$active_pid" ] \
    && [ "$(stat -c '%U' "/proc/$active_pid")" = resume-ai ] \
    || fail "active application PID is unavailable or has the wrong owner"
  active_start_ticks="$("$SCRIPT_DIR/read-proc-start-ticks.py" "$active_pid")" \
    || fail "active application process identity cannot be frozen"
  python3 - /etc/resume-ai/quota.env "/proc/$active_pid/environ" <<'PY'
import pathlib, sys
expected = {}
for line in pathlib.Path(sys.argv[1]).read_text(encoding="utf-8").splitlines():
    if line and not line.startswith("#"):
        key, value = line.split("=", 1)
        expected[key] = value
observed = {}
for entry in pathlib.Path(sys.argv[2]).read_bytes().split(b"\0"):
    if b"=" in entry:
        key, value = entry.split(b"=", 1)
        decoded = key.decode("ascii", errors="strict")
        if decoded in expected:
            observed[decoded] = value.decode("ascii", errors="strict")
if observed != expected:
    raise SystemExit("live application quota environment differs from the committed generation")
PY
  [ "$("$SCRIPT_DIR/read-proc-start-ticks.py" "$active_pid")" = "$active_start_ticks" ] \
    || fail "active application changed while its quota environment was inspected"
fi
if systemctl is-active --quiet nginx; then
  loaded_generation="$(curl --proto '=https' --tlsv1.2 -fsS \
    --resolve siyuanjiaxin.com:443:127.0.0.1 --connect-timeout 5 --max-time 10 \
    https://siyuanjiaxin.com/__resume_ai_quota_generation)" \
    || fail "live Nginx quota-generation endpoint is unavailable"
  [ "$loaded_generation" = "$GENERATION" ] \
    || fail "live Nginx workers did not load the committed quota generation"
fi
write_journal runtime_verified
printf 'completed=%s\ngeneration=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$GENERATION" \
  > "$BACKUP_DIR/RESULT"
chmod 0600 "$BACKUP_DIR/RESULT"
sync -f "$BACKUP_DIR/RESULT"
sync -f "$BACKUP_DIR"
unlink "$PENDING_FILE"
sync -f "$STATE_DIR"
trap - ERR EXIT
find "$staging" -xdev -depth -delete
printf '%s\n' "Installed and runtime-verified quota generation $GENERATION."
