import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

describe("formal producer uses the actual grouped worker", () => {
  it("preserves fsync, bounded finance, original clocks, mixed effort and recovery across 24 offline scenarios", async () => {
    // A separate Node process isolates fsync fault injection and the source loader.
    // The shipped fixture uses no repository artifacts, database or live provider.
    const { stdout, stderr } = await promisify(execFile)(process.execPath, [
      "--test", "--test-reporter=tap", "tests/fixtures/v7-grouped-executor.checks.mjs",
    ], { cwd: process.cwd(), timeout: 45_000, maxBuffer: 2 * 1024 * 1024 });
    expect(stderr).toBe("");
    expect(stdout).toMatch(/^# tests 24$/m);
    expect(stdout).toMatch(/^# pass 24$/m);
    expect(stdout).toMatch(/^# fail 0$/m);
    expect(stdout).toMatch(/^# skipped 0$/m);
    expect(stdout).toMatch(/^# cancelled 0$/m);
  }, 50_000);
});
