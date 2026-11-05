#!/usr/bin/env bash
set -euo pipefail

# RETIRED PRODUCTION ENTRYPOINT
#
# The former mutable, single-directory installer was deliberately removed. It
# cannot be re-enabled with an environment variable or a specially named path.
# Production releases are prepared and deployed exclusively through ops/bin/.
printf '%s\n' \
  "ERROR: deploy/setup.sh is permanently retired. Use ops/bin/prepare-release-bundle.sh and ops/bin/deploy-release.sh." >&2
exit 64
