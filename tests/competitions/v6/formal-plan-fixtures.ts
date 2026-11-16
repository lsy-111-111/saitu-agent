import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getCoverageProfiles } from "@/lib/competitions/v6/catalog";
import { catalogContentDigest } from "@/lib/competitions/v6/catalog-review";
import { COST_CATEGORIES, coverageProfileDigest, type FormalParticipationPlan } from "@/lib/competitions/v6/participation-plan";
import type { DecisionCompetitionRecord, ParticipationRequirements } from "@/lib/competitions/v6/catalog-types";
import { syntheticRecord } from "./decision-fixtures";
export const now = new Date("2026-11-06T00:00:00Z");
export const profile = getCoverageProfiles()[0];
/** Test-only certification markers exercise digest validation. Never real reviews or ledger writes. */
export function attachSyntheticReviews(r: DecisionCompetitionRecord) {
  r.review.policy = "ai_dual_review"; r.review.authorAgentId = "SYNTHETIC-CONTRACT-ONLY-author";
  r.review.aiReviews = ["A", "B"].map(id => ({ reviewerId: `SYNTHETIC-CONTRACT-ONLY-${id}`, runId: `SYNTHETIC-CONTRACT-ONLY-run-${id}`, model: "test-only", reviewedAt: now.toISOString(), contentDigest: catalogContentDigest(r), method: "independent_source_recheck", sourceIds: r.sources.map(s => s.id), evidenceArtifact: "SYNTHETIC-CONTRACT-ONLY", checks: { factualSupport: true, entityScope: true, studentUsefulness: true, temporalAccuracy: true }, outcome: "approved", findings: [] }));
}
export function makeSyntheticPlanRecord() {
  const r = syntheticRecord(998);
  r.scope = r.sources[0].scope = r.facts[0].scope = "SYNTHETIC-CONTRACT-ONLY current complete formal path";
  r.sources[0].locator = "SYNTHETIC-CONTRACT-ONLY exact workflow and price paragraphs";
  r.facts[0].status = "verified_current";
  r.identity = {editionId:"synthetic-2026",trackId:r.track.id,groupId:"synthetic-student",scopeId:"synthetic-national",stageIds:["final"],supersedesRecordIds:[],legacyRecordIds:[]};
  r.roles[0].personalDeliverable = "SYNTHETIC-CONTRACT-ONLY complete reproducible notebook";
  const add = (field: string) => { const id = `synthetic-plan.${field}`; r.facts.push({ ...r.facts[0], id, field, text: `SYNTHETIC-CONTRACT-ONLY ${field} complete scope and upper bound.` }); return [id]; };
  r.registration = { status: "open", checkedAt: now.toISOString(), factIds: add("registration.open"), note: "SYNTHETIC-CONTRACT-ONLY" };
  const values = { teamSize: { minimum: 1, maximum: 1 }, mentor: false, laboratory: false, equipment: [profile.equipment[0]], attendance: "remote", weeklyHours: null };
  r.participationRequirements = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value, factIds: key === "weeklyHours" ? [] : add(`participation.${key}`) }])) as ParticipationRequirements;
  const pathFacts = add("participation.formalPath"), stageFacts = add("participation.stage.final"), priceFacts = add("cost.public_upper_bound"), feeFacts = add("fee.registration");
  r.stages = [{ id: "final", name: "Only mandatory formal stage", factIds: stageFacts }];
  const plan: FormalParticipationPlan = {
    version: "saitu.formal-participation-plan.v2", id: "SYNTHETIC-CONTRACT-ONLY", scope: r.scope,
    profileId: profile.id, profileDigest: coverageProfileDigest(profile),
    path: { completionDefinition: "Every mandatory formal deliverable including final submission", officialFactIds: pathFacts, stages: [{ id: "final", deliverable: "Complete tested submission", factIds: stageFacts }], exitConditions: ["Stop if any prerequisite or price ceiling ceases to apply"] },
    prerequisites: { experience: profile.experience, evidence: [], ownedEquipment: [profile.equipment[0]], additionalRequirements: [], role: "sole contributor", teamSize: 1 },
    timing: { editionId: "synthetic-2026", rulesFactIds: pathFacts, registrationFactIds: add("registration.window"), scheduleFactIds: add("schedule.final"),
      registrationOpens: {value:"2026-11-01",precision:"day",utcOffsetMinutes:0}, registrationCloses: {value:"2026-11-07",precision:"day",utcOffsetMinutes:0},
      stages: [{stageId:"final",starts:{value:"2026-11-07",precision:"day",utcOffsetMinutes:0},ends:{value:"2026-11-08",precision:"day",utcOffsetMinutes:0}}] },
    resourceDerivations: [],
    workload: { kind: "editorial_estimate", methodology: "Task decomposition includes learning, revisions and fixed official session; intervals are not performance guarantees.",
      tasks: [
        { id: "delivery", stageId: "final", description: "Build and verify complete submission", role: "sole contributor", kind: "delivery", minimumMinutes: 60, maximumMinutes: 120, factIds: stageFacts },
        { id: "learn", stageId: "final", description: "Learn required submission format", role: "sole contributor", kind: "learning", minimumMinutes: 15, maximumMinutes: 30, factIds: stageFacts },
        { id: "rework", stageId: "final", description: "Rerun and fix failed checks", role: "sole contributor", kind: "rework", minimumMinutes: 15, maximumMinutes: 30, factIds: stageFacts },
        { id: "session", stageId: "final", description: "Mandatory uninterrupted official event", role: "sole contributor", kind: "official_session", minimumMinutes: 120, maximumMinutes: 120, factIds: stageFacts },
      ], weeks: [{ weekStart: "2026-11-02", allocations: [{ taskId: "delivery", maximumMinutes: 120 }, { taskId: "learn", maximumMinutes: 30 }, { taskId: "rework", maximumMinutes: 30 }, { taskId: "session", maximumMinutes: 120 }] }],
      sessions: [{ taskId: "session", stageId: "final", startAt: "2026-11-07T10:00:00Z", endAt: "2026-11-07T12:00:00Z", factIds: stageFacts }], peakWeeklyMinutes: 300 },
    cost: { kind: "component_sum", components: COST_CATEGORIES.map(category => ({ id: category, category, stageId: "final", explanation: "Explicit complete workflow closure; publicly bounded incremental price when required.",
      treatment: category === "registration" || category === "connectivity" ? "paid" : category === "tools" ? "owned" : "not_required",
      priceBasis: category === "registration" ? "organizer_fee" : category === "connectivity" ? "public_price_upper_bound" : category === "tools" ? "confirmed_owned" : "workflow_closure",
      upperUnitFen: category === "registration" ? 2000 : category === "connectivity" ? 3000 : 0, quantity: 1, unit: "complete path",
      ...(category === "tools" ? { ownedResource: {kind:"device" as const,name:profile.equipment[0]} } : {}), factIds: category === "registration" ? feeFacts : category === "connectivity" ? priceFacts : stageFacts,
      validFrom: "2026-11-01", validThrough: "2026-12-31" })) },
  };
  const publicEvidence = "artifacts/continuation-20261105/strict-plan-test-evidence/public-evidence";
  const body = "SYNTHETIC-CONTRACT-ONLY supplier prepaid connectivity, maximum 30 CNY per complete path, all users, 2026-11-01 through 2026-12-31.";
  const raw = `<html><body>${body}</body></html>`;
  const hash = (s: string) => createHash("sha256").update(s).digest("hex");
  mkdirSync(path.resolve(publicEvidence), {recursive:true});
  const rawPath = `${publicEvidence}/${hash(raw)}.html`, bodyPath = `${publicEvidence}/${hash(body)}.txt`;
  writeFileSync(rawPath,raw); writeFileSync(bodyPath,body);
  const supplierId = "synthetic-supplier-price";
  r.sources.push({...r.sources[0],id:supplierId,url:"https://supplier.example.test/prepaid",publisher:"SYNTHETIC supplier",authority:"supplier",integrity:"consistent",publicPriceCapture:{sourceArtifact:rawPath,sourceByteSha256:hash(raw),bodyArtifact:bodyPath,bodySha256:hash(body),retrievedAt:"2026-11-05T00:00:00Z"}});
  const price = r.facts.find(f => f.id === priceFacts[0])!;
  price.kind = "published_price"; price.sourceIds = [supplierId];
  price.publicPrice = {currency:"CNY",maximumUnitFen:3000,unit:"complete path",validFrom:"2026-11-01",validThrough:"2026-12-31",applicableScope:r.scope,conditions:[]};
  r.participationPlans = [plan]; attachSyntheticReviews(r); return r;
}
