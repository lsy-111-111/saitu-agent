import { createRequire } from "node:module";
import type { ScoringCase, ScoringKey, ProductObservation, ProductSemanticReview } from "./score-product-observations";
const { scoringHash } = createRequire(import.meta.url)("./score-product-observations.ts") as typeof import("./score-product-observations");

export const PROFILE_ATOM_PROTOCOL = Object.freeze({
  schemaVersion: "saitu.profile-atom-protocol.v1",
  unit: "fact_or_explicit_unknown_field", matching: "one_to_one_semantic",
  review: "two_originals_adjudicate_disagreement", slice: "every_templateFamilyId",
  emptyDenominator: "null", failedExtraction: "all_expected_missed",
});
type Pair = { expected: number; observed: number; reason: string };
type AtomReview = ProductSemanticReview & { profileAlignment?: { complete: boolean; goldSha256:string; pairs: Pair[] } };
type Counts = { cases: number; tp: number; fp: number; fn: number };
type ProfileCase = ScoringCase & { templateFamilyId: string };
const zero = (): Counts => ({ cases:0, tp:0, fp:0, fn:0 });
const f1 = (counts: Counts) => {
  const denominator = 2 * counts.tp + counts.fp + counts.fn;
  return denominator ? 2 * counts.tp / denominator : null;
};
const asObject = (x: unknown) => x && typeof x === "object" && !Array.isArray(x) ? x as Record<string,unknown> : {};
function atoms(raw: unknown) {
  const object = asObject(raw);
  if (!Array.isArray(object.facts) || !Array.isArray(object.unknownFields)) return null;
  return [
    ...object.facts.map(value => ({kind:"fact", value})),
    ...object.unknownFields.map(value => ({kind:"unknown", value})),
  ];
}

// The reviewer's list of matched atoms must be exhaustive. Unmatched observed
// atoms are false positives; unmatched expected atoms are false negatives.
function validatedPairs(review: AtomReview | undefined, key: ScoringKey, observation: ProductObservation,
  expected: NonNullable<ReturnType<typeof atoms>>, observed: NonNullable<ReturnType<typeof atoms>>, utterance: unknown,goldSha256:string) {
  if (!review || !review.contextId || review.contextId === key.authorContextId ||
      review.keySha256 !== scoringHash(key) || review.observationSha256 !== scoringHash(observation) ||
      review.repetition !== (observation.repetition ?? 0) || review.caseId !== key.caseId ||
      review.profileAlignment?.goldSha256 !== goldSha256 || review.profileAlignment.complete !== true || !Array.isArray(review.profileAlignment.pairs)) return null;
  const left = new Set<number>(), right = new Set<number>();
  for (const pair of review.profileAlignment.pairs) {
    if (!Number.isSafeInteger(pair.expected) || !Number.isSafeInteger(pair.observed) || !pair.reason?.trim() ||
        !expected[pair.expected] || !observed[pair.observed] || left.has(pair.expected) || right.has(pair.observed) ||
        expected[pair.expected].kind !== observed[pair.observed].kind) throw new Error("invalid_or_reused_atom_alignment");
    const value=observed[pair.observed].value;
    if (observed[pair.observed].kind === "fact") {
      const row=asObject(value);
      if (row.confirmed !== false || typeof utterance !== "string" || typeof row.sourceText !== "string" ||
          !row.sourceText.trim() || !utterance.includes(row.sourceText)) throw new Error("matched_atom_without_student_provenance");
    } else if (typeof value !== "string" || !value) throw new Error("invalid_unknown_field_atom");
    left.add(pair.expected); right.add(pair.observed);
  }
  return review.profileAlignment.pairs.map(({expected,observed})=>[expected,observed]).sort((a,b)=>a[0]-b[0]);
}

export function aggregateProfileAtoms(input: {
  expectedByCase: Map<string,unknown>; cases: ProfileCase[]; keys: ScoringKey[]; observations: ProductObservation[]; reviews: AtomReview[];
}) {
  const total = zero(), slices: Record<string, Counts> = Object.create(null), pending: string[] = [];
  for (const item of input.cases.filter(item=>item.operation==="extract_profile")) {
    const key=input.keys.find(key=>key.caseId===item.caseId);
    const observation=input.observations.find(row=>row.caseId===item.caseId && (row.repetition??0)===0);
    const gold=input.expectedByCase.get(item.caseId);
    const expected=atoms(gold);
    if (!key || !expected || !item.templateFamilyId || key.annotationStatus!=="adjudicated" ||
        !observation || observation.status==="not_run" || observation.inputSha256!==scoringHash(item.input)) {
      pending.push(item.caseId); continue;
    }
    const observed=observation.status==="error" ? [] : atoms(observation.output);
    if (!observed) { pending.push(item.caseId); continue; }
    let tp=0;
    if (observation.status!=="error") {
      const reviews=input.reviews.filter(r=>r.caseId===item.caseId && r.repetition===0);
      const original=(role:AtomReview["role"])=>{
        const matches=reviews.filter(row=>row.role===role);
        return matches.length===1 ? matches[0] : undefined;
      };
      const a=original("reviewer_a"), b=original("reviewer_b"), utterance=asObject(item.input).utterance;
      const first=validatedPairs(a,key,observation,expected,observed,utterance,scoringHash(gold));
      const second=validatedPairs(b,key,observation,expected,observed,utterance,scoringHash(gold));
      if (!a || !b || a.contextId===b.contextId || !first || !second) { pending.push(item.caseId); continue; }
      if (scoringHash(first)===scoringHash(second)) tp=first.length;
      else {
        const judge=original("adjudicator");
        const third=validatedPairs(judge,key,observation,expected,observed,utterance,scoringHash(gold));
        if (!judge || !third || [a.contextId,b.contextId].includes(judge.contextId) ||
            !judge.resolvesReviewSha256 || scoringHash(judge.resolvesReviewSha256)!==scoringHash([scoringHash(a),scoringHash(b)])) {
          pending.push(item.caseId); continue;
        }
        tp=third.length;
      }
    }
    for (const counter of [total,slices[item.templateFamilyId]??=zero()]) {
      counter.cases++; counter.tp+=tp; counter.fn+=expected.length-tp; counter.fp+=observed.length-tp;
    }
  }
  const scores=Object.entries(slices).map(([name,counts])=>({name,...counts,f1:f1(counts)}));
  const complete=pending.length===0 && total.cases===120;
  return {total,pending,slices:scores,complete, microF1:complete?f1(total):null,
    minimumSliceF1:complete && scores.length && scores.every(s=>s.f1!==null) ? Math.min(...scores.map(s=>s.f1!)):null};
}
