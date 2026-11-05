import { createHash } from "node:crypto";
import { lstat, readFile, readdir, readlink, realpath } from "node:fs/promises";
import path from "node:path";

const SNAPSHOT_FORMAT = "codex-security-directory/v1";
const SNAPSHOT_PREFIX = "codex-security-snapshot/v1:sha256:";
const FILE_CEILING = 128 * 1024 * 1024;
const TREE_CEILING = 2 * 1024 * 1024 * 1024;

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const fail = (message) => { throw new Error(message); };

function stable(metadata) {
  return ["dev", "ino", "mode", "nlink", "size", "mtimeNs", "ctimeNs"]
    .map((key) => metadata[key]);
}

function sameStable(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function compareUnicode(left, right) {
  const leftPoints = Array.from(left, (value) => value.codePointAt(0));
  const rightPoints = Array.from(right, (value) => value.codePointAt(0));
  for (let index = 0; index < Math.min(leftPoints.length, rightPoints.length); index += 1) {
    if (leftPoints[index] !== rightPoints[index]) return leftPoints[index] - rightPoints[index];
  }
  return leftPoints.length - rightPoints.length;
}

// pathlib.Path ordering compares normalized path components, not one joined
// string. Codex Security 0.1.22 uses sorted(Path.rglob("*")); mirror that
// ordering exactly, including non-ASCII component names.
function comparePythonPaths(left, right) {
  const leftParts = left.split("/");
  const rightParts = right.split("/");
  for (let index = 0; index < Math.min(leftParts.length, rightParts.length); index += 1) {
    const compared = compareUnicode(leftParts[index], rightParts[index]);
    if (compared !== 0) return compared;
  }
  return leftParts.length - rightParts.length;
}

function normalizedRelative(value) {
  if (
    !value
    || value.startsWith("/")
    || /[\0\r\n\t]/u.test(value)
    || value.split("/").some((part) => !part || part === "." || part === "..")
  ) fail(`invalid source manifest path: ${JSON.stringify(value)}`);
  return value;
}

export function parseReleaseSourceManifest(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.at(-1) !== 0x0a) {
    fail("source manifest must be nonempty and newline terminated");
  }
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes)) fail("source manifest is not UTF-8");
  const entries = [];
  const seen = new Set();
  let previousPathBytes;
  for (const line of text.slice(0, -1).split("\n")) {
    const match = /^([a-f0-9]{64})\t([FL])\t(.+)$/u.exec(line);
    if (!match) fail("source manifest contains a malformed member");
    const [, digest, kind, rawPath] = match;
    const relative = normalizedRelative(rawPath);
    if (seen.has(relative)) fail(`source manifest contains a duplicate member: ${relative}`);
    const relativeBytes = Buffer.from(relative, "utf8");
    if (previousPathBytes && Buffer.compare(previousPathBytes, relativeBytes) >= 0) {
      fail("source manifest members are not in canonical byte order");
    }
    previousPathBytes = relativeBytes;
    seen.add(relative);
    entries.push({ digest, kind, path: relative });
  }
  if (entries.length === 0) fail("source manifest is empty");
  return entries;
}

function updateDigestField(digest, label, value) {
  const labelBytes = Buffer.from(label, "utf8");
  const valueBytes = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
  const labelLength = Buffer.alloc(4);
  labelLength.writeUInt32BE(labelBytes.length);
  const valueLength = Buffer.alloc(8);
  valueLength.writeBigUInt64BE(BigInt(valueBytes.length));
  digest.update(labelLength);
  digest.update(labelBytes);
  digest.update(valueLength);
  digest.update(valueBytes);
}

function requiredDirectories(entries) {
  const directories = new Set();
  for (const entry of entries) {
    const parts = entry.path.split("/");
    for (let count = 1; count < parts.length; count += 1) {
      directories.add(parts.slice(0, count).join("/"));
    }
  }
  return directories;
}

async function enumerateSnapshot(root) {
  const result = new Map();
  const directories = new Map();
  async function walk(absolute, relative) {
    const before = await lstat(absolute, { bigint: true });
    if (!before.isDirectory() || before.isSymbolicLink()) fail(`snapshot ancestor is unsafe: ${relative || "."}`);
    const children = await readdir(absolute);
    children.sort(compareUnicode);
    for (const name of children) {
      if (!name || name === "." || name === ".." || /[\0\r\n\t/]/u.test(name)) {
        fail(`snapshot member name is unsafe: ${JSON.stringify(name)}`);
      }
      const childRelative = relative ? `${relative}/${name}` : name;
      const childAbsolute = path.join(absolute, name);
      const metadata = await lstat(childAbsolute, { bigint: true });
      result.set(childRelative, { absolute: childAbsolute, metadata: stable(metadata) });
      if (metadata.isDirectory() && !metadata.isSymbolicLink()) await walk(childAbsolute, childRelative);
    }
    const namesAfter = (await readdir(absolute)).sort(compareUnicode);
    const after = await lstat(absolute, { bigint: true });
    if (JSON.stringify(children) !== JSON.stringify(namesAfter) || !sameStable(stable(before), stable(after))) {
      fail(`snapshot directory changed while enumerating: ${relative || "."}`);
    }
    directories.set(relative, stable(after));
  }
  await walk(root, "");
  return { entries: result, directories };
}

function safeSymlinkTarget(value, relative) {
  if (!value || value.startsWith("/") || /[\0\r\n]/u.test(value)) fail(`unsafe snapshot symlink: ${relative}`);
  const parts = value.split("/");
  if (parts.some((part) => part === "..")) fail(`snapshot symlink escapes its source tree: ${relative}`);
}

export async function inspectCodexSecurityDirectorySnapshot(targetRoot, sourceManifestBytes) {
  const rootMetadata = await lstat(targetRoot, { bigint: true });
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) fail("Deep Scan target is not an ordinary directory");
  const root = await realpath(targetRoot);
  const entries = parseReleaseSourceManifest(sourceManifestBytes);
  const expectedMembers = new Map(entries.map((entry) => [entry.path, entry]));
  const expectedDirectories = requiredDirectories(entries);
  const observed = await enumerateSnapshot(root);
  const observedDirectories = new Set();
  const observedMembers = new Set();
  for (const [relative, entry] of observed.entries) {
    const metadata = await lstat(entry.absolute, { bigint: true });
    if (metadata.isDirectory() && !metadata.isSymbolicLink()) observedDirectories.add(relative);
    else observedMembers.add(relative);
  }
  if (
    JSON.stringify([...observedMembers].sort(comparePythonPaths)) !== JSON.stringify([...expectedMembers.keys()].sort(comparePythonPaths))
    || JSON.stringify([...observedDirectories].sort(comparePythonPaths)) !== JSON.stringify([...expectedDirectories].sort(comparePythonPaths))
  ) fail("Deep Scan target membership differs from the reviewed source manifest");

  const digest = createHash("sha256");
  updateDigestField(digest, "format", SNAPSHOT_FORMAT);
  const memberModes = new Map();
  let totalSize = 0;
  const allPaths = [...observed.entries.keys()].sort(comparePythonPaths);
  for (const relative of allPaths) {
    const observedEntry = observed.entries.get(relative);
    const before = await lstat(observedEntry.absolute, { bigint: true });
    if (!sameStable(stable(before), observedEntry.metadata)) fail(`Deep Scan target changed before hashing: ${relative}`);
    const mode = Number(before.mode & 0o7777n);
    updateDigestField(digest, "path", relative);
    updateDigestField(digest, "mode", String(mode));
    if (before.isDirectory() && !before.isSymbolicLink()) {
      updateDigestField(digest, "kind", "directory");
      continue;
    }
    const expected = expectedMembers.get(relative);
    if (!expected) fail(`unexpected Deep Scan target member: ${relative}`);
    if (before.isFile() && !before.isSymbolicLink()) {
      if (expected.kind !== "F" || before.nlink !== 1n || before.size > BigInt(FILE_CEILING)) {
        fail(`unsafe or mistyped Deep Scan file: ${relative}`);
      }
      totalSize += Number(before.size);
      if (totalSize > TREE_CEILING) fail("Deep Scan target exceeds the reviewed size ceiling");
      const bytes = await readFile(observedEntry.absolute);
      const after = await lstat(observedEntry.absolute, { bigint: true });
      if (!sameStable(stable(before), stable(after))) fail(`Deep Scan file changed while hashing: ${relative}`);
      const contentDigest = createHash("sha256").update(bytes).digest();
      if (contentDigest.toString("hex") !== expected.digest) fail(`Deep Scan file differs from source manifest: ${relative}`);
      updateDigestField(digest, "kind", "file");
      updateDigestField(digest, "size", String(bytes.length));
      updateDigestField(digest, "content-sha256", contentDigest);
    } else if (before.isSymbolicLink()) {
      if (expected.kind !== "L") fail(`mistyped Deep Scan symlink: ${relative}`);
      const target = await readlink(observedEntry.absolute, "utf8");
      safeSymlinkTarget(target, relative);
      const after = await lstat(observedEntry.absolute, { bigint: true });
      if (!sameStable(stable(before), stable(after))) fail(`Deep Scan symlink changed while hashing: ${relative}`);
      const contentDigest = sha256(Buffer.from(target, "utf8"));
      if (contentDigest !== expected.digest) fail(`Deep Scan symlink differs from source manifest: ${relative}`);
      updateDigestField(digest, "kind", "symlink");
      updateDigestField(digest, "content", target);
    } else {
      fail(`unsupported Deep Scan target member: ${relative}`);
    }
    memberModes.set(relative, mode);
  }

  for (const [relative, expectedStable] of observed.directories) {
    const absolute = relative ? path.join(root, ...relative.split("/")) : root;
    const after = await lstat(absolute, { bigint: true });
    if (!sameStable(expectedStable, stable(after))) fail(`Deep Scan directory changed while hashing: ${relative || "."}`);
  }
  return {
    algorithm: SNAPSHOT_FORMAT,
    snapshotDigest: `${SNAPSHOT_PREFIX}${digest.digest("hex")}`,
    sourceManifestSha256: sha256(sourceManifestBytes),
    sourceMemberCount: entries.length,
    // Release mode receipts use the source manifest's canonical byte ordering,
    // while the Codex Security snapshot digest above deliberately mirrors
    // pathlib's component ordering. Keep the two contracts independent.
    sourceModeManifestSha256: sha256(Buffer.from(entries.map((entry) => (
      `${memberModes.get(entry.path).toString(8).padStart(4, "0")}\t${entry.path}\n`
    )).join(""), "utf8")),
    directoryCount: expectedDirectories.size
  };
}

export async function inspectReleaseSourceModeManifest(targetRoot, sourceManifestBytes) {
  const rootMetadata = await lstat(targetRoot, { bigint: true });
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    fail("final source root is not an ordinary directory");
  }
  const root = await realpath(targetRoot);
  const entries = parseReleaseSourceManifest(sourceManifestBytes);
  const checkedDirectories = new Set([root]);
  const modeLines = [];
  for (const entry of entries) {
    const parts = entry.path.split("/");
    for (let count = 1; count < parts.length; count += 1) {
      const directory = path.join(root, ...parts.slice(0, count));
      if (checkedDirectories.has(directory)) continue;
      const metadata = await lstat(directory, { bigint: true });
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
        fail(`final source ancestor is unsafe: ${entry.path}`);
      }
      checkedDirectories.add(directory);
    }
    const filename = path.join(root, ...parts);
    const before = await lstat(filename, { bigint: true });
    const mode = Number(before.mode & 0o7777n);
    if ((mode & 0o7022) !== 0) fail(`final source member has an unsafe mode: ${entry.path}`);
    if (before.isFile() && !before.isSymbolicLink()) {
      if (entry.kind !== "F" || before.nlink !== 1n || before.size > BigInt(FILE_CEILING)) {
        fail(`final source file is unsafe or mistyped: ${entry.path}`);
      }
      const bytes = await readFile(filename);
      const after = await lstat(filename, { bigint: true });
      if (!sameStable(stable(before), stable(after)) || sha256(bytes) !== entry.digest) {
        fail(`final source file differs from its manifest: ${entry.path}`);
      }
    } else if (before.isSymbolicLink()) {
      if (entry.kind !== "L") fail(`final source symlink is mistyped: ${entry.path}`);
      const target = await readlink(filename, "utf8");
      safeSymlinkTarget(target, entry.path);
      const after = await lstat(filename, { bigint: true });
      if (!sameStable(stable(before), stable(after)) || sha256(Buffer.from(target, "utf8")) !== entry.digest) {
        fail(`final source symlink differs from its manifest: ${entry.path}`);
      }
    } else {
      fail(`final source member is unsupported: ${entry.path}`);
    }
    modeLines.push(`${mode.toString(8).padStart(4, "0")}\t${entry.path}\n`);
  }
  return {
    sourceManifestSha256: sha256(sourceManifestBytes),
    sourceModeManifestSha256: sha256(Buffer.from(modeLines.join(""), "utf8")),
    sourceModeMemberCount: entries.length
  };
}
