#!/usr/bin/env bash
set -Eeuo pipefail
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

fail() { printf '%s\n' "ERROR: $*" >&2; exit 1; }
[ "${EUID:-$(id -u)}" -eq 0 ] || fail "run as root"
[ "${ACK_INSTALL_SSH_HARDENING:-}" = YES ] \
  || fail "explicit SSH hardening acknowledgement is required"
case "${1:-}:$#" in stage:3|finalize:2) ;; \
  *) fail "usage: install-ssh-hardening.sh stage ROOT_OWNED_NEW_PUBLIC_KEY ROOT_OWNED_EXPECTATIONS | finalize ROOT_OWNED_EXPECTATIONS" ;;
esac
PHASE=$1
if [ "$PHASE" = stage ]; then NEW_PUBLIC_KEY=$2; EXPECTATIONS=$3; else EXPECTATIONS=$2; fi
case "$EXPECTATIONS:${NEW_PUBLIC_KEY:-/root/placeholder}" in /*:/*) ;; *) fail "SSH evidence paths must be absolute" ;; esac
umask 077

# Caller-supplied paths are only locators. Freeze their bytes once through
# O_NOFOLLOW descriptors into a root-private generation before parsing,
# hashing, or invoking ssh-keygen so a writable ancestor cannot create a
# check/use race. Stage also proves the key and expectations are independent
# inodes before either snapshot is accepted.
INPUT_SNAPSHOT_DIR="$(mktemp -d /run/resume-ai-ssh-inputs.XXXXXX)"
cleanup_input_snapshot() {
  local status=$?
  trap - EXIT
  case "$INPUT_SNAPSHOT_DIR" in /run/resume-ai-ssh-inputs.??????) ;; *) exit "$status" ;; esac
  if [ -d "$INPUT_SNAPSHOT_DIR" ] && [ ! -L "$INPUT_SNAPSHOT_DIR" ]; then
    find "$INPUT_SNAPSHOT_DIR" -xdev -depth -delete >/dev/null 2>&1 || true
  fi
  exit "$status"
}
trap cleanup_input_snapshot EXIT
snapshot_arguments=("$EXPECTATIONS" "$INPUT_SNAPSHOT_DIR/expectations")
if [ "$PHASE" = stage ]; then
  snapshot_arguments+=("$NEW_PUBLIC_KEY" "$INPUT_SNAPSHOT_DIR/new-public-key")
fi
python3 -I - "${snapshot_arguments[@]}" <<'PY' \
  || fail "SSH evidence could not be frozen into one stable root snapshot"
import os
import pathlib
import stat
import sys

arguments = sys.argv[1:]
if not arguments or len(arguments) % 2:
    raise SystemExit(2)

def identity(value):
    return (value.st_dev, value.st_ino, value.st_mode, value.st_uid,
            value.st_gid, value.st_nlink, value.st_size,
            value.st_mtime_ns, value.st_ctime_ns)

opened_sources = set()
for source_name, destination_name in zip(arguments[::2], arguments[1::2], strict=True):
    source = pathlib.Path(source_name)
    before = source.lstat()
    if (not stat.S_ISREG(before.st_mode) or stat.S_IMODE(before.st_mode) != 0o400
            or before.st_uid != 0 or before.st_gid != 0 or before.st_nlink != 1
            or before.st_size > 1024 * 1024):
        raise SystemExit(2)
    source_identity = (before.st_dev, before.st_ino)
    if source_identity in opened_sources:
        raise SystemExit(2)
    opened_sources.add(source_identity)
    descriptor = os.open(source, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        opened = os.fstat(descriptor)
        if identity(opened) != identity(before):
            raise SystemExit(2)
        chunks = []
        total = 0
        while True:
            chunk = os.read(descriptor, 65536)
            if not chunk:
                break
            total += len(chunk)
            if total > 1024 * 1024:
                raise SystemExit(2)
            chunks.append(chunk)
        if (identity(os.fstat(descriptor)) != identity(opened)
                or identity(source.lstat()) != identity(before)):
            raise SystemExit(2)
    finally:
        os.close(descriptor)

    destination = pathlib.Path(destination_name)
    output = os.open(
        destination,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
        0o400,
    )
    try:
        for chunk in chunks:
            view = memoryview(chunk)
            while view:
                written = os.write(output, view)
                if written <= 0:
                    raise SystemExit(2)
                view = view[written:]
        os.fchmod(output, 0o400)
        os.fchown(output, 0, 0)
        os.fsync(output)
    finally:
        os.close(output)
directory = os.open(pathlib.Path(arguments[1]).parent, os.O_RDONLY | os.O_DIRECTORY)
try:
    os.fsync(directory)
finally:
    os.close(directory)
PY
EXPECTATIONS="$INPUT_SNAPSHOT_DIR/expectations"
if [ "$PHASE" = stage ]; then NEW_PUBLIC_KEY="$INPUT_SNAPSHOT_DIR/new-public-key"; fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
if [ "$SCRIPT_DIR" = /usr/local/lib/resume-ai ]; then
  ACTIVE_RELEASE_ROOT="$(readlink -e /opt/resume-ai/current)" \
    || fail "active release is unavailable to the installed SSH entrypoint"
  case "$ACTIVE_RELEASE_ROOT" in /opt/resume-ai/releases/20??????T??????Z) ;; \
    *) fail "active release path is outside the fixed managed tree" ;; esac
  OPS_DIR="$ACTIVE_RELEASE_ROOT/ops"
else
  OPS_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
fi
. "$SCRIPT_DIR/open-root-lock.sh"
open_root_lock 8 deploy
open_root_lock 9 ssh-rotation
for required_command in sshd ssh-keygen sha256sum systemctl; do
  command -v "$required_command" >/dev/null 2>&1 || fail "$required_command is unavailable"
done

assert_external_file() {
  local path=$1 label=$2
  [ -f "$path" ] && [ ! -L "$path" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$path")" = root:root:400:1 ] \
    || fail "$label must be one root-owned mode-0400 file"
}
assert_external_file "$EXPECTATIONS" "SSH expectation evidence"
declare -A expected=()
while IFS='=' read -r key value || [ -n "$key" ]; do
  case "$key" in SCHEMA_VERSION|USER_KEY_FINGERPRINT|HOST_ED25519_FINGERPRINT|ISSUED_AT) ;; *) fail "unknown SSH expectation key" ;; esac
  [ -z "${expected[$key]:-}" ] && [ -n "$value" ] || fail "duplicate or empty SSH expectation"
  expected[$key]=$value
done < "$EXPECTATIONS"
[ "${expected[SCHEMA_VERSION]:-}" = 1 ] \
  && [[ "${expected[USER_KEY_FINGERPRINT]:-}" =~ ^SHA256:[A-Za-z0-9+/]+$ ]] \
  && [[ "${expected[HOST_ED25519_FINGERPRINT]:-}" =~ ^SHA256:[A-Za-z0-9+/]+$ ]] \
  && [[ "${expected[ISSUED_AT]:-}" =~ ^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] \
  || fail "SSH expectation evidence is malformed"
EXPECTATION_SHA256="$(sha256sum "$EXPECTATIONS" | awk '{print $1}')"
HOST_KEY_PUBLIC=/etc/ssh/ssh_host_ed25519_key.pub
[ -f "$HOST_KEY_PUBLIC" ] && [ ! -L "$HOST_KEY_PUBLIC" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$HOST_KEY_PUBLIC")" = root:root:644:1 ] \
  || fail "server Ed25519 host key is missing or unsafe"
HOST_KEY_FINGERPRINT="$(ssh-keygen -E sha256 -lf "$HOST_KEY_PUBLIC" \
  | awk 'NR == 1 { print $2 } END { if (NR != 1) exit 2 }')" \
  || fail "server Ed25519 host fingerprint cannot be derived"
[ "$HOST_KEY_FINGERPRINT" = "${expected[HOST_ED25519_FINGERPRINT]}" ] \
  || fail "server host key differs from the externally supplied fingerprint"

TARGET=/etc/ssh/sshd_config.d/00-resume-ai-hardening.conf
KEY_ROOT=/etc/ssh/authorized_keys
AUTHORIZED_KEYS="$KEY_ROOT/ubuntu"
STAGED_KEY="$KEY_ROOT/ubuntu.next"
PENDING=/etc/resume-ai/ssh-key-rotation.pending
KEY_EVIDENCE=/etc/resume-ai/approved-ssh-user-key.env
EXPECTATION_COPY=/etc/resume-ai/approved-ssh-expectations.env
install -d -o root -g root -m 0755 "$KEY_ROOT"

install_hardening_config() {
  local temporary
  temporary="$(mktemp /etc/ssh/sshd_config.d/.resume-ai-hardening.XXXXXX)"
  install -o root -g root -m 0644 "$OPS_DIR/ssh/00-resume-ai-hardening.conf" "$temporary"
  sync -f "$temporary"
  mv -f -- "$temporary" "$TARGET"
  sync -f /etc/ssh/sshd_config.d
  sshd -t
  "$OPS_DIR/bin/assert-ssh-effective-policy.sh" >/dev/null
  systemctl reload ssh
}

if [ "$PHASE" = stage ]; then
  [ ! -e "$PENDING" ] && [ ! -L "$PENDING" ] \
    || fail "an earlier SSH key rotation requires finalization"
  assert_external_file "$NEW_PUBLIC_KEY" "new SSH public key"
  awk '
    /\r/ || /^[[:space:]]*(#.*)?$/ { bad = 1; next }
    $1 != "ssh-ed25519" || NF < 2 || keys { bad = 1; next }
    { keys += 1 }
    END { exit !bad && keys == 1 ? 0 : 1 }
  ' "$NEW_PUBLIC_KEY" || fail "new SSH key must be exactly one plain Ed25519 authorization"
  NEW_KEY_FINGERPRINT="$(ssh-keygen -E sha256 -lf "$NEW_PUBLIC_KEY" \
    | awk 'NR == 1 { print $2 } END { if (NR != 1) exit 2 }')" \
    || fail "new SSH key fingerprint cannot be derived"
  [ "$NEW_KEY_FINGERPRINT" = "${expected[USER_KEY_FINGERPRINT]}" ] \
    || fail "new SSH key differs from the externally supplied fingerprint"

  current_source=/home/ubuntu/.ssh/authorized_keys
  if [ -e "$AUTHORIZED_KEYS" ] || [ -L "$AUTHORIZED_KEYS" ]; then current_source=$AUTHORIZED_KEYS; fi
  staged_authorized="$(mktemp "$KEY_ROOT/.ubuntu.staged.XXXXXX")"
  python3 -I - "$current_source" "$staged_authorized" <<'PY' \
    || fail "current SSH authorizations are outside the bounded rotation contract"
import os
import pathlib
import stat
import sys

source = pathlib.Path(sys.argv[1])
before = source.lstat()
if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_size > 1024 * 1024:
    raise SystemExit(2)
flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
descriptor = os.open(source, flags)
try:
    opened = os.fstat(descriptor)
    identity = lambda value: (value.st_dev, value.st_ino, value.st_mode, value.st_nlink, value.st_size, value.st_mtime_ns, value.st_ctime_ns)
    if identity(opened) != identity(before):
        raise SystemExit(2)
    raw = b""
    while True:
        chunk = os.read(descriptor, 65536)
        if not chunk:
            break
        raw += chunk
        if len(raw) > 1024 * 1024:
            raise SystemExit(2)
    if identity(os.fstat(descriptor)) != identity(opened) or identity(source.lstat()) != identity(before):
        raise SystemExit(2)
finally:
    os.close(descriptor)
text = raw.decode("utf-8", errors="strict")
if "\r" in text:
    raise SystemExit(2)
seen = set()
output = []
for line in text.splitlines():
    if not line.strip() or line.lstrip().startswith("#"):
        continue
    fields = line.split()
    if len(fields) < 2 or fields[0] not in {"ssh-ed25519", "ssh-rsa"}:
        raise SystemExit(2)
    identity_key = (fields[0], fields[1])
    if identity_key in seen:
        raise SystemExit(2)
    seen.add(identity_key)
    output.append(line)
if not 1 <= len(output) <= 4:
    raise SystemExit(2)
pathlib.Path(sys.argv[2]).write_text("\n".join(output) + "\n", encoding="utf-8")
PY
  new_identity="$(awk '{print $1 " " $2}' "$NEW_PUBLIC_KEY")"
  if ! awk -v expected="$new_identity" '$1 " " $2 == expected { found = 1 } END { exit found ? 0 : 1 }' \
    "$staged_authorized"; then
    cat "$NEW_PUBLIC_KEY" >> "$staged_authorized"
  fi
  [ "$(awk '/^[[:space:]]*(#.*)?$/ { next } { count += 1 } END { print count + 0 }' \
    "$staged_authorized")" -le 5 ] || fail "staged SSH authorization set exceeds its bound"
  chown root:root "$staged_authorized"
  chmod 0600 "$staged_authorized"
  sync -f "$staged_authorized"
  mv -f -- "$staged_authorized" "$AUTHORIZED_KEYS"
  install -o root -g root -m 0400 "$NEW_PUBLIC_KEY" "$STAGED_KEY"
  install -o root -g root -m 0400 "$EXPECTATIONS" "$EXPECTATION_COPY"
  sync -f "$AUTHORIZED_KEYS"
  sync -f "$STAGED_KEY"
  sync -f "$EXPECTATION_COPY"
  sync -f "$KEY_ROOT"
  # Publish and reload the root-owned authorization path before committing the
  # staged marker. If reload fails, the old daemon keeps its prior policy and a
  # retry can safely reconstruct this same bounded old+new key set.
  install_hardening_config
  pending_temp="$(mktemp /etc/resume-ai/.ssh-key-rotation.XXXXXX)"
  cat > "$pending_temp" <<EOF
SCHEMA_VERSION=1
PHASE=staged
USER_KEY_FINGERPRINT=$NEW_KEY_FINGERPRINT
HOST_ED25519_FINGERPRINT=$HOST_KEY_FINGERPRINT
EXPECTATION_SHA256=$EXPECTATION_SHA256
STAGED_KEY_SHA256=$(sha256sum "$STAGED_KEY" | awk '{print $1}')
STAGED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF
  chown root:root "$pending_temp"
  chmod 0600 "$pending_temp"
  sync -f "$pending_temp"
  mv -f -- "$pending_temp" "$PENDING"
  sync -f /etc/resume-ai
  printf '%s\n' "Staged root-owned SSH authorizations. Verify a new login, then run finalize."
  exit 0
fi

[ "${ACK_NEW_SSH_LOGIN_VERIFIED:-}" = YES ] \
  || fail "finalization requires a separately verified new SSH login"
[ "${VERIFIED_NEW_SSH_SESSION_FINGERPRINT:-}" = "${expected[USER_KEY_FINGERPRINT]}" ] \
  || fail "verified session fingerprint does not match the external expectation"
[ -f "$PENDING" ] && [ ! -L "$PENDING" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$PENDING")" = root:root:600:1 ] \
  || fail "staged SSH rotation evidence is missing or unsafe"
for staged_control in "$STAGED_KEY" "$EXPECTATION_COPY"; do
  [ -f "$staged_control" ] && [ ! -L "$staged_control" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$staged_control")" = root:root:400:1 ] \
    || fail "staged SSH control is missing or unsafe"
done
[ "$(sha256sum "$EXPECTATION_COPY" | awk '{print $1}')" = "$EXPECTATION_SHA256" ] \
  || fail "external SSH expectation changed after staging"
grep -Fxq "USER_KEY_FINGERPRINT=${expected[USER_KEY_FINGERPRINT]}" "$PENDING" \
  && grep -Fxq "HOST_ED25519_FINGERPRINT=$HOST_KEY_FINGERPRINT" "$PENDING" \
  && grep -Fxq "EXPECTATION_SHA256=$EXPECTATION_SHA256" "$PENDING" \
  && grep -Fxq "STAGED_KEY_SHA256=$(sha256sum "$STAGED_KEY" | awk '{print $1}')" "$PENDING" \
  || fail "SSH finalization inputs differ from the staged transaction"

final_temp="$(mktemp "$KEY_ROOT/.ubuntu.final.XXXXXX")"
install -o root -g root -m 0600 "$STAGED_KEY" "$final_temp"
sync -f "$final_temp"
mv -f -- "$final_temp" "$AUTHORIZED_KEYS"
sync -f "$AUTHORIZED_KEYS"
sync -f "$KEY_ROOT"
home_key=/home/ubuntu/.ssh/authorized_keys
if [ -e "$home_key" ] || [ -L "$home_key" ]; then
  [ -f "$home_key" ] && [ ! -L "$home_key" ] && [ "$(stat -c '%h' "$home_key")" = 1 ] \
    || fail "legacy home authorization path is unsafe"
  empty_temp="$(mktemp /home/ubuntu/.ssh/.authorized_keys.disabled.XXXXXX)"
  chown root:root "$empty_temp"
  chmod 0600 "$empty_temp"
  sync -f "$empty_temp"
  mv -f -- "$empty_temp" "$home_key"
  sync -f /home/ubuntu/.ssh
fi
install_hardening_config

evidence_temp="$(mktemp /etc/resume-ai/.approved-ssh-user-key.XXXXXX)"
cat > "$evidence_temp" <<EOF
SCHEMA_VERSION=2
LOGIN_USER=ubuntu
AUTHORIZED_KEYS_PATH=$AUTHORIZED_KEYS
KEY_TYPE=ssh-ed25519
AUTHORIZED_KEYS_SHA256=$(sha256sum "$AUTHORIZED_KEYS" | awk '{print $1}')
KEY_FINGERPRINT=${expected[USER_KEY_FINGERPRINT]}
HOST_ED25519_FINGERPRINT=$HOST_KEY_FINGERPRINT
EXPECTATION_SHA256=$EXPECTATION_SHA256
VERIFIED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
LEGACY_KEYS_REMOVED=YES
HOME_AUTHORIZED_KEYS_DISABLED=YES
EOF
chown root:root "$evidence_temp"
chmod 0600 "$evidence_temp"
sync -f "$evidence_temp"
mv -f -- "$evidence_temp" "$KEY_EVIDENCE"
sync -f "$KEY_EVIDENCE"
unlink "$STAGED_KEY"
unlink "$PENDING"
sync -f "$KEY_ROOT"
sync -f /etc/resume-ai
printf '%s\n' "Finalized the externally pinned Ed25519 key and revoked every legacy authorization."
