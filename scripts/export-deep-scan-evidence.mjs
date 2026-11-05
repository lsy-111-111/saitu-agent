#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { lstat, mkdir, open, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { inspectCodexSecurityDirectorySnapshot } from "./lib/codex-security-directory-snapshot.mjs";
import { inspectTrustedMacDeepScanGeneration } from "./lib/trusted-macos-deep-scan-generation.mjs";

const REQUIRED_PLUGIN_VERSION = "0.1.22";
const TRUSTED_GENERATION_LOCK = "/private/var/db/com.siyuanjiaxin.resume-ai/deep-scan-generations/.control.lock";
const LOCK_HOLDER_SOURCE = String.raw`import fcntl, os, stat, sys
path = sys.argv[1]
flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0)
fd = os.open(path, flags)
metadata = os.fstat(fd)
if (not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1
        or metadata.st_uid != 0 or metadata.st_gid != 0
        or stat.S_IMODE(metadata.st_mode) != 0o444):
    raise SystemExit(73)
fcntl.flock(fd, fcntl.LOCK_SH)
os.write(1, b"READY\n")
while os.read(0, 1):
    pass
`;

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const fail = (message) => { throw new Error(message); };

function argumentsOf(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--") || Object.hasOwn(result, key)) fail("invalid exporter arguments");
    result[key] = value;
  }
  const required = [
    "--scan-dir",
    "--scan-target-dir",
    "--trusted-generation-attestation",
    "--trusted-generation-attestation-sha256",
    "--trusted-generation-producer-sha256",
    "--scan-source-manifest",
    "--evidence-dir"
  ];
  if (Object.keys(result).some((key) => !required.includes(key)) || required.some((key) => !result[key])) fail("missing or unknown exporter argument");
  return result;
}

async function canonicalAbsentDirectory(filename) {
  if (
    typeof filename !== "string"
    || !path.isAbsolute(filename)
    || path.normalize(filename) !== filename
    || filename === "/"
    || /[\0\r\n\t]/u.test(filename)
  ) fail("Deep Scan evidence directory must be a normalized absolute path");
  const parent = await realpath(path.dirname(filename));
  const canonical = path.join(parent, path.basename(filename));
  try {
    await lstat(canonical);
  } catch (error) {
    if (error?.code === "ENOENT") return canonical;
    throw error;
  }
  fail(`Deep Scan evidence generation already exists: ${canonical}`);
}

async function writeDurableExclusive(filename, bytes) {
  const handle = await open(filename, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectory(directory) {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } catch (error) {
    if (!new Set(["EINVAL", "ENOTSUP"]).has(error?.code)) throw error;
  } finally {
    await handle.close();
  }
}

export async function publishDeepScanEvidenceGeneration(
  evidenceDir,
  reportBytes,
  exportBytes,
  { afterReport = async () => {} } = {}
) {
  // mkdir is both the publication reservation and the no-clobber lock.  An
  // existing or crashed generation is never overwritten or repaired in place.
  await mkdir(evidenceDir, { mode: 0o700 });
  const metadata = await lstat(evidenceDir, { bigint: true });
  if (
    !metadata.isDirectory()
    || metadata.isSymbolicLink()
    || metadata.uid !== BigInt(process.getuid?.() ?? -1)
    || metadata.gid !== BigInt(process.getgid?.() ?? -1)
    || Number(metadata.mode & 0o7777n) !== 0o700
  ) fail("Deep Scan evidence generation reservation is not private and caller-owned");
  // Make the no-clobber reservation durable before publishing either member.
  // After a power loss, a half-generation remains reserved and cannot silently
  // be reused as if it were a fresh generation.
  await syncDirectory(path.dirname(evidenceDir));
  const reportTarget = path.join(evidenceDir, "security-scan-report.txt");
  const exportTarget = path.join(evidenceDir, "deep-scan-export.json");
  await writeDurableExclusive(reportTarget, reportBytes);
  await afterReport();
  // The export document is the commit marker and is always published last.
  await writeDurableExclusive(exportTarget, exportBytes);
  await syncDirectory(evidenceDir);
  return exportTarget;
}

export async function acquireTrustedGenerationSharedLock() {
  const child = spawn(
    "/usr/bin/python3",
    ["-I", "-S", "-c", LOCK_HOLDER_SOURCE, TRUSTED_GENERATION_LOCK],
    {
      cwd: "/",
      env: { PATH: "/usr/bin:/bin", LANG: "C" },
      stdio: ["pipe", "pipe", "pipe"]
    }
  );
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout = `${stdout}${chunk}`.slice(0, 256);
  });
  child.stderr.on("data", (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-2048);
  });
  const ready = await new Promise((resolve, reject) => {
    let settled = false;
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdout.off("data", inspect);
      child.off("exit", exited);
      callback(value);
    };
    const inspect = () => {
      if (stdout === "READY\n") settle(resolve, true);
      else if (stdout.includes("\n")) settle(reject, new Error("trusted generation lock holder returned an invalid handshake"));
    };
    const exited = (code) => settle(reject, new Error(
      `trusted generation lock holder exited before acquisition (${code ?? "signal"})${stderr ? `: ${stderr.trim()}` : ""}`
    ));
    const timer = setTimeout(
      () => settle(reject, new Error("timed out acquiring the trusted generation lifecycle lock")),
      15_000
    );
    child.stdout.on("data", inspect);
    child.once("exit", exited);
    inspect();
  }).catch((error) => {
    child.kill("SIGTERM");
    throw error;
  });
  if (!ready || child.exitCode !== null) fail("trusted generation lifecycle lock was not acquired");
  let released = false;
  return {
    async release() {
      if (released) return;
      released = true;
      const exit = once(child, "exit");
      child.stdin.end();
      const [code] = child.exitCode === null ? await exit : [child.exitCode];
      if (code !== 0) fail(`trusted generation lock holder failed while releasing (${code ?? "signal"})`);
    }
  };
}

async function ordinary(filename, ceiling = 128 * 1024 * 1024) {
  const before = await lstat(filename, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size > BigInt(ceiling)) fail(`unsafe Deep Scan artifact: ${filename}`);
  const bytes = await readFile(filename);
  const after = await lstat(filename, { bigint: true });
  for (const key of ["dev", "ino", "mode", "nlink", "size", "mtimeNs", "ctimeNs"]) if (before[key] !== after[key]) fail(`Deep Scan artifact changed: ${filename}`);
  return { bytes, sha256: sha256(bytes) };
}

function instant(value, label) {
  if (!/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(value ?? "")) fail(`invalid ${label}`);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString().replace(/\.000Z$/u, "Z") !== value) fail(`invalid ${label}`);
  return milliseconds;
}

function oneLine(value, fallback) {
  if (typeof value !== "string" || !value.trim()) return fallback;
  return value.replace(/[\r\n\t]+/gu, " ").trim();
}

const nonempty = (value) => typeof value === "string" && value.length > 0;
const canonicalId = (value) => typeof value === "string" && /^[a-z0-9][a-z0-9._/-]*$/u.test(value);

function canonicalFinding(finding) {
  const severity = finding?.severity;
  const confidence = finding?.confidence;
  const taxonomy = finding?.taxonomy;
  return /^csf_[a-f0-9]{24}$/u.test(finding?.findingId ?? "")
    && /^occ_[a-f0-9]{24}$/u.test(finding?.occurrenceId ?? "")
    && canonicalId(finding?.ruleId)
    && canonicalId(finding?.identity?.anchor)
    && (finding?.identity?.instance === undefined || canonicalId(finding.identity.instance))
    && finding?.fingerprints?.algorithm === "codex-security/v1"
    && /^codex-security\/v1:sha256:[a-f0-9]{64}$/u.test(finding?.fingerprints?.primary ?? "")
    && nonempty(finding?.title)
    && nonempty(finding?.summary)
    && ["critical", "high", "medium", "low", "informational"].includes(severity?.level)
    && (severity?.score === undefined || (typeof severity.score === "number" && Number.isFinite(severity.score) && severity.score >= 0 && severity.score <= 10))
    && ["high", "medium", "low"].includes(confidence?.level)
    && nonempty(confidence?.rationale)
    && nonempty(taxonomy?.category)
    && Array.isArray(taxonomy?.cwe)
    && taxonomy.cwe.every(nonempty)
    && Array.isArray(finding?.locations)
    && finding.locations.length > 0
    && finding.locations.every((location) => (
      nonempty(location?.path)
      && Number.isInteger(location?.startLine)
      && location.startLine >= 1
      && (location?.endLine === undefined || (Number.isInteger(location.endLine) && location.endLine >= 1))
    ))
    && nonempty(finding?.remediation)
    && nonempty(finding?.provenance?.source);
}

function canonicalArtifactLedger(scan, findingsArtifact, coverageArtifact) {
  if (!Array.isArray(scan?.artifacts) || scan.artifacts.length < 2) fail("sealed Deep Scan artifact ledger is missing");
  const paths = scan.artifacts.map((entry) => entry?.path);
  if (
    new Set(paths).size !== paths.length
    || scan.artifacts.some((entry) => (
      typeof entry?.path !== "string"
      || !/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\\).+$/u.test(entry.path)
      || !/^[a-f0-9]{64}$/u.test(entry?.sha256 ?? "")
      || !nonempty(entry?.mediaType)
    ))
  ) fail("sealed Deep Scan artifact ledger is malformed");
  const artifacts = new Map(scan.artifacts.map((entry) => [entry.path, entry.sha256]));
  if (artifacts.get("findings.json") !== findingsArtifact.sha256 || artifacts.get("coverage.json") !== coverageArtifact.sha256) {
    fail("sealed Deep Scan artifact hashes do not match");
  }
  return artifacts;
}

function deriveFormalReport({ scan, manifestArtifact, findingsArtifact, coverageArtifact, findings, coverage }) {
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
    `- Manifest SHA-256: ${manifestArtifact.sha256}`,
    `- Findings SHA-256: ${findingsArtifact.sha256}`,
    `- Coverage SHA-256: ${coverageArtifact.sha256}`,
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

export async function runDeepScanEvidenceExporter(
  argv,
  {
    inspectGeneration = inspectTrustedMacDeepScanGeneration,
    acquireGenerationLock = acquireTrustedGenerationSharedLock,
    publishEvidence = publishDeepScanEvidenceGeneration
  } = {}
) {
  const args = argumentsOf(argv);
  for (const key of ["--scan-dir", "--scan-target-dir", "--trusted-generation-attestation", "--scan-source-manifest", "--evidence-dir"]) {
    if (!path.isAbsolute(args[key])) fail("exporter paths must be absolute");
  }
  const generationLock = await acquireGenerationLock();
  let primaryError;
  try {
  const scanDir = await realpath(args["--scan-dir"]);
  const scanTargetDir = await realpath(args["--scan-target-dir"]);
  const expectedTargetId = `target_sha256_${sha256(Buffer.from(`local-workspace\0${scanTargetDir}`, "utf8"))}`;
  const evidenceDir = await canonicalAbsentDirectory(args["--evidence-dir"]);
  const source = await ordinary(args["--scan-source-manifest"]);
  const sourceManifestSha256 = source.sha256;
  const snapshot = await inspectCodexSecurityDirectorySnapshot(scanTargetDir, source.bytes);
  if (snapshot.sourceManifestSha256 !== sourceManifestSha256) fail("Deep Scan source binding hash is inconsistent");
  const trustedGeneration = await inspectGeneration({
    attestationPath: args["--trusted-generation-attestation"],
    attestationSha256: args["--trusted-generation-attestation-sha256"],
    producerSha256: args["--trusted-generation-producer-sha256"],
    scanTargetDir,
    sourceManifestBytes: source.bytes,
    snapshot
  });
  if (trustedGeneration.sourceManifestSha256 !== sourceManifestSha256) fail("trusted generation source manifest binding differs");
  const manifestArtifact = await ordinary(path.join(scanDir, "scan-manifest.json"));
  const findingsArtifact = await ordinary(path.join(scanDir, "findings.json"));
  const coverageArtifact = await ordinary(path.join(scanDir, "coverage.json"));
  const reportArtifact = await ordinary(path.join(scanDir, "report.md"));
  const manifest = JSON.parse(manifestArtifact.bytes.toString("utf8"));
  const findings = JSON.parse(findingsArtifact.bytes.toString("utf8"));
  const coverage = JSON.parse(coverageArtifact.bytes.toString("utf8"));
  const scan = manifest?.scan;
  if (manifest?.documentType !== "codex-security.scan-manifest" || manifest?.schemaVersion !== "1.0") fail("not a canonical Codex Security scan manifest");
  if (
    scan?.producer?.name !== "codex-security-plugin"
    || scan?.producer?.version !== REQUIRED_PLUGIN_VERSION
    || scan?.status !== "completed"
    || typeof scan?.id !== "string"
    || !scan.id.trim()
  ) fail("Deep Scan is not sealed and completed");
  if (
    scan?.findingsRef !== "findings.json"
    || scan?.coverageRef !== "coverage.json"
    || scan?.target?.kind !== "directory_snapshot"
    || scan?.target?.targetId !== expectedTargetId
    || typeof scan?.target?.displayName !== "string"
    || !scan.target.displayName.trim()
    || !/^codex-security-snapshot\/v1:sha256:[a-f0-9]{64}$/u.test(scan?.target?.snapshotDigest ?? "")
    || !Array.isArray(scan?.scope?.includePaths)
    || !Array.isArray(scan?.scope?.excludePaths)
    || [...scan.scope.includePaths, ...scan.scope.excludePaths].some((value) => typeof value !== "string")
  ) fail("Deep Scan canonical references are incomplete");
  if (
    scan.target.snapshotDigest !== snapshot.snapshotDigest
    || JSON.stringify(scan.scope.includePaths) !== JSON.stringify(["."])
    || scan.scope.excludePaths.length !== 0
  ) fail("Deep Scan completion is not bound to the reviewed directory snapshot");
  const started = instant(scan.startedAt, "scan start time");
  const completed = instant(scan.completedAt, "scan completion time");
  const sealed = instant(scan.sealedAt, "scan seal time");
  const now = Date.now();
  if (completed < started || sealed < completed || sealed > now + 5 * 60_000 || completed - started > 120 * 60 * 60_000) fail("Deep Scan timestamps are inconsistent");
  const prepared = instant(trustedGeneration.attestation.createdAt, "trusted generation creation time");
  if (prepared > started || started - prepared > 24 * 60 * 60_000) fail("Deep Scan was not started from the fresh prepared snapshot");
  if (
    findings?.documentType !== "codex-security.findings"
    || findings?.schemaVersion !== "1.0"
    || findings?.scanId !== scan.id
    || !Array.isArray(findings?.findings)
    || findings.findings.some((finding) => !canonicalFinding(finding))
  ) fail("Deep Scan findings are malformed");
  const artifacts = canonicalArtifactLedger(scan, findingsArtifact, coverageArtifact);
  if (
    coverage?.documentType !== "codex-security.coverage"
    || coverage?.schemaVersion !== "1.0"
    || coverage?.scanId !== scan.id
    || coverage?.mode !== "deep_repository"
    || coverage?.completeness !== "complete"
    || coverage?.inventoryStrategy !== "repository"
    || !Array.isArray(coverage?.surfaces)
    || coverage.surfaces.length === 0
    || !Array.isArray(coverage?.deferred)
    || coverage.deferred.length !== 0
    || !Array.isArray(coverage?.explicitExclusions)
    || coverage.explicitExclusions.length !== 0
    || !Array.isArray(coverage?.includePaths)
    || JSON.stringify(coverage?.includePaths) !== JSON.stringify(["."])
    || !Array.isArray(coverage?.excludePaths)
    || coverage.excludePaths.length !== 0
    || (coverage?.openQuestions !== undefined && (!Array.isArray(coverage.openQuestions) || coverage.openQuestions.length !== 0))
  ) fail("Deep Scan coverage is malformed or is not a complete Deep Scan");
  const surfaceIds = coverage.surfaces.map((surface) => surface?.id);
  const allowedSurfaceDispositions = new Set(["reported", "no_issue_found", "rejected", "not_applicable"]);
  if (
    new Set(surfaceIds).size !== surfaceIds.length
    || coverage.surfaces.some((surface) => (
      typeof surface?.id !== "string"
      || !surface.id.trim()
      || typeof surface?.label !== "string"
      || !surface.label.trim()
      || !allowedSurfaceDispositions.has(surface?.disposition)
      || !Array.isArray(surface?.receiptRefs)
      || surface.receiptRefs.some((receipt) => (
        typeof receipt !== "string"
        || !/^artifacts\/(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\\).+$/u.test(receipt)
        || !artifacts.has(receipt)
      ))
    ))
  ) fail("Deep Scan coverage surface ledger is incomplete");
  const findingIds = findings.findings.map((finding) => finding?.findingId);
  if (new Set(findingIds).size !== findingIds.length) fail("Deep Scan finding identities are invalid");
  const deferred = coverage.deferred.length;
  const followUp = coverage.surfaces.filter((surface) => surface?.disposition === "needs_follow_up").length;
  const openQuestions = Array.isArray(coverage?.openQuestions) ? coverage.openQuestions.length : 0;
  const incompleteCoverage = coverage?.completeness === "complete" ? 0 : 1;
  if (reportArtifact.bytes.length === 0) fail("completed Deep Scan report projection is empty");
  const formalReport = deriveFormalReport({
    scan,
    manifestArtifact,
    findingsArtifact,
    coverageArtifact,
    findings,
    coverage
  });
  const exportValue = {
    schemaVersion: 3,
    evidenceType: "codex-security-deep-scan-export",
    scanType: "codex-security-deep-scan",
    scanId: scan.id,
    status: "completed",
    scanSourceManifestSha256: sourceManifestSha256,
    sourceBinding: {
      algorithm: snapshot.algorithm,
      pluginVersion: REQUIRED_PLUGIN_VERSION,
      targetKind: "directory_snapshot",
      targetId: scan.target.targetId,
      snapshotDigest: snapshot.snapshotDigest,
      sourceManifestBytes: source.bytes.length,
      sourceMemberCount: snapshot.sourceMemberCount,
      sourceModeManifestSha256: snapshot.sourceModeManifestSha256,
      directoryCount: snapshot.directoryCount
    },
    trustedGenerationAttestation: {
      sha256: trustedGeneration.attestationArtifact.sha256,
      producerSha256: trustedGeneration.producerSha256,
      generationId: trustedGeneration.generationId,
      base64: trustedGeneration.attestationArtifact.bytes.toString("base64")
    },
    startedAt: scan.startedAt,
    completedAt: scan.completedAt,
    sealedAt: scan.sealedAt,
    reportSha256: sha256(formalReport),
    reportDerivation: "sealed-manifest-findings-coverage.v1",
    generatedReportProjectionSha256: reportArtifact.sha256,
    completionArtifact: {
      kind: "sealed-scan-manifest",
      sha256: manifestArtifact.sha256,
      base64: manifestArtifact.bytes.toString("base64")
    },
    canonicalArtifacts: {
      findings: { sha256: findingsArtifact.sha256, base64: findingsArtifact.bytes.toString("base64") },
      coverage: { sha256: coverageArtifact.sha256, base64: coverageArtifact.bytes.toString("base64") }
    },
    findingIds,
    validatedFindingCount: findingIds.length,
    untriagedFindingCount: deferred + followUp + openQuestions + incompleteCoverage,
    exporter: "scripts/export-deep-scan-evidence.mjs"
  };
  const exportTarget = await publishEvidence(
    evidenceDir,
    formalReport,
    Buffer.from(`${JSON.stringify(exportValue, null, 2)}\n`, "utf8")
  );
  process.stdout.write(`${exportTarget}\n`);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      await generationLock.release();
    } catch (error) {
      if (!primaryError) throw error;
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runDeepScanEvidenceExporter(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`ERROR: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
