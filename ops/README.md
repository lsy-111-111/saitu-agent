# Resume AI production runbook

`ops/` is the only supported production control plane. `deploy/setup.sh` is
permanently retired and always exits 64. Never run it to create a database,
install Nginx, or deploy an application.

Every mutating entrypoint requires a named `ACK_*` value. Read that script,
resolve its exact target, and confirm the prerequisite before supplying the
acknowledgement. Cloud snapshot, security-group, SSH-source and alert changes
remain separate Tencent Cloud console actions and require individual approval.

## 0. First-root bootstrap boundary

Freeze the complete source before touching the host. On the trusted
workstation, generate the canonical bootstrap manifest once, check it, and
record the copier and manifest SHA-256 values in an out-of-band operator
record. The manifest deliberately inventories every ordinary file below
`ops/` plus the external control sources named by
`ops/config/control-plane-files.conf`; any later source or documentation edit
requires a new manifest and invalidates the previous values.

```bash
/usr/bin/python3 -I ops/bin/generate-bootstrap-source-manifest.py generate "$PWD" \
  > bootstrap-source-manifest.txt
/usr/bin/python3 -I ops/bin/generate-bootstrap-source-manifest.py check \
  "$PWD" "$PWD/bootstrap-source-manifest.txt"
shasum -a 256 ops/bin/create-bootstrap-generation.py bootstrap-source-manifest.txt
```

Before any upload, root command, package change or bootstrap installation on
the server, create the separately approved Tencent Lighthouse system-disk
snapshot named exactly
`resume-ai-initial-rollback-20260826T041035Z`. Wait for `NORMAL`/100%, then
obtain the raw, single-resource `DescribeSnapshots` and `DescribeDisks` JSON
responses. Their `CreatedTime` must predate the first bootstrap invocation.
A screenshot or console success banner is not API evidence.

Only after that snapshot exists may the reviewed source be uploaded to one new
unprivileged staging directory. Do not run any script from that directory with
`sudo`. Install only the copier bytes, compare the installed file to the
out-of-band literal, and let that fixed copier create the content-addressed,
root-only generation. `REVIEWED_*` below must be literal values copied from the
trusted workstation record; never derive them from the uploaded tree or from
candidate-produced output on the server.

```bash
SOURCE_ROOT=/absolute/unprivileged/reviewed-source
REVIEWED_COPIER_SHA256=OUT_OF_BAND_64_HEX
REVIEWED_BOOTSTRAP_MANIFEST_SHA256=OUT_OF_BAND_64_HEX

sudo /usr/bin/install -d -o root -g root -m 0755 /usr/local/lib/resume-ai
sudo /usr/bin/install -o root -g root -m 0555 \
  "$SOURCE_ROOT/ops/bin/create-bootstrap-generation.py" \
  /usr/local/lib/resume-ai/create-bootstrap-generation.py
[ "$(sudo /usr/bin/sha256sum /usr/local/lib/resume-ai/create-bootstrap-generation.py | /usr/bin/awk '{print $1}')" \
  = "$REVIEWED_COPIER_SHA256" ]
[ "$(/usr/bin/sha256sum "$SOURCE_ROOT/bootstrap-source-manifest.txt" | /usr/bin/awk '{print $1}')" \
  = "$REVIEWED_BOOTSTRAP_MANIFEST_SHA256" ]
BOOTSTRAP_GENERATION=$(sudo /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin \
  /usr/bin/python3 -I /usr/local/lib/resume-ai/create-bootstrap-generation.py \
  create "$SOURCE_ROOT" "$SOURCE_ROOT/bootstrap-source-manifest.txt" \
  "$REVIEWED_BOOTSTRAP_MANIFEST_SHA256" "$REVIEWED_COPIER_SHA256")
[ "$BOOTSTRAP_GENERATION" \
  = "/var/lib/resume-ai/bootstrap-generations/generation-$REVIEWED_BOOTSTRAP_MANIFEST_SHA256" ]
```

Create `/var/lib/resume-ai/security/cloud-snapshots` as root:root `0700`, copy
the two raw Tencent responses into separate root-owned `0400` ordinary files,
and import them with the snapshot helper inside that exact generation. The
helper verifies instance `lhins-aw4n6o9t`, the attached Guangzhou system disk,
the exact snapshot name, API request IDs, snapshot uniqueness and the
snapshot-before-bootstrap timestamp. Keep the JSON inputs root-only; do not
place them in a release archive.

```bash
sudo /usr/bin/install -d -o root -g root -m 0700 /root/evidence
sudo /usr/bin/install -o root -g root -m 0400 \
  /absolute/upload/describe-snapshot.json /root/evidence/describe-snapshot.json
sudo /usr/bin/install -o root -g root -m 0400 \
  /absolute/upload/describe-disks.json /root/evidence/describe-disks.json
sudo ACK_RECORD_CLOUD_SNAPSHOT_EVIDENCE=INITIAL_PRE_CHANGE_ROLLBACK \
  /usr/bin/python3 -I \
  "$BOOTSTRAP_GENERATION/ops/bin/record-cloud-snapshot-evidence.py" \
  --api-initial-rollback /root/evidence/describe-snapshot.json \
  /root/evidence/describe-disks.json 20260826T041035Z \
  /var/lib/resume-ai/security/cloud-snapshots
```

Every first-root command below must resolve inside the same
`$BOOTSTRAP_GENERATION`. The fixed verifier recreates its persistent root lock
safely after reboot and rejects a changed generation, active receipt, copier,
manifest, link, hardlink or special file.

## 1. Freeze pre-change evidence

Keep the current Ed25519 SSH/sudo session open. After the initial snapshot API
evidence above has been accepted, capture the root-only host baseline from the
same bootstrap generation:

```bash
INITIAL_SNAPSHOT_EVIDENCE=/var/lib/resume-ai/security/cloud-snapshots/20260826T041035Z.initial-rollback.env
HOST_BASELINE_DIR=$(sudo ACK_CAPTURE_HOST_BASELINE=YES \
  SOURCE_DIR=/home/ubuntu/resume-ai-web-releases/20260826T041035Z \
  INITIAL_SNAPSHOT_RELEASE_ID=20260826T041035Z \
  INITIAL_SNAPSHOT_EVIDENCE="$INITIAL_SNAPSHOT_EVIDENCE" \
  "$BOOTSTRAP_GENERATION/ops/bin/capture-host-baseline.sh")
HOST_BASELINE_MANIFEST_SHA256=$(sudo /usr/bin/sha256sum "$HOST_BASELINE_DIR/SHA256SUMS" | /usr/bin/awk '{print $1}')
```

The evidence is stored under `/var/backups/resume-ai/prechange`; application
secrets and SSH host private keys are deliberately excluded. For the one-time
legacy adoption, the baseline also contains a stable no-follow manifest of the
sanitized `.next` and `node_modules` runtime so the still-untrusted `ubuntu`
account cannot substitute different built bytes between review and adoption.

## 2. Pinned host runtime and packages

The only approved application toolchain is official Node.js 24.20.0
(`node-v24.20.0-linux-x64.tar.xz`, frozen SHA-256), PM2 7.0.4 and pnpm 11.19.0.
The installer verifies the archive and npm integrity values, records a
zero-vulnerability runtime audit and file hashes, recursively flushes the
immutable runtime before switching `/opt/nodejs/current`, and retains rollback
evidence. A durable `/opt/nodejs/node-runtime.pending` journal and
`resume-ai-node-runtime-recovery.service` restore the old pointer, PM2 unit,
dump and NodeSource configuration after interruption before PM2 is allowed to
boot. It does not use `curl | bash` or the EOL NodeSource 20 runtime.

```bash
sudo ACK_NODE24_RUNTIME_UPGRADE=YES \
  HOST_BASELINE_DIR="$HOST_BASELINE_DIR" \
  HOST_BASELINE_MANIFEST_SHA256="$HOST_BASELINE_MANIFEST_SHA256" \
  "$BOOTSTRAP_GENERATION/ops/bin/install-node-runtime.sh"
sudo ACK_INSTALL_RUNTIME_LAYOUT=YES \
  HOST_BASELINE_DIR="$HOST_BASELINE_DIR" \
  HOST_BASELINE_MANIFEST_SHA256="$HOST_BASELINE_MANIFEST_SHA256" \
  "$BOOTSTRAP_GENERATION/ops/bin/install-runtime-layout.sh"
```

Populate `/etc/resume-ai/app.env` as one `root:resume-ai` mode-0640 regular
file. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are server-runtime-only and must
be configured together; none is exposed to build, test, preflight, bundle or
logs. The provider is exactly DeepSeek and the two optional endpoint overrides
may only equal the reviewed `api.deepseek.com` URLs.

The current production observation records all four Supabase configuration
checks as `absent`. This proves only that Supabase analytics is dormant; it is
not evidence that migration `004` (or any earlier Supabase migration) has been
applied to a remote project, and the release report must not claim otherwise.
Before enabling analytics in the future, execute and verify migrations
`001` through `004` in order on the exact target Supabase project. Acceptance
requires `pg_cron`, exactly one active reviewed retention job, the anonymous
event constraint, and the reviewed table/function privileges. Only after every
check passes may the two application variables above be populated together.
If any prerequisite is missing or ambiguous, leave them absent and fail closed.

Install Ubuntu security/regular updates and the reviewed unattended-upgrade
policy, which enables security origins but forbids automatic reboot:

```bash
sudo ACK_INSTALL_UNATTENDED_UPGRADES=YES \
  "$BOOTSTRAP_GENERATION/ops/bin/install-unattended-upgrades.sh"
```

Migrate Nginx with the single transactional entrypoint only:

```bash
sudo ACK_MIGRATE_NGINX_1_30_4=YES \
  "$BOOTSTRAP_GENERATION/ops/bin/migrate-nginx-1.30.4.sh"
```

It verifies the exact official multi-primary signing-key set, pins
`nginx=1.30.4-1~jammy`, caches and simulates the complete Ubuntu
`1.18.0-6ubuntu14.20` security-candidate rollback set, and binds all nine
cached package identities, architectures, filenames, and SHA-256 values to a
canonical contract that boot recovery independently re-verifies. It preserves the active
3000/3001 port, validates Certbot compatibility, and journals every durable
phase. `recover-nginx-migration.sh` is ordered before Nginx at boot. The old
split `install-nginx-*` scripts are retired and must not be used.

### One-time adoption of the currently unmanaged release

If `/opt/resume-ai/state/active.env` is absent and the only live application is
the reviewed `ubuntu` PM2 process in
`/home/ubuntu/resume-ai-web-releases/20260826T041035Z`, do not use
`initialize-release-state.sh` and do not stop that process manually. After the
cloud snapshot, source-bound host baseline, Node 24 runtime/layout and Nginx
transaction are complete, run the dedicated adoption writer with the exact live
PM2 PID:

```bash
sudo ACK_LEGACY_ADOPTION=YES \
  CLOUD_SNAPSHOT_CONFIRMED=YES \
  CLOUD_SNAPSHOT_ID=lhsnap-REVIEWED_ID \
  HOST_BASELINE_DIR=/var/backups/resume-ai/prechange/UTC_BASELINE_ID \
  /usr/local/lib/resume-ai/adopt-legacy-release.sh \
  LIVE_PM2_PID 20260826T041035Z
```

The writer requires the PID's exact `/proc/PID/cwd`, PM2 name, port and
baseline hashes. It copies `.env.local` only to the separate
`/etc/resume-ai/legacy.env` (`root:resume-ai`, 0640) after matching the exact 31
observed key names. Values and value hashes never enter evidence. The cloned
release excludes every `.env*`/package-manager credential, rejects escaping
links, hardlinks and special files, and scans all ordinary files—including
`.next` and `node_modules`—for the real non-public legacy values without
printing them.

The root-owned immutable clone is started by `resume-ai` with Node 24 on 3001.
Only after health, assets, all three API fail-closed probes, the dedicated PM2
dump, Nginx, `current`, `active.env`, and `legacy-delete` evidence agree is the
old ubuntu PM2 process stopped. The independent
`legacy-adoption.pending` journal is fsynced in the `initializing` phase before
the first environment/evidence/release mutation. At boot, upstream 3000
preserves/restores the old service and safely quarantines partial preparation;
upstream 3001 completes adoption. A recovery error leaves Nginx blocked. Full
host acceptance remains intentionally unavailable until the first
manifest-bound release completes its canary and rpc-only database hardening.
While the adopted release is the immediate rollback target, host acceptance
requires its isolated `legacy.env`; once that rollback window closes, host
acceptance instead requires the legacy secret file to have been retired by a
separately reviewed operation. See `ops/legacy-adoption-runbook.txt`.

Apply conservative host permissions after the snapshot:

```bash
sudo ACK_HARDEN_HOST_FILES=YES \
  /usr/local/lib/resume-ai/harden-host-file-permissions.sh
```

Disabling the locked `lighthouse` sudo identity additionally requires
`ACK_DISABLE_LIGHTHOUSE=YES` and
`CLOUD_CONSOLE_LIGHTHOUSE_DEPENDENCY=CONFIRMED_ABSENT`; do not guess that cloud
dependency. The command retains the previous sudoers file and validates the
replacement with `visudo`.

Disable, but never execute or repair, the recursive legacy startup file:

```bash
sudo ACK_DISABLE_RC_LOCAL=YES \
  "$BOOTSTRAP_GENERATION/ops/bin/disable-rc-local.sh"
```

The migration publishes a root-only, completion-marker-bound backup under
`/var/backups/resume-ai/rc-local/UTC_ID` before changing any startup control.
It records the fixed path allowlist, including absent controls, file ownership,
mode, link target and content hashes. Verify a selected generation before any
recovery work:

```bash
sudo /usr/bin/python3 -I \
  /usr/local/lib/resume-ai/rc-local-backup.py verify \
  /var/backups/resume-ai/rc-local/UTC_ID --production
```

Recovery is deliberately separate from migration and requires an explicit
acknowledgement. Production recovery restores only the two legacy `rc.local`
evidence paths, forces the script back to inert mode 0644, and leaves the exact
`/dev/null` mask and reviewed QCloud controls unchanged. A durable pending
journal makes an interrupted recovery fail host acceptance. It never starts
`rc-local.service` or executes the restored legacy script:

```bash
sudo ACK_RESTORE_RC_LOCAL=YES /usr/bin/python3 -I \
  /usr/local/lib/resume-ai/rc-local-backup.py restore \
  /var/backups/resume-ai/rc-local/UTC_ID
```

Re-enabling legacy `rc-local`, or restoring any superseded startup control, is
not part of this recovery path and requires a separately reviewed operation.
Test the complete archived allowlist without touching host paths by using
`restore-test` with a private, empty destination root.

## 3. PostgreSQL durability and least privilege

Install root-only backup/restore jobs and create a backup before authorization
or checksum changes:

```bash
sudo ACK_INSTALL_BACKUP_JOBS=YES \
  "$BOOTSTRAP_GENERATION/ops/bin/install-backup-jobs.sh"
sudo /usr/local/lib/resume-ai/backup-postgres.sh predeploy
```

Retention is 14 daily, 8 weekly and 5 pre-deploy backups. Monthly verification
restores to a strictly named temporary database, verifies required tables,
migration ledger/checksums, indexes, constraints and verification SQL, then
drops it. RPO is 24 hours; RTO is 7200 seconds.

After the PostgreSQL security update, enable data checksums only in the approved
downtime window. Provisioning and release migrations use local root-to-postgres
peer authentication, never the application URL or owner password.

After `apt-get update` and the reviewed host-wide upgrade, first prove that the
server, client and libpq packages all match the unheld 14.24 policy, then enable
checksums. The checksum command creates a new checksummed daily backup:

```bash
sudo /usr/local/lib/resume-ai/assert-postgres-security-version.sh \
  /etc/resume-ai/approved-postgres-runtime.conf
sudo ACK_POSTGRES_CHECKSUM_DOWNTIME=YES \
  /usr/local/lib/resume-ai/enable-postgres-checksums.sh
```

The application login role is non-owner/no-DDL and receives only the table DML
allowlist plus EXECUTE on seven byte-frozen SECURITY DEFINER deletion RPCs.
During the first canary, the old release keeps its exact eight-table DELETE set;
only after the new release passes the 30-minute observation does an independent
transaction revoke it. Functions and tables are owned by a NOLOGIN, non-superuser
owner role. Runtime defaults are statement timeout 10s, lock timeout 5s and idle
transaction timeout 15s.

Daily retention does not execute application or Node code. A root-installed SQL
file is launched through local postgres peer auth and immediately `SET ROLE`s to
`resume_ai_security_maintenance`, a NOLOGIN role with SELECT/DELETE on only the
eight fixed retention tables. Batches are 500 rows; consent retention is 180
days.

## 4. Release evidence

Release evidence is generated only in a root-owned Ubuntu Jammy builder copy
that includes the source worktree's `.git` metadata. The copy must be owned by
root and not group/world writable. The workflow deliberately rejects macOS,
bsdtar, an ambient `node`, or a source-only copy without `.git`; it uses fixed
Node `v24.20.0`, pnpm `11.19.0`, `/usr/bin/git`, `/usr/bin/python3` and GNU tar.
There is no portability fallback that can silently change archive membership.

The final x64 evidence run may use the actual Jammy amd64 host as its builder
without stopping the live service, but only from a new root-owned directory
that is physically separate from `/opt/resume-ai/current`, every release
directory and every approval/deploy staging directory. The sequential
PostgreSQL and Playwright gates use an isolated Next production server on
`127.0.0.1:3111`; the PostgreSQL gate additionally starts the exact Nginx
1.30.4 configuration on `127.0.0.1:3112` and sends 50 complete signed
recommendation journeys through one shared source address. Production remains
on 3000/3001. Confirm 3111 and 3112 are free before starting. The builder copy
must contain `.env.example` but no other
root `.env*` file; inject the live DeepSeek preflight key only through the
one-shot process environment. The PostgreSQL gate must receive dedicated local admin and
non-owner runtime URLs whose database name contains `test`, `tmp` or `scratch`;
neither may equal the production `DATABASE_URL`. Never run the evidence gate
against the production database. Keep enough CPU, memory and disk headroom for
the production service throughout the build. An arm64 VM can run the portable
source-membership, syntax and shell checks, but it cannot generate or approve
the formal x64 result: the runner and verifier deliberately require the
immutable `node-v24.20.0-linux-x64` toolchain.

Generate and independently review the source manifest first. Its sole member
inventory is the NUL output of `git ls-files --cached --others
--exclude-standard -z`, minus deleted tracked entries and the explicit
secret/generated/local exclusions. It includes the reviewed `.env.example` but
never real dotenv files, credentials, `.claude`, `.DS_Store`, `*.tsbuildinfo`
or `artifacts`. Git does not represent empty directories, so they are not
release members. Do not modify the index to make evidence.

The three-column source manifest remains the content/kind contract consumed by
deployment. The validation wrapper separately derives a deterministic
`mode<TAB>path` receipt from that exact NUL member set, rejects special bits,
hard links, symlinks and non-root-writable ancestors, and checks the receipt
again after all gates. Prepare embeds its hash/count and bytes in
`release-manifest.json`; approval replays the archive modes and requires the
validation/E2E run to carry the same receipt. Thus mode evidence is bound
without changing the deployed three-column manifest format.

```bash
RELEASE_SOURCE_PATHS_NUL=/root/release-evidence/source-paths.nul \
  /usr/local/lib/resume-ai/create-release-source-manifest.sh "$PWD" \
  > /root/release-evidence/source-manifest.txt
```

Run all application gates through the root-installed coordinator and one new
fixed-path generation. The coordinator refuses an existing output directory or
any output outside `/var/lib/resume-ai/release-evidence-generations`. The
control-plane installer creates that parent as root:root `0700` and provisions
one persistent Ed25519 keypair at
`/etc/resume-ai/release-evidence-signing.{key,pub}`. It never replaces an
existing key and fails closed on wrong ownership/mode, a public key without its
private half, or a private/public mismatch. During an interrupted first
bootstrap only, a missing public half is deterministically re-derived from the
already-published private key; the private key is never regenerated. The
private key is root:root `0600`; the public trust anchor is root:root `0644`.
Both live outside every release and control-plane generation, are never copied
into a release bundle, and must not be rotated as part of deployment. Host
continuity must be covered by a separately confirmed post-provision system-disk
snapshot; losing the private key requires a deliberate trust-anchor rotation
and regeneration of release evidence.

The coordinator records the fixed executable/argv, exit code and raw log hash
for dependency acquisition, typecheck, lint, unit tests, production build,
production dependency audit, real isolated PostgreSQL integration, the real
DeepSeek preflight and E2E. Playwright builds and starts the production
application in that same run with both JSON and HTML reporters. Its result
binds the run ID, source-manifest hash, both reporter hashes, desktop/mobile
statistics and the actual HTTPS `www` redirect response. After all gates pass,
the coordinator signs a byte/path/hash manifest of the complete Linux
validation artifact set. Supplying an old report, rewriting a log or creating a
self-consistent caller-owned result fails signature verification.

```bash
EVIDENCE_RUN_ID=$(/usr/bin/cat /proc/sys/kernel/random/uuid)
/opt/nodejs/node-v24.20.0-linux-x64/bin/node \
  /usr/local/lib/resume-ai/run-release-evidence.mjs \
  --source-manifest /root/release-evidence/source-manifest.txt \
  --output "/var/lib/resume-ai/release-evidence-generations/generation-${EVIDENCE_RUN_ID}" \
  --www-url https://www.siyuanjiaxin.com/release-evidence-probe
```

Treat the printed generation path as read-only. Copy its complete contents,
including `linux-validation-artifact-manifest.txt` and
`linux-validation-attestation.json`, into a new assembly directory before
adding cross-machine evidence. Never regenerate, edit or omit a signed member.
The verifier always loads the independently installed public key; a copied key
inside the assembly is not trusted.

After the source is frozen, create one scanner-readable generation through the
reviewed macOS root helper. The formal exporter does **not** accept the legacy
user-owned `prepare-deep-scan-target.mjs` receipt. Review the creator and
cleanup helper hashes before installing them; install the creator as root:wheel
mode `0444` at its fixed path, then invoke it with the unprivileged scanner UID:

```bash
REVIEWED_CREATOR_SHA256=$(shasum -a 256 scripts/lib/macos_trusted_deep_scan_generation.py | awk '{print $1}')
REVIEWED_CLEANUP_SHA256=$(shasum -a 256 scripts/lib/macos_cleanup_trusted_deep_scan_generation.py | awk '{print $1}')
# Stop here and independently review both hashes before authorizing sudo.
sudo /usr/bin/install -o root -g wheel -m 0444 \
  scripts/lib/macos_trusted_deep_scan_generation.py \
  /Library/PrivilegedHelperTools/com.siyuanjiaxin.resume-ai.create-deep-scan-generation
sudo /usr/bin/install -o root -g wheel -m 0444 \
  scripts/lib/macos_cleanup_trusted_deep_scan_generation.py \
  /Library/PrivilegedHelperTools/com.siyuanjiaxin.resume-ai.cleanup-deep-scan-generation
[ "$(shasum -a 256 /Library/PrivilegedHelperTools/com.siyuanjiaxin.resume-ai.create-deep-scan-generation | awk '{print $1}')" = "$REVIEWED_CREATOR_SHA256" ]
[ "$(shasum -a 256 /Library/PrivilegedHelperTools/com.siyuanjiaxin.resume-ai.cleanup-deep-scan-generation | awk '{print $1}')" = "$REVIEWED_CLEANUP_SHA256" ]
sudo /usr/bin/env -i PATH=/usr/bin:/bin /usr/bin/python3 -I -S \
  /Library/PrivilegedHelperTools/com.siyuanjiaxin.resume-ai.create-deep-scan-generation \
  --source-root "$PWD" \
  --source-manifest /absolute/reviewed/source-manifest.txt \
  --scanner-uid "$(id -u)"
```

The one-line helper result is the independent trust input. Record its exact
`scanSource`, `attestation`, `attestationSha256`, `producerSha256`,
`sourceManifestSha256` and `snapshotDigest` outside the candidate evidence
directory. Confirm the installed creator hash equals both the reviewed source
hash and `producerSha256`; immediately before approval, re-hash the fixed
root-owned attestation and installed creator rather than trusting a saved
user-writable copy of stdout. Do not copy either pin out of a
candidate-generated export.

Run exactly one Codex Security Deep Scan with `targetPath` set to that physical
`scanSource` and `scope` set to `.`. Do not invoke a second scan for evidence.
Immediately after its single completion has sealed `scan-manifest.json`,
`findings.json`, `coverage.json` and `report.md`, export those canonical bytes:

```bash
TRUSTED_DEEP_SCAN_COMPLETION_SHA256=$(shasum -a 256 /absolute/codex-security/scan-directory/scan-manifest.json | awk '{print $1}')
```

Record this third pin directly from the just-completed Codex Security directory;
never derive it from `deep-scan-export.json`. Export and finalize into a fresh
macOS Deep Scan evidence directory, not into the signed Linux generation:

```bash
pnpm evidence:deep-scan:export \
  --scan-dir /absolute/codex-security/scan-directory \
  --scan-target-dir /private/var/db/com.siyuanjiaxin.resume-ai/deep-scan-generations/ds-.../source \
  --trusted-generation-attestation /private/var/db/com.siyuanjiaxin.resume-ai/deep-scan-generations/ds-.../attestation.json \
  --trusted-generation-attestation-sha256 "$TRUSTED_DEEP_SCAN_ATTESTATION_SHA256" \
  --trusted-generation-producer-sha256 "$TRUSTED_DEEP_SCAN_PRODUCER_SHA256" \
  --scan-source-manifest /absolute/reviewed/source-manifest.txt \
  --evidence-dir /absolute/fresh/deep-scan-evidence
```

The export records the authoritative `scanId`, real start/completion/seal
times, canonical artifact hashes, original finding IDs/count and the sealed
completion manifest bytes. A handwritten `{status:"passed"}` result is not an
accepted completion artifact. If the scan has no findings, the scanned source
manifest must byte-equal the final release manifest. If it has findings, fix
them without starting another scan, generate one independent
`codex-security.verify-fix-result` receipt per original finding with
`evidence:deep-scan:close`, and bind every closure to the new final source
manifest. Finalization derives, rather than accepts from the caller, the zero
open/untriaged counts:

```bash
pnpm evidence:deep-scan:finalize \
  --evidence-dir /absolute/fresh/deep-scan-evidence \
  --final-source-manifest /absolute/reviewed/final-source-manifest.txt \
  --final-source-root /absolute/final/source
# Add --closures-dir /absolute/deep-scan-closures only when the
# original scan reported findings.
```

Transfer the finalized `deep-scan-export.json`, `security-scan-report.txt` and
`security-scan-result.json` byte-for-byte into the separate server-side
assembly that already contains the complete signed Linux generation. Re-hash
all three Deep Scan pins from their authoritative root-owned sources; do not
take them from the assembly. No Deep Scan step may modify a signed Linux file.

Bundle creation requires every input explicitly. All five evidence file paths
below must point into the same fresh evidence directory; prepare snapshots that
entire directory plus the reviewed source manifest once and parses only the
snapshot:

```bash
VALIDATION_LOG=/root/release-evidence/assembly-UUID/validation-result.json \
E2E_EVIDENCE=/root/release-evidence/assembly-UUID \
E2E_RESULT=/root/release-evidence/assembly-UUID/e2e-result.json \
REVIEWED_SOURCE_MANIFEST=/absolute/path/source-manifest.txt \
SECURITY_SCAN_REPORT=/root/release-evidence/assembly-UUID/security-scan-report.txt \
SECURITY_SCAN_RESULT=/root/release-evidence/assembly-UUID/security-scan-result.json \
PREVIOUS_RELEASE_ID=YYYYMMDDTHHMMSSZ \
RELEASE_NODE_BIN=/opt/nodejs/current/bin/node \
/usr/local/lib/resume-ai/prepare-release-bundle.sh \
  "$PWD" "$PWD/artifacts/releases"
```

The immutable bundle contains the real tracked binary patch and same-generation
untracked inventory/archive, exact Git-selected source archive/manifest, raw
validation and Playwright evidence, Deep Scan completion/closure evidence, the
prospective baseline and exact `SHA256SUMS`. The outer release manifest binds
the baseline bytes; the baseline never tries to hash its containing manifest.
Prepare re-extracts, scans and semantically verifies the final evidence archive
and its top-level copies before sealing it.

Independently review the SHA allowlist and all evidence, then freeze root
approval without modifying the Git index. Derive
`TRUSTED_REQUIRED_TEST_POLICY_SHA256` independently from the exact reviewed
`ops/config/release-required-tests.json`; approval refuses a value merely
echoed from the candidate bundle unless it also matches the installed fixed
policy, reviewed source row and signed Linux evidence member:

```bash
sudo ACK_APPROVE_RELEASE_BUNDLE=YES \
  TRUSTED_DEEP_SCAN_ATTESTATION_SHA256="$TRUSTED_DEEP_SCAN_ATTESTATION_SHA256" \
  TRUSTED_DEEP_SCAN_PRODUCER_SHA256="$TRUSTED_DEEP_SCAN_PRODUCER_SHA256" \
  TRUSTED_DEEP_SCAN_COMPLETION_SHA256="$TRUSTED_DEEP_SCAN_COMPLETION_SHA256" \
  TRUSTED_REQUIRED_TEST_POLICY_SHA256="$TRUSTED_REQUIRED_TEST_POLICY_SHA256" \
  /usr/local/lib/resume-ai/approve-release-bundle.sh \
  /absolute/path/to/artifacts/releases/YYYYMMDDTHHMMSSZ \
  /absolute/path/to/reviewed-source-manifest.txt
```

When moving a bundle to the server, transfer it into a new root-only directory,
compare the sender's `sha256sum SHA256SUMS release-manifest.json
source-manifest.txt` with the receiver before approval, then let approval
snapshot and re-run bundle semantics. Never approve evidence in place across a
mutable shared path. Set `PREVIOUS_RELEASE_ID` to the exact currently active
release read from the five-way active state immediately before bundle creation;
do not choose “latest”, a directory glob, or an inferred timestamp as rollback.

## 5. Canary deploy and rollback

```bash
sudo ACK_PRODUCTION_DEPLOY=YES \
  /usr/local/lib/resume-ai/deploy-release.sh \
  /absolute/path/to/artifacts/releases/YYYYMMDDTHHMMSSZ
```

The deployer verifies the exact approved artifact set; installs dependencies
without lifecycle scripts while blocking production PostgreSQL; runs reviewed
code in a no-host-network cgroup; tests owner/runtime identities in a disposable
PostgreSQL cluster/network namespace; freezes source/build hashes; runs the real
DeepSeek preflight with a separate one-shot UID; prunes dev dependencies; takes
a backup; and applies only hash-manifested expand migrations under a root peer
transaction/advisory lock.

The candidate starts on the inactive loopback port. PM2 state is saved and
fsynced before Nginx switches atomically. During at least 1800 seconds the gate
continuously checks health, assets, invalid API fail-closed behavior, correlation
IDs, security headers and security.txt. After success, direct DELETE is revoked
and bound to the release manifest. A durable journal covers prepared,
nginx-switched, hardening-started, permissions-hardened and committed phases.

Immediate rollback is:

```bash
sudo ACK_PRODUCTION_ROLLBACK=YES /usr/local/lib/resume-ai/rollback-release.sh
```

The rollback starts and checks the target release, writes its durable journal,
restores that release's exact database ACL contract, and only then may switch
Nginx. ACL restoration failure is fail-closed. It also checks the three API
contracts, assets and public security headers. Interrupted rollback/deploy is
recovered before Nginx starts.

## 6. SSH, real reboot and final acceptance

After a second new-key login and `sudo -n true` succeed, and only after the old
RSA plus every unapproved key is removed:

```bash
sudo ACK_INSTALL_SSH_HARDENING=YES \
  NEW_SSH_PUBLIC_KEY_VERIFIED=YES LEGACY_KEYS_REMOVED=YES \
  /usr/local/lib/resume-ai/install-ssh-hardening.sh
```

The installer requires exactly one plain Ed25519 key in ubuntu's protected
`authorized_keys`; it rejects RSA and `claude-deploy-siyuan`, then records the
user-key and server Ed25519 host-key fingerprints in root-only evidence. Pin the
recorded host fingerprint in the administrator's client before closing the old
session.

Record a real maintenance reboot, rather than merely checking active services:

```bash
sudo ACK_MAINTENANCE_REBOOT_EVIDENCE=YES \
  /usr/local/lib/resume-ai/record-maintenance-reboot.sh prepare
# perform the separately approved reboot
sudo ACK_MAINTENANCE_REBOOT_EVIDENCE=YES \
  /usr/local/lib/resume-ai/record-maintenance-reboot.sh verify
```

After backup restore verification and one successful retention cleanup:

```bash
sudo /usr/local/lib/resume-ai/verify-production-host.sh
```

The final read-only gate verifies official Nginx/Node packages, HTTP/2/TLS,
single nonce CSP/security headers, www redirects, unknown Host/IP rejection,
raw-IP log privacy, all quota/deadline derivatives and live PM2 environment,
five-way release state, database contract/function ownership/timeouts, immutable
retention SQL, backups/restores, real boot ID change, SSH, patch level, log
rotation and Certbot renewal. Separately complete a real recommendation flow on
desktop/mobile and confirm the Tencent snapshot, source-restricted port 22 and
CPU/memory/disk/availability alerts in the console.
