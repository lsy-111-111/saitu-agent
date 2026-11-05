#!/usr/bin/env python3
"""Validate restore evidence against the current backup/schema/privilege contract."""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import pathlib
import re
import stat
import sys


def fail(message: str) -> "NoReturn":
    raise SystemExit(f"ERROR: {message}")


def trusted_dir(path: pathlib.Path, mode: int, owner_group_root: bool = True) -> None:
    metadata = path.lstat()
    if (not stat.S_ISDIR(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode)
            or metadata.st_uid != 0 or (owner_group_root and metadata.st_gid != 0)
            or stat.S_IMODE(metadata.st_mode) != mode):
        fail(f"unsafe root-owned directory: {path}")
    if path.resolve(strict=True) != path.absolute():
        fail(f"directory path contains a symlinked component: {path}")


def trusted_bytes(
    path: pathlib.Path,
    *,
    exact_mode: int | None = None,
    max_size: int = 8 * 1024 * 1024,
) -> bytes:
    before = path.lstat()
    if (not stat.S_ISREG(before.st_mode) or stat.S_ISLNK(before.st_mode)
            or before.st_uid != 0 or before.st_nlink != 1
            or (exact_mode is not None and stat.S_IMODE(before.st_mode) != exact_mode)
            or (exact_mode is None and stat.S_IMODE(before.st_mode) & 0o022)
            or before.st_size > max_size):
        fail(f"unsafe root-owned contract file: {path}")
    flags = os.O_RDONLY | os.O_CLOEXEC
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(path, flags)
    try:
        opened = os.fstat(descriptor)
        if (opened.st_dev, opened.st_ino) != (before.st_dev, before.st_ino):
            fail(f"contract file changed while it was opened: {path}")
        chunks: list[bytes] = []
        total = 0
        while True:
            chunk = os.read(descriptor, min(1024 * 1024, max_size + 1 - total))
            if not chunk:
                break
            chunks.append(chunk)
            total += len(chunk)
            if total > max_size:
                fail(f"contract file is too large: {path}")
        after_open = os.fstat(descriptor)
    finally:
        os.close(descriptor)
    after_path = path.lstat()
    stable_fields = ("st_dev", "st_ino", "st_mode", "st_uid", "st_gid", "st_nlink", "st_size", "st_mtime_ns", "st_ctime_ns")
    if any(getattr(before, field) != getattr(after_open, field) for field in stable_fields):
        fail(f"contract file changed while it was read: {path}")
    if any(getattr(before, field) != getattr(after_path, field) for field in stable_fields):
        fail(f"contract path changed while it was read: {path}")
    return b"".join(chunks)


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def trusted_digest(path: pathlib.Path, *, exact_mode: int, max_size: int) -> str:
    before = path.lstat()
    if (not stat.S_ISREG(before.st_mode) or stat.S_ISLNK(before.st_mode)
            or before.st_uid != 0 or before.st_nlink != 1
            or stat.S_IMODE(before.st_mode) != exact_mode or before.st_size > max_size):
        fail(f"unsafe root-owned backup member: {path}")
    flags = os.O_RDONLY | os.O_CLOEXEC
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(path, flags)
    digest = hashlib.sha256()
    try:
        opened = os.fstat(descriptor)
        if (opened.st_dev, opened.st_ino) != (before.st_dev, before.st_ino):
            fail(f"backup member changed while it was opened: {path}")
        total = 0
        while True:
            chunk = os.read(descriptor, 1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
            total += len(chunk)
            if total > max_size:
                fail(f"backup member is too large: {path}")
        after_open = os.fstat(descriptor)
    finally:
        os.close(descriptor)
    after_path = path.lstat()
    stable_fields = ("st_dev", "st_ino", "st_mode", "st_uid", "st_gid", "st_nlink", "st_size", "st_mtime_ns", "st_ctime_ns")
    if any(getattr(before, field) != getattr(after_open, field) for field in stable_fields):
        fail(f"backup member changed while it was read: {path}")
    if any(getattr(before, field) != getattr(after_path, field) for field in stable_fields):
        fail(f"backup path changed while it was read: {path}")
    return digest.hexdigest()


def parse_pairs(pairs: list[tuple[str, object]]) -> dict[str, object]:
    parsed: dict[str, object] = {}
    for key, value in pairs:
        if key in parsed:
            fail(f"duplicate restore evidence key: {key}")
        parsed[key] = value
    return parsed


def parse_env(
    value: bytes,
    allowed: set[str],
    label: str,
    *,
    allow_comments: bool = False,
) -> dict[str, str]:
    try:
        text = value.decode("utf-8")
    except UnicodeDecodeError:
        fail(f"{label} is not UTF-8")
    parsed: dict[str, str] = {}
    for row in text.splitlines():
        if allow_comments and (not row or row.startswith("#")):
            continue
        if "=" not in row:
            fail(f"{label} contains a malformed row")
        key, item = row.split("=", 1)
        if key not in allowed or key in parsed or not item:
            fail(f"{label} contains an unknown, duplicate, or empty row")
        parsed[key] = item
    if set(parsed) != allowed:
        fail(f"{label} is incomplete")
    return parsed


parser = argparse.ArgumentParser(add_help=False)
source = parser.add_mutually_exclusive_group(required=True)
source.add_argument("--evidence", type=pathlib.Path)
source.add_argument("--latest-root", type=pathlib.Path)
parser.add_argument("--expected-id")
parser.add_argument("--daily-root", required=True, type=pathlib.Path)
parser.add_argument("--active-root", required=True, type=pathlib.Path)
parser.add_argument("--config", required=True, type=pathlib.Path)
parser.add_argument("--database", required=True)
parser.add_argument("--system-identifier", required=True)
parser.add_argument("--require-retained", action="store_true")
args = parser.parse_args()

if os.geteuid() != 0:
    fail("restore evidence must be verified as root")
if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", args.database):
    fail("database identity is invalid")
if not re.fullmatch(r"[0-9]{10,}", args.system_identifier):
    fail("PostgreSQL system identifier is invalid")

trusted_dir(args.daily_root, 0o700)
if args.latest_root is not None:
    trusted_dir(args.latest_root, 0o700)
    candidates = []
    for candidate in args.latest_root.iterdir():
        if re.fullmatch(r"20[0-9]{6}T[0-9]{6}Z[.]json", candidate.name):
            candidates.append(candidate)
    if not candidates:
        fail("no restore verification evidence exists")
    evidence_path = sorted(candidates, key=lambda path: path.name)[-1]
    expected_id = evidence_path.stem
else:
    evidence_path = args.evidence
    if evidence_path is None:
        fail("restore evidence path is missing")
    expected_id = args.expected_id or evidence_path.stem
if not re.fullmatch(r"20[0-9]{6}T[0-9]{6}Z", expected_id):
    fail("restore verification identity is invalid")

active_root = args.active_root
active_match = re.fullmatch(r"/opt/resume-ai/releases/(20[0-9]{6}T[0-9]{6}Z)", str(active_root))
if active_match is None or active_root.resolve(strict=True) != active_root.absolute():
    fail("active release root is not a fixed physical release")
active_release = active_match.group(1)
active_metadata = active_root.lstat()
if (not stat.S_ISDIR(active_metadata.st_mode) or active_metadata.st_uid != 0
        or stat.S_IMODE(active_metadata.st_mode) & 0o022):
    fail("active release root is mutable or not root-owned")

source_contract_paths = {
    "backupWriterSha256": active_root / "ops/bin/backup-postgres.sh",
    "backupInspectorSha256": active_root / "ops/bin/inspect-postgres-backups.py",
    "retentionSelectorSha256": active_root / "ops/bin/select-postgres-retention.py",
    "restoreVerifierSha256": active_root / "ops/bin/verify-postgres-restore.sh",
    "evidenceVerifierSha256": active_root / "ops/bin/assert-postgres-restore-evidence.py",
    "migrationManifestSha256": active_root / "ops/config/migrations.manifest",
    "databaseVerificationManifestSha256": active_root / "ops/config/database-verification.manifest",
    "runtimeTablePolicySha256": active_root / "ops/postgresql/runtime-table-privileges.conf",
    "runtimeFunctionPolicySha256": active_root / "ops/postgresql/runtime-function-privileges.conf",
    "requiredTablesPolicySha256": active_root / "ops/postgresql/restore-required-tables.txt",
    "runtimeIdentityHelperSha256": active_root / "ops/bin/read-postgres-runtime-identity.sh",
}
installed_contract_paths = {
    "backupWriterSha256": pathlib.Path("/usr/local/lib/resume-ai/backup-postgres.sh"),
    "backupInspectorSha256": pathlib.Path("/usr/local/lib/resume-ai/inspect-postgres-backups.py"),
    "retentionSelectorSha256": pathlib.Path("/usr/local/lib/resume-ai/select-postgres-retention.py"),
    "restoreVerifierSha256": pathlib.Path("/usr/local/lib/resume-ai/verify-postgres-restore.sh"),
    "evidenceVerifierSha256": pathlib.Path("/usr/local/lib/resume-ai/assert-postgres-restore-evidence.py"),
    "runtimeTablePolicySha256": pathlib.Path("/etc/resume-ai/runtime-table-privileges.conf"),
    "runtimeFunctionPolicySha256": pathlib.Path("/etc/resume-ai/runtime-function-privileges.conf"),
    "requiredTablesPolicySha256": pathlib.Path("/etc/resume-ai/restore-required-tables.txt"),
    "runtimeIdentityHelperSha256": pathlib.Path("/usr/local/lib/resume-ai/read-postgres-runtime-identity.sh"),
}
contract_hashes: dict[str, str] = {}
for key, path in source_contract_paths.items():
    contract_hashes[key] = sha256_bytes(trusted_bytes(path))
for key, path in installed_contract_paths.items():
    expected_mode = 0o755 if path.suffix in {".sh", ".py"} else 0o644
    installed_hash = sha256_bytes(trusted_bytes(path, exact_mode=expected_mode))
    if installed_hash != contract_hashes[key]:
        fail(f"installed PostgreSQL contract differs from active release: {path}")

config_bytes = trusted_bytes(args.config, exact_mode=0o600, max_size=64 * 1024)
config_hash = sha256_bytes(config_bytes)
contract_hashes["backupConfigSha256"] = config_hash
backup_config_keys = {
    "DB_NAME", "BACKUP_TIMEZONE", "DAILY_RETENTION", "WEEKLY_RETENTION",
    "PREDEPLOY_RETENTION", "RPO_HOURS", "RTO_SECONDS",
}
backup_config = parse_env(
    config_bytes, backup_config_keys, "backup configuration", allow_comments=True
)
numeric_config = {
    key: int(value)
    for key, value in backup_config.items()
    if key in {
        "DAILY_RETENTION", "WEEKLY_RETENTION", "PREDEPLOY_RETENTION",
        "RPO_HOURS", "RTO_SECONDS",
    } and re.fullmatch(r"[0-9]+", value) is not None
}
if (backup_config["DB_NAME"] != args.database
        or backup_config["BACKUP_TIMEZONE"] != "Asia/Shanghai"
        or len(numeric_config) != 5
        or numeric_config["DAILY_RETENTION"] < 14
        or numeric_config["WEEKLY_RETENTION"] < 8
        or numeric_config["PREDEPLOY_RETENTION"] < 5
        or not 1 <= numeric_config["RPO_HOURS"] <= 24
        or not 1 <= numeric_config["RTO_SECONDS"] <= 7200):
    fail("backup configuration recovery/retention contract is invalid")

evidence_raw = trusted_bytes(evidence_path, exact_mode=0o600, max_size=64 * 1024)
try:
    evidence = json.loads(evidence_raw.decode("utf-8"), object_pairs_hook=parse_pairs)
except (UnicodeDecodeError, json.JSONDecodeError) as error:
    fail(f"restore evidence is malformed: {error}")
if not isinstance(evidence, dict):
    fail("restore evidence must be a JSON object")

digest_fields = {
    "backupDatabaseDumpSha256", "backupGlobalsSha256", "backupArchiveListSha256",
    "backupManifestSha256", "backupChecksumsSha256", "backupWriterSha256",
    "backupInspectorSha256", "retentionSelectorSha256", "backupConfigSha256",
    "restoreVerifierSha256", "migrationManifestSha256",
    "evidenceVerifierSha256",
    "databaseVerificationManifestSha256", "runtimeTablePolicySha256",
    "runtimeFunctionPolicySha256", "requiredTablesPolicySha256",
    "runtimeIdentityHelperSha256", "contractSha256",
}
integer_fields = {
    "publicTableCount", "requiredTableCount", "restoredTablePolicyCount",
    "restoredFunctionPolicyCount", "validExpandMigrationCount", "manifestMigrationCount",
    "verifiedSqlCount", "invalidIndexCount", "unvalidatedConstraintCount",
    "elapsedSeconds", "rtoSeconds",
}
required_keys = digest_fields | integer_fields | {
    "schemaVersion", "verificationId", "verifiedAt", "backup", "databaseName",
    "backupCreatedAt", "postgresSystemIdentifier", "activeRelease",
    "temporaryDatabaseDropped", "ok",
}
if set(evidence) != required_keys:
    fail("restore evidence schema is incomplete or has unknown fields")
if evidence["schemaVersion"] != 3 or evidence["verificationId"] != expected_id:
    fail("restore evidence identity or schema version is invalid")
if evidence["databaseName"] != args.database or evidence["activeRelease"] != active_release:
    fail("restore evidence is not bound to the current database/release")
if evidence["postgresSystemIdentifier"] != args.system_identifier:
    fail("restore evidence belongs to a different PostgreSQL cluster")
if evidence["temporaryDatabaseDropped"] is not True or evidence["ok"] is not True:
    fail("restore evidence does not represent a completed disposable restore")
for key in digest_fields:
    if not isinstance(evidence[key], str) or re.fullmatch(r"[a-f0-9]{64}", evidence[key]) is None:
        fail(f"restore evidence digest is invalid: {key}")
for key in integer_fields:
    if type(evidence[key]) is not int or evidence[key] < 0:
        fail(f"restore evidence count is invalid: {key}")
for key in (
    "publicTableCount", "requiredTableCount", "restoredTablePolicyCount",
    "restoredFunctionPolicyCount", "validExpandMigrationCount", "manifestMigrationCount",
    "verifiedSqlCount",
):
    if evidence[key] < 1:
        fail(f"restore evidence lacks a required successful gate: {key}")
if (evidence["manifestMigrationCount"] != evidence["validExpandMigrationCount"]
        or evidence["invalidIndexCount"] != 0 or evidence["unvalidatedConstraintCount"] != 0
        or evidence["elapsedSeconds"] > evidence["rtoSeconds"]
        or evidence["rtoSeconds"] != int(backup_config["RTO_SECONDS"])):
    fail("restore evidence reports a failed integrity or RTO gate")
for key, expected_hash in contract_hashes.items():
    if evidence[key] != expected_hash:
        fail(f"restore evidence is stale for the current contract: {key}")

backup_id = evidence["backup"]
if not isinstance(backup_id, str) or re.fullmatch(r"20[0-9]{6}T[0-9]{6}Z", backup_id) is None:
    fail("restore evidence backup identity is invalid")
backup_dir = args.daily_root / backup_id
if backup_dir.exists() or backup_dir.is_symlink():
    backup_metadata = backup_dir.lstat()
    if (not stat.S_ISDIR(backup_metadata.st_mode) or stat.S_ISLNK(backup_metadata.st_mode)
            or backup_metadata.st_uid != 0 or backup_metadata.st_gid != 0
            or stat.S_IMODE(backup_metadata.st_mode) != 0o700):
        fail("restore evidence references an unsafe retained backup")
    backup_members = {
        "database.dump": "backupDatabaseDumpSha256",
        "globals.sql": "backupGlobalsSha256",
        "archive.list": "backupArchiveListSha256",
        "manifest.env": "backupManifestSha256",
        "SHA256SUMS": "backupChecksumsSha256",
    }
    retained_hashes: dict[str, str] = {}
    for name, key in backup_members.items():
        max_size = 512 * 1024 * 1024 * 1024 if name == "database.dump" else 64 * 1024 * 1024
        retained_hashes[name] = trusted_digest(
            backup_dir / name, exact_mode=0o600, max_size=max_size
        )
        if retained_hashes[name] != evidence[key]:
            fail(f"retained restore source differs from evidence: {name}")
    checksum_bytes = trusted_bytes(
        backup_dir / "SHA256SUMS", exact_mode=0o600, max_size=64 * 1024
    )
    try:
        checksum_rows = checksum_bytes.decode("ascii").splitlines()
    except UnicodeDecodeError:
        fail("retained backup checksum manifest is not ASCII")
    declared_checksums: dict[str, str] = {}
    for row in checksum_rows:
        match = re.fullmatch(
            r"([a-f0-9]{64})  (database[.]dump|globals[.]sql|archive[.]list|manifest[.]env)",
            row,
        )
        if match is None or match.group(2) in declared_checksums:
            fail("retained backup checksum manifest is malformed")
        declared_checksums[match.group(2)] = match.group(1)
    if set(declared_checksums) != {"database.dump", "globals.sql", "archive.list", "manifest.env"}:
        fail("retained backup checksum manifest is incomplete")
    for name, declared_hash in declared_checksums.items():
        if retained_hashes[name] != declared_hash:
            fail(f"retained backup checksum manifest differs from member: {name}")
    manifest_keys = {
        "BACKUP_ID", "BACKUP_SCHEMA_VERSION", "BACKUP_TIER", "DATABASE_NAME", "CREATED_AT",
        "POSTGRES_VERSION", "DATA_CHECKSUMS", "SYSTEM_IDENTIFIER", "DATABASE_SIZE_BYTES",
        "RPO_HOURS", "RTO_SECONDS", "BACKUP_WRITER_SHA256", "BACKUP_INSPECTOR_SHA256",
        "RETENTION_SELECTOR_SHA256", "BACKUP_CONFIG_SOURCE", "BACKUP_CONFIG_SHA256",
    }
    manifest = parse_env(
        trusted_bytes(backup_dir / "manifest.env", exact_mode=0o600, max_size=64 * 1024),
        manifest_keys,
        "retained backup manifest",
    )
    if (manifest["BACKUP_ID"] != backup_id or manifest["BACKUP_SCHEMA_VERSION"] != "2"
            or manifest["BACKUP_TIER"] != "daily" or manifest["DATABASE_NAME"] != args.database
            or manifest["DATA_CHECKSUMS"] != "on" or manifest["SYSTEM_IDENTIFIER"] != args.system_identifier):
        fail("retained backup manifest differs from the restore contract")
    if manifest["CREATED_AT"] != evidence["backupCreatedAt"]:
        fail("retained backup creation timestamp differs from evidence")
    if (manifest["RPO_HOURS"] != backup_config["RPO_HOURS"]
            or manifest["RTO_SECONDS"] != backup_config["RTO_SECONDS"]):
        fail("retained backup RPO/RTO differs from the current configuration")
    if manifest["BACKUP_CONFIG_SOURCE"] != "file":
        fail("retained restore source did not use the explicit backup configuration")
    manifest_contract = {
        "BACKUP_WRITER_SHA256": "backupWriterSha256",
        "BACKUP_INSPECTOR_SHA256": "backupInspectorSha256",
        "RETENTION_SELECTOR_SHA256": "retentionSelectorSha256",
        "BACKUP_CONFIG_SHA256": "backupConfigSha256",
    }
    for manifest_key, evidence_key in manifest_contract.items():
        if manifest[manifest_key] != evidence[evidence_key]:
            fail(f"retained backup contract differs from evidence: {manifest_key}")
elif args.require_retained:
    fail("restore verification source is no longer retained")

contract_rows = [
    ("databaseName", evidence["databaseName"]),
    ("postgresSystemIdentifier", evidence["postgresSystemIdentifier"]),
    ("activeRelease", evidence["activeRelease"]),
    ("backup", evidence["backup"]),
    ("backupCreatedAt", evidence["backupCreatedAt"]),
]
for key in sorted(digest_fields - {"contractSha256"}):
    contract_rows.append((key, evidence[key]))
contract_value = "".join(f"{key}={value}\n" for key, value in contract_rows).encode("utf-8")
if sha256_bytes(contract_value) != evidence["contractSha256"]:
    fail("restore evidence aggregate contract digest is invalid")

try:
    verified_at = dt.datetime.strptime(evidence["verifiedAt"], "%Y-%m-%dT%H:%M:%SZ").replace(
        tzinfo=dt.timezone.utc
    )
    verification_started = dt.datetime.strptime(expected_id, "%Y%m%dT%H%M%SZ").replace(
        tzinfo=dt.timezone.utc
    )
    backup_identity = dt.datetime.strptime(backup_id, "%Y%m%dT%H%M%SZ").replace(
        tzinfo=dt.timezone.utc
    )
    backup_created_at = dt.datetime.strptime(
        evidence["backupCreatedAt"], "%Y-%m-%dT%H:%M:%SZ"
    ).replace(tzinfo=dt.timezone.utc)
except (TypeError, ValueError):
    fail("restore evidence timestamp is invalid")
now = dt.datetime.now(dt.timezone.utc)
if verified_at - now > dt.timedelta(minutes=5):
    fail("restore evidence is implausibly future-dated")
span = verified_at - verification_started
if span < dt.timedelta(0) or span > dt.timedelta(seconds=evidence["rtoSeconds"] + 300):
    fail("restore evidence identity and completion timestamp are inconsistent")
backup_creation_span = backup_created_at - backup_identity
backup_age_at_verification = verification_started - backup_created_at
if (backup_creation_span < dt.timedelta(0)
        or backup_creation_span > dt.timedelta(days=1)
        or backup_age_at_verification < dt.timedelta(0)
        or backup_age_at_verification > dt.timedelta(hours=numeric_config["RPO_HOURS"], minutes=5)):
    fail("restore evidence source did not satisfy the current RPO/timestamp contract")
if verified_at.date() < now.date() - dt.timedelta(days=35):
    fail("restore evidence exceeds the monthly UTC calendar window plus grace")

print(f"PostgreSQL restore evidence is current: {expected_id}")
