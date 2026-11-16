import {expect,it} from "vitest";
import {reconcileProfileGold} from "../../../scripts/competitions/v6/profile-gold";
import {scoringHash} from "../../../scripts/competitions/v6/score-product-observations";
type Input=Parameters<typeof reconcileProfileGold>[0];
function fixture():Input{
 const cases=Array.from({length:120},(_,i)=>({caseId:"p"+i,operation:"extract_profile",input:{utterance:"我只协助整理样本"}}));
 const keys=cases.map(c=>({caseId:c.caseId,authorContextId:"author",annotationStatus:"adjudicated" as const,scoring:{expected:{facts:[{example:"an exemplar, not the full reference"}]}}}));
 const inputPackageSha256="f".repeat(64),rows=cases.map(c=>({caseId:c.caseId,inputSha256:scoringHash(c.input),complete:true as const,coverageReason:"all requested fields reviewed",expected:{facts:[{field:"contribution",value:"assisted",state:"affirmed",confirmed:false,sourceText:"协助整理样本",evidenceLevel:"self_report"}],unknownFields:["teamSize"]}}));
 const review={inputPackageSha256,openedAt:"2026-11-06T01:00:00Z",sealedAt:"2026-11-06T02:00:00Z",rows};
 return {originals:[{...structuredClone(review),contextId:"a"},{...structuredClone(review),contextId:"b"}],originalBytes:["a".repeat(64),"b".repeat(64)],
   cases,keys,inputPackageSha256,registeredAt:"2026-11-06T05:00:00Z"};
}
it("keeps illustrative original keys intact, and requires binds to two original references before semantic alignment",()=>{
 const f=fixture();expect(reconcileProfileGold(f).size).toBe(120);
 const [a,b]=f.originals;b.rows[0].expected.unknownFields=[];
 expect(()=>reconcileProfileGold(f)).toThrow("profile_gold_disagreement_without_binding");
 f.adjudication={contextId:"judge",resolvesReviewSha256:f.originalBytes,sealedAt:"2026-11-06T04:00:00Z",rows:[{...a.rows[0],originalRowSha256:[scoringHash(a.rows[0]),scoringHash(b.rows[0])]}]};
 expect(reconcileProfileGold(f).get("p0")?.unknownFields).toEqual(["teamSize"]);
 b.rows[0].expected.facts[0].sourceText="从没说过";expect(()=>reconcileProfileGold(f)).toThrow("profile_gold_fact_without_student_span");
});
