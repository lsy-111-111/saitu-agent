import type { CoverageProfile, DecisionCompetitionRecord, ParticipationRequirements } from "@/lib/competitions/v6/catalog-types";
import { isDecisionEvidenceFact, isEvidenceForRecord } from "@/lib/competitions/v6/evidence";
import { validateDecisionRecord } from "@/lib/competitions/v6/catalog-validation";
import { assessFormalParticipationPlan } from "@/lib/competitions/v6/participation-plan";
import { participationRequirementsSchema } from "@/lib/competitions/v6/participation-requirements";

/** The now-open badge retains its independent 72-hour registration policy. */
export function assessNowRegistration(record: DecisionCompetitionRecord, now: Date) {
  return validateDecisionRecord(record, now).currentRegistrationVerified;
}
/** Formal planning can precede opening, but never precedes published applicable evidence. */
export function assessStrictParticipation(record: DecisionCompetitionRecord, profile: CoverageProfile, now: Date) {
  const reasons: string[] = [];
  const parsed=participationRequirementsSchema.safeParse(record.participationRequirements);
  const resources = parsed.success?parsed.data:undefined;
  if(!parsed.success)reasons.push("complete_typed_participation_requirements_required");

  const planResult = record.participationPlans !== undefined ? assessFormalParticipationPlan(record, profile, now) : undefined;
  if (planResult) reasons.push(...planResult.reasons);
  else reasons.push("published_formal_participation_plan_required");
  const keys: (keyof ParticipationRequirements)[] = ["teamSize", "mentor", "laboratory", "equipment", "attendance", "weeklyHours"];
  for (const key of keys) {
    const requirement = resources?.[key];
    if (key === "weeklyHours" && planResult?.plan && planResult.reasons.length === 0) continue;
    const derivation = planResult?.plan?.resourceDerivations.find(d => d.field === key);
    if (key !== "teamSize" && key !== "weeklyHours" && derivation && planResult?.reasons.length === 0 && requirement?.value !== null && requirement?.factIds.length === 1 && requirement.factIds[0] === derivation.conclusionFactId) continue;
    if (!requirement || requirement.value === null || !requirement.factIds.length || !requirement.factIds.every(id => record.facts.some(fact =>
      fact.id === id && fact.field === `participation.${key}` && fact.kind === "official_fact" && fact.status === "verified_current"
      && isEvidenceForRecord(record, fact) && isDecisionEvidenceFact(record, fact)
      && fact.sourceIds.every(sourceId => record.sources.some(source => source.id === sourceId && source.integrity !== "requires_recheck"))))) {
      reasons.push(`${key}_requirements_not_verified`);
    }
  }
  if (resources) {
    const team = resources.teamSize?.value;
    // "Available to form a team" is not an established team or a confirmed headcount.
    if (team && (!Number.isInteger(team.minimum) || !Number.isInteger(team.maximum) || team.minimum < 1 || team.maximum < team.minimum || team.minimum > 1)) reasons.push("actual_team_not_confirmed_or_requirement_invalid");
    if (resources.mentor?.value === true) reasons.push("required_mentor_access_not_confirmed");
    if (resources.laboratory?.value === true) reasons.push("required_laboratory_access_not_confirmed");
    // The source protocol's mentor/lab flags mean obtainable, not already accessible.
    if (resources.equipment?.value && (!Array.isArray(resources.equipment.value) || resources.equipment.value.some(item => typeof item !== "string" || !profile.equipment.includes(item)))) reasons.push("required_equipment_not_confirmed");
    const attendance = resources.attendance?.value;
    if (attendance && !["remote", "local", "travel"].includes(attendance)) reasons.push("attendance_requirement_invalid");
    if (attendance === "travel" || attendance === "local" && profile.mobility === "remote_only") reasons.push("attendance_not_feasible_for_profile");
    if (!planResult && resources.weeklyHours.meaning !== "official_complete_path_weekly_bound") reasons.push("complete_path_workload_bound_required");
    const hours = planResult?.reasons.length === 0 && planResult.peakWeeklyMinutes !== null ? planResult.peakWeeklyMinutes / 60 : resources.weeklyHours?.value;
    if (hours !== null && hours !== undefined && (!Number.isFinite(hours) || hours <= 0 || hours > profile.weeklyHours)) reasons.push("weekly_time_not_feasible_for_profile");
    if ([resources.mentor?.value, resources.laboratory?.value].some(value => value !== null && typeof value !== "boolean")) reasons.push("resource_requirement_invalid");
  }
  return { passed: reasons.length === 0, reasons };
}
