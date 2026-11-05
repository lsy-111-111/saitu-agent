#!/usr/bin/env python3
"""Freeze one untrusted legacy runtime tree through no-follow descriptors.

The legacy application remains online while it is adopted, so its ubuntu-owned
working tree cannot be copied by pathname.  This helper retains every ancestor
descriptor, verifies each directory generation and file metadata before/after
copying, and writes only to a private root-owned snapshot.  Runtime caches and
all secret-shaped configuration files are excluded before any byte is copied.
"""

from __future__ import annotations

import os
import pathlib
import stat
import sys


def fail(message: str) -> "NoReturn":
    raise SystemExit(f"ERROR: {message}")


if len(sys.argv) not in {3, 5}:
    fail(
        "usage: snapshot-legacy-release.py SOURCE EMPTY_SNAPSHOT_ROOT "
        "[EXPECTED_SOURCE_DEVICE EXPECTED_SOURCE_INODE]"
    )

expected_source_identity: tuple[int, int] | None = None
if len(sys.argv) == 5:
    try:
        expected_source_identity = (int(sys.argv[3]), int(sys.argv[4]))
    except ValueError:
        fail("expected legacy source identity must be numeric")
    if min(expected_source_identity) < 0:
        fail("expected legacy source identity is invalid")

no_follow = getattr(os, "O_NOFOLLOW", None)
directory_flag = getattr(os, "O_DIRECTORY", None)
if no_follow is None or directory_flag is None:
    fail("no-follow descriptor operations are unavailable")


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


def open_absolute_directory(raw: str) -> list[tuple[int, tuple[int, ...]]]:
    path = pathlib.PurePosixPath(raw)
    if not path.is_absolute() or any(part in {".", ".."} for part in path.parts):
        fail("legacy snapshot paths must be normalized and absolute")
    descriptors: list[tuple[int, tuple[int, ...]]] = []
    current = os.open("/", os.O_RDONLY | directory_flag | no_follow)
    descriptors.append((current, stable(os.fstat(current))))
    for component in path.parts[1:]:
        current = os.open(
            component, os.O_RDONLY | directory_flag | no_follow, dir_fd=current
        )
        descriptors.append((current, stable(os.fstat(current))))
    return descriptors


def descriptor_path(descriptor: int, label: str) -> pathlib.Path:
    value = os.readlink(f"/proc/self/fd/{descriptor}")
    if value.endswith(" (deleted)"):
        fail(f"{label} was removed while it was open")
    return pathlib.Path(value)


def assert_chain_stable(
    descriptors: list[tuple[int, tuple[int, ...]]], label: str
) -> None:
    for descriptor, expected in descriptors:
        if stable(os.fstat(descriptor)) != expected:
            fail(f"{label} path changed while it was snapshotted")


source_chain = open_absolute_directory(sys.argv[1])
snapshot_chain = open_absolute_directory(sys.argv[2])
source_fd = source_chain[-1][0]
snapshot_fd = snapshot_chain[-1][0]
source_before = os.fstat(source_fd)
snapshot_before = os.fstat(snapshot_fd)
source = descriptor_path(source_fd, "legacy source")
snapshot_root = descriptor_path(snapshot_fd, "legacy snapshot root")
if not stat.S_ISDIR(source_before.st_mode) or not stat.S_ISDIR(snapshot_before.st_mode):
    fail("legacy source and snapshot root must be directories")
if expected_source_identity is not None and (
    source_before.st_dev,
    source_before.st_ino,
) != expected_source_identity:
    fail("legacy source path no longer names the approved running cwd inode")
if os.listdir(snapshot_fd):
    fail("legacy snapshot root is not empty")
if snapshot_root == source or source in snapshot_root.parents:
    fail("legacy snapshot root must be outside the live source")

mountinfo = pathlib.Path("/proc/self/mountinfo")
if not mountinfo.is_file():
    fail("mount topology is unavailable")


def decode_mount_path(value: str) -> pathlib.Path:
    return pathlib.Path(
        value.replace("\\040", " ")
        .replace("\\011", "\t")
        .replace("\\012", "\n")
        .replace("\\134", "\\")
    )


def assert_no_source_mounts() -> None:
    for line in mountinfo.read_text(encoding="utf-8").splitlines():
        fields = line.split()
        if len(fields) < 5:
            fail("malformed mount topology")
        mount = decode_mount_path(fields[4])
        try:
            mount.relative_to(source)
        except ValueError:
            continue
        fail(f"legacy source contains or is a mount point: {mount}")


excluded_directories = {
    ".git",
    "artifacts",
    "coverage",
    "logs",
    "playwright-report",
    "test-results",
    "tmp",
}
secret_names = {
    ".netrc",
    ".npmrc",
    ".pypirc",
    ".yarnrc",
    "credentials.json",
    "secrets.env",
    "api密钥.rtfd",
}
secret_suffixes = {".jks", ".key", ".keystore", ".p12", ".pem", ".pfx"}


def excluded(relative: pathlib.PurePosixPath, is_directory: bool) -> bool:
    name = relative.name
    lowered = name.lower()
    if name == ".env" or name.startswith(".env.") or name.startswith(".env.local"):
        return True
    if (
        name in secret_names
        or name.startswith("id_ed25519")
        or name.startswith("id_rsa")
        or "secret" in lowered
        or "credential" in lowered
        or "密钥" in name
    ):
        return True
    if pathlib.PurePosixPath(name).suffix.lower() in secret_suffixes:
        return True
    return is_directory and (
        name in excluded_directories or relative.as_posix() == ".next/cache"
    )


def sync_directory(path: pathlib.Path) -> None:
    descriptor = os.open(path, os.O_RDONLY | directory_flag | no_follow)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


file_count = 0
total_size = 0


def copy_file(source_descriptor: int, output: pathlib.Path) -> None:
    with os.fdopen(os.dup(source_descriptor), "rb") as source_stream, output.open(
        "xb"
    ) as target_stream:
        while True:
            chunk = source_stream.read(1024 * 1024)
            if not chunk:
                target_stream.flush()
                os.fsync(target_stream.fileno())
                return
            target_stream.write(chunk)


def copy_directory(
    directory_fd: int, target: pathlib.Path, display: pathlib.PurePosixPath
) -> None:
    global file_count, total_size
    directory_before = os.fstat(directory_fd)
    names_before = sorted(os.listdir(directory_fd))
    for name in names_before:
        relative = display / name
        if "\n" in relative.as_posix() or "\r" in relative.as_posix():
            fail("newline is forbidden in legacy release member names")
        before = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
        is_directory = stat.S_ISDIR(before.st_mode)
        if excluded(relative, is_directory):
            continue
        output = target / name
        if is_directory:
            child_fd = os.open(
                name, os.O_RDONLY | directory_flag | no_follow, dir_fd=directory_fd
            )
            try:
                if stable(before) != stable(os.fstat(child_fd)):
                    fail(f"legacy directory changed while it was opened: {relative}")
                output.mkdir(mode=0o700)
                copy_directory(child_fd, output, relative)
                output.chmod(0o500)
                sync_directory(output)
            finally:
                os.close(child_fd)
        elif stat.S_ISREG(before.st_mode):
            if before.st_nlink != 1:
                fail(f"hard-linked file is forbidden in the legacy source: {relative}")
            file_fd = os.open(name, os.O_RDONLY | no_follow, dir_fd=directory_fd)
            try:
                opened = os.fstat(file_fd)
                if stable(before) != stable(opened):
                    fail(f"legacy file changed while it was opened: {relative}")
                if opened.st_nlink != 1:
                    fail(f"hard-linked file is forbidden in the legacy source: {relative}")
                file_count += 1
                total_size += opened.st_size
                if file_count > 250_000 or total_size > 8 * 1024**3:
                    fail("legacy snapshot exceeds the reviewed size bounds")
                copy_file(file_fd, output)
                output.chmod(0o500 if before.st_mode & 0o111 else 0o400)
                if stable(opened) != stable(os.fstat(file_fd)):
                    fail(f"legacy file changed while it was snapshotted: {relative}")
            finally:
                os.close(file_fd)
        elif stat.S_ISLNK(before.st_mode):
            target_value = os.readlink(name, dir_fd=directory_fd)
            if pathlib.PurePosixPath(target_value).is_absolute():
                fail(f"absolute symlink is forbidden in the legacy source: {relative}")
            os.symlink(target_value, output)
            if target_value != os.readlink(name, dir_fd=directory_fd):
                fail(f"legacy symlink changed while it was snapshotted: {relative}")
        else:
            fail(f"special file is forbidden in the legacy source: {relative}")
        after = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
        if stable(before) != stable(after):
            fail(f"legacy entry changed while it was snapshotted: {relative}")
    if names_before != sorted(os.listdir(directory_fd)) or stable(directory_before) != stable(
        os.fstat(directory_fd)
    ):
        fail(f"legacy directory changed while it was snapshotted: {display}")


def verify_snapshot_links(root: pathlib.Path) -> None:
    for current, directory_names, file_names in os.walk(root, followlinks=False):
        current_path = pathlib.Path(current)
        for name in [*directory_names, *file_names]:
            candidate = current_path / name
            if not candidate.is_symlink():
                continue
            try:
                resolved = candidate.resolve(strict=False)
            except (OSError, RuntimeError) as error:
                fail(f"legacy snapshot contains an invalid symlink: {candidate}: {error}")
            if resolved != root and root not in resolved.parents:
                fail(f"legacy snapshot symlink escapes the tree: {candidate}")


assert_no_source_mounts()
os.mkdir("source", mode=0o700, dir_fd=snapshot_fd)
destination = snapshot_root / "source"
try:
    copy_directory(source_fd, destination, pathlib.PurePosixPath())
    destination.chmod(0o500)
    verify_snapshot_links(destination)
    sync_directory(destination)
    assert_no_source_mounts()
    assert_chain_stable(source_chain, "legacy source")
    # Creating `source` intentionally changes the final snapshot directory.
    # Its retained root-owned descriptor is authoritative; only its ancestors
    # must remain the same path generation throughout the copy.
    assert_chain_stable(snapshot_chain[:-1], "legacy snapshot root")
    if stable(source_before) != stable(os.fstat(source_fd)):
        fail("legacy source root changed while it was snapshotted")
    sync_directory(snapshot_root)
finally:
    closed: set[int] = set()
    for descriptor, _ in [*source_chain, *snapshot_chain]:
        if descriptor not in closed:
            os.close(descriptor)
            closed.add(descriptor)
