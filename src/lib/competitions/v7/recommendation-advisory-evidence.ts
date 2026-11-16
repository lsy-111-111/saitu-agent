import "server-only";

import { isDeepStrictEqual } from "node:util";
import type { CatalogFact, CatalogSource, DecisionCompetitionRecord } from "../v6/catalog-types";
import type { DecisionClaimV6, DecisionReportV6, StudentProfileV6 } from "../v6/contracts";
import { evaluateRecordEligibility } from "../v6/eligibility";
import type { DecisionCandidate, DecisionContextV6 } from "../v6/engine";
import { isDecisionEvidenceFact } from "../v6/evidence";
import { activeStudentFacts } from "../v6/profile";
import { RECOMMENDATION_ADVISORY_PREFIXES } from "./recommendation-notes";

export type RecommendationAdvisoryEvidenceV7 = {
  text: string;
  studentFactIds: readonly string[];
  facts: readonly CatalogFact[];
  sources: readonly CatalogSource[];
};

type CandidateWithAdvisories = DecisionCandidate & {
  advisoryEvidence?: {
    claims: DecisionClaimV6[];
    supplementalFactIds: string[];
    supplementalSourceIds: string[];
  };
};

export function createRecommendationAdvisoryEvidenceV7(
  record: DecisionCompetitionRecord, text: string, factIds: readonly string[], studentFactIds: readonly string[],
): RecommendationAdvisoryEvidenceV7 | null {
  const facts = record.facts.filter(fact => factIds.includes(fact.id));
  if (!facts.length || facts.length !== new Set(factIds).size) return null;
  const sourceIds = new Set(facts.flatMap(fact => fact.sourceIds));
  return { text, studentFactIds, facts, sources: record.sources.filter(source => sourceIds.has(source.id)) };
}

export function collectCurrentEligibilityAdvisoryEvidenceV7(
  record: DecisionCompetitionRecord, profile: StudentProfileV6,
): RecommendationAdvisoryEvidenceV7[] {
  const bindings: RecommendationAdvisoryEvidenceV7[] = [];
  evaluateRecordEligibility(record, profile, ({ rule, condition, studentFactIds }) => {
    const binding = createRecommendationAdvisoryEvidenceV7(
      record, RECOMMENDATION_ADVISORY_PREFIXES.eligibility + condition, rule.factIds, studentFactIds,
    );
    if (binding) bindings.push(binding);
  });
  return bindings;
}

export function bindRecommendationAdvisoryEvidenceV7(
  candidate: DecisionCandidate, bindings: readonly RecommendationAdvisoryEvidenceV7[],
): CandidateWithAdvisories {
  const original = candidate.record;
  let record = original;
  const claims = new Map<string, DecisionClaimV6>();
  for (const binding of bindings) {
    const { text, facts, sources } = binding;
    const eligibility = text.startsWith(RECOMMENDATION_ADVISORY_PREFIXES.eligibility);
    if (!candidate.conditions.includes(text) || !facts.length ||
        (!eligibility && !text.startsWith(RECOMMENDATION_ADVISORY_PREFIXES.budget))) continue;
    const existingFacts = new Map(record.facts.map(fact => [fact.id, fact]));
    const existingSources = new Map(record.sources.map(source => [source.id, source]));
    const sourceIds = new Set(facts.flatMap(fact => fact.sourceIds));
    if (new Set(facts.map(fact => fact.id)).size !== facts.length ||
        new Set(sources.map(source => source.id)).size !== sources.length ||
        facts.some(fact => existingFacts.has(fact.id) && !isDeepStrictEqual(fact, existingFacts.get(fact.id))) ||
        sources.some(source => !sourceIds.has(source.id) || !/^https?:\/\//.test(source.url) ||
          existingSources.has(source.id) && !isDeepStrictEqual(source, existingSources.get(source.id)))) continue;

    const extraFacts = facts.filter(fact => !existingFacts.has(fact.id));
    // Supplemental facts may only add scoped eligibility evidence. Budget
    // evidence must come from the record's actual, already verified cost.
    if (extraFacts.some(fact => !eligibility || !fact.entity || !fact.field.startsWith("eligibility"))) continue;
    const extraSources = sources.filter(source => !existingSources.has(source.id));
    const combined = extraFacts.length || extraSources.length ? {
      ...record, facts: [...record.facts, ...extraFacts], sources: [...record.sources, ...extraSources],
    } : record;
    if (facts.some(fact => fact.kind !== "official_fact" || !isDecisionEvidenceFact(combined, fact))) continue;

    const prior = claims.get(text);
    const studentFactIds = [...new Set([...(prior?.studentFactIds ?? []), ...binding.studentFactIds])];
    const competitionFactIds = [...new Set([...(prior?.competitionFactIds ?? []), ...facts.map(fact => fact.id)])];
    claims.set(text, { text, basis: studentFactIds.length ? "inference" : "unknown", studentFactIds, competitionFactIds, conditions: [] });
    record = combined;
  }
  if (!claims.size) return candidate;
  const originalFactIds = new Set(original.facts.map(fact => fact.id));
  const originalSourceIds = new Set(original.sources.map(source => source.id));
  return { ...candidate, record, advisoryEvidence: {
    claims: [...claims.values()],
    supplementalFactIds: record.facts.filter(fact => !originalFactIds.has(fact.id)).map(fact => fact.id),
    supplementalSourceIds: record.sources.filter(source => !originalSourceIds.has(source.id)).map(source => source.id),
  } };
}

/** Match inputs reuse the base competition task facts. */
export function recommendationMatchRecordV7(candidate: CandidateWithAdvisories): DecisionCompetitionRecord {
  const { record, advisoryEvidence } = candidate;
  if (!advisoryEvidence?.supplementalFactIds.length && !advisoryEvidence?.supplementalSourceIds.length) return record;
  const factIds = new Set(advisoryEvidence.supplementalFactIds);
  const sourceIds = new Set(advisoryEvidence.supplementalSourceIds);
  return { ...record, facts: record.facts.filter(fact => !factIds.has(fact.id)), sources: record.sources.filter(source => !sourceIds.has(source.id)) };
}

export function applyRecommendationAdvisoryClaimsV7(
  report: DecisionReportV6, context: DecisionContextV6, readyItemIds?: ReadonlySet<string>,
): DecisionReportV6 {
  const activeIds = new Set(activeStudentFacts(context.profile).map(fact => fact.id));
  let changed = false;
  const recommendations = report.recommendations.map(item => {
    if (readyItemIds && !readyItemIds.has(item.itemId)) return item;
    const candidate: CandidateWithAdvisories | undefined = context.candidates.find(value => value.record.recordId === item.itemId);
    const bindings = candidate?.advisoryEvidence?.claims;
    if (!bindings?.length) return item;
    const itemFactIds = new Set(item.evidenceFacts.map(fact => fact.id));
    const valid = bindings.filter(claim => item.eligibilityNotes.includes(claim.text) &&
      claim.studentFactIds.every(id => activeIds.has(id)) && claim.competitionFactIds.every(id => itemFactIds.has(id)));
    if (!valid.length) return item;
    const byText = new Map(valid.map(claim => [claim.text, claim]));
    const existingText = new Set(item.gaps.map(claim => claim.text));
    const missing = valid.filter(claim => !existingText.has(claim.text));
    changed = true;
    return { ...item, gaps: [...missing, ...item.gaps.map(claim => byText.get(claim.text) ?? claim)].slice(0, 12) };
  });
  return changed ? { ...report, recommendations } : report;
}
