#!/usr/bin/env bash
set -Eeuo pipefail
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

fail() {
  printf '%s\n' "ERROR: $*" >&2
  exit 1
}

[ "${EUID:-$(id -u)}" -eq 0 ] || fail "run as root"
[ "${ACK_NODE24_RUNTIME_UPGRADE:-}" = YES ] \
  || fail "set ACK_NODE24_RUNTIME_UPGRADE=YES after snapshot and rollback-package checks"
[ "$#" -eq 0 ] || fail "this installer accepts no arguments"

BOOTSTRAP_COPIER=/usr/local/lib/resume-ai/create-bootstrap-generation.py
SELF_PATH="$(readlink -e -- "${BASH_SOURCE[0]}")" \
  || fail "Node installer path cannot be resolved"
[[ "$SELF_PATH" =~ ^(/var/lib/resume-ai/bootstrap-generations/generation-([a-f0-9]{64}))/ops/bin/install-node-runtime\.sh$ ]] \
  || fail "Node installation must execute from the independently pinned bootstrap generation"
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
OPS_DIR="$BOOTSTRAP_GENERATION/ops"
. "$SCRIPT_DIR/open-root-lock.sh"

HOST_BASELINE_DIR=${HOST_BASELINE_DIR:-}
HOST_BASELINE_MANIFEST_SHA256=${HOST_BASELINE_MANIFEST_SHA256:-}
BASELINE_VERIFIER="$SCRIPT_DIR/verify-host-baseline.py"
baseline_identity="$(/usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin \
  /usr/bin/python3 -I "$BASELINE_VERIFIER" "$HOST_BASELINE_DIR" \
  "$HOST_BASELINE_MANIFEST_SHA256" "$BOOTSTRAP_GENERATION" \
  "$BOOTSTRAP_MANIFEST_SHA256")" \
  || fail "protected pre-change host baseline failed verification"
IFS=$'\t' read -r verified_baseline_manifest INITIAL_SNAPSHOT_RELEASE_ID \
  INITIAL_SNAPSHOT_EVIDENCE INITIAL_SNAPSHOT_ID INITIAL_SNAPSHOT_EVIDENCE_SHA256 \
  baseline_bootstrap_started <<< "$baseline_identity"
[ "$verified_baseline_manifest:$baseline_bootstrap_started" \
    = "$HOST_BASELINE_MANIFEST_SHA256:$BOOTSTRAP_STARTED_AT" ] \
  || fail "host baseline belongs to another bootstrap transaction"
/usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin \
  /usr/bin/python3 -I "$SCRIPT_DIR/record-cloud-snapshot-evidence.py" \
  --verify-initial-pre-bootstrap "$INITIAL_SNAPSHOT_EVIDENCE" \
  "$INITIAL_SNAPSHOT_RELEASE_ID" >/dev/null \
  || fail "host baseline initial snapshot failed its global identity gate"
POLICY="$OPS_DIR/config/approved-node-runtime.conf"
[ -f "$POLICY" ] && [ ! -L "$POLICY" ] || fail "approved Node runtime policy is missing"

declare -A policy=()
while IFS='=' read -r key value || [ -n "$key" ]; do
  case "$key" in ''|'#'*) continue ;; esac
  case "$key" in NODE_VERSION|NODE_ARCHIVE|NODE_SHA256|NODE_ORIGIN|NPM_VERSION|PM2_VERSION|PM2_TARBALL|PM2_INTEGRITY|PNPM_VERSION|PNPM_TARBALL|PNPM_INTEGRITY|RUNTIME_PACKAGE_JSON_SHA256|RUNTIME_PACKAGE_LOCK_SHA256) ;; *) fail "unknown Node runtime policy key: $key" ;; esac
  [ -z "${policy[$key]:-}" ] || fail "duplicate Node runtime policy key: $key"
  policy[$key]=$value
done < "$POLICY"

[ "${policy[NODE_VERSION]:-}" = 24.20.0 ] || fail "Node version is not the reviewed LTS patch"
[ "${policy[NODE_ARCHIVE]:-}" = node-v24.20.0-linux-x64.tar.xz ] || fail "Node archive is not approved"
[[ "${policy[NODE_SHA256]:-}" =~ ^[a-f0-9]{64}$ ]] || fail "Node checksum is malformed"
[ "${policy[NODE_ORIGIN]:-}" = https://nodejs.org/dist/v24.20.0 ] || fail "Node origin is not approved"
[ "${policy[NPM_VERSION]:-}" = 11.17.0 ] || fail "Node-bundled npm version is not approved"
[ "${policy[PM2_VERSION]:-}" = 7.0.4 ] && [ "${policy[PNPM_VERSION]:-}" = 11.19.0 ] \
  || fail "PM2/pnpm versions are not approved"
[ "${policy[PM2_TARBALL]:-}" = https://registry.npmjs.org/pm2/-/pm2-7.0.4.tgz ] \
  && [ "${policy[PNPM_TARBALL]:-}" = https://registry.npmjs.org/pnpm/-/pnpm-11.19.0.tgz ] \
  || fail "npm package origin is not approved"
[[ "${policy[PM2_INTEGRITY]:-}" == sha512-* ]] && [[ "${policy[PNPM_INTEGRITY]:-}" == sha512-* ]] \
  || fail "npm package integrity is malformed"
[[ "${policy[RUNTIME_PACKAGE_JSON_SHA256]:-}" =~ ^[a-f0-9]{64}$ ]] \
  && [[ "${policy[RUNTIME_PACKAGE_LOCK_SHA256]:-}" =~ ^[a-f0-9]{64}$ ]] \
  || fail "runtime package manifest checksums are malformed"
[ "$(uname -m)" = x86_64 ] || fail "the approved Node archive is x86_64-only"

RUNTIME_PACKAGE_JSON="$OPS_DIR/node-runtime/package.json"
RUNTIME_PACKAGE_LOCK="$OPS_DIR/node-runtime/package-lock.json"
for runtime_policy_file in "$RUNTIME_PACKAGE_JSON" "$RUNTIME_PACKAGE_LOCK"; do
  [ -f "$runtime_policy_file" ] && [ ! -L "$runtime_policy_file" ] \
    || fail "frozen runtime package policy is missing or unsafe: $runtime_policy_file"
done
[ "$(sha256sum "$RUNTIME_PACKAGE_JSON" | awk '{print $1}')" = "${policy[RUNTIME_PACKAGE_JSON_SHA256]}" ] \
  && [ "$(sha256sum "$RUNTIME_PACKAGE_LOCK" | awk '{print $1}')" = "${policy[RUNTIME_PACKAGE_LOCK_SHA256]}" ] \
  || fail "frozen runtime package policy checksum mismatch"
python3 -I - "$RUNTIME_PACKAGE_JSON" "$RUNTIME_PACKAGE_LOCK" \
  "${policy[PM2_TARBALL]}" "${policy[PM2_INTEGRITY]}" \
  "${policy[PNPM_TARBALL]}" "${policy[PNPM_INTEGRITY]}" <<'PY'
import json
import pathlib
import sys

package = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
lock = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding="utf-8"))
if package.get("dependencies") != {"pm2": "7.0.4", "pnpm": "11.19.0"}:
    raise SystemExit("runtime package.json dependency set is not exact")
if lock.get("lockfileVersion") != 3:
    raise SystemExit("runtime package lock version is not approved")
packages = lock.get("packages")
if not isinstance(packages, dict) or packages.get("", {}).get("dependencies") != package["dependencies"]:
    raise SystemExit("runtime lock root differs from package.json")
expected_roots = {
    "node_modules/pm2": ("7.0.4", sys.argv[3], sys.argv[4]),
    "node_modules/pnpm": ("11.19.0", sys.argv[5], sys.argv[6]),
}
for name, metadata in packages.items():
    if name == "":
        continue
    if not isinstance(metadata, dict) or metadata.get("link"):
        raise SystemExit(f"runtime lock contains an invalid package entry: {name}")
    resolved = metadata.get("resolved")
    integrity = metadata.get("integrity")
    if not isinstance(resolved, str) or not resolved.startswith("https://registry.npmjs.org/"):
        raise SystemExit(f"runtime package has an unapproved origin: {name}")
    if not isinstance(integrity, str) or not integrity.startswith("sha512-"):
        raise SystemExit(f"runtime package lacks SHA-512 integrity: {name}")
for name, expected in expected_roots.items():
    metadata = packages.get(name, {})
    observed = (metadata.get("version"), metadata.get("resolved"), metadata.get("integrity"))
    if observed != expected:
        raise SystemExit(f"runtime root package differs from frozen policy: {name}")
PY

for command_name in curl flock python3 sha256sum systemctl tar xz; do
  command -v "$command_name" >/dev/null 2>&1 || fail "$command_name is unavailable"
done
# Node and release transactions both mutate the current runtime pointer, PM2
# unit/dump and running process set.  Always take the shared deployment lock
# first, then the Node-specific lock, so no two durable journals can overlap.
open_root_lock 8 deploy
open_root_lock 9 node-runtime

NODE_ROOT=/opt/nodejs
FINAL_DIR="$NODE_ROOT/node-v${policy[NODE_VERSION]}-linux-x64"
CURRENT_LINK="$NODE_ROOT/current"
PENDING_FILE="$NODE_ROOT/node-runtime.pending"
LIVE_MARKER=/run/resume-ai-locks/node-runtime.live
RECOVERY_SCRIPT=/usr/local/lib/resume-ai/recover-node-runtime.sh
BACKUP_ROOT=/var/backups/resume-ai/node-runtime
BACKUP_DIR="$BACKUP_ROOT/$(date -u +%Y%m%dT%H%M%SZ)"
[ ! -e "$BACKUP_DIR" ] || fail "Node runtime backup already exists"
install -d -o root -g root -m 0755 "$NODE_ROOT"
install -d -o root -g root -m 0700 "$BACKUP_ROOT" "$BACKUP_DIR"
[ ! -e "$PENDING_FILE" ] && [ ! -L "$PENDING_FILE" ] \
  || fail "an earlier Node runtime migration requires recovery"

# Install and durably publish the recovery control plane before the first
# transaction-managed mutation.  A PM2 drop-in orders boot and normal restarts
# behind the recovery unit; the live-owner gate prevents our own restart from
# activating rollback while this exact installer process is alive.
install -d -o root -g root -m 0755 /usr/local/lib/resume-ai
install -d -o root -g root -m 0755 /etc/systemd/system/resume-ai-pm2.service.d
install_root_control() {
  local source=$1 destination=$2 mode=$3 destination_dir destination_base temporary
  destination_dir=${destination%/*}
  destination_base=${destination##*/}
  [ -f "$source" ] && [ ! -L "$source" ] \
    || fail "Node recovery control source is missing or linked: $source"
  temporary="$(mktemp "$destination_dir/.${destination_base}.resume-ai.XXXXXX")"
  install -o root -g root -m "$mode" "$source" "$temporary"
  sync -f "$temporary"
  mv -f -- "$temporary" "$destination"
  sync -f "$destination_dir"
}
install_root_control "$OPS_DIR/bin/open-root-lock.sh" \
  /usr/local/lib/resume-ai/open-root-lock.sh 0755
install_root_control "$OPS_DIR/bin/read-proc-start-ticks.py" \
  /usr/local/lib/resume-ai/read-proc-start-ticks.py 0755
install_root_control "$OPS_DIR/bin/node-runtime-recovery-gate.sh" \
  /usr/local/lib/resume-ai/node-runtime-recovery-gate.sh 0755
install_root_control "$OPS_DIR/bin/recover-node-runtime.sh" "$RECOVERY_SCRIPT" 0755
install_root_control "$OPS_DIR/bin/assert-pm2-effective-service.sh" \
  /usr/local/lib/resume-ai/assert-pm2-effective-service.sh 0755
install_root_control "$OPS_DIR/bin/verify-single-link-tree.sh" \
  /usr/local/lib/resume-ai/verify-single-link-tree.sh 0755
install_root_control "$OPS_DIR/bin/snapshot-pm2-dump.py" \
  /usr/local/lib/resume-ai/snapshot-pm2-dump.py 0755
install_root_control "$OPS_DIR/systemd/resume-ai-node-runtime-recovery.service" \
  /etc/systemd/system/resume-ai-node-runtime-recovery.service 0644
install_root_control "$OPS_DIR/systemd/resume-ai-pm2-node-recovery.conf" \
  /etc/systemd/system/resume-ai-pm2.service.d/node-runtime-recovery.conf 0644
systemctl daemon-reload

WORK_DIR="$(mktemp -d /var/tmp/resume-ai-node24.XXXXXX)"
install -d -o root -g root -m 0700 "$WORK_DIR/npm-home" "$WORK_DIR/npm-cache"
EXTRACT_ROOT="$NODE_ROOT/.extract-node-v${policy[NODE_VERSION]}.$$"
STAGING_DIR="$NODE_ROOT/.node-v${policy[NODE_VERSION]}-staging.$$"
[ ! -e "$STAGING_DIR" ] && [ ! -e "$EXTRACT_ROOT" ] || fail "Node runtime staging path already exists"
install -d -o root -g root -m 0700 "$EXTRACT_ROOT"
PREVIOUS_TARGET=none
if [ -e "$CURRENT_LINK" ] || [ -L "$CURRENT_LINK" ]; then
  [ -L "$CURRENT_LINK" ] || fail "$CURRENT_LINK must be a symbolic link before migration"
  PREVIOUS_TARGET="$(readlink "$CURRENT_LINK")"
  [[ "$PREVIOUS_TARGET" =~ ^node-v[0-9]+\.[0-9]+\.[0-9]+-linux-x64$ \
    || "$PREVIOUS_TARGET" =~ ^/opt/nodejs/node-v[0-9]+\.[0-9]+\.[0-9]+-linux-x64$ ]] \
    || fail "existing Node runtime pointer has an unsafe target"
  previous_resolved="$(readlink -f "$CURRENT_LINK")"
  [[ "$previous_resolved" =~ ^/opt/nodejs/node-v[0-9]+\.[0-9]+\.[0-9]+-linux-x64$ ]] \
    && [ -d "$previous_resolved" ] && [ ! -L "$previous_resolved" ] \
    && [ "$(stat -c '%U:%G' "$previous_resolved")" = root:root ] \
    || fail "existing Node runtime target is missing or not root-owned"
fi
UNIT_BACKUP=none
LOGROTATE_BACKUP=none
PM2_DUMP_BACKUP=none
PM2_DUMP_EXISTED=0
SERVICE_WAS_ACTIVE=0
if [ -f /etc/systemd/system/resume-ai-pm2.service ]; then
  [ ! -L /etc/systemd/system/resume-ai-pm2.service ] \
    && [ "$(stat -c '%U:%G:%h' /etc/systemd/system/resume-ai-pm2.service)" = root:root:1 ] \
    || fail "existing PM2 systemd unit is unsafe"
  cp --preserve=mode,ownership,timestamps /etc/systemd/system/resume-ai-pm2.service "$BACKUP_DIR/resume-ai-pm2.service.before"
  chmod 0600 "$BACKUP_DIR/resume-ai-pm2.service.before"
  UNIT_BACKUP="$BACKUP_DIR/resume-ai-pm2.service.before"
fi
if [ -e /etc/logrotate.d/resume-ai ] || [ -L /etc/logrotate.d/resume-ai ]; then
  [ -f /etc/logrotate.d/resume-ai ] && [ ! -L /etc/logrotate.d/resume-ai ] \
    && [ "$(stat -c '%U:%G:%h' /etc/logrotate.d/resume-ai)" = root:root:1 ] \
    || fail "existing application logrotate policy is unsafe"
  cp --preserve=mode,ownership,timestamps /etc/logrotate.d/resume-ai \
    "$BACKUP_DIR/resume-ai-logrotate.before"
  chmod 0600 "$BACKUP_DIR/resume-ai-logrotate.before"
  LOGROTATE_BACKUP="$BACKUP_DIR/resume-ai-logrotate.before"
fi
if id resume-ai >/dev/null 2>&1; then
  pm2_dump_result="$(python3 -I "$OPS_DIR/bin/snapshot-pm2-dump.py" \
    /var/lib/resume-ai/.pm2/dump.pm2 "$BACKUP_DIR/dump.pm2.before" \
    "$(id -u resume-ai)" "$(id -g resume-ai)")" \
    || fail "existing PM2 recovery dump could not be copied through a stable descriptor"
else
  [ ! -e /var/lib/resume-ai/.pm2/dump.pm2 ] \
    && [ ! -L /var/lib/resume-ai/.pm2/dump.pm2 ] \
    || fail "PM2 dump exists before the dedicated runtime account is provisioned"
  pm2_dump_result=absent
fi
case "$pm2_dump_result" in
present)
  PM2_DUMP_BACKUP="$BACKUP_DIR/dump.pm2.before"
  PM2_DUMP_EXISTED=1
  ;;
absent) ;;
*) fail "PM2 dump snapshot helper returned an invalid state" ;;
esac
if systemctl is-active --quiet resume-ai-pm2.service 2>/dev/null; then
  SERVICE_WAS_ACTIVE=1
  id resume-ai >/dev/null 2>&1 || fail "active PM2 unit has no resume-ai service account"
  [ -d /var/lib/resume-ai/.pm2 ] || fail "active PM2 unit has no protected PM2 home"
fi
dpkg-query -W -f='${Package}\t${Version}\t${Architecture}\n' nodejs \
  > "$BACKUP_DIR/system-node-package.txt" 2>/dev/null || true
command -v node > "$BACKUP_DIR/system-node-path.txt" 2>/dev/null || true
command -v pm2 > "$BACKUP_DIR/system-pm2-path.txt" 2>/dev/null || true
if command -v node >/dev/null 2>&1; then node --version > "$BACKUP_DIR/system-node-version.txt" 2>&1 || true; fi
if command -v pm2 >/dev/null 2>&1; then pm2 --version > "$BACKUP_DIR/system-pm2-version.txt" 2>&1 || true; fi

JOURNAL_WRITTEN=0

cleanup_node_staging() {
  [ ! -e "$STAGING_DIR" ] || find "$STAGING_DIR" -depth -delete >/dev/null 2>&1 || true
  [ ! -e "$EXTRACT_ROOT" ] || find "$EXTRACT_ROOT" -depth -delete >/dev/null 2>&1 || true
  [ ! -e "$WORK_DIR" ] || find "$WORK_DIR" -depth -delete >/dev/null 2>&1 || true
}

rollback() {
  local exit_status=$?
  trap - ERR EXIT
  set +e
  if [ "$JOURNAL_WRITTEN" -eq 1 ]; then
    if [ -f "$LIVE_MARKER" ] && [ ! -L "$LIVE_MARKER" ]; then unlink "$LIVE_MARKER"; fi
    sync -f /run/resume-ai-locks >/dev/null 2>&1 || true
    flock -u 9 >/dev/null 2>&1 || true
    flock -u 8 >/dev/null 2>&1 || true
    if "$RECOVERY_SCRIPT" >/dev/null 2>&1; then
      JOURNAL_WRITTEN=0
      printf '%s\n' "Node runtime migration failed; durable recovery restored the previous pointer and PM2 controls." >&2
    else
      printf '%s\n' "Node runtime migration failed and automatic recovery did not complete; the journal was retained for boot recovery." >&2
      cleanup_node_staging
      exit 70
    fi
  else
    printf '%s\n' "Node runtime preparation failed before any managed runtime mutation." >&2
  fi
  cleanup_node_staging
  exit "$exit_status"
}
trap rollback ERR EXIT

fsync_tree() {
  local tree=$1 member
  while IFS= read -r -d '' member; do sync -f "$member"; done \
    < <(find "$tree" -xdev -type f -print0)
  while IFS= read -r -d '' member; do sync -f "$member"; done \
    < <(find "$tree" -xdev -depth -type d -print0)
}

write_node_journal() {
  local phase=$1 journal_temp
  journal_temp="$(mktemp "$NODE_ROOT/.node-runtime.pending.XXXXXX")"
  cat > "$journal_temp" <<EOF
KIND=node-runtime
PHASE=$phase
BACKUP_DIR=$BACKUP_DIR
PREVIOUS_TARGET=$PREVIOUS_TARGET
FINAL_DIR=$FINAL_DIR
UNIT_BACKUP=$UNIT_BACKUP
LOGROTATE_BACKUP=$LOGROTATE_BACKUP
PM2_DUMP_BACKUP=$PM2_DUMP_BACKUP
PM2_DUMP_EXISTED=$PM2_DUMP_EXISTED
SERVICE_WAS_ACTIVE=$SERVICE_WAS_ACTIVE
EOF
  chown root:root "$journal_temp"
  chmod 0600 "$journal_temp"
  mv -f -- "$journal_temp" "$PENDING_FILE"
  sync -f "$PENDING_FILE"
  sync -f "$NODE_ROOT"
}

install_live_marker() {
  local start_time marker_temp
  start_time="$(/usr/local/lib/resume-ai/read-proc-start-ticks.py "$$")"
  [[ "$start_time" =~ ^[1-9][0-9]*$ ]] || fail "cannot read Node installer process identity"
  marker_temp="$(mktemp /run/resume-ai-locks/.node-runtime.live.XXXXXX)"
  cat > "$marker_temp" <<EOF
SCHEMA_VERSION=1
PID=$$
START_TIME_TICKS=$start_time
EOF
  chown root:root "$marker_temp"
  chmod 0600 "$marker_temp"
  mv -f -- "$marker_temp" "$LIVE_MARKER"
  sync -f "$LIVE_MARKER"
  sync -f /run/resume-ai-locks
}

runtime_npm() {
  env -i HOME="$WORK_DIR/npm-home" \
    PATH="$STAGING_DIR/bin:/usr/bin:/bin" \
    npm_config_userconfig=/dev/null \
    npm_config_cache="$WORK_DIR/npm-cache" \
    npm_config_registry=https://registry.npmjs.org/ \
    "$STAGING_DIR/bin/npm" "$@"
}

node_archive="$WORK_DIR/${policy[NODE_ARCHIVE]}"
node_sums="$WORK_DIR/SHASUMS256.txt"
env -i PATH=/usr/bin:/bin curl -q -fL --proto '=https' --tlsv1.2 --retry 3 --connect-timeout 10 \
  --output "$node_archive" "${policy[NODE_ORIGIN]}/${policy[NODE_ARCHIVE]}"
env -i PATH=/usr/bin:/bin curl -q -fL --proto '=https' --tlsv1.2 --retry 3 --connect-timeout 10 \
  --output "$node_sums" "${policy[NODE_ORIGIN]}/SHASUMS256.txt"
[ "$(sha256sum "$node_archive" | awk '{print $1}')" = "${policy[NODE_SHA256]}" ] \
  || fail "Node archive checksum mismatch"
grep -Fxq "${policy[NODE_SHA256]}  ${policy[NODE_ARCHIVE]}" "$node_sums" \
  || fail "official Node checksum list disagrees with the pinned checksum"

python3 -I - "$node_archive" "${policy[NODE_ARCHIVE]%.tar.xz}" <<'PY'
import posixpath
import pathlib
import sys
import tarfile

archive = pathlib.Path(sys.argv[1])
prefix = sys.argv[2]
with tarfile.open(archive, "r:xz") as handle:
    members = handle.getmembers()
    if not members:
        raise SystemExit("Node archive is empty")
    for member in members:
        path = pathlib.PurePosixPath(member.name)
        if path.is_absolute() or ".." in path.parts or not path.parts or path.parts[0] != prefix:
            raise SystemExit(f"unsafe Node archive member: {member.name}")
        if not (member.isfile() or member.isdir() or member.issym()):
            raise SystemExit(f"unsupported Node archive member: {member.name}")
        if member.issym():
            target = pathlib.PurePosixPath(member.linkname)
            resolved = pathlib.PurePosixPath(posixpath.normpath(str(path.parent / target)))
            if target.is_absolute() or not resolved.parts or resolved.parts[0] != prefix:
                raise SystemExit(f"unsafe Node archive symlink: {member.name}")
PY

tar -xJf "$node_archive" -C "$EXTRACT_ROOT"
EXTRACTED_DIR="$EXTRACT_ROOT/${policy[NODE_ARCHIVE]%.tar.xz}"
[ -d "$EXTRACTED_DIR" ] && [ ! -L "$EXTRACTED_DIR" ] || fail "Node archive did not create its expected directory"
mv -- "$EXTRACTED_DIR" "$STAGING_DIR"
"$STAGING_DIR/bin/node" --version | grep -Fxq "v${policy[NODE_VERSION]}"
"$STAGING_DIR/bin/npm" --version | grep -Fxq "${policy[NPM_VERSION]}"
RUNTIME_TOOLS_DIR="$STAGING_DIR/lib/runtime-tools"
install -d -o root -g root -m 0755 "$RUNTIME_TOOLS_DIR"
install -o root -g root -m 0644 "$RUNTIME_PACKAGE_JSON" "$RUNTIME_TOOLS_DIR/package.json"
install -o root -g root -m 0644 "$RUNTIME_PACKAGE_LOCK" "$RUNTIME_TOOLS_DIR/package-lock.json"
(
  cd "$RUNTIME_TOOLS_DIR"
  runtime_npm ci --ignore-scripts --no-audit --no-fund >/dev/null
)
ln -s ../lib/runtime-tools/node_modules/pm2/bin/pm2 "$STAGING_DIR/bin/pm2"
ln -s ../lib/runtime-tools/node_modules/pm2/bin/pm2-dev "$STAGING_DIR/bin/pm2-dev"
ln -s ../lib/runtime-tools/node_modules/pm2/bin/pm2-docker "$STAGING_DIR/bin/pm2-docker"
ln -s ../lib/runtime-tools/node_modules/pm2/bin/pm2-runtime "$STAGING_DIR/bin/pm2-runtime"
ln -s ../lib/runtime-tools/node_modules/pnpm/bin/pnpm.mjs "$STAGING_DIR/bin/pn"
ln -s ../lib/runtime-tools/node_modules/pnpm/bin/pnpm.mjs "$STAGING_DIR/bin/pnpm"
ln -s ../lib/runtime-tools/node_modules/pnpm/bin/pnpx.mjs "$STAGING_DIR/bin/pnx"
ln -s ../lib/runtime-tools/node_modules/pnpm/bin/pnpx.mjs "$STAGING_DIR/bin/pnpx"
"$OPS_DIR/bin/verify-single-link-tree.sh" "$STAGING_DIR"
"$STAGING_DIR/bin/node" -e \
  'const p=require(process.argv[1]); if(p.version!==process.argv[2]) process.exit(1)' \
  "$RUNTIME_TOOLS_DIR/node_modules/pm2/package.json" "${policy[PM2_VERSION]}"
"$STAGING_DIR/bin/pnpm" --version | grep -Fxq "${policy[PNPM_VERSION]}"
set +e
(
  cd "$RUNTIME_TOOLS_DIR"
  runtime_npm audit --omit=dev --audit-level=low --json
) > "$BACKUP_DIR/runtime-npm-audit.json"
audit_status=$?
set -e
[ "$audit_status" -eq 0 ] || fail "pinned PM2/pnpm runtime dependency audit found a vulnerability"
"$STAGING_DIR/bin/node" - "$BACKUP_DIR/runtime-npm-audit.json" <<'NODE'
const fs = require("node:fs");
const report = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (report?.metadata?.vulnerabilities?.total !== 0) process.exit(2);
NODE
(
  cd "$RUNTIME_TOOLS_DIR"
  runtime_npm ls --all --json
) > "$BACKUP_DIR/runtime-installed-dependencies.json"
chown -R root:root "$STAGING_DIR"
chmod -R go-w "$STAGING_DIR"
"$OPS_DIR/bin/create-immutable-tree-manifest.py" "$STAGING_DIR" \
  > "$BACKUP_DIR/node24-installed-tree.jsonl"
(cd "$STAGING_DIR" && find . -type f -print0 | sort -z | xargs -0 sha256sum) \
  > "$BACKUP_DIR/node24-installed-files.sha256"

find "$BACKUP_DIR" -maxdepth 1 -type f -exec chmod 0600 {} +
fsync_tree "$STAGING_DIR"
fsync_tree "$BACKUP_DIR"
sync -f "$BACKUP_ROOT"
install_live_marker
write_node_journal prepared
JOURNAL_WRITTEN=1

if [ -e "$FINAL_DIR" ]; then
  [ -d "$FINAL_DIR" ] && [ ! -L "$FINAL_DIR" ] || fail "approved Node target is unsafe"
  unsafe_existing_runtime="$(find "$FINAL_DIR" -xdev ! -type l \
    \( ! -user root -o -perm /022 \) -print -quit)"
  [ -z "$unsafe_existing_runtime" ] \
    || fail "existing approved Node directory is not root-owned and immutable"
  "$OPS_DIR/bin/verify-single-link-tree.sh" "$FINAL_DIR"
  "$OPS_DIR/bin/create-immutable-tree-manifest.py" "$FINAL_DIR" \
    > "$BACKUP_DIR/node24-existing-tree.jsonl"
  cmp -s "$BACKUP_DIR/node24-installed-tree.jsonl" "$BACKUP_DIR/node24-existing-tree.jsonl" \
    || fail "existing approved Node directory metadata or links differ from the staged runtime"
  (cd "$FINAL_DIR" && find . -type f -print0 | sort -z | xargs -0 sha256sum) \
    > "$BACKUP_DIR/node24-existing-files.sha256"
  cmp -s "$BACKUP_DIR/node24-installed-files.sha256" "$BACKUP_DIR/node24-existing-files.sha256" \
    || fail "existing approved Node directory differs from the staged runtime"
  find "$STAGING_DIR" -depth -delete
else
  mv -- "$STAGING_DIR" "$FINAL_DIR"
fi
fsync_tree "$FINAL_DIR"
sync -f "$NODE_ROOT"
write_node_journal runtime_ready

new_link="$NODE_ROOT/.current-${policy[NODE_VERSION]}.$$"
ln -s "$(basename "$FINAL_DIR")" "$new_link"
mv -Tf -- "$new_link" "$CURRENT_LINK"
sync -f "$NODE_ROOT"
write_node_journal pointer_switched
install -o root -g root -m 0644 "$OPS_DIR/systemd/resume-ai-pm2.service" \
  /etc/systemd/system/resume-ai-pm2.service
install -o root -g root -m 0644 "$OPS_DIR/logrotate/resume-ai" /etc/logrotate.d/resume-ai
sync -f /etc/systemd/system/resume-ai-pm2.service
sync -f /etc/systemd/system
sync -f /etc/logrotate.d/resume-ai
systemctl daemon-reload
write_node_journal unit_installed
/usr/local/lib/resume-ai/assert-pm2-effective-service.sh >/dev/null
if [ "$SERVICE_WAS_ACTIVE" -eq 1 ]; then
  runuser -u resume-ai -- env -i HOME=/var/lib/resume-ai PM2_HOME=/var/lib/resume-ai/.pm2 \
    PATH=/opt/nodejs/current/bin:/usr/bin:/bin /opt/nodejs/current/bin/pm2 save >/dev/null
  [ -f /var/lib/resume-ai/.pm2/dump.pm2 ] || fail "PM2 recovery dump was not written"
  sync -f /var/lib/resume-ai/.pm2/dump.pm2
  sync -f /var/lib/resume-ai/.pm2
  systemctl restart resume-ai-pm2.service
  systemctl is-active --quiet resume-ai-pm2.service
else
  if systemctl is-active --quiet resume-ai-pm2.service; then
    fail "Node runtime migration unexpectedly started the application service"
  fi
fi
write_node_journal service_restarted

/opt/nodejs/current/bin/node --version | grep -Fxq "v${policy[NODE_VERSION]}"
/opt/nodejs/current/bin/node -e \
  'const p=require(process.argv[1]); if(p.version!==process.argv[2]) process.exit(1)' \
  /opt/nodejs/current/lib/runtime-tools/node_modules/pm2/package.json "${policy[PM2_VERSION]}"
/opt/nodejs/current/bin/pnpm --version | grep -Fxq "${policy[PNPM_VERSION]}"
grep -Fqx 'ExecStart=/opt/nodejs/current/bin/pm2 resurrect' /etc/systemd/system/resume-ai-pm2.service

# Disable the obsolete NodeSource 20 channel only after Node 24 and PM2 have
# recovered.  The old package/binaries remain installed as the documented
# immediate rollback source until a later maintenance cleanup.
install -d -o root -g root -m 0700 "$BACKUP_DIR/nodesource"
: > "$BACKUP_DIR/nodesource-disabled.map"
while IFS= read -r -d '' source_file; do
  [ "$source_file" = /etc/apt/sources.list ] \
    || [[ "$source_file" =~ ^/etc/apt/sources\.list\.d/[A-Za-z0-9_.+-]+\.(list|sources)$ ]] \
    || fail "NodeSource source path has an unapproved name: $source_file"
  [ -f "$source_file" ] && [ ! -L "$source_file" ] \
    && [ "$(stat -c '%U:%G:%h' "$source_file")" = root:root:1 ] \
    && [ -z "$(find "$source_file" -maxdepth 0 -perm /022 -print)" ] \
    || fail "NodeSource source file is linked, writable, or not root-owned"
  relative=${source_file#/etc/apt/}
  safe_name=${relative//\//_}
  cp --preserve=mode,ownership,timestamps "$source_file" "$BACKUP_DIR/nodesource/$safe_name"
  [ "$(sha256sum "$source_file" | awk '{print $1}')" \
    = "$(sha256sum "$BACKUP_DIR/nodesource/$safe_name" | awk '{print $1}')" ] \
    || fail "NodeSource source backup differs from its active file"
  disabled="$source_file.resume-ai-disabled"
  [ ! -e "$disabled" ] || fail "NodeSource disabled target already exists: $disabled"
  printf '%s|%s|%s\n' "$source_file" "$disabled" "$BACKUP_DIR/nodesource/$safe_name" \
    >> "$BACKUP_DIR/nodesource-disabled.map"
  sync -f "$BACKUP_DIR/nodesource-disabled.map"
  mv -- "$source_file" "$disabled"
  sync -f "$(dirname "$source_file")"
done < <(grep -IlZ 'deb\.nodesource\.com/node_20\.x' /etc/apt/sources.list /etc/apt/sources.list.d/* 2>/dev/null || true)
write_node_journal sources_disabled

cat > "$BACKUP_DIR/rollback-instructions.txt" <<EOF
Node 24 runtime: $FINAL_DIR
Previous /opt/nodejs/current target: $PREVIOUS_TARGET
Previous PM2 unit backup: $UNIT_BACKUP
The old distro/NodeSource nodejs package was intentionally retained; exact package metadata is in system-node-package.txt.
Restore the backed-up PM2 unit and previous current pointer, daemon-reload, and restart resume-ai-pm2.service to roll back.
EOF
find "$BACKUP_DIR" -maxdepth 1 -type f -exec chmod 0600 {} +
find "$BACKUP_DIR/nodesource" -type f -exec chmod 0600 {} +
fsync_tree "$FINAL_DIR"
fsync_tree "$BACKUP_DIR"
sync -f "$NODE_ROOT"
sync -f "$BACKUP_ROOT"
write_node_journal committed

unlink "$LIVE_MARKER"
sync -f /run/resume-ai-locks
find "$WORK_DIR" -depth -delete
[ ! -e "$EXTRACT_ROOT" ] || find "$EXTRACT_ROOT" -depth -delete
unlink "$PENDING_FILE"
sync -f "$NODE_ROOT"
JOURNAL_WRITTEN=0
trap - ERR EXIT
printf '%s\n' "Node ${policy[NODE_VERSION]}, PM2 ${policy[PM2_VERSION]}, and pnpm ${policy[PNPM_VERSION]} are installed; rollback evidence: $BACKUP_DIR"
