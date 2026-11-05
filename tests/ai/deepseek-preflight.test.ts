import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

function runPreflight(env: Record<string, string>) {
  return spawnSync(process.execPath, ["scripts/verify-deepseek.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, ...env }
  });
}

describe("DeepSeek production preflight", () => {
  it("skips without network access when AI is explicitly disabled", () => {
    const result = runPreflight({ FEATURE_AI: "0" });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"status":"skipped"');
    expect(result.stdout).toContain('"reason":"feature_disabled"');
  });

  it("rejects an explicit mock provider before any upstream request", () => {
    const result = runPreflight({
      FEATURE_AI: "1",
      AI_PROVIDER: "mock",
      AI_API_KEY: "",
      AI_TEST_MODE: "1",
      ALLOW_AI_MOCK: "1"
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('"status":"failed"');
    expect(result.stderr).toContain("AI_PROVIDER must be deepseek in production");
  });

  it("rejects a missing production API key before checking models", () => {
    const result = runPreflight({
      FEATURE_AI: "1",
      AI_PROVIDER: "deepseek",
      AI_API_KEY: "",
      AI_TEST_MODE: "0",
      ALLOW_AI_MOCK: "0"
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('"status":"failed"');
    expect(result.stderr).toContain("AI_API_KEY is required");
  });

  it.each([
    ["AI_API_URL", "http://127.0.0.1:5432/internal"],
    ["AI_MODELS_URL", "https://attacker.example/models"]
  ])("rejects an unapproved %s before any network request", (name, value) => {
    const result = runPreflight({
      FEATURE_AI: "1",
      AI_PROVIDER: "deepseek",
      AI_API_KEY: "synthetic-key-that-must-not-be-used",
      AI_TEST_MODE: "0",
      ALLOW_AI_MOCK: "0",
      [name]: value
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${name} must use the approved DeepSeek endpoint`);
  });
});
