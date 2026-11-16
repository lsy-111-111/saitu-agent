import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { decisionEffortPolicySchema } from "../../src/lib/ai/effort-contract";
import { currentDecisionEffortPolicy, withDecisionEffortPolicy } from "../../src/lib/ai/effort-context";
import { effortPolicySha256, parseEffortPolicy } from "../../src/lib/ai/effort-policy.mjs";
import { readFrozenRunEffortPolicyV7 } from "../../src/lib/competitions/v7/store";
// @ts-expect-error The fixed production consumer intentionally has its own parser.
import { parseFixedEffortPolicy } from "../../scripts/lib/release-evidence-deepseek-verifier.mjs";
// @ts-expect-error The existing native helper runs the real PM2 configuration parser without starting PM2.
import { loadProductionEcosystem, productionGrantEnvironment, renderEnvironment } from "../helpers/v7-production-environment.mjs";

const exec = promisify(execFile), root = process.cwd();
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const lowV1 = { version: "saitu.effort-policy.v1", rank: "low", explain: "low", review: "low" };
const nonThinkingV2 = { version: "saitu.effort-policy.v2", rank: "low", explain: "low", review: "low", rankThinking: "disabled", rankTemperature: 0 };
const lowV1Hash = "04962f576d20346af8a8f076ce64fdbda5aea13fdbd2fae39f3c7456fe30aa48";
const nonThinkingV2Hash = "ecd106664dd8656d6a3be9076b8e03f5b32da0c2c5c1c94e2efaf4a2b1da71eb";
const rankModelSettings = { thinking: "disabled", policyReasoningEffort: "low", wireReasoningEffort: null, temperature: 0, topP: 1 };
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });

async function fixture(policy: Record<string, unknown> = nonThinkingV2) {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "saitu-v7-local-worker-C-")));
  directories.push(directory);
  const releaseRoot = path.join(directory, "20261110T000000Z"), sourceSha256 = "a".repeat(64), worker = "// synthetic worker; never executed\n";
  const put = async (relative: string, value: unknown) => {
    const filename = path.join(releaseRoot, relative);
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, typeof value === "string" ? value : JSON.stringify(value));
  };
  const fingerprint = sha(JSON.stringify(policy));
  const metadata = policy.version === "saitu.effort-policy.v2" ? { rankModelSettings } : {};
  const binding = { schemaVersion: "saitu.next-worker-binding.v7", sourceSha256, workerArtifactSha256: sha(worker), nextBuildId: "local-synthetic", effortPolicy: policy, effortPolicySha256: fingerprint, ...metadata, detailLayout: "single", executionMode: "user-unbounded" };
  const manifest = { schemaVersion: "saitu.worker-build.v7", sourceSha256, artifactSha256: sha(worker), nodeMajor: 24, inputs: ["synthetic.ts"], nextBuildId: binding.nextBuildId, nextBindingSha256: sha(JSON.stringify(binding)), effortPolicy: policy, effortPolicySha256: fingerprint, ...metadata, detailLayout: "single", executionMode: "user-unbounded" };
  const config = { env: { SAITU_V7_SOURCE_SHA256: sourceSha256, SAITU_V7_EFFORT_POLICY: JSON.stringify(policy), SAITU_V7_EFFORT_POLICY_SHA256: fingerprint, SAITU_V7_DETAIL_LAYOUT: "single", SAITU_AI_EXECUTION_MODE: "user-unbounded" } };
  await put("dist/decision-worker/worker.mjs", worker);
  await put("dist/decision-worker/manifest.json", manifest);
  await put(".next/decision-worker-binding.json", binding);
  await put(".next/BUILD_ID", binding.nextBuildId);
  await put(".next/required-server-files.json", { config });
  for (const filename of ["src/lib/ai/effort-policy.mjs", "src/lib/ai/execution-policy.mjs", "src/lib/competitions/v7/detail-layout.mjs", "scripts/competitions/v7/worker-entry.ts"]) await put(filename, "// configuration-only capability marker\n");
  return { directory, releaseRoot, manifest, binding, config, put };
}
const verify = (releaseRoot: string, ...options: string[]) => exec(process.execPath, [path.join(root, "ops/bin/verify-decision-worker-build.mjs"), releaseRoot, ...options]);

describe("local v2 worker binding without production authorization", () => {
  it("checks all six v2 fields only with the explicit local flag", async () => {
    const { releaseRoot } = await fixture();
    const local = JSON.parse((await verify(releaseRoot, "--local-development")).stdout);
    expect(local).toMatchObject({ status: "passed", effortPolicySha256: nonThinkingV2Hash, localDevelopment: true });
    await expect(verify(releaseRoot, "--worker-only", "--local-development")).resolves.toBeDefined();
    for (const options of [[], ["--worker-only"]]) await expect(verify(releaseRoot, ...options)).rejects.toMatchObject({ stderr: expect.stringContaining("V7_WORKER_EFFORT_POLICY_LOCAL_ONLY") });
  });

  it("rejects missing, altered or extra v2 settings rather than filling them", async () => {
    const { rankTemperature: omitted, ...missingTemperature } = nonThinkingV2;
    expect(omitted).toBe(0);
    for (const policy of [missingTemperature, { ...nonThinkingV2, rankThinking: "enabled" }, { ...nonThinkingV2, rankTemperature: 1 }, { ...nonThinkingV2, explain: "high" }, { ...nonThinkingV2, extra: true }]) {
      const { releaseRoot } = await fixture(policy);
      await expect(verify(releaseRoot, "--local-development")).rejects.toMatchObject({ stderr: expect.stringContaining("V7_WORKER_EFFORT_POLICY_REQUIRED") });
    }
    const changed = await fixture();
    await changed.put("dist/decision-worker/manifest.json", { ...changed.manifest, effortPolicySha256: lowV1Hash });
    await expect(verify(changed.releaseRoot, "--worker-only", "--local-development")).rejects.toMatchObject({ stderr: expect.stringContaining("V7_WORKER_EFFORT_POLICY_MISMATCH") });
    const wrongWire = await fixture();
    await wrongWire.put("dist/decision-worker/manifest.json", { ...wrongWire.manifest, rankModelSettings: { ...rankModelSettings, wireReasoningEffort: "low" } });
    await expect(verify(wrongWire.releaseRoot, "--worker-only", "--local-development")).rejects.toMatchObject({ stderr: expect.stringContaining("V7_WORKER_RANK_MODEL_SETTINGS_MISMATCH") });
  });

  it("rejects field loss or substitution in paired Next configuration and bindings", async () => {
    for (const replace of ["next-policy", "next-hash", "binding-policy"] as const) {
      const value = await fixture();
      if (replace === "binding-policy") {
        const binding = { ...value.binding, effortPolicy: lowV1 };
        await value.put(".next/decision-worker-binding.json", binding);
        await value.put("dist/decision-worker/manifest.json", { ...value.manifest, nextBindingSha256: sha(JSON.stringify(binding)) });
      } else {
        await value.put(".next/required-server-files.json", { config: { env: { ...value.config.env, ...(replace === "next-policy" ? { SAITU_V7_EFFORT_POLICY: JSON.stringify(lowV1) } : { SAITU_V7_EFFORT_POLICY_SHA256: lowV1Hash }) } } });
      }
      await expect(verify(value.releaseRoot, "--local-development")).rejects.toMatchObject({ stderr: expect.stringContaining("V7_NEXT_WORKER_EFFORT_MISMATCH") });
    }
    const value = await fixture(), binding = { ...value.binding, rankModelSettings: { ...rankModelSettings, thinking: "enabled" } };
    await value.put(".next/decision-worker-binding.json", binding);
    await value.put("dist/decision-worker/manifest.json", { ...value.manifest, nextBindingSha256: sha(JSON.stringify(binding)) });
    await expect(verify(value.releaseRoot, "--local-development")).rejects.toMatchObject({ stderr: expect.stringContaining("V7_NEXT_WORKER_RANK_MODEL_SETTINGS_MISMATCH") });
  });

  it("retains the original v1 serialization and default verifier behavior", async () => {
    const policy = parseEffortPolicy(lowV1);
    expect(JSON.stringify(policy)).toBe('{"version":"saitu.effort-policy.v1","rank":"low","explain":"low","review":"low"}');
    expect(effortPolicySha256(policy)).toBe(lowV1Hash);
    const { releaseRoot } = await fixture(lowV1);
    const verified = JSON.parse((await verify(releaseRoot)).stdout);
    expect(verified.effortPolicySha256).toBe(lowV1Hash);
    expect(verified).not.toHaveProperty("localDevelopment");
  });

  it("round-trips complete frozen run and API policies without upgrading old v1 records", () => {
    for (const raw of [lowV1, nonThinkingV2]) {
      const policy = parseEffortPolicy(raw), fingerprint = effortPolicySha256(policy);
      const saved = JSON.parse(JSON.stringify({ effortPolicy: policy, effortPolicySha256: fingerprint }));
      expect(readFrozenRunEffortPolicyV7(saved)).toEqual(raw);
      expect(decisionEffortPolicySchema.parse(saved.effortPolicy)).toEqual(raw);
      expect(withDecisionEffortPolicy(policy, currentDecisionEffortPolicy)).toEqual(raw);
      expect(Object.keys(saved.effortPolicy)).toEqual(Object.keys(raw));
      expect(() => readFrozenRunEffortPolicyV7({ ...saved, effortPolicySha256: "0".repeat(64) })).toThrow("DECISION_EFFORT_POLICY_CHANGED");
    }
  });

  it("binds the complete v2 policy into Next configuration without building Next", async () => {
    const script = "const m=await import(process.argv[1]);const c=m.default('phase-production-build');process.stdout.write(JSON.stringify(c.env));";
    const result = await exec(process.execPath, ["--input-type=module", "-e", script, path.join(root, "next.config.mjs")], { env: { NODE_ENV: "test", SAITU_V7_SOURCE_SHA256: "a".repeat(64), SAITU_V7_EFFORT_POLICY: JSON.stringify(nonThinkingV2), SAITU_V7_EFFORT_POLICY_SHA256: nonThinkingV2Hash, SAITU_V7_DETAIL_LAYOUT: "single", SAITU_AI_EXECUTION_MODE: "user-unbounded" } });
    expect(JSON.parse(result.stdout)).toMatchObject({ SAITU_V7_EFFORT_POLICY: JSON.stringify(nonThinkingV2), SAITU_V7_EFFORT_POLICY_SHA256: nonThinkingV2Hash, SAITU_V7_SOURCE_SHA256: "a".repeat(64) });
  });

  it("keeps PM2 and signed-release policy parsers closed to v2", async () => {
    expect(() => parseFixedEffortPolicy(nonThinkingV2)).toThrow();
    const value = await fixture(), appEnvFile = path.join(value.directory, "app.env"), quotaEnvFile = path.join(value.directory, "quota.env");
    const app = { ...productionGrantEnvironment({ databaseUrl: "postgresql://synthetic:fixture@127.0.0.1/never_connected", runId: "saitu-v7-effort-20261109-formal-00", policySha256: "a".repeat(64), conditionSha256: "b".repeat(64) }), AI_SPEND_AUTHORIZED_EFFORT: "stage", AI_SPEND_HIGH_CONDITION_SHA256: "", AI_SPEND_EFFORT_CONDITION_SHA256: "b".repeat(64), SAITU_V7_EFFORT_POLICY: JSON.stringify(nonThinkingV2), SAITU_V7_EFFORT_POLICY_SHA256: nonThinkingV2Hash };
    await writeFile(appEnvFile, renderEnvironment(app), { mode: 0o640 });
    await writeFile(quotaEnvFile, await readFile(path.join(root, "ops/generated/application-quota.env")), { mode: 0o640 });
    expect(() => loadProductionEcosystem({ root, releaseDirectory: value.releaseRoot, appEnvFile, quotaEnvFile })).toThrow("Explicit stage effort policy required");
  });
});
