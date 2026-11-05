#!/usr/bin/env python3
"""Hash the exact, filtered NUL member set produced by Git.

The shell entrypoint is intentionally the only code allowed to obtain the
member list. This helper never walks a source tree and therefore cannot add a
Git-ignored credential, editor state, build output, or directory placeholder.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import pathlib
import stat


def fail(message: str) -> "NoReturn":
    raise SystemExit(f"ERROR: {message}")


parser = argparse.ArgumentParser(add_help=False)
parser.add_argument("--source", required=True)
parser.add_argument("--git-paths-nul", required=True)
parser.add_argument("--git-deleted-paths-nul", required=True)
parser.add_argument("--write-filtered-paths-nul")
arguments = parser.parse_args()

root = pathlib.Path(arguments.source).resolve(strict=True)
if not root.is_dir() or root.is_symlink():
    fail("source root is missing or unsafe")

raw_paths = pathlib.Path(arguments.git_paths_nul).read_bytes()
if raw_paths and not raw_paths.endswith(b"\0"):
    fail("Git member inventory is not NUL terminated")
raw_deleted_paths = pathlib.Path(arguments.git_deleted_paths_nul).read_bytes()
if raw_deleted_paths and not raw_deleted_paths.endswith(b"\0"):
    fail("Git deleted-member inventory is not NUL terminated")

excluded_roots = {
    ".git",
    ".claude",
    ".next",
    "artifacts",
    "coverage",
    "node_modules",
    "playwright-report",
    "test-results",
    "tmp",
}
excluded_exact = {
    "api密钥.rtfd",
    "tests/fixtures/competition-score-prospective-baseline.json",
}
credential_names = {".netrc", ".pypirc", "credentials.json", "secrets.env"}
credential_suffixes = {".jks", ".key", ".keystore", ".p12", ".pem", ".pfx"}


def excluded(relative: pathlib.PurePosixPath) -> bool:
    value = relative.as_posix()
    parts = relative.parts
    name = relative.name
    lowered = name.lower()
    if not parts:
        fail("empty source member")
    if parts[0] in excluded_roots or parts[0].startswith(".next-"):
        return True
    if "__pycache__" in parts or relative.suffix.lower() in {".pyc", ".pyo"}:
        return True
    if value in excluded_exact or parts[0] == "api密钥.rtfd":
        return True
    if name == ".DS_Store" or lowered.endswith(".tsbuildinfo"):
        return True
    # Keep the reviewed template while excluding every real dotenv variant.
    if name.startswith(".env") and value != ".env.example":
        return True
    if name in credential_names or name.startswith(("id_ed25519", "id_rsa")):
        return True
    if relative.suffix.lower() in credential_suffixes:
        return True
    if name == ".npmrc":
        if value != ".npmrc":
            fail(f"nested npm configuration is forbidden: {value}")
        npm_config = (root / value).read_bytes()
        if npm_config not in {b"engine-strict=true\n", b"engine-strict=true"}:
            fail("root .npmrc differs from the reviewed secret-free policy")
    return False


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


def decode(raw: bytes) -> pathlib.PurePosixPath:
    try:
        value = raw.decode("utf-8")
    except UnicodeDecodeError as error:
        fail(f"source member is not UTF-8: {error}")
    if not value or "\n" in value or "\r" in value or "\t" in value or "\0" in value:
        fail("source member contains a forbidden control character")
    path = pathlib.PurePosixPath(value)
    if path.is_absolute() or value != path.as_posix() or any(part in {"", ".", ".."} for part in path.parts):
        fail(f"source member is not a normalized relative path: {value}")
    return path


deleted = {decode(raw).as_posix() for raw in raw_deleted_paths.split(b"\0") if raw}
filtered: list[pathlib.PurePosixPath] = []
seen: set[str] = set()
for raw in raw_paths.split(b"\0"):
    if not raw:
        continue
    relative = decode(raw)
    value = relative.as_posix()
    if value in seen:
        fail(f"duplicate Git source member: {value}")
    seen.add(value)
    if value not in deleted and not excluded(relative):
        filtered.append(relative)

filtered.sort(key=lambda entry: entry.as_posix().encode("utf-8"))
if not filtered:
    fail("release source inventory is empty")

output_paths = bytearray()
manifest: list[tuple[str, str, str]] = []
no_follow = getattr(os, "O_NOFOLLOW", None)
if no_follow is None:
    fail("no-follow file access is unavailable")

for relative in filtered:
    value = relative.as_posix()
    for parent in relative.parents:
        if parent == pathlib.PurePosixPath("."):
            continue
        if root.joinpath(*parent.parts).is_symlink():
            fail(f"source member traverses a symlink ancestor: {value}")
    path = root.joinpath(*relative.parts)
    before = path.lstat()
    if stat.S_ISLNK(before.st_mode):
        target = os.readlink(path)
        target_path = pathlib.PurePosixPath(target)
        if target_path.is_absolute() or ".." in target_path.parts:
            fail(f"unsafe source symlink: {value} -> {target}")
        digest = hashlib.sha256(target.encode("utf-8")).hexdigest()
        if stable(path.lstat()) != stable(before):
            fail(f"source symlink changed while hashing: {value}")
        kind = "L"
    elif stat.S_ISREG(before.st_mode) and before.st_nlink == 1:
        descriptor = os.open(path, os.O_RDONLY | no_follow)
        try:
            opened = os.fstat(descriptor)
            if stable(opened) != stable(before):
                fail(f"source file changed while opening: {value}")
            digest_state = hashlib.sha256()
            while True:
                chunk = os.read(descriptor, 1024 * 1024)
                if not chunk:
                    break
                digest_state.update(chunk)
            if stable(os.fstat(descriptor)) != stable(opened) or stable(path.lstat()) != stable(before):
                fail(f"source file changed while hashing: {value}")
            digest = digest_state.hexdigest()
        finally:
            os.close(descriptor)
        kind = "F"
    else:
        fail(f"linked, missing, directory, or special source member: {value}")
    manifest.append((digest, kind, value))
    output_paths.extend(value.encode("utf-8") + b"\0")

if arguments.write_filtered_paths_nul:
    output = pathlib.Path(arguments.write_filtered_paths_nul)
    descriptor = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL | no_follow, 0o600)
    with os.fdopen(descriptor, "wb") as destination:
        destination.write(output_paths)
        destination.flush()
        os.fsync(destination.fileno())

for digest, kind, value in manifest:
    print(f"{digest}\t{kind}\t{value}")
