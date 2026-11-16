import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

type ObjectValue = Record<string, unknown>;
type Outcome = "passed" | "failed" | "pending";
export type ScoringCase = { caseId: string; operation: string; input: unknown };
export type ScoringKey = { caseId: string; authorContextId: string; annotationStatus: "adjudicated" | "pending"; scoring: ObjectValue };
export type ProductObservation = {
  caseId: string; operation: string; inputSha256: string; status: "observed" | "not_run" | "error";
  output: unknown; events: unknown[]; repetition?: number; [key: string]: unknown;
};
export type BoundEvidence = { pointer: string; valueSha256: string };
export type SemanticDecision = {
  rulePointer: string; status: Outcome; reason: string; observations: BoundEvidence[];
  sources: { sourceId: string; bodySha256: string; quote: string }[];
};
/** Reviews are collected in separate contexts after opening, never from the product itself. */
export type ProductSemanticReview = {
  caseId: string; repetition: number; contextId: string; role: "reviewer_a" | "reviewer_b" | "adjudicator";
  keySha256: string; observationSha256: string; decisions: SemanticDecision[];
  resolvesReviewSha256?: [string, string];
};
export type FrozenScoringSource = { sourceId: string; scope: string; body: string; bodySha256: string };
type Check = { id: string; status: Outcome; reason: string };
const object = (value: unknown): ObjectValue => value !== null && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const strings = (value: unknown) => array(value).filter((item): item is string => typeof item === "string");
const assert = (condition: unknown, message: string): void => { if (!condition) throw new Error(message); };
const unique = (values: unknown[]) => new Set(values).size === values.length;
function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype)
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as ObjectValue)[key])}`).join(",")}}`;
  throw new Error("non_json_scoring_input");
}
export const scoringHash = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
const textHash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const conditionLabel = (value: unknown) => {
  if (["satisfied", "meets_target"].includes(String(value))) return "satisfied";
  if (["violated", "fails_target", "not_satisfied"].includes(String(value))) return "violated";
  return value === "unknown" ? "unknown" : null;
};
/** RFC6901 lookup rejects prototype traversal and absent values rather than inventing nulls. */
export function scoringPointer(value: unknown, pointer: string): unknown {
  if (pointer === "") return value;
  assert(pointer.startsWith("/"), "invalid_pointer");
  let current = value;
  for (const token of pointer.slice(1).split("/")) {
    assert(!/~(?:[^01]|$)/.test(token), "invalid_pointer_escape");
    const part = token.replace(/~1/g, "/").replace(/~0/g, "~");
    assert(!["__proto__", "prototype", "constructor"].includes(part), "unsafe_pointer");
    assert(current !== null && typeof current === "object" && Object.hasOwn(current, part), "missing_pointer");
    current = (current as ObjectValue)[part];
  }
  return current;
}

/** No keyword matching or literal exemplar equality substitutes for semantic judgment. */
export function semanticRulePointers(key: ScoringKey): string[] {
  const rules: string[] = [];
  const addList = (value: unknown, prefix: string) => array(value).forEach((_, index) => rules.push(`${prefix}/${index}`));
  addList(key.scoring.required, "/scoring/required");
  addList(key.scoring.forbidden, "/scoring/forbidden");
  addList(key.scoring.rubric, "/scoring/rubric");
  const expected = object(key.scoring.expected);
  if (Array.isArray(expected.facts)) rules.push("/scoring/expected/facts");
  if (Array.isArray(expected.unknownFields)) rules.push("/scoring/expected/unknownFields");
  array(key.scoring.checkpoints).forEach((checkpoint, index) => {
    const row = object(checkpoint), prefix = `/scoring/checkpoints/${index}`;
    for (const field of ["expected", "unknownFields", "changedFields"]) if (Object.hasOwn(row, field)) rules.push(`${prefix}/${field}`);
    addList(row.required, `${prefix}/required`); addList(row.forbidden, `${prefix}/forbidden`);
  });
  // Metamorphic values refer to measured state, not similarly named input injection fields.
  if (!Object.hasOwn(expected, "decision") && !Object.hasOwn(expected, "judgments") && !Object.hasOwn(expected, "facts") && Object.keys(expected).length)
    rules.push("/scoring/expected");
  if (!rules.length) rules.push("/scoring");
  return [...new Set(rules)];
}

function reviewValidity(review: ProductSemanticReview, key: ScoringKey, observation: ProductObservation, sources: Map<string, FrozenScoringSource>, rules: string[]): string[] {
  const errors: string[] = [];
  if (!review.contextId || review.contextId === key.authorContextId) errors.push("author_cannot_review_own_output");
  if (review.caseId !== key.caseId || review.repetition !== (observation.repetition ?? 0) || review.keySha256 !== scoringHash(key) || review.observationSha256 !== scoringHash(observation)) errors.push("review_binding_mismatch");
  if (!unique(review.decisions.map(row => row.rulePointer)) || review.decisions.length !== rules.length || rules.some(rule => !review.decisions.some(row => row.rulePointer === rule))) errors.push("incomplete_semantic_rule_coverage");
  for (const decision of review.decisions) {
    if (!["passed", "failed", "pending"].includes(decision.status) || !decision.reason.trim()) errors.push("invalid_semantic_verdict");
    if (decision.status !== "pending" && !decision.observations.length) errors.push("verdict_without_observed_evidence");
    for (const evidence of decision.observations) {
      try { if (scoringHash(scoringPointer(observation, evidence.pointer)) !== evidence.valueSha256) errors.push("observation_evidence_changed"); }
      catch { errors.push("observation_evidence_absent"); }
    }
    for (const evidence of decision.sources) {
      const source = sources.get(evidence.sourceId);
      if (!source || source.bodySha256 !== evidence.bodySha256 || !evidence.quote || !source.body.includes(evidence.quote)) errors.push("source_evidence_absent_or_changed");
    }
    if (["qualify", "fact_check"].includes(observation.operation) && decision.status === "passed" && !decision.sources.length) errors.push("source_based_pass_without_source_evidence");
  }
  return [...new Set(errors)];
}

function semanticChecks(key: ScoringKey, observation: ProductObservation, allReviews: ProductSemanticReview[], sources: Map<string, FrozenScoringSource>): Check[] {
  const rules = semanticRulePointers(key), reviews = allReviews.filter(review => review.caseId === key.caseId && review.repetition === (observation.repetition ?? 0));
  const byRole = (role: ProductSemanticReview["role"]) => reviews.filter(review => review.role === role);
  const a = byRole("reviewer_a"), b = byRole("reviewer_b"), adjudicators = byRole("adjudicator");
  if (a.length !== 1 || b.length !== 1 || a[0].contextId === b[0].contextId)
    return rules.map(id => ({id, status:"pending", reason:"two_separate_semantic_reviews_required"}));
  const invalid = [...reviewValidity(a[0], key, observation, sources, rules), ...reviewValidity(b[0], key, observation, sources, rules)];
  if (invalid.length) return rules.map(id => ({id, status:"pending", reason:invalid.join(",")}));
  const validAdjudicator = adjudicators.length === 1 && ![a[0].contextId, b[0].contextId, key.authorContextId].includes(adjudicators[0].contextId)
    && !reviewValidity(adjudicators[0], key, observation, sources, rules).length
    && Array.isArray(adjudicators[0].resolvesReviewSha256)
    && canonical(adjudicators[0].resolvesReviewSha256) === canonical([scoringHash(a[0]), scoringHash(b[0])]);
  return rules.map(id => {
    const left = a[0].decisions.find(row => row.rulePointer === id)!, right = b[0].decisions.find(row => row.rulePointer === id)!;
    if (left.status === right.status) return {id, status:left.status, reason:"two_reviewers_agree"};
    if (validAdjudicator) return {id, status:adjudicators[0].decisions.find(row => row.rulePointer === id)!.status, reason:"fresh_adjudication_bound_to_both_reviews"};
    return {id, status:"pending", reason:"unresolved_semantic_disagreement"};
  });
}

function structuralChecks(item: ScoringCase, key: ScoringKey, observation: ProductObservation, sources: Map<string, FrozenScoringSource>): Check[] {
  const checks: Check[] = [], output = object(observation.output), input = object(item.input), expected = object(key.scoring.expected);
  const add = (id: string, passed: boolean, reason: string) => checks.push({id,status:passed?"passed":"failed",reason});
  add("invocation_binding", observation.operation === item.operation && observation.inputSha256 === scoringHash(item.input), "operation_and_exact_input_hash");
  const quotes = (rows: unknown[], requireQuote: boolean) => {
    if (requireQuote && !rows.length) return false;
    return rows.every(raw => { const row = object(raw), source = sources.get(String(row.sourceId));
      return source && typeof row.quote === "string" && row.quote.length > 0 && source.body.includes(row.quote) && (row.scope === undefined || row.scope === source.scope); });
  };
  if (item.operation === "qualify") {
    add("condition_decision", conditionLabel(expected.decision) !== null && conditionLabel(output.decision) === conditionLabel(expected.decision), "only_frozen_public_condition_label_equivalences");
    add("condition_scope", output.targetKind === object(input.target).kind && output.scope === input.editionScope, "condition_kind_and_edition_remain_bound");
    add("condition_quotes", quotes(array(output.evidence), output.decision !== "unknown"), "non_unknown_requires_frozen_source_quote");
  } else if (item.operation === "fact_check") {
    const actual = array(output.judgments).map(object), target = array(expected.judgments).map(object);
    add("claim_identity", unique(actual.map(row=>row.id)) && actual.length===target.length && target.every(row=>actual.some(value=>value.id===row.id)), "claims_joined_by_id_not_order");
    for (const row of target) {
      const found = actual.find(value=>value.id===row.id);
      add(`claim_label:${row.id}`, Boolean(found && found.status === row.status), "exact_supported_contradicted_unknown_label");
      add(`claim_quote:${row.id}`, Boolean(found && quotes(array(found.evidence), found.status !== "unknown")), "quote_presence_does_not_itself_prove_support");
    }
  } else if (item.operation === "extract_profile") {
    const facts = array(output.facts).map(object), utterance = String(input.utterance ?? "");
    add("profile_shape", Array.isArray(output.facts) && Array.isArray(output.unknownFields), "explicit_facts_and_unknown_fields");
    for (let index=0;index<facts.length;index++) {
      const fact=facts[index];
      add(`fact_provenance:${index}`, typeof fact.sourceText === "string" && fact.sourceText.length>0 && utterance.includes(fact.sourceText), "actual_contiguous_user_text_required");
      add(`fact_confirmation:${index}`, fact.confirmed===false, "extraction_cannot_confirm_for_student");
    }
  } else if (item.operation === "conversation") {
    const states = array(output.states).map(object), checkpoints = array(key.scoring.checkpoints).map(object);
    add("all_checkpoints", states.length===checkpoints.length && unique(states.map(row=>row.afterTurn)) && checkpoints.every(row=>states.some(state=>state.afterTurn===row.afterTurn)), "every_checkpoint_including_first_must_exist");
    const turns=array(input.turns).map(object);
    for (const state of states) {
      const at=typeof state.afterTurn === "number" ? state.afterTurn-1 : turns.findIndex(turn=>turn.id===state.afterTurn);
      const prefix=turns.slice(0,at+1).map(turn=>String(turn.text));
      const initial=array(input.initialFacts).map(object);
      add(`checkpoint_provenance:${state.afterTurn}`, array(state.facts).every(raw=>{const fact=object(raw);return initial.some(old=>scoringHash(old)===scoringHash(fact)) || typeof fact.sourceText==="string" && fact.sourceText.length>0 && prefix.some(text=>text.includes(String(fact.sourceText)));}), "state_cannot_cite_future_turns");
    }
  } else if (item.operation === "robustness") {
    add("real_dispatch", observation.events.some(raw=>object(raw).type==="request_dispatch"), "wrapper_event_is_execution_coverage_not_safety_success");
  }
  return checks;
}

export function scoreProductObservations(input: { cases: ScoringCase[]; keys: ScoringKey[]; observations: ProductObservation[]; semanticReviews: ProductSemanticReview[]; sources: FrozenScoringSource[]; expectedRankingRepeats: 5 }) {
  assert(input.cases.length>0 && unique(input.cases.map(row=>row.caseId)), "unique_nonempty_cases_required");
  assert(input.cases.every(row=>Boolean(row.caseId) && ["qualify","fact_check","extract_profile","conversation","recommend","robustness"].includes(row.operation)), "invalid_case_operation");
  assert(unique(input.keys.map(row=>row.caseId)) && input.keys.length===input.cases.length && input.cases.every(row=>input.keys.some(key=>key.caseId===row.caseId)), "case_key_bijection_required");
  assert(input.expectedRankingRepeats===5, "ranking_requires_five_runs");
  assert(unique(input.sources.map(row=>row.sourceId)) && input.sources.every(source=>textHash(source.body)===source.bodySha256), "frozen_source_body_hash_mismatch");
  assert(unique(input.observations.map(row=>`${row.caseId}:${row.repetition??0}`)) && input.observations.every(row=>input.cases.some(item=>item.caseId===row.caseId)), "duplicate_or_extra_observation");
  assert(input.observations.every(row=>["observed","not_run","error"].includes(row.status) && Array.isArray(row.events)), "invalid_observation_status_or_trace");
  const sources=new Map(input.sources.map(source=>[source.sourceId,source]));
  const results=input.cases.map(item=>{
    const key=input.keys.find(row=>row.caseId===item.caseId)!, expectedRuns=item.operation==="recommend"?5:1;
    const observations=input.observations.filter(row=>row.caseId===item.caseId);
    assert(observations.every(row=>Number.isInteger(row.repetition??0) && (row.repetition??0)>=0 && (row.repetition??0)<expectedRuns), "unregistered_repetition");
    const runs=Array.from({length:expectedRuns},(_,repetition)=>{
      const observation=observations.find(row=>(row.repetition??0)===repetition);
      if(!observation || observation.status==="not_run") return {repetition,status:"not_run",checks:[] as Check[],observationSha256:observation?scoringHash(observation):null};
      if(observation.status==="error") return {repetition,status:"failed",checks:[{id:"execution",status:"failed" as const,reason:"actual_product_error"}],observationSha256:scoringHash(observation)};
      if(key.annotationStatus!=="adjudicated") return {repetition,status:"pending",checks:[{id:"annotation_readiness",status:"pending" as const,reason:"frozen_key_unresolved_or_readiness_missing"}],observationSha256:scoringHash(observation)};
      const checks=structuralChecks(item,key,observation,sources);
      if(item.operation==="recommend") checks.push({id:"independent_full_pool_labels",status:"pending",reason:"use_evaluate_rankings_with_five_runs_and_adjudicated_complete_pool_never_null_labels"});
      else checks.push(...semanticChecks(key,observation,input.semanticReviews,sources));
      return {repetition,status:checks.some(check=>check.status==="failed")?"failed":checks.some(check=>check.status==="pending")?"pending":"passed",checks,observationSha256:scoringHash(observation)};
    });
    return {caseId:item.caseId,operation:item.operation,keySha256:scoringHash(key),status:runs.some(run=>run.status==="failed")?"failed":runs.some(run=>run.status==="not_run")?"not_run":runs.some(run=>run.status==="pending")?"pending":"passed",runs};
  });
  const counts=Object.fromEntries(["passed","failed","not_run","pending"].map(status=>[status,results.filter(row=>row.status===status).length]));
  return {schemaVersion:"saitu.observation-scoring.v1",cases:results,counts,denominator:input.cases.length,allPassed:results.every(row=>row.status==="passed"),productAcceptance:false,
    limitations:["Label/quote checks cannot replace meaning or source-scope judgment.","Two process-separated AI judgments are not human gold.","Ranking, profile F1, citations and product performance retain their separate preregistered aggregate protocols."]};
}

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const inputIndex=process.argv.indexOf("--input"), outputIndex=process.argv.indexOf("--output"), hashIndex=process.argv.indexOf("--input-sha256");
  if(!process.argv.includes("--open") || inputIndex<0 || outputIndex<0 || hashIndex<0) throw new Error("usage: --open --input OPENED_SCORING_BUNDLE.json --input-sha256 SHA --output NEW_RESULT.json");
  const bytes=readFileSync(process.argv[inputIndex+1]);
  if(createHash("sha256").update(bytes).digest("hex")!==process.argv[hashIndex+1]) throw new Error("scoring_bundle_bytes_changed");
  const result=scoreProductObservations(JSON.parse(bytes.toString("utf8")));
  writeFileSync(process.argv[outputIndex+1],JSON.stringify(result,null,2)+"\n",{flag:"wx",mode:0o600});
  if(!result.allPassed) process.exitCode=1;
}
