#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' \
  "ERROR: this split installer is retired; use ops/bin/migrate-nginx-1.30.4.sh for transactional package/config migration." >&2
exit 64
