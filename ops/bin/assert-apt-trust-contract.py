#!/usr/bin/env python3
"""Verify exact APT source, Signed-By key and pin controls without invoking APT."""

from __future__ import annotations

import argparse
import hashlib
import os
import pathlib
import stat
import struct
from typing import NoReturn


UBUNTU_FINGERPRINTS = {"F6ECB3762474EDA9D21B7022871920D1991BC93C"}
NGINX_FINGERPRINTS = {
    "573BFD6B3D8FBC641079A6ABABF5BD827BD9BF62",
    "8540A6F18833A80E9C1653A42FD21310B49F6B46",
    "9E9BE90EACBCDE69FE9B204CBCDCD8A38D88A2B3",
}
ESM_APP_FINGERPRINTS = {"E8A443CE358113D187BEE0E6AB01A101DB53907B"}
ESM_INFRA_FINGERPRINTS = {"56F7650A24C9E9ECF87C4D8D4067E40313CB4B13"}
BASE_SOURCE_NAMES = {"resume-ai-ubuntu.sources", "nginx.list"}
BASE_PREFERENCE_NAMES = {
    "99nginx",
    "99resume-ai-ubuntu",
    "ubuntu-pro-esm-apps",
    "ubuntu-pro-esm-infra",
}
ESM_SOURCE_NAMES = {"ubuntu-esm-apps.list", "ubuntu-esm-infra.list"}
CANONICAL = {
    "resume-ai-ubuntu.sources": (
        "Types: deb\n"
        "URIs: http://mirrors.tencentyun.com/ubuntu\n"
        "Suites: jammy jammy-updates jammy-security\n"
        "Components: main restricted universe multiverse\n"
        "Architectures: amd64\n"
        "Signed-By: /etc/apt/keyrings/resume-ai-ubuntu-archive-2018.gpg\n"
    ),
    "nginx.list": (
        "deb [arch=amd64 signed-by=/usr/share/keyrings/nginx-archive-keyring.gpg] "
        "https://nginx.org/packages/ubuntu jammy nginx\n"
    ),
    "99nginx": (
        "Package: nginx\n"
        "Pin: version 1.30.4-1~jammy\n"
        "Pin-Priority: 1001\n\n"
        "Package: *\n"
        "Pin: origin nginx.org\n"
        "Pin-Priority: -1\n"
    ),
    "99resume-ai-ubuntu": (
        "Package: *\nPin: release o=Ubuntu,a=jammy\nPin-Priority: 500\n\n"
        "Package: *\nPin: release o=Ubuntu,a=jammy-updates\nPin-Priority: 500\n\n"
        "Package: *\nPin: release o=Ubuntu,a=jammy-security\nPin-Priority: 500\n"
    ),
    "ubuntu-esm-apps.list": (
        "# Managed ESM source; Ubuntu Pro authentication remains in root-only auth.conf.\n"
        "deb [arch=amd64 signed-by=/usr/share/keyrings/ubuntu-pro-esm-apps.gpg] "
        "https://esm.ubuntu.com/apps/ubuntu jammy-apps-security main\n"
    ),
    "ubuntu-esm-infra.list": (
        "# Managed ESM source; Ubuntu Pro authentication remains in root-only auth.conf.\n"
        "deb [arch=amd64 signed-by=/usr/share/keyrings/ubuntu-pro-esm-infra.gpg] "
        "https://esm.ubuntu.com/infra/ubuntu jammy-infra-security main\n"
    ),
    "ubuntu-pro-esm-apps": (
        "Package: *\nPin: release o=UbuntuESMApps\nPin-Priority: 510\n"
    ),
    "ubuntu-pro-esm-infra": (
        "Package: *\nPin: release o=UbuntuESM\nPin-Priority: 510\n"
    ),
}


def fail(message: str) -> NoReturn:
    raise SystemExit(f"ERROR: {message}")


def protected_file(
    path: pathlib.Path,
    production: bool,
    expected_mode: int | None = None,
) -> bytes:
    try:
        metadata = path.lstat()
    except FileNotFoundError:
        fail(f"required APT trust file is missing: {path}")
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
        fail(f"APT trust file is linked or not ordinary: {path}")
    if metadata.st_mode & 0o022:
        fail(f"APT trust file is writable by an untrusted account: {path}")
    if production and (metadata.st_uid != 0 or metadata.st_gid != 0):
        fail(f"APT trust file is not root-owned: {path}")
    if expected_mode is not None and stat.S_IMODE(metadata.st_mode) != expected_mode:
        fail(f"APT trust file mode differs from policy: {path}")

    # lstat followed by Path.read_bytes would leave a validation-to-use race.
    # Open without following links, compare the opened inode to the inspected
    # inode, and read that same descriptor.
    flags = os.O_RDONLY | os.O_CLOEXEC | os.O_NONBLOCK
    flags |= getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags)
    except OSError as error:
        fail(f"APT trust file could not be opened safely: {path}: {error}")
    try:
        opened = os.fstat(descriptor)
        if (
            not stat.S_ISREG(opened.st_mode)
            or opened.st_nlink != 1
            or (opened.st_dev, opened.st_ino) != (metadata.st_dev, metadata.st_ino)
        ):
            fail(f"APT trust file changed while it was being validated: {path}")
        with os.fdopen(os.dup(descriptor), "rb") as handle:
            return handle.read()
    finally:
        os.close(descriptor)


def protected_directory(
    path: pathlib.Path,
    production: bool,
    expected_mode: int | None = None,
) -> None:
    try:
        metadata = path.lstat()
    except FileNotFoundError:
        fail(f"APT control directory is missing: {path}")
    if not stat.S_ISDIR(metadata.st_mode):
        fail(f"APT control directory is linked or not a directory: {path}")
    if metadata.st_mode & 0o022:
        fail(f"APT control directory is writable by an untrusted account: {path}")
    if production and (metadata.st_uid != 0 or metadata.st_gid != 0):
        fail(f"APT control directory is not root-owned: {path}")
    if expected_mode is not None and stat.S_IMODE(metadata.st_mode) != expected_mode:
        fail(f"APT control directory mode differs from policy: {path}")


def packet_length(data: bytes, offset: int, old_length_type: int | None) -> tuple[int, int]:
    if old_length_type is not None:
        widths = {0: 1, 1: 2, 2: 4}
        if old_length_type not in widths:
            fail("indeterminate-length OpenPGP packets are not approved")
        width = widths[old_length_type]
        if offset + width > len(data):
            fail("truncated OpenPGP packet length")
        return int.from_bytes(data[offset : offset + width], "big"), offset + width
    if offset >= len(data):
        fail("truncated OpenPGP packet length")
    first = data[offset]
    offset += 1
    if first < 192:
        return first, offset
    if first < 224:
        if offset >= len(data):
            fail("truncated two-octet OpenPGP length")
        return ((first - 192) << 8) + data[offset] + 192, offset + 1
    if first == 255:
        if offset + 4 > len(data):
            fail("truncated five-octet OpenPGP length")
        return int.from_bytes(data[offset : offset + 4], "big"), offset + 4
    fail("partial OpenPGP body lengths are not approved for APT keyrings")


def primary_fingerprints(data: bytes) -> set[str]:
    offset = 0
    fingerprints: list[str] = []
    while offset < len(data):
        header = data[offset]
        offset += 1
        if not header & 0x80:
            fail("malformed OpenPGP packet header")
        if header & 0x40:
            tag = header & 0x3F
            length, offset = packet_length(data, offset, None)
        else:
            tag = (header >> 2) & 0x0F
            length, offset = packet_length(data, offset, header & 0x03)
        end = offset + length
        if end > len(data):
            fail("truncated OpenPGP packet body")
        body = data[offset:end]
        offset = end
        if tag != 6:
            continue
        if not body:
            fail("empty OpenPGP public-key packet")
        if body[0] == 4:
            if len(body) > 0xFFFF:
                fail("oversized OpenPGP v4 public key")
            fingerprint = hashlib.sha1(b"\x99" + struct.pack(">H", len(body)) + body).hexdigest()
        elif body[0] in {5, 6}:
            prefix = b"\x9a" if body[0] == 5 else b"\x9b"
            fingerprint = hashlib.sha256(prefix + struct.pack(">I", len(body)) + body).hexdigest()
        else:
            fail("legacy OpenPGP public-key versions are not approved")
        fingerprints.append(fingerprint.upper())
    if not fingerprints or len(fingerprints) != len(set(fingerprints)):
        fail("APT keyring has no unique primary-key set")
    return set(fingerprints)


def active_names(
    directory: pathlib.Path,
    suffixes: tuple[str, ...],
    production: bool,
) -> set[str]:
    protected_directory(directory, production, 0o755 if production else None)
    try:
        members = list(directory.iterdir())
    except FileNotFoundError:
        fail(f"APT control directory is missing: {directory}")
    names: set[str] = set()
    for member in members:
        if member.name.endswith(suffixes):
            protected_file(member, production, 0o644 if production else None)
            names.add(member.name)
    return names


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True, type=pathlib.Path)
    parser.add_argument("--templates", required=True, type=pathlib.Path)
    parser.add_argument("--enable-esm", action="store_true")
    arguments = parser.parse_args()
    if not arguments.root.is_absolute() or not arguments.templates.is_absolute():
        fail("APT trust contract paths must be absolute")
    try:
        root = arguments.root.resolve(strict=True)
        templates = arguments.templates.resolve(strict=True)
    except FileNotFoundError:
        fail("APT trust contract root or template directory is missing")
    if root != arguments.root or templates != arguments.templates:
        fail("APT trust contract paths must not contain aliases or symbolic links")
    production = root == pathlib.Path("/")
    protected_directory(root, production)
    protected_directory(templates, False)

    template_names = BASE_SOURCE_NAMES | BASE_PREFERENCE_NAMES
    if arguments.enable_esm:
        template_names |= ESM_SOURCE_NAMES
    for name in template_names:
        expected = CANONICAL[name]
        observed = protected_file(templates / name, False).decode("utf-8")
        if observed != expected:
            fail(f"reviewed APT template differs from the canonical contract: {name}")

    apt_root = root / "etc/apt"
    legacy_sources = apt_root / "sources.list"
    if legacy_sources.exists() or legacy_sources.is_symlink():
        fail("legacy /etc/apt/sources.list must be disabled")
    sources_dir = apt_root / "sources.list.d"
    preferences_dir = apt_root / "preferences.d"
    source_names = BASE_SOURCE_NAMES | (ESM_SOURCE_NAMES if arguments.enable_esm else set())
    preference_names = BASE_PREFERENCE_NAMES
    if active_names(sources_dir, (".list", ".sources"), production) != source_names:
        fail("active APT source filenames differ from the exact managed set")
    if active_names(preferences_dir, ("",), production) != preference_names:
        fail("active APT preference filenames differ from the exact managed set")
    for name in source_names:
        if protected_file(
            sources_dir / name, production, 0o644 if production else None
        ).decode("utf-8") != CANONICAL[name]:
            fail(f"installed APT source differs from its exact template: {name}")
    for name in preference_names:
        observed_pin = protected_file(
            preferences_dir / name, production, 0o644 if production else None
        ).decode("utf-8")
        if observed_pin != CANONICAL[name]:
            fail(f"installed APT pin differs from its exact template: {name}")

    ubuntu_key = protected_file(
        apt_root / "keyrings/resume-ai-ubuntu-archive-2018.gpg",
        production,
        0o644 if production else None,
    )
    nginx_key = protected_file(
        root / "usr/share/keyrings/nginx-archive-keyring.gpg",
        production,
        0o644 if production else None,
    )
    if primary_fingerprints(ubuntu_key) != UBUNTU_FINGERPRINTS:
        fail("Ubuntu Signed-By keyring fingerprint differs from the exact 2018 archive key")
    if primary_fingerprints(nginx_key) != NGINX_FINGERPRINTS:
        fail("nginx.org Signed-By keyring primary fingerprints differ from policy")
    if arguments.enable_esm:
        esm_apps_key = protected_file(
            root / "usr/share/keyrings/ubuntu-pro-esm-apps.gpg",
            production,
            0o644 if production else None,
        )
        esm_infra_key = protected_file(
            root / "usr/share/keyrings/ubuntu-pro-esm-infra.gpg",
            production,
            0o644 if production else None,
        )
        if primary_fingerprints(esm_apps_key) != ESM_APP_FINGERPRINTS:
            fail("ESM Apps Signed-By keyring fingerprint differs from policy")
        if primary_fingerprints(esm_infra_key) != ESM_INFRA_FINGERPRINTS:
            fail("ESM Infra Signed-By keyring fingerprint differs from policy")

    print(
        "APT source files, Signed-By fingerprints, architectures and pins are exact "
        f"(ESM {'enabled' if arguments.enable_esm else 'disabled'})."
    )


if __name__ == "__main__":
    main()
