import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vitestEntry = path.join(repositoryRoot, "node_modules/vitest/vitest.mjs");
const testPath = "tests/competitions/strict-baseline-acceptance.test.ts";
const artifactPath = path.join(
  repositoryRoot,
  "tests/fixtures/competition-score-prospective-baseline.json"
);

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1]?.trim();
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

const releaseId = argument("--release-id");
const sourceArchiveSha256 = argument("--source-archive-sha256");
if (sourceArchiveSha256 && !releaseId) {
  throw new Error("--source-archive-sha256 requires --release-id");
}
if (sourceArchiveSha256 && !/^[a-f0-9]{64}$/.test(sourceArchiveSha256)) {
  throw new Error("--source-archive-sha256 must be a lowercase SHA-256");
}

const result = spawnSync(process.execPath, [vitestEntry, "run", testPath], {
  cwd: repositoryRoot,
  env: {
    ...process.env,
    CAPTURE_COMPETITION_PROSPECTIVE_BASELINE: "1",
    PROSPECTIVE_BASELINE_RELEASE_ID: releaseId ?? "",
    PROSPECTIVE_BASELINE_SOURCE_ARCHIVE_SHA256: sourceArchiveSha256 ?? ""
  },
  stdio: "inherit"
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
if (result.status === 0) {
  const bytes = readFileSync(artifactPath);
  const artifact = JSON.parse(bytes.toString("utf8"));
  process.stdout.write(`${JSON.stringify({
    bundleSidecarSource: "tests/fixtures/competition-score-prospective-baseline.json",
    bundleSidecarPath: artifact.provenance.releaseBindingContract.bundleSidecarPath,
    installPath: artifact.provenance.releaseBindingContract.installPath,
    byteSha256: createHash("sha256").update(bytes).digest("hex"),
    artifactSha256: artifact.artifactSha256
  })}\n`);
}
