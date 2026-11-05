#!/usr/bin/env bash
set -Eeuo pipefail

fail() {
  printf '%s\n' "ERROR: $*" >&2
  exit 1
}

[ "$#" -eq 1 ] || fail "usage: verify-single-link-tree.sh /absolute/tree"
case "$1" in /*) ;; *) fail "tree path must be absolute" ;; esac
[ -d "$1" ] && [ ! -L "$1" ] || fail "tree is missing, linked, or not a directory"

python3 -I - "$1" <<'PY'
import os
import pathlib
import stat
import sys

root = pathlib.Path(sys.argv[1]).resolve(strict=True)
for current, directory_names, file_names in os.walk(root, topdown=True, followlinks=False):
    current_path = pathlib.Path(current)
    for name in [*directory_names, *file_names]:
        candidate = current_path / name
        metadata = candidate.lstat()
        relative = candidate.relative_to(root).as_posix()
        if stat.S_ISLNK(metadata.st_mode):
            try:
                target = candidate.resolve(strict=True)
                target.relative_to(root)
            except (OSError, RuntimeError, ValueError):
                raise SystemExit(
                    f"linked dependency path escapes the immutable tree or is broken: {relative}"
                )
            target_mode = target.stat().st_mode
            if not (stat.S_ISREG(target_mode) or stat.S_ISDIR(target_mode)):
                raise SystemExit(f"linked dependency path targets a special file: {relative}")
            continue
        if stat.S_ISDIR(metadata.st_mode):
            continue
        if not stat.S_ISREG(metadata.st_mode):
            raise SystemExit(f"special file is forbidden in immutable dependency tree: {relative}")
        if metadata.st_nlink != 1:
            raise SystemExit(f"hard-linked file is forbidden in immutable dependency tree: {relative}")
PY
