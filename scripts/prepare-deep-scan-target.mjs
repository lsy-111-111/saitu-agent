#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readlink,
  realpath,
  symlink,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  inspectCodexSecurityDirectorySnapshot,
  parseReleaseSourceManifest
} from "./lib/codex-security-directory-snapshot.mjs";

const fail = (message) => { throw new Error(message); };
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function argumentsOf(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--") || Object.hasOwn(result, key)) {
      fail("invalid Deep Scan target preparation arguments");
    }
    result[key] = value;
  }
  const required = ["--source-root", "--source-manifest", "--target", "--receipt"];
  if (Object.keys(result).some((key) => !required.includes(key)) || required.some((key) => !result[key])) {
    fail("usage: prepare-deep-scan-target.mjs --source-root ABS --source-manifest ABS --target ABS --receipt ABS");
  }
  for (const value of Object.values(result)) if (!path.isAbsolute(value)) fail("Deep Scan preparation paths must be absolute");
  return result;
}

function stable(metadata) {
  return ["dev", "ino", "mode", "nlink", "size", "mtimeNs", "ctimeNs"].map((key) => metadata[key]);
}

function same(left, right) {
  return left.every((value, index) => value === right[index]);
}

function safeMode(metadata, relative) {
  const mode = Number(metadata.mode & 0o7777n);
  if ((mode & 0o7022) !== 0) fail(`source member has unsafe mode: ${relative}`);
  return mode;
}

function safeLinkTarget(value, relative) {
  if (!value || value.startsWith("/") || /[\0\r\n]/u.test(value) || value.split("/").includes("..")) {
    fail(`source symlink escapes the snapshot: ${relative}`);
  }
}

async function missing(filename, label) {
  try {
    await lstat(filename);
    fail(`${label} already exists: ${filename}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function main() {
  const args = argumentsOf(process.argv.slice(2));
  const sourceRoot = await realpath(args["--source-root"]);
  const sourceMetadata = await lstat(sourceRoot, { bigint: true });
  if (!sourceMetadata.isDirectory() || sourceMetadata.isSymbolicLink()) fail("source root is unsafe");
  const target = args["--target"];
  const receiptPath = args["--receipt"];
  await missing(target, "Deep Scan target");
  await missing(receiptPath, "Deep Scan receipt");
  const targetParent = await realpath(path.dirname(target));
  const receiptParent = await realpath(path.dirname(receiptPath));
  if (targetParent === sourceRoot || targetParent.startsWith(`${sourceRoot}${path.sep}`)) {
    fail("Deep Scan target must be outside the Git source tree");
  }
  if (receiptParent === target || receiptParent.startsWith(`${target}${path.sep}`)) {
    fail("Deep Scan receipt must remain outside the scanned target");
  }
  const sourceManifestPath = await realpath(args["--source-manifest"]);
  const sourceManifestBytes = await readFile(sourceManifestPath);
  const entries = parseReleaseSourceManifest(sourceManifestBytes);
  const directories = new Set();
  for (const entry of entries) {
    const parts = entry.path.split("/");
    for (let count = 1; count < parts.length; count += 1) directories.add(parts.slice(0, count).join("/"));
  }
  await mkdir(target, { mode: 0o700 });
  for (const relative of [...directories].sort((left, right) => {
    const depth = left.split("/").length - right.split("/").length;
    return depth || Buffer.compare(Buffer.from(left), Buffer.from(right));
  })) {
    const source = path.join(sourceRoot, ...relative.split("/"));
    const metadata = await lstat(source, { bigint: true });
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) fail(`source ancestor is unsafe: ${relative}`);
    const mode = safeMode(metadata, relative);
    const destination = path.join(target, ...relative.split("/"));
    await mkdir(destination, { mode });
    await chmod(destination, mode);
  }
  for (const entry of entries) {
    const source = path.join(sourceRoot, ...entry.path.split("/"));
    const destination = path.join(target, ...entry.path.split("/"));
    const before = await lstat(source, { bigint: true });
    if (before.isFile() && !before.isSymbolicLink()) {
      if (entry.kind !== "F" || before.nlink !== 1n || before.size > 128n * 1024n * 1024n) {
        fail(`source file is linked, mistyped, or too large: ${entry.path}`);
      }
      const mode = safeMode(before, entry.path);
      const bytes = await readFile(source);
      const after = await lstat(source, { bigint: true });
      if (!same(stable(before), stable(after)) || sha256(bytes) !== entry.digest) {
        fail(`source file changed or differs from its manifest: ${entry.path}`);
      }
      await writeFile(destination, bytes, { flag: "wx", mode });
      await chmod(destination, mode);
    } else if (before.isSymbolicLink()) {
      if (entry.kind !== "L") fail(`source symlink kind differs: ${entry.path}`);
      const linkTarget = await readlink(source, "utf8");
      safeLinkTarget(linkTarget, entry.path);
      const after = await lstat(source, { bigint: true });
      if (!same(stable(before), stable(after)) || sha256(Buffer.from(linkTarget, "utf8")) !== entry.digest) {
        fail(`source symlink changed or differs from its manifest: ${entry.path}`);
      }
      await symlink(linkTarget, destination);
    } else {
      fail(`source member is special or mistyped: ${entry.path}`);
    }
  }
  const snapshot = await inspectCodexSecurityDirectorySnapshot(target, sourceManifestBytes);
  const identity = await lstat(target, { bigint: true });
  const receipt = {
    schemaVersion: 1,
    evidenceType: "codex-security-directory-snapshot-preparation",
    producer: "scripts/prepare-deep-scan-target.mjs",
    createdAt: new Date().toISOString().replace(/\.\d{3}Z$/u, "Z"),
    sourceManifestSha256: snapshot.sourceManifestSha256,
    snapshotDigest: snapshot.snapshotDigest,
    sourceMemberCount: snapshot.sourceMemberCount,
    sourceModeManifestSha256: snapshot.sourceModeManifestSha256,
    directoryCount: snapshot.directoryCount,
    targetIdentity: { device: String(identity.dev), inode: String(identity.ino) }
  };
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ target, receipt: receiptPath, snapshotDigest: snapshot.snapshotDigest })}\n`);
}

main().catch((error) => {
  process.stderr.write(`ERROR: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
