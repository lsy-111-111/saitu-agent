#!/usr/bin/env bash
set -Eeuo pipefail

# Bash remains a portable launcher only. The environment file is parsed as
# literal data by Python and is never sourced or evaluated.
exec python3 - "$@" <<'PY'
from __future__ import annotations

import grp
import pathlib
import pwd
import re
import stat
import sys
from urllib.parse import urlsplit


def fail(message: str) -> "None":
    print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(1)


def usage() -> "None":
    fail("usage: validate-app-env.sh permissions|production|get KEY [FILE]")


arguments = sys.argv[1:]
if not arguments:
    usage()
mode = arguments[0]
if mode in {"permissions", "production"}:
    if len(arguments) > 2:
        usage()
    requested_key = ""
    env_file = arguments[1] if len(arguments) == 2 else "/etc/resume-ai/app.env"
elif mode == "get":
    if len(arguments) not in {2, 3}:
        usage()
    requested_key = arguments[1]
    env_file = arguments[2] if len(arguments) == 3 else "/etc/resume-ai/app.env"
else:
    usage()

path = pathlib.Path(env_file)
try:
    metadata = path.lstat()
except FileNotFoundError:
    fail(f"{env_file} does not exist")
if stat.S_ISLNK(metadata.st_mode):
    fail(f"{env_file} must not be a symbolic link")
if not stat.S_ISREG(metadata.st_mode):
    fail(f"{env_file} must be a regular file")
if metadata.st_nlink != 1:
    fail(f"{env_file} must have exactly one hard link")

if env_file == "/etc/resume-ai/app.env":
    try:
        owner = pwd.getpwuid(metadata.st_uid).pw_name
        group = grp.getgrgid(metadata.st_gid).gr_name
    except KeyError:
        fail(f"{env_file} has an unresolved owner or group")
    actual_mode = stat.S_IMODE(metadata.st_mode)
    if (owner, group, actual_mode) != ("root", "resume-ai", 0o640):
        fail(
            f"{env_file} must be one root:resume-ai mode 0640 file "
            f"(found {owner}:{group}:{actual_mode:o}:{metadata.st_nlink})"
        )

allowed_keys = {
    "DATABASE_URL", "AI_API_KEY", "AI_API_URL", "AI_MODELS_URL",
    "AI_CONSENT_SALT", "AI_CONVERSATION_SIGNING_SECRET", "LOG_HASH_SECRET",
    "RATE_LIMIT_HASH_SALT", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY",
    "NEXT_PUBLIC_SITE_URL", "NEXT_PUBLIC_CONTACT_EMAIL", "NEXT_PUBLIC_ICP_LABEL",
    "NEXT_PUBLIC_POLICE_CODE", "NEXT_PUBLIC_POLICE_LABEL", "FEATURE_AI",
    "FEATURE_COMPETITION_RECOMMENDER", "AI_PROVIDER", "AI_MODEL",
    "AI_COMPETITION_NORMALIZE_MODEL", "AI_COMPETITION_CLARIFY_MODEL",
    "AI_COMPETITION_RECOMMEND_MODEL", "AI_TIMEOUT_MS",
    "AI_RETRY_MAX_DELAY_MS", "AI_VERIFY_TIMEOUT_MS",
    "AI_CLARIFY_SCHEMA_DIAGNOSTICS", "AI_RANK_SCHEMA_DIAGNOSTICS",
    "AI_TEST_MODE", "ALLOW_AI_MOCK", "NEXT_PUBLIC_AI_TEST_MODE",
}
key_pattern = re.compile(r"[A-Z][A-Z0-9_]*\Z", re.ASCII)
values: dict[str, str] = {}
try:
    raw = path.read_bytes()
except OSError as error:
    fail(f"cannot read {env_file}: {error}")
if b"\x00" in raw:
    fail(f"NUL is not accepted in {env_file}")
try:
    text = raw.decode("utf-8")
except UnicodeDecodeError:
    fail(f"{env_file} must be valid UTF-8")

for line_number, raw_line in enumerate(text.splitlines(keepends=True), start=1):
    if raw_line.endswith("\r\n") or "\r" in raw_line:
        fail(f"CRLF is not accepted at {env_file}:{line_number}")
    line = raw_line.removesuffix("\n")
    if not line or line.startswith("#"):
        continue
    if "=" not in line:
        fail(f"expected KEY=VALUE at {env_file}:{line_number}")
    key, value = line.split("=", 1)
    if not key_pattern.fullmatch(key):
        fail(f"invalid key at {env_file}:{line_number}")
    if key not in allowed_keys:
        fail(f"unapproved application environment key {key} in {env_file}")
    if key in values:
        fail(f"duplicate key {key} in {env_file}")
    values[key] = value


def require_nonempty(key: str) -> str:
    value = values.get(key, "")
    if not value:
        fail(f"{key} must be populated in {env_file}")
    return value


def require_minimum_length(key: str, minimum: int) -> str:
    value = require_nonempty(key)
    if len(value) < minimum:
        fail(f"{key} must contain at least {minimum} characters")
    return value


def require_integer_range(key: str, minimum: int, maximum: int) -> int:
    value = require_nonempty(key)
    if not re.fullmatch(r"[0-9]+", value, re.ASCII):
        fail(f"{key} must be an integer")
    numeric = int(value)
    if not minimum <= numeric <= maximum:
        fail(f"{key} must be between {minimum} and {maximum}")
    return numeric


if mode == "production":
    if urlsplit(require_nonempty("DATABASE_URL")).scheme not in {"postgresql", "postgres"}:
        fail("DATABASE_URL must use PostgreSQL")
    require_minimum_length("AI_CONSENT_SALT", 32)
    require_minimum_length("AI_CONVERSATION_SIGNING_SECRET", 32)
    require_minimum_length("LOG_HASH_SECRET", 32)
    if require_nonempty("NEXT_PUBLIC_SITE_URL") != "https://siyuanjiaxin.com":
        fail("NEXT_PUBLIC_SITE_URL must match the canonical production origin")
    if require_nonempty("NEXT_PUBLIC_CONTACT_EMAIL") != "privacy@siyuanjiaxin.com":
        fail("NEXT_PUBLIC_CONTACT_EMAIL must preserve the established security contact")

    supabase_url = values.get("SUPABASE_URL", "")
    supabase_key = values.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if bool(supabase_url) != bool(supabase_key):
        fail(
            "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured together"
        )
    if supabase_url:
        parsed_supabase = urlsplit(supabase_url)
        try:
            port = parsed_supabase.port
        except ValueError:
            fail("SUPABASE_URL contains an invalid port")
        hostname = (parsed_supabase.hostname or "").lower()
        canonical_origins = {f"https://{hostname}", f"https://{hostname}/"}
        if (
            supabase_url != supabase_url.strip()
            or
            supabase_url not in canonical_origins
            or
            parsed_supabase.scheme != "https"
            or not hostname.endswith(".supabase.co")
            or hostname == "supabase.co"
            or parsed_supabase.username is not None
            or parsed_supabase.password is not None
            or port is not None
            or parsed_supabase.path not in {"", "/"}
            or parsed_supabase.query
            or parsed_supabase.fragment
        ):
            fail(
                "SUPABASE_URL must be an approved HTTPS Supabase project origin "
                "without credentials, port, path, query or fragment"
            )
        require_minimum_length("SUPABASE_SERVICE_ROLE_KEY", 32)

    require_integer_range("AI_TIMEOUT_MS", 1_000, 120_000)
    require_integer_range("AI_RETRY_MAX_DELAY_MS", 0, 60_000)
    if values.get("AI_VERIFY_TIMEOUT_MS", ""):
        require_integer_range("AI_VERIFY_TIMEOUT_MS", 1_000, 300_000)

    feature_ai = values.get("FEATURE_AI", "1")
    if feature_ai == "1":
        ai_key = require_minimum_length("AI_API_KEY", 16)
        if not re.fullmatch(r"[A-Za-z0-9._-]+", ai_key, re.ASCII):
            fail("AI_API_KEY contains characters unsafe for the isolated verifier environment")
    elif feature_ai != "0":
        fail("FEATURE_AI must be 0 or 1")

    model_keys = (
        "AI_PROVIDER", "AI_MODEL", "AI_COMPETITION_NORMALIZE_MODEL",
        "AI_COMPETITION_CLARIFY_MODEL", "AI_COMPETITION_RECOMMEND_MODEL",
    )
    for key in model_keys:
        value = require_nonempty(key)
        if not re.fullmatch(r"[A-Za-z0-9._:/-]+", value, re.ASCII):
            fail(f"{key} contains unsupported characters")
    if values["AI_PROVIDER"] != "deepseek":
        fail("AI_PROVIDER must be deepseek in production")
    if values.get("AI_API_URL", "") not in {"", "https://api.deepseek.com/chat/completions"}:
        fail("AI_API_URL must be empty or the exact reviewed DeepSeek chat endpoint")
    if values.get("AI_MODELS_URL", "") not in {"", "https://api.deepseek.com/models"}:
        fail("AI_MODELS_URL must be empty or the exact reviewed DeepSeek models endpoint")
    if values.get("FEATURE_COMPETITION_RECOMMENDER", "") not in {"0", "1"}:
        fail("FEATURE_COMPETITION_RECOMMENDER must be 0 or 1")
    if values.get("AI_TEST_MODE", "") != "0":
        fail("AI_TEST_MODE must be 0 in production")
    if values.get("ALLOW_AI_MOCK", "") != "0":
        fail("ALLOW_AI_MOCK must be 0 in production")
    if values.get("NEXT_PUBLIC_AI_TEST_MODE", "") != "0":
        fail("NEXT_PUBLIC_AI_TEST_MODE must be 0 in production")

    # Production PM2 receives these values from the separately generated,
    # root-owned quota environment. Validate that companion file here without
    # allowing a duplicate override in app.env.
    if env_file == "/etc/resume-ai/app.env":
        quota_path = pathlib.Path("/etc/resume-ai/quota.env")
        try:
            quota_metadata = quota_path.lstat()
        except FileNotFoundError:
            fail("/etc/resume-ai/quota.env does not exist")
        try:
            quota_owner = pwd.getpwuid(quota_metadata.st_uid).pw_name
            quota_group = grp.getgrgid(quota_metadata.st_gid).gr_name
        except KeyError:
            fail("/etc/resume-ai/quota.env has an unresolved owner or group")
        if (
            not stat.S_ISREG(quota_metadata.st_mode)
            or stat.S_ISLNK(quota_metadata.st_mode)
            or quota_metadata.st_nlink != 1
            or (quota_owner, quota_group, stat.S_IMODE(quota_metadata.st_mode))
                != ("root", "resume-ai", 0o640)
        ):
            fail("/etc/resume-ai/quota.env must be one root:resume-ai mode 0640 file")
        quota_values: dict[str, str] = {}
        for line_number, line in enumerate(
            quota_path.read_text(encoding="utf-8").splitlines(), start=1
        ):
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                fail(f"invalid quota environment at line {line_number}")
            quota_key, quota_value = line.split("=", 1)
            if not key_pattern.fullmatch(quota_key) or quota_key in quota_values:
                fail(f"invalid or duplicate quota key at line {line_number}")
            quota_values[quota_key] = quota_value
        expected_deadlines = {
            "AI_REQUEST_DEADLINE_MS": 45_000,
            "AI_PRODUCER_DEADLINE_MS": 50_000,
            "IDEMPOTENCY_FINALIZE_DEADLINE_MS": 60_000,
            "IDEMPOTENCY_DUPLICATE_WAIT_MS": 62_000,
            "APP_RESPONSE_DEADLINE_MS": 65_000,
        }
        observed_deadlines = []
        for quota_key, expected_value in expected_deadlines.items():
            if quota_values.get(quota_key) != str(expected_value):
                fail(f"{quota_key} differs from the reviewed production deadline")
            observed_deadlines.append(expected_value)
        if observed_deadlines != sorted(set(observed_deadlines)):
            fail("production deadline layers are not strictly increasing")
        if observed_deadlines[-1] > 65_000:
            fail("application response deadline lacks ten seconds of proxy headroom")

if mode == "get":
    if not key_pattern.fullmatch(requested_key):
        fail("invalid requested key")
    if requested_key not in values:
        fail(f"{requested_key} is absent from {env_file}")
    sys.stdout.write(values[requested_key])
PY
