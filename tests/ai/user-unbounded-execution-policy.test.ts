import {afterEach,describe,expect,it,vi} from "vitest";
import {mkdtemp,mkdir,writeFile,rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {readExecutionMode,USER_UNBOUNDED_AUTHORIZATION_POLICY,USER_UNBOUNDED_EXECUTION_LIMITS,USER_UNBOUNDED_GRANT_VERSION} from "@/lib/ai/execution-policy.mjs";
import {prepareEffortBudgetCondition} from "../../scripts/competitions/v6/effort-budget-condition.mjs";
// @ts-expect-error Deployment configuration intentionally remains plain JavaScript.
import createNextConfig from "../../next.config.mjs";
const directories:string[]=[];
afterEach(async()=>{vi.unstubAllEnvs();for(const directory of directories.splice(0))await rm(directory,{recursive:true,force:true});});
describe("explicit user-unbounded policy without numeric sentinels",()=>{
  it("requires the literal mode and represents every artificial limit as null",()=>{
    expect(readExecutionMode({})).toBe("finite");expect(readExecutionMode({SAITU_AI_EXECUTION_MODE:"user-unbounded"})).toBe("user-unbounded");
    for(const raw of ["unlimited","Infinity","999999999","true"])expect(()=>readExecutionMode({SAITU_AI_EXECUTION_MODE:raw})).toThrow("invalid_ai_execution_mode");
    expect(USER_UNBOUNDED_EXECUTION_LIMITS).toEqual({modelConcurrencyLimit:null,totalCallLimit:null,totalCostLimitMicros:null});
  });
  it("binds the new authorization bytes and requires explicit mode plus the unchanged low product policy",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"unbounded-condition-"));directories.push(root);
    const policyFile=path.join(root,USER_UNBOUNDED_AUTHORIZATION_POLICY),effortPolicyFile=path.join(root,"effort.json"),bytes="Synthetic newly approved execution authorization\n";
    await mkdir(path.dirname(policyFile),{recursive:true});await writeFile(policyFile,bytes);await writeFile(effortPolicyFile,JSON.stringify({version:"saitu.effort-policy.v1",rank:"low",explain:"low",review:"low"}));
    const input={root,policyFile,effortPolicyFile,phase:"calibration",mainRunId:"synthetic-main",priorLedger:[]};
    await expect(prepareEffortBudgetCondition(input)).rejects.toThrow("explicit_execution_mode_required");
    const prepared=await prepareEffortBudgetCondition({...input,executionMode:"user-unbounded"});
    expect(prepared.grantVersion).toBe(USER_UNBOUNDED_GRANT_VERSION);expect(prepared.policySha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(prepared.condition).toMatchObject({executionMode:"user-unbounded",executionLimits:USER_UNBOUNDED_EXECUTION_LIMITS,authorization:"user-approved-20261109-top5-unbounded-execution",sourcePolicy:USER_UNBOUNDED_AUTHORIZATION_POLICY});
    await expect(prepareEffortBudgetCondition({...input,executionMode:"user-unbounded",policyFile:path.join(root,"docs/v7/top5-continuation-contract-20261109.md")})).rejects.toThrow("explicit_execution_mode_required");
  });
  it("freezes the explicit mode into new Next builds while preserving the finite configuration branch",()=>{
    vi.stubEnv("SAITU_V7_SOURCE_SHA256","a".repeat(64));vi.stubEnv("SAITU_AI_EXECUTION_MODE","user-unbounded");
    const configured=createNextConfig("phase-production-build");expect(configured.env?.SAITU_AI_EXECUTION_MODE).toBe("user-unbounded");
    vi.stubEnv("SAITU_AI_EXECUTION_MODE","finite");expect(createNextConfig("phase-production-build").env).not.toHaveProperty("SAITU_AI_EXECUTION_MODE");
  });
});
