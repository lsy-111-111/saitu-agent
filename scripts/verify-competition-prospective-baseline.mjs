import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vitestEntry = path.join(repositoryRoot, "node_modules/vitest/vitest.mjs");
const result = spawnSync(process.execPath, [
  vitestEntry,
  "run",
  "tests/competitions/strict-baseline-acceptance.test.ts"
], {
  cwd: repositoryRoot,
  env: {
    ...process.env,
    CAPTURE_COMPETITION_PROSPECTIVE_BASELINE: "0"
  },
  stdio: "inherit"
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
