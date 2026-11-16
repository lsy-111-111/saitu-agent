import { describe, expect, it, vi } from "vitest";
import type { CatalogAiReview, DecisionCompetitionRecord } from "@/lib/competitions/v6/catalog-types";
const { trustedLedger } = vi.hoisted(() => ({ trustedLedger: {} as Record<string, CatalogAiReview[]> }));
// Isolated fixed test dependency only. No product injection interface and no production ledger writes.
vi.mock("@/content/competitions-v6/ai-review-ledger.json", () => ({default:trustedLedger}));
import { makeSyntheticPlanRecord, attachSyntheticReviews as selfSign, profile, now } from "./formal-plan-fixtures";
import { validateDecisionRecord } from "@/lib/competitions/v6/catalog-validation";
import { isDecisionEvidenceFact } from "@/lib/competitions/v6/evidence";
import { COST_CATEGORIES, assessFormalParticipationPlan, coverageProfileDigest, inspectFormalParticipationPlan, yuanToFen, type FormalParticipationPlan } from "@/lib/competitions/v6/participation-plan";
import { assessStrictParticipation, assessNowRegistration } from "../../../scripts/competitions/v6/coverage-participation";
import { hasVerifiedAffordableTotal } from "../../../scripts/competitions/v6/evaluate-coverage";
function attachSyntheticReviews(r: DecisionCompetitionRecord) { selfSign(r); trustedLedger[r.recordId] = structuredClone(r.review.aiReviews!); }
function fixture() { const r = makeSyntheticPlanRecord(); attachSyntheticReviews(r); return r; }
const planOf = (r: DecisionCompetitionRecord) => r.participationPlans![0];
const costOf = (r: DecisionCompetitionRecord) => { const c = planOf(r).cost; if (c.kind !== "component_sum") throw new Error("fixture kind"); return c; };
const workOf = (r: DecisionCompetitionRecord) => { const w = planOf(r).workload; if (w.kind !== "editorial_estimate") throw new Error("fixture kind"); return w; };
const reassess = (r: DecisionCompetitionRecord) => { attachSyntheticReviews(r); return assessFormalParticipationPlan(r, profile, now); };

describe("typed, reviewed formal participation assessments (public synthetic contracts only)", () => {
  it("accepts reviewed task intervals and a recomputed complete personal upper bound without a total-cost fact", () => {
    const r = fixture(); const result = assessFormalParticipationPlan(r, profile, now);
    expect(result.reasons).toEqual([]); expect(result.maximumPersonalFen).toBe(5000); expect(result.peakWeeklyMinutes).toBe(300);
    expect(r.facts.some(f => f.field === "personalTotalCost")).toBe(false);
    expect(hasVerifiedAffordableTotal(r, 300, profile, now)).toBe(true);
    expect(assessStrictParticipation(r, profile, now)).toEqual({ passed: true, reasons: [] });
    const validation = validateDecisionRecord(r, now);
    expect(validation.currentRegistrationVerified).toBe(true);
    expect(validation.issues.filter(x => x.blocks === "L2")).toEqual([]);
  });
  it("does not accept a caller approval flag, human marker or stale digest after any estimate edit", () => {
    const r = fixture(); workOf(r).tasks[0].description += " revised";
    expect(assessFormalParticipationPlan(r, profile, now).reasons).toContain("trusted_ledger_current_digest_dual_review_required");
    attachSyntheticReviews(r); expect(assessFormalParticipationPlan(r, profile, now).reasons).toEqual([]);
    (planOf(r) as unknown as { approved: boolean }).approved = true;
    expect(reassess(r).reasons).toContain("invalid_typed_formal_participation_plan");
    const human = fixture(); human.review = { status: "human_reviewed", reviewerIds: ["caller"], reviewedAt: now.toISOString() };
    expect(assessFormalParticipationPlan(human, profile, now).reasons).toContain("trusted_ledger_current_digest_dual_review_required");
  });
  it("rejects fee-only and zero-registration plus remote without mandatory expense closure", () => {
    const r = fixture(); costOf(r).components = costOf(r).components.filter(c => c.category === "registration"); costOf(r).components[0].upperUnitFen = 0;
    expect(reassess(r).reasons).toContain("cost_stage_category_closure_missing");
    expect(hasVerifiedAffordableTotal(r, 300, profile, now)).toBe(false);
    delete r.participationPlans; r.cost = { minimumPersonalCny: 0, maximumPersonalCny: 0, factIds: ["synthetic-plan.fee.registration"], scope: r.scope, note: "Registration only" };
    expect(hasVerifiedAffordableTotal(r, 300)).toBe(false);
  });
  it("cannot infer existing network access from owned computer and phone", () => {
    const r = fixture(); const c = costOf(r).components.find(c => c.category === "connectivity")!;
    c.treatment = "owned"; c.priceBasis = "confirmed_owned"; c.upperUnitFen = 0; c.ownedResource = {kind:"connectivity",name:"network access"};
    planOf(r).prerequisites.ownedEquipment.push("network access");
    expect(reassess(r).reasons).toContain("profile_prerequisites_not_confirmed");
    const noNetwork = fixture(); const n = costOf(noNetwork).components.find(c => c.category === "connectivity")!;
    n.treatment = "not_required"; n.priceBasis = "workflow_closure"; n.upperUnitFen = 0;
    expect(reassess(noNetwork).reasons).toContain("remote_connectivity_unaccounted");
  });
  it.each(["scope", "source", "historical", "price_expiry", "unknown", "missing_stage", "reimbursement"]) ("propagates %s rather than inventing an affordable total", kind => {
    const r = fixture();
    if (kind === "scope") planOf(r).scope = "Other track";
    if (kind === "source") r.sources[0].integrity = "requires_recheck";
    if (kind === "historical") r.facts.find(f => f.field === "cost.public_upper_bound")!.status = "historical";
    if (kind === "price_expiry") costOf(r).components[0].validThrough = "2026-11-03";
    if (kind === "unknown") costOf(r).components[0].upperUnitFen = null;
    if (kind === "missing_stage") r.stages!.push({ id: "national-final", name: "Mandatory later stage", factIds: [r.facts[0].id] });
    if (kind === "reimbursement") (costOf(r).components[0] as unknown as { expectedReimbursementFen: number }).expectedReimbursementFen = 2000;
    expect(reassess(r).reasons.length).toBeGreaterThan(0); expect(hasVerifiedAffordableTotal(r, 300, profile, now)).toBe(false);
  });
  it("refuses an eight-hour event averaged across four weeks or hidden beneath a lower declared peak", () => {
    const r = fixture(), w = workOf(r); w.sessions[0].endAt = "2026-11-07T18:00:00Z";
    w.tasks.find(t => t.id === "session")!.maximumMinutes = 480;
    for (const weekStart of ["2026-11-09", "2026-11-16", "2026-11-23"]) w.weeks.push({ weekStart, allocations: [{ taskId: "session", maximumMinutes: 120 }] });
    expect(reassess(r).reasons).toContain("official_session_peak_averaged_or_missing");
    const peak = fixture(); workOf(peak).peakWeeklyMinutes = 120;
    expect(reassess(peak).reasons).toContain("weekly_peak_bound_invalid");
  });
  it("requires allocation of learning and rework, all task upper bounds, and the individual's confirmed prerequisites", () => {
    const r = fixture(); workOf(r).tasks = workOf(r).tasks.filter(t => t.kind !== "learning");
    expect(reassess(r).reasons).toContain("learning_allowance_missing");
    const missing = fixture(); workOf(missing).weeks[0].allocations[0].maximumMinutes = 60;
    expect(reassess(missing).reasons).toContain("task_upper_bound_not_fully_allocated");
    const prereq = fixture(); planOf(prereq).prerequisites.experience = "coursework";
    expect(reassess(prereq).reasons).toContain("profile_prerequisites_not_confirmed");
    const changedProfile = { ...profile, constraints: [...profile.constraints, "New restriction"] };
    expect(assessFormalParticipationPlan(fixture(), changedProfile, now).reasons).toContain("unique_profile_bound_plan_required");
  });
  it("does not turn an official event-duration scalar into a complete workload", () => {
    const r = fixture(); delete r.participationPlans;
    r.participationRequirements!.weeklyHours = { value: 2, factIds: ["synthetic-hours"], meaning: "official_event_duration" };
    r.facts.push({ ...r.facts[0], id: "synthetic-hours", field: "participation.weeklyHours" }); attachSyntheticReviews(r);
    expect(assessStrictParticipation(r, profile, now).reasons).toContain("complete_path_workload_bound_required");
  });
  it("supports a reviewed resource inference from the complete workflow while leaving official norms official", () => {
    const r = fixture(); const f = r.facts.find(f => f.field === "participation.mentor")!;
    f.kind = "editorial_inference"; f.sourceIds = [];
    planOf(r).resourceDerivations.push({ field: "mentor", conclusionFactId: f.id, basisFactIds: planOf(r).path.officialFactIds, rationale: "Complete mandatory individual workflow contains no mentor-dependent activity; reviewed inference, not official quote." });
    attachSyntheticReviews(r);
    expect(assessStrictParticipation(r, profile, now).passed).toBe(true);
    expect(validateDecisionRecord(r, now).currentRegistrationVerified).toBe(true);
  });
  it("allows an applicable official complete personal total with an investment field, never a fee-only total", () => {
    const r = fixture(); const fact = { ...r.facts[0], id: "synthetic-total", field: "investment" }; r.facts.push(fact);
    planOf(r).cost = { kind: "direct_official_total", maximumPersonalFen: 5000, factIds: [fact.id], definition: "all_required_personal_expenditure", stageIds: ["final"], includedCategories: [...COST_CATEGORIES], exceptions: [], validFrom: "2026-11-01", validThrough: "2026-12-31" };
    expect(reassess(r).maximumPersonalFen).toBe(5000);
    fact.field = "fee"; expect(reassess(r).reasons).toContain("direct_total_is_not_registration_fee");
  });
  it("computes integer fen without rounding down, rejects unsafe multiplication and compares the exact budget", () => {
    expect(yuanToFen(0.29)).toBe(29); expect(yuanToFen(0.001)).toBeNull(); expect(yuanToFen(Number.MAX_SAFE_INTEGER)).toBeNull();
    const r = fixture(); const c = costOf(r).components[0]; c.upperUnitFen = Number.MAX_SAFE_INTEGER; c.quantity = 2;
    expect(reassess(r).reasons).toContain("cost_integer_overflow");
    const over = fixture(); costOf(over).components[0].upperUnitFen = 27001;
    expect(reassess(over).maximumPersonalFen).toBe(30001); expect(hasVerifiedAffordableTotal(over, 300, profile, now)).toBe(false);
  });
  it("supports an official complete-path weekly bound but keeps over-budget time separate from a known cost", () => {
    const r = fixture(); const id = "synthetic-official-workload";
    r.facts.push({ ...r.facts[0], id, field: "participation.weeklyHours" });
    planOf(r).workload = { kind: "official_complete_path_bound", factIds: [id], weeks: [{ weekStart: "2026-11-02", maximumMinutes: 420, factIds: [id] }], sessions: [], peakWeeklyMinutes: 420 };
    const result = reassess(r);
    expect(result.reasons).toContain("weekly_time_not_feasible_for_profile");
    expect(result.maximumPersonalFen).toBe(5000);
    expect(hasVerifiedAffordableTotal(r, 300, profile, now)).toBe(true);
    expect(assessStrictParticipation(r, profile, now).passed).toBe(false);
  });
  it("fails closed on malformed plan arrays and an altered official source scope", () => {
    const r = fixture(); r.participationPlans = [null] as unknown as FormalParticipationPlan[];
    expect(() => assessFormalParticipationPlan(r, profile, now)).not.toThrow();
    expect(assessFormalParticipationPlan(r, profile, now).reasons).toContain("unique_profile_bound_plan_required");
    const mismatch = fixture(); mismatch.sources[0].scope = "Unrelated region and season";
    expect(reassess(mismatch).reasons).toContain("formal_path_current_official_closure_missing");
  });
  it("keeps the registration 72-hour gate unchanged and does not downgrade an honest unknown cost into malformed editorial content", () => {
    const r = fixture(); costOf(r).components[0].upperUnitFen = null; attachSyntheticReviews(r);
    expect(inspectFormalParticipationPlan(r, planOf(r), now).reasons).toContain("component_upper_bound_unknown");
    expect(validateDecisionRecord(r, now).currentRegistrationVerified).toBe(true);
    expect(assessStrictParticipation(r, profile, now).passed).toBe(false);
    const stale = fixture(); stale.registration.checkedAt = "2026-11-02T23:59:59.999Z"; attachSyntheticReviews(stale);
    expect(assessNowRegistration(stale, now)).toBe(false);
    expect(assessStrictParticipation(stale, profile, now).passed).toBe(true);
    const boundary = fixture(); boundary.registration.checkedAt = "2026-11-03T00:00:00Z"; attachSyntheticReviews(boundary);
    expect(validateDecisionRecord(boundary, now).currentRegistrationVerified).toBe(true);
  });
  it("rejects the exact fixed-300-budget PC-as-connectivity reversal even with isolated trusted test reviews", () => {
    const r = fixture(); costOf(r).components.find(c => c.category === "registration")!.upperUnitFen = 28000;
    expect(reassess(r).maximumPersonalFen).toBe(31000);
    expect(hasVerifiedAffordableTotal(r, 300, profile, now)).toBe(false);
    const c = costOf(r).components.find(c => c.category === "connectivity")!;
    c.treatment = "owned"; c.priceBasis = "confirmed_owned"; c.upperUnitFen = 0;
    c.ownedResource = { kind: "device", name: profile.equipment[0] };
    c.factIds = planOf(r).path.stages[0].factIds;
    expect(reassess(r).reasons).toContain("owned_resource_category_mismatch");
    expect(hasVerifiedAffordableTotal(r, 300, profile, now)).toBe(false);
    c.ownedResource.kind = "connectivity";
    expect(reassess(r).reasons).toContain("owned_resource_not_confirmed_for_profile");
  });
  it("accepts a truthfully typed supplier quote with real frozen public body bytes, without making it an official rule", () => {
    const r = fixture(); const price = r.facts.find(f => f.kind === "published_price")!;
    const source = r.sources.find(s => s.authority === "supplier")!;
    expect(price.publicPrice?.maximumUnitFen).toBe(3000); expect(source.publicPriceCapture?.bodySha256).toMatch(/^[a-f0-9]{64}$/);
    expect(assessFormalParticipationPlan(r, profile, now).maximumPersonalFen).toBe(5000);
    price.kind = "official_fact";
    expect(isDecisionEvidenceFact(r, price)).toBe(false);
    expect(reassess(r).costReasons).toContain("component_scope_date_or_evidence_invalid");
  });
  it.each(["wrong_hash", "missing_body", "path_escape", "unsupported_currency", "unconfirmed_condition", "unit_mismatch"]) ("rejects supplier evidence with %s", issue => {
    const r = fixture(), source = r.sources.find(s => s.authority === "supplier")!, price = r.facts.find(f => f.kind === "published_price")!;
    if (issue === "wrong_hash") source.publicPriceCapture!.bodySha256 = "0".repeat(64);
    if (issue === "missing_body") source.publicPriceCapture!.bodyArtifact += ".missing";
    if (issue === "path_escape") source.publicPriceCapture!.bodyArtifact = "artifacts/../outside-public-evidence.txt";
    if (issue === "unsupported_currency") (price.publicPrice as unknown as {currency:string}).currency = "USD";
    if (issue === "unconfirmed_condition") price.publicPrice!.conditions = ["existing paid network account"];
    if (issue === "unit_mismatch") price.publicPrice!.unit = "one day";
    expect(reassess(r).costReasons.length).toBeGreaterThan(0);
    expect(hasVerifiedAffordableTotal(r, 300, profile, now)).toBe(false);
  });
  it("does not let a snapshot author self-sign after changing a formerly trusted plan", () => {
    const r = fixture(); planOf(r).path.completionDefinition += " changed by caller";
    selfSign(r); // deliberately does not write even the isolated test ledger
    expect(assessFormalParticipationPlan(r, profile, now).reasons).toContain("trusted_ledger_current_digest_dual_review_required");
  });
  it("accepts published upcoming formal planning while independently refusing the now-open badge", () => {
    const r = fixture(); r.registration.status = "upcoming";
    const p = planOf(r); p.timing.registrationOpens!.value = "2026-11-08"; p.timing.registrationCloses!.value = "2026-11-15";
    p.timing.stages[0].starts!.value = "2026-11-21"; p.timing.stages[0].ends!.value = "2026-11-22";
    const w = workOf(r); w.weeks[0].weekStart = "2026-11-16"; w.sessions[0].startAt = "2026-11-21T10:00:00Z"; w.sessions[0].endAt = "2026-11-21T12:00:00Z";
    expect(reassess(r).reasons).toEqual([]);
    expect(assessStrictParticipation(r, profile, now).passed).toBe(true);
    expect(assessNowRegistration(r, now)).toBe(false);
  });
  it("respects official month precision without inventing an opening hour", () => {
    const r = fixture(); r.registration.status = "upcoming";
    const p = planOf(r); p.timing.registrationOpens = {value:"2026-11",precision:"month",utcOffsetMinutes:0}; p.timing.registrationCloses = {value:"2026-12",precision:"month",utcOffsetMinutes:0};
    // R3: November-only opening cannot guarantee entry to the former November 7 session.
    // Keep month precision and the original assertions; move the mandatory event after latest opening.
    p.timing.stages[0].starts = {value:"2026-12",precision:"month",utcOffsetMinutes:0}; p.timing.stages[0].ends = {value:"2027-01",precision:"month",utcOffsetMinutes:0};
    const w = workOf(r); w.weeks[0].weekStart = "2026-11-30";
    w.sessions[0].startAt = "2026-12-05T10:00:00Z"; w.sessions[0].endAt = "2026-12-05T12:00:00Z";
    expect(reassess(r).reasons).toEqual([]);
    expect(assessStrictParticipation(r, profile, now).passed).toBe(true); expect(assessNowRegistration(r, now)).toBe(false);
    p.timing.registrationCloses.value = "2026-11";
    expect(reassess(r).reasons).toContain("registration_deadline_passed_or_precision_insufficient");
  });
  it.each(["missing_window", "closed_entry", "historical", "ended_stage", "wrong_edition", "unpublished_schedule", "past_work", "past_session", "wrong_session_stage"]) ("does not count %s as a published future opportunity", issue => {
    const r = fixture(); const p = planOf(r);
    if (issue === "missing_window") p.timing.registrationOpens = null;
    if (issue === "closed_entry") p.timing.registrationCloses!.value = "2026-11-05";
    if (issue === "historical") r.registration.status = "historical";
    if (issue === "ended_stage") p.timing.stages[0].ends!.value = "2026-11-05";
    if (issue === "wrong_edition") p.timing.editionId = "2025-ended";
    if (issue === "unpublished_schedule") r.facts.find(f => f.field === "schedule.final")!.status = "pending_review";
    if (issue === "past_work") workOf(r).weeks[0].weekStart = "2026-10-26";
    if (issue === "past_session") { p.timing.stages[0].starts!.value = "2026-11-01"; workOf(r).sessions[0].startAt = "2026-11-05T10:00:00Z"; workOf(r).sessions[0].endAt = "2026-11-05T12:00:00Z"; }
    if (issue === "wrong_session_stage") workOf(r).sessions[0].stageId = "another-branch";
    expect(reassess(r).reasons.length).toBeGreaterThan(0); expect(assessStrictParticipation(r, profile, now).passed).toBe(false);
  });

});
