import type { CompetitionRecommendationProfileV5 } from "@/types/competition-recommendation";
import type { PublicSeed } from "../../../scripts/competitions/v6/evaluate-seeds";

/** Explicit confirmed-choice fixtures, NOT an implementation of free-text extraction. */
export function seedBaseProfile(): CompetitionRecommendationProfileV5 {
  return {
    profileVersion: "competition-profile.v5", questionnaireVersion: "competition-questionnaire.v1",
    stage: "undergraduate-2", confirmedFields: ["stage"], confirmedFacts: [],
    majorFields: [], specificSubjects: [], skills: [], interests: [], goals: [], preferredOutputs: [],
    startingPoint: "idea_only", weeklyCommitment: "under-5", teamStatus: "solo", availableResources: [],
    participationMode: "flexible", participationTiming: "flexible", taskFormats: [], experienceLevel: "none", evidence: [],
    decisionContext: { mode: "quick", experienceStatus: "unknown" }
  };
}

export function confirmedProfileFixture(seed: PublicSeed): CompetitionRecommendationProfileV5 {
  const p = seedBaseProfile();
  const context = p.decisionContext!;
  const experience = (task: string, contribution: "observed" | "assisted" | "independent") => {
    context.experienceStatus = "provided";
    context.experiences = [{ id: "experience-1", task, contribution, completion: "unknown", challenge: "", confirmed: true }];
  };
  switch (seed.familyId) {
    case "P-interest": p.interests = ["ai"]; p.confirmedFields.push("interests"); context.experienceStatus = "none"; break;
    case "P-contribution": experience("项目中只协助制作了PPT，其他工作由队友完成", "assisted"); break;
    case "P-unknown": context.budget = { range: "unknown", scope: "unknown" }; break;
    case "P-negation": context.excludedTaskFormats = ["software"]; break;
    case "P-correction": p.stage = "undergraduate-2"; break;
    case "P-observed": experience("看学长完成实验，自己没有实际操作", "observed"); break;
    case "P-resource": context.obtainableResources = ["lab"]; p.confirmedFields.push("availableResources"); break;
    case "P-no-skill": experience("独立写过一个能够使用的小程序", "independent"); p.experienceLevel = "none"; p.confirmedFields.push("experienceLevel"); break;
    default: throw new Error(`No confirmed-profile fixture for ${seed.familyId}`);
  }
  return p;
}
