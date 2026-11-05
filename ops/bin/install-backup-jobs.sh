#!/usr/bin/env bash
set -euo pipefail
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

fail() {
  printf '%s\n' "ERROR: $*" >&2
  exit 1
}

[ "${EUID:-$(id -u)}" -eq 0 ] || fail "run as root"
[ "${ACK_INSTALL_BACKUP_JOBS:-}" = "YES" ] \
  || fail "set ACK_INSTALL_BACKUP_JOBS=YES after the pre-change database backup"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
OPS_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
. "$OPS_DIR/bin/open-root-lock.sh"
open_root_lock 9 deploy
open_root_lock 8 postgres-backup
open_root_lock 7 postgres-restore-verify

install -d -o root -g root -m 0755 /usr/local/lib/resume-ai
install -o root -g root -m 0755 "$OPS_DIR/bin/backup-postgres.sh" \
  /usr/local/lib/resume-ai/backup-postgres.sh
install -o root -g root -m 0755 "$OPS_DIR/bin/verify-postgres-restore.sh" \
  /usr/local/lib/resume-ai/verify-postgres-restore.sh
install -o root -g root -m 0755 "$OPS_DIR/bin/inspect-postgres-backups.py" \
  /usr/local/lib/resume-ai/inspect-postgres-backups.py
install -o root -g root -m 0755 "$OPS_DIR/bin/select-postgres-retention.py" \
  /usr/local/lib/resume-ai/select-postgres-retention.py
install -o root -g root -m 0755 "$OPS_DIR/bin/assert-postgres-restore-evidence.py" \
  /usr/local/lib/resume-ai/assert-postgres-restore-evidence.py
install -o root -g root -m 0755 "$OPS_DIR/bin/assert-postgres-ops-runtime.sh" \
  /usr/local/lib/resume-ai/assert-postgres-ops-runtime.sh
install -o root -g root -m 0755 "$OPS_DIR/bin/enable-postgres-checksums.sh" \
  /usr/local/lib/resume-ai/enable-postgres-checksums.sh
install -o root -g root -m 0755 "$OPS_DIR/bin/assert-postgres-security-version.sh" \
  /usr/local/lib/resume-ai/assert-postgres-security-version.sh
install -o root -g root -m 0755 "$OPS_DIR/bin/read-backup-config.sh" \
  /usr/local/lib/resume-ai/read-backup-config.sh
install -o root -g root -m 0755 "$OPS_DIR/bin/open-root-lock.sh" \
  /usr/local/lib/resume-ai/open-root-lock.sh
install -d -o root -g root -m 0700 /run/resume-ai-locks
install -o root -g root -m 0644 "$OPS_DIR/postgresql/restore-required-tables.txt" \
  /etc/resume-ai/restore-required-tables.txt
install -o root -g root -m 0644 "$OPS_DIR/config/approved-postgres-runtime.conf" \
  /etc/resume-ai/approved-postgres-runtime.conf

if [ ! -e /etc/resume-ai/backup.env ] && [ ! -L /etc/resume-ai/backup.env ]; then
  install -o root -g root -m 0600 "$OPS_DIR/postgresql/backup.env.example" \
    /etc/resume-ai/backup.env
else
  /usr/local/lib/resume-ai/read-backup-config.sh validate /etc/resume-ai/backup.env
fi

for unit in \
  resume-ai-postgres-backup.service \
  resume-ai-postgres-backup.timer \
  resume-ai-postgres-restore-verify.service \
  resume-ai-postgres-restore-verify.timer \
  resume-ai-postgres-ops-alert@.service; do
  install -o root -g root -m 0644 "$OPS_DIR/systemd/$unit" "/etc/systemd/system/$unit"
done
systemd-analyze verify \
  /etc/systemd/system/resume-ai-postgres-backup.service \
  /etc/systemd/system/resume-ai-postgres-backup.timer \
  /etc/systemd/system/resume-ai-postgres-restore-verify.service \
  /etc/systemd/system/resume-ai-postgres-restore-verify.timer \
  /etc/systemd/system/resume-ai-postgres-ops-alert@.service
systemctl daemon-reload
systemctl enable resume-ai-postgres-backup.timer resume-ai-postgres-restore-verify.timer
flock -u 7
exec 7>&-
flock -u 8
exec 8>&-
flock -u 9
exec 9>&-
systemctl start resume-ai-postgres-backup.timer resume-ai-postgres-restore-verify.timer
/usr/local/lib/resume-ai/assert-postgres-ops-runtime.sh "$OPS_DIR" units
systemctl start resume-ai-postgres-backup.service
systemctl is-active --quiet resume-ai-postgres-backup.timer
systemctl is-active --quiet resume-ai-postgres-restore-verify.timer
printf '%s\n' "Backup timers installed and the first daily backup completed; restore evidence remains fail-closed until checksums are enabled."
