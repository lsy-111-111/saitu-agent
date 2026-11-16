import { createHash } from "node:crypto";
import type { DecisionClaimV6, MatchPlanV6 } from "./contracts";
import type { DecisionContextV6 } from "./engine";
import { isDecisionEvidenceFact } from "./evidence";

// Bounded, generic partitioning: small pools use one independent review per
// candidate; larger pools distribute every candidate across at most 39 shards.
// The isolated runtime must configure 40 governed calls (ranking + reviews).
export const CATALOG_SUPPORT_SHARDS = 39;
function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function recommendationAssertions(item: MatchPlanV6["recommendations"][number]) {
  return [...item.reasons.map((reason, index) => ({ suffix: `reason${index}`, reason })),
    ...(item.roleReason ? [{ suffix: "role", reason: item.roleReason }] : [])];
}
export type FrozenSupportClaim = {
  key: string; itemId: string; reason: DecisionClaimV6; claimSha256: string;
  evidenceSha256: string; reviewId: string;
};

/** Retrieve the actual dependencies of the fixed statements, including their
 * original scopes and every unresolved condition. This does not decide which
 * candidates reach ranking, or assert that any student meets the conditions.
 */
export function freezeCatalogSupport(context: DecisionContextV6, plan: MatchPlanV6) {
  const shards = Array.from({ length: Math.min(CATALOG_SUPPORT_SHARDS, plan.recommendations.length) }, (_, index) => ({
    reviewId: `support-${index}`, candidates: [] as unknown[], claims: [] as FrozenSupportClaim[],
  }));
  const entries = new Map<string, { recommendationSha256: string; claims: FrozenSupportClaim[] }>();
  plan.recommendations.forEach((item, index) => {
    const candidate = context.candidates.find(row => row.record.recordId === item.itemId);
    if (!candidate) throw new Error("support_unknown_candidate");
    const record = candidate.record, assertions = recommendationAssertions(item);
    const cited = new Set(assertions.flatMap(assertion => assertion.reason.competitionFactIds));
    const studentIds = new Set(assertions.flatMap(assertion => assertion.reason.studentFactIds));
    const evidence = {
      itemId: item.itemId, name: record.name, edition: record.edition, track: record.track,
      group: record.group, scope: record.scope,
      eligibility: candidate.eligibility, conditions: [...candidate.conditions],
      // Keep task and role editor text: suggestion provenance is distinct from
      // official facts, and role text alone cannot certify personal ability.
      catalogTasks: record.sections.task,
      catalogRoles: record.roles,
      facts: record.facts.filter(fact => cited.has(fact.id) && isDecisionEvidenceFact(record, fact))
        .map(({ id, field, text, kind, status, scope }) => ({ id, field, text, kind, status, scope })),
      studentFacts: context.profile.facts.filter(fact => studentIds.has(fact.id)),
    };
    const shard = shards[index % shards.length], evidenceSha256 = hash(evidence);
    const claims = assertions.map(({ suffix, reason }) => ({
      key: `c${index}:${suffix}`, itemId: item.itemId, reason,
      claimSha256: hash({ profileRevision: plan.profileRevision, catalogVersion: plan.catalogVersion, itemId: item.itemId, reason }),
      evidenceSha256, reviewId: shard.reviewId,
    }));
    shard.candidates.push(evidence); shard.claims.push(...claims);
    entries.set(item.itemId, { recommendationSha256: hash(item), claims });
  });
  return { shards, entries };
}

/** A verdict on an earlier/different statement cannot authorize display. */
export function boundSupportClaims(frozen: ReturnType<typeof freezeCatalogSupport>, plan: MatchPlanV6) {
  return plan.recommendations.flatMap(item => {
    const entry = frozen.entries.get(item.itemId);
    if (!entry || entry.recommendationSha256 !== hash(item)) throw new Error("support_binding_mismatch");
    return entry.claims;
  });
}
