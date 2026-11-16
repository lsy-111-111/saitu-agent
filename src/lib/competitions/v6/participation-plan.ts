import { createHash } from "node:crypto";
import { z } from "zod";
import type { CoverageProfile, DecisionCompetitionRecord } from "./catalog-types";
import { hasTrustedPlanDualReview, trustedCurrentPlanReviews } from "./trusted-plan-review";
import { hasPublishedPriceFacts } from "./published-price-evidence";
import { formalPlanTimingSchema, assessFormalPlanTiming, publishedDateBounds } from "./formal-plan-timing";
import { remainingWorkFits, type RemainingWork } from "./formal-plan-capacity";
import { isDecisionEvidenceFact, isEvidenceForRecord } from "./evidence";

const text = z.string().trim().min(1);
const ids = z.array(text).min(1).refine(x => new Set(x).size === x.length);
const inventory = z.array(text).refine(x => new Set(x).size === x.length);
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(x => Number.isFinite(Date.parse(x)) && new Date(x).toISOString().slice(0, 10) === x);
const instant = z.string().datetime({ offset: true });
export const COST_CATEGORIES = ["registration", "materials", "tools", "connectivity", "compute", "shipping", "travel", "lodging", "mandatory_other"] as const;
const category = z.enum(COST_CATEGORIES);
const session = z.object({ taskId: text, stageId: text, startAt: instant, endAt: instant, factIds: ids }).strict();
const workload = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("editorial_estimate"), methodology: text,
    tasks: z.array(z.object({ id: text, stageId: text, description: text, role: text,
      kind: z.enum(["delivery", "learning", "rework", "official_session"]), minimumMinutes: integer, maximumMinutes: integer, factIds: ids }).strict()).min(3),
    weeks: z.array(z.object({ weekStart: date, allocations: z.array(z.object({ taskId: text, maximumMinutes: integer }).strict()).min(1) }).strict()).min(1),
    sessions: z.array(session), peakWeeklyMinutes: integer,
  }).strict(),
  z.object({ kind: z.literal("official_complete_path_bound"), factIds: ids,
    weeks: z.array(z.object({ weekStart: date, maximumMinutes: integer, factIds: ids }).strict()).min(1),
    sessions: z.array(session), peakWeeklyMinutes: integer,
  }).strict(),
]);
const ownedResource = z.object({kind:z.enum(["device", "connectivity", "software_license", "compute_service", "materials", "travel_pass", "lodging_entitlement"]),name:text}).strict();
const component = z.object({ id: text, stageId: text, category, explanation: text, factIds: ids,
  treatment: z.enum(["paid", "owned", "not_required"]),
  priceBasis: z.enum(["organizer_fee", "public_price_upper_bound", "workflow_closure", "confirmed_owned"]),
  upperUnitFen: integer.nullable(), quantity: integer.positive(), unit: text, ownedResource: ownedResource.optional(),
  validFrom: date, validThrough: date,
}).strict();
const cost = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("component_sum"), components: z.array(component).min(1) }).strict(),
  z.object({ kind: z.literal("direct_official_total"), maximumPersonalFen: integer.nullable(), factIds: ids,
    definition: z.literal("all_required_personal_expenditure"), stageIds: ids,
    includedCategories: z.array(category).min(1), exceptions: z.array(text), validFrom: date, validThrough: date,
  }).strict(),
]);
/** Public JSON is untrusted. No approval boolean or claimed digest can authorize a plan. */
export const formalParticipationPlanSchema = z.object({
  version: z.literal("saitu.formal-participation-plan.v2"), id: text, scope: text,
  profileId: text, profileDigest: z.string().regex(/^[a-f0-9]{64}$/),
  path: z.object({ completionDefinition: text, officialFactIds: ids,
    stages: z.array(z.object({ id: text, deliverable: text, factIds: ids }).strict()).min(1),
    exitConditions: ids,
  }).strict(),
  prerequisites: z.object({ experience: z.enum(["beginner", "coursework"]), evidence: inventory,
    ownedEquipment: inventory, additionalRequirements: inventory, role: text, teamSize: z.literal(1),
  }).strict(),
  timing: formalPlanTimingSchema,
  resourceDerivations: z.array(z.object({ field: z.enum(["mentor", "laboratory", "equipment", "attendance"]),
    conclusionFactId: text, basisFactIds: ids, rationale: text }).strict()),
  workload, cost,
}).strict();
export type FormalParticipationPlan = z.infer<typeof formalParticipationPlanSchema>;

/** All supplied profile facts, including negative constraints, are bound without adding resources. */
export function coverageProfileDigest(profile: CoverageProfile): string {
  const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : v && typeof v === "object"
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonical(x)])) : v;
  return createHash("sha256").update(JSON.stringify(canonical(profile))).digest("hex");
}
const sameSet = (a: string[], b: string[]) => a.length === b.length && new Set(a).size === a.length && a.every(x => b.includes(x));
const monday = (instantMs: number) => { const d = new Date(instantMs); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7); return d.toISOString().slice(0, 10); };
const WEEK = 7 * 86400000;
function validAt(record: DecisionCompetitionRecord, id: string, now: Date): boolean {
  const f = record.facts.find(x => x.id === id);
  if (!f || f.kind !== "official_fact" || f.status !== "verified_current" || f.conflictsWith.length || !isEvidenceForRecord(record, f) || !isDecisionEvidenceFact(record, f)) return false;
  const checked = Date.parse(f.checkedAt ?? "");
  if (!Number.isFinite(checked) || checked > now.getTime()) return false;
  for (const [bound, lower] of [[f.validFrom, true], [f.validUntil, false]] as const) {
    if (bound?.value) { const t = Date.parse(bound.value); if (!Number.isFinite(t) || (lower ? now.getTime() < t : now.getTime() > t + (bound.precision === "day" ? 86400000 - 1 : 0))) return false; }
  }
  return f.sourceIds.every(sourceId => record.sources.some(s => s.id === sourceId && s.integrity !== "requires_recheck" && s.locator.trim() && Number.isFinite(Date.parse(s.checkedAt ?? "")) && Date.parse(s.checkedAt!) <= now.getTime()));
}
export const hasCurrentPlanFacts = (record: DecisionCompetitionRecord, factIds: string[], now: Date) => factIds.length > 0 && new Set(factIds).size === factIds.length && factIds.every(id => validAt(record, id, now));

/** Structure/evidence only. Used by the catalog validator without conflating estimates with official facts. */
export function inspectFormalParticipationPlan(record: DecisionCompetitionRecord, input: unknown, now: Date) {
  if (!Number.isFinite(now.getTime())) return { plan: undefined, reasons: ["invalid_assessment_time"], costReasons: ["invalid_assessment_time"], peakWeeklyMinutes: null, maximumPersonalFen: null };
  const parsed = formalParticipationPlanSchema.safeParse(input); const reasons: string[] = [];
  if (!parsed.success) return { plan: undefined, reasons: ["invalid_typed_formal_participation_plan"], costReasons: ["invalid_typed_formal_participation_plan"], peakWeeklyMinutes: null, maximumPersonalFen: null };
  const plan = parsed.data;
  const check = (value: boolean, reason: string) => { if (!value) reasons.push(reason); };
  check(plan.scope === record.scope, "plan_scope_mismatch");
  const stages = plan.path.stages.map(s => s.id);
  check(sameSet(stages, (record.stages ?? []).map(s => s.id)), "formal_stage_closure_missing_or_mismatched");
  check(hasCurrentPlanFacts(record, plan.path.officialFactIds, now) && plan.path.officialFactIds.every(id => record.facts.find(f => f.id === id)?.field === "participation.formalPath"), "formal_path_current_official_closure_missing");
  for (const stage of plan.path.stages) check(hasCurrentPlanFacts(record, stage.factIds, now), "stage_current_official_basis_missing");
  check(new Set(plan.resourceDerivations.map(d => d.field)).size === plan.resourceDerivations.length, "duplicate_resource_derivation");
  for (const d of plan.resourceDerivations) {
    const fact = record.facts.find(f => f.id === d.conclusionFactId);
    check(Boolean(fact && fact.kind === "editorial_inference" && fact.status === "verified_current" && !fact.conflictsWith.length && isEvidenceForRecord(record, fact) && fact.field === `participation.${d.field}` && hasCurrentPlanFacts(record, d.basisFactIds, now)), "resource_derivation_basis_missing");
  }
  check(hasCurrentPlanFacts(record, plan.timing.rulesFactIds, now) && plan.timing.rulesFactIds.every(id => /^(eligibility|participation\.formalPath|track|rules)(\.|$)/.test(record.facts.find(f => f.id === id)?.field ?? "")), "current_formal_rules_not_verified");
  check(hasCurrentPlanFacts(record, plan.timing.registrationFactIds, now) && plan.timing.registrationFactIds.every(id => record.facts.find(f => f.id === id)?.field.startsWith("registration")), "published_registration_window_not_verified");
  check(hasCurrentPlanFacts(record, plan.timing.scheduleFactIds, now) && plan.timing.scheduleFactIds.every(id => /^(schedule|participation\.schedule)(\.|$)/.test(record.facts.find(f => f.id === id)?.field ?? "")), "published_formal_schedule_not_verified");
  reasons.push(...assessFormalPlanTiming(record, plan.timing, stages, plan.workload.weeks.map(w => w.weekStart), now));
  const commonReasons = [...reasons];
  const weeks = plan.workload.weeks.map(w => w.weekStart);
  check(new Set(weeks).size === weeks.length && weeks.every(w => monday(Date.parse(w)) === w), "invalid_calendar_weeks");
  const upperByWeek = new Map<string, bigint>();
  if (plan.workload.kind === "editorial_estimate") {
    const tasks = plan.workload.tasks; const taskIds = tasks.map(t => t.id);
    check(new Set(taskIds).size === taskIds.length, "duplicate_workload_task");
    check(stages.every(stage => tasks.some(t => t.stageId === stage && t.kind === "delivery")), "mandatory_stage_delivery_work_missing");
    for (const kind of ["learning", "rework"] as const) check(tasks.some(t => t.kind === kind && t.maximumMinutes > 0), `${kind}_allowance_missing`);
    const allocated = new Map<string, bigint>();
    for (const task of tasks) check(stages.includes(task.stageId) && task.minimumMinutes <= task.maximumMinutes && task.role === plan.prerequisites.role && hasCurrentPlanFacts(record, task.factIds, now), "task_scope_role_interval_or_source_invalid");
    for (const week of plan.workload.weeks) {
      check(new Set(week.allocations.map(a => a.taskId)).size === week.allocations.length, "duplicate_week_task_allocation");
      let total = BigInt(0);
      for (const a of week.allocations) { check(taskIds.includes(a.taskId), "unknown_allocated_task");
        const task = tasks.find(t => t.id === a.taskId), stage = plan.timing.stages.find(s => s.stageId === task?.stageId);
        const end = stage?.ends && publishedDateBounds(stage.ends);
        check(Boolean(end && Date.parse(week.weekStart) <= end.earliest), "work_after_formal_stage_end");
        total += BigInt(a.maximumMinutes); allocated.set(a.taskId, (allocated.get(a.taskId) ?? BigInt(0)) + BigInt(a.maximumMinutes)); }
      upperByWeek.set(week.weekStart, total);
    }
    check(tasks.every(t => allocated.get(t.id) === BigInt(t.maximumMinutes)), "task_upper_bound_not_fully_allocated");
    check(sameSet(tasks.filter(t => t.kind === "official_session").map(t => t.id), plan.workload.sessions.map(s => s.taskId)), "official_session_schedule_missing");
  } else {
    check(hasCurrentPlanFacts(record, plan.workload.factIds, now) && plan.workload.factIds.every(id => record.facts.find(f => f.id === id)?.field === "participation.weeklyHours"), "official_complete_workload_basis_missing");
    for (const week of plan.workload.weeks) {
      check(plan.timing.stages.some(s => s.ends && Date.parse(week.weekStart) <= (publishedDateBounds(s.ends)?.earliest ?? -Infinity)), "work_after_formal_stage_end");
      check(hasCurrentPlanFacts(record, week.factIds, now), "official_week_bound_basis_missing"); upperByWeek.set(week.weekStart, BigInt(week.maximumMinutes)); }
  }
  const sessionWeekTotals = new Map<string, bigint>();
  for (const s of plan.workload.sessions) {
    const start = Date.parse(s.startAt), end = Date.parse(s.endAt);
    check(end > start && hasCurrentPlanFacts(record, s.factIds, now), "official_session_invalid");
    check(start >= now.getTime(), "past_session_participation_not_confirmed");
    const registrationOpen = plan.timing.registrationOpens && publishedDateBounds(plan.timing.registrationOpens);
    check(Boolean(registrationOpen && Math.max(now.getTime(), registrationOpen.latest) <= start), "registration_entry_after_required_session");
    if (plan.workload.kind === "editorial_estimate") check(plan.workload.tasks.some(t => t.id === s.taskId && t.stageId === s.stageId && t.kind === "official_session"), "official_session_task_stage_mismatch");
    // Bound loops and refuse unknown/multi-year sessions, instead of hanging on malicious JSON.
    if (!(end > start) || end - start > 366 * 86400000) { reasons.push("official_session_invalid"); continue; }
    for (let cursor = start; cursor < end;) {
      const stage = plan.timing.stages.find(x => x.stageId === s.stageId);
      const stageStart = stage?.starts && publishedDateBounds(stage.starts), stageEnd = stage?.ends && publishedDateBounds(stage.ends);
      check(Boolean(stageStart && stageEnd && start >= stageStart.earliest && end <= stageEnd.earliest), "session_outside_formal_stage_schedule");
      const week = monday(cursor), until = Math.min(end, Date.parse(week) + WEEK), minutes = BigInt(Math.ceil((until - cursor) / 60000));
      sessionWeekTotals.set(week, (sessionWeekTotals.get(week) ?? BigInt(0)) + minutes);
      if (plan.workload.kind === "editorial_estimate") {
        const allocation = plan.workload.weeks.find(w => w.weekStart === week)?.allocations.find(a => a.taskId === s.taskId);
        check(Boolean(allocation && BigInt(allocation.maximumMinutes) >= minutes), "official_session_peak_averaged_or_missing");
      }
      cursor = until;
    }
  }
  for (const [week, minutes] of sessionWeekTotals) check((upperByWeek.get(week) ?? -BigInt(1)) >= minutes, "official_session_peak_averaged_or_missing");
  // Reserve fixed sessions, then place the complete remaining upper bounds in the
  // actual unelapsed week. Preparation may start before registration/stage opening.
  // These are physical capacity bounds, not invented user availability or completed work.
  for (const week of plan.workload.weeks) {
    const weekStart = Date.parse(week.weekStart), weekEnd = weekStart + WEEK;
    const fixed = plan.workload.sessions.map(s => ({ taskId: s.taskId, start: Date.parse(s.startAt), end: Date.parse(s.endAt) }));
    const reservedFor = (taskId?: string) => fixed.filter(s => taskId === undefined || s.taskId === taskId)
      .reduce((sum, s) => sum + BigInt(Math.max(0, Math.min(weekEnd, s.end) - Math.max(weekStart, s.start))), BigInt(0));
    const work: RemainingWork[] = [];
    if (plan.workload.kind === "editorial_estimate" && "allocations" in week) {
      for (const allocation of week.allocations) {
        const task = plan.workload.tasks.find(t => t.id === allocation.taskId);
        const stage = plan.timing.stages.find(s => s.stageId === task?.stageId);
        const deadline = stage?.ends && publishedDateBounds(stage.ends);
        work.push({ deadline: deadline?.earliest ?? NaN, milliseconds: BigInt(allocation.maximumMinutes) * BigInt(60000) - reservedFor(allocation.taskId) });
      }
    } else if ("maximumMinutes" in week) {
      // An official aggregate has no task/stage split. Fitting it before the earliest
      // mandatory deadline is a conservative sufficient condition; later-stage slack
      // cannot certify that an unquantified early deliverable was completed in time.
      const deadline = Math.min(...plan.timing.stages.map(s => s.ends ? publishedDateBounds(s.ends)?.earliest ?? NaN : NaN));
      work.push({ deadline, milliseconds: BigInt(week.maximumMinutes) * BigInt(60000) - reservedFor() });
    }
    check(remainingWorkFits(Math.max(weekStart, now.getTime()), weekEnd, work, fixed), "remaining_work_exceeds_real_time_capacity");
  }
  const peak = [...upperByWeek.values()].reduce((a, b) => a > b ? a : b, BigInt(0));
  check(peak > BigInt(0) && peak <= BigInt(10080) && peak === BigInt(plan.workload.peakWeeklyMinutes), "weekly_peak_bound_invalid");
  const first = [...weeks].sort()[0], last = [...weeks].sort().at(-1)!;
  const through = new Date(Date.parse(last) + WEEK - 86400000).toISOString().slice(0, 10);
  const covers = (from: string, to: string) => from <= first && to >= through;
  const workloadReasons = [...reasons];
  const costStart = reasons.length;
  let total: bigint | null = BigInt(0);
  if (plan.cost.kind === "direct_official_total") {
    const c = plan.cost;
    check(c.factIds.some(id => ["personalTotalCost", "cost", "cost.total", "investment"].includes(record.facts.find(f => f.id === id)?.field ?? "")), "direct_total_is_not_registration_fee");
    check(c.maximumPersonalFen !== null && !c.exceptions.length && sameSet(c.stageIds, stages) && sameSet(c.includedCategories, [...COST_CATEGORIES]) && covers(c.validFrom, c.validThrough) && hasCurrentPlanFacts(record, c.factIds, now), "official_total_scope_or_completeness_unknown");
    total = c.maximumPersonalFen === null ? null : BigInt(c.maximumPersonalFen);
  } else {
    const components = plan.cost.components;
    check(new Set(components.map(c => c.id)).size === components.length, "duplicate_cost_component");
    for (const stage of stages) for (const cat of COST_CATEGORIES) check(components.some(c => c.stageId === stage && c.category === cat), "cost_stage_category_closure_missing");
    for (const stage of stages) for (const cat of COST_CATEGORIES) {
      const group = components.filter(c => c.stageId === stage && c.category === cat);
      check(!(group.some(c => c.treatment === "not_required") && group.length > 1), "contradictory_cost_category_closure");
    }
    for (const c of components) {
      const priceEvidence = c.priceBasis === "public_price_upper_bound" ? hasPublishedPriceFacts(record, c.factIds, now) : hasCurrentPlanFacts(record, c.factIds, now);
      check(stages.includes(c.stageId) && covers(c.validFrom, c.validThrough) && priceEvidence, "component_scope_date_or_evidence_invalid");
      if (c.priceBasis === "public_price_upper_bound") {
        check(c.factIds.every(id => { const price = record.facts.find(f => f.id === id)?.publicPrice; return Boolean(price && price.unit === c.unit && price.applicableScope === record.scope && price.validFrom <= c.validFrom && price.validThrough >= c.validThrough && c.upperUnitFen !== null && c.upperUnitFen >= price.maximumUnitFen); }), "published_price_bound_or_applicability_mismatch");
      }
      check(c.upperUnitFen !== null, "component_upper_bound_unknown");
      if (c.upperUnitFen === null) total = null; else if (total !== null) total += BigInt(c.upperUnitFen) * BigInt(c.quantity);
      if (c.treatment === "paid") {
        check(["organizer_fee", "public_price_upper_bound"].includes(c.priceBasis) && (c.category !== "registration" || c.priceBasis === "organizer_fee") && !c.ownedResource, "paid_price_upper_bound_missing");
        check(c.factIds.some(id => /^(fee|cost|personalTotalCost)(\.|$)/.test(record.facts.find(f => f.id === id)?.field ?? "")), "price_fact_required");
      } else {
        check(c.upperUnitFen === 0 && (c.treatment === "owned" ? c.priceBasis === "confirmed_owned" && Boolean(c.ownedResource) : c.priceBasis === "workflow_closure" && !c.ownedResource), "zero_cost_basis_invalid");
        if (c.treatment === "owned") {
          const allowedKinds: Partial<Record<typeof c.category, string[]>> = { tools: ["device", "software_license"], materials: ["materials"], connectivity: ["connectivity"], compute: ["device", "compute_service"], travel: ["travel_pass"], lodging: ["lodging_entitlement"] };
          check(Boolean(c.ownedResource && allowedKinds[c.category]?.includes(c.ownedResource.kind)), "owned_resource_category_mismatch");
          if (c.ownedResource?.kind === "device") check(plan.prerequisites.ownedEquipment.includes(c.ownedResource.name), "owned_cost_resource_not_bound");
        }
      }
      if (record.participationRequirements?.attendance?.value === "remote" && c.category === "connectivity") check(c.treatment !== "not_required", "remote_connectivity_unaccounted");
    }
  }
  if (total !== null && total > BigInt(Number.MAX_SAFE_INTEGER)) { reasons.push("cost_integer_overflow"); total = null; }
  const costReasons = [...new Set([...commonReasons, ...reasons.slice(costStart)])];
  return { plan, reasons: [...new Set(reasons)], costReasons, peakWeeklyMinutes: workloadReasons.length ? null : Number(peak), maximumPersonalFen: costReasons.length || total === null ? null : Number(total) };
}

/** Derived conclusions require two independent current-digest reviews; caller flags are ignored. */
export function assessFormalParticipationPlan(record: DecisionCompetitionRecord, profile: CoverageProfile, now: Date) {
  const matches = (Array.isArray(record.participationPlans) ? record.participationPlans : []).filter(p => p && typeof p === "object" && p.profileId === profile.id && p.profileDigest === coverageProfileDigest(profile));
  if (matches.length !== 1) return { plan: undefined, reasons: ["unique_profile_bound_plan_required"], costReasons: ["unique_profile_bound_plan_required"], peakWeeklyMinutes: null, maximumPersonalFen: null };
  const result = inspectFormalParticipationPlan(record, matches[0], now); const reasons = [...result.reasons]; const p = result.plan;
  if (!hasTrustedPlanDualReview(record)) reasons.push("trusted_ledger_current_digest_dual_review_required");
  if (p) {
    const prereq = p.prerequisites;
    if (prereq.experience !== profile.experience || !prereq.evidence.every(e => profile.evidence.includes(e)) || (prereq.experience === "coursework" && !prereq.evidence.length) || prereq.additionalRequirements.length || !prereq.ownedEquipment.every(e => profile.equipment.includes(e))) reasons.push("profile_prerequisites_not_confirmed");
    if (p.cost.kind === "component_sum") for (const c of p.cost.components) {
      if (c.treatment === "owned" && c.ownedResource) {
        const resource = c.ownedResource;
        const confirmed = resource.kind === "device" ? profile.equipment.includes(resource.name) : profile.ownedResources?.some(r => r.kind === resource.kind && r.name === resource.name);
        if (!confirmed) reasons.push("owned_resource_not_confirmed_for_profile");
      }
      if (c.priceBasis === "public_price_upper_bound" && !(hasPublishedPriceFacts(record, c.factIds, now) && c.factIds.every(id => record.facts.find(f => f.id === id)?.publicPrice?.conditions.every(condition => profile.evidence.includes(condition))))) reasons.push("published_price_conditions_not_confirmed");
    }
    const requiredFactIds = planFactIds(p);
    const requiredSources = [...new Set(requiredFactIds.flatMap(id => record.facts.find(f => f.id === id)?.sourceIds ?? []))];
    const reviews = trustedCurrentPlanReviews(record).filter(r => r.reviewerId !== record.review.authorAgentId && r.outcome === "approved" && r.method === "independent_source_recheck" && r.model && r.runId && r.evidenceArtifact && Number.isFinite(Date.parse(r.reviewedAt)) && Object.values(r.checks).every(Boolean) && r.findings.every(f => f.resolved) && requiredSources.every(s => r.sourceIds.includes(s)));
    if (new Set(reviews.map(r => r.reviewerId)).size < 2 || new Set(reviews.map(r => r.runId)).size < 2) reasons.push("plan_sources_not_dual_reviewed");
  }
  const costReasons = [...new Set([...result.costReasons, ...reasons.slice(result.reasons.length)])];
  if (result.peakWeeklyMinutes !== null && result.peakWeeklyMinutes > profile.weeklyHours * 60) reasons.push("weekly_time_not_feasible_for_profile");
  return { ...result, reasons: [...new Set(reasons)], costReasons, peakWeeklyMinutes: reasons.length ? null : result.peakWeeklyMinutes, maximumPersonalFen: costReasons.length ? null : result.maximumPersonalFen };
}
export function planFactIds(plan: FormalParticipationPlan): string[] {
  const found: string[] = [];
  const visit = (v: unknown) => { if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { if ((k === "factIds" || k.endsWith("FactIds")) && Array.isArray(x)) found.push(...x); else if (k === "conclusionFactId" && typeof x === "string") found.push(x); else visit(x); } };
  visit(plan); return [...new Set(found)];
}
/** Decimal yuan converts exactly to integer fen, without floating rounding that could undercount. */
export function yuanToFen(value: number): number | null {
  if (!Number.isFinite(value) || value < 0) return null;
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value)); if (!match) return null;
  const fen = BigInt(match[1]) * BigInt(100) + BigInt((match[2] ?? "").padEnd(2, "0"));
  return fen <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(fen) : null;
}
