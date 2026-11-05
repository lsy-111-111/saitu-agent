import { z } from "zod";

export const aiConsentDisclosureV1Schema = z
  .object({
    schemaVersion: z.literal("ai-consent-disclosure.v1"),
    version: z.string().min(1).max(80).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
    heading: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(2_000),
    privacyHref: z.literal("/privacy")
  })
  .strict();

export type AiConsentDisclosureV1 = z.infer<typeof aiConsentDisclosureV1Schema>;

export function parseAiConsentDisclosureV1(value: unknown): AiConsentDisclosureV1 | null {
  const parsed = aiConsentDisclosureV1Schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
