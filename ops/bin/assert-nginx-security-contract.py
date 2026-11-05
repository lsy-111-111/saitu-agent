#!/usr/bin/env python3
"""Validate the effective Nginx configuration and compiled-module contract.

The official package bytes are attested separately.  This parser therefore
focuses on the configuration-dependent preconditions for the 2026 map/SSI/
slice vulnerabilities and on excluding unreviewed include/module surfaces.
"""

from __future__ import annotations

import argparse
import pathlib
import re
import sys


MANAGED_FILES = {
    "/etc/nginx/nginx.conf",
    "/etc/nginx/mime.types",
    "/etc/nginx/conf.d/00-resume-ai-global.conf",
    "/etc/nginx/conf.d/10-resume-ai-upstream.conf",
    "/etc/nginx/conf.d/20-resume-ai.conf",
    "/etc/nginx/snippets/resume-ai-transport-security.conf",
    "/etc/nginx/snippets/resume-ai-proxy-common.conf",
    "/etc/nginx/snippets/resume-ai-recommend-quota.inc",
    "/etc/nginx/snippets/resume-ai-track-quota.inc",
}
CONFIG_MARKER = re.compile(r"^# configuration file (/[^:]+):$")
CAPTURE_VARIABLE = re.compile(r"\$(?:[1-9][0-9]*|[A-Za-z_][A-Za-z0-9_]*_capture)\b")
REGEX_CAPTURE = re.compile(r"\(\?(?:<[^>]+>|P<[^>]+>)")


def fail(message: str) -> "NoReturn":
    raise SystemExit(f"ERROR: {message}")


def ordinary_file(raw_path: str, label: str) -> pathlib.Path:
    path = pathlib.Path(raw_path)
    if not path.is_absolute():
        fail(f"{label} path must be absolute")
    try:
        metadata = path.lstat()
    except FileNotFoundError:
        fail(f"{label} is missing")
    if not path.is_file() or path.is_symlink() or metadata.st_nlink != 1:
        fail(f"{label} is linked or not one ordinary file")
    return path


def without_comments(text: str) -> list[str]:
    result: list[str] = []
    for raw in text.splitlines():
        if raw.startswith("# configuration file "):
            continue
        # The managed configuration contains no quoted literal '#'.  Treating
        # it as the comment delimiter is intentionally conservative here.
        line = raw.split("#", 1)[0].strip()
        if line:
            result.append(line)
    return result


def assert_no_trigger(text: str) -> None:
    lines = without_comments(text)
    for line in lines:
        lowered = line.lower()
        if re.search(r"(?:^|[{};])\s*load_module(?:\s|;)", lowered):
            fail("dynamic load_module directives are outside the reviewed module contract")
        if re.search(r"(?:^|[{};])\s*ssi\s+on\s*;", lowered):
            fail("SSI is enabled (CVE-2026-56434 trigger)")
        if re.search(r"(?:^|[{};])\s*proxy_buffering\s+off\s*;", lowered):
            fail("proxy buffering is disabled (CVE-2026-56434 trigger)")
        if re.search(r"(?:^|[{};])\s*slice\s+", lowered):
            fail("slice processing is enabled (CVE-2026-60005 trigger)")
        if "~" in line or REGEX_CAPTURE.search(line) or CAPTURE_VARIABLE.search(line):
            fail("regex matching or capture variables are outside the safe map contract")


def brace_delta(line: str) -> int:
    """Count structural braces while ignoring quoted response bodies."""
    delta = 0
    quote = ""
    escaped = False
    for character in line:
        if escaped:
            escaped = False
            continue
        if character == "\\" and quote:
            escaped = True
            continue
        if quote:
            if character == quote:
                quote = ""
            continue
        if character in ("'", '"'):
            quote = character
        elif character == "{":
            delta += 1
        elif character == "}":
            delta -= 1
    if quote:
        fail("unterminated quoted value in effective Nginx configuration")
    return delta


def assert_managed_http2(text: str) -> None:
    blocks: list[list[str]] = []
    active: list[str] | None = None
    depth = 0
    for line in without_comments(text):
        if active is None:
            if re.fullmatch(r"server\s*\{", line):
                active = [line]
                depth = brace_delta(line)
            continue
        active.append(line)
        depth += brace_delta(line)
        if depth < 0:
            fail("unbalanced braces in effective Nginx configuration")
        if depth == 0:
            blocks.append(active)
            active = None
    if active is not None:
        fail("unterminated server block in effective Nginx configuration")

    tls_blocks = 0
    for block in blocks:
        listens = [line for line in block if re.match(r"^listen\s+", line)]
        tls_listens = [line for line in listens if re.search(r"(?:^|[\s\[])(?:\[::\]:)?443(?:\s|;)", line)]
        if not tls_listens:
            continue
        tls_blocks += 1
        if any(re.search(r"\bhttp2\b", line) for line in tls_listens):
            fail("deprecated listen ... http2 syntax is forbidden")
        defaults = any("default_server" in line for line in tls_listens)
        expected = {
            "listen 443 ssl default_server;" if defaults else "listen 443 ssl;",
            "listen [::]:443 ssl default_server;" if defaults else "listen [::]:443 ssl;",
        }
        if set(tls_listens) != expected or len(tls_listens) != 2:
            fail("TLS IPv4/IPv6 listener options are not one exact symmetric pair")
        if sum(line == "http2 on;" for line in block) != 1:
            fail("each TLS virtual host must enable HTTP/2 exactly once")
    if tls_blocks != 3:
        fail("managed Nginx policy requires exactly three TLS virtual hosts")


def assert_managed_inventory(text: str) -> None:
    observed: list[str] = []
    for line in text.splitlines():
        match = CONFIG_MARKER.fullmatch(line)
        if match:
            observed.append(match.group(1))
    observed_set = set(observed)
    if observed_set != MANAGED_FILES:
        missing = sorted(MANAGED_FILES - observed_set)
        extra = sorted(observed_set - MANAGED_FILES)
        fail(f"effective include inventory differs from policy; missing={missing!r} extra={extra!r}")
    if len(observed) != len(observed_set):
        fail("effective configuration contains duplicate include inventory members")


def assert_version_contract(text: str, require_approved_package: bool) -> None:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if not lines or re.fullmatch(r"nginx version: nginx/[0-9]+\.[0-9]+\.[0-9]+", lines[0]) is None:
        fail("Nginx runtime version output is malformed")
    if require_approved_package and lines[0] != "nginx version: nginx/1.30.4":
        fail("Nginx runtime version is not exactly 1.30.4")
    arguments = next((line for line in lines if line.startswith("configure arguments:")), "")
    if not arguments:
        fail("Nginx configure arguments are unavailable")
    if require_approved_package:
        for required in ("--with-http_ssl_module", "--with-http_v2_module", "--with-threads"):
            if required not in arguments.split():
                fail(f"required official Nginx module option is absent: {required}")
        if "--add-module=" in arguments or "--add-dynamic-module=" in arguments:
            fail("third-party compiled modules are outside the official package contract")


parser = argparse.ArgumentParser()
config_group = parser.add_mutually_exclusive_group(required=True)
config_group.add_argument("--effective-config")
config_group.add_argument("--config-tree")
parser.add_argument("--version-output", required=True)
parser.add_argument(
    "--mode", choices=("trigger-only", "staged-managed", "managed"), required=True
)
args = parser.parse_args()

version_path = ordinary_file(args.version_output, "Nginx version output")
try:
    version_text = version_path.read_text(encoding="utf-8")
except UnicodeDecodeError:
    fail("Nginx evidence is not UTF-8 text")

if args.config_tree is not None:
    if args.mode not in ("trigger-only", "staged-managed"):
        fail("a configuration tree can be used only for pre-runtime validation")
    tree = pathlib.Path(args.config_tree)
    if not tree.is_absolute() or not tree.is_dir() or tree.is_symlink():
        fail("Nginx configuration tree is missing, linked, or not absolute")
    chunks: list[str] = []
    observed_tree_files: set[str] = set()
    for member in sorted(tree.rglob("*")):
        metadata = member.lstat()
        if member.is_symlink():
            fail(f"Nginx configuration tree contains a symbolic link: {member}")
        if member.is_dir():
            continue
        if not member.is_file() or metadata.st_nlink != 1:
            fail(f"Nginx configuration tree contains a special or hard-linked member: {member}")
        if metadata.st_size > 1024 * 1024:
            fail(f"Nginx configuration member exceeds the review bound: {member}")
        relative = member.relative_to(tree).as_posix()
        observed_tree_files.add(f"/etc/nginx/{relative}")
        try:
            chunks.append(member.read_text(encoding="utf-8"))
        except UnicodeDecodeError:
            fail(f"Nginx configuration member is not UTF-8 text: {member}")
    config_text = "\n".join(chunks)
    if args.mode == "staged-managed" and observed_tree_files != MANAGED_FILES:
        missing = sorted(MANAGED_FILES - observed_tree_files)
        extra = sorted(observed_tree_files - MANAGED_FILES)
        fail(f"staged include inventory differs from policy; missing={missing!r} extra={extra!r}")
else:
    config_path = ordinary_file(args.effective_config, "effective Nginx configuration")
    try:
        config_text = config_path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        fail("Nginx effective configuration is not UTF-8 text")

assert_no_trigger(config_text)
assert_version_contract(version_text, args.mode == "managed")
if args.mode in ("staged-managed", "managed"):
    assert_managed_http2(config_text)
if args.mode == "managed":
    assert_managed_inventory(config_text)
print(f"Nginx {args.mode} security contract passed.")
