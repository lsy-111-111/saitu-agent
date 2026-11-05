import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

async function read(relativePath: string) {
  return readFile(path.join(root, relativePath), "utf8");
}

function execWithInput(file: string, args: string[], input: string) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(file, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`command exited ${code}: ${stderr}`));
    });
    child.stdin.end(input);
  });
}

describe("PostgreSQL backup and restore controls", () => {
  it("selects retention by inclusive UTC calendar day rather than count or mtime", async () => {
    const selector = path.join(root, "ops/bin/select-postgres-retention.py");
    const dailyRows = [
      "1\t/var/backups/resume-ai/postgresql/daily/20260801T235959Z",
      "2\t/var/backups/resume-ai/postgresql/daily/20260813T235959Z",
      "3\t/var/backups/resume-ai/postgresql/daily/20260814T000000Z",
      "4\t/var/backups/resume-ai/postgresql/daily/20260827T235959Z",
      ""
    ].join("\n");
    const daily = await execWithInput("python3", [
      "-I", selector, "daily", "14", "2026-08-27"
    ], dailyRows);
    expect(daily.stdout.trim().split("\n")).toEqual([
      "/var/backups/resume-ai/postgresql/daily/20260801T235959Z",
      "/var/backups/resume-ai/postgresql/daily/20260813T235959Z"
    ]);

    const weeklyRows = [
      "1\t/var/backups/resume-ai/postgresql/weekly/20260702T000000Z",
      "2\t/var/backups/resume-ai/postgresql/weekly/20260703T000000Z",
      ""
    ].join("\n");
    const weekly = await execWithInput("python3", [
      "-I", selector, "weekly", "8", "2026-08-27"
    ], weeklyRows);
    expect(weekly.stdout.trim()).toBe(
      "/var/backups/resume-ai/postgresql/weekly/20260702T000000Z"
    );

    const predeployRows = [1, 2, 3].map((value) =>
      `${value}\t/var/backups/resume-ai/postgresql/predeploy/2026082${value}T000000Z`
    ).join("\n") + "\n";
    const predeploy = await execWithInput("python3", [
      "-I", selector, "predeploy", "2", "2026-08-27"
    ], predeployRows);
    expect(predeploy.stdout.trim()).toBe(
      "/var/backups/resume-ai/postgresql/predeploy/20260821T000000Z"
    );
  });

  it("rejects future, reordered, duplicated, and cross-tier retention rows", async () => {
    const selector = path.join(root, "ops/bin/select-postgres-retention.py");
    const invoke = (input: string) => execWithInput("python3", [
      "-I", selector, "daily", "14", "2026-08-27"
    ], input);
    await expect(invoke(
      "1\t/var/backups/resume-ai/postgresql/daily/20260828T000000Z\n"
    )).rejects.toBeDefined();
    await expect(invoke([
      "2\t/var/backups/resume-ai/postgresql/daily/20260826T000000Z",
      "1\t/var/backups/resume-ai/postgresql/daily/20260827T000000Z",
      ""
    ].join("\n"))).rejects.toBeDefined();
    await expect(invoke([
      "1\t/var/backups/resume-ai/postgresql/daily/20260826T000000Z",
      "2\t/var/backups/resume-ai/postgresql/daily/20260826T000000Z",
      ""
    ].join("\n"))).rejects.toBeDefined();
    await expect(invoke(
      "1\t/var/backups/resume-ai/postgresql/weekly/20260826T000000Z\n"
    )).rejects.toBeDefined();
  });

  it("binds restore evidence to the current backup, schema, privilege and writer contracts", async () => {
    const backup = await read("ops/bin/backup-postgres.sh");
    const restore = await read("ops/bin/verify-postgres-restore.sh");
    const verifier = await read("ops/bin/assert-postgres-restore-evidence.py");
    const inspector = await read("ops/bin/inspect-postgres-backups.py");

    expect(backup).toContain("BACKUP_SCHEMA_VERSION=2");
    expect(backup).toContain("BACKUP_WRITER_SHA256=");
    expect(backup).toContain("BACKUP_CONFIG_SHA256=");
    expect(backup).toContain("select-postgres-retention.py");
    expect(backup).toContain("inherited descriptor 9 is not the held Resume AI deploy lock");
    expect(backup).toContain("open_root_lock 8 postgres-backup");
    expect(backup).toContain("open_root_lock 6 postgres-role-hardening");
    expect(backup).not.toContain("-mtime");
    expect(backup).not.toContain("while [ \"${#entries[@]}\" -gt");
    expect(backup).toContain('mv -T -- "$staging_dir" "$final_dir"');
    expect(inspector).toContain("current_manifest_keys");
    expect(inspector).toContain("legacy_manifest_keys");

    expect(restore).toContain('"schemaVersion": 3');
    expect(restore).toContain('"contractSha256": "$CURRENT_CONTRACT_SHA256"');
    expect(restore).toContain('"backupCreatedAt": "${backup_manifest[CREATED_AT]}"');
    expect(restore).toContain("latest checksummed daily backup exceeds the configured RPO");
    expect(restore).toContain("peer_data_checksums");
    expect(restore).toContain('"migrationManifestSha256"');
    expect(restore).toContain('"databaseVerificationManifestSha256"');
    expect(restore).toContain('"runtimeTablePolicySha256"');
    expect(restore).toContain('"runtimeFunctionPolicySha256"');
    expect(restore).toContain('"requiredTablesPolicySha256"');
    expect(restore).toContain('"runtimeIdentityHelperSha256"');
    expect(restore).toContain(".restore-pending.env");
    expect(restore).toContain("open_root_lock 7 postgres-restore-verify");
    expect(restore).toContain("write_restore_journal database_created");
    expect(restore).toContain("write_restore_journal database_dropped");
    expect(restore).toContain("write_restore_journal evidence_published");
    expect(restore.match(/active release changed/gu)?.length).toBeGreaterThanOrEqual(2);
    expect(restore.indexOf("dropdb --force \"$TEMP_DB\"")).toBeLessThan(
      restore.indexOf('"temporaryDatabaseDropped": true')
    );
    expect(restore.indexOf("python3 \"$EVIDENCE_VERIFIER\"")).toBeLessThan(
      restore.indexOf('mv -- "$EVIDENCE_TEMP" "$EVIDENCE_FINAL"')
    );

    expect(verifier).toContain("if set(evidence) != required_keys");
    expect(verifier).toContain("object_pairs_hook=parse_pairs");
    expect(verifier).toContain("installed PostgreSQL contract differs from active release");
    expect(verifier).toContain("restore evidence aggregate contract digest is invalid");
    expect(verifier).toContain('backup_config["BACKUP_TIMEZONE"] != "Asia/Shanghai"');
    expect(verifier).toContain("restore evidence source did not satisfy the current RPO/timestamp contract");
    expect(verifier).toContain("O_NOFOLLOW");
    expect(verifier).toContain("st_nlink != 1");
    expect(verifier).toContain("restore evidence exceeds the monthly UTC calendar window plus grace");
  });

  it("requires exact effective fragments, no drop-ins, one calendar, and all sandbox properties", async () => {
    const gate = await read("ops/bin/assert-postgres-ops-runtime.sh");
    const backupService = await read("ops/systemd/resume-ai-postgres-backup.service");
    const restoreService = await read("ops/systemd/resume-ai-postgres-restore-verify.service");
    const backupTimer = await read("ops/systemd/resume-ai-postgres-backup.timer");
    const restoreTimer = await read("ops/systemd/resume-ai-postgres-restore-verify.timer");

    expect(gate).toContain('expect_property "$unit" FragmentPath "$installed_unit"');
    expect(gate).toContain('expect_property "$unit" DropInPaths ""');
    expect(gate).toContain('expect_word_set "$service" TriggeredBy "$timer"');
    expect(gate).toContain("TimersMonotonic");
    expect(gate).toContain("OnCalendar=");
    expect(gate).toContain("systemd-analyze calendar --iterations=3");
    expect(gate).toContain("CapabilityBoundingSet");
    expect(gate).toContain('expect_property "$unit" AmbientCapabilities ""');
    expect(gate).toContain("assert-postgres-restore-evidence.py");
    expect(gate).not.toContain("systemctl cat");

    for (const service of [backupService, restoreService]) {
      for (const directive of [
        "NoNewPrivileges=true", "PrivateTmp=true", "PrivateDevices=true", "PrivateIPC=true",
        "ProtectSystem=strict", "ProtectHome=true", "ProtectKernelTunables=true",
        "ProtectKernelModules=true", "ProtectKernelLogs=true", "ProtectControlGroups=true",
        "ProtectClock=true", "ProtectHostname=true", "ProtectProc=invisible", "ProcSubset=pid",
        "RestrictSUIDSGID=true", "RestrictNamespaces=true", "RestrictRealtime=true",
        "RestrictAddressFamilies=AF_UNIX", "LockPersonality=true", "AmbientCapabilities=",
        "SystemCallArchitectures=native"
      ]) {
        expect(service).toContain(directive);
      }
    }
    expect(backupTimer).toContain("OnCalendar=*-*-* 02:20:00 Asia/Shanghai");
    expect(restoreTimer).toContain("OnCalendar=*-*-01 03:30:00 Asia/Shanghai");
    for (const timer of [backupTimer, restoreTimer]) {
      expect(timer).toContain("Persistent=true");
      expect(timer.match(/OnCalendar=/gu)).toHaveLength(1);
    }
  });

  it("provides an explicit Ubuntu 22.04, PG14, systemd and root runnable gate", async () => {
    const gate = await read("tests/deployment/postgres-ops-linux-root.sh");
    expect(gate).toContain("run as root");
    expect(gate).toContain("Linux");
    expect(gate).toContain('VERSION_ID:-}" = 22.04');
    expect(gate).toContain("server_version_num");
    expect(gate).toContain("systemd-analyze verify");
    expect(gate).toContain("assert-postgres-ops-runtime.sh");
    expect(gate).toContain("BACKUP_TIMEZONE=Etc/UTC");
    expect(gate).toContain("a backup timezone that diverges from the installed timer was accepted");
    expect(gate).toContain("tampered restore success marker was accepted");
    expect(gate).toContain("hard-linked restore evidence was accepted");
    expect(gate).toContain("symlinked restore evidence was accepted");
  });
});
