#!/usr/bin/env python3
"""Validate the one narrow pending-deploy exception used by host acceptance."""

from __future__ import annotations

import datetime
import hashlib
import pathlib
import re
import stat
import sys


def fail(message: str) -> "NoReturn":
    raise SystemExit(f"ERROR: {message}")


if len(sys.argv) not in {5, 8}:
    fail(
        "usage: validate-pending-deploy-host-state.py STATE JOURNAL ROOT_UID RUNTIME_GID "
        "[TEST_APPROVAL TEST_APPROVAL_UID TEST_APPROVAL_GID]"
    )

state_path = pathlib.Path(sys.argv[1])
journal_path = pathlib.Path(sys.argv[2])
try:
    expected_uid = int(sys.argv[3])
    expected_gid = int(sys.argv[4])
except ValueError:
    fail("pending owner identity must be numeric")
if len(sys.argv) == 8:
    # The production host never supplies this argument. It exists solely so a
    # non-root unit test can exercise the complete approval-binding branch.
    approval_path = pathlib.Path(sys.argv[5])
    try:
        approval_expected_uid = int(sys.argv[6])
        approval_expected_gid = int(sys.argv[7])
    except ValueError:
        fail("test approval owner identity must be numeric")
    if not approval_path.is_absolute():
        fail("test approval path must be absolute")
else:
    approval_path = None
    approval_expected_uid = 0
    approval_expected_gid = 0


def read_protected(path: pathlib.Path, allowed: set[str]) -> dict[str, str]:
    metadata = path.lstat()
    if (
        not stat.S_ISREG(metadata.st_mode)
        or stat.S_ISLNK(metadata.st_mode)
        or metadata.st_uid != expected_uid
        or metadata.st_gid != expected_gid
        or metadata.st_nlink != 1
        or stat.S_IMODE(metadata.st_mode) != 0o640
    ):
        fail(f"pending deployment input is linked or has unsafe ownership: {path}")
    values: dict[str, str] = {}
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if "=" not in line:
            fail(f"malformed pending deployment row at {path}:{line_number}")
        key, value = line.split("=", 1)
        if key not in allowed or key in values or not value or "\r" in value or "\n" in value:
            fail(f"unknown, duplicate, or empty pending deployment row at {path}:{line_number}")
        values[key] = value
    if set(values) != allowed:
        fail(f"pending deployment input does not have its exact schema: {path}")
    return values


state_keys = {
    "ACTIVE_PORT",
    "ACTIVE_RELEASE",
    "PREVIOUS_PORT",
    "PREVIOUS_RELEASE",
    "SWITCHED_AT",
}
journal_keys = {
    "KIND",
    "PHASE",
    "OLD_ACTIVE_PORT",
    "OLD_ACTIVE_RELEASE",
    "OLD_PREVIOUS_PORT",
    "OLD_PREVIOUS_RELEASE",
    "NEW_PORT",
    "NEW_RELEASE",
    "NEW_PREVIOUS_PORT",
    "NEW_PREVIOUS_RELEASE",
    "APPROVAL_FILE_SHA256",
}
state = read_protected(state_path, state_keys)
journal = read_protected(journal_path, journal_keys)

release = re.compile(r"20\d{6}T\d{6}Z")
port = re.compile(r"300[01]")
if journal["KIND"] != "deploy" or journal["PHASE"] not in {
    "nginx_switched",
    "permissions_hardened",
    "state_committed",
}:
    fail("pending deployment phase is not an approved host-validation phase")
if re.fullmatch(r"[a-f0-9]{64}", journal["APPROVAL_FILE_SHA256"]) is None:
    fail("pending deployment approval digest is malformed")
for key in ("ACTIVE_RELEASE", "PREVIOUS_RELEASE"):
    if release.fullmatch(state[key]) is None:
        fail("pending state release identity is invalid")
for key in ("OLD_ACTIVE_RELEASE", "NEW_RELEASE", "NEW_PREVIOUS_RELEASE"):
    if release.fullmatch(journal[key]) is None:
        fail("pending journal release identity is invalid")
if journal["OLD_PREVIOUS_RELEASE"] != "none" and release.fullmatch(
    journal["OLD_PREVIOUS_RELEASE"]
) is None:
    fail("pending journal old previous release identity is invalid")
for key in ("ACTIVE_PORT", "PREVIOUS_PORT"):
    if port.fullmatch(state[key]) is None:
        fail("pending state port identity is invalid")
for key in ("OLD_ACTIVE_PORT", "NEW_PORT", "NEW_PREVIOUS_PORT"):
    if port.fullmatch(journal[key]) is None:
        fail("pending journal port identity is invalid")
if journal["OLD_PREVIOUS_PORT"] != "none" and port.fullmatch(
    journal["OLD_PREVIOUS_PORT"]
) is None:
    fail("pending journal old previous port identity is invalid")
if (journal["OLD_PREVIOUS_PORT"] == "none") != (
    journal["OLD_PREVIOUS_RELEASE"] == "none"
):
    fail("pending journal old previous port/release pair is inconsistent")

expected_bindings = {
    "NEW_PORT": state["ACTIVE_PORT"],
    "NEW_RELEASE": state["ACTIVE_RELEASE"],
    "NEW_PREVIOUS_PORT": state["PREVIOUS_PORT"],
    "NEW_PREVIOUS_RELEASE": state["PREVIOUS_RELEASE"],
    "OLD_ACTIVE_PORT": state["PREVIOUS_PORT"],
    "OLD_ACTIVE_RELEASE": state["PREVIOUS_RELEASE"],
}
for key, expected in expected_bindings.items():
    if journal[key] != expected:
        fail(f"pending deployment {key} is not bound to active state")

if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", state["SWITCHED_AT"]):
    fail("pending active state timestamp is malformed")
try:
    switched_at = datetime.datetime.strptime(
        state["SWITCHED_AT"], "%Y-%m-%dT%H:%M:%SZ"
    ).replace(tzinfo=datetime.timezone.utc)
    release_at = datetime.datetime.strptime(
        journal["NEW_RELEASE"], "%Y%m%dT%H%M%SZ"
    ).replace(tzinfo=datetime.timezone.utc)
except ValueError:
    fail("pending deployment timestamp is invalid")
now = datetime.datetime.now(datetime.timezone.utc)
if switched_at > now + datetime.timedelta(minutes=5):
    fail("pending active state timestamp is in the future")
if switched_at + datetime.timedelta(minutes=5) < release_at:
    fail("pending active state predates its release identity")

if approval_path is None:
    approval_path = pathlib.Path(
        f"/etc/resume-ai/approved-releases/{journal['NEW_RELEASE']}.env"
    )
try:
    approval_metadata = approval_path.lstat()
except OSError:
    fail("pending deployment approval is missing")
if (
    not stat.S_ISREG(approval_metadata.st_mode)
    or stat.S_ISLNK(approval_metadata.st_mode)
    or approval_metadata.st_uid != approval_expected_uid
    or approval_metadata.st_gid != approval_expected_gid
    or approval_metadata.st_nlink != 1
    or stat.S_IMODE(approval_metadata.st_mode) != 0o400
    or hashlib.sha256(approval_path.read_bytes()).hexdigest()
    != journal["APPROVAL_FILE_SHA256"]
):
    fail("pending deployment is not bound to its immutable root approval")

print(journal["PHASE"])
