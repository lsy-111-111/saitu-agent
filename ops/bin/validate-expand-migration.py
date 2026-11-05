#!/usr/bin/env python3
"""Fail-closed static gate for deliberately simple automatic canary migrations."""

from __future__ import annotations

import pathlib
import re
import sys

ALLOWED_PREFIXES = (
    re.compile(r"^create table if not exists ([a-z][a-z0-9_]*)\s*\(", re.I),
    re.compile(r"^create (?:unique )?index if not exists ([a-z][a-z0-9_]*)\s+on\s+([a-z][a-z0-9_]*)\s*\(", re.I),
    re.compile(r"^comment\s+on\s+(?:table|column|index)\s+[a-z][a-z0-9_.]*\s+is\s+'(?:''|[^'])*'$", re.I),
)
REVIEWED_PUBLIC_REVOKES = {
    f"revoke all on table {table} from public"
    for table in {
        "ai_model_daily_usage",
        "competition_rate_limit_counters",
        "competition_session_starts",
        "competition_sessions",
        "competition_session_transitions",
        "competition_idempotency",
        "ai_model_call_leases",
        "ai_model_call_waiters",
    }
}
DENIED_TOKENS = {
    "alter", "attach", "call", "copy", "createextension", "delete", "detach",
    "do", "drop", "execute", "extension", "function", "insert", "load", "merge",
    "prepare", "procedure", "reassign", "refresh", "reset", "rule", "security",
    "select", "set", "trigger", "truncate", "update", "vacuum", "view",
}
ALLOWED_CALLS = {
    "check", "decimal", "in", "key", "now", "numeric", "octet_length", "or",
    "primary", "time", "timestamp", "unique", "varchar",
}


def statements(source: str) -> list[str]:
    if "\x00" in source or "\r" in source or "/*" in source or "*/" in source or re.search(r"\$[A-Za-z_0-9]*\$", source):
        raise ValueError("NUL, CRLF, block comments, and dollar quoting are forbidden")
    output: list[str] = []
    current: list[str] = []
    quote = False
    index = 0
    while index < len(source):
        character = source[index]
        if not quote and character == "-" and source[index:index + 2] == "--":
            newline = source.find("\n", index)
            index = len(source) if newline < 0 else newline
            continue
        if character == "'":
            current.append(character)
            if quote and source[index:index + 2] == "''":
                current.append("'")
                index += 2
                continue
            quote = not quote
            index += 1
            continue
        if not quote and character == ";":
            value = " ".join("".join(current).split())
            if value:
                output.append(value)
            current = []
        else:
            current.append(character)
        index += 1
    if quote:
        raise ValueError("unterminated SQL string")
    tail = " ".join("".join(current).split())
    if tail:
        raise ValueError("every migration statement must end with a semicolon")
    return output


def unquoted(statement: str) -> str:
    return re.sub(r"'(?:''|[^'])*'", "''", statement)


def validate(path: pathlib.Path) -> None:
    if not path.is_file() or path.is_symlink() or path.stat().st_size > 1024 * 1024:
        raise ValueError("migration must be a small ordinary file")
    source = path.read_text(encoding="utf-8")
    if re.search(r"(?m)^\s*\\", source):
        raise ValueError("psql meta-commands are forbidden in automatic migrations")
    parsed = statements(source)
    if not parsed:
        raise ValueError("migration has no SQL statements")
    for statement in parsed:
        plain = unquoted(statement)
        normalized = plain.lower()
        token_source = re.sub(r"\bon\s+delete\s+(?:cascade|restrict|set\s+null|no\s+action)\b", "", plain, flags=re.I)
        compact_tokens = {token.lower() for token in re.findall(r"[A-Za-z_][A-Za-z0-9_]*", token_source)}
        denied = DENIED_TOKENS & compact_tokens
        if normalized in REVIEWED_PUBLIC_REVOKES:
            continue
        if normalized.startswith(("grant ", "revoke ")):
            raise ValueError("only the byte-frozen PUBLIC revokes for reviewed new tables are automatic")
        allowed_match = next(
            (match for pattern in ALLOWED_PREFIXES if (match := pattern.fullmatch(statement) or pattern.match(statement))),
            None,
        )
        if not allowed_match:
            raise ValueError(f"statement is outside the automatic expand allowlist: {statement[:100]}")
        if normalized.startswith("create "):
            if denied:
                raise ValueError(f"denied token in CREATE statement: {sorted(denied)}")
            declared_names = {value.lower() for value in allowed_match.groups() if value}
            # A foreign-key target is the only non-expression identifier that
            # may legitimately be followed by parentheses in this deliberately
            # small grammar.  Treat only the identifier immediately following
            # REFERENCES as structural; arbitrary function calls remain denied.
            declared_names.update(
                value.lower()
                for value in re.findall(
                    r"\breferences\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(",
                    plain,
                    flags=re.I,
                )
            )
            calls = {value.lower() for value in re.findall(r"\b([A-Za-z_][A-Za-z0-9_]*)\s*\(", plain)}
            unexpected_calls = calls - ALLOWED_CALLS - declared_names
            if unexpected_calls:
                raise ValueError(f"unapproved function-like expression: {sorted(unexpected_calls)}")


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("usage: validate-expand-migration.py MIGRATION.sql [...]")
    for raw in sys.argv[1:]:
        path = pathlib.Path(raw)
        try:
            validate(path)
        except (OSError, UnicodeError, ValueError) as error:
            raise SystemExit(f"ERROR: {path}: {error}") from error


if __name__ == "__main__":
    main()
