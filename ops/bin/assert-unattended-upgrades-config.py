#!/usr/bin/env python3
"""Validate the security-relevant effective unattended-upgrades policy."""

from __future__ import annotations

import argparse
import pathlib
import re
import stat
from collections import defaultdict
from typing import NoReturn


def fail(message: str) -> NoReturn:
    raise SystemExit(f"ERROR: {message}")


parser = argparse.ArgumentParser()
parser.add_argument("--dump", required=True, type=pathlib.Path)
parser.add_argument("--esm", required=True, choices=("disabled", "enabled"))
args = parser.parse_args()
metadata = args.dump.lstat()
if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1 or metadata.st_mode & 0o022:
    fail("APT configuration dump is linked, special, or writable by an untrusted account")

entries: dict[str, list[str]] = defaultdict(list)
syntax = re.compile(r'^([^\s]+)\s+"((?:[^"\\]|\\.)*)";$')
for number, raw_line in enumerate(args.dump.read_text(encoding="utf-8").splitlines(), 1):
    line = raw_line.strip()
    if not line:
        continue
    match = syntax.fullmatch(line)
    if match is None:
        fail(f"malformed apt-config dump line {number}")
    entries[match.group(1)].append(match.group(2))


def one(key: str, expected: str) -> None:
    if entries.get(key) != [expected]:
        fail(f"effective APT value is not exact: {key}")


one("APT::Periodic::Update-Package-Lists", "1")
one("APT::Periodic::Unattended-Upgrade", "1")
one("APT::Periodic::AutocleanInterval", "7")
for key in (
    "Unattended-Upgrade::Remove-Unused-Kernel-Packages",
    "Unattended-Upgrade::Remove-New-Unused-Dependencies",
    "Unattended-Upgrade::Remove-Unused-Dependencies",
    "Unattended-Upgrade::Automatic-Reboot",
    "Unattended-Upgrade::Automatic-Reboot-WithUsers",
    "Unattended-Upgrade::InstallOnShutdown",
    "Unattended-Upgrade::Skip-Updates-On-Metered-Connections",
    "Unattended-Upgrade::Allow-downgrade",
):
    one(key, "false")
one("Unattended-Upgrade::SyslogEnable", "true")

for key in entries:
    if key.startswith("Unattended-Upgrade::Origins-Pattern"):
        fail("Origins-Pattern can widen unattended upgrades outside the exact origin set")

one("Unattended-Upgrade::Allowed-Origins", "")
origin_key = "Unattended-Upgrade::Allowed-Origins::"
for key in entries:
    if key.startswith(origin_key) and key != origin_key:
        fail("nested unattended-upgrade origin keys are not approved")
origins = entries.get(origin_key, [])
expected_origins = ["${distro_id}:${distro_codename}-security"]
if args.esm == "enabled":
    expected_origins.extend(
        [
            "${distro_id}ESMApps:${distro_codename}-apps-security",
            "${distro_id}ESM:${distro_codename}-infra-security",
        ]
    )
if origins != expected_origins or len(origins) != len(set(origins)):
    fail("effective unattended-upgrade origins differ from the exact security policy")

one("Unattended-Upgrade::Package-Blacklist", "")
blacklist_key = "Unattended-Upgrade::Package-Blacklist::"
for key in entries:
    if key.startswith(blacklist_key) and key != blacklist_key:
        fail("nested unattended-upgrade blacklist keys are not approved")
if entries.get(blacklist_key, []):
    fail("unexpected unattended-upgrade package blacklist entry")

for restricted_prefix in (
    "Unattended-Upgrade::Package-Whitelist",
    "Unattended-Upgrade::Update-Days",
):
    if any(key == restricted_prefix or key.startswith(restricted_prefix + "::") for key in entries):
        fail(f"unattended upgrades can be silently restricted by {restricted_prefix}")

for scalar in (
    "Unattended-Upgrade::Remove-Unused-Kernel-Packages",
    "Unattended-Upgrade::Remove-New-Unused-Dependencies",
    "Unattended-Upgrade::Remove-Unused-Dependencies",
    "Unattended-Upgrade::Automatic-Reboot",
    "Unattended-Upgrade::Automatic-Reboot-WithUsers",
    "Unattended-Upgrade::InstallOnShutdown",
    "Unattended-Upgrade::Skip-Updates-On-Metered-Connections",
    "Unattended-Upgrade::Allow-downgrade",
    "Unattended-Upgrade::SyslogEnable",
):
    if any(key.startswith(scalar + "::") for key in entries):
        fail(f"effective APT scalar has an unapproved nested form: {scalar}")

print(f"Effective unattended-upgrades policy is exact (ESM {args.esm}).")
