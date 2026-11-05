#!/usr/bin/python3
"""Create a root-owned, immutable-to-the-scanner Codex Deep Scan generation.

This file is intended to be reviewed, installed by a separate trusted control
plane at TRUSTED_INSTALL_PATH, and invoked only as:

  /usr/bin/python3 -I -S TRUSTED_INSTALL_PATH \
    --source-root ABS --source-manifest ABS --scanner-uid UID

The helper never imports or executes code from the candidate source tree.  It
only performs descriptor-relative reads and copies the exact manifest members.
The installer/caller must independently pin this file's SHA-256 (or verify an
equivalent signed package); a helper cannot establish its own provenance.
"""

from __future__ import annotations

import datetime
import ctypes
import errno
import fcntl
import hashlib
import json
import os
import pwd
import re
import secrets
import stat
import struct
import sys
from typing import Dict, Iterable, List, Mapping, MutableMapping, Optional, Sequence, Tuple


TRUSTED_INSTALL_PATH = (
    "/Library/PrivilegedHelperTools/"
    "com.siyuanjiaxin.resume-ai.create-deep-scan-generation"
)
GENERATIONS_ROOT = (
    "/private/var/db/com.siyuanjiaxin.resume-ai/deep-scan-generations"
)
SNAPSHOT_FORMAT = "codex-security-directory/v1"
SNAPSHOT_PREFIX = "codex-security-snapshot/v1:sha256:"
ATTESTATION_SCHEMA = "com.siyuanjiaxin.resume-ai.deep-scan-generation/v1"
FILE_CEILING = 128 * 1024 * 1024
TREE_CEILING = 2 * 1024 * 1024 * 1024
MANIFEST_CEILING = 64 * 1024 * 1024
MEMBER_CEILING = 250_000
COPY_CHUNK = 1024 * 1024
_GENERATION_RE = re.compile(r"^ds-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{16}$")
_MANIFEST_RE = re.compile(rb"^([a-f0-9]{64})\t([FL])\t(.+)$")
_HEX64_RE = re.compile(r"^[a-f0-9]{64}$")
_NOFOLLOW = getattr(os, "O_NOFOLLOW", 0)
_DIRECTORY = getattr(os, "O_DIRECTORY", 0)
_CLOEXEC = getattr(os, "O_CLOEXEC", 0)
_ACL_TYPE_EXTENDED = 0x00000100
_RENAME_EXCL = 0x00000004
_LIBSYSTEM = None
_CONTROL_LOCK_NAME = ".control.lock"
_STAGING_RE = re.compile(r"^\.staging-[a-f0-9]{32}$")


class BoundaryError(RuntimeError):
    """A fail-closed generation boundary violation."""


def _fail(message: str) -> None:
    raise BoundaryError(message)


def _mode(metadata: os.stat_result) -> int:
    return stat.S_IMODE(metadata.st_mode)


def _stable(metadata: os.stat_result) -> Tuple[int, ...]:
    return (
        metadata.st_dev,
        metadata.st_ino,
        metadata.st_mode,
        metadata.st_nlink,
        metadata.st_uid,
        metadata.st_gid,
        metadata.st_size,
        metadata.st_mtime_ns,
        metadata.st_ctime_ns,
    )


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _libsystem():
    global _LIBSYSTEM
    if sys.platform != "darwin":
        return None
    if _LIBSYSTEM is None:
        library = ctypes.CDLL("/usr/lib/libSystem.B.dylib", use_errno=True)
        library.acl_get_fd_np.argtypes = [ctypes.c_int, ctypes.c_int]
        library.acl_get_fd_np.restype = ctypes.c_void_p
        library.acl_init.argtypes = [ctypes.c_int]
        library.acl_init.restype = ctypes.c_void_p
        library.acl_set_fd_np.argtypes = [ctypes.c_int, ctypes.c_void_p, ctypes.c_int]
        library.acl_set_fd_np.restype = ctypes.c_int
        library.acl_to_text.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_ssize_t)]
        library.acl_to_text.restype = ctypes.c_void_p
        library.acl_free.argtypes = [ctypes.c_void_p]
        library.acl_free.restype = ctypes.c_int
        library.renameatx_np.argtypes = [
            ctypes.c_int,
            ctypes.c_char_p,
            ctypes.c_int,
            ctypes.c_char_p,
            ctypes.c_uint,
        ]
        library.renameatx_np.restype = ctypes.c_int
        _LIBSYSTEM = library
    return _LIBSYSTEM


def _acl_text(fd: int) -> bytes:
    library = _libsystem()
    if library is None:
        return b""
    ctypes.set_errno(0)
    acl = library.acl_get_fd_np(fd, _ACL_TYPE_EXTENDED)
    if not acl:
        if ctypes.get_errno() == errno.ENOENT:
            return b""
        _fail("cannot inspect the extended ACL on a trusted generation object")
    text_pointer = None
    try:
        length = ctypes.c_ssize_t()
        text_pointer = library.acl_to_text(acl, ctypes.byref(length))
        if not text_pointer:
            _fail("cannot serialize the extended ACL on a trusted generation object")
        return ctypes.string_at(text_pointer, length.value)
    finally:
        if text_pointer:
            library.acl_free(text_pointer)
        library.acl_free(acl)


def _require_empty_acl(fd: int, label: str) -> None:
    if _acl_text(fd):
        _fail("%s has an extended ACL that mode bits cannot prove safe" % label)


def _clear_acl(fd: int, label: str) -> None:
    library = _libsystem()
    if library is None:
        return
    empty = library.acl_init(1)
    if not empty:
        _fail("cannot allocate an empty ACL for %s" % label)
    try:
        ctypes.set_errno(0)
        if library.acl_set_fd_np(fd, empty, _ACL_TYPE_EXTENDED) != 0:
            error = ctypes.get_errno()
            raise OSError(error, os.strerror(error), label)
    finally:
        library.acl_free(empty)
    _require_empty_acl(fd, label)


def _rename_exclusive(
    source_parent_fd: int,
    source_name: str,
    destination_parent_fd: int,
    destination_name: str,
) -> None:
    library = _libsystem()
    if library is None:
        try:
            os.stat(destination_name, dir_fd=destination_parent_fd, follow_symlinks=False)
        except FileNotFoundError:
            pass
        else:
            raise FileExistsError(destination_name)
        os.rename(
            source_name,
            destination_name,
            src_dir_fd=source_parent_fd,
            dst_dir_fd=destination_parent_fd,
        )
        return
    ctypes.set_errno(0)
    result = library.renameatx_np(
        source_parent_fd,
        os.fsencode(source_name),
        destination_parent_fd,
        os.fsencode(destination_name),
        _RENAME_EXCL,
    )
    if result != 0:
        error = ctypes.get_errno()
        if error == errno.EEXIST:
            raise FileExistsError(destination_name)
        raise OSError(error, os.strerror(error), destination_name)


def _safe_absolute_path(value: str, label: str) -> str:
    try:
        value.encode("utf-8", "strict")
    except UnicodeEncodeError:
        _fail("%s must be valid UTF-8" % label)
    if (
        not value
        or "\x00" in value
        or "\n" in value
        or "\r" in value
        or "\t" in value
        or not os.path.isabs(value)
        or value != os.path.normpath(value)
        or value == "/"
    ):
        _fail("%s must be a normalized absolute path" % label)
    return value


def _path_parts(absolute: str) -> List[str]:
    _safe_absolute_path(absolute, "path")
    parts = absolute.split("/")[1:]
    if any(not part or part in (".", "..") for part in parts):
        _fail("absolute path contains an unsafe component")
    return parts


def _open_absolute_no_symlinks(absolute: str, final_flags: int) -> int:
    """Open an absolute path without following a symlink in any component."""
    parts = _path_parts(absolute)
    current = os.open("/", os.O_RDONLY | _DIRECTORY | _CLOEXEC)
    try:
        for component in parts[:-1]:
            next_fd = os.open(
                component,
                os.O_RDONLY | _DIRECTORY | _NOFOLLOW | _CLOEXEC,
                dir_fd=current,
            )
            os.close(current)
            current = next_fd
        return os.open(
            parts[-1], final_flags | _NOFOLLOW | _CLOEXEC, dir_fd=current
        )
    finally:
        os.close(current)


def _open_relative_directory(root_fd: int, parts: Sequence[str]) -> int:
    current = os.dup(root_fd)
    try:
        for component in parts:
            next_fd = os.open(
                component,
                os.O_RDONLY | _DIRECTORY | _NOFOLLOW | _CLOEXEC,
                dir_fd=current,
            )
            os.close(current)
            current = next_fd
        return current
    except BaseException:
        os.close(current)
        raise


def _read_fd(fd: int, ceiling: int, label: str) -> bytes:
    metadata_before = os.fstat(fd)
    if not stat.S_ISREG(metadata_before.st_mode) or metadata_before.st_nlink != 1:
        _fail("%s is not a single-link ordinary file" % label)
    if metadata_before.st_size < 0 or metadata_before.st_size > ceiling:
        _fail("%s exceeds its reviewed size ceiling" % label)
    chunks: List[bytes] = []
    total = 0
    os.lseek(fd, 0, os.SEEK_SET)
    while True:
        chunk = os.read(fd, min(COPY_CHUNK, ceiling - total + 1))
        if not chunk:
            break
        total += len(chunk)
        if total > ceiling:
            _fail("%s exceeds its reviewed size ceiling" % label)
        chunks.append(chunk)
    metadata_after = os.fstat(fd)
    if _stable(metadata_before) != _stable(metadata_after):
        _fail("%s changed while it was read" % label)
    return b"".join(chunks)


def _safe_relative(raw: bytes) -> Tuple[str, Tuple[str, ...]]:
    try:
        relative = raw.decode("utf-8", "strict")
    except UnicodeDecodeError:
        _fail("source manifest contains a non-UTF-8 member path")
    if (
        not relative
        or relative.startswith("/")
        or any(character in relative for character in ("\x00", "\r", "\n", "\t"))
    ):
        _fail("source manifest contains an unsafe member path")
    parts = tuple(relative.split("/"))
    if any(not part or part in (".", "..") for part in parts):
        _fail("source manifest contains an unsafe member path")
    if len(parts) > 128:
        _fail("source manifest member exceeds its reviewed depth ceiling")
    if len(raw) > 4096:
        _fail("source manifest member path exceeds its reviewed size ceiling")
    return relative, parts


def _parse_manifest(manifest_bytes: bytes) -> List[Mapping[str, object]]:
    if not manifest_bytes or not manifest_bytes.endswith(b"\n"):
        _fail("source manifest must be nonempty and newline terminated")
    entries: List[Mapping[str, object]] = []
    seen = set()
    previous: Optional[bytes] = None
    for line in manifest_bytes[:-1].split(b"\n"):
        match = _MANIFEST_RE.fullmatch(line)
        if not match:
            _fail("source manifest contains a malformed member")
        raw_path = match.group(3)
        relative, parts = _safe_relative(raw_path)
        if previous is not None and previous >= raw_path:
            _fail("source manifest members are not in canonical byte order")
        if relative in seen:
            _fail("source manifest contains a duplicate member")
        previous = raw_path
        seen.add(relative)
        entries.append(
            {
                "digest": match.group(1).decode("ascii"),
                "kind": match.group(2).decode("ascii"),
                "path": relative,
                "parts": parts,
            }
        )
        if len(entries) > MEMBER_CEILING:
            _fail("source manifest exceeds its reviewed member ceiling")
    if not entries:
        _fail("source manifest is empty")
    return entries


def _safe_source_mode(metadata: os.stat_result, relative: str, kind: str) -> int:
    mode = _mode(metadata)
    if mode & 0o7022:
        _fail("source %s has a privileged or group/world-writable mode: %s" % (kind, relative))
    if kind == "directory" and mode & 0o005 != 0o005:
        _fail("source directory is not scanner-traversable without changing its mode: %s" % relative)
    if kind == "file" and mode & 0o004 != 0o004:
        _fail("source file is not scanner-readable without changing its mode: %s" % relative)
    return mode


def _safe_symlink_target(value: str, relative: str) -> None:
    try:
        value.encode("utf-8", "strict")
    except UnicodeEncodeError:
        _fail("source symlink target is not valid UTF-8: %s" % relative)
    if (
        not value
        or value.startswith("/")
        or "\x00" in value
        or "\r" in value
        or "\n" in value
        or ".." in value.split("/")
    ):
        _fail("source symlink escapes the generation: %s" % relative)


def _required_directories(entries: Iterable[Mapping[str, object]]) -> List[Tuple[str, ...]]:
    directories = set()
    for entry in entries:
        parts = entry["parts"]
        assert isinstance(parts, tuple)
        for count in range(1, len(parts)):
            directories.add(parts[:count])
    return sorted(directories, key=lambda parts: (len(parts), tuple(parts)))


def _ensure_owned_directory_chain(
    absolute: str,
    owner_uid: int,
    owner_gid: int,
    create_from: int,
    validate_system_prefix: bool,
) -> int:
    """Create the private application tail and return a safe fd for it."""
    parts = _path_parts(absolute)
    current = os.open("/", os.O_RDONLY | _DIRECTORY | _CLOEXEC)
    try:
        for index, component in enumerate(parts):
            created = False
            try:
                next_fd = os.open(
                    component,
                    os.O_RDONLY | _DIRECTORY | _NOFOLLOW | _CLOEXEC,
                    dir_fd=current,
                )
            except FileNotFoundError:
                if index < create_from:
                    raise
                try:
                    os.mkdir(component, 0o755, dir_fd=current)
                    created = True
                except FileExistsError:
                    # Another first-run helper may have created the same trusted
                    # tail immediately before the fixed lifecycle lock existed.
                    created = False
                next_fd = os.open(
                    component,
                    os.O_RDONLY | _DIRECTORY | _NOFOLLOW | _CLOEXEC,
                    dir_fd=current,
                )
                os.fchown(next_fd, owner_uid, owner_gid)
                os.fchmod(next_fd, 0o755)
            metadata = os.fstat(next_fd)
            if not stat.S_ISDIR(metadata.st_mode):
                os.close(next_fd)
                _fail("generation root contains a non-directory ancestor")
            if validate_system_prefix and index < create_from:
                if (
                    metadata.st_uid != 0
                    or metadata.st_gid != 0
                    or _mode(metadata) & 0o022
                ):
                    os.close(next_fd)
                    _fail("macOS generation root prefix is not sealed root:wheel")
                _require_empty_acl(next_fd, "macOS generation root prefix")
            if index >= create_from and (
                metadata.st_uid != owner_uid
                or metadata.st_gid != owner_gid
                or _mode(metadata) & 0o022
            ):
                os.close(next_fd)
                _fail("generation root tail is not owned and sealed by the trusted owner")
            if index >= create_from:
                if created:
                    _clear_acl(next_fd, "new generation root directory")
                    # Persist both the sealed child metadata and its parent entry.
                    # A first-run power loss must not leave the lifecycle lock or
                    # later staging recovery rooted in an undurable directory tail.
                    _fsync_directory(next_fd)
                    _fsync_directory(current)
                else:
                    _require_empty_acl(next_fd, "generation root directory")
            os.close(current)
            current = next_fd
        return current
    except BaseException:
        os.close(current)
        raise


def _create_directory_at(parent_fd: int, name: str, owner_uid: int, owner_gid: int, mode: int) -> int:
    os.mkdir(name, 0o700, dir_fd=parent_fd)
    child = os.open(
        name,
        os.O_RDONLY | _DIRECTORY | _NOFOLLOW | _CLOEXEC,
        dir_fd=parent_fd,
    )
    try:
        os.fchown(child, owner_uid, owner_gid)
        _clear_acl(child, "new trusted generation directory")
        os.fchmod(child, mode)
        return child
    except BaseException:
        os.close(child)
        raise


def _write_all(fd: int, value: bytes) -> None:
    view = memoryview(value)
    while view:
        written = os.write(fd, view)
        if written <= 0:
            _fail("short write while creating the sealed generation")
        view = view[written:]


def _copy_file(
    source_parent_fd: int,
    destination_parent_fd: int,
    name: str,
    expected_digest: str,
    relative: str,
    owner_uid: int,
    owner_gid: int,
) -> Tuple[int, str]:
    source_fd = os.open(
        name, os.O_RDONLY | _NOFOLLOW | _CLOEXEC, dir_fd=source_parent_fd
    )
    destination_fd: Optional[int] = None
    try:
        before = os.fstat(source_fd)
        if (
            not stat.S_ISREG(before.st_mode)
            or before.st_nlink != 1
            or before.st_size < 0
            or before.st_size > FILE_CEILING
        ):
            _fail("source file is linked, special, or too large: %s" % relative)
        mode = _safe_source_mode(before, relative, "file")
        destination_fd = os.open(
            name,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | _NOFOLLOW | _CLOEXEC,
            0o600,
            dir_fd=destination_parent_fd,
        )
        os.fchown(destination_fd, owner_uid, owner_gid)
        _clear_acl(destination_fd, "new trusted generation file")
        digest = hashlib.sha256()
        copied = 0
        while True:
            chunk = os.read(source_fd, COPY_CHUNK)
            if not chunk:
                break
            copied += len(chunk)
            if copied > FILE_CEILING:
                _fail("source file grew beyond its reviewed size ceiling: %s" % relative)
            digest.update(chunk)
            _write_all(destination_fd, chunk)
        after = os.fstat(source_fd)
        observed_digest = digest.hexdigest()
        if (
            _stable(before) != _stable(after)
            or copied != before.st_size
            or observed_digest != expected_digest
        ):
            _fail("source file changed or differs from its manifest: %s" % relative)
        os.fchmod(destination_fd, mode)
        os.fsync(destination_fd)
        destination = os.fstat(destination_fd)
        if (
            not stat.S_ISREG(destination.st_mode)
            or destination.st_nlink != 1
            or destination.st_uid != owner_uid
            or destination.st_gid != owner_gid
            or _mode(destination) != mode
            or destination.st_size != copied
        ):
            _fail("sealed file identity differs from the reviewed source: %s" % relative)
        return copied, observed_digest
    finally:
        os.close(source_fd)
        if destination_fd is not None:
            os.close(destination_fd)


def _update_digest_field(digest: "hashlib._Hash", label: str, value: bytes) -> None:
    label_bytes = label.encode("utf-8")
    digest.update(struct.pack(">I", len(label_bytes)))
    digest.update(label_bytes)
    digest.update(struct.pack(">Q", len(value)))
    digest.update(value)


def _python_path_key(relative: str) -> Tuple[str, ...]:
    return tuple(relative.split("/"))


def _snapshot_target(
    source_fd: int,
    entries: Sequence[Mapping[str, object]],
    expected_directories: Mapping[str, int],
    owner_uid: int,
    owner_gid: int,
) -> Mapping[str, object]:
    _require_empty_acl(source_fd, "sealed generation source root")
    expected_members = {str(entry["path"]): entry for entry in entries}
    observed: MutableMapping[str, Tuple[str, int, object]] = {}

    def walk(directory_fd: int, prefix: str) -> None:
        directory_before = os.fstat(directory_fd)
        names = sorted(os.listdir(directory_fd))
        for name in names:
            if not name or name in (".", "..") or any(c in name for c in ("/", "\x00", "\r", "\n", "\t")):
                _fail("sealed generation contains an unsafe name")
            relative = "%s/%s" % (prefix, name) if prefix else name
            metadata = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
            if metadata.st_uid != owner_uid or metadata.st_gid != owner_gid:
                _fail("sealed generation member is not owned by the trusted owner: %s" % relative)
            mode = _mode(metadata)
            if stat.S_ISDIR(metadata.st_mode):
                if mode & 0o022 or mode & 0o005 != 0o005:
                    _fail("sealed directory is writable or unreadable by the scanner: %s" % relative)
                child = os.open(
                    name,
                    os.O_RDONLY | _DIRECTORY | _NOFOLLOW | _CLOEXEC,
                    dir_fd=directory_fd,
                )
                try:
                    _require_empty_acl(child, "sealed generation directory")
                    observed[relative] = ("directory", mode, None)
                    walk(child, relative)
                finally:
                    os.close(child)
            elif stat.S_ISREG(metadata.st_mode):
                if metadata.st_nlink != 1 or mode & 0o022 or mode & 0o004 != 0o004:
                    _fail("sealed file is linked, writable, or unreadable by the scanner: %s" % relative)
                file_fd = os.open(
                    name, os.O_RDONLY | _NOFOLLOW | _CLOEXEC, dir_fd=directory_fd
                )
                try:
                    _require_empty_acl(file_fd, "sealed generation file")
                    file_before = os.fstat(file_fd)
                    content = _read_fd(file_fd, FILE_CEILING, "sealed file")
                    if _stable(file_before) != _stable(os.fstat(file_fd)):
                        _fail("sealed file changed while hashing: %s" % relative)
                    observed[relative] = (
                        "file",
                        mode,
                        (len(content), hashlib.sha256(content).digest()),
                    )
                finally:
                    os.close(file_fd)
            elif stat.S_ISLNK(metadata.st_mode):
                target = os.readlink(name, dir_fd=directory_fd)
                _safe_symlink_target(target, relative)
                after = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
                if _stable(metadata) != _stable(after):
                    _fail("sealed symlink changed while hashing: %s" % relative)
                observed[relative] = ("symlink", mode, target)
            else:
                _fail("sealed generation contains a special member: %s" % relative)
        if names != sorted(os.listdir(directory_fd)) or _stable(directory_before) != _stable(os.fstat(directory_fd)):
            _fail("sealed generation changed while it was enumerated")

    walk(source_fd, "")
    observed_members = {path for path, value in observed.items() if value[0] != "directory"}
    observed_directories = {path for path, value in observed.items() if value[0] == "directory"}
    if observed_members != set(expected_members) or observed_directories != set(expected_directories):
        _fail("sealed generation membership differs from the exact source manifest")

    digest = hashlib.sha256()
    _update_digest_field(digest, "format", SNAPSHOT_FORMAT.encode("utf-8"))
    total_size = 0
    for relative in sorted(observed, key=_python_path_key):
        kind, mode, payload = observed[relative]
        _update_digest_field(digest, "path", relative.encode("utf-8"))
        _update_digest_field(digest, "mode", str(mode).encode("utf-8"))
        _update_digest_field(digest, "kind", kind.encode("utf-8"))
        if kind == "directory":
            if expected_directories[relative] != mode:
                _fail("sealed directory mode differs from its source: %s" % relative)
        elif kind == "file":
            entry = expected_members[relative]
            if entry["kind"] != "F" or int(entry["mode"]) != mode:
                _fail("sealed file kind or mode differs from its source: %s" % relative)
            size, raw_digest = payload
            assert isinstance(size, int) and isinstance(raw_digest, bytes)
            total_size += size
            if total_size > TREE_CEILING:
                _fail("sealed generation exceeds its reviewed size ceiling")
            if raw_digest.hex() != entry["digest"]:
                _fail("sealed file content differs from its source manifest: %s" % relative)
            _update_digest_field(digest, "size", str(size).encode("utf-8"))
            _update_digest_field(digest, "content-sha256", raw_digest)
        else:
            entry = expected_members[relative]
            target = payload
            assert isinstance(target, str)
            if (
                entry["kind"] != "L"
                or int(entry["mode"]) != mode
                or _sha256_bytes(target.encode("utf-8")) != entry["digest"]
            ):
                _fail("sealed symlink differs from its source manifest: %s" % relative)
            _update_digest_field(digest, "content", target.encode("utf-8"))

    mode_manifest = b"".join(
        (
            "%04o\t%s\n" % (int(entry["mode"]), entry["path"])
        ).encode("utf-8")
        for entry in entries
    )
    return {
        "algorithm": SNAPSHOT_FORMAT,
        "snapshotDigest": SNAPSHOT_PREFIX + digest.hexdigest(),
        "sourceModeManifestSha256": _sha256_bytes(mode_manifest),
        "sourceMemberCount": len(entries),
        "directoryCount": len(expected_directories),
        "treeBytes": total_size,
    }


def _remove_tree_at(parent_fd: int, name: str, owner_uid: int, owner_gid: int) -> None:
    """Descriptor-relative cleanup used only for an unpublished staging tree."""
    directory_fd = os.open(
        name,
        os.O_RDONLY | _DIRECTORY | _NOFOLLOW | _CLOEXEC,
        dir_fd=parent_fd,
    )
    try:
        metadata = os.fstat(directory_fd)
        if metadata.st_uid != owner_uid or metadata.st_gid != owner_gid:
            _fail("refusing to remove a staging tree with an unexpected owner")
        os.fchmod(directory_fd, 0o700)
        for child_name in os.listdir(directory_fd):
            child = os.stat(child_name, dir_fd=directory_fd, follow_symlinks=False)
            if stat.S_ISDIR(child.st_mode):
                _remove_tree_at(directory_fd, child_name, owner_uid, owner_gid)
            elif stat.S_ISREG(child.st_mode) or stat.S_ISLNK(child.st_mode):
                os.unlink(child_name, dir_fd=directory_fd)
            else:
                _fail("refusing to remove a special staging member")
    finally:
        os.close(directory_fd)
    os.rmdir(name, dir_fd=parent_fd)


def _fsync_directory(fd: int) -> None:
    try:
        os.fsync(fd)
    except OSError as error:
        if error.errno not in (errno.EINVAL, errno.ENOTSUP):
            raise


def _acquire_control_lock(
    base_fd: int,
    owner_uid: int,
    owner_gid: int,
) -> int:
    """Acquire the fixed root-controlled generation lifecycle lock."""
    created = False
    try:
        lock_fd = os.open(
            _CONTROL_LOCK_NAME,
            os.O_RDONLY | os.O_CREAT | os.O_EXCL | _NOFOLLOW | _CLOEXEC,
            0o444,
            dir_fd=base_fd,
        )
        created = True
    except FileExistsError:
        lock_fd = os.open(
            _CONTROL_LOCK_NAME,
            os.O_RDONLY | _NOFOLLOW | _CLOEXEC,
            dir_fd=base_fd,
        )
    try:
        fcntl.flock(lock_fd, fcntl.LOCK_EX)
        metadata = os.fstat(lock_fd)
        base = os.fstat(base_fd)
        if created:
            os.fchown(lock_fd, owner_uid, owner_gid)
            _clear_acl(lock_fd, "new trusted generation control lock")
            os.fchmod(lock_fd, 0o444)
            os.fsync(lock_fd)
            _fsync_directory(base_fd)
            metadata = os.fstat(lock_fd)
        if (
            not stat.S_ISREG(metadata.st_mode)
            or metadata.st_nlink != 1
            or metadata.st_uid != owner_uid
            or metadata.st_gid != owner_gid
            or metadata.st_dev != base.st_dev
            or _mode(metadata) != 0o444
        ):
            _fail("trusted generation control lock is not a sealed ordinary file")
        _require_empty_acl(lock_fd, "trusted generation control lock")
        return lock_fd
    except BaseException:
        os.close(lock_fd)
        raise


def _validate_recovery_tree(
    directory_fd: int,
    owner_uid: int,
    owner_gid: int,
    expected_device: int,
    label: str,
) -> None:
    """Validate a private, possibly half-built tree before crash recovery."""
    before = os.fstat(directory_fd)
    if (
        not stat.S_ISDIR(before.st_mode)
        or before.st_uid != owner_uid
        or before.st_gid != owner_gid
        or before.st_dev != expected_device
        or _mode(before) & 0o022
    ):
        _fail("%s is not a private trusted recovery directory" % label)
    _require_empty_acl(directory_fd, label)
    names = sorted(os.listdir(directory_fd))
    for name in names:
        if not name or name in (".", "..") or any(
            character in name for character in ("/", "\x00", "\r", "\n", "\t")
        ):
            _fail("%s contains an unsafe member name" % label)
        metadata = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
        if (
            metadata.st_uid != owner_uid
            or metadata.st_gid != owner_gid
            or metadata.st_dev != expected_device
        ):
            _fail("%s contains an unexpected owner or device" % label)
        if stat.S_ISDIR(metadata.st_mode):
            child = os.open(
                name,
                os.O_RDONLY | _DIRECTORY | _NOFOLLOW | _CLOEXEC,
                dir_fd=directory_fd,
            )
            try:
                _validate_recovery_tree(
                    child, owner_uid, owner_gid, expected_device, label
                )
            finally:
                os.close(child)
        elif stat.S_ISREG(metadata.st_mode):
            if metadata.st_nlink != 1 or _mode(metadata) & 0o022:
                _fail("%s contains an unsafe ordinary file" % label)
            child = os.open(
                name, os.O_RDONLY | _NOFOLLOW | _CLOEXEC, dir_fd=directory_fd
            )
            try:
                _require_empty_acl(child, "%s ordinary file" % label)
            finally:
                os.close(child)
        elif stat.S_ISLNK(metadata.st_mode):
            target = os.readlink(name, dir_fd=directory_fd)
            _safe_symlink_target(target, name)
        else:
            _fail("%s contains a special member" % label)
    if names != sorted(os.listdir(directory_fd)) or _stable(before) != _stable(
        os.fstat(directory_fd)
    ):
        _fail("%s changed while it was validated" % label)


def _recover_staging_trees(
    base_fd: int,
    owner_uid: int,
    owner_gid: int,
) -> int:
    """Remove only strict, root-controlled staging trees left by a dead helper."""
    base = os.fstat(base_fd)
    recovered = 0
    for name in sorted(os.listdir(base_fd)):
        if not name.startswith(".staging-"):
            continue
        if not _STAGING_RE.fullmatch(name):
            _fail("generation root contains a malformed staging recovery member")
        staging_fd = os.open(
            name,
            os.O_RDONLY | _DIRECTORY | _NOFOLLOW | _CLOEXEC,
            dir_fd=base_fd,
        )
        try:
            _validate_recovery_tree(
                staging_fd,
                owner_uid,
                owner_gid,
                base.st_dev,
                "trusted generation staging tree",
            )
        finally:
            os.close(staging_fd)
        _remove_tree_at(base_fd, name, owner_uid, owner_gid)
        recovered += 1
    if recovered:
        _fsync_directory(base_fd)
    return recovered


def _helper_identity(path: str, expected_uid: int, expected_gid: int) -> Mapping[str, object]:
    fd = _open_absolute_no_symlinks(path, os.O_RDONLY)
    try:
        metadata = os.fstat(fd)
        if (
            not stat.S_ISREG(metadata.st_mode)
            or metadata.st_nlink != 1
            or metadata.st_uid != expected_uid
            or metadata.st_gid != expected_gid
            or _mode(metadata) & 0o7222
        ):
            _fail("trusted helper is not a sealed root-owned ordinary file")
        _require_empty_acl(fd, "trusted helper")
        content = _read_fd(fd, 4 * 1024 * 1024, "trusted helper")
        return {
            "installedPath": path,
            "sha256": _sha256_bytes(content),
            "mode": "%04o" % _mode(metadata),
            "device": str(metadata.st_dev),
            "inode": str(metadata.st_ino),
        }
    finally:
        os.close(fd)


def _validate_scanner_uid(scanner_uid: int) -> Mapping[str, object]:
    if scanner_uid <= 0:
        _fail("scanner UID must identify a non-root local account")
    try:
        account = pwd.getpwuid(scanner_uid)
    except KeyError:
        _fail("scanner UID does not identify a local account")
    try:
        account.pw_name.encode("utf-8", "strict")
    except UnicodeEncodeError:
        _fail("scanner account identity is unsafe")
    if account.pw_gid == 0 or not account.pw_name or any(
        character in account.pw_name for character in ("\x00", "\r", "\n", "\t")
    ):
        _fail("scanner account identity is unsafe")
    return {
        "uid": scanner_uid,
        "gid": account.pw_gid,
        "name": account.pw_name,
    }


def _new_generation_id(now: datetime.datetime) -> str:
    return "ds-%s-%s" % (now.strftime("%Y%m%dT%H%M%SZ"), secrets.token_hex(8))


def _canonical_json(value: Mapping[str, object]) -> bytes:
    return (json.dumps(value, sort_keys=True, indent=2, ensure_ascii=False) + "\n").encode("utf-8")


def create_generation(
    source_root: str,
    source_manifest: str,
    scanner: Mapping[str, object],
    *,
    generations_root: str,
    owner_uid: int,
    owner_gid: int,
    helper_identity: Mapping[str, object],
    now: Optional[datetime.datetime] = None,
) -> Mapping[str, object]:
    """Pure boundary implementation; the public CLI hard-codes privileged values."""
    source_root = _safe_absolute_path(source_root, "source root")
    source_manifest = _safe_absolute_path(source_manifest, "source manifest")
    generations_root = _safe_absolute_path(generations_root, "generation root")
    if (
        source_root == generations_root
        or source_root.startswith(generations_root + "/")
        or generations_root.startswith(source_root + "/")
        or source_manifest == generations_root
        or source_manifest.startswith(generations_root + "/")
    ):
        _fail("source and manifest paths must not overlap the trusted generation root")
    source_fd = _open_absolute_no_symlinks(
        source_root, os.O_RDONLY | _DIRECTORY
    )
    manifest_fd = _open_absolute_no_symlinks(source_manifest, os.O_RDONLY)
    base_fd: Optional[int] = None
    control_lock_fd: Optional[int] = None
    staging_name: Optional[str] = None
    published = False
    previous_umask = os.umask(0o077)
    try:
        source_root_before = os.fstat(source_fd)
        if not stat.S_ISDIR(source_root_before.st_mode):
            _fail("source root is not an ordinary directory")
        source_root_mode = _safe_source_mode(source_root_before, ".", "directory")
        manifest_bytes = _read_fd(manifest_fd, MANIFEST_CEILING, "source manifest")
        entries = _parse_manifest(manifest_bytes)

        # Only the application-specific tail may be created.  The system-owned
        # /private/var/db ancestors must already exist and are never modified.
        base_parts = _path_parts(generations_root)
        base_fd = _ensure_owned_directory_chain(
            generations_root,
            owner_uid,
            owner_gid,
            max(3, len(base_parts) - 2),
            generations_root == GENERATIONS_ROOT
            and owner_uid == 0
            and owner_gid == 0,
        )
        control_lock_fd = _acquire_control_lock(base_fd, owner_uid, owner_gid)
        _recover_staging_trees(base_fd, owner_uid, owner_gid)
        timestamp = now or datetime.datetime.now(datetime.timezone.utc)
        if timestamp.tzinfo is None:
            _fail("generation timestamp must be timezone-aware")
        timestamp = timestamp.astimezone(datetime.timezone.utc).replace(microsecond=0)
        generation_id = _new_generation_id(timestamp)
        if not _GENERATION_RE.fullmatch(generation_id):
            _fail("internal generation identifier is invalid")
        staging_name = ".staging-%s" % secrets.token_hex(16)
        generation_fd = _create_directory_at(base_fd, staging_name, owner_uid, owner_gid, 0o700)
        try:
            destination_source_fd = _create_directory_at(
                generation_fd, "source", owner_uid, owner_gid, 0o700
            )
            try:
                directory_modes: Dict[str, int] = {}
                for parts in _required_directories(entries):
                    relative = "/".join(parts)
                    source_directory_fd = _open_relative_directory(source_fd, parts)
                    try:
                        source_directory_before = os.fstat(source_directory_fd)
                        if not stat.S_ISDIR(source_directory_before.st_mode):
                            _fail("source ancestor is not an ordinary directory: %s" % relative)
                        directory_mode = _safe_source_mode(
                            source_directory_before, relative, "directory"
                        )
                    finally:
                        os.close(source_directory_fd)
                    parent = _open_relative_directory(destination_source_fd, parts[:-1])
                    try:
                        child = _create_directory_at(
                            parent, parts[-1], owner_uid, owner_gid, 0o700
                        )
                        os.close(child)
                    finally:
                        os.close(parent)
                    directory_modes[relative] = directory_mode

                total_size = 0
                for entry in entries:
                    parts = entry["parts"]
                    assert isinstance(parts, tuple)
                    relative = str(entry["path"])
                    source_parent = _open_relative_directory(source_fd, parts[:-1])
                    destination_parent = _open_relative_directory(
                        destination_source_fd, parts[:-1]
                    )
                    try:
                        before = os.stat(
                            parts[-1], dir_fd=source_parent, follow_symlinks=False
                        )
                        if stat.S_ISREG(before.st_mode):
                            if entry["kind"] != "F":
                                _fail("source file kind differs from its manifest: %s" % relative)
                            copied, _ = _copy_file(
                                source_parent,
                                destination_parent,
                                parts[-1],
                                str(entry["digest"]),
                                relative,
                                owner_uid,
                                owner_gid,
                            )
                            entry["mode"] = _mode(before)
                            total_size += copied
                            if total_size > TREE_CEILING:
                                _fail("source tree exceeds its reviewed size ceiling")
                        elif stat.S_ISLNK(before.st_mode):
                            if entry["kind"] != "L":
                                _fail("source symlink kind differs from its manifest: %s" % relative)
                            target = os.readlink(parts[-1], dir_fd=source_parent)
                            _safe_symlink_target(target, relative)
                            after = os.stat(
                                parts[-1], dir_fd=source_parent, follow_symlinks=False
                            )
                            if (
                                _stable(before) != _stable(after)
                                or _sha256_bytes(target.encode("utf-8")) != entry["digest"]
                            ):
                                _fail("source symlink changed or differs from its manifest: %s" % relative)
                            os.symlink(target, parts[-1], dir_fd=destination_parent)
                            os.chown(
                                parts[-1],
                                owner_uid,
                                owner_gid,
                                dir_fd=destination_parent,
                                follow_symlinks=False,
                            )
                            os.chmod(
                                parts[-1],
                                _mode(before),
                                dir_fd=destination_parent,
                                follow_symlinks=False,
                            )
                            destination_link = os.stat(
                                parts[-1],
                                dir_fd=destination_parent,
                                follow_symlinks=False,
                            )
                            if _mode(destination_link) != _mode(before):
                                _fail("sealed symlink mode differs from its source: %s" % relative)
                            entry["mode"] = _mode(before)
                        else:
                            _fail("source manifest names a special member: %s" % relative)
                    finally:
                        os.close(source_parent)
                        os.close(destination_parent)

                for relative, mode in sorted(
                    directory_modes.items(),
                    key=lambda item: (-len(item[0].split("/")), _python_path_key(item[0])),
                ):
                    directory_fd = _open_relative_directory(
                        destination_source_fd, relative.split("/")
                    )
                    try:
                        os.fchmod(directory_fd, mode)
                        os.fchown(directory_fd, owner_uid, owner_gid)
                        _fsync_directory(directory_fd)
                    finally:
                        os.close(directory_fd)
                os.fchmod(destination_source_fd, source_root_mode)
                os.fchown(destination_source_fd, owner_uid, owner_gid)
                snapshot = _snapshot_target(
                    destination_source_fd,
                    entries,
                    directory_modes,
                    owner_uid,
                    owner_gid,
                )
                source_root_after = os.fstat(source_fd)
                if _stable(source_root_before) != _stable(source_root_after):
                    _fail("source root changed while the generation was created")
                source_identity = {
                    "device": str(source_root_before.st_dev),
                    "inode": str(source_root_before.st_ino),
                    "mode": "%04o" % source_root_mode,
                }
                target_identity_metadata = os.fstat(destination_source_fd)
                target_identity = {
                    "device": str(target_identity_metadata.st_dev),
                    "inode": str(target_identity_metadata.st_ino),
                    "mode": "%04o" % _mode(target_identity_metadata),
                }
                _fsync_directory(destination_source_fd)
            finally:
                os.close(destination_source_fd)

            final_generation_path = "%s/%s" % (generations_root, generation_id)
            final_source_path = "%s/source" % final_generation_path
            attestation = {
                "schema": ATTESTATION_SCHEMA,
                "schemaVersion": 1,
                "evidenceType": "trusted-macos-codex-security-generation",
                "generationId": generation_id,
                "createdAt": timestamp.isoformat().replace("+00:00", "Z"),
                "producer": dict(helper_identity),
                "sourceManifest": {
                    "sha256": _sha256_bytes(manifest_bytes),
                    "bytes": len(manifest_bytes),
                    "memberCount": len(entries),
                },
                "sourceRootIdentity": source_identity,
                "generation": {
                    "root": final_generation_path,
                    "source": final_source_path,
                    "ownerUid": owner_uid,
                    "ownerGid": owner_gid,
                    "rootMode": "0555",
                    "sourceIdentity": target_identity,
                },
                "scanner": {
                    "uid": int(scanner["uid"]),
                    "gid": int(scanner["gid"]),
                    "name": str(scanner["name"]),
                    "accessPolicy": "exact-posix-modes; other-read/search; no-group-or-world-write",
                },
                "snapshot": dict(snapshot),
                "boundary": {
                    "candidateCodeExecuted": False,
                    "descriptorRelativeTraversal": True,
                    "symlinkAncestorsFollowed": False,
                    "atomicPublish": True,
                    "atomicNoClobber": True,
                    "extendedAclEntries": False,
                    "exactManifestMembership": True,
                    "modePolicy": "preserve exact source mode and fail unless scanner-readable and scanner-nonwritable",
                    "attestationSignature": "none; externally pin this attestation hash and producer hash",
                },
                "runtime": {
                    "python": sys.version.split()[0],
                    "pythonExecutable": sys.executable,
                    "isolatedMode": bool(sys.flags.isolated),
                    "siteImportDisabled": bool(sys.flags.no_site),
                },
            }
            attestation_bytes = _canonical_json(attestation)
            attestation_fd = os.open(
                "attestation.json",
                os.O_WRONLY | os.O_CREAT | os.O_EXCL | _NOFOLLOW | _CLOEXEC,
                0o600,
                dir_fd=generation_fd,
            )
            try:
                os.fchown(attestation_fd, owner_uid, owner_gid)
                _clear_acl(attestation_fd, "new trusted generation attestation")
                _write_all(attestation_fd, attestation_bytes)
                os.fchmod(attestation_fd, 0o444)
                os.fsync(attestation_fd)
            finally:
                os.close(attestation_fd)
            os.fchmod(generation_fd, 0o555)
            _fsync_directory(generation_fd)
        finally:
            os.close(generation_fd)

        try:
            _rename_exclusive(base_fd, staging_name, base_fd, generation_id)
        except FileExistsError:
            _fail("generation identifier collision")
        published = True
        _fsync_directory(base_fd)
        return {
            "ok": True,
            "generationId": generation_id,
            "generationRoot": "%s/%s" % (generations_root, generation_id),
            "scanSource": "%s/%s/source" % (generations_root, generation_id),
            "attestation": "%s/%s/attestation.json" % (generations_root, generation_id),
            "attestationSha256": _sha256_bytes(attestation_bytes),
            "sourceManifestSha256": _sha256_bytes(manifest_bytes),
            "snapshotDigest": snapshot["snapshotDigest"],
            "producerSha256": helper_identity["sha256"],
        }
    except BaseException:
        if base_fd is not None and staging_name is not None and not published:
            try:
                _remove_tree_at(base_fd, staging_name, owner_uid, owner_gid)
            except (FileNotFoundError, BoundaryError, OSError):
                pass
        raise
    finally:
        os.umask(previous_umask)
        os.close(source_fd)
        os.close(manifest_fd)
        if control_lock_fd is not None:
            os.close(control_lock_fd)
        if base_fd is not None:
            os.close(base_fd)


def _arguments(argv: Sequence[str]) -> Mapping[str, str]:
    result: Dict[str, str] = {}
    allowed = {"--source-root", "--source-manifest", "--scanner-uid"}
    if not argv or len(argv) % 2:
        _fail("invalid trusted generation arguments")
    for index in range(0, len(argv), 2):
        key, value = argv[index], argv[index + 1]
        if key not in allowed or key in result or not value or value.startswith("--"):
            _fail("invalid trusted generation arguments")
        result[key] = value
    if set(result) != allowed:
        _fail("usage requires --source-root, --source-manifest, and --scanner-uid")
    return result


def _assert_trusted_runtime() -> Mapping[str, object]:
    if sys.platform != "darwin":
        _fail("trusted generation helper is macOS-only")
    if os.geteuid() != 0 or os.getegid() != 0:
        _fail("trusted generation helper requires UID/GID 0")
    if (
        not sys.flags.isolated
        or not sys.flags.no_site
        or not sys.flags.no_user_site
        or not sys.flags.ignore_environment
    ):
        _fail("invoke the trusted generation helper with /usr/bin/python3 -I -S")
    if os.path.abspath(__file__) != TRUSTED_INSTALL_PATH:
        _fail("refusing to run the root helper outside its fixed installed path")
    # Verify the install directory itself; the caller must additionally pin the
    # helper hash from an independently trusted release/control plane.
    install_parent = os.path.dirname(TRUSTED_INSTALL_PATH)
    library_fd = _open_absolute_no_symlinks(
        "/Library", os.O_RDONLY | _DIRECTORY
    )
    parent_fd = _open_absolute_no_symlinks(
        install_parent, os.O_RDONLY | _DIRECTORY
    )
    try:
        library = os.fstat(library_fd)
        parent = os.fstat(parent_fd)
        if (
            library.st_uid != 0
            or library.st_gid != 0
            or not stat.S_ISDIR(library.st_mode)
            or _mode(library) & 0o022
            or parent.st_uid != 0
            or parent.st_gid != 0
            or not stat.S_ISDIR(parent.st_mode)
            or _mode(parent) & 0o022
        ):
            _fail("trusted helper directory is not sealed root:wheel")
        _require_empty_acl(library_fd, "/Library")
        _require_empty_acl(parent_fd, "trusted helper directory")
    finally:
        os.close(library_fd)
        os.close(parent_fd)
    return _helper_identity(TRUSTED_INSTALL_PATH, 0, 0)


def main(argv: Sequence[str]) -> int:
    try:
        arguments = _arguments(argv)
        helper = _assert_trusted_runtime()
        try:
            scanner_uid = int(arguments["--scanner-uid"], 10)
        except ValueError:
            _fail("scanner UID must be a decimal integer")
        scanner = _validate_scanner_uid(scanner_uid)
        result = create_generation(
            arguments["--source-root"],
            arguments["--source-manifest"],
            scanner,
            generations_root=GENERATIONS_ROOT,
            owner_uid=0,
            owner_gid=0,
            helper_identity=helper,
        )
        sys.stdout.write(json.dumps(result, sort_keys=True, separators=(",", ":")) + "\n")
        return 0
    except (BoundaryError, OSError, ValueError) as error:
        message = str(error).replace("\r", " ").replace("\n", " ")[:500]
        sys.stderr.write(
            json.dumps({"ok": False, "error": message}, sort_keys=True, separators=(",", ":"))
            + "\n"
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
