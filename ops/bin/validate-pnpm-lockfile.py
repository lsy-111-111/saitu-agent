#!/usr/bin/python3
"""Fail closed unless a pnpm v9 lockfile uses only integrity-bound npm packages."""

from __future__ import annotations

import argparse
import base64
import json
import pathlib
import re


def fail(message: str) -> "NoReturn":
    raise SystemExit(f"ERROR: {message}")


def reject_duplicates(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            fail(f"package.json contains a duplicate key: {key}")
        result[key] = value
    return result


parser = argparse.ArgumentParser(add_help=False)
parser.add_argument("--source", required=True)
arguments = parser.parse_args()
root_input = pathlib.Path(arguments.source)
root = root_input.resolve(strict=True)
if root != root_input or not root.is_dir() or root.is_symlink():
    fail("package source is not one physical directory")

npmrc = root / ".npmrc"
lock_path = root / "pnpm-lock.yaml"
package_path = root / "package.json"
for path in (npmrc, lock_path, package_path):
    metadata = path.lstat()
    if not path.is_file() or path.is_symlink() or metadata.st_nlink != 1:
        fail(f"package policy input is missing, linked, or hard-linked: {path.name}")
if npmrc.read_bytes() not in {b"engine-strict=true\n", b"engine-strict=true"}:
    fail("project .npmrc differs from the reviewed registry-neutral policy")

try:
    package = json.loads(
        package_path.read_text(encoding="utf-8"), object_pairs_hook=reject_duplicates
    )
except (OSError, UnicodeError, json.JSONDecodeError) as error:
    fail(f"package.json is not strict JSON: {error}")
if not isinstance(package, dict) or package.get("packageManager") != (
    "pnpm@11.19.0+sha512.7881f3ed590d472c4a955e2b88b2121791116066dcc88cbca3849ec9b60f1bbaa6d2ccb221fa91da4e1c65bef2bcbe379365aea7ac539c7bf86dedc3a1b22dce"
):
    fail("package.json does not pin the reviewed pnpm executable identity")

raw = lock_path.read_bytes()
if not raw or len(raw) > 16 * 1024 * 1024 or b"\x00" in raw:
    fail("pnpm lockfile is empty, oversized, or binary")
try:
    text = raw.decode("utf-8")
except UnicodeDecodeError as error:
    fail(f"pnpm lockfile is not UTF-8: {error}")
if "\r" in text or "\t" in text:
    fail("pnpm lockfile uses non-canonical controls")

source_token = re.compile(
    r"(?i)(?:https?://|git(?:\+[^:]+)?://|git@|github:|bitbucket:|ssh:|file:|link:|workspace:)"
)
source_value = re.compile(r"^\s+(?:resolution|specifier|version|tarball|path|repo):")
configurable_source = re.compile(
    r"^\s+(?:patchedDependencies|registry|registries|publishConfig):"
)
for line in text.splitlines():
    if configurable_source.match(line) is not None:
        fail("pnpm lockfile contains configurable package source policy")
    if source_value.match(line) is not None and source_token.search(line) is not None:
        fail("pnpm lockfile contains a Git/file/http/custom package source")

lines = text.splitlines()
if lines.count("lockfileVersion: '9.0'") != 1:
    fail("pnpm lockfile version is not exactly 9.0")
try:
    packages_start = lines.index("packages:")
    snapshots_start = lines.index("snapshots:")
except ValueError:
    fail("pnpm lockfile lacks packages/snapshots sections")
if packages_start >= snapshots_start:
    fail("pnpm lockfile section order is invalid")

package_header = re.compile(r"^  (?:'[^\r\n]+'|[^ '\r\n][^\r\n]*):$")
integrity_row = re.compile(r"^    resolution: \{integrity: (sha512-[A-Za-z0-9+/]+={0,2})\}$")
package_count = 0
integrity_count = 0
active_package = False
active_integrity = False
for line in lines[packages_start + 1 : snapshots_start]:
    if not line or line.startswith("    "):
        integrity_match = integrity_row.fullmatch(line)
        if integrity_match is not None:
            if not active_package or active_integrity:
                fail("package has a duplicate or misplaced integrity resolution")
            encoded = integrity_match.group(1).removeprefix("sha512-")
            try:
                decoded = base64.b64decode(encoded, validate=True)
            except ValueError:
                fail("package integrity is not canonical base64")
            if len(decoded) != 64:
                fail("package integrity is not a SHA-512 digest")
            active_integrity = True
            integrity_count += 1
        elif line.lstrip().startswith("resolution:"):
            fail("package resolution is not one exact SHA-512 integrity row")
        continue
    if line.startswith("  "):
        if active_package and not active_integrity:
            fail("package is missing its registry integrity")
        if package_header.fullmatch(line) is None:
            fail("packages section contains an unsupported top-level row")
        if source_token.search(line) is not None:
            fail("package identity contains a Git/file/http/custom source")
        active_package = True
        active_integrity = False
        package_count += 1
        continue
    fail("packages section escaped its expected indentation")
if active_package and not active_integrity:
    fail("final package is missing its registry integrity")
if package_count == 0 or package_count != integrity_count:
    fail("pnpm package/integrity cardinality is invalid")

print(f"packages={package_count} registry=https://registry.npmjs.org integrity=sha512")
