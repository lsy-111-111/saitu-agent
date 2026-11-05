#!/usr/bin/env python3
"""Verify the pre-change host baseline and its first-root snapshot binding."""

from __future__ import annotations

import datetime
import hashlib
import os
import pathlib
import re
import stat
import sys


BOUNDARY_KEYS = {
    "SCHEMA_VERSION", "BOOTSTRAP_GENERATION", "BOOTSTRAP_MANIFEST_SHA256",
    "BOOTSTRAP_STARTED_AT", "BASELINE_STARTED_AT", "INITIAL_SNAPSHOT_RELEASE_ID",
    "INITIAL_SNAPSHOT_EVIDENCE", "INITIAL_SNAPSHOT_ID",
    "INITIAL_SNAPSHOT_EVIDENCE_SHA256", "INITIAL_SNAPSHOT_RESPONSE_SHA256",
    "INITIAL_DISKS_RESPONSE_SHA256", "INITIAL_SNAPSHOT_CAPTURED_AT",
}
SNAPSHOT_KEYS = {
    "SCHEMA_VERSION", "PROVIDER", "REGION", "INSTANCE_ID", "SYSTEM_DISK_ID",
    "SYSTEM_DISK_ZONE", "SYSTEM_DISK_STATE", "SYSTEM_DISK_ATTACHED",
    "SNAPSHOT_ID", "SNAPSHOT_STATUS", "SNAPSHOT_PERCENT", "RELEASE_ID",
    "CAPTURED_AT", "VERIFIED_AT", "RESTORE_SCOPE", "VERIFICATION_SOURCE",
    "SNAPSHOT_RESPONSE_SHA256", "DISKS_RESPONSE_SHA256", "SNAPSHOT_REQUEST_ID",
    "DISKS_REQUEST_ID", "SNAPSHOT_NAME",
}
HEX64 = re.compile(r"[a-f0-9]{64}")


def fail(message: str) -> "NoReturn":
    raise SystemExit(f"ERROR: {message}")


def parse_time(value: str, label: str) -> datetime.datetime:
    try:
        return datetime.datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(
            tzinfo=datetime.timezone.utc
        )
    except ValueError:
        fail(f"{label} is not one UTC whole-second timestamp")


def stable_file(path: pathlib.Path, mode: int, label: str) -> bytes:
    before = path.lstat()
    if (
        not stat.S_ISREG(before.st_mode)
        or stat.S_ISLNK(before.st_mode)
        or before.st_uid != 0
        or before.st_gid != 0
        or before.st_nlink != 1
        or stat.S_IMODE(before.st_mode) != mode
        or path.resolve(strict=True) != path
    ):
        fail(f"unsafe {label}: {path}")
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        opened = os.fstat(descriptor)
        chunks: list[bytes] = []
        total = 0
        while True:
            chunk = os.read(descriptor, 1024 * 1024)
            if not chunk:
                break
            chunks.append(chunk)
            total += len(chunk)
            if total > 256 * 1024 * 1024:
                fail(f"oversized {label}: {path}")
        after = os.fstat(descriptor)
    finally:
        os.close(descriptor)
    final = path.lstat()
    fields = (
        "st_dev", "st_ino", "st_mode", "st_uid", "st_gid", "st_nlink",
        "st_size", "st_mtime_ns", "st_ctime_ns",
    )
    if any(
        getattr(before, field) != getattr(observed, field)
        for observed in (opened, after, final)
        for field in fields
    ):
        fail(f"{label} changed while read: {path}")
    return b"".join(chunks)


def parse_env(raw: bytes, allowed: set[str], label: str) -> dict[str, str]:
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        fail(f"{label} is not UTF-8")
    if not text.endswith("\n"):
        fail(f"{label} is not newline terminated")
    values: dict[str, str] = {}
    for line in text.splitlines():
        if line.count("=") != 1:
            fail(f"{label} contains a malformed row")
        key, value = line.split("=", 1)
        if key not in allowed or key in values or not value:
            fail(f"{label} contains an unknown, duplicate, or empty field")
        values[key] = value
    if set(values) != allowed:
        fail(f"{label} does not contain its exact schema")
    return values


def main() -> None:
    if os.geteuid() != 0:
        fail("run host baseline verification as root")
    if len(sys.argv) != 5:
        fail(
            "usage: verify-host-baseline.py BASELINE_DIR SHA256SUMS_SHA256 "
            "BOOTSTRAP_GENERATION BOOTSTRAP_MANIFEST_SHA256"
        )
    baseline = pathlib.Path(sys.argv[1])
    expected_sums_sha = sys.argv[2]
    bootstrap_generation = sys.argv[3]
    bootstrap_manifest = sys.argv[4]
    if (
        re.fullmatch(r"/var/backups/resume-ai/prechange/20\d{6}T\d{6}Z", str(baseline)) is None
        or HEX64.fullmatch(expected_sums_sha) is None
        or bootstrap_generation
        != f"/var/lib/resume-ai/bootstrap-generations/generation-{bootstrap_manifest}"
        or HEX64.fullmatch(bootstrap_manifest) is None
    ):
        fail("host baseline invocation identity is malformed")
    metadata = baseline.lstat()
    if (
        not stat.S_ISDIR(metadata.st_mode)
        or baseline.is_symlink()
        or metadata.st_uid != 0
        or metadata.st_gid != 0
        or stat.S_IMODE(metadata.st_mode) != 0o700
        or baseline.resolve(strict=True) != baseline
    ):
        fail("host baseline directory is unsafe")
    sums_raw = stable_file(baseline / "SHA256SUMS", 0o600, "host baseline manifest")
    if hashlib.sha256(sums_raw).hexdigest() != expected_sums_sha:
        fail("host baseline manifest differs from its independent expected digest")
    try:
        sums_text = sums_raw.decode("utf-8")
    except UnicodeDecodeError:
        fail("host baseline manifest is not UTF-8")
    if not sums_text.endswith("\n"):
        fail("host baseline manifest is not newline terminated")
    records: dict[str, str] = {}
    for line in sums_text.splitlines():
        match = re.fullmatch(r"([a-f0-9]{64})  \./([A-Za-z0-9][A-Za-z0-9._-]{0,127})", line)
        if match is None or match.group(2) == "SHA256SUMS" or match.group(2) in records:
            fail("host baseline manifest contains a malformed or duplicate member")
        records[match.group(2)] = match.group(1)
    observed = {
        path.name for path in baseline.iterdir()
        if path.name != "SHA256SUMS"
    }
    if observed != set(records):
        fail("host baseline manifest does not cover its exact top-level inventory")
    members: dict[str, bytes] = {}
    for name, digest in records.items():
        data = stable_file(baseline / name, 0o600, f"host baseline member {name}")
        if hashlib.sha256(data).hexdigest() != digest:
            fail(f"host baseline member differs from manifest: {name}")
        members[name] = data
    required = {
        "bootstrap-boundary.env", "source-SHA256SUMS", "legacy-runtime.manifest.jsonl",
        "system-config.tar.gz", "nginx-effective.txt", "postgres-backup.txt",
    }
    if not required.issubset(members):
        fail("host baseline omits required rollback evidence")
    boundary = parse_env(
        members["bootstrap-boundary.env"], BOUNDARY_KEYS, "host baseline bootstrap boundary"
    )
    release = boundary["INITIAL_SNAPSHOT_RELEASE_ID"]
    evidence_path = pathlib.Path(boundary["INITIAL_SNAPSHOT_EVIDENCE"])
    if (
        boundary["SCHEMA_VERSION"] != "1"
        or boundary["BOOTSTRAP_GENERATION"] != bootstrap_generation
        or boundary["BOOTSTRAP_MANIFEST_SHA256"] != bootstrap_manifest
        or re.fullmatch(r"20\d{6}T\d{6}Z", release) is None
        or evidence_path
        != pathlib.Path(
            f"/var/lib/resume-ai/security/cloud-snapshots/{release}.initial-rollback.env"
        )
        or re.fullmatch(r"lhsnap-[A-Za-z0-9]{6,80}", boundary["INITIAL_SNAPSHOT_ID"])
        is None
        or any(
            HEX64.fullmatch(boundary[key]) is None
            for key in (
                "INITIAL_SNAPSHOT_EVIDENCE_SHA256", "INITIAL_SNAPSHOT_RESPONSE_SHA256",
                "INITIAL_DISKS_RESPONSE_SHA256",
            )
        )
    ):
        fail("host baseline bootstrap/snapshot identity is malformed")
    bootstrap_started = parse_time(boundary["BOOTSTRAP_STARTED_AT"], "bootstrap start")
    baseline_started = parse_time(boundary["BASELINE_STARTED_AT"], "baseline start")
    snapshot_captured = parse_time(
        boundary["INITIAL_SNAPSHOT_CAPTURED_AT"], "initial snapshot capture"
    )
    if snapshot_captured > bootstrap_started or bootstrap_started > baseline_started:
        fail("host baseline does not prove snapshot-before-bootstrap ordering")
    evidence_raw = stable_file(evidence_path, 0o400, "initial rollback snapshot evidence")
    if hashlib.sha256(evidence_raw).hexdigest() != boundary["INITIAL_SNAPSHOT_EVIDENCE_SHA256"]:
        fail("initial rollback snapshot evidence differs from the host baseline")
    snapshot = parse_env(evidence_raw, SNAPSHOT_KEYS, "initial rollback snapshot evidence")
    if (
        snapshot["SCHEMA_VERSION"] != "3"
        or snapshot["RELEASE_ID"] != release
        or snapshot["SNAPSHOT_ID"] != boundary["INITIAL_SNAPSHOT_ID"]
        or snapshot["CAPTURED_AT"] != boundary["INITIAL_SNAPSHOT_CAPTURED_AT"]
        or snapshot["SNAPSHOT_RESPONSE_SHA256"]
        != boundary["INITIAL_SNAPSHOT_RESPONSE_SHA256"]
        or snapshot["DISKS_RESPONSE_SHA256"] != boundary["INITIAL_DISKS_RESPONSE_SHA256"]
    ):
        fail("initial rollback snapshot differs from the baseline-bound API identity")
    print("\t".join((
        expected_sums_sha, release, str(evidence_path), boundary["INITIAL_SNAPSHOT_ID"],
        boundary["INITIAL_SNAPSHOT_EVIDENCE_SHA256"], boundary["BOOTSTRAP_STARTED_AT"],
    )))


if __name__ == "__main__":
    main()
