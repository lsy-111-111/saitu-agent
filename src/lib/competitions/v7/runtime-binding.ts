import "server-only";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { RECOMMENDATION_IMPLEMENTATION_VERSION, RECOMMENDATION_POLICY_VERSION } from "./contracts";
import { effortPolicySha256, readConfiguredEffortPolicy } from "../../ai/effort-policy.mjs";
import {readExecutionMode} from "../../ai/execution-policy.mjs";
import {readConfiguredDetailLayoutV7} from "./detail-layout.mjs";

/** Builds inject this value into both Next and the worker. Development computes
 * it from source; a source change cannot silently resume an old paid task. */
export function recommendationRuntimeBindingV7():string {
  const configured=process.env.SAITU_V7_SOURCE_SHA256;
  if(configured){if(!/^[a-f0-9]{64}$/.test(configured))throw new Error("INVALID_V7_SOURCE_BINDING");return configured;}
  if(process.env.NODE_ENV==="production")throw new Error("V7_SOURCE_BINDING_REQUIRED");
  const hash=createHash("sha256").update(`${RECOMMENDATION_IMPLEMENTATION_VERSION}\0${RECOMMENDATION_POLICY_VERSION}\0deepseek-flash:effort-policy:${effortPolicySha256(readConfiguredEffortPolicy())}\0execution-mode:${readExecutionMode()}\0detail-layout:${readConfiguredDetailLayoutV7()}`);
  function visit(directory:string){for(const name of readdirSync(directory).sort()){
    const filename=path.join(directory,name),stat=statSync(filename);
    if(stat.isDirectory())visit(filename);
    else if(/\.(ts|tsx|json|css|mjs|sql)$/.test(name))hash.update(path.relative(process.cwd(),filename)).update("\0").update(readFileSync(filename)).update("\0");
  }}
  // Include imported legacy catalog/types, API/security/database code and UI;
  // changing any execution dependency must not resume an old paid task silently.
  for(const directory of ["src","db/migrations"])visit(path.join(process.cwd(),directory));
  for(const filename of ["scripts/competitions/v7/worker-entry.ts","package.json","pnpm-lock.yaml","tsconfig.json","next.config.mjs"]){
    hash.update(filename).update("\0").update(readFileSync(path.join(process.cwd(),filename))).update("\0");
  }
  return hash.digest("hex");
}
