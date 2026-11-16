import type { DecisionContextV6 } from "@/lib/competitions/v6/engine";
import { rankTaskFactsV7 } from "@/lib/competitions/v7/rank-packet";

/** Positive mocks choose existing fixture evidence. Invalid-output cases can
 * mutate the returned IDs or emit a deliberately unbound row. */
export function rankFixtureEvidence(context: DecisionContextV6, itemId: string, goalIndex?: number) {
  const record = context.candidates.find(candidate => candidate.record.recordId === itemId)?.record;
  const task = record && rankTaskFactsV7(record)[0];
  const student = context.profile.facts.find(fact => ["skills", "interests"].includes(fact.field) && fact.confirmed && fact.state === "affirmed");
  if (!task || goalIndex === undefined && !student) throw new Error(`rank_fixture_missing_evidence:${itemId}`);
  return { studentBasisIndices: goalIndex === undefined ? [0] : [], competitionFactIds: [task.id],
    ...(goalIndex === undefined ? {} : { goalIndex }) };
}

/** Test providers can specify positive witnesses and explicitly assess the rest
 * of the actual fixture pool as null. Production has no such fill step. */
export function rankFixtureAssessmentReply<T extends { recommendations: readonly { itemId: string }[] }>(context: DecisionContextV6, reply: T) {
  const { recommendations, ...headers } = reply;
  const itemIds = context.candidates.map(({ record }) => record.recordId).sort();
  const seen = new Set<string>();
  const assessments: { itemId: string; fit: Record<string, unknown> | null }[] = recommendations.map(({ itemId, ...fit }) => {
    const alias = /^@C(0|[1-9]\d*)$/.exec(itemId);
    seen.add(alias ? itemIds[Number(alias[1])] ?? itemId : itemId);
    return { itemId, fit: { matchKind: "direct", taskStepIndex: 0, ...fit } };
  });
  assessments.push(...itemIds.filter(itemId => !seen.has(itemId)).map(itemId => ({ itemId, fit: null })));
  return { ...headers, assessments };
}

/** Fake providers echo the rank request headers. Explain/review use the actual
 * public context versions and must not use this helper. */
export function echoRankWireHeaders<T extends object>(prompt: string, reply: T): T & { profileRevision: string; catalogVersion: string } {
  const input = JSON.parse(prompt);
  const { profileRevision, catalogVersion } = input.outputFormat ?? input.expectedHeaders;
  if (typeof profileRevision !== "string" || typeof catalogVersion !== "string") throw new Error("missing_rank_wire_headers");
  return { ...reply, profileRevision, catalogVersion };
}
