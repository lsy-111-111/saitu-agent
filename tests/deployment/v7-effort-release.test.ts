import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { effortPolicySha256, parseEffortPolicy } from "../../src/lib/ai/effort-policy.mjs";
// @ts-expect-error Fixed root controls intentionally remain standalone JavaScript.
import { authorizationSha256, createBudgetPermit, fixedEffortPolicySha256 as spendHash, parseFixedEffortPolicy as spendParse, reservationSql, settlementPlan, settlementSql, transitionSql, validatePolicyBinding, validateSpendPolicy } from "../../scripts/lib/release-evidence-spend.mjs";
// @ts-expect-error Fixed root controls intentionally remain standalone JavaScript.
import { fixedEffortPolicySha256 as verifierHash, fixedRequestDefinitions, parseFixedEffortPolicy as verifierParse, validateBudgetPermit } from "../../scripts/lib/release-evidence-deepseek-verifier.mjs";
// @ts-expect-error Fixed root controls intentionally remain standalone JavaScript.
import { preflightBudgetEnvironment, productionBrowserBinding, releaseEffortPolicySha256 } from "../../scripts/run-release-evidence.mjs";
// @ts-expect-error Independent fixed consumer intentionally remains standalone JavaScript.
import { effortPolicyHash, validateDeepSeekBudgetReceipt } from "../../ops/bin/verify-release-evidence.mjs";
// @ts-expect-error Pure delivery control intentionally remains standalone JavaScript.
import { verifyExecutionBuildBinding, verifyWorkerBuildArtifacts } from "../../scripts/lib/release-evidence-v6-contract.mjs";

const exec = promisify(execFile);
const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const policy = (rank: "high" | "low" = "low") => parseEffortPolicy({ version: "saitu.effort-policy.v1", rank, explain: "low", review: "high" });
type Request = { operation: string; reservationId: string; requestSha256: string; effort: string; reservedMicros: number };
const protectedPolicy = (top5 = false, unbounded = false) => ({ schemaVersion: unbounded ? "release-evidence-spend-policy.v7.top5.user-unbounded.v1" : top5 ? "release-evidence-spend-policy.v7.top5.v1" : "release-evidence-spend-policy.v7.effort.v1", runId: `saitu-v7-${unbounded ? "top5-unbounded" : top5 ? "top5" : "effort"}-20261109-formal-00`, phase: "formal",
  pgServiceFile: "/etc/resume-ai/ai-spend-ledger.pg_service.conf", pgService: "synthetic_ledger", limitCny: unbounded ? null : 1, fundedCny: 1, ...(unbounded ? {executionMode:"user-unbounded"} : {}),
  authorization: { mainRunId: "synthetic-existing-main", grantVersion: unbounded ? "saitu.v7.top5.user-unbounded.v1" : top5 ? "saitu.v7.top5.v1" : "saitu.v7.effort.v1", policySha256: "a".repeat(64), authorizedEffort: "stage",
    effortConditionSha256: "c".repeat(64), effortPolicy: top5 ? parseEffortPolicy({...policy(),review:"low"}) : policy(), effortPolicySha256: effortPolicySha256(top5 ? {...policy(),review:"low"} : policy()), callLimit: unbounded ? null : 2, ...(unbounded ? {executionMode:"user-unbounded"} : {}),
    funding: { runId: "saitu-v7-effort-20261109-formal-00", createdAt: "2026-11-09T00:00:00.000123Z", fundingLimitMicros: 1000000, baselineIdsSha256: sha("") } } });
function permit(state = "launched", top5 = false, unbounded = false) {
  const configured = protectedPolicy(top5,unbounded);
  const value = createBudgetPermit(validateSpendPolicy(configured), "b".repeat(64), fixedRequestDefinitions(unbounded ? "v7-top5-user-unbounded" : top5 ? "v7-top5" : "v7-effort", configured.authorization.effortPolicy));
  value.state = state; if (state === "launched") value.claimedAt = new Date().toISOString();
  return value;
}
function event(p: ReturnType<typeof permit>, r: Request, operation: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({ event: "deepseek_preflight", verifier: p.authorization.grantVersion === "saitu.v7.top5.user-unbounded.v1" ? "release-evidence-deepseek.v7.top5.user-unbounded.v1" : p.authorization.grantVersion === "saitu.v7.top5.v1" ? "release-evidence-deepseek.v7.top5.v1" : "release-evidence-deepseek.v7.effort.v1", status: "ok", operation,
    permitId: p.permitId, permitSha256: "d".repeat(64), runId: p.runId, authorizationSha256: p.authorizationSha256,
    mainRunId: p.authorization.mainRunId, phase: p.phase, ...(p.authorization.executionMode?{executionMode:p.authorization.executionMode}:{}), reservationId: r.reservationId, requestSha256: r.requestSha256, ...extra });
}
function log(p: ReturnType<typeof permit>) {
  return [...["models", "competition_normalize", "competition_followup_policy", "competition_recommend"].map(op => event(p, p.requests[0], op)),
    ...p.requests.flatMap((r: Request) => [event(p, r, "budget_attempt", { attempt: 1, model: "deepseek-flash", reasoningEffort: r.effort, maxTokens: 8192 }),
      event(p, r, "budget_terminal", { upstreamAttempted: true, usage: { inputTokens: 100, outputTokens: 50, cachedInputTokens: 20 } })])].join("\n");
}
function receipt(p: ReturnType<typeof permit>, bytes: string) {
  return { schemaVersion: p.authorization.grantVersion === "saitu.v7.top5.user-unbounded.v1" ? "release-evidence-spend-receipt.v7.top5.user-unbounded.v1" : p.authorization.grantVersion === "saitu.v7.top5.v1" ? "release-evidence-spend-receipt.v7.top5.v1" : "release-evidence-spend-receipt.v7.effort.v1", source: "protected-psql-shared-ledger", providerInvoice: false,
    verifierSha256: p.verifierSha256, controlSha256: "e".repeat(64), permitSha256: "d".repeat(64), permitId: p.permitId, logSha256: sha(bytes),
    ...(p.authorization.executionMode?{executionMode:p.authorization.executionMode}:{}), runId: p.runId, phase: p.phase, priceVersion: p.priceVersion, limitMicros: p.limitMicros, fundedMicros: p.fundedMicros,
    authorization: p.authorization, authorizationSha256: p.authorizationSha256, reservations: settlementPlan(p, bytes, "d".repeat(64)) };
}
const roots: string[] = [];
function directory() { const value = realpathSync(mkdtempSync(path.join(tmpdir(), "saitu-effort-release-"))); roots.push(value); return value; }
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("stage effort release contract without live services", () => {
  it("requires explicit user-unbounded authorization and null artificial caps while retaining physical funding", () => {
    const raw=protectedPolicy(true,true),configured=validateSpendPolicy(raw),p=permit("launched",true,true);
    expect(configured.limitMicros).toBeNull();expect(p.authorization.callLimit).toBeNull();expect(p.fundedMicros).toBe(1_000_000);
    expect(validateBudgetPermit(p,p.verifierSha256)).toBe(p);
    const options={"--run-id":raw.runId,"--phase":"formal","--profile":"v7-top5-user-unbounded","--authorized-effort":"stage","--policy-sha256":raw.authorization.policySha256,"--condition-sha256":raw.authorization.effortConditionSha256,"--effort-policy":JSON.stringify(raw.authorization.effortPolicy),"--effort-policy-sha256":raw.authorization.effortPolicySha256,"--limit-cny":"0","--funded-cny":"0"};
    expect(()=>validatePolicyBinding(options,configured)).not.toThrow();
    for(const value of [{...raw,limitCny:9_000_000},{...raw,executionMode:"finite"},{...raw,authorization:{...raw.authorization,callLimit:1}},{...raw,runId:"saitu-v7-top5-20261109-formal-00"}])expect(()=>validateSpendPolicy(value)).toThrow();
    const sql=reservationSql(permit("prepared",true,true));
    for(const value of ["saitu.v7.top5.user-unbounded.v1","docs/v7/top5-unbounded-execution-contract-20261109.md","batch.call_limit is not null","execution_mode='user-unbounded'","v7_fresh_funding_exhausted","baseline_reservation_ids"])expect(sql).toContain(value);
    expect(sql).not.toContain("phase_calls+2>batch.call_limit");
    const env={SAITU_AI_EXECUTION_MODE:"user-unbounded",AI_SPEND_RUN_ID:raw.runId,AI_SPEND_PHASE:"formal",AI_SPEND_LIMIT_CNY:"0",AI_SPEND_FUNDED_CNY:"0",AI_REASONING_EFFORT:"high",AI_SPEND_AUTHORIZED_EFFORT:"stage",AI_SPEND_POLICY_SHA256:raw.authorization.policySha256,AI_SPEND_EFFORT_CONDITION_SHA256:raw.authorization.effortConditionSha256,SAITU_V7_EFFORT_POLICY:JSON.stringify(raw.authorization.effortPolicy),SAITU_V7_EFFORT_POLICY_SHA256:raw.authorization.effortPolicySha256};
    const control=preflightBudgetEnvironment(env,true,raw.authorization.policySha256,true,true,true);
    expect(control.spendLimitCny).toBe("unbounded");expect(control.spendFundedCny).toBe("physical");
    expect(control.profileArguments).toContain("v7-top5-user-unbounded");
    expect(()=>preflightBudgetEnvironment({...env,SAITU_AI_EXECUTION_MODE:"finite"},true,raw.authorization.policySha256,true,true,true)).toThrow();
  });

  it("binds unbounded mode across compiled artifacts and original receipts without changing unknown settlement", () => {
    const p=permit("launched",true,true),bytes=log(p),r=receipt(p,bytes),gate={command:{permitSha256:"d".repeat(64)}},controls={deepseek:p.verifierSha256,spendControl:"e".repeat(64)};
    expect(validateDeepSeekBudgetReceipt(r,gate,controls,Buffer.from(bytes),"v7-top5-user-unbounded",p.authorization.policySha256,p.authorization.effortPolicySha256)).toBe(true);
    expect(()=>validateDeepSeekBudgetReceipt({...r,executionMode:"finite"},gate,controls,Buffer.from(bytes),"v7-top5-user-unbounded",p.authorization.policySha256,p.authorization.effortPolicySha256)).toThrow();
    expect(settlementPlan(p,"","d".repeat(64)).every((row:{state:string})=>row.state==="conservative")).toBe(true);
    expect(settlementSql(p,settlementPlan(p,"","d".repeat(64)))).not.toContain("ai_spend_development_batches");
    expect(verifyExecutionBuildBinding({executionMode:"user-unbounded"},{executionMode:"user-unbounded"},{env:{SAITU_AI_EXECUTION_MODE:"user-unbounded"}},true)).toBe("user-unbounded");
    for(const [manifest,binding,config] of [[{},{executionMode:"user-unbounded"},{env:{SAITU_AI_EXECUTION_MODE:"user-unbounded"}}],[{executionMode:"user-unbounded"},{},{env:{SAITU_AI_EXECUTION_MODE:"user-unbounded"}}],[{executionMode:"user-unbounded"},{executionMode:"user-unbounded"},{env:{}}]])expect(()=>verifyExecutionBuildBinding(manifest,binding,config,true)).toThrow();
    expect(()=>verifyExecutionBuildBinding({},{},{env:{}},false)).not.toThrow();
    expect(()=>verifyExecutionBuildBinding({},{},{env:{}},true)).toThrow();
  });

  it("requires the Top5 namespace and LLL at protected policy, coordinator, permit and receipt boundaries", () => {
    const configured = protectedPolicy(true), p = permit("launched", true);
    expect(validateBudgetPermit(p, p.verifierSha256)).toBe(p);
    expect(p.schemaVersion).toBe("release-evidence-budget-permit.v7.top5.v1");
    expect(p.requests.map((r: Request) => r.effort)).toEqual(["high", "low"]);
    for (const patch of [
      {runId:"saitu-v7-effort-20261109-formal-00"},
      {schemaVersion:"release-evidence-spend-policy.v7.effort.v1"},
      {authorization:{...configured.authorization,grantVersion:"saitu.v7.effort.v1"}}
    ]) expect(() => validateSpendPolicy({...configured,...patch})).toThrow();
    for(const key of ["rank","explain","review"] as const){
      const changed=structuredClone(configured); changed.authorization.effortPolicy={...changed.authorization.effortPolicy,[key]:"high"};
      changed.authorization.effortPolicySha256=effortPolicySha256(changed.authorization.effortPolicy);
      expect(() => validateSpendPolicy(changed)).toThrow(/low\/low\/low/);
      expect(() => fixedRequestDefinitions("v7-top5",changed.authorization.effortPolicy)).toThrow(/low\/low\/low/);
    }
    const effort=p.authorization.effortPolicy, fingerprint=p.authorization.effortPolicySha256;
    const env={AI_SPEND_RUN_ID:p.runId,AI_SPEND_PHASE:p.phase,AI_SPEND_LIMIT_CNY:"1",AI_SPEND_FUNDED_CNY:"1",AI_REASONING_EFFORT:"high",AI_SPEND_AUTHORIZED_EFFORT:"stage",AI_SPEND_POLICY_SHA256:p.authorization.policySha256,AI_SPEND_EFFORT_CONDITION_SHA256:p.authorization.effortConditionSha256,SAITU_V7_EFFORT_POLICY:JSON.stringify(effort),SAITU_V7_EFFORT_POLICY_SHA256:fingerprint};
    expect(preflightBudgetEnvironment(env,true,p.authorization.policySha256,true,true).profileArguments).toContain("v7-top5");
    expect(() => preflightBudgetEnvironment({...env,AI_SPEND_RUN_ID:"saitu-v7-effort-20261109-formal-00"},true,p.authorization.policySha256,true,true)).toThrow();
    const bytes=log(p),r=receipt(p,bytes),gate={command:{permitSha256:"d".repeat(64)}},controls={deepseek:p.verifierSha256,spendControl:"e".repeat(64)};
    expect(validateDeepSeekBudgetReceipt(r,gate,controls,Buffer.from(bytes),"v7-top5",p.authorization.policySha256,fingerprint)).toBe(true);
    expect(() => validateDeepSeekBudgetReceipt(r,gate,controls,Buffer.from(bytes),"v7-effort",p.authorization.policySha256,fingerprint)).toThrow();
    expect(() => validateBudgetPermit({...p,schemaVersion:"release-evidence-budget-permit.v7.effort.v1"},p.verifierSha256)).toThrow();
  });

  it("binds Top5 reservation to its exact authorization while retaining unknown and closed-grant settlement", () => {
    const p=permit("prepared",true),sql=reservationSql(p);
    for(const value of ["saitu.v7.top5.v1","saitu.user-approved-budget-condition.v7.top5.v1","user-approved-20261109-top5-continuation","docs/v7/top5-continuation-contract-20261109.md","saitu.policy.2026-11-09.v7.top5","saitu.async.2026-11-09.v7.3.top5","724310896145225","phase_calls+2>batch.call_limit"]) expect(sql).toContain(value);
    expect(sql).not.toMatch(/(?:insert into|update) (?:public\.)?ai_spend_(?:authority|budgets|development_batches)/i);
    p.state="launched";
    const unknown=settlementPlan(p,"","d".repeat(64));
    expect(unknown.every((r: {state:string;chargedMicros:number;reservedMicros:number})=>r.state==="conservative"&&r.chargedMicros===r.reservedMicros)).toBe(true);
    expect(settlementSql(p,unknown)).not.toContain("ai_spend_development_batches");
    expect(transitionSql(permit("prepared",true),"cancel")).not.toContain("batch.state");
  });

  it("matches the product fingerprint for all eight policies and fixes normalization to high", () => {
    for (const rank of ["high", "low"]) for (const explain of ["high", "low"]) for (const review of ["high", "low"]) {
      const input = { review, explain, rank, version: "saitu.effort-policy.v1" }, expected = effortPolicySha256(parseEffortPolicy(input));
      for (const hash of [spendHash, verifierHash, releaseEffortPolicySha256, effortPolicyHash]) expect(hash(input)).toBe(expected);
      const definitions = fixedRequestDefinitions("v7-effort", input);
      expect(definitions.map((r: { body: { reasoning_effort: string } }) => r.body.reasoning_effort)).toEqual(["high", rank]);
      expect(definitions.every((r: { body: { thinking: { type: string }; max_tokens: number } }) => r.body.thinking.type === "enabled" && r.body.max_tokens === 8192)).toBe(true);
    }
    for (const parse of [parseEffortPolicy, spendParse, verifierParse]) {
      for (const invalid of [{ ...policy(), extra: true }, { ...policy(), rank: "max" }, { ...policy(), version: "wrong" }, { rank: "low" }, null]) expect(() => parse(invalid)).toThrow();
    }
  });

  it("preserves old high and max request identities and rejects permit version substitution", () => {
    expect(fixedRequestDefinitions("v7-high").map((r: { requestSha256: string }) => r.requestSha256)).toEqual([
      "59bae03086f7685d62dd9df47660f4a75f26d246e3798434cdd9c56a7f75c7d6", "df5f5150de1aead558a0f636fcf2635329b0a9dbc1d1ce048ecbaaaacc7a0280"]);
    expect(fixedRequestDefinitions().every((r: { body: { reasoning_effort: string } }) => r.body.reasoning_effort === "max")).toBe(true);
    const p = permit(); expect(validateBudgetPermit(p, p.verifierSha256)).toBe(p);
    for (const schemaVersion of ["release-evidence-budget-permit.v7", "release-evidence-budget-permit.v1"]) expect(() => validateBudgetPermit({ ...p, schemaVersion }, p.verifierSha256)).toThrow();
    expect(p.requests.map((r: Request) => r.effort)).toEqual(["high", "low"]);
  });

  it("requires a separate stage grant namespace and exact protected policy and condition", () => {
    const raw = protectedPolicy(), p = validateSpendPolicy(raw), options = { "--run-id": p.runId, "--phase": p.phase, "--limit-cny": "1", "--funded-cny": "1",
      "--profile": "v7-effort", "--authorized-effort": "stage", "--policy-sha256": p.authorization.policySha256, "--condition-sha256": p.authorization.effortConditionSha256,
      "--effort-policy": JSON.stringify(p.authorization.effortPolicy), "--effort-policy-sha256": p.authorization.effortPolicySha256 };
    expect(() => validatePolicyBinding(options, p)).not.toThrow();
    for (const key of ["--profile", "--authorized-effort", "--policy-sha256", "--condition-sha256", "--effort-policy", "--effort-policy-sha256"]) expect(() => validatePolicyBinding({ ...options, [key]: "invalid" }, p)).toThrow();
    for (const patch of [{ runId: "saitu-v7-20261109-formal-00" }, { schemaVersion: "release-evidence-spend-policy.v7" }, { authorization: { ...raw.authorization, grantVersion: "saitu.v7" } }, { authorization: { ...raw.authorization, effortPolicySha256: "f".repeat(64) } }]) expect(() => validateSpendPolicy({ ...raw, ...patch })).toThrow();
  });

  it("requires the explicit source authorization and fingerprint at the coordinator boundary", () => {
    const env = { AI_SPEND_RUN_ID: "saitu-v7-effort-20261109-formal-00", AI_SPEND_PHASE: "formal", AI_SPEND_LIMIT_CNY: "1", AI_SPEND_FUNDED_CNY: "1",
      AI_REASONING_EFFORT: "high", AI_SPEND_AUTHORIZED_EFFORT: "stage", AI_SPEND_POLICY_SHA256: "a".repeat(64), AI_SPEND_EFFORT_CONDITION_SHA256: "c".repeat(64),
      SAITU_V7_EFFORT_POLICY: JSON.stringify(policy()), SAITU_V7_EFFORT_POLICY_SHA256: effortPolicySha256(policy()) };
    expect(preflightBudgetEnvironment(env, true, "a".repeat(64), true).profileArguments).toContain("v7-effort");
    for (const key of Object.keys(env)) expect(() => preflightBudgetEnvironment({ ...env, [key]: "invalid" }, true, "a".repeat(64), true)).toThrow();
    expect(() => preflightBudgetEnvironment(env, true, "f".repeat(64), true)).toThrow();
    expect(() => preflightBudgetEnvironment(env, true, "a".repeat(64), false)).toThrow();
    expect(() => preflightBudgetEnvironment({ ...env, AI_SPEND_HIGH_CONDITION_SHA256: "c".repeat(64) }, true, "a".repeat(64), true)).toThrow();
    const worker = { sourceSha256: "b".repeat(64), effortPolicy: policy(), effortPolicySha256: effortPolicySha256(policy()) };
    const configured = preflightBudgetEnvironment(env, true, "a".repeat(64), true).effortEnvironment;
    expect(productionBrowserBinding(worker, configured)).toEqual({ ...configured, SAITU_V7_SOURCE_SHA256: worker.sourceSha256 });
    expect(() => productionBrowserBinding({ ...worker, sourceSha256: "invalid" }, configured)).toThrow();
    expect(() => productionBrowserBinding(worker, { ...configured, SAITU_V7_SOURCE_SHA256: "f".repeat(64) })).toThrow();
    expect(() => productionBrowserBinding({ ...worker, effortPolicySha256: "f".repeat(64) }, configured)).toThrow();
  });

  it("binds SQL to the existing authority, stage policy and common finite budget lock", () => {
    const p = permit("prepared"), sql = reservationSql(p);
    for (const required of ["724310896145225", "saitu.v7.effort.v1", "saitu.user-approved-budget-condition.v7.effort.v1", "effort_policy_sha256", "baseline_reservation_ids", "phase_calls+2>batch.call_limit", "fresh+137736", "'high'", "'low'"]) expect(sql).toContain(required);
    expect(sql).not.toMatch(/(?:insert into|update) (?:public\.)?ai_spend_(?:authority|budgets|development_batches)/i);
    expect(transitionSql(p, "claim")).toContain("fresh+0");
    const changed = structuredClone(p); changed.authorization.effortPolicy.rank = "high"; changed.authorization.effortPolicySha256 = effortPolicySha256(changed.authorization.effortPolicy); changed.authorizationSha256 = authorizationSha256(changed.authorization);
    expect(() => reservationSql(changed)).toThrow();
  });

  it("holds unknown or foreign effort observations and preserves settlement after grant closure", () => {
    const p = permit(), r = p.requests[1], noAttempt = event(p, r, "budget_terminal", { upstreamAttempted: false, usage: null });
    expect(settlementPlan(p, noAttempt, "d".repeat(64))[1]).toMatchObject({ state: "cancelled", chargedMicros: 0 });
    for (const bytes of ["", log(p).replaceAll(p.authorizationSha256, "f".repeat(64)), log(p).replace('"reasoningEffort":"low"', '"reasoningEffort":"high"')]) expect(settlementPlan(p, bytes, "d".repeat(64))[1]).toMatchObject({ state: "conservative", chargedMicros: r.reservedMicros });
    expect(settlementSql(p, settlementPlan(p, "", "d".repeat(64)))).not.toContain("ai_spend_development_batches");
    expect(transitionSql(permit("prepared"), "cancel")).not.toContain("batch.state");
  });

  it("requires the signed runtime policy when consuming stage receipts and rejects event substitutions", () => {
    const p = permit(), bytes = log(p), r = receipt(p, bytes), gate = { command: { permitSha256: "d".repeat(64) } }, controls = { deepseek: p.verifierSha256, spendControl: "e".repeat(64) };
    const consume = (value = r, data = bytes, fingerprint: string | undefined = p.authorization.effortPolicySha256) => validateDeepSeekBudgetReceipt(value, gate, controls, Buffer.from(data), "v7-effort", "a".repeat(64), fingerprint);
    expect(consume()).toBe(true);
    expect(() => validateDeepSeekBudgetReceipt(r, gate, controls, Buffer.from(bytes), "v7-effort", "a".repeat(64))).toThrow();
    expect(() => consume(r, bytes, effortPolicySha256(policy("high")))).toThrow();
    expect(() => consume({ ...r, schemaVersion: "release-evidence-spend-receipt.v7" })).toThrow();
    const substituted = bytes.replaceAll('"reasoningEffort":"low"', '"reasoningEffort":"high"'); expect(() => consume({ ...r, logSha256: sha(substituted) }, substituted)).toThrow();
  });

  it("executes exactly two synthetic HTTP requests with normalization high and recommendation rank effort", async () => {
    for (const kind of ["effort","top5","unbounded"]) {
    const top5=kind!=="effort",unbounded=kind==="unbounded";
    const root = directory(), verifier = path.resolve("scripts/lib/release-evidence-deepseek-verifier.mjs"), p = permit("launched", top5,unbounded); p.verifierSha256 = sha(readFileSync(verifier));
    const permitFile = path.join(root, "permit.json"); writeFileSync(permitFile, JSON.stringify(p));
    const code = `import fs from 'node:fs/promises';import {syncBuiltinESMExports} from 'node:module';import {pathToFileURL} from 'node:url';const read=fs.readFile;fs.readFile=async(file,...args)=>String(file).endsWith('/deepseek-key')?'synthetic-key-never-print':String(file).endsWith('/budget-permit')?read(${JSON.stringify(permitFile)}):read(file,...args);syncBuiltinESMExports();let calls=0;globalThis.fetch=async(url,options)=>{if(String(url)==='https://api.deepseek.com/models')return new Response(JSON.stringify({data:[{id:'deepseek-flash'}]}));if(String(url)!=='https://api.deepseek.com/chat/completions')throw Error('HTTP forbidden');const body=JSON.parse(options.body);calls++;if(calls>2||body.reasoning_effort!==(calls===1?'high':'low')||body.thinking.type!=='enabled')throw Error('effort differs');const content=calls===1?{mappings:[{fieldId:'skills',status:'unique',values:['programming'],evidenceSpan:'Python'}]}:{recommendations:['algorithm','software','modeling'].map((id,i)=>({competitionId:'preflight-'+id,matchEvidenceRefs:[['profile.skill:programming','profile.output:software','profile.interest:data'][i]],gapEvidenceRefs:['candidate.verify:preflight-'+id],preparationTipRefs:['tip.official:preflight-'+id,'tip.output:preflight-'+id]}))};return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(content),reasoning_content:'SYNTHETIC_REASONING_NEVER_PRINT'}}],usage:{prompt_tokens:100,completion_tokens:50,prompt_cache_hit_tokens:20}}));};process.argv=[process.execPath,${JSON.stringify(verifier)},'/run/credentials/synthetic/deepseek-key','/run/credentials/synthetic/budget-permit','deepseek-flash','deepseek-flash'];await import(pathToFileURL(${JSON.stringify(verifier)}));`;
    const script = path.join(root, "synthetic.mjs"); writeFileSync(script, code);
    const result = await exec(process.execPath, [script], { env: { PATH: "/usr/bin:/bin", NODE_ENV: "test" }, maxBuffer: 128000 });
    expect(result.stderr).toBe(""); expect(result.stdout).not.toMatch(/synthetic-key-never-print|SYNTHETIC_REASONING_NEVER_PRINT/);
    const events = result.stdout.trim().split("\n").map(line => JSON.parse(line)); expect(events.filter(e => e.operation === "budget_attempt").map(e => e.reasoningEffort)).toEqual(["high", "low"]);
    expect(events.every(e => e.verifier === (unbounded ? "release-evidence-deepseek.v7.top5.user-unbounded.v1" : top5 ? "release-evidence-deepseek.v7.top5.v1" : "release-evidence-deepseek.v7.effort.v1") && e.authorizationSha256 === p.authorizationSha256)).toBe(true);
    }
  });

  it("requires exact paired Next and worker effort bytes and retains the old manifest branch", () => {
    const root = directory(), put = (name: string, value: unknown) => { const file = path.join(root, name); mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value)); };
    const buildId = "synthetic-build", sourceSha256 = "a".repeat(64), workerBytes = "// synthetic worker only\n", artifactSha256 = sha(workerBytes), effortPolicy = policy(), fingerprint = effortPolicySha256(effortPolicy);
    const binding = { schemaVersion: "saitu.next-worker-binding.v7", sourceSha256, workerArtifactSha256: artifactSha256, nextBuildId: buildId, effortPolicy, effortPolicySha256: fingerprint };
    const manifest = { schemaVersion: "saitu.worker-build.v7", sourceSha256, artifactSha256, nodeMajor: 24, inputs: ["synthetic.ts"], nextBuildId: buildId, nextBindingSha256: sha(JSON.stringify(binding)), effortPolicy, effortPolicySha256: fingerprint };
    const config = { env: { SAITU_V7_SOURCE_SHA256: sourceSha256, SAITU_V7_EFFORT_POLICY: JSON.stringify(effortPolicy), SAITU_V7_EFFORT_POLICY_SHA256: fingerprint } };
    put(".next/BUILD_ID", buildId); put(".next/decision-worker-binding.json", binding); put(".next/required-server-files.json", { config }); put("dist/decision-worker/worker.mjs", workerBytes); put("dist/decision-worker/manifest.json", manifest);
    const check = (required = true) => verifyWorkerBuildArtifacts(path.join(root, ".next"), path.join(root, "dist/decision-worker"), { requireEffortPolicy: required });
    expect(check().effortPolicySha256).toBe(fingerprint);
    put(".next/required-server-files.json", { config: { ...config, env: { ...config.env, SAITU_V7_EFFORT_POLICY_SHA256: "f".repeat(64) } } }); expect(() => check()).toThrow(/effort_binding/);
    const oldBinding = { schemaVersion: binding.schemaVersion, sourceSha256, workerArtifactSha256: artifactSha256, nextBuildId: buildId };
    const oldManifest = { schemaVersion: manifest.schemaVersion, sourceSha256, artifactSha256, nodeMajor: 24, inputs: ["synthetic.ts"], nextBuildId: buildId, nextBindingSha256: sha(JSON.stringify(oldBinding)) };
    put(".next/decision-worker-binding.json", oldBinding); put("dist/decision-worker/manifest.json", oldManifest); put(".next/required-server-files.json", { config: { env: { SAITU_V7_SOURCE_SHA256: sourceSha256 } } });
    expect(() => check()).toThrow(/effort_binding_required/); expect(check(false).sourceSha256).toBe(sourceSha256);
  });

  it("validates app environment and PM2 against the signed policy without starting a process", async () => {
    for (const kind of ["effort","top5","unbounded"]) {
    const top5=kind!=="effort",unbounded=kind==="unbounded";
    const root = directory(), effort = top5 ? parseEffortPolicy({...policy(), review:"low"}) : policy(), fingerprint = effortPolicySha256(effort), release = "/opt/resume-ai/releases/20261109T000000Z";
    const app: Record<string, string> = { DATABASE_URL: "postgresql://synthetic@127.0.0.1/synthetic", AI_CONSENT_SALT: "0".repeat(32), AI_CONVERSATION_SIGNING_SECRET: "1".repeat(32), LOG_HASH_SECRET: "2".repeat(32), NEXT_PUBLIC_SITE_URL: "https://siyuanjiaxin.com", NEXT_PUBLIC_CONTACT_EMAIL: "privacy@siyuanjiaxin.com", FEATURE_AI: "0", FEATURE_COMPETITION_RECOMMENDER: "1", AI_PROVIDER: "deepseek", AI_MODEL: "deepseek-flash", AI_COMPETITION_NORMALIZE_MODEL: "deepseek-flash", AI_COMPETITION_CLARIFY_MODEL: "deepseek-flash", AI_COMPETITION_RECOMMEND_MODEL: "deepseek-flash", AI_TIMEOUT_MS: "30000", AI_RETRY_MAX_DELAY_MS: "5000", AI_REASONING_EFFORT: "high", AI_SPEND_AUTHORIZED_EFFORT: "stage", AI_SPEND_POLICY_SHA256: "a".repeat(64), AI_SPEND_EFFORT_CONDITION_SHA256: "c".repeat(64), AI_SPEND_PHASE: "formal", AI_SPEND_RUN_ID: `saitu-v7-${unbounded ? "top5-unbounded" : top5 ? "top5" : "effort"}-20261109-formal-00`, AI_SPEND_LIMIT_CNY: "1", AI_SPEND_FUNDED_CNY: "1", SAITU_DECISION_STRATEGY: "llm", SAITU_V7_EFFORT_POLICY: JSON.stringify(effort), SAITU_V7_EFFORT_POLICY_SHA256: fingerprint, AI_TEST_MODE: "0", ALLOW_AI_MOCK: "0", NEXT_PUBLIC_AI_TEST_MODE: "0" };
    if(unbounded)Object.assign(app,{SAITU_AI_EXECUTION_MODE:"user-unbounded",AI_SPEND_LIMIT_CNY:"0",AI_SPEND_FUNDED_CNY:"0",AI_CALIBRATION_CALL_LIMIT:"0",SAITU_V7_WORKER_CONCURRENCY:"0"});
    const envBytes = (value: Record<string, string>) => Object.entries(value).map(([key, data]) => `${key}=${data}`).join("\n") + "\n", envFile = path.join(root, "app.env");
    writeFileSync(envFile, envBytes(app)); await exec("/bin/bash", ["ops/bin/validate-app-env.sh", "production", envFile], { env: { PATH: "/usr/bin:/bin", NODE_ENV: "test" } });
    writeFileSync(envFile, envBytes({ ...app, SAITU_V7_EFFORT_POLICY_SHA256: "f".repeat(64) })); await expect(exec("/bin/bash", ["ops/bin/validate-app-env.sh", "production", envFile], { env: { PATH: "/usr/bin:/bin", NODE_ENV: "test" } })).rejects.toThrow();
    const source = readFileSync("ops/pm2/ecosystem.config.cjs", "utf8"), workerBytes = "// synthetic worker", artifactSha256 = sha(workerBytes), sourceSha256 = "b".repeat(64), buildId = "synthetic-build";
    const binding = { ...(unbounded?{executionMode:"user-unbounded"}:{}), schemaVersion: "saitu.next-worker-binding.v7", sourceSha256, workerArtifactSha256: artifactSha256, nextBuildId: buildId, effortPolicy: effort, effortPolicySha256: fingerprint };
    const files = new Map<string, string>([[release + "/scripts/competitions/v7/worker-entry.ts", "// source"], [release + "/src/lib/ai/effort-policy.mjs", "// source"], [release + "/dist/decision-worker/worker.mjs", workerBytes], [release + "/dist/decision-worker/manifest.json", JSON.stringify({ ...(unbounded?{executionMode:"user-unbounded"}:{}), schemaVersion: "saitu.worker-build.v7", sourceSha256, artifactSha256, nodeMajor: 24, inputs: ["synthetic.ts"], nextBuildId: buildId, nextBindingSha256: sha(JSON.stringify(binding)), effortPolicy: effort, effortPolicySha256: fingerprint })], [release + "/.next/decision-worker-binding.json", JSON.stringify(binding)], [release + "/.next/BUILD_ID", buildId], [release + "/.next/required-server-files.json", JSON.stringify({ config: { env: { ...(unbounded?{SAITU_AI_EXECUTION_MODE:"user-unbounded"}:{}), SAITU_V7_SOURCE_SHA256: sourceSha256, SAITU_V7_EFFORT_POLICY: JSON.stringify(effort), SAITU_V7_EFFORT_POLICY_SHA256: fingerprint } } })], ["/etc/resume-ai/quota.env", "AI_REQUEST_DEADLINE_MS=45000\nAI_PRODUCER_DEADLINE_MS=50000\nIDEMPOTENCY_FINALIZE_DEADLINE_MS=60000\nIDEMPOTENCY_DUPLICATE_WAIT_MS=62000\nAPP_RESPONSE_DEADLINE_MS=65000\n"]]);
    if(top5) files.set(release + "/db/migrations/20261109_spend_v7_top5_policy.sql", "-- configuration-only source marker");
    if(unbounded)files.set(release + "/src/lib/ai/execution-policy.mjs", "// configuration-only unbounded capability marker");
    const evaluate = (values: Record<string, string>) => { files.set("/etc/resume-ai/app.env", envBytes(values)); const fs = { existsSync: (name: string) => files.has(name), lstatSync: () => ({ uid: 0, gid: 1001, mode: 0o640, nlink: 1, isFile: () => true, isSymbolicLink: () => false }), realpathSync: (name: string) => name, readFileSync: (name: string, encoding?: string) => { const bytes = files.get(name); if (bytes === undefined) throw new Error("ENOENT"); return encoding ? bytes : Buffer.from(bytes); } }; const fixtureModule = { exports: {} as { apps: Array<{ env: Record<string, string> }> } }; new Function("require", "process", "module", source)((name: string) => name === "node:fs" ? fs : name === "node:path" ? path : { createHash }, { getgid: () => 1001, env: { APP_RELEASE_DIR: release } }, fixtureModule); return fixtureModule.exports; };
    expect(evaluate(app).apps.map(item => item.env.SAITU_V7_EFFORT_POLICY_SHA256)).toEqual([fingerprint, fingerprint]);
    const other = policy("high"); expect(() => evaluate({ ...app, SAITU_V7_EFFORT_POLICY: JSON.stringify(other), SAITU_V7_EFFORT_POLICY_SHA256: effortPolicySha256(other) })).toThrow(top5 ? /Top5/ : /signed Next-worker build/);
    expect(() => evaluate({ ...app, AI_SPEND_HIGH_CONDITION_SHA256: "c".repeat(64) })).toThrow();
    if(top5) expect(() => evaluate({...app, AI_SPEND_RUN_ID:"saitu-v7-effort-20261109-formal-00"})).toThrow();
    }
  });
});
