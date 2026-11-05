#!/usr/bin/env python3
"""Verify that all quota derivatives belong to one committed generation."""

from __future__ import annotations

import hashlib
import os
import pathlib
import re
import stat
import sys


def fail(message: str) -> "NoReturn":
    raise SystemExit(f"ERROR: {message}")


if len(sys.argv) != 6:
    fail("usage: verify-quota-generation.py MANIFEST APP GLOBAL RECOMMEND TRACK")

def stable_bytes(path: pathlib.Path) -> bytes:
    try:
        if path.resolve(strict=True) != path:
            fail(f"quota generation member traverses a symbolic-link ancestor: {path}")
    except RuntimeError:
        fail(f"quota generation member has an unsafe resolution loop: {path}")
    before = path.lstat()
    if (not stat.S_ISREG(before.st_mode) or stat.S_ISLNK(before.st_mode)
            or before.st_nlink != 1 or before.st_size > 1024 * 1024):
        fail(f"quota generation member is linked or not one bounded ordinary file: {path}")
    flags = os.O_RDONLY | os.O_CLOEXEC
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(path, flags)
    try:
        opened = os.fstat(descriptor)
        fields = (
            "st_dev", "st_ino", "st_mode", "st_uid", "st_gid", "st_nlink",
            "st_size", "st_mtime_ns", "st_ctime_ns",
        )
        if any(getattr(before, field) != getattr(opened, field) for field in fields):
            fail(f"quota generation member changed while it was opened: {path}")
        chunks: list[bytes] = []
        total = 0
        while True:
            chunk = os.read(descriptor, min(1024 * 1024, 1024 * 1024 + 1 - total))
            if not chunk:
                break
            chunks.append(chunk)
            total += len(chunk)
            if total > 1024 * 1024:
                fail(f"quota generation member exceeds its review bound: {path}")
        after_open = os.fstat(descriptor)
    finally:
        os.close(descriptor)
    after_path = path.lstat()
    if (any(getattr(before, field) != getattr(after_open, field) for field in fields)
            or any(getattr(before, field) != getattr(after_path, field) for field in fields)):
        fail(f"quota generation member changed while it was read: {path}")
    return b"".join(chunks)


paths = [pathlib.Path(value) for value in sys.argv[1:]]
raw_members: list[bytes] = []
for path in paths:
    if not path.is_absolute():
        fail("quota generation paths must be absolute")
    try:
        raw_members.append(stable_bytes(path))
    except FileNotFoundError:
        fail(f"quota generation member is missing: {path}")

manifest_path, *members = paths
manifest_raw, *member_bytes = raw_members
allowed = {
    "SCHEMA_VERSION",
    "GENERATION_SHA256",
    "APPLICATION_QUOTA_SHA256",
    "NGINX_GLOBAL_SHA256",
    "NGINX_RECOMMEND_SHA256",
    "NGINX_TRACK_SHA256",
}
values: dict[str, str] = {}
try:
    manifest_text = manifest_raw.decode("utf-8", errors="strict")
except UnicodeDecodeError:
    fail("quota generation manifest is not UTF-8")
for line in manifest_text.splitlines():
    if "=" not in line:
        fail("quota generation manifest contains a malformed line")
    key, value = line.split("=", 1)
    if key not in allowed or key in values:
        fail("quota generation manifest contains an unknown or duplicate key")
    values[key] = value
if set(values) != allowed or values["SCHEMA_VERSION"] != "1":
    fail("quota generation manifest is incomplete or has the wrong schema")
generation = values["GENERATION_SHA256"]
if re.fullmatch(r"[a-f0-9]{64}", generation) is None:
    fail("quota generation identity is malformed")

digest_keys = (
    "APPLICATION_QUOTA_SHA256",
    "NGINX_GLOBAL_SHA256",
    "NGINX_RECOMMEND_SHA256",
    "NGINX_TRACK_SHA256",
)
marker = f"# Quota-Generation-SHA256: {generation}"
for path, raw, digest_key in zip(members, member_bytes, digest_keys):
    if hashlib.sha256(raw).hexdigest() != values[digest_key]:
        fail(f"quota generation digest mismatch: {path}")
    text = raw.decode("utf-8", errors="strict")
    if text.splitlines().count(marker) != 1:
        fail(f"quota generation marker is missing or duplicated: {path}")
print(generation)
