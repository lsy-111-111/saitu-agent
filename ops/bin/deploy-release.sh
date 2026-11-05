#!/usr/bin/env bash
set -Eeuo pipefail
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

# Derive helper paths from this reviewed script, never from caller-controlled
# environment.  The physical directory also survives invocation through the
# installed /usr/local/lib/resume-ai symlink layout.
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
. "$SCRIPT_DIR/open-root-lock.sh"

postgres_peer() {
  runuser -u postgres -- env -i PATH=/usr/bin:/bin PGHOST=/var/run/postgresql PGUSER=postgres "$@"
}

fail() {
  printf '%s\n' "ERROR: $*" >&2
  exit 1
}

ROOT_SYSTEM_PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
root_python() {
  (cd / && /usr/bin/env -i PATH="$ROOT_SYSTEM_PATH" /usr/bin/python3 -I "$@")
}
root_tar() {
  (cd / && /usr/bin/env -i PATH="$ROOT_SYSTEM_PATH" /usr/bin/tar "$@")
}
root_curl() {
  (cd / && /usr/bin/env -i PATH="$ROOT_SYSTEM_PATH" \
    /usr/bin/curl --disable --noproxy '*' "$@")
}

[ "${EUID:-$(id -u)}" -eq 0 ] || fail "run as root"
[ "${ACK_PRODUCTION_DEPLOY:-}" = "YES" ] \
  || fail "set ACK_PRODUCTION_DEPLOY=YES after snapshot and pre-change gates pass"
[ "$#" -eq 1 ] || fail "usage: deploy-release.sh /absolute/path/to/release-bundle"

CALLER_BUNDLE_DIR=$1
case "$CALLER_BUNDLE_DIR" in /*) ;; *) fail "release bundle path must be absolute" ;; esac
[ -d "$CALLER_BUNDLE_DIR" ] && [ ! -L "$CALLER_BUNDLE_DIR" ] \
  || fail "release bundle must be an ordinary directory"
SNAPSHOT_HELPER=/usr/local/lib/resume-ai/snapshot-release-bundle.py
[ -f "$SNAPSHOT_HELPER" ] && [ ! -L "$SNAPSHOT_HELPER" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$SNAPSHOT_HELPER")" = root:root:755:1 ] \
  || fail "root-owned release snapshot helper is missing or unsafe"
open_root_lock 9 deploy
umask 077
DEPLOY_INPUT_ROOT=/opt/resume-ai/deploy-inputs
[ -d "$DEPLOY_INPUT_ROOT" ] && [ ! -L "$DEPLOY_INPUT_ROOT" ] \
  && [ "$(readlink -e -- "$DEPLOY_INPUT_ROOT")" = "$DEPLOY_INPUT_ROOT" ] \
  && [ "$(stat -c '%U:%G:%a' "$DEPLOY_INPUT_ROOT")" = root:root:700 ] \
  || fail "preinstalled root-only deploy input scratch is missing or unsafe"
DEPLOY_INPUT_SNAPSHOT="$(mktemp -d "$DEPLOY_INPUT_ROOT/input.XXXXXX")"
cleanup_deploy_input_snapshot() {
  if [[ "${DEPLOY_INPUT_SNAPSHOT:-}" == /opt/resume-ai/deploy-inputs/input.* ]] \
    && [ -d "$DEPLOY_INPUT_SNAPSHOT" ] && [ ! -L "$DEPLOY_INPUT_SNAPSHOT" ]; then
    find "$DEPLOY_INPUT_SNAPSHOT" -xdev -depth -delete >/dev/null 2>&1 || true
  fi
  DEPLOY_INPUT_SNAPSHOT=""
}
trap cleanup_deploy_input_snapshot EXIT
root_python "$SNAPSHOT_HELPER" "$CALLER_BUNDLE_DIR" "$DEPLOY_INPUT_SNAPSHOT"
BUNDLE_DIR="$DEPLOY_INPUT_SNAPSHOT/bundle"
for artifact in release-manifest.json SHA256SUMS source.tar.gz source-manifest.txt \
  validation.log e2e-evidence.tar.gz e2e-result.json untracked-source.tar.gz \
  security-scan-report.txt security-scan-result.json \
  baseline/competition-score-prospective-baseline.json; do
  [ -s "$BUNDLE_DIR/$artifact" ] && [ -f "$BUNDLE_DIR/$artifact" ] && [ ! -L "$BUNDLE_DIR/$artifact" ] \
    || fail "release artifact is missing, empty, or unsafe: $artifact"
done
for command_name in createdb createuser curl dropdb dropuser flock getent nginx pg_isready pgrep pkill psql python3 runuser sha256sum sync systemctl systemd-run tar; do
  command -v "$command_name" >/dev/null 2>&1 || fail "$command_name is unavailable"
done
NODE_BIN=/opt/nodejs/current/bin/node
PM2_BIN=/opt/nodejs/current/bin/pm2
PNPM_BIN=/opt/nodejs/current/bin/pnpm
[ -x "$NODE_BIN" ] && [ -x "$PM2_BIN" ] && [ -x "$PNPM_BIN" ] || fail "approved Node toolchain is unavailable"
root_node() {
  (cd / && /usr/bin/env -i HOME=/root \
    PATH=/opt/nodejs/current/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    "$NODE_BIN" "$@")
}
root_pnpm() {
  (cd / && /usr/bin/env -i HOME=/root NPM_CONFIG_USERCONFIG=/dev/null \
    npm_config_userconfig=/dev/null \
    PATH=/opt/nodejs/current/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    "$PNPM_BIN" "$@")
}
PROJECT_TOOLCHAIN_COORDINATOR=/usr/local/lib/resume-ai/run-release-evidence.mjs
verify_project_toolchain() {
  local source_root=$1 modules_root=$2 output=$3
  [ ! -e "$output" ] && [ ! -L "$output" ] \
    || fail "project-toolchain receipt output already exists"
  root_node "$PROJECT_TOOLCHAIN_COORDINATOR" verify-project-toolchain \
    --source-manifest "$BUNDLE_DIR/source-manifest.txt" \
    --source-root "$source_root" --node-modules "$modules_root" \
    --output "$output" >/dev/null
  [ -f "$output" ] && [ ! -L "$output" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$output")" = root:root:600:1 ] \
    || fail "fixed project-toolchain verifier did not emit a safe root receipt"
}
[ "$(root_node --version)" = v24.20.0 ] && [ "$(root_pnpm --version)" = 11.19.0 ] \
  || fail "approved Node 24.20.0/pnpm 11.19.0 toolchain is not active"
assert_dedicated_account() {
  local account=$1 expected_home=$2 uid gid
  local passwd_name passwd_uid passwd_gid passwd_home passwd_shell
  uid="$(id -u "$account")" && gid="$(id -g "$account")" \
    || fail "$account account does not exist"
  IFS=: read -r passwd_name _ passwd_uid passwd_gid _ passwd_home passwd_shell < <(
    getent passwd "$account"
  )
  [ "$passwd_name:$passwd_uid:$passwd_gid:$passwd_home" \
      = "$account:$uid:$gid:$expected_home" ] \
    && [[ "$uid" =~ ^[1-9][0-9]*$ ]] \
    && [[ "$gid" =~ ^[1-9][0-9]*$ ]] \
    && [ "$(id -gn "$account")" = "$account" ] \
    && [ "$(id -G "$account")" = "$gid" ] \
    && [ -z "$(getent group "$account" | cut -d: -f4)" ] \
    && { [ "$passwd_shell" = /usr/sbin/nologin ] || [ "$passwd_shell" = /bin/false ]; } \
    || fail "$account is not an exact dedicated non-login identity"
}
assert_dedicated_account resume-ai /var/lib/resume-ai
assert_dedicated_account resume-ai-build /var/lib/resume-ai-build
assert_dedicated_account resume-ai-verify /var/lib/resume-ai-verify
assert_dedicated_account resume-ai-pgtest /var/lib/resume-ai-pgtest
assert_dedicated_account resume-ai-dbverify /var/lib/resume-ai-dbverify

RELEASE_ID="$(root_node -e '
  const fs = require("node:fs");
  const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (typeof manifest.releaseId !== "string") process.exit(2);
  process.stdout.write(manifest.releaseId);
' "$BUNDLE_DIR/release-manifest.json")"
case "$RELEASE_ID" in
  [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z) ;;
  *) fail "manifest releaseId is invalid" ;;
esac
APPROVAL_FILE="/etc/resume-ai/approved-releases/$RELEASE_ID.env"
[ -f "$APPROVAL_FILE" ] && [ ! -L "$APPROVAL_FILE" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$APPROVAL_FILE")" = "root:root:400:1" ] \
  || fail "frozen root-owned release approval is missing or unsafe"
declare -A approval=()
while IFS='=' read -r approval_key approval_value || [ -n "$approval_key" ]; do
  case "$approval_key" in SCHEMA_VERSION|RELEASE_ID|RELEASE_MANIFEST_SHA256|SOURCE_MANIFEST_SHA256|SHA256SUMS_SHA256|CONTROL_PLANE_SPEC_SHA256|EVIDENCE_HELPER_SHA256|TRUSTED_DEEP_SCAN_ATTESTATION_SHA256|TRUSTED_DEEP_SCAN_PRODUCER_SHA256|TRUSTED_DEEP_SCAN_COMPLETION_SHA256|LINUX_VALIDATION_ATTESTATION_SHA256|REQUIRED_TEST_POLICY_SHA256|APPROVED_AT) ;; *) fail "unknown release approval key" ;; esac
  [ -z "${approval[$approval_key]:-}" ] || fail "duplicate release approval key"
  approval[$approval_key]=$approval_value
done < "$APPROVAL_FILE"
[ "${#approval[@]}" -eq 13 ] && [ "${approval[SCHEMA_VERSION]:-}" = 6 ] \
  && [ "${approval[RELEASE_ID]:-}" = "$RELEASE_ID" ] \
  || fail "release approval identity mismatch"
for approved_hash_key in RELEASE_MANIFEST_SHA256 SOURCE_MANIFEST_SHA256 SHA256SUMS_SHA256 CONTROL_PLANE_SPEC_SHA256 EVIDENCE_HELPER_SHA256 TRUSTED_DEEP_SCAN_ATTESTATION_SHA256 TRUSTED_DEEP_SCAN_PRODUCER_SHA256 TRUSTED_DEEP_SCAN_COMPLETION_SHA256 LINUX_VALIDATION_ATTESTATION_SHA256 REQUIRED_TEST_POLICY_SHA256; do
  [[ "${approval[$approved_hash_key]:-}" =~ ^[a-f0-9]{64}$ ]] || fail "invalid approved release hash"
done
[ "$(sha256sum "$BUNDLE_DIR/release-manifest.json" | awk '{print $1}')" = "${approval[RELEASE_MANIFEST_SHA256]}" ] \
  && [ "$(sha256sum "$BUNDLE_DIR/source-manifest.txt" | awk '{print $1}')" = "${approval[SOURCE_MANIFEST_SHA256]}" ] \
  && [ "$(sha256sum "$BUNDLE_DIR/SHA256SUMS" | awk '{print $1}')" = "${approval[SHA256SUMS_SHA256]}" ] \
  || fail "bundle differs from its frozen root-owned approval"
observed_linux_validation_attestation_sha256="$(root_python - \
  "$BUNDLE_DIR/release-manifest.json" <<'PY'
import json
import pathlib
import re
import sys

def reject_duplicates(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result

try:
    manifest = json.loads(
        pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"),
        object_pairs_hook=reject_duplicates,
    )
except (OSError, UnicodeError, json.JSONDecodeError, ValueError) as error:
    raise SystemExit(f"release manifest is not strict JSON: {error}")
binding = manifest.get("linuxValidationAttestation") if isinstance(manifest, dict) else None
if (
    not isinstance(binding, dict)
    or set(binding) != {"evidenceMember", "artifactManifestMember", "sha256"}
    or binding.get("evidenceMember") != "linux-validation-attestation.json"
    or binding.get("artifactManifestMember") != "linux-validation-artifact-manifest.txt"
    or re.fullmatch(r"[a-f0-9]{64}", binding.get("sha256", "")) is None
):
    raise SystemExit("release manifest does not contain the exact signed Linux validation binding")
print(binding["sha256"])
PY
)" || fail "release manifest Linux validation binding cannot be parsed"
[ "$observed_linux_validation_attestation_sha256" = "${approval[LINUX_VALIDATION_ATTESTATION_SHA256]}" ] \
  || fail "signed Linux validation generation differs from the root approval"
root_python - "$BUNDLE_DIR/release-manifest.json" \
  "${approval[APPROVED_AT]:-}" "$RELEASE_ID" <<'PY'
import datetime
import json
import pathlib
import re
import sys

timestamp_pattern = re.compile(r"20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z")

def instant(value: object, label: str) -> datetime.datetime:
    if not isinstance(value, str) or timestamp_pattern.fullmatch(value) is None:
        raise SystemExit(f"{label} is not strict UTC ISO seconds")
    try:
        parsed = datetime.datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(
            tzinfo=datetime.timezone.utc
        )
    except ValueError:
        raise SystemExit(f"{label} is not a real UTC timestamp")
    if parsed.strftime("%Y-%m-%dT%H:%M:%SZ") != value:
        raise SystemExit(f"{label} is not canonical UTC ISO seconds")
    return parsed

def reject_duplicates(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result

try:
    manifest = json.loads(
        pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"),
        object_pairs_hook=reject_duplicates,
    )
except (OSError, UnicodeError, json.JSONDecodeError, ValueError) as error:
    raise SystemExit(f"release manifest is not strict JSON: {error}")
if not isinstance(manifest, dict) or manifest.get("releaseId") != sys.argv[3]:
    raise SystemExit("release manifest identity differs during freshness verification")
created_at = instant(manifest.get("createdAt"), "release manifest createdAt")
approved_at = instant(sys.argv[2], "root approval APPROVED_AT")
now = datetime.datetime.now(datetime.timezone.utc)
if created_at > approved_at:
    raise SystemExit("release approval predates bundle creation")
if approved_at > now or created_at > now:
    raise SystemExit("release creation or approval timestamp is in the future")
if (now - approved_at).total_seconds() > 24 * 60 * 60:
    raise SystemExit("root release approval is older than 24 hours at first deployment")
if (now - created_at).total_seconds() > 24 * 60 * 60:
    raise SystemExit("release bundle is older than 24 hours at first deployment")
PY
read -r observed_control_spec_sha observed_evidence_helper_sha \
  observed_required_test_policy_sha < <(root_python - \
  "$BUNDLE_DIR/source-manifest.txt" <<'PY'
import pathlib
import re
import sys

wanted = {"ops/config/control-plane-files.conf": None,
          "ops/bin/verify-release-evidence.mjs": None,
          "ops/config/release-required-tests.json": None}
for line in pathlib.Path(sys.argv[1]).read_text(encoding="utf-8").splitlines():
    match = re.fullmatch(r"([a-f0-9]{64})\t([FL])\t([^\t\r\n]+)", line)
    if match is None:
        raise SystemExit(2)
    digest, kind, relative = match.groups()
    if relative in wanted:
        if kind != "F" or wanted[relative] is not None:
            raise SystemExit(2)
        wanted[relative] = digest
if any(value is None for value in wanted.values()):
    raise SystemExit(2)
print(wanted["ops/config/control-plane-files.conf"],
      wanted["ops/bin/verify-release-evidence.mjs"],
      wanted["ops/config/release-required-tests.json"])
PY
) || fail "bundle source manifest does not bind control-plane/evidence helpers"
[ "$observed_control_spec_sha" = "${approval[CONTROL_PLANE_SPEC_SHA256]}" ] \
  && [ "$observed_evidence_helper_sha" = "${approval[EVIDENCE_HELPER_SHA256]}" ] \
  && [ "$observed_required_test_policy_sha" = "${approval[REQUIRED_TEST_POLICY_SHA256]}" ] \
  || fail "control-plane/evidence helper hashes differ from frozen approval"
EVIDENCE_HELPER=/usr/local/lib/resume-ai/verify-release-evidence.mjs
[ -f "$EVIDENCE_HELPER" ] && [ ! -L "$EVIDENCE_HELPER" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$EVIDENCE_HELPER")" = root:root:755:1 ] \
  && [ "$(sha256sum "$EVIDENCE_HELPER" | awk '{print $1}')" = "${approval[EVIDENCE_HELPER_SHA256]}" ] \
  || fail "installed semantic evidence verifier differs from the approved generation"
[ -f /etc/resume-ai/release-evidence-signing.pub ] \
  && [ ! -L /etc/resume-ai/release-evidence-signing.pub ] \
  && [ "$(stat -c '%U:%G:%a:%h' /etc/resume-ai/release-evidence-signing.pub)" = root:root:644:1 ] \
  || fail "Linux validation public trust anchor is missing or unsafe"
[ -f /usr/local/lib/resume-ai/release-required-tests.json ] \
  && [ ! -L /usr/local/lib/resume-ai/release-required-tests.json ] \
  && [ "$(stat -c '%U:%G:%a:%h' /usr/local/lib/resume-ai/release-required-tests.json)" = root:root:444:1 ] \
  && [ "$(sha256sum /usr/local/lib/resume-ai/release-required-tests.json | awk '{print $1}')" = "${approval[REQUIRED_TEST_POLICY_SHA256]}" ] \
  || fail "installed required-test policy differs from the independent root approval"
root_node "$EVIDENCE_HELPER" --bundle "$BUNDLE_DIR" \
  --trusted-generation-attestation-sha256 "${approval[TRUSTED_DEEP_SCAN_ATTESTATION_SHA256]}" \
  --trusted-generation-producer-sha256 "${approval[TRUSTED_DEEP_SCAN_PRODUCER_SHA256]}" \
  --trusted-deep-scan-completion-sha256 "${approval[TRUSTED_DEEP_SCAN_COMPLETION_SHA256]}" \
  || fail "release evidence failed the installed semantic verifier"
root_python - "$BUNDLE_DIR/SHA256SUMS" <<'PY'
import pathlib
import re
import sys

expected = {
    "source.tar.gz", "source-manifest.txt", "working-tree.patch",
    "working-tree-status.txt", "untracked-source.tar.gz", "untracked-source-paths.txt",
    "validation.log", "e2e-evidence.tar.gz",
    "e2e-result.json", "security-scan-report.txt", "security-scan-result.json",
    "baseline/competition-score-prospective-baseline.json",
    "release-manifest.json",
}
seen = set()
for line in pathlib.Path(sys.argv[1]).read_text(encoding="utf-8").splitlines():
    match = re.fullmatch(r"([a-f0-9]{64})  ([A-Za-z0-9._/-]+)", line)
    if not match or match.group(2) not in expected or match.group(2) in seen:
        raise SystemExit("unsafe or duplicate SHA256SUMS member")
    seen.add(match.group(2))
if seen != expected:
    raise SystemExit("SHA256SUMS does not cover the exact release artifact set")
PY
root_python - "$BUNDLE_DIR" <<'PY'
import os
import pathlib
import stat
import sys

root = pathlib.Path(sys.argv[1])
expected_files = {
    "SHA256SUMS", "source.tar.gz", "source-manifest.txt", "working-tree.patch",
    "working-tree-status.txt", "untracked-source.tar.gz", "untracked-source-paths.txt",
    "validation.log", "e2e-evidence.tar.gz",
    "e2e-result.json", "security-scan-report.txt", "security-scan-result.json",
    "release-manifest.json",
    "baseline/competition-score-prospective-baseline.json",
}
seen = set()
for directory, directories, files in os.walk(root, followlinks=False):
    for name in [*directories, *files]:
        path = pathlib.Path(directory, name)
        mode = path.lstat().st_mode
        if stat.S_ISLNK(mode) or not (stat.S_ISDIR(mode) or stat.S_ISREG(mode)):
            raise SystemExit(f"unsafe bundle member: {path.relative_to(root)}")
    for name in files:
        seen.add((pathlib.Path(directory, name).relative_to(root)).as_posix())
if seen != expected_files:
    raise SystemExit("release bundle contains missing or unapproved files")
PY
(
  cd "$BUNDLE_DIR"
  sha256sum -c SHA256SUMS
)

root_python - "$BUNDLE_DIR/source.tar.gz" "$BUNDLE_DIR/e2e-evidence.tar.gz" "$BUNDLE_DIR/untracked-source.tar.gz" "$BUNDLE_DIR/source-manifest.txt" <<'PY'
import pathlib
import sys
import tarfile

def validate(pathname, allow_symlinks, allow_empty=False, forbid_git=False):
  with tarfile.open(pathname, "r:gz") as archive:
    members = archive.getmembers()
    if (not members and not allow_empty) or len(members) > 250_000:
        raise SystemExit("archive is empty or has too many members")
    if sum(member.size for member in members if member.isfile()) > 4 * 1024**3:
        raise SystemExit("archive expands beyond the reviewed size ceiling")
    normalized = set()
    symlinks = set()
    payload = {}
    for member in members:
        path = pathlib.PurePosixPath(member.name)
        if "\n" in member.name or "\r" in member.name or path.is_absolute() or ".." in path.parts:
            raise SystemExit(f"unsafe archive member: {member.name}")
        canonical = path.as_posix().removeprefix("./") or "."
        if forbid_git and pathlib.PurePosixPath(canonical).parts[0] == ".git":
            raise SystemExit("source archive contains forbidden Git metadata")
        if canonical in normalized:
            raise SystemExit(f"duplicate archive member: {member.name}")
        normalized.add(canonical)
        if not (member.isfile() or member.isdir() or member.issym()):
            raise SystemExit(f"forbidden archive member type: {member.name}")
        if member.isfile():
            payload[canonical] = "F"
        if member.issym():
            if not allow_symlinks:
                raise SystemExit(f"symlink is forbidden in evidence archive: {member.name}")
            target = pathlib.PurePosixPath(member.linkname)
            if target.is_absolute() or ".." in target.parts:
                raise SystemExit(f"unsafe archive symlink: {member.name} -> {member.linkname}")
            symlinks.add(canonical)
            payload[canonical] = "L"
    for canonical in normalized:
        parts = pathlib.PurePosixPath(canonical).parts
        for index in range(1, len(parts)):
            if pathlib.PurePosixPath(*parts[:index]).as_posix() in symlinks:
                raise SystemExit(f"archive member traverses a symlink ancestor: {canonical}")
    return payload

expected_source = {}
for line in pathlib.Path(sys.argv[4]).read_text(encoding="utf-8").splitlines():
    fields = line.split("\t")
    if len(fields) != 3 or len(fields[0]) != 64 or fields[1] not in {"F", "L"}:
        raise SystemExit("source manifest contains a malformed archive row")
    if fields[2] in expected_source:
        raise SystemExit("source manifest contains a duplicate archive member")
    expected_source[fields[2]] = fields[1]
observed_source = validate(sys.argv[1], True, forbid_git=True)
if observed_source != expected_source or any(
    pathlib.PurePosixPath(path).parts[0] == ".git" for path in observed_source
):
    raise SystemExit("source archive payload is not the exact approved manifest inventory")
validate(sys.argv[2], False)
validate(sys.argv[3], True, allow_empty=True)
PY
root_python - "$BUNDLE_DIR/e2e-evidence.tar.gz" "$BUNDLE_DIR/e2e-result.json" <<'PY'
import hashlib
import json
import pathlib
import sys
import tarfile

result = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding="utf-8"))
expected = result.get("playwrightReportSha256")
if not isinstance(expected, str) or len(expected) != 64:
    raise SystemExit("E2E result has no Playwright reporter hash")
with tarfile.open(sys.argv[1], "r:gz") as archive:
    members = [
        member for member in archive.getmembers()
        if pathlib.PurePosixPath(member.name).as_posix().removeprefix("./") == "playwright-report.json"
    ]
    if len(members) != 1 or not members[0].isfile():
        raise SystemExit("E2E evidence must contain exactly one Playwright JSON report")
    if members[0].size > 128 * 1024**2:
        raise SystemExit("Playwright JSON report exceeds the 128 MiB evidence ceiling")
    stream = archive.extractfile(members[0])
    if stream is None:
        raise SystemExit("Playwright JSON report cannot be read")
    raw = stream.read(128 * 1024**2 + 1)
    if len(raw) > 128 * 1024**2:
        raise SystemExit("Playwright JSON report exceeded its declared evidence ceiling")
if hashlib.sha256(raw).hexdigest() != expected:
    raise SystemExit("Playwright JSON report hash differs from E2E result")
report = json.loads(raw)
projects = {project.get("name") for project in report.get("config", {}).get("projects", [])}
if not {"desktop", "mobile"}.issubset(projects):
    raise SystemExit("Playwright JSON report lacks desktop/mobile projects")
if report.get("stats", {}).get("unexpected") != 0 or report.get("stats", {}).get("expected", 0) <= 0:
    raise SystemExit("Playwright JSON report is not passing")
passed = set()
def visit(suite):
    for spec in suite.get("specs", []):
        for test in spec.get("tests", []):
            statuses = {entry.get("status") for entry in test.get("results", [])}
            if statuses - {"passed", "skipped"}:
                raise SystemExit("Playwright JSON report contains a failed result")
            if "passed" in statuses:
                passed.add(test.get("projectName"))
    for child in suite.get("suites", []):
        visit(child)
for suite in report.get("suites", []):
    visit(suite)
if not {"desktop", "mobile"}.issubset(passed):
    raise SystemExit("Playwright report does not prove a pass in both projects")
PY

SOURCE_MANIFEST_SHA256="$(sha256sum "$BUNDLE_DIR/source-manifest.txt" | awk '{print $1}')"
SOURCE_ARCHIVE_SHA256="$(sha256sum "$BUNDLE_DIR/source.tar.gz" | awk '{print $1}')"
BASELINE_SHA256="$(sha256sum "$BUNDLE_DIR/baseline/competition-score-prospective-baseline.json" | awk '{print $1}')"
SECURITY_REPORT_SHA256="$(sha256sum "$BUNDLE_DIR/security-scan-report.txt" | awk '{print $1}')"
root_node -e '
  const fs = require("node:fs");
  const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const e2e = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  const security = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
  const baselineArtifact = JSON.parse(fs.readFileSync(process.argv[10], "utf8"));
  const [expected, sourceArchive, baseline, securityReport, releaseId] = process.argv.slice(4);
  if (manifest?.schemaVersion !== 1 || manifest?.releaseId !== releaseId || manifest?.secretFilesIncluded !== false) process.exit(2);
  if (manifest?.rollbackRelease !== "none" && !/^20\d{6}T\d{6}Z$/u.test(manifest?.rollbackRelease ?? "")) process.exit(2);
  if (manifest?.sourceArchive !== "source.tar.gz" || manifest?.sourceSha256 !== sourceArchive) process.exit(2);
  if (manifest?.sourceManifest !== "source-manifest.txt" || manifest?.sourceManifestSha256 !== expected) process.exit(2);
  if (manifest?.validationLog !== "validation.log" || manifest?.e2eEvidence !== "e2e-evidence.tar.gz" || manifest?.e2eResult !== "e2e-result.json") process.exit(2);
  if (manifest?.playwrightReportSha256 !== e2e?.playwrightReportSha256 || manifest?.securityScanReport !== "security-scan-report.txt" || manifest?.securityScanReportSha256 !== securityReport || manifest?.securityScanResult !== "security-scan-result.json") process.exit(2);
  if (manifest?.trackedWorkingTreePatch !== "working-tree.patch" || manifest?.untrackedSourceArchive !== "untracked-source.tar.gz" || manifest?.untrackedSourcePaths !== "untracked-source-paths.txt") process.exit(2);
  const baselineBoundary = manifest?.prospectiveBaseline;
  if (baselineBoundary?.bundlePath !== "baseline/competition-score-prospective-baseline.json" || baselineBoundary?.byteSha256 !== baseline) process.exit(2);
  if (!["bootstrap", "carry-forward"].includes(baselineBoundary?.mode)) process.exit(10);
  if (!/^20\d{6}T\d{6}Z$/u.test(baselineBoundary?.originReleaseId ?? "") || !/^[a-f0-9]{64}$/u.test(baselineBoundary?.originSourceArchiveSha256 ?? "")) process.exit(10);
  const canonicalJson = (value) => {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
    if (value && typeof value === "object") return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
    return JSON.stringify(value);
  };
  const {artifactSha256, ...baselineWithoutHash} = baselineArtifact;
  const computedArtifactHash = require("node:crypto").createHash("sha256").update(canonicalJson(baselineWithoutHash)).digest("hex");
  if (artifactSha256 !== computedArtifactHash || baselineBoundary?.artifactSha256 !== artifactSha256) process.exit(10);
  if (baselineArtifact?.provenance?.releaseId !== baselineBoundary.originReleaseId || baselineArtifact?.provenance?.sourceArchiveSha256 !== baselineBoundary.originSourceArchiveSha256) process.exit(10);
  if (baselineBoundary.mode === "bootstrap" && (baselineBoundary.originReleaseId !== releaseId || baselineBoundary.originSourceArchiveSha256 !== sourceArchive)) process.exit(10);
  if (baselineBoundary.mode === "carry-forward" && (manifest?.rollbackRelease === "none" || baselineBoundary.originReleaseId === releaseId)) process.exit(10);
  const databaseContract = manifest?.databaseContract;
  if (databaseContract?.schemaVersion !== 1 || databaseContract?.runtimeRequiresDirectDelete !== false || databaseContract?.functionOwnerRoleSuffix !== "_owner") process.exit(7);
  const sourceEntries = new Map(fs.readFileSync(process.argv[9], "utf8").trim().split("\n").map((line) => {
    const [hash, kind, path] = line.split("\t");
    return [path, { hash, kind }];
  }));
  for (const [key, path] of [
    ["migrationsManifestSha256", "ops/config/migrations.manifest"],
    ["runtimeTablePolicySha256", "ops/postgresql/runtime-table-privileges.conf"],
    ["runtimeFunctionPolicySha256", "ops/postgresql/runtime-function-privileges.conf"]
  ]) {
    if (!/^[a-f0-9]{64}$/u.test(databaseContract[key] ?? "") || sourceEntries.get(path)?.kind !== "F" || sourceEntries.get(path)?.hash !== databaseContract[key]) process.exit(8);
  }
  if (e2e?.schemaVersion !== 1 || e2e?.status !== "passed" || e2e?.failed !== 0) process.exit(3);
  if (e2e?.sourceManifestSha256 !== expected) process.exit(4);
  if (e2e?.browsers?.desktop !== true || e2e?.browsers?.mobile !== true) process.exit(5);
  if (e2e?.redirects?.www !== true) process.exit(6);
  if (security?.schemaVersion !== 1 || security?.scanType !== "codex-security-deep-scan" || security?.status !== "passed" || security?.sourceManifestSha256 !== expected || security?.reportSha256 !== securityReport || security?.validatedOpenFindings !== 0 || security?.untriagedFindings !== 0) process.exit(9);
' "$BUNDLE_DIR/release-manifest.json" "$BUNDLE_DIR/e2e-result.json" \
  "$BUNDLE_DIR/security-scan-result.json" "$SOURCE_MANIFEST_SHA256" \
  "$SOURCE_ARCHIVE_SHA256" "$BASELINE_SHA256" "$SECURITY_REPORT_SHA256" "$RELEASE_ID" \
  "$BUNDLE_DIR/source-manifest.txt" \
  "$BUNDLE_DIR/baseline/competition-score-prospective-baseline.json" \
  || fail "release/E2E provenance validation failed"

RELEASE_ROOT=/opt/resume-ai/releases
BUILD_ROOT=/opt/resume-ai/build-staging
VERIFY_ROOT=/opt/resume-ai/verify-staging
ARTIFACT_ROOT=/opt/resume-ai/release-artifacts
CACHE_ROOT=/var/cache/resume-ai
STATE_DIR=/opt/resume-ai/state
STATE_FILE="$STATE_DIR/active.env"
PENDING_FILE="$STATE_DIR/deploy.pending"
CURRENT_LINK=/opt/resume-ai/current
NGINX_UPSTREAM=/etc/nginx/conf.d/10-resume-ai-upstream.conf
PM2_HOME=/var/lib/resume-ai/.pm2
FINAL_RELEASE="$RELEASE_ROOT/$RELEASE_ID"
STAGING_RELEASE="$BUILD_ROOT/$RELEASE_ID"
VERIFY_RELEASE="$VERIFY_ROOT/$RELEASE_ID"
SOAK_SECONDS="${SOAK_SECONDS:-1800}"
SOAK_INTERVAL_SECONDS="${SOAK_INTERVAL_SECONDS:-10}"
PUBLIC_URL="${PUBLIC_URL:-https://siyuanjiaxin.com/}"
case "$SOAK_SECONDS:$SOAK_INTERVAL_SECONDS" in *[!0-9:]*) fail "soak values must be integers" ;; esac
[ "$SOAK_SECONDS" -ge 1800 ] || fail "SOAK_SECONDS must be at least 1800"
[ "$SOAK_INTERVAL_SECONDS" -ge 5 ] || fail "SOAK_INTERVAL_SECONDS must be at least 5"

for directory in "$RELEASE_ROOT" "$BUILD_ROOT" "$VERIFY_ROOT" "$ARTIFACT_ROOT" "$STATE_DIR"; do
  [ -d "$directory" ] || fail "runtime layout is missing: $directory"
done
[ -f /etc/resume-ai/quota.env ] || fail "quota environment is missing"
[ -f "$STATE_FILE" ] && [ -L "$CURRENT_LINK" ] && [ -f "$NGINX_UPSTREAM" ] \
  || fail "release state is not initialized"
[ ! -e "$FINAL_RELEASE" ] && [ ! -e "$STAGING_RELEASE" ] && [ ! -e "$VERIFY_RELEASE" ] \
  || fail "release or staging path already exists"
/usr/local/lib/resume-ai/validate-app-env.sh production

if [ -e "$PENDING_FILE" ]; then /usr/local/lib/resume-ai/recover-deployment-state.sh; fi

ACTIVE_PORT=""
ACTIVE_RELEASE=""
PREVIOUS_PORT=none
PREVIOUS_RELEASE=none
while IFS='=' read -r state_key state_value || [ -n "$state_key" ]; do
  case "$state_key" in
    ACTIVE_PORT|ACTIVE_RELEASE|PREVIOUS_PORT|PREVIOUS_RELEASE) printf -v "$state_key" '%s' "$state_value" ;;
    SWITCHED_AT|'') ;;
    *) fail "unknown active state key: $state_key" ;;
  esac
done < "$STATE_FILE"
case "$ACTIVE_PORT:$ACTIVE_RELEASE" in 3000:20??????T??????Z|3001:20??????T??????Z) ;; *) fail "invalid active state" ;; esac
case "$PREVIOUS_PORT:$PREVIOUS_RELEASE" in none:none|3000:20??????T??????Z|3001:20??????T??????Z) ;; *) fail "invalid previous state" ;; esac
[ -d "$RELEASE_ROOT/$ACTIVE_RELEASE" ] || fail "active release is missing"
DECLARED_ROLLBACK_RELEASE="$(root_node -e '
  const fs = require("node:fs");
  const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (typeof value.rollbackRelease !== "string") process.exit(2);
  process.stdout.write(value.rollbackRelease);
' "$BUNDLE_DIR/release-manifest.json")" \
  || fail "release manifest rollback target is missing"
[ "$DECLARED_ROLLBACK_RELEASE" = "$ACTIVE_RELEASE" ] \
  || fail "release manifest rollback target differs from the currently active release"
case "$ACTIVE_PORT" in 3000) CANDIDATE_PORT=3001 ;; 3001) CANDIDATE_PORT=3000 ;; esac
ACTIVE_REQUIRES_DIRECT_DELETE=1
active_release_manifest="$ARTIFACT_ROOT/$ACTIVE_RELEASE/release-manifest.json"
if [ -f "$active_release_manifest" ] && [ ! -L "$active_release_manifest" ]; then
  if root_node -e '
    const fs = require("node:fs");
    const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    process.exit(value?.databaseContract?.schemaVersion === 1
      && value.databaseContract.runtimeRequiresDirectDelete === false ? 0 : 1);
  ' "$active_release_manifest"; then
    ACTIVE_REQUIRES_DIRECT_DELETE=0
  fi
fi

umask 077
STATE_BACKUP="$(mktemp /tmp/resume-ai-state.XXXXXX)"
UPSTREAM_BACKUP="$(mktemp /tmp/resume-ai-upstream.XXXXXX)"
DATABASE_STATE_BACKUP="$(mktemp /tmp/resume-ai-database-state.XXXXXX)"
DATABASE_STATE_EXISTED=0
APPROVAL_FILE_SHA256="$(sha256sum "$APPROVAL_FILE" | awk '{print $1}')"
cp -- "$STATE_FILE" "$STATE_BACKUP"
cp -- "$NGINX_UPSTREAM" "$UPSTREAM_BACKUP"
if [ -f "$STATE_DIR/database-permissions.env" ] && [ ! -L "$STATE_DIR/database-permissions.env" ]; then
  cp -- "$STATE_DIR/database-permissions.env" "$DATABASE_STATE_BACKUP"
  DATABASE_STATE_EXISTED=1
fi
ORIGINAL_CURRENT_TARGET="$(readlink "$CURRENT_LINK")"
CANDIDATE_SLOT_TOUCHED=0
SWITCH_STARTED=0
DEPLOYMENT_COMMITTED=0
DB_PERMISSIONS_HARDENED=0
TEST_DATABASE=""
TEST_RUNTIME_ROLE=""
TEST_PG_DATA_DIR=""
TEST_PG_UNIT=""
VERIFY_CREDENTIAL_FILE=""
VERIFY_HOSTS_FILE=""
REGISTRY_HOSTS_FILE=""
MIGRATION_TEMP_DIR=""
BUILD_HOME="/run/resume-ai-build-home.$RELEASE_ID"

kill_service_account_processes() {
  local account=$1 uid
  uid="$(id -u "$account")"
  pkill -KILL -u "$uid" >/dev/null 2>&1 || true
  for ((_attempt = 0; _attempt < 50; _attempt += 1)); do
    pgrep -u "$uid" >/dev/null 2>&1 || return 0
    sleep 0.1
  done
  return 1
}

remove_builder_home() {
  case "$BUILD_HOME" in /run/resume-ai-build-home.20??????T??????Z) ;; *) return 1 ;; esac
  [ ! -e "$BUILD_HOME" ] && [ ! -L "$BUILD_HOME" ] && return 0
  [ -d "$BUILD_HOME" ] && [ ! -L "$BUILD_HOME" ] \
    && [ "$(readlink -e -- "$BUILD_HOME")" = "$BUILD_HOME" ] \
    || return 1
  root_python - "$BUILD_HOME" <<'PY' || return 1
import pathlib
import sys

root = pathlib.Path(sys.argv[1]).resolve(strict=True)
if root.parent != pathlib.Path("/run"):
    raise SystemExit(1)
for line in pathlib.Path("/proc/self/mountinfo").read_text(encoding="utf-8").splitlines():
    fields = line.split()
    if len(fields) < 5:
        raise SystemExit(1)
    mount = pathlib.Path(fields[4].replace("\\040", " ").replace("\\011", "\t").replace("\\012", "\n").replace("\\134", "\\"))
    try:
        mount.relative_to(root)
    except ValueError:
        continue
    raise SystemExit(1)
PY
  /usr/bin/find "$BUILD_HOME" -xdev -depth -delete || return 1
  [ ! -e "$BUILD_HOME" ] && [ ! -L "$BUILD_HOME" ]
}

prepare_builder_identity() {
  kill_service_account_processes resume-ai-build \
    || fail "resume-ai-build was not idle before a transient build unit"
  remove_builder_home || fail "stale one-release builder home is unsafe"
  install -d -o resume-ai-build -g resume-ai-build -m 0700 "$BUILD_HOME"
  [ -d "$BUILD_HOME" ] && [ ! -L "$BUILD_HOME" ] \
    && [ "$(readlink -e -- "$BUILD_HOME")" = "$BUILD_HOME" ] \
    && [ "$(stat -c '%U:%G:%a' "$BUILD_HOME")" = resume-ai-build:resume-ai-build:700 ] \
    && [ -z "$(/usr/bin/find "$BUILD_HOME" -mindepth 1 -print -quit)" ] \
    || fail "one-release builder home is not an empty dedicated directory"
}

finish_builder_identity() {
  local label=$1
  kill_service_account_processes resume-ai-build \
    || fail "resume-ai-build retained a process after $label"
  remove_builder_home || fail "one-release builder home cleanup failed after $label"
}

set_tree_readonly_for_builder() {
  local tree=$1
  root_python - "$tree" "$(id -g resume-ai-build)" <<'PY'
import os
import pathlib
import stat
import sys

root = pathlib.Path(sys.argv[1]).resolve(strict=True)
gid = int(sys.argv[2])

def fchmod_nofollow(path, expected, mode, *, directory):
    flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC
    if directory:
        flags |= os.O_DIRECTORY
    descriptor = os.open(path, flags)
    try:
        opened = os.fstat(descriptor)
        if (
            opened.st_dev != expected.st_dev
            or opened.st_ino != expected.st_ino
            or opened.st_mode != expected.st_mode
            or opened.st_nlink != expected.st_nlink
        ):
            raise SystemExit(f"member changed before freeze: {path.relative_to(root)}")
        os.fchmod(descriptor, mode)
    finally:
        os.close(descriptor)

for directory, directories, files in os.walk(root, topdown=True, followlinks=False):
    for name in [*directories, *files]:
        member = pathlib.Path(directory, name)
        metadata = member.lstat()
        if stat.S_ISLNK(metadata.st_mode):
            os.chown(member, 0, gid, follow_symlinks=False)
        elif stat.S_ISDIR(metadata.st_mode):
            os.chown(member, 0, gid, follow_symlinks=False)
            fchmod_nofollow(member, member.lstat(), 0o750, directory=True)
        elif stat.S_ISREG(metadata.st_mode) and metadata.st_nlink == 1:
            executable = bool(stat.S_IMODE(metadata.st_mode) & 0o111)
            os.chown(member, 0, gid, follow_symlinks=False)
            fchmod_nofollow(member, member.lstat(), 0o750 if executable else 0o640, directory=False)
        else:
            raise SystemExit(f"unsafe member while freezing builder source: {member.relative_to(root)}")
root_metadata = root.lstat()
if not stat.S_ISDIR(root_metadata.st_mode) or stat.S_ISLNK(root_metadata.st_mode):
    raise SystemExit("builder source root is unsafe")
os.chown(root, 0, gid, follow_symlinks=False)
fchmod_nofollow(root, root.lstat(), 0o750, directory=True)
PY
}

set_tree_readonly_for_runtime() {
  local tree=$1 runtime_gid
  runtime_gid="$(id -g resume-ai)" \
    && [[ "$runtime_gid" =~ ^[1-9][0-9]*$ ]] \
    || fail "resume-ai runtime group is unavailable"
  root_python - "$tree" "$runtime_gid" <<'PY'
import os
import pathlib
import stat
import sys

root = pathlib.Path(sys.argv[1]).resolve(strict=True)
gid = int(sys.argv[2])

def fchmod_nofollow(path, expected, mode, *, directory):
    flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC
    if directory:
        flags |= os.O_DIRECTORY
    descriptor = os.open(path, flags)
    try:
        opened = os.fstat(descriptor)
        if (
            opened.st_dev != expected.st_dev
            or opened.st_ino != expected.st_ino
            or opened.st_mode != expected.st_mode
            or opened.st_nlink != expected.st_nlink
        ):
            raise SystemExit(f"member changed before runtime freeze: {path.relative_to(root)}")
        os.fchmod(descriptor, mode)
    finally:
        os.close(descriptor)

for directory, directories, files in os.walk(root, topdown=True, followlinks=False):
    for name in [*directories, *files]:
        member = pathlib.Path(directory, name)
        metadata = member.lstat()
        if stat.S_ISLNK(metadata.st_mode):
            os.chown(member, 0, gid, follow_symlinks=False)
        elif stat.S_ISDIR(metadata.st_mode):
            os.chown(member, 0, gid, follow_symlinks=False)
            fchmod_nofollow(member, member.lstat(), 0o750, directory=True)
        elif stat.S_ISREG(metadata.st_mode) and metadata.st_nlink == 1:
            executable = bool(stat.S_IMODE(metadata.st_mode) & 0o111)
            os.chown(member, 0, gid, follow_symlinks=False)
            fchmod_nofollow(member, member.lstat(), 0o750 if executable else 0o640, directory=False)
        else:
            raise SystemExit(f"unsafe member while freezing runtime source: {member.relative_to(root)}")
root_metadata = root.lstat()
if not stat.S_ISDIR(root_metadata.st_mode) or stat.S_ISLNK(root_metadata.st_mode):
    raise SystemExit("runtime source root is unsafe")
os.chown(root, 0, gid, follow_symlinks=False)
fchmod_nofollow(root, root.lstat(), 0o750, directory=True)
PY
}

set_tree_writable_by_builder() {
  local tree=$1
  root_python - "$tree" "$(id -u resume-ai-build)" "$(id -g resume-ai-build)" <<'PY'
import os
import pathlib
import stat
import sys

root = pathlib.Path(sys.argv[1]).resolve(strict=True)
uid, gid = map(int, sys.argv[2:])

def fchmod_nofollow(path, expected, mode, *, directory):
    flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC
    if directory:
        flags |= os.O_DIRECTORY
    descriptor = os.open(path, flags)
    try:
        opened = os.fstat(descriptor)
        if (
            opened.st_dev != expected.st_dev
            or opened.st_ino != expected.st_ino
            or opened.st_mode != expected.st_mode
            or opened.st_nlink != expected.st_nlink
        ):
            raise SystemExit(f"member changed before writable transition: {path.relative_to(root)}")
        os.fchmod(descriptor, mode)
    finally:
        os.close(descriptor)

for directory, directories, files in os.walk(root, topdown=True, followlinks=False):
    for name in [*directories, *files]:
        member = pathlib.Path(directory, name)
        metadata = member.lstat()
        if stat.S_ISLNK(metadata.st_mode):
            os.chown(member, uid, gid, follow_symlinks=False)
        elif stat.S_ISDIR(metadata.st_mode):
            os.chown(member, uid, gid, follow_symlinks=False)
            fchmod_nofollow(member, member.lstat(), 0o700, directory=True)
        elif stat.S_ISREG(metadata.st_mode) and metadata.st_nlink == 1:
            executable = bool(stat.S_IMODE(metadata.st_mode) & 0o111)
            os.chown(member, uid, gid, follow_symlinks=False)
            fchmod_nofollow(member, member.lstat(), 0o700 if executable else 0o600, directory=False)
        else:
            raise SystemExit(f"unsafe member while opening builder output: {member.relative_to(root)}")
root_metadata = root.lstat()
if not stat.S_ISDIR(root_metadata.st_mode) or stat.S_ISLNK(root_metadata.st_mode):
    raise SystemExit("builder output root is unsafe")
os.chown(root, uid, gid, follow_symlinks=False)
fchmod_nofollow(root, root.lstat(), 0o700, directory=True)
PY
}

assert_builder_owned_output() {
  local tree=$1
  root_python /usr/local/lib/resume-ai/hash-runtime-tree.py --root "$tree" \
    --expected-uid "$(id -u resume-ai-build)" \
    --expected-gid "$(id -g resume-ai-build)" >/dev/null
}

hash_runtime_tree() {
  root_python /usr/local/lib/resume-ai/hash-runtime-tree.py "$@"
}

cleanup_ephemeral_credentials() {
  rm -f -- "${VERIFY_CREDENTIAL_FILE:-}" "${VERIFY_HOSTS_FILE:-}" \
    "${REGISTRY_HOSTS_FILE:-}"
  VERIFY_CREDENTIAL_FILE=""
  VERIFY_HOSTS_FILE=""
  REGISTRY_HOSTS_FILE=""
  kill_service_account_processes resume-ai-verify || true
  kill_service_account_processes resume-ai-build || true
  remove_builder_home || true
  if [[ "${MIGRATION_TEMP_DIR:-}" == /run/resume-ai-migrations.* ]] && [ -d "$MIGRATION_TEMP_DIR" ]; then
    find "$MIGRATION_TEMP_DIR" -depth -delete >/dev/null 2>&1 || true
    MIGRATION_TEMP_DIR=""
  fi
  if [[ "${TEST_PG_UNIT:-}" == resume-ai-pgtest-20??????t??????z.service ]]; then
    systemctl stop "$TEST_PG_UNIT" >/dev/null 2>&1 || true
    systemctl reset-failed "$TEST_PG_UNIT" >/dev/null 2>&1 || true
    TEST_PG_UNIT=""
  fi
  kill_service_account_processes resume-ai-pgtest || true
  if [[ "${TEST_PG_DATA_DIR:-}" == /run/resume-ai-pgtest.20??????T??????Z ]] \
    && [ -d "$TEST_PG_DATA_DIR" ] && [ ! -L "$TEST_PG_DATA_DIR" ]; then
    find "$TEST_PG_DATA_DIR" -xdev -depth -delete >/dev/null 2>&1 || true
    TEST_PG_DATA_DIR=""
  fi
}

pm2_as_app() {
  runuser -u resume-ai -- env -i HOME=/var/lib/resume-ai PM2_HOME="$PM2_HOME" \
    PATH=/opt/nodejs/current/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin "$@"
}

start_release_process() {
  local release=$1
  local port=$2
  local process_name="resume-ai-$port"
  pm2_as_app pm2 delete "$process_name" >/dev/null 2>&1 || true
  pm2_as_app env APP_RELEASE_DIR="$RELEASE_ROOT/$release" APP_PORT="$port" \
    APP_PROCESS_NAME="$process_name" pm2 start \
    "$RELEASE_ROOT/$release/ops/pm2/ecosystem.config.cjs" --update-env
}

write_journal() {
  local phase=$1
  local journal_temp
  journal_temp="$(mktemp "$STATE_DIR/.deploy-pending.XXXXXX")"
  cat > "$journal_temp" <<EOF
KIND=deploy
PHASE=$phase
OLD_ACTIVE_PORT=$ACTIVE_PORT
OLD_ACTIVE_RELEASE=$ACTIVE_RELEASE
OLD_PREVIOUS_PORT=$PREVIOUS_PORT
OLD_PREVIOUS_RELEASE=$PREVIOUS_RELEASE
NEW_PORT=$CANDIDATE_PORT
NEW_RELEASE=$RELEASE_ID
NEW_PREVIOUS_PORT=$ACTIVE_PORT
NEW_PREVIOUS_RELEASE=$ACTIVE_RELEASE
APPROVAL_FILE_SHA256=$APPROVAL_FILE_SHA256
EOF
  chown root:resume-ai "$journal_temp"
  chmod 0640 "$journal_temp"
  mv -f -- "$journal_temp" "$PENDING_FILE"
  sync -f "$PENDING_FILE"
  sync -f "$STATE_DIR"
}

safe_remove_uncommitted_tree() {
  local root=$1 release_id=$2 member="$1/$2"
  [ ! -e "$member" ] && [ ! -L "$member" ] && return 0
  case "$member" in "$root"/20??????T??????Z) ;; *) return 1 ;; esac
  [ -d "$member" ] && [ ! -L "$member" ] || return 1
  root_python - "$member" <<'PY' || return 1
import pathlib
import sys

root = pathlib.Path(sys.argv[1]).resolve(strict=True)
mountinfo = pathlib.Path("/proc/self/mountinfo")
if not mountinfo.is_file():
    raise SystemExit(1)
for line in mountinfo.read_text(encoding="utf-8").splitlines():
    fields = line.split()
    if len(fields) < 5:
        raise SystemExit(1)
    mount = pathlib.Path(fields[4].replace("\\040", " ").replace("\\011", "\t").replace("\\012", "\n").replace("\\134", "\\"))
    try:
        mount.relative_to(root)
    except ValueError:
        continue
    raise SystemExit(1)
PY
  find "$member" -xdev -depth -delete || return 1
  [ ! -e "$member" ] && [ ! -L "$member" ]
}

cleanup_uncommitted_publish() {
  local managed_root
  for managed_root in "$RELEASE_ROOT" "$ARTIFACT_ROOT" "$CACHE_ROOT" "$BUILD_ROOT" "$VERIFY_ROOT"; do
    safe_remove_uncommitted_tree "$managed_root" "$RELEASE_ID" \
      || return 1
    sync -f "$managed_root" || return 1
  done
}

write_deployment_complete_marker() {
  local marker="$ARTIFACT_DIR/deployment-complete.env" marker_temp
  [ ! -e "$marker" ] && [ ! -L "$marker" ] \
    || fail "deployment completion marker already exists"
  marker_temp="$(mktemp "$ARTIFACT_DIR/.deployment-complete.XXXXXX")"
  cat > "$marker_temp" <<EOF
SCHEMA_VERSION=2
RELEASE_ID=$RELEASE_ID
COMPLETED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
RELEASE_MANIFEST_SHA256=${approval[RELEASE_MANIFEST_SHA256]}
ROLLBACK_RELEASE=$ACTIVE_RELEASE
APPROVAL_FILE_SHA256=$APPROVAL_FILE_SHA256
EOF
  chown root:root "$marker_temp"
  chmod 0400 "$marker_temp"
  sync -f "$marker_temp"
  mv -- "$marker_temp" "$marker"
  sync -f "$ARTIFACT_DIR"
  sync -f "$ARTIFACT_ROOT"
}

restore_previous_state() {
  local exit_status=$?
  trap - ERR EXIT
  set +e
  [ "$exit_status" -ne 0 ] || exit_status=1
  cleanup_deploy_input_snapshot
  cleanup_ephemeral_credentials
  if [ "$DEPLOYMENT_COMMITTED" -eq 0 ]; then
    # Persist the rollback decision before changing database, proxy, pointer, or
    # control-plane state.  This overrides state_committed only while the local
    # transaction is still rollbackable, so boot recovery and the independent
    # control journal cannot mistakenly complete candidate controls forward.
    if [ -f "$PENDING_FILE" ] && [ ! -L "$PENDING_FILE" ]; then
      if ! write_journal rollback_decided; then
        printf '%s\n' "Rollback decision could not be made durable; recovery journals were retained." >&2
        rm -f -- "$STATE_BACKUP" "$UPSTREAM_BACKUP" "$DATABASE_STATE_BACKUP"
        exit "$exit_status"
      fi
    fi
    if [ "$DB_PERMISSIONS_HARDENED" -eq 1 ] && [ "$ACTIVE_REQUIRES_DIRECT_DELETE" -eq 1 ]; then
      if ! ACK_POSTGRES_LEGACY_DELETE=YES \
        /usr/local/lib/resume-ai/provision-postgres-runtime-role.sh \
          grant-legacy-delete "$ACTIVE_RELEASE" >/dev/null 2>&1; then
        printf '%s\n' "Database compatibility restoration failed; refusing to switch traffic to the legacy release. Durable recovery journal retained." >&2
        rm -f -- "$STATE_BACKUP" "$UPSTREAM_BACKUP" "$DATABASE_STATE_BACKUP"
        exit "$exit_status"
      fi
    fi
    if [ "$SWITCH_STARTED" -eq 1 ]; then
      if ! cp -- "$UPSTREAM_BACKUP" "$NGINX_UPSTREAM" \
        || ! sync -f "$NGINX_UPSTREAM" \
        || ! sync -f /etc/nginx/conf.d \
        || ! nginx -t >/dev/null 2>&1 \
        || ! systemctl reload nginx >/dev/null 2>&1; then
        printf '%s\n' \
          "Nginx rollback could not be durably validated and reloaded; managed pointers were not changed and the recovery journal was retained." >&2
        rm -f -- "$STATE_BACKUP" "$UPSTREAM_BACKUP" "$DATABASE_STATE_BACKUP"
        exit "$exit_status"
      fi
      rollback_link="/opt/resume-ai/.current-rollback-$RELEASE_ID"
      if ! rm -f -- "$rollback_link" \
        || ! ln -s "$ORIGINAL_CURRENT_TARGET" "$rollback_link" \
        || ! mv -Tf -- "$rollback_link" "$CURRENT_LINK" \
        || ! cp -- "$STATE_BACKUP" "$STATE_FILE" \
        || ! sync -f "$STATE_FILE" \
        || ! sync -f "$STATE_DIR" \
        || ! sync -f /opt/resume-ai; then
        printf '%s\n' \
          "Release pointer rollback was incomplete; the durable recovery journal was retained." >&2
        rm -f -- "$STATE_BACKUP" "$UPSTREAM_BACKUP" "$DATABASE_STATE_BACKUP"
        exit "$exit_status"
      fi
      if [ "$DATABASE_STATE_EXISTED" -eq 1 ]; then
        if ! cp -- "$DATABASE_STATE_BACKUP" "$STATE_DIR/database-permissions.env" \
          || ! chown root:resume-ai "$STATE_DIR/database-permissions.env" \
          || ! chmod 0640 "$STATE_DIR/database-permissions.env"; then
          printf '%s\n' \
            "Database permission-state rollback was incomplete; the durable recovery journal was retained." >&2
          rm -f -- "$STATE_BACKUP" "$UPSTREAM_BACKUP" "$DATABASE_STATE_BACKUP"
          exit "$exit_status"
        fi
      else
        if ! rm -f -- "$STATE_DIR/database-permissions.env"; then
          printf '%s\n' \
            "Database permission-state cleanup failed; the durable recovery journal was retained." >&2
          rm -f -- "$STATE_BACKUP" "$UPSTREAM_BACKUP" "$DATABASE_STATE_BACKUP"
          exit "$exit_status"
        fi
      fi
      if ! sync -f "$STATE_DIR"; then
        printf '%s\n' \
          "Rolled-back state could not be durably synced; the recovery journal was retained." >&2
        rm -f -- "$STATE_BACKUP" "$UPSTREAM_BACKUP" "$DATABASE_STATE_BACKUP"
        exit "$exit_status"
      fi
    fi
    if [ "$CANDIDATE_SLOT_TOUCHED" -eq 1 ]; then
      pm2_as_app pm2 delete "resume-ai-$CANDIDATE_PORT" >/dev/null 2>&1 || true
      if pm2_as_app pm2 describe "resume-ai-$CANDIDATE_PORT" >/dev/null 2>&1; then
        printf '%s\n' \
          "Candidate PM2 process survived rollback; the durable recovery journal was retained." >&2
        rm -f -- "$STATE_BACKUP" "$UPSTREAM_BACKUP" "$DATABASE_STATE_BACKUP"
        exit "$exit_status"
      fi
      if [ "$PREVIOUS_PORT" = "$CANDIDATE_PORT" ] && [ "$PREVIOUS_RELEASE" != none ] \
        && [ -d "$RELEASE_ROOT/$PREVIOUS_RELEASE" ]; then
        if ! start_release_process "$PREVIOUS_RELEASE" "$PREVIOUS_PORT" >/dev/null 2>&1; then
          printf '%s\n' \
            "Previous PM2 process could not be restored; the durable recovery journal was retained." >&2
          rm -f -- "$STATE_BACKUP" "$UPSTREAM_BACKUP" "$DATABASE_STATE_BACKUP"
          exit "$exit_status"
        fi
      fi
      if ! pm2_as_app pm2 save >/dev/null 2>&1 \
        || [ ! -f "$PM2_HOME/dump.pm2" ] \
        || ! sync -f "$PM2_HOME/dump.pm2" \
        || ! sync -f "$PM2_HOME"; then
        printf '%s\n' \
          "Rolled-back PM2 topology could not be durably saved; the recovery journal was retained." >&2
        rm -f -- "$STATE_BACKUP" "$UPSTREAM_BACKUP" "$DATABASE_STATE_BACKUP"
        exit "$exit_status"
      fi
    fi
    # The application pointer is authoritative for cross-journal recovery.
    # Restore the old installed controls while the candidate tree and its
    # backed-up specification are still present, then remove the candidate.
    if [ -e "$STATE_DIR/control-plane.pending" ] || [ -L "$STATE_DIR/control-plane.pending" ]; then
      if ! /usr/local/lib/resume-ai/recover-control-plane-generation.sh >/dev/null 2>&1; then
        printf '%s\n' \
          "Control-plane rollback was incomplete; both durable journals and candidate evidence were retained." >&2
        rm -f -- "$STATE_BACKUP" "$UPSTREAM_BACKUP" "$DATABASE_STATE_BACKUP"
        exit "$exit_status"
      fi
    fi
    # Remove the candidate only after the database contract, public proxy,
    # managed pointers and PM2 topology have all returned to the old release.
    # A post-switch failure can still be serving this tree until then.
    if ! cleanup_uncommitted_publish; then
      printf '%s\n' \
        "Rolled-back traffic is safe, but uncommitted release trees could not be removed; the durable journal was retained." >&2
      rm -f -- "$STATE_BACKUP" "$UPSTREAM_BACKUP" "$DATABASE_STATE_BACKUP"
      exit "$exit_status"
    fi
    if ! rm -f -- "$PENDING_FILE" || ! sync -f "$STATE_DIR"; then
      printf '%s\n' "Rolled-back transaction journal could not be durably cleared." >&2
      rm -f -- "$STATE_BACKUP" "$UPSTREAM_BACKUP" "$DATABASE_STATE_BACKUP"
      exit "$exit_status"
    fi
    printf '%s\n' "Deployment failed; application, PM2 and proxy state were rolled back." >&2
  fi
  rm -f -- "$STATE_BACKUP" "$UPSTREAM_BACKUP" "$DATABASE_STATE_BACKUP"
  exit "$exit_status"
}
trap restore_previous_state ERR EXIT

ARTIFACT_DIR="$ARTIFACT_ROOT/$RELEASE_ID"
[ ! -e "$ARTIFACT_DIR" ] || fail "immutable artifact directory already exists"
write_journal publishing
cp -a -- "$BUNDLE_DIR" "$ARTIFACT_DIR"
chown -R root:root "$ARTIFACT_DIR"
chmod -R u+rwX,go-rwx "$ARTIFACT_DIR"
BUNDLE_DIR="$ARTIFACT_DIR"
[ "$(sha256sum "$BUNDLE_DIR/release-manifest.json" | awk '{print $1}')" = "${approval[RELEASE_MANIFEST_SHA256]}" ] \
  && [ "$(sha256sum "$BUNDLE_DIR/source-manifest.txt" | awk '{print $1}')" = "${approval[SOURCE_MANIFEST_SHA256]}" ] \
  && [ "$(sha256sum "$BUNDLE_DIR/SHA256SUMS" | awk '{print $1}')" = "${approval[SHA256SUMS_SHA256]}" ] \
  || fail "root-owned artifact copy differs from its approval"
(cd "$BUNDLE_DIR" && sha256sum -c SHA256SUMS >/dev/null)
root_python - "$BUNDLE_DIR" <<'PY'
import os
import pathlib
import stat
import sys

root = pathlib.Path(sys.argv[1]).resolve(strict=True)
mountinfo = pathlib.Path("/proc/self/mountinfo")
if not mountinfo.is_file():
    raise SystemExit("artifact mount topology is unavailable")
for line in mountinfo.read_text(encoding="utf-8").splitlines():
    fields = line.split()
    if len(fields) < 5:
        raise SystemExit("malformed artifact mount topology")
    mount = pathlib.Path(fields[4].replace("\\040", " ").replace("\\011", "\t").replace("\\012", "\n").replace("\\134", "\\"))
    try:
        mount.relative_to(root)
    except ValueError:
        continue
    raise SystemExit(f"artifact copy contains or is a mount point: {mount}")
for directory, directories, files in os.walk(root, followlinks=False):
    for name in [*directories, *files]:
        member = pathlib.Path(directory, name)
        metadata = member.lstat()
        if (not (stat.S_ISDIR(metadata.st_mode) or stat.S_ISREG(metadata.st_mode))
                or stat.S_ISLNK(metadata.st_mode) or metadata.st_uid != 0
                or metadata.st_gid != 0
                or (stat.S_ISREG(metadata.st_mode) and metadata.st_nlink != 1)):
            raise SystemExit(f"artifact copy has an unsafe member: {member.relative_to(root)}")
PY
cleanup_deploy_input_snapshot
install -o root -g root -m 0600 /dev/null "$ARTIFACT_DIR/production-validation.log"
exec 6>&1 7>&2
exec > >(tee -a "$ARTIFACT_DIR/production-validation.log") 2>&1

# No process under the reusable build UID may survive into publication. The
# reviewed source is extracted and retained as root-owned, group-readable data;
# the builder receives write access only to the explicit output partitions.
kill_service_account_processes resume-ai-build \
  || fail "resume-ai-build was not idle before release staging"
install -d -o root -g resume-ai-build -m 0750 "$STAGING_RELEASE"
root_tar --no-same-owner --no-same-permissions -C "$STAGING_RELEASE" -xzf "$BUNDLE_DIR/source.tar.gz"
install -d -o root -g resume-ai-build -m 0750 "$STAGING_RELEASE/tests/fixtures"
install -o root -g resume-ai-build -m 0640 \
  "$BUNDLE_DIR/baseline/competition-score-prospective-baseline.json" \
  "$STAGING_RELEASE/tests/fixtures/competition-score-prospective-baseline.json"
set_tree_readonly_for_builder "$STAGING_RELEASE"
for builder_output in node_modules .next; do
  [ ! -e "$STAGING_RELEASE/$builder_output" ] && [ ! -L "$STAGING_RELEASE/$builder_output" ] \
    || fail "source archive unexpectedly contains generated output: $builder_output"
  install -d -o resume-ai-build -g resume-ai-build -m 0700 \
    "$STAGING_RELEASE/$builder_output"
done
[ ! -e "$STAGING_RELEASE/tsconfig.tsbuildinfo" ] \
  && [ ! -L "$STAGING_RELEASE/tsconfig.tsbuildinfo" ] \
  || fail "source archive unexpectedly contains compiler bookkeeping"
install -o resume-ai-build -g resume-ai-build -m 0600 /dev/null \
  "$STAGING_RELEASE/tsconfig.tsbuildinfo"
root_python /usr/local/lib/resume-ai/verify-release-source-tree.py \
  --source "$STAGING_RELEASE" --manifest "$BUNDLE_DIR/source-manifest.txt" \
  > "$ARTIFACT_DIR/extracted-source-manifest.txt"
cmp -s "$ARTIFACT_DIR/extracted-source-manifest.txt" "$BUNDLE_DIR/source-manifest.txt" \
  || fail "extracted source differs from the reviewed source manifest"

get_app_env() { /usr/local/lib/resume-ai/validate-app-env.sh get "$1"; }
get_optional_app_env() { /usr/local/lib/resume-ai/validate-app-env.sh get "$1" 2>/dev/null || true; }
PUBLIC_SITE_URL="$(get_app_env NEXT_PUBLIC_SITE_URL)"
PUBLIC_CONTACT_EMAIL="$(get_app_env NEXT_PUBLIC_CONTACT_EMAIL)"
PUBLIC_ICP_LABEL="$(get_optional_app_env NEXT_PUBLIC_ICP_LABEL)"
PUBLIC_POLICE_CODE="$(get_optional_app_env NEXT_PUBLIC_POLICE_CODE)"
PUBLIC_POLICE_LABEL="$(get_optional_app_env NEXT_PUBLIC_POLICE_LABEL)"
FEATURE_AI="$(get_app_env FEATURE_AI)"
FEATURE_RECOMMENDER="$(get_app_env FEATURE_COMPETITION_RECOMMENDER)"
AI_PROVIDER="$(get_app_env AI_PROVIDER)"
AI_MODEL="$(get_app_env AI_MODEL)"
AI_NORMALIZE_MODEL="$(get_app_env AI_COMPETITION_NORMALIZE_MODEL)"
AI_CLARIFY_MODEL="$(get_app_env AI_COMPETITION_CLARIFY_MODEL)"
AI_RECOMMEND_MODEL="$(get_app_env AI_COMPETITION_RECOMMEND_MODEL)"

build_env=(
  HOME="$BUILD_HOME"
  PATH=/opt/nodejs/current/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
  XDG_CONFIG_HOME="$BUILD_HOME/xdg-config"
  XDG_CACHE_HOME="$BUILD_HOME/xdg-cache"
  XDG_DATA_HOME="$BUILD_HOME/xdg-data"
  PNPM_HOME="$BUILD_HOME/pnpm-home"
  NPM_CONFIG_USERCONFIG=/dev/null
  npm_config_userconfig=/dev/null
  NPM_CONFIG_CACHE="$BUILD_HOME/npm-cache"
  npm_config_cache="$BUILD_HOME/npm-cache"
  NPM_CONFIG_SCRIPT_SHELL=/bin/bash
  npm_config_script_shell=/bin/bash
  NPM_CONFIG_REGISTRY=https://registry.npmjs.org/
  npm_config_registry=https://registry.npmjs.org/
  GIT_CONFIG_NOSYSTEM=1
  GIT_CONFIG_GLOBAL=/dev/null
  CI=1
  NEXT_PUBLIC_SITE_URL="$PUBLIC_SITE_URL"
  NEXT_PUBLIC_CONTACT_EMAIL="$PUBLIC_CONTACT_EMAIL"
  NEXT_PUBLIC_ICP_LABEL="$PUBLIC_ICP_LABEL"
  NEXT_PUBLIC_POLICE_CODE="$PUBLIC_POLICE_CODE"
  NEXT_PUBLIC_POLICE_LABEL="$PUBLIC_POLICE_LABEL"
  FEATURE_AI="$FEATURE_AI"
  FEATURE_COMPETITION_RECOMMENDER="$FEATURE_RECOMMENDER"
  AI_PROVIDER="$AI_PROVIDER"
  AI_MODEL="$AI_MODEL"
  AI_COMPETITION_NORMALIZE_MODEL="$AI_NORMALIZE_MODEL"
  AI_COMPETITION_CLARIFY_MODEL="$AI_CLARIFY_MODEL"
  AI_COMPETITION_RECOMMEND_MODEL="$AI_RECOMMEND_MODEL"
  DATABASE_URL=
  AI_API_KEY=
  AI_CONSENT_SALT=build-only-consent-salt-00000000000000000000000000000000
  AI_CONVERSATION_SIGNING_SECRET=build-only-signing-secret-000000000000000000000000000000
  LOG_HASH_SECRET=build-only-log-secret-000000000000000000000000000000000
  AI_TEST_MODE=1
  ALLOW_AI_MOCK=1
  NEXT_PUBLIC_AI_TEST_MODE=1
)

quota_check_dir="$(mktemp -d /tmp/resume-ai-quota-check.XXXXXX)"
"$SCRIPT_DIR/render-quota-config.sh" "$STAGING_RELEASE/ops/config/quotas.conf" "$quota_check_dir" >/dev/null
cmp -s "$quota_check_dir/application-quota.env" /etc/resume-ai/quota.env \
  && cmp -s "$quota_check_dir/00-resume-ai-global.conf" /etc/nginx/conf.d/00-resume-ai-global.conf \
  && cmp -s "$quota_check_dir/nginx-quota.inc" /etc/nginx/snippets/resume-ai-recommend-quota.inc \
  && cmp -s "$quota_check_dir/nginx-track-quota.inc" /etc/nginx/snippets/resume-ai-track-quota.inc \
  || fail "candidate quota configuration differs from all four installed derivatives"
rm -rf -- "$quota_check_dir"

TEST_DATABASE="resume_ai_security_test_${RELEASE_ID,,}"
[[ "$TEST_DATABASE" =~ ^[a-z0-9_]+$ ]] || fail "invalid temporary integration database name"
build_systemd_environment=()
for build_variable in "${build_env[@]}"; do
  build_systemd_environment+=(--setenv="$build_variable")
done

# Dependency installation is the only build step which needs public network
# access. Lifecycle scripts are disabled, while access to the production
# PostgreSQL loopback and Unix socket is denied by the transient unit.
root_python /usr/local/lib/resume-ai/validate-pnpm-lockfile.py \
  --source "$STAGING_RELEASE" > "$ARTIFACT_DIR/pnpm-lock-policy.txt"
mapfile -t registry_ips < <(/usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin \
  /usr/bin/getent ahosts registry.npmjs.org | /usr/bin/awk '{print $1}' | /usr/bin/sort -u)
[ "${#registry_ips[@]}" -gt 0 ] || fail "official npm registry did not resolve"
root_python - "${registry_ips[@]}" <<'PY'
import ipaddress
import sys

for raw in sys.argv[1:]:
    address = ipaddress.ip_address(raw)
    if not address.is_global:
        raise SystemExit(f"official npm registry resolved to a non-public address: {address}")
PY
REGISTRY_HOSTS_FILE="$(mktemp /run/resume-ai-registry-hosts.XXXXXX)"
printf '%s\n' '127.0.0.1 localhost' > "$REGISTRY_HOSTS_FILE"
registry_ip_properties=()
for registry_ip in "${registry_ips[@]}"; do
  printf '%s %s\n' "$registry_ip" registry.npmjs.org >> "$REGISTRY_HOSTS_FILE"
  registry_ip_properties+=(--property="IPAddressAllow=$registry_ip")
done
chown root:root "$REGISTRY_HOSTS_FILE"
chmod 0444 "$REGISTRY_HOSTS_FILE"
sync -f "$REGISTRY_HOSTS_FILE"
INSTALL_UNIT="resume-ai-install-$RELEASE_ID.service"
prepare_builder_identity
systemd-run --quiet --wait --collect --pipe --service-type=exec \
  --unit="$INSTALL_UNIT" --uid=resume-ai-build --gid=resume-ai-build \
  --working-directory="$STAGING_RELEASE" \
  --property=KillMode=control-group --property=NoNewPrivileges=yes \
  --property=PrivateTmp=yes --property=PrivateDevices=yes --property=ProtectHome=yes \
  --property=ProtectSystem=strict --property=ProtectKernelTunables=yes \
  --property=ProtectKernelModules=yes --property=ProtectControlGroups=yes \
  --property=RestrictSUIDSGID=yes --property=RestrictNamespaces=yes \
  --property=LockPersonality=yes \
  --property=ProtectProc=invisible --property=ProcSubset=pid \
  --property='CapabilityBoundingSet=' --property='AmbientCapabilities=' \
  --property='RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6' \
  --property=IPAddressDeny=any "${registry_ip_properties[@]}" \
  --property="BindReadOnlyPaths=$REGISTRY_HOSTS_FILE:/etc/hosts" \
  --property='InaccessiblePaths=/run/postgresql /var/run/postgresql /var/lib/postgresql /etc/postgresql /var/lib/resume-ai-build /opt/resume-ai/current /opt/resume-ai/releases /run/docker.sock /var/run/docker.sock /run/containerd /run/incus' \
  --property="ReadOnlyPaths=$STAGING_RELEASE" \
  --property="ReadWritePaths=$STAGING_RELEASE/node_modules $BUILD_HOME" \
  "${build_systemd_environment[@]}" \
  /usr/bin/env -i "${build_env[@]}" /bin/bash -Eeuo pipefail -c '
    pnpm install --frozen-lockfile --ignore-scripts --package-import-method=copy \
      --store-dir "$HOME/pnpm-store" --config.registry=https://registry.npmjs.org/
    pnpm audit --prod --audit-level=low --registry=https://registry.npmjs.org/
  '
finish_builder_identity "dependency installation"
rm -f -- "$REGISTRY_HOSTS_FILE"
REGISTRY_HOSTS_FILE=""
assert_builder_owned_output "$STAGING_RELEASE/node_modules"
"$SCRIPT_DIR/verify-single-link-tree.sh" "$STAGING_RELEASE/node_modules"
set_tree_readonly_for_builder "$STAGING_RELEASE/node_modules"
for transient_cache in .cache .vite; do
  cache_path="$STAGING_RELEASE/node_modules/$transient_cache"
  if [ -e "$cache_path" ] || [ -L "$cache_path" ]; then
    [ -d "$cache_path" ] && [ ! -L "$cache_path" ] \
      || fail "dependency cache partition is linked or unsafe: $transient_cache"
  else
    install -d -o resume-ai-build -g resume-ai-build -m 0700 "$cache_path"
  fi
  set_tree_writable_by_builder "$cache_path"
done
DEVELOPMENT_DEPENDENCIES_SHA256="$(hash_runtime_tree \
  --root "$STAGING_RELEASE/node_modules" \
  --exclude-relative .cache --exclude-relative .vite)" \
  || fail "installed dependency tree could not be hashed"
[[ "$DEVELOPMENT_DEPENDENCIES_SHA256" =~ ^[a-f0-9]{64}$ ]] \
  || fail "installed dependency digest is malformed"
root_python /usr/local/lib/resume-ai/verify-release-source-tree.py \
  --source "$STAGING_RELEASE" --manifest "$BUNDLE_DIR/source-manifest.txt" \
  >/dev/null || fail "dependency installation modified reviewed source"
PROJECT_TOOLCHAIN_PRE_BUILD="$ARTIFACT_DIR/project-toolchain-pre-build.json"
PROJECT_TOOLCHAIN_POST_BUILD="$ARTIFACT_DIR/project-toolchain-post-build.json"
verify_project_toolchain "$STAGING_RELEASE" "$STAGING_RELEASE/node_modules" \
  "$PROJECT_TOOLCHAIN_PRE_BUILD"
declare -A PROJECT_TOOL_RELATIVE=()
declare -A PROJECT_TOOL_SHA256=()
while IFS=$'\t' read -r tool_id tool_relative tool_sha; do
  [ -n "$tool_id" ] && [ -z "${PROJECT_TOOL_RELATIVE[$tool_id]:-}" ] \
    || fail "project-toolchain receipt emitted a duplicate or empty tool identity"
  PROJECT_TOOL_RELATIVE[$tool_id]=$tool_relative
  PROJECT_TOOL_SHA256[$tool_id]=$tool_sha
done < <(root_python - "$PROJECT_TOOLCHAIN_PRE_BUILD" <<'PY'
import json
import pathlib
import re
import sys

expected = ["eslint", "next", "playwright", "playwright-test", "typescript", "vitest"]
value = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
tools = value.get("observedTools") if isinstance(value, dict) else None
if not isinstance(tools, list) or [tool.get("id") for tool in tools] != expected:
    raise SystemExit("project-toolchain receipt has an unexpected tool inventory")
for tool in tools:
    relative = tool.get("binRelativePath")
    digest = tool.get("binSha256")
    if (
        not isinstance(relative, str)
        or re.fullmatch(r"[A-Za-z0-9@_+./-]+", relative) is None
        or pathlib.PurePosixPath(relative).is_absolute()
        or ".." in pathlib.PurePosixPath(relative).parts
        or not isinstance(digest, str)
        or re.fullmatch(r"[a-f0-9]{64}", digest) is None
    ):
        raise SystemExit("project-toolchain receipt contains an unsafe executable")
    print(f"{tool['id']}\t{relative}\t{digest}")
PY
)
declare -A PROJECT_TOOL_ABSOLUTE=()
for tool_id in eslint next playwright playwright-test typescript vitest; do
  tool_relative="${PROJECT_TOOL_RELATIVE[$tool_id]:-}"
  tool_sha="${PROJECT_TOOL_SHA256[$tool_id]:-}"
  [ -n "$tool_relative" ] && [[ "$tool_sha" =~ ^[a-f0-9]{64}$ ]] \
    || fail "project-toolchain receipt omitted a required executable"
  tool_absolute="$STAGING_RELEASE/node_modules/$tool_relative"
  [ -f "$tool_absolute" ] && [ ! -L "$tool_absolute" ] \
    && [ "$(readlink -e -- "$tool_absolute")" = "$tool_absolute" ] \
    && [ "$(stat -c '%U:%h' "$tool_absolute")" = root:1 ] \
    && [ -z "$(find "$tool_absolute" -maxdepth 0 -perm /022 -print -quit)" ] \
    && [ "$(sha256sum "$tool_absolute" | awk '{print $1}')" = "$tool_sha" ] \
    || fail "project-toolchain executable is not the verified root-frozen target: $tool_id"
  PROJECT_TOOL_ABSOLUTE[$tool_id]=$tool_absolute
done
PROJECT_NODE_BIN=/opt/nodejs/node-v24.20.0-linux-x64/bin/node
[ -f "$PROJECT_NODE_BIN" ] && [ ! -L "$PROJECT_NODE_BIN" ] \
  && [ "$(readlink -e -- "$PROJECT_NODE_BIN")" = "$PROJECT_NODE_BIN" ] \
  || fail "physical project-toolchain Node executable is unavailable"

# All reviewed code execution before the PostgreSQL integration gate receives
# no host network namespace, no database URL and no production secret.
BUILD_UNIT="resume-ai-build-$RELEASE_ID.service"
prepare_builder_identity
systemd-run --quiet --wait --collect --pipe --service-type=exec \
  --unit="$BUILD_UNIT" --uid=resume-ai-build --gid=resume-ai-build \
  --working-directory="$STAGING_RELEASE" \
  --property=KillMode=control-group --property=NoNewPrivileges=yes \
  --property=PrivateNetwork=yes --property=PrivateTmp=yes --property=PrivateDevices=yes \
  --property=ProtectHome=yes --property=ProtectSystem=strict \
  --property=ProtectKernelTunables=yes --property=ProtectKernelModules=yes \
  --property=ProtectControlGroups=yes --property=RestrictSUIDSGID=yes \
  --property=RestrictNamespaces=yes --property=LockPersonality=yes \
  --property=ProtectProc=invisible --property=ProcSubset=pid \
  --property='CapabilityBoundingSet=' --property='AmbientCapabilities=' \
  --property='RestrictAddressFamilies=AF_UNIX' \
  --property='InaccessiblePaths=/run/postgresql /var/run/postgresql /var/lib/postgresql /etc/postgresql /var/lib/resume-ai-build /opt/resume-ai/current /opt/resume-ai/releases /run/docker.sock /var/run/docker.sock /run/containerd /run/incus' \
  --property="ReadOnlyPaths=$STAGING_RELEASE" \
  --property="ReadWritePaths=$STAGING_RELEASE/.next $STAGING_RELEASE/tsconfig.tsbuildinfo $STAGING_RELEASE/node_modules/.cache $STAGING_RELEASE/node_modules/.vite $BUILD_HOME" \
  "${build_systemd_environment[@]}" \
  /usr/bin/env -i "${build_env[@]}" PROJECT_NODE_BIN="$PROJECT_NODE_BIN" \
    TOOL_TYPESCRIPT="${PROJECT_TOOL_ABSOLUTE[typescript]}" \
    TOOL_ESLINT="${PROJECT_TOOL_ABSOLUTE[eslint]}" \
    TOOL_VITEST="${PROJECT_TOOL_ABSOLUTE[vitest]}" \
    TOOL_NEXT="${PROJECT_TOOL_ABSOLUTE[next]}" \
    /bin/bash -Eeuo pipefail -c '
    NODE_ENV=test "$PROJECT_NODE_BIN" "$TOOL_TYPESCRIPT" --noEmit --incremental false
    NODE_ENV=test "$PROJECT_NODE_BIN" "$TOOL_ESLINT" . --max-warnings=0
    NODE_ENV=test "$PROJECT_NODE_BIN" "$TOOL_VITEST" run --passWithNoTests
    NODE_ENV=production DATABASE_URL= AI_TEST_MODE=0 ALLOW_AI_MOCK=0 \
      NEXT_PUBLIC_AI_TEST_MODE=0 NEXT_DIST_DIR=.next \
      "$PROJECT_NODE_BIN" "$TOOL_NEXT" build
  '
finish_builder_identity "the secret-free build cgroup"
assert_builder_owned_output "$STAGING_RELEASE/.next"
ASSET_TREE_SHA256="$(hash_runtime_tree --root "$STAGING_RELEASE/.next" \
  --exclude-relative cache)" \
  || fail "production asset tree could not be hashed"
[[ "$ASSET_TREE_SHA256" =~ ^[a-f0-9]{64}$ ]] \
  || fail "production asset digest is malformed"
CURRENT_DEVELOPMENT_DEPENDENCIES_SHA256="$(hash_runtime_tree \
  --root "$STAGING_RELEASE/node_modules" \
  --exclude-relative .cache --exclude-relative .vite)" \
  || fail "post-build dependency tree could not be hashed"
[ "$CURRENT_DEVELOPMENT_DEPENDENCIES_SHA256" = "$DEVELOPMENT_DEPENDENCIES_SHA256" ] \
  || fail "build/test execution modified installed dependency content"
verify_project_toolchain "$STAGING_RELEASE" "$STAGING_RELEASE/node_modules" \
  "$PROJECT_TOOLCHAIN_POST_BUILD"
root_python - "$PROJECT_TOOLCHAIN_PRE_BUILD" "$PROJECT_TOOLCHAIN_POST_BUILD" <<'PY'
import datetime
import json
import pathlib
import re
import sys

expected = {
    "schemaVersion", "evidenceType", "status", "createdAt",
    "sourceManifestSha256", "policy", "coordinator", "inputs",
    "runtime", "observedTools",
}

def reject_duplicates(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate project-toolchain receipt key")
        result[key] = value
    return result

def load(path):
    value = json.loads(
        pathlib.Path(path).read_text(encoding="utf-8"),
        object_pairs_hook=reject_duplicates,
    )
    if not isinstance(value, dict) or set(value) != expected:
        raise SystemExit("project-toolchain receipt has an unexpected schema")
    if (
        value.get("schemaVersion") != 1
        or value.get("evidenceType") != "release-project-toolchain-verification"
        or value.get("status") != "passed"
    ):
        raise SystemExit("project-toolchain receipt does not prove a pass")
    timestamp = value.get("createdAt")
    if not isinstance(timestamp, str) or re.fullmatch(
        r"20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z", timestamp
    ) is None:
        raise SystemExit("project-toolchain receipt timestamp is malformed")
    instant = datetime.datetime.strptime(timestamp, "%Y-%m-%dT%H:%M:%SZ")
    value = dict(value)
    del value["createdAt"]
    return instant, value

before_time, before = load(sys.argv[1])
after_time, after = load(sys.argv[2])
if after_time < before_time or after != before:
    raise SystemExit("project toolchain changed while candidate build code executed")
PY
set_tree_readonly_for_builder "$STAGING_RELEASE/.next"
[ -f "$STAGING_RELEASE/tsconfig.tsbuildinfo" ] \
  && [ ! -L "$STAGING_RELEASE/tsconfig.tsbuildinfo" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$STAGING_RELEASE/tsconfig.tsbuildinfo")" \
       = resume-ai-build:resume-ai-build:600:1 ] \
  || fail "compiler bookkeeping output is unsafe"
chown root:resume-ai-build "$STAGING_RELEASE/tsconfig.tsbuildinfo"
chmod 0640 "$STAGING_RELEASE/tsconfig.tsbuildinfo"

# Run the real PostgreSQL contract in an isolated network namespace.  The
# disposable postmaster never runs as the host's postgres account: even a
# candidate test which obtains its temporary database superuser can therefore
# act only as the dedicated, non-login resume-ai-pgtest OS identity.
POSTGRES_BINDIR="$(runuser -u postgres -- env -i PATH=/usr/bin:/bin pg_config --bindir)"
case "$POSTGRES_BINDIR" in /usr/lib/postgresql/[0-9]*/bin) ;; *) fail "unapproved PostgreSQL binary directory" ;; esac
for postgres_binary in initdb pg_isready postgres psql; do
  [ -x "$POSTGRES_BINDIR/$postgres_binary" ] || fail "missing PostgreSQL test binary: $postgres_binary"
done
TEST_RUNTIME_ROLE="resume_ai_test_runtime_${RELEASE_ID,,}"
[[ "$TEST_RUNTIME_ROLE" =~ ^[a-z0-9_]+$ ]] || fail "invalid temporary integration runtime role"
TEST_PG_DATA_DIR="/run/resume-ai-pgtest.$RELEASE_ID"
[ ! -e "$TEST_PG_DATA_DIR" ] || fail "temporary PostgreSQL data directory already exists"
kill_service_account_processes resume-ai-pgtest \
  || fail "resume-ai-pgtest had a pre-existing process"
install -d -o resume-ai-pgtest -g resume-ai-pgtest -m 0700 "$TEST_PG_DATA_DIR"
runuser -u resume-ai-pgtest -- env -i HOME=/var/lib/resume-ai-pgtest \
  PATH="$POSTGRES_BINDIR:/usr/bin:/bin" \
  "$POSTGRES_BINDIR/initdb" --pgdata="$TEST_PG_DATA_DIR" \
  --encoding=UTF8 --locale=C --auth-local=trust --auth-host=trust >/dev/null
TEST_PG_UNIT="resume-ai-pgtest-${RELEASE_ID,,}.service"
systemd-run --quiet --collect --service-type=exec --unit="$TEST_PG_UNIT" \
  --uid=resume-ai-pgtest --gid=resume-ai-pgtest --property=PrivateNetwork=yes \
  --property=KillMode=control-group --property=NoNewPrivileges=yes \
  --property=PrivateTmp=yes --property=PrivateDevices=yes --property=ProtectHome=yes \
  --property=ProtectSystem=strict --property=ProtectKernelTunables=yes \
  --property=ProtectKernelModules=yes --property=ProtectControlGroups=yes \
  --property=ProtectKernelLogs=yes --property=ProtectClock=yes \
  --property=ProtectProc=invisible --property=ProcSubset=pid \
  --property=RestrictSUIDSGID=yes --property=RestrictNamespaces=yes \
  --property=LockPersonality=yes \
  --property=CapabilityBoundingSet= --property=AmbientCapabilities= \
  --property='RestrictAddressFamilies=AF_UNIX AF_INET' \
  --property='SystemCallFilter=@system-service' --property=SystemCallErrorNumber=EPERM \
  --property=UMask=0077 \
  --property='InaccessiblePaths=/run/postgresql /var/run/postgresql /var/lib/postgresql /etc/postgresql /opt/resume-ai/current /opt/resume-ai/releases' \
  --property="ReadWritePaths=$TEST_PG_DATA_DIR" \
  "$POSTGRES_BINDIR/postgres" -D "$TEST_PG_DATA_DIR" -h 127.0.0.1 -p 5432 \
    -k "$TEST_PG_DATA_DIR" -c jit=off

PG_SETUP_UNIT="resume-ai-pgsetup-${RELEASE_ID,,}.service"
systemd-run --quiet --wait --collect --pipe --service-type=exec \
  --unit="$PG_SETUP_UNIT" --uid=resume-ai-pgtest --gid=resume-ai-pgtest \
  --property=PrivateNetwork=yes --property="JoinsNamespaceOf=$TEST_PG_UNIT" \
  --property=KillMode=control-group --property=NoNewPrivileges=yes \
  --property=PrivateTmp=yes --property=PrivateDevices=yes --property=ProtectHome=yes \
  --property=ProtectSystem=strict --property=ProtectKernelTunables=yes \
  --property=ProtectKernelModules=yes --property=ProtectControlGroups=yes \
  --property=ProtectKernelLogs=yes --property=ProtectClock=yes \
  --property=ProtectProc=invisible --property=ProcSubset=pid \
  --property=RestrictSUIDSGID=yes --property=RestrictNamespaces=yes \
  --property=LockPersonality=yes \
  --property=CapabilityBoundingSet= --property=AmbientCapabilities= \
  --property='RestrictAddressFamilies=AF_UNIX AF_INET' \
  --property='SystemCallFilter=@system-service' --property=SystemCallErrorNumber=EPERM \
  --property=UMask=0077 \
  --property='InaccessiblePaths=/run/postgresql /var/run/postgresql /var/lib/postgresql /etc/postgresql /opt/resume-ai/current /opt/resume-ai/releases' \
  --property="ReadWritePaths=$TEST_PG_DATA_DIR" \
  --setenv=PATH="$POSTGRES_BINDIR:/usr/bin:/bin" \
  --setenv=PGHOST=127.0.0.1 --setenv=PGPORT=5432 --setenv=PGUSER=postgres \
  --setenv=TEST_RUNTIME_ROLE="$TEST_RUNTIME_ROLE" --setenv=TEST_DATABASE="$TEST_DATABASE" \
  /bin/bash -Eeuo pipefail -c '
    for attempt in $(seq 1 60); do
      pg_isready --dbname=postgres >/dev/null 2>&1 && break
      [ "$attempt" -lt 60 ] || exit 70
      sleep 0.25
    done
    psql --dbname=postgres --no-psqlrc --set=ON_ERROR_STOP=1 \
      --set=test_role="$TEST_RUNTIME_ROLE" --set=test_database="$TEST_DATABASE" <<'"'"'SQL'"'"'
CREATE ROLE :"test_role" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
CREATE DATABASE :"test_database" OWNER postgres;
SQL
  '

TEST_OWNER_URL="postgresql://postgres@127.0.0.1:5432/$TEST_DATABASE"
TEST_RUNTIME_URL="postgresql://$TEST_RUNTIME_ROLE@127.0.0.1:5432/$TEST_DATABASE"
PG_TEST_UNIT="resume-ai-pgcontract-${RELEASE_ID,,}.service"
prepare_builder_identity
systemd-run --quiet --wait --collect --pipe --service-type=exec \
  --unit="$PG_TEST_UNIT" --uid=resume-ai-build --gid=resume-ai-build \
  --working-directory="$STAGING_RELEASE" \
  --property=PrivateNetwork=yes --property="JoinsNamespaceOf=$TEST_PG_UNIT" \
  --property=KillMode=control-group --property=NoNewPrivileges=yes \
  --property=PrivateTmp=yes --property=PrivateDevices=yes --property=ProtectHome=yes \
  --property=ProtectSystem=strict --property=ProtectKernelTunables=yes \
  --property=ProtectKernelModules=yes --property=ProtectControlGroups=yes \
  --property=ProtectKernelLogs=yes --property=ProtectClock=yes \
  --property=ProtectProc=invisible --property=ProcSubset=pid \
  --property=RestrictSUIDSGID=yes --property=RestrictNamespaces=yes \
  --property=LockPersonality=yes \
  --property=CapabilityBoundingSet= --property=AmbientCapabilities= \
  --property='RestrictAddressFamilies=AF_UNIX AF_INET' \
  --property='SystemCallFilter=@system-service' --property=SystemCallErrorNumber=EPERM \
  --property=UMask=0077 \
  --property='InaccessiblePaths=/run/postgresql /var/run/postgresql /var/lib/postgresql /etc/postgresql /var/lib/resume-ai-build /opt/resume-ai/current /opt/resume-ai/releases /run/docker.sock /var/run/docker.sock /run/containerd /run/incus' \
  --property="ReadOnlyPaths=$STAGING_RELEASE" \
  --property="ReadWritePaths=$STAGING_RELEASE/node_modules/.cache $STAGING_RELEASE/node_modules/.vite $BUILD_HOME" \
  "${build_systemd_environment[@]}" \
  --setenv=RUN_POSTGRES_SECURITY_STATE_TESTS=1 \
  --setenv=POSTGRES_SECURITY_STATE_TEST_DATABASE_URL="$TEST_OWNER_URL" \
  --setenv=POSTGRES_SECURITY_STATE_RUNTIME_DATABASE_URL="$TEST_RUNTIME_URL" \
  /usr/bin/env -i "${build_env[@]}" RUN_POSTGRES_SECURITY_STATE_TESTS=1 \
    POSTGRES_SECURITY_STATE_TEST_DATABASE_URL="$TEST_OWNER_URL" \
    POSTGRES_SECURITY_STATE_RUNTIME_DATABASE_URL="$TEST_RUNTIME_URL" \
    PROJECT_NODE_BIN="$PROJECT_NODE_BIN" \
    TOOL_VITEST="${PROJECT_TOOL_ABSOLUTE[vitest]}" \
    /bin/bash -Eeuo pipefail -c '
    for production_path in /run/postgresql /var/run/postgresql /var/lib/postgresql \
      /etc/postgresql /opt/resume-ai/current /opt/resume-ai/releases; do
      [ ! -e "$production_path" ] \
        || { echo "isolated builder can see $production_path" >&2; exit 71; }
    done
    if PGHOST=/run/postgresql PGPORT=5432 PGUSER=postgres \
      psql --no-psqlrc --dbname=resume_ai --command="select 1" >/dev/null 2>&1; then
      echo "isolated builder unexpectedly reached the production PostgreSQL socket" >&2
      exit 72
    fi
    if psql --no-psqlrc --set=ON_ERROR_STOP=1 --dbname="$POSTGRES_SECURITY_STATE_TEST_DATABASE_URL" \
      --command="COPY (SELECT 1) TO PROGRAM '\''test -e /var/lib/postgresql -o -e /run/postgresql -o -e /opt/resume-ai/current'\''" \
      >/dev/null 2>&1; then
      echo "disposable PostgreSQL COPY PROGRAM can see production paths" >&2
      exit 73
    fi
    NODE_ENV=test DATABASE_URL= "$PROJECT_NODE_BIN" "$TOOL_VITEST" run \
      tests/security/competition-shared-state-postgres.integration.test.ts \
      --testTimeout=30000
  '
finish_builder_identity "the isolated PostgreSQL gate"
cleanup_ephemeral_credentials
pgrep -u "$(id -u resume-ai-pgtest)" >/dev/null 2>&1 \
  && fail "resume-ai-pgtest retained a process after disposable-cluster cleanup"
POST_PG_ASSET_TREE_SHA256="$(hash_runtime_tree --root "$STAGING_RELEASE/.next" \
  --exclude-relative cache)" \
  || fail "post-PostgreSQL asset tree could not be hashed"
[ "$POST_PG_ASSET_TREE_SHA256" = "$ASSET_TREE_SHA256" ] \
  || fail "isolated PostgreSQL tests modified production build assets"
CURRENT_DEVELOPMENT_DEPENDENCIES_SHA256="$(hash_runtime_tree \
  --root "$STAGING_RELEASE/node_modules" \
  --exclude-relative .cache --exclude-relative .vite)" \
  || fail "post-PostgreSQL dependency tree could not be hashed"
[ "$CURRENT_DEVELOPMENT_DEPENDENCIES_SHA256" = "$DEVELOPMENT_DEPENDENCIES_SHA256" ] \
  || fail "isolated PostgreSQL tests modified installed dependency content"
root_python - "$STAGING_RELEASE/.next" \
  "$PUBLIC_SITE_URL" "$PUBLIC_CONTACT_EMAIL" "$PUBLIC_ICP_LABEL" \
  "$PUBLIC_POLICE_CODE" "$PUBLIC_POLICE_LABEL" <<'PY'
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
for key, configured in zip((
    "NEXT_PUBLIC_SITE_URL", "NEXT_PUBLIC_CONTACT_EMAIL",
    "NEXT_PUBLIC_ICP_LABEL", "NEXT_PUBLIC_POLICE_CODE", "NEXT_PUBLIC_POLICE_LABEL",
), sys.argv[2:], strict=True):
    value = configured.encode()
    if not value:
        continue
    if not any(value in path.read_bytes() for path in root.rglob("*") if path.is_file() and path.stat().st_size <= 32 * 1024 * 1024):
        raise SystemExit(f"build output did not capture configured {key}")
PY
kill_service_account_processes resume-ai-build \
  || fail "resume-ai-build retained a process after its KillMode=control-group gate"
cleanup_ephemeral_credentials

root_python /usr/local/lib/resume-ai/verify-release-source-tree.py \
  --source "$STAGING_RELEASE" --manifest "$BUNDLE_DIR/source-manifest.txt" \
  > "$ARTIFACT_DIR/post-build-source-manifest.txt"
cmp -s "$ARTIFACT_DIR/post-build-source-manifest.txt" "$BUNDLE_DIR/source-manifest.txt" \
  || fail "builder modified reviewed source outside excluded build/dependency paths"
/usr/local/lib/resume-ai/scan-release-secrets.sh --source-tree "$STAGING_RELEASE"
/usr/local/lib/resume-ai/scan-release-secrets.sh --full "$STAGING_RELEASE/.next"

chown -R root:resume-ai-verify "$STAGING_RELEASE"
chmod -R u=rX,g=rX,o= "$STAGING_RELEASE"
mv -- "$STAGING_RELEASE" "$VERIFY_RELEASE"
sync -f "$VERIFY_ROOT"
ASSET_TREE_SHA256="$(hash_runtime_tree --root "$VERIFY_RELEASE/.next" \
  --exclude-relative cache)" \
  || fail "frozen production asset tree could not be hashed"
printf '%s\n' "$ASSET_TREE_SHA256" > "$ARTIFACT_DIR/build-output-sha256.txt"

# The real credential is exposed only through systemd's private credential
# mount to a fixed, root-installed verifier. Candidate JavaScript, candidate
# cwd, the unit environment, and the deployment log never receive the key.
FIXED_DEEPSEEK_VERIFIER=/usr/local/lib/resume-ai/release-evidence-deepseek-verifier.mjs
[ -f "$FIXED_DEEPSEEK_VERIFIER" ] && [ ! -L "$FIXED_DEEPSEEK_VERIFIER" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$FIXED_DEEPSEEK_VERIFIER")" = root:root:755:1 ] \
  && cmp -s "$RELEASE_ROOT/$ACTIVE_RELEASE/scripts/lib/release-evidence-deepseek-verifier.mjs" \
    "$FIXED_DEEPSEEK_VERIFIER" \
  || fail "fixed DeepSeek verifier is not bound to the active trusted control generation"
REAL_AI_KEY="$(get_app_env AI_API_KEY)"
[[ "$REAL_AI_KEY" != *[$'\r\n\t ']* ]] && [ "${#REAL_AI_KEY}" -ge 16 ] \
  || fail "AI_API_KEY is invalid for the fixed preflight"
kill_service_account_processes resume-ai-verify \
  || fail "resume-ai-verify had a pre-existing process"
VERIFY_CREDENTIAL_FILE="$(mktemp /run/resume-ai-deepseek-credential.XXXXXX)"
printf '%s\n' "$REAL_AI_KEY" > "$VERIFY_CREDENTIAL_FILE"
chown root:root "$VERIFY_CREDENTIAL_FILE"
chmod 0400 "$VERIFY_CREDENTIAL_FILE"
sync -f "$VERIFY_CREDENTIAL_FILE"
unset REAL_AI_KEY

mapfile -t deepseek_ips < <(getent ahosts api.deepseek.com | awk '{print $1}' | sort -u)
[ "${#deepseek_ips[@]}" -gt 0 ] || fail "could not resolve the pinned DeepSeek host"
root_python - "${deepseek_ips[@]}" <<'PY'
import ipaddress
import sys
for value in sys.argv[1:]: ipaddress.ip_address(value)
PY
VERIFY_HOSTS_FILE="$(mktemp /run/resume-ai-verify-hosts.XXXXXX)"
printf '%s\n' '127.0.0.1 localhost' > "$VERIFY_HOSTS_FILE"
for deepseek_ip in "${deepseek_ips[@]}"; do printf '%s %s\n' "$deepseek_ip" api.deepseek.com >> "$VERIFY_HOSTS_FILE"; done
chown root:root "$VERIFY_HOSTS_FILE"
chmod 0444 "$VERIFY_HOSTS_FILE"
allowed_deepseek_ips="${deepseek_ips[*]}"
VERIFY_UNIT="resume-ai-verify-$RELEASE_ID.service"
CREDENTIAL_PATH="/run/credentials/$VERIFY_UNIT/deepseek-key"
systemd-run --quiet --wait --collect --pipe --service-type=exec \
  --unit="$VERIFY_UNIT" --uid=resume-ai-verify --gid=resume-ai-verify \
  --working-directory=/ \
  --property=KillMode=control-group --property=NoNewPrivileges=yes \
  --property=PrivateTmp=yes --property=PrivateDevices=yes --property=ProtectHome=yes \
  --property=ProtectSystem=strict --property=ProtectKernelTunables=yes \
  --property=ProtectKernelModules=yes --property=ProtectControlGroups=yes \
  --property=RestrictSUIDSGID=yes --property=RestrictNamespaces=yes \
  --property=LockPersonality=yes --property=ProtectProc=invisible --property=ProcSubset=pid \
  --property='CapabilityBoundingSet=' --property='AmbientCapabilities=' \
  --property='IPAddressDeny=any' \
  --property="IPAddressAllow=$allowed_deepseek_ips" \
  --property="LoadCredential=deepseek-key:$VERIFY_CREDENTIAL_FILE" \
  --property="BindReadOnlyPaths=$VERIFY_HOSTS_FILE:/etc/hosts" \
  --property="InaccessiblePaths=$VERIFY_RELEASE /opt/resume-ai/current /opt/resume-ai/releases" \
  /usr/bin/env -i PATH=/opt/nodejs/current/bin:/usr/bin:/bin NODE_ENV=production \
    "$NODE_BIN" "$FIXED_DEEPSEEK_VERIFIER" "$CREDENTIAL_PATH" \
    "$AI_NORMALIZE_MODEL" "$AI_RECOMMEND_MODEL"
kill_service_account_processes resume-ai-verify \
  || fail "resume-ai-verify retained a process after its one-shot cgroup ended"
rm -f -- "$VERIFY_CREDENTIAL_FILE" "$VERIFY_HOSTS_FILE"
VERIFY_CREDENTIAL_FILE=""
VERIFY_HOSTS_FILE=""
root_python /usr/local/lib/resume-ai/verify-release-source-tree.py \
  --source "$VERIFY_RELEASE" --manifest "$BUNDLE_DIR/source-manifest.txt" \
  > "$ARTIFACT_DIR/post-preflight-source-manifest.txt"
cmp -s "$ARTIFACT_DIR/post-preflight-source-manifest.txt" "$BUNDLE_DIR/source-manifest.txt" \
  || fail "one-shot preflight changed reviewed source"
hash_runtime_tree --root "$VERIFY_RELEASE/.next" --exclude-relative cache \
  > "$ARTIFACT_DIR/post-preflight-build-output-sha256.txt"
cmp -s "$ARTIFACT_DIR/post-preflight-build-output-sha256.txt" "$ARTIFACT_DIR/build-output-sha256.txt" \
  || fail "one-shot preflight changed production build output"

# The verifier needed a development-only helper. After its secret-bearing
# cgroup is destroyed, prune in a fresh secret-free builder cgroup, kill that
# entire UID again, and perform the final immutable freeze.
mv -- "$VERIFY_RELEASE" "$STAGING_RELEASE"
kill_service_account_processes resume-ai-build \
  || fail "resume-ai-build was not idle before production pruning"
set_tree_readonly_for_builder "$STAGING_RELEASE"
set_tree_writable_by_builder "$STAGING_RELEASE/node_modules"
prepare_builder_identity
systemd-run --quiet --wait --collect --pipe --service-type=exec \
  --unit="resume-ai-prune-$RELEASE_ID.service" --uid=resume-ai-build --gid=resume-ai-build \
  --working-directory="$STAGING_RELEASE" \
  --property=KillMode=control-group --property=NoNewPrivileges=yes \
  --property=PrivateTmp=yes --property=PrivateDevices=yes --property=ProtectHome=yes \
  --property=PrivateNetwork=yes --property=ProtectSystem=strict \
  --property=ProtectKernelTunables=yes --property=ProtectKernelModules=yes \
  --property=ProtectControlGroups=yes --property=ProtectProc=invisible --property=ProcSubset=pid \
  --property=RestrictSUIDSGID=yes --property=RestrictNamespaces=yes \
  --property=LockPersonality=yes --property='CapabilityBoundingSet=' \
  --property='AmbientCapabilities=' --property='RestrictAddressFamilies=AF_UNIX' \
  --property='InaccessiblePaths=/run/postgresql /var/run/postgresql /var/lib/postgresql /etc/postgresql /var/lib/resume-ai-build /opt/resume-ai/current /opt/resume-ai/releases /run/docker.sock /var/run/docker.sock /run/containerd /run/incus' \
  --property="ReadOnlyPaths=$STAGING_RELEASE" \
  --property="ReadWritePaths=$STAGING_RELEASE/node_modules $BUILD_HOME" \
  "${build_systemd_environment[@]}" \
  /usr/bin/env -i "${build_env[@]}" \
    /bin/bash -Eeuo pipefail -c '
    pnpm prune --prod --ignore-scripts --package-import-method=copy --offline \
      --store-dir "$HOME/pnpm-store" >&2
    node -e '\''require("sharp"); require("next/package.json")'\''
    pnpm list --prod --depth=0 --json
  ' > "$ARTIFACT_DIR/production-dependencies.json"
finish_builder_identity "production dependency pruning"
rm -rf --one-file-system -- "$STAGING_RELEASE/node_modules/.cache" \
  "$STAGING_RELEASE/node_modules/.vite"
assert_builder_owned_output "$STAGING_RELEASE/node_modules"
"$SCRIPT_DIR/verify-single-link-tree.sh" "$STAGING_RELEASE/node_modules"
root_node -e '
  const fs = require("node:fs");
  const report = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const root = Array.isArray(report) ? report[0] : report;
  const dependencies = new Set(Object.keys(root?.dependencies ?? {}));
  for (const forbidden of ["playwright", "@playwright/test", "eslint", "typescript", "vitest"]) {
    if (dependencies.has(forbidden)) process.exit(2);
  }
' "$ARTIFACT_DIR/production-dependencies.json" || fail "development dependency survived production pruning"
root_python /usr/local/lib/resume-ai/verify-release-source-tree.py \
  --source "$STAGING_RELEASE" --manifest "$BUNDLE_DIR/source-manifest.txt" \
  > "$ARTIFACT_DIR/final-frozen-source-manifest.txt"
cmp -s "$ARTIFACT_DIR/final-frozen-source-manifest.txt" "$BUNDLE_DIR/source-manifest.txt" \
  || fail "production pruning changed reviewed source"
/usr/local/lib/resume-ai/scan-release-secrets.sh --source-tree "$STAGING_RELEASE"
/usr/local/lib/resume-ai/scan-release-secrets.sh --full "$STAGING_RELEASE/.next"
chown -R root:resume-ai-verify "$STAGING_RELEASE"
chmod -R u=rX,g=rX,o= "$STAGING_RELEASE"
mv -- "$STAGING_RELEASE" "$VERIFY_RELEASE"
sync -f "$VERIFY_ROOT"
FINAL_ASSET_TREE_SHA256="$(hash_runtime_tree --root "$VERIFY_RELEASE/.next" \
  --exclude-relative cache)" \
  || fail "final production asset tree could not be hashed"
[ "$FINAL_ASSET_TREE_SHA256" = "$ASSET_TREE_SHA256" ] \
  || fail "production pruning modified frozen application assets"
PRODUCTION_DEPENDENCIES_SHA256="$(hash_runtime_tree \
  --root "$VERIFY_RELEASE/node_modules")" \
  || fail "production dependency tree could not be hashed"
[[ "$PRODUCTION_DEPENDENCIES_SHA256" =~ ^[a-f0-9]{64}$ ]] \
  || fail "production dependency digest is malformed"
printf '%s\n' "$PRODUCTION_DEPENDENCIES_SHA256" \
  > "$ARTIFACT_DIR/production-dependencies-sha256.txt"
STAGING_RELEASE=$VERIFY_RELEASE

backup_result="$("$SCRIPT_DIR/backup-postgres.sh" predeploy)"
printf '%s\n' "$backup_result"

MIGRATION_MANIFEST="$STAGING_RELEASE/ops/config/migrations.manifest"
[ -s "$MIGRATION_MANIFEST" ] || fail "expand-only migration manifest is missing"
declared_migrations=()
declare -A seen_migrations=()
while read -r expected_hash migration_name migration_mode extra; do
  case "$expected_hash" in ''|'#'*) continue ;; esac
  [ -z "${extra:-}" ] || fail "invalid migration manifest row"
  [[ "$expected_hash" =~ ^[a-f0-9]{64}$ ]] || fail "invalid migration hash"
  [[ "$migration_name" =~ ^[0-9]{8}_[a-z0-9_]+\.sql$ ]] || fail "invalid migration filename"
  [ "$migration_mode" = expand ] || fail "only expand migrations are allowed during canary deployment"
  [ -z "${seen_migrations[$migration_name]:-}" ] || fail "duplicate migration manifest entry: $migration_name"
  seen_migrations[$migration_name]=1
  migration_path="$STAGING_RELEASE/db/migrations/$migration_name"
  [ -f "$migration_path" ] && [ ! -L "$migration_path" ] || fail "declared migration is missing or unsafe"
  [ "$(sha256sum "$migration_path" | awk '{print $1}')" = "$expected_hash" ] \
    || fail "migration checksum mismatch: $migration_name"
  if [ "$migration_name" = 20260826_runtime_delete_functions.sql ]; then
    [ "$expected_hash" = 8f60e9129bb9bd3e74a2880383f05f3b8b4fd392cd74939fb9e4cf1e3463f2eb ] \
      || fail "reviewed runtime RPC migration hash is not the frozen contract"
    /usr/local/lib/resume-ai/validate-reviewed-migration.py "$migration_path"
  else
    /usr/local/lib/resume-ai/validate-expand-migration.py "$migration_path"
  fi
  declared_migrations+=("$migration_name:$expected_hash")
done < "$MIGRATION_MANIFEST"
[ "${#declared_migrations[@]}" -ge 1 ] || fail "migration manifest is empty"
mapfile -t actual_migrations < <(find "$STAGING_RELEASE/db/migrations" -maxdepth 1 -type f -name '*.sql' -printf '%f\n' | sort)
[ "${#actual_migrations[@]}" -eq "${#declared_migrations[@]}" ] || fail "undeclared migration file exists"
for migration_index in "${!actual_migrations[@]}"; do
  [ "${actual_migrations[$migration_index]}" = "${declared_migrations[$migration_index]%%:*}" ] \
    || fail "migration manifest and directory content differ"
done

database_identity="$(/usr/local/lib/resume-ai/read-postgres-runtime-identity.sh)"
DATABASE_NAME=${database_identity#*$'\t'}
[[ "$DATABASE_NAME" =~ ^[a-z_][a-z0-9_]{0,62}$ ]] || fail "runtime database name is invalid"
unset database_identity
MIGRATION_TEMP_DIR="$(mktemp -d /run/resume-ai-migrations.XXXXXX)"
chown root:postgres "$MIGRATION_TEMP_DIR"
chmod 0750 "$MIGRATION_TEMP_DIR"
[ "$(readlink -e -- "$MIGRATION_TEMP_DIR")" = "$MIGRATION_TEMP_DIR" ] \
  && [ "$(stat -c '%U:%G:%a' "$MIGRATION_TEMP_DIR")" = root:postgres:750 ] \
  || fail "migration runtime directory is not traversable only by root/postgres"
migration_driver="$MIGRATION_TEMP_DIR/driver.sql"
cat > "$migration_driver" <<'SQL'
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout TO '5s';
SET LOCAL statement_timeout TO '60s';
SELECT pg_advisory_xact_lock(hashtextextended('resume-ai-expand-migrations', 0));
CREATE TABLE IF NOT EXISTS resume_ai_schema_migrations (
  migration_name text PRIMARY KEY,
  migration_sha256 text NOT NULL CHECK (migration_sha256 ~ '^[a-f0-9]{64}$'),
  migration_mode text NOT NULL CHECK (migration_mode = 'expand'),
  applied_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE resume_ai_schema_migrations OWNER TO postgres;
REVOKE ALL PRIVILEGES ON TABLE resume_ai_schema_migrations FROM PUBLIC;
SQL
for migration_entry in "${declared_migrations[@]}"; do
  migration_name=${migration_entry%%:*}
  migration_hash=${migration_entry#*:}
  runtime_migration="$MIGRATION_TEMP_DIR/$migration_name"
  install -o root -g postgres -m 0440 "$STAGING_RELEASE/db/migrations/$migration_name" "$runtime_migration"
  cat >> "$migration_driver" <<EOF
SELECT NOT EXISTS (
  SELECT 1 FROM resume_ai_schema_migrations
  WHERE migration_name = '$migration_name' AND migration_sha256 <> '$migration_hash'
) AS migration_checksum_ok \gset
\if :migration_checksum_ok
  \i '$runtime_migration'
  INSERT INTO resume_ai_schema_migrations (migration_name, migration_sha256, migration_mode)
  VALUES ('$migration_name', '$migration_hash', 'expand')
  ON CONFLICT (migration_name) DO NOTHING;
\else
  \echo 'migration checksum changed: $migration_name'
  \quit 42
\endif
EOF
done
cat >> "$migration_driver" <<'SQL'
REVOKE ALL PRIVILEGES ON TABLE resume_ai_schema_migrations FROM PUBLIC;
COMMIT;
SQL
chown root:postgres "$migration_driver"
chmod 0440 "$migration_driver"
postgres_peer psql --dbname="$DATABASE_NAME" --no-psqlrc --set=ON_ERROR_STOP=1 \
  --file="$migration_driver" >/dev/null

cmp -s "$STAGING_RELEASE/ops/postgresql/runtime-table-privileges.conf" \
  /etc/resume-ai/runtime-table-privileges.conf \
  || fail "candidate and installed runtime database privilege policies differ"
cmp -s "$STAGING_RELEASE/ops/postgresql/runtime-function-privileges.conf" \
  /etc/resume-ai/runtime-function-privileges.conf \
  || fail "candidate and installed runtime database function policies differ"
export EXPECTED_RUNTIME_TABLE_POLICY_SHA256
export EXPECTED_RUNTIME_FUNCTION_POLICY_SHA256
EXPECTED_RUNTIME_TABLE_POLICY_SHA256="$(sha256sum "$STAGING_RELEASE/ops/postgresql/runtime-table-privileges.conf" | awk '{print $1}')"
EXPECTED_RUNTIME_FUNCTION_POLICY_SHA256="$(sha256sum "$STAGING_RELEASE/ops/postgresql/runtime-function-privileges.conf" | awk '{print $1}')"
if [ "$ACTIVE_REQUIRES_DIRECT_DELETE" -eq 1 ]; then
  if ! /usr/local/lib/resume-ai/provision-postgres-runtime-role.sh verify-compat >/dev/null 2>&1; then
    ACK_POSTGRES_RUNTIME_HARDENING=YES \
      /usr/local/lib/resume-ai/provision-postgres-runtime-role.sh prepare
  fi
  /usr/local/lib/resume-ai/provision-postgres-runtime-role.sh verify-compat >/dev/null
  DATABASE_DELETE_MODE=legacy-delete
else
  if ! /usr/local/lib/resume-ai/provision-postgres-runtime-role.sh verify >/dev/null 2>&1; then
    ACK_POSTGRES_RUNTIME_HARDENING=YES \
      /usr/local/lib/resume-ai/provision-postgres-runtime-role.sh reconcile
  fi
  /usr/local/lib/resume-ai/provision-postgres-runtime-role.sh verify >/dev/null
  DATABASE_DELETE_MODE=rpc-only
fi

# Candidate-owned verification SQL is never opened or executed against the
# production cluster.  Behavioral DML/RPC coverage already ran inside the
# disposable cluster above.  Production receives only the root-installed,
# control-generation-bound catalog/ACL verifier through a same-name peer role
# that cannot RESET ROLE back to postgres.
if ! /usr/local/lib/resume-ai/provision-postgres-verifier-role.sh verify >/dev/null 2>&1; then
  ACK_POSTGRES_VERIFIER_ROLE=YES \
    /usr/local/lib/resume-ai/provision-postgres-verifier-role.sh reconcile
fi
/usr/local/lib/resume-ai/provision-postgres-verifier-role.sh verify >/dev/null
/usr/local/lib/resume-ai/verify-production-database-readonly.sh >/dev/null
if [ "$DATABASE_DELETE_MODE" = legacy-delete ]; then
  /usr/local/lib/resume-ai/provision-postgres-runtime-role.sh verify-compat
else
  /usr/local/lib/resume-ai/provision-postgres-runtime-role.sh verify
fi
ACK_POSTGRES_MAINTENANCE=YES \
  /usr/local/lib/resume-ai/provision-postgres-maintenance-role.sh reconcile
/usr/local/lib/resume-ai/provision-postgres-maintenance-role.sh verify
find "$MIGRATION_TEMP_DIR" -depth -delete
MIGRATION_TEMP_DIR=""
unset DATABASE_NAME

mv -- "$STAGING_RELEASE" "$FINAL_RELEASE"
set_tree_readonly_for_runtime "$FINAL_RELEASE"
runtime_cache="/var/cache/resume-ai/$RELEASE_ID"
install -d -o resume-ai -g resume-ai -m 0750 "$runtime_cache"
rm -rf -- "$FINAL_RELEASE/.next/cache"
ln -s "$runtime_cache" "$FINAL_RELEASE/.next/cache"
chown -h root:resume-ai "$FINAL_RELEASE/.next/cache"
[ -L "$FINAL_RELEASE/.next/cache" ] \
  && [ "$(stat -c '%U:%G:%h' "$FINAL_RELEASE/.next/cache")" = root:resume-ai:1 ] \
  && [ "$(readlink -- "$FINAL_RELEASE/.next/cache")" = "$runtime_cache" ] \
  && [ "$(readlink -e -- "$FINAL_RELEASE/.next/cache")" = "$runtime_cache" ] \
  || fail "release cache link was not published with the exact no-follow identity"

fsync_tree() {
  local tree=$1 member
  local -a members=()
  mapfile -d '' members < <(find "$tree" -xdev -type f -print0)
  for member in "${members[@]}"; do sync -f "$member"; done
  members=()
  mapfile -d '' members < <(find "$tree" -xdev -depth -type d -print0)
  for member in "${members[@]}"; do sync -f "$member"; done
}
fsync_tree "$FINAL_RELEASE"
fsync_tree "$ARTIFACT_DIR"
sync -f "$runtime_cache"
sync -f /var/cache/resume-ai
sync -f "$RELEASE_ROOT"
sync -f "$ARTIFACT_ROOT"

# Freeze every candidate control as root-only shadow data before the candidate
# can receive traffic. Live root controls remain the old trusted generation
# throughout validation and soak; the shadow is published only at commit.
ACK_CONTROL_PLANE_GENERATION=YES ACK_ADOPT_UNMANAGED_CONTROL_PLANE=YES \
  /usr/local/lib/resume-ai/install-control-plane-generation.sh stage \
  "$FINAL_RELEASE" "$ARTIFACT_DIR/source-manifest.txt"

# Persist the recovery contract before the candidate slot is mutated. A later
# write of the same phase records that PM2's validated candidate dump is also
# durable; recovery treats either prepared record as a rollback-to-old action.
write_journal prepared
CANDIDATE_SLOT_TOUCHED=1
start_release_process "$RELEASE_ID" "$CANDIDATE_PORT"
candidate_url="http://127.0.0.1:$CANDIDATE_PORT/"
deadline=$((SECONDS + 90))
until candidate_status="$(root_curl -sS --connect-timeout 2 --max-time 5 \
  -o /dev/null -w '%{http_code}' "$candidate_url")" && [ "$candidate_status" = 200 ]; do
  [ "$SECONDS" -lt "$deadline" ] || fail "candidate did not become healthy within 90 seconds"
  sleep 2
done
runuser -u resume-ai -- env -i HOME=/var/lib/resume-ai \
  PATH=/opt/nodejs/current/bin:/usr/bin:/bin \
  "$NODE_BIN" "$FINAL_RELEASE/scripts/verify-next-assets.mjs" "$candidate_url"
pm2_as_app pm2 save
sync -f "$PM2_HOME/dump.pm2"
sync -f "$PM2_HOME"
write_journal prepared

candidate_snapshot="/var/lib/resume-ai/security/cloud-snapshots/$RELEASE_ID.env"
[ ! -e "/var/lib/resume-ai/security/cloud-snapshots/$RELEASE_ID.pending" ] \
  && [ ! -L "/var/lib/resume-ai/security/cloud-snapshots/$RELEASE_ID.pending" ] \
  && [ -f "$candidate_snapshot" ] && [ ! -L "$candidate_snapshot" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$candidate_snapshot")" = root:root:400:1 ] \
  && [ -f /usr/local/lib/resume-ai/record-cloud-snapshot-evidence.py ] \
  && [ ! -L /usr/local/lib/resume-ai/record-cloud-snapshot-evidence.py ] \
  && [ "$(stat -c '%U:%G:%a:%h' /usr/local/lib/resume-ai/record-cloud-snapshot-evidence.py)" = root:root:755:1 ] \
  || fail "candidate post-provision snapshot evidence is missing, pending, or unsafe"
root_python /usr/local/lib/resume-ai/record-cloud-snapshot-evidence.py \
  --verify-pre-switch "$candidate_snapshot" "$RELEASE_ID" >/dev/null \
  || fail "candidate post-provision snapshot continuity failed before traffic switch"
unset candidate_snapshot

SWITCH_STARTED=1
upstream_temp="$(mktemp /etc/nginx/conf.d/.resume-ai-upstream.XXXXXX)"
cat > "$upstream_temp" <<EOF
# Managed atomically by ops/bin/deploy-release.sh.
upstream resume_ai_active {
    server 127.0.0.1:$CANDIDATE_PORT max_fails=2 fail_timeout=10s;
    keepalive 32;
}
EOF
chmod 0644 "$upstream_temp"
mv -f -- "$upstream_temp" "$NGINX_UPSTREAM"
sync -f "$NGINX_UPSTREAM"
sync -f /etc/nginx/conf.d
nginx -t
systemctl reload nginx
write_journal nginx_switched

current_temp="/opt/resume-ai/.current-$RELEASE_ID"
ln -s "releases/$RELEASE_ID" "$current_temp"
mv -Tf -- "$current_temp" "$CURRENT_LINK"
sync -f /opt/resume-ai
state_temp="$(mktemp "$STATE_DIR/.active.XXXXXX")"
cat > "$state_temp" <<EOF
ACTIVE_PORT=$CANDIDATE_PORT
ACTIVE_RELEASE=$RELEASE_ID
PREVIOUS_PORT=$ACTIVE_PORT
PREVIOUS_RELEASE=$ACTIVE_RELEASE
SWITCHED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF
chown root:resume-ai "$state_temp"
chmod 0640 "$state_temp"
mv -f -- "$state_temp" "$STATE_FILE"
sync -f "$STATE_FILE"
sync -f "$STATE_DIR"
/usr/local/lib/resume-ai/configure-security-state-cleanup.sh
systemctl start resume-ai-security-state-cleanup.service
"/usr/local/lib/resume-ai/write-database-permission-state.sh" \
  "$RELEASE_ID" "$DATABASE_DELETE_MODE"
ALLOW_PENDING_TRANSACTION=1 \
  /usr/local/lib/resume-ai/verify-release-consistency.sh "$STATE_FILE" >/dev/null
printf '%s\n' "Release switched; observing for $SOAK_SECONDS seconds"
soak_deadline=$((SECONDS + SOAK_SECONDS))
next_public_check=$SECONDS
run_soak_security_gate() {
  local gate_dir endpoint endpoint_id status header_name header_count security_text public_status
  gate_dir="$(mktemp -d /run/resume-ai-soak-gate.XXXXXX)"
  for endpoint in \
    /api/competitions/recommend/normalize \
    /api/ai/competition-clarify \
    /api/ai/competition-recommend; do
    endpoint_id="$(printf '%s' "$endpoint" | sha256sum | awk '{print $1}')"
    status="$(root_curl -sS --proto '=https' --tlsv1.2 --connect-timeout 5 --max-time 10 \
      -D "$gate_dir/$endpoint_id.headers" -o "$gate_dir/$endpoint_id.body" \
      -w '%{http_code}' -H 'Content-Type: application/json' --data-binary '{}' \
      "${PUBLIC_URL%/}$endpoint")"
    case "$status" in 400|401|403|405|415|422) ;; *) rm -rf -- "$gate_dir"; fail "invalid API probe did not fail closed at $endpoint (HTTP $status)" ;; esac
    header_count="$(awk -F: 'tolower($1) == "x-request-id" { count += 1 } END { print count + 0 }' "$gate_dir/$endpoint_id.headers")"
    [ "$header_count" -eq 1 ] || { rm -rf -- "$gate_dir"; fail "API probe lacks one request correlation ID"; }
  done
  public_status="$(root_curl -sS --proto '=https' --tlsv1.2 --connect-timeout 5 --max-time 10 \
    -D "$gate_dir/public.headers" -o /dev/null -w '%{http_code}' "$PUBLIC_URL")"
  [ "$public_status" = 200 ] \
    || { rm -rf -- "$gate_dir"; fail "public homepage returned HTTP $public_status during soak"; }
  for header_name in strict-transport-security content-security-policy x-request-id; do
    header_count="$(awk -F: -v name="$header_name" 'tolower($1) == name { count += 1 } END { print count + 0 }' "$gate_dir/public.headers")"
    [ "$header_count" -eq 1 ] || { rm -rf -- "$gate_dir"; fail "$header_name drifted during soak"; }
  done
  security_text="$(root_curl -fsS --proto '=https' --tlsv1.2 --connect-timeout 5 --max-time 10 \
    "${PUBLIC_URL%/}/.well-known/security.txt")"
  printf '%s\n' "$security_text" | grep -Fxq 'Contact: mailto:privacy@siyuanjiaxin.com' \
    || { rm -rf -- "$gate_dir"; fail "security.txt drifted during soak"; }
  runuser -u resume-ai -- env -i HOME=/var/lib/resume-ai \
    "$NODE_BIN" "$FINAL_RELEASE/scripts/verify-next-assets.mjs" "$candidate_url"
  rm -rf -- "$gate_dir"
}
while [ "$SECONDS" -lt "$soak_deadline" ]; do
  candidate_status="$(root_curl -sS --connect-timeout 2 --max-time 5 \
    -o /dev/null -w '%{http_code}' "$candidate_url")" \
    && [ "$candidate_status" = 200 ] \
    || fail "candidate health failed during soak (HTTP ${candidate_status:-000})"
  if [ "$SECONDS" -ge "$next_public_check" ]; then
    run_soak_security_gate
    next_public_check=$((SECONDS + 60))
  fi
  sleep "$SOAK_INTERVAL_SECONDS"
done

write_journal hardening_started
# From this durable point onward, any failure path must assume that the
# transaction may have revoked legacy table DELETE (including a failure after
# COMMIT but before the verifier returns). Restoration is idempotent and must
# happen before traffic can return to a legacy release.
DB_PERMISSIONS_HARDENED=1
ACK_POSTGRES_RUNTIME_HARDENING=YES \
  /usr/local/lib/resume-ai/provision-postgres-runtime-role.sh reconcile
/usr/local/lib/resume-ai/provision-postgres-runtime-role.sh verify >/dev/null
/usr/local/lib/resume-ai/write-database-permission-state.sh "$RELEASE_ID" rpc-only
write_journal permissions_hardened
# The active topology and rpc-only database contract are now the durable
# forward-recovery decision, but remain locally rollbackable.  Install the
# frozen generation while retaining its backup journal, then run every
# privileged proof from those exact installed bytes.  This avoids both an
# old-control/new-app mixed generation and a failure window after rollback was
# disabled.
write_journal state_committed
ACK_CONTROL_PLANE_GENERATION=YES \
  /usr/local/lib/resume-ai/install-control-plane-generation.sh commit \
  "$FINAL_RELEASE" "$ARTIFACT_DIR/source-manifest.txt"
/usr/local/lib/resume-ai/backup-postgres.sh daily >/dev/null
/usr/local/lib/resume-ai/verify-postgres-restore.sh >/dev/null
/usr/local/lib/resume-ai/verify-production-database-readonly.sh >/dev/null
ALLOW_PENDING_TRANSACTION=1 /usr/local/lib/resume-ai/verify-release-consistency.sh \
  "$STATE_FILE" >/dev/null
write_deployment_complete_marker
# Stop the validation-log writer before the artifact is made immutable.  The
# durable state_committed journal remains authoritative until a *final* host
# gate has observed the sealed tree and exact completion marker.
exec 1>&6 2>&7
wait
chmod -R a-w "$ARTIFACT_DIR"
chmod 0550 "$ARTIFACT_DIR"
fsync_tree "$ARTIFACT_DIR"
sync -f "$ARTIFACT_ROOT"
# The full host gate is explicitly allowed to observe only an installed,
# rollbackable control journal bound to this state_committed deploy.  On pass,
# finalization removes only the control receipt/stage; it changes no live byte.
ALLOW_PENDING_TRANSACTION=1 RUN_CERTBOT_DRY_RUN=0 \
  /usr/local/lib/resume-ai/verify-production-host.sh
ACK_CONTROL_PLANE_GENERATION=YES \
  /usr/local/lib/resume-ai/install-control-plane-generation.sh finalize \
  "$FINAL_RELEASE" "$ARTIFACT_DIR/source-manifest.txt"
# Once the generation is finalized, the still-durable state_committed deploy
# journal is sufficient for boot recovery.  Disable the local rollback trap
# before clearing it; a failed unlink therefore recovers forward, never into a
# mixed generation.
DEPLOYMENT_COMMITTED=1
rm -f -- "$PENDING_FILE"
sync -f "$STATE_DIR"
# Re-run without either pending allowance to close the final TOCTOU window.
RUN_CERTBOT_DRY_RUN=0 /usr/local/lib/resume-ai/verify-production-host.sh
"$SCRIPT_DIR/prune-releases.sh"
rm -f -- "$STATE_BACKUP" "$UPSTREAM_BACKUP" "$DATABASE_STATE_BACKUP"
printf '%s\n' "Release $RELEASE_ID passed the 30-minute production observation window and final sealed-host gate."
trap - ERR EXIT
