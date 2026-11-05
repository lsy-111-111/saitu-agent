#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const fail = (message) => { throw new Error(message); };
const REQUIRED_PLUGIN_VERSION = "0.1.22";

async function file(filename) {
  const metadata = await lstat(filename, { bigint: true });
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1n || metadata.size > 128n * 1024n * 1024n) fail(`unsafe closure input: ${filename}`);
  const bytes = await readFile(filename);
  const after = await lstat(filename, { bigint: true });
  for (const key of ["dev", "ino", "mode", "nlink", "size", "mtimeNs", "ctimeNs"]) {
    if (metadata[key] !== after[key]) fail(`closure input changed while reading: ${filename}`);
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
  const values = {};
  for (let index = 2; index < process.argv.length; index += 2) {
    const key = process.argv[index];
    const value = process.argv[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--") || Object.hasOwn(values, key)) fail("invalid closure exporter arguments");
    values[key] = value;
  }
  const required = ["--raw-verification", "--final-source-manifest", "--output"];
  if (Object.keys(values).some((key) => !required.includes(key)) || required.some((key) => !values[key])) fail("usage: export-deep-scan-finding-closure.mjs --raw-verification ABS --final-source-manifest ABS --output ABS");
  for (const value of Object.values(values)) if (!path.isAbsolute(value)) fail("closure exporter paths must be absolute");
  const raw = await file(values["--raw-verification"]);
  const finalManifest = await file(values["--final-source-manifest"]);
  const receipt = JSON.parse(raw.bytes.toString("utf8"));
  if (
    receipt?.documentType !== "codex-security.verify-fix-result"
    || receipt?.schemaVersion !== "1.0"
    || receipt?.producer?.name !== "codex-security-plugin"
    || receipt?.producer?.version !== REQUIRED_PLUGIN_VERSION
    || typeof receipt?.scanId !== "string"
    || typeof receipt?.findingId !== "string"
    || receipt?.status !== "verified-fixed"
    || receipt?.sourceManifestSha256 !== finalManifest.sha256
  ) fail("raw verification is not an authoritative fixed-finding receipt");
  instant(receipt.verifiedAt, "finding verification time");
  for (const [name, entries] of [["fixEvidence", receipt.fixEvidence], ["verificationEvidence", receipt.verificationEvidence]]) {
    if (!Array.isArray(entries) || entries.length === 0) fail(`raw verification lacks ${name}`);
    for (const entry of entries) {
      const bytes = Buffer.from(entry?.base64 ?? "", "base64");
      if (!/^[a-f0-9]{64}$/u.test(entry?.sha256 ?? "") || sha256(bytes) !== entry.sha256) fail(`raw verification has invalid ${name} bytes`);
      if (name === "verificationEvidence" && entry?.exitCode !== 0) fail("fix verification command did not pass");
    }
  }
  const result = {
    schemaVersion: 1,
    evidenceType: "codex-security-finding-closure",
    producer: "scripts/export-deep-scan-finding-closure.mjs",
    pluginVersion: REQUIRED_PLUGIN_VERSION,
    scanId: receipt.scanId,
    findingId: receipt.findingId,
    status: "verified-fixed",
    verifiedAt: receipt.verifiedAt,
    finalSourceManifestSha256: finalManifest.sha256,
    rawVerification: { sha256: raw.sha256, base64: raw.bytes.toString("base64") }
  };
  await writeFile(values["--output"], `${JSON.stringify(result, null, 2)}\n`, { flag: "wx", mode: 0o600 });
}

main().catch((error) => {
  process.stderr.write(`ERROR: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
