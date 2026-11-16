import { createRequire } from "node:module";
import type {ProductObservation,FrozenScoringSource} from "./score-product-observations";
const {scoringHash}=createRequire(import.meta.url)("./score-product-observations.ts") as typeof import("./score-product-observations");
export const REASON_PROTOCOL="all_displayed_reasons_in_selected_600_original_observations.v1";
type Proof={sourceId:string;bodySha256:string;quote:string;scope:string};
type Row={pointer:string;claimSha256:string;valid:boolean|null;reason:string;proof:Proof[]};
type Review={caseId:string;repetition:number;role:"reviewer_a"|"reviewer_b"|"adjudicator";contextId:string;observationSha256:string;rows:Row[];resolvesReviewSha256?:[string,string]};
type Identity={caseId:string;reviewerContextIds:[string,string];adjudicatorContextId?:string;authorContextId:string};
const record=(v:unknown)=>v && typeof v==="object" && !Array.isArray(v)?v as Record<string,unknown>:{};
const list=(v:unknown)=>Array.isArray(v)?v:[];
type Passage={pointer:string;claim:Record<string,unknown>;validReferences:boolean; sourceIds:Set<string>};
function reasonPassages(output:unknown):Passage[] {
  const report=record(output),profile=record(report.profile),withdrawn=new Set(list(profile.retractedFactIds));
  const active=new Set(list(profile.facts).map(record).filter(f=>f.confirmed===true && !["unknown","retracted"].includes(String(f.state)) && !withdrawn.has(f.id)).map(f=>f.id));
  if(!Array.isArray(report.recommendations)) throw new Error("reason_audit_missing_report");
  return report.recommendations.flatMap((item:unknown,index:number)=>{
    const recommendation=record(item), facts=list(recommendation.evidenceFacts).map(record);
    if (!Array.isArray(recommendation.reasons)|| !recommendation.reasons.length) throw new Error("reason_audit_missing_displayed_reasons");
    return recommendation.reasons.map((v:unknown,j:number)=>{
      const claim=record(v), students=list(claim.studentFactIds), contest=list(claim.competitionFactIds);
      const cited=facts.filter(f=>contest.includes(f.id)), sourceIds=new Set(cited.flatMap(f=>list(f.sourceIds).map(String)));
      const validReferences=students.every(id=>active.has(id)) && cited.length===contest.length &&
        (!(claim.basis==="student" || claim.basis==="inference") || students.length>0) &&
        (claim.basis!=="official" || cited.length>0 && cited.every(f=>f.kind==="official_fact"));
      return {pointer:"/output/recommendations/"+index+"/reasons/"+j,claim,sourceIds,validReferences};
    });
  });
}
function decisions(review:Review,passages:Passage[],sources:Map<string,FrozenScoringSource>){
  if(!Array.isArray(review.rows)||review.rows.length!==passages.length || new Set(review.rows.map(r=>r.pointer)).size!==passages.length)
    throw new Error("reason_audit_incomplete_or_duplicate");
  return passages.map(p=>{
    const row=review.rows.find(r=>r.pointer===p.pointer);
    if(!row || row.claimSha256!==scoringHash(p.claim) || !row.reason?.trim() || ![true,false,null].includes(row.valid) || !Array.isArray(row.proof))
      throw new Error("reason_audit_changed_claim_or_verdict");
    for(const proof of row.proof) {
      const source=sources.get(proof.sourceId);
      if(!source || !p.sourceIds.has(proof.sourceId) || proof.bodySha256!==source.bodySha256 || proof.scope!==source.scope ||
        !proof.quote?.trim() || !source.body.includes(proof.quote)) throw new Error("reason_audit_source_scope_or_quote_changed");
    }
    if(row.valid===true && !p.validReferences) return false;
    if(row.valid===true && p.sourceIds.size && !row.proof.length) return null;
    return row.valid;
  });
}
export function aggregateReasonAudit(bundle:{observations:ProductObservation[];identities:Identity[];sources:FrozenScoringSource[];reviews:Review[]}){
  const observed=bundle.observations.filter(r=>r.operation==="recommend"),sources=new Map(bundle.sources.map(s=>[s.sourceId,s]));
  const groups=new Map<string,Review[]>(), registered=new Set(observed.map(r=>JSON.stringify([r.caseId,r.repetition])));
  for(const review of bundle.reviews) {
    const key=JSON.stringify([review.caseId,review.repetition]);
    if(!registered.has(key)) throw new Error("reason_review_not_in_registered_matrix");
    groups.set(key,[...groups.get(key)??[],review]);
  }
  let completedReports=0,emptyReports=0,displayed=0,valid=0,unresolved=0;
  for (const obs of observed) {
    if(obs.status!=="observed") continue;
    const identity=bundle.identities.find(i=>i.caseId===obs.caseId);
    if(!identity) throw new Error("missing_reason_case_manifest");
    const source=reasonPassages(obs.output), reviews=groups.get(JSON.stringify([obs.caseId,obs.repetition]))??[];
    displayed+=source.length;
    if(!source.length) {emptyReports++;completedReports++;continue;}
    const roles=new Map(reviews.map(row=>[row.role,row]));
    const hash=scoringHash(obs);
    if(roles.size!==reviews.length || reviews.some(r=>r.observationSha256!==hash || !r.contextId || r.contextId===identity.authorContextId ||
      r.contextId!==(r.role==="reviewer_a"?identity.reviewerContextIds[0]:r.role==="reviewer_b"?identity.reviewerContextIds[1]:r.role==="adjudicator"?identity.adjudicatorContextId:null)))
      throw new Error("reason_reviewer_or_original_mismatch");
    const a=roles.get("reviewer_a"),b=roles.get("reviewer_b"),judge=roles.get("adjudicator");
    if(!a||!b||a.contextId===b.contextId) {unresolved+=source.length;continue;}
    const first=decisions(a,source,sources),second=decisions(b,source,sources);
    const third=judge && ![a.contextId,b.contextId].includes(judge.contextId) && judge.resolvesReviewSha256 &&
      scoringHash(judge.resolvesReviewSha256)===scoringHash([scoringHash(a),scoringHash(b)]) ? decisions(judge,source,sources):null;
    let pending=0;
    for(let i=0;i<source.length;i++){
      const result=first[i]===second[i]?first[i]:third?.[i];
      if(result===true) valid++; else if(result==null) pending++;
    }
    unresolved+=pending; if(!pending) completedReports++;
  }
  return {complete:registered.size===600 && observed.length===600 && completedReports===600 && !unresolved && displayed>0,
    completedReports,emptyReports,displayed,valid,unresolved};
}
