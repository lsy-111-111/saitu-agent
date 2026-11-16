import { z } from "zod";

export const profileMutationSchema = z.object({
  operation: z.enum(["set", "retract"]),
  field: z.string().min(1).max(160),
  state:z.enum(["affirmed","negated","unknown","conditional"]).optional(),
  value: z.union([z.string().max(1600), z.number().finite(), z.boolean()]).optional(),
  targetFactIds: z.array(z.string().max(180)).max(30),
  quote: z.string().min(1).max(1600),
}).strict();
export type ProfileMutation = z.infer<typeof profileMutationSchema>;
