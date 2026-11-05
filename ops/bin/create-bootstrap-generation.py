#!/usr/bin/env python3
"""Freeze and verify the independently pinned first-root bootstrap controls.

The program is intentionally installed without executing candidate bytes.  An
operator must compare both its installed SHA-256 and the source-manifest
SHA-256 with values obtained through an independent reviewed channel before
calling ``create``.
"""

from __future__ import annotations

import ctypes
import datetime
import errno
import fcntl
import hashlib
import os
import pathlib
import re
import shutil
import stat
import sys
import uuid


INSTALLED_SELF = pathlib.Path("/usr/local/lib/resume-ai/create-bootstrap-generation.py")
GENERATION_ROOT = pathlib.Path("/var/lib/resume-ai/bootstrap-generations")
ACTIVE_RECEIPT = pathlib.Path("/var/lib/resume-ai/bootstrap-generation.env")
SOURCE_MANIFEST_NAME = "bootstrap-source-manifest.txt"
GENERATION_RECEIPT_NAME = "bootstrap-generation.env"
MANIFEST_HEADER = "RESUME_AI_BOOTSTRAP_SOURCE_MANIFEST_V1"
RECEIPT_KEYS = {
    "SCHEMA_VERSION", "PHASE", "STARTED_AT", "GENERATION_PATH",
    "BOOTSTRAP_MANIFEST_SHA256", "COPIER_SHA256", "MEMBER_COUNT",
}
HEX64 = re.compile(r"[a-f0-9]{64}")
RELEASE_GENERATION = re.compile(r"generation-([a-f0-9]{64})")
REQUIRED_MEMBERS = {
    "ops/bin/create-bootstrap-generation.py",
    "ops/bin/capture-host-baseline.sh",
    "ops/bin/install-node-runtime.sh",
    "ops/bin/install-runtime-layout.sh",
    "ops/bin/record-cloud-snapshot-evidence.py",
    "ops/bin/verify-host-baseline.py",
    "ops/bin/open-root-lock.sh",
    "ops/bin/backup-postgres.sh",
    "ops/bin/snapshot-legacy-release.py",
    "ops/bin/create-immutable-tree-manifest.py",
    "ops/config/approved-node-runtime.conf",
    "ops/config/control-plane-files.conf",
}
STAGE_NAME = re.compile(
    r"\.generation-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"
)
RECEIPT_TEMP_NAME = re.compile(
    r"\.bootstrap-generation\.[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"
)
LOCK_PATH = pathlib.Path("/usr/local/lib/resume-ai/.bootstrap-generation.lock")


def fail(message: str) -> "NoReturn":
    raise SystemExit(f"ERROR: {message}")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def fsync_directory(path: pathlib.Path) -> None:
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def physical_root_chain(path: pathlib.Path, include_leaf: bool = True) -> None:
    target = path if include_leaf else path.parent
    current = pathlib.Path("/")
    for part in target.parts[1:]:
        current /= part
        metadata = current.lstat()
        if (
            not stat.S_ISDIR(metadata.st_mode)
            or current.is_symlink()
            or metadata.st_uid != 0
            or metadata.st_gid != 0
            or stat.S_IMODE(metadata.st_mode) & 0o022
            or current.resolve(strict=True) != current
        ):
            fail(f"bootstrap trusted path ancestry is unsafe: {current}")


def open_bootstrap_lock() -> int:
    physical_root_chain(LOCK_PATH, include_leaf=False)
    flags = os.O_RDWR | os.O_CLOEXEC
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    created = False
    try:
        descriptor = os.open(LOCK_PATH, flags | os.O_CREAT | os.O_EXCL, 0o600)
        created = True
    except FileExistsError:
        descriptor = os.open(LOCK_PATH, flags)
    if created:
        os.fchown(descriptor, 0, 0)
        os.fchmod(descriptor, 0o600)
        os.fsync(descriptor)
        fsync_directory(LOCK_PATH.parent)
    metadata = os.fstat(descriptor)
    path_metadata = LOCK_PATH.lstat()
    identity_fields = ("st_dev", "st_ino", "st_mode", "st_uid", "st_gid", "st_nlink")
    if (
        not stat.S_ISREG(metadata.st_mode)
        or metadata.st_uid != 0
        or metadata.st_gid != 0
        or metadata.st_nlink != 1
        or stat.S_IMODE(metadata.st_mode) != 0o600
        or LOCK_PATH.is_symlink()
        or any(
            getattr(metadata, field) != getattr(path_metadata, field)
            for field in identity_fields
        )
    ):
        os.close(descriptor)
        fail("bootstrap generation lock is unsafe")
    fcntl.flock(descriptor, fcntl.LOCK_EX)
    return descriptor


def strict_file(path: pathlib.Path, mode: int, label: str) -> bytes:
    before = path.lstat()
    if (
        not stat.S_ISREG(before.st_mode)
        or stat.S_ISLNK(before.st_mode)
        or before.st_uid != 0
        or before.st_gid != 0
        or before.st_nlink != 1
        or stat.S_IMODE(before.st_mode) != mode
        or path.resolve(strict=True) != path
    ):
        fail(f"unsafe {label}: {path}")
    flags = os.O_RDONLY | os.O_CLOEXEC
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(path, flags)
    try:
        opened = os.fstat(descriptor)
        chunks: list[bytes] = []
        total = 0
        while True:
            chunk = os.read(descriptor, 1024 * 1024)
            if not chunk:
                break
            chunks.append(chunk)
            total += len(chunk)
            if total > 128 * 1024 * 1024:
                fail(f"oversized {label}: {path}")
        after = os.fstat(descriptor)
    finally:
        os.close(descriptor)
    fields = (
        "st_dev", "st_ino", "st_mode", "st_uid", "st_gid", "st_nlink",
        "st_size", "st_mtime_ns", "st_ctime_ns",
    )
    final_path = path.lstat()
    if any(
        getattr(before, field) != getattr(observed, field)
        for observed in (opened, after, final_path)
        for field in fields
    ):
        fail(f"{label} changed while read: {path}")
    return b"".join(chunks)


def verify_installed_self(expected: str | None = None) -> str:
    if pathlib.Path(__file__).resolve(strict=True) != INSTALLED_SELF:
        fail("bootstrap copier must run from its fixed root-installed path")
    physical_root_chain(INSTALLED_SELF, include_leaf=False)
    data = strict_file(INSTALLED_SELF, 0o555, "installed bootstrap copier")
    digest = sha256(data)
    if expected is not None and digest != expected:
        fail("installed bootstrap copier differs from the independent expected digest")
    return digest


def exact_relative(raw: str) -> pathlib.PurePosixPath:
    if (
        not raw
        or raw.startswith("/")
        or "\\" in raw
        or any(character in raw for character in ("\x00", "\t", "\r", "\n"))
        or raw != str(pathlib.PurePosixPath(raw))
    ):
        fail(f"bootstrap manifest path is not canonical: {raw!r}")
    path = pathlib.PurePosixPath(raw)
    if any(part in ("", ".", "..") for part in path.parts):
        fail(f"bootstrap manifest path escapes its source root: {raw!r}")
    if path.parts[0] not in {"ops", "scripts"}:
        fail(f"bootstrap manifest path is outside the approved roots: {raw!r}")
    return path


def parse_manifest(raw: bytes, expected_sha: str) -> dict[str, tuple[int, int, str]]:
    if HEX64.fullmatch(expected_sha) is None or sha256(raw) != expected_sha:
        fail("bootstrap source manifest differs from the independent expected digest")
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        fail("bootstrap source manifest is not UTF-8")
    if not text.endswith("\n"):
        fail("bootstrap source manifest is not newline terminated")
    lines = text.splitlines()
    if not lines or lines[0] != MANIFEST_HEADER:
        fail("bootstrap source manifest header is invalid")
    records: dict[str, tuple[int, int, str]] = {}
    order: list[str] = []
    for line in lines[1:]:
        fields = line.split("\t")
        if (
            len(fields) != 5
            or fields[0] != "FILE"
            or fields[1] not in {"0400", "0500"}
            or not fields[2].isdigit()
            or HEX64.fullmatch(fields[3]) is None
        ):
            fail("bootstrap source manifest row is malformed")
        relative = str(exact_relative(fields[4]))
        if relative in records:
            fail("bootstrap source manifest contains a duplicate member")
        size = int(fields[2])
        if size < 0 or size > 128 * 1024 * 1024:
            fail("bootstrap source manifest member size is invalid")
        records[relative] = (int(fields[1], 8), size, fields[3])
        order.append(relative)
    if order != sorted(order, key=lambda item: item.encode("utf-8")):
        fail("bootstrap source manifest is not bytewise path sorted")
    if not REQUIRED_MEMBERS.issubset(records):
        fail("bootstrap source manifest omits a first-root trust control")
    if records["ops/bin/create-bootstrap-generation.py"][0] != 0o500:
        fail("bootstrap copier generation member is not executable")
    return records


class SourceTree:
    def __init__(self, root: pathlib.Path):
        if not root.is_absolute():
            fail("bootstrap source root must be absolute")
        metadata = root.lstat()
        if not stat.S_ISDIR(metadata.st_mode) or root.is_symlink():
            fail("bootstrap source root is not one physical directory")
        flags = os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        self.root_fd = os.open(root, flags)

    def close(self) -> None:
        os.close(self.root_fd)

    def _open_parent(self, relative: pathlib.PurePosixPath) -> tuple[int, str]:
        descriptor = os.dup(self.root_fd)
        try:
            for part in relative.parts[:-1]:
                flags = os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC
                if hasattr(os, "O_NOFOLLOW"):
                    flags |= os.O_NOFOLLOW
                child = os.open(part, flags, dir_fd=descriptor)
                os.close(descriptor)
                descriptor = child
            return descriptor, relative.name
        except BaseException:
            os.close(descriptor)
            raise

    def read(self, relative_text: str) -> bytes:
        relative = pathlib.PurePosixPath(relative_text)
        parent, name = self._open_parent(relative)
        flags = os.O_RDONLY | os.O_CLOEXEC
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        try:
            descriptor = os.open(name, flags, dir_fd=parent)
        finally:
            os.close(parent)
        try:
            before = os.fstat(descriptor)
            if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1:
                fail(f"bootstrap source member is linked or non-regular: {relative_text}")
            chunks: list[bytes] = []
            total = 0
            while True:
                chunk = os.read(descriptor, 1024 * 1024)
                if not chunk:
                    break
                chunks.append(chunk)
                total += len(chunk)
                if total > 128 * 1024 * 1024:
                    fail(f"bootstrap source member is oversized: {relative_text}")
            after = os.fstat(descriptor)
        finally:
            os.close(descriptor)
        fields = (
            "st_dev", "st_ino", "st_mode", "st_uid", "st_gid", "st_nlink",
            "st_size", "st_mtime_ns", "st_ctime_ns",
        )
        if any(getattr(before, field) != getattr(after, field) for field in fields):
            fail(f"bootstrap source member changed while read: {relative_text}")
        return b"".join(chunks)

    def ops_inventory(self) -> set[str]:
        flags = os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        root_ops = os.open("ops", flags, dir_fd=self.root_fd)
        inventory: set[str] = set()
        stack: list[tuple[tuple[str, ...], int]] = [(('ops',), root_ops)]
        while stack:
            prefix, descriptor = stack.pop()
            try:
                for entry in os.scandir(descriptor):
                    metadata = entry.stat(follow_symlinks=False)
                    relative = "/".join(prefix + (entry.name,))
                    if entry.is_symlink():
                        fail(f"bootstrap ops inventory contains a symlink: {relative}")
                    if stat.S_ISDIR(metadata.st_mode):
                        child = os.open(entry.name, flags, dir_fd=descriptor)
                        stack.append((prefix + (entry.name,), child))
                    elif stat.S_ISREG(metadata.st_mode):
                        if metadata.st_nlink != 1:
                            fail(f"bootstrap ops inventory contains a hardlink: {relative}")
                        inventory.add(relative)
                    else:
                        fail(f"bootstrap ops inventory contains a special file: {relative}")
            finally:
                os.close(descriptor)
        return inventory


def validate_control_spec(records: dict[str, tuple[int, int, str]], members: dict[str, bytes]) -> None:
    relative = "ops/config/control-plane-files.conf"
    try:
        lines = members[relative].decode("utf-8").splitlines()
    except UnicodeDecodeError:
        fail("bootstrap control-plane specification is not UTF-8")
    for line in lines:
        if not line or line.startswith("#"):
            continue
        fields = line.split("\t")
        if len(fields) != 3:
            fail("bootstrap control-plane specification contains a malformed row")
        exact_relative(fields[1])
        if fields[1] not in records:
            fail(f"bootstrap manifest omits control-plane source: {fields[1]}")


def capture_source(
    source_root: pathlib.Path, expected_manifest_sha: str
) -> tuple[bytes, dict[str, tuple[int, int, str]], dict[str, bytes]]:
    tree = SourceTree(source_root)
    try:
        manifest_raw = tree.read(SOURCE_MANIFEST_NAME)
        records = parse_manifest(manifest_raw, expected_manifest_sha)
        ops_records = {name for name in records if name.startswith("ops/")}
        if tree.ops_inventory() != ops_records:
            fail("bootstrap manifest does not equal the exact ops ordinary-file inventory")
        members: dict[str, bytes] = {}
        for relative, (_, expected_size, expected_sha) in records.items():
            data = tree.read(relative)
            if len(data) != expected_size or sha256(data) != expected_sha:
                fail(f"bootstrap source member differs from manifest: {relative}")
            members[relative] = data
        validate_control_spec(records, members)
        return manifest_raw, records, members
    finally:
        tree.close()


def receipt_bytes(
    generation: pathlib.Path,
    manifest_sha: str,
    copier_sha: str,
    member_count: int,
    started_at: str,
) -> bytes:
    return (
        "SCHEMA_VERSION=1\n"
        "PHASE=complete\n"
        f"STARTED_AT={started_at}\n"
        f"GENERATION_PATH={generation}\n"
        f"BOOTSTRAP_MANIFEST_SHA256={manifest_sha}\n"
        f"COPIER_SHA256={copier_sha}\n"
        f"MEMBER_COUNT={member_count}\n"
    ).encode("utf-8")


def parse_receipt(raw: bytes, label: str) -> dict[str, str]:
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        fail(f"{label} is not UTF-8")
    if not text.endswith("\n"):
        fail(f"{label} is not newline terminated")
    values: dict[str, str] = {}
    for line in text.splitlines():
        if line.count("=") != 1:
            fail(f"{label} contains a malformed row")
        key, value = line.split("=", 1)
        if key not in RECEIPT_KEYS or key in values or not value:
            fail(f"{label} contains an unknown, duplicate, or empty field")
        values[key] = value
    if set(values) != RECEIPT_KEYS or values["SCHEMA_VERSION"] != "1" \
            or values["PHASE"] != "complete":
        fail(f"{label} has the wrong schema or phase")
    try:
        started = datetime.datetime.strptime(
            values["STARTED_AT"], "%Y-%m-%dT%H:%M:%SZ"
        ).replace(tzinfo=datetime.timezone.utc)
    except ValueError:
        fail(f"{label} start time is malformed")
    if started > datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=5):
        fail(f"{label} start time is in the future")
    if (
        HEX64.fullmatch(values["BOOTSTRAP_MANIFEST_SHA256"]) is None
        or HEX64.fullmatch(values["COPIER_SHA256"]) is None
        or not values["MEMBER_COUNT"].isdigit()
        or int(values["MEMBER_COUNT"]) <= 0
    ):
        fail(f"{label} contains malformed identity fields")
    return values


def write_file(path: pathlib.Path, data: bytes, mode: int) -> None:
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_CLOEXEC
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(path, flags, mode)
    try:
        written = 0
        while written < len(data):
            count = os.write(descriptor, data[written:])
            if count <= 0:
                fail(f"short write while publishing bootstrap file: {path}")
            written += count
        if written != len(data):
            fail(f"bootstrap file length differs after write: {path}")
        os.fchmod(descriptor, mode)
        os.fchown(descriptor, 0, 0)
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def rename_noreplace(source: pathlib.Path, destination: pathlib.Path) -> None:
    libc = ctypes.CDLL(None, use_errno=True)
    renameat2 = getattr(libc, "renameat2", None)
    if renameat2 is None:
        fail("renameat2 is required for no-clobber bootstrap publication")
    result = renameat2(
        ctypes.c_int(-100), ctypes.c_char_p(os.fsencode(source)),
        ctypes.c_int(-100), ctypes.c_char_p(os.fsencode(destination)), ctypes.c_uint(1),
    )
    if result != 0:
        error = ctypes.get_errno()
        if error == errno.EEXIST:
            raise FileExistsError(destination)
        raise OSError(error, os.strerror(error), destination)


def ensure_root_directory(path: pathlib.Path, mode: int) -> None:
    if not path.exists() and not path.is_symlink():
        path.mkdir(mode=mode)
        os.chown(path, 0, 0)
        os.chmod(path, mode)
        fsync_directory(path.parent)
    metadata = path.lstat()
    if (
        not stat.S_ISDIR(metadata.st_mode)
        or path.is_symlink()
        or metadata.st_uid != 0
        or metadata.st_gid != 0
        or stat.S_IMODE(metadata.st_mode) != mode
        or path.resolve(strict=True) != path
    ):
        fail(f"unsafe bootstrap directory: {path}")


def provision_roots() -> None:
    ensure_root_directory(pathlib.Path("/var/lib/resume-ai"), 0o755)
    ensure_root_directory(GENERATION_ROOT, 0o700)
    ensure_root_directory(pathlib.Path("/var/lib/resume-ai/security"), 0o700)
    ensure_root_directory(pathlib.Path("/var/lib/resume-ai/security/cloud-snapshots"), 0o700)
    ensure_root_directory(
        pathlib.Path("/var/lib/resume-ai/security/cloud-snapshots/by-snapshot-id"), 0o700
    )


def validate_abandoned_stage(path: pathlib.Path) -> None:
    root_device = GENERATION_ROOT.lstat().st_dev
    metadata = path.lstat()
    if (
        STAGE_NAME.fullmatch(path.name) is None
        or not stat.S_ISDIR(metadata.st_mode)
        or path.is_symlink()
        or metadata.st_uid != 0
        or metadata.st_gid != 0
        or stat.S_IMODE(metadata.st_mode) not in {0o500, 0o700}
        or metadata.st_dev != root_device
        or os.path.ismount(path)
        or path.resolve(strict=True) != path
    ):
        fail(f"unsafe abandoned bootstrap staging path: {path}")
    for member in path.rglob("*"):
        state = member.lstat()
        if (
            member.is_symlink()
            or state.st_uid != 0
            or state.st_gid != 0
            or state.st_dev != root_device
            or (stat.S_ISREG(state.st_mode) and state.st_nlink != 1)
            or not (stat.S_ISREG(state.st_mode) or stat.S_ISDIR(state.st_mode))
        ):
            fail(f"unsafe abandoned bootstrap staging member: {member}")


def cleanup_abandoned_publications() -> None:
    for candidate in GENERATION_ROOT.iterdir():
        if candidate.name.startswith(".generation-"):
            validate_abandoned_stage(candidate)
            os.chmod(candidate, 0o700)
            for directory in (
                item for item in candidate.rglob("*") if item.is_dir() and not item.is_symlink()
            ):
                os.chmod(directory, 0o700)
            shutil.rmtree(candidate)
            fsync_directory(GENERATION_ROOT)
    parent = ACTIVE_RECEIPT.parent
    for candidate in parent.iterdir():
        if not candidate.name.startswith(".bootstrap-generation."):
            continue
        state = candidate.lstat()
        if (
            RECEIPT_TEMP_NAME.fullmatch(candidate.name) is None
            or not stat.S_ISREG(state.st_mode)
            or candidate.is_symlink()
            or state.st_uid != 0
            or state.st_gid != 0
            or state.st_nlink != 1
            or stat.S_IMODE(state.st_mode) != 0o400
            or candidate.resolve(strict=True) != candidate
        ):
            fail(f"unsafe abandoned bootstrap receipt publication: {candidate}")
        candidate.unlink()
        fsync_directory(parent)


def verify_generation(
    generation: pathlib.Path, expected_manifest_sha: str, copier_sha: str
) -> dict[str, str]:
    match = RELEASE_GENERATION.fullmatch(generation.name)
    if (
        match is None
        or match.group(1) != expected_manifest_sha
        or generation.parent != GENERATION_ROOT
    ):
        fail("bootstrap generation path is not content addressed")
    metadata = generation.lstat()
    if (
        not stat.S_ISDIR(metadata.st_mode)
        or generation.is_symlink()
        or metadata.st_uid != 0
        or metadata.st_gid != 0
        or stat.S_IMODE(metadata.st_mode) != 0o500
        or generation.resolve(strict=True) != generation
    ):
        fail("bootstrap generation directory is unsafe")
    manifest_raw = strict_file(
        generation / SOURCE_MANIFEST_NAME, 0o400, "bootstrap generation manifest"
    )
    records = parse_manifest(manifest_raw, expected_manifest_sha)
    expected_files = {SOURCE_MANIFEST_NAME, GENERATION_RECEIPT_NAME, *records.keys()}
    observed_files: set[str] = set()
    for path in generation.rglob("*"):
        relative = path.relative_to(generation).as_posix()
        state = path.lstat()
        if path.is_symlink():
            fail(f"bootstrap generation contains a symlink: {relative}")
        if stat.S_ISDIR(state.st_mode):
            if state.st_uid != 0 or state.st_gid != 0 or stat.S_IMODE(state.st_mode) != 0o500:
                fail(f"unsafe bootstrap generation directory: {relative}")
        elif stat.S_ISREG(state.st_mode):
            observed_files.add(relative)
        else:
            fail(f"bootstrap generation contains a special file: {relative}")
    if observed_files != expected_files:
        fail("bootstrap generation inventory differs from its exact manifest")
    for relative, (mode, size, digest) in records.items():
        data = strict_file(generation / relative, mode, f"bootstrap member {relative}")
        if len(data) != size or sha256(data) != digest:
            fail(f"bootstrap generation member differs from manifest: {relative}")
    receipt_raw = strict_file(
        generation / GENERATION_RECEIPT_NAME, 0o400, "bootstrap generation receipt"
    )
    values = parse_receipt(receipt_raw, "bootstrap generation receipt")
    if (
        values["GENERATION_PATH"] != str(generation)
        or values["BOOTSTRAP_MANIFEST_SHA256"] != expected_manifest_sha
        or values["COPIER_SHA256"] != copier_sha
        or values["MEMBER_COUNT"] != str(len(records))
    ):
        fail("bootstrap generation receipt differs from its physical generation")
    return values


def verify_active_receipt(generation: pathlib.Path, expected: dict[str, str]) -> None:
    raw = strict_file(ACTIVE_RECEIPT, 0o400, "active bootstrap receipt")
    values = parse_receipt(raw, "active bootstrap receipt")
    generation_raw = strict_file(
        generation / GENERATION_RECEIPT_NAME, 0o400, "bootstrap generation receipt"
    )
    if values != expected or raw != generation_raw:
        fail("active bootstrap receipt differs from the verified generation")


def publish_active_receipt(generation: pathlib.Path) -> None:
    if ACTIVE_RECEIPT.exists() or ACTIVE_RECEIPT.is_symlink():
        return
    source = generation / GENERATION_RECEIPT_NAME
    temporary = ACTIVE_RECEIPT.parent / f".bootstrap-generation.{uuid.uuid4()}"
    write_file(
        temporary, strict_file(source, 0o400, "bootstrap generation receipt"), 0o400
    )
    try:
        rename_noreplace(temporary, ACTIVE_RECEIPT)
    except FileExistsError:
        fail("active bootstrap receipt appeared during no-clobber publication")
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass
    fsync_directory(ACTIVE_RECEIPT.parent)


def build_generation(
    source_root: pathlib.Path,
    expected_manifest_sha: str,
    expected_copier_sha: str,
    started_at: str,
) -> pathlib.Path:
    copier_sha = verify_installed_self(expected_copier_sha)
    provision_roots()
    cleanup_abandoned_publications()
    manifest_raw, records, members = capture_source(source_root, expected_manifest_sha)
    if sha256(members["ops/bin/create-bootstrap-generation.py"]) != copier_sha:
        fail("manifest-pinned bootstrap copier differs from the installed trusted copier")
    target = GENERATION_ROOT / f"generation-{expected_manifest_sha}"
    if target.exists() or target.is_symlink():
        values = verify_generation(target, expected_manifest_sha, copier_sha)
        publish_active_receipt(target)
        verify_active_receipt(target, values)
        return target
    if ACTIVE_RECEIPT.exists() or ACTIVE_RECEIPT.is_symlink():
        fail("another bootstrap generation is already active")
    stage = GENERATION_ROOT / f".generation-{uuid.uuid4()}"
    stage.mkdir(mode=0o700)
    os.chown(stage, 0, 0)
    try:
        write_file(stage / SOURCE_MANIFEST_NAME, manifest_raw, 0o400)
        for relative, (mode, _, _) in records.items():
            destination = stage / relative
            destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            os.chown(destination.parent, 0, 0)
            os.chmod(destination.parent, 0o700)
            write_file(destination, members[relative], mode)
        receipt = receipt_bytes(
            target, expected_manifest_sha, copier_sha, len(records), started_at
        )
        write_file(stage / GENERATION_RECEIPT_NAME, receipt, 0o400)
        for directory in sorted(
            (path for path in stage.rglob("*") if path.is_dir()),
            key=lambda item: len(item.parts), reverse=True,
        ):
            os.chown(directory, 0, 0)
            os.chmod(directory, 0o500)
            fsync_directory(directory)
        os.chmod(stage, 0o500)
        fsync_directory(stage)
        try:
            rename_noreplace(stage, target)
        except FileExistsError:
            os.chmod(stage, 0o700)
            for directory in (path for path in stage.rglob("*") if path.is_dir()):
                os.chmod(directory, 0o700)
            shutil.rmtree(stage)
        fsync_directory(GENERATION_ROOT)
    except BaseException:
        if stage.exists() and not stage.is_symlink():
            os.chmod(stage, 0o700)
            for directory in (path for path in stage.rglob("*") if path.is_dir()):
                os.chmod(directory, 0o700)
            shutil.rmtree(stage)
        raise
    values = verify_generation(target, expected_manifest_sha, copier_sha)
    publish_active_receipt(target)
    verify_active_receipt(target, values)
    return target


def main() -> None:
    if os.geteuid() != 0:
        fail("run bootstrap generation control as root")
    started_at = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    if len(sys.argv) == 6 and sys.argv[1] == "create":
        source_root = pathlib.Path(sys.argv[2])
        manifest_path = pathlib.Path(sys.argv[3])
        expected_manifest_sha = sys.argv[4]
        expected_copier_sha = sys.argv[5]
        if manifest_path != source_root / SOURCE_MANIFEST_NAME:
            fail("bootstrap manifest must use its fixed source-root basename")
        # The dirfd reader consumes the fixed basename. This independent path
        # check prevents a caller from displaying/pinning one manifest while
        # asking the copier to consume another.
        verify_installed_self(expected_copier_sha)
        lock_descriptor = open_bootstrap_lock()
        try:
            target = build_generation(
                source_root, expected_manifest_sha, expected_copier_sha, started_at
            )
        finally:
            os.close(lock_descriptor)
        print(target)
        return
    if len(sys.argv) == 4 and sys.argv[1] == "verify":
        generation = pathlib.Path(sys.argv[2])
        expected_manifest_sha = sys.argv[3]
        copier_sha = verify_installed_self()
        lock_descriptor = open_bootstrap_lock()
        try:
            values = verify_generation(generation, expected_manifest_sha, copier_sha)
            verify_active_receipt(generation, values)
        finally:
            os.close(lock_descriptor)
        print(
            "\t".join((
                values["GENERATION_PATH"], values["BOOTSTRAP_MANIFEST_SHA256"],
                values["STARTED_AT"], values["COPIER_SHA256"],
            ))
        )
        return
    fail(
        "usage: create-bootstrap-generation.py create SOURCE_ROOT MANIFEST "
        "EXPECTED_MANIFEST_SHA256 EXPECTED_COPIER_SHA256 | verify GENERATION "
        "EXPECTED_MANIFEST_SHA256"
    )


if __name__ == "__main__":
    main()
