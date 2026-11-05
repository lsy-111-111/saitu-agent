#!/usr/bin/python3
"""Remove one attestation-bound trusted macOS Deep Scan generation.

The trusted control plane must invoke this installed file as
``/usr/bin/python3 -I -S CLEANUP_INSTALL_PATH``.  No caller-controlled path is
accepted: the helper resolves a strict generation ID beneath GENERATIONS_ROOT,
checks its root-owned seal and attestation hash, atomically tombstones it, and
then performs descriptor-relative deletion without following symlinks.
"""

from __future__ import annotations

import ctypes
import errno
import fcntl
import hashlib
import json
import os
import re
import stat
import sys
from typing import Dict, Mapping, Optional, Sequence, Tuple


CLEANUP_INSTALL_PATH = (
    "/Library/PrivilegedHelperTools/"
    "com.siyuanjiaxin.resume-ai.cleanup-deep-scan-generation"
)
CREATOR_INSTALL_PATH = (
    "/Library/PrivilegedHelperTools/"
    "com.siyuanjiaxin.resume-ai.create-deep-scan-generation"
)
GENERATIONS_ROOT = (
    "/private/var/db/com.siyuanjiaxin.resume-ai/deep-scan-generations"
)
ATTESTATION_SCHEMA = "com.siyuanjiaxin.resume-ai.deep-scan-generation/v1"
ATTESTATION_CEILING = 256 * 1024
_GENERATION_RE = re.compile(r"^ds-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{16}$")
_HEX64_RE = re.compile(r"^[a-f0-9]{64}$")
_SNAPSHOT_RE = re.compile(
    r"^codex-security-snapshot/v1:sha256:[a-f0-9]{64}$"
)
_NOFOLLOW = getattr(os, "O_NOFOLLOW", 0)
_DIRECTORY = getattr(os, "O_DIRECTORY", 0)
_CLOEXEC = getattr(os, "O_CLOEXEC", 0)
_ACL_TYPE_EXTENDED = 0x00000100
_RENAME_EXCL = 0x00000004
_LIBSYSTEM = None
_CONTROL_LOCK_NAME = ".control.lock"
_TOMBSTONE_RE = re.compile(
    r"^\.deleting-(ds-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{16})-"
    r"([a-f0-9]{64}|[a-f0-9]{16})$"
)


class BoundaryError(RuntimeError):
    """A fail-closed cleanup boundary violation."""


def _fail(message: str) -> None:
    raise BoundaryError(message)


def _mode(metadata: os.stat_result) -> int:
    return stat.S_IMODE(metadata.st_mode)


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


def _require_empty_acl(fd: int, label: str) -> None:
    library = _libsystem()
    if library is None:
        return
    ctypes.set_errno(0)
    acl = library.acl_get_fd_np(fd, _ACL_TYPE_EXTENDED)
    if not acl:
        if ctypes.get_errno() == errno.ENOENT:
            return
        _fail("cannot inspect the extended ACL on %s" % label)
    text_pointer = None
    try:
        length = ctypes.c_ssize_t()
        text_pointer = library.acl_to_text(acl, ctypes.byref(length))
        if not text_pointer:
            _fail("cannot serialize the extended ACL on %s" % label)
        if ctypes.string_at(text_pointer, length.value):
            _fail("%s has an extended ACL that mode bits cannot prove safe" % label)
    finally:
        if text_pointer:
            library.acl_free(text_pointer)
        library.acl_free(acl)


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


def _safe_absolute_path(value: str, label: str) -> str:
    try:
        value.encode("utf-8", "strict")
    except UnicodeEncodeError:
        _fail("%s must be valid UTF-8" % label)
    if (
        not value
        or "\x00" in value
        or "\r" in value
        or "\n" in value
        or "\t" in value
        or not os.path.isabs(value)
        or value != os.path.normpath(value)
        or value == "/"
    ):
        _fail("%s must be a normalized absolute path" % label)
    return value


def _path_parts(absolute: str):
    _safe_absolute_path(absolute, "path")
    parts = absolute.split("/")[1:]
    if any(not part or part in (".", "..") for part in parts):
        _fail("absolute path contains an unsafe component")
    return parts


def _open_absolute_no_symlinks(absolute: str, final_flags: int) -> int:
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


def _read_file_at(
    parent_fd: int,
    name: str,
    ceiling: int,
    owner_uid: int,
    owner_gid: int,
) -> bytes:
    fd = os.open(name, os.O_RDONLY | _NOFOLLOW | _CLOEXEC, dir_fd=parent_fd)
    try:
        before = os.fstat(fd)
        if (
            not stat.S_ISREG(before.st_mode)
            or before.st_nlink != 1
            or before.st_uid != owner_uid
            or before.st_gid != owner_gid
            or before.st_size < 0
            or before.st_size > ceiling
            or _mode(before) != 0o444
        ):
            _fail("generation attestation is not a sealed ordinary file")
        _require_empty_acl(fd, "generation attestation")
        chunks = []
        total = 0
        while True:
            chunk = os.read(fd, min(1024 * 1024, ceiling - total + 1))
            if not chunk:
                break
            total += len(chunk)
            if total > ceiling:
                _fail("generation attestation exceeds its reviewed size ceiling")
            chunks.append(chunk)
        if _stable(before) != _stable(os.fstat(fd)):
            _fail("generation attestation changed while it was read")
        return b"".join(chunks)
    finally:
        os.close(fd)


def _validate_attestation(
    value: object,
    generation_id: str,
    generations_root: str,
    owner_uid: int,
    owner_gid: int,
    expected_creator_path: str,
) -> Mapping[str, object]:
    if not isinstance(value, dict):
        _fail("generation attestation is not an object")
    generation = value.get("generation")
    producer = value.get("producer")
    snapshot = value.get("snapshot")
    boundary = value.get("boundary")
    expected_root = "%s/%s" % (generations_root, generation_id)
    if (
        value.get("schema") != ATTESTATION_SCHEMA
        or value.get("schemaVersion") != 1
        or value.get("evidenceType") != "trusted-macos-codex-security-generation"
        or value.get("generationId") != generation_id
        or not isinstance(generation, dict)
        or generation.get("root") != expected_root
        or generation.get("source") != "%s/source" % expected_root
        or generation.get("ownerUid") != owner_uid
        or generation.get("ownerGid") != owner_gid
        or generation.get("rootMode") != "0555"
        or not isinstance(producer, dict)
        or producer.get("installedPath") != expected_creator_path
        or not _HEX64_RE.fullmatch(str(producer.get("sha256", "")))
        or not isinstance(snapshot, dict)
        or not _SNAPSHOT_RE.fullmatch(str(snapshot.get("snapshotDigest", "")))
        or not isinstance(boundary, dict)
        or boundary.get("candidateCodeExecuted") is not False
        or boundary.get("descriptorRelativeTraversal") is not True
        or boundary.get("atomicNoClobber") is not True
        or boundary.get("extendedAclEntries") is not False
        or boundary.get("exactManifestMembership") is not True
    ):
        _fail("generation attestation does not match the trusted boundary contract")
    return value


def _validate_tree(
    directory_fd: int,
    owner_uid: int,
    owner_gid: int,
    expected_device: int,
) -> None:
    before = os.fstat(directory_fd)
    if (
        not stat.S_ISDIR(before.st_mode)
        or before.st_uid != owner_uid
        or before.st_gid != owner_gid
        or before.st_dev != expected_device
        or _mode(before) & 0o022
        or _mode(before) & 0o005 != 0o005
    ):
        _fail("generation contains an unsealed or cross-device directory")
    _require_empty_acl(directory_fd, "generation directory")
    names = sorted(os.listdir(directory_fd))
    for name in names:
        if not name or name in (".", "..") or any(
            character in name for character in ("/", "\x00", "\r", "\n", "\t")
        ):
            _fail("generation contains an unsafe member name")
        metadata = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
        if metadata.st_uid != owner_uid or metadata.st_gid != owner_gid or metadata.st_dev != expected_device:
            _fail("generation member has an unexpected owner or device")
        mode = _mode(metadata)
        if stat.S_ISDIR(metadata.st_mode):
            child = os.open(
                name,
                os.O_RDONLY | _DIRECTORY | _NOFOLLOW | _CLOEXEC,
                dir_fd=directory_fd,
            )
            try:
                _validate_tree(child, owner_uid, owner_gid, expected_device)
            finally:
                os.close(child)
        elif stat.S_ISREG(metadata.st_mode):
            if metadata.st_nlink != 1 or mode & 0o022 or mode & 0o004 != 0o004:
                _fail("generation contains an unsealed ordinary file")
            file_fd = os.open(
                name, os.O_RDONLY | _NOFOLLOW | _CLOEXEC, dir_fd=directory_fd
            )
            try:
                _require_empty_acl(file_fd, "generation ordinary file")
            finally:
                os.close(file_fd)
        elif stat.S_ISLNK(metadata.st_mode):
            target = os.readlink(name, dir_fd=directory_fd)
            try:
                target.encode("utf-8", "strict")
            except UnicodeEncodeError:
                _fail("generation contains a non-UTF-8 symlink")
            if (
                not target
                or target.startswith("/")
                or "\x00" in target
                or "\r" in target
                or "\n" in target
                or ".." in target.split("/")
            ):
                _fail("generation contains an escaping symlink")
        else:
            _fail("generation contains a special member")
    if names != sorted(os.listdir(directory_fd)) or _stable(before) != _stable(os.fstat(directory_fd)):
        _fail("generation changed while cleanup validated it")


def _remove_tree_at(
    parent_fd: int,
    name: str,
    owner_uid: int,
    owner_gid: int,
    expected_device: int,
) -> None:
    directory_fd = os.open(
        name,
        os.O_RDONLY | _DIRECTORY | _NOFOLLOW | _CLOEXEC,
        dir_fd=parent_fd,
    )
    try:
        metadata = os.fstat(directory_fd)
        if (
            metadata.st_uid != owner_uid
            or metadata.st_gid != owner_gid
            or metadata.st_dev != expected_device
            or not stat.S_ISDIR(metadata.st_mode)
        ):
            _fail("refusing to remove an unexpected cleanup tree")
        os.fchmod(directory_fd, 0o700)
        for child_name in os.listdir(directory_fd):
            child = os.stat(child_name, dir_fd=directory_fd, follow_symlinks=False)
            if child.st_uid != owner_uid or child.st_gid != owner_gid or child.st_dev != expected_device:
                _fail("refusing to remove an unexpected cleanup member")
            if stat.S_ISDIR(child.st_mode):
                _remove_tree_at(
                    directory_fd,
                    child_name,
                    owner_uid,
                    owner_gid,
                    expected_device,
                )
            elif stat.S_ISREG(child.st_mode) or stat.S_ISLNK(child.st_mode):
                os.unlink(child_name, dir_fd=directory_fd)
            else:
                _fail("refusing to remove a special cleanup member")
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
) -> None:
    """Validate a root-controlled, possibly half-deleted tombstone."""
    before = os.fstat(directory_fd)
    if (
        not stat.S_ISDIR(before.st_mode)
        or before.st_uid != owner_uid
        or before.st_gid != owner_gid
        or before.st_dev != expected_device
        or _mode(before) & 0o022
    ):
        _fail("cleanup tombstone is not a private trusted directory")
    _require_empty_acl(directory_fd, "cleanup tombstone directory")
    names = sorted(os.listdir(directory_fd))
    for name in names:
        if not name or name in (".", "..") or any(
            character in name for character in ("/", "\x00", "\r", "\n", "\t")
        ):
            _fail("cleanup tombstone contains an unsafe member name")
        metadata = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
        if (
            metadata.st_uid != owner_uid
            or metadata.st_gid != owner_gid
            or metadata.st_dev != expected_device
        ):
            _fail("cleanup tombstone contains an unexpected owner or device")
        if stat.S_ISDIR(metadata.st_mode):
            child = os.open(
                name,
                os.O_RDONLY | _DIRECTORY | _NOFOLLOW | _CLOEXEC,
                dir_fd=directory_fd,
            )
            try:
                _validate_recovery_tree(
                    child, owner_uid, owner_gid, expected_device
                )
            finally:
                os.close(child)
        elif stat.S_ISREG(metadata.st_mode):
            if metadata.st_nlink != 1 or _mode(metadata) & 0o022:
                _fail("cleanup tombstone contains an unsafe ordinary file")
            child = os.open(
                name, os.O_RDONLY | _NOFOLLOW | _CLOEXEC, dir_fd=directory_fd
            )
            try:
                _require_empty_acl(child, "cleanup tombstone ordinary file")
            finally:
                os.close(child)
        elif not stat.S_ISLNK(metadata.st_mode):
            _fail("cleanup tombstone contains a special member")
    if names != sorted(os.listdir(directory_fd)) or _stable(before) != _stable(
        os.fstat(directory_fd)
    ):
        _fail("cleanup tombstone changed while it was validated")


def _recover_deleting_trees(
    base_fd: int,
    owner_uid: int,
    owner_gid: int,
) -> Mapping[str, str]:
    """Resume strict tombstones whose atomic rename already recorded intent."""
    base = os.fstat(base_fd)
    recovered: Dict[str, str] = {}
    for name in sorted(os.listdir(base_fd)):
        if not name.startswith(".deleting-"):
            continue
        match = _TOMBSTONE_RE.fullmatch(name)
        if match is None:
            _fail("generation root contains a malformed cleanup tombstone")
        tombstone_fd = os.open(
            name,
            os.O_RDONLY | _DIRECTORY | _NOFOLLOW | _CLOEXEC,
            dir_fd=base_fd,
        )
        try:
            _validate_recovery_tree(
                tombstone_fd, owner_uid, owner_gid, base.st_dev
            )
        finally:
            os.close(tombstone_fd)
        _remove_tree_at(
            base_fd, name, owner_uid, owner_gid, base.st_dev
        )
        recovered[match.group(1)] = match.group(2)
    if recovered:
        _fsync_directory(base_fd)
    return recovered


def cleanup_generation(
    generation_id: str,
    expected_attestation_sha256: str,
    *,
    generations_root: str,
    owner_uid: int,
    owner_gid: int,
    expected_creator_path: str,
) -> Mapping[str, object]:
    if not _GENERATION_RE.fullmatch(generation_id):
        _fail("generation ID is invalid")
    if not _HEX64_RE.fullmatch(expected_attestation_sha256):
        _fail("expected attestation SHA-256 is invalid")
    generations_root = _safe_absolute_path(generations_root, "generation root")
    base_fd = _open_absolute_no_symlinks(
        generations_root, os.O_RDONLY | _DIRECTORY
    )
    control_lock_fd: Optional[int] = None
    generation_fd: Optional[int] = None
    tombstone: Optional[str] = None
    try:
        base = os.fstat(base_fd)
        if (
            not stat.S_ISDIR(base.st_mode)
            or base.st_uid != owner_uid
            or base.st_gid != owner_gid
            or _mode(base) & 0o022
        ):
            _fail("generation root is not owned and sealed by the trusted owner")
        _require_empty_acl(base_fd, "generation root")
        control_lock_fd = _acquire_control_lock(base_fd, owner_uid, owner_gid)
        recovered = _recover_deleting_trees(base_fd, owner_uid, owner_gid)
        try:
            generation_fd = os.open(
                generation_id,
                os.O_RDONLY | _DIRECTORY | _NOFOLLOW | _CLOEXEC,
                dir_fd=base_fd,
            )
        except FileNotFoundError:
            return {
                "ok": True,
                "removedGenerationId": generation_id,
                "attestationSha256": expected_attestation_sha256,
                "alreadyRemoved": True,
                "recoveredAfterCrash": generation_id in recovered,
            }
        generation_before = os.fstat(generation_fd)
        if (
            not stat.S_ISDIR(generation_before.st_mode)
            or generation_before.st_uid != owner_uid
            or generation_before.st_gid != owner_gid
            or generation_before.st_dev != base.st_dev
            or _mode(generation_before) != 0o555
        ):
            _fail("generation is not a sealed trusted directory")
        _require_empty_acl(generation_fd, "generation wrapper")
        if set(os.listdir(generation_fd)) != {"source", "attestation.json"}:
            _fail("generation top-level membership is unexpected")
        attestation_bytes = _read_file_at(
            generation_fd,
            "attestation.json",
            ATTESTATION_CEILING,
            owner_uid,
            owner_gid,
        )
        if hashlib.sha256(attestation_bytes).hexdigest() != expected_attestation_sha256:
            _fail("generation attestation SHA-256 does not match the trusted caller pin")
        try:
            attestation = json.loads(attestation_bytes.decode("utf-8", "strict"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            _fail("generation attestation is not canonical UTF-8 JSON")
        _validate_attestation(
            attestation,
            generation_id,
            generations_root,
            owner_uid,
            owner_gid,
            expected_creator_path,
        )
        source_fd = os.open(
            "source",
            os.O_RDONLY | _DIRECTORY | _NOFOLLOW | _CLOEXEC,
            dir_fd=generation_fd,
        )
        try:
            _validate_tree(source_fd, owner_uid, owner_gid, generation_before.st_dev)
        finally:
            os.close(source_fd)
        observed = os.stat(generation_id, dir_fd=base_fd, follow_symlinks=False)
        if _stable(observed) != _stable(generation_before):
            _fail("generation changed before cleanup isolation")
        tombstone = ".deleting-%s-%s" % (
            generation_id,
            expected_attestation_sha256,
        )
        _rename_exclusive(base_fd, generation_id, base_fd, tombstone)
        renamed = os.stat(tombstone, dir_fd=base_fd, follow_symlinks=False)
        if renamed.st_dev != generation_before.st_dev or renamed.st_ino != generation_before.st_ino:
            _fail("cleanup tombstone identity differs from the validated generation")
        # Persist deletion intent before removing any member.  A dead helper can
        # therefore resume only a root-controlled, exact-name tombstone.
        _fsync_directory(base_fd)
        os.close(generation_fd)
        generation_fd = None
        _remove_tree_at(
            base_fd,
            tombstone,
            owner_uid,
            owner_gid,
            generation_before.st_dev,
        )
        tombstone = None
        _fsync_directory(base_fd)
        return {
            "ok": True,
            "removedGenerationId": generation_id,
            "attestationSha256": expected_attestation_sha256,
            "alreadyRemoved": False,
            "recoveredAfterCrash": False,
        }
    finally:
        if generation_fd is not None:
            os.close(generation_fd)
        if control_lock_fd is not None:
            os.close(control_lock_fd)
        os.close(base_fd)


def _arguments(argv: Sequence[str]) -> Mapping[str, str]:
    result: Dict[str, str] = {}
    allowed = {"--generation-id", "--expected-attestation-sha256"}
    if not argv or len(argv) % 2:
        _fail("invalid trusted cleanup arguments")
    for index in range(0, len(argv), 2):
        key, value = argv[index], argv[index + 1]
        if key not in allowed or key in result or not value or value.startswith("--"):
            _fail("invalid trusted cleanup arguments")
        result[key] = value
    if set(result) != allowed:
        _fail("usage requires --generation-id and --expected-attestation-sha256")
    return result


def _assert_trusted_runtime() -> None:
    if sys.platform != "darwin":
        _fail("trusted cleanup helper is macOS-only")
    if os.geteuid() != 0 or os.getegid() != 0:
        _fail("trusted cleanup helper requires UID/GID 0")
    if (
        not sys.flags.isolated
        or not sys.flags.no_site
        or not sys.flags.no_user_site
        or not sys.flags.ignore_environment
    ):
        _fail("invoke the trusted cleanup helper with /usr/bin/python3 -I -S")
    if os.path.abspath(__file__) != CLEANUP_INSTALL_PATH:
        _fail("refusing to run the root helper outside its fixed installed path")
    library_fd = _open_absolute_no_symlinks(
        "/Library", os.O_RDONLY | _DIRECTORY
    )
    parent_fd = _open_absolute_no_symlinks(
        os.path.dirname(CLEANUP_INSTALL_PATH), os.O_RDONLY | _DIRECTORY
    )
    helper_fd = _open_absolute_no_symlinks(CLEANUP_INSTALL_PATH, os.O_RDONLY)
    try:
        library = os.fstat(library_fd)
        parent = os.fstat(parent_fd)
        helper = os.fstat(helper_fd)
        if (
            not stat.S_ISDIR(library.st_mode)
            or library.st_uid != 0
            or library.st_gid != 0
            or _mode(library) & 0o022
            or not stat.S_ISDIR(parent.st_mode)
            or parent.st_uid != 0
            or parent.st_gid != 0
            or _mode(parent) & 0o022
            or not stat.S_ISREG(helper.st_mode)
            or helper.st_nlink != 1
            or helper.st_uid != 0
            or helper.st_gid != 0
            or _mode(helper) & 0o7222
        ):
            _fail("trusted cleanup helper installation is not sealed root:wheel")
        _require_empty_acl(library_fd, "/Library")
        _require_empty_acl(parent_fd, "trusted cleanup helper directory")
        _require_empty_acl(helper_fd, "trusted cleanup helper")
    finally:
        os.close(library_fd)
        os.close(parent_fd)
        os.close(helper_fd)


def main(argv: Sequence[str]) -> int:
    try:
        arguments = _arguments(argv)
        _assert_trusted_runtime()
        result = cleanup_generation(
            arguments["--generation-id"],
            arguments["--expected-attestation-sha256"],
            generations_root=GENERATIONS_ROOT,
            owner_uid=0,
            owner_gid=0,
            expected_creator_path=CREATOR_INSTALL_PATH,
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
