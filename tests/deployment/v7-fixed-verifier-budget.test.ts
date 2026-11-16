import { createHash } from "node:crypto";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
// @ts-expect-error Standalone root control has no TypeScript declaration.
import { authorizationSha256, createBudgetPermit, reservationSql, settlementPlan, settlementSql, transitionSql, validatePermitShape, validatePolicyBinding, validateSpendPolicy } from "../../scripts/lib/release-evidence-spend.mjs";
// @ts-expect-error Standalone fixed verifier has no TypeScript declaration.
import { fixedRequestDefinitions, validateBudgetPermit } from "../../scripts/lib/release-evidence-deepseek-verifier.mjs";
// @ts-expect-error Standalone evidence consumer has no TypeScript declaration.
import { validateDeepSeekBudgetReceipt } from "../../ops/bin/verify-release-evidence.mjs";
// @ts-expect-error Standalone root coordinator has no TypeScript declaration.
import { preflightBudgetEnvironment, projectToolOutputSandbox } from "../../scripts/run-release-evidence.mjs";

const exec = promisify(execFile);
const digest = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
type Request = { operation: string; requestSha256: string; reservedMicros: number; reservationId: string; model: string; effort: string; maxTokens: number };
const policyInput = () => ({
  schemaVersion: "release-evidence-spend-policy.v7", runId: "saitu-v7-20261109-formal-00", phase: "formal",
  pgServiceFile: "/etc/resume-ai/ai-spend-ledger.pg_service.conf", pgService: "synthetic_ledger", limitCny: 500, fundedCny: 400,
  authorization: { mainRunId: "synthetic-existing-main", grantVersion: "saitu.v7", policySha256: "a".repeat(64), authorizedEffort: "high",
    effortConditionSha256: "c".repeat(64), callLimit: 4,
    funding: { runId: "saitu-v7-20261109-formal-00", createdAt: "2026-11-09T00:00:00.000123Z", fundingLimitMicros: 500000000, baselineIdsSha256: digest("") } }
});
function permit(state = "launched") {
  const p = createBudgetPermit(validateSpendPolicy(policyInput()), "b".repeat(64), fixedRequestDefinitions("v7-high"));
  p.state = state;
  if (state === "launched") p.claimedAt = new Date().toISOString();
  return p;
}
function event(p: ReturnType<typeof permit>, r: Request, operation: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({ event: "deepseek_preflight", verifier: "release-evidence-deepseek.v7.1", status: "ok", operation,
    permitId: p.permitId, permitSha256: "d".repeat(64), runId: p.runId, authorizationSha256: p.authorizationSha256,
    mainRunId: p.authorization.mainRunId, phase: p.phase, reservationId: r.reservationId, requestSha256: r.requestSha256, ...extra });
}
function successfulLog(p: ReturnType<typeof permit>) {
  return [...["models", "competition_normalize", "competition_followup_policy", "competition_recommend"].map(op => event(p, p.requests[0], op)),
    ...p.requests.flatMap((r: Request) => [event(p, r, "budget_attempt", { attempt: 1, model: "deepseek-flash", reasoningEffort: "high", maxTokens: 8192 }),
      event(p, r, "budget_terminal", { upstreamAttempted: true, usage: { inputTokens: 100, outputTokens: 50, cachedInputTokens: 20 } })])].join("\n");
}
function receipt(p: ReturnType<typeof permit>, log: string) {
  return { schemaVersion: "release-evidence-spend-receipt.v7", source: "protected-psql-shared-ledger", providerInvoice: false,
    verifierSha256: p.verifierSha256, controlSha256: "e".repeat(64), permitSha256: "d".repeat(64), permitId: p.permitId,
    logSha256: digest(log), runId: p.runId, phase: p.phase, priceVersion: p.priceVersion, limitMicros: p.limitMicros, fundedMicros: p.fundedMicros,
    authorization: p.authorization, authorizationSha256: p.authorizationSha256, reservations: settlementPlan(p, log, "d".repeat(64)) };
}

describe("versioned v7 fixed preflight, no provider HTTP", () => {
  it("preserves exact v1 max definitions and independently fixes high body hashes", () => {
    const high = fixedRequestDefinitions("v7-high"), legacy = fixedRequestDefinitions();
    expect(high.map((r: Request) => [r.operation, r.requestSha256, r.reservedMicros])).toEqual([
      ["competition_normalize", "59bae03086f7685d62dd9df47660f4a75f26d246e3798434cdd9c56a7f75c7d6", 68428],
      ["competition_recommend", "df5f5150de1aead558a0f636fcf2635329b0a9dbc1d1ce048ecbaaaacc7a0280", 69308]
    ]);
    for (let i = 0; i < high.length; i++) {
      expect(high[i].body).toEqual({ ...legacy[i].body, reasoning_effort: "high" });
      expect(digest(JSON.stringify(high[i].body))).toBe(high[i].requestSha256);
      expect(legacy[i].body.reasoning_effort).toBe("max");
      expect(high[i].body).not.toHaveProperty("temperature");
    }
    expect(() => fixedRequestDefinitions("high")).toThrow();
  });

  it("accepts an explicitly versioned finite grant above legacy caps without changing v1", () => {
    expect(validateSpendPolicy(policyInput()).fundedMicros).toBe(400000000);
    const legacy = { ...policyInput(), schemaVersion: "release-evidence-spend-policy.v1" };
    delete (legacy as Partial<typeof legacy>).authorization;
    expect(() => validateSpendPolicy(legacy)).toThrow();
    expect(() => validateSpendPolicy({ ...policyInput(), extra: true })).toThrow();
  });

  it.each(["mainRunId", "grantVersion", "policySha256", "authorizedEffort", "effortConditionSha256", "callLimit"])("rejects invalid v7 %s before SQL", field => {
    const p = policyInput();
    Object.assign(p.authorization, { [field]: field === "callLimit" ? Infinity : "invalid'" });
    expect(() => validateSpendPolicy(p)).toThrow();
  });

  it("requires matching protected profile, policy, condition and authorized high caller", () => {
    const p = validateSpendPolicy(policyInput());
    const options = { "--run-id": p.runId, "--phase": p.phase, "--limit-cny": "500", "--funded-cny": "400", "--profile": "v7-high",
      "--authorized-effort": "high", "--policy-sha256": p.authorization.policySha256, "--condition-sha256": p.authorization.effortConditionSha256 };
    expect(() => validatePolicyBinding(options, p)).not.toThrow();
    for (const key of ["--profile", "--authorized-effort", "--policy-sha256", "--condition-sha256", "--run-id", "--phase"])
      expect(() => validatePolicyBinding({ ...options, [key]: "wrong" }, p)).toThrow();
  });

  it("binds policy to reviewed source and refuses legacy/default effort for v7", () => {
    const env = { AI_SPEND_RUN_ID: "saitu-v7-20261109-formal-00", AI_SPEND_PHASE: "formal", AI_SPEND_LIMIT_CNY: "500", AI_SPEND_FUNDED_CNY: "400",
      AI_REASONING_EFFORT: "high", AI_SPEND_AUTHORIZED_EFFORT: "high", AI_SPEND_POLICY_SHA256: "a".repeat(64), AI_SPEND_HIGH_CONDITION_SHA256: "c".repeat(64) };
    expect(preflightBudgetEnvironment(env, true, "a".repeat(64)).profileArguments).toContain("v7-high");
    for (const key of ["AI_REASONING_EFFORT", "AI_SPEND_AUTHORIZED_EFFORT", "AI_SPEND_POLICY_SHA256", "AI_SPEND_HIGH_CONDITION_SHA256", "AI_SPEND_PHASE"])
      expect(() => preflightBudgetEnvironment({ ...env, [key]: "max" }, true, "a".repeat(64))).toThrow();
    expect(() => preflightBudgetEnvironment(env, true, "f".repeat(64))).toThrow();
    expect(() => preflightBudgetEnvironment(env, false)).toThrow();
  });

  it("rejects cross-version, effort, request, funding and canonical authorization changes", () => {
    const p = permit(); expect(validateBudgetPermit(p, p.verifierSha256)).toBe(p);
    for (const patch of [{ schemaVersion: "release-evidence-budget-permit.v1" }, { authorizationSha256: "f".repeat(64) },
      { requests: p.requests.map((r: Request) => ({ ...r, effort: "max" })) }, { requests: p.requests.map((r: Request) => ({ ...r, requestSha256: "a".repeat(64) })) },
      { authorization: { ...p.authorization, funding: { ...p.authorization.funding, fundingLimitMicros: Infinity } } }])
      expect(() => validateBudgetPermit({ ...p, ...patch }, p.verifierSha256)).toThrow();
    const changed = structuredClone(p); changed.authorization.callLimit++; expect(() => validatePermitShape(changed)).toThrow();
    changed.authorizationSha256 = authorizationSha256(changed.authorization);
    expect(transitionSql({ ...changed, state: "prepared" }, "claim")).not.toEqual(transitionSql({ ...p, state: "prepared" }, "claim"));
  });

  it("emits SQL for one common lock, existing authority/grant and UUID funding; never mints budget", () => {
    const sql = reservationSql(permit("prepared"));
    expect(sql).toContain("724310896145225"); expect(sql).toContain("baseline_reservation_ids");
    expect(sql).toContain("phase_calls+2>batch.call_limit"); expect(sql).toContain("fresh+137736");
    expect(sql).toContain("saitu.user-approved-budget-condition.v7");
    expect(sql).not.toMatch(/(?:insert into|update) (?:public\.)?ai_spend_(?:authority|budgets|development_batches)/i);
    expect(sql).not.toContain("30000000"); expect(sql).not.toContain("phase_calls+2>100");
  });

  it("does not double-count held rows on claim or require an active grant to settle/cancel", () => {
    const p = permit("prepared"); expect(transitionSql(p, "claim")).toContain("fresh+0");
    expect(transitionSql(p, "cancel")).not.toContain("batch.state");
    p.state = "launched"; expect(settlementSql(p, settlementPlan(p, "", "d".repeat(64)))).not.toContain("ai_spend_authority");
    expect(() => transitionSql(p, "cancel")).toThrow();
  });

  it("keeps uncertain/foreign/multiple observations fully held and cancels only explicit no-attempt", () => {
    const p = permit(), r = p.requests[0];
    const noAttempt = event(p, r, "budget_terminal", { upstreamAttempted: false, usage: null });
    expect(settlementPlan(p, noAttempt, "d".repeat(64))[0]).toMatchObject({ state: "cancelled", chargedMicros: 0 });
    for (const log of ["", noAttempt + "\n" + noAttempt, noAttempt.replace(p.authorizationSha256, "f".repeat(64)),
      event(p, r, "budget_attempt", { attempt: 1, model: "deepseek-flash", reasoningEffort: "max", maxTokens: 8192 }) + "\n" + noAttempt])
      expect(settlementPlan(p, log, "d".repeat(64))[0]).toMatchObject({ state: "conservative", chargedMicros: r.reservedMicros });
  });

  it("consumer requires high receipt/source policy/exact bodies, rejects version or event substitution", () => {
    const p = permit(), log = successfulLog(p), r = receipt(p, log), gate = { command: { permitSha256: "d".repeat(64) } }, controls = { deepseek: p.verifierSha256, spendControl: "e".repeat(64) };
    const consume = (value = r, bytes = log, policy = "a".repeat(64)) => validateDeepSeekBudgetReceipt(value, gate, controls, Buffer.from(bytes), "v7-high", policy);
    expect(consume()).toBe(true);
    expect(() => validateDeepSeekBudgetReceipt(r, gate, controls, Buffer.from(log))).toThrow();
    for (const patch of [{ schemaVersion: "release-evidence-spend-receipt.v1" }, { authorizationSha256: "f".repeat(64) },
      { reservations: r.reservations.map((row: Request) => ({ ...row, requestSha256: "f".repeat(64) })) }]) expect(() => consume({ ...r, ...patch })).toThrow();
    expect(() => consume(r, log, "f".repeat(64))).toThrow();
    const badLog = log.replaceAll('"reasoningEffort":"high"', '"reasoningEffort":"max"');
    expect(() => consume({ ...r, logSha256: digest(badLog) }, badLog)).toThrow();
  });

  it("actual verifier performs exactly two synthetic high requests, hides key/reasoning and retains failed usage", async () => {
    const directory = await realpath(await mkdtemp(path.join(tmpdir(), "saitu-v7-fixed-http-")));
    try {
      const verifier = path.resolve("scripts/lib/release-evidence-deepseek-verifier.mjs"), p = permit();
      p.verifierSha256 = digest(await readFile(verifier)); const permitFile = path.join(directory, "permit.json");
      await writeFile(permitFile, JSON.stringify(p)); const bootstrap = path.join(directory, "bootstrap.mjs");
      const code = `import fs from 'node:fs/promises';import {syncBuiltinESMExports} from 'node:module';import {pathToFileURL} from 'node:url';const realRead=fs.readFile;fs.readFile=async(file,...args)=>String(file).endsWith('/deepseek-key')?'synthetic-key-never-print':String(file).endsWith('/budget-permit')?realRead(${JSON.stringify(permitFile)}):realRead(file,...args);syncBuiltinESMExports();let calls=0;globalThis.fetch=async(url,options)=>{if(String(url)==='https://api.deepseek.com/models')return new Response(JSON.stringify({data:[{id:'deepseek-flash'}]}));if(String(url)!=='https://api.deepseek.com/chat/completions')throw Error('unknown HTTP forbidden');calls++;const body=JSON.parse(options.body);if(body.reasoning_effort!=='high'||body.thinking.type!=='enabled'||body.max_tokens!==8192||calls>2)throw Error('body differs');const content=calls===1?{mappings:[{fieldId:'skills',status:'unique',values:['programming'],evidenceSpan:'Python'}]}:{recommendations:['algorithm','software','modeling'].map((id,i)=>({competitionId:'preflight-'+id,matchEvidenceRefs:[['profile.skill:programming','profile.output:software','profile.interest:data'][i]],gapEvidenceRefs:['candidate.verify:preflight-'+id],preparationTipRefs:['tip.official:preflight-'+id,'tip.output:preflight-'+id]}))};return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(content),reasoning_content:'SYNTHETIC_REASONING_NEVER_PRINT'}}],usage:{prompt_tokens:100,completion_tokens:50,prompt_cache_hit_tokens:20}}));};process.argv=[process.execPath,${JSON.stringify(verifier)},'/run/credentials/synthetic/deepseek-key','/run/credentials/synthetic/budget-permit','deepseek-flash','deepseek-flash'];await import(pathToFileURL(${JSON.stringify(verifier)}));`;
      await writeFile(bootstrap, code);
      const result = await exec(process.execPath, [bootstrap], { env: { PATH: process.env.PATH ?? "", NODE_ENV: "test" }, maxBuffer: 128000 });
      expect(result.stderr).toBe(""); expect(result.stdout).not.toMatch(/synthetic-key-never-print|SYNTHETIC_REASONING_NEVER_PRINT|reasoning_content/);
      const events = result.stdout.trim().split("\n").map(line => JSON.parse(line));
      expect(events.filter(e => e.operation === "budget_attempt")).toHaveLength(2);
      expect(events.every(e => e.verifier === "release-evidence-deepseek.v7.1" && e.authorizationSha256 === p.authorizationSha256)).toBe(true);
      await writeFile(bootstrap, code.replace("content:JSON.stringify(content)", 'content:calls===1?"not-json":JSON.stringify(content)'));
      const failed = await exec(process.execPath, [bootstrap], { env: { PATH: process.env.PATH ?? "", NODE_ENV: "test" }, maxBuffer: 128000 }).then(() => { throw Error("expected failure"); }, error => error as { code: number; stdout: string });
      expect(failed.code).toBe(1);
      const terminal = failed.stdout.trim().split("\n").map(line => JSON.parse(line)).filter(e => e.operation === "budget_terminal");
      expect(terminal[0]).toMatchObject({ upstreamAttempted: true, usage: { inputTokens: 100, outputTokens: 50, cachedInputTokens: 20 } });
      expect(terminal[1]).toMatchObject({ upstreamAttempted: false, usage: null });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});

describe("unit-only empty artifact output sandbox plan", () => {
  const builder = () => ({ view: "/frozen/source", writable: "/private/writable", mounts: { next: { source: "/private/writable/next", target: "/frozen/source/.next" } },
    unitArtifacts: { source: "/private/unit-artifacts", target: "/frozen/source/artifacts" } });
  it("exposes the additional output only to the fixed unit Vitest gate", () => {
    const b = builder(); expect(projectToolOutputSandbox(b, "unit", "vitest").binds).toContainEqual(b.unitArtifacts);
    expect(projectToolOutputSandbox(b, "unit", "vitest").writablePaths).toEqual([b.writable, b.unitArtifacts.source]);
    expect(() => projectToolOutputSandbox(b, "unit", "next")).toThrow();
    for (const name of ["typecheck", "lint", "production-build", "postgres-integration", "production-e2e", "production-dependency-audit", "source-manifest-before", "source-manifest-after"]) {
      const plan = projectToolOutputSandbox(b, name, "vitest");
      expect(plan.binds).not.toContainEqual(b.unitArtifacts); expect(plan.writablePaths).toEqual([b.writable]); expect(plan.inaccessiblePaths).toEqual(["-/private/unit-artifacts"]);
    }
  });
  it("rejects inherited/common mounts and path substitutions", () => {
    for (const unitArtifacts of [{ source: "/old/artifacts", target: "/frozen/source/artifacts" }, { source: "/private/unit-artifacts", target: "/frozen/source/test-results" }, { source: "/private/writable/../old", target: "/frozen/source/artifacts" }])
      expect(() => projectToolOutputSandbox({ ...builder(), unitArtifacts }, "unit", "vitest")).toThrow();
    const b = builder(); expect(() => projectToolOutputSandbox({ ...b, mounts: { ...b.mounts, inherited: b.unitArtifacts } }, "production-build", "next")).toThrow();
    expect(() => projectToolOutputSandbox({ ...b, mounts: { ...b.mounts, inherited: { source: "/private", target: "/other" } } }, "production-build", "next")).toThrow();
  });
  it("uses a fresh child cwd for synthetic public evidence, preserves real whitelist checks and source exclusion", async () => {
    const directory = await realpath(await mkdtemp(path.join(tmpdir(), "saitu-v7-unit-output-"))), root = process.cwd();
    try {
      const loader = path.join(root, "scripts/lib/load-typescript-source.mjs"), validator = path.join(root, "src/lib/competitions/v6/published-price-evidence.ts");
      const bootstrap = path.join(directory, "probe.mjs");
      const code = `import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {pathToFileURL} from 'node:url';const {installSourceLoader}=await import(pathToFileURL(${JSON.stringify(loader)}));installSourceLoader(${JSON.stringify(root)});const {hasVerifiedPublicPriceCapture}=await import(pathToFileURL(${JSON.stringify(validator)}));globalThis.fetch=()=>{throw Error('HTTP forbidden')};const base='artifacts/continuation-20261105/unit-output-boundary/public-evidence';assert.equal(fs.existsSync('artifacts'),false);fs.mkdirSync(base,{recursive:true});const hash=s=>createHash('sha256').update(s).digest('hex'),raw='synthetic public supplier raw',body='synthetic public supplier text';const rawPath=base+'/raw.html',bodyPath=base+'/body.txt';fs.writeFileSync(rawPath,raw);fs.writeFileSync(bodyPath,body);const source={url:'https://supplier.example.test/public',authority:'supplier',accessStatus:'body_read',integrity:'consistent',locator:'synthetic line',publisher:'synthetic supplier',publicPriceCapture:{sourceArtifact:rawPath,sourceByteSha256:hash(raw),bodyArtifact:bodyPath,bodySha256:hash(body),retrievedAt:'2026-11-05T00:00:00Z'}};const now=new Date('2026-11-09T00:00:00Z');assert.equal(hasVerifiedPublicPriceCapture(source,now),true);for(const sourceArtifact of ['test-results/raw.html','artifacts/continuation-20261105/unit-output-boundary/private/raw.html','artifacts/../raw.html'])assert.equal(hasVerifiedPublicPriceCapture({...source,publicPriceCapture:{...source.publicPriceCapture,sourceArtifact}},now),false);fs.symlinkSync(path.resolve(rawPath),base+'/alias.html');assert.equal(hasVerifiedPublicPriceCapture({...source,publicPriceCapture:{...source.publicPriceCapture,sourceArtifact:base+'/alias.html'}},now),false);fs.writeFileSync(rawPath,raw+'changed');assert.equal(hasVerifiedPublicPriceCapture(source,now),false);fs.writeFileSync('reviewed.txt','synthetic reviewed source\\n');console.log(JSON.stringify({freshEmptyArtifacts:true,realPriceWhitelistAccepted:true,wrongPathPrivateTraversalSymlinkAndHashRejected:true,providerHttp:0}));`;
      await writeFile(bootstrap, code);
      const result = await exec(process.execPath, [bootstrap], { cwd: directory, env: { PATH: process.env.PATH ?? "", NODE_ENV: "test" }, maxBuffer: 64000 });
      expect(JSON.parse(result.stdout)).toMatchObject({ freshEmptyArtifacts: true, realPriceWhitelistAccepted: true, wrongPathPrivateTraversalSymlinkAndHashRejected: true, providerHttp: 0 });
      await exec("/usr/bin/git", ["init", "--quiet", directory]);
      const manifest = await exec("/bin/bash", [path.join(root, "ops/bin/create-release-source-manifest.sh"), directory], { env: { PATH: "/usr/bin:/bin", TMPDIR: tmpdir(), NODE_ENV: "test" }, maxBuffer: 64000 });
      expect(manifest.stdout).toContain("\treviewed.txt");
      expect(manifest.stdout).not.toMatch(/\tartifacts\//);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
