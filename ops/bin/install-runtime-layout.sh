#!/usr/bin/env bash
set -euo pipefail
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH

fail() {
  printf '%s\n' "ERROR: $*" >&2
  exit 1
}

[ "${EUID:-$(id -u)}" -eq 0 ] || fail "run as root"
[ "${ACK_INSTALL_RUNTIME_LAYOUT:-}" = "YES" ] \
  || fail "set ACK_INSTALL_RUNTIME_LAYOUT=YES after the pre-change backup exists"

BOOTSTRAP_COPIER=/usr/local/lib/resume-ai/create-bootstrap-generation.py
SELF_PATH="$(readlink -e -- "${BASH_SOURCE[0]}")" \
  || fail "runtime-layout installer path cannot be resolved"
if [ "${RUNTIME_LAYOUT_SNAPSHOT_EXEC:-}" = 1 ]; then
  [[ "$SELF_PATH" =~ ^/opt/resume-ai/runtime-layout-generations/generation-[a-f0-9]{64}/ops/bin/install-runtime-layout\.sh$ ]] \
    || fail "runtime-layout re-exec is outside its protected internal snapshot"
  BOOTSTRAP_GENERATION=${RESUME_AI_BOOTSTRAP_GENERATION:-}
  BOOTSTRAP_MANIFEST_SHA256=${RESUME_AI_BOOTSTRAP_MANIFEST_SHA256:-}
  [ "$BOOTSTRAP_GENERATION" \
      = "/var/lib/resume-ai/bootstrap-generations/generation-$BOOTSTRAP_MANIFEST_SHA256" ] \
    || fail "runtime-layout re-exec lacks its original bootstrap generation"
else
  [[ "$SELF_PATH" =~ ^(/var/lib/resume-ai/bootstrap-generations/generation-([a-f0-9]{64}))/ops/bin/install-runtime-layout\.sh$ ]] \
    || fail "runtime layout must execute from the independently pinned bootstrap generation"
  BOOTSTRAP_GENERATION=${BASH_REMATCH[1]}
  BOOTSTRAP_MANIFEST_SHA256=${BASH_REMATCH[2]}
fi
[ -f "$BOOTSTRAP_COPIER" ] && [ ! -L "$BOOTSTRAP_COPIER" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$BOOTSTRAP_COPIER")" = root:root:555:1 ] \
  || fail "fixed bootstrap generation verifier is missing or unsafe"
bootstrap_identity="$(/usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin \
  /usr/bin/python3 -I "$BOOTSTRAP_COPIER" verify \
  "$BOOTSTRAP_GENERATION" "$BOOTSTRAP_MANIFEST_SHA256")" \
  || fail "bootstrap generation failed its fixed verifier"
IFS=$'\t' read -r verified_generation verified_manifest RUNTIME_LAYOUT_STARTED_AT \
  verified_copier <<< "$bootstrap_identity"
[ "$verified_generation:$verified_manifest" \
    = "$BOOTSTRAP_GENERATION:$BOOTSTRAP_MANIFEST_SHA256" ] \
  && [[ "$RUNTIME_LAYOUT_STARTED_AT" =~ ^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] \
  && [[ "$verified_copier" =~ ^[a-f0-9]{64}$ ]] \
  || fail "bootstrap verifier returned a malformed identity"

SCRIPT_DIR="$(cd -- "$(dirname -- "$SELF_PATH")" && pwd -P)"
CANDIDATE_SOURCE_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd -P)"
BOOTSTRAP_BIN="$BOOTSTRAP_GENERATION/ops/bin"

HOST_BASELINE_DIR=${HOST_BASELINE_DIR:-}
HOST_BASELINE_MANIFEST_SHA256=${HOST_BASELINE_MANIFEST_SHA256:-}
baseline_identity="$(/usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin \
  /usr/bin/python3 -I "$BOOTSTRAP_BIN/verify-host-baseline.py" \
  "$HOST_BASELINE_DIR" "$HOST_BASELINE_MANIFEST_SHA256" \
  "$BOOTSTRAP_GENERATION" "$BOOTSTRAP_MANIFEST_SHA256")" \
  || fail "protected pre-change host baseline failed verification"
IFS=$'\t' read -r verified_baseline_manifest INITIAL_SNAPSHOT_RELEASE_ID \
  INITIAL_SNAPSHOT_EVIDENCE INITIAL_SNAPSHOT_ID INITIAL_SNAPSHOT_EVIDENCE_SHA256 \
  baseline_bootstrap_started <<< "$baseline_identity"
[ "$verified_baseline_manifest:$baseline_bootstrap_started" \
    = "$HOST_BASELINE_MANIFEST_SHA256:$RUNTIME_LAYOUT_STARTED_AT" ] \
  || fail "host baseline belongs to another bootstrap transaction"
/usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin \
  /usr/bin/python3 -I "$BOOTSTRAP_BIN/record-cloud-snapshot-evidence.py" \
  --verify-initial-pre-bootstrap "$INITIAL_SNAPSHOT_EVIDENCE" \
  "$INITIAL_SNAPSHOT_RELEASE_ID" >/dev/null \
  || fail "host baseline initial snapshot failed its global identity gate"

command -v useradd >/dev/null 2>&1 || fail "useradd is unavailable"
command -v systemctl >/dev/null 2>&1 || fail "systemctl is unavailable"
command -v openssl >/dev/null 2>&1 || fail "openssl is unavailable"
command -v flock >/dev/null 2>&1 || fail "flock is unavailable"
[ -x /opt/nodejs/current/bin/node ] && [ -x /opt/nodejs/current/bin/pm2 ] \
  && [ -x /opt/nodejs/current/bin/pnpm ] \
  || fail "install the frozen Node 24/PM2/pnpm runtime before the application layout"
[ "$(/usr/bin/env -i PATH=/opt/nodejs/current/bin:/usr/bin:/bin \
  /opt/nodejs/current/bin/node --version)" = v24.20.0 ] \
  || fail "the approved Node 24.20.0 runtime is not active"

# The pre-snapshot trust base is deliberately embedded.  Never source or
# execute a candidate-workspace helper before its exact bytes have been copied
# into a durable, root-private generation.
open_bootstrap_lock() {
  local lock_fd=$1 lock_name=$2
  local lock_root=/run/resume-ai-locks lock_path
  [[ "$lock_fd" =~ ^[3-9]$ ]] || fail "invalid bootstrap lock descriptor"
  [[ "$lock_name" =~ ^[a-z0-9][a-z0-9-]{0,62}$ ]] \
    || fail "invalid bootstrap lock name"
  umask 077
  if [ ! -e "$lock_root" ] && [ ! -L "$lock_root" ]; then
    install -d -o root -g root -m 0700 "$lock_root"
  fi
  [ -d "$lock_root" ] && [ ! -L "$lock_root" ] \
    && [ "$(readlink -e -- "$lock_root")" = "$lock_root" ] \
    && [ "$(stat -c '%U:%G:%a' "$lock_root")" = root:root:700 ] \
    || fail "private bootstrap lock directory is unsafe"
  lock_path="$lock_root/$lock_name.lock"
  if [ ! -e "$lock_path" ] && [ ! -L "$lock_path" ]; then
    install -o root -g root -m 0600 /dev/null "$lock_path"
  fi
  [ -f "$lock_path" ] && [ ! -L "$lock_path" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$lock_path")" = root:root:600:1 ] \
    || fail "private bootstrap lock file is unsafe: $lock_name"
  # The containing directory is root:root 0700, so no unprivileged process can
  # replace the verified lock inode between this check and the open.
  eval "exec ${lock_fd}<>\"${lock_path}\""
  flock -n "$lock_fd" || fail "another $lock_name operation is running"
}
open_bootstrap_lock 9 deploy
open_bootstrap_lock 8 control-plane

RUNTIME_LAYOUT_PENDING=/opt/resume-ai/state/runtime-layout.pending
RUNTIME_LAYOUT_COMPLETE=/etc/resume-ai/runtime-layout-bootstrap.env
RUNTIME_LAYOUT_GENERATIONS=/opt/resume-ai/runtime-layout-generations
EVIDENCE_GENERATIONS=/var/lib/resume-ai/release-evidence-generations
if { [ -e /opt/resume-ai/state/active.env ] || [ -L /opt/resume-ai/state/active.env ]; } \
  || { [ -e /opt/resume-ai/current ] || [ -L /opt/resume-ai/current ]; } \
  || { [ -e /etc/resume-ai/control-plane-generation.env ] || [ -L /etc/resume-ai/control-plane-generation.env ]; }; then
  fail "runtime layout is bootstrap-only; an active host must use release/control generation transactions"
fi
if { [ -e "$RUNTIME_LAYOUT_COMPLETE" ] || [ -L "$RUNTIME_LAYOUT_COMPLETE" ]; } \
  && { [ ! -e "$RUNTIME_LAYOUT_PENDING" ] && [ ! -L "$RUNTIME_LAYOUT_PENDING" ]; }; then
  fail "runtime layout bootstrap is already complete"
fi

# `useradd --create-home` and every later `install -d` follow directory links.
# Reject all pre-existing linked ancestors before even account provisioning can
# create or repair a home below them.
reject_linked_ancestry() {
  local requested=$1 current= component
  local -a components=()
  case "$requested" in /*) ;; *) fail "runtime directory must be absolute" ;; esac
  IFS='/' read -r -a components <<< "${requested#/}"
  current=/
  for component in "${components[@]}"; do
    [ -n "$component" ] || continue
    current="${current%/}/$component"
    if [ -e "$current" ] || [ -L "$current" ]; then
      [ -d "$current" ] && [ ! -L "$current" ] \
        || fail "runtime directory ancestry is linked or non-directory: $current"
    else
      break
    fi
  done
}
for planned_directory in \
  /opt/resume-ai /opt/resume-ai/releases /opt/resume-ai/build-staging \
  /opt/resume-ai/verify-staging /opt/resume-ai/adoption-staging \
  /opt/resume-ai/approval-staging /opt/resume-ai/deploy-inputs \
  /opt/resume-ai/release-artifacts /opt/resume-ai/runtime-layout-generations \
  /opt/resume-ai/state \
  /var/lib/resume-ai /var/lib/resume-ai/.pm2 \
  /var/lib/resume-ai/release-evidence-generations /var/lib/resume-ai-build \
  /var/lib/resume-ai-verify /var/lib/resume-ai-pgtest /var/lib/resume-ai-dbverify \
  /var/lib/resume-ai/security /var/lib/resume-ai/security/cloud-snapshots \
  /var/lib/resume-ai/security/cloud-snapshots/by-snapshot-id \
  /var/log/resume-ai /var/cache/resume-ai /var/backups/resume-ai \
  /etc/resume-ai /etc/resume-ai/approved-releases \
  /usr/local/lib/resume-ai /usr/local/share/resume-ai /run/resume-ai-locks; do
  reject_linked_ancestry "$planned_directory"
done

# Create only the root-owned transaction parents before account provisioning;
# every externally usable service/unit is published later under this receipt.
install -d -o root -g root -m 0755 /opt/resume-ai
install -d -o root -g root -m 0700 /opt/resume-ai/state
install -d -o root -g root -m 0700 "$RUNTIME_LAYOUT_GENERATIONS"
install -d -o root -g root -m 0750 /etc/resume-ai

run_runtime_layout_snapshot_tcb() {
  /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin /usr/bin/python3 -I - "$@" <<'PY_RUNTIME_LAYOUT_SNAPSHOT_TCB'
import errno
import datetime
import hashlib
import os
import pathlib
import re
import stat
import sys
import uuid

MAX_FILE_BYTES = 64 * 1024 * 1024
MANIFEST_NAME = "runtime-layout-snapshot.manifest"
MANIFEST_HEADER = "RUNTIME_LAYOUT_SNAPSHOT_MANIFEST_V1\n"
EXPLICIT_INPUTS = (
    "ops/config/control-plane-files.conf",
    "ops/bin/install-runtime-layout.sh",
    "ops/bin/open-root-lock.sh",
    "ops/bin/verify-control-plane-generation.py",
    "ops/bin/install-control-plane-generation.sh",
    "ops/bin/recover-control-plane-generation.sh",
    "ops/generated/quota-generation.env",
    "ops/generated/application-quota.env",
    "ops/generated/00-resume-ai-global.conf",
    "ops/generated/nginx-quota.inc",
    "ops/generated/nginx-track-quota.inc",
    "ops/config/app.env.example",
)
HEX64 = re.compile(r"[a-f0-9]{64}")
MODE = re.compile(r"0[45-7][0-7]{2}")
GENERATION = re.compile(r"generation-([a-f0-9]{64})")
EXPECTED_UID = None
EXPECTED_GID = None


def die(message):
    raise SystemExit(message)


def fsync_directory(fd):
    os.fsync(fd)


def exact_relative(text):
    if not text or "\x00" in text or "\t" in text or "\n" in text:
        die("runtime-layout source member is malformed")
    pure = pathlib.PurePosixPath(text)
    if pure.is_absolute() or text != pure.as_posix() or any(
        part in ("", ".", "..") for part in pure.parts
    ):
        die(f"runtime-layout source member is not canonical: {text}")
    return pure.parts


def stable_read(fd, label):
    before = os.fstat(fd)
    if (
        not stat.S_ISREG(before.st_mode)
        or before.st_nlink != 1
        or before.st_uid != EXPECTED_UID
        or before.st_mode & 0o022
        or before.st_size > MAX_FILE_BYTES
    ):
        die(f"unsafe runtime-layout source file: {label}")
    chunks = []
    total = 0
    os.lseek(fd, 0, os.SEEK_SET)
    while True:
        chunk = os.read(fd, min(1024 * 1024, MAX_FILE_BYTES + 1 - total))
        if not chunk:
            break
        chunks.append(chunk)
        total += len(chunk)
        if total > MAX_FILE_BYTES:
            die(f"runtime-layout source file is too large: {label}")
    after = os.fstat(fd)
    identity = lambda item: (
        item.st_dev, item.st_ino, item.st_mode, item.st_uid, item.st_gid,
        item.st_nlink, item.st_size, item.st_mtime_ns, item.st_ctime_ns,
    )
    if identity(before) != identity(after) or total != before.st_size:
        die(f"runtime-layout source changed while read: {label}")
    return b"".join(chunks), identity(after)


class RootFrozenTree:
    def __init__(self, absolute_root):
        root_text = os.path.normpath(absolute_root)
        if not os.path.isabs(root_text) or root_text != absolute_root or root_text == "/":
            die("runtime-layout source root must be a canonical absolute directory")
        flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
        current = os.open("/", flags)
        try:
            self._verify_directory(current, "/")
            traversed = ""
            for component in pathlib.PurePosixPath(root_text).parts[1:]:
                traversed += "/" + component
                child = os.open(component, flags, dir_fd=current)
                self._verify_directory(child, traversed)
                os.close(current)
                current = child
            self.root_fd = current
            self._directory_cache = {(): os.dup(current)}
        except BaseException:
            os.close(current)
            raise
        self._fds = [current]

    @staticmethod
    def _verify_directory(fd, label):
        metadata = os.fstat(fd)
        if (
            not stat.S_ISDIR(metadata.st_mode)
            or metadata.st_uid not in (0, EXPECTED_UID)
            or metadata.st_mode & 0o022
        ):
            die(f"runtime-layout source directory is not root-frozen: {label}")

    def directory_fd(self, parts):
        parts = tuple(parts)
        if parts in self._directory_cache:
            return self._directory_cache[parts]
        parent = self.directory_fd(parts[:-1])
        flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
        child = os.open(parts[-1], flags, dir_fd=parent)
        self._verify_directory(child, "/".join(parts))
        self._directory_cache[parts] = child
        return child

    def read(self, relative):
        parts = exact_relative(relative)
        parent = self.directory_fd(parts[:-1])
        fd = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC,
                     dir_fd=parent)
        try:
            return stable_read(fd, relative)
        finally:
            os.close(fd)

    def close(self):
        seen = set()
        for fd in list(self._directory_cache.values()) + self._fds:
            if fd not in seen:
                seen.add(fd)
                os.close(fd)


def parse_control_spec(raw):
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as error:
        die(f"runtime-layout control specification is not UTF-8: {error}")
    records = []
    sources = set()
    targets = set()
    for line in text.splitlines():
        if not line or line.startswith("#"):
            continue
        fields = line.split("\t")
        if len(fields) != 3 or MODE.fullmatch(fields[0]) is None:
            die("malformed runtime-layout control specification")
        mode, relative, target = fields
        exact_relative(relative)
        if (
            not target.startswith("/")
            or os.path.normpath(target) != target
            or target == "/"
            or relative in sources
            or target in targets
        ):
            die("duplicate or non-canonical runtime-layout control record")
        sources.add(relative)
        targets.add(target)
        records.append((mode, relative, target))
    if not records:
        die("runtime-layout control specification is empty")
    return records


def collect_source(tree):
    spec_raw, spec_identity = tree.read("ops/config/control-plane-files.conf")
    records = parse_control_spec(spec_raw)
    members = set(EXPLICIT_INPUTS)
    members.update(relative for _, relative, _ in records)
    captured = {}
    for relative in sorted(members):
        data, identity = tree.read(relative)
        captured[relative] = (data, identity)
    if captured["ops/config/control-plane-files.conf"] != (spec_raw, spec_identity):
        die("runtime-layout control specification drifted during snapshot")
    # Re-read every pinned-dirfd member after the full pass.  This rejects a
    # cross-file mixed generation as well as in-place source drift.
    for relative, (data, identity) in captured.items():
        repeated, repeated_identity = tree.read(relative)
        if repeated != data or repeated_identity != identity:
            die(f"runtime-layout source drifted during snapshot: {relative}")
    return captured


def safe_directory(path, allowed_modes, label):
    metadata = os.lstat(path)
    if (
        not stat.S_ISDIR(metadata.st_mode)
        or stat.S_ISLNK(metadata.st_mode)
        or metadata.st_uid != EXPECTED_UID
        or metadata.st_gid != EXPECTED_GID
        or stat.S_IMODE(metadata.st_mode) not in allowed_modes
    ):
        die(f"unsafe {label}: {path}")
    return os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)


def write_all(fd, data):
    view = memoryview(data)
    while view:
        written = os.write(fd, view)
        if written <= 0:
            die("short write while creating runtime-layout snapshot")
        view = view[written:]


def discard_completed_staging(parent_fd, name):
    root_fd = os.open(
        name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
        dir_fd=parent_fd,
    )

    def discard_directory(directory_fd):
        for entry in list(os.scandir(directory_fd)):
            metadata = entry.stat(follow_symlinks=False)
            if entry.is_symlink():
                die("refusing to discard a linked runtime-layout staging member")
            if stat.S_ISDIR(metadata.st_mode):
                if (
                    metadata.st_uid != EXPECTED_UID
                    or metadata.st_gid != EXPECTED_GID
                    or stat.S_IMODE(metadata.st_mode) != 0o700
                ):
                    die("refusing to discard an unsafe runtime-layout staging directory")
                child = os.open(
                    entry.name,
                    os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
                    dir_fd=directory_fd,
                )
                try:
                    discard_directory(child)
                finally:
                    os.close(child)
                os.rmdir(entry.name, dir_fd=directory_fd)
            elif stat.S_ISREG(metadata.st_mode):
                if (
                    metadata.st_uid != EXPECTED_UID
                    or metadata.st_gid != EXPECTED_GID
                    or metadata.st_nlink != 1
                    or stat.S_IMODE(metadata.st_mode) not in (0o400, 0o500)
                ):
                    die("refusing to discard an unsafe runtime-layout staging file")
                os.unlink(entry.name, dir_fd=directory_fd)
            else:
                die("refusing to discard a special runtime-layout staging member")
        os.fsync(directory_fd)

    try:
        root_metadata = os.fstat(root_fd)
        if (
            root_metadata.st_uid != EXPECTED_UID
            or root_metadata.st_gid != EXPECTED_GID
            or stat.S_IMODE(root_metadata.st_mode) != 0o700
        ):
            die("refusing to discard an unsafe runtime-layout staging root")
        discard_directory(root_fd)
    finally:
        os.close(root_fd)
    os.rmdir(name, dir_fd=parent_fd)
    os.fsync(parent_fd)


def make_snapshot(generations_root, captured):
    parent_fd = safe_directory(generations_root, {0o700}, "snapshot generation root")
    staging = ".staging-" + str(uuid.uuid4())
    os.mkdir(staging, 0o700, dir_fd=parent_fd)
    staging_fd = os.open(staging, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
                         dir_fd=parent_fd)
    directory_fds = {(): staging_fd}
    try:
        manifest_records = []
        for relative, (data, _) in sorted(captured.items()):
            parts = exact_relative(relative)
            current_parts = ()
            current_fd = staging_fd
            for component in parts[:-1]:
                next_parts = current_parts + (component,)
                if next_parts not in directory_fds:
                    try:
                        os.mkdir(component, 0o700, dir_fd=current_fd)
                    except FileExistsError:
                        pass
                    child_fd = os.open(
                        component,
                        os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
                        dir_fd=current_fd,
                    )
                    directory_fds[next_parts] = child_fd
                current_parts = next_parts
                current_fd = directory_fds[current_parts]
            original_mode = stat.S_IMODE(captured[relative][1][2])
            snapshot_mode = 0o500 if original_mode & 0o111 else 0o400
            fd = os.open(
                parts[-1],
                os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
                0o600,
                dir_fd=current_fd,
            )
            try:
                write_all(fd, data)
                os.fchmod(fd, snapshot_mode)
                os.fsync(fd)
            finally:
                os.close(fd)
            manifest_records.append(
                f"FILE\t{snapshot_mode:04o}\t{len(data)}\t"
                f"{hashlib.sha256(data).hexdigest()}\t{relative}\n"
            )
        manifest = (MANIFEST_HEADER + "".join(manifest_records)).encode("utf-8")
        manifest_hash = hashlib.sha256(manifest).hexdigest()
        fd = os.open(
            MANIFEST_NAME,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
            0o600,
            dir_fd=staging_fd,
        )
        try:
            write_all(fd, manifest)
            os.fchmod(fd, 0o400)
            os.fsync(fd)
        finally:
            os.close(fd)
        for fd_value in reversed(list(directory_fds.values())):
            fsync_directory(fd_value)
        final_name = "generation-" + manifest_hash
        try:
            os.rename(staging, final_name, src_dir_fd=parent_fd, dst_dir_fd=parent_fd)
            fsync_directory(parent_fd)
        except OSError as error:
            if error.errno not in (errno.EEXIST, errno.ENOTEMPTY):
                raise
            existing_path = os.path.join(generations_root, final_name)
            # A crash may have durably renamed the exact generation immediately
            # before publishing pending.  Reuse only after full manifest and
            # inventory validation; discard only our completed private staging.
            verify_snapshot(existing_path, manifest_hash)
            discard_completed_staging(parent_fd, staging)
        return os.path.join(generations_root, final_name), manifest_hash, captured[
            "ops/config/control-plane-files.conf"
        ][0]
    finally:
        for parts, fd_value in list(directory_fds.items())[::-1]:
            try:
                os.close(fd_value)
            except OSError:
                pass
        os.close(parent_fd)


def read_snapshot_file(root_fd, relative, expected_mode):
    parts = exact_relative(relative)
    current = os.dup(root_fd)
    try:
        for component in parts[:-1]:
            child = os.open(
                component,
                os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
                dir_fd=current,
            )
            os.close(current)
            current = child
            metadata = os.fstat(current)
            if metadata.st_uid != EXPECTED_UID or metadata.st_gid != EXPECTED_GID or stat.S_IMODE(metadata.st_mode) != 0o700:
                die(f"unsafe runtime-layout snapshot directory: {relative}")
        fd = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=current)
        try:
            metadata = os.fstat(fd)
            if (
                not stat.S_ISREG(metadata.st_mode)
                or metadata.st_uid != EXPECTED_UID
                or metadata.st_gid != EXPECTED_GID
                or metadata.st_nlink != 1
                or stat.S_IMODE(metadata.st_mode) != expected_mode
            ):
                die(f"unsafe runtime-layout snapshot member: {relative}")
            data, _ = stable_snapshot_read(fd, relative)
            return data
        finally:
            os.close(fd)
    finally:
        os.close(current)


def stable_snapshot_read(fd, label):
    before = os.fstat(fd)
    os.lseek(fd, 0, os.SEEK_SET)
    chunks = []
    while True:
        chunk = os.read(fd, 1024 * 1024)
        if not chunk:
            break
        chunks.append(chunk)
    after = os.fstat(fd)
    if (
        before.st_dev, before.st_ino, before.st_mode, before.st_uid, before.st_gid,
        before.st_nlink, before.st_size, before.st_mtime_ns, before.st_ctime_ns
    ) != (
        after.st_dev, after.st_ino, after.st_mode, after.st_uid, after.st_gid,
        after.st_nlink, after.st_size, after.st_mtime_ns, after.st_ctime_ns
    ):
        die(f"runtime-layout snapshot member changed while read: {label}")
    return b"".join(chunks), after


def verify_snapshot(snapshot_path, generation_hash):
    if os.path.basename(snapshot_path) != "generation-" + generation_hash:
        die("runtime-layout pending generation path is not content-addressed")
    root_fd = safe_directory(snapshot_path, {0o700}, "runtime-layout snapshot")
    try:
        manifest = read_snapshot_file(root_fd, MANIFEST_NAME, 0o400)
        if hashlib.sha256(manifest).hexdigest() != generation_hash:
            die("runtime-layout snapshot manifest hash differs from its generation")
        try:
            text = manifest.decode("utf-8")
        except UnicodeDecodeError:
            die("runtime-layout snapshot manifest is not UTF-8")
        lines = text.splitlines()
        if not lines or lines[0] != MANIFEST_HEADER.rstrip("\n"):
            die("runtime-layout snapshot manifest header is invalid")
        expected_files = {MANIFEST_NAME}
        observed_records = set()
        for line in lines[1:]:
            fields = line.split("\t")
            if (
                len(fields) != 5
                or fields[0] != "FILE"
                or fields[1] not in ("0400", "0500")
                or not fields[2].isdigit()
                or HEX64.fullmatch(fields[3]) is None
            ):
                die("runtime-layout snapshot manifest record is malformed")
            _, mode_text, size_text, digest, relative = fields
            exact_relative(relative)
            if relative in observed_records:
                die("runtime-layout snapshot manifest contains a duplicate")
            observed_records.add(relative)
            expected_files.add(relative)
            data = read_snapshot_file(root_fd, relative, int(mode_text, 8))
            if len(data) != int(size_text) or hashlib.sha256(data).hexdigest() != digest:
                die(f"runtime-layout snapshot member differs from manifest: {relative}")
        if not set(EXPLICIT_INPUTS).issubset(observed_records):
            die("runtime-layout snapshot omits an explicit bootstrap input")
        spec = read_snapshot_file(root_fd, "ops/config/control-plane-files.conf", 0o400)
        expected_sources = {relative for _, relative, _ in parse_control_spec(spec)}
        if not expected_sources.issubset(observed_records):
            die("runtime-layout snapshot omits an allowlisted control source")
        observed_files = set()
        stack = [((), os.dup(root_fd))]
        while stack:
            prefix, directory_fd = stack.pop()
            try:
                for entry in os.scandir(directory_fd):
                    relative = "/".join(prefix + (entry.name,))
                    metadata = entry.stat(follow_symlinks=False)
                    if entry.is_symlink():
                        die(f"runtime-layout snapshot contains a link: {relative}")
                    if stat.S_ISDIR(metadata.st_mode):
                        if metadata.st_uid != EXPECTED_UID or metadata.st_gid != EXPECTED_GID or stat.S_IMODE(metadata.st_mode) != 0o700:
                            die(f"unsafe runtime-layout snapshot directory: {relative}")
                        child = os.open(
                            entry.name,
                            os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
                            dir_fd=directory_fd,
                        )
                        stack.append((prefix + (entry.name,), child))
                    elif stat.S_ISREG(metadata.st_mode):
                        observed_files.add(relative)
                    else:
                        die(f"runtime-layout snapshot contains a special file: {relative}")
            finally:
                os.close(directory_fd)
        if observed_files != expected_files:
            die("runtime-layout snapshot inventory differs from its exact manifest")
        return hashlib.sha256(spec).hexdigest()
    finally:
        os.close(root_fd)


def load_pending(pending_path):
    metadata = os.lstat(pending_path)
    if (
        not stat.S_ISREG(metadata.st_mode)
        or stat.S_ISLNK(metadata.st_mode)
        or metadata.st_uid != EXPECTED_UID
        or metadata.st_gid != EXPECTED_GID
        or metadata.st_nlink != 1
        or stat.S_IMODE(metadata.st_mode) != 0o600
    ):
        die("runtime-layout pending receipt is unsafe")
    fd = os.open(pending_path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        raw, _ = stable_snapshot_read(fd, "pending receipt")
    finally:
        os.close(fd)
    try:
        lines = raw.decode("utf-8").splitlines()
    except UnicodeDecodeError:
        die("runtime-layout pending receipt is not UTF-8")
    if len(lines) != 11:
        die("runtime-layout pending receipt has unexpected fields")
    values = {}
    for line in lines:
        if line.count("=") != 1:
            die("runtime-layout pending receipt is malformed")
        key, value = line.split("=", 1)
        if key in values:
            die("runtime-layout pending receipt contains a duplicate")
        values[key] = value
    if set(values) != {
        "SCHEMA_VERSION", "PHASE", "SOURCE_GENERATION_SHA256",
        "GENERATION_PATH", "MANIFEST_SHA256", "CONTROL_SPEC_SHA256", "STARTED_AT",
        "BOOTSTRAP_GENERATION", "BOOTSTRAP_MANIFEST_SHA256",
        "HOST_BASELINE_DIR", "HOST_BASELINE_MANIFEST_SHA256",
    } or values["SCHEMA_VERSION"] != "5" or values["PHASE"] != "installing":
        die("runtime-layout pending receipt schema is invalid")
    try:
        started = datetime.datetime.strptime(
            values["STARTED_AT"], "%Y-%m-%dT%H:%M:%SZ"
        ).replace(tzinfo=datetime.timezone.utc)
    except ValueError:
        die("runtime-layout pending receipt start time is invalid")
    if started > datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=5):
        die("runtime-layout pending receipt start time is in the future")
    bootstrap_hash = values["BOOTSTRAP_MANIFEST_SHA256"]
    if (HEX64.fullmatch(bootstrap_hash) is None
            or values["BOOTSTRAP_GENERATION"]
            != f"/var/lib/resume-ai/bootstrap-generations/generation-{bootstrap_hash}"):
        die("runtime-layout pending receipt bootstrap identity is invalid")
    if (re.fullmatch(r"/var/backups/resume-ai/prechange/20\d{6}T\d{6}Z",
                     values["HOST_BASELINE_DIR"]) is None
            or HEX64.fullmatch(values["HOST_BASELINE_MANIFEST_SHA256"]) is None):
        die("runtime-layout pending receipt host baseline identity is invalid")
    generation_hash = values["SOURCE_GENERATION_SHA256"]
    if (
        HEX64.fullmatch(generation_hash) is None
        or values["MANIFEST_SHA256"] != generation_hash
        or HEX64.fullmatch(values["CONTROL_SPEC_SHA256"]) is None
    ):
        die("runtime-layout pending receipt hashes are invalid")
    return values


def publish_pending(
    pending_path, snapshot_path, generation_hash, spec_hash, started_at,
    bootstrap_generation, bootstrap_manifest, baseline_dir, baseline_manifest,
):
    state_directory = os.path.dirname(pending_path)
    state_fd = safe_directory(state_directory, {0o700, 0o750}, "runtime-layout state directory")
    temporary = ".runtime-layout-pending-" + str(uuid.uuid4())
    payload = (
        "SCHEMA_VERSION=5\n"
        "PHASE=installing\n"
        f"STARTED_AT={started_at}\n"
        f"BOOTSTRAP_GENERATION={bootstrap_generation}\n"
        f"BOOTSTRAP_MANIFEST_SHA256={bootstrap_manifest}\n"
        f"HOST_BASELINE_DIR={baseline_dir}\n"
        f"HOST_BASELINE_MANIFEST_SHA256={baseline_manifest}\n"
        f"SOURCE_GENERATION_SHA256={generation_hash}\n"
        f"GENERATION_PATH={snapshot_path}\n"
        f"MANIFEST_SHA256={generation_hash}\n"
        f"CONTROL_SPEC_SHA256={spec_hash}\n"
    ).encode("utf-8")
    try:
        fd = os.open(
            temporary,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
            0o600,
            dir_fd=state_fd,
        )
        try:
            write_all(fd, payload)
            os.fchmod(fd, 0o600)
            os.fsync(fd)
        finally:
            os.close(fd)
        if os.path.lexists(pending_path):
            die("runtime-layout pending receipt appeared during snapshot publication")
        # The state directory is root-owned and non-writable outside root, and
        # both bootstrap locks are held.  One atomic rename avoids the nlink=2
        # crash window inherent in link+unlink publication.
        os.rename(temporary, os.path.basename(pending_path),
                  src_dir_fd=state_fd, dst_dir_fd=state_fd)
        fsync_directory(state_fd)
    finally:
        os.close(state_fd)


def validate_pending(pending_path, generations_root, expected_snapshot=None):
    values = load_pending(pending_path)
    snapshot_path = values["GENERATION_PATH"]
    generation_hash = values["SOURCE_GENERATION_SHA256"]
    if os.path.dirname(snapshot_path) != generations_root:
        die("runtime-layout pending receipt points outside the generation root")
    if expected_snapshot is not None and snapshot_path != expected_snapshot:
        die("executing bootstrap is not the pending snapshotted generation")
    spec_hash = verify_snapshot(snapshot_path, generation_hash)
    if spec_hash != values["CONTROL_SPEC_SHA256"]:
        die("runtime-layout snapshotted control specification differs from pending")
    return (
        snapshot_path, generation_hash, spec_hash, values["STARTED_AT"],
        values["BOOTSTRAP_GENERATION"], values["BOOTSTRAP_MANIFEST_SHA256"],
        values["HOST_BASELINE_DIR"], values["HOST_BASELINE_MANIFEST_SHA256"],
    )


def main():
    global EXPECTED_UID, EXPECTED_GID
    if len(sys.argv) != 12:
        die("runtime-layout snapshot TCB usage is invalid")
    action, pending_path, generations_root = sys.argv[1:4]
    try:
        EXPECTED_UID = int(sys.argv[5])
        EXPECTED_GID = int(sys.argv[6])
    except ValueError:
        die("runtime-layout snapshot TCB owner identity is invalid")
    if EXPECTED_UID < 0 or EXPECTED_GID < 0:
        die("runtime-layout snapshot TCB owner identity is invalid")
    if action == "create":
        source_root = sys.argv[4]
        if os.path.lexists(pending_path):
            die("runtime-layout pending receipt already exists")
        tree = RootFrozenTree(source_root)
        try:
            captured = collect_source(tree)
        finally:
            tree.close()
        snapshot_path, generation_hash, spec = make_snapshot(generations_root, captured)
        spec_hash = hashlib.sha256(spec).hexdigest()
        verify_snapshot(snapshot_path, generation_hash)
        started_at = sys.argv[7]
        try:
            started = datetime.datetime.strptime(
                started_at, "%Y-%m-%dT%H:%M:%SZ"
            ).replace(tzinfo=datetime.timezone.utc)
        except ValueError:
            die("runtime-layout bootstrap start time is invalid")
        if started > datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=5):
            die("runtime-layout bootstrap start time is in the future")
        publish_pending(
            pending_path, snapshot_path, generation_hash, spec_hash, started_at,
            sys.argv[8], sys.argv[9], sys.argv[10], sys.argv[11],
        )
    elif action == "validate":
        expected = None if sys.argv[4] == "-" else sys.argv[4]
        (snapshot_path, generation_hash, spec_hash, started_at,
         pending_bootstrap_generation, pending_bootstrap_manifest,
         pending_baseline_dir, pending_baseline_manifest) = validate_pending(
            pending_path, generations_root, expected
        )
        if (pending_bootstrap_generation != sys.argv[8]
                or pending_bootstrap_manifest != sys.argv[9]
                or pending_baseline_dir != sys.argv[10]
                or pending_baseline_manifest != sys.argv[11]):
            die("runtime-layout pending receipt belongs to another bootstrap generation")
    else:
        die("runtime-layout snapshot TCB action is invalid")
    print(f"{snapshot_path}\t{generation_hash}\t{spec_hash}\t{started_at}")


if __name__ == "__main__":
    main()
PY_RUNTIME_LAYOUT_SNAPSHOT_TCB
}

if [ "${RUNTIME_LAYOUT_SNAPSHOT_EXEC:-}" = 1 ]; then
  snapshot_tcb_result="$(run_runtime_layout_snapshot_tcb validate \
    "$RUNTIME_LAYOUT_PENDING" "$RUNTIME_LAYOUT_GENERATIONS" \
    "$CANDIDATE_SOURCE_ROOT" 0 0 - \
    "$BOOTSTRAP_GENERATION" "$BOOTSTRAP_MANIFEST_SHA256" \
    "$HOST_BASELINE_DIR" "$HOST_BASELINE_MANIFEST_SHA256")" \
    || fail "cannot validate pending runtime-layout snapshot"
else
  if [ -e "$RUNTIME_LAYOUT_PENDING" ] || [ -L "$RUNTIME_LAYOUT_PENDING" ]; then
    snapshot_tcb_result="$(run_runtime_layout_snapshot_tcb validate \
      "$RUNTIME_LAYOUT_PENDING" "$RUNTIME_LAYOUT_GENERATIONS" - 0 0 - \
      "$BOOTSTRAP_GENERATION" "$BOOTSTRAP_MANIFEST_SHA256" \
      "$HOST_BASELINE_DIR" "$HOST_BASELINE_MANIFEST_SHA256")" \
      || fail "cannot resume the pending runtime-layout snapshot"
  else
    snapshot_tcb_result="$(run_runtime_layout_snapshot_tcb create \
      "$RUNTIME_LAYOUT_PENDING" "$RUNTIME_LAYOUT_GENERATIONS" \
      "$CANDIDATE_SOURCE_ROOT" 0 0 "$RUNTIME_LAYOUT_STARTED_AT" \
      "$BOOTSTRAP_GENERATION" "$BOOTSTRAP_MANIFEST_SHA256" \
      "$HOST_BASELINE_DIR" "$HOST_BASELINE_MANIFEST_SHA256")" \
      || fail "cannot create the runtime-layout source snapshot"
  fi
  SNAPSHOT_ROOT=${snapshot_tcb_result%%$'\t'*}
  [ -n "$SNAPSHOT_ROOT" ] || fail "runtime-layout snapshot TCB returned no path"
  exec 8>&-
  exec 9>&-
  reexec_environment=(
    /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin
    ACK_INSTALL_RUNTIME_LAYOUT=YES RUNTIME_LAYOUT_SNAPSHOT_EXEC=1
    RESUME_AI_BOOTSTRAP_GENERATION="$BOOTSTRAP_GENERATION"
    RESUME_AI_BOOTSTRAP_MANIFEST_SHA256="$BOOTSTRAP_MANIFEST_SHA256"
    HOST_BASELINE_DIR="$HOST_BASELINE_DIR"
    HOST_BASELINE_MANIFEST_SHA256="$HOST_BASELINE_MANIFEST_SHA256"
  )
  if [ "${ACK_CONTROL_PLANE_TRUST_ANCHOR_UPGRADE:-}" = YES ]; then
    reexec_environment+=(ACK_CONTROL_PLANE_TRUST_ANCHOR_UPGRADE=YES)
  fi
  if [ "${ACK_ADOPT_EXISTING_EVIDENCE_SIGNING_KEY:-}" = YES ]; then
    reexec_environment+=(ACK_ADOPT_EXISTING_EVIDENCE_SIGNING_KEY=YES)
  fi
  exec "${reexec_environment[@]}" \
    "$SNAPSHOT_ROOT/ops/bin/install-runtime-layout.sh"
fi

IFS=$'\t' read -r SNAPSHOT_ROOT RUNTIME_LAYOUT_SOURCE_GENERATION \
  RUNTIME_LAYOUT_CONTROL_SPEC_SHA256 RUNTIME_LAYOUT_STARTED_AT \
  <<< "$snapshot_tcb_result"
[[ "$SNAPSHOT_ROOT" = "$RUNTIME_LAYOUT_GENERATIONS"/generation-* ]] \
  && [[ "$RUNTIME_LAYOUT_SOURCE_GENERATION" =~ ^[a-f0-9]{64}$ ]] \
  && [[ "$RUNTIME_LAYOUT_CONTROL_SPEC_SHA256" =~ ^[a-f0-9]{64}$ ]] \
  && [[ "$RUNTIME_LAYOUT_STARTED_AT" =~ ^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] \
  || fail "runtime-layout snapshot TCB returned malformed state"
OPS_DIR="$SNAPSHOT_ROOT/ops"

for conflicting_transaction in \
  /opt/resume-ai/state/deploy.pending \
  /opt/resume-ai/state/control-plane.pending; do
  [ ! -e "$conflicting_transaction" ] && [ ! -L "$conflicting_transaction" ] \
    || fail "runtime-layout bootstrap refuses an existing release/control transaction"
done

ensure_service_account() {
  local account=$1
  local home_dir=$2
  local comment=$3
  local account_uid account_gid group_gid supplementary_group
  if ! getent group "$account" >/dev/null 2>&1; then groupadd --system "$account"; fi
  group_gid="$(getent group "$account" | cut -d: -f3)"
  [[ "$group_gid" =~ ^[1-9][0-9]*$ ]] \
    || fail "$account primary group is root-equivalent or malformed"
  if ! id "$account" >/dev/null 2>&1; then
    useradd --system --gid "$account" --home-dir "$home_dir" \
      --create-home --shell /usr/sbin/nologin --comment "$comment" "$account"
  else
    account_uid="$(id -u "$account")"
    [[ "$account_uid" =~ ^[1-9][0-9]*$ ]] \
      || fail "$account is root-equivalent or malformed"
    usermod --gid "$account" --home "$home_dir" --shell /usr/sbin/nologin "$account"
  fi
  # Remove every supplementary membership, including an unnecessary explicit
  # member entry in the same-named primary group. A denylist cannot cover local
  # daemon sockets such as libvirt/incus/custom operator groups.
  for supplementary_group in $(id -nG "$account"); do
    [ "$supplementary_group" = "$account" ] && continue
    gpasswd -d "$account" "$supplementary_group" >/dev/null \
      || fail "cannot remove $account from supplementary group $supplementary_group"
  done
  gpasswd -d "$account" "$account" >/dev/null 2>&1 || true

  account_uid="$(id -u "$account")"
  account_gid="$(id -g "$account")"
  IFS=: read -r passwd_name _ passwd_uid passwd_gid _ passwd_home passwd_shell < <(
    getent passwd "$account"
  )
  [ "$passwd_name:$passwd_uid:$passwd_gid:$passwd_home:$passwd_shell" \
      = "$account:$account_uid:$account_gid:$home_dir:/usr/sbin/nologin" ] \
    && [[ "$account_uid" =~ ^[1-9][0-9]*$ ]] \
    && [[ "$account_gid" =~ ^[1-9][0-9]*$ ]] \
    && [ "$(id -gn "$account")" = "$account" ] \
    && [ "$(id -G "$account")" = "$account_gid" ] \
    && [ -z "$(getent group "$account" | cut -d: -f4)" ] \
    || fail "$account is not an exact dedicated non-login identity"
}

ensure_service_account resume-ai /var/lib/resume-ai "Resume AI runtime"
ensure_service_account resume-ai-build /var/lib/resume-ai-build "Resume AI isolated builder"
ensure_service_account resume-ai-verify /var/lib/resume-ai-verify "Resume AI one-shot verifier"
ensure_service_account resume-ai-pgtest /var/lib/resume-ai-pgtest "Resume AI disposable PostgreSQL"
ensure_service_account resume-ai-dbverify /var/lib/resume-ai-dbverify "Resume AI read-only database verifier"

install -d -o root -g root -m 0755 /opt/resume-ai
install -d -o root -g resume-ai -m 0750 /opt/resume-ai/releases
install -d -o root -g resume-ai-build -m 0750 /opt/resume-ai/build-staging
install -d -o root -g resume-ai-verify -m 0750 /opt/resume-ai/verify-staging
install -d -o root -g root -m 0700 /opt/resume-ai/adoption-staging
install -d -o root -g root -m 0700 /opt/resume-ai/approval-staging
install -d -o root -g root -m 0700 /opt/resume-ai/deploy-inputs
install -d -o root -g root -m 0700 /opt/resume-ai/release-artifacts
install -d -o root -g resume-ai -m 0750 /opt/resume-ai/state
install -d -o root -g root -m 0755 /var/lib/resume-ai
install -d -o root -g root -m 0700 "$EVIDENCE_GENERATIONS"
install -d -o resume-ai -g resume-ai -m 0750 /var/lib/resume-ai/.pm2
install -d -o root -g root -m 0555 /var/lib/resume-ai-build
install -d -o root -g root -m 0555 /var/lib/resume-ai-verify
install -d -o resume-ai-pgtest -g resume-ai-pgtest -m 0700 /var/lib/resume-ai-pgtest
install -d -o root -g root -m 0555 /var/lib/resume-ai-dbverify
install -d -o resume-ai -g resume-ai -m 0750 /var/log/resume-ai
install -d -o root -g resume-ai -m 0750 /var/cache/resume-ai
install -d -o root -g root -m 0700 /var/backups/resume-ai
install -d -o root -g root -m 0700 /var/lib/resume-ai/security
install -d -o root -g root -m 0700 /var/lib/resume-ai/security/cloud-snapshots
install -d -o root -g root -m 0700 /var/lib/resume-ai/security/cloud-snapshots/by-snapshot-id
install -d -o root -g resume-ai -m 0750 /etc/resume-ai
install -d -o root -g root -m 0700 /etc/resume-ai/approved-releases
install -d -o root -g root -m 0755 /usr/local/lib/resume-ai
install -d -o root -g root -m 0755 /usr/local/share/resume-ai
install -d -o root -g root -m 0700 /run/resume-ai-locks

# Abort before publishing any privileged byte if an existing filesystem link
# redirects a managed directory. `install -d` follows directory symlinks.
for managed_directory in \
  /opt/resume-ai /opt/resume-ai/releases /opt/resume-ai/release-artifacts \
  /opt/resume-ai/runtime-layout-generations \
  /opt/resume-ai/adoption-staging /opt/resume-ai/approval-staging \
  /opt/resume-ai/deploy-inputs /opt/resume-ai/state /var/backups/resume-ai \
  /var/lib/resume-ai /var/lib/resume-ai/release-evidence-generations \
  /var/lib/resume-ai/security /var/lib/resume-ai/security/cloud-snapshots \
  /var/lib/resume-ai/security/cloud-snapshots/by-snapshot-id \
  /etc/resume-ai /usr/local/lib/resume-ai /usr/local/share/resume-ai \
  /run/resume-ai-locks; do
  [ "$(readlink -e -- "$managed_directory")" = "$managed_directory" ] \
    || fail "managed runtime directory traverses a symbolic link: $managed_directory"
done
[ "$(stat -c '%U:%G:%a' /var/lib/resume-ai)" = root:root:755 ] \
  || fail "/var/lib/resume-ai must be a root-owned container, not the app home"
[ "$(readlink -e -- "$EVIDENCE_GENERATIONS")" = "$EVIDENCE_GENERATIONS" ] \
  && [ "$(stat -c '%U:%G:%a' "$EVIDENCE_GENERATIONS")" = root:root:700 ] \
  || fail "release-evidence generation root must be root:root 0700"
[ "$(readlink -e -- /var/lib/resume-ai/security/cloud-snapshots/by-snapshot-id)" \
    = /var/lib/resume-ai/security/cloud-snapshots/by-snapshot-id ] \
  && [ "$(stat -c '%U:%G:%a' /var/lib/resume-ai/security/cloud-snapshots/by-snapshot-id)" \
    = root:root:700 ] \
  || fail "global snapshot identity registry must be root:root 0700"
for scratch_root in /opt/resume-ai/approval-staging /opt/resume-ai/deploy-inputs; do
  [ "$(stat -c '%U:%G:%a' "$scratch_root")" = root:root:700 ] \
    || fail "privileged scratch root is not root:root 0700: $scratch_root"
done

# The Linux validation attestation key is a persistent host trust anchor, not
# a release input.  Publish it only when absent, never repair/replace an unsafe
# existing inode, and require the stored public key to be the exact derivation
# of the private PKCS#8 key on every bootstrap/resume.
publish_new_key_artifact() {
  local temporary=$1 destination=$2 expected_mode=$3
  /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin /usr/bin/python3 -I - \
    "$temporary" "$destination" "$expected_mode" 0 0 <<'PY_KEY_PUBLISH'
import ctypes
import errno
import os
import stat
import sys

source, destination, mode_text, uid_text, gid_text = sys.argv[1:]
expected_mode = int(mode_text, 8)
expected_uid = int(uid_text)
expected_gid = int(gid_text)
source_metadata = os.lstat(source)
if (
    not stat.S_ISREG(source_metadata.st_mode)
    or stat.S_ISLNK(source_metadata.st_mode)
    or source_metadata.st_uid != expected_uid
    or source_metadata.st_gid != expected_gid
    or source_metadata.st_nlink != 1
    or stat.S_IMODE(source_metadata.st_mode) != expected_mode
):
    raise SystemExit("new release-evidence key artifact is unsafe")
if os.path.lexists(destination):
    raise SystemExit("release-evidence key artifact already exists; refusing overwrite")
directory = os.path.dirname(destination)
directory_metadata = os.lstat(directory)
if (
    not stat.S_ISDIR(directory_metadata.st_mode)
    or stat.S_ISLNK(directory_metadata.st_mode)
    or directory_metadata.st_uid not in (0, expected_uid)
    or directory_metadata.st_mode & 0o022
):
    raise SystemExit("release-evidence key directory is unsafe")
with open(source, "rb", buffering=0) as stream:
    os.fsync(stream.fileno())
libc = ctypes.CDLL(None, use_errno=True)
renameat2 = getattr(libc, "renameat2", None)
if renameat2 is None:
    raise SystemExit("renameat2 is required for no-overwrite key publication")
renameat2.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
renameat2.restype = ctypes.c_int
if renameat2(-100, os.fsencode(source), -100, os.fsencode(destination), 1) != 0:
    error = ctypes.get_errno()
    if error == errno.EEXIST:
        raise SystemExit("release-evidence key artifact appeared; refusing overwrite")
    raise OSError(error, os.strerror(error), destination)
directory_fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
try:
    os.fsync(directory_fd)
finally:
    os.close(directory_fd)
PY_KEY_PUBLISH
}

assert_key_artifact() {
  local path=$1 mode=$2 label=$3
  [ -f "$path" ] && [ ! -L "$path" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$path")" = "root:root:$mode:1" ] \
    || fail "$label is unsafe (expected root:root $mode, one ordinary link)"
}

signing_private_temp=
signing_public_temp=
signing_pending_temp=
signing_marker_temp=
cleanup_validated_release_evidence_key_temp() {
  local expected_directory=$1 expected_user=$2 expected_group=$3 temporary=$4
  local base directory_metadata metadata directory_mode
  [ -n "$temporary" ] || return 0
  if [[ ! "$expected_user" =~ ^[a-z_][a-z0-9_-]*$ ]] \
    || [[ ! "$expected_group" =~ ^[a-z_][a-z0-9_-]*$ ]]; then
    printf '%s\n' "ERROR: refusing key cleanup for malformed owner identity" >&2
    return 0
  fi
  base=${temporary##*/}
  if [ "${temporary%/*}" != "$expected_directory" ] \
    || [[ ! "$base" =~ ^\.release-evidence-signing\.(key|pub|pending|env)\.[[:alnum:]]{6}$ ]]; then
    printf '%s\n' "ERROR: refusing to clean unexpected key temp path: $temporary" >&2
    return 0
  fi
  if [ ! -d "$expected_directory" ] || [ -L "$expected_directory" ] \
    || [ "$(readlink -e -- "$expected_directory" 2>/dev/null || true)" != "$expected_directory" ]; then
    printf '%s\n' "ERROR: refusing key cleanup through unsafe directory: $expected_directory" >&2
    return 0
  fi
  directory_metadata="$(stat -c '%U:%a' "$expected_directory" 2>/dev/null || true)"
  if [[ ! "$directory_metadata" =~ ^${expected_user}:([0-7]+)$ ]]; then
    printf '%s\n' "ERROR: refusing key cleanup through mismatched directory: $expected_directory" >&2
    return 0
  fi
  directory_mode=${BASH_REMATCH[1]}
  if (( (8#$directory_mode & 8#022) != 0 )); then
    printf '%s\n' "ERROR: refusing key cleanup through writable directory: $expected_directory" >&2
    return 0
  fi
  if [ -e "$temporary" ] || [ -L "$temporary" ]; then
    if [ -f "$temporary" ] && [ ! -L "$temporary" ]; then
      metadata="$(stat -c '%U:%G:%a:%h' "$temporary" 2>/dev/null || true)"
      case "$metadata" in
        "$expected_user:$expected_group:600:1"|"$expected_user:$expected_group:644:1")
          unlink -- "$temporary"
          ;;
        *) printf '%s\n' "ERROR: refusing to clean unsafe key temp inode: $temporary" >&2 ;;
      esac
    else
      printf '%s\n' "ERROR: refusing to clean linked/non-file key temp: $temporary" >&2
    fi
  fi
}
cleanup_release_evidence_key_temps() {
  local temporary
  for temporary in "$signing_private_temp" "$signing_public_temp" \
    "$signing_pending_temp" "$signing_marker_temp"; do
    cleanup_validated_release_evidence_key_temp /etc/resume-ai root root "$temporary"
  done
}

cleanup_orphaned_release_evidence_key_temps() {
  local orphan_root=${1:-/etc/resume-ai}
  local directory_user=${2:-root} directory_group=${3:-resume-ai}
  local file_user=${4:-root} file_group=${5:-root}
  local temporary base expected_mode metadata cleaned=0
  local -a orphaned=()
  [ -d "$orphan_root" ] && [ ! -L "$orphan_root" ] \
    && [ "$(readlink -e -- "$orphan_root")" = "$orphan_root" ] \
    && [ "$(stat -c '%U:%G:%a' "$orphan_root")" = "$directory_user:$directory_group:750" ] \
    || fail "release-evidence orphan cleanup root is unsafe"
  shopt -s nullglob
  orphaned=("$orphan_root"/.release-evidence-signing.{key,pub,pending,env}.??????)
  shopt -u nullglob
  for temporary in "${orphaned[@]}"; do
    base=${temporary##*/}
    case "$base" in
      .release-evidence-signing.key.??????|.release-evidence-signing.pending.??????|.release-evidence-signing.env.??????)
        expected_mode=600
        ;;
      .release-evidence-signing.pub.??????)
        expected_mode=644
        ;;
      *) fail "unexpected release-evidence orphan basename: $temporary" ;;
    esac
    [[ "$base" =~ ^\.release-evidence-signing\.(key|pub|pending|env)\.[[:alnum:]]{6}$ ]] \
      || fail "release-evidence orphan basename is malformed: $temporary"
    [ -f "$temporary" ] && [ ! -L "$temporary" ] \
      && [ "$(readlink -e -- "$temporary")" = "$temporary" ] \
      || fail "release-evidence orphan is linked or not an ordinary file: $temporary"
    metadata="$(stat -c '%U:%G:%a:%h' "$temporary")"
    [ "$metadata" = "$file_user:$file_group:$expected_mode:1" ] \
      || fail "release-evidence orphan has unsafe metadata: $temporary"
    unlink -- "$temporary"
    cleaned=1
  done
  [ "$cleaned" -eq 0 ] || sync -f "$orphan_root"
}
trap cleanup_release_evidence_key_temps EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

EVIDENCE_SIGNING_PRIVATE_KEY=/etc/resume-ai/release-evidence-signing.key
EVIDENCE_SIGNING_PUBLIC_KEY=/etc/resume-ai/release-evidence-signing.pub
EVIDENCE_SIGNING_PENDING=/etc/resume-ai/release-evidence-signing.pending
EVIDENCE_SIGNING_MARKER=/etc/resume-ai/release-evidence-signing.env

validate_evidence_private_key() {
  assert_key_artifact "$EVIDENCE_SIGNING_PRIVATE_KEY" 600 \
    "release-evidence Ed25519 private key"
  [ "$(head -n 1 "$EVIDENCE_SIGNING_PRIVATE_KEY")" = '-----BEGIN PRIVATE KEY-----' ] \
    || fail "release-evidence private key is not unencrypted PKCS#8 PEM"
  /usr/bin/env -i PATH=/usr/bin:/bin /usr/bin/openssl pkey \
    -in "$EVIDENCE_SIGNING_PRIVATE_KEY" -check -noout >/dev/null \
    || fail "release-evidence private key is invalid"
  /usr/bin/env -i PATH=/usr/bin:/bin /usr/bin/openssl pkey \
    -in "$EVIDENCE_SIGNING_PRIVATE_KEY" -text -noout \
    | grep -Fq 'ED25519 Private-Key:' \
    || fail "release-evidence private key is not Ed25519"
}

derive_evidence_public_key() {
  local private_path=$1 output_path=$2
  /usr/bin/env -i PATH=/usr/bin:/bin /usr/bin/openssl pkey \
    -in "$private_path" -pubout -out "$output_path"
  chown root:root "$output_path"
  chmod 0644 "$output_path"
}

publish_evidence_key_journal() {
  local phase=$1 private_sha=$2 public_sha=$3
  [[ "$phase" =~ ^(publishing|adopting-existing)$ ]] \
    && [[ "$private_sha" =~ ^[a-f0-9]{64}$ ]] \
    && [[ "$public_sha" =~ ^[a-f0-9]{64}$ ]] \
    || fail "release-evidence key publication journal input is malformed"
  [ ! -e "$EVIDENCE_SIGNING_PENDING" ] && [ ! -L "$EVIDENCE_SIGNING_PENDING" ] \
    || fail "release-evidence key publication journal unexpectedly exists"
  signing_pending_temp="$(mktemp /etc/resume-ai/.release-evidence-signing.pending.XXXXXX)"
  {
    printf '%s\n' 'SCHEMA_VERSION=1'
    printf 'PHASE=%s\n' "$phase"
    printf 'PRIVATE_SHA256=%s\n' "$private_sha"
    printf 'PUBLIC_SHA256=%s\n' "$public_sha"
  } > "$signing_pending_temp"
  chown root:root "$signing_pending_temp"
  chmod 0600 "$signing_pending_temp"
  sync -f "$signing_pending_temp"
  publish_new_key_artifact "$signing_pending_temp" "$EVIDENCE_SIGNING_PENDING" 0600
  signing_pending_temp=
}

begin_evidence_key_transaction() {
  local private_sha public_sha
  signing_private_temp="$(mktemp /etc/resume-ai/.release-evidence-signing.key.XXXXXX)"
  /usr/bin/env -i PATH=/usr/bin:/bin /usr/bin/openssl genpkey \
    -algorithm ED25519 -out "$signing_private_temp"
  chown root:root "$signing_private_temp"
  chmod 0600 "$signing_private_temp"
  [ "$(head -n 1 "$signing_private_temp")" = '-----BEGIN PRIVATE KEY-----' ] \
    || fail "generated release-evidence key is not unencrypted PKCS#8 PEM"
  /usr/bin/env -i PATH=/usr/bin:/bin /usr/bin/openssl pkey \
    -in "$signing_private_temp" -check -noout >/dev/null \
    || fail "generated release-evidence Ed25519 key is invalid"
  /usr/bin/env -i PATH=/usr/bin:/bin /usr/bin/openssl pkey \
    -in "$signing_private_temp" -text -noout \
    | grep -Fq 'ED25519 Private-Key:' \
    || fail "generated release-evidence key is not Ed25519"
  signing_public_temp="$(mktemp /etc/resume-ai/.release-evidence-signing.pub.XXXXXX)"
  derive_evidence_public_key "$signing_private_temp" "$signing_public_temp"
  private_sha="$(sha256sum "$signing_private_temp" | awk '{print $1}')"
  public_sha="$(sha256sum "$signing_public_temp" | awk '{print $1}')"
  [[ "$private_sha" =~ ^[a-f0-9]{64}$ ]] && [[ "$public_sha" =~ ^[a-f0-9]{64}$ ]] \
    || fail "generated release-evidence key hashes are malformed"
  publish_evidence_key_journal publishing "$private_sha" "$public_sha"
}

load_evidence_key_transaction() {
  local -a journal_rows=()
  [ -f "$EVIDENCE_SIGNING_PENDING" ] && [ ! -L "$EVIDENCE_SIGNING_PENDING" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$EVIDENCE_SIGNING_PENDING")" = root:root:600:1 ] \
    || fail "release-evidence key publication journal is unsafe"
  mapfile -t journal_rows < "$EVIDENCE_SIGNING_PENDING"
  [ "${#journal_rows[@]}" -eq 4 ] \
    && [ "${journal_rows[0]}" = 'SCHEMA_VERSION=1' ] \
    && [[ "${journal_rows[1]}" =~ ^PHASE=(publishing|adopting-existing)$ ]] \
    && [[ "${journal_rows[2]}" =~ ^PRIVATE_SHA256=([a-f0-9]{64})$ ]] \
    || fail "release-evidence key publication journal schema is invalid"
  EVIDENCE_KEY_JOURNAL_PHASE=${journal_rows[1]#PHASE=}
  EVIDENCE_EXPECTED_PRIVATE_SHA256=${BASH_REMATCH[1]}
  [[ "${journal_rows[3]}" =~ ^PUBLIC_SHA256=([a-f0-9]{64})$ ]] \
    || fail "release-evidence key publication journal public hash is invalid"
  EVIDENCE_EXPECTED_PUBLIC_SHA256=${BASH_REMATCH[1]}
}

validate_existing_evidence_keypair() {
  validate_evidence_private_key
  assert_key_artifact "$EVIDENCE_SIGNING_PUBLIC_KEY" 644 \
    "release-evidence Ed25519 public key"
  signing_public_temp="$(mktemp /etc/resume-ai/.release-evidence-signing.pub.XXXXXX)"
  derive_evidence_public_key "$EVIDENCE_SIGNING_PRIVATE_KEY" "$signing_public_temp"
  cmp -s "$signing_public_temp" "$EVIDENCE_SIGNING_PUBLIC_KEY" \
    || fail "release-evidence public key differs from the private key derivation"
  unlink "$signing_public_temp"
  signing_public_temp=
}

publish_evidence_signing_marker() {
  local public_sha=$1 provisioned_at
  [[ "$public_sha" =~ ^[a-f0-9]{64}$ ]] \
    || fail "release-evidence signing marker public hash is malformed"
  [ ! -e "$EVIDENCE_SIGNING_MARKER" ] && [ ! -L "$EVIDENCE_SIGNING_MARKER" ] \
    || fail "release-evidence signing marker already exists; refusing overwrite"
  provisioned_at="$(/usr/bin/date -u '+%Y-%m-%dT%H:%M:%SZ')"
  [[ "$provisioned_at" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] \
    || fail "release-evidence signing marker timestamp is malformed"
  signing_marker_temp="$(mktemp /etc/resume-ai/.release-evidence-signing.env.XXXXXX)"
  {
    printf '%s\n' 'SCHEMA_VERSION=1'
    printf 'PROVISIONED_AT=%s\n' "$provisioned_at"
    printf 'PUBLIC_KEY_SHA256=%s\n' "$public_sha"
  } > "$signing_marker_temp"
  chown root:root "$signing_marker_temp"
  chmod 0600 "$signing_marker_temp"
  sync -f "$signing_marker_temp"
  publish_new_key_artifact "$signing_marker_temp" "$EVIDENCE_SIGNING_MARKER" 0600
  signing_marker_temp=
}

validate_evidence_signing_marker() {
  local expected_public_sha=$1
  local -a marker_rows=()
  assert_key_artifact "$EVIDENCE_SIGNING_MARKER" 600 \
    "release-evidence signing provenance marker"
  mapfile -t marker_rows < "$EVIDENCE_SIGNING_MARKER"
  [ "${#marker_rows[@]}" -eq 3 ] \
    && [ "${marker_rows[0]}" = 'SCHEMA_VERSION=1' ] \
    && [[ "${marker_rows[1]}" =~ ^PROVISIONED_AT=[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] \
    && [[ "${marker_rows[2]}" =~ ^PUBLIC_KEY_SHA256=([a-f0-9]{64})$ ]] \
    || fail "release-evidence signing marker schema is invalid"
  [ "${BASH_REMATCH[1]}" = "$expected_public_sha" ] \
    || fail "release-evidence signing marker public hash drifted"
}

cleanup_orphaned_release_evidence_key_temps

private_key_present=0
public_key_present=0
pending_key_transaction=0
signing_marker_present=0
{ [ -e "$EVIDENCE_SIGNING_PRIVATE_KEY" ] || [ -L "$EVIDENCE_SIGNING_PRIVATE_KEY" ]; } \
  && private_key_present=1
{ [ -e "$EVIDENCE_SIGNING_PUBLIC_KEY" ] || [ -L "$EVIDENCE_SIGNING_PUBLIC_KEY" ]; } \
  && public_key_present=1
{ [ -e "$EVIDENCE_SIGNING_PENDING" ] || [ -L "$EVIDENCE_SIGNING_PENDING" ]; } \
  && pending_key_transaction=1
{ [ -e "$EVIDENCE_SIGNING_MARKER" ] || [ -L "$EVIDENCE_SIGNING_MARKER" ]; } \
  && signing_marker_present=1

if [ "$pending_key_transaction" -eq 0 ]; then
  if [ "$private_key_present:$public_key_present" = 0:0 ]; then
    [ "$signing_marker_present" -eq 0 ] \
      || fail "release-evidence signing marker exists without its keypair"
    begin_evidence_key_transaction
    pending_key_transaction=1
  elif [ "$private_key_present:$public_key_present" != 1:1 ]; then
    fail "unjournaled release-evidence keypair has a missing half"
  elif [ "$signing_marker_present" -eq 0 ]; then
    [ "${ACK_ADOPT_EXISTING_EVIDENCE_SIGNING_KEY:-}" = YES ] \
      || fail "existing release-evidence keypair lacks provenance; set ACK_ADOPT_EXISTING_EVIDENCE_SIGNING_KEY=YES for one journaled adoption"
    validate_existing_evidence_keypair
    adoption_private_sha="$(sha256sum "$EVIDENCE_SIGNING_PRIVATE_KEY" | awk '{print $1}')"
    adoption_public_sha="$(sha256sum "$EVIDENCE_SIGNING_PUBLIC_KEY" | awk '{print $1}')"
    publish_evidence_key_journal adopting-existing \
      "$adoption_private_sha" "$adoption_public_sha"
    pending_key_transaction=1
  fi
else
  load_evidence_key_transaction
  if [ "$signing_marker_present" -eq 1 ] \
    && [ "$private_key_present:$public_key_present" != 1:1 ]; then
    fail "release-evidence signing marker exists with an incomplete keypair"
  fi
  if [ "$EVIDENCE_KEY_JOURNAL_PHASE" = adopting-existing ] \
    && [ "$private_key_present:$public_key_present" != 1:1 ]; then
    fail "adoption journal does not have the complete pre-existing keypair"
  fi
  if [ "$private_key_present:$public_key_present" = 0:0 ]; then
    # The journal was durable but neither trust-anchor half was published. No
    # external identity exists, so close that empty transaction and start one
    # fresh transaction rather than accepting an arbitrary half.
    unlink "$EVIDENCE_SIGNING_PENDING"
    sync -f /etc/resume-ai
    pending_key_transaction=0
    begin_evidence_key_transaction
    pending_key_transaction=1
  elif [ "$private_key_present:$public_key_present" = 0:1 ]; then
    fail "journaled release-evidence public key exists without its private half"
  fi
fi

if [ "$pending_key_transaction" -eq 1 ]; then
  load_evidence_key_transaction
  if [ "$private_key_present" -eq 0 ]; then
    [ -n "$signing_private_temp" ] \
      || fail "journaled private key is missing and cannot be reconstructed"
    [ "$(sha256sum "$signing_private_temp" | awk '{print $1}')" \
      = "$EVIDENCE_EXPECTED_PRIVATE_SHA256" ] \
      || fail "generated private key differs from its durable journal"
    publish_new_key_artifact "$signing_private_temp" \
      "$EVIDENCE_SIGNING_PRIVATE_KEY" 0600
    signing_private_temp=
    private_key_present=1
  fi
  validate_evidence_private_key
  [ "$(sha256sum "$EVIDENCE_SIGNING_PRIVATE_KEY" | awk '{print $1}')" \
    = "$EVIDENCE_EXPECTED_PRIVATE_SHA256" ] \
    || fail "release-evidence private key differs from its durable journal"

  if [ "$public_key_present" -eq 0 ]; then
    if [ -z "$signing_public_temp" ]; then
      signing_public_temp="$(mktemp /etc/resume-ai/.release-evidence-signing.pub.XXXXXX)"
      derive_evidence_public_key "$EVIDENCE_SIGNING_PRIVATE_KEY" "$signing_public_temp"
    fi
    [ "$(sha256sum "$signing_public_temp" | awk '{print $1}')" \
      = "$EVIDENCE_EXPECTED_PUBLIC_SHA256" ] \
      || fail "derived public key differs from its durable journal"
    publish_new_key_artifact "$signing_public_temp" \
      "$EVIDENCE_SIGNING_PUBLIC_KEY" 0644
    signing_public_temp=
    public_key_present=1
  fi
  assert_key_artifact "$EVIDENCE_SIGNING_PUBLIC_KEY" 644 \
    "release-evidence Ed25519 public key"
  [ "$(sha256sum "$EVIDENCE_SIGNING_PUBLIC_KEY" | awk '{print $1}')" \
    = "$EVIDENCE_EXPECTED_PUBLIC_SHA256" ] \
    || fail "release-evidence public key differs from its durable journal"
  derived_public_check="$(mktemp /etc/resume-ai/.release-evidence-signing.pub.XXXXXX)"
  signing_public_temp=$derived_public_check
  derive_evidence_public_key "$EVIDENCE_SIGNING_PRIVATE_KEY" "$derived_public_check"
  cmp -s "$derived_public_check" "$EVIDENCE_SIGNING_PUBLIC_KEY" \
    || fail "release-evidence public key differs from the private key derivation"
  unlink "$derived_public_check"
  signing_public_temp=
else
  validate_evidence_private_key
  assert_key_artifact "$EVIDENCE_SIGNING_PUBLIC_KEY" 644 \
    "release-evidence Ed25519 public key"
  signing_public_temp="$(mktemp /etc/resume-ai/.release-evidence-signing.pub.XXXXXX)"
  derive_evidence_public_key "$EVIDENCE_SIGNING_PRIVATE_KEY" "$signing_public_temp"
  cmp -s "$signing_public_temp" "$EVIDENCE_SIGNING_PUBLIC_KEY" \
    || fail "release-evidence public key differs from the private key derivation"
  unlink "$signing_public_temp"
  signing_public_temp=
fi

evidence_public_sha="$(sha256sum "$EVIDENCE_SIGNING_PUBLIC_KEY" | awk '{print $1}')"
[[ "$evidence_public_sha" =~ ^[a-f0-9]{64}$ ]] \
  || fail "release-evidence public key hash is malformed"
if [ "$signing_marker_present" -eq 1 ]; then
  validate_evidence_signing_marker "$evidence_public_sha"
else
  [ "$pending_key_transaction" -eq 1 ] \
    || fail "release-evidence keypair has no journaled provenance marker transaction"
  publish_evidence_signing_marker "$evidence_public_sha"
  signing_marker_present=1
fi
if [ "$pending_key_transaction" -eq 1 ]; then
  unlink "$EVIDENCE_SIGNING_PENDING"
  sync -f /etc/resume-ai
fi

# Publish every boot-critical Node recovery executable before the unit/drop-in
# that makes PM2 depend on it.  A power loss can therefore never leave PM2
# ordered behind a missing or only partially installed recovery control.
install_owned_control() {
  local source=$1 destination=$2 owner=$3 group=$4 mode=$5 directory base temporary
  [ -f "$source" ] && [ ! -L "$source" ] \
    || fail "boot control source is missing or linked: $source"
  directory=${destination%/*}
  base=${destination##*/}
  [ "$(readlink -e -- "$directory")" = "$directory" ] \
    || fail "boot control destination traverses a symbolic link: $directory"
  temporary="$(mktemp "$directory/.${base}.resume-ai.XXXXXX")"
  install -o "$owner" -g "$group" -m "$mode" "$source" "$temporary"
  sync -f "$temporary"
  mv -f -- "$temporary" "$destination"
  sync -f "$directory"
}
install_boot_control() {
  install_owned_control "$1" "$2" root root "$3"
}
install_trust_anchor() {
  local source=$1 destination=$2 mode=$3
  if [ -e "$destination" ] || [ -L "$destination" ]; then
    [ -f "$destination" ] && [ ! -L "$destination" ] \
      && [ "$(stat -c '%U:%G:%a:%h' "$destination")" = "root:root:$mode:1" ] \
      || fail "existing control-plane trust anchor is unsafe: $destination"
    if ! cmp -s "$source" "$destination"; then
      [ "${ACK_CONTROL_PLANE_TRUST_ANCHOR_UPGRADE:-}" = YES ] \
        || fail "control-plane trust-anchor changes require ACK_CONTROL_PLANE_TRUST_ANCHOR_UPGRADE=YES: $destination"
    else
      return 0
    fi
  fi
  install_owned_control "$source" "$destination" root root "$mode"
}
install_trust_anchor "$OPS_DIR/bin/open-root-lock.sh" \
  /usr/local/lib/resume-ai/open-root-lock.sh 0755
install_trust_anchor "$OPS_DIR/bin/verify-control-plane-generation.py" \
  /usr/local/lib/resume-ai/verify-control-plane-generation.py 0755
install_trust_anchor "$OPS_DIR/bin/install-control-plane-generation.sh" \
  /usr/local/lib/resume-ai/install-control-plane-generation.sh 0755
install_trust_anchor "$OPS_DIR/bin/recover-control-plane-generation.sh" \
  /usr/local/lib/resume-ai/recover-control-plane-generation.sh 0755
install_boot_control "$OPS_DIR/bin/read-proc-start-ticks.py" \
  /usr/local/lib/resume-ai/read-proc-start-ticks.py 0755
install_boot_control "$OPS_DIR/bin/node-runtime-recovery-gate.sh" \
  /usr/local/lib/resume-ai/node-runtime-recovery-gate.sh 0755
install_boot_control "$OPS_DIR/bin/recover-node-runtime.sh" \
  /usr/local/lib/resume-ai/recover-node-runtime.sh 0755
install_boot_control "$OPS_DIR/bin/verify-single-link-tree.sh" \
  /usr/local/lib/resume-ai/verify-single-link-tree.sh 0755
install_boot_control "$OPS_DIR/bin/assert-nginx-security-contract.py" \
  /usr/local/lib/resume-ai/assert-nginx-security-contract.py 0755
install_boot_control "$OPS_DIR/bin/assert-nginx-package-runtime.sh" \
  /usr/local/lib/resume-ai/assert-nginx-package-runtime.sh 0755
install_boot_control "$OPS_DIR/bin/finalize-nginx-migration-recovery.sh" \
  /usr/local/lib/resume-ai/finalize-nginx-migration-recovery.sh 0755
install_boot_control "$OPS_DIR/bin/verify-quota-generation.py" \
  /usr/local/lib/resume-ai/verify-quota-generation.py 0755
install_boot_control "$OPS_DIR/bin/recover-quota-generation.sh" \
  /usr/local/lib/resume-ai/recover-quota-generation.sh 0755
install_boot_control "$OPS_DIR/bin/recover-qcloud-control-generation.sh" \
  /usr/local/lib/resume-ai/recover-qcloud-control-generation.sh 0755
install_boot_control "$OPS_DIR/bin/qcloud-network-control.py" \
  /usr/local/lib/resume-ai/qcloud-network-control.py 0755
install_boot_control "$OPS_DIR/bin/rc-local-backup.py" \
  /usr/local/lib/resume-ai/rc-local-backup.py 0755
install_boot_control "$OPS_DIR/bin/run-qcloud-network-tuning.sh" \
  /usr/local/lib/resume-ai/run-qcloud-network-tuning.sh 0755
install_boot_control "$OPS_DIR/bin/recover-unattended-upgrades.sh" \
  /usr/local/lib/resume-ai/recover-unattended-upgrades.sh 0755

"$OPS_DIR/bin/verify-quota-generation.py" \
  "$OPS_DIR/generated/quota-generation.env" \
  "$OPS_DIR/generated/application-quota.env" \
  "$OPS_DIR/generated/00-resume-ai-global.conf" \
  "$OPS_DIR/generated/nginx-quota.inc" \
  "$OPS_DIR/generated/nginx-track-quota.inc" >/dev/null
# The fixed release already contains its source-manifest-bound generation.
# Publish ordinary members atomically and the generation manifest last; never
# mutate the release by rendering again on the host.
install_owned_control "$OPS_DIR/generated/application-quota.env" \
  /etc/resume-ai/quota.env root resume-ai 0640
install_owned_control "$OPS_DIR/generated/quota-generation.env" \
  /etc/resume-ai/quota-generation.env root root 0600
install_boot_control "$OPS_DIR/systemd/resume-ai-pm2.service" \
  /etc/systemd/system/resume-ai-pm2.service 0644
install -d -o root -g root -m 0755 /etc/systemd/system/resume-ai-pm2.service.d
install_boot_control "$OPS_DIR/systemd/resume-ai-node-runtime-recovery.service" \
  /etc/systemd/system/resume-ai-node-runtime-recovery.service 0644
install_boot_control "$OPS_DIR/systemd/resume-ai-pm2-node-recovery.conf" \
  /etc/systemd/system/resume-ai-pm2.service.d/node-runtime-recovery.conf 0644
install_boot_control "$OPS_DIR/systemd/resume-ai-pm2-quota-recovery.conf" \
  /etc/systemd/system/resume-ai-pm2.service.d/quota-generation-recovery.conf 0644
install -o root -g root -m 0644 "$OPS_DIR/systemd/resume-ai-deploy-recovery.service" \
  /etc/systemd/system/resume-ai-deploy-recovery.service
install -o root -g root -m 0644 "$OPS_DIR/systemd/resume-ai-nginx-migration-recovery.service" \
  /etc/systemd/system/resume-ai-nginx-migration-recovery.service
install -o root -g root -m 0644 "$OPS_DIR/systemd/resume-ai-quota-generation-recovery.service" \
  /etc/systemd/system/resume-ai-quota-generation-recovery.service
install -o root -g root -m 0644 "$OPS_DIR/systemd/resume-ai-qcloud-control-recovery.service" \
  /etc/systemd/system/resume-ai-qcloud-control-recovery.service
install -o root -g root -m 0644 "$OPS_DIR/systemd/resume-ai-qcloud-network-tuning@.service" \
  /etc/systemd/system/resume-ai-qcloud-network-tuning@.service
install -d -o root -g root -m 0755 /etc/udev/rules.d
install -o root -g root -m 0644 "$OPS_DIR/udev/80-qcloud-nic.rules" \
  /etc/udev/rules.d/80-qcloud-nic.rules
install -o root -g root -m 0644 "$OPS_DIR/systemd/resume-ai-control-plane-recovery.service" \
  /etc/systemd/system/resume-ai-control-plane-recovery.service
install -o root -g root -m 0644 "$OPS_DIR/systemd/resume-ai-apt-recovery.service" \
  /etc/systemd/system/resume-ai-apt-recovery.service
install -d -o root -g root -m 0755 \
  /etc/systemd/system/apt-daily.service.d \
  /etc/systemd/system/apt-daily-upgrade.service.d
install -o root -g root -m 0644 "$OPS_DIR/systemd/apt-daily-resume-ai-recovery.conf" \
  /etc/systemd/system/apt-daily.service.d/resume-ai-recovery.conf
install -o root -g root -m 0644 "$OPS_DIR/systemd/apt-daily-upgrade-resume-ai-recovery.conf" \
  /etc/systemd/system/apt-daily-upgrade.service.d/resume-ai-recovery.conf
install -o root -g root -m 0644 "$OPS_DIR/systemd/resume-ai-legacy-adoption-recovery.service" \
  /etc/systemd/system/resume-ai-legacy-adoption-recovery.service
install -o root -g root -m 0644 "$OPS_DIR/systemd/resume-ai-security-state-cleanup.service" \
  /etc/systemd/system/resume-ai-security-state-cleanup.service
install -o root -g root -m 0644 "$OPS_DIR/systemd/resume-ai-security-state-cleanup.timer" \
  /etc/systemd/system/resume-ai-security-state-cleanup.timer
install -o root -g root -m 0644 "$OPS_DIR/systemd/resume-ai-security-state-cleanup-alert.service" \
  /etc/systemd/system/resume-ai-security-state-cleanup-alert.service
for postgres_unit in \
  resume-ai-postgres-backup.service \
  resume-ai-postgres-backup.timer \
  resume-ai-postgres-restore-verify.service \
  resume-ai-postgres-restore-verify.timer \
  resume-ai-postgres-ops-alert@.service; do
  install -o root -g root -m 0644 "$OPS_DIR/systemd/$postgres_unit" \
    "/etc/systemd/system/$postgres_unit"
done
install -d -o root -g root -m 0755 /etc/systemd/system/nginx.service.d
install -o root -g root -m 0644 "$OPS_DIR/systemd/nginx-resume-ai-recovery.conf" \
  /etc/systemd/system/nginx.service.d/resume-ai-recovery.conf
install -o root -g root -m 0644 "$OPS_DIR/logrotate/resume-ai" \
  /etc/logrotate.d/resume-ai

if [ ! -f /etc/resume-ai/app.env ]; then
  install -o root -g resume-ai -m 0640 "$OPS_DIR/config/app.env.example" /etc/resume-ai/app.env
  printf '%s\n' "Created /etc/resume-ai/app.env from the secret-free template; populate required values before starting the service." >&2
fi

[ ! -L /etc/resume-ai/app.env ] || fail "/etc/resume-ai/app.env must not be a symbolic link"
[ -f /etc/resume-ai/app.env ] || fail "/etc/resume-ai/app.env must be a regular file"
chown root:resume-ai /etc/resume-ai/app.env
chmod 0640 /etc/resume-ai/app.env

install -o root -g root -m 0755 "$OPS_DIR/bin/validate-app-env.sh" \
  /usr/local/lib/resume-ai/validate-app-env.sh
/usr/local/lib/resume-ai/validate-app-env.sh permissions
log_hash_secret="$(/usr/local/lib/resume-ai/validate-app-env.sh get LOG_HASH_SECRET 2>/dev/null || true)"
if [ -z "$log_hash_secret" ]; then
  log_hash_secret="$(openssl rand -hex 32)"
  app_env_temp="$(mktemp /etc/resume-ai/.app.env.XXXXXX)"
  awk -v secret="$log_hash_secret" '
    BEGIN { replaced = 0 }
    $0 ~ /^LOG_HASH_SECRET=/ { print "LOG_HASH_SECRET=" secret; replaced = 1; next }
    { print }
    END { if (!replaced) print "LOG_HASH_SECRET=" secret }
  ' /etc/resume-ai/app.env > "$app_env_temp"
  chown root:resume-ai "$app_env_temp"
  chmod 0640 "$app_env_temp"
  mv -f -- "$app_env_temp" /etc/resume-ai/app.env
fi
[ "${#log_hash_secret}" -ge 32 ] || fail "LOG_HASH_SECRET must contain at least 32 characters"
unset log_hash_secret

install -o root -g root -m 0755 "$OPS_DIR/bin/recover-deployment-state.sh" \
  /usr/local/lib/resume-ai/recover-deployment-state.sh
install -o root -g root -m 0755 "$OPS_DIR/bin/adopt-legacy-release.sh" \
  /usr/local/lib/resume-ai/adopt-legacy-release.sh
install -o root -g root -m 0755 "$OPS_DIR/bin/recover-legacy-adoption.sh" \
  /usr/local/lib/resume-ai/recover-legacy-adoption.sh
install -o root -g root -m 0755 "$OPS_DIR/bin/recover-nginx-migration.sh" \
  /usr/local/lib/resume-ai/recover-nginx-migration.sh
install -o root -g root -m 0755 "$OPS_DIR/bin/nginx-migration-recovery-gate.sh" \
  /usr/local/lib/resume-ai/nginx-migration-recovery-gate.sh
install -o root -g root -m 0755 "$OPS_DIR/bin/verify-release-consistency.sh" \
  /usr/local/lib/resume-ai/verify-release-consistency.sh
install -o root -g root -m 0755 "$OPS_DIR/bin/verify-pm2-topology.mjs" \
  /usr/local/lib/resume-ai/verify-pm2-topology.mjs
install -o root -g root -m 0755 "$OPS_DIR/bin/verify-pm2-boot-state.sh" \
  /usr/local/lib/resume-ai/verify-pm2-boot-state.sh
install -o root -g root -m 0755 "$OPS_DIR/bin/verify-production-host.sh" \
  /usr/local/lib/resume-ai/verify-production-host.sh
install -o root -g root -m 0755 "$OPS_DIR/bin/validate-pending-deploy-host-state.py" \
  /usr/local/lib/resume-ai/validate-pending-deploy-host-state.py
install -o root -g root -m 0755 "$OPS_DIR/bin/create-release-source-manifest.sh" \
  /usr/local/lib/resume-ai/create-release-source-manifest.sh
install -o root -g root -m 0755 "$OPS_DIR/bin/create-release-source-manifest.py" \
  /usr/local/lib/resume-ai/create-release-source-manifest.py
install -o root -g root -m 0755 "$OPS_DIR/bin/verify-release-source-tree.py" \
  /usr/local/lib/resume-ai/verify-release-source-tree.py
install -o root -g root -m 0755 "$OPS_DIR/bin/hash-runtime-tree.py" \
  /usr/local/lib/resume-ai/hash-runtime-tree.py
install -o root -g root -m 0755 "$OPS_DIR/bin/validate-pnpm-lockfile.py" \
  /usr/local/lib/resume-ai/validate-pnpm-lockfile.py
install -o root -g root -m 0755 "$OPS_DIR/bin/verify-release-evidence.mjs" \
  /usr/local/lib/resume-ai/verify-release-evidence.mjs
install -o root -g root -m 0755 "$OPS_DIR/../scripts/run-release-evidence.mjs" \
  /usr/local/lib/resume-ai/run-release-evidence.mjs
install -o root -g root -m 0444 "$OPS_DIR/config/release-required-tests.json" \
  /usr/local/lib/resume-ai/release-required-tests.json
install -o root -g root -m 0755 "$OPS_DIR/../scripts/lib/release-evidence-deepseek-verifier.mjs" \
  /usr/local/lib/resume-ai/release-evidence-deepseek-verifier.mjs
install -o root -g root -m 0755 "$OPS_DIR/../scripts/lib/release-evidence-http-probe.mjs" \
  /usr/local/lib/resume-ai/release-evidence-http-probe.mjs
install -o root -g root -m 0755 "$OPS_DIR/bin/scan-release-secrets.sh" \
  /usr/local/lib/resume-ai/scan-release-secrets.sh
install -o root -g root -m 0755 "$OPS_DIR/bin/create-immutable-tree-manifest.py" \
  /usr/local/lib/resume-ai/create-immutable-tree-manifest.py
install -o root -g root -m 0755 "$OPS_DIR/bin/assert-ssh-effective-policy.sh" \
  /usr/local/lib/resume-ai/assert-ssh-effective-policy.sh
install -o root -g root -m 0755 "$OPS_DIR/bin/install-ssh-hardening.sh" \
  /usr/local/lib/resume-ai/install-ssh-hardening.sh
install -o root -g root -m 0755 "$OPS_DIR/bin/assert-pm2-effective-service.sh" \
  /usr/local/lib/resume-ai/assert-pm2-effective-service.sh
install -o root -g root -m 0755 "$OPS_DIR/bin/assert-postgres-security-version.sh" \
  /usr/local/lib/resume-ai/assert-postgres-security-version.sh
install -o root -g root -m 0755 "$OPS_DIR/bin/backup-postgres.sh" \
  /usr/local/lib/resume-ai/backup-postgres.sh
install -o root -g root -m 0755 "$OPS_DIR/bin/verify-postgres-restore.sh" \
  /usr/local/lib/resume-ai/verify-postgres-restore.sh
install -o root -g root -m 0755 "$OPS_DIR/bin/select-postgres-retention.py" \
  /usr/local/lib/resume-ai/select-postgres-retention.py
install -o root -g root -m 0755 "$OPS_DIR/bin/assert-postgres-restore-evidence.py" \
  /usr/local/lib/resume-ai/assert-postgres-restore-evidence.py
install -o root -g root -m 0755 "$OPS_DIR/bin/assert-postgres-ops-runtime.sh" \
  /usr/local/lib/resume-ai/assert-postgres-ops-runtime.sh
install -o root -g root -m 0755 "$OPS_DIR/bin/enable-postgres-checksums.sh" \
  /usr/local/lib/resume-ai/enable-postgres-checksums.sh
install -o root -g root -m 0755 "$OPS_DIR/bin/read-backup-config.sh" \
  /usr/local/lib/resume-ai/read-backup-config.sh
install -o root -g root -m 0755 "$OPS_DIR/bin/render-quota-config.sh" \
  /usr/local/lib/resume-ai/render-quota-config.sh
install -o root -g root -m 0755 "$OPS_DIR/bin/verify-quota-generation.py" \
  /usr/local/lib/resume-ai/verify-quota-generation.py
install -o root -g root -m 0755 "$OPS_DIR/bin/install-quota-generation.sh" \
  /usr/local/lib/resume-ai/install-quota-generation.sh
install -o root -g root -m 0755 "$OPS_DIR/bin/install-qcloud-control-generation.sh" \
  /usr/local/lib/resume-ai/install-qcloud-control-generation.sh
install -o root -g root -m 0755 "$OPS_DIR/bin/assert-apt-active-sources.sh" \
  /usr/local/lib/resume-ai/assert-apt-active-sources.sh
install -o root -g root -m 0755 "$OPS_DIR/bin/assert-apt-effective-config.sh" \
  /usr/local/lib/resume-ai/assert-apt-effective-config.sh
install -o root -g root -m 0755 "$OPS_DIR/bin/assert-apt-trust-contract.py" \
  /usr/local/lib/resume-ai/assert-apt-trust-contract.py
install -o root -g root -m 0755 "$OPS_DIR/bin/assert-unattended-upgrades-config.py" \
  /usr/local/lib/resume-ai/assert-unattended-upgrades-config.py
install -o root -g root -m 0755 "$OPS_DIR/bin/assert-unattended-upgrades-runtime.sh" \
  /usr/local/lib/resume-ai/assert-unattended-upgrades-runtime.sh
install -o root -g root -m 0755 "$OPS_DIR/bin/install-unattended-upgrades.sh" \
  /usr/local/lib/resume-ai/install-unattended-upgrades.sh
install -o root -g root -m 0755 "$OPS_DIR/bin/verify-apt-unattended-jammy.sh" \
  /usr/local/lib/resume-ai/verify-apt-unattended-jammy.sh
install -o root -g root -m 0755 "$OPS_DIR/bin/prune-releases.sh" \
  /usr/local/lib/resume-ai/prune-releases.sh
install -o root -g root -m 0755 "$OPS_DIR/bin/initialize-release-state.sh" \
  /usr/local/lib/resume-ai/initialize-release-state.sh
install -o root -g root -m 0755 "$OPS_DIR/bin/deploy-release.sh" \
  /usr/local/lib/resume-ai/deploy-release.sh
install -o root -g root -m 0755 "$OPS_DIR/bin/rollback-release.sh" \
  /usr/local/lib/resume-ai/rollback-release.sh
install -o root -g root -m 0755 "$OPS_DIR/bin/prepare-release-bundle.sh" \
  /usr/local/lib/resume-ai/prepare-release-bundle.sh
install -o root -g root -m 0755 "$OPS_DIR/bin/approve-release-bundle.sh" \
  /usr/local/lib/resume-ai/approve-release-bundle.sh
install -o root -g root -m 0755 "$OPS_DIR/bin/snapshot-release-bundle.py" \
  /usr/local/lib/resume-ai/snapshot-release-bundle.py
install -o root -g root -m 0755 "$OPS_DIR/bin/snapshot-legacy-release.py" \
  /usr/local/lib/resume-ai/snapshot-legacy-release.py
install -o root -g root -m 0755 "$OPS_DIR/bin/snapshot-pm2-dump.py" \
  /usr/local/lib/resume-ai/snapshot-pm2-dump.py
install -o root -g root -m 0755 "$OPS_DIR/bin/inspect-postgres-backups.py" \
  /usr/local/lib/resume-ai/inspect-postgres-backups.py
install -o root -g root -m 0755 "$OPS_DIR/bin/validate-expand-migration.py" \
  /usr/local/lib/resume-ai/validate-expand-migration.py
install -o root -g root -m 0755 "$OPS_DIR/bin/validate-reviewed-migration.py" \
  /usr/local/lib/resume-ai/validate-reviewed-migration.py
install -o root -g root -m 0755 "$OPS_DIR/bin/read-postgres-runtime-identity.sh" \
  /usr/local/lib/resume-ai/read-postgres-runtime-identity.sh
install -o root -g root -m 0755 "$OPS_DIR/bin/configure-security-state-cleanup.sh" \
  /usr/local/lib/resume-ai/configure-security-state-cleanup.sh
install -o root -g root -m 0755 "$OPS_DIR/bin/run-security-state-cleanup.sh" \
  /usr/local/lib/resume-ai/run-security-state-cleanup.sh
install -o root -g root -m 0755 "$OPS_DIR/bin/provision-postgres-runtime-role.sh" \
  /usr/local/lib/resume-ai/provision-postgres-runtime-role.sh
install -o root -g root -m 0755 "$OPS_DIR/bin/provision-postgres-maintenance-role.sh" \
  /usr/local/lib/resume-ai/provision-postgres-maintenance-role.sh
install -o root -g root -m 0755 "$OPS_DIR/bin/provision-postgres-verifier-role.sh" \
  /usr/local/lib/resume-ai/provision-postgres-verifier-role.sh
install -o root -g root -m 0755 "$OPS_DIR/bin/verify-production-database-readonly.sh" \
  /usr/local/lib/resume-ai/verify-production-database-readonly.sh
install -o root -g root -m 0755 "$OPS_DIR/bin/write-database-permission-state.sh" \
  /usr/local/lib/resume-ai/write-database-permission-state.sh
install -o root -g root -m 0755 "$OPS_DIR/bin/harden-host-file-permissions.sh" \
  /usr/local/lib/resume-ai/harden-host-file-permissions.sh
install -o root -g root -m 0755 "$OPS_DIR/bin/record-maintenance-reboot.sh" \
  /usr/local/lib/resume-ai/record-maintenance-reboot.sh
install -o root -g root -m 0755 "$OPS_DIR/bin/record-cloud-snapshot-evidence.py" \
  /usr/local/lib/resume-ai/record-cloud-snapshot-evidence.py
install -o root -g root -m 0755 "$OPS_DIR/bin/verify-host-baseline.py" \
  /usr/local/lib/resume-ai/verify-host-baseline.py
install -o root -g root -m 0444 "$OPS_DIR/postgresql/cleanup-security-state.sql" \
  /usr/local/share/resume-ai/security-state-cleanup.sql
install -o root -g root -m 0444 "$OPS_DIR/postgresql/verify-production-database-readonly.sql" \
  /usr/local/share/resume-ai/verify-production-database-readonly.sql
install -o root -g root -m 0444 "$OPS_DIR/config/database-verification.manifest" \
  /usr/local/share/resume-ai/database-verification.manifest
install -o root -g root -m 0440 "$OPS_DIR/config/legacy-env-keys.conf" \
  /usr/local/share/resume-ai/legacy-env-keys.conf
install -o root -g root -m 0440 "$OPS_DIR/pm2/legacy-ecosystem.config.cjs" \
  /usr/local/share/resume-ai/legacy-ecosystem.config.cjs
install -o root -g root -m 0550 "$OPS_DIR/../scripts/verify-next-assets.mjs" \
  /usr/local/share/resume-ai/legacy-verify-next-assets.mjs
install -o root -g root -m 0444 "$OPS_DIR/legacy-adoption-runbook.txt" \
  /usr/local/share/resume-ai/legacy-adoption-runbook.txt
install -o root -g root -m 0444 "$OPS_DIR/config/approved-qcloud-network-tuning.conf" \
  /usr/local/share/resume-ai/approved-qcloud-network-tuning.conf
install_trust_anchor "$OPS_DIR/config/control-plane-files.conf" \
  /usr/local/share/resume-ai/control-plane-files.conf 0444
install -o root -g root -m 0644 "$OPS_DIR/postgresql/runtime-table-privileges.conf" \
  /etc/resume-ai/runtime-table-privileges.conf
install -o root -g root -m 0644 "$OPS_DIR/postgresql/runtime-function-privileges.conf" \
  /etc/resume-ai/runtime-function-privileges.conf
install -o root -g root -m 0644 "$OPS_DIR/postgresql/restore-required-tables.txt" \
  /etc/resume-ai/restore-required-tables.txt
install -o root -g root -m 0644 "$OPS_DIR/config/approved-postgres-runtime.conf" \
  /etc/resume-ai/approved-postgres-runtime.conf
/usr/local/lib/resume-ai/validate-app-env.sh permissions

systemctl daemon-reload
/usr/local/lib/resume-ai/assert-pm2-effective-service.sh >/dev/null
systemctl enable resume-ai-pm2.service >/dev/null
systemctl enable resume-ai-security-state-cleanup.timer >/dev/null
systemctl enable resume-ai-qcloud-control-recovery.service >/dev/null

for account in resume-ai resume-ai-build resume-ai-verify resume-ai-pgtest resume-ai-dbverify; do
  account_uid="$(id -u "$account")"
  account_gid="$(id -g "$account")"
  IFS=: read -r passwd_name _ passwd_uid passwd_gid _ passwd_home passwd_shell < <(
    getent passwd "$account"
  )
  [ "$passwd_name:$passwd_uid:$passwd_gid:$passwd_shell" \
      = "$account:$account_uid:$account_gid:/usr/sbin/nologin" ] \
    && [[ "$account_uid" =~ ^[1-9][0-9]*$ ]] \
    && [[ "$account_gid" =~ ^[1-9][0-9]*$ ]] \
    && [ "$(id -gn "$account")" = "$account" ] \
    && [ "$(id -G "$account")" = "$account_gid" ] \
    && [ -z "$(getent group "$account" | cut -d: -f4)" ] \
    || fail "$account lost its exact dedicated non-login identity contract"
done

# The pending receipt remains durable until the snapshotted generation and
# every allowlisted target/trust anchor have been re-read from disk.  Candidate
# workspace paths are never consulted after the snapshot boundary.
final_snapshot_state="$(run_runtime_layout_snapshot_tcb validate \
  "$RUNTIME_LAYOUT_PENDING" "$RUNTIME_LAYOUT_GENERATIONS" \
  "$SNAPSHOT_ROOT" 0 0 - "$BOOTSTRAP_GENERATION" \
  "$BOOTSTRAP_MANIFEST_SHA256" "$HOST_BASELINE_DIR" \
  "$HOST_BASELINE_MANIFEST_SHA256")" \
  || fail "runtime-layout snapshot changed while privileged files were published"
[ "$final_snapshot_state" = "$snapshot_tcb_result" ] \
  || fail "runtime-layout pending snapshot identity changed during bootstrap"
/usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin /usr/bin/python3 -I - \
  "$SNAPSHOT_ROOT" /usr/local/share/resume-ai/control-plane-files.conf <<'PY'
import hashlib
import pathlib
import re
import stat
import sys

source_root = pathlib.Path(sys.argv[1]).resolve(strict=True)
installed_spec = pathlib.Path(sys.argv[2])
source_spec = source_root / "ops/config/control-plane-files.conf"

def content_hash(path):
    state = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            state.update(chunk)
    return state.hexdigest()

def ordinary(path, uid, gid, mode, label):
    metadata = path.lstat()
    if (
        not stat.S_ISREG(metadata.st_mode)
        or stat.S_ISLNK(metadata.st_mode)
        or metadata.st_nlink != 1
        or metadata.st_uid != uid
        or metadata.st_gid != gid
        or stat.S_IMODE(metadata.st_mode) != mode
        or path.resolve(strict=True) != path
    ):
        raise SystemExit(f"unsafe or mismatched {label}: {path}")

ordinary(installed_spec, 0, 0, 0o444, "installed control specification")
ordinary(source_spec, 0, source_spec.lstat().st_gid,
         stat.S_IMODE(source_spec.lstat().st_mode), "source control specification")
if source_spec.lstat().st_mode & 0o022:
    raise SystemExit("bootstrap control specification is writable outside root")
if source_spec.read_bytes() != installed_spec.read_bytes():
    raise SystemExit("installed control specification differs from bootstrap source")
for line in source_spec.read_text(encoding="utf-8").splitlines():
    if not line or line.startswith("#"):
        continue
    fields = line.split("\t")
    if len(fields) != 3 or re.fullmatch(r"0[45-7][0-7]{2}", fields[0]) is None:
        raise SystemExit("malformed bootstrap control specification")
    mode, relative, target_text = fields
    source = source_root.joinpath(*pathlib.PurePosixPath(relative).parts)
    target = pathlib.Path(target_text)
    ordinary(source, 0, source.lstat().st_gid,
             stat.S_IMODE(source.lstat().st_mode), f"control source {relative}")
    if source.lstat().st_mode & 0o022:
        raise SystemExit(f"bootstrap control source is writable outside root: {relative}")
    ordinary(target, 0, 0, int(mode, 8), f"installed control {target_text}")
    if content_hash(source) != content_hash(target):
        raise SystemExit(f"installed control differs from bootstrap source: {target_text}")

for relative, target_text, mode in [
    ("ops/bin/open-root-lock.sh", "/usr/local/lib/resume-ai/open-root-lock.sh", 0o755),
    ("ops/bin/verify-control-plane-generation.py", "/usr/local/lib/resume-ai/verify-control-plane-generation.py", 0o755),
    ("ops/bin/install-control-plane-generation.sh", "/usr/local/lib/resume-ai/install-control-plane-generation.sh", 0o755),
    ("ops/bin/recover-control-plane-generation.sh", "/usr/local/lib/resume-ai/recover-control-plane-generation.sh", 0o755),
]:
    source = source_root.joinpath(*pathlib.PurePosixPath(relative).parts)
    target = pathlib.Path(target_text)
    ordinary(target, 0, 0, mode, f"installed trust anchor {target_text}")
    if content_hash(source) != content_hash(target):
        raise SystemExit(f"installed trust anchor differs from bootstrap source: {target_text}")
PY

if [ -e "$RUNTIME_LAYOUT_COMPLETE" ] || [ -L "$RUNTIME_LAYOUT_COMPLETE" ]; then
  [ -f "$RUNTIME_LAYOUT_COMPLETE" ] && [ ! -L "$RUNTIME_LAYOUT_COMPLETE" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$RUNTIME_LAYOUT_COMPLETE")" = root:root:400:1 ] \
    && grep -Fxq 'SCHEMA_VERSION=4' "$RUNTIME_LAYOUT_COMPLETE" \
    && grep -Fxq 'PHASE=complete' "$RUNTIME_LAYOUT_COMPLETE" \
    && grep -Fxq "STARTED_AT=$RUNTIME_LAYOUT_STARTED_AT" "$RUNTIME_LAYOUT_COMPLETE" \
    && grep -Fxq "BOOTSTRAP_GENERATION=$BOOTSTRAP_GENERATION" "$RUNTIME_LAYOUT_COMPLETE" \
    && grep -Fxq "BOOTSTRAP_MANIFEST_SHA256=$BOOTSTRAP_MANIFEST_SHA256" "$RUNTIME_LAYOUT_COMPLETE" \
    && grep -Fxq "HOST_BASELINE_DIR=$HOST_BASELINE_DIR" "$RUNTIME_LAYOUT_COMPLETE" \
    && grep -Fxq "HOST_BASELINE_MANIFEST_SHA256=$HOST_BASELINE_MANIFEST_SHA256" "$RUNTIME_LAYOUT_COMPLETE" \
    && grep -Fxq "SOURCE_GENERATION_SHA256=$RUNTIME_LAYOUT_SOURCE_GENERATION" "$RUNTIME_LAYOUT_COMPLETE" \
    && grep -Fxq "CONTROL_SPEC_SHA256=$RUNTIME_LAYOUT_CONTROL_SPEC_SHA256" "$RUNTIME_LAYOUT_COMPLETE" \
    && [ "$(wc -l < "$RUNTIME_LAYOUT_COMPLETE")" -eq 9 ] \
    || fail "runtime-layout completion receipt is unsafe or belongs to another generation"
else
  runtime_complete_temp="$(mktemp /etc/resume-ai/.runtime-layout-bootstrap.XXXXXX)"
  cat > "$runtime_complete_temp" <<EOF
SCHEMA_VERSION=4
PHASE=complete
STARTED_AT=$RUNTIME_LAYOUT_STARTED_AT
BOOTSTRAP_GENERATION=$BOOTSTRAP_GENERATION
BOOTSTRAP_MANIFEST_SHA256=$BOOTSTRAP_MANIFEST_SHA256
HOST_BASELINE_DIR=$HOST_BASELINE_DIR
HOST_BASELINE_MANIFEST_SHA256=$HOST_BASELINE_MANIFEST_SHA256
SOURCE_GENERATION_SHA256=$RUNTIME_LAYOUT_SOURCE_GENERATION
CONTROL_SPEC_SHA256=$RUNTIME_LAYOUT_CONTROL_SPEC_SHA256
EOF
  chown root:root "$runtime_complete_temp"
  chmod 0400 "$runtime_complete_temp"
  sync -f "$runtime_complete_temp"
  mv -f -- "$runtime_complete_temp" "$RUNTIME_LAYOUT_COMPLETE"
  sync -f /etc/resume-ai
fi
rm -f -- "$RUNTIME_LAYOUT_PENDING"
sync -f /opt/resume-ai/state

printf '%s\n' "Runtime layout installed. The PM2 systemd unit is enabled but was not started."
