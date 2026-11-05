#!/usr/bin/env bash
set -Eeuo pipefail

scan_mode=full
case "${1:-}" in
  --source-tree) scan_mode=source-tree; shift ;;
  --full) shift ;;
  --*) printf '%s\n' "ERROR: unsupported secret-scan mode: $1" >&2; exit 1 ;;
esac
[ "$#" -ge 1 ] || { printf '%s\n' "ERROR: provide at least one file or directory" >&2; exit 1; }
/usr/bin/python3 -I - "$scan_mode" "$@" <<'PY'
from __future__ import annotations

import mmap
import os
import pathlib
import re
import stat
import sys
import zlib


source_mode = sys.argv[1] == "source-tree"
excluded_root_parts = {".git", "node_modules", ".next", "artifacts", "coverage", "playwright-report", "test-results", "tmp"}
# Source contains a small, reviewed set of exact synthetic values needed by
# tests and the isolated build.  Evidence scanning has no exceptions.  In
# particular, a real credential is never excused merely because it contains a
# substring such as "test", "example" or "invalid".
source_placeholder_values = frozenset({
    b"build-only-consent-salt-00000000000000000000000000000000",
    b"build-only-signing-secret-000000000000000000000000000000",
    b"build-only-log-secret-000000000000000000000000000000000",
    b"deployment-test-db-password",
    b"deployment-test-key",
    b"deployment-test-consent-salt-000000000000",
    b"deployment-test-signing-secret-0000000000",
    b"deployment-test-log-secret-0000000000000000",
    b"deployment-test-service-role-key-00000000",
    b"e2e-competition-signing-secret-at-least-thirty-two-characters",
    b"synthetic-key-that-must-not-be-used",
    b"REDACTED",
})
private_key_prefix = rb"-----BEGIN "
private_material = (
    re.compile(private_key_prefix + rb"[A-Z0-9 ]*PRIVATE KEY-----"),
)
provider_tokens = (
    re.compile(rb"\bsk-[A-Za-z0-9_-]{24,}\b"),
    re.compile(rb"\bgh[opusr]_[A-Za-z0-9]{30,}\b"),
    re.compile(rb"\bxox[baprs]-[A-Za-z0-9-]{20,}\b"),
    re.compile(rb"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(rb"\bAKID[0-9A-Za-z]{13,}\b"),
)
named_secret = re.compile(
    rb"(?:^|[\r\n])[ \t]*(?:export[ \t]+)?[\"']?"
    rb"(?:AI_API_KEY|AI_CONVERSATION_SIGNING_SECRET|AI_CONSENT_SALT|"
    rb"LOG_HASH_SECRET|RATE_LIMIT_HASH_SALT|SUPABASE_SERVICE_ROLE_KEY|"
    rb"AWS_SECRET_ACCESS_KEY|TENCENTCLOUD_SECRET_KEY|SECRET_KEY|PASSWORD|TOKEN)"
    rb"[\"']?[ \t]*(?:=|:)[ \t]*[\"']?([^\r\n\"' \t,}]{16,})",
    re.I,
)
postgres_credential = re.compile(
    rb"postgres(?:ql)?://[A-Za-z0-9_.%+-]+:([^@/\s]{8,})@[A-Za-z0-9_.:[\]%-]+",
    re.I,
)
reviewed_postgres_placeholder = b"postgresql://saitu:" + b"password@localhost:5432"
reviewed_postgres_placeholder_context = b"# e.g. " + reviewed_postgres_placeholder + b"/saitu"
reviewed_postgres_placeholder_paths = frozenset({
    ".env.example",
    "ops/bin/scan-release-secrets.sh",
    "tests/deployment/release-evidence.test.ts",
})
git_base85_alphabet = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+-;<=>?@^_`{|}~"
git_base85_values = {value: index for index, value in enumerate(git_base85_alphabet)}
binary_literal_ceiling = 128 * 1024 * 1024


def iter_files(argument: pathlib.Path):
    metadata = argument.lstat()
    if stat.S_ISLNK(metadata.st_mode):
        raise SystemExit(f"ERROR: secret-scan input is a symlink: {argument}")
    if stat.S_ISREG(metadata.st_mode):
        yield argument
        return
    if not stat.S_ISDIR(metadata.st_mode):
        raise SystemExit(f"ERROR: secret-scan input is not a regular file or directory: {argument}")
    for current, directories, files in os.walk(argument, followlinks=False):
        retained_directories = []
        for name in directories:
            path = pathlib.Path(current) / name
            metadata = path.lstat()
            if stat.S_ISLNK(metadata.st_mode):
                if source_mode:
                    continue
                raise SystemExit(f"ERROR: full secret-scan encountered a symlink: {path}")
            if not stat.S_ISDIR(metadata.st_mode):
                raise SystemExit(f"ERROR: secret-scan encountered a special directory entry: {path}")
            relative = path.relative_to(argument)
            if source_mode and len(relative.parts) == 1 and (
                name in excluded_root_parts or name.startswith(".next-")
            ):
                continue
            retained_directories.append(name)
        directories[:] = retained_directories
        for name in files:
            path = pathlib.Path(current) / name
            metadata = path.lstat()
            if stat.S_ISLNK(metadata.st_mode):
                if source_mode:
                    continue
                raise SystemExit(f"ERROR: full secret-scan encountered a symlink: {path}")
            if not stat.S_ISREG(metadata.st_mode):
                raise SystemExit(f"ERROR: secret-scan encountered a special file: {path}")
            yield path


def is_reviewed_placeholder(value: bytes, relative_path: str | None, *, source: bool) -> bool:
    if source:
        return value in source_placeholder_values
    if relative_path is None:
        return False
    # A patch is evidence, so exceptions are bound to both a reviewed path and
    # an exact synthetic value. A filename containing "test" or "example" is
    # never sufficient by itself.
    placeholder_path = (
        relative_path == ".env.example"
        or relative_path == "playwright.config.ts"
        or relative_path.startswith("tests/")
        or (
            relative_path.startswith("ops/")
            and pathlib.PurePosixPath(relative_path).name.endswith(".example")
        )
    )
    return placeholder_path and value in source_placeholder_values


def contains_secret(buffer, relative_path: str | None = None, *, source: bool = False) -> bool:
    if any(pattern.search(buffer) for pattern in private_material):
        return True
    for pattern in provider_tokens:
        for match in pattern.finditer(buffer):
            if not is_reviewed_placeholder(match.group(0), relative_path, source=source):
                return True
    for pattern in (named_secret, postgres_credential):
        for match in pattern.finditer(buffer):
            if (
                pattern is postgres_credential
                and relative_path in reviewed_postgres_placeholder_paths
                and match.group(0) == reviewed_postgres_placeholder
                and buffer.find(reviewed_postgres_placeholder_context) >= 0
            ):
                continue
            if not is_reviewed_placeholder(match.group(1), relative_path, source=source):
                return True
    return False


def decode_git_binary_line(line: bytes) -> bytes:
    if not line:
        raise ValueError("empty Git binary patch line")
    marker = line[0]
    if ord("A") <= marker <= ord("Z"):
        decoded_length = marker - ord("A") + 1
    elif ord("a") <= marker <= ord("z"):
        decoded_length = marker - ord("a") + 27
    else:
        raise ValueError("invalid Git binary patch length marker")
    encoded = line[1:]
    if not encoded or len(encoded) % 5 != 0:
        raise ValueError("invalid Git binary patch base85 width")
    output = bytearray()
    for offset in range(0, len(encoded), 5):
        value = 0
        for character in encoded[offset:offset + 5]:
            digit = git_base85_values.get(character)
            if digit is None:
                raise ValueError("invalid Git binary patch base85 character")
            value = value * 85 + digit
        if value > 0xFFFFFFFF:
            raise ValueError("overflowing Git binary patch base85 group")
        output.extend(value.to_bytes(4, "big"))
    if decoded_length > len(output) or len(output) - decoded_length > 3:
        raise ValueError("invalid Git binary patch decoded length")
    return bytes(output[:decoded_length])


def inflate_git_literal(encoded_lines: list[bytes], expected_size: int) -> bytes:
    if expected_size < 0 or expected_size > binary_literal_ceiling:
        raise ValueError("Git binary patch literal exceeds size ceiling")
    compressed = b"".join(decode_git_binary_line(line) for line in encoded_lines)
    inflater = zlib.decompressobj()
    output = inflater.decompress(compressed, expected_size + 1)
    if len(output) > expected_size or inflater.unconsumed_tail:
        raise ValueError("Git binary patch literal exceeds declared size")
    output += inflater.flush()
    if (
        len(output) != expected_size
        or not inflater.eof
        or inflater.unused_data
        or inflater.unconsumed_tail
    ):
        raise ValueError("Git binary patch literal is malformed")
    return output


def contains_secret_in_binary_patches(raw: bytes) -> bool | None:
    # A non-embedded binary marker cannot be inspected from evidence alone.
    # Fail closed instead of pretending a text-hunk scan covered it.
    if re.search(rb"(?m)^Binary files .* differ\r?$", raw):
        return True
    marker = b"GIT binary patch"
    if marker not in raw:
        return None
    lines = raw.splitlines()
    markers = [index for index, line in enumerate(lines) if line == marker]
    if not markers:
        return True
    for marker_index in markers:
        chunks: list[bytes] = []
        index = marker_index + 1
        while index < len(lines) and len(chunks) < 2:
            while index < len(lines) and not lines[index]:
                index += 1
            if index >= len(lines) or lines[index].startswith(b"diff --git "):
                break
            header = re.fullmatch(rb"(literal|delta) ([0-9]+)", lines[index])
            if header is None:
                return True
            # Delta blocks require the preimage Git object and are not
            # self-contained evidence. Reject them rather than scan encoded
            # bytes that cannot reveal the reconstructed secret.
            if header.group(1) != b"literal":
                return True
            expected_size = int(header.group(2))
            index += 1
            encoded_lines: list[bytes] = []
            while index < len(lines) and lines[index] and not lines[index].startswith(b"diff --git "):
                if re.fullmatch(rb"(?:literal|delta) [0-9]+", lines[index]):
                    break
                encoded_lines.append(lines[index])
                index += 1
            if not encoded_lines:
                return True
            try:
                chunks.append(inflate_git_literal(encoded_lines, expected_size))
            except (OverflowError, ValueError, zlib.error):
                return True
        if len(chunks) != 2:
            return True
        if any(contains_secret(chunk, None, source=False) for chunk in chunks):
            return True
    return False


def diff_path(raw: bytes, prefix: bytes) -> str | None:
    if not raw.startswith(prefix):
        return None
    value = raw[len(prefix):].rstrip(b"\r\n")
    if value == b"/dev/null":
        return None
    # Release paths containing tabs/newlines are already rejected by the
    # source manifest. Quoted Git headers are not accepted as an exception,
    # which safely disables placeholder allowances for that hunk.
    if value.startswith(b'"') or b"\t" in value:
        return None
    try:
        decoded = value.decode("utf-8")
    except UnicodeDecodeError:
        return None
    path = pathlib.PurePosixPath(decoded)
    if path.is_absolute() or ".." in path.parts:
        return None
    return path.as_posix()


def contains_secret_in_unified_diff(raw: bytes) -> bool | None:
    binary_result = contains_secret_in_binary_patches(raw)
    if binary_result is True:
        return True
    if b"diff --git " not in raw or b"@@ " not in raw:
        return binary_result
    old_path: str | None = None
    new_path: str | None = None
    in_hunk = False
    payloads: dict[str | None, bytearray] = {}
    for line in raw.splitlines(keepends=True):
        if line.startswith(b"diff --git "):
            old_path = None
            new_path = None
            in_hunk = False
            continue
        parsed_old = diff_path(line, b"--- a/")
        if parsed_old is not None or line.startswith(b"--- /dev/null"):
            old_path = parsed_old
            continue
        parsed_new = diff_path(line, b"+++ b/")
        if parsed_new is not None or line.startswith(b"+++ /dev/null"):
            new_path = parsed_new
            continue
        if line.startswith(b"@@ "):
            in_hunk = True
            continue
        if line.startswith(b"\\ No newline at end of file"):
            continue
        if not in_hunk or not line[:1] in {b"+", b"-", b" "}:
            continue
        relative = old_path if line.startswith(b"-") else new_path
        payloads.setdefault(relative, bytearray()).extend(line[1:])
    if not payloads:
        return binary_result
    return any(
        contains_secret(bytes(payload), relative, source=False)
        for relative, payload in payloads.items()
    )


violations: list[str] = []
for raw in sys.argv[2:]:
    argument = pathlib.Path(raw)
    if not argument.exists():
        raise SystemExit(f"ERROR: secret-scan input is missing: {argument}")
    for path in iter_files(argument):
        relative_path = None
        if source_mode:
            if argument.is_dir():
                relative_path = path.relative_to(argument).as_posix()
            else:
                try:
                    relative_path = path.absolute().relative_to(pathlib.Path.cwd()).as_posix()
                except ValueError:
                    relative_path = path.name
        try:
            with path.open("rb") as source:
                if os.fstat(source.fileno()).st_size == 0:
                    continue
                with mmap.mmap(source.fileno(), 0, access=mmap.ACCESS_READ) as data:
                    # Only the named release patch is interpreted as a diff.
                    # Treating arbitrary JSON/log text that happens to contain
                    # `diff --git` and `@@` as a patch could hide secrets outside
                    # the fake hunk payload.
                    diff_result = (
                        contains_secret_in_unified_diff(data[:])
                        if not source_mode and path.name.endswith(".patch")
                        else None
                    )
                    if (
                        diff_result is True
                        or (
                            diff_result is None
                            and contains_secret(data, relative_path, source=source_mode)
                        )
                    ):
                        violations.append(str(path))
        except (OSError, ValueError) as error:
            raise SystemExit(f"ERROR: cannot completely scan {path}: {error}") from error

if violations:
    print("ERROR: possible production secret found in release evidence:", file=sys.stderr)
    for path in sorted(set(violations)):
        print(path, file=sys.stderr)
    raise SystemExit(1)
PY
