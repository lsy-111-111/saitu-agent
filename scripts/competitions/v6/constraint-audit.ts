import { createRequire } from "node:module";
import type { ScoringCase, ScoringKey, ProductObservation, ProductSemanticReview, FrozenScoringSource, BoundEvidence } from "./score-product-observations";
const {scoringHash,scoringPointer}=createRequire(import.meta.url)("./score-product-observations.ts") as typeof import("./score-product-observations");

export const CONSTRAINT_PROTOCOL = "all_300_source_scoped_conditions_two_original_reviews.v1";
type ConstraintReview = ProductSemanticReview & {hardConstraintAudit?: {
  violated: boolean; reason:string; evidence:BoundEvidence[];
  sources: {sourceId:string; bodySha256:string; quote:string}[];
}};
export function aggregateConstraintAudit(bundle:{cases:ScoringCase[];keys:ScoringKey[];observations:ProductObservation[];
  reviews:ConstraintReview[];sources:FrozenScoringSource[]}) {
  const pending:string[]=[], violations:string[]=[];
  let assessed=0;
  for(const item of bundle.cases.filter(row=>row.operation==="qualify")) {
    const key=bundle.keys.find(row=>row.caseId===item.caseId);
    const obs=bundle.observations.find(row=>row.caseId===item.caseId && (row.repetition??0)===0);
    if (!key || key.annotationStatus!=="adjudicated" || !obs || obs.status!=="observed" || obs.inputSha256!==scoringHash(item.input)) {
      pending.push(item.caseId); continue;
    }
    const rows=bundle.reviews.filter(row=>row.caseId===item.caseId && row.repetition===0);
    const original=(role:ProductSemanticReview["role"])=>{
      const matches=rows.filter(row=>row.role===role); return matches.length===1?matches[0]:undefined;
    };
    const verdict=(review:ConstraintReview|undefined)=>{
      const audit=review?.hardConstraintAudit;
      if (!review || !audit || typeof audit.violated!=="boolean" || !audit.reason?.trim() ||
          !review.contextId || review.contextId===key.authorContextId || review.keySha256!==scoringHash(key) ||
          review.observationSha256!==scoringHash(obs) || !audit.evidence?.length || !audit.sources?.length) return null;
      for (const point of audit.evidence) {
        if (!point.pointer.startsWith("/output/") || scoringHash(scoringPointer(obs,point.pointer))!==point.valueSha256)
          throw new Error("constraint_verdict_not_bound_to_displayed_output");
      }
      const allowed=(item.input as {evidenceIds?:string[]}).evidenceIds??[];
      for (const cited of audit.sources) {
        const source=bundle.sources.find(row=>row.sourceId===cited.sourceId);
        if (!allowed.includes(cited.sourceId) || !source || source.bodySha256!==cited.bodySha256 || !cited.quote?.trim() || !source.body.includes(cited.quote))
          throw new Error("constraint_verdict_not_bound_to_case_source");
      }
      return audit.violated;
    };
    const a=original("reviewer_a"), b=original("reviewer_b"), av=verdict(a),bv=verdict(b);
    if (!a || !b || a.contextId===b.contextId || av===null || bv===null) {pending.push(item.caseId);continue;}
    let violation=av;
    if(av!==bv) {
      const judge=original("adjudicator"), value=verdict(judge);
      if (!judge || value===null || [a.contextId,b.contextId].includes(judge.contextId) ||
          !judge.resolvesReviewSha256 || scoringHash(judge.resolvesReviewSha256)!==scoringHash([scoringHash(a),scoringHash(b)])) {
        pending.push(item.caseId);continue;
      }
      violation=value;
    }
    const normalized=(label:unknown) => ["satisfied","meets_target"].includes(String(label)) ? "satisfied" :
      ["violated","fails_target","not_satisfied"].includes(String(label))?"violated":label;
    const expected=normalized((key.scoring.expected as {decision?:string})?.decision);
    const actual=normalized((obs.output as {decision?:string})?.decision);
    // An expressed approval of a violated or unknown condition always counts,
    // including when both reviewers incorrectly marked it harmless.
    const unsafePass=actual==="satisfied" && (expected==="violated" || expected==="unknown");
    assessed++; if (violation || unsafePass) violations.push(item.caseId);
  }
  return {assessed,pending,violations,complete:assessed===300 && !pending.length};
}
