import { z } from "zod";

/** Browser-safe shape shared with native Node readers. No server policy IO. */
const v1 = z.object({
  version: z.literal("saitu.effort-policy.v1"),
  rank: z.enum(["high", "low"]), explain: z.enum(["high", "low"]), review: z.enum(["high", "low"]),
}).strict();
const v2 = z.object({
  version: z.literal("saitu.effort-policy.v2"),
  rank: z.literal("low"), explain: z.literal("low"), review: z.literal("low"),
  rankThinking: z.literal("disabled"), rankTemperature: z.literal(0),
}).strict();
export const decisionEffortPolicySchema = z.discriminatedUnion("version", [v1, v2]);
