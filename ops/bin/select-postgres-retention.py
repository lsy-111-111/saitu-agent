#!/usr/bin/env python3
"""Select published PostgreSQL backups that are outside the UTC retention window."""

from __future__ import annotations

import datetime as dt
import pathlib
import re
import sys


def fail(message: str) -> "NoReturn":
    raise SystemExit(f"ERROR: {message}")


if len(sys.argv) != 4:
    fail("usage: select-postgres-retention.py TIER RETENTION TODAY_UTC")

tier = sys.argv[1]
try:
    retention = int(sys.argv[2])
except ValueError:
    fail("retention must be an integer")
if retention < 1:
    fail("retention must be positive")
try:
    today = dt.date.fromisoformat(sys.argv[3])
except ValueError:
    fail("TODAY_UTC must be an ISO calendar date")
if today.isoformat() != sys.argv[3]:
    fail("TODAY_UTC must use canonical YYYY-MM-DD form")
if tier not in {"daily", "weekly", "predeploy"}:
    fail("invalid backup tier")

rows: list[tuple[int, pathlib.PurePath, dt.date]] = []
seen_paths: set[pathlib.PurePath] = set()
previous_epoch = -1
for raw_line in sys.stdin:
    line = raw_line.removesuffix("\n")
    if not line or "\t" not in line:
        fail("backup inspector row is malformed")
    raw_epoch, raw_path = line.split("\t", 1)
    if not re.fullmatch(r"[0-9]+", raw_epoch) or not raw_path.startswith("/"):
        fail("backup inspector row is malformed")
    epoch = int(raw_epoch)
    path = pathlib.PurePath(raw_path)
    if path in seen_paths or epoch < previous_epoch:
        fail("backup inspector rows are duplicated or out of order")
    match = re.fullmatch(r"(20[0-9]{6})T[0-9]{6}Z", path.name)
    if match is None or path.parent.name != tier:
        fail("backup inspector path does not match its tier")
    try:
        backup_day = dt.datetime.strptime(match.group(1), "%Y%m%d").date()
    except ValueError:
        fail("backup identity contains an invalid UTC calendar date")
    if backup_day > today:
        fail("backup identity is in a future UTC calendar day")
    rows.append((epoch, path, backup_day))
    seen_paths.add(path)
    previous_epoch = epoch

if tier == "predeploy":
    expired = rows[:-retention] if len(rows) > retention else []
else:
    # Daily retention is expressed in inclusive UTC calendar days. Weekly
    # retention is the same invariant over seven-day UTC calendar windows.
    # Neither policy consults filesystem mtime or a rolling N-hour cutoff.
    window_days = retention if tier == "daily" else retention * 7
    oldest_kept_day = today - dt.timedelta(days=window_days - 1)
    expired = [row for row in rows if row[2] < oldest_kept_day]

for _, path, _ in expired:
    print(path)
