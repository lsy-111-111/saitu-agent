import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { link, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  adoptionPowerLossFixtures,
  recoverLegacyAdoption
} from "./fixtures/legacy-adoption-recovery-model";

const root = process.cwd();
const execFileAsync = promisify(execFile);
const writerPath = "ops/bin/adopt-legacy-release.sh";
const recoveryPath = "ops/bin/recover-legacy-adoption.sh";

async function read(relativePath: string) {
  return readFile(path.resolve(root, relativePath), "utf8");
}

function expectInOrder(source: string, markers: readonly string[]) {
  let previous = -1;
  for (const marker of markers) {
    const current = source.indexOf(marker, previous + 1);
    expect(current, `missing or out-of-order marker: ${marker}`).toBeGreaterThan(previous);
    previous = current;
  }
}

describe("one-time legacy deployment adoption", () => {
  it("requires explicit acknowledgement, a confirmed snapshot and source-bound host baseline", async () => {
    const writer = await read(writerPath);

    expect(writer).toContain('"${ACK_LEGACY_ADOPTION:-}" = YES');
    expect(writer).toContain('"${CLOUD_SNAPSHOT_CONFIRMED:-}" = YES');
    expect(writer).toContain("CLOUD_SNAPSHOT_ID");
    expect(writer).toContain("^lhsnap-[A-Za-z0-9]{6,80}$");
    expect(writer).not.toContain("^snap-");
    expect(writer).toContain('values["SNAPSHOT_ID"] != sys.argv[3]');
    expect(writer).toContain('values["RELEASE_ID"] != sys.argv[2]');
    expect(writer).toContain("SYSTEM_DISK_ZONE");
    expect(writer).toContain("SYSTEM_DISK_STATE");
    expect(writer).toContain("SYSTEM_DISK_ATTACHED");
    expect(writer).toContain('sha256sum "$SNAPSHOT_EVIDENCE"');
    expect(writer).toContain('"snapshotEvidenceSha256"');
    expect(writer).toContain('"schemaVersion": 2');
    const recovery = await read(recoveryPath);
    expect(recovery).toContain("snapshotEvidenceSha256");
    expect(recovery).toContain("^lhsnap-[A-Za-z0-9]{6,80}$");
    expect(writer).toContain("HOST_BASELINE_DIR");
    expect(writer).toContain("sha256sum -c SHA256SUMS");
    expect(writer).toContain('cmp -s "$LIVE_SOURCE_SUMS" "$HOST_BASELINE_DIR/source-SHA256SUMS"');
    expect(writer).toContain("postgres-backup.txt");
  });

  it("binds the only observed PM2 app, PID, listener and cwd to the exact legacy release", async () => {
    const writer = await read(writerPath);

    expect(writer).toContain('[[ "$LEGACY_PID" =~ ^[1-9][0-9]*$ ]]');
    expect(writer).toContain('readlink -e "/proc/$LEGACY_PID/cwd"');
    expect(writer).toContain('"/home/ubuntu/resume-ai-web-releases/$RELEASE_ID"');
    expect(writer).toContain("old_pm2_as_ubuntu /usr/bin/pm2 jlist");
    expect(writer).toContain('entry.get("pid") != int(os.environ["LEGACY_PID"])');
    expect(writer).toContain("port 3000 is not owned exclusively by the explicit legacy PID");
    expect(writer).toContain("legacy PM2 must contain exactly one resume-ai application");
    expect(writer).toContain('expected_exec = pathlib.Path(os.environ["LEGACY_SOURCE"], "node_modules/next/dist/bin/next")');
    expect(writer).not.toContain('environment.get("PORT", "")');
  });

  it("isolates the exact legacy environment without recording or mixing its values", async () => {
    const writer = await read(writerPath);
    const ecosystem = await read("ops/pm2/legacy-ecosystem.config.cjs");
    const policy = (await read("ops/config/legacy-env-keys.conf"))
      .split("\n")
      .filter((line) => line && !line.startsWith("#"));

    expect(policy).toHaveLength(31);
    expect(new Set(policy).size).toBe(31);
    expect(writer).toContain("/etc/resume-ai/legacy.env");
    expect(writer).toContain("/usr/local/lib/resume-ai/assert-pm2-effective-service.sh");
    expect(writer).toContain('"$PM2_POLICY_VERIFIER" >/dev/null');
    expect(writer).toContain("os.O_NOFOLLOW");
    expect(writer).toContain("legacy .env.local keys differ from the exact reviewed production set");
    expect(writer).toContain("ENV_KEY_SET_SHA256");
    expect(writer).toContain("before.st_ctime_ns");
    expect(writer).toContain("before.st_mode, before.st_uid, before.st_gid");
    expect(writer).not.toContain("SOURCE_ENV_SHA256");
    expect(ecosystem).toContain('readLegacyEnvironment(\n  "/etc/resume-ai/legacy.env"');
    expect(ecosystem).toContain('const { parseEnv } = require("node:util")');
    expect(ecosystem).not.toContain("/etc/resume-ai/app.env");
    expect(ecosystem).not.toContain("/etc/resume-ai/quota.env");
    expect(ecosystem).not.toContain("process.loadEnvFile");
  });

  it("clones the built runtime but excludes config secrets, hardlinks and escaping members", async () => {
    const writer = await read(writerPath);
    const snapshot = await read("ops/bin/snapshot-legacy-release.py");
    const baseline = await read("ops/bin/capture-host-baseline.sh");

    expect(writer).toContain("source.sanitized.tar.gz");
    expect(writer).toContain("/usr/local/lib/resume-ai/snapshot-legacy-release.py");
    expect(writer).toContain('stat -Lc \'%d\' "/proc/$LEGACY_PID/cwd"');
    expect(writer).toContain('"$LEGACY_SOURCE_DEVICE" "$LEGACY_SOURCE_INODE"');
    expect(writer).toContain("legacy environment path no longer belongs to the running cwd inode");
    expect(snapshot).toContain("expected_source_identity");
    expect(snapshot).toContain("approved running cwd inode");
    expect(writer).toContain('"$LEGACY_SNAPSHOT_HELPER" "$LEGACY_SOURCE" "$LEGACY_SNAPSHOT_ROOT"');
    expect(writer).toContain('cd "$ARCHIVE_SOURCE"');
    expect(writer).toContain("stable legacy snapshot differs from the reviewed host baseline");
    expect(writer).toContain("legacy-runtime.manifest.jsonl");
    expect(writer).toContain("legacy build/runtime bytes differ from the stable pre-change baseline");
    expect(writer).toContain("--hard-dereference");
    expect(writer).toContain('name.startswith(".env.")');
    expect(writer).toContain("name in secret_names");
    expect(writer).toContain('relative.as_posix() == ".next/cache"');
    expect(writer).toContain('[ -d "$STAGING_RELEASE/.next" ] && [ -d "$STAGING_RELEASE/node_modules" ]');
    expect(writer).toContain("hard-linked file is forbidden in the copied release");
    expect(writer).toContain("release symlink escapes the copied tree");
    expect(writer).toContain("special file is forbidden in the copied release");
    expect(writer).toContain("frozen legacy release contains a non-root or runtime-writable member");
    expect(writer).toContain('fsync_tree "$EVIDENCE_DIR"');
    expect(writer).toContain('fsync_tree "$STAGING_RELEASE"');
    expect(writer.indexOf('fsync_tree "$STAGING_RELEASE"')).toBeLessThan(
      writer.indexOf("write_journal prepared")
    );
    expect(baseline).toContain('fsync_tree "$BASELINE_DIR"');
    expect(snapshot).toContain("O_NOFOLLOW");
    expect(snapshot).toContain("legacy source root changed while it was snapshotted");
    expect(snapshot).toContain("legacy snapshot symlink escapes the tree");
    expect(snapshot).toContain("hard-linked file is forbidden in the legacy source");
    expect(snapshot).toContain('relative.as_posix() == ".next/cache"');
  });

  it.skipIf(!existsSync("/proc/self/mountinfo"))(
    "freezes one stable legacy generation while preserving only safe relative links",
    async () => {
      const fixture = await mkdtemp(path.join(tmpdir(), "resume-ai-legacy-snapshot-"));
      const source = path.join(fixture, "source");
      const snapshot = path.join(fixture, "snapshot");
      const helper = path.join(root, "ops/bin/snapshot-legacy-release.py");
      try {
        await mkdir(path.join(source, ".next", "cache"), { recursive: true });
        await mkdir(path.join(source, "node_modules", "pkg"), { recursive: true });
        await mkdir(snapshot);
        await writeFile(path.join(source, "app.js"), "stable generation\n", "utf8");
        await writeFile(path.join(source, ".env.local"), "SECRET=excluded\n", "utf8");
        await writeFile(path.join(source, ".next", "cache", "mutable"), "excluded\n", "utf8");
        await writeFile(path.join(source, "node_modules", "pkg", "index.js"), "module\n", "utf8");
        await symlink("pkg/index.js", path.join(source, "node_modules", "entry.js"));

        await expect(execFileAsync("python3", [helper, source, snapshot])).resolves.toBeDefined();
        await expect(readFile(path.join(snapshot, "source", "app.js"), "utf8"))
          .resolves.toBe("stable generation\n");
        expect(existsSync(path.join(snapshot, "source", ".env.local"))).toBe(false);
        expect(existsSync(path.join(snapshot, "source", ".next", "cache"))).toBe(false);
        expect(existsSync(path.join(snapshot, "source", "node_modules", "entry.js"))).toBe(true);

        const escapingSource = path.join(fixture, "escaping");
        const escapingSnapshot = path.join(fixture, "escaping-snapshot");
        await mkdir(escapingSource);
        await mkdir(escapingSnapshot);
        await symlink("../../outside", path.join(escapingSource, "escape"));
        await expect(execFileAsync("python3", [helper, escapingSource, escapingSnapshot]))
          .rejects.toBeDefined();

        const hardlinkSource = path.join(fixture, "hardlink-source");
        const hardlinkSnapshot = path.join(fixture, "hardlink-snapshot");
        const outsideSecret = path.join(fixture, ".npmrc");
        await mkdir(hardlinkSource);
        await mkdir(hardlinkSnapshot);
        await writeFile(outsideSecret, "registry-token=must-not-copy\n", "utf8");
        await link(outsideSecret, path.join(hardlinkSource, "ordinary-name.js"));
        await expect(execFileAsync("python3", [helper, hardlinkSource, hardlinkSnapshot]))
          .rejects.toBeDefined();

        const racingSource = path.join(fixture, "racing");
        const racingSnapshot = path.join(fixture, "racing-snapshot");
        await mkdir(racingSource);
        await mkdir(racingSnapshot);
        await Promise.all(Array.from({ length: 500 }, (_, index) =>
          writeFile(path.join(racingSource, `${index.toString().padStart(4, "0")}.bin`), Buffer.alloc(4096, index % 251))
        ));
        const copy = execFileAsync("python3", [helper, racingSource, racingSnapshot]);
        const deadline = Date.now() + 5_000;
        while (!existsSync(path.join(racingSnapshot, "source")) && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        await rename(racingSource, path.join(fixture, "racing-swapped"));
        await expect(copy).rejects.toBeDefined();
      } finally {
        await execFileAsync("chmod", ["-R", "u+w", fixture]).catch(() => undefined);
        await rm(fixture, { recursive: true, force: true });
      }
    }
  );

  it("scans actual non-public values across .next, dependencies and every ordinary release file", async () => {
    const writer = await read(writerPath);
    for (const key of [
      "AI_API_KEY",
      "AI_CONVERSATION_SIGNING_SECRET",
      "AI_CONSENT_SALT",
      "DATABASE_URL",
      "MODERATION_ADMIN_TOKEN",
      "DISCUSSION_IDENTITY_CODES",
      "DISCUSSION_IP_SALT"
    ]) {
      expect(writer).toContain(`"${key}"`);
    }
    expect(writer).toContain("value is present in a copied release file");
    expect(writer).toContain('"$SECRET_SCANNER" --full "$STAGING_RELEASE/.next"');
    expect(writer).not.toContain("console.log(value)");
    expect(writer).not.toContain("console.error(value)");
  });

  it("starts and proves the frozen candidate under resume-ai and pinned Node 24 on port 3001", async () => {
    const writer = await read(writerPath);

    expect(writer).toContain("v24.20.0");
    expect(writer).toContain("runuser -u resume-ai -- env -i");
    expect(writer).toContain('APP_PORT="$CANDIDATE_PORT"');
    expect(writer).toContain('APP_PROCESS_NAME="$CANDIDATE_PROCESS_NAME"');
    expect(writer).toContain("candidate port 3001 is not owned exclusively by its dedicated PM2 PID");
    expect(writer).toContain("candidate process is outside the reviewed PM2 systemd sandbox");
    expect(writer.indexOf("systemctl start resume-ai-pm2.service")).toBeLessThan(
      writer.indexOf('pm2_as_app /opt/nodejs/current/bin/pm2 jlist')
    );
    expect(writer).toContain("scripts/verify-next-assets.mjs");
    for (const endpoint of [
      "/api/competitions/recommend/normalize",
      "/api/ai/competition-clarify",
      "/api/ai/competition-recommend"
    ]) {
      expect(writer).toContain(endpoint);
    }
    expect(writer).toContain('[ "$status" = 405 ]');
  });

  it("persists every adoption phase and stops ubuntu only after all managed state is durable", async () => {
    const writer = await read(writerPath);

    expect(writer).toContain("KIND=adopt");
    expect(writer).toContain("OLD_START_TIME_TICKS=$LEGACY_START_TIME_TICKS");
    expect(writer).toContain("LEGACY_START_TIME_TICKS=$LEGACY_START_TIME_TICKS");
    expect(writer).toContain('"$START_TICKS_READER" "$LEGACY_PID"');
    expect(writer).not.toContain("awk '{print $22}'");
    for (const phase of [
      "initializing",
      "prepared",
      "candidate_ready",
      "nginx_switched",
      "state_committed",
      "old_stopped"
    ]) {
      expect(writer).toContain(`write_journal ${phase}`);
    }
    expectInOrder(writer, [
      "write_journal initializing",
      'install -d -o root -g root -m 0700 "$EVIDENCE_ROOT" "$EVIDENCE_DIR"',
      "write_journal prepared",
      'mv -- "$STAGING_RELEASE" "$FINAL_RELEASE"',
      "write_journal candidate_ready",
      "systemctl reload nginx",
      "write_journal nginx_switched",
      'mv -Tf -- "$current_temp" "$CURRENT_LINK"',
      '"$DATABASE_STATE_WRITER" "$RELEASE_ID" legacy-delete',
      "write_journal state_committed",
      'old_pm2_as_ubuntu /usr/bin/pm2 delete "$LEGACY_PROCESS_NAME"',
      'old_pm2_as_ubuntu /usr/bin/pm2 save --force',
      "write_journal old_stopped",
      'rm -f -- "$PENDING_FILE"'
    ]);
    expect(writer).not.toContain("grant-legacy-delete");
  });

  it("installs an independent boot recovery unit before Nginx", async () => {
    const layout = await read("ops/bin/install-runtime-layout.sh");
    const service = await read("ops/systemd/resume-ai-legacy-adoption-recovery.service");
    const nginxDropIn = await read("ops/systemd/nginx-resume-ai-recovery.conf");

    expect(layout).toContain("resume-ai-legacy-adoption-recovery.service");
    expect(layout).toContain("recover-legacy-adoption.sh");
    expect(service).toContain("ConditionPathExists=/opt/resume-ai/state/legacy-adoption.pending");
    expect(service).toContain("Before=nginx.service");
    expect(service).toContain("Requires=resume-ai-pm2.service");
    expect(service).toContain(
      "ReadWritePaths=/opt/resume-ai /etc/resume-ai /etc/nginx/conf.d /var/lib/resume-ai /var/cache/resume-ai -/var/backups/resume-ai/legacy-adoption /home/ubuntu/.pm2 /run/resume-ai-locks"
    );
    expect(nginxDropIn).toContain("resume-ai-legacy-adoption-recovery.service");
  });
});

describe("legacy adoption power-loss recovery", () => {
  it.each(adoptionPowerLossFixtures)(
    "$phase with upstream $upstreamPort follows the safe recovery branch",
    (observation) => {
      const result = recoverLegacyAdoption(observation);

      if (observation.upstreamPort === 3000) {
        expect(result).toMatchObject({
          outcome: "preserve-legacy",
          activePort: 3000,
          legacyProcessRunning: true,
          candidateProcessRunning: false,
          managedStateRelease: null,
          currentRelease: null,
          databaseMode: "unchanged-legacy",
          journalCleared: true
        });
        expect(result.actions).not.toContain("stop-legacy-pm2");
      } else {
        expect(result).toMatchObject({
          outcome: "complete-adoption",
          activePort: 3001,
          legacyProcessRunning: false,
          candidateProcessRunning: true,
          managedStateRelease: "candidate",
          currentRelease: "candidate",
          databaseMode: "legacy-delete",
          journalCleared: true
        });
        expect(result.actions.at(-2)).toBe("stop-legacy-pm2");
      }
    }
  );

  it("rejects an impossible committed phase whose upstream still points to 3000", () => {
    expect(() => recoverLegacyAdoption({ phase: "nginx_switched", upstreamPort: 3000 }))
      .toThrow("conflicts with the observed upstream");
  });

  it("uses the on-disk upstream as the pre-switch commit witness and never grants new database privileges", async () => {
    const recovery = await read(recoveryPath);
    const rollbackBranch = recovery.slice(recovery.indexOf("initializing:3000|prepared:3000|candidate_ready:3000"));
    const completeBranch = recovery.slice(recovery.indexOf("prepared:3001|candidate_ready:3001"));

    expect(recovery).toContain("legacy-adoption.pending");
    expect(recovery).toContain('OBSERVED_UPSTREAM="$(upstream_port)"');
    expect(rollbackBranch).toContain("ensure_old_service");
    expect(rollbackBranch).toContain("stop_candidate_pre_switch");
    expect(recovery).toContain('pm2 save --force');
    expect(recovery).not.toContain("pm2 resurrect");
    expect(recovery).toContain("refusing to execute its user-writable PM2 dump");
    expect(recovery).toContain("managed PM2 service is not active; refusing to create an unsandboxed daemon");
    expect(recovery).toContain("trusted legacy recovery control is missing or unsafe");
    expect(recovery).toContain('"$PM2_POLICY_VERIFIER" >/dev/null');
    expect(recovery).toContain("--max-redirs 0");
    expect(recovery).toContain('[ "$status" = 200 ]');
    expect(recovery).toContain('/proc/self/mountinfo');
    expectInOrder(completeBranch, [
      "ensure_candidate",
      "write_managed_state",
      "ALLOW_PENDING_LEGACY_ADOPTION=1",
      "write_journal state_committed",
      "stop_old_service",
      "write_journal old_stopped",
      'rm -f -- "$PENDING_FILE"'
    ]);
    expect(recovery).not.toContain("grant-legacy-delete");
  });
});
