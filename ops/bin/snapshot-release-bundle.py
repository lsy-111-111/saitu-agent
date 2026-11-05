#!/usr/bin/env python3
"""Copy one release bundle through stable no-follow descriptors.

The destination must be a new private directory.  Every source entry is
checked before opening, after opening, after copying, and again through its
parent descriptor.  Directory entry sets and ctime/mtime metadata must remain
stable for the whole traversal.  This turns a caller-owned tree into one
root-controlled generation before approval or deployment parses any byte.
"""

from __future__ import annotations

import os
import pathlib
import stat
import sys


def fail(message: str) -> "NoReturn":
    raise SystemExit(f"ERROR: {message}")


if len(sys.argv) not in (3, 4):
    fail("usage: snapshot-release-bundle.py SOURCE SNAPSHOT_ROOT [REVIEWED_MANIFEST]")

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


def open_absolute_no_follow(raw: str, *, final_directory: bool) -> list[tuple[int, tuple[int, ...]]]:
    path = pathlib.PurePosixPath(raw)
    if not path.is_absolute() or any(part in {".", ".."} for part in path.parts):
        fail("snapshot inputs must be normalized absolute paths")
    descriptors: list[tuple[int, tuple[int, ...]]] = []
    current = os.open("/", os.O_RDONLY | directory_flag | no_follow)
    descriptors.append((current, stable(os.fstat(current))))
    components = path.parts[1:]
    if not components:
        if not final_directory:
            fail("reviewed manifest cannot be the filesystem root")
        return descriptors
    for index, component in enumerate(components):
        is_final = index == len(components) - 1
        flags = os.O_RDONLY | no_follow
        if not is_final or final_directory:
            flags |= directory_flag
        next_descriptor = os.open(component, flags, dir_fd=current)
        current = next_descriptor
        descriptors.append((current, stable(os.fstat(current))))
    return descriptors


def assert_chain_stable(descriptors: list[tuple[int, tuple[int, ...]]], label: str) -> None:
    for descriptor, expected in descriptors:
        if stable(os.fstat(descriptor)) != expected:
            fail(f"{label} path changed while it was snapshotted")


def descriptor_path(descriptor: int, label: str) -> pathlib.Path:
    value = os.readlink(f"/proc/self/fd/{descriptor}")
    if value.endswith(" (deleted)"):
        fail(f"{label} path was removed while it was opened")
    return pathlib.Path(value)


# Open and retain every path component before resolving a display path.  A
# caller cannot swap any ancestor or final component to a symlink between a
# path-based precheck and the actual copy.
source_chain = open_absolute_no_follow(sys.argv[1], final_directory=True)
source_fd = source_chain[-1][0]
source_before = os.fstat(source_fd)
if not stat.S_ISDIR(source_before.st_mode):
    fail("bundle root changed before it could be frozen")
source = descriptor_path(source_fd, "bundle")

snapshot_chain = open_absolute_no_follow(sys.argv[2], final_directory=True)
snapshot_fd = snapshot_chain[-1][0]
snapshot_metadata = os.fstat(snapshot_fd)
if not stat.S_ISDIR(snapshot_metadata.st_mode):
    fail("snapshot root is not an ordinary directory")
if os.listdir(snapshot_fd):
    fail("snapshot root is not empty")
snapshot_root = descriptor_path(snapshot_fd, "snapshot root")
if snapshot_root == source or source in snapshot_root.parents:
    fail("snapshot root must stay outside the caller bundle")
os.mkdir("bundle", mode=0o700, dir_fd=snapshot_fd)
destination = snapshot_root / "bundle"

review_fd: int | None = None
review_before: os.stat_result | None = None
review_chain: list[tuple[int, tuple[int, ...]]] = []
review: pathlib.Path | None = None
if len(sys.argv) == 4:
    review_chain = open_absolute_no_follow(sys.argv[3], final_directory=False)
    review_fd = review_chain[-1][0]
    review_before = os.fstat(review_fd)
    review = descriptor_path(review_fd, "reviewed manifest")
    if not stat.S_ISREG(review_before.st_mode) or review_before.st_nlink != 1:
        fail("reviewed manifest is linked, special, or changed")

mountinfo = pathlib.Path("/proc/self/mountinfo")
if not mountinfo.is_file():
    fail("mount topology is unavailable")


def assert_no_source_mounts() -> None:
    for line in mountinfo.read_text(encoding="utf-8").splitlines():
        fields = line.split()
        if len(fields) < 5:
            fail("malformed mount topology")
        mount = pathlib.Path(
            fields[4]
            .replace("\\040", " ")
            .replace("\\011", "\t")
            .replace("\\012", "\n")
            .replace("\\134", "\\")
        )
        try:
            mount.relative_to(source)
        except ValueError:
            continue
        fail(f"bundle contains or is a mount point: {mount}")


assert_no_source_mounts()
file_count = 0
total_size = 0


def copy_stream(source_stream, target_stream) -> None:
    while True:
        chunk = source_stream.read(1024 * 1024)
        if not chunk:
            target_stream.flush()
            os.fsync(target_stream.fileno())
            return
        target_stream.write(chunk)


def sync_directory(path: pathlib.Path) -> None:
    descriptor = os.open(path, os.O_RDONLY | directory_flag | no_follow)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def copy_directory(directory_fd: int, target: pathlib.Path, display: pathlib.PurePath) -> None:
    global file_count, total_size
    directory_before = os.fstat(directory_fd)
    if not stat.S_ISDIR(directory_before.st_mode):
        fail(f"unsafe bundle directory entry: {display}")
    names_before = sorted(os.listdir(directory_fd))
    for name in names_before:
        item_display = display / name
        before = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
        if stat.S_ISDIR(before.st_mode):
            child_fd = os.open(name, os.O_RDONLY | directory_flag | no_follow, dir_fd=directory_fd)
            try:
                if stable(before) != stable(os.fstat(child_fd)):
                    fail(f"bundle directory changed while it was opened: {item_display}")
                child_target = target / name
                child_target.mkdir(mode=0o700)
                copy_directory(child_fd, child_target, item_display)
                child_target.chmod(0o500)
                sync_directory(child_target)
            finally:
                os.close(child_fd)
        elif stat.S_ISREG(before.st_mode) and before.st_nlink == 1:
            file_fd = os.open(name, os.O_RDONLY | no_follow, dir_fd=directory_fd)
            try:
                opened = os.fstat(file_fd)
                if stable(before) != stable(opened):
                    fail(f"bundle file changed while it was opened: {item_display}")
                file_count += 1
                total_size += opened.st_size
                if file_count > 250_000 or total_size > 8 * 1024**3:
                    fail("bundle exceeds the approval snapshot bounds")
                output = target / name
                with os.fdopen(os.dup(file_fd), "rb") as source_stream, output.open("xb") as target_stream:
                    copy_stream(source_stream, target_stream)
                if stable(opened) != stable(os.fstat(file_fd)):
                    fail(f"bundle changed while it was snapshotted: {item_display}")
                output.chmod(0o400)
            finally:
                os.close(file_fd)
        else:
            fail(f"linked or special bundle entry: {item_display}")
        if stable(before) != stable(os.stat(name, dir_fd=directory_fd, follow_symlinks=False)):
            fail(f"bundle entry changed while it was snapshotted: {item_display}")
    if names_before != sorted(os.listdir(directory_fd)) or stable(directory_before) != stable(
        os.fstat(directory_fd)
    ):
        fail(f"bundle directory changed while it was snapshotted: {display}")


try:
    copy_directory(source_fd, destination, pathlib.PurePath("bundle"))
    destination.chmod(0o500)
    sync_directory(destination)
    assert_no_source_mounts()
    assert_chain_stable(source_chain, "bundle")
    if stable(source_before) != stable(os.fstat(source_fd)):
        fail("bundle root changed while it was snapshotted")

    if review is not None:
        assert review_fd is not None and review_before is not None
        review_copy = snapshot_root / "reviewed-source-manifest.txt"
        with os.fdopen(os.dup(review_fd), "rb") as source_stream, review_copy.open("xb") as target_stream:
            copy_stream(source_stream, target_stream)
        assert_chain_stable(review_chain, "reviewed manifest")
        if stable(review_before) != stable(os.fstat(review_fd)):
            fail("reviewed manifest changed while it was snapshotted")
        review_copy.chmod(0o400)
    sync_directory(snapshot_root)
finally:
    closed = set()
    for descriptor, _ in [*review_chain, *source_chain, *snapshot_chain]:
        if descriptor not in closed:
            os.close(descriptor)
            closed.add(descriptor)
