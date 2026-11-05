#!/usr/bin/python3
"""Verify an extracted release from a frozen three-column source manifest.

This verifier deliberately has no Git dependency. Production bundles exclude
`.git`; the approved manifest is the complete source inventory and every row is
opened with no-follow semantics before its digest is emitted.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import pathlib
import re
import stat


def fail(message: str) -> "NoReturn":
    raise SystemExit(f"ERROR: {message}")


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


def decode_path(value: str) -> pathlib.PurePosixPath:
    if not value or any(character in value for character in "\0\r\n\t"):
        fail("source manifest path contains a forbidden control character")
    relative = pathlib.PurePosixPath(value)
    if (
        relative.is_absolute()
        or relative.as_posix() != value
        or any(part in {"", ".", ".."} for part in relative.parts)
    ):
        fail(f"source manifest path is not normalized: {value}")
    return relative


parser = argparse.ArgumentParser(add_help=False)
parser.add_argument("--source", required=True)
parser.add_argument("--manifest", required=True)
arguments = parser.parse_args()

if os.geteuid() != 0:
    fail("source verification must run as root")
requested_root = pathlib.Path(arguments.source)
requested_manifest = pathlib.Path(arguments.manifest)
if not requested_root.is_absolute() or not requested_manifest.is_absolute():
    fail("source root and manifest must be absolute")
try:
    requested_root_metadata = requested_root.lstat()
    requested_manifest_metadata = requested_manifest.lstat()
    root = requested_root.resolve(strict=True)
    manifest_path = requested_manifest.resolve(strict=True)
except (FileNotFoundError, RuntimeError):
    fail("source root or manifest is missing or has an unsafe resolution")
if (
    root != requested_root
    or not stat.S_ISDIR(requested_root_metadata.st_mode)
    or stat.S_ISLNK(requested_root_metadata.st_mode)
    or requested_root_metadata.st_uid != 0
    or requested_root_metadata.st_mode & 0o022
):
    fail("source root is linked, writable, non-canonical, or not root-owned")
if manifest_path != requested_manifest:
    fail("source manifest traverses a symlink or is non-canonical")
manifest_metadata = manifest_path.lstat()
if (
    stable(manifest_metadata) != stable(requested_manifest_metadata)
    or not stat.S_ISREG(manifest_metadata.st_mode)
    or manifest_metadata.st_nlink != 1
    or manifest_metadata.st_uid != 0
    or manifest_metadata.st_mode & 0o022
):
    fail("source manifest is not one root-frozen ordinary file")

no_follow = getattr(os, "O_NOFOLLOW", None)
if no_follow is None:
    fail("no-follow file access is unavailable")
manifest_descriptor = os.open(manifest_path, os.O_RDONLY | no_follow)
try:
    opened_manifest = os.fstat(manifest_descriptor)
    if stable(opened_manifest) != stable(manifest_metadata):
        fail("source manifest changed while opening")
    manifest_chunks: list[bytes] = []
    manifest_size = 0
    while chunk := os.read(manifest_descriptor, 1024 * 1024):
        manifest_size += len(chunk)
        if manifest_size > 64 * 1024 * 1024:
            fail("source manifest exceeds the 64 MiB verification ceiling")
        manifest_chunks.append(chunk)
    if (
        stable(os.fstat(manifest_descriptor)) != stable(opened_manifest)
        or stable(manifest_path.lstat()) != stable(manifest_metadata)
    ):
        fail("source manifest changed while reading")
finally:
    os.close(manifest_descriptor)
try:
    manifest_text = b"".join(manifest_chunks).decode("utf-8", errors="strict")
except UnicodeDecodeError:
    fail("source manifest is not strict UTF-8")

rows: list[tuple[str, str, pathlib.PurePosixPath]] = []
seen: set[str] = set()
previous_key: bytes | None = None
for line in manifest_text.splitlines():
    match = re.fullmatch(r"([a-f0-9]{64})\t([FL])\t([^\t\r\n]+)", line)
    if match is None:
        fail("source manifest contains a malformed row")
    digest, kind, value = match.groups()
    relative = decode_path(value)
    key = value.encode("utf-8")
    if value in seen or (previous_key is not None and key <= previous_key):
        fail("source manifest paths are duplicate or not bytewise sorted")
    seen.add(value)
    previous_key = key
    rows.append((digest, kind, relative))
if not rows:
    fail("source manifest is empty")
approved_directories: set[str] = set()
for _, _, relative in rows:
    for parent in relative.parents:
        if parent != pathlib.PurePosixPath("."):
            approved_directories.add(parent.as_posix())

for expected_digest, expected_kind, relative in rows:
    value = relative.as_posix()
    for parent in relative.parents:
        if parent == pathlib.PurePosixPath("."):
            continue
        parent_metadata = root.joinpath(*parent.parts).lstat()
        if (
            stat.S_ISLNK(parent_metadata.st_mode)
            or not stat.S_ISDIR(parent_metadata.st_mode)
            or parent_metadata.st_uid != 0
            or parent_metadata.st_mode & 0o022
        ):
            fail(f"source member traverses a symlink ancestor: {value}")
    path = root.joinpath(*relative.parts)
    before = path.lstat()
    if stat.S_ISLNK(before.st_mode):
        if before.st_uid != 0:
            fail(f"source symlink is not root-owned: {value}")
        target = os.readlink(path)
        target_path = pathlib.PurePosixPath(target)
        if target_path.is_absolute() or ".." in target_path.parts:
            fail(f"unsafe source symlink: {value} -> {target}")
        digest = hashlib.sha256(target.encode("utf-8")).hexdigest()
        kind = "L"
        if stable(path.lstat()) != stable(before):
            fail(f"source symlink changed while hashing: {value}")
    elif (
        stat.S_ISREG(before.st_mode)
        and before.st_nlink == 1
        and before.st_uid == 0
        and not before.st_mode & 0o022
    ):
        descriptor = os.open(path, os.O_RDONLY | no_follow)
        try:
            opened = os.fstat(descriptor)
            if stable(opened) != stable(before):
                fail(f"source file changed while opening: {value}")
            state = hashlib.sha256()
            while chunk := os.read(descriptor, 1024 * 1024):
                state.update(chunk)
            if stable(os.fstat(descriptor)) != stable(opened) or stable(path.lstat()) != stable(before):
                fail(f"source file changed while hashing: {value}")
            digest = state.hexdigest()
            kind = "F"
        finally:
            os.close(descriptor)
    else:
        fail(f"linked, missing, directory, or special source member: {value}")
    if kind != expected_kind or digest != expected_digest:
        fail(f"source member differs from the approved manifest: {value}")

# Candidate execution must not add a second, unreviewed source file. Only the
# two deterministic build trees, the injected baseline fixture, and compiler
# bookkeeping are outside the approved source inventory.
for directory, directories, files in os.walk(root, topdown=True, followlinks=False):
    relative_directory = pathlib.Path(directory).relative_to(root)
    for name in directories:
        child = pathlib.Path(directory, name)
        child_relative = child.relative_to(root).as_posix()
        if child.is_symlink() and child_relative not in seen:
            fail(f"unapproved directory symlink was added to the release tree: {child_relative}")
        if child.is_symlink():
            continue
        if relative_directory == pathlib.Path(".") and name in {".next", "node_modules"}:
            continue
        if child_relative not in approved_directories:
            fail(f"unapproved directory was added to the release tree: {child_relative}")
    if relative_directory == pathlib.Path("."):
        for generated_name in [
            name for name in directories
            if name in {".next", "node_modules"}
        ]:
            if pathlib.Path(directory, generated_name).is_symlink():
                fail(f"generated release tree is a symlink: {generated_name}")
        directories[:] = [
            name for name in directories if name not in {".next", "node_modules"}
        ]
    for name in files:
        relative = (relative_directory / name).as_posix()
        if relative.startswith("./"):
            relative = relative[2:]
        if relative in seen:
            continue
        if relative == "tests/fixtures/competition-score-prospective-baseline.json":
            continue
        if relative == "tsconfig.tsbuildinfo":
            continue
        fail(f"unapproved file was added to the release tree: {relative}")

for digest, kind, relative in rows:
    print(f"{digest}\t{kind}\t{relative.as_posix()}")
