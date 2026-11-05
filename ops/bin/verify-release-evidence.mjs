#!/usr/bin/env node

import { createHash, verify as verifyBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstat, mkdtemp, readFile, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const REQUIRED_GATES = [
  "dependency-fetch", "dependency-offline-install", "playwright-browser-fetch",
  "dependency-provenance", "typecheck", "lint", "unit", "production-build",
  "production-dependency-audit", "postgres-integration", "deepseek-preflight",
  "production-e2e", "required-tests"
];
const REQUIRED_NODE_PATH = "/opt/nodejs/node-v24.20.0-linux-x64/bin/node";
const REQUIRED_PNPM_ENTRYPOINT = "/opt/nodejs/node-v24.20.0-linux-x64/lib/runtime-tools/node_modules/pnpm/bin/pnpm.mjs";
const REQUIRED_COORDINATOR_PATH = "/usr/local/lib/resume-ai/run-release-evidence.mjs";
const REQUIRED_DEEPSEEK_VERIFIER_PATH = "/usr/local/lib/resume-ai/release-evidence-deepseek-verifier.mjs";
const REQUIRED_TESTS_PATH = "/usr/local/lib/resume-ai/release-required-tests.json";
const REQUIRED_TESTS_MEMBER = "ops/config/release-required-tests.json";
const REQUIRED_TEST_POLICY_SHA256 = "69e7f409a3a07b7bcec7805032041a18051b1ca7f8e3842787414af103947321";
const REQUIRED_EVIDENCE_GENERATIONS_ROOT = "/var/lib/resume-ai/release-evidence-generations";
const EVIDENCE_SIGNING_PUBLIC_KEY = "/etc/resume-ai/release-evidence-signing.pub";
const LINUX_GENERATION_MANIFEST = "linux-validation-artifact-manifest.txt";
const LINUX_GENERATION_ATTESTATION = "linux-validation-attestation.json";
const LINUX_GENERATION_SCHEMA = "resume-ai-linux-validation-generation.v1";
const LINUX_GENERATION_MANIFEST_ALGORITHM = "sha256-bytes-path.v1";
const REQUIRED_TEST_MANIFEST_LIMIT_BYTES = 1024 * 1024;
const REQUIRED_TEST_RECEIPT_LIMIT_BYTES = 16 * 1024 * 1024;
const DEPENDENCY_PROVENANCE_RECEIPT_LIMIT_BYTES = 16 * 1024 * 1024;
const PROJECT_TOOLCHAIN_POLICY_ID = "resume-ai-project-toolchain.v1";
const PROJECT_TOOLCHAIN_POLICY_SHA256 = "5f0a44a4d5106af0095a4d73e0e2498d9b6d88c67a79d98c5f626fd5fcda2adb";
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
const REQUIRED_TEST_CATEGORIES = new Set([
  "followups-0", "followups-1", "followups-2", "followups-3", "pure-text-max-10",
  "shared-nat-50", "threshold-429-recovery", "token-forgery", "token-expiry",
  "token-replay", "token-cross-session", "queue-full-fallback", "quota-config-consistency",
  "desktop-e2e", "mobile-e2e"
]);
const REQUIRED_TEST_IDS = [
  "followups-0-desktop",
  "followups-1-desktop",
  "followups-2-desktop",
  "followups-2-mobile",
  "followups-3-pure-text-desktop",
  "followups-3-pure-text-mobile",
  "shared-nat-50-postgres",
  "shared-nat-50-full-stack",
  "session-start-real-threshold",
  "countdown-answer-recovery-desktop",
  "countdown-answer-recovery-mobile",
  "conversation-token-forgery",
  "conversation-token-expiry",
  "conversation-token-semantic-replay",
  "cross-session-isolation",
  "queue-8-active-32-waiting",
  "queue-full-deterministic-fallback",
  "root-quota-generation-consistency",
  "nginx-three-endpoint-consistency"
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
const MAX_EVIDENCE_AGE_MS = 24 * 60 * 60_000;
const HTML_REPORT_FILE_LIMIT_BYTES = 64 * 1024 * 1024;
const HTML_REPORT_TOTAL_LIMIT_BYTES = 512 * 1024 * 1024;
const HTML_REPORT_MEMBER_LIMIT = 20_000;
const HTML_REPORT_DEPTH_LIMIT = 128;
const TRUSTED_GENERATIONS_ROOT = "/private/var/db/com.siyuanjiaxin.resume-ai/deep-scan-generations";
const TRUSTED_CREATOR_PATH = "/Library/PrivilegedHelperTools/com.siyuanjiaxin.resume-ai.create-deep-scan-generation";
const TRUSTED_ATTESTATION_SCHEMA = "com.siyuanjiaxin.resume-ai.deep-scan-generation/v1";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const fail = (message) => { throw new Error(message); };
let temporaryEvidenceDir = null;

function releaseSourceRows(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.at(-1) !== 0x0a) fail("source manifest is not canonical");
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes)) fail("source manifest is not UTF-8");
  const rows = new Map();
  let previous;
  for (const line of text.slice(0, -1).split("\n")) {
    const match = /^([a-f0-9]{64})\t([FL])\t(.+)$/u.exec(line);
    if (!match) fail("source manifest row is malformed");
    const [, digest, kind, relative] = match;
    if (
      relative.startsWith("/")
      || /[\0\r\n\t]/u.test(relative)
      || relative.split("/").some((part) => !part || part === "." || part === "..")
      || rows.has(relative)
    ) fail("source manifest path is unsafe or duplicated");
    const relativeBytes = Buffer.from(relative, "utf8");
    if (previous && Buffer.compare(previous, relativeBytes) >= 0) fail("source manifest paths are not byte sorted");
    previous = relativeBytes;
    rows.set(relative, { digest, kind });
  }
  if (rows.size === 0) fail("source manifest is empty");
  return rows;
}

function safeManifestPath(relative) {
  return typeof relative === "string"
    && relative.length > 0
    && relative === relative.normalize("NFC")
    && !relative.startsWith("/")
    && !relative.includes("\\")
    && !/[\0\r\n\t]/u.test(relative)
    && !relative.split("/").some((part) => !part || part === "." || part === "..")
    && path.posix.normalize(relative) === relative;
}

function exactKeys(value, expected) {
  return value && typeof value === "object" && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
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

function requiredTestText(value, label, maximum = 512) {
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

function parseProjectToolchainPolicy(value, sourceRows) {
  const expectedRuntime = {
    node: { executable: REQUIRED_NODE_PATH, version: "v24.20.0" },
    pnpm: { entrypoint: REQUIRED_PNPM_ENTRYPOINT, name: "pnpm", version: "11.19.0" }
  };
  if (
    !exactKeys(value, ["schemaVersion", "policyId", "inputs", "runtime", "tools"])
    || value.schemaVersion !== 1
    || value.policyId !== PROJECT_TOOLCHAIN_POLICY_ID
    || canonicalJson(value.inputs) !== canonicalJson(TRUSTED_DEPENDENCY_INPUTS)
    || canonicalJson(value.runtime) !== canonicalJson(expectedRuntime)
    || canonicalJson(value.tools) !== canonicalJson(TRUSTED_PROJECT_TOOLS)
  ) fail("project-toolchain policy differs from the fixed execution authority");
  for (const input of TRUSTED_DEPENDENCY_INPUTS) {
    const reviewed = sourceRows.get(input.path);
    if (reviewed?.kind !== "F" || reviewed.digest !== input.sha256) {
      fail(`project-toolchain input differs from reviewed source: ${input.path}`);
    }
  }
  const policySha256 = sha256(Buffer.from(canonicalJson(value)));
  if (policySha256 !== PROJECT_TOOLCHAIN_POLICY_SHA256) fail("project-toolchain canonical policy hash differs");
  return {
    schemaVersion: 1,
    policyId: PROJECT_TOOLCHAIN_POLICY_ID,
    inputs: TRUSTED_DEPENDENCY_INPUTS.map((input) => ({ ...input })),
    runtime: expectedRuntime,
    tools: TRUSTED_PROJECT_TOOLS.map((tool) => ({ ...tool })),
    sha256: policySha256
  };
}

export function parseRequiredTestManifest(bytes, sourceRows) {
  if (!Buffer.isBuffer(bytes) || sha256(bytes) !== REQUIRED_TEST_POLICY_SHA256) {
    fail("required-test manifest whole-policy SHA-256 differs from the fixed authority");
  }
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > REQUIRED_TEST_MANIFEST_LIMIT_BYTES || bytes.at(-1) !== 0x0a || bytes.includes(0x0d)) {
    fail("required-test manifest must be bounded canonical LF JSON");
  }
  const textValue = bytes.toString("utf8");
  if (!Buffer.from(textValue, "utf8").equals(bytes)) fail("required-test manifest is not UTF-8");
  let value;
  try { value = JSON.parse(textValue); } catch { fail("required-test manifest is not JSON"); }
  if (
    !exactKeys(value, ["schemaVersion", "evidenceType", "minimumPassedObservations", "projectToolchain", "sourcePins", "requirements"])
    || value.schemaVersion !== 1
    || value.evidenceType !== "resume-ai-release-required-tests"
    || value.minimumPassedObservations !== REQUIRED_TEST_IDS.length
    || !Array.isArray(value.sourcePins)
    || value.sourcePins.length === 0
    || !Array.isArray(value.requirements)
    || value.requirements.length !== REQUIRED_TEST_IDS.length
  ) fail("required-test manifest has an invalid fixed top-level contract");
  const projectToolchain = parseProjectToolchainPolicy(value.projectToolchain, sourceRows);

  const pins = new Map();
  let previousPin;
  for (const pin of value.sourcePins) {
    if (!exactKeys(pin, ["path", "sha256"]) || !safeManifestPath(pin.path) || !/^[a-f0-9]{64}$/u.test(pin.sha256)) {
      fail("required-test manifest contains an invalid source pin");
    }
    if (previousPin && Buffer.compare(Buffer.from(previousPin), Buffer.from(pin.path)) >= 0) {
      fail("required-test source pins are not in canonical byte order");
    }
    previousPin = pin.path;
    if (pins.has(pin.path)) fail("required-test source pin is duplicated");
    const reviewed = sourceRows.get(pin.path);
    if (reviewed?.kind !== "F" || reviewed.digest !== pin.sha256) {
      fail(`required-test pinned source differs from the reviewed release: ${pin.path}`);
    }
    pins.set(pin.path, pin.sha256);
  }
  for (const config of ["playwright.config.ts", "vitest.config.ts"]) {
    if (!pins.has(config)) fail(`required-test manifest does not pin ${config}`);
  }

  const coveredCategories = new Set();
  const observationKeys = new Set();
  const requirements = value.requirements.map((requirement, index) => {
    if (!exactKeys(requirement, ["id", "categories", "framework", "report", "testFile", "fullName", "project", "minimumPassed"])) {
      fail("required-test entry has unexpected fields");
    }
    const id = requiredTestText(requirement.id, "id", 96);
    if (id !== REQUIRED_TEST_IDS[index]) fail("required-test fixed identity or order differs");
    if (!Array.isArray(requirement.categories) || requirement.categories.length === 0) fail(`required-test categories are empty: ${id}`);
    const categories = requirement.categories.map((category) => requiredTestText(category, "category", 64));
    if (new Set(categories).size !== categories.length || categories.some((category) => !REQUIRED_TEST_CATEGORIES.has(category))) {
      fail(`required-test categories are unknown or duplicated: ${id}`);
    }
    for (const category of categories) coveredCategories.add(category);
    const testFile = requiredTestText(requirement.testFile, "file", 256);
    if (!safeManifestPath(testFile) || !pins.has(testFile)) fail(`required-test file is unsafe or unpinned: ${id}`);
    const fullName = requiredTestText(requirement.fullName, "fullName", 512);
    const { framework, report, project } = requirement;
    const validReport = (
      framework === "vitest"
      && ((report === "vitest-unit" && project === "unit") || (report === "vitest-postgres" && project === "postgres-integration"))
    ) || (
      framework === "playwright"
      && report === "playwright-production"
      && ["desktop", "mobile"].includes(project)
    );
    if (!validReport || requirement.minimumPassed !== 1) fail(`required-test execution contract differs: ${id}`);
    const observationKey = [report, testFile, fullName, project].join("\0");
    if (observationKeys.has(observationKey)) fail(`required-test observation is duplicated: ${id}`);
    observationKeys.add(observationKey);
    return { id, categories, framework, report, testFile, fullName, project, minimumPassed: 1 };
  });
  if (JSON.stringify([...coveredCategories].sort()) !== JSON.stringify([...REQUIRED_TEST_CATEGORIES].sort())) {
    fail("required-test manifest does not cover every fixed release requirement");
  }
  return { pins, requirements, minimumPassedObservations: REQUIRED_TEST_IDS.length, projectToolchain };
}

function canonicalBase64(value, label) {
  if (typeof value !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) fail(`invalid ${label} encoding`);
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) fail(`non-canonical ${label} encoding`);
  return bytes;
}

function argumentsOf(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--") || Object.hasOwn(values, key)) fail("invalid evidence verifier arguments");
    values[key] = value;
  }
  const allowed = [
    "--evidence-dir",
    "--source-manifest",
    "--source-mode-manifest-sha256",
    "--source-mode-member-count",
    "--bundle",
    "--trusted-generation-attestation-sha256",
    "--trusted-generation-producer-sha256",
    "--trusted-deep-scan-completion-sha256"
  ];
  if (Object.keys(values).some((key) => !allowed.includes(key)) || (!values["--evidence-dir"] && !values["--bundle"])) fail("usage: verify-release-evidence.mjs (--evidence-dir ABS --source-manifest ABS --source-mode-manifest-sha256 SHA256 --source-mode-member-count N | --bundle ABS [--evidence-dir EXTRACTED])");
  if (Boolean(values["--source-manifest"]) === Boolean(values["--bundle"])) fail("select exactly one source-manifest mode");
  if (
    (values["--source-manifest"] && (!values["--source-mode-manifest-sha256"] || !values["--source-mode-member-count"]))
    || (values["--bundle"] && (values["--source-mode-manifest-sha256"] || values["--source-mode-member-count"]))
  ) fail("source mode binding arguments differ from the selected verifier mode");
  const hasAttestationPin = Boolean(values["--trusted-generation-attestation-sha256"]);
  const hasProducerPin = Boolean(values["--trusted-generation-producer-sha256"]);
  const hasCompletionPin = Boolean(values["--trusted-deep-scan-completion-sha256"]);
  if (new Set([hasAttestationPin, hasProducerPin, hasCompletionPin]).size !== 1) fail("trusted Deep Scan pins must be supplied together");
  for (const key of ["--trusted-generation-attestation-sha256", "--trusted-generation-producer-sha256", "--trusted-deep-scan-completion-sha256"]) {
    if (values[key] && !/^[a-f0-9]{64}$/u.test(values[key])) fail("trusted generation pin is malformed");
  }
  return values;
}

async function artifact(filename, ceiling = 128 * 1024 * 1024) {
  const before = await lstat(filename, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size > BigInt(ceiling)) fail(`unsafe release evidence file: ${filename}`);
  const bytes = await readFile(filename);
  const after = await lstat(filename, { bigint: true });
  for (const key of ["dev", "ino", "mode", "nlink", "size", "mtimeNs", "ctimeNs"]) if (before[key] !== after[key]) fail(`release evidence changed while verifying: ${filename}`);
  return { bytes, sha256: sha256(bytes) };
}

function instant(value, label) {
  if (!/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(value ?? "")) fail(`invalid ${label}`);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString().replace(/\.000Z$/u, "Z") !== value || milliseconds > Date.now() + 5 * 60_000) fail(`invalid ${label}`);
  return milliseconds;
}

function ordered(start, end, label, maximum = 120 * 60 * 60_000) {
  const startMs = instant(start, `${label} start`);
  const endMs = instant(end, `${label} completion`);
  if (endMs < startMs || endMs - startMs > maximum) fail(`${label} timestamps are inconsistent`);
}

async function validateLinuxGenerationAttestation({
  evidenceDir,
  validation,
  sourceManifestSha256,
  sourceModeManifestSha256,
  sourceModeMemberCount,
  coordinatorSha256,
  publicKeyPath = EVIDENCE_SIGNING_PUBLIC_KEY,
  enforceRootPublicKey = true
}) {
  const [attestationArtifact, manifestArtifact, publicKeyArtifact] = await Promise.all([
    artifact(path.join(evidenceDir, LINUX_GENERATION_ATTESTATION), 1024 * 1024),
    artifact(path.join(evidenceDir, LINUX_GENERATION_MANIFEST), 32 * 1024 * 1024),
    artifact(publicKeyPath, 1024 * 1024)
  ]);
  const publicKeyMetadata = await lstat(publicKeyPath, { bigint: true });
  if (enforceRootPublicKey && (
    !publicKeyMetadata.isFile()
    || publicKeyMetadata.isSymbolicLink()
    || publicKeyMetadata.nlink !== 1n
    || publicKeyMetadata.uid !== 0n
    || publicKeyMetadata.gid !== 0n
    || (publicKeyMetadata.mode & 0o777n) !== 0o644n
  )) fail("Linux validation public key is not a fixed root trust anchor");
  let attestation;
  try { attestation = JSON.parse(attestationArtifact.bytes.toString("utf8")); } catch { fail("Linux validation attestation is not JSON"); }
  if (
    !exactKeys(attestation, [
      "schemaVersion", "evidenceType", "algorithm", "publicKey", "payloadEncoding",
      "payloadSha256", "payloadBase64", "signatureBase64"
    ])
    || attestation.schemaVersion !== 1
    || attestation.evidenceType !== LINUX_GENERATION_SCHEMA
    || attestation.algorithm !== "Ed25519"
    || !exactKeys(attestation.publicKey, ["path", "sha256"])
    || attestation.publicKey.path !== EVIDENCE_SIGNING_PUBLIC_KEY
    || attestation.publicKey.sha256 !== publicKeyArtifact.sha256
    || attestation.payloadEncoding !== "base64"
  ) fail("Linux validation attestation trust anchor or schema differs");
  const payloadBytes = canonicalBase64(attestation.payloadBase64, "Linux validation signed payload");
  const signatureBytes = canonicalBase64(attestation.signatureBase64, "Linux validation Ed25519 signature");
  if (
    payloadBytes.length === 0
    || payloadBytes.length > 64 * 1024
    || payloadBytes.at(-1) !== 0x0a
    || payloadBytes.includes(0x0d)
    || sha256(payloadBytes) !== attestation.payloadSha256
    || signatureBytes.length !== 64
    || !verifyBytes(null, payloadBytes, publicKeyArtifact.bytes, signatureBytes)
  ) fail("Linux validation generation signature or signed payload differs");
  let payload;
  try { payload = JSON.parse(payloadBytes.toString("utf8")); } catch { fail("Linux validation signed payload is not JSON"); }
  if (!Buffer.from(`${JSON.stringify(payload)}\n`, "utf8").equals(payloadBytes)) {
    fail("Linux validation signed payload is not canonical JSON");
  }
  if (
    !exactKeys(payload, [
      "schemaVersion", "evidenceType", "status", "runId", "generationRoot", "createdAt",
      "sourceManifestSha256", "sourceModeManifestSha256", "sourceModeMemberCount",
      "producer", "artifactManifest"
    ])
    || payload.schemaVersion !== 1
    || payload.evidenceType !== "resume-ai-linux-validation-generation-payload"
    || payload.status !== "sealed"
    || payload.runId !== validation.runId
    || payload.generationRoot !== `${REQUIRED_EVIDENCE_GENERATIONS_ROOT}/generation-${validation.runId}`
    || payload.sourceManifestSha256 !== sourceManifestSha256
    || payload.sourceModeManifestSha256 !== sourceModeManifestSha256
    || payload.sourceModeMemberCount !== sourceModeMemberCount
    || !exactKeys(payload.producer, ["path", "sha256"])
    || payload.producer.path !== REQUIRED_COORDINATOR_PATH
    || payload.producer.sha256 !== coordinatorSha256
    || !exactKeys(payload.artifactManifest, ["artifact", "algorithm", "sha256", "memberCount", "totalBytes"])
    || payload.artifactManifest.artifact !== LINUX_GENERATION_MANIFEST
    || payload.artifactManifest.algorithm !== LINUX_GENERATION_MANIFEST_ALGORITHM
    || payload.artifactManifest.sha256 !== manifestArtifact.sha256
  ) fail("Linux validation signed generation is not bound to this source, run, and coordinator");
  const attestedAt = instant(payload.createdAt, "Linux validation generation seal");
  const validationCompleted = instant(validation.completedAt, "validation completion for Linux generation");
  if (attestedAt < validationCompleted || attestedAt - validationCompleted > 5 * 60_000) {
    fail("Linux validation generation was not sealed immediately after validation");
  }

  if (
    manifestArtifact.bytes.length === 0
    || manifestArtifact.bytes.at(-1) !== 0x0a
    || manifestArtifact.bytes.includes(0x0d)
  ) fail("Linux validation artifact manifest is not canonical LF text");
  const manifestText = manifestArtifact.bytes.toString("utf8");
  if (!Buffer.from(manifestText, "utf8").equals(manifestArtifact.bytes)) fail("Linux validation artifact manifest is not UTF-8");
  const rows = new Map();
  let previousPath;
  let totalBytes = 0;
  for (const line of manifestText.slice(0, -1).split("\n")) {
    const match = /^([a-f0-9]{64})\t([0-9]+)\t(.+)$/u.exec(line);
    if (!match) fail("Linux validation artifact manifest row is malformed");
    const [, digest, byteText, relative] = match;
    const bytes = Number(byteText);
    if (
      !safeManifestPath(relative)
      || rows.has(relative)
      || !Number.isSafeInteger(bytes)
      || bytes < 0
      || bytes > 64 * 1024 * 1024
      || (previousPath && Buffer.compare(Buffer.from(previousPath), Buffer.from(relative)) >= 0)
    ) fail("Linux validation artifact manifest path, order, or size differs");
    previousPath = relative;
    totalBytes += bytes;
    if (totalBytes > 2 * 1024 * 1024 * 1024) fail("Linux validation signed artifact set exceeds its byte ceiling");
    rows.set(relative, { digest, bytes });
  }
  if (
    rows.size !== payload.artifactManifest.memberCount
    || totalBytes !== payload.artifactManifest.totalBytes
    || [...REQUIRED_SIGNED_EVIDENCE_FILES].some((required) => !rows.has(required))
    || [...rows].some(([relative]) => (
      !REQUIRED_SIGNED_EVIDENCE_FILES.has(relative)
      && !relative.startsWith("playwright-report/")
    ))
    || !rows.has("playwright-report/index.html")
  ) fail("Linux validation signed artifact membership differs");
  const logNames = (await readdir(path.join(evidenceDir, "validation-logs")))
    .sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
  const expectedLogNames = REQUIRED_GATES.map((name) => `${name}.log`)
    .sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
  if (JSON.stringify(logNames) !== JSON.stringify(expectedLogNames)) {
    fail("Linux validation signed log directory contains missing or extra evidence");
  }
  for (const [relative, expected] of rows) {
    const filename = path.join(evidenceDir, ...relative.split("/"));
    if (!path.resolve(filename).startsWith(`${evidenceDir}${path.sep}`)) fail("Linux validation signed artifact escapes evidence root");
    const observed = await artifact(filename, 64 * 1024 * 1024);
    if (observed.sha256 !== expected.digest || observed.bytes.length !== expected.bytes) {
      fail(`Linux validation signed artifact differs: ${relative}`);
    }
  }
  return { attestationArtifact, manifestArtifact, payload, rows };
}

function assertEmbeddedTrustedGenerationAttestation(attestation, exported) {
  const generationId = attestation?.generationId;
  const producerSha256 = exported?.trustedGenerationAttestation?.producerSha256;
  const generationRoot = `${TRUSTED_GENERATIONS_ROOT}/${generationId}`;
  const boundary = attestation?.boundary;
  if (
    attestation?.schema !== TRUSTED_ATTESTATION_SCHEMA
    || attestation?.schemaVersion !== 1
    || attestation?.evidenceType !== "trusted-macos-codex-security-generation"
    || !/^ds-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{16}$/u.test(generationId ?? "")
    || !/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(attestation?.createdAt ?? "")
    || attestation?.producer?.installedPath !== TRUSTED_CREATOR_PATH
    || attestation?.producer?.sha256 !== producerSha256
    || !/^[a-f0-9]{64}$/u.test(producerSha256 ?? "")
    || attestation?.producer?.mode !== "0444"
    || !/^\d+$/u.test(attestation?.producer?.device ?? "")
    || !/^\d+$/u.test(attestation?.producer?.inode ?? "")
    || attestation?.sourceManifest?.sha256 !== exported?.scanSourceManifestSha256
    || attestation?.sourceManifest?.bytes !== exported?.sourceBinding?.sourceManifestBytes
    || attestation?.sourceManifest?.memberCount !== exported?.sourceBinding?.sourceMemberCount
    || attestation?.generation?.root !== generationRoot
    || attestation?.generation?.source !== `${generationRoot}/source`
    || attestation?.generation?.ownerUid !== 0
    || attestation?.generation?.ownerGid !== 0
    || attestation?.generation?.rootMode !== "0555"
    || !/^\d+$/u.test(attestation?.generation?.sourceIdentity?.device ?? "")
    || !/^\d+$/u.test(attestation?.generation?.sourceIdentity?.inode ?? "")
    || !/^0[0-7]{3}$/u.test(attestation?.generation?.sourceIdentity?.mode ?? "")
    || !Number.isInteger(attestation?.scanner?.uid)
    || !Number.isInteger(attestation?.scanner?.gid)
    || attestation.scanner.uid <= 0
    || attestation.scanner.gid <= 0
    || typeof attestation?.scanner?.name !== "string"
    || !attestation.scanner.name.trim()
    || /[\0\r\n\t]/u.test(attestation.scanner.name)
    || attestation?.scanner?.accessPolicy !== "exact-posix-modes; other-read/search; no-group-or-world-write"
    || attestation?.snapshot?.algorithm !== exported?.sourceBinding?.algorithm
    || attestation?.snapshot?.snapshotDigest !== exported?.sourceBinding?.snapshotDigest
    || attestation?.snapshot?.sourceModeManifestSha256 !== exported?.sourceBinding?.sourceModeManifestSha256
    || attestation?.snapshot?.sourceMemberCount !== exported?.sourceBinding?.sourceMemberCount
    || attestation?.snapshot?.directoryCount !== exported?.sourceBinding?.directoryCount
    || !Number.isInteger(attestation?.snapshot?.treeBytes)
    || attestation.snapshot.treeBytes < 0
    || boundary?.candidateCodeExecuted !== false
    || boundary?.descriptorRelativeTraversal !== true
    || boundary?.symlinkAncestorsFollowed !== false
    || boundary?.atomicPublish !== true
    || boundary?.atomicNoClobber !== true
    || boundary?.extendedAclEntries !== false
    || boundary?.exactManifestMembership !== true
    || boundary?.modePolicy !== "preserve exact source mode and fail unless scanner-readable and scanner-nonwritable"
    || boundary?.attestationSignature !== "none; externally pin this attestation hash and producer hash"
    || attestation?.runtime?.pythonExecutable !== "/usr/bin/python3"
    || !/^3\.\d+(?:\.\d+)?$/u.test(attestation?.runtime?.python ?? "")
    || attestation?.runtime?.isolatedMode !== true
    || attestation?.runtime?.siteImportDisabled !== true
  ) fail("trusted Deep Scan generation attestation is malformed or unbound");
}

function oneLine(value, fallback) {
  if (typeof value !== "string" || !value.trim()) return fallback;
  return value.replace(/[\r\n\t]+/gu, " ").trim();
}

const nonempty = (value) => typeof value === "string" && value.length > 0;
const canonicalId = (value) => typeof value === "string" && /^[a-z0-9][a-z0-9._/-]*$/u.test(value);

function canonicalFinding(finding) {
  return /^csf_[a-f0-9]{24}$/u.test(finding?.findingId ?? "")
    && /^occ_[a-f0-9]{24}$/u.test(finding?.occurrenceId ?? "")
    && canonicalId(finding?.ruleId)
    && canonicalId(finding?.identity?.anchor)
    && (finding?.identity?.instance === undefined || canonicalId(finding.identity.instance))
    && finding?.fingerprints?.algorithm === "codex-security/v1"
    && /^codex-security\/v1:sha256:[a-f0-9]{64}$/u.test(finding?.fingerprints?.primary ?? "")
    && nonempty(finding?.title)
    && nonempty(finding?.summary)
    && ["critical", "high", "medium", "low", "informational"].includes(finding?.severity?.level)
    && (finding?.severity?.score === undefined || (typeof finding.severity.score === "number" && Number.isFinite(finding.severity.score) && finding.severity.score >= 0 && finding.severity.score <= 10))
    && ["high", "medium", "low"].includes(finding?.confidence?.level)
    && nonempty(finding?.confidence?.rationale)
    && nonempty(finding?.taxonomy?.category)
    && Array.isArray(finding?.taxonomy?.cwe)
    && finding.taxonomy.cwe.every(nonempty)
    && Array.isArray(finding?.locations)
    && finding.locations.length > 0
    && finding.locations.every((location) => nonempty(location?.path) && Number.isInteger(location?.startLine) && location.startLine >= 1 && (location?.endLine === undefined || (Number.isInteger(location.endLine) && location.endLine >= 1)))
    && nonempty(finding?.remediation)
    && nonempty(finding?.provenance?.source);
}

function deriveFormalDeepScanReport({ scan, manifestSha256, findingsSha256, coverageSha256, findings, coverage }) {
  const lines = [
    "# Codex Security Deep Scan Evidence Report",
    "",
    "This report is deterministically derived from the sealed scan manifest and its hash-bound findings and coverage documents. The generated report.md projection is not used as an authority.",
    "",
    `- Scan ID: ${scan.id}`,
    `- Plugin: ${scan.producer.name} ${scan.producer.version}`,
    `- Status: ${scan.status}`,
    `- Started: ${scan.startedAt}`,
    `- Completed: ${scan.completedAt}`,
    `- Sealed: ${scan.sealedAt}`,
    `- Snapshot: ${scan.target.snapshotDigest}`,
    `- Manifest SHA-256: ${manifestSha256}`,
    `- Findings SHA-256: ${findingsSha256}`,
    `- Coverage SHA-256: ${coverageSha256}`,
    `- Validated findings: ${findings.findings.length}`,
    `- Coverage completeness: ${oneLine(coverage.completeness, "unknown")}`,
    "",
    "## Validated Findings",
    ""
  ];
  if (findings.findings.length === 0) {
    lines.push("No reportable findings are present in the sealed finding ledger.");
  } else {
    for (const finding of findings.findings) {
      lines.push(
        `### ${oneLine(finding?.title, "Untitled finding")}`,
        "",
        `- Finding ID: ${oneLine(finding?.findingId, "missing")}`,
        `- Severity: ${oneLine(finding?.severity?.level, "unknown")}`,
        `- Summary: ${oneLine(finding?.summary, "No summary supplied")}`,
        `- Remediation: ${oneLine(finding?.remediation, "No remediation supplied")}`,
        ""
      );
    }
  }
  lines.push(
    "",
    "## Coverage Ledger",
    "",
    `- Reviewed surfaces: ${Array.isArray(coverage.surfaces) ? coverage.surfaces.length : 0}`,
    `- Deferred items: ${Array.isArray(coverage.deferred) ? coverage.deferred.length : 0}`,
    `- Explicit exclusions: ${Array.isArray(coverage.explicitExclusions) ? coverage.explicitExclusions.length : 0}`,
    `- Open questions: ${Array.isArray(coverage.openQuestions) ? coverage.openQuestions.length : 0}`,
    ""
  );
  return Buffer.from(`${lines.join("\n").replace(/\n{3,}/gu, "\n\n").trimEnd()}\n`, "utf8");
}

async function htmlTreeHash(root) {
  const entries = [];
  let totalBytes = 0;
  let visitedMembers = 0;
  async function walk(directory, relative, depth = 0) {
    if (depth > HTML_REPORT_DEPTH_LIMIT) fail("Playwright HTML report nesting is too deep");
    const before = await lstat(directory, { bigint: true });
    if (!before.isDirectory() || before.isSymbolicLink()) fail(`unsafe HTML evidence directory: ${relative || "."}`);
    const directoryEntries = await readdir(directory, { withFileTypes: true });
    visitedMembers += directoryEntries.length;
    if (visitedMembers > HTML_REPORT_MEMBER_LIMIT) fail("Playwright HTML report has too many members");
    const names = directoryEntries.map((entry) => entry.name)
      .sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
    for (const entry of directoryEntries
      .sort((left, right) => Buffer.from(left.name).compare(Buffer.from(right.name)))) {
      const next = relative ? `${relative}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      if (
        entry.name !== entry.name.normalize("NFC")
        || /[\\\0\r\n\t/]/u.test(entry.name)
        || entry.name === "."
        || entry.name === ".."
      ) fail(`unsafe HTML evidence member name: ${next}`);
      if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) fail(`unsafe HTML evidence member: ${next}`);
      if (entry.isDirectory()) await walk(absolute, next, depth + 1);
      else {
        const member = await artifact(absolute, HTML_REPORT_FILE_LIMIT_BYTES);
        totalBytes += member.bytes.length;
        if (totalBytes > HTML_REPORT_TOTAL_LIMIT_BYTES) fail("Playwright HTML report exceeds its total byte limit");
        entries.push(`${member.sha256}\t${next}`);
      }
    }
    const namesAfter = (await readdir(directory))
      .sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
    const after = await lstat(directory, { bigint: true });
    if (JSON.stringify(namesAfter) !== JSON.stringify(names)) fail(`HTML evidence membership changed: ${relative || "."}`);
    for (const key of ["dev", "ino", "mode", "nlink", "size", "mtimeNs", "ctimeNs"]) {
      if (before[key] !== after[key]) fail(`HTML evidence directory changed: ${relative || "."}`);
    }
  }
  await walk(root, "");
  if (!entries.some((entry) => entry.endsWith("\tindex.html"))) fail("Playwright HTML report lacks index.html");
  return { sha256: sha256(Buffer.from(`${entries.join("\n")}\n`)), files: entries.length, totalBytes };
}

function visitSuite(suite, projects) {
  for (const spec of suite?.specs ?? []) for (const test of spec?.tests ?? []) {
    if (!Object.hasOwn(projects, test?.projectName)) continue;
    for (const result of test?.results ?? []) {
      if (result?.status === "passed") projects[test.projectName].passed += 1;
      else if (result?.status === "skipped") projects[test.projectName].skipped += 1;
      else projects[test.projectName].failed += 1;
    }
  }
  for (const child of suite?.suites ?? []) visitSuite(child, projects);
}

function validateCommand(gate, controlHashes, dependencyState, runId) {
  const argv = gate?.command?.argv;
  if (!Array.isArray(argv) || argv.length < 1 || argv.some((value) => typeof value !== "string" || /[\r\n\0]/u.test(value))) fail(`invalid command evidence for ${gate?.name}`);
  if (["required-tests", "dependency-provenance"].includes(gate?.name)) {
    const requiredTests = gate.name === "required-tests";
    if (
      gate?.command?.executable !== REQUIRED_COORDINATOR_PATH
      || JSON.stringify(argv) !== JSON.stringify([requiredTests ? "verify-required-test-reports" : "verify-fresh-dependency-generation"])
      || (requiredTests && gate?.command?.requiredTestManifestSha256 !== controlHashes.requiredTests)
      || !exactKeys(gate.command, requiredTests ? ["executable", "argv", "requiredTestManifestSha256"] : ["executable", "argv"])
      || gate?.execution?.launcher !== "trusted-coordinator"
      || gate?.execution?.uid !== "root"
      || gate?.execution?.candidateCodeExecuted !== false
      || !exactKeys(gate.execution, ["launcher", "uid", "candidateCodeExecuted"])
    ) fail(`${gate.name} trusted-coordinator boundary differs`);
    return;
  }
  if (argv.length < 2) fail(`invalid command evidence for ${gate?.name}`);
  if (gate?.command?.executable !== REQUIRED_NODE_PATH) fail(`unfixed Node command for ${gate?.name}`);
  const assertSandbox = ({ uid = "resume-ai-build", networked = false, credentialTransport = "none", repositoryVerifier = null } = {}) => {
    if (
      gate?.execution?.uid !== uid
      || gate?.execution?.launcher !== "/usr/bin/systemd-run"
      || !/^resume-ai-evidence-[a-z0-9-]+-[a-f0-9-]{12}\.service$/u.test(gate?.execution?.unit ?? "")
      || !gate.execution.unit.endsWith(`-${runId.slice(-12)}.service`)
      || gate?.execution?.environment !== "env-i"
      || gate?.execution?.sourceReadOnly !== true
      || gate?.execution?.privateNetwork !== !networked
      || gate?.execution?.ipAddressDeny !== (networked ? "any" : null)
      || gate?.execution?.credentialTransport !== credentialTransport
      || gate?.execution?.repositoryVerifier !== repositoryVerifier
      || !exactKeys(gate.execution, [
        "launcher", "unit", "uid", "environment", "sourceReadOnly", "privateNetwork",
        "ipAddressDeny", "credentialTransport", "repositoryVerifier"
      ])
    ) fail(`sandbox execution boundary differs for ${gate?.name}`);
  };
  if (gate?.name === "deepseek-preflight") {
    if (
      argv.length !== 4
      || argv[0] !== REQUIRED_DEEPSEEK_VERIFIER_PATH
      || argv[1] !== "<systemd-credential>"
      || !/^[A-Za-z0-9._-]{1,128}$/u.test(argv[2])
      || !/^[A-Za-z0-9._-]{1,128}$/u.test(argv[3])
      || gate?.command?.verifierSha256 !== controlHashes.deepseek
      || !exactKeys(gate.command, ["executable", "argv", "verifierSha256"])
    ) fail("DeepSeek fixed-verifier execution boundary differs");
    assertSandbox({ uid: "resume-ai-verify", networked: true, credentialTransport: "systemd-LoadCredential", repositoryVerifier: false });
    return;
  }

  const commonDependencyFlags = [
    "--frozen-lockfile", "--ignore-scripts", "--ignore-pnpmfile",
    "--store-dir=<ephemeral-store>", "--virtual-store-dir=<ephemeral-node_modules/.pnpm>",
    "--config.manage-package-manager-versions=false", "--config.verify-store-integrity=true",
    "--reporter=append-only"
  ];
  if (gate.name === "dependency-fetch" || gate.name === "dependency-offline-install") {
    const expected = gate.name === "dependency-fetch"
      ? [REQUIRED_PNPM_ENTRYPOINT, "fetch", ...commonDependencyFlags]
      : [REQUIRED_PNPM_ENTRYPOINT, "install", "--offline", "--package-import-method=copy", ...commonDependencyFlags];
    if (!exactKeys(gate.command, ["executable", "argv"]) || JSON.stringify(argv) !== JSON.stringify(expected)) {
      fail(`${gate.name} fixed pnpm command differs`);
    }
    assertSandbox({ networked: gate.name === "dependency-fetch" });
    return;
  }
  if (gate.name === "playwright-browser-fetch") {
    const playwright = dependencyState?.observedById?.get("playwright");
    if (
      !playwright
      || !exactKeys(gate.command, ["executable", "argv", "executableSha256"])
      || JSON.stringify(argv) !== JSON.stringify([
        "<frozen-node_modules>/playwright/cli.js", "install", "chromium"
      ])
      || gate.command.executableSha256 !== playwright.binSha256
    ) fail("fresh Playwright browser command differs from observed trusted toolchain");
    assertSandbox({ networked: true });
    return;
  }
  if (gate.name === "production-dependency-audit") {
    if (
      !exactKeys(gate.command, ["executable", "argv"])
      || JSON.stringify(argv) !== JSON.stringify([
        REQUIRED_PNPM_ENTRYPOINT, "audit", "--prod", "--audit-level=low", "--json"
      ])
    ) fail("production dependency audit command drift");
    assertSandbox({ networked: true });
    return;
  }

  const projectToolByGate = {
    typecheck: "typescript",
    lint: "eslint",
    unit: "vitest",
    "production-build": "next",
    "postgres-integration": "vitest",
    "production-e2e": "playwright-test"
  };
  const toolId = projectToolByGate[gate.name];
  const tool = dependencyState?.observedById?.get(toolId);
  if (
    !tool
    || !exactKeys(gate.command, ["executable", "argv", "projectTool", "executableSha256"])
    || gate.command.projectTool !== toolId
    || gate.command.executableSha256 !== tool.binSha256
    || argv[0] !== `<frozen-node_modules>/${tool.binRelativePath}`
  ) fail(`project-tool identity differs for ${gate.name}`);
  assertSandbox();
  const rest = argv.slice(1);
  const exact = (...expected) => JSON.stringify(rest) === JSON.stringify(expected);
  switch (gate.name) {
    case "typecheck": if (!exact("--noEmit", "--incremental", "false")) fail("typecheck command drift"); break;
    case "lint": if (!exact(".", "--max-warnings=0")) fail("lint command drift"); break;
    case "production-build": if (!exact("build")) fail("production build command drift"); break;
    case "unit":
      if (!exact("run", "--reporter=json", `--outputFile=/opt/resume-ai/build-staging/release-evidence-${runId}/writable/vitest-unit-result.json`)) fail("unit command drift");
      break;
    case "postgres-integration":
      if (!exact("run", "tests/security/competition-shared-state-postgres.integration.test.ts", "--reporter=json", `--outputFile=/opt/resume-ai/build-staging/release-evidence-${runId}/writable/vitest-postgres-result.json`)) fail("PostgreSQL integration command drift");
      break;
    case "production-e2e":
      if (!exact("test", "--reporter=json,html")) fail("production E2E command drift");
      break;
    default: fail(`unknown validation gate: ${gate.name}`);
  }
}

function assertDeepSeekLog(bytes) {
  const completed = new Set();
  for (const line of bytes.toString("utf8").split(/\r?\n/u)) {
    const candidate = line.replace(/^\[(?:stdout|stderr)\] /u, "").trim();
    if (!candidate.startsWith("{")) continue;
    try {
      const value = JSON.parse(candidate);
      if (value?.event === "deepseek_preflight" && value?.status === "ok" && value?.verifier === "release-evidence-deepseek.v1") completed.add(value.operation);
      if (value?.event === "deepseek_preflight" && ["failed", "skipped"].includes(value?.status)) fail("DeepSeek evidence is failed or skipped");
    } catch (error) {
      if (error instanceof Error && error.message === "DeepSeek evidence is failed or skipped") throw error;
    }
  }
  for (const operation of ["models", "competition_normalize", "competition_followup_policy", "competition_recommend"]) if (!completed.has(operation)) fail(`DeepSeek evidence lacks ${operation}`);
}

function requiredReportPath(value, pins, label) {
  if (typeof value !== "string" || value.length === 0 || value !== value.normalize("NFC") || /[\\\0\r\n\t]/u.test(value)) {
    fail(`${label} report contains an invalid test filename`);
  }
  if (pins.has(value)) return value;
  const match = /^\/opt\/resume-ai\/build-staging\/release-evidence-[0-9a-f-]{36}\/source\/(.+)$/u.exec(value);
  if (!match || !safeManifestPath(match[1]) || !pins.has(match[1])) fail(`${label} report names an unpinned test file`);
  return match[1];
}

function requiredVitestObservations(report, contract, project, label) {
  if (
    report?.success !== true
    || report?.numFailedTests !== 0
    || !Number.isInteger(report?.numPassedTests)
    || report.numPassedTests <= 0
    || !Array.isArray(report?.testResults)
  ) fail(`${label} required-test report is not a passing Vitest report`);
  const observations = [];
  for (const testResult of report.testResults) {
    const testFile = requiredReportPath(testResult?.name, contract.pins, label);
    if (!Array.isArray(testResult?.assertionResults)) fail(`${label} test result lacks assertions`);
    for (const assertion of testResult.assertionResults) {
      const fullName = requiredTestText(assertion?.fullName, `${label} fullName`, 512);
      if (!["passed", "failed", "skipped", "pending", "todo"].includes(assertion?.status)) {
        fail(`${label} assertion has an unknown status`);
      }
      observations.push({
        framework: "vitest",
        report: label,
        testFile,
        fullName,
        project,
        passed: assertion.status === "passed"
      });
    }
  }
  return observations;
}

function requiredPlaywrightObservations(report, contract) {
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
      const testFile = requiredReportPath(spec?.file ?? suiteFile, contract.pins, "playwright-production");
      const fullName = requiredTestText(spec?.title, "playwright-production fullName", 512);
      if (!Array.isArray(spec?.tests) || spec.tests.length === 0) fail("Playwright required-test spec lacks project results");
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
          report: "playwright-production",
          testFile,
          fullName,
          project,
          passed: statuses.every((status) => status === "passed")
        });
      }
    }
    for (const child of suite?.suites ?? []) visit(child, suiteFile);
  }
  for (const suite of report.suites) visit(suite, undefined);
  return observations;
}

function deriveRequiredTestVerification(contract, reports) {
  const observations = [
    ...requiredVitestObservations(reports.unit, contract, "unit", "vitest-unit"),
    ...requiredVitestObservations(reports.postgres, contract, "postgres-integration", "vitest-postgres"),
    ...requiredPlaywrightObservations(reports.playwright, contract)
  ];
  let passedObservations = 0;
  const verified = contract.requirements.map((requirement) => {
    const matches = observations.filter((observation) => (
      observation.framework === requirement.framework
      && observation.report === requirement.report
      && observation.testFile === requirement.testFile
      && observation.fullName === requirement.fullName
      && observation.project === requirement.project
    ));
    const passed = matches.filter((match) => match.passed).length;
    if (matches.some((match) => !match.passed) || passed < requirement.minimumPassed) {
      fail(`required test was missing, skipped, renamed, or failed: ${requirement.id}`);
    }
    passedObservations += passed;
    return {
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
    };
  });
  if (passedObservations < contract.minimumPassedObservations) fail("required-test passing observation floor was not met");
  return { passedObservations, verified };
}

function assertRequiredTestLog(bytes, expected) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.at(-1) !== 0x0a || bytes.includes(0x0d)) {
    fail("required-test gate log is not canonical LF JSONL");
  }
  const lines = bytes.toString("utf8").slice(0, -1).split("\n");
  if (lines.length !== 1) fail("required-test gate log must contain exactly one receipt event");
  let value;
  try { value = JSON.parse(lines[0]); } catch { fail("required-test gate log is not JSON"); }
  if (
    !exactKeys(value, ["event", "status", "requiredTestManifestSha256", "requiredTestReceiptSha256", "minimumPassedObservations", "passedObservations"])
    || value.event !== "release_required_tests"
    || value.status !== "passed"
    || value.requiredTestManifestSha256 !== expected.manifestSha256
    || value.requiredTestReceiptSha256 !== expected.receiptSha256
    || value.minimumPassedObservations !== expected.minimumPassedObservations
    || value.passedObservations !== expected.passedObservations
  ) fail("required-test gate log differs from its bound receipt");
}

function validateObservedProjectTools(observedTools, policy) {
  if (!Array.isArray(observedTools) || observedTools.length !== policy.tools.length) {
    fail("dependency provenance lacks the fixed observed project-tool set");
  }
  const observedById = new Map();
  const normalized = observedTools.map((observed, index) => {
    const expected = policy.tools[index];
    if (
      !exactKeys(observed, [
        "id", "packageName", "packagePath", "packageRealPath", "version",
        "packageJsonSha256", "binName", "binTarget", "binRelativePath", "binSha256"
      ])
      || observed.id !== expected.id
      || observed.packageName !== expected.packageName
      || observed.packagePath !== expected.packagePath
      || observed.version !== expected.version
      || observed.binName !== expected.binName
      || observed.binTarget !== expected.binTarget
      || !safeManifestPath(observed.packageRealPath)
      || !observed.packageRealPath.startsWith(".pnpm/")
      || !safeManifestPath(observed.binRelativePath)
      || !observed.binRelativePath.startsWith(`${observed.packageRealPath}/`)
      || !/^[a-f0-9]{64}$/u.test(observed.packageJsonSha256 ?? "")
      || !/^[a-f0-9]{64}$/u.test(observed.binSha256 ?? "")
      || observedById.has(observed.id)
    ) fail(`dependency provenance observed project tool differs: ${expected.id}`);
    const normalizedTool = { ...observed };
    observedById.set(observed.id, normalizedTool);
    return normalizedTool;
  });
  return { observed: normalized, observedById };
}

function validateFrozenTreeLedger(value, { label, maxMembers, maxBytes, expectedRelativePath }) {
  const expectedKeys = expectedRelativePath
    ? ["relativePath", "manifestSha256", "members", "totalBytes", "symlinks", "owner", "ambientInputUsed"]
    : ["manifestSha256", "members", "totalBytes", "symlinks", "owner", "ambientInputUsed"];
  if (
    !exactKeys(value, expectedKeys)
    || (expectedRelativePath && value.relativePath !== expectedRelativePath)
    || !/^[a-f0-9]{64}$/u.test(value?.manifestSha256 ?? "")
    || !Number.isSafeInteger(value?.members)
    || value.members <= 0
    || value.members > maxMembers
    || !Number.isSafeInteger(value?.totalBytes)
    || value.totalBytes <= 0
    || value.totalBytes > maxBytes
    || !Number.isSafeInteger(value?.symlinks)
    || value.symlinks < 0
    || value.symlinks > value.members
    || value.owner !== "root"
    || value.ambientInputUsed !== false
  ) fail(`${label} frozen-tree provenance differs or exceeds policy`);
}

function assertDependencyProvenanceLog(bytes, expected) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.at(-1) !== 0x0a || bytes.includes(0x0d)) {
    fail("dependency provenance log is not canonical LF JSONL");
  }
  const lines = bytes.toString("utf8").slice(0, -1).split("\n");
  if (lines.length !== 1) fail("dependency provenance log must contain exactly one event");
  let value;
  try { value = JSON.parse(lines[0]); } catch { fail("dependency provenance log is not JSON"); }
  if (
    !exactKeys(value, ["event", "status", "receiptSha256", "nodeModulesManifestSha256", "browserManifestSha256", "ambientInputUsed"])
    || value.event !== "release_dependency_provenance"
    || value.status !== "passed"
    || value.receiptSha256 !== expected.receiptSha256
    || value.nodeModulesManifestSha256 !== expected.nodeModulesManifestSha256
    || value.browserManifestSha256 !== expected.browserManifestSha256
    || value.ambientInputUsed !== false
  ) fail("dependency provenance log differs from its frozen-tree receipt");
}

async function validateDependencyProvenanceEvidence({
  evidenceDir,
  validation,
  gates,
  policy,
  policyArtifact,
  sourceManifestSha256,
  sourceModeManifestSha256,
  sourceModeMemberCount
}) {
  const receiptArtifact = await artifact(
    path.join(evidenceDir, "dependency-provenance-receipt.json"),
    DEPENDENCY_PROVENANCE_RECEIPT_LIMIT_BYTES
  );
  let receipt;
  try { receipt = JSON.parse(receiptArtifact.bytes.toString("utf8")); } catch { fail("dependency provenance receipt is not JSON"); }
  if (
    !exactKeys(receipt, [
      "schemaVersion", "evidenceType", "status", "runId", "createdAt", "sourceManifestSha256",
      "sourceModeManifestSha256", "sourceModeMemberCount", "inputs", "toolchain", "networkPolicy",
      "projectToolchainPolicy", "observedTools", "dependencyFetch", "offlineInstall", "nodeModules",
      "browserFetch", "browsers"
    ])
    || receipt.schemaVersion !== 1
    || receipt.evidenceType !== "release-dependency-provenance"
    || receipt.status !== "passed"
    || receipt.runId !== validation.runId
    || receipt.sourceManifestSha256 !== sourceManifestSha256
    || receipt.sourceModeManifestSha256 !== sourceModeManifestSha256
    || receipt.sourceModeMemberCount !== sourceModeMemberCount
    || canonicalJson(receipt.inputs) !== canonicalJson(policy.inputs)
    || !exactKeys(receipt.toolchain, ["node", "pnpm"])
    || !exactKeys(receipt.toolchain.node, ["path", "version", "sha256"])
    || receipt.toolchain.node.path !== REQUIRED_NODE_PATH
    || receipt.toolchain.node.version !== "v24.20.0"
    || !/^[a-f0-9]{64}$/u.test(receipt.toolchain.node.sha256 ?? "")
    || receipt.toolchain.node.sha256 !== validation.toolchain.node.sha256
    || !exactKeys(receipt.toolchain.pnpm, ["path", "version", "sha256"])
    || receipt.toolchain.pnpm.path !== REQUIRED_PNPM_ENTRYPOINT
    || receipt.toolchain.pnpm.version !== "11.19.0"
    || !/^[a-f0-9]{64}$/u.test(receipt.toolchain.pnpm.sha256 ?? "")
    || receipt.toolchain.pnpm.sha256 !== validation.toolchain.pnpm.sha256
    || !exactKeys(receipt.networkPolicy, ["dependencyRegistry", "browserDownloadHosts"])
    || receipt.networkPolicy.dependencyRegistry !== "https://registry.npmjs.org/"
    || JSON.stringify(receipt.networkPolicy.browserDownloadHosts) !== JSON.stringify([
      "cdn.playwright.dev", "playwright.download.prss.microsoft.com"
    ])
    || !exactKeys(receipt.projectToolchainPolicy, ["installedPath", "sourceMember", "artifactSha256", "jsonPointer", "policyId", "sha256"])
    || receipt.projectToolchainPolicy.installedPath !== REQUIRED_TESTS_PATH
    || receipt.projectToolchainPolicy.sourceMember !== REQUIRED_TESTS_MEMBER
    || receipt.projectToolchainPolicy.artifactSha256 !== policyArtifact.sha256
    || receipt.projectToolchainPolicy.jsonPointer !== "/projectToolchain"
    || receipt.projectToolchainPolicy.policyId !== policy.policyId
    || receipt.projectToolchainPolicy.sha256 !== policy.sha256
  ) fail("dependency provenance receipt is not source-, runtime-, network-, and policy-bound");
  const observedState = validateObservedProjectTools(receipt.observedTools, policy);
  validateFrozenTreeLedger(receipt.nodeModules, {
    label: "node_modules",
    maxMembers: 250_000,
    maxBytes: 6 * 1024 * 1024 * 1024
  });
  validateFrozenTreeLedger(receipt.browsers, {
    label: "Playwright browsers",
    maxMembers: 50_000,
    maxBytes: 3 * 1024 * 1024 * 1024,
    expectedRelativePath: "node_modules/.release-evidence-playwright-browsers"
  });

  const fetchGate = gates.get("dependency-fetch");
  const installGate = gates.get("dependency-offline-install");
  const browserGate = gates.get("playwright-browser-fetch");
  const provenanceGate = gates.get("dependency-provenance");
  if (
    !exactKeys(receipt.dependencyFetch, ["command", "rawLog", "rawLogSha256"])
    || canonicalJson(receipt.dependencyFetch.command) !== canonicalJson(fetchGate?.command)
    || receipt.dependencyFetch.rawLog !== "validation-logs/dependency-fetch.log"
    || receipt.dependencyFetch.rawLog !== fetchGate?.rawLog
    || receipt.dependencyFetch.rawLogSha256 !== fetchGate?.rawLogSha256
    || !exactKeys(receipt.offlineInstall, ["command", "privateNetwork", "packageImportMethod", "rawLog", "rawLogSha256"])
    || canonicalJson(receipt.offlineInstall.command) !== canonicalJson(installGate?.command)
    || receipt.offlineInstall.privateNetwork !== true
    || receipt.offlineInstall.packageImportMethod !== "copy"
    || receipt.offlineInstall.rawLog !== "validation-logs/dependency-offline-install.log"
    || receipt.offlineInstall.rawLog !== installGate?.rawLog
    || receipt.offlineInstall.rawLogSha256 !== installGate?.rawLogSha256
    || !exactKeys(receipt.browserFetch, ["command", "playwrightCliSha256", "rawLog", "rawLogSha256"])
    || canonicalJson(receipt.browserFetch.command) !== canonicalJson(browserGate?.command)
    || receipt.browserFetch.playwrightCliSha256 !== observedState.observedById.get("playwright")?.binSha256
    || receipt.browserFetch.rawLog !== "validation-logs/playwright-browser-fetch.log"
    || receipt.browserFetch.rawLog !== browserGate?.rawLog
    || receipt.browserFetch.rawLogSha256 !== browserGate?.rawLogSha256
  ) fail("dependency provenance receipt does not bind the three preparation gates");
  const createdAt = instant(receipt.createdAt, "dependency provenance creation");
  const browserCompleted = instant(browserGate?.completedAt, "browser preparation completion");
  const provenanceCompleted = instant(provenanceGate?.completedAt, "dependency provenance completion");
  if (createdAt < browserCompleted || createdAt > provenanceCompleted) fail("dependency provenance receipt timestamp is outside its preparation boundary");

  if (
    provenanceGate?.receipt !== "dependency-provenance-receipt.json"
    || provenanceGate?.receiptSha256 !== receiptArtifact.sha256
    || provenanceGate?.rawLog !== "validation-logs/dependency-provenance.log"
  ) fail("dependency provenance gate does not bind its receipt and log");
  const logArtifact = await artifact(path.join(evidenceDir, provenanceGate.rawLog));
  assertDependencyProvenanceLog(logArtifact.bytes, {
    receiptSha256: receiptArtifact.sha256,
    nodeModulesManifestSha256: receipt.nodeModules.manifestSha256,
    browserManifestSha256: receipt.browsers.manifestSha256
  });
  const validationLedger = validation.dependencyProvenance;
  if (
    !exactKeys(validationLedger, [
      "receipt", "receiptSha256", "projectToolchainPolicySha256", "observedTools",
      "nodeModulesManifestSha256", "browserManifestSha256", "ambientInputUsed"
    ])
    || validationLedger.receipt !== "dependency-provenance-receipt.json"
    || validationLedger.receiptSha256 !== receiptArtifact.sha256
    || validationLedger.projectToolchainPolicySha256 !== policy.sha256
    || JSON.stringify(validationLedger.observedTools) !== JSON.stringify(observedState.observed)
    || validationLedger.nodeModulesManifestSha256 !== receipt.nodeModules.manifestSha256
    || validationLedger.browserManifestSha256 !== receipt.browsers.manifestSha256
    || validationLedger.ambientInputUsed !== false
  ) fail("validation dependency-provenance ledger differs from its receipt");
  return { receiptArtifact, receipt, ...observedState };
}

async function validateRequiredTestEvidence({
  evidenceDir,
  validation,
  gate,
  contract,
  manifestArtifact,
  sourceManifestSha256,
  sourceModeManifestSha256,
  reports
}) {
  const receiptArtifact = await artifact(path.join(evidenceDir, "required-test-receipt.json"), REQUIRED_TEST_RECEIPT_LIMIT_BYTES);
  let receipt;
  try { receipt = JSON.parse(receiptArtifact.bytes.toString("utf8")); } catch { fail("required-test receipt is not JSON"); }
  const derived = deriveRequiredTestVerification(contract, reports);
  const reportSha256 = {
    "vitest-unit": reports.unit.sha256,
    "vitest-postgres": reports.postgres.sha256,
    "playwright-production": reports.playwright.sha256
  };
  if (
    !exactKeys(receipt, [
      "schemaVersion", "evidenceType", "status", "runId", "sourceManifestSha256",
      "sourceModeManifestSha256", "requiredTestManifest", "minimumPassedObservations",
      "passedObservations", "reportSha256", "verified"
    ])
    || receipt.schemaVersion !== 1
    || receipt.evidenceType !== "release-required-test-receipt"
    || receipt.status !== "passed"
    || receipt.runId !== validation.runId
    || receipt.sourceManifestSha256 !== sourceManifestSha256
    || receipt.sourceModeManifestSha256 !== sourceModeManifestSha256
    || !exactKeys(receipt.requiredTestManifest, ["installedPath", "sourceMember", "artifact", "sha256"])
    || receipt.requiredTestManifest.installedPath !== REQUIRED_TESTS_PATH
    || receipt.requiredTestManifest.sourceMember !== REQUIRED_TESTS_MEMBER
    || receipt.requiredTestManifest.artifact !== "release-required-tests.json"
    || receipt.requiredTestManifest.sha256 !== manifestArtifact.sha256
    || receipt.minimumPassedObservations !== contract.minimumPassedObservations
    || receipt.passedObservations !== derived.passedObservations
    || !exactKeys(receipt.reportSha256, Object.keys(reportSha256))
    || Object.entries(reportSha256).some(([name, digest]) => receipt.reportSha256[name] !== digest)
    || JSON.stringify(receipt.verified) !== JSON.stringify(derived.verified)
  ) fail("required-test receipt is not independently reproduced from the machine reports");

  const expectedValidationLedger = {
    manifestInstalledPath: REQUIRED_TESTS_PATH,
    manifestSourceMember: REQUIRED_TESTS_MEMBER,
    manifestArtifact: "release-required-tests.json",
    manifestSha256: manifestArtifact.sha256,
    receipt: "required-test-receipt.json",
    receiptSha256: receiptArtifact.sha256,
    minimumPassedObservations: contract.minimumPassedObservations,
    passedObservations: derived.passedObservations,
    reportSha256
  };
  if (JSON.stringify(validation.requiredTests) !== JSON.stringify(expectedValidationLedger)) {
    fail("validation required-test ledger differs from independently reproduced evidence");
  }
  if (
    gate?.requiredTestReceipt !== "required-test-receipt.json"
    || gate?.requiredTestReceiptSha256 !== receiptArtifact.sha256
    || gate?.rawLog !== "validation-logs/required-tests.log"
    || gate?.minimumPassedObservations !== contract.minimumPassedObservations
    || gate?.passedObservations !== derived.passedObservations
  ) fail("required-test gate does not bind its receipt and observation counts");
  const logArtifact = await artifact(path.join(evidenceDir, gate.rawLog));
  assertRequiredTestLog(logArtifact.bytes, {
    manifestSha256: manifestArtifact.sha256,
    receiptSha256: receiptArtifact.sha256,
    minimumPassedObservations: contract.minimumPassedObservations,
    passedObservations: derived.passedObservations
  });
  return { receiptArtifact, derived };
}

async function validateDeepScan(
  evidenceDir,
  sourceManifestSha256,
  sourceModeManifestSha256,
  sourceModeMemberCount,
  expectedTrustedGeneration = null
) {
  const [report, resultArtifact, exportArtifact] = await Promise.all([
    artifact(path.join(evidenceDir, "security-scan-report.txt")),
    artifact(path.join(evidenceDir, "security-scan-result.json")),
    artifact(path.join(evidenceDir, "deep-scan-export.json"))
  ]);
  const result = JSON.parse(resultArtifact.bytes.toString("utf8"));
  const exported = JSON.parse(exportArtifact.bytes.toString("utf8"));
  if (
    result?.schemaVersion !== 1
    || result?.evidenceType !== "codex-security-deep-scan-finalization"
    || result?.scanType !== "codex-security-deep-scan"
    || result?.status !== "passed"
    || result?.finalizer !== "scripts/finalize-deep-scan-evidence.mjs"
  ) fail("Deep Scan result was not exporter-finalized");
  if (
    result?.sourceManifestSha256 !== sourceManifestSha256
    || result?.finalSourceManifestSha256 !== sourceManifestSha256
    || result?.finalSourceModeManifestSha256 !== sourceModeManifestSha256
    || result?.finalSourceModeMemberCount !== sourceModeMemberCount
    || !Number.isInteger(result?.scanSourceModeMemberCount)
    || result.scanSourceModeMemberCount <= 0
    || result?.reportSha256 !== report.sha256
    || result?.exportSha256 !== exportArtifact.sha256
    || result?.validatedOpenFindings !== 0
    || result?.untriagedFindings !== 0
  ) fail("Deep Scan final evidence hashes or derived counts do not match");
  if (
    exported?.schemaVersion !== 3
    || exported?.evidenceType !== "codex-security-deep-scan-export"
    || exported?.scanType !== "codex-security-deep-scan"
    || exported?.status !== "completed"
    || exported?.exporter !== "scripts/export-deep-scan-evidence.mjs"
    || exported?.reportDerivation !== "sealed-manifest-findings-coverage.v1"
    || !/^[a-f0-9]{64}$/u.test(exported?.generatedReportProjectionSha256 ?? "")
    || exported?.scanId !== result.scanId
    || exported?.scanSourceManifestSha256 !== result.scanSourceManifestSha256
    || exported?.reportSha256 !== report.sha256
    || exported?.sourceBinding?.algorithm !== "codex-security-directory/v1"
    || exported?.sourceBinding?.pluginVersion !== "0.1.22"
    || exported?.sourceBinding?.targetKind !== "directory_snapshot"
    || !/^codex-security-snapshot\/v1:sha256:[a-f0-9]{64}$/u.test(exported?.sourceBinding?.snapshotDigest ?? "")
    || !Number.isInteger(exported?.sourceBinding?.sourceMemberCount)
    || exported.sourceBinding.sourceMemberCount <= 0
    || !Number.isInteger(exported?.sourceBinding?.sourceManifestBytes)
    || exported.sourceBinding.sourceManifestBytes <= 0
    || !/^[a-f0-9]{64}$/u.test(exported?.sourceBinding?.sourceModeManifestSha256 ?? "")
    || exported?.sourceBinding?.sourceModeManifestSha256 !== result?.scanSourceModeManifestSha256
    || exported?.sourceBinding?.sourceMemberCount !== result.scanSourceModeMemberCount
    || report.bytes.length === 0
  ) fail("Deep Scan raw export identity differs");
  const completion = canonicalBase64(exported?.completionArtifact?.base64, "Deep Scan completion");
  if (
    exported?.completionArtifact?.kind !== "sealed-scan-manifest"
    || sha256(completion) !== exported?.completionArtifact?.sha256
    || result?.rawCompletionSha256 !== exported?.completionArtifact?.sha256
    || result?.scanSnapshotDigest !== exported?.sourceBinding?.snapshotDigest
  ) fail("Deep Scan raw completion hash differs");
  const attestationBytes = canonicalBase64(exported?.trustedGenerationAttestation?.base64, "trusted Deep Scan generation attestation");
  if (
    sha256(attestationBytes) !== exported?.trustedGenerationAttestation?.sha256
    || result?.scanGenerationAttestationSha256 !== exported?.trustedGenerationAttestation?.sha256
    || result?.scanGenerationProducerSha256 !== exported?.trustedGenerationAttestation?.producerSha256
  ) fail("trusted Deep Scan generation attestation hash differs");
  if (
    (expectedTrustedGeneration?.attestationSha256 && expectedTrustedGeneration.attestationSha256 !== exported.trustedGenerationAttestation.sha256)
    || (expectedTrustedGeneration?.producerSha256 && expectedTrustedGeneration.producerSha256 !== exported.trustedGenerationAttestation.producerSha256)
    || (expectedTrustedGeneration?.completionSha256 && expectedTrustedGeneration.completionSha256 !== exported.completionArtifact.sha256)
  ) fail("trusted Deep Scan generation differs from the reviewed source or independent root approval");
  const attestation = JSON.parse(attestationBytes.toString("utf8"));
  assertEmbeddedTrustedGenerationAttestation(attestation, exported);
  if (exported?.trustedGenerationAttestation?.generationId !== attestation.generationId) fail("trusted Deep Scan generation identity differs");
  const manifest = JSON.parse(completion.toString("utf8"));
  if (
    manifest?.documentType !== "codex-security.scan-manifest"
    || manifest?.schemaVersion !== "1.0"
    || manifest?.scan?.id !== result.scanId
    || manifest?.scan?.status !== "completed"
    || manifest?.scan?.producer?.name !== "codex-security-plugin"
    || manifest?.scan?.producer?.version !== exported.sourceBinding.pluginVersion
    || manifest?.scan?.target?.kind !== "directory_snapshot"
    || manifest?.scan?.target?.targetId !== exported.sourceBinding.targetId
    || manifest?.scan?.target?.snapshotDigest !== exported.sourceBinding.snapshotDigest
    || JSON.stringify(manifest?.scan?.scope?.includePaths) !== JSON.stringify(["."])
    || manifest?.scan?.scope?.excludePaths?.length !== 0
    || exported.startedAt !== manifest?.scan?.startedAt
    || exported.completedAt !== manifest?.scan?.completedAt
    || exported.sealedAt !== manifest?.scan?.sealedAt
    || result.startedAt !== manifest?.scan?.startedAt
    || result.scanCompletedAt !== manifest?.scan?.completedAt
  ) fail("Deep Scan raw completion is not sealed canonical output");
  ordered(manifest.scan.startedAt, manifest.scan.completedAt, "Deep Scan", 120 * 60 * 60_000);
  const preparedAt = instant(attestation.createdAt, "trusted Deep Scan generation creation");
  if (preparedAt > instant(manifest.scan.startedAt, "Deep Scan start") || instant(manifest.scan.startedAt, "Deep Scan start") - preparedAt > 24 * 60 * 60_000) fail("Deep Scan snapshot was not freshly prepared");
  if (instant(manifest.scan.sealedAt, "Deep Scan seal") < instant(manifest.scan.completedAt, "Deep Scan completion")) fail("Deep Scan seal predates completion");
  const findingsBytes = canonicalBase64(exported?.canonicalArtifacts?.findings?.base64, "Deep Scan findings");
  const coverageBytes = canonicalBase64(exported?.canonicalArtifacts?.coverage?.base64, "Deep Scan coverage");
  if (sha256(findingsBytes) !== exported?.canonicalArtifacts?.findings?.sha256 || sha256(coverageBytes) !== exported?.canonicalArtifacts?.coverage?.sha256) fail("Deep Scan canonical artifact hashes differ");
  const findings = JSON.parse(findingsBytes.toString("utf8"));
  const coverage = JSON.parse(coverageBytes.toString("utf8"));
  const ids = findings?.findings?.map((finding) => finding?.findingId) ?? [];
  const sealedArtifacts = new Map((manifest?.scan?.artifacts ?? []).map((entry) => [entry?.path, entry?.sha256]));
  if (
    findings?.documentType !== "codex-security.findings"
    || findings?.schemaVersion !== "1.0"
    || findings?.scanId !== result.scanId
    || !Array.isArray(findings?.findings)
    || findings.findings.some((finding) => !canonicalFinding(finding))
    || new Set(ids).size !== ids.length
    || JSON.stringify(ids) !== JSON.stringify(exported.findingIds)
    || JSON.stringify(ids) !== JSON.stringify(result.validatedFindingIds)
    || ids.length !== exported.validatedFindingCount
    || ids.length !== result.validatedFindingCount
  ) fail("Deep Scan finding ledger differs");
  if (
    coverage?.documentType !== "codex-security.coverage"
    || coverage?.schemaVersion !== "1.0"
    || coverage?.scanId !== result.scanId
    || coverage?.mode !== "deep_repository"
    || coverage?.completeness !== "complete"
    || coverage?.inventoryStrategy !== "repository"
    || JSON.stringify(coverage?.includePaths) !== JSON.stringify(["."])
    || !Array.isArray(coverage?.excludePaths)
    || coverage.excludePaths.length !== 0
    || !Array.isArray(coverage?.deferred)
    || coverage.deferred.length !== 0
    || !Array.isArray(coverage?.explicitExclusions)
    || coverage.explicitExclusions.length !== 0
    || !Array.isArray(coverage?.surfaces)
    || coverage.surfaces.length === 0
    || new Set(coverage.surfaces.map((surface) => surface?.id)).size !== coverage.surfaces.length
    || coverage.surfaces.some((surface) => (
      typeof surface?.id !== "string"
      || !surface.id.trim()
      || typeof surface?.label !== "string"
      || !surface.label.trim()
      || !["reported", "no_issue_found", "rejected", "not_applicable"].includes(surface?.disposition)
      || !Array.isArray(surface?.receiptRefs)
      || surface.receiptRefs.some((receipt) => typeof receipt !== "string" || !/^artifacts\/(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\\).+$/u.test(receipt) || !sealedArtifacts.has(receipt))
    ))
    || (coverage?.openQuestions !== undefined && (!Array.isArray(coverage.openQuestions) || coverage.openQuestions.length !== 0))
    || exported.untriagedFindingCount !== 0
  ) fail("Deep Scan coverage retained untriaged work");
  const derivedReport = deriveFormalDeepScanReport({
    scan: manifest.scan,
    manifestSha256: exported.completionArtifact.sha256,
    findingsSha256: exported.canonicalArtifacts.findings.sha256,
    coverageSha256: exported.canonicalArtifacts.coverage.sha256,
    findings,
    coverage
  });
  if (!report.bytes.equals(derivedReport)) fail("Deep Scan report is not the deterministic sealed-ledger projection");
  if (
    sealedArtifacts.size !== (manifest?.scan?.artifacts ?? []).length
    || sealedArtifacts.get("findings.json") !== exported.canonicalArtifacts.findings.sha256
    || sealedArtifacts.get("coverage.json") !== exported.canonicalArtifacts.coverage.sha256
  ) fail("Deep Scan sealed artifact ledger differs");
  const finalCompleted = instant(result.completedAt, "Deep Scan evidence completion");
  if (finalCompleted < instant(manifest.scan.completedAt, "Deep Scan completion")) fail("Deep Scan finalization predates completion");
  if (ids.length === 0) {
    if (
      result.scanSourceManifestSha256 !== sourceManifestSha256
      || result.scanSourceModeManifestSha256 !== sourceModeManifestSha256
      || result.scanSourceModeMemberCount !== sourceModeMemberCount
      || result.closedFindingCount !== 0
      || !Array.isArray(result.closures)
      || result.closures.length !== 0
    ) fail("zero-finding scan is not bound to final source");
  } else {
    if (
      result.scanSourceManifestSha256 === sourceManifestSha256
      || result.closedFindingCount !== ids.length
      || !Array.isArray(result.closures)
      || result.closures.length !== ids.length
      || new Set(result.closures.map((closure) => closure?.findingId)).size !== ids.length
      || ids.some((id) => !result.closures.some((closure) => closure?.findingId === id))
    ) fail("Deep Scan closure ledger is incomplete");
    const closureDir = path.join(evidenceDir, "deep-scan-closures");
    const closureNames = await readdir(closureDir);
    if (closureNames.length !== ids.length || closureNames.some((name) => !name.endsWith(".json"))) fail("Deep Scan closure directory is not an exact ledger");
    const closureArtifacts = [];
    for (const name of closureNames) closureArtifacts.push(await artifact(path.join(closureDir, name)));
    if (new Set(closureArtifacts.map((candidate) => candidate.sha256)).size !== ids.length) fail("Deep Scan closure bytes are duplicated");
    for (const closureRef of result.closures) {
      const match = closureArtifacts.find((candidate) => candidate.sha256 === closureRef.closureSha256);
      if (!match) fail(`Deep Scan closure bytes are missing: ${closureRef.findingId}`);
      const closure = JSON.parse(match.bytes.toString("utf8"));
      if (
        closure?.schemaVersion !== 1
        || closure?.evidenceType !== "codex-security-finding-closure"
        || closure?.producer !== "scripts/export-deep-scan-finding-closure.mjs"
        || closure?.pluginVersion !== exported.sourceBinding.pluginVersion
        || closure?.findingId !== closureRef.findingId
        || closure?.scanId !== result.scanId
        || closure?.finalSourceManifestSha256 !== sourceManifestSha256
        || closure?.status !== "verified-fixed"
        || closure?.verifiedAt !== closureRef.verifiedAt
      ) fail("Deep Scan closure semantics differ");
      const verifiedAt = instant(closure.verifiedAt, "Deep Scan closure verification");
      if (verifiedAt < instant(manifest.scan.completedAt, "Deep Scan completion") || verifiedAt > finalCompleted) fail("Deep Scan closure time order differs");
      const raw = canonicalBase64(closure?.rawVerification?.base64, "Deep Scan closure receipt");
      if (sha256(raw) !== closure?.rawVerification?.sha256) fail("Deep Scan closure raw verification hash differs");
      const receipt = JSON.parse(raw.toString("utf8"));
      if (
        receipt?.documentType !== "codex-security.verify-fix-result"
        || receipt?.schemaVersion !== "1.0"
        || receipt?.producer?.name !== "codex-security-plugin"
        || receipt?.producer?.version !== exported.sourceBinding.pluginVersion
        || receipt?.scanId !== result.scanId
        || receipt?.findingId !== closure.findingId
        || receipt?.status !== "verified-fixed"
        || receipt?.sourceManifestSha256 !== sourceManifestSha256
        || receipt?.verifiedAt !== closure.verifiedAt
      ) fail("Deep Scan closure receipt identity differs");
      for (const [label, entries] of [["fix", receipt?.fixEvidence], ["verification", receipt?.verificationEvidence]]) {
        if (!Array.isArray(entries) || entries.length === 0) fail(`Deep Scan closure lacks ${label} evidence`);
        for (const entry of entries) {
          const bytes = canonicalBase64(entry?.base64, `Deep Scan closure ${label}`);
          if (sha256(bytes) !== entry?.sha256 || (label === "verification" && entry?.exitCode !== 0)) fail(`Deep Scan closure ${label} evidence differs`);
        }
      }
    }
  }
  ordered(result.startedAt, result.completedAt, "Deep Scan evidence", 30 * 24 * 60 * 60_000);
  if (Date.now() - finalCompleted > MAX_EVIDENCE_AGE_MS) fail("Deep Scan evidence is older than 24 hours");
  return { report, resultArtifact, finalCompleted };
}

function validateBundleSource(bundle) {
  const verifier = String.raw`
import base64, hashlib, json, pathlib, re, stat, sys, tarfile
root = pathlib.Path(sys.argv[1]).resolve(strict=True)
manifest_bytes = (root / "source-manifest.txt").read_bytes()
archive_bytes = (root / "source.tar.gz").read_bytes()
release = json.loads((root / "release-manifest.json").read_text(encoding="utf-8"))
if release.get("sourceManifestSha256") != hashlib.sha256(manifest_bytes).hexdigest():
    raise SystemExit("source manifest hash differs")
if release.get("sourceSha256") != hashlib.sha256(archive_bytes).hexdigest():
    raise SystemExit("source archive hash differs")
if release.get("sourceMembership") != "git-ls-files-cached-and-nonignored-untracked" or release.get("emptyDirectoriesIncluded") is not False:
    raise SystemExit("source membership semantics differ")
entries = {}
for line in manifest_bytes.decode("utf-8").splitlines():
    fields = line.split("\t")
    if len(fields) != 3 or not re.fullmatch(r"[a-f0-9]{64}", fields[0]) or fields[1] not in {"F", "L"}:
        raise SystemExit("invalid source manifest row")
    digest, kind, name = fields
    path = pathlib.PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts or name != path.as_posix() or name in entries:
        raise SystemExit("unsafe or duplicate source manifest path")
    entries[name] = (digest, kind)
mode_receipt = release.get("sourceModeManifest", {})
try:
    mode_bytes = base64.b64decode(mode_receipt.get("data", ""), validate=True)
except Exception as error:
    raise SystemExit("invalid source mode receipt encoding") from error
if mode_receipt.get("encoding") != "base64" or mode_receipt.get("sha256") != hashlib.sha256(mode_bytes).hexdigest():
    raise SystemExit("source mode receipt hash differs")
modes = {}
for line in mode_bytes.decode("utf-8").splitlines():
    fields = line.split("\t")
    if len(fields) != 2 or not re.fullmatch(r"0[0-7]{3}", fields[0]) or fields[1] in modes:
        raise SystemExit("invalid source mode row")
    modes[fields[1]] = fields[0]
if set(modes) != set(entries) or mode_receipt.get("memberCount") != len(entries):
    raise SystemExit("source mode membership differs")
def verify_tar(filename, expected_names, allow_empty=False):
    seen = set()
    with tarfile.open(filename, "r:gz") as archive:
        members = archive.getmembers()
        if (not members and not allow_empty) or len(members) > 250000:
            raise SystemExit("source archive member count differs")
        for member in members:
            name = pathlib.PurePosixPath(member.name).as_posix()
            path = pathlib.PurePosixPath(name)
            if not name or member.name != name or path.is_absolute() or ".." in path.parts or name in seen or name not in expected_names:
                raise SystemExit("unsafe, duplicate or unexpected source archive member")
            if not (member.isfile() or member.issym()):
                raise SystemExit("directory or special source archive member")
            seen.add(name)
            expected_hash, expected_kind = entries[name]
            kind = "F" if member.isfile() else "L"
            if kind != expected_kind or f"{member.mode:04o}" != modes[name]:
                raise SystemExit("source archive kind or mode differs")
            if member.isfile():
                stream = archive.extractfile(member)
                if stream is None:
                    raise SystemExit("unreadable source archive member")
                digest = hashlib.sha256()
                total = 0
                for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                    total += len(chunk)
                    if total > 4 * 1024**3:
                        raise SystemExit("source archive member exceeds size ceiling")
                    digest.update(chunk)
                observed = digest.hexdigest()
            else:
                target = pathlib.PurePosixPath(member.linkname)
                if target.is_absolute() or ".." in target.parts:
                    raise SystemExit("unsafe source archive symlink")
                observed = hashlib.sha256(member.linkname.encode("utf-8")).hexdigest()
            if observed != expected_hash:
                raise SystemExit("source archive content differs")
    if seen != set(expected_names):
        raise SystemExit("source archive membership differs")
verify_tar(root / "source.tar.gz", set(entries))
untracked_lines = (root / "untracked-source-paths.txt").read_text(encoding="utf-8").splitlines()
if untracked_lines != sorted(set(untracked_lines)) or any(name not in entries for name in untracked_lines):
    raise SystemExit("untracked source path ledger differs")
verify_tar(root / "untracked-source.tar.gz", set(untracked_lines), allow_empty=True)
baseline_path = root / "baseline/competition-score-prospective-baseline.json"
baseline_bytes = baseline_path.read_bytes()
baseline = json.loads(baseline_bytes)
boundary = release.get("prospectiveBaseline", {})
if boundary.get("outerIntegrityBoundary") != "release-manifest.json" or boundary.get("byteSha256") != hashlib.sha256(baseline_bytes).hexdigest():
    raise SystemExit("prospective baseline outer boundary differs")
if boundary.get("mode") not in {"bootstrap", "carry-forward"}:
    raise SystemExit("prospective baseline promotion mode differs")
origin_release = boundary.get("originReleaseId")
origin_source = boundary.get("originSourceArchiveSha256")
if not isinstance(origin_release, str) or not re.fullmatch(r"20\d{6}T\d{6}Z", origin_release) or not isinstance(origin_source, str) or not re.fullmatch(r"[a-f0-9]{64}", origin_source):
    raise SystemExit("prospective baseline origin is invalid")
if baseline.get("provenance", {}).get("releaseId") != origin_release or baseline.get("provenance", {}).get("sourceArchiveSha256") != origin_source:
    raise SystemExit("prospective baseline provenance differs")
if boundary.get("mode") == "bootstrap" and (origin_release != release.get("releaseId") or origin_source != release.get("sourceSha256")):
    raise SystemExit("bootstrap baseline does not bind this release")
if boundary.get("mode") == "carry-forward" and (release.get("rollbackRelease") == "none" or origin_release == release.get("releaseId")):
    raise SystemExit("carry-forward baseline lacks a prior approved origin")
`;
  const check = spawnSync("/usr/bin/python3", ["-I", "-c", verifier, bundle], { encoding: "utf8" });
  if (check.status !== 0) fail(`bundle source semantics failed: ${check.stderr.trim()}`);
}

async function main() {
  const args = argumentsOf(process.argv.slice(2));
  if (args["--bundle"] && !args["--evidence-dir"]) {
    temporaryEvidenceDir = await mkdtemp(path.join(tmpdir(), "resume-ai-evidence-verify."));
    const archive = path.join(await realpath(args["--bundle"]), "e2e-evidence.tar.gz");
    const extractor = String.raw`
import os, pathlib, shutil, stat, sys, tarfile
archive_path = pathlib.Path(sys.argv[1])
destination = pathlib.Path(sys.argv[2]).resolve(strict=True)
seen = set()
total = 0
with tarfile.open(archive_path, "r:gz") as archive:
    members = archive.getmembers()
    if not members or len(members) > 250000:
        raise SystemExit("invalid evidence archive member count")
    for member in members:
        raw = member.name
        value = pathlib.PurePosixPath(raw).as_posix().removeprefix("./") or "."
        path = pathlib.PurePosixPath(value)
        if path.is_absolute() or ".." in path.parts or "\n" in raw or "\r" in raw or value in seen:
            raise SystemExit("unsafe or duplicate evidence member")
        if not (member.isfile() or member.isdir()):
            raise SystemExit("linked or special evidence member")
        seen.add(value)
        if member.isfile():
            total += member.size
            if total > 4 * 1024**3:
                raise SystemExit("evidence archive exceeds size ceiling")
    for member in members:
        value = pathlib.PurePosixPath(member.name).as_posix().removeprefix("./") or "."
        target = destination if value == "." else destination.joinpath(*pathlib.PurePosixPath(value).parts)
        if member.isdir():
            target.mkdir(mode=0o700, parents=True, exist_ok=True)
            continue
        target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        stream = archive.extractfile(member)
        if stream is None:
            raise SystemExit("unreadable evidence member")
        descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
        with stream, os.fdopen(descriptor, "wb") as output:
            shutil.copyfileobj(stream, output, 1024 * 1024)
        metadata = target.lstat()
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_size != member.size:
            raise SystemExit("evidence member changed while extracting")
`;
    const extraction = spawnSync("/usr/bin/python3", ["-I", "-c", extractor, archive, temporaryEvidenceDir], { encoding: "utf8" });
    if (extraction.status !== 0) fail(`cannot safely extract bundle evidence: ${extraction.stderr.trim()}`);
    args["--evidence-dir"] = temporaryEvidenceDir;
  }
  const evidenceDir = await realpath(args["--evidence-dir"]);
  if (await lstat(path.join(evidenceDir, "EVIDENCE_FAILED")).then(() => true, () => false)) fail("evidence run contains a failure marker");
  const bundlePath = args["--bundle"] ? await realpath(args["--bundle"]) : null;
  const sourceManifestPath = args["--source-manifest"] ?? path.join(bundlePath, "source-manifest.txt");
  let sourceModeManifestSha256;
  let sourceModeMemberCount;
  let releaseCreatedAt = null;
  let releaseManifest = null;
  if (bundlePath) {
    validateBundleSource(bundlePath);
    releaseManifest = JSON.parse((await artifact(path.join(bundlePath, "release-manifest.json"))).bytes.toString("utf8"));
    sourceModeManifestSha256 = releaseManifest?.sourceModeManifest?.sha256;
    sourceModeMemberCount = releaseManifest?.sourceModeManifest?.memberCount;
    releaseCreatedAt = instant(releaseManifest?.createdAt, "release bundle creation");
  } else {
    sourceModeManifestSha256 = args["--source-mode-manifest-sha256"];
    sourceModeMemberCount = Number(args["--source-mode-member-count"]);
  }
  if (!/^[a-f0-9]{64}$/u.test(sourceModeManifestSha256 ?? "") || !Number.isSafeInteger(sourceModeMemberCount) || sourceModeMemberCount <= 0) fail("source mode binding is invalid");
  const sourceManifest = await artifact(sourceManifestPath);
  const sourceManifestSha256 = sourceManifest.sha256;
  const sourceRows = releaseSourceRows(sourceManifest.bytes);
  const requiredControlRows = {
    coordinator: sourceRows.get("scripts/run-release-evidence.mjs"),
    deepseek: sourceRows.get("scripts/lib/release-evidence-deepseek-verifier.mjs"),
    httpProbe: sourceRows.get("scripts/lib/release-evidence-http-probe.mjs"),
    trustedGenerationCreator: sourceRows.get("scripts/lib/macos_trusted_deep_scan_generation.py"),
    requiredTests: sourceRows.get(REQUIRED_TESTS_MEMBER)
  };
  if (Object.values(requiredControlRows).some((row) => row?.kind !== "F")) fail("source manifest lacks fixed release-evidence controls");
  const controlHashes = {
    coordinator: requiredControlRows.coordinator.digest,
    deepseek: requiredControlRows.deepseek.digest,
    httpProbe: requiredControlRows.httpProbe.digest,
    trustedGenerationCreator: requiredControlRows.trustedGenerationCreator.digest,
    requiredTests: requiredControlRows.requiredTests.digest
  };
  const requiredTestManifestArtifact = await artifact(
    path.join(evidenceDir, "release-required-tests.json"),
    REQUIRED_TEST_MANIFEST_LIMIT_BYTES
  );
  if (requiredTestManifestArtifact.sha256 !== controlHashes.requiredTests) {
    fail("required-test policy evidence differs from the reviewed source row");
  }
  const requiredTestContract = parseRequiredTestManifest(requiredTestManifestArtifact.bytes, sourceRows);
  const validationArtifact = await artifact(path.join(evidenceDir, "validation-result.json"));
  const e2eArtifact = await artifact(path.join(evidenceDir, "e2e-result.json"));
  const validation = JSON.parse(validationArtifact.bytes.toString("utf8"));
  const e2e = JSON.parse(e2eArtifact.bytes.toString("utf8"));
  if (
    !exactKeys(validation, [
      "schemaVersion", "evidenceType", "status", "runId", "sourceManifestSha256",
      "sourceModeManifestSha256", "sourceModeMemberCount", "prospectiveBaselineCandidate",
      "requiredTests", "dependencyProvenance", "startedAt", "completedAt", "requiredGates",
      "coordinator", "toolchain", "gates"
    ])
    || validation.schemaVersion !== 1
    || validation.evidenceType !== "release-validation"
    || validation.status !== "passed"
    || validation.sourceManifestSha256 !== sourceManifestSha256
    || validation.sourceModeManifestSha256 !== sourceModeManifestSha256
    || validation.sourceModeMemberCount !== sourceModeMemberCount
  ) fail("validation result is not source/mode-bound and passing");
  const baselineRow = sourceRows.get("tests/fixtures/competition-score-prospective-baseline.json");
  if (
    !exactKeys(validation.prospectiveBaselineCandidate, ["path", "byteSha256", "artifactSha256"])
    || validation.prospectiveBaselineCandidate.path !== "tests/fixtures/competition-score-prospective-baseline.json"
    || baselineRow?.kind !== "F"
    || validation.prospectiveBaselineCandidate.byteSha256 !== baselineRow.digest
    || !/^[a-f0-9]{64}$/u.test(validation.prospectiveBaselineCandidate.artifactSha256 ?? "")
  ) fail("prospective baseline candidate is not bound to the reviewed release source");
  if (
    !exactKeys(e2e, [
      "schemaVersion", "evidenceType", "status", "failed", "runId", "sourceManifestSha256",
      "sourceModeManifestSha256", "sourceModeMemberCount", "startedAt", "completedAt",
      "productionBuild", "playwrightReporter", "reporters", "playwrightReportSha256",
      "playwrightHtmlManifestSha256", "playwrightHtmlFiles", "playwrightHtmlBytes", "browsers",
      "projectStats", "redirects", "wwwRedirect"
    ])
    || e2e.schemaVersion !== 1
    || e2e.evidenceType !== "playwright-production-e2e"
    || e2e.status !== "passed"
    || e2e.failed !== 0
    || e2e.sourceManifestSha256 !== sourceManifestSha256
    || e2e.sourceModeManifestSha256 !== sourceModeManifestSha256
    || e2e.sourceModeMemberCount !== sourceModeMemberCount
    || e2e.runId !== validation.runId
    || e2e.productionBuild !== true
  ) fail("E2E result is not part of this production validation run");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(validation?.runId ?? "")) fail("validation run ID is not a UUIDv4");
  if (
    !exactKeys(validation.coordinator, ["path", "sha256", "invocation"])
    || !exactKeys(validation.toolchain, ["node", "pnpm"])
    || !exactKeys(validation.toolchain?.node, ["executable", "version", "sha256"])
    || !exactKeys(validation.toolchain?.pnpm, ["entrypoint", "version", "sha256"])
    ||
    validation?.coordinator?.path !== REQUIRED_COORDINATOR_PATH
    || validation?.coordinator?.sha256 !== controlHashes.coordinator
    || validation?.coordinator?.invocation !== `${REQUIRED_NODE_PATH} ${REQUIRED_COORDINATOR_PATH}`
  ) fail("release evidence coordinator is not bound to the reviewed source row");
  const linuxGeneration = await validateLinuxGenerationAttestation({
    evidenceDir,
    validation,
    sourceManifestSha256,
    sourceModeManifestSha256,
    sourceModeMemberCount,
    coordinatorSha256: controlHashes.coordinator
  });
  if (releaseManifest && (
    !exactKeys(releaseManifest.linuxValidationAttestation, [
      "evidenceMember", "artifactManifestMember", "sha256"
    ])
    || releaseManifest.linuxValidationAttestation.evidenceMember !== LINUX_GENERATION_ATTESTATION
    || releaseManifest.linuxValidationAttestation.artifactManifestMember !== LINUX_GENERATION_MANIFEST
    || releaseManifest.linuxValidationAttestation.sha256 !== linuxGeneration.attestationArtifact.sha256
  )) fail("release manifest does not bind the signed Linux validation generation");
  ordered(validation.startedAt, validation.completedAt, "validation", 12 * 60 * 60_000);
  ordered(e2e.startedAt, e2e.completedAt, "E2E", 4 * 60 * 60_000);
  const validationStart = instant(validation.startedAt, "validation start");
  const validationEnd = instant(validation.completedAt, "validation completion");
  if (Date.now() - validationEnd > MAX_EVIDENCE_AGE_MS) fail("release validation is older than 24 hours");
  if (releaseCreatedAt !== null && (releaseCreatedAt < validationEnd || releaseCreatedAt - validationEnd > MAX_EVIDENCE_AGE_MS || Date.now() - releaseCreatedAt > MAX_EVIDENCE_AGE_MS)) fail("release bundle creation is not fresh or ordered after validation");
  if (
    JSON.stringify(validation.requiredGates) !== JSON.stringify(REQUIRED_GATES)
    || validation.gates?.length !== REQUIRED_GATES.length
    || JSON.stringify(validation.gates.map((gate) => gate?.name)) !== JSON.stringify(REQUIRED_GATES)
  ) fail("validation required-gate ledger differs");
  if (
    validation?.toolchain?.node?.version !== "v24.20.0"
    || validation?.toolchain?.node?.executable !== REQUIRED_NODE_PATH
    || validation?.toolchain?.pnpm?.version !== "11.19.0"
    || validation?.toolchain?.pnpm?.entrypoint !== REQUIRED_PNPM_ENTRYPOINT
    || !/^[a-f0-9]{64}$/u.test(validation?.toolchain?.node?.sha256 ?? "")
    || !/^[a-f0-9]{64}$/u.test(validation?.toolchain?.pnpm?.sha256 ?? "")
  ) fail("validation toolchain is not fixed");
  const gates = new Map(validation.gates.map((gate) => [gate?.name, gate]));
  if (gates.size !== REQUIRED_GATES.length || REQUIRED_GATES.some((name) => !gates.has(name))) fail("validation gate identity is missing or duplicated");
  const dependencyState = await validateDependencyProvenanceEvidence({
    evidenceDir,
    validation,
    gates,
    policy: requiredTestContract.projectToolchain,
    policyArtifact: requiredTestManifestArtifact,
    sourceManifestSha256,
    sourceModeManifestSha256,
    sourceModeMemberCount
  });
  const dependencyFetchStart = instant(gates.get("dependency-fetch")?.startedAt, "dependency fetch start");
  const browserFetchCompletion = instant(gates.get("playwright-browser-fetch")?.completedAt, "browser fetch completion");
  let previousGateCompletion = validationStart;
  const rawLogs = new Set();
  for (const name of REQUIRED_GATES) {
    const gate = gates.get(name);
    const gateExtras = {
      "dependency-provenance": ["receipt", "receiptSha256"],
      unit: ["stats", "machineResultSha256"],
      "production-dependency-audit": ["stats", "machineResultSha256"],
      "postgres-integration": ["stats", "machineResultSha256"],
      "production-e2e": ["e2eResultSha256", "playwrightReportSha256", "playwrightHtmlManifestSha256"],
      "required-tests": [
        "requiredTestReceipt", "requiredTestReceiptSha256",
        "minimumPassedObservations", "passedObservations"
      ]
    }[name] ?? [];
    if (!exactKeys(gate, [
      "name", "command", "execution", "startedAt", "completedAt", "exitCode", "rawLog", "rawLogSha256",
      ...gateExtras
    ])) fail(`validation gate shape differs: ${name}`);
    const expectedRawLog = `validation-logs/${name}.log`;
    if (gate.rawLog !== expectedRawLog || rawLogs.has(gate.rawLog)) {
      fail(`validation gate raw-log identity differs or is reused: ${name}`);
    }
    rawLogs.add(gate.rawLog);
    if (gate.exitCode !== 0 || !/^[a-f0-9]{64}$/u.test(gate.rawLogSha256 ?? "")) fail(`validation gate is not successful: ${name}`);
    ordered(gate.startedAt, gate.completedAt, `validation gate ${name}`, name === "production-e2e" ? 4 * 60 * 60_000 : 2 * 60 * 60_000);
    const gateStart = instant(gate.startedAt, `validation gate ${name} start`);
    const gateEnd = instant(gate.completedAt, `validation gate ${name} completion`);
    if (name === "dependency-provenance") {
      if (gateStart !== dependencyFetchStart || gateEnd < browserFetchCompletion || gateEnd > validationEnd) {
        fail("dependency provenance aggregate time boundary differs");
      }
    } else if (gateStart < previousGateCompletion || gateEnd > validationEnd) {
      fail(`validation gate time order differs: ${name}`);
    }
    previousGateCompletion = gateEnd;
    validateCommand(gate, controlHashes, dependencyState, validation.runId);
    const logPath = path.join(evidenceDir, gate.rawLog);
    if (!path.resolve(logPath).startsWith(`${evidenceDir}${path.sep}`) || (await artifact(logPath)).sha256 !== gate.rawLogSha256) fail(`validation raw log hash differs: ${name}`);
    if (name === "deepseek-preflight") assertDeepSeekLog((await artifact(logPath)).bytes);
  }
  const e2eGate = gates.get("production-e2e");
  if (e2e.startedAt !== e2eGate.startedAt || e2e.completedAt !== e2eGate.completedAt) fail("E2E timestamps differ from their gate");
  const machineReports = {};
  for (const [name, machine, key] of [
    ["unit", "vitest-unit-result.json", "unit"],
    ["postgres-integration", "vitest-postgres-result.json", "postgres"]
  ]) {
    const gate = gates.get(name);
    const machineArtifact = await artifact(path.join(evidenceDir, machine));
    machineReports[key] = machineArtifact;
    const machineResult = JSON.parse(machineArtifact.bytes.toString("utf8"));
    const derivedStats = {
      passed: Number(machineResult?.numPassedTests),
      failed: Number(machineResult?.numFailedTests),
      skipped: Number(machineResult?.numPendingTests ?? 0) + Number(machineResult?.numTodoTests ?? 0)
    };
    if (
      !exactKeys(gate.stats, ["passed", "failed", "skipped"])
      || machineResult?.success !== true
      || !Number.isInteger(derivedStats.passed)
      || !Number.isInteger(derivedStats.failed)
      || !Number.isInteger(derivedStats.skipped)
      || JSON.stringify(gate.stats) !== JSON.stringify(derivedStats)
      || machineArtifact.sha256 !== gate.machineResultSha256
      || derivedStats.passed <= 0
      || derivedStats.failed !== 0
      || derivedStats.skipped < 0
      || (name === "postgres-integration" && derivedStats.skipped !== 0)
    ) fail(`${name} machine result differs`);
  }
  const auditGate = gates.get("production-dependency-audit");
  const auditArtifact = await artifact(path.join(evidenceDir, "pnpm-audit-result.json"));
  const audit = JSON.parse(auditArtifact.bytes.toString("utf8"));
  const vulnerabilities = audit?.metadata?.vulnerabilities ?? {};
  const vulnerabilityCounts = Object.values(vulnerabilities);
  if (
    !exactKeys(auditGate.stats, ["vulnerabilities"])
    ||
    auditArtifact.sha256 !== auditGate.machineResultSha256
    || auditGate?.stats?.vulnerabilities !== 0
    || JSON.stringify(Object.keys(vulnerabilities).sort()) !== JSON.stringify(["critical", "high", "info", "low", "moderate"])
    || vulnerabilityCounts.some((count) => !Number.isInteger(count) || count !== 0)
  ) fail("production dependency audit machine result differs");
  const playwrightArtifact = await artifact(path.join(evidenceDir, "playwright-report.json"));
  machineReports.playwright = playwrightArtifact;
  if (playwrightArtifact.sha256 !== e2e.playwrightReportSha256 || e2e.playwrightReporter !== "json" || JSON.stringify(e2e.reporters) !== JSON.stringify(["json", "html"])) fail("Playwright JSON evidence hash/reporter differs");
  const report = JSON.parse(playwrightArtifact.bytes.toString("utf8"));
  const names = new Set((report?.config?.projects ?? []).map((project) => project?.name));
  if (!names.has("desktop") || !names.has("mobile") || report?.stats?.unexpected !== 0 || !(report?.stats?.expected > 0)) fail("Playwright JSON is not a passing desktop/mobile report");
  const projectStats = { desktop: { passed: 0, failed: 0, skipped: 0 }, mobile: { passed: 0, failed: 0, skipped: 0 } };
  for (const suite of report?.suites ?? []) visitSuite(suite, projectStats);
  if (JSON.stringify(projectStats) !== JSON.stringify(e2e.projectStats) || Object.values(projectStats).some((stats) => stats.passed <= 0 || stats.failed !== 0)) fail("Playwright project statistics differ");
  const html = await htmlTreeHash(path.join(evidenceDir, "playwright-report"));
  if (
    html.sha256 !== e2e.playwrightHtmlManifestSha256
    || html.files !== e2e.playwrightHtmlFiles
    || html.totalBytes !== e2e.playwrightHtmlBytes
  ) fail("Playwright HTML evidence is stale, oversized, or mixed");
  if (
    !exactKeys(e2e.browsers, ["desktop", "mobile"])
    || !exactKeys(e2e.redirects, ["www"])
    || !exactKeys(e2e.wwwRedirect, ["requestUrl", "status", "location", "expectedLocation", "verifier", "verifierSha256"])
    ||
    e2e?.browsers?.desktop !== true
    || e2e?.browsers?.mobile !== true
    || e2e?.redirects?.www !== true
    || e2e?.wwwRedirect?.requestUrl !== "https://www.siyuanjiaxin.com/release-evidence-probe"
    || e2e?.wwwRedirect?.expectedLocation !== "https://siyuanjiaxin.com/release-evidence-probe"
    || e2e?.wwwRedirect?.location !== e2e.wwwRedirect.expectedLocation
    || ![301, 308].includes(e2e?.wwwRedirect?.status)
    || e2e?.wwwRedirect?.verifier !== "release-evidence-http-probe.v1"
    || e2e?.wwwRedirect?.verifierSha256 !== controlHashes.httpProbe
  ) fail("browser or fixed www redirect evidence is incomplete");
  if (gates.get("production-e2e")?.e2eResultSha256 !== e2eArtifact.sha256 || gates.get("production-e2e")?.playwrightReportSha256 !== playwrightArtifact.sha256 || gates.get("production-e2e")?.playwrightHtmlManifestSha256 !== html.sha256) fail("E2E gate is not bound to its reporter artifacts");
  await validateRequiredTestEvidence({
    evidenceDir,
    validation,
    gate: gates.get("required-tests"),
    contract: requiredTestContract,
    manifestArtifact: requiredTestManifestArtifact,
    sourceManifestSha256,
    sourceModeManifestSha256,
    reports: machineReports
  });
  const security = await validateDeepScan(
    evidenceDir,
    sourceManifestSha256,
    sourceModeManifestSha256,
    sourceModeMemberCount,
    {
      attestationSha256: args["--trusted-generation-attestation-sha256"] ?? null,
      producerSha256: controlHashes.trustedGenerationCreator,
      completionSha256: args["--trusted-deep-scan-completion-sha256"] ?? null
    }
  );
  if (
    args["--trusted-generation-producer-sha256"]
    && args["--trusted-generation-producer-sha256"] !== controlHashes.trustedGenerationCreator
  ) fail("independently approved trusted generation producer differs from the reviewed source row");
  if (releaseCreatedAt !== null && (releaseCreatedAt < security.finalCompleted || releaseCreatedAt - security.finalCompleted > MAX_EVIDENCE_AGE_MS)) fail("release bundle creation is not ordered after fresh Deep Scan finalization");
  if (args["--bundle"]) {
    const bundle = await realpath(args["--bundle"]);
    for (const [bundleName, evidenceArtifact] of [
      ["validation.log", validationArtifact], ["e2e-result.json", e2eArtifact],
      ["security-scan-report.txt", security.report], ["security-scan-result.json", security.resultArtifact]
    ]) if ((await artifact(path.join(bundle, bundleName))).sha256 !== evidenceArtifact.sha256) fail(`bundle copy differs from frozen evidence: ${bundleName}`);
  }
  process.stdout.write(`${validation.runId}\n`);
}

export {
  htmlTreeHash,
  validateBundleSource,
  validateCommand,
  validateDeepScan,
  validateDependencyProvenanceEvidence,
  validateLinuxGenerationAttestation
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((error) => {
      process.stderr.write(`ERROR: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    })
    .finally(async () => {
      if (temporaryEvidenceDir) await rm(temporaryEvidenceDir, { recursive: true, force: true });
    });
}
