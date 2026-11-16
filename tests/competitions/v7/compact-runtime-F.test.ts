import {afterEach,describe,expect,it,vi} from "vitest";
import {parseDetailLayoutV7,readConfiguredDetailLayoutV7} from "@/lib/competitions/v7/detail-layout.mjs";
import {DEFAULT_EFFORT_POLICY,LEGACY_DEFAULT_EFFORT_POLICY,effortPolicySha256,requireCompactRecommendationEffortPolicy,resolveEffortForOperation} from "@/lib/ai/effort-policy.mjs";
import {evaluationRuntimeForEffort,requireTop5EvaluationRuntime} from "../../../scripts/competitions/v7/evaluation-effort.mjs";
import {runtimeBehaviorConfiguration} from "../../../scripts/competitions/v7/evaluation-runtime.mjs";
import {readFrozenRunDetailLayoutV7,readFrozenRunEffortPolicyV7} from "@/lib/competitions/v7/store";
import {mkdtemp,rm,writeFile} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {prepareEffortBudgetCondition} from "../../../scripts/competitions/v6/effort-budget-condition.mjs";
import {COMPACT_RECOMMENDATION_AUTHORIZATION,COMPACT_RECOMMENDATION_AUTHORIZATION_POLICY,USER_UNBOUNDED_AUTHORIZATION_POLICY} from "@/lib/ai/execution-policy.mjs";

afterEach(()=>vi.unstubAllEnvs());
describe("compact runtime keeps frozen effort and layout",()=>{
  it("permits only LLL/HLL for new recommendation execution while retaining historical parsing",()=>{
    for(const rank of ["low","high"] as const)for(const explain of ["low","high"] as const)for(const review of ["low","high"] as const){
      const policy={version:"saitu.effort-policy.v1" as const,rank,explain,review};
      if(explain==="low"&&review==="low")expect(requireTop5EvaluationRuntime(evaluationRuntimeForEffort(policy))).toEqual(policy);
      else expect(()=>requireCompactRecommendationEffortPolicy(policy)).toThrow("compact_recommendation_requires_low_explain_review");
    }
    expect(readFrozenRunEffortPolicyV7({effortPolicy:LEGACY_DEFAULT_EFFORT_POLICY,effortPolicySha256:effortPolicySha256(LEGACY_DEFAULT_EFFORT_POLICY)})).toEqual(LEGACY_DEFAULT_EFFORT_POLICY);
  });
  it("keeps profile/chat high under HLL and validates its exact fingerprint",()=>{
    const policy={...DEFAULT_EFFORT_POLICY,rank:"high" as const};
    expect(["rank","explain","review","extract","chat","chat_review"].map(stage=>resolveEffortForOperation(`competition_v7_${stage}`,policy))).toEqual(["high","low","low","high","high","high"]);
    expect(()=>readFrozenRunEffortPolicyV7({effortPolicy:policy,effortPolicySha256:effortPolicySha256(DEFAULT_EFFORT_POLICY)})).toThrow("DECISION_EFFORT_POLICY_CHANGED");
  });
  it("defaults historical layout to single and rejects unknown layouts",()=>{
    expect(readFrozenRunDetailLayoutV7({})).toBe("single");
    expect(readConfiguredDetailLayoutV7({})).toBe("single");
    expect(readConfiguredDetailLayoutV7({SAITU_V7_DETAIL_LAYOUT:"parallel-2"})).toBe("parallel-2");
    for(const value of ["",null,"parallel-3",false])expect(()=>parseDetailLayoutV7(value)).toThrow("invalid_v7_detail_layout");
  });
  it("binds the actual layout and stage map into measured behavior configuration",()=>{
    const policy={...DEFAULT_EFFORT_POLICY,rank:"high" as const};
    const env={SAITU_V7_EFFORT_POLICY:JSON.stringify(policy),SAITU_V7_EFFORT_POLICY_SHA256:effortPolicySha256(policy),SAITU_V7_DETAIL_LAYOUT:"parallel-2"};
    expect(runtimeBehaviorConfiguration(env)).toMatchObject({effortPolicy:policy,effortPolicySha256:effortPolicySha256(policy),groupedDetails:{detailLayout:"parallel-2",groupIds:["g0","g1"]}});
  });
  it("requires a fresh compact approval for HLL while the old authorization stays LLL",async()=>{
    const directory=await mkdtemp(path.join(os.tmpdir(),"saitu-compact-effort-F-")),effortPolicyFile=path.join(directory,"effort.json"),root=process.cwd();
    try{
      const policy={...DEFAULT_EFFORT_POLICY,rank:"high" as const};await writeFile(effortPolicyFile,JSON.stringify(policy));
      const input={root,effortPolicyFile,phase:"calibration",mainRunId:"synthetic-main",priorLedger:[],executionMode:"user-unbounded" as const};
      const prepared=await prepareEffortBudgetCondition({...input,policyFile:path.join(root,COMPACT_RECOMMENDATION_AUTHORIZATION_POLICY)});
      expect(prepared.condition).toMatchObject({authorization:COMPACT_RECOMMENDATION_AUTHORIZATION,sourcePolicy:COMPACT_RECOMMENDATION_AUTHORIZATION_POLICY,effortPolicy:policy,effortPolicySha256:effortPolicySha256(policy)});
      await expect(prepareEffortBudgetCondition({...input,policyFile:path.join(root,USER_UNBOUNDED_AUTHORIZATION_POLICY)})).rejects.toThrow("approved_top5_low_policy_required");
      await writeFile(effortPolicyFile,JSON.stringify({...policy,review:"high"}));
      await expect(prepareEffortBudgetCondition({...input,policyFile:path.join(root,COMPACT_RECOMMENDATION_AUTHORIZATION_POLICY)})).rejects.toThrow("compact_recommendation_requires_low_explain_review");
    }finally{await rm(directory,{recursive:true,force:true});}
  });
});
