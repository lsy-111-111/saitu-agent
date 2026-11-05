#!/usr/bin/python3
"""Validate and hash one immutable runtime output tree without following links."""

from __future__ import annotations

import argparse
import hashlib
import os
import pathlib
import stat


def fail(message: str) -> "NoReturn":
    raise SystemExit(f"ERROR: {message}")


def stable(metadata: os.stat_result) -> tuple[int, ...]:
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


def normalized_relative(raw: str) -> pathlib.PurePosixPath:
    value = pathlib.PurePosixPath(raw)
    if (
        not raw
        or value.is_absolute()
        or value.as_posix() != raw
        or any(part in {"", ".", ".."} for part in value.parts)
        or any(character in raw for character in "\0\r\n\t")
    ):
        fail(f"excluded runtime path is not normalized: {raw!r}")
    return value


parser = argparse.ArgumentParser(add_help=False)
parser.add_argument("--root", required=True)
parser.add_argument("--expected-uid", type=int)
parser.add_argument("--expected-gid", type=int)
parser.add_argument("--forbid-group-other-write", action="store_true")
parser.add_argument("--exclude-relative", action="append", default=[])
arguments = parser.parse_args()

if (arguments.expected_uid is None) != (arguments.expected_gid is None):
    fail("expected uid and gid must be supplied together")
if arguments.expected_uid is not None and (
    arguments.expected_uid < 0 or arguments.expected_gid < 0
):
    fail("expected ownership is invalid")

root_input = pathlib.Path(arguments.root)
root_metadata = root_input.lstat()
if not stat.S_ISDIR(root_metadata.st_mode) or stat.S_ISLNK(root_metadata.st_mode):
    fail("runtime tree root is missing, linked, or not a directory")
root = root_input.resolve(strict=True)
if root != root_input or root.stat().st_dev != root_metadata.st_dev:
    fail("runtime tree root is not one physical directory")
if arguments.expected_uid is not None and (
    root_metadata.st_uid != arguments.expected_uid
    or root_metadata.st_gid != arguments.expected_gid
):
    fail("runtime tree root has unexpected ownership")
if arguments.forbid_group_other_write and root_metadata.st_mode & 0o022:
    fail("runtime tree root is writable outside its owner")
root_device = root_metadata.st_dev

excluded = {normalized_relative(value).as_posix() for value in arguments.exclude_relative}
for left in excluded:
    if any(right != left and right.startswith(f"{left}/") for right in excluded):
        fail("runtime exclusions overlap")


def is_excluded(relative: str) -> bool:
    return any(relative == value or relative.startswith(f"{value}/") for value in excluded)


records: list[tuple[bytes, bytes]] = []
no_follow = getattr(os, "O_NOFOLLOW", None)
if no_follow is None:
    fail("no-follow file access is unavailable")

for current, directory_names, file_names in os.walk(root, topdown=True, followlinks=False):
    current_path = pathlib.Path(current)
    directory_names.sort(key=lambda value: value.encode("utf-8"))
    file_names.sort(key=lambda value: value.encode("utf-8"))
    retained_directories: list[str] = []
    for name in directory_names:
        relative = (current_path / name).relative_to(root).as_posix()
        if is_excluded(relative):
            continue
        retained_directories.append(name)
    directory_names[:] = retained_directories

    for name in [*directory_names, *file_names]:
        member = current_path / name
        relative = member.relative_to(root).as_posix()
        if is_excluded(relative):
            continue
        relative_bytes = relative.encode("utf-8")
        before = member.lstat()
        if before.st_dev != root_device:
            fail(f"runtime member crosses a filesystem boundary: {relative}")
        if arguments.expected_uid is not None and (
            before.st_uid != arguments.expected_uid
            or before.st_gid != arguments.expected_gid
        ):
            fail(f"runtime member has unexpected ownership: {relative}")
        if (
            arguments.forbid_group_other_write
            and not stat.S_ISLNK(before.st_mode)
            and before.st_mode & 0o022
        ):
            fail(f"runtime member is writable outside its owner: {relative}")

        if stat.S_ISLNK(before.st_mode):
            target_text = os.readlink(member)
            try:
                target = member.resolve(strict=True)
                target.relative_to(root)
            except (OSError, RuntimeError, ValueError):
                fail(f"runtime link is broken or escapes its tree: {relative}")
            if not (target.is_file() or target.is_dir()):
                fail(f"runtime link targets a special member: {relative}")
            if stable(member.lstat()) != stable(before):
                fail(f"runtime link changed while hashing: {relative}")
            payload = b"L\0" + target_text.encode("utf-8")
        elif stat.S_ISDIR(before.st_mode):
            if stable(member.lstat()) != stable(before):
                fail(f"runtime directory changed while hashing: {relative}")
            payload = b"D"
        elif stat.S_ISREG(before.st_mode) and before.st_nlink == 1:
            descriptor = os.open(member, os.O_RDONLY | no_follow)
            try:
                opened = os.fstat(descriptor)
                if stable(opened) != stable(before):
                    fail(f"runtime file changed while opening: {relative}")
                content = hashlib.sha256()
                while chunk := os.read(descriptor, 1024 * 1024):
                    content.update(chunk)
                if stable(os.fstat(descriptor)) != stable(opened):
                    fail(f"runtime file changed while hashing: {relative}")
            finally:
                os.close(descriptor)
            if stable(member.lstat()) != stable(before):
                fail(f"runtime file changed after hashing: {relative}")
            payload = f"F\0{before.st_size}\0{content.hexdigest()}".encode("ascii")
        else:
            fail(f"runtime tree contains a special or hard-linked member: {relative}")
        records.append((relative_bytes, payload))

if not records:
    fail("runtime output tree is empty")
records.sort(key=lambda item: item[0])
digest = hashlib.sha256()
for relative_bytes, payload in records:
    digest.update(len(relative_bytes).to_bytes(8, "big"))
    digest.update(relative_bytes)
    digest.update(len(payload).to_bytes(8, "big"))
    digest.update(payload)
print(digest.hexdigest())
