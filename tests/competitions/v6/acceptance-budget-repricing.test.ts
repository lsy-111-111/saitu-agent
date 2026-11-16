import {describe,it,expect} from "vitest";
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import type {AcceptanceInput} from "../../../scripts/competitions/v6/acceptance-gate";
import {deriveBudgetArtifact,repriceLiveLedgerUsage} from "../../../scripts/competitions/v6/acceptance-artifact-derivation";
const price="deepseek-flash-cny-20261105-peak-upper-bound";
const usage=(input:string,output:string,cached="0")=>({model:"deepseek-flash",price_version:price,input_tokens:input,output_tokens:output,cached_input_tokens:cached});
const baselineBytes=readFileSync(path.join(process.cwd(),"tests/fixtures/spend-ledger-baseline-20261105.json"));
function withNewLiveRow(change:Record<string,unknown>,check:(result:ReturnType<typeof deriveBudgetArtifact>)=>void){
 const root=mkdtempSync(path.join(tmpdir(),"saitu-reprice-r1-"));
 const write=(name:string,bytes:string|Buffer)=>{writeFileSync(path.join(root,name),bytes);return {path:name,sha256:createHash("sha256").update(bytes).digest("hex")};};
 try{
  const snapshot=JSON.parse(baselineBytes.toString()),original=snapshot.ledger.find((row:{run_id:string;state:string})=>row.run_id===snapshot.runId&&row.state==="usage_estimated");
  snapshot.observedAt="2026-11-05T18:40:00Z";
  snapshot.ledger.push({...original,id:"synthetic-new-live-row",created_at:"2026-11-05T18:39:00Z",settled_at:"2026-11-05T18:39:01Z",...change});
  const envelope={schemaVersion:"saitu.acceptance-ledger-budget-evidence.v1",baseline:write("baseline.json",baselineBytes),snapshot:write("snapshot.json",JSON.stringify(snapshot))};
  const input={budget:{maximumCny:230.02,spentCny:0,reservedCny:0,unpricedCalls:0},budgetEvidence:write("budget.json",JSON.stringify(envelope))} as AcceptanceInput;
  check(deriveBudgetArtifact(input,root));
 }finally{rmSync(root,{recursive:true,force:true});}
}
describe("AIR1-01 exact live usage repricing",()=>{
 it("prices one billion uncached input tokens and one output token at exactly 2000.000008 CNY",()=>{
  expect(repriceLiveLedgerUsage(usage("1000000000","1"))).toBe("2000000008");
  withNewLiveRow({...usage("1000000000","1"),charged_micros:"0",reserved_micros:"2000000008"},result=>{
   expect(result.status).toBe("invalid");expect(result.reason).toBe("live_usage_charge_price_mismatch");
  });
 });
 it("uses integer rational ceiling for cached tokens, including the safe integer boundary",()=>{
  expect(repriceLiveLedgerUsage(usage("1","0","1"))).toBe("1");
  expect(repriceLiveLedgerUsage(usage("25","0","25"))).toBe("1");
  expect(repriceLiveLedgerUsage(usage("26","0","26"))).toBe("2");
  expect(repriceLiveLedgerUsage(usage("3","1","2"))).toBe("11");
  expect(repriceLiveLedgerUsage(usage("9007199254740991","0","9007199254740991"))).toBe("360287970189640");
 });
 it("rejects unsafe token integers, impossible cache counts and a priced charge above its reservation",()=>{
  expect(()=>repriceLiveLedgerUsage(usage("9007199254740992","1"))).toThrow("live_usage_token_count_not_safe_integer");
  expect(()=>repriceLiveLedgerUsage(usage("1","0","2"))).toThrow("live_usage_cached_tokens_exceed_input");
  withNewLiveRow({...usage("10","1"),charged_micros:"28",reserved_micros:"27"},result=>expect(result.reason).toBe("live_usage_exceeds_reserved_upper_bound"));
 });
 it("retains unknown pricing as pending and accepts exact pricing without certifying unreviewed origins",()=>{
  withNewLiveRow({...usage("10","1"),price_version:"unknown-price",charged_micros:"28",reserved_micros:"100"},result=>{
   expect(result.status).toBe("pending");expect(result.reason).toBe("live_usage_price_snapshot_unrecognized");
  });
  withNewLiveRow({...usage("3","1","2"),charged_micros:"11",reserved_micros:"100"},result=>{
   expect(result.status).toBe("pending");expect(result.reason).toBe("ledger_source_review_required");
  });
 });
});
