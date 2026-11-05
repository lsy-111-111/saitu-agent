#!/usr/bin/env python3
"""Read Linux /proc/PID/stat starttime without trusting whitespace in comm."""

from __future__ import annotations

import os
import re
import stat
import sys


def fail(message: str) -> "NoReturn":
    raise SystemExit(f"ERROR: {message}")


if len(sys.argv) != 2 or re.fullmatch(r"[1-9][0-9]*", sys.argv[1]) is None:
    fail("usage: read-proc-start-ticks.py PID")

pid = sys.argv[1]
descriptor = os.open(f"/proc/{pid}/stat", os.O_RDONLY | os.O_NOFOLLOW)
try:
    metadata = os.fstat(descriptor)
    if not stat.S_ISREG(metadata.st_mode):
        fail("process stat is not an ordinary procfs file")
    raw = os.read(descriptor, 65537)
    if len(raw) > 65536 or os.read(descriptor, 1):
        fail("process stat exceeds its safe parsing bound")
finally:
    os.close(descriptor)

try:
    value = raw.decode("ascii", errors="strict").rstrip("\n")
except UnicodeDecodeError:
    fail("process stat is not ASCII")
closing_parenthesis = value.rfind(")")
if closing_parenthesis < 3 or not value.startswith(f"{pid} ("):
    fail("process stat has a malformed pid/comm prefix")
# Field 3 (state) is the first suffix token. starttime is field 22, hence
# zero-based suffix index 19. Splitting the whole line would be unsafe because
# the parenthesized comm field may itself contain spaces or right parentheses.
suffix = value[closing_parenthesis + 1 :].strip().split()
if len(suffix) < 20 or re.fullmatch(r"[1-9][0-9]*", suffix[19]) is None:
    fail("process stat has an invalid starttime field")
print(suffix[19])
