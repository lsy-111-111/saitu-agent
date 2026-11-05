#!/usr/bin/env python3
"""Emit a canonical JSON-lines manifest for an immutable filesystem tree."""

from __future__ import annotations

import hashlib
import json
import os
import pathlib
import stat
import sys


def fail(message: str) -> None:
    raise SystemExit(message)


if len(sys.argv) != 2:
    fail("usage: create-immutable-tree-manifest.py /absolute/tree")

requested_root = pathlib.Path(sys.argv[1])
if not requested_root.is_absolute() or requested_root.is_symlink():
    fail("immutable tree root must be an ordinary absolute directory")
root = requested_root.resolve(strict=True)
if not root.is_dir():
    fail("immutable tree root is not a directory")

entries: list[dict[str, object]] = []
for current, directory_names, file_names in os.walk(root, topdown=True, followlinks=False):
    current_path = pathlib.Path(current)
    for name in [*directory_names, *file_names]:
        candidate = current_path / name
        metadata = candidate.lstat()
        relative = candidate.relative_to(root).as_posix()
        common = {
            "gid": metadata.st_gid,
            "mode": f"{stat.S_IMODE(metadata.st_mode):04o}",
            "path": relative,
            "uid": metadata.st_uid,
        }
        if stat.S_ISLNK(metadata.st_mode):
            target_text = os.readlink(candidate)
            if "\n" in target_text or "\r" in target_text or "\0" in target_text:
                fail(f"linked path has a control character: {relative}")
            try:
                resolved_target = candidate.resolve(strict=True)
                resolved_target.relative_to(root)
            except (OSError, RuntimeError, ValueError):
                fail(f"linked path is broken or escapes the tree: {relative}")
            entries.append({**common, "kind": "symlink", "target": target_text})
        elif stat.S_ISDIR(metadata.st_mode):
            entries.append({**common, "kind": "directory"})
        elif stat.S_ISREG(metadata.st_mode):
            if metadata.st_nlink != 1:
                fail(f"hard-linked file is forbidden: {relative}")
            digest = hashlib.sha256()
            with candidate.open("rb") as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                    digest.update(chunk)
            entries.append(
                {
                    **common,
                    "kind": "file",
                    "sha256": digest.hexdigest(),
                    "size": metadata.st_size,
                }
            )
        else:
            fail(f"special filesystem member is forbidden: {relative}")

for entry in sorted(entries, key=lambda item: str(item["path"])):
    print(json.dumps(entry, ensure_ascii=True, separators=(",", ":"), sort_keys=True))
