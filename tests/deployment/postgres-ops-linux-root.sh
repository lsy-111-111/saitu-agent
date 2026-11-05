#!/usr/bin/env bash
set -Eeuo pipefail
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

fail() {
  printf '%s\n' "ERROR: $*" >&2
  exit 1
}

[ "${EUID:-$(id -u)}" -eq 0 ] || fail "run as root"
[ "$(uname -s)" = Linux ] || fail "Linux is required"
[ -r /etc/os-release ] || fail "Ubuntu release identity is unavailable"
. /etc/os-release
[ "${ID:-}" = ubuntu ] && [ "${VERSION_ID:-}" = 22.04 ] \
  || fail "this runnable gate requires Ubuntu 22.04"
[ -d /run/systemd/system ] || fail "systemd is not the running init system"

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
ACTIVE_ROOT="$(readlink -e /opt/resume-ai/current)" \
  || fail "active release pointer cannot be resolved"
[ "$REPO_ROOT" = "$ACTIVE_ROOT" ] \
  || fail "run the Linux/root gate from the installed active physical release"

DB_NAME="$(/usr/local/lib/resume-ai/read-backup-config.sh get DB_NAME /etc/resume-ai/backup.env)"
server_contract="$(runuser -u postgres -- env -i PATH=/usr/bin:/bin \
  PGHOST=/var/run/postgresql PGUSER=postgres psql --dbname="$DB_NAME" --no-psqlrc \
  --tuples-only --no-align --command='SHOW server_version_num;')"
server_version_num=$server_contract
[[ "$server_version_num" =~ ^14[0-9]{4}$ ]] \
  || fail "the runnable gate requires PostgreSQL 14"
peer_system_id="$(runuser -u postgres -- env -i PATH=/usr/bin:/bin \
  PGHOST=/var/run/postgresql PGUSER=postgres psql --dbname="$DB_NAME" --no-psqlrc \
  --tuples-only --no-align --command="SELECT (pg_control_system()).system_identifier::text;")"
[[ "$peer_system_id" =~ ^[0-9]{10,}$ ]] || fail "PostgreSQL system identity is malformed"

bash -n \
  "$REPO_ROOT/ops/bin/backup-postgres.sh" \
  "$REPO_ROOT/ops/bin/verify-postgres-restore.sh" \
  "$REPO_ROOT/ops/bin/provision-postgres-verifier-role.sh" \
  "$REPO_ROOT/ops/bin/verify-production-database-readonly.sh" \
  "$REPO_ROOT/ops/bin/assert-postgres-ops-runtime.sh" \
  "$REPO_ROOT/ops/bin/install-backup-jobs.sh"
PYTHONDONTWRITEBYTECODE=1 python3 -m py_compile \
  "$REPO_ROOT/ops/bin/inspect-postgres-backups.py" \
  "$REPO_ROOT/ops/bin/select-postgres-retention.py" \
  "$REPO_ROOT/ops/bin/assert-postgres-restore-evidence.py"
systemd-analyze verify \
  /etc/systemd/system/resume-ai-postgres-backup.service \
  /etc/systemd/system/resume-ai-postgres-backup.timer \
  /etc/systemd/system/resume-ai-postgres-restore-verify.service \
  /etc/systemd/system/resume-ai-postgres-restore-verify.timer \
  /etc/systemd/system/resume-ai-postgres-ops-alert@.service
systemd-analyze calendar --iterations=3 '*-*-* 02:20:00 Asia/Shanghai' >/dev/null
systemd-analyze calendar --iterations=3 '*-*-01 03:30:00 Asia/Shanghai' >/dev/null
"$REPO_ROOT/ops/bin/assert-postgres-ops-runtime.sh" "$REPO_ROOT/ops" full
cmp -s "$REPO_ROOT/ops/bin/provision-postgres-verifier-role.sh" \
  /usr/local/lib/resume-ai/provision-postgres-verifier-role.sh \
  && cmp -s "$REPO_ROOT/ops/bin/verify-production-database-readonly.sh" \
    /usr/local/lib/resume-ai/verify-production-database-readonly.sh \
  && cmp -s "$REPO_ROOT/ops/postgresql/verify-production-database-readonly.sql" \
    /usr/local/share/resume-ai/verify-production-database-readonly.sql \
  && cmp -s "$REPO_ROOT/ops/config/database-verification.manifest" \
    /usr/local/share/resume-ai/database-verification.manifest \
  || fail "installed read-only database verifier differs from the active release"
/usr/local/lib/resume-ai/provision-postgres-verifier-role.sh verify >/dev/null
/usr/local/lib/resume-ai/verify-production-database-readonly.sh >/dev/null
if runuser -u resume-ai-dbverify -- env -i PATH=/usr/bin:/bin \
  PGHOST=/var/run/postgresql PGUSER=resume-ai-dbverify \
  PGOPTIONS='-c default_transaction_read_only=on' \
  psql --dbname="$DB_NAME" --no-psqlrc --set=ON_ERROR_STOP=1 \
    --command='CREATE TABLE public.resume_ai_verifier_must_not_write(id integer)' \
    >/dev/null 2>&1; then
  fail "the dedicated database verifier identity performed DDL"
fi

latest_evidence="$(find /var/backups/resume-ai/postgresql/restore-verifications \
  -maxdepth 1 -type f -name '20??????T??????Z.json' -print | sort | tail -n 1)"
[ -n "$latest_evidence" ] || fail "restore evidence is missing for negative tests"
evidence_id="$(basename "$latest_evidence" .json)"
TEST_ROOT="$(mktemp -d /run/resume-ai-postgres-negative.XXXXXX)"
cleanup() {
  local status=$?
  trap - EXIT
  case "$TEST_ROOT" in /run/resume-ai-postgres-negative.*) ;;
    *) exit "$status" ;;
  esac
  find "$TEST_ROOT" -xdev -depth -delete >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT
install -o root -g root -m 0600 /etc/resume-ai/backup.env "$TEST_ROOT/wrong-timezone.env"
python3 -I - "$TEST_ROOT/wrong-timezone.env" <<'PY'
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
rows = path.read_text(encoding="utf-8").splitlines()
matches = [index for index, row in enumerate(rows) if row.startswith("BACKUP_TIMEZONE=")]
if len(matches) != 1:
    raise SystemExit("backup timezone row is not unique")
rows[matches[0]] = "BACKUP_TIMEZONE=Etc/UTC"
path.write_text("\n".join(rows) + "\n", encoding="utf-8")
PY
if /usr/local/lib/resume-ai/read-backup-config.sh validate \
  "$TEST_ROOT/wrong-timezone.env" >/dev/null 2>&1; then
  fail "a backup timezone that diverges from the installed timer was accepted"
fi
install -o root -g root -m 0600 "$latest_evidence" "$TEST_ROOT/tampered.json"
python3 -I - "$TEST_ROOT/tampered.json" <<'PY'
import json
import pathlib
import sys
path = pathlib.Path(sys.argv[1])
value = json.loads(path.read_text(encoding="utf-8"))
value["ok"] = False
path.write_text(json.dumps(value, sort_keys=True) + "\n", encoding="utf-8")
PY
if "$REPO_ROOT/ops/bin/assert-postgres-restore-evidence.py" \
  --evidence "$TEST_ROOT/tampered.json" --expected-id "$evidence_id" \
  --daily-root /var/backups/resume-ai/postgresql/daily \
  --active-root "$ACTIVE_ROOT" --config /etc/resume-ai/backup.env \
  --database "$DB_NAME" --system-identifier "$peer_system_id" >/dev/null 2>&1; then
  fail "tampered restore success marker was accepted"
fi
install -o root -g root -m 0600 "$latest_evidence" "$TEST_ROOT/hardlinked.json"
ln "$TEST_ROOT/hardlinked.json" "$TEST_ROOT/hardlinked-second-name.json"
if "$REPO_ROOT/ops/bin/assert-postgres-restore-evidence.py" \
  --evidence "$TEST_ROOT/hardlinked.json" --expected-id "$evidence_id" \
  --daily-root /var/backups/resume-ai/postgresql/daily \
  --active-root "$ACTIVE_ROOT" --config /etc/resume-ai/backup.env \
  --database "$DB_NAME" --system-identifier "$peer_system_id" >/dev/null 2>&1; then
  fail "hard-linked restore evidence was accepted"
fi
ln -s "$latest_evidence" "$TEST_ROOT/symlink.json"
if "$REPO_ROOT/ops/bin/assert-postgres-restore-evidence.py" \
  --evidence "$TEST_ROOT/symlink.json" --expected-id "$evidence_id" \
  --daily-root /var/backups/resume-ai/postgresql/daily \
  --active-root "$ACTIVE_ROOT" --config /etc/resume-ai/backup.env \
  --database "$DB_NAME" --system-identifier "$peer_system_id" >/dev/null 2>&1; then
  fail "symlinked restore evidence was accepted"
fi
printf '%s\n' "Ubuntu 22.04/PostgreSQL 14 backup, timer and restore-evidence runtime gate passed."
trap - EXIT
cleanup
