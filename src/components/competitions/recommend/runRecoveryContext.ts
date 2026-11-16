import { z } from "zod";
import { businessActivityValues } from "@/lib/competitions/business-activities";
import { COMPETITION_GOALS, COMPETITION_RESOURCES, COMPETITION_TASK_FORMATS } from "@/types/competition-recommendation";
import { isCompetitionAnswerTextValid } from "./answerText";

// Only validates this tab's cached form values. Server request schemas remain
// the authority when a recovered draft is submitted again.
const answer = z.string().max(120).refine(value => !value || isCompetitionAnswerTextValid(value));
export const runRecoveryContextSchema = z.object({
  mode: z.enum(["quick", "deep"]).optional(),
  goalIntent: z.enum([...COMPETITION_GOALS, "explore", "skill"]).optional(),
  goalResolution: z.enum(["confirmed", "undecided"]).optional(),
  primaryGoal: z.enum(COMPETITION_GOALS).optional(),
  experienceStatus: z.enum(["provided", "none", "unknown"]).optional(),
  experienceRole: z.enum(["observed", "assisted", "independent", "led", "unknown"]).optional(),
  experiences: z.array(z.object({ id: z.string().min(1).max(64), task: answer, challenge: answer,
    contribution: z.enum(["observed", "assisted", "independent", "led", "unknown"]),
    completion: z.enum(["learning", "draft", "delivered", "feedback", "unknown"]), confirmed: z.boolean(),
  }).strict()).max(2).optional(),
  noviceTaskPreferences: z.array(z.object({ task: z.enum(["organize-information", "explain-ideas", "observe-record", "make-content", "build-tool"]), preference: z.enum(["try", "avoid", "unknown"]) }).strict()).max(5).optional(),
  budget: z.object({ range: z.enum(["zero", "under100", "100-500", "over500", "unknown"]), maximumYuan: z.number().int().min(0).max(1_000_000).optional(), scope: z.enum(["personal", "team", "unknown"]) }).strict().optional(),
  preparationHorizon: z.enum(["1-2-weeks", "one-month", "2-3-months", "long-term", "unknown"]).optional(),
  businessActivity: z.enum(businessActivityValues).optional(), fixedTeam: z.boolean().optional(),
  excludedTaskFormats: z.array(z.enum([...COMPETITION_TASK_FORMATS, "laboratory"])).max(11).optional(),
  obtainableResources: z.array(z.enum(COMPETITION_RESOURCES)).max(7).optional(),
  unavailableResources: z.array(z.enum(COMPETITION_RESOURCES)).max(7).optional(),
}).strict();
