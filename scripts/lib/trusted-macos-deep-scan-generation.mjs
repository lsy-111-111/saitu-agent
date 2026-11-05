import { createHash } from "node:crypto";
import { lstat, readFile, realpath, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

export const TRUSTED_GENERATIONS_ROOT = "/private/var/db/com.siyuanjiaxin.resume-ai/deep-scan-generations";
export const TRUSTED_CREATOR_PATH = "/Library/PrivilegedHelperTools/com.siyuanjiaxin.resume-ai.create-deep-scan-generation";
export const TRUSTED_ATTESTATION_SCHEMA = "com.siyuanjiaxin.resume-ai.deep-scan-generation/v1";

const GENERATION_ID = /^ds-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{16}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const SNAPSHOT = /^codex-security-snapshot\/v1:sha256:[a-f0-9]{64}$/u;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const fail = (message) => { throw new Error(message); };
const mode = (metadata) => Number(metadata.mode & 0o7777n);

function normalizedAbsolute(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value) || path.normalize(value) !== value || value === "/" || /[\0\r\n\t]/u.test(value)) {
    fail(`${label} is not a normalized absolute path`);
  }
  return value;
}

async function stableOrdinary(filename, ceiling, label) {
  const before = await lstat(filename, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size < 0n || before.size > BigInt(ceiling)) {
    fail(`${label} is not a safe ordinary file`);
  }
  const bytes = await readFile(filename);
  const after = await lstat(filename, { bigint: true });
  for (const key of ["dev", "ino", "mode", "nlink", "uid", "gid", "size", "mtimeNs", "ctimeNs"]) {
    if (before[key] !== after[key]) fail(`${label} changed while it was read`);
  }
  return { bytes, metadata: before, sha256: sha256(bytes) };
}

async function sealedAncestorChain(filename, stopAt, label) {
  const parts = filename.split("/").filter(Boolean);
  const stopParts = stopAt.split("/").filter(Boolean);
  if (parts.slice(0, stopParts.length).join("/") !== stopParts.join("/")) fail(`${label} escapes its trusted prefix`);
  let current = "";
  for (const part of parts) {
    current += `/${part}`;
    const metadata = await lstat(current, { bigint: true });
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== 0n || metadata.gid !== 0n || (mode(metadata) & 0o022) !== 0) {
      fail(`${label} has a linked, writable, or non-root ancestor: ${current}`);
    }
  }
}

async function assertRootOwnedTree(directory, label) {
  const before = await lstat(directory, { bigint: true });
  if (!before.isDirectory() || before.isSymbolicLink() || before.uid !== 0n || before.gid !== 0n || (mode(before) & 0o022) !== 0) {
    fail(`${label} root is not sealed root:wheel`);
  }
  const names = (await readdir(directory)).sort();
  for (const name of names) {
    if (!name || name === "." || name === ".." || /[\/\0\r\n\t]/u.test(name)) fail(`${label} contains an unsafe name`);
    const member = path.join(directory, name);
    const metadata = await lstat(member, { bigint: true });
    if (metadata.uid !== 0n || metadata.gid !== 0n || (mode(metadata) & 0o022) !== 0) fail(`${label} contains an unsealed member: ${member}`);
    if (metadata.isDirectory() && !metadata.isSymbolicLink()) {
      await assertRootOwnedTree(member, label);
    } else if (metadata.isFile() && !metadata.isSymbolicLink()) {
      if (metadata.nlink !== 1n || (mode(metadata) & 0o004) === 0) fail(`${label} contains a linked or unreadable file: ${member}`);
    } else if (!metadata.isSymbolicLink()) {
      fail(`${label} contains a special member: ${member}`);
    }
  }
  const after = await lstat(directory, { bigint: true });
  for (const key of ["dev", "ino", "mode", "nlink", "uid", "gid", "mtimeNs", "ctimeNs"]) {
    if (before[key] !== after[key]) fail(`${label} changed while it was inspected`);
  }
  if (JSON.stringify(names) !== JSON.stringify((await readdir(directory)).sort())) fail(`${label} membership changed while it was inspected`);
}

function exactBoundary(value) {
  return value?.candidateCodeExecuted === false
    && value?.descriptorRelativeTraversal === true
    && value?.symlinkAncestorsFollowed === false
    && value?.atomicPublish === true
    && value?.atomicNoClobber === true
    && value?.extendedAclEntries === false
    && value?.exactManifestMembership === true
    && value?.modePolicy === "preserve exact source mode and fail unless scanner-readable and scanner-nonwritable"
    && value?.attestationSignature === "none; externally pin this attestation hash and producer hash";
}

export function assertEmbeddedTrustedGenerationAttestation(attestation, {
  sourceManifestSha256,
  sourceManifestBytes,
  snapshot,
  producerSha256
}) {
  const generationId = attestation?.generationId;
  const generationRoot = `${TRUSTED_GENERATIONS_ROOT}/${generationId}`;
  const generationSource = `${generationRoot}/source`;
  if (
    attestation?.schema !== TRUSTED_ATTESTATION_SCHEMA
    || attestation?.schemaVersion !== 1
    || attestation?.evidenceType !== "trusted-macos-codex-security-generation"
    || !GENERATION_ID.test(generationId ?? "")
    || !/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(attestation?.createdAt ?? "")
    || attestation?.producer?.installedPath !== TRUSTED_CREATOR_PATH
    || attestation?.producer?.sha256 !== producerSha256
    || !SHA256.test(attestation?.producer?.sha256 ?? "")
    || attestation?.producer?.mode !== "0444"
    || !/^\d+$/u.test(attestation?.producer?.device ?? "")
    || !/^\d+$/u.test(attestation?.producer?.inode ?? "")
    || attestation?.sourceManifest?.sha256 !== sourceManifestSha256
    || attestation?.sourceManifest?.bytes !== sourceManifestBytes
    || attestation?.sourceManifest?.memberCount !== snapshot.sourceMemberCount
    || attestation?.generation?.root !== generationRoot
    || attestation?.generation?.source !== generationSource
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
    || attestation?.snapshot?.algorithm !== snapshot.algorithm
    || attestation?.snapshot?.snapshotDigest !== snapshot.snapshotDigest
    || attestation?.snapshot?.sourceModeManifestSha256 !== snapshot.sourceModeManifestSha256
    || attestation?.snapshot?.sourceMemberCount !== snapshot.sourceMemberCount
    || attestation?.snapshot?.directoryCount !== snapshot.directoryCount
    || !Number.isInteger(attestation?.snapshot?.treeBytes)
    || attestation.snapshot.treeBytes < 0
    || !SNAPSHOT.test(attestation?.snapshot?.snapshotDigest ?? "")
    || !exactBoundary(attestation?.boundary)
    || attestation?.runtime?.pythonExecutable !== "/usr/bin/python3"
    || !/^3\.\d+(?:\.\d+)?$/u.test(attestation?.runtime?.python ?? "")
    || attestation?.runtime?.isolatedMode !== true
    || attestation?.runtime?.siteImportDisabled !== true
  ) fail("embedded trusted generation attestation is malformed or unbound");
  return { generationId, generationRoot, generationSource };
}

/**
 * Revalidate a privileged macOS generation immediately before evidence export.
 * The caller supplies hashes captured from the root helper's single JSON result;
 * neither the repository nor the attestation is allowed to choose those pins.
 */
export async function inspectTrustedMacDeepScanGeneration({
  attestationPath,
  attestationSha256,
  producerSha256,
  scanTargetDir,
  sourceManifestBytes,
  snapshot
}) {
  normalizedAbsolute(attestationPath, "trusted generation attestation path");
  normalizedAbsolute(scanTargetDir, "Deep Scan target path");
  if (!SHA256.test(attestationSha256 ?? "") || !SHA256.test(producerSha256 ?? "")) fail("trusted generation pins must be SHA-256 values");

  const target = await realpath(scanTargetDir);
  if (target !== scanTargetDir) fail("Deep Scan target must use its canonical physical path");
  const generationRoot = path.dirname(target);
  const generationId = path.basename(generationRoot);
  if (path.dirname(generationRoot) !== TRUSTED_GENERATIONS_ROOT || path.basename(target) !== "source" || !GENERATION_ID.test(generationId)) {
    fail("Deep Scan target is not a trusted macOS generation");
  }
  if (attestationPath !== path.join(generationRoot, "attestation.json")) fail("attestation is not the generation's canonical member");

  await sealedAncestorChain(TRUSTED_GENERATIONS_ROOT, "/private", "trusted generation root");
  await sealedAncestorChain(generationRoot, TRUSTED_GENERATIONS_ROOT, "trusted generation");
  const generationMetadata = await lstat(generationRoot, { bigint: true });
  if (mode(generationMetadata) !== 0o555) fail("trusted generation root mode is not 0555");
  const generationMembers = (await readdir(generationRoot)).sort();
  if (JSON.stringify(generationMembers) !== JSON.stringify(["attestation.json", "source"])) fail("trusted generation has unexpected top-level members");

  const attestationArtifact = await stableOrdinary(attestationPath, 4 * 1024 * 1024, "trusted generation attestation");
  if (attestationArtifact.metadata.uid !== 0n || attestationArtifact.metadata.gid !== 0n || mode(attestationArtifact.metadata) !== 0o444) {
    fail("trusted generation attestation is not sealed root:wheel mode 0444");
  }
  if (attestationArtifact.sha256 !== attestationSha256) fail("trusted generation attestation differs from its external pin");

  await sealedAncestorChain(path.dirname(TRUSTED_CREATOR_PATH), "/Library", "trusted creator install directory");
  const producerArtifact = await stableOrdinary(TRUSTED_CREATOR_PATH, 4 * 1024 * 1024, "trusted generation creator");
  if (producerArtifact.metadata.uid !== 0n || producerArtifact.metadata.gid !== 0n || mode(producerArtifact.metadata) !== 0o444 || producerArtifact.sha256 !== producerSha256) {
    fail("trusted generation creator differs from its sealed external pin");
  }

  const attestation = JSON.parse(attestationArtifact.bytes.toString("utf8"));
  const sourceMetadata = await lstat(target, { bigint: true });
  const sourceManifestSha256 = sha256(sourceManifestBytes);
  assertEmbeddedTrustedGenerationAttestation(attestation, {
    sourceManifestSha256,
    sourceManifestBytes: sourceManifestBytes.length,
    snapshot,
    producerSha256
  });
  if (
    attestation?.generationId !== generationId
    || attestation?.producer?.device !== String(producerArtifact.metadata.dev)
    || attestation?.producer?.inode !== String(producerArtifact.metadata.ino)
    || attestation?.generation?.root !== generationRoot
    || attestation?.generation?.source !== target
    || attestation?.generation?.sourceIdentity?.device !== String(sourceMetadata.dev)
    || attestation?.generation?.sourceIdentity?.inode !== String(sourceMetadata.ino)
    || attestation?.generation?.sourceIdentity?.mode !== mode(sourceMetadata).toString(8).padStart(4, "0")
    || attestation?.scanner?.uid !== process.getuid?.()
    || attestation?.scanner?.gid !== process.getgid?.()
  ) fail("trusted generation attestation is inconsistent with the sealed target");

  await assertRootOwnedTree(target, "trusted generation source");
  return {
    attestation,
    attestationArtifact,
    generationId,
    generationRoot,
    producerSha256,
    sourceManifestSha256
  };
}
