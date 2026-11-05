#!/usr/bin/env bash
set -Eeuo pipefail
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

fail() {
  printf '%s\n' "ERROR: $*" >&2
  exit 1
}

case "$#" in
  2) esm_mode=disabled ;;
  3)
    [ "$3" = --enable-esm ] || fail "the only optional argument is --enable-esm"
    esm_mode=enabled
    ;;
  *) fail "usage: $0 APPROVED_SOURCES INDEXTARGETS_OUTPUT [--enable-esm]" ;;
esac
policy_file=$1
targets_file=$2
for input_file in "$policy_file" "$targets_file"; do
  [ -f "$input_file" ] && [ ! -L "$input_file" ] \
    || fail "APT source assertion input is missing, linked, or not a regular file: $input_file"
done

# The indextargets boundary is the complete set of active binary Packages
# indexes, not merely a presence check for the Ubuntu security pocket. Every
# actual Packages row must match one canonical policy row exactly; translations
# and other non-package metadata are intentionally outside this comparison.
python3 -I - "$policy_file" "$targets_file" "$esm_mode" <<'PY'
from __future__ import annotations

import collections
import pathlib
import re
import stat
import sys
from typing import NoReturn


def fail(message: str) -> NoReturn:
    raise SystemExit(f"ERROR: {message}")


policy_path = pathlib.Path(sys.argv[1])
targets_path = pathlib.Path(sys.argv[2])
esm_enabled = sys.argv[3] == "enabled"
for input_path in (policy_path, targets_path):
    metadata = input_path.lstat()
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1 or metadata.st_mode & 0o022:
        fail(f"APT package assertion input is linked, special, or writable: {input_path}")

ubuntu_uri = "http://mirrors.tencentyun.com/ubuntu"
components = ("main", "restricted", "universe", "multiverse")
required = {
    (ubuntu_uri, suite, "jammy", component, "amd64", "Packages", "Packages")
    for suite in ("jammy", "jammy-security", "jammy-updates")
    for component in components
}
required.add(
    (
        "https://nginx.org/packages/ubuntu",
        "jammy",
        "jammy",
        "nginx",
        "amd64",
        "Packages",
        "Packages",
    )
)
optional_esm = {
    (
        "https://esm.ubuntu.com/apps/ubuntu",
        "jammy-apps-security",
        "jammy",
        "main",
        "amd64",
        "Packages",
        "Packages",
    ),
    (
        "https://esm.ubuntu.com/infra/ubuntu",
        "jammy-infra-security",
        "jammy",
        "main",
        "amd64",
        "Packages",
        "Packages",
    ),
}

policy_version: str | None = None
policy_esm: str | None = None
policy_rows: dict[str, set[tuple[str, ...]]] = {
    "required": set(),
    "esm": set(),
}
for number, raw_line in enumerate(policy_path.read_text(encoding="utf-8").splitlines(), 1):
    line = raw_line.strip()
    if not line or line.startswith("#"):
        continue
    if line.startswith("POLICY_VERSION="):
        if policy_version is not None:
            fail("duplicate APT package policy version")
        policy_version = line.removeprefix("POLICY_VERSION=")
        continue
    if line.startswith("ESM_MODE="):
        if policy_esm is not None:
            fail("duplicate APT ESM mode")
        policy_esm = line.removeprefix("ESM_MODE=")
        continue
    fields = tuple(line.split("|"))
    if len(fields) != 8 or fields[0] not in policy_rows or any(not value for value in fields):
        fail(f"malformed APT package policy row {number}")
    row = fields[1:]
    if row in policy_rows[fields[0]]:
        fail(f"duplicate APT package policy row {number}")
    policy_rows[fields[0]].add(row)

if policy_version != "resume-ai-apt-packages-v2":
    fail("unapproved APT package policy version")
if policy_esm != "explicit":
    fail("APT policy must keep ESM behind the explicit command-line gate")
if policy_rows["required"] != required or policy_rows["esm"] != optional_esm:
    fail("APT package policy differs from the canonical Jammy/nginx.org target set")

approved = required | (optional_esm if esm_enabled else set())
observed: collections.Counter[tuple[str, ...]] = collections.Counter()
observed_indexes: set[str] = set()
safe_index = re.compile(r"^/var/lib/apt/lists/[A-Za-z0-9][A-Za-z0-9%+.,_:=~-]{0,511}$")
for number, raw_line in enumerate(targets_path.read_text(encoding="utf-8").splitlines(), 1):
    if not raw_line:
        continue
    fields = tuple(raw_line.split("|"))
    if len(fields) != 9 or any(not value for value in fields):
        fail(f"malformed or empty apt-get indextargets row {number}")
    # apt-get indextargets also reports Translation, DEP-11 and other indexes.
    # Only rows that can supply installable binary packages are in this policy.
    if fields[5] != "Packages" and fields[6] != "Packages":
        continue
    if fields[5] != "Packages" or fields[6] != "Packages":
        fail(f"ambiguous Packages target metadata on row {number}")
    row = fields[:7]
    if row not in approved:
        fail("unapproved active Packages target: " + "|".join(row))
    if fields[8] != "yes":
        fail(f"active Packages target is not authenticated on row {number}")
    if safe_index.fullmatch(fields[7]) is None:
        fail(f"unsafe Packages index path on row {number}")
    if fields[7] in observed_indexes:
        fail(f"Packages index path is reused on row {number}")
    observed_indexes.add(fields[7])
    observed[row] += 1

duplicates = sorted(row for row, count in observed.items() if count != 1)
missing = sorted(approved - set(observed))
if duplicates:
    fail("active Packages target is duplicated: " + "|".join(duplicates[0]))
if missing:
    fail("approved Packages target is disabled or missing: " + "|".join(missing[0]))
if set(observed) != approved:
    fail("active Packages target set differs from the exact approved policy")

print(
    f"Exact authenticated APT Packages policy is active ({len(approved)} targets; "
    f"ESM {'enabled' if esm_enabled else 'disabled'})."
)
PY
