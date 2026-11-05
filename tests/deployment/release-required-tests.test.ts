import { createHash, generateKeyPairSync, randomUUID, sign as signBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, open, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

// @ts-expect-error The installed release coordinator is intentionally plain JavaScript.
import { CapturedOutputLimitError, evaluateRequiredTestReports, hashOrdinaryFile, parseProjectToolchainPolicy, parseRequiredTestManifest, resolveContainedDependencySymlink, spawnCaptured, validateDedicatedAccountRecords, validateReadOnlyTreeMemberMetadata, writeEvidenceFailure } from "../../scripts/run-release-evidence.mjs";
// @ts-expect-error The installed release verifier is intentionally plain JavaScript.
import { parseRequiredTestManifest as parseVerifiedRequiredTestManifest, validateCommand, validateDependencyProvenanceEvidence, validateLinuxGenerationAttestation } from "../../ops/bin/verify-release-evidence.mjs";

const root = process.cwd();
const manifestPath = path.join(root, "ops/config/release-required-tests.json");
const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

type RequiredTestRequirement = {
  id: string;
  categories: string[];
  framework: "vitest" | "playwright";
  report: "vitest-unit" | "vitest-postgres" | "playwright-production";
  testFile: string;
  fullName: string;
  project: "unit" | "postgres-integration" | "desktop" | "mobile";
  minimumPassed: number;
};
type RequiredContract = {
  minimumPassedObservations: number;
  projectToolchain: ProjectToolchainPolicy;
  pins: Map<string, string>;
  requirements: RequiredTestRequirement[];
};
type ProjectToolchainPolicy = {
  policyId: string;
  sha256: string;
  inputs: Array<{ path: string; sha256: string }>;
  tools: Array<{ id: string; packageName: string; packagePath: string; version: string; binName: string; binTarget: string }>;
};
type DedicatedAccountRecord = {
  account: string;
  uidText: string;
  gidText: string;
  groupName: string;
  groupIds: string;
  passwdLine: string;
  groupLine: string;
};
type ReportArtifact = { bytes: Buffer; sha256: string };

function artifact(value: unknown): ReportArtifact {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
  return { bytes, sha256: sha256(bytes) };
}

async function loadContract() {
  const bytes = await readFile(manifestPath);
  const value = JSON.parse(bytes.toString("utf8")) as {
    projectToolchain: ProjectToolchainPolicy;
    sourcePins: Array<{ path: string; sha256: string }>;
  };
  const sourcePaths = [...new Set([
    ...value.sourcePins.map((pin) => pin.path),
    ...value.projectToolchain.inputs.map((input) => input.path)
  ])];
  const sourceEntries = await Promise.all(sourcePaths.map(async (relative) => ({
    relative,
    sha256: sha256(await readFile(path.join(root, relative)))
  })));
  return {
    bytes,
    value,
    sourceEntries,
    contract: parseRequiredTestManifest(bytes, sourceEntries) as RequiredContract
  };
}

function passingReports(contract: RequiredContract) {
  const vitest = (label: "vitest-unit" | "vitest-postgres") => {
    const requirements = contract.requirements.filter((requirement) => requirement.report === label);
    const grouped = new Map<string, typeof requirements>();
    for (const requirement of requirements) {
      const existing = grouped.get(requirement.testFile) ?? [];
      existing.push(requirement);
      grouped.set(requirement.testFile, existing);
    }
    return artifact({
      success: true,
      numPassedTests: requirements.length,
      numFailedTests: 0,
      testResults: [...grouped].map(([testFile, entries]) => ({
        name: path.join(root, testFile),
        assertionResults: entries.map((entry) => ({ fullName: entry.fullName, status: "passed" }))
      }))
    });
  };
  const playwrightRequirements = contract.requirements.filter((requirement) => requirement.report === "playwright-production");
  const grouped = new Map<string, typeof playwrightRequirements>();
  for (const requirement of playwrightRequirements) {
    const key = `${requirement.testFile}\0${requirement.fullName}`;
    const existing = grouped.get(key) ?? [];
    existing.push(requirement);
    grouped.set(key, existing);
  }
  const playwright = artifact({
    config: { projects: [{ name: "desktop" }, { name: "mobile" }] },
    stats: { expected: playwrightRequirements.length, unexpected: 0 },
    suites: [{
      specs: [...grouped].map(([, entries]) => ({
        file: path.join(root, entries[0].testFile),
        title: entries[0].fullName,
        tests: entries.map((entry) => ({ projectName: entry.project, results: [{ status: "passed" }] }))
      }))
    }]
  });
  return {
    "vitest-unit": vitest("vitest-unit"),
    "vitest-postgres": vitest("vitest-postgres"),
    "playwright-production": playwright
  };
}

async function dependencyProvenanceFixture(contract: RequiredContract, ambientInputUsed = false) {
  const evidenceDir = await mkdtemp(path.join(tmpdir(), "resume-ai-dependency-provenance-"));
  const logs = path.join(evidenceDir, "validation-logs");
  await mkdir(logs);
  const at = (secondsAgo: number) => new Date(Date.now() - secondsAgo * 1000)
    .toISOString().replace(/\.\d{3}Z$/u, "Z");
  const runId = "123e4567-e89b-42d3-a456-426614174000";
  const sourceManifestSha256 = "1".repeat(64);
  const sourceModeManifestSha256 = "2".repeat(64);
  const sourceModeMemberCount = 100;
  const runtime = { node: "3".repeat(64), pnpm: "4".repeat(64) };
  const observedTools = contract.projectToolchain.tools.map((tool) => {
    const slug = tool.packageName.replace("@", "").replace("/", "+");
    const packageRealPath = `.pnpm/${slug}@${tool.version}/node_modules/${tool.packageName}`;
    return {
      ...tool,
      packageRealPath,
      packageJsonSha256: sha256(`package:${tool.id}`),
      binRelativePath: `${packageRealPath}/${tool.binTarget}`,
      binSha256: sha256(`bin:${tool.id}`)
    };
  });
  const logsByGate = {
    "dependency-fetch": Buffer.from("fetch passed\n"),
    "dependency-offline-install": Buffer.from("offline install passed\n"),
    "playwright-browser-fetch": Buffer.from("browser fetch passed\n")
  };
  const commands = {
    "dependency-fetch": { executable: "/opt/nodejs/node-v24.20.0-linux-x64/bin/node", argv: ["fetch"] },
    "dependency-offline-install": { executable: "/opt/nodejs/node-v24.20.0-linux-x64/bin/node", argv: ["install", "--offline"] },
    "playwright-browser-fetch": {
      executable: "/opt/nodejs/node-v24.20.0-linux-x64/bin/node",
      argv: ["<frozen-node_modules>/playwright/cli.js", "install", "chromium"],
      executableSha256: observedTools.find((tool) => tool.id === "playwright")?.binSha256
    }
  };
  type FixtureGate = {
    name: string;
    command: { executable: string; argv: string[]; executableSha256?: string };
    startedAt: string;
    completedAt: string;
    rawLog: string;
    rawLogSha256: string;
    receipt?: string;
    receiptSha256?: string;
  };
  const gates = new Map<string, FixtureGate>(Object.entries(logsByGate).map(([name, bytes], index) => {
    const rawLog = `validation-logs/${name}.log`;
    return [name, {
      name,
      command: commands[name as keyof typeof commands],
      startedAt: at(300 - index * 60),
      completedAt: at(260 - index * 60),
      rawLog,
      rawLogSha256: sha256(bytes)
    }];
  }));
  await Promise.all(Object.entries(logsByGate).map(([name, bytes]) => writeFile(
    path.join(logs, `${name}.log`),
    bytes
  )));
  const requiredManifestBytes = await readFile(manifestPath);
  const policyArtifact = { sha256: sha256(requiredManifestBytes) };
  const receipt = {
    schemaVersion: 1,
    evidenceType: "release-dependency-provenance",
    status: "passed",
    runId,
    createdAt: at(100),
    sourceManifestSha256,
    sourceModeManifestSha256,
    sourceModeMemberCount,
    inputs: contract.projectToolchain.inputs,
    toolchain: {
      node: { path: "/opt/nodejs/node-v24.20.0-linux-x64/bin/node", version: "v24.20.0", sha256: runtime.node },
      pnpm: { path: "/opt/nodejs/node-v24.20.0-linux-x64/lib/runtime-tools/node_modules/pnpm/bin/pnpm.mjs", version: "11.19.0", sha256: runtime.pnpm }
    },
    networkPolicy: {
      dependencyRegistry: "https://registry.npmjs.org/",
      browserDownloadHosts: ["cdn.playwright.dev", "playwright.download.prss.microsoft.com"]
    },
    projectToolchainPolicy: {
      installedPath: "/usr/local/lib/resume-ai/release-required-tests.json",
      sourceMember: "ops/config/release-required-tests.json",
      artifactSha256: policyArtifact.sha256,
      jsonPointer: "/projectToolchain",
      policyId: contract.projectToolchain.policyId,
      sha256: contract.projectToolchain.sha256
    },
    observedTools,
    dependencyFetch: {
      command: gates.get("dependency-fetch")?.command,
      rawLog: gates.get("dependency-fetch")?.rawLog,
      rawLogSha256: gates.get("dependency-fetch")?.rawLogSha256
    },
    offlineInstall: {
      command: gates.get("dependency-offline-install")?.command,
      privateNetwork: true,
      packageImportMethod: "copy",
      rawLog: gates.get("dependency-offline-install")?.rawLog,
      rawLogSha256: gates.get("dependency-offline-install")?.rawLogSha256
    },
    nodeModules: {
      manifestSha256: "5".repeat(64), members: 1000, totalBytes: 1_000_000,
      symlinks: 10, owner: "root", ambientInputUsed
    },
    browserFetch: {
      command: gates.get("playwright-browser-fetch")?.command,
      playwrightCliSha256: observedTools.find((tool) => tool.id === "playwright")?.binSha256,
      rawLog: gates.get("playwright-browser-fetch")?.rawLog,
      rawLogSha256: gates.get("playwright-browser-fetch")?.rawLogSha256
    },
    browsers: {
      relativePath: "node_modules/.release-evidence-playwright-browsers",
      manifestSha256: "6".repeat(64), members: 100, totalBytes: 1_000_000,
      symlinks: 1, owner: "root", ambientInputUsed: false
    }
  };
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
  const receiptSha256 = sha256(receiptBytes);
  await writeFile(path.join(evidenceDir, "dependency-provenance-receipt.json"), receiptBytes);
  const provenanceLog = Buffer.from(`${JSON.stringify({
    event: "release_dependency_provenance",
    status: "passed",
    receiptSha256,
    nodeModulesManifestSha256: receipt.nodeModules.manifestSha256,
    browserManifestSha256: receipt.browsers.manifestSha256,
    ambientInputUsed: false
  })}\n`);
  await writeFile(path.join(logs, "dependency-provenance.log"), provenanceLog);
  gates.set("dependency-provenance", {
    name: "dependency-provenance",
    command: { executable: "/usr/local/lib/resume-ai/run-release-evidence.mjs", argv: ["verify-fresh-dependency-generation"] },
    startedAt: gates.get("dependency-fetch")!.startedAt,
    completedAt: at(90),
    rawLog: "validation-logs/dependency-provenance.log",
    rawLogSha256: sha256(provenanceLog),
    receipt: "dependency-provenance-receipt.json",
    receiptSha256
  });
  const validation = {
    runId,
    toolchain: {
      node: { sha256: runtime.node },
      pnpm: { sha256: runtime.pnpm }
    },
    dependencyProvenance: {
      receipt: "dependency-provenance-receipt.json",
      receiptSha256,
      projectToolchainPolicySha256: contract.projectToolchain.sha256,
      observedTools,
      nodeModulesManifestSha256: receipt.nodeModules.manifestSha256,
      browserManifestSha256: receipt.browsers.manifestSha256,
      ambientInputUsed: false
    }
  };
  return {
    evidenceDir,
    input: {
      evidenceDir,
      validation,
      gates,
      policy: contract.projectToolchain,
      policyArtifact,
      sourceManifestSha256,
      sourceModeManifestSha256,
      sourceModeMemberCount
    }
  };
}

function accountRecord(overrides: Partial<DedicatedAccountRecord> = {}): DedicatedAccountRecord {
  return {
    account: "resume-ai-build",
    uidText: "1001",
    gidText: "1001",
    groupName: "resume-ai-build",
    groupIds: "1001",
    passwdLine: "resume-ai-build:x:1001:1001::/nonexistent:/usr/sbin/nologin",
    groupLine: "resume-ai-build:x:1001:",
    ...overrides
  };
}

describe("fixed release required-test contract", () => {
  it("loads policy only from the fixed installed root path and binds it to one source-manifest row", async () => {
    const coordinator = await readFile(path.join(root, "scripts/run-release-evidence.mjs"), "utf8");
    const verifier = await readFile(path.join(root, "ops/bin/verify-release-evidence.mjs"), "utf8");
    const policySha256 = sha256(await readFile(manifestPath));
    expect(coordinator).toContain('const REQUIRED_TESTS_PATH = "/usr/local/lib/resume-ai/release-required-tests.json";');
    expect(coordinator).toContain('const REQUIRED_TESTS_MEMBER = "ops/config/release-required-tests.json";');
    expect(coordinator).toContain(`const REQUIRED_TEST_POLICY_SHA256 = "${policySha256}";`);
    expect(verifier).toContain(`const REQUIRED_TEST_POLICY_SHA256 = "${policySha256}";`);
    expect(coordinator).toContain("verifyInstalledControlFile(REQUIRED_TESTS_PATH, REQUIRED_TESTS_MEMBER, sourceState)");
    expect(coordinator).toContain('request.href !== "https://www.siyuanjiaxin.com/release-evidence-probe"');
    expect(coordinator).toContain('name: "dependency-fetch"');
    expect(coordinator).toContain('name: "dependency-offline-install"');
    expect(coordinator).toContain('"--ignore-pnpmfile"');
    expect(coordinator).toContain('"--package-import-method=copy"');
    expect(coordinator).toContain('const virtualStore = path.join(modulesTarget, ".pnpm");');
    expect(coordinator).not.toContain('const virtualStore = path.join(modules, ".pnpm");');
    expect(coordinator).toContain('ambientInputUsed: false');
    expect(coordinator).toContain('projectTool: toolId');
    expect(coordinator).not.toContain('"/root/.cache/ms-playwright"');
    expect(coordinator).not.toContain('path.join(sourceRoot, "node_modules")');
    expect(coordinator).not.toContain('["exec", "vitest"');
  });

  it("pins exact dependency inputs and direct package/bin identities against npm alias substitution", async () => {
    const { contract, value, sourceEntries } = await loadContract();
    expect(contract.projectToolchain.policyId).toBe("resume-ai-project-toolchain.v1");
    expect(contract.projectToolchain.inputs.map((input) => input.path)).toEqual([
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml"
    ]);
    expect(contract.projectToolchain.tools.map((tool) => [tool.id, tool.packageName, tool.version, tool.binName, tool.binTarget])).toEqual([
      ["eslint", "eslint", "8.57.1", "eslint", "bin/eslint.js"],
      ["next", "next", "15.5.24", "next", "dist/bin/next"],
      ["playwright", "playwright", "1.60.0", "playwright", "cli.js"],
      ["playwright-test", "@playwright/test", "1.60.0", "playwright", "cli.js"],
      ["typescript", "typescript", "5.7.2", "tsc", "bin/tsc"],
      ["vitest", "vitest", "3.2.6", "vitest", "vitest.mjs"]
    ]);

    const maliciousPackage = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
    maliciousPackage.devDependencies.vitest = "npm:@attacker/fake-vitest@1.0.0";
    const maliciousSha = sha256(Buffer.from(`${JSON.stringify(maliciousPackage, null, 2)}\n`));
    const substitutedSources = sourceEntries.map((entry) => entry.relative === "package.json"
      ? { ...entry, sha256: maliciousSha }
      : entry);
    expect(() => parseProjectToolchainPolicy(value.projectToolchain, substitutedSources))
      .toThrow(/project-toolchain input differs/u);
  });

  it("pins every selected source and covers the complete fixed release matrix", async () => {
    const { bytes, contract, sourceEntries, value } = await loadContract();
    const verifiedContract = parseVerifiedRequiredTestManifest(
      bytes,
      new Map(sourceEntries.map((entry) => [
        entry.relative,
        { kind: "F", digest: entry.sha256 }
      ]))
    ) as RequiredContract;
    expect(contract.minimumPassedObservations).toBe(19);
    expect(contract.requirements).toHaveLength(19);
    expect(verifiedContract.minimumPassedObservations).toBe(19);
    expect(verifiedContract.requirements.map(({ id }) => id))
      .toEqual(contract.requirements.map(({ id }) => id));
    expect([...contract.pins]).toEqual(value.sourcePins.map((pin) => [pin.path, pin.sha256]));
    expect(new Set(contract.requirements.flatMap((requirement) => requirement.categories))).toEqual(new Set([
      "followups-0",
      "followups-1",
      "followups-2",
      "followups-3",
      "pure-text-max-10",
      "shared-nat-50",
      "threshold-429-recovery",
      "token-forgery",
      "token-expiry",
      "token-replay",
      "token-cross-session",
      "queue-full-fallback",
      "quota-config-consistency",
      "desktop-e2e",
      "mobile-e2e"
    ]));
  });

  it("accepts only exact passing observations from all three machine reports", async () => {
    const { contract } = await loadContract();
    const reports = passingReports(contract);
    const result = evaluateRequiredTestReports(contract, reports, root);
    expect(result.minimumPassedObservations).toBe(19);
    expect(result.passedObservations).toBe(19);
    expect(result.verified).toHaveLength(19);
    expect(result.reportSha256).toEqual({
      "vitest-unit": reports["vitest-unit"].sha256,
      "vitest-postgres": reports["vitest-postgres"].sha256,
      "playwright-production": reports["playwright-production"].sha256
    });
  });

  it("fails closed when a pinned test is changed into a trivial substitute", async () => {
    const { bytes, sourceEntries } = await loadContract();
    const changed = sourceEntries.map((entry, index) => index === 0 ? { ...entry, sha256: "0".repeat(64) } : entry);
    expect(() => parseRequiredTestManifest(bytes, changed)).toThrow(/differs from reviewed source manifest/u);
  });

  it("makes both authorities reject a self-consistent policy mapping rewrite", async () => {
    const { value, sourceEntries } = await loadContract();
    const rewritten = structuredClone(value) as typeof value & {
      requirements: Array<{ fullName: string }>;
    };
    rewritten.requirements[0]!.fullName = `${rewritten.requirements[0]!.fullName} rewritten`;
    const rewrittenBytes = Buffer.from(`${JSON.stringify(rewritten, null, 2)}\n`);
    const sourceRows = new Map(sourceEntries.map((entry) => [
      entry.relative,
      { kind: "F", digest: entry.sha256 }
    ]));

    expect(() => parseRequiredTestManifest(rewrittenBytes, sourceEntries))
      .toThrow(/whole-policy SHA-256 differs/u);
    expect(() => parseVerifiedRequiredTestManifest(rewrittenBytes, sourceRows))
      .toThrow(/whole-policy SHA-256 differs/u);
  });

  it("rejects missing, renamed, skipped, and incomplete required observations", async () => {
    const { contract } = await loadContract();
    const base = passingReports(contract);
    const unit = JSON.parse(base["vitest-unit"].bytes.toString("utf8"));
    unit.testResults[0].assertionResults[0].status = "skipped";
    expect(() => evaluateRequiredTestReports(contract, { ...base, "vitest-unit": artifact(unit) }, root)).toThrow(/missing, skipped, renamed, or failed/u);

    const playwright = JSON.parse(base["playwright-production"].bytes.toString("utf8"));
    playwright.suites[0].specs[0].title = `${playwright.suites[0].specs[0].title} renamed`;
    expect(() => evaluateRequiredTestReports(contract, { ...base, "playwright-production": artifact(playwright) }, root)).toThrow(/missing, skipped, renamed, or failed/u);

    const { "vitest-postgres": _missing, ...incomplete } = base;
    expect(() => evaluateRequiredTestReports(contract, incomplete, root)).toThrow(/incomplete or unexpected/u);
  });
});

describe("independent dependency-provenance verifier", () => {
  it("reproduces the coordinator receipt and rejects ambient dependency input", async () => {
    const { contract } = await loadContract();
    const valid = await dependencyProvenanceFixture(contract);
    const invalid = await dependencyProvenanceFixture(contract, true);
    try {
      await expect(validateDependencyProvenanceEvidence(valid.input)).resolves.toBeDefined();
      await expect(validateDependencyProvenanceEvidence(invalid.input))
        .rejects.toThrow(/node_modules frozen-tree provenance differs/u);
    } finally {
      await Promise.all([
        rm(valid.evidenceDir, { recursive: true, force: true }),
        rm(invalid.evidenceDir, { recursive: true, force: true })
      ]);
    }
  });

  it("accepts only the frozen Playwright path and run-bound project-tool output", async () => {
    const { contract } = await loadContract();
    const runId = "123e4567-e89b-42d3-a456-426614174000";
    const observedById = new Map(contract.projectToolchain.tools.map((tool) => {
      const slug = tool.packageName.replace("@", "").replace("/", "+");
      const packageRealPath = `.pnpm/${slug}@${tool.version}/node_modules/${tool.packageName}`;
      return [tool.id, {
        binRelativePath: `${packageRealPath}/${tool.binTarget}`,
        binSha256: sha256(`bin:${tool.id}`)
      }];
    }));
    const execution = {
      launcher: "/usr/bin/systemd-run",
      unit: `resume-ai-evidence-browser-fetch-${runId.slice(-12)}.service`,
      uid: "resume-ai-build",
      environment: "env-i",
      sourceReadOnly: true,
      privateNetwork: false,
      ipAddressDeny: "any",
      credentialTransport: "none",
      repositoryVerifier: null
    };
    const browser = {
      name: "playwright-browser-fetch",
      command: {
        executable: "/opt/nodejs/node-v24.20.0-linux-x64/bin/node",
        argv: ["<frozen-node_modules>/playwright/cli.js", "install", "chromium"],
        executableSha256: observedById.get("playwright")?.binSha256
      },
      execution
    };
    expect(() => validateCommand(browser, {}, { observedById }, runId)).not.toThrow();
    expect(() => validateCommand({
      ...browser,
      command: { ...browser.command, argv: ["<frozen-node_modules>/.pnpm/playwright/cli.js", "install", "chromium"] }
    }, {}, { observedById }, runId)).toThrow(/Playwright browser command differs/u);

    const vitest = observedById.get("vitest");
    const unit = {
      name: "unit",
      command: {
        executable: "/opt/nodejs/node-v24.20.0-linux-x64/bin/node",
        argv: [
          `<frozen-node_modules>/${vitest?.binRelativePath}`,
          "run",
          "--reporter=json",
          `--outputFile=/opt/resume-ai/build-staging/release-evidence-${runId}/writable/vitest-unit-result.json`
        ],
        projectTool: "vitest",
        executableSha256: vitest?.binSha256
      },
      execution: { ...execution, unit: `resume-ai-evidence-unit-${runId.slice(-12)}.service`, privateNetwork: true, ipAddressDeny: null }
    };
    expect(() => validateCommand(unit, {}, { observedById }, runId)).not.toThrow();
    expect(() => validateCommand(unit, {}, { observedById }, "223e4567-e89b-42d3-a456-426614174000"))
      .toThrow(/unit command drift/u);
  });
});

describe("signed Linux validation generation", () => {
  it("verifies the fixed Ed25519 trust boundary and detects a rewritten gate log", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "resume-ai-linux-generation-"));
    const evidenceDir = path.join(fixture, "evidence");
    const publicKeyPath = path.join(fixture, "release-evidence-signing.pub");
    const runId = "123e4567-e89b-42d3-a456-426614174000";
    const sourceManifestSha256 = "1".repeat(64);
    const sourceModeManifestSha256 = "2".repeat(64);
    const coordinatorSha256 = "3".repeat(64);
    const gateNames = [
      "dependency-fetch", "dependency-offline-install", "playwright-browser-fetch",
      "dependency-provenance", "typecheck", "lint", "unit", "production-build",
      "production-dependency-audit", "postgres-integration", "deepseek-preflight",
      "production-e2e", "required-tests"
    ];
    const topLevel = [
      "dependency-provenance-receipt.json", "e2e-result.json", "playwright-report.json",
      "pnpm-audit-result.json", "release-required-tests.json", "required-test-receipt.json",
      "validation-result.json", "vitest-postgres-result.json", "vitest-unit-result.json"
    ];
    try {
      await mkdir(path.join(evidenceDir, "validation-logs"), { recursive: true });
      await mkdir(path.join(evidenceDir, "playwright-report"));
      for (const relative of topLevel) await writeFile(path.join(evidenceDir, relative), `${relative}\n`);
      for (const gate of gateNames) await writeFile(path.join(evidenceDir, "validation-logs", `${gate}.log`), `${gate}\n`);
      await writeFile(path.join(evidenceDir, "playwright-report/index.html"), "<!doctype html>\n");

      const signedPaths = [
        ...topLevel,
        ...gateNames.map((gate) => `validation-logs/${gate}.log`),
        "playwright-report/index.html"
      ].sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
      let totalBytes = 0;
      const manifestRows = [];
      for (const relative of signedPaths) {
        const bytes = await readFile(path.join(evidenceDir, relative));
        totalBytes += bytes.length;
        manifestRows.push(`${sha256(bytes)}\t${bytes.length}\t${relative}\n`);
      }
      const manifestBytes = Buffer.from(manifestRows.join(""));
      await writeFile(path.join(evidenceDir, "linux-validation-artifact-manifest.txt"), manifestBytes);
      const { privateKey, publicKey } = generateKeyPairSync("ed25519", {
        privateKeyEncoding: { format: "pem", type: "pkcs8" },
        publicKeyEncoding: { format: "pem", type: "spki" }
      });
      const publicKeyBytes = Buffer.from(publicKey);
      await writeFile(publicKeyPath, publicKeyBytes);
      const completedAt = new Date(Date.now() - 120_000).toISOString().replace(/\.\d{3}Z$/u, "Z");
      const createdAt = new Date(Date.now() - 60_000).toISOString().replace(/\.\d{3}Z$/u, "Z");
      const payload = {
        schemaVersion: 1,
        evidenceType: "resume-ai-linux-validation-generation-payload",
        status: "sealed",
        runId,
        generationRoot: `/var/lib/resume-ai/release-evidence-generations/generation-${runId}`,
        createdAt,
        sourceManifestSha256,
        sourceModeManifestSha256,
        sourceModeMemberCount: 100,
        producer: { path: "/usr/local/lib/resume-ai/run-release-evidence.mjs", sha256: coordinatorSha256 },
        artifactManifest: {
          artifact: "linux-validation-artifact-manifest.txt",
          algorithm: "sha256-bytes-path.v1",
          sha256: sha256(manifestBytes),
          memberCount: signedPaths.length,
          totalBytes
        }
      };
      const payloadBytes = Buffer.from(`${JSON.stringify(payload)}\n`);
      const signature = signBytes(null, payloadBytes, privateKey);
      await writeFile(path.join(evidenceDir, "linux-validation-attestation.json"), `${JSON.stringify({
        schemaVersion: 1,
        evidenceType: "resume-ai-linux-validation-generation.v1",
        algorithm: "Ed25519",
        publicKey: {
          path: "/etc/resume-ai/release-evidence-signing.pub",
          sha256: sha256(publicKeyBytes)
        },
        payloadEncoding: "base64",
        payloadSha256: sha256(payloadBytes),
        payloadBase64: payloadBytes.toString("base64"),
        signatureBase64: signature.toString("base64")
      }, null, 2)}\n`);
      const input = {
        evidenceDir,
        validation: { runId, completedAt },
        sourceManifestSha256,
        sourceModeManifestSha256,
        sourceModeMemberCount: 100,
        coordinatorSha256,
        publicKeyPath,
        enforceRootPublicKey: false
      };
      await expect(validateLinuxGenerationAttestation(input)).resolves.toBeDefined();
      await writeFile(path.join(evidenceDir, "validation-logs/unit.log"), "rewritten unit log\n");
      await expect(validateLinuxGenerationAttestation(input))
        .rejects.toThrow(/signed artifact differs: validation-logs\/unit\.log/u);
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });
});

describe("release coordinator bounded output capture", () => {
  it.each([
    ["stdout", "process.stdout.write(Buffer.alloc(2 * 1024 * 1024))", 4096, 4096, 6144],
    ["stderr", "process.stderr.write(Buffer.alloc(2 * 1024 * 1024))", 4096, 4096, 6144],
    ["total", "process.stdout.write(Buffer.alloc(3072)); process.stderr.write(Buffer.alloc(3072))", 4096, 4096, 4096]
  ])("terminates a child that exceeds the %s hard limit", async (_label, program, stdoutLimitBytes, stderrLimitBytes, totalLimitBytes) => {
    const started = Date.now();
    let caught: unknown;
    try {
      await spawnCaptured(process.execPath, ["-e", program], {
        stdoutLimitBytes,
        stderrLimitBytes,
        totalLimitBytes
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CapturedOutputLimitError);
    const limited = caught as InstanceType<typeof CapturedOutputLimitError>;
    expect(limited.code).toBe("CAPTURE_LIMIT_EXCEEDED");
    expect(limited.capturedBytes.stdout).toBeLessThanOrEqual(stdoutLimitBytes);
    expect(limited.capturedBytes.stderr).toBeLessThanOrEqual(stderrLimitBytes);
    expect(limited.capturedBytes.total).toBeLessThanOrEqual(totalLimitBytes);
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  const canRunSystemdProbe = process.platform === "linux"
    && process.getuid?.() === 0
    && existsSync("/run/systemd/system")
    && existsSync("/usr/bin/systemd-run")
    && existsSync("/usr/bin/systemctl");

  it.runIf(canRunSystemdProbe)("kills the complete transient service after malicious output overflow", async () => {
    const unit = `resume-ai-evidence-output-test-${randomUUID().replaceAll("-", "").slice(0, 12)}.service`;
    const program = "import os,time\nwhile True:\n os.write(1, b'x' * 65536)\n time.sleep(0.001)";
    await expect(spawnCaptured("/usr/bin/systemd-run", [
      "--quiet",
      "--wait",
      "--collect",
      "--pipe",
      "--service-type=exec",
      `--unit=${unit}`,
      "/usr/bin/python3",
      "-c",
      program
    ], {
      unit,
      stdoutLimitBytes: 8192,
      stderrLimitBytes: 8192,
      totalLimitBytes: 12288
    })).rejects.toBeInstanceOf(CapturedOutputLimitError);
    const active = await spawnCaptured("/usr/bin/systemctl", ["is-active", unit]);
    expect(active.exitCode).not.toBe(0);
  }, 20_000);

  it("rejects an oversized candidate artifact from metadata before reading it into root memory", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "resume-ai-evidence-size-"));
    const filename = path.join(fixture, "oversized-machine-report.json");
    try {
      const handle = await open(filename, "wx", 0o600);
      await handle.truncate(1025);
      await handle.close();
      await expect(hashOrdinaryFile(filename, { maxBytes: 1024, label: "test machine report" }))
        .rejects.toThrow(/exceeds 1024 bytes/u);
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("persists the hard-limit failure marker used by the formal coordinator", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "resume-ai-evidence-failed-"));
    try {
      let caught: unknown;
      try {
        await spawnCaptured(process.execPath, ["-e", "process.stdout.write(Buffer.alloc(65536))"], {
          stdoutLimitBytes: 1024,
          stderrLimitBytes: 1024,
          totalLimitBytes: 1536
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(CapturedOutputLimitError);
      await writeEvidenceFailure(fixture, caught);
      expect(await readFile(path.join(fixture, "EVIDENCE_FAILED"), "utf8"))
        .toMatch(/^captured output limit exceeded/u);
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });
});

describe("release coordinator dedicated service identities", () => {
  it("accepts only one same-name primary group and a non-login account", () => {
    expect(validateDedicatedAccountRecords(accountRecord())).toEqual({
      account: "resume-ai-build",
      uid: 1001,
      gid: 1001
    });
  });

  it.each([
    ["supplementary group", { groupIds: "1001 27" }],
    ["different primary group name", { groupName: "builders" }],
    ["explicit group member", { groupLine: "resume-ai-build:x:1001:unexpected" }],
    ["login shell", { passwdLine: "resume-ai-build:x:1001:1001::/home/resume-ai-build:/bin/bash" }]
  ])("rejects a %s", (_label, overrides) => {
    expect(() => validateDedicatedAccountRecords(accountRecord(overrides))).toThrow(/no supplementary groups/u);
  });
});

describe("read-only dependency symlink validation", () => {
  it.runIf(process.platform !== "win32")("accepts owner-controlled 0777 symlink metadata but rejects escape and writable ordinary members", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "resume-ai-dependency-link-"));
    const source = path.join(fixture, "source");
    try {
      await mkdir(path.join(source, "nested"), { recursive: true });
      const target = path.join(source, "nested/target.js");
      await writeFile(target, "export default true;\n", { mode: 0o444 });
      const contained = path.join(source, "contained-link");
      await symlink("nested/target.js", contained);
      const linkMetadata = await lstat(contained);
      expect(() => validateReadOnlyTreeMemberMetadata({
        uid: linkMetadata.uid,
        mode: 0o120777,
        isSymbolicLink: () => true
      }, "contained-link", linkMetadata.uid)).not.toThrow();
      await expect(resolveContainedDependencySymlink(contained, await realpath(source), "contained-link"))
        .resolves.toMatchObject({ target: "nested/target.js", resolved: await realpath(target) });

      const outside = path.join(fixture, "outside.js");
      await writeFile(outside, "outside\n", { mode: 0o444 });
      const escaped = path.join(source, "escaped-link");
      await symlink("../outside.js", escaped);
      await expect(resolveContainedDependencySymlink(escaped, await realpath(source), "escaped-link"))
        .rejects.toThrow(/escapes its tree/u);

      const absolute = path.join(source, "absolute-link");
      await symlink(target, absolute);
      await expect(resolveContainedDependencySymlink(absolute, await realpath(source), "absolute-link"))
        .rejects.toThrow(/absolute or non-canonical dependency symlink/u);

      const writable = path.join(source, "writable.js");
      await writeFile(writable, "writable\n", { mode: 0o600 });
      await chmod(writable, 0o666);
      const writableMetadata = await lstat(writable);
      expect(() => validateReadOnlyTreeMemberMetadata(writableMetadata, "writable.js", writableMetadata.uid))
        .toThrow(/owner-frozen/u);
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it.runIf(process.platform !== "win32")("keeps pnpm-style links inside a relocated copied tree and can execute its CLI", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "resume-ai-pnpm-link-copy-"));
    const copied = path.join(fixture, "trusted-node-modules");
    try {
      const packageRoot = path.join(copied, ".pnpm/example@1.0.0/node_modules/example");
      await mkdir(packageRoot, { recursive: true });
      const cli = path.join(packageRoot, "cli.mjs");
      await writeFile(cli, 'process.stdout.write("trusted-cli-1.0.0\\n");\n', { mode: 0o555 });
      const topLevel = path.join(copied, "example");
      await symlink(".pnpm/example@1.0.0/node_modules/example", topLevel);

      const copiedRoot = await realpath(copied);
      const resolution = await resolveContainedDependencySymlink(topLevel, copiedRoot, "example");
      expect(resolution.target).toBe(".pnpm/example@1.0.0/node_modules/example");
      expect(resolution.resolved.startsWith(`${copiedRoot}${path.sep}`)).toBe(true);
      const execution = await spawnCaptured(process.execPath, [path.join(topLevel, "cli.mjs")], {
        stdoutLimitBytes: 4096,
        stderrLimitBytes: 4096,
        totalLimitBytes: 6144
      });
      expect(execution.exitCode).toBe(0);
      expect(execution.stdout.toString("utf8")).toBe("trusted-cli-1.0.0\n");
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });
});
