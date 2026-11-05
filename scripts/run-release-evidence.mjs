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
const HTTP_PROBE_MEMBER = "scripts/lib/release-evidence-http-probe.mjs";
const REQUIRED_TESTS_PATH = "/usr/local/lib/resume-ai/release-required-tests.json";
const REQUIRED_TESTS_MEMBER = "ops/config/release-required-tests.json";
const REQUIRED_TEST_POLICY_SHA256 = "69e7f409a3a07b7bcec7805032041a18051b1ca7f8e3842787414af103947321";
const PROSPECTIVE_BASELINE_MEMBER = "tests/fixtures/competition-score-prospective-baseline.json";
const DEPENDENCY_INPUT_MEMBERS = ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"];
const PROJECT_TOOLCHAIN_POLICY_ID = "resume-ai-project-toolchain.v1";
const TRUSTED_DEPENDENCY_INPUTS = [
  { path: "package.json", sha256: "d1af29380ea26fc3057eee45150b217f6d8163fee6625e293ac8796346cef488" },
  { path: "pnpm-lock.yaml", sha256: "528fe4316b80f1cdc3665303b967d25fc01b43f55cde03a1b9eb4693bc362db7" },
  { path: "pnpm-workspace.yaml", sha256: "e75f844f4a9a6e0f9b39809bf2e249625a3ce20590c40107f25dfa720aa451a5" }
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
  "dependency-provenance-receipt.json",
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

function parseArguments(argv) {
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
  const allowed = new Set(["--source-manifest", "--output", "--www-url"]);
  for (const key of Object.keys(values)) if (!allowed.has(key)) fail(`unknown argument: ${key}`);
  for (const key of allowed) if (!values[key]) fail(`missing argument: ${key}`);
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
  for (const config of ["playwright.config.ts", "vitest.config.ts"]) {
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

async function inspectProspectiveBaseline(sourceRoot) {
  const filename = path.join(sourceRoot, PROSPECTIVE_BASELINE_MEMBER);
  const artifact = await hashOrdinaryFile(filename, { maxBytes: REQUIRED_TEST_MANIFEST_LIMIT_BYTES, label: "prospective baseline candidate" });
  if (artifact.metadata.uid !== 0n || (artifact.metadata.mode & 0o7022n) !== 0n) fail("prospective baseline candidate is not root-frozen");
  let value;
  try { value = JSON.parse(artifact.bytes.toString("utf8")); } catch { fail("prospective baseline candidate is not JSON"); }
  const { artifactSha256, ...withoutArtifactHash } = value ?? {};
  if (value?.schemaVersion !== "competition-score-prospective-baseline.v1" || !/^[a-f0-9]{64}$/u.test(artifactSha256 ?? "") || artifactSha256 !== sha256(Buffer.from(canonicalJson(withoutArtifactHash)))) {
    fail("prospective baseline candidate has an invalid canonical artifact hash");
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
  for (const [name, relative] of [["next", ".next"], ["nextE2e", ".next-e2e"], ["testResults", "test-results"], ["viteCache", "node_modules/.vite"]]) {
    await ensureReadOnlyViewDirectory(view, relative, buildIdentity);
    const output = path.join(writable, name);
    await mkdir(output, { mode: 0o700 });
    await chown(output, buildIdentity.uid, buildIdentity.gid);
    mounts[name] = { source: output, target: path.join(view, ...relative.split("/")) };
  }
  const home = path.join(writable, "home");
  await mkdir(home, { mode: 0o700 });
  await chown(home, buildIdentity.uid, buildIdentity.gid);
  return {
    view,
    writable,
    home,
    mounts,
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
    writablePaths: [builder.writable],
    readOnlyRoot: builder.view,
    binds: Object.values(builder.mounts),
    privateNetwork: !networkAllow?.length,
    joinUnit,
    networkAllow,
    hostsFile,
    allowNamespaces: name === "production-e2e",
    inaccessiblePaths: [
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
    argv: [tool.executable, ...argv],
    semanticCommand: {
      executable: REQUIRED_NODE_PATH,
      argv: [`<frozen-node_modules>/${tool.relativePath}`, ...argv],
      projectTool: toolId,
      executableSha256: tool.sha256
    },
    logPath,
    writablePaths: [builder.writable],
    readOnlyRoot: builder.view,
    binds: Object.values(builder.mounts),
    privateNetwork: true,
    joinUnit,
    allowNamespaces: name === "production-e2e",
    inaccessiblePaths: [
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

function assertDeepSeekLog(raw) {
  const required = new Set(["models", "competition_normalize", "competition_followup_policy", "competition_recommend"]);
  for (const line of raw.toString("utf8").split(/\r?\n/u)) {
    const candidate = line.trim();
    if (!candidate.startsWith("{")) continue;
    try {
      const value = JSON.parse(candidate);
      if (value?.event !== "deepseek_preflight") continue;
      if (value.status === "ok" && value.verifier === "release-evidence-deepseek.v1") required.delete(value.operation);
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

async function prepareDeepSeekCredential(workRoot) {
  const apiKey = String(process.env.AI_API_KEY ?? "").trim();
  delete process.env.AI_API_KEY;
  if (apiKey.length < 16 || /[\r\n\t ]/u.test(apiKey)) fail("AI_API_KEY is required only for the fixed one-shot DeepSeek verifier");
  const normalizeModel = String(process.env.AI_COMPETITION_NORMALIZE_MODEL ?? process.env.AI_MODEL ?? "deepseek-v4-pro").trim();
  const recommendModel = String(process.env.AI_COMPETITION_RECOMMEND_MODEL ?? process.env.AI_MODEL ?? "deepseek-v4-pro").trim();
  if (![normalizeModel, recommendModel].every((value) => /^[A-Za-z0-9._-]{1,128}$/u.test(value))) fail("DeepSeek model name is unsafe");
  const credential = path.join(workRoot, "deepseek.credential");
  await writeFile(credential, `${apiKey}\n`, { flag: "wx", mode: 0o400 });
  await chown(credential, 0, 0);
  await chmod(credential, 0o400);
  return { credential, normalizeModel, recommendModel };
}

async function runFixedDeepSeek({ builder, verifyIdentity, workRoot, logPath, controlFile, verifierSha256 }) {
  await assertAccountIdle(verifyIdentity);
  const addresses = await resolveHost("api.deepseek.com");
  const hostsFile = await createHostsFile(workRoot, "api.deepseek.com", { "api.deepseek.com": addresses });
  const unit = `resume-ai-evidence-deepseek-${path.basename(workRoot).slice(-12)}.service`;
  const credentialPath = `/run/credentials/${unit}/deepseek-key`;
  try {
    const result = await runSandboxed({
      name: "deepseek-preflight",
      unit,
      identity: verifyIdentity,
      cwd: "/",
      environment: { PATH: BUILDER_PATH, NODE_ENV: "production" },
      executable: REQUIRED_NODE_PATH,
      argv: [REQUIRED_DEEPSEEK_VERIFIER_PATH, credentialPath, controlFile.normalizeModel, controlFile.recommendModel],
      semanticCommand: {
        executable: REQUIRED_NODE_PATH,
        argv: [REQUIRED_DEEPSEEK_VERIFIER_PATH, "<systemd-credential>", controlFile.normalizeModel, controlFile.recommendModel],
        verifierSha256
      },
      logPath,
      writablePaths: [],
      readOnlyRoot: "/",
      privateNetwork: false,
      networkAllow: addresses,
      hostsFile,
      credentials: [{ name: "deepseek-key", path: controlFile.credential }],
      inaccessiblePaths: [`-${builder.view}`, `-${builder.writable}`]
    });
    assertDeepSeekLog(result.stdout);
    return result;
  } finally {
    await rm(controlFile.credential, { force: true });
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
    writablePaths: [builder.writable],
    readOnlyRoot: builder.view,
    binds: Object.values(builder.mounts),
    privateNetwork: true,
    inaccessiblePaths: [
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
  const data = path.join("/run", `resume-ai-evidence-pg-${id}`);
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
  const httpProbeSha256 = await verifyInstalledControlFile(REQUIRED_HTTP_PROBE_PATH, HTTP_PROBE_MEMBER, sourceState);
  const requiredTestsSha256 = await verifyInstalledControlFile(REQUIRED_TESTS_PATH, REQUIRED_TESTS_MEMBER, sourceState);
  const requiredTestsArtifact = await hashOrdinaryFile(REQUIRED_TESTS_PATH, { maxBytes: REQUIRED_TEST_MANIFEST_LIMIT_BYTES, label: "required-test manifest" });
  if (requiredTestsArtifact.sha256 !== requiredTestsSha256) fail("installed required-test manifest changed after control-file verification");
  const requiredTests = parseRequiredTestManifest(requiredTestsArtifact.bytes, sourceState.entries);

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
  const workRoot = path.join(workParent, `release-evidence-${runId}`);
  await mkdir(workRoot, { mode: 0o750 });
  await chown(workRoot, 0, buildIdentity.gid);
  const logs = path.join(output, "validation-logs");
  await mkdir(logs, { mode: 0o700 });

  try {
    const startedAt = isoNow();
    const requiredTestManifestEvidencePath = path.join(output, "release-required-tests.json");
    await writeFile(requiredTestManifestEvidencePath, requiredTestsArtifact.bytes, { flag: "wx", mode: 0o600 });
    const requiredTestManifestEvidence = await hashOrdinaryFile(requiredTestManifestEvidencePath, {
      maxBytes: REQUIRED_TEST_MANIFEST_LIMIT_BYTES,
      label: "required-test manifest evidence"
    });
    if (requiredTestManifestEvidence.sha256 !== requiredTestsSha256) fail("required-test manifest evidence copy differs from installed policy");
    const deepseekControl = await prepareDeepSeekCredential(workRoot);
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
    const unit = await runProjectToolGate({
      name: "unit",
      toolId: "vitest",
      argv: ["run", "--reporter=json", `--outputFile=${unitBuilderPath}`],
      builder,
      buildIdentity,
      workRoot,
      logPath: path.join(logs, "unit.log"),
      environment: { RUN_POSTGRES_SECURITY_STATE_TESTS: "0", RUN_DEEPSEEK_LIVE: "0" }
    });
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
      environment: { NODE_ENV: "production", NEXT_DIST_DIR: ".next" }
    });
    gates.push(build.result);

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

    let postgresArtifact;
    const postgres = await prepareEphemeralPostgres({ workRoot, buildIdentity });
    try {
      const postgresBuilderPath = path.join(builder.writable, "vitest-postgres-result.json");
      const postgresGate = await runProjectToolGate({
        name: "postgres-integration",
        toolId: "vitest",
        argv: ["run", "tests/security/competition-shared-state-postgres.integration.test.ts", "--reporter=json", `--outputFile=${postgresBuilderPath}`],
        builder,
        buildIdentity,
        workRoot,
        logPath: path.join(logs, "postgres-integration.log"),
        environment: {
          RUN_POSTGRES_SECURITY_STATE_TESTS: "1",
          POSTGRES_SECURITY_STATE_TEST_DATABASE_URL: postgres.adminUrl,
          POSTGRES_SECURITY_STATE_RUNTIME_DATABASE_URL: postgres.runtimeUrl
        },
        joinUnit: postgres.serverUnit
      });
      postgresArtifact = await publishMachineFile(postgresBuilderPath, path.join(output, "vitest-postgres-result.json"));
      postgresGate.result.stats = parseVitestBytes(postgresArtifact.bytes, { allowSkipped: false });
      postgresGate.result.machineResultSha256 = postgresArtifact.sha256;
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
      verifierSha256: deepseekVerifierSha256
    });
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

    const completedAt = isoNow();
    const validation = {
      schemaVersion: 1,
      evidenceType: "release-validation",
      status: "passed",
      runId,
      sourceManifestSha256: sourceState.sourceManifestSha256,
      sourceModeManifestSha256: sourceState.sourceModeManifestSha256,
      sourceModeMemberCount: sourceState.sourceModeMemberCount,
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
    process.stdout.write(`${output}\n`);
  } catch (error) {
    await writeEvidenceFailure(output, error).catch(() => undefined);
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
