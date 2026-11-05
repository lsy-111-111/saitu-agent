#!/usr/bin/env bash
set -Eeuo pipefail
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

fail() { printf '%s\n' "ERROR: $*" >&2; exit 1; }
[ "${EUID:-$(id -u)}" -eq 0 ] || fail "run as root"
[ "$#" -eq 0 ] || fail "production database verification accepts no caller paths"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
[ "$SCRIPT_DIR" = /usr/local/lib/resume-ai ] \
  || fail "production database verification must use the root-installed control"
. "$SCRIPT_DIR/open-root-lock.sh"
deploy_lock=/run/resume-ai-locks/deploy.lock
if [ -e /proc/$$/fd/9 ] \
  && [ "$(readlink /proc/$$/fd/9)" = "$deploy_lock" ] \
  && [ "$(stat -Lc '%d:%i' /proc/$$/fd/9)" = "$(stat -c '%d:%i' "$deploy_lock")" ] \
  && flock -n 9; then
  :
else
  open_root_lock 9 deploy
fi

SQL_FILE=/usr/local/share/resume-ai/verify-production-database-readonly.sql
POLICY_FILE=/usr/local/share/resume-ai/database-verification.manifest
PROVISIONER="$SCRIPT_DIR/provision-postgres-verifier-role.sh"
CONFIG_READER="$SCRIPT_DIR/read-backup-config.sh"
for trusted_file in "$SCRIPT_DIR/verify-production-database-readonly.sh" \
  "$PROVISIONER" "$CONFIG_READER"; do
  [ -f "$trusted_file" ] && [ ! -L "$trusted_file" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$trusted_file")" = root:root:755:1 ] \
    || fail "root-installed database verification control is unsafe: $trusted_file"
done
for trusted_data in "$SQL_FILE" "$POLICY_FILE"; do
  [ -f "$trusted_data" ] && [ ! -L "$trusted_data" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$trusted_data")" = root:root:444:1 ] \
    || fail "root-installed database verification data is unsafe: $trusted_data"
done

read -r expected_hash expected_name expected_identity extra < <(
  awk '!/^($|#)/ { print }' "$POLICY_FILE"
)
[ -z "${extra:-}" ] && [[ "$expected_hash" =~ ^[a-f0-9]{64}$ ]] \
  && [ "$expected_name" = verify-production-database-readonly.sql ] \
  && [ "$expected_identity" = readonly-peer-v1 ] \
  && [ "$(awk '!/^($|#)/ { count += 1 } END { print count + 0 }' "$POLICY_FILE")" -eq 1 ] \
  || fail "installed production database verification policy is malformed"
[ "$(sha256sum "$SQL_FILE" | awk '{print $1}')" = "$expected_hash" ] \
  || fail "installed production database verification SQL differs from policy"

# A second fail-closed grammar guard ensures that even an incorrectly approved
# policy cannot turn this catalog verifier into a write or server-program path.
python3 -I - "$SQL_FILE" <<'PY'
import pathlib
import re
import sys

text = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
allowed_meta = re.compile(r"^\\(?:set|gset|if|else|echo|quit|endif)(?:\s|$)")
for line in text.splitlines():
    stripped = line.lstrip()
    if stripped.startswith("\\") and allowed_meta.match(stripped) is None:
        raise SystemExit("ERROR: production database SQL contains an unapproved psql meta-command")
without_comments = re.sub(r"--[^\n]*", " ", text)
without_strings = re.sub(r"'(?:''|[^'])*'", "''", without_comments)
forbidden = re.compile(
    r"\b(?:alter|call|copy|create|delete|do|drop|execute|grant|insert|merge|"
    r"refresh|reindex|revoke|security\s+definer|truncate|update|vacuum)\b",
    re.IGNORECASE,
)
match = forbidden.search(without_strings)
if match is not None:
    raise SystemExit(f"ERROR: production database SQL contains forbidden token: {match.group(0)}")
PY

"$CONFIG_READER" validate /etc/resume-ai/backup.env
DATABASE_NAME="$("$CONFIG_READER" get DB_NAME /etc/resume-ai/backup.env)"
[[ "$DATABASE_NAME" =~ ^[a-z_][a-z0-9_]{0,62}$ ]] || fail "invalid production database name"
"$PROVISIONER" verify >/dev/null
kill_uid="$(id -u resume-ai-dbverify)"
pgrep -u "$kill_uid" >/dev/null 2>&1 && fail "database verifier has a pre-existing process"
unit="resume-ai-dbverify-$(date -u +%Y%m%dT%H%M%S)-$$.service"
systemd-run --quiet --wait --collect --pipe --service-type=exec --unit="$unit" \
  --uid=resume-ai-dbverify --gid=resume-ai-dbverify \
  --property=PrivateNetwork=yes --property=KillMode=control-group \
  --property=NoNewPrivileges=yes --property=PrivateTmp=yes --property=PrivateDevices=yes \
  --property=ProtectHome=yes --property=ProtectSystem=strict \
  --property=ProtectKernelTunables=yes --property=ProtectKernelModules=yes \
  --property=ProtectKernelLogs=yes --property=ProtectControlGroups=yes \
  --property=ProtectClock=yes --property=ProtectProc=invisible --property=ProcSubset=pid \
  --property=RestrictSUIDSGID=yes --property=RestrictNamespaces=yes \
  --property=LockPersonality=yes --property=MemoryDenyWriteExecute=yes \
  --property=CapabilityBoundingSet= --property=AmbientCapabilities= \
  --property='RestrictAddressFamilies=AF_UNIX' \
  --property='SystemCallFilter=@system-service' --property=SystemCallErrorNumber=EPERM \
  --property=UMask=0077 \
  --property='InaccessiblePaths=/var/lib/postgresql /etc/postgresql /opt/resume-ai/current /opt/resume-ai/releases' \
  --setenv=PATH=/usr/bin:/bin --setenv=PGHOST=/var/run/postgresql \
  --setenv=PGUSER=resume-ai-dbverify \
  --setenv='PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=30s -c lock_timeout=5s' \
  /usr/bin/psql --dbname="$DATABASE_NAME" --no-psqlrc --set=ON_ERROR_STOP=1 \
    --file="$SQL_FILE" >/dev/null
pgrep -u "$kill_uid" >/dev/null 2>&1 \
  && fail "database verifier retained a process after its one-shot unit"
printf '%s\n' "Fixed read-only production database catalog contract passed."
