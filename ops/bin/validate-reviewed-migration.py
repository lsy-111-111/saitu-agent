#!/usr/bin/env python3
"""Validate one byte-frozen, manually reviewed automatic migration contract."""

from __future__ import annotations

import hashlib
import pathlib
import re
import sys

EXPECTED_NAME = "20260826_runtime_delete_functions.sql"
EXPECTED_SHA256 = "8f60e9129bb9bd3e74a2880383f05f3b8b4fd392cd74939fb9e4cf1e3463f2eb"
# Exact SQL bytes reviewed in release-migration-independent-review-r2. This
# exception does not expand the grammar accepted for any other migration.
REVIEWED_MIGRATIONS = {
    EXPECTED_NAME: EXPECTED_SHA256,
    "20261105_ai_spend_ledger.sql": "81ecf009b4baaaaaac297ddaef66db17a9a029d34337bdde650fed6a20f9beab",
    "20261105_decision_states.sql": "28210fe1c757449579e5a563911eb353df107c347b500693558183c0863d426f",
    "20261105_spend_authority.sql": "03cc61ea8faba4f0cc5b130439f4e6a2ecbd7fdda4ac64b4fc02028e1b8d0987",
    "20261106_ai_spend_development_batches.sql": "197e089a877b3cc0b5583b0e58c1b5cf49e86991da766cadc621ff0cd8b2afad",
    "20261106_ai_spend_development_effort.sql": "683e4762ff439f7a807767004fd705f9657dc1b9bc60cec15fb4645cc16ae22b",
    "20261109_decision_runs.sql": "c671a8cd4f9383bc89a239aaee8fd73eba4d2f14a55d64bba51367d6e6849b43",
    "20261109_decision_runs_chat_requests.sql": "8efc9d99bb74152af1e20e7aab630c77f876470a48b37b9c5e4ba05da7c7911f",
    "20261109_spend_v7_batches.sql": "896b8797b99fe7c024002652ab37f2e74422b4824641cdec5c77a6d34b30866f",
    "20261109_spend_v7_effort_policy.sql": "9aef0b5be2ec7a529964ced14cafbb6403464e18e6bbb1eeb9bcca6db4885556",
    "20261109_spend_v7_top5_policy.sql": "d307c2d25e48b2268c90bdfa7410bcd7cbc0fb3be1f6ef6a66428420868f97de",
    "20261109_spend_user_unbounded_execution.sql": "12b97459966d6d2785dedfea6f7fe5f3649b933241c8faf56dd77357de350431",
}
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
    if path.name not in REVIEWED_MIGRATIONS or not path.is_file() or path.is_symlink():
        fail("migration is outside the reviewed contract")
    content = path.read_bytes()
    if hashlib.sha256(content).hexdigest() != REVIEWED_MIGRATIONS[path.name]:
        fail("reviewed migration checksum mismatch")
    if path.name != EXPECTED_NAME:
        return
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
