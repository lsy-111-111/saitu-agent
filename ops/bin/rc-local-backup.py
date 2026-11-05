#!/usr/bin/python3
"""Create, verify, and explicitly restore one rc-local migration backup."""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import pathlib
import secrets
import stat
import subprocess
import sys
from typing import Any


SCHEMA_VERSION = 1
PRODUCTION_BACKUP_ROOT = pathlib.Path("/var/backups/resume-ai/rc-local")
STATUS_MEMBER = "rc-local-status.txt"
MANIFEST_MEMBER = "BACKUP_MANIFEST.json"
CHECKSUM_MEMBER = "SHA256SUMS"
COMPLETE_MEMBER = "BACKUP_COMPLETE.json"
RESTORE_STATE_DIR = pathlib.Path("/var/lib/resume-ai/security")
RESTORE_PENDING = RESTORE_STATE_DIR / "rc-local-restore.pending"
MAPPINGS = (
    ("/etc/rc.local", "rc.local", True),
    ("/etc/rc.d/rc.local", "rc.d-rc-local", True),
    ("/etc/udev/rules.d/80-qcloud-nic.rules", "80-qcloud-nic.rules", True),
    ("/etc/systemd/system/rc-local.service", "rc-local.service.previous", False),
    (
        "/etc/systemd/system/resume-ai-qcloud-network-tuning@.service",
        "resume-ai-qcloud-network-tuning@.service.previous",
        False,
    ),
    (
        "/usr/local/lib/resume-ai/run-qcloud-network-tuning.sh",
        "run-qcloud-network-tuning.sh.previous",
        False,
    ),
    (
        "/usr/local/lib/resume-ai/qcloud-network-control.py",
        "qcloud-network-control.py.previous",
        False,
    ),
    (
        "/usr/local/lib/resume-ai/rc-local-backup.py",
        "rc-local-backup.py.previous",
        False,
    ),
    (
        "/usr/local/share/resume-ai/approved-qcloud-network-tuning.conf",
        "approved-qcloud-network-tuning.conf.previous",
        False,
    ),
)
EXPECTED_PATHS = tuple(item[0] for item in MAPPINGS)
EXPECTED_MEMBERS = {item[1] for item in MAPPINGS}
BASE_MEMBERS = {STATUS_MEMBER, MANIFEST_MEMBER, CHECKSUM_MEMBER, COMPLETE_MEMBER}


class BackupError(RuntimeError):
    pass


def fail(message: str) -> "NoReturn":
    raise BackupError(message)


def canonical_json(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=True, separators=(",", ":"), sort_keys=True) + "\n").encode(
        "ascii"
    )


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_path(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    flags = os.O_RDONLY | os.O_NOFOLLOW
    descriptor = os.open(path, flags)
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode):
            fail(f"checksum member is not a regular file: {path}")
        while True:
            chunk = os.read(descriptor, 1024 * 1024)
            if not chunk:
                return digest.hexdigest()
            digest.update(chunk)
    finally:
        os.close(descriptor)


def stable(metadata: os.stat_result) -> tuple[int, ...]:
    return (
        metadata.st_dev,
        metadata.st_ino,
        metadata.st_mode,
        metadata.st_nlink,
        metadata.st_size,
        metadata.st_mtime_ns,
        metadata.st_ctime_ns,
    )


def normalize_absolute(raw: str, label: str) -> pathlib.Path:
    value = pathlib.Path(raw)
    if not value.is_absolute() or any(part in {".", ".."} for part in value.parts):
        fail(f"{label} must be a normalized absolute path")
    return value


def lstat_directory(
    path: pathlib.Path,
    owner_uid: int | None,
    exact_mode: int | None = 0o700,
) -> os.stat_result:
    try:
        metadata = os.lstat(path)
    except OSError as error:
        fail(f"directory is unavailable: {path}: {error}")
    if not stat.S_ISDIR(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode):
        fail(f"path is not an ordinary directory: {path}")
    if owner_uid is not None and metadata.st_uid != owner_uid:
        fail(f"directory has an unexpected owner: {path}")
    if exact_mode is not None:
        if stat.S_IMODE(metadata.st_mode) != exact_mode:
            fail(f"directory has an unexpected mode: {path}")
    elif stat.S_IMODE(metadata.st_mode) & 0o022:
        fail(f"directory is group/world writable: {path}")
    return metadata


def rooted(source_root: pathlib.Path, absolute: str) -> pathlib.Path:
    value = pathlib.PurePosixPath(absolute)
    if source_root == pathlib.Path("/"):
        return pathlib.Path(absolute)
    return source_root.joinpath(*value.parts[1:])


def write_regular_atomic(path: pathlib.Path, value: bytes, mode: int = 0o600) -> None:
    temporary = path.parent / f".{path.name}.{secrets.token_hex(8)}"
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW
    descriptor = os.open(temporary, flags, mode)
    try:
        offset = 0
        while offset < len(value):
            offset += os.write(descriptor, value[offset:])
        os.fchmod(descriptor, mode)
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    os.replace(temporary, path)
    fsync_directory(path.parent)


def fsync_directory(path: pathlib.Path) -> None:
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def copy_regular(source: pathlib.Path, destination: pathlib.Path) -> dict[str, Any]:
    source_flags = os.O_RDONLY | os.O_NOFOLLOW
    source_fd = os.open(source, source_flags)
    destination_fd: int | None = None
    try:
        before = os.fstat(source_fd)
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1:
            fail(f"backup source is linked or special: {source}")
        destination_fd = os.open(
            destination,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
            0o600,
        )
        digest = hashlib.sha256()
        size = 0
        while True:
            chunk = os.read(source_fd, 1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
            size += len(chunk)
            offset = 0
            while offset < len(chunk):
                offset += os.write(destination_fd, chunk[offset:])
        os.fchown(destination_fd, before.st_uid, before.st_gid)
        os.fchmod(destination_fd, stat.S_IMODE(before.st_mode))
        os.fsync(destination_fd)
        after = os.fstat(source_fd)
        try:
            path_after = os.lstat(source)
        except OSError as error:
            fail(f"backup source changed while copied: {source}: {error}")
        if stable(before) != stable(after) or stable(before) != stable(path_after):
            fail(f"backup source changed while copied: {source}")
        copied = os.fstat(destination_fd)
        if copied.st_size != size or sha256_path(destination) != digest.hexdigest():
            fail(f"backup copy differs from its stable source: {source}")
        return {
            "state": "present",
            "kind": "file",
            "mode": f"{stat.S_IMODE(before.st_mode):04o}",
            "uid": before.st_uid,
            "gid": before.st_gid,
            "nlink": before.st_nlink,
            "size": size,
            "sha256": digest.hexdigest(),
        }
    finally:
        os.close(source_fd)
        if destination_fd is not None:
            os.close(destination_fd)


def copy_symlink(source: pathlib.Path, destination: pathlib.Path) -> dict[str, Any]:
    before = os.lstat(source)
    if not stat.S_ISLNK(before.st_mode) or before.st_nlink != 1:
        fail(f"backup source is not a single symlink: {source}")
    target = os.readlink(source)
    after = os.lstat(source)
    if stable(before) != stable(after) or os.readlink(source) != target:
        fail(f"backup symlink changed while copied: {source}")
    os.symlink(target, destination)
    os.lchown(destination, before.st_uid, before.st_gid)
    copied = os.lstat(destination)
    if not stat.S_ISLNK(copied.st_mode) or os.readlink(destination) != target:
        fail(f"backup symlink differs from its source: {source}")
    return {
        "state": "present",
        "kind": "symlink",
        "mode": f"{stat.S_IMODE(before.st_mode):04o}",
        "uid": before.st_uid,
        "gid": before.st_gid,
        "nlink": before.st_nlink,
        "target": target,
    }


def validate_source_entry(
    source_root: pathlib.Path,
    source_path: str,
    required: bool,
    production: bool,
) -> tuple[pathlib.Path, os.stat_result | None]:
    source = rooted(source_root, source_path)
    try:
        metadata = os.lstat(source)
    except FileNotFoundError:
        if required:
            fail(f"required backup source is absent: {source_path}")
        return (source, None)
    except OSError as error:
        fail(f"backup source could not be inspected: {source_path}: {error}")
    if not (stat.S_ISREG(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode)):
        fail(f"backup source is special or a directory: {source_path}")
    if metadata.st_nlink != 1:
        fail(f"backup source has multiple links: {source_path}")
    if production and (metadata.st_uid != 0 or metadata.st_gid != 0):
        fail(f"production backup source is not root-owned: {source_path}")
    if stat.S_ISREG(metadata.st_mode) and stat.S_IMODE(metadata.st_mode) & 0o022:
        fail(f"backup source is group/world writable: {source_path}")
    if source_path == "/etc/rc.d/rc.local":
        if not stat.S_ISLNK(metadata.st_mode) or os.readlink(source) != "/etc/rc.local":
            fail("rc.d backup source is not the exact preserved rc.local link")
    elif required and not stat.S_ISREG(metadata.st_mode):
        fail(f"required backup source has an unexpected type: {source_path}")
    if source_path == "/etc/udev/rules.d/80-qcloud-nic.rules" and stat.S_IMODE(metadata.st_mode) != 0o644:
        fail("QCloud udev rule has an unexpected pre-migration mode")
    return (source, metadata)


def create_backup(
    backup_dir: pathlib.Path,
    backup_id: str,
    source_root: pathlib.Path,
    production: bool,
) -> None:
    if re_full_backup_id(backup_id) is False:
        fail("backup ID is invalid")
    owner_uid = 0 if production else os.geteuid()
    lstat_directory(backup_dir, owner_uid)
    existing = {item.name for item in backup_dir.iterdir()}
    if existing != {STATUS_MEMBER}:
        fail("pending backup directory must contain only rc-local-status.txt")
    status = backup_dir / STATUS_MEMBER
    status_metadata = os.lstat(status)
    if not stat.S_ISREG(status_metadata.st_mode) or stat.S_ISLNK(status_metadata.st_mode):
        fail("rc-local status evidence is linked or special")
    if status_metadata.st_nlink != 1 or stat.S_IMODE(status_metadata.st_mode) != 0o600:
        fail("rc-local status evidence has unsafe metadata")

    entries: list[dict[str, Any]] = []
    for source_path, member, required in MAPPINGS:
        source, metadata = validate_source_entry(source_root, source_path, required, production)
        entry: dict[str, Any] = {"sourcePath": source_path, "backupMember": member}
        if metadata is None:
            entry["state"] = "absent"
        elif stat.S_ISREG(metadata.st_mode):
            entry.update(copy_regular(source, backup_dir / member))
        else:
            entry.update(copy_symlink(source, backup_dir / member))
        entries.append(entry)

    manifest = {
        "schemaVersion": SCHEMA_VERSION,
        "backupId": backup_id,
        "createdAt": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "entries": entries,
    }
    manifest_bytes = canonical_json(manifest)
    write_regular_atomic(backup_dir / MANIFEST_MEMBER, manifest_bytes)

    regular_members = sorted(
        item.name
        for item in backup_dir.iterdir()
        if item.name not in {CHECKSUM_MEMBER, COMPLETE_MEMBER} and item.is_file() and not item.is_symlink()
    )
    checksum_lines = "".join(f"{sha256_path(backup_dir / member)}  {member}\n" for member in regular_members)
    write_regular_atomic(backup_dir / CHECKSUM_MEMBER, checksum_lines.encode("ascii"))
    completion = {
        "schemaVersion": SCHEMA_VERSION,
        "backupId": backup_id,
        "entryCount": len(entries),
        "manifestSha256": sha256_bytes(manifest_bytes),
        "checksumsSha256": sha256_bytes(checksum_lines.encode("ascii")),
    }
    write_regular_atomic(backup_dir / COMPLETE_MEMBER, canonical_json(completion))
    verify_backup(backup_dir, expected_backup_id=backup_id, production=production)
    fsync_directory(backup_dir)


def re_full_backup_id(value: str) -> bool:
    import re

    return re.fullmatch(r"20\d{6}T\d{6}Z\.[A-Za-z0-9]{8,32}", value) is not None


def load_json_exact(path: pathlib.Path, expected_keys: set[str]) -> dict[str, Any]:
    metadata = os.lstat(path)
    if (
        not stat.S_ISREG(metadata.st_mode)
        or stat.S_ISLNK(metadata.st_mode)
        or metadata.st_nlink != 1
        or stat.S_IMODE(metadata.st_mode) != 0o600
    ):
        fail(f"backup control has unsafe metadata: {path.name}")
    try:
        value = json.loads(path.read_text(encoding="ascii"))
    except (OSError, UnicodeError, ValueError) as error:
        fail(f"backup control is malformed: {path.name}: {error}")
    if not isinstance(value, dict) or set(value) != expected_keys:
        fail(f"backup control has an unexpected schema: {path.name}")
    return value


def parse_manifest(backup_dir: pathlib.Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    manifest = load_json_exact(
        backup_dir / MANIFEST_MEMBER,
        {"schemaVersion", "backupId", "createdAt", "entries"},
    )
    if manifest["schemaVersion"] != SCHEMA_VERSION or not isinstance(manifest["entries"], list):
        fail("backup manifest identity is invalid")
    entries = manifest["entries"]
    if len(entries) != len(MAPPINGS):
        fail("backup manifest entry count is invalid")
    normalized: list[dict[str, Any]] = []
    for raw, mapping in zip(entries, MAPPINGS):
        if not isinstance(raw, dict):
            fail("backup manifest entry is not an object")
        source_path, member, _ = mapping
        if raw.get("sourcePath") != source_path or raw.get("backupMember") != member:
            fail("backup manifest path order differs from the fixed allowlist")
        state = raw.get("state")
        if state == "absent":
            if set(raw) != {"sourcePath", "backupMember", "state"}:
                fail("absent backup manifest entry has unexpected metadata")
        elif state == "present" and raw.get("kind") == "file":
            if set(raw) != {
                "sourcePath",
                "backupMember",
                "state",
                "kind",
                "mode",
                "uid",
                "gid",
                "nlink",
                "size",
                "sha256",
            }:
                fail("regular backup manifest entry has unexpected metadata")
        elif state == "present" and raw.get("kind") == "symlink":
            if set(raw) != {
                "sourcePath",
                "backupMember",
                "state",
                "kind",
                "mode",
                "uid",
                "gid",
                "nlink",
                "target",
            }:
                fail("symlink backup manifest entry has unexpected metadata")
        else:
            fail("backup manifest entry state or type is invalid")
        normalized.append(raw)
    return manifest, normalized


def parse_checksums(backup_dir: pathlib.Path) -> dict[str, str]:
    path = backup_dir / CHECKSUM_MEMBER
    metadata = os.lstat(path)
    if (
        not stat.S_ISREG(metadata.st_mode)
        or stat.S_ISLNK(metadata.st_mode)
        or metadata.st_nlink != 1
        or stat.S_IMODE(metadata.st_mode) != 0o600
    ):
        fail("backup checksum manifest has unsafe metadata")
    checksums: dict[str, str] = {}
    for line in path.read_text(encoding="ascii").splitlines():
        fields = line.split("  ")
        if len(fields) != 2 or len(fields[0]) != 64 or any(item not in "0123456789abcdef" for item in fields[0]):
            fail("backup checksum manifest is malformed")
        digest, member = fields
        if member in checksums or pathlib.PurePosixPath(member).name != member:
            fail("backup checksum manifest has an unsafe or duplicate member")
        checksums[member] = digest
    return checksums


def verify_backup(
    backup_dir: pathlib.Path,
    expected_backup_id: str | None = None,
    production: bool = False,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    owner_uid = 0 if production else None
    lstat_directory(backup_dir, owner_uid)
    manifest, entries = parse_manifest(backup_dir)
    backup_id = expected_backup_id or backup_dir.name
    if not re_full_backup_id(backup_id) or manifest["backupId"] != backup_id:
        fail("backup directory and manifest identity differ")
    completion = load_json_exact(
        backup_dir / COMPLETE_MEMBER,
        {"schemaVersion", "backupId", "entryCount", "manifestSha256", "checksumsSha256"},
    )
    manifest_bytes = (backup_dir / MANIFEST_MEMBER).read_bytes()
    checksum_bytes = (backup_dir / CHECKSUM_MEMBER).read_bytes()
    if (
        completion["schemaVersion"] != SCHEMA_VERSION
        or completion["backupId"] != backup_id
        or completion["entryCount"] != len(MAPPINGS)
        or completion["manifestSha256"] != sha256_bytes(manifest_bytes)
        or completion["checksumsSha256"] != sha256_bytes(checksum_bytes)
    ):
        fail("backup completion marker does not bind the completed generation")

    expected_members = set(BASE_MEMBERS)
    expected_regular = {STATUS_MEMBER, MANIFEST_MEMBER}
    for entry in entries:
        member = entry["backupMember"]
        target = backup_dir / member
        if entry["state"] == "absent":
            if target.exists() or target.is_symlink():
                fail(f"absent backup entry unexpectedly has content: {member}")
            continue
        expected_members.add(member)
        metadata = os.lstat(target)
        if metadata.st_uid != entry["uid"] or metadata.st_gid != entry["gid"]:
            fail(f"backup member ownership differs from its manifest: {member}")
        if stat.S_IMODE(metadata.st_mode) != int(entry["mode"], 8) or metadata.st_nlink != entry["nlink"]:
            fail(f"backup member metadata differs from its manifest: {member}")
        if entry["kind"] == "file":
            if not stat.S_ISREG(metadata.st_mode) or metadata.st_size != entry["size"]:
                fail(f"regular backup member differs from its manifest: {member}")
            if sha256_path(target) != entry["sha256"]:
                fail(f"regular backup member hash differs from its manifest: {member}")
            expected_regular.add(member)
        else:
            if not stat.S_ISLNK(metadata.st_mode) or os.readlink(target) != entry["target"]:
                fail(f"backup symlink differs from its manifest: {member}")
    actual_members = {item.name for item in backup_dir.iterdir()}
    if actual_members != expected_members:
        fail("backup directory contains a missing or unreviewed member")
    checksums = parse_checksums(backup_dir)
    if set(checksums) != expected_regular:
        fail("backup checksum manifest does not cover the exact regular member set")
    for member, expected_sha256 in checksums.items():
        if sha256_path(backup_dir / member) != expected_sha256:
            fail(f"backup checksum verification failed: {member}")
    if production:
        for entry in entries:
            if entry["state"] == "present" and (entry["uid"] != 0 or entry["gid"] != 0):
                fail("production backup contains a non-root source identity")
    return manifest, entries


def assert_destination_chain(root: pathlib.Path, destination: pathlib.Path, production: bool) -> None:
    boundary = pathlib.Path("/") if production else root
    owner_uid = 0 if production else os.geteuid()
    current = destination.parent
    chain: list[pathlib.Path] = []
    while True:
        chain.append(current)
        if current == boundary:
            break
        if boundary not in current.parents:
            fail(f"restore destination escaped its root: {destination}")
        current = current.parent
    for directory in reversed(chain):
        if not directory.exists():
            if production:
                fail(f"production restore parent is missing: {directory}")
            directory.mkdir(mode=0o700)
        metadata = os.lstat(directory)
        if not stat.S_ISDIR(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode):
            fail(f"restore parent is linked or special: {directory}")
        if metadata.st_uid != owner_uid or stat.S_IMODE(metadata.st_mode) & 0o022:
            fail(f"restore parent is not owner-controlled: {directory}")


def restore_regular(
    source: pathlib.Path,
    destination: pathlib.Path,
    entry: dict[str, Any],
    production: bool,
) -> None:
    temporary = destination.parent / f".{destination.name}.restore.{secrets.token_hex(8)}"
    source_fd = os.open(source, os.O_RDONLY | os.O_NOFOLLOW)
    destination_fd = os.open(
        temporary,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
        0o600,
    )
    try:
        while True:
            chunk = os.read(source_fd, 1024 * 1024)
            if not chunk:
                break
            offset = 0
            while offset < len(chunk):
                offset += os.write(destination_fd, chunk[offset:])
        if production:
            os.fchown(destination_fd, entry["uid"], entry["gid"])
        os.fchmod(destination_fd, int(entry["mode"], 8))
        os.fsync(destination_fd)
    finally:
        os.close(source_fd)
        os.close(destination_fd)
    os.replace(temporary, destination)
    fsync_directory(destination.parent)


def restore_symlink(destination: pathlib.Path, entry: dict[str, Any], production: bool) -> None:
    temporary = destination.parent / f".{destination.name}.restore.{secrets.token_hex(8)}"
    os.symlink(entry["target"], temporary)
    if production:
        os.lchown(temporary, entry["uid"], entry["gid"])
    os.replace(temporary, destination)
    fsync_directory(destination.parent)


def materialize_backup(
    backup_dir: pathlib.Path,
    destination_root: pathlib.Path,
    production: bool,
) -> None:
    _, entries = verify_backup(backup_dir, production=production)
    lstat_directory(
        destination_root,
        0 if production else os.geteuid(),
        exact_mode=None if production else 0o700,
    )
    destinations: list[tuple[dict[str, Any], pathlib.Path]] = []
    for entry in entries:
        destination = rooted(destination_root, entry["sourcePath"])
        assert_destination_chain(destination_root, destination, production)
        if destination.exists() and destination.is_dir() and not destination.is_symlink():
            fail(f"restore target is unexpectedly a directory: {entry['sourcePath']}")
        destinations.append((entry, destination))
    for entry, destination in destinations:
        if entry["state"] == "absent":
            try:
                destination.unlink()
                fsync_directory(destination.parent)
            except FileNotFoundError:
                pass
            continue
        source = backup_dir / entry["backupMember"]
        if entry["kind"] == "file":
            restore_regular(source, destination, entry, production)
        else:
            restore_symlink(destination, entry, production)


def restore_inert_legacy(
    backup_dir: pathlib.Path,
    destination_root: pathlib.Path,
    production: bool,
) -> None:
    """Restore legacy evidence without making either legacy entry executable."""
    _, entries = verify_backup(backup_dir, production=production)
    by_source = {entry["sourcePath"]: entry for entry in entries}
    mask = rooted(destination_root, "/etc/systemd/system/rc-local.service")
    try:
        mask_metadata = os.lstat(mask)
    except OSError as error:
        fail(f"the persistent rc-local mask is unavailable: {error}")
    if not stat.S_ISLNK(mask_metadata.st_mode) or os.readlink(mask) != "/dev/null":
        fail("production restore requires the exact persistent rc-local mask")

    rc_entry = by_source["/etc/rc.local"]
    rc_link_entry = by_source["/etc/rc.d/rc.local"]
    if rc_entry.get("state") != "present" or rc_entry.get("kind") != "file":
        fail("backup does not contain the required legacy rc.local file")
    if rc_link_entry.get("state") != "present" or rc_link_entry.get("kind") != "symlink":
        fail("backup does not contain the required legacy rc.local link")

    rc_destination = rooted(destination_root, "/etc/rc.local")
    link_destination = rooted(destination_root, "/etc/rc.d/rc.local")
    assert_destination_chain(destination_root, rc_destination, production=production)
    assert_destination_chain(destination_root, link_destination, production=production)
    inert_entry = dict(rc_entry)
    inert_entry["mode"] = "0644"
    restore_regular(
        backup_dir / rc_entry["backupMember"],
        rc_destination,
        inert_entry,
        production=production,
    )
    restore_symlink(link_destination, rc_link_entry, production=production)
    if stat.S_IMODE(os.lstat(rc_destination).st_mode) != 0o644:
        fail("restored legacy rc.local is not inert")
    if os.readlink(link_destination) != "/etc/rc.local":
        fail("restored legacy rc.local link is not exact")
    if not stat.S_ISLNK(os.lstat(mask).st_mode) or os.readlink(mask) != "/dev/null":
        fail("persistent rc-local mask changed during restore")


def production_backup_path(path: pathlib.Path) -> None:
    try:
        parent = path.parent.resolve(strict=True)
    except OSError as error:
        fail(f"production backup parent is unavailable: {error}")
    if parent != PRODUCTION_BACKUP_ROOT or path.name.startswith("."):
        fail("production restore accepts only one finalized rc-local backup directory")


def begin_restore_journal(backup_id: str) -> None:
    parent = RESTORE_STATE_DIR.parent
    lstat_directory(parent, 0, exact_mode=None)
    try:
        os.mkdir(RESTORE_STATE_DIR, 0o700)
        os.chown(RESTORE_STATE_DIR, 0, 0)
        fsync_directory(parent)
    except FileExistsError:
        pass
    lstat_directory(RESTORE_STATE_DIR, 0, exact_mode=0o700)
    if RESTORE_PENDING.exists() or RESTORE_PENDING.is_symlink():
        fail("an rc-local restore transaction is already pending")
    write_regular_atomic(
        RESTORE_PENDING,
        canonical_json(
            {
                "schemaVersion": SCHEMA_VERSION,
                "backupId": backup_id,
                "startedAt": dt.datetime.now(dt.timezone.utc)
                .replace(microsecond=0)
                .isoformat()
                .replace("+00:00", "Z"),
                "safetyMode": "inert-legacy-only",
            }
        ),
    )


def complete_restore_journal() -> None:
    metadata = os.lstat(RESTORE_PENDING)
    if (
        not stat.S_ISREG(metadata.st_mode)
        or metadata.st_uid != 0
        or metadata.st_gid != 0
        or metadata.st_nlink != 1
        or stat.S_IMODE(metadata.st_mode) != 0o600
    ):
        fail("rc-local restore journal changed during recovery")
    os.unlink(RESTORE_PENDING)
    fsync_directory(RESTORE_STATE_DIR)


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    create = subparsers.add_parser("create")
    create.add_argument("backup_dir")
    create.add_argument("backup_id")
    create.add_argument("--fixture-source-root")
    verify = subparsers.add_parser("verify")
    verify.add_argument("backup_dir")
    verify.add_argument("--expected-backup-id")
    verify.add_argument("--production", action="store_true")
    restore_test = subparsers.add_parser("restore-test")
    restore_test.add_argument("backup_dir")
    restore_test.add_argument("destination_root")
    restore_test.add_argument("--inert-legacy", action="store_true")
    restore = subparsers.add_parser("restore")
    restore.add_argument("backup_dir")
    return parser.parse_args()


def main() -> None:
    if not hasattr(os, "O_NOFOLLOW") or not hasattr(os, "O_DIRECTORY"):
        fail("no-follow descriptor and directory operations are unavailable")
    arguments = parse_arguments()
    backup_dir = normalize_absolute(arguments.backup_dir, "backup directory")
    if arguments.command == "create":
        source_root = normalize_absolute(arguments.fixture_source_root or "/", "source root")
        production = source_root == pathlib.Path("/")
        if production and os.geteuid() != 0:
            fail("production backup creation must run as root")
        lstat_directory(
            source_root,
            0 if production else os.geteuid(),
            exact_mode=None if production else 0o700,
        )
        create_backup(backup_dir, arguments.backup_id, source_root, production)
        print(f"Completed rc-local backup generation {arguments.backup_id}.")
        return
    if arguments.command == "verify":
        if arguments.production and os.geteuid() != 0:
            fail("production backup verification must run as root")
        verify_backup(
            backup_dir,
            expected_backup_id=arguments.expected_backup_id,
            production=arguments.production,
        )
        print(f"Verified complete rc-local backup {arguments.expected_backup_id or backup_dir.name}.")
        return
    if arguments.command == "restore-test":
        destination_root = normalize_absolute(arguments.destination_root, "test restore root")
        if destination_root == pathlib.Path("/"):
            fail("test restore cannot target the host root")
        if arguments.inert_legacy:
            restore_inert_legacy(backup_dir, destination_root, production=False)
        else:
            materialize_backup(backup_dir, destination_root, production=False)
        print("Materialized rc-local backup into the isolated test root.")
        return
    if os.geteuid() != 0 or os.environ.get("ACK_RESTORE_RC_LOCAL") != "YES":
        fail("production restore requires root and ACK_RESTORE_RC_LOCAL=YES")
    production_backup_path(backup_dir)
    verify_backup(backup_dir, production=True)
    begin_restore_journal(backup_dir.name)
    subprocess.run(["/usr/bin/systemctl", "stop", "rc-local.service"], check=True, timeout=30)
    restore_inert_legacy(backup_dir, pathlib.Path("/"), production=True)
    subprocess.run(["/usr/bin/systemctl", "daemon-reload"], check=True, timeout=30)
    complete_restore_journal()
    print("Restored inert legacy rc.local evidence without changing its persistent mask.")


if __name__ == "__main__":
    try:
        main()
    except (BackupError, OSError, ValueError, subprocess.SubprocessError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1) from None
