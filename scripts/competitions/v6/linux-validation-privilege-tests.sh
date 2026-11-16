#!/usr/bin/env bash
set -Eeuo pipefail
umask 022
[ "$(uname -s)" = Linux ] || exit 2
export PATH="$HOME/saitu-validation/bin:/opt/nodejs/current/bin:$PATH"
cd "$HOME/saitu-validation/work/saitu-agent"
PG_BINDIR=/opt/postgresql/14.24/bin bash tests/deployment/postgres-ops-regression.sh
sudo env PATH=/opt/nodejs/current/bin:/usr/sbin:/usr/bin:/bin AI_API_KEY="" CI=1 /opt/nodejs/current/bin/node node_modules/vitest/vitest.mjs run tests/deployment/production-ops.test.ts tests/deployment/release-evidence-sandbox.test.ts tests/deployment/release-required-tests.test.ts --maxWorkers=1 --testNamePattern='keeps pre-checksum backups|rejects direct root execution|kills the complete transient service' --reporter=json --outputFile=/tmp/saitu-linux-root-tests.json
cat > /tmp/saitu-hostile-vitest.config.mjs <<EOF
export default {root:"$PWD",resolve:{alias:{"@":"$PWD/src","server-only":"$PWD/tests/fixtures/server-only.ts"}},test:{environment:"node",include:["tests/deployment/release-evidence-sandbox.test.ts"]}};
EOF
sudo install -d -o root -g root -m 700 /opt/resume-ai/releases /run/credentials
sudo systemd-run --quiet --wait --collect --pipe --service-type=exec --unit=saitu-hostile-evidence --property=User=jiumian --property=Group=jiumian --property=WorkingDirectory="$PWD" --property=PrivateNetwork=yes --property=ProtectSystem=strict --property=ProtectHome=read-only --property=ReadWritePaths=/tmp --property=InaccessiblePaths='/opt/resume-ai/releases /run/credentials' --setenv=AI_API_KEY= --setenv=RELEASE_EVIDENCE_SANDBOX=1 --setenv=RELEASE_EVIDENCE_EXPECTED_UID=501 --setenv=PATH=/opt/nodejs/current/bin:/usr/bin:/bin /opt/nodejs/current/bin/node node_modules/vitest/vitest.mjs run --config=/tmp/saitu-hostile-vitest.config.mjs --maxWorkers=1 --testNamePattern='proves hostile repository code' --reporter=json --outputFile=/tmp/saitu-hostile-sandbox.json
