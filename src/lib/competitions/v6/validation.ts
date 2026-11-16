import {
  decisionReportSchema,
  matchPlanSchema,
  type DecisionClaimV6,
  type DecisionReportV6,
  type MatchPlanV6,
} from "./contracts";
import type { DecisionContextV6 } from "./engine";
import { selectPublishedDecisionRecords } from "./published-records";
import { isDecisionEvidenceFact } from "./evidence";

export type DecisionValidation = { ok: boolean; issues: string[] };
function checkClaim(
  claim: DecisionClaimV6,
  context: DecisionContextV6,
  allowedItems: readonly string[],
  path: string,
  issues: string[],
) {
  const students = new Map(context.profile.facts.map((f) => [f.id, f]));
  const records = context.candidates
    .filter((c) => allowedItems.includes(c.record.recordId))
    .map((c) => c.record);
  const facts = new Map(
    records.flatMap((r) => r.facts.map((f) => [f.id, f] as const)),
  );
  for (const id of claim.studentFactIds) {
    const fact = students.get(id);
    if (
      !fact ||
      !fact.confirmed ||
      fact.state === "unknown" ||
      fact.state === "retracted" ||
      context.profile.retractedFactIds.includes(id)
    )
      issues.push(`${path}: inactive_student_fact:${id}`);
  }
  for (const id of claim.competitionFactIds) {
    const fact = facts.get(id);
    const record = records.find((record) =>
      record.facts.some((item) => item.id === id),
    );
    if (!fact || !record || !isDecisionEvidenceFact(record, fact))
      issues.push(`${path}: unsupported_competition_fact:${id}`);
    if (
      fact?.kind === "official_fact" &&
      (!fact.sourceIds.length ||
        !fact.sourceIds.every((sourceId) =>
          records.some((r) =>
            r.sources.some(
              (s) => s.id === sourceId && s.accessStatus !== "unavailable",
            ),
          ),
        ))
    )
      issues.push(`${path}: missing_source:${id}`);
  }
  if (claim.basis === "student" && !claim.studentFactIds.length)
    issues.push(`${path}: student_claim_without_evidence`);
  if (
    claim.basis === "official" &&
    (!claim.competitionFactIds.length ||
      claim.competitionFactIds.some(
        (id) => facts.get(id)?.kind !== "official_fact",
      ))
  )
    issues.push(`${path}: official_claim_without_official_fact`);
  if (claim.basis === "inference" && !claim.studentFactIds.length)
    issues.push(`${path}: personalized_inference_without_student`);
  if (
    /(?:保证|必定|一定能)(?:获得|拿到|取得|提升)?(?:获奖|奖项|实习|就业|录取|保研)|获奖(?:概率|率)(?:是|为|达到)?\s*\d/.test(
      claim.text,
    )
  )
    issues.push(`${path}: unsupported_guarantee`);
}
export function validateMatchPlan(
  value: unknown,
  context: DecisionContextV6,
): DecisionValidation {
  const parsed = matchPlanSchema.safeParse(value);
  if (!parsed.success)
    return {
      ok: false,
      issues: parsed.error.issues.map(
        (i) => `${i.path.join(".")}: ${i.message}`,
      ),
    };
  const plan = parsed.data;
  const issues: string[] = [];
  const seen = new Set<string>();
  if (plan.profileRevision !== context.profile.revision)
    issues.push("stale_profile_revision");
  if (plan.catalogVersion !== context.catalogVersion)
    issues.push("stale_catalog_version");
  if (plan.recommendations.length < 5 && !plan.shortfallReason?.trim())
    issues.push("unexplained_shortlist_shortfall");
  for (const item of plan.recommendations) {
    const candidate = context.candidates.find(
      (c) => c.record.recordId === item.itemId,
    );
    if (!candidate) {
      issues.push(`unknown_or_excluded_candidate:${item.itemId}`);
      continue;
    }
    if (seen.has(candidate.record.seriesId))
      issues.push(`duplicate_series:${candidate.record.seriesId}`);
    seen.add(candidate.record.seriesId);
    if (!["L2", "L3"].includes(candidate.record.contentTier))
      issues.push(`content_gate:${item.itemId}`);
    if (item.roleIndex !== undefined && !candidate.record.roles[item.roleIndex])
      issues.push(`unknown_role:${item.itemId}`);
    if ((item.roleIndex !== undefined) !== Boolean(item.roleReason))
      issues.push(`incomplete_role_decision:${item.itemId}`);
    if (item.roleReason)
      checkClaim(
        item.roleReason,
        context,
        [item.itemId],
        `${item.itemId}.roleReason`,
        issues,
      );
    item.reasons.forEach((reason, i) => {
      checkClaim(
        reason,
        context,
        [item.itemId],
        `${item.itemId}.reasons.${i}`,
        issues,
      );
      if (reason.basis === "inference" && !reason.competitionFactIds.length)
        issues.push(`${item.itemId}: match_inference_without_task_evidence`);
    });
  }
  if (plan.comparison)
    checkClaim(
      plan.comparison,
      context,
      plan.recommendations.slice(0, 2).map((r) => r.itemId),
      "comparison",
      issues,
    );
  return { ok: issues.length === 0, issues };
}

/** Structural and cross-object support checks. Semantic inference still requires independent review. */
export function validateDecisionReport(
  value: unknown,
  context: DecisionContextV6,
): DecisionValidation {
  const parsed = decisionReportSchema.safeParse(value);
  if (!parsed.success)
    return {
      ok: false,
      issues: parsed.error.issues.map(
        (i) => `${i.path.join(".")}: ${i.message}`,
      ),
    };
  const report: DecisionReportV6 = parsed.data;
  const plan: MatchPlanV6 = {
    profileRevision: report.profile.revision,
    catalogVersion: report.catalogVersion,
    recommendations: report.recommendations.map((r) => ({
      itemId: r.itemId,
      reasons: r.reasons,
    })),
    shortfallReason: report.shortlistShortfallReason,
  };
  const issues = validateMatchPlan(plan, context).issues;
  if (JSON.stringify(report.profile) !== JSON.stringify(context.profile))
    issues.push("profile_snapshot_mismatch");
  const selected = report.recommendations.map((r) => r.itemId);
  for (const id of report.summary.focusItemIds)
    if (!selected.includes(id)) issues.push(`summary_unknown_candidate:${id}`);
  const summaryClaims = [
    report.summary.direction,
    ...report.summary.personalEvidence,
    report.summary.mainGap,
    report.summary.nextStep,
  ];
  summaryClaims.forEach((c, i) =>
    checkClaim(c, context, selected, `summary.${i}`, issues),
  );
  for (const path of report.goalPaths) {
    if (
      context.profile.tradeoffStatus !== "undecided" ||
      !context.profile.goals.includes(path.goal)
    )
      issues.push("unconfirmed_goal_path");
    if (path.itemIds.some((id) => !context.candidates.some(candidate => candidate.record.recordId === id)))
      issues.push("goal_path_unknown_candidate");
    checkClaim(
      path.nextStep,
      context,
      path.itemIds,
      "goal_path.nextStep",
      issues,
    );
  }
  report.recommendations.forEach((item, i) => {
    const candidate = context.candidates.find(
      (c) => c.record.recordId === item.itemId,
    );
    if (!candidate) return;
    const record = candidate.record;
    if (item.rank !== i + 1) issues.push("non_contiguous_ranks");
    if (
      item.seriesId !== record.seriesId ||
      item.trackLabel !== record.track.name ||
      item.edition !== record.edition
    )
      issues.push(`candidate_identity_mismatch:${item.itemId}`);
    if (
      item.contentTier !== record.contentTier ||
      item.eligibilityStatus !== candidate.eligibility
    )
      issues.push(`candidate_status_mismatch:${item.itemId}`);
    if (
      item.registration.status !== record.registration.status ||
      item.registration.note !== record.registration.note
    )
      issues.push(`registration_mismatch:${item.itemId}`);
    if (!candidate.conditions.every((c) => item.eligibilityNotes.includes(c)))
      issues.push(`missing_condition:${item.itemId}`);
    if (new Set(item.difficulty.map((d) => d.stage)).size !== 3)
      issues.push(`duplicate_difficulty:${item.itemId}`);
    if (
      new Set(item.values.map((v) => v.dimension)).size !== item.values.length
    )
      issues.push(`duplicate_value_dimension:${item.itemId}`);
    const expectedFacts = record.facts.map((f) => ({
      id: f.id,
      text: f.text,
      sourceIds: f.sourceIds,
      scope: f.scope,
      status: f.status,
      kind: f.kind,
    }));
    if (JSON.stringify(item.evidenceFacts) !== JSON.stringify(expectedFacts))
      issues.push(`altered_fact_pack:${item.itemId}`);
    for (const source of item.sources) {
      const original = record.sources.find((s) => s.id === source.id);
      if (
        !original ||
        source.url !== original.url ||
        source.scope !== original.scope
      )
        issues.push(`altered_source:${source.id}`);
    }
    const claims = [
      item.coreTask,
      ...item.reasons,
      item.currentRole,
      ...item.gaps,
      ...item.values.map((v) => v.claim),
      ...item.difficulty.map((d) => d.claim),
      item.opportunityCost,
      item.nextStep,
    ];
    claims.forEach((c, j) =>
      checkClaim(c, context, [item.itemId], `${item.itemId}.${j}`, issues),
    );
  });
  for (const comparison of report.comparisons) {
    if (
      comparison.itemIds.some((id) => !selected.includes(id)) ||
      new Set(comparison.itemIds).size !== comparison.itemIds.length
    )
      issues.push("comparison_unknown_candidate");
    checkClaim(
      comparison.tradeoff,
      context,
      comparison.itemIds,
      "comparison.tradeoff",
      issues,
    );
    for (const dimension of comparison.dimensions) {
      if (
        dimension.values.length !== comparison.itemIds.length ||
        new Set(dimension.values.map((v) => v.itemId)).size !==
          comparison.itemIds.length
      )
        issues.push("comparison_missing_or_duplicate_value");
      for (const value of dimension.values) {
        if (!comparison.itemIds.includes(value.itemId))
          issues.push("comparison_wrong_item");
        checkClaim(
          value.claim,
          context,
          [value.itemId],
          "comparison.value",
          issues,
        );
      }
    }
  }
  const published = new Set(selectPublishedDecisionRecords(context.records));
  const selectedRecords = new Set(report.recommendations.map(item => item.itemId));
  for (const item of report.candidateAudit) {
    // Historical reports without recordId retain their legacy series lookup.
    const record = context.records.find(r => item.recordId ? r.recordId === item.recordId : r.seriesId === item.seriesId);
    if (!record) {
      issues.push("audit_unknown_candidate");
      continue;
    }
    if (item.recordId) {
      const expected = !published.has(record) ? "content_pending" : selectedRecords.has(record.recordId) ? "selected"
        : context.excluded.has(record.recordId) ? "excluded" : "not_selected";
      if (item.seriesId !== record.seriesId || item.name !== record.name) issues.push("audit_record_identity_mismatch");
      if (item.status !== expected) issues.push("audit_record_status_mismatch");
    }
    checkClaim(item.reason, context, [record.recordId], "audit.reason", issues);
  }
  return { ok: issues.length === 0, issues };
}


export function validateDecisionClaims(claims: DecisionClaimV6[], context: DecisionContextV6, itemIds: string[]): DecisionValidation {
  const issues: string[] = [];
  claims.forEach((claim, index) => checkClaim(claim, context, itemIds, `chat.${index}`, issues));
  return { ok: issues.length === 0, issues };
}
