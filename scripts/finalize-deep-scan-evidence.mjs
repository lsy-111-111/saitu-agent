#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstat, readFile, realpath, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { inspectReleaseSourceModeManifest } from "./lib/codex-security-directory-snapshot.mjs";
import { assertEmbeddedTrustedGenerationAttestation } from "./lib/trusted-macos-deep-scan-generation.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const fail = (message) => { throw new Error(message); };
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

function argsOf(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--") || Object.hasOwn(result, key)) fail("invalid finalizer arguments");
    result[key] = value;
  }
  const allowed = ["--evidence-dir", "--final-source-manifest", "--final-source-root", "--closures-dir"];
  if (
    Object.keys(result).some((key) => !allowed.includes(key))
    || !result["--evidence-dir"]
    || !result["--final-source-manifest"]
    || !result["--final-source-root"]
  ) fail("missing or unknown finalizer argument");
  return result;
}

async function artifact(filename) {
  const metadata = await lstat(filename, { bigint: true });
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1n || metadata.size > 128n * 1024n * 1024n) fail(`unsafe evidence artifact: ${filename}`);
  const bytes = await readFile(filename);
  const after = await lstat(filename, { bigint: true });
  for (const key of ["dev", "ino", "mode", "nlink", "size", "mtimeNs", "ctimeNs"]) {
    if (metadata[key] !== after[key]) fail(`evidence artifact changed while reading: ${filename}`);
  }
  return { bytes, sha256: sha256(bytes) };
}

function instant(value, label) {
  if (!/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(value ?? "")) fail(`invalid ${label}`);
  const milliseconds = Date.parse(value);
  if (
    !Number.isFinite(milliseconds)
    || new Date(milliseconds).toISOString().replace(/\.000Z$/u, "Z") !== value
    || milliseconds > Date.now() + 5 * 60_000
  ) fail(`invalid ${label}`);
  return milliseconds;
}

async function main() {
  const args = argsOf(process.argv.slice(2));
  const evidenceDir = await realpath(args["--evidence-dir"]);
  const finalManifest = await artifact(args["--final-source-manifest"]);
  const finalModes = await inspectReleaseSourceModeManifest(
    args["--final-source-root"],
    finalManifest.bytes
  );
  const exportArtifact = await artifact(path.join(evidenceDir, "deep-scan-export.json"));
  const report = await artifact(path.join(evidenceDir, "security-scan-report.txt"));
  const exported = JSON.parse(exportArtifact.bytes.toString("utf8"));
  if (
    exported?.schemaVersion !== 3
    || exported?.evidenceType !== "codex-security-deep-scan-export"
    || exported?.scanType !== "codex-security-deep-scan"
    || exported?.status !== "completed"
    || exported?.exporter !== "scripts/export-deep-scan-evidence.mjs"
    || exported?.reportDerivation !== "sealed-manifest-findings-coverage.v1"
  ) fail("Deep Scan export is not canonical completion evidence");
  if (
    !/^[a-f0-9]{64}$/u.test(exported?.scanSourceManifestSha256 ?? "")
    || report.sha256 !== exported.reportSha256
    || exported?.sourceBinding?.algorithm !== "codex-security-directory/v1"
    || exported?.sourceBinding?.pluginVersion !== "0.1.22"
    || exported?.sourceBinding?.targetKind !== "directory_snapshot"
    || !/^codex-security-snapshot\/v1:sha256:[a-f0-9]{64}$/u.test(exported?.sourceBinding?.snapshotDigest ?? "")
    || !Number.isInteger(exported?.sourceBinding?.sourceMemberCount)
    || exported.sourceBinding.sourceMemberCount <= 0
    || !Number.isInteger(exported?.sourceBinding?.sourceManifestBytes)
    || exported.sourceBinding.sourceManifestBytes <= 0
    || !/^[a-f0-9]{64}$/u.test(exported?.sourceBinding?.sourceModeManifestSha256 ?? "")
  ) fail("Deep Scan export hashes are inconsistent");
  if (
    finalModes.sourceManifestSha256 !== finalManifest.sha256
    || !Number.isInteger(finalModes.sourceModeMemberCount)
    || finalModes.sourceModeMemberCount <= 0
    || !/^[a-f0-9]{64}$/u.test(finalModes.sourceModeManifestSha256 ?? "")
  ) fail("final release modes differ from the source modes reviewed by Deep Scan");
  const manifestBytes = Buffer.from(exported?.completionArtifact?.base64 ?? "", "base64");
  if (sha256(manifestBytes) !== exported?.completionArtifact?.sha256) fail("embedded raw completion manifest hash is invalid");
  const sealedManifest = JSON.parse(manifestBytes.toString("utf8"));
  if (
    sealedManifest?.documentType !== "codex-security.scan-manifest"
    || sealedManifest?.schemaVersion !== "1.0"
    || sealedManifest?.scan?.id !== exported.scanId
    || sealedManifest?.scan?.producer?.name !== "codex-security-plugin"
    || sealedManifest?.scan?.status !== "completed"
    || !sealedManifest?.scan?.sealedAt
    || exported.startedAt !== sealedManifest?.scan?.startedAt
    || exported.completedAt !== sealedManifest?.scan?.completedAt
    || exported.sealedAt !== sealedManifest?.scan?.sealedAt
    || sealedManifest?.scan?.producer?.version !== exported.sourceBinding.pluginVersion
    || sealedManifest?.scan?.target?.kind !== "directory_snapshot"
    || sealedManifest?.scan?.target?.targetId !== exported.sourceBinding.targetId
    || sealedManifest?.scan?.target?.snapshotDigest !== exported.sourceBinding.snapshotDigest
    || JSON.stringify(sealedManifest?.scan?.scope?.includePaths) !== JSON.stringify(["."])
    || sealedManifest?.scan?.scope?.excludePaths?.length !== 0
  ) fail("embedded raw completion does not identify the exported scan");
  const scanStarted = instant(exported.startedAt, "Deep Scan start time");
  const scanCompleted = instant(exported.completedAt, "Deep Scan completion time");
  const scanSealed = instant(exported.sealedAt, "Deep Scan seal time");
  if (scanCompleted < scanStarted || scanSealed < scanCompleted || scanCompleted - scanStarted > 120 * 60 * 60_000) fail("Deep Scan time order is invalid");
  const attestationBytes = Buffer.from(exported?.trustedGenerationAttestation?.base64 ?? "", "base64");
  if (
    sha256(attestationBytes) !== exported?.trustedGenerationAttestation?.sha256
    || !/^[a-f0-9]{64}$/u.test(exported?.trustedGenerationAttestation?.producerSha256 ?? "")
  ) fail("embedded trusted generation attestation hash is invalid");
  const attestation = JSON.parse(attestationBytes.toString("utf8"));
  assertEmbeddedTrustedGenerationAttestation(attestation, {
    sourceManifestSha256: exported.scanSourceManifestSha256,
    sourceManifestBytes: exported.sourceBinding.sourceManifestBytes,
    snapshot: exported.sourceBinding,
    producerSha256: exported.trustedGenerationAttestation.producerSha256
  });
  const preparedAt = instant(attestation.createdAt, "trusted generation creation time");
  if (
    exported.trustedGenerationAttestation.generationId !== attestation.generationId
    || preparedAt > scanStarted
    || scanStarted - preparedAt > 24 * 60 * 60_000
  ) fail("trusted generation attestation is not bound to the exported scan");
  const findingBytes = Buffer.from(exported?.canonicalArtifacts?.findings?.base64 ?? "", "base64");
  const coverageBytes = Buffer.from(exported?.canonicalArtifacts?.coverage?.base64 ?? "", "base64");
  if (sha256(findingBytes) !== exported?.canonicalArtifacts?.findings?.sha256 || sha256(coverageBytes) !== exported?.canonicalArtifacts?.coverage?.sha256) fail("embedded canonical artifact hash is invalid");
  const findings = JSON.parse(findingBytes.toString("utf8"));
  const coverage = JSON.parse(coverageBytes.toString("utf8"));
  const findingIds = findings?.findings?.map((finding) => finding?.findingId) ?? [];
  const sealedArtifacts = new Map((sealedManifest?.scan?.artifacts ?? []).map((entry) => [entry?.path, entry?.sha256]));
  if (
    findings?.documentType !== "codex-security.findings"
    || findings?.schemaVersion !== "1.0"
    || findings?.scanId !== exported.scanId
    || !Array.isArray(findings?.findings)
    || findings.findings.some((finding) => !canonicalFinding(finding))
    || new Set(findingIds).size !== findingIds.length
    || JSON.stringify(findingIds) !== JSON.stringify(exported.findingIds)
    || findingIds.length !== exported.validatedFindingCount
  ) fail("Deep Scan export finding ledger is inconsistent");
  if (
    coverage?.documentType !== "codex-security.coverage"
    || coverage?.schemaVersion !== "1.0"
    || coverage?.scanId !== exported.scanId
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
  ) fail("Deep Scan coverage is incomplete");
  if (
    sealedArtifacts.size !== (sealedManifest?.scan?.artifacts ?? []).length
    || sealedArtifacts.get("findings.json") !== exported.canonicalArtifacts.findings.sha256
    || sealedArtifacts.get("coverage.json") !== exported.canonicalArtifacts.coverage.sha256
  ) fail("Deep Scan sealed artifact ledger is inconsistent");
  if (exported.untriagedFindingCount !== 0) fail("Deep Scan retained untriaged or follow-up work");
  const finalSourceManifestSha256 = finalManifest.sha256;
  const closures = [];
  if (findingIds.length === 0) {
    if (
      exported.scanSourceManifestSha256 !== finalSourceManifestSha256
      || exported.sourceBinding.sourceModeManifestSha256 !== finalModes.sourceModeManifestSha256
      || exported.sourceBinding.sourceMemberCount !== finalModes.sourceModeMemberCount
    ) fail("zero-finding Deep Scan source and modes must equal final release source");
    if (args["--closures-dir"]) fail("zero-finding Deep Scan must not carry closure evidence");
  } else {
    if (exported.scanSourceManifestSha256 === finalSourceManifestSha256) fail("finding remediation did not produce a new final source manifest");
    if (!args["--closures-dir"]) fail("every Deep Scan finding requires independent closure evidence");
    const closureDir = await realpath(args["--closures-dir"]);
    const names = (await readdir(closureDir)).sort();
    if (names.length !== findingIds.length || names.some((name) => !name.endsWith(".json"))) fail("closure directory is not an exact finding ledger");
    for (const name of names) {
      const item = await artifact(path.join(closureDir, name));
      const closure = JSON.parse(item.bytes.toString("utf8"));
      if (
        closure?.schemaVersion !== 1
        || closure?.evidenceType !== "codex-security-finding-closure"
        || closure?.producer !== "scripts/export-deep-scan-finding-closure.mjs"
        || closure?.pluginVersion !== exported.sourceBinding.pluginVersion
        || closure?.scanId !== exported.scanId
        || closure?.status !== "verified-fixed"
        || closure?.finalSourceManifestSha256 !== finalSourceManifestSha256
        || !findingIds.includes(closure?.findingId)
      ) fail(`invalid Deep Scan finding closure: ${name}`);
      const verifiedAt = instant(closure.verifiedAt, "finding verification time");
      if (verifiedAt < scanCompleted || verifiedAt > Date.now()) fail("finding verification time is outside the remediation window");
      const raw = Buffer.from(closure?.rawVerification?.base64 ?? "", "base64");
      if (sha256(raw) !== closure?.rawVerification?.sha256) fail("finding closure raw verification hash is invalid");
      const receipt = JSON.parse(raw.toString("utf8"));
      if (
        receipt?.documentType !== "codex-security.verify-fix-result"
        || receipt?.schemaVersion !== "1.0"
        || receipt?.producer?.name !== "codex-security-plugin"
        || receipt?.producer?.version !== exported.sourceBinding.pluginVersion
        || receipt?.scanId !== exported.scanId
        || receipt?.findingId !== closure.findingId
        || receipt?.status !== "verified-fixed"
        || receipt?.sourceManifestSha256 !== finalSourceManifestSha256
        || receipt?.verifiedAt !== closure.verifiedAt
      ) fail("raw fix verification does not close the claimed finding");
      for (const [label, entries] of [["fix", receipt?.fixEvidence], ["verification", receipt?.verificationEvidence]]) {
        if (!Array.isArray(entries) || entries.length === 0) fail(`raw closure lacks ${label} evidence`);
        for (const entry of entries) {
          const bytes = Buffer.from(entry?.base64 ?? "", "base64");
          if (sha256(bytes) !== entry?.sha256 || (label === "verification" && entry?.exitCode !== 0)) fail(`raw closure ${label} evidence is invalid`);
        }
      }
      closures.push({ findingId: closure.findingId, closureSha256: item.sha256, verifiedAt: closure.verifiedAt });
    }
    if (new Set(closures.map((closure) => closure.findingId)).size !== findingIds.length) fail("not every Deep Scan finding has one closure");
  }
  if (scanCompleted > Date.now()) fail("Deep Scan completion is in the future");
  const completedAt = new Date().toISOString().replace(/\.\d{3}Z$/u, "Z");
  const result = {
    schemaVersion: 1,
    evidenceType: "codex-security-deep-scan-finalization",
    scanType: "codex-security-deep-scan",
    status: "passed",
    scanId: exported.scanId,
    scanSourceManifestSha256: exported.scanSourceManifestSha256,
    scanSourceModeManifestSha256: exported.sourceBinding.sourceModeManifestSha256,
    scanSourceModeMemberCount: exported.sourceBinding.sourceMemberCount,
    scanSnapshotDigest: exported.sourceBinding.snapshotDigest,
    finalSourceManifestSha256,
    finalSourceModeManifestSha256: finalModes.sourceModeManifestSha256,
    finalSourceModeMemberCount: finalModes.sourceModeMemberCount,
    sourceManifestSha256: finalSourceManifestSha256,
    startedAt: exported.startedAt,
    scanCompletedAt: exported.completedAt,
    completedAt,
    reportSha256: report.sha256,
    rawCompletionSha256: exported.completionArtifact.sha256,
    scanGenerationAttestationSha256: exported.trustedGenerationAttestation.sha256,
    scanGenerationProducerSha256: exported.trustedGenerationAttestation.producerSha256,
    exportSha256: exportArtifact.sha256,
    validatedFindingCount: findingIds.length,
    validatedFindingIds: findingIds,
    closedFindingCount: closures.length,
    closures,
    validatedOpenFindings: 0,
    untriagedFindings: 0,
    finalizer: "scripts/finalize-deep-scan-evidence.mjs"
  };
  const target = path.join(evidenceDir, "security-scan-result.json");
  await writeFile(target, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  process.stdout.write(`${target}\n`);
}

main().catch((error) => {
  process.stderr.write(`ERROR: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
