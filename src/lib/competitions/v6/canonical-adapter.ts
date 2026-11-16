import { competitionRecommendationProfileV5Schema } from "@/lib/ai/competition-request-schema";
import { COMPETITION_STAGES,type CompetitionRecommendationProfileV5 } from "@/types/competition-recommendation";
import { studentProfileSchema,type StudentProfileV6 } from "./contracts";
import { activeStudentFacts,projectProfileToLegacy } from "./profile";
/** The compatibility view is secondary; callers must pass the intact canonical profile to the engine. */
export function canonicalProfileInput(input:unknown):{profile:StudentProfileV6;legacy:CompetitionRecommendationProfileV5}{
  const profile=studentProfileSchema.parse(input);
  const stage=activeStudentFacts(profile).find(f=>f.field==="stage"&&f.state==="affirmed")?.value;
  if(!COMPETITION_STAGES.includes(stage as typeof COMPETITION_STAGES[number]))throw new Error("canonical_profile_requires_confirmed_supported_stage");
  const base=competitionRecommendationProfileV5Schema.parse({profileVersion:"competition-profile.v5",questionnaireVersion:"competition-questionnaire.v1",stage,majorFields:[],specificSubjects:[],skills:[],interests:[],goals:[],preferredOutputs:[],startingPoint:"idea_only",weeklyCommitment:"under-5",teamStatus:"solo",availableResources:[],participationMode:"flexible",participationTiming:"flexible",taskFormats:[],experienceLevel:"none",evidence:[],confirmedFields:["stage"],confirmedFacts:[]});
  return {profile:structuredClone(profile),legacy:projectProfileToLegacy(profile,base)};
}
