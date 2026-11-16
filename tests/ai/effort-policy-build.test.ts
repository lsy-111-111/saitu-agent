import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import {fileURLToPath} from "node:url";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const vitestRequire = createRequire(require.resolve("vitest/package.json"));
const viteRequire = createRequire(vitestRequire.resolve("vite/package.json"));
const { buildSync } = viteRequire("esbuild") as {
  buildSync: (options: Record<string, unknown>) => { outputFiles: {text:string}[] };
};
const source = readFileSync(new URL("../../src/lib/ai/effort-policy.mjs", import.meta.url), "utf8");
const low = { version: "saitu.effort-policy.v1", rank: "low", explain: "low", review: "low" };
const high = { version: "saitu.effort-policy.v1", rank: "high", explain: "high", review: "high" };
const lowSha = "04962f576d20346af8a8f076ce64fdbda5aea13fdbd2fae39f3c7456fe30aa48";

function runCompiled(policy: unknown, fingerprint: string, expression: string) {
  const { outputFiles } = buildSync({stdin:{contents:source,resolveDir:fileURLToPath(new URL("../../src/lib/ai/",import.meta.url)),sourcefile:"effort-policy.mjs"},bundle:true,write:false,
    format: "esm", platform: "node", target: "node24",
    define: {
      "process.env.SAITU_V7_EFFORT_POLICY": JSON.stringify(JSON.stringify(policy)),
      "process.env.SAITU_V7_EFFORT_POLICY_SHA256": JSON.stringify(fingerprint)
    }
  });
  const code=outputFiles[0].text;
  const url = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  // A fresh process has no runtime policy, spend grant, credentials or DB URL.
  const child = spawnSync(process.execPath, ["--input-type=module", "-e",
    `globalThis.fetch=()=>{throw Error('provider_forbidden')};const m=await import(${JSON.stringify(url)});${expression}`
  ], { env: { NODE_ENV: "test" }, encoding: "utf8", timeout: 10_000 });
  expect(child.status, child.stderr).toBe(0);
  return JSON.parse(child.stdout);
}

describe("compiled decision effort policy", () => {
  it("freezes the configured default even when the runtime environment lacks the policy", () => {
    expect(runCompiled(low, lowSha,
      "console.log(JSON.stringify({policy:m.readConfiguredEffortPolicy(),runtimeValue:process.env.SAITU_V7_EFFORT_POLICY??null}));"
    )).toEqual({ policy: low, runtimeValue: null });
  });

  it("preserves explicit-environment parsing independently of compiled defaults", () => {
    expect(runCompiled(low, lowSha,
      `console.log(JSON.stringify({empty:m.readConfiguredEffortPolicy({}),explicit:m.readConfiguredEffortPolicy({SAITU_V7_EFFORT_POLICY:${JSON.stringify(JSON.stringify(high))}})}));`
    )).toEqual({ empty: low, explicit: high });
  });

  it("rejects mismatched compiled and explicit fingerprints without weakening validation", () => {
    expect(runCompiled(low, "0".repeat(64),
      `let a,b;try{m.readConfiguredEffortPolicy()}catch(e){a=e.message}try{m.readConfiguredEffortPolicy({SAITU_V7_EFFORT_POLICY:${JSON.stringify(JSON.stringify(low))},SAITU_V7_EFFORT_POLICY_SHA256:'wrong'})}catch(e){b=e.message}console.log(JSON.stringify([a,b]));`
    )).toEqual(["decision_effort_policy_hash_mismatch", "decision_effort_policy_hash_mismatch"]);
  });
});
