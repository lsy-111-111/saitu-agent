import {afterEach,describe,expect,it} from "vitest";
import {mkdtemp,mkdir,writeFile,rm,readFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {prepareEffortBudgetCondition,EFFORT_AUTHORIZATION_POLICY,TOP5_AUTHORIZATION_POLICY} from "../../scripts/competitions/v6/effort-budget-condition.mjs";
import {effortPolicySha256,parseEffortPolicy,RANK_NON_THINKING_EFFORT_POLICY} from "../../src/lib/ai/effort-policy.mjs";
import {RANK_NONTHINKING_AUTHORIZATION_POLICY,RANK_NONTHINKING_AUTHORIZATION,RANK_NONTHINKING_TRIAL_ID,RANK_NONTHINKING_TRIAL_SLOTS,COMPACT_RECOMMENDATION_AUTHORIZATION_POLICY,USER_UNBOUNDED_AUTHORIZATION_POLICY} from "../../src/lib/ai/execution-policy.mjs";
const directories:string[]=[];
afterEach(async()=>{for(const directory of directories.splice(0))await rm(directory,{recursive:true,force:true});});
async function fixture(){
  const root=await mkdtemp(path.join(os.tmpdir(),"effort-grant-"));directories.push(root);
  const policyFile=path.join(root,EFFORT_AUTHORIZATION_POLICY),effortPolicyFile=path.join(root,"effort.json");
  await mkdir(path.dirname(policyFile),{recursive:true});await writeFile(policyFile,"Synthetic authorization bytes\n");
  const policy=parseEffortPolicy({review:"low",explain:"high",rank:"low",version:"saitu.effort-policy.v1"});
  await writeFile(effortPolicyFile,JSON.stringify(policy));
  return {root,policyFile,effortPolicyFile,phase:"calibration",mainRunId:"synthetic-main",priorLedger:[],policy};
}
describe("explicit stage effort grant preparation without database or provider",()=>{
  it("binds original authorization bytes, main authority and canonical stage policy",async()=>{
    const input=await fixture(),value=await prepareEffortBudgetCondition(input);
    expect(value.policySha256).toBe(createHash("sha256").update(await readFile(input.policyFile)).digest("hex"));
    expect(value.effortPolicySha256).toBe(effortPolicySha256(input.policy));
    expect(value.condition).toMatchObject({schemaVersion:"saitu.user-approved-budget-condition.v7.effort.v1",effort:"stage",mainRunId:"synthetic-main",effortPolicy:input.policy});
  });
  it("rejects arbitrary authorization files and malformed or widened policies",async()=>{
    const input=await fixture();
    await expect(prepareEffortBudgetCondition({...input,policyFile:path.join(input.root,"other.md")})).rejects.toThrow("approved_stage_effort_policy_required");
    await writeFile(input.effortPolicyFile,JSON.stringify({...input.policy,chat:"low"}));
    await expect(prepareEffortBudgetCondition(input)).rejects.toThrow("invalid_decision_effort_policy");
  });
  it("refuses missing main authority or an unapproved phase",async()=>{
    const input=await fixture();
    await expect(prepareEffortBudgetCondition({...input,mainRunId:""})).rejects.toThrow("approved_stage_effort_policy_required");
    await expect(prepareEffortBudgetCondition({...input,phase:"unlimited"})).rejects.toThrow("approved_stage_effort_policy_required");
  });
  it("binds only the approved Top5 document and low-low-low product policy to its new grant",async()=>{
    const input=await fixture(),policyFile=path.join(input.root,TOP5_AUTHORIZATION_POLICY);
    await writeFile(policyFile,"Synthetic Top5 authorization bytes\n");
    await writeFile(input.effortPolicyFile,JSON.stringify({version:"saitu.effort-policy.v1",rank:"low",explain:"low",review:"low"}));
    const prepared=await prepareEffortBudgetCondition({...input,policyFile});
    expect(prepared).toMatchObject({grantVersion:"saitu.v7.top5.v1",runIdPrefix:"saitu-v7-top5-20261109"});
    expect(prepared.condition).toMatchObject({schemaVersion:"saitu.user-approved-budget-condition.v7.top5.v1",sourcePolicy:TOP5_AUTHORIZATION_POLICY,
      policyVersion:"saitu.policy.2026-11-09.v7.top5",implementationVersion:"saitu.async.2026-11-09.v7.3.top5",authorization:"user-approved-20261109-top5-continuation"});
    expect(prepared.policySha256).not.toBe((await prepareEffortBudgetCondition(input)).policySha256);
    await writeFile(input.effortPolicyFile,JSON.stringify(input.policy));
    await expect(prepareEffortBudgetCondition({...input,policyFile})).rejects.toThrow("approved_top5_low_policy_required");
  });
});

describe("separate fixed-three non-thinking ranking authorization",()=>{
  async function fastFixture(){
    const input=await fixture(),policyFile=path.join(input.root,RANK_NONTHINKING_AUTHORIZATION_POLICY);
    await writeFile(policyFile,"Synthetic separately approved fixed three trial\n");
    await writeFile(input.effortPolicyFile,JSON.stringify(RANK_NON_THINKING_EFFORT_POLICY));
    return {...input,policyFile,executionMode:"user-unbounded" as const};
  }
  it("records actual wire settings and fixed slots without fabricating a passing pilot",async()=>{
    const prepared=await prepareEffortBudgetCondition(await fastFixture());
    expect(prepared.condition).toMatchObject({sourcePolicy:RANK_NONTHINKING_AUTHORIZATION_POLICY,authorization:RANK_NONTHINKING_AUTHORIZATION,
      effortPolicy:RANK_NON_THINKING_EFFORT_POLICY,rankModelSettings:{thinking:"disabled",policyReasoningEffort:"low",wireReasoningEffort:null,temperature:0,topP:1},
      developmentTrial:{id:RANK_NONTHINKING_TRIAL_ID,maxReports:3,slotIds:RANK_NONTHINKING_TRIAL_SLOTS},pilotContinuation:null});
    expect(prepared.effortPolicySha256).toBe("ecd106664dd8656d6a3be9076b8e03f5b32da0c2c5c1c94e2efaf4a2b1da71eb");
  });
  it.each([EFFORT_AUTHORIZATION_POLICY,TOP5_AUTHORIZATION_POLICY,USER_UNBOUNDED_AUTHORIZATION_POLICY,COMPACT_RECOMMENDATION_AUTHORIZATION_POLICY])("rejects v2 under the old document %s",async oldPolicy=>{
    const input=await fastFixture(),policyFile=path.join(input.root,oldPolicy);
    await writeFile(policyFile,"Synthetic old authorization\n");
    const executionMode=oldPolicy===EFFORT_AUTHORIZATION_POLICY||oldPolicy===TOP5_AUTHORIZATION_POLICY?"finite":"user-unbounded";
    await expect(prepareEffortBudgetCondition({...input,policyFile,executionMode})).rejects.toThrow("legacy_authorization_requires_v1_policy");
  });
  it("requires actual passed-pilot evidence before formal, repair, performance or reserve phases",async()=>{
    const input=await fastFixture();
    for(const phase of ["formal","repair","performance","reserve"]){
      await expect(prepareEffortBudgetCondition({...input,phase})).rejects.toThrow("passed_rank_nonthinking_pilot_proof_required");
    }
    const proof=path.join(input.root,"fabricated-proof.json");await writeFile(proof,JSON.stringify({complete:3}));
    await expect(prepareEffortBudgetCondition({...input,phase:"formal",pilotProofFile:proof})).rejects.toThrow("explicit_v2_pilot_proof_required");
    await expect(prepareEffortBudgetCondition({...input,pilotProofFile:proof})).rejects.toThrow("pilot_proof_only_for_rank_nonthinking_continuation");
  });
  it("refuses an enabled legacy policy under the new approval",async()=>{
    const input=await fastFixture();
    await writeFile(input.effortPolicyFile,JSON.stringify({version:"saitu.effort-policy.v1",rank:"low",explain:"low",review:"low"}));
    await expect(prepareEffortBudgetCondition(input)).rejects.toThrow();
  });
});
