#!/usr/bin/env python3
"""Copy a service-owned PM2 dump to root evidence without pathname races."""

from __future__ import annotations

import json
import os
import pathlib
import stat
import sys


def fail(message: str) -> "NoReturn":
    raise SystemExit(f"ERROR: {message}")


if len(sys.argv) != 5:
    fail("usage: snapshot-pm2-dump.py SOURCE DESTINATION EXPECTED_UID EXPECTED_GID")
source, destination = sys.argv[1:3]
try:
    expected_uid, expected_gid = map(int, sys.argv[3:5])
except ValueError:
    fail("PM2 dump identity must be numeric")


def identity(value: os.stat_result) -> tuple[int, ...]:
    return (
        value.st_dev,
        value.st_ino,
        value.st_mode,
        value.st_uid,
        value.st_gid,
        value.st_nlink,
        value.st_size,
        value.st_mtime_ns,
        value.st_ctime_ns,
    )


directory, name = os.path.split(source)
directory_fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
try:
    directory_metadata = os.fstat(directory_fd)
    if (
        not stat.S_ISDIR(directory_metadata.st_mode)
        or directory_metadata.st_uid != expected_uid
        or directory_metadata.st_gid != expected_gid
        or stat.S_IMODE(directory_metadata.st_mode) != 0o750
    ):
        fail("PM2 home is not the reviewed service-owned directory")
    try:
        source_fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory_fd)
    except FileNotFoundError:
        print("absent")
        raise SystemExit(0)
    try:
        before = os.fstat(source_fd)
        if (
            not stat.S_ISREG(before.st_mode)
            or before.st_nlink != 1
            or before.st_uid != expected_uid
            or before.st_gid != expected_gid
            or stat.S_IMODE(before.st_mode) != 0o600
            or before.st_size > 4 * 1024 * 1024
        ):
            fail("existing PM2 recovery dump is unsafe")
        destination_fd = os.open(
            destination,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
            0o600,
        )
        try:
            while True:
                chunk = os.read(source_fd, 1024 * 1024)
                if not chunk:
                    break
                remaining = memoryview(chunk)
                while remaining:
                    written = os.write(destination_fd, remaining)
                    if written <= 0:
                        fail("PM2 dump backup write made no progress")
                    remaining = remaining[written:]
            os.fchmod(destination_fd, 0o600)
            os.fsync(destination_fd)
        finally:
            os.close(destination_fd)
        after = os.fstat(source_fd)
        current = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
        if identity(before) != identity(after) or identity(after) != identity(current):
            fail("PM2 recovery dump changed while its root backup was created")
    finally:
        os.close(source_fd)
finally:
    os.close(directory_fd)

destination_path = pathlib.Path(destination)
metadata = destination_path.lstat()
if (
    not stat.S_ISREG(metadata.st_mode)
    or stat.S_ISLNK(metadata.st_mode)
    or metadata.st_uid != os.geteuid()
    or metadata.st_nlink != 1
    or stat.S_IMODE(metadata.st_mode) != 0o600
):
    fail("root PM2 dump backup has unsafe metadata")
try:
    value = json.loads(destination_path.read_text(encoding="utf-8"))
except (UnicodeDecodeError, json.JSONDecodeError):
    fail("PM2 dump backup is not valid UTF-8 JSON")
if not isinstance(value, list):
    fail("PM2 dump backup is not a PM2 application list")
print("present")
