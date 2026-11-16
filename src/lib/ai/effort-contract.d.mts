import { z } from "zod";

export const decisionEffortPolicySchema: z.ZodDiscriminatedUnion<"version", [z.ZodObject<{
  version: z.ZodLiteral<"saitu.effort-policy.v1">;
  rank: z.ZodEnum<["high", "low"]>;
  explain: z.ZodEnum<["high", "low"]>;
  review: z.ZodEnum<["high", "low"]>;
}, "strict">, z.ZodObject<{
  version: z.ZodLiteral<"saitu.effort-policy.v2">;
  rank: z.ZodLiteral<"low">;
  explain: z.ZodLiteral<"low">;
  review: z.ZodLiteral<"low">;
  rankThinking: z.ZodLiteral<"disabled">;
  rankTemperature: z.ZodLiteral<0>;
}, "strict">]>;
