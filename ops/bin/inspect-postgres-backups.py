#!/usr/bin/env python3
"""Validate and order every atomically published PostgreSQL backup."""

from __future__ import annotations

import datetime
import hashlib
import os
import pathlib
import re
import stat
import sys
import time


def fail(message: str) -> "NoReturn":
    raise SystemExit(f"ERROR: {message}")


if len(sys.argv) not in (4, 5) or (len(sys.argv) == 5 and sys.argv[4] != "--require-checksums"):
    fail("usage: inspect-postgres-backups.py TIER_DIR TIER DATABASE [--require-checksums]")

raw_tier_root = pathlib.Path(sys.argv[1])
raw_tier_metadata = raw_tier_root.lstat()
if (not stat.S_ISDIR(raw_tier_metadata.st_mode) or stat.S_ISLNK(raw_tier_metadata.st_mode)
        or raw_tier_metadata.st_uid != 0 or raw_tier_metadata.st_gid != 0
        or stat.S_IMODE(raw_tier_metadata.st_mode) != 0o700):
    fail("backup tier root is not a private root-owned directory")
tier_root = raw_tier_root.resolve(strict=True)
if tier_root != raw_tier_root.absolute():
    fail("backup tier root contains a symlinked path component")
expected_tier = sys.argv[2]
expected_database = sys.argv[3]
require_checksums = len(sys.argv) == 5
if expected_tier not in {"daily", "weekly", "predeploy"}:
    fail("invalid backup tier")
if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", expected_database):
    fail("invalid backup database")

required_files = {"database.dump", "globals.sql", "archive.list", "manifest.env", "SHA256SUMS"}
legacy_manifest_keys = {
    "BACKUP_ID", "BACKUP_TIER", "DATABASE_NAME", "CREATED_AT", "POSTGRES_VERSION",
    "DATA_CHECKSUMS", "SYSTEM_IDENTIFIER", "DATABASE_SIZE_BYTES", "RPO_HOURS", "RTO_SECONDS",
}
current_manifest_keys = legacy_manifest_keys | {
    "BACKUP_SCHEMA_VERSION", "BACKUP_WRITER_SHA256", "BACKUP_INSPECTOR_SHA256",
    "RETENTION_SELECTOR_SHA256", "BACKUP_CONFIG_SOURCE", "BACKUP_CONFIG_SHA256",
}
mountinfo = pathlib.Path("/proc/self/mountinfo")
if not mountinfo.is_file():
    fail("mount topology is unavailable")
mounts = []
for line in mountinfo.read_text(encoding="utf-8").splitlines():
    fields = line.split()
    if len(fields) < 5:
        fail("malformed mount topology")
    mounts.append(pathlib.Path(fields[4].replace("\\040", " ").replace("\\011", "\t").replace("\\012", "\n").replace("\\134", "\\")))


def sha256(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


rows = []
now = int(time.time())
for candidate in sorted(tier_root.iterdir()):
    if not re.fullmatch(r"20\d{6}T\d{6}Z", candidate.name):
        continue
    metadata = candidate.lstat()
    if (not stat.S_ISDIR(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode)
            or metadata.st_uid != 0 or metadata.st_gid != 0
            or stat.S_IMODE(metadata.st_mode) != 0o700):
        fail(f"unsafe published backup directory: {candidate}")
    for mount in mounts:
        try:
            mount.relative_to(candidate)
        except ValueError:
            continue
        fail(f"published backup contains or is a mount point: {mount}")
    observed = {member.name for member in candidate.iterdir()}
    if observed != required_files:
        fail(f"published backup has a missing or unexpected member: {candidate}")
    for name in required_files:
        member = candidate / name
        member_metadata = member.lstat()
        if (not stat.S_ISREG(member_metadata.st_mode) or stat.S_ISLNK(member_metadata.st_mode)
                or member_metadata.st_uid != 0 or member_metadata.st_gid != 0
                or stat.S_IMODE(member_metadata.st_mode) != 0o600 or member_metadata.st_nlink != 1):
            fail(f"unsafe published backup member: {member}")

    checksums = {}
    for line in (candidate / "SHA256SUMS").read_text(encoding="utf-8").splitlines():
        match = re.fullmatch(r"([a-f0-9]{64})  (database\.dump|globals\.sql|archive\.list|manifest\.env)", line)
        if not match or match.group(2) in checksums:
            fail(f"malformed published backup checksum manifest: {candidate}")
        checksums[match.group(2)] = match.group(1)
    if set(checksums) != required_files - {"SHA256SUMS"}:
        fail(f"incomplete published backup checksum manifest: {candidate}")
    for name, expected in checksums.items():
        if sha256(candidate / name) != expected:
            fail(f"published backup checksum mismatch: {candidate / name}")

    manifest = {}
    for line in (candidate / "manifest.env").read_text(encoding="utf-8").splitlines():
        if "=" not in line:
            fail(f"malformed published backup manifest: {candidate}")
        key, value = line.split("=", 1)
        if key not in current_manifest_keys or key in manifest or not value:
            fail(f"unknown, duplicate, or empty published backup manifest row: {candidate}")
        manifest[key] = value
    if set(manifest) not in (legacy_manifest_keys, current_manifest_keys):
        fail(f"incomplete published backup manifest: {candidate}")
    if (manifest["BACKUP_ID"] != candidate.name or manifest["BACKUP_TIER"] != expected_tier
            or manifest["DATABASE_NAME"] != expected_database):
        fail(f"published backup identity mismatch: {candidate}")
    if manifest["DATA_CHECKSUMS"] not in {"on", "off"}:
        fail(f"published backup checksum state is unacceptable: {candidate}")
    if not re.fullmatch(r"\d{10,}", manifest["SYSTEM_IDENTIFIER"]):
        fail(f"published backup system identifier is invalid: {candidate}")
    for key in ("DATABASE_SIZE_BYTES", "RPO_HOURS", "RTO_SECONDS"):
        if not re.fullmatch(r"\d+", manifest[key]):
            fail(f"published backup numeric field is invalid: {candidate}")
    if set(manifest) == current_manifest_keys:
        if manifest["BACKUP_SCHEMA_VERSION"] != "2":
            fail(f"published backup schema version is unsupported: {candidate}")
        if manifest["BACKUP_CONFIG_SOURCE"] not in {"file", "builtin-v1"}:
            fail(f"published backup configuration source is invalid: {candidate}")
        for key in (
            "BACKUP_WRITER_SHA256", "BACKUP_INSPECTOR_SHA256",
            "RETENTION_SELECTOR_SHA256", "BACKUP_CONFIG_SHA256",
        ):
            if not re.fullmatch(r"[a-f0-9]{64}", manifest[key]):
                fail(f"published backup contract digest is invalid: {candidate}")

    identity_time = datetime.datetime.strptime(candidate.name, "%Y%m%dT%H%M%SZ").replace(
        tzinfo=datetime.timezone.utc
    )
    try:
        created_time = datetime.datetime.strptime(manifest["CREATED_AT"], "%Y-%m-%dT%H:%M:%SZ").replace(
            tzinfo=datetime.timezone.utc
        )
    except ValueError:
        fail(f"published backup creation timestamp is invalid: {candidate}")
    identity_epoch = int(identity_time.timestamp())
    created_epoch = int(created_time.timestamp())
    if (now - identity_epoch < -300 or now - created_epoch < -300
            or created_epoch < identity_epoch or created_epoch - identity_epoch > 86400):
        fail(f"published backup is future-dated or has inconsistent timestamps: {candidate}")
    rows.append((created_epoch, candidate.name, candidate, manifest["DATA_CHECKSUMS"] == "on"))

eligible_rows = [row for row in rows if not require_checksums or row[3]]
if require_checksums and not eligible_rows:
    fail("no structurally valid checksummed backup exists")
for created_epoch, _, candidate, _ in sorted(eligible_rows):
    print(f"{created_epoch}\t{candidate}")
