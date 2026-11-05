import { execFile, type ExecFileException } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  recoverPowerLoss,
  transactionFixtures,
  type TransactionKind
} from "./fixtures/transaction-recovery-model";

const workspaceRoot = process.cwd();
const setupScript = path.resolve(workspaceRoot, "deploy/setup.sh");

const transactionWriters: ReadonlyArray<{
  kind: TransactionKind;
  path: string;
}> = [
  { kind: "deploy", path: "ops/bin/deploy-release.sh" },
  { kind: "rollback", path: "ops/bin/rollback-release.sh" },
  { kind: "initialize", path: "ops/bin/initialize-release-state.sh" }
];

const requiredJournalFields = [
  "KIND",
  "PHASE",
  "NEW_RELEASE",
  "NEW_PORT",
  "NEW_PREVIOUS_RELEASE",
  "NEW_PREVIOUS_PORT",
  "APPROVAL_FILE_SHA256"
] as const;

function runRetiredSetup(env: NodeJS.ProcessEnv) {
  return new Promise<{
    error: ExecFileException | null;
    stdout: string;
    stderr: string;
  }>((resolve) => {
    execFile(
      "/bin/bash",
      [setupScript],
      { env, encoding: "utf8", maxBuffer: 64 * 1024 },
      (error, stdout, stderr) => resolve({ error, stdout, stderr })
    );
  });
}

describe("retired legacy deployment entrypoint", () => {
  it.each([
    ["without the former test escape hatch", undefined],
    ["with the former test escape hatch", "1"]
  ])("always exits 64 %s and performs no legacy setup", async (_label, escapeHatch) => {
    const fixtureRoot = await mkdtemp(path.join(tmpdir(), "resume-ai-retired-setup-"));
    const sentinel = path.join(fixtureRoot, "must-remain-unchanged");
    await writeFile(sentinel, "unchanged\n", "utf8");

    try {
      const env: NodeJS.ProcessEnv = {
        NODE_ENV: "test",
        PATH: "/usr/bin:/bin",
        APP_DIR: fixtureRoot,
        ENABLE_HTTPS: "1",
        FEATURE_AI: "1",
        SUDO_PASS: "must-not-be-used"
      };
      if (escapeHatch !== undefined) {
        env.ALLOW_LEGACY_SETUP_FOR_TESTS = escapeHatch;
      }

      const result = await runRetiredSetup(env);

      expect(result.error).not.toBeNull();
      expect(result.error?.code).toBe(64);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("deploy/setup.sh is permanently retired");
      await expect(readFile(sentinel, "utf8")).resolves.toBe("unchanged\n");
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });
});

describe("transactional deployment power-loss recovery", () => {
  it.each(transactionWriters)(
    "$kind writer persists the complete recovery contract at every phase",
    async ({ kind, path: relativePath }) => {
      const source = await readFile(path.resolve(workspaceRoot, relativePath), "utf8");

      expect(source).toMatch(new RegExp(`KIND=${kind}\\n`));
      for (const field of requiredJournalFields) {
        expect(source, `${relativePath} must journal ${field}`).toMatch(
          new RegExp(`^${field}=`, "m")
        );
      }
      for (const phase of ["prepared", "nginx_switched", "state_committed"] as const) {
        expect(source, `${relativePath} must persist phase ${phase}`).toContain(
          `write_journal ${phase}`
        );
      }
      if (kind === "deploy") {
        expect(source).toContain("write_journal publishing");
        expect(source).toContain("write_journal hardening_started");
        expect(source).toContain("write_journal permissions_hardened");
        expect(source).toContain("write_journal rollback_decided");
      }
    }
  );

  it("the recovery parser accepts only reviewed kinds and phase-specific hardening", async () => {
    const recovery = await readFile(
      path.resolve(workspaceRoot, "ops/bin/recover-deployment-state.sh"),
      "utf8"
    );

    expect(recovery).toContain("case \"$KIND\" in deploy|rollback|initialize)");
    expect(recovery).toContain("open_root_lock 9 deploy");
    expect(recovery).toContain('/proc/$$/fd/9');
    expect(recovery).toContain(
      "case \"$PHASE\" in publishing|prepared|nginx_switched|hardening_started|permissions_hardened|state_committed|rollback_decided)"
    );
    expect(recovery).toContain('if [ "$PHASE" = state_committed ]');
    expect(recovery).toContain('if [ "$KIND" = initialize ]');
    expect(recovery).toContain("Recovered incomplete $KIND transaction");
    for (const field of requiredJournalFields) {
      expect(recovery).toContain(`${field}=\${journal[${field}]:-}`);
    }
  });

  it.each(transactionFixtures)(
    "recovers $kind after power loss in $phase",
    ({ kind, phase, journal, observed }) => {
      const result = recoverPowerLoss(journal, observed);
      const completesNext =
        phase === "state_committed" ||
        phase === "hardening_started" ||
        phase === "permissions_hardened" ||
        kind === "initialize";

      expect(result.active).toEqual(
        completesNext ? journal.next.active : journal.old?.active
      );
      expect(result.previous).toEqual(
        completesNext ? journal.next.previous : journal.old?.previous
      );
      expect(result.journalCleared).toBe(true);
      expect(result.action).toBe(
        phase === "publishing"
          ? "discard-uncommitted-publication"
          : phase === "state_committed"
          ? "accept-committed"
          : phase === "hardening_started" || phase === "permissions_hardened"
            ? "complete-post-soak-hardening"
            : kind === "initialize"
              ? "complete-initialization"
              : "restore-old-topology"
      );
    }
  );

  it("does not accept a state_committed journal when durable state does not match it", () => {
    const fixture = transactionFixtures.find(
      ({ kind, phase }) => kind === "deploy" && phase === "state_committed"
    );
    expect(fixture).toBeDefined();
    if (!fixture) return;

    expect(fixture.journal.old).not.toBeNull();
    const result = recoverPowerLoss(fixture.journal, fixture.journal.old);
    expect(result.action).toBe("restore-old-topology");
    expect(result.active).toEqual(fixture.journal.old?.active);
    expect(result.previous).toEqual(fixture.journal.old?.previous);
  });

  it("restores a legacy DELETE contract before rollback traffic can switch", async () => {
    const rollback = await readFile(
      path.resolve(workspaceRoot, "ops/bin/rollback-release.sh"),
      "utf8"
    );
    const journal = rollback.indexOf("write_journal prepared");
    const authorization = rollback.indexOf("authorize_rollback_target", journal);
    const nginxSwitch = rollback.indexOf("systemctl reload nginx", authorization);
    expect(journal).toBeGreaterThan(-1);
    expect(authorization).toBeGreaterThan(journal);
    expect(nginxSwitch).toBeGreaterThan(authorization);
    expect(rollback).toContain("grant-legacy-delete \"$PREVIOUS_RELEASE\"");
    expect(rollback).toContain("verify-compat");
  });
});
