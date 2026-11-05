import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const root = process.cwd();

async function read(relativePath: string) {
  return readFile(path.join(root, relativePath), "utf8");
}

describe("host operations remediation contracts", () => {
  it("accepts only the modern symmetric HTTP/2 managed tree and rejects link or syntax bypasses", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "resume-ai-nginx-contract-"));
    const tree = path.join(fixture, "etc", "nginx");
    const version = path.join(fixture, "version.txt");
    const helper = path.join(root, "ops/bin/assert-nginx-security-contract.py");
    const invoke = () => execFileAsync("python3", [
      "-I", helper, "--config-tree", tree, "--version-output", version,
      "--mode", "staged-managed"
    ]);
    const sources = new Map([
      ["nginx.conf", "ops/nginx/nginx.conf"],
      ["conf.d/00-resume-ai-global.conf", "ops/generated/00-resume-ai-global.conf"],
      ["conf.d/20-resume-ai.conf", "ops/nginx/20-resume-ai.conf"],
      ["snippets/resume-ai-transport-security.conf", "ops/nginx/resume-ai-transport-security.conf"],
      ["snippets/resume-ai-proxy-common.conf", "ops/nginx/resume-ai-proxy-common.conf"],
      ["snippets/resume-ai-recommend-quota.inc", "ops/generated/nginx-quota.inc"],
      ["snippets/resume-ai-track-quota.inc", "ops/generated/nginx-track-quota.inc"]
    ]);
    try {
      await mkdir(path.join(tree, "conf.d"), { recursive: true });
      await mkdir(path.join(tree, "snippets"), { recursive: true });
      for (const [destination, source] of sources) {
        await copyFile(path.join(root, source), path.join(tree, destination));
      }
      await writeFile(path.join(tree, "mime.types"), "types { text/plain txt; }\n");
      await writeFile(
        path.join(tree, "conf.d", "10-resume-ai-upstream.conf"),
        "upstream resume_ai_active { server 127.0.0.1:3000; }\n"
      );
      await writeFile(
        version,
        "nginx version: nginx/1.30.4\nconfigure arguments: --with-http_ssl_module --with-http_v2_module --with-threads\n"
      );
      await expect(invoke()).resolves.toMatchObject({
        stdout: expect.stringContaining("staged-managed security contract passed")
      });

      const virtualHosts = path.join(tree, "conf.d", "20-resume-ai.conf");
      const modern = await readFile(virtualHosts, "utf8");
      await writeFile(virtualHosts, modern.replace("listen 443 ssl;", "listen 443 ssl http2;"));
      await expect(invoke()).rejects.toMatchObject({ code: 1 });
      await writeFile(virtualHosts, modern);

      await symlink("20-resume-ai.conf", path.join(tree, "conf.d", "linked.conf"));
      await expect(invoke()).rejects.toMatchObject({ code: 1 });
      await rm(path.join(tree, "conf.d", "linked.conf"));

      const proxyPolicy = path.join(tree, "snippets", "resume-ai-proxy-common.conf");
      const safeProxyPolicy = await readFile(proxyPolicy, "utf8");
      for (const trigger of [
        "location /inline-ssi { ssi on; }",
        "location /inline-buffering { proxy_buffering off; }",
        "location /inline-slice { slice 1m; }"
      ]) {
        await writeFile(proxyPolicy, `${safeProxyPolicy}\n${trigger}\n`);
        await expect(invoke()).rejects.toMatchObject({ code: 1 });
      }
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("binds every Nginx power-loss phase to one cached 1.30.4 package and safe config", async () => {
    const migration = await read("ops/bin/migrate-nginx-1.30.4.sh");
    const recovery = await read("ops/bin/recover-nginx-migration.sh");
    const finalizer = await read("ops/bin/finalize-nginx-migration-recovery.sh");
    const runtime = await read("ops/bin/assert-nginx-package-runtime.sh");
    const config = await read("ops/nginx/20-resume-ai.conf");

    expect(config).not.toMatch(/listen[^;]*\bhttp2\b/gu);
    expect(config.match(/^[ ]{4}http2 on;$/gmu)).toHaveLength(3);
    expect(config.match(/^[ ]{4}listen 443 ssl(?: default_server)?;$/gmu)).toHaveLength(3);
    expect(config.match(/^[ ]{4}listen \[::\]:443 ssl(?: default_server)?;$/gmu)).toHaveLength(3);
    expect(runtime).toContain("assert_clean_config_diagnostics");
    expect(runtime).toContain("emitted a warning or unexpected diagnostic");
    expect(runtime).toContain("package/etc/nginx/mime.types");

    expect(migration).toContain("SAFE_CONFIG_SHA256=$SAFE_CONFIG_SHA256");
    expect(migration).toContain("APT_CONTRACT_SHA256=$APT_CONTRACT_SHA256");
    expect(migration).toContain("approved-apt/SHA256SUMS");
    expect(migration).toContain("publish_approved_apt_contract");
    expect(migration).toContain("--mode staged-managed");
    expect(migration).toContain('tar -C "$safe_build_root" -czf "$SAFE_CONFIG_ARCHIVE"');
    const main = migration.indexOf("if ! getent group nginx");
    const installPackage = migration.indexOf("DEBIAN_FRONTEND=noninteractive apt-get install -y", main);
    const publishConfig = migration.indexOf('mv -- /etc/nginx "$package_config_evidence"', main);
    expect(installPackage).toBeGreaterThan(main);
    expect(installPackage).toBeLessThan(publishConfig);
    expect(migration).not.toContain("UBUNTU_ROLLBACK_SECURITY_VERSION");

    expect(recovery).toContain("SAFE_CONFIG_SHA256");
    expect(recovery).toContain("APT_CONTRACT_SHA256");
    expect(recovery).toContain("approved Nginx APT recovery contract differs from the journal");
    expect(recovery).toContain("managed Nginx archive inventory differs from policy");
    expect(recovery.indexOf('apt-get install -y')).toBeLessThan(
      recovery.indexOf('tar -C / -xzf "$SAFE_CONFIG_ARCHIVE"')
    );
    expect(recovery).toContain('"$ACTIVE_OPS" "$OFFICIAL_DEB" managed');
    expect(finalizer).toContain('"$ACTIVE_OPS" "$OFFICIAL_DEB" managed');
    expect(finalizer).toContain("installed Nginx APT contract differs from the durable recovery generation");
    expect(finalizer.indexOf("assert-nginx-package-runtime.sh")).toBeLessThan(
      finalizer.indexOf('unlink "$PENDING_FILE"')
    );
  });

  it.skipIf(process.platform !== "linux" || !existsSync("/proc/self/stat"))(
    "parses field 22 after a Linux comm containing spaces and a right parenthesis",
    async () => {
      const helper = path.join(root, "ops/bin/read-proc-start-ticks.py");
      const probe = String.raw`
import ctypes
import os
import pathlib
import subprocess
import sys

if ctypes.CDLL(None).prctl(15, b"resume ) worker", 0, 0, 0) != 0:
    raise SystemExit(2)
raw = pathlib.Path(f"/proc/{os.getpid()}/stat").read_text(encoding="ascii")
expected = raw[raw.rfind(")") + 1:].strip().split()[19]
observed = subprocess.check_output(
    [sys.executable, "-I", sys.argv[1], str(os.getpid())], text=True
).strip()
if observed != expected:
    raise SystemExit(f"field22 mismatch: {observed} != {expected}")
`;
      await expect(execFileAsync("python3", ["-I", "-c", probe, helper]))
        .resolves.toBeDefined();
    }
  );

  it("requires API-derived Lighthouse zone and attached-disk evidence for adoption", async () => {
    const recorder = await read("ops/bin/record-cloud-snapshot-evidence.py");
    const runbook = await read("ops/README.md");
    const adoption = await read("ops/bin/adopt-legacy-release.sh");
    const recovery = await read("ops/bin/recover-legacy-adoption.sh");
    const host = await read("ops/bin/verify-production-host.sh");
    const linuxGate = await read("tests/deployment/cloud-snapshot-linux-root.sh");

    for (const source of [recorder, adoption]) {
      expect(source).toContain("SYSTEM_DISK_ZONE");
      expect(source).toContain("SYSTEM_DISK_STATE");
      expect(source).toContain("SYSTEM_DISK_ATTACHED");
      expect(source).toContain("ap-guangzhou-[1-9][0-9]*");
    }
    expect(recorder).toContain('disk.get("DiskState") != "ATTACHED"');
    expect(recorder).toContain('disk.get("Attached") is not True');
    expect(recorder).toContain('"SCHEMA_VERSION": "4" if evidence_kind == "--api" else "3"');
    expect(recorder).toContain("--verify-pre-switch");
    expect(recorder).toContain("--verify-continuity");
    expect(recorder).toContain("SIGNING_MARKER_SHA256");
    expect(runbook).toContain("separate root-owned `0400` ordinary files");
    expect(runbook.match(/install -o root -g root -m 0400/g)).toHaveLength(2);
    expect(runbook).not.toContain("raw Tencent responses into separate root-owned `0600`");
    expect(host).toContain("/usr/local/lib/resume-ai/record-cloud-snapshot-evidence.py");
    expect(host).toContain("--verify-continuity");
    expect(host).toContain(".initial-rollback.env");
    expect(adoption).toContain("^lhsnap-[A-Za-z0-9]{6,80}$");
    expect(adoption).not.toContain("^snap-");
    expect(adoption).toContain('values["SNAPSHOT_ID"] != sys.argv[3]');
    expect(adoption).toContain("SNAPSHOT_EVIDENCE_ID");
    expect(adoption).toContain("snapshotEvidenceSha256");
    expect(recovery).toContain("snapshotEvidenceSha256");
    expect(linuxGate).toContain("snap-wrongtype");
    expect(linuxGate).toContain("write_disk ap-guangzhou-6 UNATTACHED false");
    expect(linuxGate).toContain("write_disk ap-shanghai-1 ATTACHED true");
  });

  it("keeps privileged runbook entrypoints inside a frozen generation or the installed control plane", async () => {
    const runbook = await read("ops/README.md");
    const legacyRunbook = await read("ops/legacy-adoption-runbook.txt");
    const projectReadme = await read("README.md");
    const spec = await read("ops/config/control-plane-files.conf");
    const installedTargets = new Set(
      spec.split("\n")
        .filter((line) => line && !line.startsWith("#"))
        .map((line) => line.split("\t")[2])
    );
    const documentedInstalledEntrypoints = [runbook, legacyRunbook, projectReadme]
      .flatMap((source) => source.match(/\/usr\/local\/lib\/resume-ai\/[A-Za-z0-9._-]+/g) ?? [])
      .filter((entrypoint) => entrypoint !== "/usr/local/lib/resume-ai/create-bootstrap-generation.py");

    for (const entrypoint of new Set(documentedInstalledEntrypoints)) {
      expect(installedTargets, `${entrypoint} is not in the installed control-plane allowlist`)
        .toContain(entrypoint);
    }
    for (const firstRootEntrypoint of [
      "install-unattended-upgrades.sh",
      "migrate-nginx-1.30.4.sh",
      "disable-rc-local.sh",
      "install-backup-jobs.sh"
    ]) {
      expect(runbook).toContain(`\"$BOOTSTRAP_GENERATION/ops/bin/${firstRootEntrypoint}\"`);
      expect(runbook).not.toContain(`/usr/local/lib/resume-ai/${firstRootEntrypoint}`);
    }
    expect(runbook).toContain("CLOUD_SNAPSHOT_ID=lhsnap-REVIEWED_ID");
    expect(runbook).not.toContain("CLOUD_SNAPSHOT_ID=snap-REVIEWED_ID");
  });

  it("publishes one physical, checksummed privileged generation and keeps SSH rotation staged", async () => {
    const spec = await read("ops/config/control-plane-files.conf");
    const controlInstall = await read("ops/bin/install-control-plane-generation.sh");
    const controlRecovery = await read("ops/bin/recover-control-plane-generation.sh");
    const controlVerifier = await read("ops/bin/verify-control-plane-generation.py");
    const qcloudInstall = await read("ops/bin/install-qcloud-control-generation.sh");
    const qcloudRecovery = await read("ops/bin/recover-qcloud-control-generation.sh");
    const quotaInstall = await read("ops/bin/install-quota-generation.sh");
    const quotaRecovery = await read("ops/bin/recover-quota-generation.sh");
    const ssh = await read("ops/bin/install-ssh-hardening.sh");
    const host = await read("ops/bin/verify-production-host.sh");
    const runtime = await read("ops/bin/install-runtime-layout.sh");

    for (const member of [
      "ops/bin/assert-apt-effective-config.sh",
      "ops/bin/assert-postgres-ops-runtime.sh",
      "ops/bin/qcloud-network-control.py",
      "ops/bin/rc-local-backup.py",
      "ops/bin/run-qcloud-network-tuning.sh",
      "ops/systemd/resume-ai-qcloud-network-tuning@.service",
      "ops/udev/80-qcloud-nic.rules",
      "ops/config/approved-qcloud-network-tuning.conf"
    ]) {
      expect(spec).toContain(member);
    }
    for (const member of [
      "ops/bin/prepare-release-bundle.sh",
      "ops/bin/verify-release-evidence.mjs",
      "scripts/run-release-evidence.mjs",
      "ops/config/release-required-tests.json",
      "scripts/lib/release-evidence-deepseek-verifier.mjs",
      "scripts/lib/release-evidence-http-probe.mjs",
      "ops/bin/provision-postgres-verifier-role.sh",
      "ops/bin/verify-production-database-readonly.sh",
      "ops/postgresql/verify-production-database-readonly.sql",
      "ops/config/database-verification.manifest"
    ]) {
      expect(spec).toContain(member);
      expect(runtime).toContain(path.basename(member));
    }
    expect(spec).not.toContain("ops/ssh/00-resume-ai-hardening.conf\t");
    expect(spec).toContain("first publication must");

    for (const trustAnchor of [
      "ops/bin/open-root-lock.sh",
      "ops/bin/verify-control-plane-generation.py",
      "ops/bin/install-control-plane-generation.sh",
      "ops/bin/recover-control-plane-generation.sh"
    ]) {
      expect(spec).not.toMatch(new RegExp(`^[^#\\n]*\\t${trustAnchor.replaceAll(".", "\\.")}\\t`, "mu"));
    }
    expect(runtime).toContain("ACK_CONTROL_PLANE_TRUST_ANCHOR_UPGRADE");
    expect(runtime).toContain("install_trust_anchor");

    for (const source of [controlInstall, controlRecovery, qcloudInstall, qcloudRecovery, quotaInstall, quotaRecovery]) {
      expect(source).toContain("BACKUP_MANIFEST_SHA256");
      expect(source).toContain("sha256sum --strict -c");
      expect(source).toContain("readlink -e --");
    }
    expect(controlInstall).toContain("SCHEMA_VERSION=3");
    expect(controlRecovery).toContain('SCHEMA_VERSION]:-}" = 3');
    expect(controlInstall).toContain("TRUSTED_VERIFIER=\"$TRUSTED_ROOT/verify-control-plane-generation.py\"");
    expect(controlInstall).toContain("TRUSTED_SPEC=/usr/local/share/resume-ai/control-plane-files.conf");
    expect(controlInstall).toContain('--candidate-spec "$CANDIDATE_SPEC"');
    expect(controlVerifier).toContain("candidate control-plane specification differs from the installed trust anchor");
    expect(controlVerifier).toContain('"/usr/local/lib/resume-ai/"');
    expect(controlVerifier).not.toContain("/etc/sudoers");
    const anchorRejection = controlInstall.indexOf("candidate attempts an ordinary control-plane trust-anchor upgrade");
    const firstStageWrite = controlInstall.indexOf('install -d -o root -g root -m 0700 "$STAGE_ROOT"');
    expect(anchorRejection).toBeGreaterThan(-1);
    expect(anchorRejection).toBeLessThan(firstStageWrite);
    expect(controlInstall).toContain("without changing live controls");
    expect(controlInstall.indexOf("stage_generation stage")).toBeLessThan(
      controlInstall.indexOf("commit_generation", controlInstall.indexOf("case \"$ACTION\""))
    );
    expect(controlRecovery).toContain("Discarded uncommitted control-plane shadow");
    expect(controlRecovery).toContain('"$TRUSTED_INSTALLER" commit');
    expect(controlRecovery.indexOf("assert_backup_target \"$target\"")).toBeLessThan(
      controlRecovery.indexOf("restore_target \"$target\"")
    );
    expect(qcloudInstall).toContain("udevadm control --reload");
    expect(qcloudRecovery).toContain("udevadm control --reload");
    expect(controlVerifier).toContain("traverses a symbolic-link ancestor");

    const snapshot = ssh.indexOf("INPUT_SNAPSHOT_DIR=");
    const expectationParse = ssh.indexOf("declare -A expected=()");
    expect(snapshot).toBeGreaterThan(-1);
    expect(snapshot).toBeLessThan(expectationParse);
    expect(ssh).toContain("O_NOFOLLOW");
    expect(ssh).toContain("identity(source.lstat()) != identity(before)");
    expect(ssh).toContain("opened_sources");

    expect(host).toContain("/usr/local/lib/resume-ai/validate-pending-deploy-host-state.py");
    expect(host).not.toContain('pending_validator="$OPS_DIR/bin/');
    expect(host).toContain("pending control-plane rollback receipt is unsafe");
    expect(host).toContain('values["PHASE"] != "installed"');
    expect(host).toContain("control-plane rollback receipt changed during the host gate");
    expect(host).toContain("boundary.originReleaseId !== manifest.releaseId");
    expect(host).toContain('manifest?.rollbackRelease === "none"');
    expect(host).toContain("baseline?.provenance?.releaseId !== boundary.originReleaseId");
  });

  it("recovers controls only from a schema-6 approval-bound deployment decision", async () => {
    const recovery = await read("ops/bin/recover-control-plane-generation.sh");
    const fixture = await mkdtemp(path.join(tmpdir(), "resume-ai-control-recovery-"));
    const approvalPath = path.join(fixture, "approval.env");
    const journalPath = path.join(fixture, "deploy.pending");
    const oldRelease = "20260825T000001Z";
    const newRelease = "20260826T000001Z";
    const digest = "a".repeat(64);
    const approval = (
      schema = "6",
      includeCompletion = true,
      includeLinux = true,
      includeRequiredPolicy = true
    ) => [
      `SCHEMA_VERSION=${schema}`,
      `RELEASE_ID=${newRelease}`,
      `RELEASE_MANIFEST_SHA256=${digest}`,
      `SOURCE_MANIFEST_SHA256=${digest}`,
      `SHA256SUMS_SHA256=${digest}`,
      `CONTROL_PLANE_SPEC_SHA256=${digest}`,
      `EVIDENCE_HELPER_SHA256=${digest}`,
      `TRUSTED_DEEP_SCAN_ATTESTATION_SHA256=${digest}`,
      `TRUSTED_DEEP_SCAN_PRODUCER_SHA256=${digest}`,
      ...(includeCompletion ? [`TRUSTED_DEEP_SCAN_COMPLETION_SHA256=${digest}`] : []),
      ...(includeLinux ? [`LINUX_VALIDATION_ATTESTATION_SHA256=${digest}`] : []),
      ...(includeRequiredPolicy ? [`REQUIRED_TEST_POLICY_SHA256=${digest}`] : []),
      "APPROVED_AT=2026-08-26T00:00:00Z"
    ].join("\n") + "\n";
    const deployJournal = (
      phase: string,
      approvalHash: string,
      kind = "deploy",
      oldPreviousPort = "none",
      oldPreviousRelease = "none"
    ) => [
      `KIND=${kind}`,
      `PHASE=${phase}`,
      "OLD_ACTIVE_PORT=3000",
      `OLD_ACTIVE_RELEASE=${oldRelease}`,
      `OLD_PREVIOUS_PORT=${oldPreviousPort}`,
      `OLD_PREVIOUS_RELEASE=${oldPreviousRelease}`,
      "NEW_PORT=3001",
      `NEW_RELEASE=${newRelease}`,
      "NEW_PREVIOUS_PORT=3000",
      `NEW_PREVIOUS_RELEASE=${oldRelease}`,
      `APPROVAL_FILE_SHA256=${approvalHash}`
    ].join("\n") + "\n";
    const initializeJournal = (approvalHash: string) => [
      "KIND=initialize",
      "PHASE=state_committed",
      "OLD_ACTIVE_PORT=none",
      "OLD_ACTIVE_RELEASE=none",
      "OLD_PREVIOUS_PORT=none",
      "OLD_PREVIOUS_RELEASE=none",
      "NEW_PORT=3000",
      `NEW_RELEASE=${newRelease}`,
      "NEW_PREVIOUS_PORT=none",
      "NEW_PREVIOUS_RELEASE=none",
      `APPROVAL_FILE_SHA256=${approvalHash}`
    ].join("\n") + "\n";

    const anchor = "read -r RECOVERY_DIRECTION APPROVAL_FILE_SHA256";
    const commandStart = recovery.indexOf(anchor);
    const heredocStart = recovery.indexOf("<<'PY'\n", commandStart);
    const bodyStart = heredocStart + "<<'PY'\n".length;
    const bodyEnd = recovery.indexOf("\nPY\n", bodyStart);
    expect(commandStart).toBeGreaterThan(-1);
    expect(heredocStart).toBeGreaterThan(commandStart);
    expect(bodyEnd).toBeGreaterThan(bodyStart);
    const parser = recovery.slice(bodyStart, bodyEnd);
    const invoke = (controlKind: string, activeRelease: string) => execFileAsync(
      "python3",
      [
        "-I", "-c", parser, journalPath, approvalPath, controlKind,
        controlKind === "bootstrap" ? newRelease : oldRelease,
        newRelease, activeRelease
      ]
    );

    try {
      const approvalText = approval();
      const approvalHash = createHash("sha256").update(approvalText).digest("hex");
      await writeFile(approvalPath, approvalText, "utf8");

      await writeFile(journalPath, deployJournal("prepared", approvalHash), "utf8");
      await expect(invoke("stage", oldRelease)).resolves.toMatchObject({
        stdout: `rollback ${approvalHash} ${digest}\n`
      });
      await writeFile(journalPath, deployJournal("state_committed", approvalHash), "utf8");
      await expect(invoke("stage", newRelease)).resolves.toMatchObject({
        stdout: `forward ${approvalHash} ${digest}\n`
      });
      await writeFile(journalPath, deployJournal("hardening_started", approvalHash), "utf8");
      await expect(invoke("stage", newRelease)).resolves.toMatchObject({
        stdout: `forward ${approvalHash} ${digest}\n`
      });
      await writeFile(journalPath, initializeJournal(approvalHash), "utf8");
      await expect(invoke("bootstrap", newRelease)).resolves.toMatchObject({
        stdout: `forward ${approvalHash} ${digest}\n`
      });

      await writeFile(journalPath, deployJournal("state_committed", "b".repeat(64)), "utf8");
      await expect(invoke("stage", newRelease)).rejects.toMatchObject({ code: 2 });
      await writeFile(approvalPath, approval("5"), "utf8");
      await writeFile(journalPath, deployJournal(
        "state_committed",
        createHash("sha256").update(approval("5")).digest("hex")
      ), "utf8");
      await expect(invoke("stage", newRelease)).rejects.toMatchObject({ code: 2 });
      await writeFile(approvalPath, approval("6", false), "utf8");
      await writeFile(journalPath, deployJournal(
        "state_committed",
        createHash("sha256").update(approval("6", false)).digest("hex")
      ), "utf8");
      await expect(invoke("stage", newRelease)).rejects.toMatchObject({ code: 2 });
      await writeFile(approvalPath, approval("6", true, false), "utf8");
      await writeFile(journalPath, deployJournal(
        "state_committed",
        createHash("sha256").update(approval("6", true, false)).digest("hex")
      ), "utf8");
      await expect(invoke("stage", newRelease)).rejects.toMatchObject({ code: 2 });
      await writeFile(approvalPath, approval("6", true, true, false), "utf8");
      await writeFile(journalPath, deployJournal(
        "state_committed",
        createHash("sha256").update(approval("6", true, true, false)).digest("hex")
      ), "utf8");
      await expect(invoke("stage", newRelease)).rejects.toMatchObject({ code: 2 });

      await writeFile(approvalPath, approvalText, "utf8");
      await writeFile(journalPath, deployJournal(
        "state_committed", approvalHash, "rollback", "3000", newRelease
      ), "utf8");
      await expect(invoke("stage", newRelease)).rejects.toMatchObject({ code: 2 });

      expect(recovery).toContain("control-plane recovery requires the durable deployment journal");
      expect(recovery).toContain("deployment journal and schema-6 approval do not decide control recovery");
      expect(recovery).not.toContain("active release is neither side of the control-plane transaction");
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("isolates candidate PostgreSQL tests from every production database capability", async () => {
    const deploy = await read("ops/bin/deploy-release.sh");
    const runtime = await read("ops/bin/install-runtime-layout.sh");
    const host = await read("ops/bin/verify-production-host.sh");

    expect(runtime).toContain("ensure_service_account resume-ai-pgtest");
    expect(runtime).toContain("ensure_service_account resume-ai-dbverify");
    expect(runtime).toContain("/usr/sbin/nologin");
    expect(deploy).toContain("--uid=resume-ai-pgtest --gid=resume-ai-pgtest");
    expect(deploy).not.toContain("--uid=postgres --gid=postgres");
    expect(deploy).toContain('JoinsNamespaceOf=$TEST_PG_UNIT');
    expect(deploy.match(/InaccessiblePaths=[^\n]*\/run\/postgresql [^\n]*\/var\/lib\/postgresql [^\n]*\/opt\/resume-ai\/current [^\n]*\/opt\/resume-ai\/releases/gu)?.length)
      .toBeGreaterThanOrEqual(5);
    expect(deploy).toContain("COPY (SELECT 1) TO PROGRAM");
    expect(deploy).toContain("isolated builder unexpectedly reached the production PostgreSQL socket");
    expect(deploy).toContain("resume-ai-pgtest retained a process after disposable-cluster cleanup");
    expect(deploy).toContain("CapabilityBoundingSet=");
    expect(deploy).toContain("SystemCallFilter=@system-service");
    expect(host).toContain("database verifier identity has a surviving process");
  });

  it("executes only the generation-bound, peer-authenticated read-only database contract", async () => {
    const deploy = await read("ops/bin/deploy-release.sh");
    const restore = await read("ops/bin/verify-postgres-restore.sh");
    const provisioner = await read("ops/bin/provision-postgres-verifier-role.sh");
    const verifier = await read("ops/bin/verify-production-database-readonly.sh");
    const sql = await read("ops/postgresql/verify-production-database-readonly.sql");
    const policy = await read("ops/config/database-verification.manifest");
    const digest = createHash("sha256").update(sql).digest("hex");

    expect(policy).toContain(`${digest} verify-production-database-readonly.sql readonly-peer-v1`);
    expect(deploy).toContain("/usr/local/lib/resume-ai/verify-production-database-readonly.sh");
    expect(deploy).not.toContain("$STAGING_RELEASE/db/verification");
    expect(restore).toContain("/usr/local/share/resume-ai/verify-production-database-readonly.sql");
    expect(restore).not.toContain("$ACTIVE_ROOT/db/verification");
    expect(provisioner).toContain('CREATE ROLE "resume-ai-dbverify"');
    expect(provisioner).toContain("NOINHERIT");
    expect(provisioner).toContain("NOBYPASSRLS");
    expect(provisioner).toContain("PASSWORD NULL");
    expect(provisioner).toContain("default_transaction_read_only = on");
    expect(provisioner).toContain("runuser -u resume-ai-dbverify");
    expect(sql).toContain("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    expect(verifier).toContain("production database verification accepts no caller paths");
    expect(verifier).toContain("SystemCallFilter=@system-service");
    expect(verifier).toContain("InaccessiblePaths=/var/lib/postgresql /etc/postgresql /opt/resume-ai/current /opt/resume-ai/releases");
    expect(sql).toContain("catalog reads only");
    expect(sql).not.toMatch(/^\s*(?:INSERT|UPDATE|DELETE|COPY|CREATE|ALTER|DROP|GRANT|REVOKE)\b/gimu);
  });

  it("passes DeepSeek credentials only to the fixed verifier credential mount", async () => {
    const deploy = await read("ops/bin/deploy-release.sh");
    const verifier = await read("scripts/lib/release-evidence-deepseek-verifier.mjs");

    expect(deploy).toContain("/usr/local/lib/resume-ai/release-evidence-deepseek-verifier.mjs");
    expect(deploy).toContain('cmp -s "$RELEASE_ROOT/$ACTIVE_RELEASE/scripts/lib/release-evidence-deepseek-verifier.mjs"');
    expect(deploy).toContain('LoadCredential=deepseek-key:$VERIFY_CREDENTIAL_FILE');
    expect(deploy).toContain('InaccessiblePaths=$VERIFY_RELEASE /opt/resume-ai/current /opt/resume-ai/releases');
    expect(deploy).not.toContain("scripts/verify-deepseek.mjs");
    expect(deploy).not.toContain("EnvironmentFile=");
    expect(deploy).not.toMatch(/--setenv=AI_API_KEY=/u);
    expect(verifier).toContain('credentialPath?.startsWith("/run/credentials/")');
    expect(verifier).not.toMatch(/console\.(?:log|error)\([^\n]*apiKey/u);
  });

  it("pins the complete Node 24.20.0 runtime generation", async () => {
    const policy = await read("ops/config/approved-node-runtime.conf");
    const installer = await read("ops/bin/install-node-runtime.sh");
    const host = await read("ops/bin/verify-production-host.sh");
    const runner = await read("scripts/run-release-evidence.mjs");
    for (const source of [policy, installer, host, runner]) {
      expect(source).toContain("24.20.0");
      expect(source).not.toContain("24.19.0");
    }
    expect(policy).toContain("2f2c0da162318f0de47665410c7c8c2ed3d36c8f3105de4bbc61176c70a7cbf2");
  });

  it("binds Linux validation and the independent required-test policy through schema-6 approval", async () => {
    const approve = await read("ops/bin/approve-release-bundle.sh");
    const deploy = await read("ops/bin/deploy-release.sh");
    const host = await read("ops/bin/verify-production-host.sh");
    const recovery = await read("ops/bin/recover-deployment-state.sh");
    const controlRecovery = await read("ops/bin/recover-control-plane-generation.sh");
    const prepare = await read("ops/bin/prepare-release-bundle.sh");
    const verifier = await read("ops/bin/verify-release-evidence.mjs");

    expect(approve).toContain("SCHEMA_VERSION=6");
    expect(approve).toContain("LINUX_VALIDATION_ATTESTATION_SHA256=");
    expect(approve).toContain("linux-validation-attestation.json");
    expect(approve).toContain("Linux validation attestation member is missing or duplicated");
    expect(approve).toContain("TRUSTED_REQUIRED_TEST_POLICY_SHA256");
    expect(approve).toContain("required-test policy evidence differs from the reviewed source row");
    expect(prepare).toContain('"linuxValidationAttestation": {');
    expect(verifier).toContain("resume-ai-linux-validation-generation.v1");
    expect(verifier).toContain("/etc/resume-ai/release-evidence-signing.pub");
    expect(deploy).toContain('[ "${#approval[@]}" -eq 13 ] && [ "${approval[SCHEMA_VERSION]:-}" = 6 ]');
    expect(deploy).toContain("LINUX_VALIDATION_ATTESTATION_SHA256");
    expect(deploy).toContain("REQUIRED_TEST_POLICY_SHA256");
    for (const source of [host, recovery]) {
      expect(source).toContain("LINUX_VALIDATION_ATTESTATION_SHA256");
      expect(source).toContain('values["SCHEMA_VERSION"] != "6"');
    }
    expect(controlRecovery).toContain("LINUX_VALIDATION_ATTESTATION_SHA256");
    expect(controlRecovery).toContain('approval["SCHEMA_VERSION"] != "6"');
    expect(controlRecovery).toContain("assert_installed_required_test_policy");
    expect(host).toContain("Linux validation Ed25519 trust anchor pair is missing, unsafe, or inconsistent");
    expect(host).toContain("root-private Linux validation generation store is missing or unsafe");
    expect(host).toContain("openssl pkey -in /etc/resume-ai/release-evidence-signing.key -pubout");
    expect(recovery).toContain("recovered release manifest differs from the approved Linux validation generation");
  });

  it("derives approval pins from exactly one regular attestation and policy archive member", async () => {
    const approve = await read("ops/bin/approve-release-bundle.sh");
    const commandStart = approve.indexOf("read -r LINUX_VALIDATION_ATTESTATION_SHA256");
    const heredocStart = approve.indexOf("<<'PY'\n", commandStart);
    const bodyStart = heredocStart + "<<'PY'\n".length;
    const bodyEnd = approve.indexOf("\nPY\n", bodyStart);
    expect(commandStart).toBeGreaterThan(-1);
    expect(heredocStart).toBeGreaterThan(commandStart);
    expect(bodyEnd).toBeGreaterThan(bodyStart);
    const parser = approve.slice(bodyStart, bodyEnd);
    const fixture = await mkdtemp(path.join(tmpdir(), "resume-ai-linux-policy-pin-"));
    const evidence = path.join(fixture, "evidence");
    const manifest = path.join(fixture, "release-manifest.json");
    const archive = path.join(fixture, "evidence.tar.gz");
    const duplicateArchive = path.join(fixture, "duplicate.tar.gz");
    const attestation = "signed-linux-generation\n";
    const policy = "{\"policy\":\"fixed\"}\n";
    const attestationHash = createHash("sha256").update(attestation).digest("hex");
    const policyHash = createHash("sha256").update(policy).digest("hex");
    const invoke = (targetArchive = archive) => execFileAsync("python3", [
      "-I", "-c", parser, manifest, targetArchive
    ]);
    try {
      await mkdir(evidence);
      await writeFile(path.join(evidence, "linux-validation-attestation.json"), attestation);
      await writeFile(path.join(evidence, "release-required-tests.json"), policy);
      await writeFile(manifest, JSON.stringify({
        linuxValidationAttestation: {
          evidenceMember: "linux-validation-attestation.json",
          artifactManifestMember: "linux-validation-artifact-manifest.txt",
          sha256: attestationHash
        }
      }));
      await execFileAsync("tar", ["-czf", archive, "-C", evidence, "."]);
      await expect(invoke()).resolves.toMatchObject({
        stdout: `${attestationHash} ${policyHash}\n`
      });

      await execFileAsync("tar", [
        "-czf", duplicateArchive, "-C", evidence,
        "linux-validation-attestation.json",
        "release-required-tests.json", "release-required-tests.json"
      ]);
      await expect(invoke(duplicateArchive)).rejects.toMatchObject({ code: 1 });

      await writeFile(manifest, JSON.stringify({
        linuxValidationAttestation: {
          evidenceMember: "linux-validation-attestation.json",
          artifactManifestMember: "linux-validation-artifact-manifest.txt",
          sha256: "b".repeat(64)
        }
      }));
      await expect(invoke()).rejects.toMatchObject({ code: 1 });
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("builds from root-owned source with one-release caches and registry-only integrity", async () => {
    const deploy = await read("ops/bin/deploy-release.sh");
    const runtime = await read("ops/bin/install-runtime-layout.sh");
    const host = await read("ops/bin/verify-production-host.sh");
    const sourceVerifier = await read("ops/bin/verify-release-source-tree.py");
    const fixtureAlias = await mkdtemp(path.join(tmpdir(), "resume-ai-pnpm-policy-"));
    const fixture = await realpath(fixtureAlias);
    const validator = path.join(root, "ops/bin/validate-pnpm-lockfile.py");
    const invoke = () => execFileAsync("python3", ["-I", validator, "--source", fixture]);
    const lockfile = await read("pnpm-lock.yaml");

    expect(deploy).toContain('set_tree_readonly_for_builder "$STAGING_RELEASE"');
    expect(deploy).toContain('ReadOnlyPaths=$STAGING_RELEASE');
    expect(deploy).not.toContain('ReadWritePaths=$STAGING_RELEASE /var/lib/resume-ai-build');
    expect(deploy).toContain('BUILD_HOME="/run/resume-ai-build-home.$RELEASE_ID"');
    expect(deploy.match(/prepare_builder_identity/gu)?.length).toBeGreaterThanOrEqual(5);
    expect(deploy.match(/finish_builder_identity/gu)?.length).toBeGreaterThanOrEqual(5);
    expect(deploy).toContain("NPM_CONFIG_USERCONFIG=/dev/null");
    expect(deploy).toContain("GIT_CONFIG_NOSYSTEM=1");
    expect(deploy).toContain("GIT_CONFIG_GLOBAL=/dev/null");
    expect(deploy).toContain("NPM_CONFIG_SCRIPT_SHELL=/bin/bash");
    expect(deploy).toContain("--frozen-lockfile --ignore-scripts --package-import-method=copy");
    expect(deploy).toContain("--store-dir \"$HOME/pnpm-store\"");
    expect(deploy).toContain("--property=IPAddressDeny=any");
    expect(deploy).toContain("registry.npmjs.org");
    expect(deploy).not.toContain("MemoryDenyWriteExecute=yes");
    expect(deploy).toContain("/usr/local/lib/resume-ai/run-release-evidence.mjs");
    expect(deploy).toContain("verify-project-toolchain");
    expect(deploy).toContain("project-toolchain-pre-build.json");
    expect(deploy).toContain("project-toolchain-post-build.json");
    expect(deploy).toContain("project toolchain changed while candidate build code executed");
    expect(deploy).toContain('tool.get("binRelativePath")');
    expect(deploy).toContain('"$PROJECT_NODE_BIN" "$TOOL_TYPESCRIPT" --noEmit --incremental false');
    expect(deploy).toContain('"$PROJECT_NODE_BIN" "$TOOL_ESLINT" . --max-warnings=0');
    expect(deploy).toContain('"$PROJECT_NODE_BIN" "$TOOL_VITEST" run --passWithNoTests');
    expect(deploy).toContain('"$PROJECT_NODE_BIN" "$TOOL_NEXT" build');
    expect(deploy).not.toMatch(/pnpm (?:run (?:typecheck|lint|test|build)|exec vitest)/u);
    expect(deploy).toContain('set_tree_readonly_for_runtime "$FINAL_RELEASE"');
    expect(deploy).not.toContain('chown -R root:resume-ai "$FINAL_RELEASE"');
    expect(deploy).toContain("os.chown(member, 0, gid, follow_symlinks=False)");
    expect(deploy).toContain("os.fchmod(descriptor, mode)");
    expect(deploy).not.toContain("os.chmod(member,");
    expect(deploy).not.toContain("os.chmod(root,");
    expect(deploy).toContain('chown -h root:resume-ai "$FINAL_RELEASE/.next/cache"');
    expect(deploy).toContain('release cache link was not published with the exact no-follow identity');
    expect(runtime).toContain("install -d -o root -g root -m 0555 /var/lib/resume-ai-build");
    expect(runtime).toContain("/usr/local/lib/resume-ai/release-required-tests.json");
    expect(host).toContain("active source tree differs from its approved manifest");
    expect(host).toContain("/usr/local/lib/resume-ai/verify-release-source-tree.py");
    expect(host).toContain("/usr/local/lib/resume-ai/hash-runtime-tree.py");
    expect(host).toContain("active runtime output differs from the release-time content provenance");
    expect(host).toContain("project-toolchain identity changed across the candidate build");
    expect(host).toContain("--forbid-group-other-write");
    expect(host).toContain("active Next cache link does not name the dedicated release cache");
    expect(host).toContain('readlink -- "$active_runtime_cache_link"');
    expect(host).toContain('resume-ai:resume-ai:750');
    expect(host).toContain('readlink -e -- "$active_runtime_cache"');
    expect(sourceVerifier).toContain("os.geteuid() != 0");
    expect(sourceVerifier).toContain('getattr(os, "O_NOFOLLOW", None)');
    expect(sourceVerifier).toContain("source manifest changed while reading");
    expect(sourceVerifier).toContain("source root is linked, writable, non-canonical, or not root-owned");
    expect(sourceVerifier).toContain("unapproved directory was added to the release tree");
    expect(sourceVerifier).not.toContain('name.startswith(".next-")');
    expect(sourceVerifier).toContain('relative == "tsconfig.tsbuildinfo"');

    try {
      const runtimeTree = path.join(fixture, "runtime-tree");
      const runtimeMember = path.join(runtimeTree, "member.txt");
      await mkdir(runtimeTree);
      await writeFile(runtimeMember, "fixed runtime\n", { mode: 0o644 });
      await symlink("member.txt", path.join(runtimeTree, "member-link"));
      const runtimeGate = () => execFileAsync("python3", [
        "-I", path.join(root, "ops/bin/hash-runtime-tree.py"),
        "--root", runtimeTree,
        "--expected-uid", String(process.getuid?.() ?? -1),
        "--expected-gid", String(process.getgid?.() ?? -1),
        "--forbid-group-other-write"
      ]);
      await expect(runtimeGate()).resolves.toMatchObject({
        stdout: expect.stringMatching(/^[a-f0-9]{64}\n$/u)
      });
      await chmod(runtimeMember, 0o664);
      await expect(runtimeGate()).rejects.toMatchObject({ code: 1 });
      await chmod(runtimeMember, 0o644);

      for (const name of ["package.json", ".npmrc", "pnpm-lock.yaml"]) {
        await copyFile(path.join(root, name), path.join(fixture, name));
      }
      await expect(invoke()).resolves.toMatchObject({
        stdout: expect.stringMatching(/^packages=[1-9][0-9]* registry=https:\/\/registry\.npmjs\.org integrity=sha512\n$/u)
      });

      await writeFile(
        path.join(fixture, "pnpm-lock.yaml"),
        lockfile.replace(/resolution: \{integrity: sha512-[A-Za-z0-9+/=]+\}/u, "resolution: {}"),
        "utf8"
      );
      await expect(invoke()).rejects.toMatchObject({ code: 1 });

      await writeFile(
        path.join(fixture, "pnpm-lock.yaml"),
        lockfile.replace(
          /resolution: \{integrity: sha512-[A-Za-z0-9+/=]+\}/u,
          "resolution: {tarball: https://registry.npmjs.org/evil/-/evil.tgz}"
        ),
        "utf8"
      );
      await expect(invoke()).rejects.toMatchObject({ code: 1 });

      await writeFile(
        path.join(fixture, "pnpm-lock.yaml"),
        lockfile.replace(/specifier: \^2\.106\.2/u, "specifier: file:../candidate-package"),
        "utf8"
      );
      await expect(invoke()).rejects.toMatchObject({ code: 1 });

      await writeFile(path.join(fixture, "pnpm-lock.yaml"), lockfile, "utf8");
      await link(path.join(fixture, "pnpm-lock.yaml"), path.join(fixture, "lock.hardlink"));
      await expect(invoke()).rejects.toMatchObject({ code: 1 });
    } finally {
      await rm(fixtureAlias, { recursive: true, force: true });
    }
  });

  it("expires an unused approval after 24 hours without expiring a stable deployment", async () => {
    const deploy = await read("ops/bin/deploy-release.sh");
    const host = await read("ops/bin/verify-production-host.sh");

    expect(deploy).toContain("root approval APPROVED_AT");
    expect(deploy).toContain("release manifest createdAt");
    expect(deploy).toContain("root release approval is older than 24 hours at first deployment");
    expect(deploy).toContain("release bundle is older than 24 hours at first deployment");
    expect(deploy).toContain("created_at > approved_at");
    expect(deploy).toContain("approved_at > now");
    expect(host).toContain("created_at > approved_at");
    expect(host).toContain("approved_at > switched_at");
    expect(host).toContain("switched_at - approved_at");
    expect(host).toContain("active release was first switched more than 24 hours after approval");
    expect(host).not.toContain("now - approved_at");
  });

  it("removes caller environment and cwd from every privileged interpreter and HTTP probe", async () => {
    const deploy = await read("ops/bin/deploy-release.sh");
    const host = await read("ops/bin/verify-production-host.sh");
    const recovery = await read("ops/bin/recover-deployment-state.sh");
    const controlInstall = await read("ops/bin/install-control-plane-generation.sh");
    const controlRecovery = await read("ops/bin/recover-control-plane-generation.sh");
    const initialize = await read("ops/bin/initialize-release-state.sh");
    const rollback = await read("ops/bin/rollback-release.sh");

    for (const source of [deploy, host, recovery, controlInstall, controlRecovery]) {
      expect(source).toContain("root_python()");
      expect(source).toContain("cd / && /usr/bin/env -i");
      expect(source).not.toMatch(/^[ \t]*python3(?:[ \t]|$)/gmu);
    }
    for (const source of [deploy, host, recovery, initialize, rollback]) {
      expect(source).toContain("root_curl()");
      expect(source).toContain("/usr/bin/curl --disable --noproxy '*'");
      expect(source).not.toMatch(/^[ \t]*curl(?:[ \t]|$)/gmu);
    }
    for (const source of [deploy, host, recovery, initialize, rollback]) {
      expect(source).toContain("root_node()");
      expect(source).toContain("/usr/bin/env -i");
    }
    expect(host).toContain("root_pnpm --version");
    expect(host).not.toContain("$(/opt/nodejs/current/bin/pnpm --version)");
    expect(deploy).toContain("root_tar()");
    expect(deploy).toContain('/usr/bin/tar "$@"');
    expect(deploy).toContain("NPM_CONFIG_USERCONFIG=/dev/null");
    expect(deploy).toContain("npm_config_userconfig=/dev/null");
  });

  it("rejects a hard-linked or byte-drifted quota generation", async () => {
    const fixtureAlias = await mkdtemp(path.join(tmpdir(), "resume-ai-quota-generation-"));
    const fixture = await realpath(fixtureAlias);
    const verifier = path.join(root, "ops/bin/verify-quota-generation.py");
    const invoke = () => execFileAsync("python3", [
      "-I", verifier,
      path.join(fixture, "quota-generation.env"),
      path.join(fixture, "application-quota.env"),
      path.join(fixture, "00-resume-ai-global.conf"),
      path.join(fixture, "nginx-quota.inc"),
      path.join(fixture, "nginx-track-quota.inc")
    ]);
    try {
      await execFileAsync("/bin/bash", [
        path.join(root, "ops/bin/render-quota-config.sh"),
        path.join(root, "ops/config/quotas.conf"),
        fixture
      ]);
      await expect(invoke()).resolves.toMatchObject({
        stdout: expect.stringMatching(/^[a-f0-9]{64}\n$/u)
      });

      const app = path.join(fixture, "application-quota.env");
      const secondLink = path.join(fixture, "application-quota.hardlink");
      await link(app, secondLink);
      await expect(invoke()).rejects.toMatchObject({ code: 1 });
      await rm(secondLink);

      await writeFile(app, `${await readFile(app, "utf8")}UNREVIEWED=1\n`, "utf8");
      await expect(invoke()).rejects.toMatchObject({ code: 1 });
    } finally {
      await rm(fixtureAlias, { recursive: true, force: true });
    }
  });

  it("ships non-production Linux gates for bootstrap, Nginx, cloud, and build contracts", async () => {
    for (const gate of [
      "tests/deployment/bootstrap-generation-linux-root.sh",
      "tests/deployment/nginx-1.30.4-linux-root.sh",
      "tests/deployment/cloud-snapshot-linux-root.sh",
      "tests/deployment/build-sandbox-linux-root.sh"
    ]) {
      const source = await read(gate);
      expect(source).toContain("disposable Ubuntu 22.04");
      await expect(execFileAsync("/bin/bash", ["-n", path.join(root, gate)]))
        .resolves.toBeDefined();
    }
  });

  it("never treats a physical directory as a single-link regular file", async () => {
    const directoryContracts = new Map<string, string[]>([
      ["ops/bin/open-root-lock.sh", ["$lock_root"]],
      ["ops/bin/deploy-release.sh", ["$BUILD_HOME", "$MIGRATION_TEMP_DIR"]],
      ["ops/bin/recover-deployment-state.sh", ["$artifact_dir"]],
      ["ops/bin/verify-production-host.sh", [
        "$latest_node_evidence", "$artifact_dir", "$active_runtime_cache"
      ]],
      ["ops/bin/verify-release-consistency.sh", ["$cache_dir"]],
      ["ops/bin/recover-quota-generation.sh", ["$BACKUP_DIR"]],
      ["ops/bin/node-runtime-recovery-gate.sh", ["$RUNTIME_DIR"]],
      ["ops/bin/initialize-release-state.sh", ["/var/cache/resume-ai/$RELEASE_ID"]],
      ["ops/bin/recover-node-runtime.sh", ["$BACKUP_DIR"]],
      ["ops/bin/recover-legacy-adoption.sh", ["$CACHE_DIR"]],
      ["tests/deployment/build-sandbox-linux-root.sh", ["$fixture/runtime-cache"]]
    ]);
    for (const [relative, variables] of directoryContracts) {
      const source = await read(relative);
      for (const variable of variables) {
        const escaped = variable.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
        expect(source).not.toMatch(
          new RegExp(
            `stat -c ['\"][^'\"]*%h[^'\"]*['\"]\\s+(?:["']${escaped}["']|${escaped})(?=\\s|\\)|;|$)`,
            "u"
          )
        );
      }
    }

    if (process.platform === "linux") {
      const fixture = await mkdtemp(path.join(tmpdir(), "resume-ai-dir-nlink-"));
      try {
        await mkdir(path.join(fixture, "child"));
        expect((await lstat(fixture)).nlink).toBeGreaterThan(1);
      } finally {
        await rm(fixture, { recursive: true, force: true });
      }
    }
  });
});
