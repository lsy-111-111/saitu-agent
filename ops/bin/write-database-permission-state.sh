#!/usr/bin/env bash
set -Eeuo pipefail

fail() {
  printf '%s\n' "ERROR: $*" >&2
  exit 1
}

[ "${EUID:-$(id -u)}" -eq 0 ] || fail "run as root"
[ "$#" -eq 2 ] || fail "usage: write-database-permission-state.sh RELEASE_ID rpc-only|legacy-delete"
RELEASE_ID=$1
DELETE_MODE=$2
case "$RELEASE_ID" in 20??????T??????Z) ;; *) fail "invalid release id" ;; esac
case "$DELETE_MODE" in rpc-only|legacy-delete) ;; *) fail "invalid database permission mode" ;; esac

STATE_DIR=/opt/resume-ai/state
STATE_FILE="$STATE_DIR/database-permissions.env"
ARTIFACT_MANIFEST="/opt/resume-ai/release-artifacts/$RELEASE_ID/release-manifest.json"
RELEASE_ROOT="/opt/resume-ai/releases/$RELEASE_ID"
install -d -o root -g resume-ai -m 0750 "$STATE_DIR"

CONTRACT_STATUS=legacy-unbound
MIGRATIONS_MANIFEST_SHA256=none
TABLE_POLICY_SHA256=none
FUNCTION_POLICY_SHA256=none
if [ -f "$ARTIFACT_MANIFEST" ] && [ ! -L "$ARTIFACT_MANIFEST" ] \
  && [ -f "$RELEASE_ROOT/ops/config/migrations.manifest" ] \
  && [ -f "$RELEASE_ROOT/ops/postgresql/runtime-table-privileges.conf" ] \
  && [ -f "$RELEASE_ROOT/ops/postgresql/runtime-function-privileges.conf" ]; then
  readarray -t contract < <(/opt/nodejs/current/bin/node - "$ARTIFACT_MANIFEST" <<'NODE'
const fs = require("node:fs");
const value = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const contract = value?.databaseContract;
if (contract?.schemaVersion !== 1 || contract?.runtimeRequiresDirectDelete !== false) process.exit(2);
for (const key of ["migrationsManifestSha256", "runtimeTablePolicySha256", "runtimeFunctionPolicySha256"]) {
  if (!/^[a-f0-9]{64}$/u.test(contract[key] ?? "")) process.exit(3);
  console.log(contract[key]);
}
NODE
  ) || fail "release database contract is missing or malformed"
  [ "${#contract[@]}" -eq 3 ] || fail "release database contract is incomplete"
  MIGRATIONS_MANIFEST_SHA256=${contract[0]}
  TABLE_POLICY_SHA256=${contract[1]}
  FUNCTION_POLICY_SHA256=${contract[2]}
  [ "$(sha256sum "$RELEASE_ROOT/ops/config/migrations.manifest" | awk '{print $1}')" = "$MIGRATIONS_MANIFEST_SHA256" ] \
    && [ "$(sha256sum "$RELEASE_ROOT/ops/postgresql/runtime-table-privileges.conf" | awk '{print $1}')" = "$TABLE_POLICY_SHA256" ] \
    && [ "$(sha256sum "$RELEASE_ROOT/ops/postgresql/runtime-function-privileges.conf" | awk '{print $1}')" = "$FUNCTION_POLICY_SHA256" ] \
    || fail "installed release differs from its database permission contract"
  CONTRACT_STATUS=bound
fi

if [ "$DELETE_MODE" = rpc-only ]; then
  [ "$CONTRACT_STATUS" = bound ] || fail "rpc-only state requires a manifest-bound database contract"
fi

state_temp="$(mktemp "$STATE_DIR/.database-permissions.XXXXXX")"
cat > "$state_temp" <<EOF
SCHEMA_VERSION=1
ACTIVE_RELEASE=$RELEASE_ID
DELETE_MODE=$DELETE_MODE
CONTRACT_STATUS=$CONTRACT_STATUS
MIGRATIONS_MANIFEST_SHA256=$MIGRATIONS_MANIFEST_SHA256
TABLE_POLICY_SHA256=$TABLE_POLICY_SHA256
FUNCTION_POLICY_SHA256=$FUNCTION_POLICY_SHA256
UPDATED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF
chown root:resume-ai "$state_temp"
chmod 0640 "$state_temp"
mv -f -- "$state_temp" "$STATE_FILE"
sync -f "$STATE_FILE"
sync -f "$STATE_DIR"
printf '%s\n' "Recorded $DELETE_MODE database authorization for $RELEASE_ID ($CONTRACT_STATUS)."
