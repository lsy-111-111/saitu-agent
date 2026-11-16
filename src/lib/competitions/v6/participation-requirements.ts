import {z} from "zod";
import type {ParticipationRequirements} from "./catalog-types";

const facts=z.array(z.string().min(1)).refine(ids=>new Set(ids).size===ids.length);
const entry=<T extends z.ZodTypeAny>(value:T)=>z.object({value:value.nullable(),factIds:facts}).strict();
/** JSON is untrusted even when the TypeScript record has a declared interface. */
export const participationRequirementsSchema: z.ZodType<ParticipationRequirements> = z.object({
  teamSize:entry(z.object({minimum:z.number().int().positive(),maximum:z.number().int().positive()}).strict().refine(value=>value.maximum>=value.minimum)),
  mentor:entry(z.boolean()),laboratory:entry(z.boolean()),
  equipment:entry(z.array(z.string().trim().min(1)).refine(items=>new Set(items).size===items.length)),
  attendance:entry(z.enum(["remote","local","travel"])),
  weeklyHours:entry(z.number().finite().positive().max(168)).extend({meaning:z.enum(["official_complete_path_weekly_bound","official_event_duration"]).optional()}).strict(),
}).strict();
