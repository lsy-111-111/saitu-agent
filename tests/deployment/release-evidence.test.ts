import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  unlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const codexSecurityTargetId = async (target: string) =>
  `target_sha256_${hash(`local-workspace\0${await realpath(target)}`)}`;

function canonicalFinding(findingId: string) {
  return {
    findingId,
    occurrenceId: "occ_0123456789abcdef01234567",
    ruleId: "release-evidence.fixture",
    identity: { anchor: "src/example.ts/release-evidence.fixture" },
    fingerprints: { algorithm: "codex-security/v1", primary: `codex-security/v1:sha256:${"b".repeat(64)}` },
    title: "Release evidence fixture finding",
    summary: "A validated fixture finding used to exercise closure semantics.",
    severity: { level: "medium" },
    confidence: { level: "high", rationale: "The deterministic fixture demonstrates the condition." },
    taxonomy: { category: "test", cwe: ["CWE-20"] },
    locations: [{ path: "src/example.ts", startLine: 1 }],
    remediation: "Replace the vulnerable fixture bytes and run focused verification.",
    provenance: { source: "codex-security-plugin" }
  };
}

async function writeTrustedGenerationAttestation(target: string, manifest: string, receipt: string, createdAt: string) {
  // @ts-expect-error JavaScript evidence helper intentionally has no declaration file.
  const { inspectCodexSecurityDirectorySnapshot } = await import("../../scripts/lib/codex-security-directory-snapshot.mjs");
  const snapshot = await inspectCodexSecurityDirectorySnapshot(target, await readFile(manifest));
  const manifestBytes = await readFile(manifest);
  const generationId = "ds-20260827T010203Z-0123456789abcdef";
  const producerSha256 = "a".repeat(64);
  const generationRoot = `/private/var/db/com.siyuanjiaxin.resume-ai/deep-scan-generations/${generationId}`;
  const value = {
    schema: "com.siyuanjiaxin.resume-ai.deep-scan-generation/v1",
    schemaVersion: 1,
    evidenceType: "trusted-macos-codex-security-generation",
    generationId,
    createdAt,
    producer: {
      installedPath: "/Library/PrivilegedHelperTools/com.siyuanjiaxin.resume-ai.create-deep-scan-generation",
      sha256: producerSha256,
      mode: "0444",
      device: "1",
      inode: "2"
    },
    sourceManifest: { sha256: hash(manifestBytes), bytes: manifestBytes.length, memberCount: snapshot.sourceMemberCount },
    sourceRootIdentity: { device: "3", inode: "4", mode: "0755" },
    generation: {
      root: generationRoot,
      source: `${generationRoot}/source`,
      ownerUid: 0,
      ownerGid: 0,
      rootMode: "0555",
      sourceIdentity: { device: "5", inode: "6", mode: "0755" }
    },
    scanner: {
      uid: Math.max(1, process.getuid?.() ?? 501),
      gid: Math.max(1, process.getgid?.() ?? 20),
      name: "release-evidence-test",
      accessPolicy: "exact-posix-modes; other-read/search; no-group-or-world-write"
    },
    snapshot: { ...snapshot, treeBytes: 0 },
    boundary: {
      candidateCodeExecuted: false,
      descriptorRelativeTraversal: true,
      symlinkAncestorsFollowed: false,
      atomicPublish: true,
      atomicNoClobber: true,
      extendedAclEntries: false,
      exactManifestMembership: true,
      modePolicy: "preserve exact source mode and fail unless scanner-readable and scanner-nonwritable",
      attestationSignature: "none; externally pin this attestation hash and producer hash"
    },
    runtime: {
      python: "3.9.6",
      pythonExecutable: "/usr/bin/python3",
      isolatedMode: true,
      siteImportDisabled: true
    }
  };
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  await writeFile(receipt, bytes);
  return { snapshot, value, bytes, producerSha256, attestationSha256: hash(bytes), generationId };
}

async function exportFixture(args: string[], trusted: Awaited<ReturnType<typeof writeTrustedGenerationAttestation>>) {
  // The public CLI always performs the privileged fixed-path/UID/ACL inspection.
  // Unit fixtures inject only the already-validated boundary result because an
  // unprivileged test process cannot create root:wheel files under /private/var/db.
  // @ts-expect-error JavaScript evidence helper intentionally has no declaration file.
  const { runDeepScanEvidenceExporter } = await import("../../scripts/export-deep-scan-evidence.mjs");
  await runDeepScanEvidenceExporter(args, {
    acquireGenerationLock: async () => ({ release: async () => {} }),
    inspectGeneration: async (input: { attestationSha256: string; producerSha256: string }) => {
      expect(input.attestationSha256).toBe(trusted.attestationSha256);
      expect(input.producerSha256).toBe(trusted.producerSha256);
      return {
        attestation: trusted.value,
        attestationArtifact: { bytes: trusted.bytes, sha256: trusted.attestationSha256 },
        generationId: trusted.generationId,
        producerSha256: trusted.producerSha256,
        sourceManifestSha256: trusted.value.sourceManifest.sha256
      };
    }
  });
}

describe("release evidence chain", () => {
  it("derives one exact source set from Git and excludes local/secret/generated members", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "resume-ai-source-set-"));
    const pathsOutput = path.join(fixture, "..", `${path.basename(fixture)}-paths.nul`);
    try {
      await execFileAsync("/usr/bin/git", ["init", "-q", fixture]);
      for (const [relative, content] of [
        [".env.example", "AI_API_KEY=\n"],
        [".env.local", "AI_API_KEY=not-for-release\n"],
        [".claude/launch.json", "{}\n"],
        [".DS_Store", "local\n"],
        ["cache.tsbuildinfo", "generated\n"],
        ["artifacts/old.txt", "generated\n"],
        ["api密钥.rtfd/TXT.rtf", "must-not-be-read-or-released\n"],
        ["src/tracked.ts", "export const tracked = true;\n"],
        ["src/deleted.ts", "export const deleted = true;\n"]
      ]) {
        const filename = path.join(fixture, relative);
        await mkdir(path.dirname(filename), { recursive: true });
        await writeFile(filename, content, "utf8");
      }
      await execFileAsync("/usr/bin/git", ["-C", fixture, "add", "-f", "."]);
      await unlink(path.join(fixture, "src/deleted.ts"));
      await writeFile(path.join(fixture, "src/untracked.ts"), "export const untracked = true;\n", "utf8");
      const { stdout } = await execFileAsync("/bin/bash", [
        path.join(root, "ops/bin/create-release-source-manifest.sh"), fixture
      ], {
        env: { ...process.env, RELEASE_SOURCE_PATHS_NUL: pathsOutput },
        maxBuffer: 10 * 1024 * 1024
      });
      expect(stdout).toContain("\tF\t.env.example\n");
      expect(stdout).toContain("\tF\tsrc/tracked.ts\n");
      expect(stdout).toContain("\tF\tsrc/untracked.ts\n");
      for (const forbidden of [".env.local", ".claude", ".DS_Store", "tsbuildinfo", "artifacts/", "api密钥.rtfd", "deleted.ts"]) {
        expect(stdout).not.toContain(forbidden);
      }
      const paths = (await readFile(pathsOutput)).toString("utf8").split("\0").filter(Boolean);
      expect(paths).toEqual([".env.example", "src/tracked.ts", "src/untracked.ts"]);
    } finally {
      await rm(fixture, { recursive: true, force: true });
      await rm(pathsOutput, { force: true });
    }
  });

  it("scans normalized diff hunk payloads while allowing only exact reviewed placeholders", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "resume-ai-patch-scan-"));
    try {
      const allowed = path.join(fixture, "allowed.patch");
      await writeFile(allowed, [
        "diff --git a/.env.example b/.env.example",
        "--- a/.env.example",
        "+++ b/.env.example",
        "@@ -0,0 +1,1 @@",
        "+# e.g. postgresql://saitu:password@localhost:5432/saitu",
        "diff --git a/playwright.config.ts b/playwright.config.ts",
        "--- a/playwright.config.ts",
        "+++ b/playwright.config.ts",
        "@@ -0,0 +1,1 @@",
        "+AI_CONVERSATION_SIGNING_SECRET=e2e-competition-signing-secret-at-least-thirty-two-characters",
        ""
      ].join("\n"), "utf8");
      await expect(execFileAsync("/bin/bash", [path.join(root, "ops/bin/scan-release-secrets.sh"), "--full", allowed]))
        .resolves.toBeDefined();
      await expect(execFileAsync("/bin/bash", [
        path.join(root, "ops/bin/scan-release-secrets.sh"),
        "--source-tree",
        path.join(root, "ops/bin/scan-release-secrets.sh"),
        path.join(root, "tests/deployment/release-evidence.test.ts")
      ], { cwd: root })).resolves.toBeDefined();

      const sourceFixture = path.join(fixture, "source");
      const deceptiveTestPath = path.join(
        sourceFixture,
        "tests/deployment/release-evidence.test.ts"
      );
      await mkdir(path.dirname(deceptiveTestPath), { recursive: true });
      await writeFile(
        deceptiveTestPath,
        `DATABASE_URL=${["postgresql://user:", "p".repeat(24), "@localhost:5432/saitu"].join("")}\n`,
        "utf8"
      );
      await expect(execFileAsync("/bin/bash", [
        path.join(root, "ops/bin/scan-release-secrets.sh"),
        "--source-tree",
        sourceFixture
      ])).rejects.toMatchObject({ code: 1 });

      const rejected = path.join(fixture, "rejected.patch");
      await writeFile(rejected, [
        "diff --git a/src/config.ts b/src/config.ts",
        "--- a/src/config.ts",
        "+++ b/src/config.ts",
        "@@ -0,0 +1,1 @@",
        `+AI_API_KEY=${"r".repeat(48)}`,
        ""
      ].join("\n"), "utf8");
      await expect(execFileAsync("/bin/bash", [path.join(root, "ops/bin/scan-release-secrets.sh"), "--full", rejected]))
        .rejects.toMatchObject({ code: 1 });

      const masqueradingLog = path.join(fixture, "masquerading-log.json");
      await writeFile(masqueradingLog, [
        "diff --git a/README.md b/README.md",
        "--- a/README.md",
        "+++ b/README.md",
        "@@ -1 +1 @@",
        "+ordinary documentation",
        `AI_API_KEY=${"s".repeat(48)}`,
        ""
      ].join("\n"), "utf8");
      await expect(execFileAsync("/bin/bash", [path.join(root, "ops/bin/scan-release-secrets.sh"), "--full", masqueradingLog]))
        .rejects.toMatchObject({ code: 1 });

      const dollarLiteral = path.join(fixture, "dollar-literal.env");
      await writeFile(
        dollarLiteral,
        ["PASS", "WORD=", "'", "$literal-production-", "password-1234567890", "'\n"].join(""),
        "utf8"
      );
      await expect(execFileAsync("/bin/bash", [
        path.join(root, "ops/bin/scan-release-secrets.sh"), "--source-tree", dollarLiteral
      ])).rejects.toMatchObject({ code: 1 });

      const importSentinel = path.join(fixture, "python-import-hijack-ran");
      await writeFile(
        path.join(fixture, "pathlib.py"),
        `open(${JSON.stringify(importSentinel)}, "w", encoding="utf-8").write("executed\\n")\n`,
        "utf8"
      );
      const benign = path.join(fixture, "benign.txt");
      await writeFile(benign, "ordinary release evidence\n", "utf8");
      await expect(execFileAsync("/bin/bash", [
        path.join(root, "ops/bin/scan-release-secrets.sh"), "--full", benign
      ], { cwd: fixture })).resolves.toBeDefined();
      await expect(lstat(importSentinel)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("decodes Git binary literals and rejects a secret hidden beside a benign text hunk", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "resume-ai-binary-patch-secret-"));
    try {
      await execFileAsync("/usr/bin/git", ["init", "-q", fixture]);
      await execFileAsync("/usr/bin/git", ["-C", fixture, "config", "user.name", "Release Evidence Test"]);
      await execFileAsync("/usr/bin/git", ["-C", fixture, "config", "user.email", "release-evidence@example.invalid"]);
      await writeFile(path.join(fixture, "README.md"), "before\n", "utf8");
      await writeFile(path.join(fixture, "removed.bin"), Buffer.concat([
        Buffer.from([0, 1, 2, 0]),
        Buffer.from(["-----BEGIN ", "PRIVATE KEY-----\nnot-a-real-key\n-----END ", "PRIVATE KEY-----\n"].join("")),
        Buffer.from([0, 255, 0])
      ]));
      await execFileAsync("/usr/bin/git", ["-C", fixture, "add", "README.md", "removed.bin"]);
      await execFileAsync("/usr/bin/git", ["-C", fixture, "commit", "-q", "-m", "fixture"]);
      await writeFile(path.join(fixture, "README.md"), "after\n", "utf8");
      await unlink(path.join(fixture, "removed.bin"));
      const { stdout } = await execFileAsync("/usr/bin/git", ["-C", fixture, "diff", "--binary", "HEAD"], {
        encoding: "buffer",
        maxBuffer: 8 * 1024 * 1024
      });
      const patchPath = path.join(fixture, "mixed.patch");
      await writeFile(patchPath, stdout);
      expect(stdout.includes(Buffer.from("@@ "))).toBe(true);
      expect(stdout.includes(Buffer.from("GIT binary patch"))).toBe(true);
      await expect(execFileAsync("/bin/bash", [
        path.join(root, "ops/bin/scan-release-secrets.sh"), "--full", patchPath
      ])).rejects.toMatchObject({ code: 1 });
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("accepts the current dirty-tree patch without weakening generic secret detection", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "resume-ai-current-patch-"));
    try {
      const { stdout } = await execFileAsync("/usr/bin/git", [
        "diff", "--binary", "--no-ext-diff", "HEAD", "--", ".",
        ":(exclude)artifacts", ":(exclude)tests/fixtures/competition-score-prospective-baseline.json"
      ], { cwd: root, maxBuffer: 128 * 1024 * 1024 });
      const patchPath = path.join(fixture, "working-tree.patch");
      await writeFile(patchPath, stdout);
      await expect(execFileAsync("/bin/bash", [path.join(root, "ops/bin/scan-release-secrets.sh"), "--full", patchPath]))
        .resolves.toBeDefined();
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("requires an independently validated baseline candidate and never auto-captures during bundle preparation", async () => {
    const [prepare, deploy, verifier] = await Promise.all([
      readFile(path.join(root, "ops/bin/prepare-release-bundle.sh"), "utf8"),
      readFile(path.join(root, "ops/bin/deploy-release.sh"), "utf8"),
      readFile(path.join(root, "ops/bin/verify-release-evidence.mjs"), "utf8")
    ]);
    expect(prepare).not.toContain("scripts/capture-competition-prospective-baseline.mjs");
    expect(prepare).toContain("PROSPECTIVE_BASELINE_INPUT");
    expect(prepare).toContain("ACK_BOOTSTRAP_PROSPECTIVE_BASELINE=YES");
    expect(prepare).toContain("prospectiveBaselineCandidate");
    expect(prepare).toContain("/opt/resume-ai/release-artifacts/$PREVIOUS_RELEASE_ID/baseline/competition-score-prospective-baseline.json");
    for (const source of [prepare, deploy, verifier]) {
      expect(source).toContain("carry-forward");
      expect(source).toContain("originReleaseId");
      expect(source).toContain("originSourceArchiveSha256");
    }
  });

  it("exports one sealed Deep Scan and derives a zero-finding final result", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "resume-ai-deep-export-"));
    const scanDir = path.join(fixture, "scan");
    const scanTargetDir = path.join(fixture, "scan-target");
    const evidenceDir = path.join(fixture, "evidence");
    try {
      await mkdir(scanDir);
      await mkdir(path.join(scanTargetDir, "src"), { recursive: true });
      const sourceManifest = path.join(fixture, "source-manifest.txt");
      const sourceBytes = Buffer.from("export const scanned = true;\n");
      await writeFile(path.join(scanTargetDir, "src/example.ts"), sourceBytes);
      await chmod(path.join(scanTargetDir, "src/example.ts"), 0o644);
      await writeFile(sourceManifest, `${hash(sourceBytes)}\tF\tsrc/example.ts\n`, "utf8");
      const targetReceipt = path.join(fixture, "trusted-generation-attestation.json");
      const findings = Buffer.from(JSON.stringify({
        documentType: "codex-security.findings", schemaVersion: "1.0", scanId: "scan_release_evidence", findings: []
      }));
      const coverage = Buffer.from(JSON.stringify({
        documentType: "codex-security.coverage", schemaVersion: "1.0", scanId: "scan_release_evidence",
        mode: "deep_repository", completeness: "complete", inventoryStrategy: "repository",
        includePaths: ["."], excludePaths: [],
        surfaces: [{ id: "surface_fixture", label: "Fixture source review", disposition: "no_issue_found", receiptRefs: [] }],
        explicitExclusions: [], deferred: [], openQuestions: []
      }));
      await writeFile(path.join(scanDir, "findings.json"), findings);
      await writeFile(path.join(scanDir, "coverage.json"), coverage);
      await writeFile(path.join(scanDir, "report.md"), "# TAMPERED UNSEALED PROJECTION\n\nThis text must not become release evidence.\n", "utf8");
      const asIsoSecond = (milliseconds: number) => new Date(milliseconds).toISOString().replace(/\.\d{3}Z$/u, "Z");
      const now = Date.now();
      const trusted = await writeTrustedGenerationAttestation(scanTargetDir, sourceManifest, targetReceipt, asIsoSecond(now - 90 * 60_000));
      const snapshot = trusted.snapshot;
      await writeFile(path.join(scanDir, "scan-manifest.json"), JSON.stringify({
        documentType: "codex-security.scan-manifest",
        schemaVersion: "1.0",
        scan: {
          id: "scan_release_evidence",
          producer: { name: "codex-security-plugin", version: "0.1.22" },
          status: "completed",
          startedAt: asIsoSecond(now - 60 * 60_000),
          completedAt: asIsoSecond(now - 30 * 60_000),
          sealedAt: asIsoSecond(now - 29 * 60_000),
          target: {
            kind: "directory_snapshot",
            targetId: await codexSecurityTargetId(scanTargetDir),
            displayName: "resume-ai-evidence-fixture",
            snapshotDigest: snapshot.snapshotDigest
          },
          scope: { includePaths: ["."], excludePaths: [] },
          findingsRef: "findings.json",
          coverageRef: "coverage.json",
          artifacts: [
            { path: "findings.json", sha256: hash(findings), mediaType: "application/json" },
            { path: "coverage.json", sha256: hash(coverage), mediaType: "application/json" }
          ]
        }
      }), "utf8");
      const exportArguments = [
        "--scan-dir", scanDir,
        "--scan-target-dir", scanTargetDir,
        "--trusted-generation-attestation", targetReceipt,
        "--trusted-generation-attestation-sha256", trusted.attestationSha256,
        "--trusted-generation-producer-sha256", trusted.producerSha256,
        "--scan-source-manifest", sourceManifest,
        "--evidence-dir", evidenceDir
      ];
      const concurrentExports = await Promise.allSettled([
        exportFixture(exportArguments, trusted),
        exportFixture(exportArguments, trusted)
      ]);
      expect(concurrentExports.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(concurrentExports.filter((result) => result.status === "rejected")).toHaveLength(1);
      expect(await readFile(path.join(evidenceDir, "security-scan-report.txt"), "utf8"))
        .not.toContain("TAMPERED UNSEALED PROJECTION");
      await chmod(path.join(scanTargetDir, "src/example.ts"), 0o755);
      await expect(execFileAsync(process.execPath, [
        path.join(root, "scripts/finalize-deep-scan-evidence.mjs"),
        "--evidence-dir", evidenceDir,
        "--final-source-manifest", sourceManifest,
        "--final-source-root", scanTargetDir
      ])).rejects.toMatchObject({ code: 1 });
      await chmod(path.join(scanTargetDir, "src/example.ts"), 0o644);
      await execFileAsync(process.execPath, [
        path.join(root, "scripts/finalize-deep-scan-evidence.mjs"),
        "--evidence-dir", evidenceDir,
        "--final-source-manifest", sourceManifest,
        "--final-source-root", scanTargetDir
      ]);
      const result = JSON.parse(await readFile(path.join(evidenceDir, "security-scan-result.json"), "utf8"));
      expect(result).toMatchObject({
        status: "passed",
        scanId: "scan_release_evidence",
        validatedFindingCount: 0,
        validatedOpenFindings: 0,
        untriagedFindings: 0
      });
      expect(result.scanSourceManifestSha256).toBe(result.finalSourceManifestSha256);
      expect(result.scanSourceModeManifestSha256).toBe(result.finalSourceModeManifestSha256);
      expect(result.rawCompletionSha256).toMatch(/^[a-f0-9]{64}$/u);
      // @ts-expect-error JavaScript evidence helper intentionally has no declaration file.
      const { validateDeepScan } = await import("../../ops/bin/verify-release-evidence.mjs");
      await expect(validateDeepScan(
        evidenceDir,
        hash(await readFile(sourceManifest)),
        result.finalSourceModeManifestSha256,
        result.finalSourceModeMemberCount
      )).resolves.toBeDefined();
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("leaves an interrupted Deep Scan evidence generation uncommitted and never reuses it", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "resume-ai-deep-publish-crash-"));
    const evidenceDir = path.join(fixture, "evidence-generation");
    try {
      // @ts-expect-error JavaScript evidence helper intentionally has no declaration file.
      const { publishDeepScanEvidenceGeneration } = await import("../../scripts/export-deep-scan-evidence.mjs");
      await expect(publishDeepScanEvidenceGeneration(
        evidenceDir,
        Buffer.from("derived report\n", "utf8"),
        Buffer.from('{"committed":true}\n', "utf8"),
        { afterReport: async () => { throw new Error("simulated power loss"); } }
      )).rejects.toThrow(/simulated power loss/u);
      expect(await readFile(path.join(evidenceDir, "security-scan-report.txt"), "utf8"))
        .toBe("derived report\n");
      await expect(lstat(path.join(evidenceDir, "deep-scan-export.json")))
        .rejects.toMatchObject({ code: "ENOENT" });
      await expect(publishDeepScanEvidenceGeneration(
        evidenceDir,
        Buffer.from("replacement report\n", "utf8"),
        Buffer.from('{"committed":true}\n', "utf8")
      )).rejects.toMatchObject({ code: "EEXIST" });
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("derives every nonzero Deep Scan closure from one authoritative fix receipt", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "resume-ai-deep-closure-"));
    const scanDir = path.join(fixture, "scan");
    const scanTargetDir = path.join(fixture, "scan-target");
    const finalTargetDir = path.join(fixture, "final-target");
    const evidenceDir = path.join(fixture, "evidence");
    const closuresDir = path.join(evidenceDir, "deep-scan-closures");
    try {
      await mkdir(scanDir);
      await mkdir(path.join(scanTargetDir, "src"), { recursive: true });
      await mkdir(path.join(finalTargetDir, "src"), { recursive: true });
      await mkdir(path.join(finalTargetDir, "tests"), { recursive: true });
      const scanSource = path.join(fixture, "scan-source-manifest.txt");
      const finalSource = path.join(fixture, "final-source-manifest.txt");
      const scanBytes = Buffer.from("export const finding = true;\n");
      const finalBytes = Buffer.from("export const finding = false;\n");
      const regressionBytes = Buffer.from("test('fixed', () => expect(true).toBe(true));\n");
      await writeFile(path.join(scanTargetDir, "src/example.ts"), scanBytes);
      await writeFile(path.join(finalTargetDir, "src/example.ts"), finalBytes);
      await writeFile(path.join(finalTargetDir, "tests/regression.test.ts"), regressionBytes);
      await chmod(path.join(scanTargetDir, "src/example.ts"), 0o644);
      await chmod(path.join(finalTargetDir, "src/example.ts"), 0o644);
      await chmod(path.join(finalTargetDir, "tests/regression.test.ts"), 0o644);
      await writeFile(scanSource, `${hash(scanBytes)}\tF\tsrc/example.ts\n`, "utf8");
      await writeFile(finalSource, [
        `${hash(finalBytes)}\tF\tsrc/example.ts`,
        `${hash(regressionBytes)}\tF\ttests/regression.test.ts`,
        ""
      ].join("\n"), "utf8");
      const targetReceipt = path.join(fixture, "trusted-generation-attestation.json");
      const findingId = "csf_0123456789abcdef01234567";
      const findings = Buffer.from(JSON.stringify({
        documentType: "codex-security.findings",
        schemaVersion: "1.0",
        scanId: "scan_release_closure",
        findings: [canonicalFinding(findingId)]
      }));
      const coverage = Buffer.from(JSON.stringify({
        documentType: "codex-security.coverage",
        schemaVersion: "1.0",
        scanId: "scan_release_closure",
        mode: "deep_repository",
        completeness: "complete",
        inventoryStrategy: "repository",
        includePaths: ["."],
        excludePaths: [],
        surfaces: [{ id: "surface_one", label: "one", disposition: "reported", receiptRefs: [] }],
        explicitExclusions: [],
        deferred: [],
        openQuestions: []
      }));
      await writeFile(path.join(scanDir, "findings.json"), findings);
      await writeFile(path.join(scanDir, "coverage.json"), coverage);
      await writeFile(path.join(scanDir, "report.md"), "# Security Review\n\nOne finding.\n", "utf8");
      const asIsoSecond = (milliseconds: number) => new Date(milliseconds).toISOString().replace(/\.\d{3}Z$/u, "Z");
      const now = Date.now();
      const completedAt = asIsoSecond(now - 30 * 60_000);
      const trusted = await writeTrustedGenerationAttestation(scanTargetDir, scanSource, targetReceipt, asIsoSecond(now - 90 * 60_000));
      const snapshot = trusted.snapshot;
      await writeFile(path.join(scanDir, "scan-manifest.json"), JSON.stringify({
        documentType: "codex-security.scan-manifest",
        schemaVersion: "1.0",
        scan: {
          id: "scan_release_closure",
          producer: { name: "codex-security-plugin", version: "0.1.22" },
          status: "completed",
          startedAt: asIsoSecond(now - 60 * 60_000),
          completedAt,
          sealedAt: asIsoSecond(now - 29 * 60_000),
          target: {
            kind: "directory_snapshot",
            targetId: await codexSecurityTargetId(scanTargetDir),
            displayName: "resume-ai-closure-fixture",
            snapshotDigest: snapshot.snapshotDigest
          },
          scope: { includePaths: ["."], excludePaths: [] },
          findingsRef: "findings.json",
          coverageRef: "coverage.json",
          artifacts: [
            { path: "findings.json", sha256: hash(findings), mediaType: "application/json" },
            { path: "coverage.json", sha256: hash(coverage), mediaType: "application/json" }
          ]
        }
      }), "utf8");
      await exportFixture([
        "--scan-dir", scanDir,
        "--scan-target-dir", scanTargetDir,
        "--trusted-generation-attestation", targetReceipt,
        "--trusted-generation-attestation-sha256", trusted.attestationSha256,
        "--trusted-generation-producer-sha256", trusted.producerSha256,
        "--scan-source-manifest", scanSource,
        "--evidence-dir", evidenceDir
      ], trusted);
      await mkdir(closuresDir);
      const fixBytes = Buffer.from("fix diff evidence\n");
      const verificationBytes = Buffer.from("focused verification passed\n");
      const rawReceipt = path.join(fixture, "verify-fix-result.json");
      await writeFile(rawReceipt, JSON.stringify({
        documentType: "codex-security.verify-fix-result",
        schemaVersion: "1.0",
        producer: { name: "codex-security-plugin", version: "0.1.22" },
        scanId: "scan_release_closure",
        findingId,
        status: "verified-fixed",
        sourceManifestSha256: hash(await readFile(finalSource)),
        verifiedAt: asIsoSecond(now - 10 * 60_000),
        fixEvidence: [{ sha256: hash(fixBytes), base64: fixBytes.toString("base64") }],
        verificationEvidence: [{
          sha256: hash(verificationBytes),
          base64: verificationBytes.toString("base64"),
          exitCode: 0
        }]
      }), "utf8");
      await execFileAsync(process.execPath, [
        path.join(root, "scripts/export-deep-scan-finding-closure.mjs"),
        "--raw-verification", rawReceipt,
        "--final-source-manifest", finalSource,
        "--output", path.join(closuresDir, `${findingId}.json`)
      ]);
      await execFileAsync(process.execPath, [
        path.join(root, "scripts/finalize-deep-scan-evidence.mjs"),
        "--evidence-dir", evidenceDir,
        "--final-source-manifest", finalSource,
        "--final-source-root", finalTargetDir,
        "--closures-dir", closuresDir
      ]);
      const result = JSON.parse(await readFile(path.join(evidenceDir, "security-scan-result.json"), "utf8"));
      expect(result).toMatchObject({
        status: "passed",
        scanId: "scan_release_closure",
        validatedFindingIds: [findingId],
        validatedFindingCount: 1,
        closedFindingCount: 1,
        validatedOpenFindings: 0,
        untriagedFindings: 0
      });
      expect(result.scanSourceManifestSha256).not.toBe(result.finalSourceManifestSha256);
      expect(result.scanSourceModeManifestSha256).not.toBe(result.finalSourceModeManifestSha256);
      expect(result.scanSourceModeMemberCount).toBe(1);
      expect(result.finalSourceModeMemberCount).toBe(2);
      // @ts-expect-error JavaScript evidence helper intentionally has no declaration file.
      const { validateDeepScan } = await import("../../ops/bin/verify-release-evidence.mjs");
      await expect(validateDeepScan(
        evidenceDir,
        hash(await readFile(finalSource)),
        result.finalSourceModeManifestSha256,
        result.finalSourceModeMemberCount
      )).resolves.toBeDefined();
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("rejects a Deep Scan completion that is not the exact reviewed directory snapshot", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "resume-ai-deep-binding-negative-"));
    const scanDir = path.join(fixture, "scan");
    const scanTargetDir = path.join(fixture, "scan-target");
    const evidenceDir = path.join(fixture, "evidence");
    try {
      await mkdir(scanDir);
      await mkdir(path.join(scanTargetDir, "src"), { recursive: true });
      const sourceBytes = Buffer.from("reviewed bytes\n");
      await writeFile(path.join(scanTargetDir, "src/example.ts"), sourceBytes);
      const sourceManifest = path.join(fixture, "source-manifest.txt");
      await writeFile(sourceManifest, `${hash(sourceBytes)}\tF\tsrc/example.ts\n`, "utf8");
      const targetReceipt = path.join(fixture, "trusted-generation-attestation.json");
      const findings = Buffer.from(JSON.stringify({
        documentType: "codex-security.findings", schemaVersion: "1.0", scanId: "scan_unbound", findings: []
      }));
      const coverage = Buffer.from(JSON.stringify({
        documentType: "codex-security.coverage", schemaVersion: "1.0", scanId: "scan_unbound",
        mode: "deep_repository", completeness: "complete", inventoryStrategy: "repository",
        includePaths: ["."], excludePaths: [],
        surfaces: [{ id: "surface_fixture", label: "Fixture source review", disposition: "no_issue_found", receiptRefs: [] }],
        explicitExclusions: [], deferred: [], openQuestions: []
      }));
      await writeFile(path.join(scanDir, "findings.json"), findings);
      await writeFile(path.join(scanDir, "coverage.json"), coverage);
      await writeFile(path.join(scanDir, "report.md"), "# Unbound\n", "utf8");
      const asIsoSecond = (milliseconds: number) => new Date(milliseconds).toISOString().replace(/\.\d{3}Z$/u, "Z");
      const now = Date.now();
      const trusted = await writeTrustedGenerationAttestation(scanTargetDir, sourceManifest, targetReceipt, asIsoSecond(now - 90_000));
      await writeFile(path.join(scanDir, "scan-manifest.json"), JSON.stringify({
        documentType: "codex-security.scan-manifest",
        schemaVersion: "1.0",
        scan: {
          id: "scan_unbound",
          producer: { name: "codex-security-plugin", version: "0.1.22" },
          status: "completed",
          startedAt: asIsoSecond(now - 60_000),
          completedAt: asIsoSecond(now - 30_000),
          sealedAt: asIsoSecond(now - 29_000),
          target: {
            kind: "directory_snapshot",
            targetId: await codexSecurityTargetId(scanTargetDir),
            displayName: "unbound",
            snapshotDigest: `codex-security-snapshot/v1:sha256:${"b".repeat(64)}`
          },
          scope: { includePaths: ["."], excludePaths: [] },
          findingsRef: "findings.json",
          coverageRef: "coverage.json",
          artifacts: [
            { path: "findings.json", sha256: hash(findings), mediaType: "application/json" },
            { path: "coverage.json", sha256: hash(coverage), mediaType: "application/json" }
          ]
        }
      }), "utf8");
      await expect(exportFixture([
        "--scan-dir", scanDir,
        "--scan-target-dir", scanTargetDir,
        "--trusted-generation-attestation", targetReceipt,
        "--trusted-generation-attestation-sha256", trusted.attestationSha256,
        "--trusted-generation-producer-sha256", trusted.producerSha256,
        "--scan-source-manifest", sourceManifest,
        "--evidence-dir", evidenceDir
      ], trusted)).rejects.toThrow(/not bound|snapshot/u);

      await writeFile(path.join(scanTargetDir, "src/extra.ts"), "extra\n", "utf8");
      // @ts-expect-error JavaScript evidence helper intentionally has no declaration file.
      const { inspectCodexSecurityDirectorySnapshot } = await import("../../scripts/lib/codex-security-directory-snapshot.mjs");
      await expect(inspectCodexSecurityDirectorySnapshot(scanTargetDir, await readFile(sourceManifest)))
        .rejects.toThrow(/membership differs/u);
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("matches the Codex Security 0.1.22 directory snapshot digest golden vector", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "resume-ai-deep-digest-vector-"));
    try {
      await mkdir(path.join(fixture, "a/b"), { recursive: true });
      await chmod(path.join(fixture, "a"), 0o755);
      await chmod(path.join(fixture, "a/b"), 0o750);
      const bytes = Buffer.from("vector\n");
      await writeFile(path.join(fixture, "a/b/example.txt"), bytes);
      await chmod(path.join(fixture, "a/b/example.txt"), 0o640);
      const manifest = Buffer.from(`${hash(bytes)}\tF\ta/b/example.txt\n`);
      // @ts-expect-error JavaScript evidence helper intentionally has no declaration file.
      const { inspectCodexSecurityDirectorySnapshot } = await import("../../scripts/lib/codex-security-directory-snapshot.mjs");
      const observed = await inspectCodexSecurityDirectorySnapshot(fixture, manifest);
      expect(observed.snapshotDigest).toBe(
        "codex-security-snapshot/v1:sha256:932c504935dc2784e9f12db365f27ceb33cbaf0b63d36b3240c11cbd24f5fbde"
      );
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("prepares one non-Git Deep Scan target and seals its pre-scan identity", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "resume-ai-deep-prepare-"));
    const source = path.join(fixture, "source");
    const target = path.join(fixture, "target");
    const receipt = path.join(fixture, "target-receipt.json");
    try {
      await mkdir(path.join(source, "src"), { recursive: true });
      const bytes = Buffer.from("security target\n");
      await writeFile(path.join(source, "src/example.ts"), bytes);
      await chmod(path.join(source, "src/example.ts"), 0o640);
      const manifest = path.join(fixture, "source-manifest.txt");
      await writeFile(manifest, `${hash(bytes)}\tF\tsrc/example.ts\n`, "utf8");
      await execFileAsync(process.execPath, [
        path.join(root, "scripts/prepare-deep-scan-target.mjs"),
        "--source-root", source,
        "--source-manifest", manifest,
        "--target", target,
        "--receipt", receipt
      ]);
      const sealed = JSON.parse(await readFile(receipt, "utf8"));
      expect(sealed).toMatchObject({
        schemaVersion: 1,
        evidenceType: "codex-security-directory-snapshot-preparation",
        producer: "scripts/prepare-deep-scan-target.mjs",
        sourceManifestSha256: hash(await readFile(manifest)),
        sourceMemberCount: 1,
        directoryCount: 1
      });
      expect(sealed.snapshotDigest).toMatch(/^codex-security-snapshot\/v1:sha256:[a-f0-9]{64}$/u);
      expect(await readFile(path.join(target, "src/example.ts"), "utf8")).toBe("security target\n");
      await expect(execFileAsync(process.execPath, [
        path.join(root, "scripts/prepare-deep-scan-target.mjs"),
        "--source-root", source,
        "--source-manifest", manifest,
        "--target", target,
        "--receipt", receipt
      ])).rejects.toMatchObject({ code: 1 });
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("rejects hand-written Deep Scan pass claims and detects stale HTML bytes", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "resume-ai-evidence-negative-"));
    try {
      const evidence = path.join(fixture, "evidence");
      const html = path.join(fixture, "html");
      await mkdir(evidence);
      await mkdir(html);
      const manifest = path.join(fixture, "source-manifest.txt");
      await writeFile(manifest, `${"c".repeat(64)}\tF\tsrc/example.ts\n`, "utf8");
      await writeFile(path.join(evidence, "security-scan-report.txt"), "No findings\n", "utf8");
      await writeFile(path.join(evidence, "deep-scan-export.json"), JSON.stringify({
        schemaVersion: 1,
        scanType: "codex-security-deep-scan",
        status: "passed",
        validatedOpenFindings: 0,
        untriagedFindings: 0
      }), "utf8");
      await expect(execFileAsync(process.execPath, [
        path.join(root, "scripts/finalize-deep-scan-evidence.mjs"),
        "--evidence-dir", evidence,
        "--final-source-manifest", manifest
      ])).rejects.toMatchObject({ code: 1 });

      await writeFile(path.join(html, "index.html"), "fresh\n", "utf8");
      // @ts-expect-error JavaScript evidence helper intentionally has no declaration file.
      const { htmlTreeHash } = await import("../../ops/bin/verify-release-evidence.mjs");
      const fresh = await htmlTreeHash(html);
      expect(fresh).toMatchObject({ files: 1, totalBytes: 6 });
      await writeFile(path.join(html, "index.html"), "old report mixed in\n", "utf8");
      const mixed = await htmlTreeHash(html);
      expect(mixed.sha256).not.toBe(fresh.sha256);
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === "linux")(
    "refuses to prepare final evidence through the macOS/bsdtar path",
    async () => {
      await expect(execFileAsync("/bin/bash", [
        path.join(root, "ops/bin/prepare-release-bundle.sh"), root, path.join(root, "artifacts/releases")
      ])).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining("reviewed Jammy builder")
      });
    }
  );

  it("re-verifies exact source archive membership, modes and baseline boundary", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "resume-ai-bundle-semantics-"));
    const source = path.join(fixture, "source");
    const bundle = path.join(fixture, "bundle");
    try {
      await mkdir(path.join(source, "src"), { recursive: true });
      await mkdir(path.join(bundle, "baseline"), { recursive: true });
      const sourceBytes = Buffer.from("export const release = true;\n");
      await writeFile(path.join(source, "src/example.ts"), sourceBytes);
      await chmod(path.join(source, "src/example.ts"), 0o644);
      const sourceArchive = path.join(bundle, "source.tar.gz");
      await execFileAsync("/usr/bin/tar", [
        "-czf", sourceArchive, "-C", source, "src/example.ts"
      ], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
      await copyFile(sourceArchive, path.join(bundle, "untracked-source.tar.gz"));
      const sourceManifest = Buffer.from(`${hash(sourceBytes)}\tF\tsrc/example.ts\n`);
      await writeFile(path.join(bundle, "source-manifest.txt"), sourceManifest);
      await writeFile(path.join(bundle, "untracked-source-paths.txt"), "src/example.ts\n", "utf8");
      const releaseId = "20260827T010203Z";
      const sourceSha256 = hash(await readFile(sourceArchive));
      const baseline = Buffer.from(`${JSON.stringify({
        provenance: { releaseId, sourceArchiveSha256: sourceSha256 }
      })}\n`);
      await writeFile(path.join(bundle, "baseline/competition-score-prospective-baseline.json"), baseline);
      const modeBytes = Buffer.from("0644\tsrc/example.ts\n");
      const releaseManifest = {
        releaseId,
        sourceSha256,
        sourceManifestSha256: hash(sourceManifest),
        sourceMembership: "git-ls-files-cached-and-nonignored-untracked",
        emptyDirectoriesIncluded: false,
        sourceModeManifest: {
          encoding: "base64",
          sha256: hash(modeBytes),
          memberCount: 1,
          data: modeBytes.toString("base64")
        },
        prospectiveBaseline: {
          outerIntegrityBoundary: "release-manifest.json",
          byteSha256: hash(baseline),
          artifactSha256: undefined,
          mode: "bootstrap",
          originReleaseId: releaseId,
          originSourceArchiveSha256: sourceSha256
        }
      };
      const releaseManifestPath = path.join(bundle, "release-manifest.json");
      await writeFile(releaseManifestPath, `${JSON.stringify(releaseManifest)}\n`, "utf8");
      // @ts-expect-error JavaScript evidence helper intentionally has no declaration file.
      const { validateBundleSource } = await import("../../ops/bin/verify-release-evidence.mjs");
      expect(() => validateBundleSource(bundle)).not.toThrow();

      const wrongMode = Buffer.from("0600\tsrc/example.ts\n");
      releaseManifest.sourceModeManifest = {
        encoding: "base64",
        sha256: hash(wrongMode),
        memberCount: 1,
        data: wrongMode.toString("base64")
      };
      await writeFile(releaseManifestPath, `${JSON.stringify(releaseManifest)}\n`, "utf8");
      expect(() => validateBundleSource(bundle)).toThrow(/source archive kind or mode differs/u);
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });
});
