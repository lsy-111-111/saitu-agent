import { createRequire } from "node:module";
import type {ProductObservation,ScoringCase,ScoringKey,BoundEvidence} from "./score-product-observations";
const {scoringHash,scoringPointer}=createRequire(import.meta.url)("./score-product-observations.ts") as typeof import("./score-product-observations");
export const STATE_AUDIT_PROTOCOL="frozen_800_case_obligation_inventory_v1";
type Kind="ability"|"revocation"|"correction"|"version"|"counterfactual";
type Obligation={id:string;kind:Kind;keyPointer:string;expectedSha256:string;observationPointers:string[];
  pairedCaseId?:string;pairedRepetition?:number;pairedPointers?:string[]};
type PlanRow={caseId:string;inputSha256:string;keySha256:string;repetition:number;items:Obligation[]};
type Identity={caseId:string;authorContextId:string;reviewerContextIds:[string,string];adjudicatorContextId?:string};
type Review={caseId:string;repetition:number;contextId:string;role:"reviewer_a"|"reviewer_b"|"adjudicator";observationSha256:string;
  outcomes:{id:string;passed:boolean|null;reason:string;evidence:BoundEvidence[];pairedSha256?:string;pairedEvidence?:BoundEvidence[]}[];resolvesReviewSha256?:[string,string]};
type Count={expected:number;passed:number;failed:number;pending:number};
const empty=():Count=>({expected:0,passed:0,failed:0,pending:0});
function bound(obs:ProductObservation,pointers:string[],evidence:BoundEvidence[]) {
  if(!pointers.length || new Set(pointers).size!==pointers.length || !Array.isArray(evidence) ||
      evidence.length!==pointers.length || new Set(evidence.map(x=>x.pointer)).size!==pointers.length) return false;
  return pointers.every(p=>(p.startsWith("/output/")||p==="/events"||p.startsWith("/events/")) &&
    evidence.some(e=>e.pointer===p && e.valueSha256===scoringHash(scoringPointer(obs,p))));
}
export function aggregateStateObligations(input:{plan:{schemaVersion:string;rows:PlanRow[]};cases:ScoringCase[];keys:ScoringKey[];
  observations:ProductObservation[];identities:Identity[];reviews:Review[]}) {
  const {rows}=input.plan, cases=new Map(input.cases.map(c=>[c.caseId,c])),keys=new Map(input.keys.map(k=>[k.caseId,k]));
  const originals=new Map(input.observations.map(o=>[JSON.stringify([o.caseId,o.repetition??0]),o]));
  const perKind:Record<Kind,Count>={ability:empty(),revocation:empty(),correction:empty(),version:empty(),counterfactual:empty()};
  const ids=new Set<string>(), planned=new Set(rows.map(r=>JSON.stringify([r.caseId,r.repetition])));
  if (input.plan.schemaVersion!=="saitu.800-state-obligations.v1" || planned.size!==rows.length ||
      new Set(rows.map(r=>r.caseId)).size!==cases.size || cases.size!==800) throw new Error("state_obligation_original_800_required");
  if(input.reviews.some(r=>!planned.has(JSON.stringify([r.caseId,r.repetition])))) throw new Error("state_review_outside_preregistered_inventory");
  for(const row of rows) {
    const item=cases.get(row.caseId),key=keys.get(row.caseId),identity=input.identities.find(c=>c.caseId===row.caseId);
    if(!item || !key || !identity || row.inputSha256!==scoringHash(item.input) || row.keySha256!==scoringHash(key) ||
        !Number.isInteger(row.repetition) || row.repetition<0 || row.repetition>=(item.operation==="recommend"?5:1))
      throw new Error("state_obligation_input_or_key_changed");
    const obs=originals.get(JSON.stringify([row.caseId,row.repetition]));
    const reviews=input.reviews.filter(r=>r.caseId===row.caseId&&r.repetition===row.repetition);
    const byRole=new Map(reviews.map(r=>[r.role,r]));
    if(reviews.length!==byRole.size || reviews.some(r=>!obs || r.observationSha256!==scoringHash(obs) ||
      !r.contextId || r.contextId===identity.authorContextId || r.contextId!==({reviewer_a:identity.reviewerContextIds[0],reviewer_b:identity.reviewerContextIds[1],adjudicator:identity.adjudicatorContextId}[r.role]) ||
      new Set(r.outcomes.map(o=>o.id)).size!==row.items.length || r.outcomes.length!==row.items.length ||
      r.outcomes.some(o=>!row.items.some(expected=>expected.id===o.id)))) throw new Error("unbound_or_incomplete_state_review");
    for(const obligation of row.items) {
      if(!Object.hasOwn(perKind,obligation.kind) || !obligation.id || ids.has(obligation.id) || !obligation.keyPointer.startsWith("/scoring/") ||
         scoringHash(scoringPointer(key,obligation.keyPointer))!==obligation.expectedSha256) throw new Error("invalid_or_duplicate_preregistered_obligation");
      const counter=perKind[obligation.kind];counter.expected++;ids.add(obligation.id);
      if (!obs || obs.status==="not_run" || key.annotationStatus!=="adjudicated"){counter.pending++;continue;}
      if (obs.status==="error") {counter.failed++;continue;}
      const pair=obligation.pairedCaseId?originals.get(JSON.stringify([obligation.pairedCaseId,obligation.pairedRepetition??0])):undefined;
      if(obligation.kind==="counterfactual") {
        if(obligation.pairedCaseId) {
          if(!pair||pair.status!=="observed"){counter.pending++;continue;}
          if(pair.inputSha256===obs.inputSha256||!(obligation.pairedPointers?.length)) throw new Error("counterfactual_requires_distinct_observed_inputs");
        } else if(item.operation!=="robustness" ||
          !obligation.observationPointers.some(p=>p==="/output/baseResult"||p.startsWith("/output/baseResult/")) ||
          !obligation.observationPointers.some(p=>p==="/output/perturbedResult"||p.startsWith("/output/perturbedResult/")))
          throw new Error("counterfactual_requires_observed_base_and_perturbation");
      }
      const verdict=(r:Review|undefined)=>{
        if(!r)return null;
        const result=r.outcomes.find(o=>o.id===obligation.id)!;
        if(![true,false,null].includes(result.passed) || !result.reason?.trim()) throw new Error("invalid_state_verdict");
        if(result.passed===null)return null;
        if(!bound(obs,obligation.observationPointers,result.evidence) ||
          (pair && (result.pairedSha256!==scoringHash(pair)||!bound(pair,obligation.pairedPointers??[],result.pairedEvidence??[]))))
          throw new Error("state_verdict_missing_original_evidence");
        return result.passed;
      };
      const a=byRole.get("reviewer_a"),b=byRole.get("reviewer_b");const first=verdict(a),second=verdict(b);
      if(!a||!b||a.contextId===b.contextId){counter.pending++;continue;}
      let final=first;
      if(first!==second){
        const judge=byRole.get("adjudicator");
        final=judge && ![a.contextId,b.contextId].includes(judge.contextId) && judge.resolvesReviewSha256 &&
          scoringHash(judge.resolvesReviewSha256)===scoringHash([scoringHash(a),scoringHash(b)])?verdict(judge):null;
      }
      if(final===null) counter.pending++; else if(final) counter.passed++; else counter.failed++;
    }
  }
  return perKind;
}
