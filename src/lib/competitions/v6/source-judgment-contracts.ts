import { z } from "zod";
const evidenceSchema=z.object({sourceId:z.string().max(180),quote:z.string().min(1).max(2400),url:z.string().url().regex(/^https:\/\//),scope:z.string().max(1600)}).strict();
export const sourceJudgmentSchema=z.object({id:z.string().max(180),status:z.enum(["supported","contradicted","unknown"]),reason:z.string().max(1600),citations:z.array(z.string().max(180)).max(8),evidence:z.array(evidenceSchema).max(8)}).strict();
export type SourceJudgment=z.infer<typeof sourceJudgmentSchema>;
export const conditionJudgmentSchema=z.object({decision:z.enum(["satisfied","violated","unknown"]),scope:z.string().max(1600),targetKind:z.enum(["student_eligibility","submission_constraint","participation_constraint"]),reason:z.string().max(2000),citations:z.array(z.string().max(180)).max(8),evidence:z.array(evidenceSchema).max(8)}).strict();
