#!/usr/bin/env python3
"""Validate one byte-frozen, manually reviewed automatic migration contract."""

from __future__ import annotations

import hashlib
import pathlib
import re
import sys

EXPECTED_NAME = "20260826_runtime_delete_functions.sql"
EXPECTED_SHA256 = "8f60e9129bb9bd3e74a2880383f05f3b8b4fd392cd74939fb9e4cf1e3463f2eb"
EXPECTED_FUNCTIONS = {
    "resume_ai_runtime_prune_competition_state": "",
    "resume_ai_runtime_delete_expired_session_start": "text",
    "resume_ai_runtime_reset_expired_session_transitions": "text",
    "resume_ai_runtime_delete_pending_transition": "text,text",
    "resume_ai_runtime_prune_model_gate": "",
    "resume_ai_runtime_delete_model_waiter": "uuid",
    "resume_ai_runtime_delete_model_lease": "uuid",
}


def fail(message: str) -> None:
    raise SystemExit(f"ERROR: {message}")


def main() -> None:
    if len(sys.argv) != 2:
        fail("usage: validate-reviewed-migration.py MIGRATION.sql")
    path = pathlib.Path(sys.argv[1])
    if path.name != EXPECTED_NAME or not path.is_file() or path.is_symlink():
        fail("migration is outside the reviewed contract")
    content = path.read_bytes()
    if hashlib.sha256(content).hexdigest() != EXPECTED_SHA256:
        fail("reviewed migration checksum mismatch")
    try:
        source = content.decode("utf-8")
    except UnicodeDecodeError as error:
        fail(f"reviewed migration is not UTF-8: {error}")

    declarations = re.findall(
        r"create\s+or\s+replace\s+function\s+public\.([a-z0-9_]+)\s*\((.*?)\)"
        r".*?language\s+plpgsql.*?security\s+definer.*?set\s+search_path\s*=\s*pg_catalog",
        source,
        flags=re.IGNORECASE | re.DOTALL,
    )
    observed: dict[str, str] = {}
    for name, arguments in declarations:
        types = []
        for argument in arguments.split(","):
            fields = argument.split()
            if fields:
                types.append(fields[-1].lower())
        signature = ",".join(types)
        if name in observed:
            fail(f"duplicate reviewed function: {name}")
        observed[name] = signature
    if observed != EXPECTED_FUNCTIONS:
        fail("reviewed function declarations differ from the fixed seven-function contract")

    revocations = re.findall(
        r"revoke\s+all\s+on\s+function\s+public\.([a-z0-9_]+)\s*\((.*?)\)\s+from\s+public\s*;",
        source,
        flags=re.IGNORECASE | re.DOTALL,
    )
    revoked = {name for name, _arguments in revocations}
    if len(revocations) != len(EXPECTED_FUNCTIONS) or revoked != set(EXPECTED_FUNCTIONS):
        fail("every reviewed function must revoke PUBLIC exactly once")


if __name__ == "__main__":
    main()
