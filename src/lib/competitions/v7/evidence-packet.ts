import type { CatalogFact, DecisionClaim, DecisionCompetitionRecord } from "../v6/catalog-types";
import type { DecisionClaimV6, MatchPlanV6, StudentFactV6 } from "../v6/contracts";
import { assembleDecisionReport, type DecisionContextV6 } from "../v6/engine";
import { validateDecisionClaims } from "../v6/validation";
import { isDecisionEvidenceFact } from "../v6/evidence";
import { compactCandidateEvidence } from "../v6/model-evidence-pack";
import { compactMatchingTables } from "../v6/model-match-tables";

export type ReviewAssertionV7 = { key: string; itemId: string; reason: DecisionClaimV6 };
const boundaryUse = "conditions_and_counterevidence_only_not_positive_support" as const;
const identity = (record: DecisionCompetitionRecord) => ({ itemId: record.recordId, name: record.name, edition: record.edition, track: record.track, scope: record.scope });
export const EDITORIAL_ADVICE_USE_V7 = "optional_editorial_advice_not_official_requirement" as const;

/** A real task's origin does not make an authored solution an official method.
 * Keep the original boundary verbatim and outside positive cited-fact support. */
export function sourceBoundaryV7(record: DecisionCompetitionRecord) {
  const example = record.deepDive?.workedExample;
  return example?.sourceBoundary ? { sourceBoundary: example.sourceBoundary, origin: example.origin,
    originMeaning: "origin_of_example_task_not_official_status_of_solution_steps", sourceIds: [...example.sourceIds], scope: record.scope, use: boundaryUse } : null;
}
export function explanationSectionsV7(record: DecisionCompetitionRecord) {
  return Object.fromEntries(Object.entries(record.sections).map(([module, claims]) => [module, claims.map(value => value.kind === "editorial_inference"
    ? { ...structuredClone(value), use: EDITORIAL_ADVICE_USE_V7, factIdsArePremisesOnly: true }
    : structuredClone(value))]));
}
export function explanationRolesV7(record: DecisionCompetitionRecord) {
  return record.roles.map((role, roleIndex) => ({ roleIndex, ...structuredClone(role), kind: "editorial_inference" as const,
    use: EDITORIAL_ADVICE_USE_V7, factIdsArePremisesOnly: true }));
}
type SectionProjectionCoverageV7 = {
  path: string; original: DecisionClaim;
  rule: "exact_official_fact" | "exact_role_skill_template" | "exact_editorial_assessment";
  coveredBy: string[];
};
/** Optional wire projection only. Unrecognized text is retained. Every omitted
 * sentence is reproduced by unchanged same-owner material that generation
 * already receives; conditions, unknowns and resource/entry modules stay whole.
 * The full helper and frozen record remain unchanged for review and audit. */
export function auditExplanationSectionProjectionV7(record: DecisionCompetitionRecord) {
  const full = explanationSectionsV7(record), facts = record.facts.filter(fact => isDecisionEvidenceFact(record, fact));
  const omitted: SectionProjectionCoverageV7[] = [];
  const retained: { path: string; original: DecisionClaim; reason: "protected_module" | "condition_or_unknown" | "no_exact_coverage" }[] = [];
  const sections = Object.fromEntries(Object.entries(full).map(([module, claims]) => [module, claims.filter((value, index) => {
    const path = `/sections/${module}/${index}`;
    const keep = (reason: typeof retained[number]["reason"]) => { retained.push({ path, original: structuredClone(value), reason }); return true; };
    if (["investment", "eligibility", "participation", "difficulty"].includes(module)) return keep("protected_module");
    if (value.conditions.length || value.kind === "unknown" || value.unknownReason) return keep("condition_or_unknown");
    if (Object.keys(value).some(key => !["text", "kind", "factIds", "conditions", "unknownReason", "use", "factIdsArePremisesOnly"].includes(key))) return keep("no_exact_coverage");
    let coverage: Omit<SectionProjectionCoverageV7, "path" | "original"> | undefined;
    if (value.kind === "official_fact" && value.factIds.length === 1) {
      const matches = facts.map((fact, factIndex) => ({ fact, factIndex })).filter(({ fact }) => fact.id === value.factIds[0]);
      if (matches.length === 1 && matches[0].fact.kind === value.kind && matches[0].fact.text === value.text
          && matches[0].fact.sourceIds.every(id => record.sources.filter(source => source.id === id).length === 1)) {
        coverage = { rule: "exact_official_fact", coveredBy: [`/facts/${matches[0].factIndex}`] };
      }
    }
    if (value.kind === "editorial_inference" && module === "skills") {
      const roleIndex = record.roles.findIndex(role => value.text === `${role.name}：${role.task}。需要的经历证据：${role.evidenceToAsk}`
        && JSON.stringify(value.factIds) === JSON.stringify(role.factIds));
      if (roleIndex >= 0) coverage = { rule: "exact_role_skill_template", coveredBy: ["name", "task", "evidenceToAsk", "factIds", "prerequisite"].map(key => `/roles/${roleIndex}/${key}`) };
    }
    if (value.kind === "editorial_inference") {
      const assessmentIndex = record.valueDimensions.findIndex(({ assessment }) => assessment.kind === value.kind && assessment.text === value.text
        && JSON.stringify(value.factIds) === JSON.stringify(assessment.factIds) && JSON.stringify(value.conditions) === JSON.stringify(assessment.conditions));
      if (assessmentIndex >= 0) coverage = { rule: "exact_editorial_assessment", coveredBy: [`/valueDimensions/${assessmentIndex}/assessment`] };
    }
    if (!coverage) return keep("no_exact_coverage");
    omitted.push({ path, original: structuredClone(value), ...coverage }); return false;
  })] as const).filter(([_module, values]) => values.length));
  return { sections, omitted, retained };
}
export function matchingExplanationSectionsV7(record: DecisionCompetitionRecord) {
  return auditExplanationSectionProjectionV7(record).sections;
}
function editorialSectionBoundaries(record: DecisionCompetitionRecord) {
  return Object.entries(record.sections).flatMap(([module, claims]) => claims.flatMap((value, index) => value.kind === "editorial_inference"
    ? [{ path: `/sections/${module}/${index}`, ...structuredClone(value), factIdsArePremisesOnly: true, use: boundaryUse }] : []));
}

/** Preserve both directions: a newer fact may supersede the cited old fact
 * without that old row pointing back to the correction. Never cross records. */
function factClosure(record: DecisionCompetitionRecord, seeds: Iterable<string>) {
  const ids = new Set(seeds);
  for (;;) {
    const before = ids.size;
    for (const fact of record.facts) {
      const related = [...fact.supersedes, ...fact.conflictsWith];
      if (ids.has(fact.id) || related.some(id => ids.has(id))) {
        ids.add(fact.id); related.forEach(id => ids.add(id));
      }
    }
    if (before === ids.size) break;
  }
  return { facts: record.facts.filter(fact => ids.has(fact.id)), unresolvedFactIds: [...ids].filter(id => !record.facts.some(fact => fact.id === id)) };
}

function sourceClosure(record: DecisionCompetitionRecord, facts: CatalogFact[], requireUnambiguous: boolean) {
  const ids = new Set(facts.flatMap(fact => fact.sourceIds));
  const unresolvedSourceIds = [...ids].filter(id => !record.sources.some(source => source.id === id));
  const ambiguousSourceIds = [...ids].filter(id => record.sources.filter(source => source.id === id).length > 1);
  if (requireUnambiguous && (unresolvedSourceIds.length || ambiguousSourceIds.length)) throw new Error("invalid_review_source_binding");
  return { sources: record.sources.filter(source => ids.has(source.id)), unresolvedSourceIds, ambiguousSourceIds };
}

function referencedFactIds(value: unknown, ids = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach(child => referencedFactIds(child, ids));
  else if (value !== null && typeof value === "object") for (const [key, child] of Object.entries(value)) {
    if (key === "factIds" && Array.isArray(child)) child.forEach(id => { if (typeof id === "string") ids.add(id); });
    else referencedFactIds(child, ids);
  }
  return ids;
}

function candidateBoundaries(context: DecisionContextV6, itemId: string) {
  const candidate = context.candidates.find(row => row.record.recordId === itemId);
  if (!candidate) throw new Error("review_candidate_not_selected");
  const record = candidate.record;
  const qualifiers: { path: string; value: DecisionClaim; use: typeof boundaryUse }[] = [];
  const add = (path: string, value: DecisionClaim) => {
    if (value.conditions.length || value.kind === "unknown" || value.unknownReason) qualifiers.push({ path, value, use: boundaryUse });
  };
  for (const [module, claims] of Object.entries(record.sections)) claims.forEach((value, index) => add(`/sections/${module}/${index}`, value));
  record.valueDimensions.forEach((value, index) => add(`/valueDimensions/${index}/assessment`, value.assessment));
  // Assumptions restrict interpretation. The uncited editorial difficulty
  // summary (which can name a particular solution) is not positive support.
  const difficultyAssumptions = record.difficulty.map(({ stage, assumptions, factIds }) => ({ stage, assumptions, factIds }));
  const cost = record.cost ?? null, participationRequirements = record.participationRequirements ?? null;
  const closure = factClosure(record, referencedFactIds([cost, participationRequirements, qualifiers, difficultyAssumptions]));
  return { ...identity(record), conditions: candidate.conditions, cost, participationRequirements, qualifiers, difficultyAssumptions,
    sourceBoundary: sourceBoundaryV7(record), editorialSectionBoundaries: editorialSectionBoundaries(record),
    editorialRoleBoundaries: record.roles.map((role, roleIndex) => ({ roleIndex, name: role.name, prerequisite: role.prerequisite,
      factIds: [...role.factIds], kind: "editorial_inference" as const, factIdsArePremisesOnly: true, use: boundaryUse })),
    boundaryFacts: closure.facts, unresolvedBoundaryFactIds: closure.unresolvedFactIds,
    boundarySourceBindings: sourceClosure(record, closure.facts, false), use: boundaryUse };
}

function studentCounterEvidence(context: DecisionContextV6, cited: StudentFactV6[]) {
  const profile = context.profile, ids = new Set(cited.map(fact => fact.id));
  for (const fact of profile.facts) if (fact.state !== "affirmed" || !fact.confirmed || profile.retractedFactIds.includes(fact.id)
    || fact.value === false || ["none", "unknown", "unsure", "undecided", "未做过", "没有", "无"].includes(String(fact.value))
    || cited.some(row => row.field === fact.field)) ids.add(fact.id);
  for (;;) {
    const before = ids.size;
    for (const fact of profile.facts) if (ids.has(fact.id) || fact.supersedesFactIds?.some(id => ids.has(id))) {
      ids.add(fact.id); fact.supersedesFactIds?.forEach(id => ids.add(id));
    }
    if (before === ids.size) break;
  }
  return { facts: profile.facts.filter(fact => ids.has(fact.id) && !cited.some(row => row.id === fact.id)),
    unresolvedFactIds: [...ids].filter(id => !profile.facts.some(fact => fact.id === id)), use: boundaryUse };
}

/** This is the exact proposed product action, not evidence for its truth.
 * Reuse the existing assembler and the same reviewed-role projection rule. */
function displayedRecommendationBoundariesV7(context: DecisionContextV6, plan: MatchPlanV6) {
  const report = assembleDecisionReport(context, plan, { method: "llm", model: "deepseek-flash" },
    { used: false, reason: null }, { admissionPolicy: "matching", profilePolicy: "self_report" });
  return new Map(report.recommendations.map(item => {
    const choice = plan.recommendations.find(row => row.itemId === item.itemId)!;
    const role = choice.roleIndex !== undefined ? context.candidates.find(row => row.record.recordId === item.itemId)?.record.roles[choice.roleIndex] : undefined;
    const usesChosenAction = Boolean(role && choice.roleReason && validateDecisionClaims([choice.roleReason], context, [item.itemId]).ok);
    return [item.itemId, { itemId: item.itemId, currentRole: structuredClone(item.currentRole),
      nextStep: structuredClone(usesChosenAction ? choice.roleReason! : item.nextStep),
      checkpoint: usesChosenAction ? role!.personalDeliverable : item.checkpoint,
      roleBinding: choice.roleIndex === undefined ? "static_default" : "selected_existing_role",
      use: "actual_product_presentation_to_check_not_positive_factual_support" as const }] as const;
  }));
}

/** Keep every supplied assertion unchanged. Positive evidence is partitioned
 * by key; unreferenced editorial tasks/roles/values cannot fill citation gaps. */
export function buildAssertionReviewPacketV7(context: DecisionContextV6, plan: MatchPlanV6, assertions: ReviewAssertionV7[]) {
  if (assertions.length > 64 || new Set(assertions.map(row => row.key)).size !== assertions.length) throw new Error("invalid_review_assertion_keys");
  const itemIds = plan.recommendations.map(item => item.itemId);
  const assertionEvidence = assertions.map(assertion => {
    const item = plan.recommendations.find(row => row.itemId === assertion.itemId);
    if (!item) throw new Error("review_assertion_not_selected");
    const expected = assertion.key === "comparison" ? plan.comparison
      : assertion.key === `${item.itemId}.role` ? item.roleReason
        : item.reasons.find((_reason, index) => assertion.key === `${item.itemId}.reason.${index}`);
    if (!expected || JSON.stringify(expected) !== JSON.stringify(assertion.reason)) throw new Error("review_assertion_binding_mismatch");
    const allowedItemIds = assertion.key === "comparison" ? itemIds.slice(0, 2) : [item.itemId];
    if (assertion.key === "comparison" && (allowedItemIds.length !== 2 || assertion.itemId !== itemIds[0])) throw new Error("invalid_review_comparison_scope");
    const records = allowedItemIds.map(id => {
      const record = context.candidates.find(candidate => candidate.record.recordId === id)?.record;
      if (!record) throw new Error("review_candidate_not_selected");
      return record;
    });
    const citedStudentFacts = assertion.reason.studentFactIds.map(id => {
      const fact = context.profile.facts.find(row => row.id === id);
      if (!fact || !fact.confirmed || ["unknown", "retracted"].includes(fact.state) || context.profile.retractedFactIds.includes(id)) throw new Error("inactive_review_student_fact");
      return fact;
    });
    const owners = new Map<string, DecisionCompetitionRecord>();
    for (const id of assertion.reason.competitionFactIds) {
      const matches = records.flatMap(record => record.facts.filter(fact => fact.id === id).map(fact => ({ record, fact })));
      if (matches.length !== 1 || !isDecisionEvidenceFact(matches[0].record, matches[0].fact)) throw new Error("invalid_review_competition_fact_scope");
      owners.set(id, matches[0].record);
    }
    const competitionItems = records.map(record => {
      const citedFacts = assertion.reason.competitionFactIds.filter(id => owners.get(id) === record).map(id => record.facts.find(fact => fact.id === id)!);
      const sources = sourceClosure(record, citedFacts, true).sources;
      const closure = factClosure(record, citedFacts.map(fact => fact.id));
      const contradictionFacts = closure.facts.filter(fact => !citedFacts.some(row => row.id === fact.id));
      return { ...identity(record), citedFacts, sources,
        contradictionContext: { facts: contradictionFacts, unresolvedFactIds: closure.unresolvedFactIds,
          sourceBindings: sourceClosure(record, contradictionFacts, false), use: boundaryUse } };
    });
    const role = assertion.key === `${item.itemId}.role` && item.roleIndex !== undefined ? records[0].roles[item.roleIndex] : undefined;
    if (assertion.key === `${item.itemId}.role` && !role) throw new Error("invalid_review_role");
    return { key: assertion.key, itemId: assertion.itemId, allowedItemIds, citedStudentFacts,
      studentAnswerUpdates: context.profile.updates?.filter(update => citedStudentFacts.some(fact => fact.answerId === update.answerId)) ?? [],
      studentCounterEvidence: studentCounterEvidence(context, citedStudentFacts), competitionItems,
      ...(role ? { editorialRoleIdentity: { roleIndex: item.roleIndex, name: role.name, prerequisite: role.prerequisite, use: "editorial_identity_not_factual_support" } } : {}) };
  });
  const boundaryOwners = new Set(assertionEvidence.flatMap(row => row.allowedItemIds));
  const presentation = displayedRecommendationBoundariesV7(context, plan);
  return { profileRevision: context.profile.revision, catalogVersion: context.catalogVersion, profile: context.profile,
    fixedOrder: { itemIds }, assertions, candidateBoundaries: itemIds.filter(id => boundaryOwners.has(id)).map(id => ({ ...candidateBoundaries(context, id), displayedRecommendation: presentation.get(id)! })), assertionEvidence };
}
export type AssertionReviewPacketV7 = ReturnType<typeof buildAssertionReviewPacketV7>;

/** Reuse the rank codecs unchanged. Their candidates traversal is adapted to a
 * one-element review bundle; expansion restores every per-key evidence cell. */
export function compactAssertionReviewPacketV7(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_review_packet");
  const { candidateBoundaries, assertionEvidence, ...rest } = value as Record<string, unknown>;
  if (!Array.isArray(candidateBoundaries) || !Array.isArray(assertionEvidence)) throw new Error("invalid_review_packet");
  const packed = compactMatchingTables(compactCandidateEvidence({ candidates: [{ candidateBoundaries, assertionEvidence }] })) as Record<string, unknown>;
  const { candidates, ...metadata } = packed;
  return { ...metadata, ...rest, evidenceBundle: candidates };
}

export const EVIDENCE_PACKET_TRANSPORT_PROMPT_V7 = "传输编码：tableSchemas指定列顺序；{$table:'tN',rows:[[值...]]}逐行按列读取，含嵌套表格。单键{$text:'tN'}/{$scope:'sN'}逐字引用evidenceDictionary.texts/scopes。字典只合并完全相同原文，所有ID、范围、条件、未知、否定和顺序均保留，字典文本不是独立支持。review的evidenceBundle[0]展开为candidateBoundaries与assertionEvidence。";
