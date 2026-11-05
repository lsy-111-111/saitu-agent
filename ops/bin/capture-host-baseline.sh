#!/usr/bin/env bash
set -euo pipefail
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

fail() {
  printf '%s\n' "ERROR: $*" >&2
  exit 1
}

fsync_tree() {
  local tree=$1 member
  while IFS= read -r -d '' member; do sync -f "$member"; done \
    < <(find "$tree" -xdev -type f -print0)
  while IFS= read -r -d '' member; do sync -f "$member"; done \
    < <(find "$tree" -xdev -depth -type d -print0)
}

[ "${EUID:-$(id -u)}" -eq 0 ] || fail "run as root"
[ "${ACK_CAPTURE_HOST_BASELINE:-}" = "YES" ] || fail "explicit baseline acknowledgement is required"
[ "$#" -eq 0 ] || fail "host baseline capture accepts no arguments"
BOOTSTRAP_COPIER=/usr/local/lib/resume-ai/create-bootstrap-generation.py
SELF_PATH="$(readlink -e -- "${BASH_SOURCE[0]}")" \
  || fail "baseline control path cannot be resolved"
[[ "$SELF_PATH" =~ ^(/var/lib/resume-ai/bootstrap-generations/generation-([a-f0-9]{64}))/ops/bin/capture-host-baseline\.sh$ ]] \
  || fail "baseline capture must execute from the independently pinned bootstrap generation"
BOOTSTRAP_GENERATION=${BASH_REMATCH[1]}
BOOTSTRAP_MANIFEST_SHA256=${BASH_REMATCH[2]}
[ -f "$BOOTSTRAP_COPIER" ] && [ ! -L "$BOOTSTRAP_COPIER" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$BOOTSTRAP_COPIER")" = root:root:555:1 ] \
  || fail "fixed bootstrap generation verifier is missing or unsafe"
bootstrap_identity="$(/usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin \
  /usr/bin/python3 -I "$BOOTSTRAP_COPIER" verify \
  "$BOOTSTRAP_GENERATION" "$BOOTSTRAP_MANIFEST_SHA256")" \
  || fail "bootstrap generation failed its fixed verifier"
IFS=$'\t' read -r verified_generation verified_manifest BOOTSTRAP_STARTED_AT \
  verified_copier <<< "$bootstrap_identity"
[ "$verified_generation:$verified_manifest" \
    = "$BOOTSTRAP_GENERATION:$BOOTSTRAP_MANIFEST_SHA256" ] \
  && [[ "$BOOTSTRAP_STARTED_AT" =~ ^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] \
  && [[ "$verified_copier" =~ ^[a-f0-9]{64}$ ]] \
  || fail "bootstrap verifier returned a malformed identity"
SCRIPT_DIR="$BOOTSTRAP_GENERATION/ops/bin"
SOURCE_DIR="${SOURCE_DIR:-/opt/resume-ai/current}"
case "$SOURCE_DIR" in /*) ;; *) fail "SOURCE_DIR must be absolute" ;; esac
SOURCE_DIR="$(readlink -e "$SOURCE_DIR")" || fail "source directory cannot be resolved"
[ -d "$SOURCE_DIR" ] && [ ! -L "$SOURCE_DIR" ] || fail "source directory is missing or unsafe"
SOURCE_DEVICE="$(stat -c '%d' "$SOURCE_DIR")"
SOURCE_INODE="$(stat -c '%i' "$SOURCE_DIR")"
[[ "$SOURCE_DEVICE:$SOURCE_INODE" =~ ^[0-9]+:[1-9][0-9]*$ ]] \
  || fail "source directory identity is invalid"

INITIAL_SNAPSHOT_RELEASE_ID=${INITIAL_SNAPSHOT_RELEASE_ID:-}
case "$INITIAL_SNAPSHOT_RELEASE_ID" in
  20??????T??????Z) ;;
  *) fail "INITIAL_SNAPSHOT_RELEASE_ID must bind the reviewed legacy release" ;;
esac
INITIAL_SNAPSHOT_EVIDENCE=${INITIAL_SNAPSHOT_EVIDENCE:-}
[ "$INITIAL_SNAPSHOT_EVIDENCE" \
    = "/var/lib/resume-ai/security/cloud-snapshots/$INITIAL_SNAPSHOT_RELEASE_ID.initial-rollback.env" ] \
  || fail "INITIAL_SNAPSHOT_EVIDENCE must use the fixed release/purpose basename"
SNAPSHOT_HELPER="$SCRIPT_DIR/record-cloud-snapshot-evidence.py"
[ -f "$SNAPSHOT_HELPER" ] && [ ! -L "$SNAPSHOT_HELPER" ] \
  || fail "bootstrap snapshot verifier is missing"
snapshot_identity="$(/usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin \
  /usr/bin/python3 -I "$SNAPSHOT_HELPER" --verify-initial-pre-bootstrap \
  "$INITIAL_SNAPSHOT_EVIDENCE" "$INITIAL_SNAPSHOT_RELEASE_ID")" \
  || fail "initial rollback snapshot does not predate the bootstrap boundary"
IFS=$'\t' read -r INITIAL_SNAPSHOT_EVIDENCE_SHA256 INITIAL_SNAPSHOT_ID \
  INITIAL_SNAPSHOT_RESPONSE_SHA256 INITIAL_DISKS_RESPONSE_SHA256 \
  INITIAL_SNAPSHOT_CAPTURED_AT snapshot_bootstrap_manifest <<< "$snapshot_identity"
[[ "$INITIAL_SNAPSHOT_EVIDENCE_SHA256:$INITIAL_SNAPSHOT_RESPONSE_SHA256:$INITIAL_DISKS_RESPONSE_SHA256" \
    =~ ^[a-f0-9]{64}:[a-f0-9]{64}:[a-f0-9]{64}$ ]] \
  && [[ "$INITIAL_SNAPSHOT_ID" =~ ^lhsnap-[A-Za-z0-9]{6,80}$ ]] \
  && [ "$snapshot_bootstrap_manifest" = "$BOOTSTRAP_MANIFEST_SHA256" ] \
  || fail "initial snapshot verifier returned a malformed or cross-generation identity"
BASELINE_STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
[[ "$BASELINE_STARTED_AT" =~ ^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] \
  || fail "cannot capture the host baseline start time"

BASELINE_ROOT=/var/backups/resume-ai/prechange
BASELINE_ID="$(date -u +%Y%m%dT%H%M%SZ)"
BASELINE_DIR="$BASELINE_ROOT/$BASELINE_ID"
[ ! -e "$BASELINE_DIR" ] || fail "baseline already exists"
umask 077
install -d -o root -g root -m 0700 "$BASELINE_DIR"

SOURCE_SNAPSHOT_ROOT="$(mktemp -d "$BASELINE_ROOT/.source-snapshot.XXXXXX")"
cleanup_source_snapshot() {
  local exit_status=$?
  trap - EXIT
  if [[ "$SOURCE_SNAPSHOT_ROOT" == /var/backups/resume-ai/prechange/.source-snapshot.* ]] \
    && [ -d "$SOURCE_SNAPSHOT_ROOT" ] && [ ! -L "$SOURCE_SNAPSHOT_ROOT" ]; then
    find "$SOURCE_SNAPSHOT_ROOT" -xdev -depth -delete >/dev/null 2>&1 || true
  fi
  exit "$exit_status"
}
trap cleanup_source_snapshot EXIT
"$SCRIPT_DIR/snapshot-legacy-release.py" "$SOURCE_DIR" "$SOURCE_SNAPSHOT_ROOT" \
  "$SOURCE_DEVICE" "$SOURCE_INODE"
SNAPSHOT_SOURCE="$SOURCE_SNAPSHOT_ROOT/source"
[ -d "$SNAPSHOT_SOURCE" ] && [ ! -L "$SNAPSHOT_SOURCE" ] \
  || fail "stable source baseline snapshot was not created"

"$SCRIPT_DIR/backup-postgres.sh" predeploy \
  > "$BASELINE_DIR/postgres-backup.txt"
uname -a > "$BASELINE_DIR/uname.txt"
uptime > "$BASELINE_DIR/uptime.txt"
df -h > "$BASELINE_DIR/filesystems.txt"
free -h > "$BASELINE_DIR/memory.txt"
dpkg-query -W -f='${binary:Package}\t${Version}\n' | sort > "$BASELINE_DIR/packages.tsv"
systemctl list-unit-files --state=enabled --no-pager > "$BASELINE_DIR/enabled-units.txt"
systemctl --failed --no-pager > "$BASELINE_DIR/failed-units.txt" || true
ss -lntup > "$BASELINE_DIR/listening-sockets.txt"
nginx -T > "$BASELINE_DIR/nginx-effective.txt" 2>&1
sshd -T > "$BASELINE_DIR/sshd-effective.txt"

if id resume-ai >/dev/null 2>&1; then
  runuser -u resume-ai -- env -i HOME=/var/lib/resume-ai PM2_HOME=/var/lib/resume-ai/.pm2 \
    PATH=/opt/nodejs/current/bin:/usr/bin:/bin /opt/nodejs/current/bin/pm2 list --no-color \
    > "$BASELINE_DIR/pm2-list.txt" 2>&1 || true
elif id ubuntu >/dev/null 2>&1; then
  runuser -u ubuntu -- env -i HOME=/home/ubuntu PM2_HOME=/home/ubuntu/.pm2 \
    PATH=/usr/bin:/bin /usr/bin/pm2 list --no-color \
    > "$BASELINE_DIR/pm2-list.txt" 2>&1 || true
fi

for required_config in /etc/nginx /etc/ssh/sshd_config; do
  [ -e "$required_config" ] && [ ! -L "$required_config" ] \
    || fail "required host configuration is missing or unsafe: $required_config"
done
config_members=(etc/nginx etc/ssh/sshd_config)
for optional_config in \
  etc/ssh/sshd_config.d \
  etc/systemd/system/resume-ai-pm2.service; do
  if [ -e "/$optional_config" ]; then
    [ ! -L "/$optional_config" ] || fail "host configuration is an unsafe symlink: /$optional_config"
    config_members+=("$optional_config")
  fi
done
tar -C / -czf "$BASELINE_DIR/system-config.tar.gz" "${config_members[@]}"

(
  cd "$SNAPSHOT_SOURCE"
  find . -type f \
    ! -path './node_modules/*' \
    ! -path './.next*/*' \
    ! -path './artifacts/*' \
    ! -path './.git/*' \
    ! -name '.env*' \
    ! -name '*.pem' \
    ! -name '*.key' \
    ! -name '*secret*' \
    ! -name '*credential*' \
    ! -name '*密钥*' \
    -print0 | sort -z | xargs -0 sha256sum
) > "$BASELINE_DIR/source-SHA256SUMS"
"$SCRIPT_DIR/create-immutable-tree-manifest.py" "$SNAPSHOT_SOURCE" \
  > "$BASELINE_DIR/legacy-runtime.manifest.jsonl"

cat > "$BASELINE_DIR/bootstrap-boundary.env" <<EOF
SCHEMA_VERSION=1
BOOTSTRAP_GENERATION=$BOOTSTRAP_GENERATION
BOOTSTRAP_MANIFEST_SHA256=$BOOTSTRAP_MANIFEST_SHA256
BOOTSTRAP_STARTED_AT=$BOOTSTRAP_STARTED_AT
BASELINE_STARTED_AT=$BASELINE_STARTED_AT
INITIAL_SNAPSHOT_RELEASE_ID=$INITIAL_SNAPSHOT_RELEASE_ID
INITIAL_SNAPSHOT_EVIDENCE=$INITIAL_SNAPSHOT_EVIDENCE
INITIAL_SNAPSHOT_ID=$INITIAL_SNAPSHOT_ID
INITIAL_SNAPSHOT_EVIDENCE_SHA256=$INITIAL_SNAPSHOT_EVIDENCE_SHA256
INITIAL_SNAPSHOT_RESPONSE_SHA256=$INITIAL_SNAPSHOT_RESPONSE_SHA256
INITIAL_DISKS_RESPONSE_SHA256=$INITIAL_DISKS_RESPONSE_SHA256
INITIAL_SNAPSHOT_CAPTURED_AT=$INITIAL_SNAPSHOT_CAPTURED_AT
EOF

(
  cd "$BASELINE_DIR"
  find . -maxdepth 1 -type f ! -name SHA256SUMS -print0 \
    | sort -z | xargs -0 sha256sum > SHA256SUMS
  sha256sum -c SHA256SUMS >/dev/null
)
chmod 0600 "$BASELINE_DIR"/*
fsync_tree "$BASELINE_DIR"
sync -f "$BASELINE_ROOT"
printf '%s\n' "$BASELINE_DIR"
