import { expect, it, vi } from "vitest";
import type { CatalogAiReview, DecisionCompetitionRecord } from "@/lib/competitions/v6/catalog-types";
const { ledger } = vi.hoisted(() => ({ ledger: {} as Record<string, CatalogAiReview[]> }));
vi.mock("@/content/competitions-v6/ai-review-ledger.json", () => ({ default: ledger }));
import { makeSyntheticPlanRecord, attachSyntheticReviews, profile, now } from "./formal-plan-fixtures";
import { assessFormalParticipationPlan, inspectFormalParticipationPlan } from "@/lib/competitions/v6/participation-plan";
import { publishedDateBounds, publishedPlanDateSchema } from "@/lib/competitions/v6/formal-plan-timing";
import { remainingWorkFits } from "@/lib/competitions/v6/formal-plan-capacity";
import { assessStrictParticipation, assessNowRegistration } from "../../../scripts/competitions/v6/coverage-participation";

const instant = (value: string) => ({ value, precision: "instant" as const, utcOffsetMinutes: 0 });
function result(r: DecisionCompetitionRecord, asOf = now) {
  attachSyntheticReviews(r); ledger[r.recordId] = structuredClone(r.review.aiReviews!);
  return { plan: assessFormalParticipationPlan(r, profile, asOf), strict: assessStrictParticipation(r, profile, asOf) };
}
function withoutSession() {
  const r = makeSyntheticPlanRecord(), p = r.participationPlans![0], w = p.workload;
  if (w.kind !== "editorial_estimate") throw Error("fixture kind");
  w.tasks = w.tasks.filter(t => t.kind !== "official_session"); w.sessions = [];
  w.weeks[0].allocations = w.weeks[0].allocations.filter(a => a.taskId !== "session"); w.peakWeeklyMinutes = 180;
  return { r, p, w };
}
it("rejects the original entry-after-final counterexample", () => {
  const r = makeSyntheticPlanRecord(), p = r.participationPlans![0]; r.registration.status = "upcoming";
  p.timing.registrationOpens!.value = "2026-12-01"; p.timing.registrationCloses!.value = "2026-12-10";
  const a = result(r); expect(a.strict.passed).toBe(false);
  expect(a.plan.reasons).toContain("registration_entry_after_required_stage");
  expect(a.plan.reasons).toContain("registration_entry_after_required_session");
});
it("rejects entry after a fixed session even when delivery is later", () => {
  const r = makeSyntheticPlanRecord(), p = r.participationPlans![0];
  p.timing.registrationOpens = instant("2026-11-07T11:00:00Z"); p.timing.registrationCloses = instant("2026-11-07T23:00:00Z");
  expect(result(r).plan.reasons).toContain("registration_entry_after_required_session");
});
it("keeps future formal planning and preparation before registration valid", () => {
  const r = makeSyntheticPlanRecord(), p = r.participationPlans![0]; r.registration.status = "upcoming";
  p.timing.registrationOpens = instant("2026-11-07T09:00:00Z"); p.timing.registrationCloses = instant("2026-11-07T23:00:00Z");
  expect(result(r).strict.passed).toBe(true); expect(assessNowRegistration(r, now)).toBe(false);
});
it("refuses same-day uncertain entry before a morning session without inventing an hour", () => {
  const r = makeSyntheticPlanRecord(), p = r.participationPlans![0];
  p.timing.registrationOpens!.value = "2026-11-07"; p.timing.registrationCloses!.value = "2026-11-08";
  expect(result(r).plan.reasons).toContain("registration_entry_after_required_session");
});
it("refuses month-precision entry that may open after a required delivery", () => {
  const { r, p } = withoutSession(); p.timing.registrationOpens = { value: "2026-11", precision: "month", utcOffsetMinutes: 0 };
  p.timing.registrationCloses!.value = "2026-12-01";
  expect(result(r).plan.reasons).toContain("registration_entry_after_required_stage");
});
it("preserves the original R2 month-positive dates as a rejected chronology regression", () => {
  const r = makeSyntheticPlanRecord(), p = r.participationPlans![0]; r.registration.status = "upcoming";
  p.timing.registrationOpens = { value: "2026-11", precision: "month", utcOffsetMinutes: 0 };
  p.timing.registrationCloses = { value: "2026-12", precision: "month", utcOffsetMinutes: 0 };
  p.timing.stages[0].starts = { value: "2026-11", precision: "month", utcOffsetMinutes: 0 };
  p.timing.stages[0].ends = { value: "2026-12", precision: "month", utcOffsetMinutes: 0 };
  const a = result(r); expect(a.strict.passed).toBe(false);
  expect(a.plan.reasons).toContain("registration_entry_after_required_session");
});
it("rejects the original three-hours-in-four-minutes counterexample", () => {
  const { r, p, w } = withoutSession(), asOf = new Date("2026-11-08T23:55:00Z");
  p.timing.registrationOpens = instant("2026-11-08T00:00:00Z"); p.timing.registrationCloses = instant("2026-11-08T23:59:00Z");
  p.timing.stages[0].starts = instant("2026-11-08T00:00:00Z"); p.timing.stages[0].ends = instant("2026-11-08T23:59:00Z");
  expect(w.tasks.reduce((n, t) => n + t.minimumMinutes, 0)).toBe(90);
  const a = result(r, asOf); expect(a.strict.passed).toBe(false); expect(a.plan.peakWeeklyMinutes).toBeNull();
  expect(a.plan.reasons).toContain("remaining_work_exceeds_real_time_capacity");
});
it("keeps the full weekly budget on the final day when sufficient real hours remain", () => {
  const { r, p } = withoutSession(), asOf = new Date("2026-11-08T20:00:00Z");
  p.timing.registrationCloses = instant("2026-11-08T23:59:00Z"); p.timing.stages[0].ends = instant("2026-11-08T23:00:00Z");
  expect(result(r, asOf).strict.passed).toBe(true);
});
it("does not place current-week tasks beyond their own stage deadline", () => {
  const { r, p } = withoutSession(); p.timing.stages[0].starts = instant("2026-11-06T00:00:00Z"); p.timing.stages[0].ends = instant("2026-11-06T01:00:00Z");
  expect(result(r).plan.reasons).toContain("remaining_work_exceeds_real_time_capacity");
});
it.each([false, true])("shares same-week multi-stage deadline capacity (feasible=%s)", feasible => {
  const { r, p, w } = withoutSession();
  p.timing.stages[0].starts = instant("2026-11-06T00:00:00Z"); p.timing.stages[0].ends = instant("2026-11-06T03:00:00Z");
  r.stages!.push({ ...r.stages![0], id: "second" }); p.path.stages.push({ ...p.path.stages[0], id: "second" });
  p.timing.stages.push({ stageId: "second", starts: instant("2026-11-06T00:00:00Z"), ends: instant(feasible ? "2026-11-06T05:00:00Z" : "2026-11-06T04:00:00Z") });
  w.tasks.push({ ...w.tasks[0], id: "delivery-second", stageId: "second" }); w.weeks[0].allocations.push({ taskId: "delivery-second", maximumMinutes: 120 }); w.peakWeeklyMinutes = 300;
  if (p.cost.kind !== "component_sum") throw Error("fixture kind");
  p.cost.components.push(...p.cost.components.map(c => ({ ...c, id: c.id + "-second", stageId: "second" })));
  const a = result(r); expect(a.strict.passed).toBe(feasible);
  expect(a.plan.reasons.includes("remaining_work_exceeds_real_time_capacity")).toBe(!feasible);
});
it("reserves fixed sessions while scheduling flexible work", () => {
  const r = makeSyntheticPlanRecord(), p = r.participationPlans![0];
  p.timing.stages[0].starts = instant("2026-11-06T00:00:00Z"); p.timing.stages[0].ends = instant("2026-11-06T04:00:00Z");
  p.workload.sessions[0].startAt = "2026-11-06T01:00:00Z"; p.workload.sessions[0].endAt = "2026-11-06T03:00:00Z";
  expect(result(r).plan.reasons).toContain("remaining_work_exceeds_real_time_capacity");
  p.timing.stages[0].ends = instant("2026-11-06T05:00:00Z"); expect(result(r).strict.passed).toBe(true);
});
it("does not double count overlapping mandatory sessions", () => {
  expect(remainingWorkFits(0, 600000, [], [{ start: 0, end: 120000 }, { start: 60000, end: 180000 }])).toBe(false);
});
it("checks cumulative earlier deadlines even when total weekly wall time is ample", () => {
  expect(remainingWorkFits(0, 600000, [{ deadline: 120000, milliseconds: BigInt(180000) }, { deadline: 600000, milliseconds: BigInt(60000) }], [])).toBe(false);
});
it("retains sub-minute capacity exactly without rounding fixed-session reservations away", () => {
  const fixed = [{ start: 0, end: 30000 }];
  expect(remainingWorkFits(0, 60000, [{ deadline: 60000, milliseconds: BigInt(30000) }], fixed)).toBe(true);
  expect(remainingWorkFits(0, 60000, [{ deadline: 60000, milliseconds: BigInt(30001) }], fixed)).toBe(false);
});
it("applies real remaining capacity to the official aggregate path too", () => {
  const { r, p } = withoutSession(), fact = r.facts.find(f => f.field === "participation.formalPath")!;
  r.facts.push({ ...fact, id: "synthetic-official-hours", field: "participation.weeklyHours" });
  p.workload = { kind: "official_complete_path_bound", factIds: ["synthetic-official-hours"], weeks: [{ weekStart: "2026-11-02", maximumMinutes: 180, factIds: ["synthetic-official-hours"] }], sessions: [], peakWeeklyMinutes: 180 };
  p.timing.stages[0].starts = instant("2026-11-06T00:00:00Z"); p.timing.stages[0].ends = instant("2026-11-06T00:04:00Z");
  expect(result(r).plan.reasons).toContain("remaining_work_exceeds_real_time_capacity");
  p.timing.stages[0].ends = instant("2026-11-06T03:00:00Z"); expect(result(r).strict.passed).toBe(true);
});
it.each(["2026-11-31T00:00:00Z", "2026-02-29T00:00:00Z", "2026-11-06T24:00:00Z", "2026-11-06T23:60:00Z", "2026-11-06T23:59:60Z", "2026-11-06T00:00:00+08:60", "2026-11-06T00:00:00+14:01"])("rejects nonexistent instant %s", value => {
  expect(publishedPlanDateSchema.safeParse(instant(value)).success).toBe(false); expect(publishedDateBounds(instant(value))).toBeNull();
});
it("preserves leap days, milliseconds, offset-local dates and day/month precision", () => {
  const leap = { value: "2028-02-29T23:59:59.999+08:00", precision: "instant" as const, utcOffsetMinutes: 480 };
  expect(publishedPlanDateSchema.safeParse(leap).success).toBe(true);
  expect(publishedDateBounds(leap)).toEqual({ earliest: Date.parse(leap.value), latest: Date.parse(leap.value) });
  expect(publishedDateBounds({ value: "2028-02-29", precision: "day", utcOffsetMinutes: 480 })).toEqual({ earliest: Date.parse("2028-02-28T16:00:00Z"), latest: Date.parse("2028-02-29T15:59:59.999Z") });
  expect(publishedDateBounds({ value: "2028-02", precision: "month", utcOffsetMinutes: 0 })?.latest).toBe(Date.parse("2028-02-29T23:59:59.999Z"));
  expect(publishedDateBounds({ ...leap, utcOffsetMinutes: 0 })).toBeNull();
});
it("rejects invalid now without throwing or trusting past work", () => {
  const r = makeSyntheticPlanRecord(); expect(inspectFormalParticipationPlan(r, r.participationPlans![0], new Date(NaN)).reasons).toEqual(["invalid_assessment_time"]);
});
