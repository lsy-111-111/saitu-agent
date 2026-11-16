#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash, randomUUID, sign as signBytes, verify as verifyBytes } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  chmod,
  chown,
  lstat,
  mkdir,
  open,
  opendir,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile
} from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const REQUIRED_NODE = "v24.20.0";
const REQUIRED_PNPM = "11.19.0";
const REQUIRED_RUNTIME_ROOT = "/opt/nodejs/node-v24.20.0-linux-x64";
const REQUIRED_NODE_PATH = `${REQUIRED_RUNTIME_ROOT}/bin/node`;
const REQUIRED_PNPM_ENTRYPOINT = `${REQUIRED_RUNTIME_ROOT}/lib/runtime-tools/node_modules/pnpm/bin/pnpm.mjs`;
const REQUIRED_PNPM_PACKAGE = `${REQUIRED_RUNTIME_ROOT}/lib/runtime-tools/node_modules/pnpm/package.json`;
const REQUIRED_COORDINATOR_PATH = "/usr/local/lib/resume-ai/run-release-evidence.mjs";
const REQUIRED_DEEPSEEK_VERIFIER_PATH = "/usr/local/lib/resume-ai/release-evidence-deepseek-verifier.mjs";
const REQUIRED_SPEND_CONTROL_PATH = "/usr/local/lib/resume-ai/release-evidence-spend.mjs";
const REQUIRED_HTTP_PROBE_PATH = "/usr/local/lib/resume-ai/release-evidence-http-probe.mjs";
const REQUIRED_WORK_PARENT = "/opt/resume-ai/build-staging";
const REQUIRED_EVIDENCE_GENERATIONS_ROOT = "/var/lib/resume-ai/release-evidence-generations";
const EVIDENCE_SIGNING_PRIVATE_KEY = "/etc/resume-ai/release-evidence-signing.key";
const EVIDENCE_SIGNING_PUBLIC_KEY = "/etc/resume-ai/release-evidence-signing.pub";
const LINUX_GENERATION_MANIFEST = "linux-validation-artifact-manifest.txt";
const LINUX_GENERATION_ATTESTATION = "linux-validation-attestation.json";
const LINUX_GENERATION_SCHEMA = "resume-ai-linux-validation-generation.v1";
const LINUX_GENERATION_MANIFEST_ALGORITHM = "sha256-bytes-path.v1";
const BUILD_ACCOUNT = "resume-ai-build";
const VERIFY_ACCOUNT = "resume-ai-verify";
const PGTEST_ACCOUNT = "resume-ai-pgtest";
const SYSTEMD_RUN = "/usr/bin/systemd-run";
const SYSTEMCTL = "/usr/bin/systemctl";
const ENV_BIN = "/usr/bin/env";
const TRUSTED_PATH = "/usr/sbin:/usr/bin:/sbin:/bin";
const BUILDER_PATH = "/opt/nodejs/current/bin:/usr/bin:/bin";
const SOURCE_MANIFEST_MEMBER = "scripts/run-release-evidence.mjs";
const DEEPSEEK_VERIFIER_MEMBER = "scripts/lib/release-evidence-deepseek-verifier.mjs";
const SPEND_CONTROL_MEMBER = "scripts/lib/release-evidence-spend.mjs";
const HTTP_PROBE_MEMBER = "scripts/lib/release-evidence-http-probe.mjs";
const REQUIRED_TESTS_PATH = "/usr/local/lib/resume-ai/release-required-tests.json";
const REQUIRED_TESTS_MEMBER = "ops/config/release-required-tests.json";
const REQUIRED_TEST_POLICY_SHA256 = "d8031d1299a5ad211bef18e0083d2db6ecd76080ac706379acdf0e5eb7152bae";
const PROSPECTIVE_BASELINE_MEMBER = "tests/fixtures/competition-score-prospective-baseline.json";
const DEPENDENCY_INPUT_MEMBERS = ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "vitest.config.ts", "tests/fixtures/mock-spend-ledger.setup.ts"];
const PROJECT_TOOLCHAIN_POLICY_ID = "resume-ai-project-toolchain.v1";
const TRUSTED_DEPENDENCY_INPUTS = [
  { path: "package.json", sha256: "9cc16eab9219c3f1f6c944dcdf1cd8c13f2e9d2eadd297dcfc2cd195bca70260" },
  { path: "pnpm-lock.yaml", sha256: "e2c3672ee797b690bba9f39ba9cb45ba55d13ed8b927bc392e67502309d4b0b9" },
  { path: "pnpm-workspace.yaml", sha256: "43b2e5babda0acd9c89dfde3a92d8e5aeedd487a3b7e5c0b311984dc37f762d3" },
  { path: "vitest.config.ts", sha256: "a32d057bc2e6fd44bb7b9e0df656794f6bd176bfa7232f4a5ac090ff4b9422a5" },
  { path: "tests/fixtures/mock-spend-ledger.setup.ts", sha256: "496e4764ef52cb24c5f4b54221883936e9f28e609e6c20a0fb26b5e8358f8c9a" }
];
const TRUSTED_PROJECT_TOOLS = [
  { id: "eslint", packageName: "eslint", packagePath: "node_modules/eslint", version: "8.57.1", binName: "eslint", binTarget: "bin/eslint.js" },
  { id: "next", packageName: "next", packagePath: "node_modules/next", version: "15.5.24", binName: "next", binTarget: "dist/bin/next" },
  { id: "playwright", packageName: "playwright", packagePath: "node_modules/playwright", version: "1.60.0", binName: "playwright", binTarget: "cli.js" },
  { id: "playwright-test", packageName: "@playwright/test", packagePath: "node_modules/@playwright/test", version: "1.60.0", binName: "playwright", binTarget: "cli.js" },
  { id: "typescript", packageName: "typescript", packagePath: "node_modules/typescript", version: "5.7.2", binName: "tsc", binTarget: "bin/tsc" },
  { id: "vitest", packageName: "vitest", packagePath: "node_modules/vitest", version: "3.2.6", binName: "vitest", binTarget: "vitest.mjs" }
];
const NPM_REGISTRY_HOST = "registry.npmjs.org";
const PLAYWRIGHT_DOWNLOAD_HOSTS = ["cdn.playwright.dev", "playwright.download.prss.microsoft.com"];
const PLAYWRIGHT_BROWSER_DIRECTORY = ".release-evidence-playwright-browsers";
const CAPTURE_STDOUT_LIMIT_BYTES = 8 * 1024 * 1024;
const CAPTURE_STDERR_LIMIT_BYTES = 8 * 1024 * 1024;
const CAPTURE_TOTAL_LIMIT_BYTES = 12 * 1024 * 1024;
const SYSTEMCTL_KILL_TIMEOUT_MS = 10_000;
const GENERAL_FILE_LIMIT_BYTES = 128 * 1024 * 1024;
const TOOLCHAIN_FILE_LIMIT_BYTES = 256 * 1024 * 1024;
const DEPENDENCY_COPY_FILE_LIMIT_BYTES = 512 * 1024 * 1024;
const GIT_COPY_TOTAL_LIMIT_BYTES = 2 * 1024 * 1024 * 1024;
const DEPENDENCY_COPY_TOTAL_LIMIT_BYTES = 6 * 1024 * 1024 * 1024;
const BROWSER_COPY_TOTAL_LIMIT_BYTES = 3 * 1024 * 1024 * 1024;
const READ_ONLY_TREE_MEMBER_LIMIT = 250_000;
const BROWSER_TREE_MEMBER_LIMIT = 50_000;
const READ_ONLY_TREE_DEPTH_LIMIT = 128;
const CONTROL_FILE_LIMIT_BYTES = 16 * 1024 * 1024;
const REQUIRED_TEST_MANIFEST_LIMIT_BYTES = 1024 * 1024;
const MACHINE_REPORT_LIMIT_BYTES = 64 * 1024 * 1024;
const HTML_REPORT_FILE_LIMIT_BYTES = 64 * 1024 * 1024;
const HTML_REPORT_TOTAL_LIMIT_BYTES = 512 * 1024 * 1024;
const HTML_REPORT_MEMBER_LIMIT = 20_000;
const REQUIRED_TEST_CATEGORIES = new Set([
  "desktop-e2e",
  "followups-0",
  "followups-1",
  "followups-2",
  "followups-3",
  "mobile-e2e",
  "pure-text-max-10",
  "queue-full-fallback",
  "quota-config-consistency",
  "shared-nat-50",
  "threshold-429-recovery",
  "token-cross-session",
  "token-expiry",
  "token-forgery",
  "token-replay",
  "v7-algorithm",
  "v7-backend-review",
  "v7-browser-desktop",
  "v7-browser-mobile",
  "v7-catalog",
  "v7-chat-adoption",
  "v7-chat-grounding",
  "v7-crypto",
  "v7-durable-state",
  "v7-group-persistence",
  "v7-governor-cap",
  "v7-native-pg14",
  "v7-profile",
  "v7-release-evidence",
  "v7-test-environment",
  "v7-v7-worker-ops",
  "v7-effort-release",
  "v7-effort-persistence",
  "v7-original-clock",
  "v7-effort-evaluation",
  "v7-effort-fixed-budget",
  "v7-effort-browser",
  "v7-provenance-boundary"
]);
const REQUIRED_GATES = [
  "dependency-fetch",
  "dependency-offline-install",
  "playwright-browser-fetch",
  "dependency-provenance",
  "typecheck",
  "lint",
  "unit",
  "production-build",
  "production-dependency-audit",
  "postgres-integration",
  "deepseek-preflight",
  "production-e2e",
  "required-tests"
];
const REQUIRED_SIGNED_EVIDENCE_FILES = new Set([
  "deepseek-budget-receipt.json",
  "dependency-provenance-receipt.json",
  "worker-build-result.json",
  "native-v7-postgres-result.json",
  "validation-logs/native-v7-postgres.log",
  "e2e-result.json",
  "playwright-report.json",
  "pnpm-audit-result.json",
  "release-required-tests.json",
  "required-test-receipt.json",
  "validation-result.json",
  "vitest-postgres-result.json",
  "vitest-unit-result.json",
  ...REQUIRED_GATES.map((name) => `validation-logs/${name}.log`)
]);

function fail(message) {
  throw new Error(message);
}

export function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--")) {
      fail("usage: run-release-evidence.mjs --source-manifest ABS --output ABS --www-url HTTPS_URL");
    }
    if (Object.hasOwn(values, key)) fail(`duplicate argument: ${key}`);
    values[key] = value;
  }
  const allowed = new Set(["--source-manifest", "--output", "--www-url", "--v6-delivery-output"]);
  for (const key of Object.keys(values)) if (!allowed.has(key)) fail(`unknown argument: ${key}`);
  for (const key of ["--source-manifest", "--output", "--www-url"]) if (!values[key]) fail(`missing argument: ${key}`);
  return values;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function boundedFileLimit(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 1024 * 1024 * 1024) {
    fail(`${label} is outside the reviewed file-size range`);
  }
  return value;
}

export async function hashOrdinaryFile(filename, { maxBytes = GENERAL_FILE_LIMIT_BYTES, label = "evidence input" } = {}) {
  const ceiling = boundedFileLimit(maxBytes, `${label} limit`);
  const before = await lstat(filename, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n) {
    fail(`evidence input is linked or special: ${filename}`);
  }
  if (before.size > BigInt(ceiling)) fail(`${label} exceeds ${ceiling} bytes: ${filename}`);
  const bytes = await readFile(filename);
  if (bytes.length > ceiling) fail(`${label} exceeds ${ceiling} bytes after read: ${filename}`);
  const after = await lstat(filename, { bigint: true });
  for (const key of ["dev", "ino", "mode", "nlink", "size", "mtimeNs", "ctimeNs"]) {
    if (before[key] !== after[key]) fail(`evidence input changed while hashing: ${filename}`);
  }
  return { bytes, sha256: sha256(bytes), metadata: before };
}

function isoNow() {
  return new Date().toISOString().replace(/\.\d{3}Z$/u, "Z");
}

async function sealLinuxValidationGeneration({
  output,
  runId,
  sourceState,
  coordinatorSha256
}) {
  const rootMetadata = await lstat(output, { bigint: true });
  if (
    !rootMetadata.isDirectory()
    || rootMetadata.isSymbolicLink()
    || rootMetadata.uid !== 0n
    || rootMetadata.gid !== 0n
    || (rootMetadata.mode & 0o777n) !== 0o700n
  ) fail("Linux validation generation root is not private and root-owned");
  for (const reserved of [LINUX_GENERATION_MANIFEST, LINUX_GENERATION_ATTESTATION]) {
    if (await lstat(path.join(output, reserved)).then(() => true, () => false)) {
      fail(`Linux validation generation reserved member already exists: ${reserved}`);
    }
  }

  const entries = [];
  let fileCount = 0;
  let totalBytes = 0;
  let visitedMembers = 0;
  async function walk(directory, relative, depth = 0) {
    if (depth > READ_ONLY_TREE_DEPTH_LIMIT) fail("Linux validation generation nesting exceeds policy");
    const before = await lstat(directory, { bigint: true });
    if (
      !before.isDirectory()
      || before.isSymbolicLink()
      || before.uid !== 0n
      || before.gid !== 0n
      || (before.mode & 0o022n) !== 0n
    ) fail(`unsafe Linux validation generation directory: ${relative || "."}`);
    const members = await readdir(directory, { withFileTypes: true });
    visitedMembers += members.length;
    if (visitedMembers > READ_ONLY_TREE_MEMBER_LIMIT) fail("Linux validation generation has too many members");
    const names = members.map((member) => member.name)
      .sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
    for (const member of members.sort((left, right) => Buffer.from(left.name).compare(Buffer.from(right.name)))) {
      if (
        member.name !== member.name.normalize("NFC")
        || /[\\/\0\r\n\t]/u.test(member.name)
        || member.name === "."
        || member.name === ".."
      ) fail("Linux validation generation contains an unsafe member name");
      const next = relative ? `${relative}/${member.name}` : member.name;
      const absolute = path.join(directory, member.name);
      if (member.isDirectory()) {
        await walk(absolute, next, depth + 1);
      } else if (member.isFile()) {
        const metadata = await lstat(absolute, { bigint: true });
        if (
          !metadata.isFile()
          || metadata.isSymbolicLink()
          || metadata.nlink !== 1n
          || metadata.uid !== 0n
          || metadata.gid !== 0n
          || (metadata.mode & 0o022n) !== 0n
        ) fail(`unsafe Linux validation generation file: ${next}`);
        const artifact = await hashOrdinaryFile(absolute, {
          maxBytes: MACHINE_REPORT_LIMIT_BYTES,
          label: `Linux validation generation artifact ${next}`
        });
        fileCount += 1;
        totalBytes += artifact.bytes.length;
        if (totalBytes > 2 * 1024 * 1024 * 1024) fail("Linux validation generation exceeds its signed byte ceiling");
        entries.push({ path: next, sha256: artifact.sha256, bytes: artifact.bytes.length });
      } else {
        fail(`linked or special Linux validation generation member: ${next}`);
      }
    }
    const namesAfter = (await readdir(directory))
      .sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
    const after = await lstat(directory, { bigint: true });
    if (JSON.stringify(namesAfter) !== JSON.stringify(names)) fail(`Linux validation generation membership changed: ${relative || "."}`);
    for (const key of ["dev", "ino", "mode", "nlink", "size", "mtimeNs", "ctimeNs"]) {
      if (before[key] !== after[key]) fail(`Linux validation generation directory changed: ${relative || "."}`);
    }
  }
  await walk(output, "");
  entries.sort((left, right) => Buffer.from(left.path).compare(Buffer.from(right.path)));
  const observedPaths = new Set(entries.map((entry) => entry.path));
  if (
    [...REQUIRED_SIGNED_EVIDENCE_FILES].some((required) => !observedPaths.has(required))
    || entries.some((entry) => (
      !REQUIRED_SIGNED_EVIDENCE_FILES.has(entry.path)
      && !entry.path.startsWith("playwright-report/")
    ))
    || !observedPaths.has("playwright-report/index.html")
  ) fail("Linux validation generation contains an incomplete or unexpected signed artifact set");
  const manifestBytes = Buffer.from(entries
    .map((entry) => `${entry.sha256}\t${entry.bytes}\t${entry.path}\n`)
    .join(""), "utf8");
  const manifestSha256 = sha256(manifestBytes);
  await writeFile(path.join(output, LINUX_GENERATION_MANIFEST), manifestBytes, { flag: "wx", mode: 0o400 });

  const [privateKeyArtifact, publicKeyArtifact] = await Promise.all([
    hashOrdinaryFile(EVIDENCE_SIGNING_PRIVATE_KEY, { maxBytes: CONTROL_FILE_LIMIT_BYTES, label: "Linux validation signing key" }),
    hashOrdinaryFile(EVIDENCE_SIGNING_PUBLIC_KEY, { maxBytes: CONTROL_FILE_LIMIT_BYTES, label: "Linux validation public key" })
  ]);
  if (
    privateKeyArtifact.metadata.uid !== 0n
    || privateKeyArtifact.metadata.gid !== 0n
    || (privateKeyArtifact.metadata.mode & 0o777n) !== 0o600n
    || publicKeyArtifact.metadata.uid !== 0n
    || publicKeyArtifact.metadata.gid !== 0n
    || (publicKeyArtifact.metadata.mode & 0o777n) !== 0o644n
  ) fail("Linux validation signing key material is not root-frozen");
  const payload = {
    schemaVersion: 1,
    evidenceType: "resume-ai-linux-validation-generation-payload",
    status: "sealed",
    runId,
    generationRoot: output,
    createdAt: isoNow(),
    sourceManifestSha256: sourceState.sourceManifestSha256,
    sourceModeManifestSha256: sourceState.sourceModeManifestSha256,
    sourceModeMemberCount: sourceState.sourceModeMemberCount,
    producer: { path: REQUIRED_COORDINATOR_PATH, sha256: coordinatorSha256 },
    artifactManifest: {
      artifact: LINUX_GENERATION_MANIFEST,
      algorithm: LINUX_GENERATION_MANIFEST_ALGORITHM,
      sha256: manifestSha256,
      memberCount: fileCount,
      totalBytes
    }
  };
  const payloadBytes = Buffer.from(`${JSON.stringify(payload)}\n`, "utf8");
  const signature = signBytes(null, payloadBytes, privateKeyArtifact.bytes);
  if (!verifyBytes(null, payloadBytes, publicKeyArtifact.bytes, signature)) {
    fail("Linux validation generation signature did not verify locally");
  }
  const attestation = {
    schemaVersion: 1,
    evidenceType: LINUX_GENERATION_SCHEMA,
    algorithm: "Ed25519",
    publicKey: {
      path: EVIDENCE_SIGNING_PUBLIC_KEY,
      sha256: publicKeyArtifact.sha256
    },
    payloadEncoding: "base64",
    payloadSha256: sha256(payloadBytes),
    payloadBase64: payloadBytes.toString("base64"),
    signatureBase64: signature.toString("base64")
  };
  const attestationBytes = Buffer.from(`${JSON.stringify(attestation, null, 2)}\n`, "utf8");
  await writeFile(path.join(output, LINUX_GENERATION_ATTESTATION), attestationBytes, { flag: "wx", mode: 0o400 });
  return { attestationSha256: sha256(attestationBytes), manifestSha256 };
}

export async function writeEvidenceFailure(output, error) {
  await writeFile(
    path.join(output, "EVIDENCE_FAILED"),
    `${String(error?.message ?? error)}\n`,
    { flag: "wx", mode: 0o600 }
  );
}

function cleanSpawnEnvironment() {
  return { PATH: TRUSTED_PATH, LANG: "C", LC_ALL: "C" };
}

export class CapturedOutputLimitError extends Error {
  constructor({ stream, unit, observed, captured, limits, killError }) {
    super(
      `captured output limit exceeded (${stream}; unit=${unit ?? "none"}; ` +
      `stdout=${observed.stdout}; stderr=${observed.stderr}; total=${observed.total}; ` +
      `limits=${limits.stdout}/${limits.stderr}/${limits.total})` +
      (killError ? `; transient-unit kill failed: ${killError}` : "")
    );
    this.name = "CapturedOutputLimitError";
    this.code = "CAPTURE_LIMIT_EXCEEDED";
    this.stream = stream;
    this.unit = unit ?? null;
    this.observedBytes = observed;
    this.capturedBytes = captured;
    this.limits = limits;
  }
}

function captureLimit(value, fallback, label) {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0 || resolved > 64 * 1024 * 1024) {
    fail(`${label} is outside the reviewed capture range`);
  }
  return resolved;
}

async function runSystemctlBounded(argv) {
  const child = spawn(
    SYSTEMCTL,
    argv,
    { cwd: "/", env: cleanSpawnEnvironment(), stdio: "ignore" }
  );
  let timeout;
  try {
    const exitCode = await Promise.race([
      new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code, signal) => resolve(signal ? 128 : (code ?? 127)));
      }),
      new Promise((resolve) => {
        timeout = setTimeout(() => {
          child.kill("SIGKILL");
          resolve(124);
        }, SYSTEMCTL_KILL_TIMEOUT_MS);
      })
    ]);
    return exitCode;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function systemctlKillTransientUnit(unit) {
  if (!/^[a-z0-9][a-z0-9_.@-]{0,200}\.service$/u.test(unit)) fail("unsafe transient unit name for output-limit kill");
  const killExit = await runSystemctlBounded(["kill", "--kill-who=all", "--signal=SIGKILL", unit]);
  let activeExit = await runSystemctlBounded(["is-active", "--quiet", unit]);
  if (![0, 3, 4].includes(activeExit)) fail(`cannot verify transient unit after output-limit kill: ${activeExit}`);
  let stopExit = null;
  if (activeExit === 0) {
    stopExit = await runSystemctlBounded(["stop", unit]);
    activeExit = await runSystemctlBounded(["is-active", "--quiet", unit]);
  }
  if (![3, 4].includes(activeExit)) {
    fail(`transient unit survived output-limit kill (kill=${killExit}; stop=${stopExit ?? "not-run"})`);
  }
}

export async function spawnCaptured(executable, argv, options = {}) {
  const limits = {
    stdout: captureLimit(options.stdoutLimitBytes, CAPTURE_STDOUT_LIMIT_BYTES, "stdout capture limit"),
    stderr: captureLimit(options.stderrLimitBytes, CAPTURE_STDERR_LIMIT_BYTES, "stderr capture limit"),
    total: captureLimit(options.totalLimitBytes, CAPTURE_TOTAL_LIMIT_BYTES, "total capture limit")
  };
  if (limits.total > limits.stdout + limits.stderr) fail("total capture limit exceeds both stream limits combined");
  const stdoutChunks = [];
  const stderrChunks = [];
  const observed = { stdout: 0, stderr: 0, total: 0 };
  const captured = { stdout: 0, stderr: 0, total: 0 };
  let overflow;
  let killPromise;
  const child = spawn(executable, argv, {
    cwd: options.cwd ?? "/",
    env: options.env ?? cleanSpawnEnvironment(),
    stdio: ["ignore", "pipe", "pipe"]
  });
  const onData = (stream, chunks, chunkValue) => {
    const chunk = Buffer.from(chunkValue);
    observed[stream] = Math.min(Number.MAX_SAFE_INTEGER, observed[stream] + chunk.length);
    observed.total = Math.min(Number.MAX_SAFE_INTEGER, observed.total + chunk.length);
    if (!overflow) {
      const allowed = Math.max(0, Math.min(
        chunk.length,
        limits[stream] - captured[stream],
        limits.total - captured.total
      ));
      if (allowed > 0) {
        chunks.push(allowed === chunk.length ? chunk : chunk.subarray(0, allowed));
        captured[stream] += allowed;
        captured.total += allowed;
      }
      if (observed[stream] > limits[stream] || observed.total > limits.total) {
        overflow = {
          stream: observed[stream] > limits[stream] ? stream : "total",
          unit: options.unit,
          observed: { ...observed },
          captured: { ...captured },
          limits
        };
        killPromise = options.unit
          ? systemctlKillTransientUnit(options.unit).then(() => null, (error) => String(error?.message ?? error))
          : Promise.resolve(null);
        child.kill("SIGKILL");
      }
    }
  };
  child.stdout.on("data", (chunk) => onData("stdout", stdoutChunks, chunk));
  child.stderr.on("data", (chunk) => onData("stderr", stderrChunks, chunk));
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve(signal ? 128 : (code ?? 127)));
  });
  if (overflow) {
    const killError = await killPromise;
    throw new CapturedOutputLimitError({ ...overflow, killError });
  }
  return { exitCode, stdout: Buffer.concat(stdoutChunks), stderr: Buffer.concat(stderrChunks) };
}

async function trustedOutput(executable, argv, label) {
  const result = await spawnCaptured(executable, argv);
  if (result.exitCode !== 0) fail(`${label} failed: ${result.stderr.toString("utf8").trim()}`);
  return result.stdout.toString("utf8").trim();
}

export function validateDedicatedAccountRecords({ account, uidText, gidText, groupName, groupIds, passwdLine, groupLine }) {
  const uid = Number(uidText);
  const gid = Number(gidText);
  const passwdFields = passwdLine.split(":");
  const groupFields = groupLine.split(":");
  if (
    !Number.isSafeInteger(uid)
    || uid <= 0
    || !Number.isSafeInteger(gid)
    || gid <= 0
    || groupName !== account
    || groupIds !== String(gid)
    || passwdFields.length !== 7
    || passwdFields[0] !== account
    || passwdFields[2] !== String(uid)
    || passwdFields[3] !== String(gid)
    || !["/usr/sbin/nologin", "/bin/false"].includes(passwdFields[6])
    || groupFields.length !== 4
    || groupFields[0] !== account
    || groupFields[2] !== String(gid)
    || groupFields[3] !== ""
  ) {
    fail(`${account} must have one same-name primary group, no supplementary groups, and a non-login shell`);
  }
  return { account, uid, gid };
}

async function accountIdentity(account) {
  const [uidText, gidText, groupName, groupIds, passwdLine, groupLine] = await Promise.all([
    trustedOutput("/usr/bin/id", ["-u", account], `${account} uid lookup`),
    trustedOutput("/usr/bin/id", ["-g", account], `${account} gid lookup`),
    trustedOutput("/usr/bin/id", ["-gn", account], `${account} primary group lookup`),
    trustedOutput("/usr/bin/id", ["-G", account], `${account} group set lookup`),
    trustedOutput("/usr/bin/getent", ["passwd", account], `${account} passwd lookup`),
    trustedOutput("/usr/bin/getent", ["group", account], `${account} group lookup`)
  ]);
  return validateDedicatedAccountRecords({ account, uidText, gidText, groupName, groupIds, passwdLine, groupLine });
}

async function assertAccountIdle(identity) {
  const result = await spawnCaptured("/usr/bin/pgrep", ["-u", String(identity.uid)]);
  if (result.exitCode === 0) fail(`${identity.account} has a process outside the release-evidence transient unit`);
  if (result.exitCode !== 1) fail(`cannot verify ${identity.account} process isolation`);
}

function safeManifestPath(relative) {
  return (
    relative.length > 0 &&
    relative === relative.normalize("NFC") &&
    !relative.startsWith("/") &&
    !/[\0\r\n\t\\]/u.test(relative) &&
    !relative.split("/").some((part) => part === "" || part === "." || part === "..") &&
    path.posix.normalize(relative) === relative
  );
}

function parseSourceManifest(bytes) {
  const text = bytes.toString("utf8");
  if (!text.endsWith("\n") || text.includes("\r")) fail("reviewed source manifest is not canonical LF text");
  const entries = [];
  for (const line of text.slice(0, -1).split("\n")) {
    const match = line.match(/^([a-f0-9]{64})\tF\t([^\t\n]+)$/u);
    if (!match || !safeManifestPath(match[2])) fail("reviewed source manifest contains an unsafe member");
    entries.push({ sha256: match[1], relative: match[2] });
  }
  if (entries.length === 0) fail("reviewed source manifest is empty");
  const sorted = [...entries].sort((left, right) => Buffer.from(left.relative).compare(Buffer.from(right.relative)));
  if (entries.some((entry, index) => entry.relative !== sorted[index].relative) || new Set(entries.map((entry) => entry.relative)).size !== entries.length) {
    fail("reviewed source manifest is unsorted or duplicated");
  }
  return entries;
}

async function inspectSource(sourceRoot, manifestArtifact) {
  const entries = parseSourceManifest(manifestArtifact.bytes);
  const modeLines = [];
  const members = [];
  const checkedDirectories = new Set([sourceRoot]);
  for (const entry of entries) {
    const parts = entry.relative.split("/");
    for (let length = 1; length < parts.length; length += 1) {
      const directory = path.join(sourceRoot, ...parts.slice(0, length));
      if (checkedDirectories.has(directory)) continue;
      const metadata = await lstat(directory);
      if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== 0 || (metadata.mode & 0o022) !== 0) fail(`source ancestor is not root-frozen: ${entry.relative}`);
      checkedDirectories.add(directory);
    }
    const filename = path.join(sourceRoot, ...parts);
    const artifact = await hashOrdinaryFile(filename, { label: `reviewed source member ${entry.relative}` });
    const metadata = artifact.metadata;
    if (metadata.uid !== 0n || (metadata.mode & 0o7022n) !== 0n || artifact.sha256 !== entry.sha256) fail(`source member differs from reviewed freeze: ${entry.relative}`);
    const mode = Number(metadata.mode & 0o7777n);
    modeLines.push(`${mode.toString(8).padStart(4, "0")}\t${entry.relative}\n`);
    members.push({ ...entry, mode });
  }
  const modeBytes = Buffer.from(modeLines.join(""));
  return {
    entries,
    members,
    sourceManifestSha256: manifestArtifact.sha256,
    sourceModeManifestSha256: sha256(modeBytes),
    sourceModeMemberCount: entries.length
  };
}

async function verifyInstalledControlFile(requiredPath, manifestMember, sourceState) {
  const installed = await realpath(requiredPath);
  if (installed !== requiredPath) fail(`installed control file resolves outside its fixed path: ${requiredPath}`);
  const metadata = await lstat(installed);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || metadata.uid !== 0 || (metadata.mode & 0o022) !== 0) {
    fail(`installed control file is not root-frozen: ${requiredPath}`);
  }
  const reviewed = sourceState.entries.find((entry) => entry.relative === manifestMember);
  const artifact = await hashOrdinaryFile(installed, { maxBytes: CONTROL_FILE_LIMIT_BYTES, label: "installed control file" });
  if (!reviewed || artifact.sha256 !== reviewed.sha256) fail(`installed control file differs from reviewed source: ${manifestMember}`);
  return artifact.sha256;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hasExactKeys(value, expected) {
  return value && typeof value === "object" && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function canonicalText(value, label, maximum = 512) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > maximum
    || value !== value.trim()
    || value !== value.normalize("NFC")
    || /[\0\r\n\t]/u.test(value)
  ) fail(`required-test ${label} is not canonical text`);
  return value;
}

export function parseProjectToolchainPolicy(value, sourceEntries) {
  const expectedRuntime = {
    node: { executable: REQUIRED_NODE_PATH, version: REQUIRED_NODE },
    pnpm: { entrypoint: REQUIRED_PNPM_ENTRYPOINT, name: "pnpm", version: REQUIRED_PNPM }
  };
  if (
    !hasExactKeys(value, ["schemaVersion", "policyId", "inputs", "runtime", "tools"])
    || value.schemaVersion !== 1
    || value.policyId !== PROJECT_TOOLCHAIN_POLICY_ID
    || canonicalJson(value.inputs) !== canonicalJson(TRUSTED_DEPENDENCY_INPUTS)
    || canonicalJson(value.runtime) !== canonicalJson(expectedRuntime)
    || canonicalJson(value.tools) !== canonicalJson(TRUSTED_PROJECT_TOOLS)
  ) fail("project-toolchain policy differs from the fixed trusted execution authority");
  const availableSources = new Map((sourceEntries ?? []).map((entry) => [entry.relative, entry.sha256]));
  if (sourceEntries) for (const input of TRUSTED_DEPENDENCY_INPUTS) {
    if (availableSources.get(input.path) !== input.sha256) {
      fail(`project-toolchain input differs from reviewed source manifest: ${input.path}`);
    }
  }
  return {
    schemaVersion: 1,
    policyId: PROJECT_TOOLCHAIN_POLICY_ID,
    inputs: TRUSTED_DEPENDENCY_INPUTS.map((input) => ({ ...input })),
    runtime: expectedRuntime,
    tools: TRUSTED_PROJECT_TOOLS.map((tool) => ({ ...tool })),
    sha256: sha256(Buffer.from(canonicalJson(value)))
  };
}

export function parseRequiredTestManifest(bytes, sourceEntries) {
  if (!Buffer.isBuffer(bytes) || sha256(bytes) !== REQUIRED_TEST_POLICY_SHA256) {
    fail("required-test manifest whole-policy SHA-256 differs from the fixed authority");
  }
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.at(-1) !== 0x0a || bytes.includes(0x0d)) {
    fail("required-test manifest must be nonempty canonical LF JSON");
  }
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes)) fail("required-test manifest is not UTF-8");
  let value;
  try { value = JSON.parse(text); } catch { fail("required-test manifest is not JSON"); }
  if (
    !hasExactKeys(value, ["schemaVersion", "evidenceType", "minimumPassedObservations", "projectToolchain", "sourcePins", "requirements"])
    || value.schemaVersion !== 1
    || value.evidenceType !== "resume-ai-release-required-tests"
    || !Array.isArray(value.sourcePins)
    || value.sourcePins.length === 0
    || !Array.isArray(value.requirements)
    || value.requirements.length === 0
  ) fail("required-test manifest has an invalid top-level contract");
  const projectToolchain = parseProjectToolchainPolicy(value.projectToolchain, sourceEntries);

  const pins = new Map();
  let previousPin;
  for (const pin of value.sourcePins) {
    if (!hasExactKeys(pin, ["path", "sha256"]) || !safeManifestPath(pin.path) || !/^[a-f0-9]{64}$/u.test(pin.sha256)) {
      fail("required-test manifest contains an invalid source pin");
    }
    if (previousPin && Buffer.compare(Buffer.from(previousPin), Buffer.from(pin.path)) >= 0) {
      fail("required-test source pins are not in canonical byte order");
    }
    previousPin = pin.path;
    if (pins.has(pin.path)) fail("required-test source pin is duplicated");
    pins.set(pin.path, pin.sha256);
  }
  for (const config of ["playwright.config.ts", "vitest.config.ts", "tests/fixtures/mock-spend-ledger.setup.ts"]) {
    if (!pins.has(config)) fail(`required-test manifest does not pin ${config}`);
  }

  const availableSources = new Map((sourceEntries ?? []).map((entry) => [entry.relative, entry.sha256]));
  if (sourceEntries) for (const [relative, expectedSha256] of pins) {
    if (availableSources.get(relative) !== expectedSha256) {
      fail(`required-test pinned source differs from reviewed source manifest: ${relative}`);
    }
  }

  const ids = new Set();
  const observationKeys = new Set();
  const coveredCategories = new Set();
  let minimumPassedObservations = 0;
  const requirements = value.requirements.map((requirement) => {
    if (!hasExactKeys(requirement, ["id", "categories", "framework", "report", "testFile", "fullName", "project", "minimumPassed"])) {
      fail("required-test entry has unexpected fields");
    }
    const id = canonicalText(requirement.id, "id", 96);
    if (!/^[a-z0-9][a-z0-9-]*$/u.test(id) || ids.has(id)) fail("required-test id is unsafe or duplicated");
    ids.add(id);
    if (!Array.isArray(requirement.categories) || requirement.categories.length === 0) fail(`required-test categories are empty: ${id}`);
    const categories = requirement.categories.map((category) => canonicalText(category, "category", 64));
    if (new Set(categories).size !== categories.length || categories.some((category) => !REQUIRED_TEST_CATEGORIES.has(category))) {
      fail(`required-test categories are unknown or duplicated: ${id}`);
    }
    for (const category of categories) coveredCategories.add(category);
    const testFile = canonicalText(requirement.testFile, "file", 256);
    if (!safeManifestPath(testFile) || !pins.has(testFile)) fail(`required-test file is unsafe or unpinned: ${id}`);
    const fullName = canonicalText(requirement.fullName, "fullName", 512);
    const framework = requirement.framework;
    const report = requirement.report;
    const project = requirement.project;
    const validReport = (
      framework === "vitest"
      && ((report === "vitest-unit" && project === "unit") || (report === "vitest-postgres" && project === "postgres-integration"))
    ) || (
      framework === "playwright"
      && report === "playwright-production"
      && ["desktop", "mobile"].includes(project)
    );
    if (!validReport) fail(`required-test framework/report/project is invalid: ${id}`);
    if (!Number.isSafeInteger(requirement.minimumPassed) || requirement.minimumPassed < 1 || requirement.minimumPassed > 10) {
      fail(`required-test minimum pass count is invalid: ${id}`);
    }
    minimumPassedObservations += requirement.minimumPassed;
    const observationKey = [report, testFile, fullName, project].join("\0");
    if (observationKeys.has(observationKey)) fail(`required-test observation is duplicated: ${id}`);
    observationKeys.add(observationKey);
    return { id, categories, framework, report, testFile, fullName, project, minimumPassed: requirement.minimumPassed };
  });
  if (
    JSON.stringify([...coveredCategories].sort()) !== JSON.stringify([...REQUIRED_TEST_CATEGORIES].sort())
    || value.minimumPassedObservations !== minimumPassedObservations
  ) fail("required-test manifest does not cover the fixed release requirements and minimum count");
  return {
    schemaVersion: value.schemaVersion,
    evidenceType: value.evidenceType,
    minimumPassedObservations,
    projectToolchain,
    pins,
    requirements
  };
}

// This input-only address is from the preserved v1 denominator, not new scores.
// Changes to it require a separately reviewed control-plane generation.
const PROSPECTIVE_INPUT_IDENTITY_SHA256 = "b12ad197eaa1022de4b05f7d093be23a8b4b7e768404ff4737f76a61f3d7c65b";
const PROSPECTIVE_MEMBER_SETS = {
  sourceSnapshot: "4178fc21d285be0fcd72b42a469f2679b8c8b42e793bf7cff53e9eab5fee9833",
  datasets: "a6df65e070ed56cd2c0b3c88750af8e7d95623316133d226e27c32b0fa2db2f6"
};

export function validateProspectiveBaseline(value) {
  const { artifactSha256, ...withoutArtifactHash } = value ?? {};
  const digest = (input) => sha256(Buffer.from(canonicalJson(input)));
  if (!['competition-score-prospective-baseline.v1', 'competition-score-prospective-baseline.v2'].includes(value?.schemaVersion)
    || !/^[a-f0-9]{64}$/u.test(artifactSha256 ?? '') || artifactSha256 !== digest(withoutArtifactHash)) {
    fail("prospective baseline candidate has an invalid canonical artifact hash");
  }
  // Preserve the existing v1 consumer contract. v2 records null exclusions and
  // therefore needs explicit denominator and outcome validation before use.
  if (value.schemaVersion === 'competition-score-prospective-baseline.v1') return value;
  if (value.captureIntent !== 'forward-regression-denominator-only' || value.historicalComparisonAllowed !== false
    || !Array.isArray(value.results) || value.results.length !== 125
    || value.datasets?.anchorCaseCount !== 100 || value.datasets?.holdoutCaseCount !== 25) {
    fail('prospective v2 must preserve the full forward-only denominator');
  }
  const identity = value.results.map(({ dataset, personaId, inputSha256, fixedCompetitionId }) => ({ dataset, personaId, inputSha256, fixedCompetitionId }));
  if (digest(identity) !== PROSPECTIVE_INPUT_IDENTITY_SHA256) fail('prospective v2 changed a preserved input or fixed pair');
  if (value.resultsSha256 !== digest(value.results)) fail('prospective v2 results hash mismatch');
  for (const key of ['sourceSnapshot', 'datasets']) {
    const snapshot = value[key];
    if (snapshot?.algorithm !== 'sha256' || !Array.isArray(snapshot.files) || snapshot.files.length === 0
      || new Set(snapshot.files.map(row => row.path)).size !== snapshot.files.length
      || snapshot.files.some(row => typeof row.path !== 'string' || !/^(src|tests)\/[A-Za-z0-9_./-]+$/u.test(row.path)
        || row.path.split('/').some(part => part === '.' || part === '..') || !/^[a-f0-9]{64}$/u.test(row.sha256 ?? ''))
      || snapshot.snapshotSha256 !== digest([...snapshot.files].sort((a, b) => a.path.localeCompare(b.path)))) {
      fail('prospective v2 content-addressed source or dataset snapshot is invalid');
    }
    if (digest(snapshot.files.map(row => row.path).sort((a, b) => a.localeCompare(b))) !== PROSPECTIVE_MEMBER_SETS[key]) {
      fail('prospective v2 source or dataset member set changed');
    }
  }
  const strings = (items) => Array.isArray(items) && items.every(item => typeof item === 'string' && item.trim().length > 0);
  for (const row of value.results) {
    if (!strings(row.top10) || row.top10.length > 10 || new Set(row.top10).size !== row.top10.length
      || !strings(row.finalTop3) || row.finalTop3.length > 3 || new Set(row.finalTop3).size !== row.finalTop3.length) {
      fail('prospective v2 has an invalid observed result list');
    }
    const qualification = row.fixedCompetitionQualification;
    if (!qualification || !['eligible', 'needs_clarification', 'ineligible'].includes(qualification.status)
      || !strings(qualification.reasons) || !strings(qualification.sourceRefs)) fail('prospective v2 qualification evidence is invalid');
    if (row.fixedPairStatus === 'hard_excluded') {
      if (row.fixedCompetitionDisplayedScore !== null || qualification.status !== 'ineligible'
        || typeof qualification.hardFilterReason !== 'string' || !qualification.hardFilterReason.trim()
        || qualification.reasons.length === 0 || qualification.sourceRefs.length === 0
        || row.top10.includes(row.fixedCompetitionId) || row.finalTop3.includes(row.fixedCompetitionId)) {
        fail('prospective v2 hard exclusion is not supported');
      }
    } else if (row.fixedPairStatus !== 'scored' || qualification.status === 'ineligible'
      || !Number.isFinite(row.fixedCompetitionDisplayedScore) || row.fixedCompetitionDisplayedScore < 0
      || row.fixedCompetitionDisplayedScore > 100) fail('prospective v2 scored outcome is invalid');
  }
  const aggregates = { scoreMeanSemantics: 'scored-pairs-only; hard-excluded pairs retained as null' };
  for (const dataset of ['anchor', 'holdout']) {
    const rows = value.results.filter(row => row.dataset === dataset);
    const scored = rows.filter(row => row.fixedPairStatus === 'scored');
    aggregates[`${dataset}FixedPairMean`] = scored.length ? scored.reduce((sum, row) => sum + row.fixedCompetitionDisplayedScore, 0) / scored.length : null;
    aggregates[`${dataset}ScoredPairCount`] = scored.length;
    aggregates[`${dataset}HardExcludedPairCount`] = rows.length - scored.length;
  }
  if (canonicalJson(value.aggregates) !== canonicalJson(aggregates)) fail('prospective v2 aggregate denominator or mean mismatch');
  // Recording fewer than three recommendations does not pass the independent
  // exact-three/subset quality tests. Those tests still run in the unit gate.
  return value;
}

async function inspectProspectiveBaseline(sourceRoot) {
  const filename = path.join(sourceRoot, PROSPECTIVE_BASELINE_MEMBER);
  const artifact = await hashOrdinaryFile(filename, { maxBytes: REQUIRED_TEST_MANIFEST_LIMIT_BYTES, label: "prospective baseline candidate" });
  if (artifact.metadata.uid !== 0n || (artifact.metadata.mode & 0o7022n) !== 0n) fail("prospective baseline candidate is not root-frozen");
  let value;
  try { value = JSON.parse(artifact.bytes.toString("utf8")); } catch { fail("prospective baseline candidate is not JSON"); }
  validateProspectiveBaseline(value);
  const { artifactSha256 } = value;
  if (value.schemaVersion === 'competition-score-prospective-baseline.v2') {
    for (const member of [...value.sourceSnapshot.files, ...value.datasets.files]) {
      const source = await hashOrdinaryFile(path.join(sourceRoot, member.path), { label: 'prospective v2 bound source' });
      if (source.sha256 !== member.sha256) fail(`prospective v2 bound source changed: ${member.path}`);
    }
  }
  return {
    path: PROSPECTIVE_BASELINE_MEMBER,
    byteSha256: artifact.sha256,
    artifactSha256,
    bytes: artifact.bytes
  };
}

async function ensureReadOnlyViewDirectory(root, relative, buildIdentity) {
  const parts = relative ? relative.split("/") : [];
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    await mkdir(current, { mode: 0o550 }).catch((error) => {
      if (error?.code !== "EEXIST") throw error;
    });
    const metadata = await lstat(current);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) fail(`unsafe builder-view directory: ${relative}`);
    await chown(current, 0, buildIdentity.gid);
    await chmod(current, 0o550);
  }
}

async function writeViewFile(filename, bytes, sourceMode, buildIdentity) {
  const mode = sourceMode & 0o111 ? 0o550 : 0o440;
  await writeFile(filename, bytes, { flag: "wx", mode });
  await chown(filename, 0, buildIdentity.gid);
  await chmod(filename, mode);
}

async function copyOwnerFrozenFileIndependently(source, destination, sourceMode, buildIdentity, expectedUid) {
  const before = await lstat(source, { bigint: true });
  if (
    !before.isFile()
    || before.isSymbolicLink()
    || before.uid !== BigInt(expectedUid)
    || (before.mode & 0o022n) !== 0n
    || before.size > BigInt(DEPENDENCY_COPY_FILE_LIMIT_BYTES)
  ) fail(`copy input is not a bounded owner-frozen ordinary file: ${source}`);

  const sourceHandle = await open(source, fsConstants.O_RDONLY | fsConstants.O_CLOEXEC | fsConstants.O_NOFOLLOW);
  let destinationHandle;
  try {
    const opened = await sourceHandle.stat({ bigint: true });
    for (const key of ["dev", "ino", "mode", "nlink", "size", "mtimeNs", "ctimeNs"]) {
      if (before[key] !== opened[key]) fail(`copy input changed while opening: ${source}`);
    }
    destinationHandle = await open(
      destination,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_CLOEXEC | fsConstants.O_NOFOLLOW,
      0o600
    );
    const digest = createHash("sha256");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let copiedBytes = 0;
    while (true) {
      const { bytesRead } = await sourceHandle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      copiedBytes += bytesRead;
      if (copiedBytes > DEPENDENCY_COPY_FILE_LIMIT_BYTES) fail(`copy input exceeded the reviewed per-file limit: ${source}`);
      digest.update(buffer.subarray(0, bytesRead));
      let written = 0;
      while (written < bytesRead) {
        const result = await destinationHandle.write(buffer, written, bytesRead - written, null);
        if (result.bytesWritten <= 0) fail(`independent file copy stopped early: ${source}`);
        written += result.bytesWritten;
      }
    }
    if (BigInt(copiedBytes) !== before.size) fail(`copy input size changed while reading: ${source}`);
    const openedAfter = await sourceHandle.stat({ bigint: true });
    const pathAfter = await lstat(source, { bigint: true });
    for (const key of ["dev", "ino", "mode", "nlink", "size", "mtimeNs", "ctimeNs"]) {
      if (before[key] !== openedAfter[key] || before[key] !== pathAfter[key]) fail(`copy input changed while reading: ${source}`);
    }
    const destinationMode = sourceMode & 0o111 ? 0o550 : 0o440;
    await destinationHandle.chown(0, buildIdentity.gid);
    await destinationHandle.chmod(destinationMode);
    const destinationOpened = await destinationHandle.stat({ bigint: true });
    const destinationPath = await lstat(destination, { bigint: true });
    if (
      destinationOpened.dev !== destinationPath.dev
      || destinationOpened.ino !== destinationPath.ino
      || !destinationOpened.isFile()
      || destinationOpened.isSymbolicLink()
      || destinationOpened.uid !== 0n
      || destinationOpened.gid !== BigInt(buildIdentity.gid)
      || (destinationOpened.mode & 0o7777n) !== BigInt(destinationMode)
      || destinationOpened.size !== before.size
    ) fail(`independent file copy is not root-frozen: ${destination}`);
    return { sha256: digest.digest("hex"), size: copiedBytes, destinationMode };
  } finally {
    await destinationHandle?.close().catch(() => undefined);
    await sourceHandle.close().catch(() => undefined);
  }
}

export function validateReadOnlyTreeMemberMetadata(metadata, relative, expectedUid = 0) {
  if (metadata.uid !== expectedUid || (!metadata.isSymbolicLink() && (metadata.mode & 0o022) !== 0)) {
    fail(`read-only dependency member is not owner-frozen: ${relative}`);
  }
}

export async function resolveContainedDependencySymlink(sourceMember, allowedRoot, relative) {
  const target = await readlink(sourceMember);
  if (!target || target !== target.normalize("NFC") || /[\0\r\n\t\\]/u.test(target) || path.isAbsolute(target)) {
    fail(`absolute or non-canonical dependency symlink is forbidden: ${relative}`);
  }
  const resolved = await realpath(path.resolve(path.dirname(sourceMember), target));
  if (resolved !== allowedRoot && !resolved.startsWith(`${allowedRoot}${path.sep}`)) {
    fail(`dependency symlink escapes its tree: ${relative}`);
  }
  return { target, resolved };
}

async function copyReadOnlyTree(source, destination, buildIdentity, allowedRoot, {
  allowSymlinks,
  maxTotalBytes,
  maxMembers,
  label,
  sourceUid = 0
}) {
  if (!Number.isSafeInteger(maxTotalBytes) || maxTotalBytes <= 0 || !Number.isSafeInteger(maxMembers) || maxMembers <= 0) {
    fail("read-only tree resource policy is invalid");
  }
  const sourceMetadata = await lstat(source);
  if (!sourceMetadata.isDirectory() || sourceMetadata.isSymbolicLink() || sourceMetadata.uid !== sourceUid || (sourceMetadata.mode & 0o022) !== 0) fail(`unsafe read-only tree: ${source}`);
  await mkdir(destination, { mode: 0o550 });
  await chown(destination, 0, buildIdentity.gid);
  await chmod(destination, 0o550);
  const destinationRoot = await realpath(destination);
  const copiedSymlinks = [];
  const manifestLines = [];
  let totalBytes = 0;
  let visitedMembers = 0;

  async function walk(from, to, relative, depth = 0) {
    if (depth > READ_ONLY_TREE_DEPTH_LIMIT) fail(`${label} nesting exceeds ${READ_ONLY_TREE_DEPTH_LIMIT}`);
    const before = await lstat(from, { bigint: true });
    const names = [];
    const handle = await opendir(from);
    for await (const entry of handle) {
      visitedMembers += 1;
      if (visitedMembers > maxMembers) fail(`${label} has more than ${maxMembers} members`);
      names.push(entry.name);
    }
    names.sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
    for (const name of names) {
      const sourceMember = path.join(from, name);
      const destinationMember = path.join(to, name);
      const nextRelative = relative ? `${relative}/${name}` : name;
      if (!safeManifestPath(nextRelative)) fail(`${label} contains an unsafe member name: ${nextRelative}`);
      const metadata = await lstat(sourceMember);
      validateReadOnlyTreeMemberMetadata(metadata, nextRelative, sourceUid);
      if (metadata.isDirectory() && !metadata.isSymbolicLink()) {
        await mkdir(destinationMember, { mode: 0o550 });
        await chown(destinationMember, 0, buildIdentity.gid);
        await chmod(destinationMember, 0o550);
        manifestLines.push(`D\t0550\t${nextRelative}`);
        await walk(sourceMember, destinationMember, nextRelative, depth + 1);
      } else if (metadata.isFile() && !metadata.isSymbolicLink()) {
        totalBytes += metadata.size;
        if (totalBytes > maxTotalBytes) fail(`${label} exceeds its ${maxTotalBytes}-byte aggregate limit`);
        // A pnpm store may hard-link immutable package files. Stable bytes are
        // copied into a new inode before any unprivileged code executes.
        const artifact = await copyOwnerFrozenFileIndependently(
          sourceMember,
          destinationMember,
          metadata.mode,
          buildIdentity,
          sourceUid
        );
        const destinationMode = artifact.destinationMode.toString(8).padStart(4, "0");
        manifestLines.push(`F\t${artifact.sha256}\t${destinationMode}\t${nextRelative}`);
      } else if (metadata.isSymbolicLink() && allowSymlinks) {
        const { target } = await resolveContainedDependencySymlink(sourceMember, allowedRoot, nextRelative);
        await symlink(target, destinationMember);
        const copiedMetadata = await lstat(destinationMember);
        if (!copiedMetadata.isSymbolicLink() || copiedMetadata.uid !== 0 || await readlink(destinationMember) !== target) {
          fail(`dependency symlink was not copied exactly: ${nextRelative}`);
        }
        copiedSymlinks.push({ destinationMember, nextRelative });
        manifestLines.push(`L\t${sha256(Buffer.from(target))}\t${target}\t${nextRelative}`);
      } else {
        fail(`special member is forbidden in read-only tree: ${nextRelative}`);
      }
    }
    const namesAfter = [];
    const handleAfter = await opendir(from);
    for await (const entry of handleAfter) namesAfter.push(entry.name);
    namesAfter.sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
    const after = await lstat(from, { bigint: true });
    if (JSON.stringify(namesAfter) !== JSON.stringify(names)) fail(`read-only tree membership changed: ${relative || "."}`);
    for (const key of ["dev", "ino", "mode", "nlink", "size", "mtimeNs", "ctimeNs"]) if (before[key] !== after[key]) fail(`read-only tree changed: ${relative || "."}`);
  }

  await walk(source, destination, "");
  for (const { destinationMember, nextRelative } of copiedSymlinks) {
    const resolved = await realpath(destinationMember);
    if (resolved !== destinationRoot && !resolved.startsWith(`${destinationRoot}${path.sep}`)) {
      fail(`copied dependency symlink escapes its destination tree: ${nextRelative}`);
    }
  }
  manifestLines.sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
  return {
    manifestSha256: sha256(Buffer.from(`${manifestLines.join("\n")}\n`)),
    members: visitedMembers,
    totalBytes,
    symlinks: copiedSymlinks.length
  };
}

async function observeProjectToolchain(nodeModulesRoot, policy) {
  const frozenRoot = await realpath(nodeModulesRoot);
  const observed = [];
  const byId = new Map();
  for (const tool of policy.tools) {
    if (!tool.packagePath.startsWith("node_modules/") || !safeManifestPath(tool.packagePath) || !safeManifestPath(tool.binTarget)) {
      fail(`project-toolchain policy contains an unsafe package/bin path: ${tool.id}`);
    }
    const logicalPackageRoot = path.join(frozenRoot, ...tool.packagePath.slice("node_modules/".length).split("/"));
    const packageRoot = await realpath(logicalPackageRoot);
    if (packageRoot !== frozenRoot && !packageRoot.startsWith(`${frozenRoot}${path.sep}`)) {
      fail(`project-toolchain package escapes the frozen dependency tree: ${tool.id}`);
    }
    const packageJsonPath = path.join(packageRoot, "package.json");
    const packageArtifact = await hashOrdinaryFile(packageJsonPath, {
      maxBytes: REQUIRED_TEST_MANIFEST_LIMIT_BYTES,
      label: `project-toolchain package metadata ${tool.id}`
    });
    let packageJson;
    try { packageJson = JSON.parse(packageArtifact.bytes.toString("utf8")); } catch { fail(`project-toolchain package metadata is not JSON: ${tool.id}`); }
    const actualBinTarget = typeof packageJson?.bin === "object" && !Array.isArray(packageJson.bin)
      ? packageJson.bin[tool.binName]
      : undefined;
    if (
      packageJson?.name !== tool.packageName
      || packageJson?.version !== tool.version
      || typeof actualBinTarget !== "string"
      || actualBinTarget.replace(/^\.\//u, "") !== tool.binTarget
    ) fail(`project-toolchain package identity/bin mapping differs from policy: ${tool.id}`);
    const binPath = await realpath(path.join(packageRoot, ...tool.binTarget.split("/")));
    if (binPath !== frozenRoot && !binPath.startsWith(`${frozenRoot}${path.sep}`)) {
      fail(`project-toolchain executable escapes the frozen dependency tree: ${tool.id}`);
    }
    const binArtifact = await hashOrdinaryFile(binPath, {
      maxBytes: CONTROL_FILE_LIMIT_BYTES,
      label: `project-toolchain executable ${tool.id}`
    });
    if (binArtifact.metadata.uid !== 0n || (binArtifact.metadata.mode & 0o7022n) !== 0n) {
      fail(`project-toolchain executable is not root-frozen: ${tool.id}`);
    }
    const binRelativePath = path.relative(frozenRoot, binPath).split(path.sep).join("/");
    const packageRealPath = path.relative(frozenRoot, packageRoot).split(path.sep).join("/");
    if (!safeManifestPath(binRelativePath) || !safeManifestPath(packageRealPath)) {
      fail(`project-toolchain observed path is not canonical: ${tool.id}`);
    }
    const identity = {
      id: tool.id,
      packageName: tool.packageName,
      packagePath: tool.packagePath,
      packageRealPath,
      version: tool.version,
      packageJsonSha256: packageArtifact.sha256,
      binName: tool.binName,
      binTarget: tool.binTarget,
      binRelativePath,
      binSha256: binArtifact.sha256
    };
    observed.push(identity);
    byId.set(tool.id, { ...identity, binAbsolutePath: binPath });
  }
  return { observed, byId };
}

function dependencySandboxEnvironment({ home, cache, browserPath, skipBrowserDownload = true, overrides = {} }) {
  return {
    HOME: home,
    PATH: BUILDER_PATH,
    CI: "1",
    LANG: "C",
    LC_ALL: "C",
    XDG_CACHE_HOME: cache,
    XDG_CONFIG_HOME: path.join(home, "config"),
    PNPM_HOME: path.join(home, "pnpm"),
    COREPACK_HOME: path.join(home, "corepack"),
    npm_config_userconfig: "/dev/null",
    NPM_CONFIG_USERCONFIG: "/dev/null",
    npm_config_globalconfig: "/dev/null",
    NPM_CONFIG_GLOBALCONFIG: "/dev/null",
    npm_config_registry: `https://${NPM_REGISTRY_HOST}/`,
    NPM_CONFIG_REGISTRY: `https://${NPM_REGISTRY_HOST}/`,
    npm_config_ignore_scripts: "true",
    NPM_CONFIG_IGNORE_SCRIPTS: "true",
    npm_config_engine_strict: "true",
    NPM_CONFIG_ENGINE_STRICT: "true",
    ...(skipBrowserDownload ? { PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1" } : {}),
    ...(browserPath ? { PLAYWRIGHT_BROWSERS_PATH: browserPath } : {}),
    ...overrides
  };
}

async function makeBuildOwnedDirectory(filename, buildIdentity) {
  await mkdir(filename, { mode: 0o700 });
  await chown(filename, buildIdentity.uid, buildIdentity.gid);
  await chmod(filename, 0o700);
  return filename;
}

async function prepareTrustedDependencies({
  sourceRoot,
  sourceState,
  projectToolchainPolicy,
  projectToolchainArtifactSha256,
  workRoot,
  buildIdentity,
  output,
  logs,
  runId
}) {
  const controlRoot = path.join(workRoot, "dependency-control");
  await mkdir(controlRoot, { mode: 0o550 });
  await chown(controlRoot, 0, buildIdentity.gid);
  await chmod(controlRoot, 0o550);
  // The fixed test setup is an execution input as well as a source pin. These
  // directories are created only inside this new root-owned control tree;
  // package fetch/install still runs --ignore-scripts and --ignore-pnpmfile.
  for (const relative of ["tests", "tests/fixtures"]) {
    const directory = path.join(controlRoot, relative);
    await mkdir(directory, { mode: 0o550 });
    await chown(directory, 0, buildIdentity.gid);
    await chmod(directory, 0o550);
  }
  const inputs = [];
  for (const relative of DEPENDENCY_INPUT_MEMBERS) {
    const reviewed = sourceState.entries.find((entry) => entry.relative === relative);
    const authority = projectToolchainPolicy.inputs.find((entry) => entry.path === relative);
    if (!reviewed) fail(`reviewed source manifest lacks dependency input: ${relative}`);
    const artifact = await hashOrdinaryFile(path.join(sourceRoot, relative), {
      maxBytes: CONTROL_FILE_LIMIT_BYTES,
      label: `dependency input ${relative}`
    });
    if (!authority || artifact.sha256 !== reviewed.sha256 || artifact.sha256 !== authority.sha256) {
      fail(`dependency input differs from the reviewed fixed execution authority: ${relative}`);
    }
    await writeViewFile(path.join(controlRoot, relative), artifact.bytes, Number(artifact.metadata.mode), buildIdentity);
    inputs.push({ path: relative, sha256: artifact.sha256 });
  }

  const dependencyWritable = await makeBuildOwnedDirectory(path.join(workRoot, "dependency-writable"), buildIdentity);
  const store = await makeBuildOwnedDirectory(path.join(dependencyWritable, "store"), buildIdentity);
  const modules = await makeBuildOwnedDirectory(path.join(dependencyWritable, "node-modules"), buildIdentity);
  const installHome = await makeBuildOwnedDirectory(path.join(dependencyWritable, "install-home"), buildIdentity);
  const installCache = await makeBuildOwnedDirectory(path.join(dependencyWritable, "install-cache"), buildIdentity);
  const browserWritable = await makeBuildOwnedDirectory(path.join(workRoot, "browser-writable"), buildIdentity);
  const browserOutput = await makeBuildOwnedDirectory(path.join(browserWritable, "browsers"), buildIdentity);
  const browserHome = await makeBuildOwnedDirectory(path.join(browserWritable, "home"), buildIdentity);
  const browserCache = await makeBuildOwnedDirectory(path.join(browserWritable, "cache"), buildIdentity);
  const modulesTarget = path.join(controlRoot, "node_modules");
  await mkdir(modulesTarget, { mode: 0o550 });
  await chown(modulesTarget, 0, buildIdentity.gid);
  await chmod(modulesTarget, 0o550);
  const modulesBinding = [{ source: modules, target: modulesTarget }];
  // pnpm must record links through the path visible inside the transient unit.
  // Using the bind source path here would bake alias-relative links that stop
  // resolving after the independently copied dependency tree is relocated.
  const virtualStore = path.join(modulesTarget, ".pnpm");
  const installEnvironment = dependencySandboxEnvironment({ home: installHome, cache: installCache });
  const commonPnpmFlags = [
    "--frozen-lockfile",
    "--ignore-scripts",
    "--ignore-pnpmfile",
    `--store-dir=${store}`,
    `--virtual-store-dir=${virtualStore}`,
    "--config.manage-package-manager-versions=false",
    "--config.verify-store-integrity=true",
    "--reporter=append-only"
  ];
  const semanticPnpmFlags = [
    "--frozen-lockfile",
    "--ignore-scripts",
    "--ignore-pnpmfile",
    "--store-dir=<ephemeral-store>",
    "--virtual-store-dir=<ephemeral-node_modules/.pnpm>",
    "--config.manage-package-manager-versions=false",
    "--config.verify-store-integrity=true",
    "--reporter=append-only"
  ];
  const registryAddresses = await resolveHost(NPM_REGISTRY_HOST);
  const registryHosts = await createHostsFile(workRoot, "dependency-registry", {
    [NPM_REGISTRY_HOST]: registryAddresses
  });
  const fetchGate = await runSandboxed({
    name: "dependency-fetch",
    unit: `resume-ai-evidence-dependency-fetch-${path.basename(workRoot).slice(-12)}.service`,
    identity: buildIdentity,
    cwd: controlRoot,
    environment: installEnvironment,
    executable: REQUIRED_NODE_PATH,
    argv: [REQUIRED_PNPM_ENTRYPOINT, "fetch", ...commonPnpmFlags],
    semanticCommand: {
      executable: REQUIRED_NODE_PATH,
      argv: [REQUIRED_PNPM_ENTRYPOINT, "fetch", ...semanticPnpmFlags]
    },
    logPath: path.join(logs, "dependency-fetch.log"),
    writablePaths: [dependencyWritable],
    readOnlyRoot: controlRoot,
    binds: modulesBinding,
    privateNetwork: false,
    networkAllow: registryAddresses,
    hostsFile: registryHosts,
    inaccessiblePaths: [`-${sourceRoot}`, "-/usr/bin/git", "-/usr/bin/ssh", "-/usr/bin/curl"]
  });

  const offlineFlags = ["--offline", "--package-import-method=copy", ...commonPnpmFlags];
  const semanticOfflineFlags = ["--offline", "--package-import-method=copy", ...semanticPnpmFlags];
  const installGate = await runSandboxed({
    name: "dependency-offline-install",
    unit: `resume-ai-evidence-dependency-install-${path.basename(workRoot).slice(-12)}.service`,
    identity: buildIdentity,
    cwd: controlRoot,
    environment: installEnvironment,
    executable: REQUIRED_NODE_PATH,
    argv: [REQUIRED_PNPM_ENTRYPOINT, "install", ...offlineFlags],
    semanticCommand: {
      executable: REQUIRED_NODE_PATH,
      argv: [REQUIRED_PNPM_ENTRYPOINT, "install", ...semanticOfflineFlags]
    },
    logPath: path.join(logs, "dependency-offline-install.log"),
    writablePaths: [dependencyWritable],
    readOnlyRoot: controlRoot,
    binds: modulesBinding,
    privateNetwork: true,
    inaccessiblePaths: [`-${sourceRoot}`, "-/usr/bin/git", "-/usr/bin/ssh", "-/usr/bin/curl"]
  });

  const trustedModules = path.join(workRoot, "trusted-node-modules");
  const dependencyTree = await copyReadOnlyTree(
    modules,
    trustedModules,
    buildIdentity,
    await realpath(modules),
    {
      allowSymlinks: true,
      maxTotalBytes: DEPENDENCY_COPY_TOTAL_LIMIT_BYTES,
      maxMembers: READ_ONLY_TREE_MEMBER_LIMIT,
      label: "fresh offline dependency tree",
      sourceUid: buildIdentity.uid
    }
  );
  if (dependencyTree.members === 0 || dependencyTree.totalBytes === 0) fail("fresh offline dependency tree is empty");
  const trustedModulesRoot = await realpath(trustedModules);
  const projectToolchain = await observeProjectToolchain(trustedModulesRoot, projectToolchainPolicy);
  const playwrightCli = projectToolchain.byId.get("playwright")?.binAbsolutePath;
  if (!playwrightCli) fail("fixed Playwright CLI identity is missing from the frozen dependency tree");
  const playwrightCliBefore = await hashOrdinaryFile(playwrightCli, {
    maxBytes: CONTROL_FILE_LIMIT_BYTES,
    label: "fresh Playwright CLI"
  });

  const browserAddressesByHost = Object.fromEntries(await Promise.all(
    PLAYWRIGHT_DOWNLOAD_HOSTS.map(async (hostname) => [hostname, await resolveHost(hostname)])
  ));
  const browserAddresses = [...new Set(Object.values(browserAddressesByHost).flat())].sort();
  const browserHosts = await createHostsFile(workRoot, "playwright-browser-download", browserAddressesByHost);
  const browserGate = await runSandboxed({
    name: "playwright-browser-fetch",
    unit: `resume-ai-evidence-browser-fetch-${path.basename(workRoot).slice(-12)}.service`,
    identity: buildIdentity,
    cwd: controlRoot,
    environment: dependencySandboxEnvironment({
      home: browserHome,
      cache: browserCache,
      browserPath: browserOutput,
      skipBrowserDownload: false,
      overrides: { NODE_ENV: "production" }
    }),
    executable: REQUIRED_NODE_PATH,
    argv: [playwrightCli, "install", "chromium"],
    semanticCommand: {
      executable: REQUIRED_NODE_PATH,
      argv: ["<frozen-node_modules>/playwright/cli.js", "install", "chromium"],
      executableSha256: playwrightCliBefore.sha256
    },
    logPath: path.join(logs, "playwright-browser-fetch.log"),
    writablePaths: [browserWritable],
    readOnlyRoot: trustedModulesRoot,
    privateNetwork: false,
    networkAllow: browserAddresses,
    hostsFile: browserHosts,
    inaccessiblePaths: [`-${sourceRoot}`, `-${modules}`, `-${store}`, "-/usr/bin/git", "-/usr/bin/ssh", "-/usr/bin/curl"]
  });
  const playwrightCliAfter = await hashOrdinaryFile(playwrightCli, {
    maxBytes: CONTROL_FILE_LIMIT_BYTES,
    label: "fresh Playwright CLI"
  });
  if (playwrightCliAfter.sha256 !== playwrightCliBefore.sha256) fail("frozen Playwright CLI changed during browser generation");

  const trustedBrowsers = path.join(workRoot, "trusted-playwright-browsers");
  const browserTree = await copyReadOnlyTree(
    browserOutput,
    trustedBrowsers,
    buildIdentity,
    await realpath(browserOutput),
    {
      allowSymlinks: true,
      maxTotalBytes: BROWSER_COPY_TOTAL_LIMIT_BYTES,
      maxMembers: BROWSER_TREE_MEMBER_LIMIT,
      label: "fresh Playwright browser tree",
      sourceUid: buildIdentity.uid
    }
  );
  if (browserTree.members === 0 || browserTree.totalBytes === 0) fail("fresh Playwright browser tree is empty");
  const trustedBrowserDestination = path.join(trustedModulesRoot, PLAYWRIGHT_BROWSER_DIRECTORY);
  if (await lstat(trustedBrowserDestination).then(() => true, () => false)) fail("dependency tree already contains the reserved browser directory");
  await rename(trustedBrowsers, trustedBrowserDestination);
  const trustedBrowserMetadata = await lstat(trustedBrowserDestination);
  if (!trustedBrowserMetadata.isDirectory() || trustedBrowserMetadata.isSymbolicLink() || trustedBrowserMetadata.uid !== 0 || (trustedBrowserMetadata.mode & 0o022) !== 0) {
    fail("fresh browser generation was not merged as a root-frozen tree");
  }

  const nodeArtifact = await hashOrdinaryFile(REQUIRED_NODE_PATH, {
    maxBytes: TOOLCHAIN_FILE_LIMIT_BYTES,
    label: "Node executable"
  });
  const pnpmArtifact = await hashOrdinaryFile(REQUIRED_PNPM_ENTRYPOINT, {
    maxBytes: CONTROL_FILE_LIMIT_BYTES,
    label: "pnpm entrypoint"
  });
  const provenanceCreatedAt = isoNow();
  const receipt = {
    schemaVersion: 1,
    evidenceType: "release-dependency-provenance",
    status: "passed",
    runId,
    createdAt: provenanceCreatedAt,
    sourceManifestSha256: sourceState.sourceManifestSha256,
    sourceModeManifestSha256: sourceState.sourceModeManifestSha256,
    sourceModeMemberCount: sourceState.sourceModeMemberCount,
    inputs,
    toolchain: {
      node: { path: REQUIRED_NODE_PATH, version: process.version, sha256: nodeArtifact.sha256 },
      pnpm: { path: REQUIRED_PNPM_ENTRYPOINT, version: REQUIRED_PNPM, sha256: pnpmArtifact.sha256 }
    },
    networkPolicy: {
      dependencyRegistry: `https://${NPM_REGISTRY_HOST}/`,
      browserDownloadHosts: PLAYWRIGHT_DOWNLOAD_HOSTS
    },
    projectToolchainPolicy: {
      installedPath: REQUIRED_TESTS_PATH,
      sourceMember: REQUIRED_TESTS_MEMBER,
      artifactSha256: projectToolchainArtifactSha256,
      jsonPointer: "/projectToolchain",
      policyId: projectToolchainPolicy.policyId,
      sha256: projectToolchainPolicy.sha256
    },
    observedTools: projectToolchain.observed,
    dependencyFetch: {
      command: fetchGate.result.command,
      rawLog: fetchGate.result.rawLog,
      rawLogSha256: fetchGate.result.rawLogSha256
    },
    offlineInstall: {
      command: installGate.result.command,
      privateNetwork: true,
      packageImportMethod: "copy",
      rawLog: installGate.result.rawLog,
      rawLogSha256: installGate.result.rawLogSha256
    },
    nodeModules: {
      manifestSha256: dependencyTree.manifestSha256,
      members: dependencyTree.members,
      totalBytes: dependencyTree.totalBytes,
      symlinks: dependencyTree.symlinks,
      owner: "root",
      ambientInputUsed: false
    },
    browserFetch: {
      command: browserGate.result.command,
      playwrightCliSha256: playwrightCliBefore.sha256,
      rawLog: browserGate.result.rawLog,
      rawLogSha256: browserGate.result.rawLogSha256
    },
    browsers: {
      relativePath: `node_modules/${PLAYWRIGHT_BROWSER_DIRECTORY}`,
      manifestSha256: browserTree.manifestSha256,
      members: browserTree.members,
      totalBytes: browserTree.totalBytes,
      symlinks: browserTree.symlinks,
      owner: "root",
      ambientInputUsed: false
    }
  };
  const receiptPath = path.join(output, "dependency-provenance-receipt.json");
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  const receiptSha256 = (await hashOrdinaryFile(receiptPath, {
    maxBytes: CONTROL_FILE_LIMIT_BYTES,
    label: "dependency provenance receipt"
  })).sha256;
  const provenanceLog = Buffer.from(`${JSON.stringify({
    event: "release_dependency_provenance",
    status: "passed",
    receiptSha256,
    nodeModulesManifestSha256: dependencyTree.manifestSha256,
    browserManifestSha256: browserTree.manifestSha256,
    ambientInputUsed: false
  })}\n`);
  const provenanceLogPath = path.join(logs, "dependency-provenance.log");
  await writeFile(provenanceLogPath, provenanceLog, { flag: "wx", mode: 0o600 });
  const completedAt = isoNow();
  const provenanceGate = {
    name: "dependency-provenance",
    command: { executable: REQUIRED_COORDINATOR_PATH, argv: ["verify-fresh-dependency-generation"] },
    execution: { launcher: "trusted-coordinator", uid: "root", candidateCodeExecuted: false },
    startedAt: fetchGate.result.startedAt,
    completedAt,
    exitCode: 0,
    rawLog: "validation-logs/dependency-provenance.log",
    rawLogSha256: sha256(provenanceLog),
    receipt: "dependency-provenance-receipt.json",
    receiptSha256
  };
  return {
    nodeModules: trustedModulesRoot,
    browsers: trustedBrowserDestination,
    receipt: "dependency-provenance-receipt.json",
    receiptSha256,
    nodeModulesManifestSha256: dependencyTree.manifestSha256,
    browserManifestSha256: browserTree.manifestSha256,
    projectToolchainPolicySha256: projectToolchainPolicy.sha256,
    observedTools: projectToolchain.observed,
    toolBinRelativePaths: Object.fromEntries(projectToolchain.observed.map((tool) => [tool.id, {
      binRelativePath: tool.binRelativePath,
      binSha256: tool.binSha256
    }])),
    gates: [fetchGate.result, installGate.result, browserGate.result, provenanceGate]
  };
}

async function prepareBuilderView({ sourceRoot, sourceState, baseline, workRoot, buildIdentity, trustedDependencies }) {
  const view = path.join(workRoot, "source");
  const writable = path.join(workRoot, "writable");
  await mkdir(view, { mode: 0o550 });
  await chown(view, 0, buildIdentity.gid);
  await mkdir(writable, { mode: 0o700 });
  await chown(writable, buildIdentity.uid, buildIdentity.gid);
  for (const member of sourceState.members) {
    const parent = path.posix.dirname(member.relative);
    if (parent !== ".") await ensureReadOnlyViewDirectory(view, parent, buildIdentity);
    const sourceArtifact = await hashOrdinaryFile(path.join(sourceRoot, ...member.relative.split("/")), {
      label: `reviewed source member ${member.relative}`
    });
    if (sourceArtifact.sha256 !== member.sha256) fail(`source member changed before builder copy: ${member.relative}`);
    await writeViewFile(path.join(view, ...member.relative.split("/")), sourceArtifact.bytes, member.mode, buildIdentity);
  }
  await ensureReadOnlyViewDirectory(view, path.posix.dirname(PROSPECTIVE_BASELINE_MEMBER), buildIdentity);
  await writeViewFile(path.join(view, ...PROSPECTIVE_BASELINE_MEMBER.split("/")), baseline.bytes, 0o640, buildIdentity);

  const sourceGit = path.join(sourceRoot, ".git");
  await copyReadOnlyTree(sourceGit, path.join(view, ".git"), buildIdentity, await realpath(sourceGit), {
    allowSymlinks: false,
    maxTotalBytes: GIT_COPY_TOTAL_LIMIT_BYTES,
    maxMembers: READ_ONLY_TREE_MEMBER_LIMIT,
    label: "Git metadata tree"
  });
  const modules = path.join(view, "node_modules");
  if (await lstat(modules).then(() => true, () => false)) fail("builder view already contains node_modules before trusted dependency merge");
  await rename(trustedDependencies.nodeModules, modules);
  const modulesMetadata = await lstat(modules);
  if (!modulesMetadata.isDirectory() || modulesMetadata.isSymbolicLink() || modulesMetadata.uid !== 0 || modulesMetadata.gid !== buildIdentity.gid || (modulesMetadata.mode & 0o022) !== 0) {
    fail("fresh dependency generation is not root-frozen in the builder view");
  }
  const browsers = path.join(modules, PLAYWRIGHT_BROWSER_DIRECTORY);
  if (await realpath(browsers) !== path.join(modules, PLAYWRIGHT_BROWSER_DIRECTORY)) fail("fresh browser generation moved outside the builder view");
  const tools = {};
  for (const [id, expected] of Object.entries(trustedDependencies.toolBinRelativePaths)) {
    const executable = await realpath(path.join(modules, ...expected.binRelativePath.split("/")));
    if (executable !== modules && !executable.startsWith(`${modules}${path.sep}`)) {
      fail(`project-toolchain executable moved outside the builder view: ${id}`);
    }
    const artifact = await hashOrdinaryFile(executable, {
      maxBytes: CONTROL_FILE_LIMIT_BYTES,
      label: `builder project-toolchain executable ${id}`
    });
    if (artifact.sha256 !== expected.binSha256) fail(`project-toolchain executable changed during builder relocation: ${id}`);
    tools[id] = { executable, relativePath: expected.binRelativePath, sha256: expected.binSha256 };
  }

  const mounts = {};
  for (const [name, relative] of [["next", ".next"], ["worker", "dist"], ["nextE2e", ".next-e2e"], ["testResults", "test-results"], ["viteCache", "node_modules/.vite"]]) {
    await ensureReadOnlyViewDirectory(view, relative, buildIdentity);
    const output = path.join(writable, name);
    await mkdir(output, { mode: 0o700 });
    await chown(output, buildIdentity.uid, buildIdentity.gid);
    mounts[name] = { source: output, target: path.join(view, ...relative.split("/")) };
  }
  // Test-generated public evidence is not a source input or a delivery member.
  // The target starts empty; only the unit gate receives this extra bind.
  await ensureReadOnlyViewDirectory(view, "artifacts", buildIdentity);
  if ((await readdir(path.join(view, "artifacts"))).length !== 0) fail("unit artifact target must start empty");
  const unitArtifactsSource = path.join(workRoot, "unit-artifacts");
  await mkdir(unitArtifactsSource, { mode: 0o700 });
  await chown(unitArtifactsSource, buildIdentity.uid, buildIdentity.gid);
  const unitArtifacts = { source: unitArtifactsSource, target: path.join(view, "artifacts") };
  const home = path.join(writable, "home");
  await mkdir(home, { mode: 0o700 });
  await chown(home, buildIdentity.uid, buildIdentity.gid);
  return {
    view,
    writable,
    home,
    mounts,
    unitArtifacts,
    browsers,
    tools,
    dependencyProvenance: trustedDependencies,
    buildUid: buildIdentity.uid,
    originalSourceRoot: sourceRoot
  };
}

function validateEnvironment(environment) {
  const entries = [];
  for (const [key, value] of Object.entries(environment)) {
    if (!/^[A-Z][A-Z0-9_]*$/u.test(key) || typeof value !== "string" || /[\0\r\n]/u.test(value)) fail(`unsafe sandbox environment entry: ${key}`);
    entries.push(`${key}=${value}`);
  }
  return entries.sort((left, right) => left.localeCompare(right));
}

function commonSandboxProperties({ writablePaths, privateNetwork, joinUnit, networkAllow, hostsFile, readOnlyRoot, allowNamespaces, credentialsPresent, inaccessiblePaths }) {
  const inaccessible = [
    "-/opt/resume-ai/releases",
    "-/opt/resume-ai/current",
    "-/etc/resume-ai",
    "-/home/ubuntu/resume-ai-web-releases",
    "-/run/postgresql",
    "-/var/run/postgresql",
    ...inaccessiblePaths
  ];
  if (!credentialsPresent) inaccessible.push("-/run/credentials");
  const properties = [
    "KillMode=control-group",
    "NoNewPrivileges=yes",
    "PrivateTmp=yes",
    "PrivateDevices=yes",
    "ProtectHome=yes",
    "ProtectSystem=strict",
    "ProtectKernelTunables=yes",
    "ProtectKernelModules=yes",
    "ProtectControlGroups=yes",
    "ProtectKernelLogs=yes",
    "ProtectClock=yes",
    "ProtectHostname=yes",
    "ProtectProc=invisible",
    "ProcSubset=pid",
    "RestrictSUIDSGID=yes",
    "LockPersonality=yes",
    "RestrictRealtime=yes",
    "RemoveIPC=yes",
    "CapabilityBoundingSet=",
    "UMask=0077",
    "TasksMax=768",
    "MemoryMax=4G",
    "RuntimeMaxSec=7200",
    `ReadOnlyPaths=${readOnlyRoot}`,
    `InaccessiblePaths=${inaccessible.join(" ")}`
  ];
  properties.push(allowNamespaces ? "RestrictNamespaces=mnt pid user ipc" : "RestrictNamespaces=yes");
  for (const writablePath of writablePaths) properties.push(`ReadWritePaths=${writablePath}`);
  if (privateNetwork) properties.push("PrivateNetwork=yes", "RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6");
  if (joinUnit) properties.push(`JoinsNamespaceOf=${joinUnit}`);
  if (networkAllow?.length) {
    properties.push("IPAddressDeny=any", "RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6");
    for (const address of networkAllow) properties.push(`IPAddressAllow=${address}`);
  }
  if (hostsFile) properties.push(`BindReadOnlyPaths=${hostsFile}:/etc/hosts`);
  return properties;
}

async function runSandboxed({
  name,
  unit,
  identity,
  cwd,
  environment,
  executable,
  argv,
  semanticCommand,
  logPath,
  writablePaths = [],
  readOnlyRoot,
  binds = [],
  privateNetwork = true,
  joinUnit,
  networkAllow,
  hostsFile,
  credentials = [],
  extraProperties = [],
  assertIdentityIdle = true,
  allowNamespaces = false,
  inaccessiblePaths = []
}) {
  const startedAt = isoNow();
  const properties = commonSandboxProperties({
    writablePaths,
    privateNetwork,
    joinUnit,
    networkAllow,
    hostsFile,
    readOnlyRoot,
    allowNamespaces,
    credentialsPresent: credentials.length > 0,
    inaccessiblePaths
  });
  for (const binding of binds) properties.push(`BindPaths=${binding.source}:${binding.target}`);
  properties.push(...extraProperties);
  const systemdArgv = [
    "--quiet", "--wait", "--collect", "--pipe", "--service-type=exec",
    `--unit=${unit}`,
    `--uid=${identity.account}`,
    `--gid=${identity.account}`,
    `--working-directory=${cwd}`
  ];
  for (const property of properties) systemdArgv.push(`--property=${property}`);
  for (const credential of credentials) systemdArgv.push(`--property=LoadCredential=${credential.name}:${credential.path}`);
  systemdArgv.push(ENV_BIN, "-i", ...validateEnvironment(environment), executable, ...argv);
  const execution = await spawnCaptured(SYSTEMD_RUN, systemdArgv, { unit });
  const completedAt = isoNow();
  const bytes = Buffer.concat([
    Buffer.from("[stdout]\n"), execution.stdout,
    execution.stdout.length && execution.stdout.at(-1) !== 0x0a ? Buffer.from("\n") : Buffer.alloc(0),
    Buffer.from("[stderr]\n"), execution.stderr,
    execution.stderr.length && execution.stderr.at(-1) !== 0x0a ? Buffer.from("\n") : Buffer.alloc(0)
  ]);
  if (logPath) await writeFile(logPath, bytes, { flag: "wx", mode: 0o600 });
  if (assertIdentityIdle) await assertAccountIdle(identity);
  const result = {
    name,
    command: semanticCommand,
    execution: {
      launcher: SYSTEMD_RUN,
      unit,
      uid: identity.account,
      environment: "env-i",
      sourceReadOnly: true,
      privateNetwork,
      ipAddressDeny: networkAllow?.length ? "any" : null,
      credentialTransport: credentials.length ? "systemd-LoadCredential" : "none",
      repositoryVerifier: name === "deepseek-preflight" ? false : null
    },
    startedAt,
    completedAt,
    exitCode: execution.exitCode,
    ...(logPath ? { rawLog: `validation-logs/${path.basename(logPath)}`, rawLogSha256: sha256(bytes) } : {})
  };
  if (execution.exitCode !== 0) fail(`release validation gate failed: ${name}`);
  return { result, rawLog: bytes, stdout: execution.stdout, stderr: execution.stderr };
}

const NATIVE_V7_ASSERTIONS = Object.freeze([
  'runtime has v7 S/I/U without DELETE/TRUNCATE/DDL',
  'actual read-only SQL accepts the complete migrated schema',
  'read-only SQL rejects plaintext',
  'read-only SQL rejects lost-call-parent',
  'read-only SQL rejects lost-idempotency',
  'read-only SQL rejects lost-cipher-cap',
  'read-only SQL rejects missing full grant evidence predicate',
  'read-only SQL rejects weakened full grant evidence predicate',
  'Node cleanup respects child FKs and retains the paid ledger',
  'installed SQL cleanup converges across committed batches without deleting spend',
  'production app.env and PM2 clean env reach the actual high-grant gate; DB formal cap wins; zero dispatch',
  'built worker stays paused before switch, activates, and pauses on rollback',
  'worker exits cleanly on SIGTERM',
]);
const NATIVE_V7_EFFORT_ASSERTIONS = Object.freeze([...NATIVE_V7_ASSERTIONS, 'stage effort app.env and PM2 reach the actual policy-bound reserve gate; DB cap wins; zero dispatch']);
const NATIVE_V7_TOP5_ASSERTIONS = Object.freeze([...NATIVE_V7_EFFORT_ASSERTIONS, 'top5 app.env and PM2 reach the actual LLL policy-bound reserve gate; DB cap wins; zero dispatch']);
const NATIVE_V7_UNBOUNDED_ASSERTIONS = Object.freeze([...NATIVE_V7_TOP5_ASSERTIONS, 'user-unbounded app.env and PM2 reserve beyond finite caps while physical unknown holds remain protected; zero dispatch']);

export function validateNativeV7PostgresEvidence(result, log, sourceHashes, workerBuild) {
  const unbounded=sourceHashes.has("db/migrations/20261109_spend_user_unbounded_execution.sql"), top5 = sourceHashes.has("db/migrations/20261109_spend_v7_top5_policy.sql"), stage = sourceHashes.has("src/lib/ai/effort-policy.mjs") || Object.hasOwn(workerBuild,"effortPolicySha256"), assertions=unbounded?NATIVE_V7_UNBOUNDED_ASSERTIONS:top5?NATIVE_V7_TOP5_ASSERTIONS:stage?NATIVE_V7_EFFORT_ASSERTIONS:NATIVE_V7_ASSERTIONS;
  if (!hasExactKeys(result, ["schemaVersion", "status", "database", "postgresVersion", "observations", "productionGrantChain", "workerBuild", "paidCalls", "productionTouched", "execution",...(stage?["stageGrantChain"]:[]),...(top5?["top5GrantChain"]:[]),...(unbounded?["userUnboundedGrantChain"]:[])])
    || result.schemaVersion !== (unbounded?"saitu.v7-ops-local-evidence.v4":top5?"saitu.v7-ops-local-evidence.v3":stage?"saitu.v7-ops-local-evidence.v2":"saitu.v7-ops-local-evidence.v1") || result.status !== "passed"
    || !/^saitu_v7_ops_[a-f0-9]{10}$/.test(result.database) || !/^14\./.test(result.postgresVersion)
    || JSON.stringify(result.observations) !== JSON.stringify(assertions) || result.paidCalls !== 0 || result.productionTouched !== false)
    fail("native v7 PostgreSQL14 evidence is incomplete or non-passing");
  const grant = result.productionGrantChain;
  if (!hasExactKeys(grant, ["syntheticGrantInDisposableDatabase", "phase", "configuredCalibrationCallLimit", "authoritativePgCallLimit", "authorizedReservations", "chargedMicros", "providerDispatches", "configurationOnlyNextSeal"])
    || grant.syntheticGrantInDisposableDatabase !== true || grant.phase !== "formal" || grant.configuredCalibrationCallLimit !== 1
    || grant.authoritativePgCallLimit !== 2 || grant.authorizedReservations !== 2 || grant.chargedMicros !== 0 || grant.providerDispatches !== 0 || grant.configurationOnlyNextSeal !== true)
    fail("native v7 high-grant authority chain differs");
  if (!hasExactKeys(result.workerBuild, ["sourceSha256", "artifactSha256",...(stage?["effortPolicySha256"]:[]),...(unbounded?["executionMode"]:[])])
    || result.workerBuild.sourceSha256 !== workerBuild.sourceSha256 || result.workerBuild.artifactSha256 !== workerBuild.artifactSha256)
    fail("native v7 worker differs from the uniform production build");
  if(stage){const g=result.stageGrantChain;
    if(!hasExactKeys(g,["syntheticGrantInDisposableDatabase","grantVersion","effortPolicySha256","rankEffort","authorizedReservations","chargedMicros","providerDispatches","configurationOnlyNextSeal"])||g.syntheticGrantInDisposableDatabase!==true||g.grantVersion!=="saitu.v7.effort.v1"||g.effortPolicySha256!==workerBuild.effortPolicySha256||result.workerBuild.effortPolicySha256!==workerBuild.effortPolicySha256||g.rankEffort!==workerBuild.effortPolicy?.rank||g.authorizedReservations!==2||g.chargedMicros!==0||g.providerDispatches!==0||g.configurationOnlyNextSeal!==true)fail("native stage effort authority chain differs");
  }
  if(top5){const g=result.top5GrantChain;
    if(!hasExactKeys(g,["syntheticGrantInDisposableDatabase","grantVersion","effortPolicySha256","rankEffort","authorizedReservations","chargedMicros","providerDispatches","configurationOnlyNextSeal"])||g.syntheticGrantInDisposableDatabase!==true||g.grantVersion!=="saitu.v7.top5.v1"||g.effortPolicySha256!==workerBuild.effortPolicySha256||g.effortPolicySha256!=="04962f576d20346af8a8f076ce64fdbda5aea13fdbd2fae39f3c7456fe30aa48"||g.rankEffort!=="low"||g.authorizedReservations!==2||g.chargedMicros!==0||g.providerDispatches!==0||g.configurationOnlyNextSeal!==true)fail("native top5 authority chain differs");
  }
  if(unbounded){const g=result.userUnboundedGrantChain;
    if(!hasExactKeys(g,["syntheticGrantInDisposableDatabase","grantVersion","executionMode","effortPolicySha256","rankEffort","authorizedReservations","chargedMicros","providerDispatches","configurationOnlyNextSeal","physicalUnknownHoldRejected"])||result.workerBuild.executionMode!=="user-unbounded"||workerBuild.executionMode!=="user-unbounded"||g.executionMode!=="user-unbounded"||g.syntheticGrantInDisposableDatabase!==true||g.grantVersion!=="saitu.v7.top5.user-unbounded.v1"||g.effortPolicySha256!==workerBuild.effortPolicySha256||g.rankEffort!=="low"||g.authorizedReservations!==3||g.chargedMicros!==0||g.providerDispatches!==0||g.configurationOnlyNextSeal!==true||g.physicalUnknownHoldRejected!==true)fail("native user-unbounded authority chain differs");
  }
  const execution = result.execution;
  if (!hasExactKeys(execution, ["platform", "arch", "node", "source", "sourceSha256", "rawLogSha256"])
    || execution.platform !== "linux" || execution.arch !== "x64" || execution.node !== "v24.20.0"
    || execution.source !== "tests/deployment/v7-ops-postgres.test.mjs"
    || execution.sourceSha256 !== sourceHashes.get(execution.source) || execution.rawLogSha256 !== sha256(log))
    fail("native v7 source, runtime or raw-log binding differs");
  const lines = log.toString("utf8").split(/\r?\n/).filter(Boolean);
  if (JSON.stringify(lines.filter(line => line.startsWith("PASS ")).map(line => line.slice(5))) !== JSON.stringify(assertions))
    fail("native v7 raw log lacks all required executed assertions");
  const footers = lines.filter(line => line.startsWith("{")).map(line => { try { return JSON.parse(line); } catch { return null; } });
  if (footers.length !== 1 || !hasExactKeys(footers[0], ["status", "observations", "paidCalls", "productionTouched", "result"])
    || footers[0].status !== "passed" || footers[0].observations !== assertions.length || footers[0].paidCalls !== 0 || footers[0].productionTouched !== false
    || !/^\/tmp\/saitu-v7-native-[A-Za-z0-9]+\/result\.json$/.test(footers[0].result))
    fail("native v7 completion marker differs");
  return true;
}

function secretFreeEnvironment(builder, overrides = {}) {
  return {
    HOME: builder.home,
    PATH: BUILDER_PATH,
    CI: "1",
    NODE_ENV: "test",
    npm_config_script_shell: "/bin/sh",
    NPM_CONFIG_SCRIPT_SHELL: "/bin/sh",
    npm_config_userconfig: "/dev/null",
    NPM_CONFIG_USERCONFIG: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_OPTIONAL_LOCKS: "0",
    DATABASE_URL: "",
    POSTGRES_SECURITY_STATE_TEST_DATABASE_URL: "",
    POSTGRES_SECURITY_STATE_RUNTIME_DATABASE_URL: "",
    SUPABASE_URL: "",
    SUPABASE_SERVICE_ROLE_KEY: "",
    AI_API_KEY: "",
    RUN_V7_DATABASE_TESTS: "0",
    RUN_V7_NATIVE_POSTGRES_TESTS: "0",
    V7_TEST_ADMIN_DATABASE_URL: "",
    V7_TEST_RUNTIME_DATABASE_URL: "",
    AI_CONSENT_SALT: "synthetic-release-evidence-consent-salt-000000000000000000",
    AI_CONVERSATION_SIGNING_SECRET: "synthetic-release-evidence-signing-secret-0000000000000000",
    LOG_HASH_SECRET: "synthetic-release-evidence-log-secret-0000000000000000000",
    AI_PROVIDER: "mock",
    AI_MODEL: "mock",
    AI_TEST_MODE: "0",
    ALLOW_AI_MOCK: "0",
    NEXT_PUBLIC_AI_TEST_MODE: "0",
    FEATURE_AI: "1",
    FEATURE_COMPETITION_RECOMMENDER: "1",
    NEXT_PUBLIC_SITE_URL: "https://siyuanjiaxin.com",
    PLAYWRIGHT_BROWSERS_PATH: builder.browsers,
    RELEASE_EVIDENCE_SANDBOX: "1",
    RELEASE_EVIDENCE_EXPECTED_UID: String(builder.buildUid),
    RELEASE_EVIDENCE_PRODUCTION_PATH: "/opt/resume-ai/releases",
    ...overrides
  };
}

export function projectToolOutputSandbox(builder, name, toolId) {
  const binding = builder.unitArtifacts;
  const expectedSource = path.join(path.dirname(builder.writable), "unit-artifacts");
  const expectedTarget = path.join(builder.view, "artifacts");
  if (!binding || binding.source !== expectedSource || binding.target !== expectedTarget
    || !path.isAbsolute(builder.view) || !path.isAbsolute(builder.writable)
    || path.resolve(builder.view) !== builder.view || path.resolve(builder.writable) !== builder.writable
    || path.resolve(binding.source) !== binding.source || path.resolve(binding.target) !== binding.target) fail("unit artifact output binding drift");
  const binds = Object.values(builder.mounts);
  const overlaps = (left, right) => left === right || left.startsWith(`${right}${path.sep}`) || right.startsWith(`${left}${path.sep}`);
  if (binds.some(row => overlaps(row.target, expectedTarget) || overlaps(row.source, expectedSource))) fail("unit artifact output became a common mount");
  if (name === "unit" && toolId !== "vitest") fail("unit artifact output requires the fixed unit test gate");
  return { binds: name === "unit" ? [...binds, binding] : binds,
    writablePaths: name === "unit" ? [builder.writable, binding.source] : [builder.writable],
    inaccessiblePaths: name === "unit" ? [] : [`-${binding.source}`] };
}

async function runPnpmGate({ name, argv, builder, buildIdentity, workRoot, logPath, environment, networkAllow, hostsFile, joinUnit }) {
  return runSandboxed({
    name,
    unit: `resume-ai-evidence-${name.replaceAll(/[^a-z0-9]/gu, "-")}-${path.basename(workRoot).slice(-12)}.service`,
    identity: buildIdentity,
    cwd: builder.view,
    environment: secretFreeEnvironment(builder, environment),
    executable: REQUIRED_NODE_PATH,
    argv: [REQUIRED_PNPM_ENTRYPOINT, ...argv],
    semanticCommand: { executable: REQUIRED_NODE_PATH, argv: [REQUIRED_PNPM_ENTRYPOINT, ...argv] },
    logPath,
    writablePaths: projectToolOutputSandbox(builder, name, undefined).writablePaths,
    readOnlyRoot: builder.view,
    binds: projectToolOutputSandbox(builder, name, undefined).binds,
    privateNetwork: !networkAllow?.length,
    joinUnit,
    networkAllow,
    hostsFile,
    allowNamespaces: name === "production-e2e",
    inaccessiblePaths: [
      ...projectToolOutputSandbox(builder, name, undefined).inaccessiblePaths,
      `-${builder.originalSourceRoot}`,
      `-${path.join(workRoot, "dependency-control")}`,
      `-${path.join(workRoot, "dependency-writable")}`,
      `-${path.join(workRoot, "browser-writable")}`
    ]
  });
}

async function runProjectToolGate({ name, toolId, argv, builder, buildIdentity, workRoot, logPath, environment, joinUnit }) {
  const tool = builder.tools[toolId];
  if (!tool) fail(`project-toolchain executable is unavailable: ${toolId}`);
  return runSandboxed({
    name,
    unit: `resume-ai-evidence-${name.replaceAll(/[^a-z0-9]/gu, "-")}-${path.basename(workRoot).slice(-12)}.service`,
    identity: buildIdentity,
    cwd: builder.view,
    environment: secretFreeEnvironment(builder, environment),
    executable: REQUIRED_NODE_PATH,
    argv: name === "production-build"
      ? [path.join(builder.view, "scripts/competitions/v7/build-worker.mjs"), "--with-next", tool.executable]
      : [tool.executable, ...argv],
    semanticCommand: {
      executable: REQUIRED_NODE_PATH,
      argv: name === "production-build"
        ? ["<reviewed-source>/scripts/competitions/v7/build-worker.mjs", "--with-next", `<frozen-node_modules>/${tool.relativePath}`]
        : [`<frozen-node_modules>/${tool.relativePath}`, ...argv],
      projectTool: toolId,
      executableSha256: tool.sha256
    },
    logPath,
    writablePaths: projectToolOutputSandbox(builder, name, toolId).writablePaths,
    readOnlyRoot: builder.view,
    binds: projectToolOutputSandbox(builder, name, toolId).binds,
    privateNetwork: true,
    joinUnit,
    allowNamespaces: name === "production-e2e",
    inaccessiblePaths: [
      ...projectToolOutputSandbox(builder, name, toolId).inaccessiblePaths,
      `-${builder.originalSourceRoot}`,
      `-${path.join(workRoot, "dependency-control")}`,
      `-${path.join(workRoot, "dependency-writable")}`,
      `-${path.join(workRoot, "browser-writable")}`
    ]
  });
}

async function publishMachineFile(builderPath, evidencePath) {
  const artifact = await hashOrdinaryFile(builderPath, { maxBytes: MACHINE_REPORT_LIMIT_BYTES, label: "candidate machine report" });
  await writeFile(evidencePath, artifact.bytes, { flag: "wx", mode: 0o600 });
  return { bytes: artifact.bytes, sha256: artifact.sha256 };
}

function parseVitestBytes(bytes, { allowSkipped }) {
  const value = JSON.parse(bytes.toString("utf8"));
  const passed = Number(value.numPassedTests);
  const failed = Number(value.numFailedTests);
  const skipped = Number(value.numPendingTests ?? 0) + Number(value.numTodoTests ?? 0);
  if (!Number.isInteger(passed) || passed <= 0 || failed !== 0) fail("Vitest result is not passing");
  if (!allowSkipped && skipped !== 0) fail("required integration tests were skipped");
  return { passed, failed, skipped };
}

function reportedTestFile(value, sourceRoot, label) {
  if (typeof value !== "string" || value.length === 0 || /[\0\r\n\t]/u.test(value)) {
    fail(`${label} report contains an invalid test filename`);
  }
  const absolute = path.isAbsolute(value) ? path.normalize(value) : path.resolve(sourceRoot, value);
  const relative = path.relative(sourceRoot, absolute).split(path.sep).join("/");
  if (!safeManifestPath(relative)) fail(`${label} report names a test outside the frozen source`);
  return relative;
}

function machineReport(artifact, label) {
  if (
    !artifact
    || !Buffer.isBuffer(artifact.bytes)
    || artifact.bytes.length > MACHINE_REPORT_LIMIT_BYTES
    || !/^[a-f0-9]{64}$/u.test(artifact.sha256 ?? "")
    || sha256(artifact.bytes) !== artifact.sha256
  ) {
    fail(`${label} machine report artifact is invalid`);
  }
  try { return JSON.parse(artifact.bytes.toString("utf8")); } catch { fail(`${label} machine report is not JSON`); }
}

function vitestObservations(artifact, sourceRoot, project, label) {
  const report = machineReport(artifact, label);
  if (
    report?.success !== true
    || report?.numFailedTests !== 0
    || !Number.isInteger(report?.numPassedTests)
    || report.numPassedTests <= 0
    || !Array.isArray(report?.testResults)
  ) fail(`${label} machine report is not globally passing`);
  const observations = [];
  for (const testResult of report.testResults) {
    const testFile = reportedTestFile(testResult?.name, sourceRoot, label);
    if (!Array.isArray(testResult?.assertionResults)) fail(`${label} test result lacks assertions`);
    for (const assertion of testResult.assertionResults) {
      const fullName = canonicalText(assertion?.fullName, `${label} fullName`, 512);
      if (!new Set(["passed", "failed", "skipped", "pending", "todo"]).has(assertion?.status)) {
        fail(`${label} assertion has an unknown status`);
      }
      observations.push({
        framework: "vitest",
        report: label,
        testFile,
        fullName,
        project,
        passed: assertion.status === "passed",
        status: assertion.status
      });
    }
  }
  return observations;
}

function playwrightObservations(artifact, sourceRoot) {
  const label = "playwright-production";
  const report = machineReport(artifact, label);
  const projects = report?.config?.projects;
  if (
    report?.stats?.unexpected !== 0
    || !(report?.stats?.expected > 0)
    || !Array.isArray(projects)
    || JSON.stringify(projects.map((project) => project?.name).sort()) !== JSON.stringify(["desktop", "mobile"])
    || !Array.isArray(report?.suites)
  ) fail("Playwright required-test report is not the fixed passing desktop/mobile matrix");
  const observations = [];
  function visit(suite, inheritedFile) {
    const suiteFile = typeof suite?.file === "string" ? suite.file : inheritedFile;
    for (const spec of suite?.specs ?? []) {
      const testFile = reportedTestFile(spec?.file ?? suiteFile, sourceRoot, label);
      const fullName = canonicalText(spec?.title, `${label} fullName`, 512);
      if (!Array.isArray(spec?.tests) || spec.tests.length === 0) fail("Playwright spec lacks project results");
      for (const test of spec.tests) {
        const project = test?.projectName;
        if (!["desktop", "mobile"].includes(project) || !Array.isArray(test?.results) || test.results.length === 0) {
          fail("Playwright required-test result has an invalid project or empty execution");
        }
        const statuses = test.results.map((result) => result?.status);
        if (statuses.some((status) => !["passed", "failed", "timedOut", "interrupted", "skipped"].includes(status))) {
          fail("Playwright required-test result has an unknown status");
        }
        observations.push({
          framework: "playwright",
          report: label,
          testFile,
          fullName,
          project,
          passed: statuses.every((status) => status === "passed"),
          status: statuses.join(",")
        });
      }
    }
    for (const child of suite?.suites ?? []) visit(child, suiteFile);
  }
  for (const suite of report.suites) visit(suite, undefined);
  return observations;
}

export function evaluateRequiredTestReports(contract, reports, sourceRoot) {
  if (!contract || !Array.isArray(contract.requirements) || !path.isAbsolute(sourceRoot)) {
    fail("required-test evaluation input is invalid");
  }
  const expectedReports = ["vitest-unit", "vitest-postgres", "playwright-production"];
  if (JSON.stringify(Object.keys(reports ?? {}).sort()) !== JSON.stringify([...expectedReports].sort())) {
    fail("required-test machine report set is incomplete or unexpected");
  }
  const observations = [
    ...vitestObservations(reports["vitest-unit"], sourceRoot, "unit", "vitest-unit"),
    ...vitestObservations(reports["vitest-postgres"], sourceRoot, "postgres-integration", "vitest-postgres"),
    ...playwrightObservations(reports["playwright-production"], sourceRoot)
  ];
  const verified = [];
  let passedObservations = 0;
  for (const requirement of contract.requirements) {
    const matches = observations.filter((observation) =>
      observation.framework === requirement.framework
      && observation.report === requirement.report
      && observation.testFile === requirement.testFile
      && observation.fullName === requirement.fullName
      && observation.project === requirement.project
    );
    const passed = matches.filter((match) => match.passed).length;
    if (matches.some((match) => !match.passed) || passed < requirement.minimumPassed) {
      fail(`required test was missing, skipped, renamed, or failed: ${requirement.id}`);
    }
    passedObservations += passed;
    verified.push({
      id: requirement.id,
      categories: requirement.categories,
      framework: requirement.framework,
      report: requirement.report,
      testFile: requirement.testFile,
      testFileSha256: contract.pins.get(requirement.testFile),
      fullName: requirement.fullName,
      project: requirement.project,
      minimumPassed: requirement.minimumPassed,
      passed
    });
  }
  if (passedObservations < contract.minimumPassedObservations) fail("required-test minimum passing observation count was not reached");
  return {
    passedObservations,
    minimumPassedObservations: contract.minimumPassedObservations,
    verified,
    reportSha256: Object.fromEntries(expectedReports.map((label) => [label, reports[label].sha256]))
  };
}

function assertDeepSeekLog(raw, expectedVerifier = "release-evidence-deepseek.v2") {
  const required = new Set(["models", "competition_normalize", "competition_followup_policy", "competition_recommend"]);
  for (const line of raw.toString("utf8").split(/\r?\n/u)) {
    const candidate = line.trim();
    if (!candidate.startsWith("{")) continue;
    try {
      const value = JSON.parse(candidate);
      if (value?.event !== "deepseek_preflight") continue;
      if (value.status === "ok" && value.verifier === expectedVerifier) required.delete(value.operation);
      if (value.status === "failed" || value.status === "skipped") fail("DeepSeek preflight did not execute fully");
    } catch (error) {
      if (error instanceof Error && error.message === "DeepSeek preflight did not execute fully") throw error;
    }
  }
  if (required.size) fail(`DeepSeek preflight lacks fixed-verifier operations: ${[...required].join(",")}`);
}

async function resolveHost(hostname) {
  const output = await trustedOutput("/usr/bin/getent", ["ahosts", hostname], `${hostname} resolution`);
  const addresses = [...new Set(output.split(/\r?\n/u).map((line) => line.trim().split(/\s+/u)[0]).filter((value) => isIP(value) !== 0))].sort();
  if (!addresses.length) fail(`cannot resolve pinned host: ${hostname}`);
  return addresses;
}

async function createHostsFile(workRoot, label, hostAddresses) {
  const filename = path.join(workRoot, `hosts-${label.replaceAll(".", "-")}`);
  const lines = ["127.0.0.1 localhost", "::1 localhost"];
  for (const [hostname, addresses] of Object.entries(hostAddresses)) {
    for (const address of addresses) lines.push(`${address} ${hostname}`);
  }
  await writeFile(filename, `${lines.join("\n")}\n`, { flag: "wx", mode: 0o444 });
  await chown(filename, 0, 0);
  await chmod(filename, 0o444);
  return filename;
}

export function parseReleaseEffortPolicy(value) {
  if (!hasExactKeys(value,["version","rank","explain","review"]) || value.version !== "saitu.effort-policy.v1" || ["rank","explain","review"].some(stage => !["high","low"].includes(value[stage]))) fail("invalid release effort policy");
  return {version:value.version,rank:value.rank,explain:value.explain,review:value.review};
}
export const releaseEffortPolicySha256 = value => sha256(Buffer.from(JSON.stringify(parseReleaseEffortPolicy(value))));
export function productionBrowserBinding(workerBuild, effortEnvironment) {
  if (!/^[a-f0-9]{64}$/.test(workerBuild?.sourceSha256 ?? "")) fail("production browser source binding is missing");
  const unbounded=workerBuild.executionMode==="user-unbounded";
  if(unbounded&&effortEnvironment.SAITU_AI_EXECUTION_MODE!=="user-unbounded"||!unbounded&&effortEnvironment.SAITU_AI_EXECUTION_MODE)fail("production browser execution mode differs");
  const carriesEffort = Object.hasOwn(workerBuild, "effortPolicy") || Object.hasOwn(workerBuild, "effortPolicySha256");
  if (carriesEffort) {
    if (!hasExactKeys(effortEnvironment, ["SAITU_V7_EFFORT_POLICY", "SAITU_V7_EFFORT_POLICY_SHA256",...(unbounded?["SAITU_AI_EXECUTION_MODE"]:[])])) fail("production browser effort environment differs");
    let policy; try { policy = parseReleaseEffortPolicy(JSON.parse(effortEnvironment.SAITU_V7_EFFORT_POLICY)); } catch { fail("production browser effort policy is invalid"); }
    const fingerprint = releaseEffortPolicySha256(policy);
    if (fingerprint !== effortEnvironment.SAITU_V7_EFFORT_POLICY_SHA256 || fingerprint !== workerBuild.effortPolicySha256 || releaseEffortPolicySha256(workerBuild.effortPolicy) !== fingerprint) fail("production browser effort differs from the uniform worker build");
  } else if (!hasExactKeys(effortEnvironment, [])) fail("legacy production browser cannot accept an effort override");
  return { ...effortEnvironment, SAITU_V7_SOURCE_SHA256: workerBuild.sourceSha256 };
}
export function preflightBudgetEnvironment(environment, requiresV7, expectedPolicySha256, requiresStage = false, requiresTop5 = false, requiresUnbounded = false) {
  if (requiresTop5 && !requiresStage) fail("top5 release requires the explicit stage policy");
  if(requiresUnbounded&&(!requiresTop5||environment.SAITU_AI_EXECUTION_MODE!=="user-unbounded")||!requiresUnbounded&&environment.SAITU_AI_EXECUTION_MODE&&environment.SAITU_AI_EXECUTION_MODE!=="finite")fail("release execution mode differs from its source authorization");
  const spendRunId = String(environment.AI_SPEND_RUN_ID ?? "").trim();
  const spendLimitCny = requiresUnbounded?"unbounded":String(environment.AI_SPEND_LIMIT_CNY ?? "300"), spendFundedCny = requiresUnbounded?"physical":String(environment.AI_SPEND_FUNDED_CNY ?? ""), spendPhase = String(environment.AI_SPEND_PHASE ?? "calibration");
  if (!/^[a-zA-Z0-9._-]{1,100}$/.test(spendRunId) || !["calibration","formal","repair","performance","reserve"].includes(spendPhase) || !requiresUnbounded&&![spendLimitCny,spendFundedCny].every(value => Number.isFinite(Number(value)) && Number(value)>0 && Number.isSafeInteger(Math.floor(Number(value)*1e6)) && (requiresV7 || Number(value)<=300))) fail("shared spend limits, phase and run are required");
  const profileArguments = [], effortEnvironment = {};
  if (requiresStage) {
    let policy;
    try { policy = parseReleaseEffortPolicy(JSON.parse(environment.SAITU_V7_EFFORT_POLICY)); } catch { fail("release requires an explicit stage effort policy"); }
    const policySha = releaseEffortPolicySha256(policy);
    if (requiresTop5 && ["rank","explain","review"].some(key => policy[key] !== "low")) fail("top5 release requires the approved low/low/low policy");
    if (!requiresV7 || !/^[a-f0-9]{64}$/.test(expectedPolicySha256 ?? "") || environment.AI_SPEND_POLICY_SHA256 !== expectedPolicySha256 || environment.AI_REASONING_EFFORT !== "high" || environment.AI_SPEND_AUTHORIZED_EFFORT !== "stage" || environment.SAITU_V7_EFFORT_POLICY_SHA256 !== policySha || !/^[a-f0-9]{64}$/.test(environment.AI_SPEND_EFFORT_CONDITION_SHA256 ?? "") || environment.AI_SPEND_HIGH_CONDITION_SHA256 || !new RegExp(`^saitu-v7-${requiresUnbounded?"top5-unbounded":requiresTop5?"top5":"effort"}-20261109-${spendPhase}-[0-9]{2}$`).test(spendRunId)) fail("stage preflight requires its separate effort grant and condition");
    Object.assign(effortEnvironment,{SAITU_V7_EFFORT_POLICY:JSON.stringify(policy),SAITU_V7_EFFORT_POLICY_SHA256:policySha});
    if(requiresUnbounded)effortEnvironment.SAITU_AI_EXECUTION_MODE="user-unbounded";
    profileArguments.push("--profile",requiresUnbounded?"v7-top5-user-unbounded":requiresTop5?"v7-top5":"v7-effort","--authorized-effort","stage","--policy-sha256",expectedPolicySha256,"--condition-sha256",environment.AI_SPEND_EFFORT_CONDITION_SHA256,"--effort-policy",JSON.stringify(policy),"--effort-policy-sha256",policySha);
  } else {
    if (["SAITU_V7_EFFORT_POLICY","SAITU_V7_EFFORT_POLICY_SHA256","AI_SPEND_EFFORT_CONDITION_SHA256"].some(key => environment[key] !== undefined && environment[key] !== "")) fail("old preflight cannot consume a stage effort policy");
    if (requiresV7) {
      if (typeof expectedPolicySha256 !== "string" || !/^[a-f0-9]{64}$/.test(expectedPolicySha256) || environment.AI_SPEND_POLICY_SHA256 !== expectedPolicySha256 || environment.AI_REASONING_EFFORT !== "high" || environment.AI_SPEND_AUTHORIZED_EFFORT !== "high" || ![environment.AI_SPEND_POLICY_SHA256,environment.AI_SPEND_HIGH_CONDITION_SHA256].every(value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value)) || !new RegExp(`^saitu-v7-20261109-${spendPhase}-[0-9]{2}$`).test(spendRunId)) fail("v7 fixed preflight requires the explicit high batch authorization");
      profileArguments.push("--profile","v7-high","--authorized-effort","high","--policy-sha256",environment.AI_SPEND_POLICY_SHA256,"--condition-sha256",environment.AI_SPEND_HIGH_CONDITION_SHA256);
    }
  }
  return {spendRunId,spendLimitCny,spendFundedCny,spendPhase,profileArguments,effortEnvironment,verifierId:requiresUnbounded?"release-evidence-deepseek.v7.top5.user-unbounded.v1":requiresTop5?"release-evidence-deepseek.v7.top5.v1":requiresStage?"release-evidence-deepseek.v7.effort.v1":requiresV7?"release-evidence-deepseek.v7.1":"release-evidence-deepseek.v2"};
}

async function prepareDeepSeekCredential(workRoot, requiresV7, expectedPolicySha256, requiresStage, requiresTop5, requiresUnbounded) {
  const apiKey = String(process.env.AI_API_KEY ?? "").trim();
  delete process.env.AI_API_KEY;
  if (apiKey.length < 16 || /[\r\n\t ]/u.test(apiKey)) fail("AI_API_KEY is required only for the fixed one-shot DeepSeek verifier");
  const normalizeModel = String(process.env.AI_COMPETITION_NORMALIZE_MODEL ?? process.env.AI_MODEL ?? "deepseek-flash").trim();
  const recommendModel = String(process.env.AI_COMPETITION_RECOMMEND_MODEL ?? process.env.AI_MODEL ?? "deepseek-flash").trim();
  if (![normalizeModel, recommendModel].every((value) => value === "deepseek-flash")) fail("fixed preflight requires deepseek-flash");
  const budget = preflightBudgetEnvironment(process.env, requiresV7, expectedPolicySha256, requiresStage, requiresTop5, requiresUnbounded);
  const credential = path.join(workRoot, "deepseek.credential");
  await writeFile(credential, `${apiKey}\n`, { flag: "wx", mode: 0o400 });
  await chown(credential, 0, 0);
  await chmod(credential, 0o400);
  return { credential, normalizeModel, recommendModel, ...budget };
}

async function runFixedDeepSeek({ builder, verifyIdentity, workRoot, logPath, controlFile, verifierSha256, spendControlSha256, budgetReceiptPath }) {
  const permitFile=path.join(workRoot,"deepseek-budget-permit.json");
  const budgetControl=async(command,extra=[])=>{
    const execution=await spawnCaptured(REQUIRED_NODE_PATH,[REQUIRED_SPEND_CONTROL_PATH,command,"--permit",permitFile,"--verifier-sha256",verifierSha256,"--run-id",controlFile.spendRunId,"--limit-cny",controlFile.spendLimitCny,"--funded-cny",controlFile.spendFundedCny,"--phase",controlFile.spendPhase,...controlFile.profileArguments,...extra]);
    if(execution.exitCode!==0)fail("protected shared-budget control failed; unknown reservations remain held");
    return JSON.parse(execution.stdout.toString("utf8").trim());
  };
  let launched=false,prepared=false,permitSha256;

  await assertAccountIdle(verifyIdentity);
  const addresses = await resolveHost("api.deepseek.com");
  const hostsFile = await createHostsFile(workRoot, "api.deepseek.com", { "api.deepseek.com": addresses });
  const unit = `resume-ai-evidence-deepseek-${path.basename(workRoot).slice(-12)}.service`;
  const credentialPath = `/run/credentials/${unit}/deepseek-key`;
  const budgetCredentialPath = `/run/credentials/${unit}/budget-permit`;
  try {
    await budgetControl("reserve");prepared=true;
    const claimed=await budgetControl("claim");launched=true;permitSha256=claimed.permitSha256;

    const result = await runSandboxed({
      name: "deepseek-preflight",
      unit,
      identity: verifyIdentity,
      cwd: "/",
      environment: { PATH: BUILDER_PATH, NODE_ENV: "production" },
      executable: REQUIRED_NODE_PATH,
      argv: [REQUIRED_DEEPSEEK_VERIFIER_PATH, credentialPath, budgetCredentialPath, controlFile.normalizeModel, controlFile.recommendModel],
      semanticCommand: {
        executable: REQUIRED_NODE_PATH,
        argv: [REQUIRED_DEEPSEEK_VERIFIER_PATH, "<systemd-credential>", "<systemd-budget-permit>", controlFile.normalizeModel, controlFile.recommendModel],
        verifierSha256, spendControlSha256, permitSha256
      },
      logPath,
      writablePaths: [],
      readOnlyRoot: "/",
      privateNetwork: false,
      networkAllow: addresses,
      hostsFile,
      credentials: [{ name: "deepseek-key", path: controlFile.credential }, {name:"budget-permit",path:permitFile}],
      inaccessiblePaths: [`-${builder.view}`, `-${builder.writable}`]
    });
    assertDeepSeekLog(result.stdout, controlFile.verifierId);
    return result;
  } finally {
    try {
      if(launched){
        const logExists=await lstat(logPath).then(()=>true,()=>false);
        if(logExists)await budgetControl("settle",["--log",logPath,"--output",budgetReceiptPath]);
        // Missing logs after any possible launch deliberately leave the full reservations held.
      }else if(prepared)await budgetControl("cancel").catch(()=>undefined);
    }finally{await rm(controlFile.credential,{force:true});await rm(permitFile,{force:true});}
  }
}

async function runFixedRedirectProbe({ wwwUrl, verifyIdentity, workRoot, verifierSha256 }) {
  const request = new URL(wwwUrl);
  if (request.href !== "https://www.siyuanjiaxin.com/release-evidence-probe") {
    fail("www redirect probe is fixed to https://www.siyuanjiaxin.com/release-evidence-probe");
  }
  const expected = new URL("https://siyuanjiaxin.com/release-evidence-probe");
  const hostAddresses = {
    [request.hostname]: await resolveHost(request.hostname),
    [expected.hostname]: await resolveHost(expected.hostname)
  };
  const addresses = [...new Set(Object.values(hostAddresses).flat())].sort();
  const hostsFile = await createHostsFile(workRoot, "www-redirect", hostAddresses);
  await assertAccountIdle(verifyIdentity);
  const probe = await runSandboxed({
    name: "www-redirect-probe",
    unit: `resume-ai-evidence-redirect-${path.basename(workRoot).slice(-12)}.service`,
    identity: verifyIdentity,
    cwd: "/",
    environment: { PATH: BUILDER_PATH, NODE_ENV: "production" },
    executable: REQUIRED_NODE_PATH,
    argv: [REQUIRED_HTTP_PROBE_PATH, request.href, expected.href],
    semanticCommand: {
      executable: REQUIRED_NODE_PATH,
      argv: [REQUIRED_HTTP_PROBE_PATH, request.href, expected.href],
      verifierSha256
    },
    writablePaths: [],
    readOnlyRoot: "/",
    privateNetwork: false,
    networkAllow: addresses,
    hostsFile
  });
  for (const line of probe.stdout.toString("utf8").split(/\r?\n/u)) {
    try {
      const value = JSON.parse(line);
      if (value?.event === "www_redirect_probe" && value?.status === "ok" && value?.verifier === "release-evidence-http-probe.v1") return value;
    } catch {
      // Fixed verifier emits one JSON line; unrelated launcher output is ignored.
    }
  }
  fail("fixed www redirect verifier did not emit a passing receipt");
}

function visitPlaywrightSuite(suite, projectStats) {
  for (const spec of suite?.specs ?? []) for (const test of spec?.tests ?? []) {
    const project = test?.projectName;
    if (!Object.hasOwn(projectStats, project)) continue;
    for (const result of test?.results ?? []) {
      if (result.status === "passed") projectStats[project].passed += 1;
      else if (result.status === "skipped") projectStats[project].skipped += 1;
      else projectStats[project].failed += 1;
    }
  }
  for (const child of suite?.suites ?? []) visitPlaywrightSuite(child, projectStats);
}

async function hashHtmlTree(root) {
  const entries = [];
  let totalBytes = 0;
  let visitedMembers = 0;
  async function walk(directory, relative, depth = 0) {
    if (depth > 128) fail("Playwright HTML report nesting is too deep");
    const before = await lstat(directory, { bigint: true });
    if (!before.isDirectory() || before.isSymbolicLink()) fail(`unsafe HTML evidence directory: ${relative || "."}`);
    const names = [];
    const handle = await opendir(directory);
    for await (const entry of handle) {
      visitedMembers += 1;
      if (visitedMembers > HTML_REPORT_MEMBER_LIMIT) fail("Playwright HTML report has too many members");
      names.push(entry.name);
    }
    names.sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
    for (const name of names) {
      const nextRelative = relative ? `${relative}/${name}` : name;
      if (!safeManifestPath(nextRelative)) fail(`Playwright HTML report has an unsafe member name: ${nextRelative}`);
      const absolute = path.join(directory, name);
      const metadata = await lstat(absolute);
      if (metadata.isDirectory() && !metadata.isSymbolicLink()) await walk(absolute, nextRelative, depth + 1);
      else if (metadata.isFile() && !metadata.isSymbolicLink()) {
        if (metadata.size > HTML_REPORT_FILE_LIMIT_BYTES) fail(`Playwright HTML report member is too large: ${nextRelative}`);
        totalBytes += metadata.size;
        if (totalBytes > HTML_REPORT_TOTAL_LIMIT_BYTES) fail("Playwright HTML report exceeds its total byte limit");
        const artifact = await hashOrdinaryFile(absolute, { maxBytes: HTML_REPORT_FILE_LIMIT_BYTES, label: "Playwright HTML report member" });
        entries.push(`${artifact.sha256}\t${nextRelative}`);
      }
      else fail(`unsafe HTML evidence: ${nextRelative}`);
    }
    const namesAfter = [];
    const handleAfter = await opendir(directory);
    for await (const entry of handleAfter) namesAfter.push(entry.name);
    namesAfter.sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
    const after = await lstat(directory, { bigint: true });
    if (JSON.stringify(namesAfter) !== JSON.stringify(names)) fail(`HTML evidence membership changed: ${relative || "."}`);
    for (const key of ["dev", "ino", "mode", "nlink", "size", "mtimeNs", "ctimeNs"]) if (before[key] !== after[key]) fail(`HTML evidence directory changed: ${relative || "."}`);
  }
  await walk(root, "");
  if (!entries.some((entry) => entry.endsWith("\tindex.html"))) fail("Playwright HTML report lacks index.html");
  return { sha256: sha256(Buffer.from(`${entries.join("\n")}\n`)), files: entries.length, totalBytes };
}

async function copyHtmlTree(source, destination) {
  await mkdir(destination, { mode: 0o700 });
  let totalBytes = 0;
  let visitedMembers = 0;
  async function walk(from, to, depth = 0) {
    if (depth > 128) fail("Playwright HTML report nesting is too deep");
    const names = [];
    const handle = await opendir(from);
    for await (const entry of handle) {
      visitedMembers += 1;
      if (visitedMembers > HTML_REPORT_MEMBER_LIMIT) fail("Playwright HTML report has too many members");
      names.push(entry.name);
    }
    names.sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
    for (const name of names) {
      const sourceMember = path.join(from, name);
      const destinationMember = path.join(to, name);
      if (name !== name.normalize("NFC") || /[\\\0\r\n\t/]/u.test(name) || name === "." || name === "..") {
        fail("Playwright HTML report has an unsafe member name");
      }
      const metadata = await lstat(sourceMember);
      if (metadata.isDirectory() && !metadata.isSymbolicLink()) {
        await mkdir(destinationMember, { mode: 0o700 });
        await walk(sourceMember, destinationMember, depth + 1);
      } else if (metadata.isFile() && !metadata.isSymbolicLink()) {
        if (metadata.size > HTML_REPORT_FILE_LIMIT_BYTES) fail(`Playwright HTML report member is too large: ${name}`);
        totalBytes += metadata.size;
        if (totalBytes > HTML_REPORT_TOTAL_LIMIT_BYTES) fail("Playwright HTML report exceeds its total byte limit");
        const artifact = await hashOrdinaryFile(sourceMember, { maxBytes: HTML_REPORT_FILE_LIMIT_BYTES, label: "Playwright HTML report member" });
        await writeFile(destinationMember, artifact.bytes, { flag: "wx", mode: 0o600 });
      } else fail("Playwright report contains an unsafe member");
    }
  }
  await walk(source, destination);
}

async function runManifestControl({ builder, buildIdentity, workRoot, expectedBytes, suffix }) {
  const pathsNul = path.join(builder.writable, `source-paths-${suffix}.nul`);
  const control = await runSandboxed({
    name: `source-manifest-${suffix}`,
    unit: `resume-ai-evidence-manifest-${suffix}-${path.basename(workRoot).slice(-12)}.service`,
    identity: buildIdentity,
    cwd: builder.view,
    environment: {
      PATH: TRUSTED_PATH,
      RELEASE_GIT_BIN: "/usr/bin/git",
      RELEASE_PYTHON_BIN: "/usr/bin/python3",
      RELEASE_SOURCE_PATHS_NUL: pathsNul,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_OPTIONAL_LOCKS: "0"
    },
    executable: "/bin/bash",
    argv: [path.join(builder.view, "ops/bin/create-release-source-manifest.sh"), builder.view],
    semanticCommand: { executable: "/bin/bash", argv: ["ops/bin/create-release-source-manifest.sh", "."] },
    writablePaths: projectToolOutputSandbox(builder, `source-manifest-${suffix}`, undefined).writablePaths,
    readOnlyRoot: builder.view,
    binds: projectToolOutputSandbox(builder, `source-manifest-${suffix}`, undefined).binds,
    privateNetwork: true,
    inaccessiblePaths: [
      ...projectToolOutputSandbox(builder, `source-manifest-${suffix}`, undefined).inaccessiblePaths,
      `-${builder.originalSourceRoot}`,
      `-${path.join(workRoot, "dependency-control")}`,
      `-${path.join(workRoot, "dependency-writable")}`,
      `-${path.join(workRoot, "browser-writable")}`
    ]
  });
  if (!control.stdout.equals(expectedBytes)) fail("sandboxed source inventory differs from reviewed source manifest");
  const paths = await hashOrdinaryFile(pathsNul);
  if (paths.bytes.toString("utf8").split("\0").filter(Boolean).length !== parseSourceManifest(expectedBytes).length) fail("sandboxed source inventory count differs");
}

async function stopEphemeralPostgres(serverUnit, data, pgtestIdentity) {
  await spawnCaptured(SYSTEMCTL, ["stop", serverUnit]);
  const active = await spawnCaptured(SYSTEMCTL, ["is-active", serverUnit]);
  const state = active.stdout.toString("utf8").trim();
  if (active.exitCode === 0 || ![3, 4].includes(active.exitCode) || !["inactive", "unknown", "failed", ""].includes(state)) {
    fail(`ephemeral PostgreSQL transient unit survived cleanup: ${serverUnit}`);
  }
  const processes = await spawnCaptured("/usr/bin/pgrep", ["-f", data]);
  if (processes.exitCode === 0) fail(`ephemeral PostgreSQL process survived cleanup: ${data}`);
  if (processes.exitCode !== 1) fail("cannot verify ephemeral PostgreSQL process cleanup");
  await rm(data, { recursive: true, force: true });
  if (await lstat(data).then(() => true, () => false)) fail("ephemeral PostgreSQL data survived cleanup");
  await assertAccountIdle(pgtestIdentity);
}

async function prepareEphemeralPostgres({ workRoot, buildIdentity }) {
  const pgtestIdentity = await accountIdentity(PGTEST_ACCOUNT);
  await assertAccountIdle(pgtestIdentity);
  const bindir = await trustedOutput("/usr/bin/pg_config", ["--bindir"], "PostgreSQL bindir lookup");
  if (!/^\/usr\/lib\/postgresql\/[0-9]+\/bin$/u.test(bindir)) fail("PostgreSQL test binary directory is unapproved");
  for (const binary of ["initdb", "pg_isready", "postgres", "psql"]) {
    const filename = path.join(bindir, binary);
    const metadata = await stat(filename);
    if (!metadata.isFile() || metadata.uid !== 0 || (metadata.mode & 0o022) !== 0) fail(`PostgreSQL test binary is not root-frozen: ${binary}`);
  }
  const id = randomUUID().replaceAll("-", "").slice(0, 16);
  // The full v7 crash/retention suite can exceed Jammy's small /run tmpfs with
  // PostgreSQL WAL. Use the installed dedicated identity's disk-backed home;
  // it remains inaccessible to application identities and outside production PG.
  const dataParent = "/var/lib/resume-ai-pgtest";
  for (const ancestor of ["/var", "/var/lib"]) {
    const metadata = await lstat(ancestor);
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== 0 || metadata.gid !== 0 || (metadata.mode & 0o022) !== 0)
      fail("dedicated PostgreSQL test data ancestor is not root-controlled");
  }
  const parentMetadata = await lstat(dataParent);
  if (!parentMetadata.isDirectory() || parentMetadata.isSymbolicLink() || await realpath(dataParent) !== dataParent
    || parentMetadata.uid !== pgtestIdentity.uid || parentMetadata.gid !== pgtestIdentity.gid || (parentMetadata.mode & 0o777) !== 0o700)
    fail("dedicated PostgreSQL test data parent is not private and identity-owned");
  const data = path.join(dataParent, `resume-ai-evidence-pg-${id}`);
  await mkdir(data, { mode: 0o700 });
  await chown(data, pgtestIdentity.uid, pgtestIdentity.gid);
  const initUnit = `resume-ai-evidence-pginit-${id}.service`;
  const init = await runSandboxed({
    name: "postgres-cluster-init",
    unit: initUnit,
    identity: pgtestIdentity,
    cwd: data,
    environment: { PATH: `${bindir}:/usr/bin:/bin` },
    executable: path.join(bindir, "initdb"),
    argv: ["--pgdata", data, "--username=postgres", "--encoding=UTF8", "--locale=C", "--auth-local=trust", "--auth-host=trust"],
    semanticCommand: { executable: path.join(bindir, "initdb"), argv: ["--ephemeral"] },
    writablePaths: [data],
    readOnlyRoot: bindir,
    privateNetwork: true,
    inaccessiblePaths: ["-/opt/resume-ai", "-/var/lib/postgresql", "-/etc/postgresql"],
    assertIdentityIdle: false
  });
  if (init.result.exitCode !== 0) fail("cannot initialize ephemeral PostgreSQL");
  const serverUnit = `resume-ai-evidence-pg-${id}.service`;
  const serverArgs = [
    "--quiet", "--collect", "--service-type=exec", `--unit=${serverUnit}`,
    `--uid=${PGTEST_ACCOUNT}`, `--gid=${PGTEST_ACCOUNT}`,
    `--working-directory=${data}`,
    "--property=PrivateNetwork=yes",
    "--property=KillMode=control-group",
    "--property=NoNewPrivileges=yes",
    "--property=PrivateTmp=yes",
    "--property=PrivateDevices=yes",
    "--property=ProtectHome=yes",
    "--property=ProtectSystem=strict",
    "--property=ProtectKernelTunables=yes",
    "--property=ProtectKernelModules=yes",
    "--property=ProtectControlGroups=yes",
    "--property=ProtectKernelLogs=yes",
    "--property=ProtectClock=yes",
    "--property=ProtectHostname=yes",
    "--property=ProtectProc=invisible",
    "--property=ProcSubset=pid",
    "--property=RestrictSUIDSGID=yes",
    "--property=RestrictNamespaces=yes",
    "--property=LockPersonality=yes",
    "--property=RestrictRealtime=yes",
    "--property=RemoveIPC=yes",
    "--property=CapabilityBoundingSet=",
    "--property=UMask=0077",
    "--property=TasksMax=256",
    "--property=MemoryMax=1G",
    "--property=RuntimeMaxSec=3600",
    "--property=InaccessiblePaths=-/run/postgresql -/var/run/postgresql -/var/lib/postgresql -/etc/postgresql -/opt/resume-ai/current -/opt/resume-ai/releases",
    `--property=ReadWritePaths=${data}`,
    ENV_BIN, "-i", `PATH=${bindir}:/usr/bin:/bin`,
    path.join(bindir, "postgres"), "-D", data, "-h", "127.0.0.1", "-p", "5432", "-k", data
  ];
  const started = await spawnCaptured(SYSTEMD_RUN, serverArgs, { unit: serverUnit });
  if (started.exitCode !== 0) fail(`cannot start ephemeral PostgreSQL: ${started.stderr.toString("utf8").trim()}`);
  const database = `resume_ai_test_${id}`;
  const role = `resume_ai_test_runtime_${id}`;
  const setupCode = `
set -eu
attempt=0
until pg_isready --dbname=postgres >/dev/null 2>&1; do
  attempt=$((attempt + 1)); [ "$attempt" -lt 120 ] || exit 70; sleep 0.25
done
psql --dbname=postgres --no-psqlrc --set=ON_ERROR_STOP=1 --command="CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS"
psql --dbname=postgres --no-psqlrc --set=ON_ERROR_STOP=1 --command="CREATE DATABASE ${database} OWNER postgres"
psql --dbname=${database} --no-psqlrc --set=ON_ERROR_STOP=1 --command="REVOKE CREATE ON SCHEMA public FROM PUBLIC; REVOKE CREATE,TEMPORARY ON DATABASE ${database} FROM PUBLIC"
psql --dbname=postgres --no-psqlrc --set=ON_ERROR_STOP=1 --command="COPY (SELECT 1) TO PROGRAM 'id -u > ${data}/copy-program-uid; test ! -e /run/postgresql/.s.PGSQL.5432; test ! -r /var/lib/postgresql; test ! -r /etc/postgresql; test ! -e /opt/resume-ai/current; test ! -e /opt/resume-ai/releases'"
`;
  try {
    const setup = await runSandboxed({
      name: "postgres-cluster-setup",
      unit: `resume-ai-evidence-pgsetup-${id}.service`,
      identity: pgtestIdentity,
      cwd: data,
      environment: { PATH: `${bindir}:/usr/bin:/bin`, PGHOST: "127.0.0.1", PGPORT: "5432", PGUSER: "postgres" },
      executable: "/bin/sh",
      argv: ["-c", setupCode],
      semanticCommand: { executable: "/bin/sh", argv: ["ephemeral-postgres-setup"] },
      writablePaths: [data],
      readOnlyRoot: bindir,
      privateNetwork: true,
      joinUnit: serverUnit,
      inaccessiblePaths: ["-/opt/resume-ai", "-/var/lib/postgresql", "-/etc/postgresql"],
      assertIdentityIdle: false
    });
    if (setup.result.exitCode !== 0) fail("cannot prepare ephemeral PostgreSQL roles");
  } catch (error) {
    await stopEphemeralPostgres(serverUnit, data, pgtestIdentity);
    throw error;
  }
  const copyProgramUid = (await readFile(path.join(data, "copy-program-uid"), "utf8")).trim();
  if (copyProgramUid !== String(pgtestIdentity.uid)) {
    await stopEphemeralPostgres(serverUnit, data, pgtestIdentity);
    fail("ephemeral PostgreSQL COPY PROGRAM escaped the dedicated pgtest identity");
  }
  return {
    serverUnit,
    data,
    adminUrl: `postgresql://postgres@127.0.0.1:5432/${database}`,
    runtimeUrl: `postgresql://${role}@127.0.0.1:5432/${database}`,
    async cleanup() {
      await stopEphemeralPostgres(serverUnit, data, pgtestIdentity);
      await assertAccountIdle(buildIdentity);
    }
  };
}

function parseProjectToolchainArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--") || Object.hasOwn(values, key)) {
      fail("usage: verify-project-toolchain --source-manifest ABS --source-root ABS --node-modules ABS --output ABS");
    }
    values[key] = value;
  }
  const allowed = new Set(["--source-manifest", "--source-root", "--node-modules", "--output"]);
  for (const key of Object.keys(values)) if (!allowed.has(key)) fail(`unknown project-toolchain argument: ${key}`);
  for (const key of allowed) if (!path.isAbsolute(values[key] ?? "")) fail(`project-toolchain argument must be absolute: ${key}`);
  return values;
}

async function verifyProjectToolchainCli(argv) {
  const args = parseProjectToolchainArguments(argv);
  if (process.platform !== "linux" || process.getuid?.() !== 0 || process.version !== REQUIRED_NODE) {
    fail("project-toolchain verification requires root and the fixed Jammy Node runtime");
  }
  const [coordinator, executingNode] = await Promise.all([realpath(process.argv[1]), realpath(process.execPath)]);
  if (coordinator !== REQUIRED_COORDINATOR_PATH || executingNode !== REQUIRED_NODE_PATH) {
    fail("project-toolchain verification must use the installed coordinator and immutable Node runtime");
  }
  const manifestPath = await realpath(args["--source-manifest"]);
  const manifestArtifact = await hashOrdinaryFile(manifestPath, {
    maxBytes: CONTROL_FILE_LIMIT_BYTES,
    label: "project-toolchain source manifest"
  });
  if (manifestArtifact.metadata.uid !== 0n || (manifestArtifact.metadata.mode & 0o7022n) !== 0n) {
    fail("project-toolchain source manifest is not root-frozen");
  }
  const entries = parseSourceManifest(manifestArtifact.bytes);
  const sourceState = { entries };
  const coordinatorSha256 = await verifyInstalledControlFile(REQUIRED_COORDINATOR_PATH, SOURCE_MANIFEST_MEMBER, sourceState);
  const requiredTestsSha256 = await verifyInstalledControlFile(REQUIRED_TESTS_PATH, REQUIRED_TESTS_MEMBER, sourceState);
  const requiredArtifact = await hashOrdinaryFile(REQUIRED_TESTS_PATH, {
    maxBytes: REQUIRED_TEST_MANIFEST_LIMIT_BYTES,
    label: "installed project-toolchain policy"
  });
  if (requiredArtifact.sha256 !== requiredTestsSha256) fail("installed project-toolchain policy changed during verification");
  const requiredTests = parseRequiredTestManifest(requiredArtifact.bytes, entries);

  const sourceRoot = await realpath(args["--source-root"]);
  const inputs = [];
  for (const input of requiredTests.projectToolchain.inputs) {
    const inputPath = await realpath(path.join(sourceRoot, ...input.path.split("/")));
    if (inputPath !== sourceRoot && !inputPath.startsWith(`${sourceRoot}${path.sep}`)) {
      fail(`project-toolchain source input escapes source root: ${input.path}`);
    }
    const artifact = await hashOrdinaryFile(inputPath, {
      maxBytes: CONTROL_FILE_LIMIT_BYTES,
      label: `project-toolchain source input ${input.path}`
    });
    if (artifact.sha256 !== input.sha256) fail(`project-toolchain source input differs from policy: ${input.path}`);
    inputs.push({ path: input.path, sha256: artifact.sha256 });
  }
  const nodeModulesRoot = await realpath(args["--node-modules"]);
  const modulesMetadata = await stat(nodeModulesRoot);
  if (!modulesMetadata.isDirectory() || modulesMetadata.uid !== 0 || (modulesMetadata.mode & 0o022) !== 0) {
    fail("project-toolchain node_modules must be a root-frozen directory");
  }
  const observed = await observeProjectToolchain(nodeModulesRoot, requiredTests.projectToolchain);
  const [nodeArtifact, pnpmArtifact] = await Promise.all([
    hashOrdinaryFile(REQUIRED_NODE_PATH, { maxBytes: TOOLCHAIN_FILE_LIMIT_BYTES, label: "project-toolchain Node executable" }),
    hashOrdinaryFile(REQUIRED_PNPM_ENTRYPOINT, { maxBytes: CONTROL_FILE_LIMIT_BYTES, label: "project-toolchain pnpm entrypoint" })
  ]);
  for (const [label, artifact] of [["Node", nodeArtifact], ["pnpm", pnpmArtifact]]) {
    if (artifact.metadata.uid !== 0n || (artifact.metadata.mode & 0o7022n) !== 0n) {
      fail(`project-toolchain ${label} runtime is not root-frozen`);
    }
  }
  const receipt = {
    schemaVersion: 1,
    evidenceType: "release-project-toolchain-verification",
    status: "passed",
    createdAt: isoNow(),
    sourceManifestSha256: manifestArtifact.sha256,
    policy: {
      installedPath: REQUIRED_TESTS_PATH,
      sourceMember: REQUIRED_TESTS_MEMBER,
      artifactSha256: requiredTestsSha256,
      jsonPointer: "/projectToolchain",
      policyId: requiredTests.projectToolchain.policyId,
      sha256: requiredTests.projectToolchain.sha256
    },
    coordinator: { path: REQUIRED_COORDINATOR_PATH, sha256: coordinatorSha256 },
    inputs,
    runtime: {
      node: { path: REQUIRED_NODE_PATH, version: process.version, sha256: nodeArtifact.sha256 },
      pnpm: { path: REQUIRED_PNPM_ENTRYPOINT, version: REQUIRED_PNPM, sha256: pnpmArtifact.sha256 }
    },
    observedTools: observed.observed
  };
  const outputParent = await realpath(path.dirname(args["--output"]));
  const outputParentMetadata = await stat(outputParent);
  if (outputParentMetadata.uid !== 0 || (outputParentMetadata.mode & 0o022) !== 0) {
    fail("project-toolchain receipt parent must be root-frozen");
  }
  const outputPath = path.join(outputParent, path.basename(args["--output"]));
  await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  process.stdout.write(`${outputPath}\n`);
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (process.platform !== "linux" || process.getuid?.() !== 0) fail("release evidence must run as root in the reviewed Jammy builder, not macOS");
  if (process.version !== REQUIRED_NODE) fail(`release evidence requires fixed Node ${REQUIRED_NODE}`);
  if (!path.isAbsolute(args["--source-manifest"]) || !path.isAbsolute(args["--output"])) fail("evidence paths must be absolute");

  const coordinator = await realpath(process.argv[1]);
  if (coordinator !== REQUIRED_COORDINATOR_PATH) fail(`release evidence must use the installed coordinator: ${REQUIRED_COORDINATOR_PATH}`);
  const coordinatorMetadata = await lstat(coordinator);
  if (!coordinatorMetadata.isFile() || coordinatorMetadata.isSymbolicLink() || coordinatorMetadata.nlink !== 1 || coordinatorMetadata.uid !== 0 || (coordinatorMetadata.mode & 0o022) !== 0) fail("installed release-evidence coordinator is not root-frozen");

  const [activeNode, activePnpm, executingNode] = await Promise.all([
    realpath("/opt/nodejs/current/bin/node"),
    realpath("/opt/nodejs/current/bin/pnpm"),
    realpath(process.execPath)
  ]);
  if (activeNode !== REQUIRED_NODE_PATH || executingNode !== REQUIRED_NODE_PATH || activePnpm !== REQUIRED_PNPM_ENTRYPOINT) fail("release evidence must use the immutable approved Node/pnpm runtime");
  for (const executable of [activeNode, activePnpm]) {
    const metadata = await stat(executable);
    if (metadata.uid !== 0 || (metadata.mode & 0o022) !== 0) fail(`release toolchain is not root-frozen: ${executable}`);
  }
  const pnpmPackage = await hashOrdinaryFile(REQUIRED_PNPM_PACKAGE, { maxBytes: CONTROL_FILE_LIMIT_BYTES, label: "pnpm package metadata" });
  let pnpmVersion;
  try { pnpmVersion = JSON.parse(pnpmPackage.bytes.toString("utf8")).version; } catch { fail("fixed pnpm package metadata is invalid"); }
  if (pnpmVersion !== REQUIRED_PNPM) fail(`release evidence requires fixed pnpm ${REQUIRED_PNPM}`);

  const sourceRoot = await realpath(process.cwd());
  const sourceMetadata = await stat(sourceRoot);
  if (sourceMetadata.uid !== 0 || (sourceMetadata.mode & 0o022) !== 0) fail("source freeze must be root-owned and non-writable by other users");
  if (sourceRoot === "/opt/resume-ai" || sourceRoot.startsWith("/opt/resume-ai/")) fail("release evidence source must be an isolated builder copy, never an active or retained release");
  const rootDotenv = (await readdir(sourceRoot)).filter((name) => name.startsWith(".env") && name !== ".env.example");
  if (rootDotenv.length !== 0) fail("isolated builder copy contains a real or local dotenv file");

  const reviewedManifest = await realpath(args["--source-manifest"]);
  if (reviewedManifest === sourceRoot || reviewedManifest.startsWith(`${sourceRoot}${path.sep}`)) fail("reviewed source manifest must remain outside the frozen source copy");
  const reviewedParent = await realpath(path.dirname(reviewedManifest));
  for (const protectedPath of [reviewedManifest, reviewedParent]) {
    const metadata = await stat(protectedPath);
    if (metadata.uid !== 0 || (metadata.mode & 0o022) !== 0) fail(`reviewed evidence path is not root-frozen: ${protectedPath}`);
  }
  const manifestArtifact = await hashOrdinaryFile(reviewedManifest, { maxBytes: CONTROL_FILE_LIMIT_BYTES, label: "reviewed source manifest" });
  const sourceState = await inspectSource(sourceRoot, manifestArtifact);
  const coordinatorSha256 = await verifyInstalledControlFile(REQUIRED_COORDINATOR_PATH, SOURCE_MANIFEST_MEMBER, sourceState);
  const deepseekVerifierSha256 = await verifyInstalledControlFile(REQUIRED_DEEPSEEK_VERIFIER_PATH, DEEPSEEK_VERIFIER_MEMBER, sourceState);
  const spendControlSha256 = await verifyInstalledControlFile(REQUIRED_SPEND_CONTROL_PATH, SPEND_CONTROL_MEMBER, sourceState);
  const httpProbeSha256 = await verifyInstalledControlFile(REQUIRED_HTTP_PROBE_PATH, HTTP_PROBE_MEMBER, sourceState);
  const requiredTestsSha256 = await verifyInstalledControlFile(REQUIRED_TESTS_PATH, REQUIRED_TESTS_MEMBER, sourceState);
  const requiredTestsArtifact = await hashOrdinaryFile(REQUIRED_TESTS_PATH, { maxBytes: REQUIRED_TEST_MANIFEST_LIMIT_BYTES, label: "required-test manifest" });
  if (requiredTestsArtifact.sha256 !== requiredTestsSha256) fail("installed required-test manifest changed after control-file verification");
  const requiredTests = parseRequiredTestManifest(requiredTestsArtifact.bytes, sourceState.entries);

  // Explicit V6 only: v5 retains its original artifact whitelist and gates.
  let v6Delivery = null;
  if (args["--v6-delivery-output"]) {
    await verifyInstalledControlFile("/usr/local/lib/resume-ai/release-evidence-v6-contract.mjs", "scripts/lib/release-evidence-v6-contract.mjs", sourceState);
    await verifyInstalledControlFile("/usr/local/lib/resume-ai/release-evidence-v6-delivery.mjs", "scripts/lib/release-evidence-v6-delivery.mjs", sourceState);
    v6Delivery = await import("file:///usr/local/lib/resume-ai/release-evidence-v6-delivery.mjs");
  }
  const workParent = await realpath(REQUIRED_WORK_PARENT);
  const buildIdentity = await accountIdentity(BUILD_ACCOUNT);
  const verifyIdentity = await accountIdentity(VERIFY_ACCOUNT);
  const workParentMetadata = await stat(workParent);
  if (workParentMetadata.uid !== 0 || workParentMetadata.gid !== buildIdentity.gid || (workParentMetadata.mode & 0o022) !== 0) fail("release-evidence build-staging parent is not root-controlled");
  await Promise.all([assertAccountIdle(buildIdentity), assertAccountIdle(verifyIdentity)]);

  const outputParent = await realpath(path.dirname(args["--output"]));
  const outputCandidate = path.join(outputParent, path.basename(args["--output"]));
  const generationMatch = /^generation-([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/u.exec(path.basename(outputCandidate));
  if (
    outputParent !== REQUIRED_EVIDENCE_GENERATIONS_ROOT
    || outputCandidate !== path.normalize(args["--output"])
    || !generationMatch
  ) fail(`release evidence output must be a new generation-UUIDv4 below ${REQUIRED_EVIDENCE_GENERATIONS_ROOT}`);
  if (outputCandidate === sourceRoot || outputCandidate.startsWith(`${sourceRoot}${path.sep}`)) fail("release evidence output must remain outside the frozen source copy");
  const outputParentMetadata = await stat(outputParent);
  if (
    outputParentMetadata.uid !== 0
    || outputParentMetadata.gid !== 0
    || (outputParentMetadata.mode & 0o777) !== 0o700
  ) fail("release evidence generation root is not private, root-owned, and root-frozen");
  for (const ancestor of [outputParent, ...path.resolve(outputParent).split(path.sep).slice(1, -1)
    .reduce((paths, part) => [...paths, path.join(paths.at(-1) ?? path.sep, part)], [])]) {
    const metadata = await lstat(ancestor);
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== 0 || metadata.gid !== 0 || (metadata.mode & 0o022) !== 0) {
      fail(`release evidence generation ancestor is unsafe: ${ancestor}`);
    }
  }
  await mkdir(args["--output"], { recursive: false, mode: 0o700 });
  const output = await realpath(args["--output"]);
  if (output !== outputCandidate) fail("release evidence generation path changed while it was created");
  const runId = generationMatch[1];
  if (v6Delivery && args["--v6-delivery-output"] !== `/var/lib/resume-ai/v6-delivery-generations/delivery-${runId}`) fail("V6 delivery output must use the same engineering generation UUID");
  const workRoot = path.join(workParent, `release-evidence-${runId}`);
  await mkdir(workRoot, { mode: 0o750 });
  await chown(workRoot, 0, buildIdentity.gid);
  const logs = path.join(output, "validation-logs");
  await mkdir(logs, { mode: 0o700 });

  let engineeringSealed = false;
  let v6BuildToken = null;
  try {
    const startedAt = isoNow();
    const requiredTestManifestEvidencePath = path.join(output, "release-required-tests.json");
    await writeFile(requiredTestManifestEvidencePath, requiredTestsArtifact.bytes, { flag: "wx", mode: 0o600 });
    const requiredTestManifestEvidence = await hashOrdinaryFile(requiredTestManifestEvidencePath, {
      maxBytes: REQUIRED_TEST_MANIFEST_LIMIT_BYTES,
      label: "required-test manifest evidence"
    });
    if (requiredTestManifestEvidence.sha256 !== requiredTestsSha256) fail("required-test manifest evidence copy differs from installed policy");
    const requiresStage = sourceState.entries.some(row => row.relative === "src/lib/ai/effort-policy.mjs");
    const requiresTop5 = sourceState.entries.some(row => row.relative === "db/migrations/20261109_spend_v7_top5_policy.sql");
    const requiresUnbounded = sourceState.entries.some(row => row.relative === "db/migrations/20261109_spend_user_unbounded_execution.sql");
    const deepseekControl = await prepareDeepSeekCredential(workRoot, sourceState.entries.some(row => row.relative === "scripts/competitions/v7/build-worker.mjs"), sourceState.entries.find(row => row.relative === (requiresUnbounded ? "docs/v7/top5-unbounded-execution-contract-20261109.md" : requiresTop5 ? "docs/v7/top5-continuation-contract-20261109.md" : requiresStage ? "docs/v7/effort-continuation-contract-20261109.md" : "docs/v7/implementation-contract.md"))?.sha256, requiresStage, requiresTop5, requiresUnbounded);
    const trustedDependencies = await prepareTrustedDependencies({
      sourceRoot,
      sourceState,
      projectToolchainPolicy: requiredTests.projectToolchain,
      projectToolchainArtifactSha256: requiredTestsSha256,
      workRoot,
      buildIdentity,
      output,
      logs,
      runId
    });
    const baseline = await inspectProspectiveBaseline(sourceRoot);
    const builder = await prepareBuilderView({
      sourceRoot,
      sourceState,
      baseline,
      workRoot,
      buildIdentity,
      trustedDependencies
    });
    await runManifestControl({ builder, buildIdentity, workRoot, expectedBytes: manifestArtifact.bytes, suffix: "before" });
    const gates = [...trustedDependencies.gates];

    for (const [name, toolId, argv] of [
      ["typecheck", "typescript", ["--noEmit", "--incremental", "false"]],
      ["lint", "eslint", [".", "--max-warnings=0"]]
    ]) {
      const gate = await runProjectToolGate({ name, toolId, argv, builder, buildIdentity, workRoot, logPath: path.join(logs, `${name}.log`) });
      gates.push(gate.result);
    }

    const unitBuilderPath = path.join(builder.writable, "vitest-unit-result.json");
    let unit;
    try {
      unit = await runProjectToolGate({
      name: "unit",
      toolId: "vitest",
      argv: ["run", "--reporter=json", `--outputFile=${unitBuilderPath}`],
      builder,
      buildIdentity,
      workRoot,
      logPath: path.join(logs, "unit.log"),
      environment: { RUN_POSTGRES_SECURITY_STATE_TESTS: "0", RUN_DEEPSEEK_LIVE: "0" }
      });
    } finally {
      // Discard the separate unit output before any later gate can run; no
      // production build/PG/browser gate or signed delivery imports these bytes.
      await rm(builder.unitArtifacts.source, { recursive: true, force: true });
    }
    const unitArtifact = await publishMachineFile(unitBuilderPath, path.join(output, "vitest-unit-result.json"));
    unit.result.stats = parseVitestBytes(unitArtifact.bytes, { allowSkipped: true });
    unit.result.machineResultSha256 = unitArtifact.sha256;
    gates.push(unit.result);

    const build = await runProjectToolGate({
      name: "production-build",
      toolId: "next",
      argv: ["build"],
      builder,
      buildIdentity,
      workRoot,
      logPath: path.join(logs, "production-build.log"),
      environment: { NODE_ENV: "production", NEXT_DIST_DIR: ".next", ...deepseekControl.effortEnvironment }
    });
    gates.push(build.result);
    const workerBuild = await publishMachineFile(path.join(builder.mounts.worker.source, "decision-worker/manifest.json"), path.join(output, "worker-build-result.json"));
    const workerReceipt = JSON.parse(workerBuild.bytes.toString("utf8"));
    if(requiresUnbounded&&workerReceipt.executionMode!=="user-unbounded")fail("worker execution mode differs from the authorized release configuration");
    const workerBytes = await hashOrdinaryFile(path.join(builder.mounts.worker.source, "decision-worker/worker.mjs"), { label: "built decision worker" });
    const nextBinding = await hashOrdinaryFile(path.join(builder.mounts.next.source, "decision-worker-binding.json"), { label: "Next-worker build binding" });
    if (requiresStage && (workerReceipt.effortPolicySha256 !== deepseekControl.effortEnvironment.SAITU_V7_EFFORT_POLICY_SHA256 || releaseEffortPolicySha256(workerReceipt.effortPolicy) !== workerReceipt.effortPolicySha256)) fail("worker effort policy differs from the authorized release configuration");
    if (workerReceipt.schemaVersion !== "saitu.worker-build.v7" || workerReceipt.artifactSha256 !== workerBytes.sha256 || workerReceipt.nextBindingSha256 !== nextBinding.sha256) fail("worker build output does not match its source-bound receipt");
    if (v6Delivery) v6BuildToken = v6Delivery.captureProductionBuild({ sourceState, buildRoot: builder.mounts.next.source, workerRoot: path.join(builder.mounts.worker.source, "decision-worker") });

    const registryAddresses = await resolveHost("registry.npmjs.org");
    const registryHosts = await createHostsFile(workRoot, "registry.npmjs.org", { "registry.npmjs.org": registryAddresses });
    const audit = await runPnpmGate({
      name: "production-dependency-audit",
      argv: ["audit", "--prod", "--audit-level=low", "--json"],
      builder,
      buildIdentity,
      workRoot,
      logPath: path.join(logs, "production-dependency-audit.log"),
      environment: { npm_config_registry: "https://registry.npmjs.org/", NPM_CONFIG_REGISTRY: "https://registry.npmjs.org/" },
      networkAllow: registryAddresses,
      hostsFile: registryHosts
    });
    const auditReport = JSON.parse(audit.stdout.toString("utf8"));
    const vulnerabilities = auditReport?.metadata?.vulnerabilities;
    const vulnerabilityCounts = Object.values(vulnerabilities ?? {});
    if (JSON.stringify(Object.keys(vulnerabilities ?? {}).sort()) !== JSON.stringify(["critical", "high", "info", "low", "moderate"]) || vulnerabilityCounts.some((count) => !Number.isInteger(count) || count !== 0)) fail("production dependency audit contains a vulnerability");
    const auditResultPath = path.join(output, "pnpm-audit-result.json");
    await writeFile(auditResultPath, audit.stdout, { flag: "wx", mode: 0o600 });
    audit.result.stats = { vulnerabilities: 0 };
    audit.result.machineResultSha256 = (await hashOrdinaryFile(auditResultPath)).sha256;
    gates.push(audit.result);

    let postgresArtifact, nativePostgresEvidence;
    const postgres = await prepareEphemeralPostgres({ workRoot, buildIdentity });
    try {
      const postgresBuilderPath = path.join(builder.writable, "vitest-postgres-result.json");
      const postgresGate = await runProjectToolGate({
        name: "postgres-integration",
        toolId: "vitest",
        argv: ["run", "tests/security/competition-shared-state-postgres.integration.test.ts", "tests/competitions/v7/backend-review.integration.test.ts", "tests/competitions/v7/durable-state.integration.test.ts", "tests/competitions/v7/group-worker.integration.test.ts", "tests/ai/reservation-scope.integration.test.ts", "tests/ai/v7-effort-durable-postgres.integration.test.ts", "tests/deployment/v7-effort-fixed-postgres.integration.test.ts", "tests/ai/v7-top5-durable-postgres.integration.test.ts", "tests/deployment/v7-native-postgres.integration.test.ts", "--maxWorkers=1", "--no-file-parallelism", "--hookTimeout=120000", "--testTimeout=30000", "--reporter=json", `--outputFile=${postgresBuilderPath}`],
        builder,
        buildIdentity,
        workRoot,
        logPath: path.join(logs, "postgres-integration.log"),
        environment: {
          RUN_POSTGRES_SECURITY_STATE_TESTS: "1",
          POSTGRES_SECURITY_STATE_TEST_DATABASE_URL: postgres.adminUrl,
          POSTGRES_SECURITY_STATE_RUNTIME_DATABASE_URL: postgres.runtimeUrl,
          RUN_V7_DATABASE_TESTS: "1",
          RUN_V7_NATIVE_POSTGRES_TESTS: "1",
          V7_TEST_ADMIN_DATABASE_URL: postgres.adminUrl,
          V7_TEST_RUNTIME_DATABASE_URL: postgres.runtimeUrl,
          V7_NATIVE_EVIDENCE_DIRECTORY: path.join(builder.writable, "native-v7-postgres"),
          ...deepseekControl.effortEnvironment
        },
        joinUnit: postgres.serverUnit
      });
      postgresArtifact = await publishMachineFile(postgresBuilderPath, path.join(output, "vitest-postgres-result.json"));
      postgresGate.result.stats = parseVitestBytes(postgresArtifact.bytes, { allowSkipped: false });
      postgresGate.result.machineResultSha256 = postgresArtifact.sha256;
      const nativePostgres = await publishMachineFile(path.join(builder.writable, "native-v7-postgres/native-v7-postgres-result.json"), path.join(output, "native-v7-postgres-result.json"));
      const nativePostgresLog = await publishMachineFile(path.join(builder.writable, "native-v7-postgres/native-v7-postgres.log"), path.join(logs, "native-v7-postgres.log"));
      validateNativeV7PostgresEvidence(JSON.parse(nativePostgres.bytes.toString("utf8")), nativePostgresLog.bytes, new Map(sourceState.entries.map(entry => [entry.relative, entry.sha256])), workerReceipt);
      nativePostgresEvidence = { artifact: "native-v7-postgres-result.json", sha256: nativePostgres.sha256, rawLog: "validation-logs/native-v7-postgres.log", rawLogSha256: nativePostgresLog.sha256 };
      gates.push(postgresGate.result);
    } finally {
      await postgres.cleanup();
    }

    const deepseek = await runFixedDeepSeek({
      builder,
      verifyIdentity,
      workRoot,
      logPath: path.join(logs, "deepseek-preflight.log"),
      controlFile: deepseekControl,
      verifierSha256: deepseekVerifierSha256,
      spendControlSha256,budgetReceiptPath:path.join(output,"deepseek-budget-receipt.json")
    });
    const spendReceipt=await hashOrdinaryFile(path.join(output,"deepseek-budget-receipt.json"),{maxBytes:CONTROL_FILE_LIMIT_BYTES,label:"shared budget receipt"});
    deepseek.result.budgetReceipt="deepseek-budget-receipt.json";deepseek.result.budgetReceiptSha256=spendReceipt.sha256;
    gates.push(deepseek.result);

    const jsonBuilderPath = path.join(builder.writable, "playwright-report.json");
    const htmlBuilderPath = path.join(builder.writable, "playwright-report");
    const e2e = await runProjectToolGate({
      name: "production-e2e",
      toolId: "playwright-test",
      argv: ["test", "--reporter=json,html"],
      builder,
      buildIdentity,
      workRoot,
      logPath: path.join(logs, "production-e2e.log"),
      environment: {
        E2E_PRODUCTION: "1",
        ...productionBrowserBinding(workerReceipt, deepseekControl.effortEnvironment),
        PLAYWRIGHT_JSON_OUTPUT_NAME: jsonBuilderPath,
        PLAYWRIGHT_HTML_OUTPUT_DIR: htmlBuilderPath,
        PLAYWRIGHT_HTML_OPEN: "never",
        RELEASE_EVIDENCE_RUN_ID: runId
      }
    });
    const reportArtifact = await publishMachineFile(jsonBuilderPath, path.join(output, "playwright-report.json"));
    const report = JSON.parse(reportArtifact.bytes.toString("utf8"));
    const projects = new Set((report?.config?.projects ?? []).map((project) => project?.name));
    if (!projects.has("desktop") || !projects.has("mobile")) fail("Playwright lacks desktop/mobile projects");
    if (report?.stats?.unexpected !== 0 || !(report?.stats?.expected > 0)) fail("Playwright JSON is not passing");
    const projectStats = { desktop: { passed: 0, failed: 0, skipped: 0 }, mobile: { passed: 0, failed: 0, skipped: 0 } };
    for (const suite of report?.suites ?? []) visitPlaywrightSuite(suite, projectStats);
    for (const project of Object.values(projectStats)) if (project.passed <= 0 || project.failed !== 0) fail("Playwright project did not pass");
    const htmlReport = path.join(output, "playwright-report");
    await copyHtmlTree(htmlBuilderPath, htmlReport);
    const html = await hashHtmlTree(htmlReport);

    const redirectReceipt = await runFixedRedirectProbe({
      wwwUrl: args["--www-url"],
      verifyIdentity,
      workRoot,
      verifierSha256: httpProbeSha256
    });
    const e2eResult = {
      schemaVersion: 1,
      evidenceType: "playwright-production-e2e",
      status: "passed",
      failed: 0,
      runId,
      sourceManifestSha256: sourceState.sourceManifestSha256,
      sourceModeManifestSha256: sourceState.sourceModeManifestSha256,
      sourceModeMemberCount: sourceState.sourceModeMemberCount,
      startedAt: e2e.result.startedAt,
      completedAt: e2e.result.completedAt,
      productionBuild: true,
      playwrightReporter: "json",
      reporters: ["json", "html"],
      playwrightReportSha256: reportArtifact.sha256,
      playwrightHtmlManifestSha256: html.sha256,
      playwrightHtmlFiles: html.files,
      playwrightHtmlBytes: html.totalBytes,
      browsers: { desktop: true, mobile: true },
      projectStats,
      redirects: { www: true },
      wwwRedirect: {
        requestUrl: redirectReceipt.requestUrl,
        status: redirectReceipt.responseStatus,
        location: redirectReceipt.location,
        expectedLocation: redirectReceipt.expectedLocation,
        verifier: redirectReceipt.verifier,
        verifierSha256: httpProbeSha256
      }
    };
    const e2eResultPath = path.join(output, "e2e-result.json");
    await writeFile(e2eResultPath, `${JSON.stringify(e2eResult, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    e2e.result.e2eResultSha256 = (await hashOrdinaryFile(e2eResultPath)).sha256;
    e2e.result.playwrightReportSha256 = reportArtifact.sha256;
    e2e.result.playwrightHtmlManifestSha256 = html.sha256;
    gates.push(e2e.result);

    const requiredTestsStartedAt = isoNow();
    const requiredTestEvaluation = evaluateRequiredTestReports(requiredTests, {
      "vitest-unit": unitArtifact,
      "vitest-postgres": postgresArtifact,
      "playwright-production": reportArtifact
    }, builder.view);
    const requiredTestReceipt = {
      schemaVersion: 1,
      evidenceType: "release-required-test-receipt",
      status: "passed",
      runId,
      sourceManifestSha256: sourceState.sourceManifestSha256,
      sourceModeManifestSha256: sourceState.sourceModeManifestSha256,
      requiredTestManifest: {
        installedPath: REQUIRED_TESTS_PATH,
        sourceMember: REQUIRED_TESTS_MEMBER,
        artifact: "release-required-tests.json",
        sha256: requiredTestsSha256
      },
      minimumPassedObservations: requiredTestEvaluation.minimumPassedObservations,
      passedObservations: requiredTestEvaluation.passedObservations,
      reportSha256: requiredTestEvaluation.reportSha256,
      verified: requiredTestEvaluation.verified
    };
    const requiredTestReceiptPath = path.join(output, "required-test-receipt.json");
    await writeFile(requiredTestReceiptPath, `${JSON.stringify(requiredTestReceipt, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    const requiredTestReceiptSha256 = (await hashOrdinaryFile(requiredTestReceiptPath)).sha256;
    const requiredTestLog = Buffer.from(`${JSON.stringify({
      event: "release_required_tests",
      status: "passed",
      requiredTestManifestSha256: requiredTestsSha256,
      requiredTestReceiptSha256,
      minimumPassedObservations: requiredTestEvaluation.minimumPassedObservations,
      passedObservations: requiredTestEvaluation.passedObservations
    })}\n`);
    const requiredTestLogPath = path.join(logs, "required-tests.log");
    await writeFile(requiredTestLogPath, requiredTestLog, { flag: "wx", mode: 0o600 });
    const requiredTestsCompletedAt = isoNow();
    gates.push({
      name: "required-tests",
      command: {
        executable: REQUIRED_COORDINATOR_PATH,
        argv: ["verify-required-test-reports"],
        requiredTestManifestSha256: requiredTestsSha256
      },
      execution: {
        launcher: "trusted-coordinator",
        uid: "root",
        candidateCodeExecuted: false
      },
      startedAt: requiredTestsStartedAt,
      completedAt: requiredTestsCompletedAt,
      exitCode: 0,
      rawLog: "validation-logs/required-tests.log",
      rawLogSha256: sha256(requiredTestLog),
      requiredTestReceipt: "required-test-receipt.json",
      requiredTestReceiptSha256,
      minimumPassedObservations: requiredTestEvaluation.minimumPassedObservations,
      passedObservations: requiredTestEvaluation.passedObservations
    });

    await runManifestControl({ builder, buildIdentity, workRoot, expectedBytes: manifestArtifact.bytes, suffix: "after" });
    const [
      finalManifest,
      finalSourceState,
      finalBaseline,
      finalRequiredTestsArtifact,
      finalRequiredTestManifestEvidence,
      finalDependencyProvenanceReceipt
    ] = await Promise.all([
      hashOrdinaryFile(reviewedManifest, { maxBytes: CONTROL_FILE_LIMIT_BYTES, label: "reviewed source manifest" }),
      inspectSource(sourceRoot, manifestArtifact),
      inspectProspectiveBaseline(sourceRoot),
      hashOrdinaryFile(REQUIRED_TESTS_PATH, { maxBytes: REQUIRED_TEST_MANIFEST_LIMIT_BYTES, label: "required-test manifest" }),
      hashOrdinaryFile(requiredTestManifestEvidencePath, { maxBytes: REQUIRED_TEST_MANIFEST_LIMIT_BYTES, label: "required-test manifest evidence" }),
      hashOrdinaryFile(path.join(output, trustedDependencies.receipt), { maxBytes: CONTROL_FILE_LIMIT_BYTES, label: "dependency provenance receipt" })
    ]);
    if (!finalManifest.bytes.equals(manifestArtifact.bytes) || finalSourceState.sourceModeManifestSha256 !== sourceState.sourceModeManifestSha256 || finalSourceState.sourceModeMemberCount !== sourceState.sourceModeMemberCount) fail("source freeze changed during release validation");
    if (finalBaseline.byteSha256 !== baseline.byteSha256 || finalBaseline.artifactSha256 !== baseline.artifactSha256) fail("prospective baseline candidate changed during release validation");
    if (!finalRequiredTestsArtifact.bytes.equals(requiredTestsArtifact.bytes) || finalRequiredTestsArtifact.sha256 !== requiredTestsSha256) {
      fail("installed required-test manifest changed during release validation");
    }
    if (!finalRequiredTestManifestEvidence.bytes.equals(requiredTestsArtifact.bytes) || finalRequiredTestManifestEvidence.sha256 !== requiredTestsSha256) {
      fail("required-test manifest evidence changed during release validation");
    }
    if (finalDependencyProvenanceReceipt.sha256 !== trustedDependencies.receiptSha256) {
      fail("dependency provenance receipt changed during release validation");
    }
    const finalWorker = await hashOrdinaryFile(path.join(builder.mounts.worker.source, "decision-worker/worker.mjs"), { label: "final decision worker" });
    const finalWorkerManifest = await hashOrdinaryFile(path.join(builder.mounts.worker.source, "decision-worker/manifest.json"), { label: "final decision worker manifest" });
    if (finalWorker.sha256 !== workerBytes.sha256 || finalWorkerManifest.sha256 !== workerBuild.sha256) fail("decision worker changed after the production build gate");

    const completedAt = isoNow();
    const validation = {
      schemaVersion: 1,
      evidenceType: "release-validation",
      status: "passed",
      runId,
      sourceManifestSha256: sourceState.sourceManifestSha256,
      sourceModeManifestSha256: sourceState.sourceModeManifestSha256,
      sourceModeMemberCount: sourceState.sourceModeMemberCount,
      workerBuild: { artifact: "worker-build-result.json", sha256: workerBuild.sha256 },
      nativePostgres: nativePostgresEvidence,
      prospectiveBaselineCandidate: {
        path: baseline.path,
        byteSha256: baseline.byteSha256,
        artifactSha256: baseline.artifactSha256
      },
      requiredTests: {
        manifestInstalledPath: REQUIRED_TESTS_PATH,
        manifestSourceMember: REQUIRED_TESTS_MEMBER,
        manifestArtifact: "release-required-tests.json",
        manifestSha256: requiredTestsSha256,
        receipt: "required-test-receipt.json",
        receiptSha256: requiredTestReceiptSha256,
        minimumPassedObservations: requiredTestEvaluation.minimumPassedObservations,
        passedObservations: requiredTestEvaluation.passedObservations,
        reportSha256: requiredTestEvaluation.reportSha256
      },
      dependencyProvenance: {
        receipt: trustedDependencies.receipt,
        receiptSha256: trustedDependencies.receiptSha256,
        projectToolchainPolicySha256: trustedDependencies.projectToolchainPolicySha256,
        observedTools: trustedDependencies.observedTools,
        nodeModulesManifestSha256: trustedDependencies.nodeModulesManifestSha256,
        browserManifestSha256: trustedDependencies.browserManifestSha256,
        ambientInputUsed: false
      },
      startedAt,
      completedAt,
      requiredGates: REQUIRED_GATES,
      coordinator: { path: REQUIRED_COORDINATOR_PATH, sha256: coordinatorSha256, invocation: `${REQUIRED_NODE_PATH} ${REQUIRED_COORDINATOR_PATH}` },
      toolchain: {
        node: { executable: REQUIRED_NODE_PATH, version: process.version, sha256: (await hashOrdinaryFile(REQUIRED_NODE_PATH, { maxBytes: TOOLCHAIN_FILE_LIMIT_BYTES, label: "Node executable" })).sha256 },
        pnpm: { entrypoint: REQUIRED_PNPM_ENTRYPOINT, version: pnpmVersion, sha256: (await hashOrdinaryFile(REQUIRED_PNPM_ENTRYPOINT, { maxBytes: CONTROL_FILE_LIMIT_BYTES, label: "pnpm entrypoint" })).sha256 }
      },
      gates
    };
    await writeFile(path.join(output, "validation-result.json"), `${JSON.stringify(validation, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    await sealLinuxValidationGeneration({
      output,
      runId,
      sourceState,
      coordinatorSha256
    });
    engineeringSealed = true;
    if (v6Delivery) {
      const delivery = v6Delivery.prepareDelivery(v6BuildToken, { sourceRoot, workRoot, output: args["--v6-delivery-output"], runId, engineeringRoot: output, modulesRoot: path.join(builder.view, "node_modules"), buildIdentity });
      const environment = secretFreeEnvironment({ ...builder, home: delivery.home }, { NODE_ENV: "production" });
      const common = { identity: buildIdentity, cwd: delivery.runtime, environment, executable: REQUIRED_NODE_PATH, writablePaths: [path.join(delivery.runtime, "node_modules"), delivery.home, delivery.store], readOnlyRoot: delivery.runtime, privateNetwork: true };
      const prune = await runSandboxed({ ...common, name: "v6-delivery-prune", unit: `resume-ai-v6-prune-${runId}`, argv: [REQUIRED_PNPM_ENTRYPOINT, ...v6Delivery.PRUNE_ARGUMENTS, `--store-dir=${delivery.store}`], semanticCommand: { executable: REQUIRED_NODE_PATH, argv: [REQUIRED_PNPM_ENTRYPOINT, ...v6Delivery.PRUNE_ARGUMENTS, "--store-dir=<generation-store>"] }, logPath: delivery.log });
      const dependencies = await runSandboxed({ ...common, name: "v6-delivery-production-dependencies", unit: `resume-ai-v6-dependencies-${runId}`, argv: [REQUIRED_PNPM_ENTRYPOINT, "list", "--prod", "--depth=0", "--json"], semanticCommand: { executable: REQUIRED_NODE_PATH, argv: [REQUIRED_PNPM_ENTRYPOINT, "list", "--prod", "--depth=0", "--json"] }, logPath: delivery.dependenciesLog });
      v6Delivery.sealDelivery(v6BuildToken, { prune, dependencies });
    }
    process.stdout.write(`${output}\n`);
  } catch (error) {
    // Do not add bytes to the already signed, exact v5 artifact set if the new
    // V6 delivery step fails. No successful V6 completion is emitted.
    if (!engineeringSealed) await writeEvidenceFailure(output, error).catch(() => undefined);
    else if (v6Delivery) {
      // No filesystem operation may use caller delivery output after a failed
      // path guard. Keep diagnostics on the controller's existing stderr FD;
      // the original exception remains authoritative if diagnostics also fail.
      try {
        process.stderr.write("v6_delivery_failed_after_engineering_seal\n");
        for (const name of ["prune.log", "dependencies.log"]) {
          // workRoot is the root-controlled exclusive staging directory created
          // before any build account runs, not the rejected delivery output.
          const failureLog = await hashOrdinaryFile(path.join(workRoot, "v6-delivery", name), { label: "V6 failure log" }).catch(() => null);
          if (failureLog) process.stderr.write(`${JSON.stringify({ schemaVersion: "saitu.v6-delivery-failure-log.v1", name, sha256: failureLog.sha256, bytes: failureLog.bytes.length, encoding: "base64", data: failureLog.bytes.toString("base64") })}\n`);
        }
      } catch { /* Never replace the original failure or write a fallback path. */ }
    }
    throw error;
  } finally {
    if (!workRoot.startsWith(`${workParent}${path.sep}release-evidence-`)) fail("unsafe release-evidence cleanup target");
    await rm(workRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const invocation = process.argv[2] === "verify-project-toolchain"
    ? verifyProjectToolchainCli(process.argv.slice(3))
    : main();
  invocation.catch((error) => {
    process.stderr.write(`ERROR: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
