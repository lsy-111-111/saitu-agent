import { createRequire } from "node:module";
import type { ScoringCase, ProductObservation, FrozenScoringSource } from "./score-product-observations";
const {scoringHash}=createRequire(import.meta.url)("./score-product-observations.ts") as typeof import("./score-product-observations");

export const FACT_AUDIT_PROTOCOL = "all_100_factual_plus_first_selected_report_of_all_120_review_every_passage.v1";
type Proof={sourceId:string; bodySha256:string; quote:string; scope:string};
type Atom={start:number;end:number;truth:"supported"|"contradicted"|"unverified";critical:boolean;needsCitation:boolean;proof:Proof[];
  citations:{sourceId:string; supports:boolean;proof:Proof[]}[];reason:string};
type PassageReview={pointer:string; textSha256:string; complete:boolean; atoms:Atom[]};
type Audit={caseId:string;role:"reviewer_a"|"reviewer_b"|"adjudicator";contextId:string;observationSha256:string;
  passages:PassageReview[];resolvesReviewSha256?:[string,string]};
type Passage={pointer:string;text:string; citations:string[]; allowedSources:string[]};
type Identity={caseId:string; reviewerContextIds:[string,string];adjudicatorContextId?:string;authorContextId:string};
const record=(value:unknown)=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
const list=(value:unknown)=>Array.isArray(value)?value:[];
const strings=(value:unknown)=>list(value).filter((s):s is string=>typeof s==="string");
const distinct=(items:string[])=>[...new Set(items)].sort();
function passages(item:ScoringCase, observation:ProductObservation) {
  const raw=record(observation.output), input=record(item.input), result:Passage[]=[];
  const add=(pointer:string,text:unknown,citations:string[],sources:string[])=>{
    if(typeof text!=="string" || !text.trim()) throw new Error("missing_raw_fact_audit_passage");
    result.push({pointer,text,citations:distinct(citations),allowedSources:distinct(sources)});
  };
  if(item.operation==="fact_check") {
    const judgments=list(raw.judgments).map(record), claims=list(input.claims).map(record);
    if(!claims.length || judgments.length!==claims.length || new Set(judgments.map(j=>j.id)).size!==claims.length) throw new Error("incomplete_fact_audit_judgments");
    for(const [index,row] of judgments.entries()) {
      const claim=claims.find(c=>c.id===row.id);if(!claim) throw new Error("unbound_fact_audit_claim");
      const cited=list(row.evidence).map(e=>String(record(e).sourceId));const base="/output/judgments/"+index;
      add(base+"/reason",row.reason,cited,strings(input.evidenceIds));
      // Bind the status and actual proposition, so a plausible reason cannot
      // conceal a wrong supported/contradicted/unknown label.
      add(base+"/status",String(row.status)+" · "+String(claim.text),cited,strings(input.evidenceIds));
    }
  } else {
    for(const [index,rawItem] of list(raw.recommendations).entries()){
      const recommendation=record(rawItem),base="/output/recommendations/"+index;
      const sources=list(recommendation.sources).map(s=>String(record(s).id));
      const facts=list(recommendation.evidenceFacts).map(record);
      function collect(value:unknown,pointer:string) {
        if (Array.isArray(value)) {value.forEach((v,i)=>collect(v,pointer+"/"+i));return;}
        const object=record(value);
        if (typeof object.text==="string" && Array.isArray(object.competitionFactIds)) {
          const cited=strings(object.competitionFactIds).flatMap(id=>strings(facts.find(f=>f.id===id)?.sourceIds));
          add(pointer+"/text",object.text,cited,sources);return;
        }
        for(const [name,member] of Object.entries(object)) collect(member,pointer+"/"+name);
      }
      for (const field of ["coreTask","reasons","currentRole","gaps","values","difficulty","opportunityCost","nextStep"])
        collect(recommendation[field],base+"/"+field);
      for (const [i,note] of list(recommendation.eligibilityNotes).entries()) add(base+"/eligibilityNotes/"+i,note,[],sources);
      const registration=record(recommendation.registration);
      add(base+"/registration/note",registration.note,[],sources);
    }
  }
  return result;
}
function checkProof(proof:Proof, allowed:string[], sources:Map<string,FrozenScoringSource>) {
  const source=sources.get(proof.sourceId);
  if(!allowed.includes(proof.sourceId) || !source || !proof.quote?.trim() || !source.body.includes(proof.quote) ||
     proof.scope!==source.scope || proof.bodySha256!==source.bodySha256) throw new Error("fact_audit_evidence_source_scope_or_bytes_changed");
}
function evaluateReview(row:Audit, original:Passage[], sources:Map<string,FrozenScoringSource>) {
  if (!Array.isArray(row.passages) || row.passages.length!==original.length ||
      new Set(row.passages.map(p=>p.pointer)).size!==original.length) throw new Error("fact_audit_missing_or_duplicate_passage");
  const atoms=[];
  for(const passage of original){
    const review=row.passages.find(p=>p.pointer===passage.pointer);
    if(!review || review.complete!==true || review.textSha256!==scoringHash(passage.text) || !Array.isArray(review.atoms)) throw new Error("incomplete_or_changed_fact_passage");
    const seen=new Set<string>();
    for (const atom of review.atoms) {
      const span=atom.start+":"+atom.end;
      if(seen.has(span) || !Number.isInteger(atom.start) || !Number.isInteger(atom.end) || atom.start<0 || atom.end<=atom.start || atom.end>passage.text.length ||
         !passage.text.slice(atom.start,atom.end).trim() || !["supported","contradicted","unverified"].includes(atom.truth) || ![atom.critical,atom.needsCitation].every(v=>typeof v==="boolean") ||
         !atom.reason?.trim() || !Array.isArray(atom.proof) || !Array.isArray(atom.citations)) throw new Error("invalid_factual_atom");
      seen.add(span);
      if(atom.truth!=="unverified" && !atom.proof.length) throw new Error("semantic_fact_verdict_needs_frozen_proof");
      for(const proof of atom.proof) checkProof(proof,passage.allowedSources,sources);
      const ids=atom.citations.map(c=>c.sourceId);
      if(new Set(ids).size!==ids.length || JSON.stringify([...ids].sort())!==JSON.stringify(passage.citations)) throw new Error("fact_audit_dropped_or_invented_displayed_citation");
      const citations=atom.citations.map(c=>{
        if(typeof c.supports!=="boolean" || !Array.isArray(c.proof) || c.supports&&!c.proof.length) throw new Error("unsupported_citation_audit");
        for(const proof of c.proof){checkProof(proof,[c.sourceId],sources);}
        return {id:c.sourceId,supports:c.supports};
      }).sort((a,b)=>a.id.localeCompare(b.id));
      atoms.push({pointer:passage.pointer,start:atom.start,end:atom.end,truth:atom.truth,critical:atom.critical,needsCitation:atom.needsCitation,citations});
    }
  }
  return atoms.sort((a,b)=>a.pointer.localeCompare(b.pointer)||a.start-b.start||a.end-b.end);
}
export function aggregateFactAudit(input:{cases:ScoringCase[];identities:Identity[];observations:ProductObservation[];sources:FrozenScoringSource[];reviews:Audit[]}) {
  const sources=new Map(input.sources.map(row=>[row.sourceId,row]));
  const cases=input.cases.filter(row=>["fact_check","recommend"].includes(row.operation));
  if (input.reviews.some(review=>!cases.some(item=>item.caseId===review.caseId))) throw new Error("fact_review_outside_registered_cases");
  const counts={assessed:0,factualCases:0,rankingCases:0,passages:0,atoms:0,accurate:0,contradicted:0,unverified:0,criticalErrors:0,criticalUnverified:0,citations:0,supported:0,required:0,covered:0,criticalRequired:0,criticalCovered:0};
  const pending:string[]=[];
  for (const item of cases) {
    const observation=input.observations.find(o=>o.caseId===item.caseId && (o.repetition??0)===0);
    const identity=input.identities.find(row=>row.caseId===item.caseId);
    if(!identity || !observation || observation.status!=="observed" || observation.inputSha256!==scoringHash(item.input)) {pending.push(item.caseId);continue;}
    const original=passages(item,observation), rows=input.reviews.filter(row=>row.caseId===item.caseId);
    const roles=new Map(rows.map(row=>[row.role,row]));
    if(roles.size!==rows.length || rows.some(r=>!(["reviewer_a","reviewer_b","adjudicator"] as string[]).includes(r.role))) throw new Error("invalid_fact_reviewer_roles");
    const a=roles.get("reviewer_a"), b=roles.get("reviewer_b"), judge=roles.get("adjudicator");
    const hash=scoringHash(observation);
    if(rows.some(r=>r.observationSha256!==hash || !r.contextId || r.contextId===identity.authorContextId ||
        r.contextId!==(r.role==="reviewer_a"?identity.reviewerContextIds[0]:r.role==="reviewer_b"?identity.reviewerContextIds[1]:identity.adjudicatorContextId))) throw new Error("unbound_fact_audit_reviewer");
    if(!a || !b || a.contextId===b.contextId){pending.push(item.caseId);continue;}
    const left=evaluateReview(a,original,sources), right=evaluateReview(b,original,sources);
    let accepted=left;
    if(scoringHash(left)!==scoringHash(right)){
      if(!judge || [a.contextId,b.contextId].includes(judge.contextId) || !judge.resolvesReviewSha256 ||
         scoringHash(judge.resolvesReviewSha256)!==scoringHash([scoringHash(a),scoringHash(b)])){pending.push(item.caseId);continue;}
      accepted=evaluateReview(judge,original,sources);
    }
    counts.assessed++; counts.passages+=original.length;
    if(item.operation==="recommend") counts.rankingCases++; else counts.factualCases++;
    for(const atom of accepted) {
      const covered=atom.citations.some(c=>c.supports);
      counts.atoms++;counts.accurate+=Number(atom.truth==="supported");
      counts.contradicted+=Number(atom.truth==="contradicted");counts.unverified+=Number(atom.truth==="unverified");
      counts.criticalErrors+=Number(atom.critical&&atom.truth==="contradicted");counts.criticalUnverified+=Number(atom.critical&&atom.truth==="unverified");
      counts.citations+=atom.citations.length;counts.supported+=atom.citations.filter(c=>c.supports).length;
      if(atom.needsCitation||atom.critical) {
        counts.required++;counts.covered+=Number(covered);
        if(atom.critical) {counts.criticalRequired++;counts.criticalCovered+=Number(covered);}
      }
    }
  }
  return {counts,pending,complete:!pending.length && counts.factualCases===100 && counts.rankingCases===120};
}
