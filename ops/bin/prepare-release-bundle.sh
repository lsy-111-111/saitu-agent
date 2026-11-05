#!/usr/bin/env bash
set -Eeuo pipefail

fail() {
  printf '%s\n' "ERROR: $*" >&2
  exit 1
}

SOURCE_DIR=${1:-$PWD}
OUTPUT_ROOT=${2:-$SOURCE_DIR/artifacts/releases}
VALIDATION_LOG=${VALIDATION_LOG:-}
E2E_EVIDENCE=${E2E_EVIDENCE:-}
E2E_RESULT=${E2E_RESULT:-}
REVIEWED_SOURCE_MANIFEST=${REVIEWED_SOURCE_MANIFEST:-}
SECURITY_SCAN_REPORT=${SECURITY_SCAN_REPORT:-}
SECURITY_SCAN_RESULT=${SECURITY_SCAN_RESULT:-}
PREVIOUS_RELEASE_ID=${PREVIOUS_RELEASE_ID:-none}
PROSPECTIVE_BASELINE_MODE=${PROSPECTIVE_BASELINE_MODE:-carry-forward}
PROSPECTIVE_BASELINE_INPUT=${PROSPECTIVE_BASELINE_INPUT:-}
ACK_BOOTSTRAP_PROSPECTIVE_BASELINE=${ACK_BOOTSTRAP_PROSPECTIVE_BASELINE:-}
RELEASE_ID=${RELEASE_ID:-$(date -u +%Y%m%dT%H%M%SZ)}
CREATED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Final release evidence is intentionally produced only in the root-owned
# Jammy builder. This prevents macOS bsdtar semantics or an ambient Node/PATH
# from silently changing the archive or result parser.
NODE_BIN=${RELEASE_NODE_BIN:-/opt/nodejs/current/bin/node}
TAR_BIN=${RELEASE_TAR_BIN:-/usr/bin/tar}
PYTHON_BIN=/usr/bin/python3
GIT_BIN=/usr/bin/git
SHA256_BIN=/usr/bin/sha256sum
SYSTEMD_RUN=/usr/bin/systemd-run
GIT_SANDBOX_ACCOUNT=resume-ai-build
CONTROL_ROOT=/usr/local/lib/resume-ai
PREPARE_CONTROL=$CONTROL_ROOT/prepare-release-bundle.sh
SNAPSHOT_CONTROL=$CONTROL_ROOT/snapshot-release-bundle.py
SOURCE_MANIFEST_CONTROL=$CONTROL_ROOT/create-release-source-manifest.sh
SOURCE_MANIFEST_PY_CONTROL=$CONTROL_ROOT/create-release-source-manifest.py
SECRET_SCAN_CONTROL=$CONTROL_ROOT/scan-release-secrets.sh
EVIDENCE_VERIFY_CONTROL=$CONTROL_ROOT/verify-release-evidence.mjs
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH
TRUSTED_ENV=(/usr/bin/env -i PATH="$PATH" LANG=C.UTF-8 LC_ALL=C.UTF-8)

if [ "$(uname -s)" != Linux ] || [ "${EUID:-$(id -u)}" -ne 0 ]; then
  fail "prepare the release as root in the reviewed Jammy builder"
fi
if [ "$(readlink -f -- "$0")" != "$PREPARE_CONTROL" ]; then
  fail "release preparation must use the installed trusted controller: $PREPARE_CONTROL"
fi
if [ ! -d "$CONTROL_ROOT" ] || [ -L "$CONTROL_ROOT" ] \
  || [ "$(stat -c '%U:%G' "$CONTROL_ROOT")" != root:root ] \
  || [ $((8#$(stat -c '%a' "$CONTROL_ROOT") & 8#022)) -ne 0 ]; then
  fail "installed control root is missing, linked, writable, or not root-owned"
fi
for control in "$PREPARE_CONTROL" "$SNAPSHOT_CONTROL" "$SOURCE_MANIFEST_CONTROL" \
  "$SOURCE_MANIFEST_PY_CONTROL" "$SECRET_SCAN_CONTROL" "$EVIDENCE_VERIFY_CONTROL"; do
  [ -f "$control" ] && [ ! -L "$control" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$control")" = root:root:755:1 ] \
    || fail "installed release control is missing or unsafe: $control"
done
for executable in "$NODE_BIN" "$TAR_BIN" "$PYTHON_BIN" "$GIT_BIN" "$SHA256_BIN" "$SYSTEMD_RUN"; do
  [ -x "$executable" ] || fail "fixed release executable is missing: $executable"
  executable_owner=$(stat -Lc '%U' "$executable")
  executable_mode=$(stat -Lc '%a' "$executable")
  if [ "$executable_owner" != root ] || [ $((8#$executable_mode & 8#022)) -ne 0 ]; then
    fail "fixed release executable is not root-owned and immutable: $executable"
  fi
done
GIT_SANDBOX_UID=$(/usr/bin/id -u "$GIT_SANDBOX_ACCOUNT") \
  && GIT_SANDBOX_GID=$(/usr/bin/id -g "$GIT_SANDBOX_ACCOUNT") \
  || fail "Git sandbox account is missing"
if ! [[ "$GIT_SANDBOX_UID" =~ ^[1-9][0-9]*$ ]] \
  || ! [[ "$GIT_SANDBOX_GID" =~ ^[1-9][0-9]*$ ]] \
  || [ "$(/usr/bin/id -gn "$GIT_SANDBOX_ACCOUNT")" != "$GIT_SANDBOX_ACCOUNT" ] \
  || [ "$(/usr/bin/id -G "$GIT_SANDBOX_ACCOUNT")" != "$GIT_SANDBOX_GID" ]; then
  fail "Git sandbox account is root-equivalent or has supplementary groups"
fi
IFS=: read -r sandbox_name _ sandbox_passwd_uid sandbox_passwd_gid _ _ sandbox_shell < <(
  /usr/bin/getent passwd "$GIT_SANDBOX_ACCOUNT"
)
if [ "$sandbox_name" != "$GIT_SANDBOX_ACCOUNT" ] \
  || [ "$sandbox_passwd_uid" != "$GIT_SANDBOX_UID" ] \
  || [ "$sandbox_passwd_gid" != "$GIT_SANDBOX_GID" ] \
  || { [ "$sandbox_shell" != /usr/sbin/nologin ] && [ "$sandbox_shell" != /bin/false ]; }; then
  fail "Git sandbox account is not a dedicated non-login identity"
fi
[ "$("${TRUSTED_ENV[@]}" "$NODE_BIN" --version)" = v24.20.0 ] || fail "fixed Node v24.20.0 is required"
"$TAR_BIN" --version | head -n 1 | grep -F 'GNU tar' >/dev/null \
  || fail "GNU tar is required; bsdtar is not a release evidence fallback"

GIT_SANDBOX_SEQUENCE=0
assert_git_sandbox_idle() {
  if /usr/bin/pgrep -u "$GIT_SANDBOX_UID" >/dev/null 2>&1; then
    fail "Git sandbox identity has a process outside the transient unit"
  elif [ "$?" -ne 1 ]; then
    fail "cannot prove Git sandbox identity is idle"
  fi
}

sandbox_git() {
  local unit=$1
  shift
  "$SYSTEMD_RUN" --quiet --wait --collect --pipe --service-type=exec \
    --unit="$unit" --uid="$GIT_SANDBOX_ACCOUNT" --gid="$GIT_SANDBOX_ACCOUNT" \
    --working-directory="$SOURCE_DIR" \
    --property=KillMode=control-group \
    --property=NoNewPrivileges=yes \
    --property=PrivateTmp=yes \
    --property=PrivateDevices=yes \
    --property=PrivateNetwork=yes \
    --property=ProtectHome=read-only \
    --property=ProtectSystem=strict \
    --property=ProtectKernelTunables=yes \
    --property=ProtectKernelModules=yes \
    --property=ProtectControlGroups=yes \
    --property=ProtectKernelLogs=yes \
    --property=ProtectClock=yes \
    --property=ProtectHostname=yes \
    --property=ProtectProc=invisible \
    --property=ProcSubset=pid \
    --property=RestrictSUIDSGID=yes \
    --property=LockPersonality=yes \
    --property=RestrictRealtime=yes \
    --property=RestrictNamespaces=yes \
    --property=RemoveIPC=yes \
    --property=CapabilityBoundingSet= \
    --property=UMask=0077 \
    --property=TasksMax=64 \
    --property=MemoryMax=512M \
    --property=RuntimeMaxSec=300 \
    --property="ReadOnlyPaths=$SOURCE_DIR" \
    --property="InaccessiblePaths=-/root -/etc/resume-ai -/opt/resume-ai/current -/opt/resume-ai/releases -/run/credentials -/run/postgresql -/var/run/postgresql -/var/lib/postgresql -/var/lib/resume-ai/backups" \
    /usr/bin/env -i PATH="$PATH" LANG=C.UTF-8 LC_ALL=C.UTF-8 \
      GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_OPTIONAL_LOCKS=0 \
      GIT_CONFIG_COUNT=3 \
      GIT_CONFIG_KEY_0=core.fsmonitor GIT_CONFIG_VALUE_0=false \
      GIT_CONFIG_KEY_1=core.hooksPath GIT_CONFIG_VALUE_1=/dev/null \
      GIT_CONFIG_KEY_2=core.untrackedCache GIT_CONFIG_VALUE_2=false \
      "$GIT_BIN" -C "$SOURCE_DIR" "$@" 2>/dev/null
}

capture_sandbox_git() {
  local output=$1 ceiling=$2
  shift 2
  GIT_SANDBOX_SEQUENCE=$((GIT_SANDBOX_SEQUENCE + 1))
  local unit="resume-ai-release-git-${RELEASE_ID,,}-$$-$GIT_SANDBOX_SEQUENCE"
  [ ! -e "$output" ] || fail "Git sandbox output already exists: $output"
  if ! sandbox_git "$unit" "$@" | "${TRUSTED_ENV[@]}" "$PYTHON_BIN" -I -c '
import os, pathlib, sys
target = pathlib.Path(sys.argv[1])
ceiling = int(sys.argv[2])
descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
total = 0
with os.fdopen(descriptor, "wb") as output:
    while True:
        chunk = sys.stdin.buffer.read(min(1024 * 1024, ceiling + 1 - total))
        if not chunk:
            break
        total += len(chunk)
        if total > ceiling:
            raise SystemExit("Git sandbox output exceeds its byte ceiling")
        output.write(chunk)
  ' "$output" "$ceiling"; then
    fail "sandboxed Git command failed or exceeded its output ceiling"
  fi
  assert_git_sandbox_idle
}
assert_git_sandbox_idle

case "$SOURCE_DIR:$OUTPUT_ROOT" in /*:/*) ;; *) fail "source and output paths must be absolute" ;; esac
case "$RELEASE_ID" in 20??????T??????Z) ;; *) fail "RELEASE_ID must use YYYYMMDDTHHMMSSZ" ;; esac
case "$PREVIOUS_RELEASE_ID" in none|20??????T??????Z) ;; *) fail "PREVIOUS_RELEASE_ID is invalid" ;; esac
case "$PROSPECTIVE_BASELINE_MODE" in bootstrap|carry-forward) ;; *) fail "PROSPECTIVE_BASELINE_MODE must be bootstrap or carry-forward" ;; esac
if [ ! -d "$SOURCE_DIR/.git" ] || [ -L "$SOURCE_DIR" ] || [ -L "$SOURCE_DIR/.git" ]; then
  fail "the frozen source must include its Git metadata"
fi
[ -f "$SOURCE_DIR/package.json" ] || fail "source is missing package.json"
SOURCE_DIR=$(cd -- "$SOURCE_DIR" && pwd -P)
if [ "$(stat -c '%U' "$SOURCE_DIR")" != root ] \
  || [ $((8#$(stat -c '%a' "$SOURCE_DIR") & 8#022)) -ne 0 ]; then
  fail "source freeze must be root-owned and not group/world writable"
fi
"${TRUSTED_ENV[@]}" "$PYTHON_BIN" -I - "$SOURCE_DIR" <<'PY'
import os
import pathlib
import stat
import sys

source = pathlib.Path(sys.argv[1]).resolve(strict=True)
for ancestor in (source, *source.parents):
    metadata = ancestor.lstat()
    if not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != 0 or metadata.st_gid != 0 or metadata.st_mode & 0o022:
        raise SystemExit(f"source ancestor is not a root-owned non-writable directory: {ancestor}")
git = source / ".git"
for current, directories, files in os.walk(git, followlinks=False):
    current_path = pathlib.Path(current)
    current_metadata = current_path.lstat()
    if not stat.S_ISDIR(current_metadata.st_mode) or current_metadata.st_uid != 0 or current_metadata.st_gid != 0 or current_metadata.st_mode & 0o022:
        raise SystemExit(f"unsafe Git metadata directory: {current_path}")
    for name in [*directories, *files]:
        member = current_path / name
        metadata = member.lstat()
        if stat.S_ISLNK(metadata.st_mode) or metadata.st_uid != 0 or metadata.st_gid != 0 or metadata.st_mode & 0o022:
            raise SystemExit(f"linked, writable, or unowned Git metadata member: {member}")
        if stat.S_ISREG(metadata.st_mode) and metadata.st_nlink != 1:
            raise SystemExit(f"hard-linked Git metadata member: {member}")
        if not (stat.S_ISDIR(metadata.st_mode) or stat.S_ISREG(metadata.st_mode)):
            raise SystemExit(f"special Git metadata member: {member}")
PY

for variable in VALIDATION_LOG E2E_EVIDENCE E2E_RESULT REVIEWED_SOURCE_MANIFEST SECURITY_SCAN_REPORT SECURITY_SCAN_RESULT; do
  value=${!variable:-}
  [ -n "$value" ] || fail "$variable is required"
  case "$value" in /*) ;; *) fail "$variable must be absolute" ;; esac
done
case "$PROSPECTIVE_BASELINE_INPUT" in /*) ;; *) fail "PROSPECTIVE_BASELINE_INPUT must be an absolute approved baseline path" ;; esac
if [ ! -s "$PROSPECTIVE_BASELINE_INPUT" ] || [ ! -f "$PROSPECTIVE_BASELINE_INPUT" ] \
  || [ -L "$PROSPECTIVE_BASELINE_INPUT" ] || [ "$(stat -c '%h' "$PROSPECTIVE_BASELINE_INPUT")" != 1 ] \
  || [ "$(stat -c '%U' "$PROSPECTIVE_BASELINE_INPUT")" != root ] \
  || [ $((8#$(stat -c '%a' "$PROSPECTIVE_BASELINE_INPUT") & 8#022)) -ne 0 ]; then
  fail "prospective baseline input is missing, linked, writable, or not root-owned"
fi
if [ "$PROSPECTIVE_BASELINE_MODE" = bootstrap ]; then
  [ "$ACK_BOOTSTRAP_PROSPECTIVE_BASELINE" = YES ] \
    || fail "bootstrap requires ACK_BOOTSTRAP_PROSPECTIVE_BASELINE=YES after independent candidate review"
  [ "$PROSPECTIVE_BASELINE_INPUT" = "$SOURCE_DIR/tests/fixtures/competition-score-prospective-baseline.json" ] \
    || fail "bootstrap must bind the exact candidate exercised by formal validation"
else
  [ "$PREVIOUS_RELEASE_ID" != none ] || fail "carry-forward requires a previous approved release"
  [ "$PROSPECTIVE_BASELINE_INPUT" = "/opt/resume-ai/release-artifacts/$PREVIOUS_RELEASE_ID/baseline/competition-score-prospective-baseline.json" ] \
    || fail "carry-forward must use the previous approved release baseline"
  [ -z "$ACK_BOOTSTRAP_PROSPECTIVE_BASELINE" ] \
    || fail "bootstrap acknowledgement is forbidden in carry-forward mode"
fi
if [ ! -d "$E2E_EVIDENCE" ] || [ -L "$E2E_EVIDENCE" ]; then
  fail "E2E_EVIDENCE must be the fresh evidence directory"
fi
E2E_EVIDENCE=$(cd -- "$E2E_EVIDENCE" && pwd -P)
for binding in \
  "VALIDATION_LOG:$E2E_EVIDENCE/validation-result.json" \
  "E2E_RESULT:$E2E_EVIDENCE/e2e-result.json" \
  "SECURITY_SCAN_REPORT:$E2E_EVIDENCE/security-scan-report.txt" \
  "SECURITY_SCAN_RESULT:$E2E_EVIDENCE/security-scan-result.json"; do
  variable=${binding%%:*}
  expected=${binding#*:}
  [ "${!variable}" = "$expected" ] || fail "$variable must identify the canonical member of E2E_EVIDENCE"
done
for input in "$VALIDATION_LOG" "$E2E_RESULT" "$REVIEWED_SOURCE_MANIFEST" "$SECURITY_SCAN_REPORT" "$SECURITY_SCAN_RESULT"; do
  if [ ! -s "$input" ] || [ ! -f "$input" ] || [ -L "$input" ]; then
    fail "release evidence input is missing or unsafe: $input"
  fi
done

mkdir -p -- "$OUTPUT_ROOT"
OUTPUT_ROOT=$(cd -- "$OUTPUT_ROOT" && pwd -P)
case "$OUTPUT_ROOT" in
  "$SOURCE_DIR"/artifacts|"$SOURCE_DIR"/artifacts/*) ;;
  "$SOURCE_DIR"|"$SOURCE_DIR"/*) fail "an in-tree output must remain below artifacts" ;;
esac
if [ "$(stat -c '%U' "$OUTPUT_ROOT")" != root ] \
  || [ $((8#$(stat -c '%a' "$OUTPUT_ROOT") & 8#022)) -ne 0 ]; then
  fail "release output root must be root-owned and not group/world writable"
fi
FINAL_DIR=$OUTPUT_ROOT/$RELEASE_ID
[ ! -e "$FINAL_DIR" ] || fail "release bundle already exists: $FINAL_DIR"

umask 077
STAGING_DIR=$(mktemp -d "$OUTPUT_ROOT/.release-$RELEASE_ID.XXXXXX")
cleanup() {
  find "$STAGING_DIR" -xdev -depth -delete >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Freeze every caller-owned evidence byte, including the reviewed source
# manifest, once. No original evidence path is parsed again below.
INPUT_SNAPSHOT=$STAGING_DIR/input-snapshot
install -d -m 0700 "$INPUT_SNAPSHOT"
"${TRUSTED_ENV[@]}" "$PYTHON_BIN" -I "$SNAPSHOT_CONTROL" \
  "$E2E_EVIDENCE" "$INPUT_SNAPSHOT" "$REVIEWED_SOURCE_MANIFEST"
BASELINE_INPUT_SHA256_BEFORE=$($SHA256_BIN "$PROSPECTIVE_BASELINE_INPUT" | awk '{print $1}')
install -o root -g root -m 0600 "$PROSPECTIVE_BASELINE_INPUT" \
  "$INPUT_SNAPSHOT/prospective-baseline-input.json"
[ "$($SHA256_BIN "$PROSPECTIVE_BASELINE_INPUT" | awk '{print $1}')" = "$BASELINE_INPUT_SHA256_BEFORE" ] \
  && [ "$($SHA256_BIN "$INPUT_SNAPSHOT/prospective-baseline-input.json" | awk '{print $1}')" = "$BASELINE_INPUT_SHA256_BEFORE" ] \
  || fail "prospective baseline input changed while freezing"
PROSPECTIVE_BASELINE_INPUT=$INPUT_SNAPSHOT/prospective-baseline-input.json
E2E_EVIDENCE=$INPUT_SNAPSHOT/bundle
REVIEWED_SOURCE_MANIFEST=$INPUT_SNAPSHOT/reviewed-source-manifest.txt
VALIDATION_LOG=$E2E_EVIDENCE/validation-result.json
E2E_RESULT=$E2E_EVIDENCE/e2e-result.json
SECURITY_SCAN_REPORT=$E2E_EVIDENCE/security-scan-report.txt
SECURITY_SCAN_RESULT=$E2E_EVIDENCE/security-scan-result.json
for input in "$VALIDATION_LOG" "$E2E_RESULT" "$SECURITY_SCAN_REPORT" "$SECURITY_SCAN_RESULT" \
  "$E2E_EVIDENCE/playwright-report.json" "$E2E_EVIDENCE/deep-scan-export.json" \
  "$E2E_EVIDENCE/linux-validation-artifact-manifest.txt" \
  "$E2E_EVIDENCE/linux-validation-attestation.json"; do
  if [ ! -s "$input" ] || [ ! -f "$input" ] || [ -L "$input" ]; then
    fail "frozen evidence member is missing: $input"
  fi
done
LINUX_VALIDATION_ATTESTATION_SHA256=$(
  "$SHA256_BIN" "$E2E_EVIDENCE/linux-validation-attestation.json" | awk '{print $1}'
)
[[ "$LINUX_VALIDATION_ATTESTATION_SHA256" =~ ^[a-f0-9]{64}$ ]] \
  || fail "signed Linux validation attestation hash is invalid"

SOURCE_PATHS=$STAGING_DIR/source-paths.before.nul
GIT_PATHS_RAW_BEFORE=$STAGING_DIR/source-paths.before.raw.nul
GIT_DELETED_BEFORE=$STAGING_DIR/source-deleted.before.nul
capture_sandbox_git "$GIT_PATHS_RAW_BEFORE" $((64 * 1024 * 1024)) \
  ls-files --cached --others --exclude-standard -z -- .
capture_sandbox_git "$GIT_DELETED_BEFORE" $((64 * 1024 * 1024)) \
  ls-files --deleted -z -- .
"${TRUSTED_ENV[@]}" "$PYTHON_BIN" -I "$SOURCE_MANIFEST_PY_CONTROL" \
  --source "$SOURCE_DIR" \
  --git-paths-nul "$GIT_PATHS_RAW_BEFORE" \
  --git-deleted-paths-nul "$GIT_DELETED_BEFORE" \
  --write-filtered-paths-nul "$SOURCE_PATHS" \
  > "$STAGING_DIR/source-manifest.before.txt"
cmp -s "$REVIEWED_SOURCE_MANIFEST" "$STAGING_DIR/source-manifest.before.txt" \
  || fail "working tree differs from the independently reviewed source manifest"
SOURCE_MANIFEST_SHA256=$($SHA256_BIN "$STAGING_DIR/source-manifest.before.txt" | awk '{print $1}')

# Candidate bytes are data, never privileged helpers.  Each installed control
# must also be the exact reviewed source row so the evidence remains
# reproducible while the execution trust anchor stays outside the candidate.
for binding in \
  "ops/bin/prepare-release-bundle.sh:$PREPARE_CONTROL" \
  "ops/bin/snapshot-release-bundle.py:$SNAPSHOT_CONTROL" \
  "ops/bin/create-release-source-manifest.sh:$SOURCE_MANIFEST_CONTROL" \
  "ops/bin/create-release-source-manifest.py:$SOURCE_MANIFEST_PY_CONTROL" \
  "ops/bin/scan-release-secrets.sh:$SECRET_SCAN_CONTROL" \
  "ops/bin/verify-release-evidence.mjs:$EVIDENCE_VERIFY_CONTROL"; do
  relative=${binding%%:*}
  installed=${binding#*:}
  expected=$("${TRUSTED_ENV[@]}" "$PYTHON_BIN" -I - \
    "$STAGING_DIR/source-manifest.before.txt" "$relative" <<'PY'
import pathlib
import re
import sys

selected = None
for line in pathlib.Path(sys.argv[1]).read_text(encoding="utf-8").splitlines():
    match = re.fullmatch(r"([a-f0-9]{64})\t([FL])\t([^\t\r\n]+)", line)
    if match is None:
        raise SystemExit(2)
    digest, kind, relative = match.groups()
    if relative == sys.argv[2]:
        if selected is not None or kind != "F":
            raise SystemExit(2)
        selected = digest
if selected is None:
    raise SystemExit(2)
print(selected, end="")
PY
  ) || fail "reviewed source manifest lacks trusted control: $relative"
  observed=$($SHA256_BIN "$installed" | awk '{print $1}')
  [ "$observed" = "$expected" ] \
    || fail "installed release control differs from reviewed source: $relative"
done

# Every selected source member is one root-owned stable file/symlink. Empty
# directories have no Git member and are deliberately absent from releases;
# the archive hash binds the selected members' exact modes.
"${TRUSTED_ENV[@]}" "$PYTHON_BIN" -I - "$SOURCE_DIR" "$SOURCE_PATHS" <<'PY'
import os
import pathlib
import stat
import sys

root = pathlib.Path(sys.argv[1])
for raw in pathlib.Path(sys.argv[2]).read_bytes().split(b"\0"):
    if not raw:
        continue
    relative = pathlib.PurePosixPath(raw.decode("utf-8"))
    path = root.joinpath(*relative.parts)
    metadata = path.lstat()
    if metadata.st_uid != 0 or metadata.st_mode & 0o7022:
        raise SystemExit(f"source member is not root-frozen: {relative}")
    if stat.S_ISREG(metadata.st_mode) and metadata.st_nlink != 1:
        raise SystemExit(f"source member is hard-linked: {relative}")
    if not (stat.S_ISREG(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode)):
        raise SystemExit(f"source member is special: {relative}")
PY
IFS=$'\t' read -r SOURCE_MODE_MANIFEST_SHA256 SOURCE_MODE_MEMBER_COUNT SOURCE_MODE_MANIFEST_BASE64 < <(
  "${TRUSTED_ENV[@]}" "$PYTHON_BIN" -I - "$SOURCE_DIR" "$SOURCE_PATHS" <<'PY'
import base64
import hashlib
import pathlib
import stat
import sys

root = pathlib.Path(sys.argv[1])
lines = []
for raw in pathlib.Path(sys.argv[2]).read_bytes().split(b"\0"):
    if not raw:
        continue
    relative = raw.decode("utf-8")
    mode = stat.S_IMODE(root.joinpath(*pathlib.PurePosixPath(relative).parts).lstat().st_mode)
    lines.append(f"{mode:04o}\t{relative}\n".encode("utf-8"))
value = b"".join(lines)
print(hashlib.sha256(value).hexdigest(), len(lines), base64.b64encode(value).decode("ascii"), sep="\t")
PY
)
if ! [[ "$SOURCE_MODE_MANIFEST_SHA256" =~ ^[a-f0-9]{64}$ ]] \
  || ! [[ "$SOURCE_MODE_MEMBER_COUNT" =~ ^[1-9][0-9]*$ ]] \
  || [ -z "$SOURCE_MODE_MANIFEST_BASE64" ]; then
  fail "source mode manifest generation failed"
fi

"${TRUSTED_ENV[@]}" "$NODE_BIN" "$EVIDENCE_VERIFY_CONTROL" \
  --evidence-dir "$E2E_EVIDENCE" \
  --source-manifest "$STAGING_DIR/source-manifest.before.txt" \
  --source-mode-manifest-sha256 "$SOURCE_MODE_MANIFEST_SHA256" \
  --source-mode-member-count "$SOURCE_MODE_MEMBER_COUNT" >/dev/null
PLAYWRIGHT_REPORT_SHA256=$($SHA256_BIN "$E2E_EVIDENCE/playwright-report.json" | awk '{print $1}')
SECURITY_SCAN_REPORT_SHA256=$($SHA256_BIN "$SECURITY_SCAN_REPORT" | awk '{print $1}')

capture_sandbox_git "$STAGING_DIR/working-tree-status.before.txt" $((64 * 1024 * 1024)) \
  status --porcelain=v1 --untracked-files=all -- . \
    ':(exclude)artifacts' \
    ':(exclude)tests/fixtures/competition-score-prospective-baseline.json'
capture_sandbox_git "$STAGING_DIR/git-commit.before.txt" 4096 rev-parse --verify HEAD
GIT_COMMIT=$(tr -d '\n' < "$STAGING_DIR/git-commit.before.txt")
[[ "$GIT_COMMIT" =~ ^[a-f0-9]{40}$ ]] || fail "unexpected Git commit identifier"
capture_sandbox_git "$STAGING_DIR/working-tree.patch" $((512 * 1024 * 1024)) \
  diff --binary --no-ext-diff --no-textconv HEAD -- . \
    ':(exclude)artifacts' \
    ':(exclude)tests/fixtures/competition-score-prospective-baseline.json'

# Source and untracked archives are both selected from the same filtered Git
# generation. No filesystem walk or exclusion glob is permitted here.
"${TRUSTED_ENV[@]}" "$TAR_BIN" --null --verbatim-files-from --no-recursion -C "$SOURCE_DIR" \
  -czf "$STAGING_DIR/source.tar.gz" --files-from="$SOURCE_PATHS"
RAW_UNTRACKED=$STAGING_DIR/untracked-source-paths.raw.nul
FILTERED_UNTRACKED=$STAGING_DIR/untracked-source-paths.filtered.nul
capture_sandbox_git "$RAW_UNTRACKED" $((64 * 1024 * 1024)) \
  ls-files --others --exclude-standard -z -- .
"${TRUSTED_ENV[@]}" "$PYTHON_BIN" -I - "$SOURCE_PATHS" "$RAW_UNTRACKED" "$FILTERED_UNTRACKED" "$STAGING_DIR/untracked-source-paths.txt" <<'PY'
import pathlib
import sys

selected = {value for value in pathlib.Path(sys.argv[1]).read_bytes().split(b"\0") if value}
untracked = [value for value in pathlib.Path(sys.argv[2]).read_bytes().split(b"\0") if value in selected]
untracked.sort()
pathlib.Path(sys.argv[3]).write_bytes(b"\0".join(untracked) + (b"\0" if untracked else b""))
with pathlib.Path(sys.argv[4]).open("w", encoding="utf-8", newline="\n") as output:
    for value in untracked:
        output.write(value.decode("utf-8") + "\n")
PY
"${TRUSTED_ENV[@]}" "$TAR_BIN" --null --verbatim-files-from --no-recursion -C "$SOURCE_DIR" \
  -czf "$STAGING_DIR/untracked-source.tar.gz" --files-from="$FILTERED_UNTRACKED"

install -d -m 0700 "$STAGING_DIR/source-secret-scan"
"${TRUSTED_ENV[@]}" "$TAR_BIN" -C "$STAGING_DIR/source-secret-scan" -xzf "$STAGING_DIR/source.tar.gz"
"${TRUSTED_ENV[@]}" "$SECRET_SCAN_CONTROL" --source-tree "$STAGING_DIR/source-secret-scan"
: > "$STAGING_DIR/no-deleted-paths.nul"
"${TRUSTED_ENV[@]}" "$PYTHON_BIN" -I "$SOURCE_MANIFEST_PY_CONTROL" \
  --source "$STAGING_DIR/source-secret-scan" \
  --git-paths-nul "$SOURCE_PATHS" \
  --git-deleted-paths-nul "$STAGING_DIR/no-deleted-paths.nul" \
  > "$STAGING_DIR/source-manifest.from-archive.txt"
cmp -s "$STAGING_DIR/source-manifest.from-archive.txt" "$STAGING_DIR/source-manifest.before.txt" \
  || fail "source archive membership or content differs from reviewed source"

cp -- "$VALIDATION_LOG" "$STAGING_DIR/validation.log"
cp -- "$E2E_RESULT" "$STAGING_DIR/e2e-result.json"
cp -- "$SECURITY_SCAN_REPORT" "$STAGING_DIR/security-scan-report.txt"
cp -- "$SECURITY_SCAN_RESULT" "$STAGING_DIR/security-scan-result.json"
"${TRUSTED_ENV[@]}" "$SECRET_SCAN_CONTROL" --full \
  "$STAGING_DIR/source-manifest.before.txt" "$STAGING_DIR/working-tree.patch" \
  "$STAGING_DIR/working-tree-status.before.txt" \
  "$STAGING_DIR/untracked-source-paths.txt" "$STAGING_DIR/validation.log" \
  "$STAGING_DIR/e2e-result.json" "$STAGING_DIR/security-scan-report.txt" \
  "$STAGING_DIR/security-scan-result.json"

"${TRUSTED_ENV[@]}" "$TAR_BIN" -C "$E2E_EVIDENCE" -czf "$STAGING_DIR/e2e-evidence.tar.gz" .
chmod 0400 "$STAGING_DIR/e2e-evidence.tar.gz"
install -d -m 0700 "$STAGING_DIR/e2e-secret-scan"
"${TRUSTED_ENV[@]}" "$PYTHON_BIN" -I - "$STAGING_DIR/e2e-evidence.tar.gz" "$STAGING_DIR/e2e-secret-scan" <<'PY'
import os
import pathlib
import shutil
import stat
import sys
import tarfile

destination = pathlib.Path(sys.argv[2]).resolve()
seen = set()
total = 0
with tarfile.open(sys.argv[1], "r:gz") as archive:
    members = archive.getmembers()
    if not members or len(members) > 250_000:
        raise SystemExit("evidence archive has an invalid member count")
    for member in members:
        value = pathlib.PurePosixPath(member.name).as_posix().removeprefix("./") or "."
        path = pathlib.PurePosixPath(value)
        if path.is_absolute() or ".." in path.parts or "\n" in member.name or "\r" in member.name or value in seen:
            raise SystemExit(f"unsafe or duplicate evidence member: {member.name}")
        if not (member.isfile() or member.isdir()):
            raise SystemExit(f"forbidden evidence member type: {member.name}")
        seen.add(value)
        if member.isfile():
            total += member.size
            if total > 4 * 1024**3:
                raise SystemExit("evidence archive exceeds size ceiling")
    for member in members:
        value = pathlib.PurePosixPath(member.name).as_posix().removeprefix("./") or "."
        target = destination if value == "." else destination.joinpath(*pathlib.PurePosixPath(value).parts)
        if member.isdir():
            target.mkdir(mode=0o700, parents=True, exist_ok=True)
            continue
        target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        stream = archive.extractfile(member)
        if stream is None:
            raise SystemExit(f"cannot read evidence member: {member.name}")
        descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
        with stream, os.fdopen(descriptor, "wb") as output:
            shutil.copyfileobj(stream, output, 1024 * 1024)
        metadata = target.lstat()
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_size != member.size:
            raise SystemExit(f"evidence member changed while extracting: {member.name}")
PY
"${TRUSTED_ENV[@]}" "$SECRET_SCAN_CONTROL" --full "$STAGING_DIR/e2e-secret-scan"

SOURCE_SHA256=$($SHA256_BIN "$STAGING_DIR/source.tar.gz" | awk '{print $1}')
PROSPECTIVE_BASELINE=$STAGING_DIR/baseline/competition-score-prospective-baseline.json
install -d -m 0700 "$STAGING_DIR/baseline"
read -r VALIDATED_BASELINE_BYTE_SHA256 VALIDATED_BASELINE_ARTIFACT_SHA256 < <("${TRUSTED_ENV[@]}" "$NODE_BIN" -e '
  const fs = require("node:fs");
  const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const candidate = value?.prospectiveBaselineCandidate;
  if (!/^[a-f0-9]{64}$/u.test(candidate?.byteSha256 ?? "") || !/^[a-f0-9]{64}$/u.test(candidate?.artifactSha256 ?? "")) process.exit(2);
  process.stdout.write(`${candidate.byteSha256} ${candidate.artifactSha256}\n`);
' "$VALIDATION_LOG") || fail "formal validation does not bind the prospective baseline candidate"
[ "$VALIDATED_BASELINE_BYTE_SHA256" = "$BASELINE_INPUT_SHA256_BEFORE" ] \
  || fail "prospective baseline input differs from the formally validated candidate"
if [ "$PROSPECTIVE_BASELINE_MODE" = bootstrap ]; then
  "${TRUSTED_ENV[@]}" "$NODE_BIN" -e '
    const crypto = require("node:crypto");
    const fs = require("node:fs");
    const [input, output, releaseId, sourceArchiveSha256, expectedArtifact] = process.argv.slice(1);
    const value = JSON.parse(fs.readFileSync(input, "utf8"));
    const canonicalJson = (item) => {
      if (Array.isArray(item)) return `[${item.map(canonicalJson).join(",")}]`;
      if (item && typeof item === "object") return `{${Object.entries(item).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
      return JSON.stringify(item);
    };
    const {artifactSha256, ...withoutArtifactHash} = value;
    const observedArtifact = crypto.createHash("sha256").update(canonicalJson(withoutArtifactHash)).digest("hex");
    if (artifactSha256 !== observedArtifact || artifactSha256 !== expectedArtifact) process.exit(2);
    if (value?.provenance?.releaseId !== null || value?.provenance?.sourceArchiveSha256 !== null) process.exit(3);
    value.provenance.releaseId = releaseId;
    value.provenance.sourceArchiveSha256 = sourceArchiveSha256;
    delete value.artifactSha256;
    value.artifactSha256 = crypto.createHash("sha256").update(canonicalJson(value)).digest("hex");
    fs.writeFileSync(output, `${JSON.stringify(value, null, 2)}\n`, {flag: "wx", mode: 0o600});
  ' "$PROSPECTIVE_BASELINE_INPUT" "$PROSPECTIVE_BASELINE" "$RELEASE_ID" "$SOURCE_SHA256" "$VALIDATED_BASELINE_ARTIFACT_SHA256" \
    || fail "cannot bind the independently validated bootstrap baseline"
else
  install -o root -g root -m 0600 "$PROSPECTIVE_BASELINE_INPUT" "$PROSPECTIVE_BASELINE"
fi
read -r BASELINE_ORIGIN_RELEASE_ID BASELINE_ORIGIN_SOURCE_SHA256 < <("${TRUSTED_ENV[@]}" "$NODE_BIN" -e '
  const fs = require("node:fs");
  const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const release = value?.provenance?.releaseId;
  const source = value?.provenance?.sourceArchiveSha256;
  if (!/^20\d{6}T\d{6}Z$/u.test(release ?? "") || !/^[a-f0-9]{64}$/u.test(source ?? "")) process.exit(2);
  process.stdout.write(`${release} ${source}\n`);
' "$PROSPECTIVE_BASELINE") || fail "approved prospective baseline origin is invalid"
if [ "$PROSPECTIVE_BASELINE_MODE" = bootstrap ] \
  && { [ "$BASELINE_ORIGIN_RELEASE_ID" != "$RELEASE_ID" ] || [ "$BASELINE_ORIGIN_SOURCE_SHA256" != "$SOURCE_SHA256" ]; }; then
  fail "bootstrap baseline is not bound to this release"
fi
BASELINE_BYTE_SHA256=$($SHA256_BIN "$PROSPECTIVE_BASELINE" | awk '{print $1}')
BASELINE_ARTIFACT_SHA256=$("${TRUSTED_ENV[@]}" "$NODE_BIN" -e '
  const fs = require("node:fs");
  const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (!/^[a-f0-9]{64}$/u.test(value?.artifactSha256 ?? "")) process.exit(2);
  process.stdout.write(value.artifactSha256);
' "$PROSPECTIVE_BASELINE") || fail "baseline artifact hash is invalid"

SOURCE_PATHS_AFTER=$STAGING_DIR/source-paths.after.nul
GIT_PATHS_RAW_AFTER=$STAGING_DIR/source-paths.after.raw.nul
GIT_DELETED_AFTER=$STAGING_DIR/source-deleted.after.nul
capture_sandbox_git "$GIT_PATHS_RAW_AFTER" $((64 * 1024 * 1024)) \
  ls-files --cached --others --exclude-standard -z -- .
capture_sandbox_git "$GIT_DELETED_AFTER" $((64 * 1024 * 1024)) \
  ls-files --deleted -z -- .
"${TRUSTED_ENV[@]}" "$PYTHON_BIN" -I "$SOURCE_MANIFEST_PY_CONTROL" \
  --source "$SOURCE_DIR" \
  --git-paths-nul "$GIT_PATHS_RAW_AFTER" \
  --git-deleted-paths-nul "$GIT_DELETED_AFTER" \
  --write-filtered-paths-nul "$SOURCE_PATHS_AFTER" \
  > "$STAGING_DIR/source-manifest.after.txt"
if ! cmp -s "$STAGING_DIR/source-manifest.before.txt" "$STAGING_DIR/source-manifest.after.txt" \
  || ! cmp -s "$SOURCE_PATHS" "$SOURCE_PATHS_AFTER" \
  || ! cmp -s "$GIT_PATHS_RAW_BEFORE" "$GIT_PATHS_RAW_AFTER" \
  || ! cmp -s "$GIT_DELETED_BEFORE" "$GIT_DELETED_AFTER"; then
  fail "source membership/content changed during evidence preparation"
fi
capture_sandbox_git "$STAGING_DIR/working-tree-status.after.txt" $((64 * 1024 * 1024)) \
  status --porcelain=v1 --untracked-files=all -- . \
    ':(exclude)artifacts' \
    ':(exclude)tests/fixtures/competition-score-prospective-baseline.json'
cmp -s "$STAGING_DIR/working-tree-status.before.txt" "$STAGING_DIR/working-tree-status.after.txt" \
  || fail "working tree changed during evidence preparation"
capture_sandbox_git "$STAGING_DIR/working-tree.patch.after" $((512 * 1024 * 1024)) \
  diff --binary --no-ext-diff --no-textconv HEAD -- . \
    ':(exclude)artifacts' \
    ':(exclude)tests/fixtures/competition-score-prospective-baseline.json'
cmp -s "$STAGING_DIR/working-tree.patch" "$STAGING_DIR/working-tree.patch.after" \
  || fail "tracked working-tree patch changed during evidence preparation"
capture_sandbox_git "$STAGING_DIR/git-commit.after.txt" 4096 rev-parse --verify HEAD
GIT_COMMIT_AFTER=$(tr -d '\n' < "$STAGING_DIR/git-commit.after.txt")
[ "$GIT_COMMIT_AFTER" = "$GIT_COMMIT" ] || fail "Git HEAD changed during evidence preparation"
RAW_UNTRACKED_AFTER=$STAGING_DIR/untracked-source-paths.after.raw.nul
FILTERED_UNTRACKED_AFTER=$STAGING_DIR/untracked-source-paths.after.filtered.nul
UNTRACKED_TEXT_AFTER=$STAGING_DIR/untracked-source-paths.after.txt
capture_sandbox_git "$RAW_UNTRACKED_AFTER" $((64 * 1024 * 1024)) \
  ls-files --others --exclude-standard -z -- .
"${TRUSTED_ENV[@]}" "$PYTHON_BIN" -I - "$SOURCE_PATHS_AFTER" "$RAW_UNTRACKED_AFTER" "$FILTERED_UNTRACKED_AFTER" "$UNTRACKED_TEXT_AFTER" <<'PY'
import pathlib
import sys

selected = {value for value in pathlib.Path(sys.argv[1]).read_bytes().split(b"\0") if value}
untracked = sorted(value for value in pathlib.Path(sys.argv[2]).read_bytes().split(b"\0") if value in selected)
pathlib.Path(sys.argv[3]).write_bytes(b"\0".join(untracked) + (b"\0" if untracked else b""))
with pathlib.Path(sys.argv[4]).open("w", encoding="utf-8", newline="\n") as output:
    for value in untracked:
        output.write(value.decode("utf-8") + "\n")
PY
if ! cmp -s "$FILTERED_UNTRACKED" "$FILTERED_UNTRACKED_AFTER" \
  || ! cmp -s "$STAGING_DIR/untracked-source-paths.txt" "$UNTRACKED_TEXT_AFTER"; then
  fail "untracked source membership changed during evidence preparation"
fi
mv -- "$STAGING_DIR/source-manifest.before.txt" "$STAGING_DIR/source-manifest.txt"
mv -- "$STAGING_DIR/working-tree-status.before.txt" "$STAGING_DIR/working-tree-status.txt"

DIRTY=false
[ ! -s "$STAGING_DIR/working-tree-status.txt" ] || DIRTY=true
MIGRATIONS_MANIFEST_SHA256=$($SHA256_BIN "$SOURCE_DIR/ops/config/migrations.manifest" | awk '{print $1}')
RUNTIME_TABLE_POLICY_SHA256=$($SHA256_BIN "$SOURCE_DIR/ops/postgresql/runtime-table-privileges.conf" | awk '{print $1}')
RUNTIME_FUNCTION_POLICY_SHA256=$($SHA256_BIN "$SOURCE_DIR/ops/postgresql/runtime-function-privileges.conf" | awk '{print $1}')
cat > "$STAGING_DIR/release-manifest.json" <<EOF
{
  "schemaVersion": 1,
  "releaseId": "$RELEASE_ID",
  "createdAt": "$CREATED_AT",
  "gitCommit": "$GIT_COMMIT",
  "workingTreeDirty": $DIRTY,
  "sourceArchive": "source.tar.gz",
  "sourceSha256": "$SOURCE_SHA256",
  "sourceManifest": "source-manifest.txt",
  "sourceManifestSha256": "$SOURCE_MANIFEST_SHA256",
  "sourceMembership": "git-ls-files-cached-and-nonignored-untracked",
  "emptyDirectoriesIncluded": false,
  "sourceModeManifest": {
    "encoding": "base64",
    "sha256": "$SOURCE_MODE_MANIFEST_SHA256",
    "memberCount": $SOURCE_MODE_MEMBER_COUNT,
    "data": "$SOURCE_MODE_MANIFEST_BASE64"
  },
  "linuxValidationAttestation": {
    "evidenceMember": "linux-validation-attestation.json",
    "artifactManifestMember": "linux-validation-artifact-manifest.txt",
    "sha256": "$LINUX_VALIDATION_ATTESTATION_SHA256"
  },
  "validationLog": "validation.log",
  "trackedWorkingTreePatch": "working-tree.patch",
  "untrackedSourceArchive": "untracked-source.tar.gz",
  "untrackedSourcePaths": "untracked-source-paths.txt",
  "e2eEvidence": "e2e-evidence.tar.gz",
  "e2eResult": "e2e-result.json",
  "playwrightReportSha256": "$PLAYWRIGHT_REPORT_SHA256",
  "securityScanReport": "security-scan-report.txt",
  "securityScanReportSha256": "$SECURITY_SCAN_REPORT_SHA256",
  "securityScanResult": "security-scan-result.json",
  "prospectiveBaseline": {
    "bundlePath": "baseline/competition-score-prospective-baseline.json",
    "installPath": "tests/fixtures/competition-score-prospective-baseline.json",
    "byteSha256": "$BASELINE_BYTE_SHA256",
    "artifactSha256": "$BASELINE_ARTIFACT_SHA256",
    "mode": "$PROSPECTIVE_BASELINE_MODE",
    "originReleaseId": "$BASELINE_ORIGIN_RELEASE_ID",
    "originSourceArchiveSha256": "$BASELINE_ORIGIN_SOURCE_SHA256",
    "outerIntegrityBoundary": "release-manifest.json"
  },
  "rollbackRelease": "$PREVIOUS_RELEASE_ID",
  "databaseContract": {
    "schemaVersion": 1,
    "runtimeRequiresDirectDelete": false,
    "functionOwnerRoleSuffix": "_owner",
    "migrationsManifestSha256": "$MIGRATIONS_MANIFEST_SHA256",
    "runtimeTablePolicySha256": "$RUNTIME_TABLE_POLICY_SHA256",
    "runtimeFunctionPolicySha256": "$RUNTIME_FUNCTION_POLICY_SHA256"
  },
  "secretFilesIncluded": false
}
EOF

(
  cd "$STAGING_DIR"
  : > SHA256SUMS
  for artifact in source.tar.gz source-manifest.txt working-tree.patch working-tree-status.txt untracked-source.tar.gz untracked-source-paths.txt validation.log e2e-evidence.tar.gz e2e-result.json security-scan-report.txt security-scan-result.json baseline/competition-score-prospective-baseline.json release-manifest.json; do
    printf '%s  %s\n' "$($SHA256_BIN "$artifact" | awk '{print $1}')" "$artifact" >> SHA256SUMS
  done
)

# Re-parse the evidence generation extracted from the final archive and compare
# every top-level bundle copy before sealing the directory.
"${TRUSTED_ENV[@]}" "$NODE_BIN" "$EVIDENCE_VERIFY_CONTROL" \
  --evidence-dir "$STAGING_DIR/e2e-secret-scan" --bundle "$STAGING_DIR" >/dev/null

"${TRUSTED_ENV[@]}" "$PYTHON_BIN" -I - "$STAGING_DIR" <<'PY'
import pathlib
import shutil
import stat
import sys

root = pathlib.Path(sys.argv[1]).resolve(strict=True)
allowed = {
    "SHA256SUMS", "source.tar.gz", "source-manifest.txt", "working-tree.patch",
    "working-tree-status.txt", "untracked-source.tar.gz", "untracked-source-paths.txt",
    "validation.log", "e2e-evidence.tar.gz", "e2e-result.json",
    "security-scan-report.txt", "security-scan-result.json", "baseline",
    "release-manifest.json",
}
for entry in root.iterdir():
    if entry.name in allowed:
        continue
    metadata = entry.lstat()
    if stat.S_ISLNK(metadata.st_mode):
        entry.unlink()
    elif stat.S_ISDIR(metadata.st_mode):
        shutil.rmtree(entry)
    elif stat.S_ISREG(metadata.st_mode):
        entry.unlink()
    else:
        raise SystemExit(f"special staging cleanup member: {entry.name}")
PY
find "$STAGING_DIR" -type f -exec chmod 0444 {} +
find "$STAGING_DIR" -type d -exec chmod 0555 {} +
mv -- "$STAGING_DIR" "$FINAL_DIR"
trap - EXIT
printf '%s\n' "$FINAL_DIR"
