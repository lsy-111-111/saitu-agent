import "server-only";
import {mkdtempSync,writeFileSync,renameSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {getAuthoredDecisionCatalog,getDecisionCatalog} from "./catalog";
import {withCatalogSnapshotPath} from "./catalog-runtime";
import {checkSnapshot,snapshotDigest,type CatalogSnapshot} from "./catalog-snapshot";
import {validateDecisionRecord} from "./catalog-validation";
import {currentDecisionCatalogVersion} from "./catalog-binding";
import {canonicalHash,EvaluationNotRun} from "./evaluation-contracts";
/** Frozen unchanged L1 discovery, not fabricated review approval or a new competition rule. */
export async function withEvaluationCatalogFixture<T>(work:(rotate:()=>Record<string,unknown>)=>Promise<T>){
 const baseline=getAuthoredDecisionCatalog();
 const record=baseline.find(item=>{const check=validateDecisionRecord(item);return check.tier==="L1"&&!check.issues.some(issue=>issue.blocks==="L1");});
 if(!record)throw new EvaluationNotRun("unchanged_structurally_valid_L1_catalog_fixture_required");
 const snapshot=(version:string):CatalogSnapshot=>{const records=[{...structuredClone(record),catalogVersion:version}];return {schemaVersion:"saitu.catalog-snapshot.v1",snapshotId:version,createdAt:new Date().toISOString(),policy:"ai_dual_review",digest:snapshotDigest(records),records};};
 const first=snapshot("sealed-runtime-v1"),second=snapshot("sealed-runtime-v2");
 // No approval bypass: only an unchanged baseline L1 is exempt under the actual publication policy.
 for(const candidate of [first,second])if(!checkSnapshot(candidate,baseline,new Date(),true).valid)throw new EvaluationNotRun("catalog_fixture_failed_real_publication_validation");
 const directory=mkdtempSync(path.join(tmpdir(),"saitu-catalog-fault-")),active=path.join(directory,"active.json");
 writeFileSync(active,JSON.stringify(first),{flag:"wx",mode:0o600});
 try{return await withCatalogSnapshotPath(active,()=>work(()=>{
   const before=currentDecisionCatalogVersion(),beforeRecordsSha256=canonicalHash(getDecisionCatalog());
   writeFileSync(`${active}.next`,JSON.stringify(second),{flag:"wx",mode:0o600});renameSync(`${active}.next`,active);
   const after=currentDecisionCatalogVersion();if(before===after)throw new EvaluationNotRun("actual_runtime_catalog_did_not_change");
   return {origin:"synthetic_fault_injection",beforeCatalogVersion:before,afterCatalogVersion:after,beforeRecordsSha256,afterRecordsSha256:canonicalHash(getDecisionCatalog()),realRuntimeFileSwitch:true,unchangedL1Discovery:true,reviewApprovalsFabricated:false};
 }));}finally{rmSync(directory,{recursive:true,force:true});}
}
