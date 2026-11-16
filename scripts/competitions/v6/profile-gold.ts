import {createRequire} from "node:module";
import type {ScoringCase,ScoringKey} from "./score-product-observations";
const {scoringHash}=createRequire(import.meta.url)("./score-product-observations.ts") as typeof import("./score-product-observations");
type Gold={facts:Record<string,unknown>[];unknownFields:string[]};
type Judgment={caseId:string;inputSha256:string;expected:Gold;complete:true;coverageReason:string};
export type OriginalGoldReview={contextId:string;inputPackageSha256:string;openedAt:string;sealedAt:string;rows:Judgment[]};
type Resolution=Judgment & {originalRowSha256:[string,string]};
export type GoldResolution={contextId:string;resolvesReviewSha256:[string,string];sealedAt:string;rows:Resolution[]};
export function reconcileProfileGold(data:{originals:[OriginalGoldReview,OriginalGoldReview];originalBytes:[string,string];
  adjudication?:GoldResolution;cases:ScoringCase[];keys:ScoringKey[];inputPackageSha256:string;registeredAt:string}) {
  const scope=data.cases.filter(item=>item.operation==="extract_profile");
  if(scope.length!==120 || new Set(scope.map(c=>c.caseId)).size!==120 || !/^[0-9a-f]{64}$/.test(data.inputPackageSha256)) throw new Error("profile_gold_requires_120_original_inputs");
  const [a,b]=data.originals, judge=data.adjudication;
  if(!a.contextId || !b.contextId || a.contextId===b.contextId || data.keys.some(k=>[a.contextId,b.contextId,judge?.contextId].includes(k.authorContextId)))
    throw new Error("profile_gold_independent_role_collision");
  for (const original of [a,b]) if(original.inputPackageSha256!==data.inputPackageSha256 ||
      original.rows.length!==120 || new Set(original.rows.map(r=>r.caseId)).size!==120 ||
      !(Date.parse(original.openedAt)<=Date.parse(original.sealedAt) && Date.parse(original.sealedAt)<=Date.parse(data.registeredAt)))
    throw new Error("profile_gold_incomplete_or_after_registration");
  if(judge && (!judge.contextId || [a.contextId,b.contextId].includes(judge.contextId) ||
     scoringHash(judge.resolvesReviewSha256)!==scoringHash(data.originalBytes) ||
     !(Date.parse(judge.sealedAt)>=Math.max(Date.parse(a.sealedAt),Date.parse(b.sealedAt)) && Date.parse(judge.sealedAt)<=Date.parse(data.registeredAt)) ||
     new Set(judge.rows.map(row=>row.caseId)).size!==judge.rows.length)) throw new Error("invalid_profile_gold_adjudicator");
  const resolved=new Map<string,Gold>(),used=new Set<string>();
  for(const item of scope){
    const left=a.rows.find(row=>row.caseId===item.caseId), right=b.rows.find(row=>row.caseId===item.caseId);
    const validate=(row:Judgment|undefined)=>{
      if(!row || row.inputSha256!==scoringHash(item.input) || !row.complete || !row.coverageReason?.trim() ||
         !Array.isArray(row.expected.facts)||!Array.isArray(row.expected.unknownFields) ||
         new Set(row.expected.unknownFields).size!==row.expected.unknownFields.length ||
         !row.expected.unknownFields.every(f=>typeof f==="string"&&f.trim())) throw new Error("profile_gold_changed_or_incomplete_case");
      const utterance=(item.input as {utterance:string}).utterance;
      if(row.expected.facts.some(f=>typeof f.field!=="string" || !f.field || !["string","number","boolean"].includes(typeof f.value) ||
          !["affirmed","negated","unknown","conditional","retracted"].includes(String(f.state)) ||
          !["self_report","concrete_experience","unknown"].includes(String(f.evidenceLevel)) || f.confirmed!==false ||
          typeof f.sourceText!=="string" || !f.sourceText.trim() || !utterance.includes(f.sourceText))) throw new Error("profile_gold_fact_without_student_span");
      return row.expected;
    };
    const first=validate(left),second=validate(right);
    if(scoringHash(first)===scoringHash(second)) resolved.set(item.caseId,first);
    else {
      const third=judge?.rows.find(row=>row.caseId===item.caseId);
      if(!third || scoringHash(third.originalRowSha256)!==scoringHash([scoringHash(left),scoringHash(right)])) throw new Error("profile_gold_disagreement_without_binding");
      resolved.set(item.caseId,validate(third));used.add(item.caseId);
    }
  }
  if(judge?.rows.some(row=>!used.has(row.caseId)))throw new Error("unnecessary_or_extra_profile_gold_resolution");
  return resolved;
}
