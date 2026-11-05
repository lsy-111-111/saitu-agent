#!/usr/bin/env python3
"""Canonically generate or check the non-self-referential bootstrap manifest."""

from __future__ import annotations

import hashlib
import os
import pathlib
import stat
import sys


HEADER = "RESUME_AI_BOOTSTRAP_SOURCE_MANIFEST_V1"


def fail(message: str) -> "NoReturn":
    raise SystemExit(f"ERROR: {message}")


def exact_relative(raw: str) -> pathlib.PurePosixPath:
    path = pathlib.PurePosixPath(raw)
    if (
        not raw
        or raw.startswith("/")
        or "\\" in raw
        or any(character in raw for character in ("\x00", "\t", "\r", "\n"))
        or raw != str(path)
        or any(part in ("", ".", "..") for part in path.parts)
        or path.parts[0] not in {"ops", "scripts"}
    ):
        fail(f"non-canonical bootstrap member: {raw!r}")
    return path


class SourceTree:
    """Race-resistant, no-follow reader for the unprivileged source tree."""

    def __init__(self, root: pathlib.Path):
        if not root.is_absolute():
            fail("source root must be absolute")
        before = root.lstat()
        if not stat.S_ISDIR(before.st_mode) or root.is_symlink():
            fail("source root is missing, linked, or non-directory")
        flags = os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        self.root_fd = os.open(root, flags)
        opened = os.fstat(self.root_fd)
        identity = ("st_dev", "st_ino", "st_mode", "st_uid", "st_gid")
        if any(getattr(before, field) != getattr(opened, field) for field in identity):
            os.close(self.root_fd)
            fail("source root changed while it was opened")

    def close(self) -> None:
        os.close(self.root_fd)

    def _open_parent(self, relative: pathlib.PurePosixPath) -> tuple[int, str]:
        descriptor = os.dup(self.root_fd)
        flags = os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        try:
            for part in relative.parts[:-1]:
                child = os.open(part, flags, dir_fd=descriptor)
                os.close(descriptor)
                descriptor = child
            return descriptor, relative.name
        except BaseException:
            os.close(descriptor)
            raise

    def read(self, relative_text: str) -> bytes:
        if relative_text == "bootstrap-source-manifest.txt":
            relative = pathlib.PurePosixPath(relative_text)
        else:
            relative = exact_relative(relative_text)
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
        try:
            root_ops = os.open("ops", flags, dir_fd=self.root_fd)
        except OSError as error:
            fail(f"ops source root cannot be opened safely: {error}")
        inventory: set[str] = set()
        stack: list[tuple[tuple[str, ...], int]] = [(('ops',), root_ops)]
        while stack:
            prefix, descriptor = stack.pop()
            try:
                for entry in os.scandir(descriptor):
                    relative = "/".join(prefix + (entry.name,))
                    exact_relative(relative)
                    metadata = entry.stat(follow_symlinks=False)
                    if entry.is_symlink():
                        fail(f"ops inventory contains a symlink: {relative}")
                    if stat.S_ISDIR(metadata.st_mode):
                        if entry.name == "__pycache__":
                            fail(f"ops inventory contains a generated Python cache: {relative}")
                        child = os.open(entry.name, flags, dir_fd=descriptor)
                        stack.append((prefix + (entry.name,), child))
                    elif stat.S_ISREG(metadata.st_mode):
                        if metadata.st_nlink != 1:
                            fail(f"ops inventory contains a hardlink: {relative}")
                        if entry.name.endswith(".pyc"):
                            fail(f"ops inventory contains generated Python bytecode: {relative}")
                        inventory.add(relative)
                    else:
                        fail(f"ops inventory contains a special file: {relative}")
            finally:
                os.close(descriptor)
        return inventory


def control_sources(tree: SourceTree) -> set[str]:
    sources: set[str] = set()
    try:
        text = tree.read("ops/config/control-plane-files.conf").decode("utf-8")
    except UnicodeDecodeError:
        fail("control-plane-files.conf is not UTF-8")
    for line in text.splitlines():
        if not line or line.startswith("#"):
            continue
        fields = line.split("\t")
        if len(fields) != 3:
            fail("control-plane-files.conf contains a malformed row")
        sources.add(str(exact_relative(fields[1])))
    return sources


def generate_from_tree(tree: SourceTree) -> bytes:
    inventory = tree.ops_inventory()
    inventory.update(control_sources(tree))
    records: list[str] = []
    for relative in sorted(inventory, key=lambda item: item.encode("utf-8")):
        path = exact_relative(relative)
        data = tree.read(relative)
        mode = "0500" if relative.startswith("ops/bin/") or (
            relative.startswith("scripts/") and path.suffix in {".js", ".mjs", ".sh"}
        ) else "0400"
        records.append(
            f"FILE\t{mode}\t{len(data)}\t{hashlib.sha256(data).hexdigest()}\t{relative}"
        )
    return (HEADER + "\n" + "\n".join(records) + "\n").encode("utf-8")


def generate(root: pathlib.Path) -> bytes:
    tree = SourceTree(root)
    try:
        return generate_from_tree(tree)
    finally:
        tree.close()


def main() -> None:
    if len(sys.argv) == 3 and sys.argv[1] == "generate":
        payload = generate(pathlib.Path(sys.argv[2]))
        written = 0
        while written < len(payload):
            count = os.write(sys.stdout.fileno(), payload[written:])
            if count <= 0:
                fail("short write while emitting bootstrap source manifest")
            written += count
        return
    if len(sys.argv) == 4 and sys.argv[1] == "check":
        root = pathlib.Path(sys.argv[2])
        manifest = pathlib.Path(sys.argv[3])
        if manifest != root / "bootstrap-source-manifest.txt":
            fail("bootstrap manifest must use its fixed source-root basename")
        tree = SourceTree(root)
        try:
            expected = generate_from_tree(tree)
            observed = tree.read("bootstrap-source-manifest.txt")
        finally:
            tree.close()
        if observed != expected:
            fail("committed bootstrap source manifest is stale or non-canonical")
        print(hashlib.sha256(observed).hexdigest())
        return
    fail(
        "usage: generate-bootstrap-source-manifest.py generate SOURCE_ROOT | "
        "check SOURCE_ROOT MANIFEST"
    )


if __name__ == "__main__":
    main()
