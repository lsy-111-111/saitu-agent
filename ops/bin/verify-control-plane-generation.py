#!/usr/bin/env python3
"""Verify source-manifest-bound root control-plane generations."""

from __future__ import annotations

import argparse
import hashlib
import pathlib
import re
import stat


def fail(message: str) -> "NoReturn":
    raise SystemExit(f"ERROR: {message}")


def ordinary(path: pathlib.Path, label: str, *, source: bool = False) -> stat.stat_result:
    if not path.is_absolute():
        fail(f"{label} must be absolute")
    try:
        metadata = path.lstat()
    except FileNotFoundError:
        fail(f"{label} is missing")
    if not stat.S_ISREG(metadata.st_mode) or path.is_symlink() or metadata.st_nlink != 1:
        fail(f"{label} is linked or not one ordinary file")
    try:
        if path.resolve(strict=True) != path:
            fail(f"{label} traverses a symbolic-link ancestor")
    except RuntimeError:
        fail(f"{label} has an unsafe resolution loop")
    if source:
        if metadata.st_uid != 0 or metadata.st_mode & 0o022:
            fail(f"{label} is not root-frozen")
    return metadata


parser = argparse.ArgumentParser()
parser.add_argument("--mode", choices=("source", "installed", "manifest"), required=True)
parser.add_argument("--source-root", required=True)
parser.add_argument("--source-manifest", required=True)
parser.add_argument("--spec", required=True)
parser.add_argument("--candidate-spec")
parser.add_argument("--installed-manifest")
args = parser.parse_args()

source_root = pathlib.Path(args.source_root)
if not source_root.is_absolute() or not source_root.is_dir() or source_root.is_symlink():
    fail("control-plane source root is missing, linked, or not absolute")
try:
    if source_root.resolve(strict=True) != source_root:
        fail("control-plane source root traverses a symbolic-link ancestor")
except RuntimeError:
    fail("control-plane source root has an unsafe resolution loop")
root_metadata = source_root.lstat()
if root_metadata.st_uid != 0 or root_metadata.st_mode & 0o022:
    fail("control-plane source root is not root-frozen")
release_id = source_root.name
if re.fullmatch(r"20\d{6}T\d{6}Z", release_id) is None:
    fail("control-plane source root has no managed release identity")

source_manifest = pathlib.Path(args.source_manifest)
ordinary(source_manifest, "release source manifest", source=True)
source_manifest_raw = source_manifest.read_bytes()
source_manifest_sha = hashlib.sha256(source_manifest_raw).hexdigest()
source_entries: dict[str, tuple[str, str]] = {}
for raw_line in source_manifest_raw.decode("utf-8", errors="strict").splitlines():
    match = re.fullmatch(r"([a-f0-9]{64})\t([FL])\t([^\t\r\n]+)", raw_line)
    if match is None:
        fail("release source manifest contains a malformed row")
    digest, kind, relative = match.groups()
    path = pathlib.PurePosixPath(relative)
    if (path.is_absolute() or path.as_posix() != relative
            or any(part in {"", ".", ".."} for part in path.parts)
            or relative in source_entries):
        fail("release source manifest contains an unsafe or duplicate path")
    source_entries[relative] = (digest, kind)

spec = pathlib.Path(args.spec)
ordinary(spec, "control-plane file specification", source=True)
spec_raw = spec.read_bytes()
spec_sha = hashlib.sha256(spec_raw).hexdigest()
if args.candidate_spec is None:
    try:
        spec_relative = spec.relative_to(source_root).as_posix()
    except ValueError:
        fail("source specification is outside the fixed release")
    if source_entries.get(spec_relative) != (spec_sha, "F"):
        fail("control-plane specification is not bound to the release source manifest")
else:
    candidate_spec = pathlib.Path(args.candidate_spec)
    ordinary(candidate_spec, "candidate control-plane specification", source=True)
    try:
        candidate_spec_relative = candidate_spec.relative_to(source_root).as_posix()
    except ValueError:
        fail("candidate control-plane specification is outside the fixed release")
    candidate_spec_raw = candidate_spec.read_bytes()
    candidate_spec_sha = hashlib.sha256(candidate_spec_raw).hexdigest()
    if source_entries.get(candidate_spec_relative) != (candidate_spec_sha, "F"):
        fail("candidate control-plane specification is not source-manifest bound")
    if candidate_spec_raw != spec_raw:
        fail("candidate control-plane specification differs from the installed trust anchor")

rows: list[tuple[int, str, pathlib.Path, str]] = []
seen_sources: set[str] = set()
seen_targets: set[str] = set()
allowed_target_roots = (
    "/usr/local/lib/resume-ai/", "/usr/local/share/resume-ai/",
    "/etc/systemd/system/", "/etc/udev/rules.d/", "/etc/logrotate.d/", "/etc/resume-ai/",
)
for line in spec_raw.decode("utf-8", errors="strict").splitlines():
    if not line or line.startswith("#"):
        continue
    fields = line.split("\t")
    if len(fields) != 3 or re.fullmatch(r"0[45-7][0-7]{2}", fields[0]) is None:
        fail("control-plane specification contains a malformed row")
    mode = int(fields[0], 8)
    relative = pathlib.PurePosixPath(fields[1])
    target = pathlib.Path(fields[2])
    target_pure = pathlib.PurePosixPath(fields[2])
    if (relative.is_absolute() or relative.as_posix() != fields[1]
            or any(part in {"", ".", ".."} for part in relative.parts)
            or fields[1] in seen_sources):
        fail("control-plane specification contains an unsafe or duplicate source")
    if (not target.is_absolute() or not target_pure.is_absolute()
            or target_pure.as_posix() != fields[2]
            or any(part in {"", ".", ".."} for part in target_pure.parts)
            or str(target) != fields[2]
            or not str(target).startswith(allowed_target_roots)
            or fields[2] in seen_targets):
        fail("control-plane specification contains an unsafe or duplicate target")
    seen_sources.add(fields[1])
    seen_targets.add(fields[2])
    rows.append((mode, fields[1], target, fields[2]))
if len(rows) < 50:
    fail("control-plane specification is unexpectedly incomplete")

canonical = bytearray()
for mode, relative, target, target_text in rows:
    source = source_root.joinpath(*pathlib.PurePosixPath(relative).parts)
    ordinary(source, f"control-plane source {relative}", source=True)
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    if source_entries.get(relative) != (digest, "F"):
        fail(f"control-plane source is not bound to the release manifest: {relative}")
    canonical.extend(f"{digest}\t{mode:04o}\t{relative}\t{target_text}\n".encode())
    if args.mode == "installed":
        metadata = ordinary(target, f"installed control {target_text}")
        if (metadata.st_uid != 0 or metadata.st_gid != 0
                or stat.S_IMODE(metadata.st_mode) != mode):
            fail(f"installed control ownership/mode differs: {target_text}")
        if hashlib.sha256(target.read_bytes()).hexdigest() != digest:
            fail(f"installed control differs from the active source: {target_text}")

generation = hashlib.sha256(
    f"SOURCE_MANIFEST_SHA256={source_manifest_sha}\nCONTROL_SPEC_SHA256={spec_sha}\n".encode()
    + bytes(canonical)
).hexdigest()
manifest_values = {
    "SCHEMA_VERSION": "1",
    "RELEASE_ID": release_id,
    "SOURCE_MANIFEST_SHA256": source_manifest_sha,
    "CONTROL_SPEC_SHA256": spec_sha,
    "MEMBER_COUNT": str(len(rows)),
    "GENERATION_SHA256": generation,
}
if args.mode == "manifest":
    if args.installed_manifest is not None:
        fail("manifest emission does not accept an installed manifest")
    for key in (
        "SCHEMA_VERSION", "RELEASE_ID", "SOURCE_MANIFEST_SHA256",
        "CONTROL_SPEC_SHA256", "MEMBER_COUNT", "GENERATION_SHA256",
    ):
        print(f"{key}={manifest_values[key]}")
elif args.mode == "installed":
    if args.installed_manifest is None:
        fail("installed verification requires the installed generation manifest")
    installed_manifest = pathlib.Path(args.installed_manifest)
    metadata = ordinary(installed_manifest, "installed control-plane manifest")
    if metadata.st_uid != 0 or metadata.st_gid != 0 or stat.S_IMODE(metadata.st_mode) != 0o400:
        fail("installed control-plane manifest ownership/mode differs")
    observed: dict[str, str] = {}
    for line in installed_manifest.read_text(encoding="utf-8").splitlines():
        if "=" not in line:
            fail("installed control-plane manifest contains a malformed row")
        key, value = line.split("=", 1)
        if key not in manifest_values or key in observed or not value:
            fail("installed control-plane manifest contains an unknown or duplicate key")
        observed[key] = value
    if observed != manifest_values:
        fail("installed control-plane manifest differs from the active generation")
    print(generation)
else:
    if args.installed_manifest is not None:
        fail("source verification does not accept an installed manifest")
    print(generation)
