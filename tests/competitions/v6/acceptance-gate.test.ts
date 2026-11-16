import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { acceptanceCanonicalHash } from "../../../scripts/competitions/v6/acceptance-artifact-derivation";
import { ACCEPTANCE_TASK_GROUPS, CASE_QUOTAS, PRODUCT_GATE_RULES, evaluateProductAcceptance, inspectChallengeManifest, verifyMetricArtifacts, type AcceptanceInput, type ChallengeManifest } from "../../../scripts/competitions/v6/acceptance-gate";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
/** Test-only synthetic manifest. Never persisted or represented as collected challenge evidence. */
function manifest(): ChallengeManifest {
  return {
    schemaVersion: "saitu.challenge-manifest.v1", evidenceClass: "ai_proxy", frozenAt: "2026-11-05T10:00:00Z",
    implementationFrozenAt: "2026-11-05T11:00:00Z", openedAt: "2026-11-05T12:00:00Z", implementationSha256: hash("code"), configurationSha256: hash("config"),
    isolation: "separate_contexts_shared_filesystem", publicSeedManifestSha256: hash("public"),
    developmentInputSha256: Array.from({length:96}, (_, i) => hash(`dev-${i}`)), developmentFamilyIds: Array.from({length:36}, (_, i) => `dev-family-${i}`), developmentTemplateFamilyIds: ["dev-template"],
    cases: Object.entries(CASE_QUOTAS).flatMap(([layer, quota]) => Array.from({length: quota}, (_, i) => ({
      caseId: `${layer}-${i}`, familyId: `${layer}-family-${i}`, templateFamilyId: `${layer}-template-${i}`,
      layer: layer as keyof typeof CASE_QUOTAS, taskGroup: ACCEPTANCE_TASK_GROUPS[i % 6], inputSha256: hash(`${layer}-${i}`), answerSha256: hash(`answer-${layer}-${i}`),
      sourceSnapshotSha256: hash("source"), authorContextId: "author", reviewerContextIds: ["reviewer-1", "reviewer-2"] as [string,string], origin: "ai_authored" as const, split: "sealed" as const,
    }))),
  };
}

function input(): { data: AcceptanceInput; verified: Set<string> } {
  const challengeManifest = manifest();
  const metrics: AcceptanceInput["metrics"] = Object.fromEntries(PRODUCT_GATE_RULES.map(rule => [rule.id, {
    value: rule.target, denominator: Math.max(rule.minDenominator ?? 1, 1), evidencePath: `${rule.id}.json`, evidenceSha256: hash(rule.id), evidenceClass: rule.classes?.[0] ?? "ai_proxy",
  }]));
  for (const [id, value] of [["comprehensionGain", 15], ["comprehensionGainCiLower", 1]] as const) metrics[id] = { value, denominator: 60, evidencePath: `${id}.json`, evidenceSha256: hash(id), evidenceClass: "ai_proxy" };
  return { data: { schemaVersion: "saitu.product-acceptance.v1", mode: "ai_proxy", selectedAlgorithm: "B", selectedReasoningEffort: "max", challengeManifest, metrics,
    sealedCaseExecution: challengeManifest.cases.map(row => ({caseId: row.caseId, status: "passed"})), recallsTrimmed: false,
    budget: {maximumCny:300, spentCny:100, reservedCny:0, unpricedCalls:0}, humanStudies: {actualParticipants:0, independentHumanReviewers:0},
    comprehensionProtocol: {baselineMean:70, baselineCriticalMisunderstandings: 2, mode:"superiority", frozenBeforeStudy:true} },
    verified: new Set(Object.values(metrics).map(metric => `${metric.evidencePath}:${metric.evidenceSha256}`)) };
}

describe("strict product acceptance separate from unit-test success", () => {
  it("rejects missing byte evidence even when every scalar threshold is supplied", () => {
    expect(evaluateProductAcceptance(input().data).agreedAiProxyGatesPassed).toBe(false);
    expect(evaluateProductAcceptance(input().data).gates.find(gate=>gate.id==="strictCoverage")?.actual).toBeNull();
  });
  it("rejects caller-supplied verification Sets and never fabricates any approval", () => {
    const {data, verified} = input();
    const result = evaluateProductAcceptance(data, verified);
    expect(result.blockers).toContain("caller_supplied_verification_is_not_evidence");
    expect(result.agreedAiProxyGatesPassed).toBe(false);
    expect(result.originalAllProductGatesPassed).toBe(false);
    expect(result.realStudentStudy).toBe("not_performed");
    expect(result.productionApproval).toBe("not_performed");
  });
  it("cannot accept zero coverage just because every engineering test passed", () => {
    const {data, verified} = input(); data.metrics.strictCoverage.value = 0;
    expect(evaluateProductAcceptance(data, verified).blockers).toContain("strictCoverage:threshold_not_met");
  });
  it("rejects public-family leakage and duplicate ranking families across groups", () => {
    const m = manifest(); m.cases[0].familyId = m.developmentFamilyIds[0];
    const ranking = m.cases.filter(row => row.layer === "ranking"); ranking[1].familyId = ranking[0].familyId;
    expect(inspectChallengeManifest(m)).toContain(`development_contamination:${m.cases[0].caseId}`);
    expect(inspectChallengeManifest(m)).toContain("ranking_requires_six_groups_of_twenty_families");
  });
  it("does not allow skipped hard cases, unpriced spending, or implicit human claims", () => {
    const {data, verified} = input(); data.sealedCaseExecution[0].status = "not_run"; data.budget.unpricedCalls = 1; data.mode = "original_human";
    const result = evaluateProductAcceptance(data, verified);
    expect(result.blockers).toContain("all_800_cases_must_execute_and_pass");
    expect(result.blockers).toContain("budget_not_reconciled_within_300_cny");
    expect(result.blockers).toContain("actual_human_evidence_required");
    expect(result.originalAllProductGatesPassed).toBe(false);
  });
  it("retains the relative gain requirement when C is selected", () => {
    const {data, verified} = input(); data.selectedAlgorithm = "C";
    expect(evaluateProductAcceptance(data, verified).blockers).toContain("relativeNdcg5Gain:missing_metric");
  });
  it("does not count tracks or repeated deep records as distinct qualified series", () => {
    const {data, verified} = input(); data.metrics.distinctL3Series.value = 44;
    data.metrics.newDistinctL2Series.value = 19; data.metrics.distinctCatalogSeries.value = 154;
    const blockers = evaluateProductAcceptance(data, verified).blockers;
    for (const id of ["distinctL3Series", "newDistinctL2Series", "distinctCatalogSeries"]) expect(blockers).toContain(`${id}:threshold_not_met`);
  });
  it("allows the preregistered high-baseline zero-misunderstanding branch only if zero is retained", () => {
    const {data, verified} = input();
    data.comprehensionProtocol = {baselineMean:90, baselineCriticalMisunderstandings:0, mode:"noninferiority", frozenBeforeStudy:true};
    data.metrics.comprehensionGainCiLower.value = -4;
    data.metrics.criticalMisunderstandings = {value:0, denominator:60, evidencePath:"misunderstandings.json", evidenceSha256:hash("zero"), evidenceClass:"ai_proxy"};
    verified.add(`misunderstandings.json:${hash("zero")}`);
    expect(evaluateProductAcceptance(data, verified).agreedAiProxyGatesPassed).toBe(false);
    expect(evaluateProductAcceptance(data, verified).blockers).toContain("sealed_case_execution:raw_scoring_deriver_unavailable");
    data.metrics.criticalMisunderstandings.value = 1;
    expect(evaluateProductAcceptance(data, verified).blockers).toContain("criticalMisunderstandings:threshold_not_met");
  });
  it("cannot adopt a cheaper or faster effort without superior quality and fresh sealed revalidation", () => {
    const {data, verified} = input(); data.selectedReasoningEffort = "high";
    const blockers = evaluateProductAcceptance(data, verified).blockers;
    for (const id of ["effortVsMaxNdcg5CiLower", "effortOtherQualityNonregressionPass", "effortFrozenUnseenRevalidationPass"]) expect(blockers).toContain(`${id}:missing_metric`);
  });
  it("distinguishes actual product timing from model execution and from mocked unit timing", () => {
    const {data, verified} = input();
    data.selectedAlgorithm = "A1";
    for (const id of ["firstScreenP95Ms", "fullReportP95Ms"]) data.metrics[id].evidenceClass = "real_product";
    expect(evaluateProductAcceptance(data, verified).agreedAiProxyGatesPassed).toBe(false);
    expect(evaluateProductAcceptance(data, verified).blockers).toContain("sealed_case_execution:raw_scoring_deriver_unavailable");
    data.metrics.actualModelRuns.evidenceClass = "real_product";
    data.metrics.firstScreenP95Ms.evidenceClass = "deterministic";
    const blockers = evaluateProductAcceptance(data, verified).blockers;
    expect(blockers).toContain("actualModelRuns:wrong_evidence_class");
    expect(blockers).toContain("firstScreenP95Ms:wrong_evidence_class");
  });
});


describe("raw artifact evidence cannot be replaced by matching hashes", () => {
  it("reproduces R1-02 with actual files and rejects false product/usage/labels/cost claims", () => {
    const root=mkdtempSync(path.join(tmpdir(),"saitu-gate-r1-"));
    try {
      const {data}=input();
      const bytes=JSON.stringify({schemaVersion:"saitu.fake-summary.v1",realProduct:false,actualModelRuns:0,observations:[],costCny:null,labels:"U",status:"not_run"});
      writeFileSync(path.join(root,"not-run.json"),bytes);
      for(const metric of Object.values(data.metrics)){metric.evidencePath="not-run.json";metric.evidenceSha256=hash(bytes);}
      const proof=verifyMetricArtifacts(data,root),result=evaluateProductAcceptance(data,root);
      expect(proof.actualModelRuns.status).toBe("invalid");
      expect(proof.actualModelRuns.reason).toBe("artifact_schema_not_authorized_for_metric");
      expect(proof.firstScreenP95Ms.status).toBe("invalid");
      expect(proof.pooledNdcg5.status).toBe("pending");
      expect(result.agreedAiProxyGatesPassed).toBe(false);
      expect(result.originalAllProductGatesPassed).toBe(false);
      expect(result.gates.every(gate=>!gate.passed && gate.actual===null)).toBe(true);
      expect(result.blockers).toContain("budget:raw_ledger_evidence_required");
      expect(result.blockers).toContain("sealed_case_execution:raw_scoring_deriver_unavailable");
      writeFileSync(path.join(root,"input.json"),JSON.stringify(data));
      const cli=spawnSync(process.execPath,[path.join(process.cwd(),"scripts/competitions/v6/acceptance-gate.ts"),"--input",path.join(root,"input.json"),"--output",path.join(root,"result.json")],{cwd:root,encoding:"utf8"});
      expect(cli.status,cli.stderr).toBe(1);
      const cliResult=JSON.parse(readFileSync(path.join(root,"result.json"),"utf8"));
      expect(cliResult.agreedAiProxyGatesPassed).toBe(false);
      expect(cliResult.gates.every((gate:{passed:boolean;actual:number|null})=>!gate.passed&&gate.actual===null)).toBe(true);
    } finally {rmSync(root,{recursive:true,force:true});}
  });
  it("rejects stale bytes and symlink escapes instead of treating a matching external hash as evidence",()=>{
    const root=mkdtempSync(path.join(tmpdir(),"saitu-gate-path-")),outside=mkdtempSync(path.join(tmpdir(),"saitu-gate-outside-"));
    try {
      const {data}=input(),metric=data.metrics.actualModelRuns;
      writeFileSync(path.join(root,"changed.json"),"{}");metric.evidencePath="changed.json";metric.evidenceSha256=hash("old bytes");
      expect(verifyMetricArtifacts(data,root).actualModelRuns.reason).toBe("artifact_bytes_mismatch");
      writeFileSync(path.join(outside,"external.json"),"{}");symlinkSync(path.join(outside,"external.json"),path.join(root,"link.json"));
      metric.evidencePath="link.json";metric.evidenceSha256=hash("{}");
      expect(verifyMetricArtifacts(data,root).actualModelRuns.reason).toBe("artifact_symlink_outside_evidence_root");
    }finally{rmSync(root,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true});}
  });
});

// Entirely synthetic, local raw-file fixture. It exercises the derivation, not provider or product quality.
function rawDispatchFixture(root:string, dispatched=600, httpStages=1, configurationHashOverride?:string) {
  const {data}=input(), sourceFiles:unknown[]=[];
  data.challengeManifest.implementationSha256=acceptanceCanonicalHash(sourceFiles);
  const runtimeKeys=["AI_PROVIDER","AI_MODEL","AI_COMPETITION_NORMALIZE_MODEL","AI_COMPETITION_RECOMMEND_MODEL",
    "AI_TIMEOUT_MS","AI_REQUEST_DEADLINE_MS","AI_RETRY_MAX_DELAY_MS","AI_TEST_MODE","ALLOW_AI_MOCK",
    "AI_SPEND_RUN_ID","AI_SPEND_PHASE","AI_SPEND_FUNDED_CNY","AI_SPEND_LIMIT_CNY","AI_BUDGET_TIMEZONE",
    "AI_REASONING_EFFORT","SAITU_DECISION_STRATEGY","SAITU_CATALOG_SNAPSHOT_PATH","SAITU_FROZEN_EVIDENCE_INDEX",
    "SAITU_FROZEN_EVIDENCE_INDEX_SHA256","SAITU_FROZEN_EVIDENCE_ROOT","NODE_ENV","AI_API_URL"];
  const runtime={schemaVersion:"saitu.runtime-configuration.v1",values:{...Object.fromEntries(runtimeKeys.map(key=>[key,null])),NODE_ENV:"development",AI_PROVIDER:"deepseek",AI_SPEND_PHASE:"formal"}};
  const runtimeHash=acceptanceCanonicalHash(runtime);
  data.challengeManifest.configurationSha256=configurationHashOverride??acceptanceCanonicalHash({phase:"E2",seed:6141,effort:"max",repeats:5,candidatePolicy:"full",algorithms:["A1","B","C"],runtimeConfigurationSha256:runtimeHash});
  const rankingCases=data.challengeManifest.cases.filter(row=>row.layer==="ranking");
  const profiles=rankingCases.map((item,index)=>{
    const profile={schemaVersion:"saitu.profile.v6",profileId:`test-profile-${index}`};
    const raw={profile};item.inputSha256=acceptanceCanonicalHash(raw);
    return {profileId:profile.profileId,caseId:item.caseId,familyId:item.familyId,taskGroup:item.taskGroup,profile,input:raw};
  });
  const write=(name:string,value:unknown)=>{const bytes=JSON.stringify(value);writeFileSync(path.join(root,name),bytes);return {path:name,sha256:hash(bytes)};};
  const challenge=write("challenge.json",data.challengeManifest);
  const profileSnapshot={origin:"ai_authored_sealed",asOf:"2026-11-05T12:00:00Z",profiles};
  const catalog:unknown[]=[];
  const registration={schemaVersion:"saitu.ranking-registration.v1",runtimeConfiguration:runtime,runtimeConfigurationSha256:runtimeHash,implementationSha256:data.challengeManifest.implementationSha256,inputOpened:false,
    config:{purpose:"ai_proxy_acceptance",profileCount:120,repeats:5,effort:"max",phase:"E2",candidatePolicy:"full",algorithms:["A1","B","C"],seed:6141,challengeManifestSha256:challenge.sha256,sourceSnapshotSha256:hash("source"),inputSha256:hash("synthetic raw input bytes")}};
  const registrationRef=write("registration.json",registration);
  const binding={runtimeConfigurationSha256:runtimeHash,challengeManifestSha256:challenge.sha256,implementationSha256:data.challengeManifest.implementationSha256,configurationSha256:data.challengeManifest.configurationSha256,
    registrationSha256:registrationRef.sha256,sourceSnapshotSha256:hash("source"),catalogSha256:acceptanceCanonicalHash(catalog),profilesSha256:acceptanceCanonicalHash(profileSnapshot)};
  const observations:Record<string,unknown>[]=[],runs:Record<string,unknown>[]=[];let cIndex=0;
  for(const profile of profiles)for(const algorithm of ["A1","B","C"])for(let repetition=0;repetition<5;repetition++){
    const invocationId=`${profile.profileId}:${algorithm}:${repetition}`,active=algorithm==="C"&&cIndex++<dispatched;
    const events:Record<string,unknown>[]=[],reservationIds:string[]=[];
    if(active)for(let stage=0;stage<httpStages;stage++){
      const reservationId=`${invocationId}:reservation:${stage}`;reservationIds.push(reservationId);
      events.push({type:"ai_budget_reserved",origin:"product",requestId:invocationId,details:{reservationId,phase:"formal",model:"deepseek-flash",effort:"max"}},
        {type:"ai_transport_dispatch",origin:"product",requestId:invocationId,details:{reservationId,model:"deepseek-flash",operation:"competition_recommend"}},
        {type:"ai_budget_settled",origin:"product",requestId:invocationId,details:{reservationId,upstreamAttempted:true,usage:null}});
    }
    const shared={invocationId,inputSha256:acceptanceCanonicalHash(profile.input),outputSha256:acceptanceCanonicalHash(null),reservationIds,freezeBinding:binding,candidateSetSha256:acceptanceCanonicalHash(["candidate"])};
    observations.push({...shared,profileId:profile.profileId,caseId:profile.caseId,operation:"recommend",algorithm,repetition,status:"error",output:null,events,execution:{actualModelRun:active,httpDispatches:active?httpStages:0}});
    runs.push({...shared,profileId:profile.profileId,algorithm});
  }
  const files=[registrationRef,write("runtime-configuration.json",{sha256:runtimeHash,configuration:runtime}),
    write("opening.json",{registrationSha256:registrationRef.sha256,inputSha256:registration.config.inputSha256}),
    write("experiment.json",{schemaVersion:"saitu.experiment-run.v2",purpose:"ai_proxy_acceptance",liveRequested:true,implementationUnchanged:true,runtimeConfigurationUnchanged:true,completedAt:"2026-11-05T12:05:00Z",implementationSha256:binding.implementationSha256,catalogSha256:binding.catalogSha256,reasoningEffort:"max",candidatePolicy:"full",seed:6141}),
    write("profiles-snapshot.json",profileSnapshot),write("catalog-snapshot.json",{records:catalog}),
    write("implementation-snapshot.json",{sha256:binding.implementationSha256,files:sourceFiles}),
    write("ranking-input.json",{schemaVersion:"saitu.ranking-evaluation.v1",purpose:"ai_proxy_acceptance",expectedRunsPerProfile:5,algorithms:["A1","B","C"],profiles:profiles.map(p=>({profileId:p.profileId,poolItemIds:["candidate"]})),runs}),
    write("product-observations.json",{schemaVersion:"saitu.bound-ranking-observations.v1",freezeBinding:binding,observations})];
  const freeze=write("freeze-manifest.json",{schemaVersion:"saitu.experiment-freeze.v1",freezeBinding:binding,phase:"E2",seed:6141,configuration:{effort:"max",repeats:5,candidatePolicy:"full",skipIndependentRecall:true},requestedAlgorithms:["A1","B","C"],files});
  const envelope=write("dispatch-evidence.json",{schemaVersion:"saitu.acceptance-ranking-dispatch-evidence.v1",challengeManifest:challenge,freezeManifest:freeze});
  data.metrics.actualModelRuns={value:600,denominator:600,evidencePath:envelope.path,evidenceSha256:envelope.sha256,evidenceClass:"live_model"};
  return {data,observations,freeze,files,write};
}

function rebindChangedObservationBytes(root:string, fixture:ReturnType<typeof rawDispatchFixture>) {
  const observationFile=JSON.parse(readFileSync(path.join(root,"product-observations.json"),"utf8"));
  observationFile.observations=fixture.observations;
  const observationRef=fixture.write("product-observations.json",observationFile);
  const freezeValue=JSON.parse(readFileSync(path.join(root,"freeze-manifest.json"),"utf8"));
  freezeValue.files=freezeValue.files.map((entry:{path:string})=>entry.path===observationRef.path?observationRef:entry);
  const freezeRef=fixture.write("freeze-manifest.json",freezeValue);
  const envelope=JSON.parse(readFileSync(path.join(root,"dispatch-evidence.json"),"utf8"));envelope.freezeManifest=freezeRef;
  const envelopeRef=fixture.write("dispatch-evidence.json",envelope);fixture.data.metrics.actualModelRuns.evidenceSha256=envelopeRef.sha256;
}

describe("actualModelRuns derives only from frozen raw recommendation dispatches",()=>{
  it("verifies array-valued contexts in the real runner inventory without relaxing required object documents",()=>{
    const root=mkdtempSync(path.join(tmpdir(),"saitu-gate-inventory-"));
    try {
      const f=rawDispatchFixture(root),freezeValue=JSON.parse(readFileSync(path.join(root,"freeze-manifest.json"),"utf8"));
      const repin=()=>{
        const freeze=f.write("freeze-manifest.json",freezeValue);
        const envelope=JSON.parse(readFileSync(path.join(root,"dispatch-evidence.json"),"utf8"));envelope.freezeManifest=freeze;
        f.data.metrics.actualModelRuns.evidenceSha256=f.write("dispatch-evidence.json",envelope).sha256;
      };
      freezeValue.files.push(f.write("contexts.json",[{profile:{profileId:"synthetic"},candidates:[],excluded:[]}]));repin();
      expect(verifyMetricArtifacts(f.data,root).actualModelRuns.status).toBe("derived");
      // Every inventory member is still byte-checked even if its content is
      // not a required object consumed by the dispatch derivation.
      writeFileSync(path.join(root,"contexts.json"),"[]");
      expect(verifyMetricArtifacts(f.data,root).actualModelRuns.reason).toBe("artifact_bytes_mismatch");
      freezeValue.files=freezeValue.files.map((entry:{path:string})=>entry.path==="contexts.json"?f.write("contexts.json",[]):entry);
      freezeValue.files=freezeValue.files.map((entry:{path:string})=>entry.path==="experiment.json"?f.write("experiment.json",[]):entry);repin();
      expect(verifyMetricArtifacts(f.data,root).actualModelRuns.reason).toBe("artifact_object_required");
    } finally {rmSync(root,{recursive:true,force:true});}
  });
  it("counts 600 failed/fallback recommendation invocations once despite 2400 HTTP stages, without claiming any overall acceptance",()=>{
    const root=mkdtempSync(path.join(tmpdir(),"saitu-gate-dispatch-"));
    try{
      const {data}=rawDispatchFixture(root,600,4),result=evaluateProductAcceptance(data,root);
      const gate=result.gates.find(row=>row.id==="actualModelRuns")!;
      expect(gate.passed).toBe(true);expect(gate.actual).toBe(600);expect(gate.derivedDenominator).toBe(600);
      expect(result.agreedAiProxyGatesPassed).toBe(false);expect(result.rawEvidenceReadiness.budget).toBe("raw_ledger_evidence_required");
      data.metrics.actualModelRuns.value=2400;
      expect(verifyMetricArtifacts(data,root).actualModelRuns.reason).toBe("claimed_metric_differs_from_raw_derivation");
      data.metrics.pooledNdcg5={...data.metrics.actualModelRuns,value:1};
      expect(verifyMetricArtifacts(data,root).pooledNdcg5.status).toBe("pending");
    }finally{rmSync(root,{recursive:true,force:true});}
  });
  it("does not promote zero dispatches to 600 even when the same matrix carries caller counts",()=>{
    const root=mkdtempSync(path.join(tmpdir(),"saitu-gate-zero-"));
    try{
      const {data}=rawDispatchFixture(root,0);
      expect(verifyMetricArtifacts(data,root).actualModelRuns.reason).toBe("claimed_metric_differs_from_raw_derivation");
      data.metrics.actualModelRuns.value=0;
      const result=evaluateProductAcceptance(data,root);
      expect(result.gates.find(row=>row.id==="actualModelRuns")?.actual).toBe(0);
      expect(result.blockers).toContain("actualModelRuns:threshold_not_met");
    }finally{rmSync(root,{recursive:true,force:true});}
  });
  it("rejects a changed challenge source binding and wrong denominator/class without bypassing the filesystem derivation",()=>{
    const root=mkdtempSync(path.join(tmpdir(),"saitu-gate-bind-"));
    try{
      const {data}=rawDispatchFixture(root);
      data.metrics.actualModelRuns.denominator=2400;
      expect(verifyMetricArtifacts(data,root).actualModelRuns.reason).toBe("claimed_metric_differs_from_raw_derivation");
      data.metrics.actualModelRuns.denominator=600;data.metrics.actualModelRuns.evidenceClass="real_product";
      expect(verifyMetricArtifacts(data,root).actualModelRuns.reason).toBe("claimed_metric_differs_from_raw_derivation");
      data.metrics.actualModelRuns.evidenceClass="live_model";data.challengeManifest.cases.find(row=>row.layer==="ranking")!.sourceSnapshotSha256=hash("other-source");
      expect(verifyMetricArtifacts(data,root).actualModelRuns.reason).toBe("challenge_manifest_not_bound_to_acceptance");
    }finally{rmSync(root,{recursive:true,force:true});}
  });
  it("does not accept rehashed injected, not-run or foreign-reservation dispatch observations",()=>{
    const root=mkdtempSync(path.join(tmpdir(),"saitu-gate-tamper-"));
    try{
      const fixture=rawDispatchFixture(root),row=fixture.observations.find(item=>item.algorithm==="C")!;
      const original=structuredClone(row);
      row.status="not_run";rebindChangedObservationBytes(root,fixture);
      expect(verifyMetricArtifacts(fixture.data,root).actualModelRuns.reason).toBe("live_dispatch_identity_or_reservation_mismatch");
      Object.assign(row,structuredClone(original));
      const events=row.events as {type:string;origin:string;details:{reservationId:string}}[];
      events.find(event=>event.type==="ai_transport_dispatch")!.origin="injected";rebindChangedObservationBytes(root,fixture);
      expect(verifyMetricArtifacts(fixture.data,root).actualModelRuns.reason).toBe("injected_transport_cannot_certify_live_runs");
      Object.assign(row,structuredClone(original));
      (row.events as {type:string;details:{reservationId:string}}[]).find(event=>event.type==="ai_transport_dispatch")!.details.reservationId="foreign-reservation";
      rebindChangedObservationBytes(root,fixture);
      expect(verifyMetricArtifacts(fixture.data,root).actualModelRuns.reason).toBe("live_dispatch_identity_or_reservation_mismatch");
    }finally{rmSync(root,{recursive:true,force:true});}
  });

});


function rewriteFrozenArtifact(root:string, fixture:ReturnType<typeof rawDispatchFixture>, name:string, mutate:(value:Record<string,unknown>)=>void) {
  const value=JSON.parse(readFileSync(path.join(root,name),"utf8"));mutate(value);
  const ref=fixture.write(name,value);
  const freeze=JSON.parse(readFileSync(path.join(root,"freeze-manifest.json"),"utf8"));
  freeze.files=freeze.files.map((entry:{path:string})=>entry.path===name?ref:entry);
  const freezeRef=fixture.write("freeze-manifest.json",freeze);
  const envelope=JSON.parse(readFileSync(path.join(root,"dispatch-evidence.json"),"utf8"));envelope.freezeManifest=freezeRef;
  fixture.data.metrics.actualModelRuns.evidenceSha256=fixture.write("dispatch-evidence.json",envelope).sha256;
}

describe("actualModelRuns requires the exact registered public runtime controls",()=>{
  it("rejects a missing runtime artifact even after the outer manifest is rehashed",()=>{
    const root=mkdtempSync(path.join(tmpdir(),"saitu-runtime-missing-"));
    try{
      const fixture=rawDispatchFixture(root);
      rewriteFrozenArtifact(root,fixture,"freeze-manifest.json",value=>{value.files=(value.files as {path:string}[]).filter(entry=>entry.path!=="runtime-configuration.json");});
      expect(verifyMetricArtifacts(fixture.data,root).actualModelRuns.reason).toBe("frozen_runtime_configuration_artifact_required");
    }finally{rmSync(root,{recursive:true,force:true});}
  });
  it("rejects rehashed runtime drift and a run that did not preserve its registered runtime",()=>{
    const root=mkdtempSync(path.join(tmpdir(),"saitu-runtime-drift-"));
    try{
      let fixture=rawDispatchFixture(root);
      rewriteFrozenArtifact(root,fixture,"runtime-configuration.json",value=>{
        const runtime=value.configuration as {values:Record<string,unknown>};runtime.values.AI_TIMEOUT_MS="999";
        value.sha256=acceptanceCanonicalHash(runtime);
      });
      expect(verifyMetricArtifacts(fixture.data,root).actualModelRuns.reason).toBe("runtime_configuration_binding_mismatch");
      fixture=rawDispatchFixture(root);
      rewriteFrozenArtifact(root,fixture,"experiment.json",value=>{value.runtimeConfigurationUnchanged=false;});
      expect(verifyMetricArtifacts(fixture.data,root).actualModelRuns.reason).toBe("live_completed_frozen_experiment_required");
    }finally{rmSync(root,{recursive:true,force:true});}
  });
  it("recomputes configurationSha256 from registered parameters and runtime hash, instead of trusting two matching declarations",()=>{
    const root=mkdtempSync(path.join(tmpdir(),"saitu-runtime-config-"));
    try{
      const fixture=rawDispatchFixture(root,600,1,hash("arbitrary matching declarations"));
      expect(verifyMetricArtifacts(fixture.data,root).actualModelRuns.reason).toBe("runtime_registered_execution_configuration_hash_mismatch");
    }finally{rmSync(root,{recursive:true,force:true});}
  });
  it("accepts only the public runtime contract, never arbitrary environment fields",()=>{
    const root=mkdtempSync(path.join(tmpdir(),"saitu-runtime-contract-"));
    try{
      const fixture=rawDispatchFixture(root);
      rewriteFrozenArtifact(root,fixture,"runtime-configuration.json",value=>{
        (value.configuration as {values:Record<string,unknown>}).values.UNREGISTERED_FIELD="synthetic";
      });
      expect(verifyMetricArtifacts(fixture.data,root).actualModelRuns.reason).toBe("runtime_configuration_public_contract_invalid");
    }finally{rmSync(root,{recursive:true,force:true});}
  });
  it("checks the registered runtime object itself in addition to its copied SHA declaration",()=>{
    const root=mkdtempSync(path.join(tmpdir(),"saitu-runtime-registration-"));
    try{
      const fixture=rawDispatchFixture(root);
      const registration=JSON.parse(readFileSync(path.join(root,"registration.json"),"utf8"));
      registration.runtimeConfiguration.values.AI_SPEND_RUN_ID="changed-synthetic-run";
      const registrationRef=fixture.write("registration.json",registration);
      const opening=JSON.parse(readFileSync(path.join(root,"opening.json"),"utf8"));opening.registrationSha256=registrationRef.sha256;
      const openingRef=fixture.write("opening.json",opening);
      rewriteFrozenArtifact(root,fixture,"freeze-manifest.json",value=>{
        (value.freezeBinding as Record<string,unknown>).registrationSha256=registrationRef.sha256;
        value.files=(value.files as {path:string}[]).map(entry=>entry.path==="registration.json"?registrationRef:entry.path==="opening.json"?openingRef:entry);
      });
      expect(verifyMetricArtifacts(fixture.data,root).actualModelRuns.reason).toBe("runtime_configuration_binding_mismatch");
    }finally{rmSync(root,{recursive:true,force:true});}
  });

});
