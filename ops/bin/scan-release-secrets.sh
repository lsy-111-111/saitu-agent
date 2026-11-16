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
import hashlib
import base64
import binascii
import os
import pathlib
import re
import stat
import sys
import zlib


source_mode = sys.argv[1] == "source-tree"
excluded_root_parts = {".git", "node_modules", ".next", "artifacts", "coverage", "playwright-report", "test-results", "tmp"}
# Source contains a small, reviewed set of exact synthetic values needed by
# tests and the isolated build. Raw evidence has no exceptions; normalized
# patches allow only exact values at reviewed member paths. A real credential
# is never excused merely because it contains "test", "example" or "invalid".
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
# Existing public constants in the coordinator's isolated build environment.
# These are path-bound in source and patch modes and exempt named assignments
# only; provider tokens, PostgreSQL credentials and private keys still reject.
release_evidence_placeholder_path = "scripts/run-release-evidence.mjs"
release_evidence_placeholder_values = frozenset({
    b"synthetic-release-evidence-consent-salt-000000000000000000",
    b"synthetic-release-evidence-signing-secret-0000000000000000",
    b"synthetic-release-evidence-log-secret-0000000000000000000",
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


# Reviewed source syntax and public fixture literals only. Each capability is
# bound to its exact path, detector category, token bytes AND complete code
# line. Digests avoid repeating credential-shaped fixture data in this scanner.
# The maximum occurrence count prevents an appended copy from acquiring the
# original line's exception. Raw logs/binary evidence have no source path.
reviewed_source_line_fingerprints = {
    # code_header_format_assertion
    ('ops/bin/install-runtime-layout.sh', 'private_material',
     '3021d90eb9437b2d8f30e8363695c4418b5e5f1870801b5c317e9398ee0f572d', '8356256256fdf91f9ea1b8f00ca5cb55956b03e4a6120b3e2f6845dee1c41feb'): 1,
    # code_header_format_assertion
    ('ops/bin/install-runtime-layout.sh', 'private_material',
     '3021d90eb9437b2d8f30e8363695c4418b5e5f1870801b5c317e9398ee0f572d', '41b59e83045fa5cad756f1a82cda7bcce59f51ddac9106d82c19e934288ed63d'): 1,
    # shell_command_reference
    ('ops/bin/install-runtime-layout.sh', 'named_secret',
     'cdeff5fa18fe97c0bba016cee76bea3b60534e7cd401806b987ed6b622899996', '826dfd53e0590a96c11305498f731dcb45108019c1de0523d12340851645d80b'): 1,
    # explicit_provisioning_placeholder
    ('ops/config/ai-spend-ledger.pg_service.example.conf', 'named_secret',
     'f7c0e70cedaab0deeb8acca6c76e7d7c70a27176bc715c97130c5eef797fbea0', '4f6e256aa11380b8b5a2692f7f1fec4b8ef44cfcea586a229110eaa239bece5d'): 1,
    # synthetic_javascript_url_template
    ('tests/competitions/v6/sealed-execution-artifacts.test.mjs', 'postgres_credential',
     'edf696994b298f535bc4919f5bc31dfac4487db8bbeaedbba09f5b0a52c34a69', 'aaf07d5ca51060179a39cc200c00546ee605c8d4df210788dbb22ae4dc11020c'): 1,
    # fixed_synthetic_test_literal
    ('tests/competitions/v7/backend-review.integration.test.ts', 'named_secret',
     'b0c698f805ccd5f7da5ad9f752d1c6adb6bf1fa2146b472a4f8b74604d984172', 'e4af866054699367756435c65408ee99a6de0703d370aba7063f5687ad8a7dd4'): 1,
    # code_header_format_assertion
    ('tests/deployment/runtime-layout-bootstrap.test.ts', 'private_material',
     '3021d90eb9437b2d8f30e8363695c4418b5e5f1870801b5c317e9398ee0f572d', '368d300b996c5d7cd70de8f6ba28a54f2d32065ad4e9037592141a20e17006d7'): 1,
    # fixed_synthetic_test_literal
    ('tests/e2e/fixtures/v7-backend-server.mjs', 'named_secret',
     '2fd34319ebc1865842b4c5d639d4023ab36354ee0d7423073881aed7ba8dc310', '3b3bec10783aca4ecdb5bf268636be531cf4e8fd9663e88c4891ae815bf7d7a7'): 1,
    # fixed_synthetic_test_literal
    ('tests/helpers/v7-production-environment.mjs', 'named_secret',
     '7bc003b6c5bdcb0a1040f12ca9f9ff15860e7b057f6863c6eca73504bc0ed1dc', '1c2d8b3eaf51284cb9497425c7d5b71a80f7689b78e535f7ad6605e04a8d47ef'): 1,
    # fixed_synthetic_test_literal
    ('tests/helpers/v7-production-environment.mjs', 'named_secret',
     'd81609ce154678e8d85aa2f5657bb6697328fd4d5000249bd8481bcc13a0987f', '37ee7f789e36b8992d784fa95edc29fd112b96fb0f7f1946a8ac243da24833ff'): 1,
    # fixed_synthetic_test_literal
    ('tests/helpers/v7-production-environment.mjs', 'named_secret',
     '926bdd4bf445ce979dbba80f99650a6bd281e621abed14ffec9d2686df559389', '8d0a1cabdec3102c4a46cc10bf9a96df8fd78a76e824b1c307210caa3b15d288'): 1,
    # code_identifier_reference
    ('tests/security/competition-shared-state-postgres.integration.test.ts', 'named_secret',
     'a2b0c93069bd4c04aa2a7200899034737680b57e7f3d8aab16398142963f932b', 'c4a410575d66ed6c5cce3073d3bc9f9982dbf323704f9c7f7f4504122e8fb8b6'): 1,
    # code_identifier_reference
    ('tests/security/competition-shared-state-postgres.integration.test.ts', 'named_secret',
     '8597469e881a04d2b46d0903e53f4f81630e4d959bdc04891a506f5da5d40dd7', '0b74622a603249816db40571e58e3145432d3067ca1cb4e8911ec0867debab79'): 1,
    # code_identifier_reference
    ('tests/security/competition-shared-state-postgres.integration.test.ts', 'named_secret',
     'e066bb9a1e09b702907e617718e527a8c942291a8f6044ac21f1b5dc1fdb31e1', '885eb38f63e5584216ffa623f833bd9d65249c008fb9bcf38c4edf7149ebc42f'): 1,
    # code_identifier_reference
    ('tests/security/competition-shared-state-postgres.integration.test.ts', 'named_secret',
     '235b0a8ac674e705ad022b97f60ed80d02f278a94da6c837e04785c2ad55742e', 'e723fc0d67da331c1733731d3d4f5a6552f9555a223ee007d1c1c4c90fc8dfa5'): 1,
}
reviewed_source_line_paths = frozenset(key[0] for key in reviewed_source_line_fingerprints)

# Source-syntax exceptions never apply to material beside those lines. An end
# marker is independently suspicious, and recoverable private DER/OpenSSH
# payloads remain suspicious even when their public PEM markers are absent.
private_footer = re.compile(rb"-----END " + rb"[A-Z0-9 ]*PRIVATE KEY-----")
asn1_length_pattern = (rb"(?:[\x00-\x80]|\x81[\x00-\xff]|\x82[\x00-\xff]{2}|"
                       rb"\x83[\x00-\xff]{3}|\x84[\x00-\xff]{4})")
private_binary_roots = re.compile(
    rb"\x30" + asn1_length_pattern
    + rb"(?:\x02" + asn1_length_pattern + rb"[\x00\x01]|\x30" + asn1_length_pattern + rb"\x06)"
)
private_ssh_magic = b"openssh-key-v1\x00"
key_base64_tokens = re.compile(rb"[A-Za-z0-9+/_-]+={0,2}")
key_hex_tokens = re.compile(rb"(?<![0-9a-fA-F])[0-9a-fA-F]{32,}(?![0-9a-fA-F])")
key_fragment_separator = re.compile(rb"""[ \t\r\n]*(?:["'\x60][ \t\r\n]*(?:[,+][ \t\r\n]*)?["'\x60]?[ \t\r\n]*)?""")
encoded_line_break = re.compile(rb"(?<!\\)\\+(?:r\\+n|r|n)")
encoded_material_byte = re.compile(rb"\\u00([0-9a-fA-F]{2})|\\x([0-9a-fA-F]{2})")


class PrivateMaterialLimit(Exception):
    pass


def der_cache_key(data, offset, limit, depth, kind):
    namespace, shift = id(data), 0
    if isinstance(data, PrivateMaterialView):
        namespace = data.cache_namespace
        if offset >= data.prefix_length:
            namespace = id(data.suffix)
            shift = data.suffix_start - data.prefix_length
    return (kind, namespace, offset + shift, limit + shift, depth), shift


def der_header(data, offset, limit, depth=0, cache=None):
    if offset + 2 > limit:
        return None
    if depth >= 32:
        raise PrivateMaterialLimit("ASN.1 nesting limit")
    if cache is None:
        cache = {}
    key, shift = der_cache_key(data, offset, limit, depth, "header")
    if key in cache:
        result = cache[key]
        return None if result is None else (result[0], *(value - shift for value in result[1:]))
    tag, length = data[offset], data[offset + 1]
    start = offset + 2
    if length == 0x80:
        if not tag & 0x20:
            return None
        # BER indefinite constructed forms can be accepted by key parsers too.
        # Cache the end reached from each child boundary as well as the header.
        # Public objects can share a long suffix hidden inside primitive values;
        # visiting that same BER tail for each apparent root would be quadratic.
        position, visited, ending = start, [], None
        while position + 2 <= limit:
            tail_key, tail_shift = der_cache_key(data, position, limit, depth, "tail")
            if tail_key in cache:
                cached = cache[tail_key]
                ending = None if cached is None else tuple(value - tail_shift for value in cached)
                break
            visited.append((tail_key, tail_shift))
            if data[position:position + 2] == b"\x00\x00":
                ending = (position, position + 2)
                break
            child = der_header(data, position, limit, depth + 1, cache)
            if not child or child[3] > limit:
                break
            position = child[3]
        for tail_key, tail_shift in visited:
            cache[tail_key] = None if ending is None else tuple(value + tail_shift for value in ending)
        result = None if ending is None else (tag, start, *ending)
        cache[key] = None if result is None else (tag, *(value + shift for value in result[1:]))
        return result
    if length & 0x80:
        count = length & 0x7f
        if not 1 <= count <= 4 or start + count > limit:
            return None
        # Nonminimal definite BER lengths must not bypass private detection.
        length = int.from_bytes(data[start:start + count], "big")
        start += count
    result = tag, start, start + length, start + length
    cache[key] = tag, *(value + shift for value in result[1:])
    return result


def private_der_at(data, offset=0, cache=None):
    if cache is None:
        cache = {}
    outer = der_header(data, offset, len(data), cache=cache)
    if not outer or outer[0] != 0x30 or outer[3] > len(data):
        return False
    children, position = [], outer[1]
    while position < outer[2]:
        child = der_header(data, position, outer[2], cache=cache)
        if not child or child[2] > outer[2] or len(children) >= 16:
            return False
        children.append(child)
        position = child[3]
    if not children:
        return False

    def version(value):
        return value[0] == 0x02 and 0 < value[2] - value[1] <= 8 and int.from_bytes(data[value[1]:value[2]], "big") in (0, 1)

    def algorithm_oid(value):
        if value[0] != 0x30:
            return None
        oid = der_header(data, value[1], value[2], cache=cache)
        if not oid or oid[0] != 0x06 or not oid[1] < oid[2] <= value[2]:
            return None
        return oid[1], oid[2]

    # PKCS#8 / OneAsymmetricKey: version, algorithm identifier, private octets.
    if (3 <= len(children) <= 5 and version(children[0])
            and algorithm_oid(children[1]) is not None
            and children[2][0] in (0x04, 0x24) and children[2][2] > children[2][1]
            and all(child[0] in (0xa0, 0xa1, 0x81) for child in children[3:])):
        return True
    # PKCS#1 RSA and traditional DSA private structures contain the private
    # integer fields, unlike their public two-integer / SubjectPublicKeyInfo forms.
    if (len(children) in (6, 9, 10) and version(children[0])
            and all(child[0] == 0x02 and child[2] > child[1] for child in children[:9])
            and (len(children) != 10 or children[9][0] == 0x30)):
        return True
    # SEC1 ECPrivateKey.
    if (2 <= len(children) <= 4 and version(children[0])
            and int.from_bytes(data[children[0][1]:children[0][2]], "big") == 1
            and children[1][0] in (0x04, 0x24) and children[1][2] > children[1][1]
            and all(child[0] in (0xa0, 0xa1) for child in children[2:])):
        return True
    # EncryptedPrivateKeyInfo. Restrict to password-encryption OID families;
    # generic AlgorithmIdentifier + OCTET STRING also describes public DigestInfo.
    if len(children) == 2 and children[1][0] in (0x04, 0x24) and children[1][2] > children[1][1]:
        oid = algorithm_oid(children[0])
        if oid:
            # Only these OID prefixes and the final arc byte are inspected.
            # An attacker-controlled OID length must not copy a shared tail.
            prefix = bytes(data[oid[0]:min(oid[1], oid[0] + 9)])
            if (
                (prefix.startswith(bytes.fromhex("2a864886f70d0105"))
                 and data[oid[1] - 1] in (1, 3, 4, 6, 10, 11, 13))
                or prefix.startswith(bytes.fromhex("2a864886f70d010c01"))
            ):
                return True
    return False


def private_ssh_at(data, offset=0):
    if data[offset:offset + len(private_ssh_magic)] != private_ssh_magic:
        return False
    position = offset + len(private_ssh_magic)

    def field(at):
        if at + 4 > len(data):
            return None
        end = at + 4 + int.from_bytes(data[at:at + 4], "big")
        return end if end <= len(data) else None

    for _ in range(3):  # cipher, KDF name, KDF options
        position = field(position)
        if position is None:
            return False
    if position + 4 > len(data):
        return False
    count = int.from_bytes(data[position:position + 4], "big")
    if not 1 <= count <= 16:
        return False
    position += 4
    for _ in range(count):
        position = field(position)
        if position is None:
            return False
    end = field(position)
    return end is not None and end - position >= 12


def contains_private_binary(data, *, prefix_length=None, encoded=False, cache=None):
    # A joined view shares its long suffix with other candidates. Only roots
    # starting in its short prefix need another check; suffix roots are scanned
    # once in the shared decoded block. Sixteen bytes cover either root marker.
    if cache is None:
        cache = {}
    probe = data if prefix_length is None else data[:prefix_length + 16]
    for match in private_binary_roots.finditer(probe):
        if prefix_length is not None and match.start() >= prefix_length:
            break
        if encoded:
            header = der_header(data, match.start(), len(data), cache=cache)
            if header and header[3] - match.start() > binary_literal_ceiling:
                raise PrivateMaterialLimit("ASN.1 object size limit")
        if private_der_at(data, match.start(), cache):
            return True
    position = probe.find(private_ssh_magic)
    while position >= 0:
        if prefix_length is not None and position >= prefix_length:
            break
        if private_ssh_at(data, position):
            return True
        position = probe.find(private_ssh_magic, position + 1)
    return False


def decode_key_base64(encoded):
    if len(encoded) % 4 == 1:
        return None
    try:
        return base64.b64decode(
            encoded + b"=" * (-len(encoded) % 4), altchars=b"-_", validate=True
        )
    except (ValueError, binascii.Error):
        return None


class PrivateMaterialView:
    """A decoded bootstrap and a shared suffix, without copying that suffix."""

    def __init__(self, prefix, suffix, suffix_start):
        self.prefix, self.suffix, self.suffix_start = prefix, suffix, suffix_start
        self.prefix_length = len(prefix)
        self.length = len(prefix) + len(suffix) - suffix_start
        self.cache_namespace = object()

    def __len__(self):
        return self.length

    def __getitem__(self, key):
        if isinstance(key, slice):
            start, end, step = key.indices(self.length)
            if step != 1:
                raise ValueError("unsupported private-material view stride")
            if end <= start:
                return b""
            if end <= self.prefix_length:
                return self.prefix[start:end]
            suffix_start = self.suffix_start + max(0, start - self.prefix_length)
            suffix_end = self.suffix_start + end - self.prefix_length
            if start >= self.prefix_length:
                return self.suffix[suffix_start:suffix_end]
            return self.prefix[start:] + self.suffix[suffix_start:suffix_end]
        if key < 0:
            key += self.length
        if not 0 <= key < self.length:
            raise IndexError("private-material view index")
        if key < self.prefix_length:
            return self.prefix[key]
        return self.suffix[self.suffix_start + key - self.prefix_length]


def contains_private_base64_segment(pieces):
    encoded = b"".join(pieces).rstrip(b"=")
    if len(encoded) > binary_literal_ceiling * 4 // 3 + 8:
        raise PrivateMaterialLimit("encoded material size limit")
    # A key can begin at any fragment, so cover all four base64 phases once.
    # An incomplete trailing character cannot erase an already complete object.
    for phase in range(min(4, len(encoded))):
        tail = encoded[phase:]
        if len(tail) % 4 == 1:
            tail = tail[:-1]
        decoded = decode_key_base64(tail)
        if decoded and contains_private_binary(decoded, encoded=True):
            return True
    return False


def contains_private_base64_run(pieces):
    candidates = [index for index, piece in enumerate(pieces) if piece[:1] in (b"M", b"b")]
    if not candidates:
        return False
    segment_start = 0
    for index, piece in enumerate(pieces):
        if piece.endswith(b"="):
            if contains_private_base64_segment(pieces[segment_start:index + 1]):
                return True
            segment_start = index + 1
    if segment_start < len(pieces) and contains_private_base64_segment(pieces[segment_start:]):
        return True

    # Independently padded pieces form a second representation. Decode each
    # fragment once into shared blocks, breaking at an undecodable fragment.
    blocks, locations = [bytearray()], []
    for piece in pieces:
        decoded = decode_key_base64(piece)
        if decoded is None:
            locations.append(None)
            if blocks[-1]:
                blocks.append(bytearray())
            continue
        block = blocks[-1]
        if len(block) + len(decoded) > binary_literal_ceiling:
            raise PrivateMaterialLimit("decoded material size limit")
        locations.append((len(blocks) - 1, len(block)))
        block.extend(decoded)
    block_caches = [{} for _ in blocks]
    if any(contains_private_binary(block, encoded=True, cache=cache) for block, cache in zip(blocks, block_caches) if block):
        return True

    # Preserve the existing short/odd-fold bootstrap before individually
    # decoded pieces. Each bootstrap consumes fewer than 32 initial characters
    # plus one fragment; shared suffixes are inspected through a zero-copy view.
    for index in candidates:
        end, length = index + 1, len(pieces[index])
        while length < 32 and not pieces[end - 1].endswith(b"=") and end < len(pieces):
            length += len(pieces[end])
            end += 1
        if end >= len(pieces) or locations[end] is None:
            continue
        bootstrap = decode_key_base64(b"".join(pieces[index:end]))
        if not bootstrap:
            continue
        block_index, suffix_start = locations[end]
        view = PrivateMaterialView(bootstrap, blocks[block_index], suffix_start)
        if contains_private_binary(view, prefix_length=len(bootstrap), encoded=True, cache=block_caches[block_index]):
            return True
    return False


def contains_private_base64(data):
    position = 0
    while True:
        fragment = key_base64_tokens.search(data, position)
        if not fragment:
            return False
        pieces = []
        while True:
            pieces.append(bytes(data[fragment.start():fragment.end()]))
            position = fragment.end()
            separator = key_fragment_separator.match(data, position)
            fragment = key_base64_tokens.match(data, separator.end())
            if not fragment or fragment.start() == position:
                break
        if contains_private_base64_run(pieces):
            return True


def contains_private_body(buffer):
    if contains_private_binary(buffer):
        return True
    # Exact capabilities still hash original bytes. This view only recognizes
    # escaped or quoted line folds of recoverable material, independently of path.
    data = buffer
    if buffer.find(b"\\") >= 0:
        data = encoded_material_byte.sub(lambda match: bytes([int(match.group(1) or match.group(2), 16)]), buffer)
        data = encoded_line_break.sub(b"\n", data)
        if private_footer.search(data) or contains_private_binary(data):
            return True
    if contains_private_base64(data):
        return True
    for match in key_hex_tokens.finditer(data):
        if data[match.start():match.start() + 2] not in (b"30", b"6f", b"6F"):
            continue
        encoded = bytes(data[match.start():match.end()])
        if len(encoded) % 2:
            continue
        decoded = bytes.fromhex(encoded.decode("ascii"))
        if contains_private_binary(decoded):
            return True
    return False


def is_reviewed_source_line(match, relative_path, category, buffer, seen) -> bool:
    if relative_path not in reviewed_source_line_paths:
        return False
    group = 0 if category == "private_material" else 1
    anchor = match.start(group)
    line_start = buffer.rfind(b"\n", 0, anchor) + 1
    line_end = buffer.find(b"\n", anchor)
    if line_end < 0:
        line_end = len(buffer)
    key = (
        relative_path, category,
        hashlib.sha256(match.group(group)).hexdigest(),
        hashlib.sha256(buffer[line_start:line_end]).hexdigest(),
    )
    limit = reviewed_source_line_fingerprints.get(key, 0)
    if not limit:
        return False
    seen[key] = seen.get(key, 0) + 1
    return seen[key] <= limit


def contains_secret(buffer, relative_path: str | None = None, *, source: bool = False) -> bool:
    if private_footer.search(buffer):
        return True
    try:
        if contains_private_body(buffer):
            return True
    except PrivateMaterialLimit:
        return True
    seen_reviewed_lines = {}
    for pattern in private_material:
        for match in pattern.finditer(buffer):
            if not is_reviewed_source_line(match, relative_path, "private_material", buffer, seen_reviewed_lines):
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
            if (
                pattern is named_secret
                and relative_path == release_evidence_placeholder_path
                and match.group(1) in release_evidence_placeholder_values
                and buffer[match.end():match.end() + 1] in (b'"', b"'")
                and match.group(0).endswith(buffer[match.end():match.end() + 1] + match.group(1))
            ):
                continue
            if is_reviewed_placeholder(match.group(1), relative_path, source=source):
                continue
            category = "named_secret" if pattern is named_secret else "postgres_credential"
            if not is_reviewed_source_line(match, relative_path, category, buffer, seen_reviewed_lines):
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
