#!/usr/bin/env python3
"""Record pending state or semantically verify Tencent Lighthouse API evidence.

This helper never creates, deletes, or mutates a cloud snapshot.  A successful
record requires frozen responses from both DescribeSnapshots and DescribeDisks;
screenshots and operator-written status files are intentionally insufficient.
"""

from __future__ import annotations

import datetime
import ctypes
import errno
import hashlib
import json
import os
import pathlib
import re
import secrets
import stat
import subprocess
import sys


def fail(message: str) -> "NoReturn":
    raise SystemExit(f"ERROR: {message}")


def root_input(raw: str, label: str) -> tuple[pathlib.Path, bytes, os.stat_result]:
    path = pathlib.Path(raw)
    if not path.is_absolute():
        fail(f"{label} must be absolute")
    before = path.lstat()
    if (not stat.S_ISREG(before.st_mode) or path.is_symlink()
            or before.st_uid != 0 or before.st_gid != 0 or before.st_nlink != 1
            or stat.S_IMODE(before.st_mode) != 0o400 or before.st_size > 8 * 1024 * 1024):
        fail(f"{label} must be one bounded root-owned mode-0400 file")
    flags = os.O_RDONLY | os.O_CLOEXEC
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(path, flags)
    try:
        opened = os.fstat(descriptor)
        stable_fields = (
            "st_dev", "st_ino", "st_mode", "st_uid", "st_gid", "st_nlink",
            "st_size", "st_mtime_ns", "st_ctime_ns",
        )
        if any(getattr(before, field) != getattr(opened, field) for field in stable_fields):
            fail(f"{label} changed while it was opened")
        chunks: list[bytes] = []
        total = 0
        while True:
            chunk = os.read(descriptor, min(1024 * 1024, 8 * 1024 * 1024 + 1 - total))
            if not chunk:
                break
            chunks.append(chunk)
            total += len(chunk)
            if total > 8 * 1024 * 1024:
                fail(f"{label} exceeds the evidence size bound")
        after_open = os.fstat(descriptor)
    finally:
        os.close(descriptor)
    after_path = path.lstat()
    if (any(getattr(before, field) != getattr(after_open, field) for field in stable_fields)
            or any(getattr(before, field) != getattr(after_path, field) for field in stable_fields)):
        fail(f"{label} changed while it was read")
    return path, b"".join(chunks), before


def protected_input(
    raw: str, label: str, expected_mode: int, maximum_size: int
) -> tuple[pathlib.Path, bytes, os.stat_result]:
    path = pathlib.Path(raw)
    if not path.is_absolute():
        fail(f"{label} must be absolute")
    before = path.lstat()
    if (not stat.S_ISREG(before.st_mode) or path.is_symlink()
            or before.st_uid != 0 or before.st_gid != 0 or before.st_nlink != 1
            or stat.S_IMODE(before.st_mode) != expected_mode
            or before.st_size > maximum_size
            or path.resolve(strict=True) != path.absolute()):
        fail(f"{label} has unsafe metadata")
    flags = os.O_RDONLY | os.O_CLOEXEC
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(path, flags)
    try:
        opened = os.fstat(descriptor)
        stable_fields = (
            "st_dev", "st_ino", "st_mode", "st_uid", "st_gid", "st_nlink",
            "st_size", "st_mtime_ns", "st_ctime_ns",
        )
        if any(getattr(before, field) != getattr(opened, field) for field in stable_fields):
            fail(f"{label} changed while it was opened")
        chunks: list[bytes] = []
        total = 0
        while True:
            chunk = os.read(descriptor, min(64 * 1024, maximum_size + 1 - total))
            if not chunk:
                break
            chunks.append(chunk)
            total += len(chunk)
            if total > maximum_size:
                fail(f"{label} exceeds the size bound")
        after_open = os.fstat(descriptor)
    finally:
        os.close(descriptor)
    after_path = path.lstat()
    if (any(getattr(before, field) != getattr(after_open, field) for field in stable_fields)
            or any(getattr(before, field) != getattr(after_path, field) for field in stable_fields)):
        fail(f"{label} changed while it was read")
    return path, b"".join(chunks), before


def parse_utc_seconds(value: str, label: str) -> datetime.datetime:
    try:
        parsed = datetime.datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(
            tzinfo=datetime.timezone.utc
        )
    except ValueError:
        fail(f"{label} is not one UTC whole-second timestamp")
    return parsed


def parse_env(raw: bytes, label: str, allowed: set[str]) -> dict[str, str]:
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as error:
        fail(f"{label} is not UTF-8: {error}")
    if not text.endswith("\n"):
        fail(f"{label} is not newline terminated")
    values: dict[str, str] = {}
    for line in text.splitlines():
        if "=" not in line:
            fail(f"{label} contains a malformed row")
        key, value = line.split("=", 1)
        if key not in allowed or key in values or not value:
            fail(f"{label} contains an unknown, duplicate, or empty value")
        values[key] = value
    if set(values) != allowed:
        fail(f"{label} does not contain its exact schema")
    return values


def signing_provisioning() -> tuple[datetime.datetime, str, str]:
    marker_path, marker_raw, _ = protected_input(
        "/etc/resume-ai/release-evidence-signing.env",
        "Linux validation signing provisioning marker", 0o600, 4096,
    )
    public_path, public_raw, _ = protected_input(
        "/etc/resume-ai/release-evidence-signing.pub",
        "Linux validation signing public key", 0o644, 64 * 1024,
    )
    values = parse_env(
        marker_raw,
        "Linux validation signing provisioning marker",
        {"SCHEMA_VERSION", "PROVISIONED_AT", "PUBLIC_KEY_SHA256"},
    )
    public_sha256 = hashlib.sha256(public_raw).hexdigest()
    if (values["SCHEMA_VERSION"] != "1"
            or re.fullmatch(r"[a-f0-9]{64}", values["PUBLIC_KEY_SHA256"]) is None
            or values["PUBLIC_KEY_SHA256"] != public_sha256):
        fail("Linux validation signing marker does not bind the fixed public key")
    provisioned = parse_utc_seconds(values["PROVISIONED_AT"], "signing key provisioning time")
    now = datetime.datetime.now(datetime.timezone.utc)
    if provisioned > now + datetime.timedelta(minutes=5):
        fail("signing key provisioning time is in the future")
    # Keep these variables alive until both stable reads have completed; their
    # absolute canonical identities are part of the trust contract.
    if marker_path != pathlib.Path("/etc/resume-ai/release-evidence-signing.env"):
        fail("signing marker path is not fixed")
    if public_path != pathlib.Path("/etc/resume-ai/release-evidence-signing.pub"):
        fail("signing public key path is not fixed")
    return provisioned, public_sha256, hashlib.sha256(marker_raw).hexdigest()


def runtime_layout_started_at(required: bool) -> tuple[datetime.datetime, str] | None:
    marker = pathlib.Path("/etc/resume-ai/runtime-layout-bootstrap.env")
    try:
        _, raw, _ = protected_input(
            str(marker), "runtime-layout bootstrap completion receipt", 0o400, 4096,
        )
    except FileNotFoundError:
        if required:
            fail("runtime-layout bootstrap completion receipt is missing")
        return None
    values = parse_env(
        raw,
        "runtime-layout bootstrap completion receipt",
        {
            "SCHEMA_VERSION", "PHASE", "STARTED_AT",
            "BOOTSTRAP_GENERATION", "BOOTSTRAP_MANIFEST_SHA256",
            "HOST_BASELINE_DIR", "HOST_BASELINE_MANIFEST_SHA256",
            "SOURCE_GENERATION_SHA256", "CONTROL_SPEC_SHA256",
        },
    )
    bootstrap_hash = values["BOOTSTRAP_MANIFEST_SHA256"]
    if (values["SCHEMA_VERSION"] != "4" or values["PHASE"] != "complete"
            or re.fullmatch(r"[a-f0-9]{64}", values["SOURCE_GENERATION_SHA256"]) is None
            or re.fullmatch(r"[a-f0-9]{64}", values["CONTROL_SPEC_SHA256"]) is None
            or re.fullmatch(r"[a-f0-9]{64}", bootstrap_hash) is None
            or values["BOOTSTRAP_GENERATION"]
            != f"/var/lib/resume-ai/bootstrap-generations/generation-{bootstrap_hash}"
            or re.fullmatch(r"/var/backups/resume-ai/prechange/20\d{6}T\d{6}Z",
                            values["HOST_BASELINE_DIR"]) is None
            or re.fullmatch(r"[a-f0-9]{64}", values["HOST_BASELINE_MANIFEST_SHA256"])
            is None):
        fail("runtime-layout bootstrap completion receipt is malformed")
    started = parse_utc_seconds(values["STARTED_AT"], "runtime-layout bootstrap start time")
    if started > datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=5):
        fail("runtime-layout bootstrap start time is in the future")
    return started, bootstrap_hash


def bootstrap_generation() -> tuple[datetime.datetime, str, str]:
    _, raw, _ = protected_input(
        "/var/lib/resume-ai/bootstrap-generation.env",
        "active first-root bootstrap receipt", 0o400, 4096,
    )
    allowed = {
        "SCHEMA_VERSION", "PHASE", "STARTED_AT", "GENERATION_PATH",
        "BOOTSTRAP_MANIFEST_SHA256", "COPIER_SHA256", "MEMBER_COUNT",
    }
    values = parse_env(raw, "active first-root bootstrap receipt", allowed)
    manifest_sha = values["BOOTSTRAP_MANIFEST_SHA256"]
    generation = values["GENERATION_PATH"]
    if (values["SCHEMA_VERSION"] != "1" or values["PHASE"] != "complete"
            or re.fullmatch(r"[a-f0-9]{64}", manifest_sha) is None
            or re.fullmatch(r"[a-f0-9]{64}", values["COPIER_SHA256"]) is None
            or generation != f"/var/lib/resume-ai/bootstrap-generations/generation-{manifest_sha}"
            or not values["MEMBER_COUNT"].isdigit()
            or int(values["MEMBER_COUNT"]) <= 0):
        fail("active first-root bootstrap receipt is malformed")
    started = parse_utc_seconds(values["STARTED_AT"], "first-root bootstrap start time")
    if started > datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=5):
        fail("first-root bootstrap start time is in the future")
    return started, manifest_sha, hashlib.sha256(raw).hexdigest()


def initial_change_boundary(require_runtime: bool) -> datetime.datetime:
    started, bootstrap_hash, _ = bootstrap_generation()
    if require_runtime:
        runtime_identity = runtime_layout_started_at(required=True)
        if runtime_identity is None or runtime_identity != (started, bootstrap_hash):
            fail("runtime-layout identity differs from the first-root bootstrap boundary")
    return started


def verify_execution_trust(action: str) -> None:
    initial_actions = {
        "--pending-initial-rollback", "--api-initial-rollback",
        "--verify-initial-pre-bootstrap",
    }
    self_path = pathlib.Path(__file__).resolve(strict=True)
    if action in initial_actions:
        _, manifest_sha, _ = bootstrap_generation()
        generation = pathlib.Path(
            f"/var/lib/resume-ai/bootstrap-generations/generation-{manifest_sha}"
        )
        expected = generation / "ops/bin/record-cloud-snapshot-evidence.py"
        if self_path != expected:
            fail("initial snapshot control must execute from the active bootstrap generation")
        protected_input(str(expected), "bootstrap snapshot evidence control", 0o500, 1024 * 1024)
        copier = pathlib.Path("/usr/local/lib/resume-ai/create-bootstrap-generation.py")
        protected_input(str(copier), "fixed bootstrap generation verifier", 0o555, 1024 * 1024)
        result = subprocess.run(
            [
                "/usr/bin/env", "-i", "PATH=/usr/sbin:/usr/bin:/sbin:/bin",
                "/usr/bin/python3", "-I", str(copier), "verify",
                str(generation), manifest_sha,
            ],
            cwd="/", check=False, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, timeout=120,
        )
        if result.returncode != 0:
            fail("initial snapshot control failed its fixed bootstrap generation verifier")
        fields = result.stdout.rstrip("\n").split("\t")
        if len(fields) != 4 or fields[0] != str(generation) or fields[1] != manifest_sha:
            fail("bootstrap generation verifier returned a malformed identity")
        return
    installed = pathlib.Path("/usr/local/lib/resume-ai/record-cloud-snapshot-evidence.py")
    if self_path != installed:
        fail("managed snapshot control must execute from its fixed installed path")
    protected_input(str(installed), "fixed managed snapshot evidence control", 0o755, 1024 * 1024)


def output_directory(raw: str) -> pathlib.Path:
    path = pathlib.Path(raw)
    if not path.is_absolute():
        fail("snapshot evidence directory must be absolute")
    metadata = path.lstat()
    if (not stat.S_ISDIR(metadata.st_mode) or path.is_symlink()
            or metadata.st_uid != 0 or metadata.st_gid != 0
            or stat.S_IMODE(metadata.st_mode) != 0o700):
        fail("snapshot evidence directory must be root-owned mode 0700")
    if path.resolve(strict=True) != path.absolute():
        fail("snapshot evidence directory contains a linked path component")
    return path


def release_id(raw: str) -> str:
    if re.fullmatch(r"20\d{6}T\d{6}Z", raw) is None:
        fail("snapshot evidence release identity is malformed")
    return raw


def publish(directory: pathlib.Path, name: str, payload: str) -> pathlib.Path:
    target = directory / name
    if pathlib.PurePath(name).name != name or not name:
        fail("snapshot evidence basename is unsafe")
    directory_before = directory.lstat()
    directory_flags = os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC
    if hasattr(os, "O_NOFOLLOW"):
        directory_flags |= os.O_NOFOLLOW
    directory_fd = os.open(directory, directory_flags)
    temporary_name = f".snapshot-evidence.{os.getpid()}.{secrets.token_hex(8)}"
    descriptor = -1
    try:
        directory_opened = os.fstat(directory_fd)
        for field in ("st_dev", "st_ino", "st_mode", "st_uid", "st_gid"):
            if getattr(directory_before, field) != getattr(directory_opened, field):
                fail("snapshot evidence directory changed while it was opened")
        descriptor = os.open(
            temporary_name,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_CLOEXEC,
            0o600,
            dir_fd=directory_fd,
        )
        os.fchown(descriptor, 0, 0)
        os.fchmod(descriptor, 0o400)
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as stream:
            descriptor = -1
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        libc = ctypes.CDLL(None, use_errno=True)
        renameat2 = getattr(libc, "renameat2", None)
        if renameat2 is None:
            fail("atomic no-clobber renameat2 is unavailable")
        renameat2.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
        renameat2.restype = ctypes.c_int
        if renameat2(
            directory_fd, os.fsencode(temporary_name),
            directory_fd, os.fsencode(name), 1,
        ) != 0:
            error_number = ctypes.get_errno()
            if error_number == errno.EEXIST:
                fail("snapshot evidence for this release already exists")
            fail(f"atomic snapshot evidence publication failed: {os.strerror(error_number)}")
        os.fsync(directory_fd)
        expected = payload.encode("utf-8")
        published_fd = os.open(
            name,
            os.O_RDONLY | os.O_CLOEXEC | getattr(os, "O_NOFOLLOW", 0),
            dir_fd=directory_fd,
        )
        try:
            published_metadata = os.fstat(published_fd)
            observed = bytearray()
            while True:
                chunk = os.read(published_fd, 64 * 1024)
                if not chunk:
                    break
                observed.extend(chunk)
        finally:
            os.close(published_fd)
        if (not stat.S_ISREG(published_metadata.st_mode)
                or published_metadata.st_uid != 0 or published_metadata.st_gid != 0
                or stat.S_IMODE(published_metadata.st_mode) != 0o400
                or published_metadata.st_nlink != 1
                or hashlib.sha256(observed).digest() != hashlib.sha256(expected).digest()):
            fail("published snapshot evidence failed its durable identity check")
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        try:
            os.unlink(temporary_name, dir_fd=directory_fd)
        except FileNotFoundError:
            pass
        os.close(directory_fd)
    return target


SNAPSHOT_SCHEMA3_KEYS = {
    "SCHEMA_VERSION", "PROVIDER", "REGION", "INSTANCE_ID", "SYSTEM_DISK_ID",
    "SYSTEM_DISK_ZONE", "SYSTEM_DISK_STATE", "SYSTEM_DISK_ATTACHED",
    "SNAPSHOT_ID", "SNAPSHOT_STATUS", "SNAPSHOT_PERCENT", "RELEASE_ID",
    "CAPTURED_AT", "VERIFIED_AT", "RESTORE_SCOPE", "VERIFICATION_SOURCE",
    "SNAPSHOT_RESPONSE_SHA256", "DISKS_RESPONSE_SHA256", "SNAPSHOT_REQUEST_ID",
    "DISKS_REQUEST_ID", "SNAPSHOT_NAME",
}
SNAPSHOT_SCHEMA4_KEYS = SNAPSHOT_SCHEMA3_KEYS | {
    "EVIDENCE_PURPOSE", "SIGNING_KEY_PROVISIONED_AT",
    "SIGNING_PUBLIC_KEY_SHA256", "SIGNING_MARKER_SHA256",
    "APPROVAL_FILE_SHA256",
}
APPROVAL_KEYS = {
    "SCHEMA_VERSION", "RELEASE_ID", "RELEASE_MANIFEST_SHA256",
    "SOURCE_MANIFEST_SHA256", "SHA256SUMS_SHA256", "CONTROL_PLANE_SPEC_SHA256",
    "EVIDENCE_HELPER_SHA256", "TRUSTED_DEEP_SCAN_ATTESTATION_SHA256",
    "TRUSTED_DEEP_SCAN_PRODUCER_SHA256", "TRUSTED_DEEP_SCAN_COMPLETION_SHA256",
    "LINUX_VALIDATION_ATTESTATION_SHA256", "REQUIRED_TEST_POLICY_SHA256",
    "APPROVED_AT",
}
SNAPSHOT_CLAIM_KEYS = {
    "SCHEMA_VERSION", "SNAPSHOT_ID", "RELEASE_ID", "EVIDENCE_PURPOSE",
    "CAPTURED_AT", "SNAPSHOT_NAME", "SNAPSHOT_RESPONSE_SHA256",
    "DISKS_RESPONSE_SHA256", "APPROVAL_FILE_SHA256",
}
SNAPSHOT_REGISTRY_ROOT = pathlib.Path(
    "/var/lib/resume-ai/security/cloud-snapshots/by-snapshot-id"
)


def release_approval(release: str) -> tuple[datetime.datetime, str]:
    path = f"/etc/resume-ai/approved-releases/{release}.env"
    _, raw, _ = protected_input(path, "release approval", 0o400, 64 * 1024)
    values = parse_env(raw, "release approval", APPROVAL_KEYS)
    if values["SCHEMA_VERSION"] != "6" or values["RELEASE_ID"] != release:
        fail("release approval does not bind the requested managed release")
    for key in APPROVAL_KEYS - {"SCHEMA_VERSION", "RELEASE_ID", "APPROVED_AT"}:
        if re.fullmatch(r"[a-f0-9]{64}", values[key]) is None:
            fail("release approval contains a malformed digest")
    return parse_utc_seconds(values["APPROVED_AT"], "release approval time"), hashlib.sha256(raw).hexdigest()


def snapshot_claim_payload(values: dict[str, str], purpose: str) -> bytes:
    claim = {
        "SCHEMA_VERSION": "1",
        "SNAPSHOT_ID": values["SNAPSHOT_ID"],
        "RELEASE_ID": values["RELEASE_ID"],
        "EVIDENCE_PURPOSE": purpose,
        "CAPTURED_AT": values["CAPTURED_AT"],
        "SNAPSHOT_NAME": values["SNAPSHOT_NAME"],
        "SNAPSHOT_RESPONSE_SHA256": values["SNAPSHOT_RESPONSE_SHA256"],
        "DISKS_RESPONSE_SHA256": values["DISKS_RESPONSE_SHA256"],
        "APPROVAL_FILE_SHA256": values.get("APPROVAL_FILE_SHA256", "none"),
    }
    return ("\n".join(f"{key}={claim[key]}" for key in sorted(claim)) + "\n").encode("utf-8")


def verify_snapshot_claim(values: dict[str, str], purpose: str) -> None:
    snapshot_id = values["SNAPSHOT_ID"]
    claim_path = SNAPSHOT_REGISTRY_ROOT / f"{snapshot_id}.env"
    _, raw, _ = protected_input(
        str(claim_path), "global snapshot identity claim", 0o400, 64 * 1024
    )
    parsed = parse_env(raw, "global snapshot identity claim", SNAPSHOT_CLAIM_KEYS)
    expected = parse_env(
        snapshot_claim_payload(values, purpose), "expected global snapshot claim", SNAPSHOT_CLAIM_KEYS
    )
    if parsed != expected:
        fail("snapshot ID is already bound to another release, purpose, or API response")


def claim_snapshot_id(values: dict[str, str], purpose: str) -> None:
    output_directory(str(SNAPSHOT_REGISTRY_ROOT))
    claim_path = SNAPSHOT_REGISTRY_ROOT / f"{values['SNAPSHOT_ID']}.env"
    if claim_path.exists() or claim_path.is_symlink():
        verify_snapshot_claim(values, purpose)
        return
    publish(
        SNAPSHOT_REGISTRY_ROOT,
        claim_path.name,
        snapshot_claim_payload(values, purpose).decode("utf-8"),
    )
    verify_snapshot_claim(values, purpose)


def validate_snapshot_identity(values: dict[str, str], release: str) -> None:
    if (values["PROVIDER"] != "tencent-lighthouse"
            or values["REGION"] != "ap-guangzhou"
            or values["INSTANCE_ID"] != "lhins-aw4n6o9t"
            or values["RELEASE_ID"] != release
            or values["SNAPSHOT_STATUS"] != "NORMAL"
            or values["SNAPSHOT_PERCENT"] != "100"
            or values["RESTORE_SCOPE"] != "system-disk"
            or values["VERIFICATION_SOURCE"] != "tencent-lighthouse-api-describe"
            or values["SYSTEM_DISK_STATE"] != "ATTACHED"
            or values["SYSTEM_DISK_ATTACHED"] != "true"
            or re.fullmatch(r"ap-guangzhou-[1-9][0-9]*", values["SYSTEM_DISK_ZONE"]) is None
            or re.fullmatch(r"lhdisk-[A-Za-z0-9]{6,80}", values["SYSTEM_DISK_ID"]) is None
            or re.fullmatch(r"lhsnap-[A-Za-z0-9]{6,80}", values["SNAPSHOT_ID"]) is None
            or any(re.fullmatch(r"[a-f0-9]{64}", values[key]) is None for key in (
                "SNAPSHOT_RESPONSE_SHA256", "DISKS_RESPONSE_SHA256"))
            or any(re.fullmatch(r"[A-Za-z0-9-]{8,128}", values[key]) is None for key in (
                "SNAPSHOT_REQUEST_ID", "DISKS_REQUEST_ID"))):
        fail("cloud snapshot evidence identity/status contract is invalid")


def load_post_provision_continuity(
    raw_path: str, release: str
) -> tuple[dict[str, str], bytes, datetime.datetime, datetime.datetime, datetime.datetime]:
    evidence_path = pathlib.Path(raw_path)
    expected_path = pathlib.Path(
        f"/var/lib/resume-ai/security/cloud-snapshots/{release}.env"
    )
    if evidence_path != expected_path:
        fail("post-provision continuity evidence must use its fixed release basename")
    _, evidence_raw, _ = protected_input(
        str(evidence_path), "post-provision continuity snapshot evidence", 0o400, 64 * 1024,
    )
    values = parse_env(
        evidence_raw, "post-provision continuity snapshot evidence", SNAPSHOT_SCHEMA4_KEYS
    )
    if values["SCHEMA_VERSION"] != "4" \
            or values["EVIDENCE_PURPOSE"] != "post-provision-continuity":
        fail("active snapshot evidence is not final post-provision continuity proof")
    validate_snapshot_identity(values, release)
    if values["SNAPSHOT_NAME"] != f"resume-ai-post-provision-{release}":
        fail("managed snapshot name does not bind the release and final purpose")
    provisioned, public_sha256, marker_sha256 = signing_provisioning()
    approved_at, approval_sha256 = release_approval(release)
    if (values["SIGNING_KEY_PROVISIONED_AT"]
            != provisioned.strftime("%Y-%m-%dT%H:%M:%SZ")
            or values["SIGNING_PUBLIC_KEY_SHA256"] != public_sha256
            or values["SIGNING_MARKER_SHA256"] != marker_sha256
            or values["APPROVAL_FILE_SHA256"] != approval_sha256):
        fail("snapshot evidence differs from the current immutable signing marker")
    captured = parse_utc_seconds(values["CAPTURED_AT"], "snapshot capture time")
    verified = parse_utc_seconds(values["VERIFIED_AT"], "snapshot verification time")
    release_created = datetime.datetime.strptime(release, "%Y%m%dT%H%M%SZ").replace(
        tzinfo=datetime.timezone.utc
    )
    if captured < max(provisioned, approved_at, release_created) or captured > verified \
            or verified - captured > datetime.timedelta(hours=24):
        fail("post-provision snapshot timestamp chain is invalid")
    verify_snapshot_claim(values, "post-provision-continuity")
    return values, evidence_raw, provisioned, captured, verified


def verify_initial_rollback(raw_path: str, release: str, expected_id: str, expected_sha: str) -> None:
    evidence_path = pathlib.Path(raw_path)
    expected_path = pathlib.Path(
        f"/var/lib/resume-ai/security/cloud-snapshots/{release}.initial-rollback.env"
    )
    if evidence_path != expected_path:
        fail("initial rollback evidence must use its fixed purpose-specific basename")
    _, evidence_raw, _ = protected_input(
        str(evidence_path), "initial pre-change rollback snapshot evidence", 0o400, 64 * 1024,
    )
    if re.fullmatch(r"lhsnap-[A-Za-z0-9]{6,80}", expected_id) is None \
            or re.fullmatch(r"[a-f0-9]{64}", expected_sha) is None \
            or hashlib.sha256(evidence_raw).hexdigest() != expected_sha:
        fail("initial rollback evidence differs from its legacy manifest binding")
    values = parse_env(
        evidence_raw, "initial pre-change rollback snapshot evidence", SNAPSHOT_SCHEMA3_KEYS
    )
    if values["SCHEMA_VERSION"] != "3" or values["SNAPSHOT_ID"] != expected_id:
        fail("initial rollback evidence has the wrong schema or snapshot identity")
    validate_snapshot_identity(values, release)
    if values["SNAPSHOT_NAME"] != f"resume-ai-initial-rollback-{release}":
        fail("initial snapshot name does not bind the legacy release and rollback purpose")
    captured = parse_utc_seconds(values["CAPTURED_AT"], "initial snapshot capture time")
    verified = parse_utc_seconds(values["VERIFIED_AT"], "initial snapshot verification time")
    bootstrap_started = initial_change_boundary(require_runtime=True)
    if (bootstrap_started is None or captured > bootstrap_started
            or captured > verified
            or verified > datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=5)
            or verified - captured > datetime.timedelta(hours=24)):
        fail("initial rollback snapshot is not proven to predate runtime-layout mutation")
    verify_snapshot_claim(values, "initial-pre-change-rollback")


if os.geteuid() != 0:
    fail("run as root")
if len(sys.argv) < 2:
    fail("snapshot evidence action is missing")
verify_execution_trust(sys.argv[1])
if len(sys.argv) == 4 and sys.argv[1] == "--verify-pre-switch":
    release = release_id(sys.argv[3])
    _, evidence_raw, _, _, verified = load_post_provision_continuity(sys.argv[2], release)
    now = datetime.datetime.now(datetime.timezone.utc)
    if verified > now + datetime.timedelta(minutes=5) \
            or now - verified > datetime.timedelta(hours=24):
        fail("post-provision snapshot is not fresh enough for a production switch")
    print(hashlib.sha256(evidence_raw).hexdigest())
    raise SystemExit(0)
if len(sys.argv) == 4 and sys.argv[1] == "--verify-rollback-target":
    release = release_id(sys.argv[3])
    _, evidence_raw, _, _, verified = load_post_provision_continuity(sys.argv[2], release)
    if verified > datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=5):
        fail("rollback target snapshot verification time is in the future")
    print(hashlib.sha256(evidence_raw).hexdigest())
    raise SystemExit(0)
if len(sys.argv) == 5 and sys.argv[1] == "--verify-continuity":
    release = release_id(sys.argv[3])
    _, evidence_raw, _, _, verified = load_post_provision_continuity(sys.argv[2], release)
    switched = parse_utc_seconds(sys.argv[4], "release switch time")
    if verified > switched:
        fail("post-provision snapshot was not confirmed usable before the release switch")
    print(hashlib.sha256(evidence_raw).hexdigest())
    raise SystemExit(0)
if len(sys.argv) == 6 and sys.argv[1] == "--verify-initial-rollback":
    release = release_id(sys.argv[3])
    verify_initial_rollback(sys.argv[2], release, sys.argv[4], sys.argv[5])
    print(sys.argv[5])
    raise SystemExit(0)
if len(sys.argv) == 4 and sys.argv[1] == "--verify-initial-pre-bootstrap":
    release = release_id(sys.argv[3])
    evidence_path = pathlib.Path(sys.argv[2])
    expected_path = pathlib.Path(
        f"/var/lib/resume-ai/security/cloud-snapshots/{release}.initial-rollback.env"
    )
    if evidence_path != expected_path:
        fail("initial rollback evidence must use its fixed purpose-specific basename")
    _, evidence_raw, _ = protected_input(
        str(evidence_path), "initial pre-change rollback snapshot evidence", 0o400, 64 * 1024,
    )
    values = parse_env(
        evidence_raw, "initial pre-change rollback snapshot evidence", SNAPSHOT_SCHEMA3_KEYS
    )
    if values["SCHEMA_VERSION"] != "3":
        fail("initial rollback evidence has the wrong schema")
    validate_snapshot_identity(values, release)
    if values["SNAPSHOT_NAME"] != f"resume-ai-initial-rollback-{release}":
        fail("initial snapshot name does not bind the legacy release and rollback purpose")
    captured = parse_utc_seconds(values["CAPTURED_AT"], "initial snapshot capture time")
    verified = parse_utc_seconds(values["VERIFIED_AT"], "initial snapshot verification time")
    bootstrap_started, bootstrap_sha, _ = bootstrap_generation()
    if (captured > bootstrap_started or captured > verified
            or verified > datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=5)
            or verified - captured > datetime.timedelta(hours=24)):
        fail("initial rollback snapshot does not predate the first-root bootstrap boundary")
    verify_snapshot_claim(values, "initial-pre-change-rollback")
    print("\t".join((
        hashlib.sha256(evidence_raw).hexdigest(), values["SNAPSHOT_ID"],
        values["SNAPSHOT_RESPONSE_SHA256"], values["DISKS_RESPONSE_SHA256"],
        values["CAPTURED_AT"], bootstrap_sha,
    )))
    raise SystemExit(0)
if len(sys.argv) == 4 and sys.argv[1] in {"--pending", "--pending-initial-rollback"}:
    pending_kind = sys.argv[1]
    pending_purpose = (
        "post-provision-continuity"
        if pending_kind == "--pending"
        else "initial-pre-change-rollback"
    )
    pending_ack = (
        "PENDING_POST_PROVISION_CONTINUITY"
        if pending_kind == "--pending"
        else "PENDING_INITIAL_PRE_CHANGE_ROLLBACK"
    )
    if os.environ.get("ACK_RECORD_CLOUD_SNAPSHOT_EVIDENCE") != pending_ack:
        fail("pending evidence requires its exact purpose-specific acknowledgement")
    release = release_id(sys.argv[2])
    directory = output_directory(sys.argv[3])
    if directory != SNAPSHOT_REGISTRY_ROOT.parent:
        fail("snapshot evidence must use the fixed root-only production directory")
    pending_name = (
        f"{release}.pending"
        if pending_kind == "--pending"
        else f"{release}.initial-rollback.pending"
    )
    target = publish(
        directory,
        pending_name,
        "SCHEMA_VERSION=1\n"
        f"EVIDENCE_PURPOSE={pending_purpose}\n"
        f"RELEASE_ID={release}\n"
        "STATUS=PENDING_NOT_PERFORMED\n"
        f"RECORDED_AT={datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}\n",
    )
    print(target)
    raise SystemExit(0)
if len(sys.argv) != 6 or sys.argv[1] not in {"--api", "--api-initial-rollback"}:
    fail("usage: record-cloud-snapshot-evidence.py --pending RELEASE OUT_DIR | --pending-initial-rollback RELEASE OUT_DIR | --api SNAPSHOT_JSON DISKS_JSON RELEASE OUT_DIR | --api-initial-rollback SNAPSHOT_JSON DISKS_JSON RELEASE OUT_DIR | --verify-pre-switch EVIDENCE RELEASE | --verify-rollback-target EVIDENCE RELEASE | --verify-continuity EVIDENCE RELEASE SWITCHED_AT | --verify-initial-rollback EVIDENCE RELEASE SNAPSHOT_ID SHA256 | --verify-initial-pre-bootstrap EVIDENCE RELEASE")
evidence_kind = sys.argv[1]
expected_ack = (
    "POST_PROVISION_CONTINUITY"
    if evidence_kind == "--api"
    else "INITIAL_PRE_CHANGE_ROLLBACK"
)
if os.environ.get("ACK_RECORD_CLOUD_SNAPSHOT_EVIDENCE") != expected_ack:
    fail("successful evidence requires its exact purpose-specific API acknowledgement")

snapshot_path, snapshot_raw, snapshot_metadata = root_input(
    sys.argv[2], "DescribeSnapshots response"
)
disks_path, disks_raw, disks_metadata = root_input(sys.argv[3], "DescribeDisks response")
if (snapshot_metadata.st_dev, snapshot_metadata.st_ino) == (disks_metadata.st_dev, disks_metadata.st_ino):
    fail("snapshot and disk responses must be independent files")
release = release_id(sys.argv[4])
directory = output_directory(sys.argv[5])
if directory != SNAPSHOT_REGISTRY_ROOT.parent:
    fail("snapshot evidence must use the fixed root-only production directory")

try:
    snapshot_document = json.loads(snapshot_raw.decode("utf-8"))
    disks_document = json.loads(disks_raw.decode("utf-8"))
except (UnicodeDecodeError, json.JSONDecodeError) as error:
    fail(f"Tencent API evidence is not valid UTF-8 JSON: {error}")
snapshot_response = snapshot_document.get("Response")
disks_response = disks_document.get("Response")
if not isinstance(snapshot_response, dict) or not isinstance(disks_response, dict):
    fail("Tencent API evidence lacks a Response object")
snapshot_set = snapshot_response.get("SnapshotSet")
disk_set = disks_response.get("DiskSet")
if (snapshot_response.get("TotalCount") != 1 or not isinstance(snapshot_set, list)
        or len(snapshot_set) != 1 or disks_response.get("TotalCount") != 1
        or not isinstance(disk_set, list) or len(disk_set) != 1):
    fail("Tencent API evidence must resolve exactly one snapshot and one disk")
snapshot = snapshot_set[0]
disk = disk_set[0]
if not isinstance(snapshot, dict) or not isinstance(disk, dict):
    fail("Tencent API resource entries are malformed")
snapshot_id = snapshot.get("SnapshotId")
snapshot_name = snapshot.get("SnapshotName")
disk_id = snapshot.get("DiskId")
created_raw = snapshot.get("CreatedTime")
expected_snapshot_name = (
    f"resume-ai-post-provision-{release}"
    if evidence_kind == "--api"
    else f"resume-ai-initial-rollback-{release}"
)
if (not isinstance(snapshot_id, str) or re.fullmatch(r"lhsnap-[A-Za-z0-9]{6,80}", snapshot_id) is None
        or snapshot_name != expected_snapshot_name
        or not isinstance(disk_id, str) or re.fullmatch(r"lhdisk-[A-Za-z0-9]{6,80}", disk_id) is None
        or snapshot.get("DiskUsage") != "SYSTEM_DISK" or snapshot.get("SnapshotState") != "NORMAL"
        or snapshot.get("Percent") != 100):
    fail("snapshot API response is not one complete NORMAL system-disk snapshot")
if (disk.get("DiskId") != disk_id or disk.get("InstanceId") != "lhins-aw4n6o9t"
        or disk.get("DiskUsage") != "SYSTEM_DISK"
        or disk.get("DiskState") != "ATTACHED" or disk.get("Attached") is not True):
    fail("disk API response does not bind the snapshot to the production instance system disk")
zone = disk.get("Zone")
if not isinstance(zone, str) or re.fullmatch(r"ap-guangzhou-[1-9][0-9]*", zone) is None:
    fail("disk API response does not prove one Guangzhou availability zone")
if not isinstance(created_raw, str):
    fail("snapshot creation timestamp is missing")
try:
    created = datetime.datetime.fromisoformat(created_raw.replace("Z", "+00:00"))
except ValueError:
    fail("snapshot creation timestamp is invalid")
if created.tzinfo is None:
    fail("snapshot creation timestamp lacks a timezone")
created = created.astimezone(datetime.timezone.utc)
now = datetime.datetime.now(datetime.timezone.utc)
if created > now + datetime.timedelta(minutes=5):
    fail("snapshot creation timestamp is in the future")
signing_values: tuple[datetime.datetime, str, str] | None = None
approval_values: tuple[datetime.datetime, str] | None = None
if evidence_kind == "--api":
    signing_values = signing_provisioning()
    approval_values = release_approval(release)
    release_created = datetime.datetime.strptime(release, "%Y%m%dT%H%M%SZ").replace(
        tzinfo=datetime.timezone.utc
    )
    if created < max(signing_values[0], approval_values[0], release_created):
        fail("post-provision continuity snapshot predates key, approval, or release identity")
else:
    bootstrap_started = initial_change_boundary(require_runtime=False)
    if created > bootstrap_started:
        fail("initial rollback snapshot was captured after runtime-layout bootstrap began")
for response in (snapshot_response, disks_response):
    request_id = response.get("RequestId")
    if not isinstance(request_id, str) or re.fullmatch(r"[A-Za-z0-9-]{8,128}", request_id) is None:
        fail("Tencent API evidence lacks a valid request ID")

values = {
    "SCHEMA_VERSION": "4" if evidence_kind == "--api" else "3",
    "PROVIDER": "tencent-lighthouse",
    "REGION": "ap-guangzhou",
    "INSTANCE_ID": "lhins-aw4n6o9t",
    "SYSTEM_DISK_ID": disk_id,
    "SYSTEM_DISK_ZONE": zone,
    "SYSTEM_DISK_STATE": "ATTACHED",
    "SYSTEM_DISK_ATTACHED": "true",
    "SNAPSHOT_ID": snapshot_id,
    "SNAPSHOT_STATUS": "NORMAL",
    "SNAPSHOT_PERCENT": "100",
    "RELEASE_ID": release,
    "CAPTURED_AT": created.strftime("%Y-%m-%dT%H:%M:%SZ"),
    "VERIFIED_AT": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
    "RESTORE_SCOPE": "system-disk",
    "VERIFICATION_SOURCE": "tencent-lighthouse-api-describe",
    "SNAPSHOT_RESPONSE_SHA256": hashlib.sha256(snapshot_raw).hexdigest(),
    "DISKS_RESPONSE_SHA256": hashlib.sha256(disks_raw).hexdigest(),
    "SNAPSHOT_REQUEST_ID": snapshot_response["RequestId"],
    "DISKS_REQUEST_ID": disks_response["RequestId"],
    "SNAPSHOT_NAME": snapshot_name,
}
if signing_values is not None:
    provisioned, public_sha256, marker_sha256 = signing_values
    values.update({
        "EVIDENCE_PURPOSE": "post-provision-continuity",
        "SIGNING_KEY_PROVISIONED_AT": provisioned.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "SIGNING_PUBLIC_KEY_SHA256": public_sha256,
        "SIGNING_MARKER_SHA256": marker_sha256,
        "APPROVAL_FILE_SHA256": approval_values[1] if approval_values is not None else "",
    })
payload = "\n".join(f"{key}={values[key]}" for key in sorted(values)) + "\n"
target_name = (
    f"{release}.env"
    if evidence_kind == "--api"
    else f"{release}.initial-rollback.env"
)
claim_snapshot_id(
    values,
    "post-provision-continuity"
    if evidence_kind == "--api"
    else "initial-pre-change-rollback",
)
target = publish(directory, target_name, payload)
pending = directory / (
    f"{release}.pending"
    if evidence_kind == "--api"
    else f"{release}.initial-rollback.pending"
)
if pending.exists() and not pending.is_symlink():
    pending_metadata = pending.lstat()
    if (stat.S_ISREG(pending_metadata.st_mode) and pending_metadata.st_uid == 0
            and pending_metadata.st_nlink == 1 and stat.S_IMODE(pending_metadata.st_mode) == 0o400):
        pending.unlink()
        directory_fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
print(target)
