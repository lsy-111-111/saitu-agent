import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  competitionDynamicAnswerSchema,
  competitionDynamicPromptFingerprint,
  competitionDynamicQuestionFamilyV3,
  competitionDynamicQuestionV3Schema,
  MAX_COMPETITION_DYNAMIC_QUESTIONS
} from "@/lib/ai/competition-dynamic-question";
import {
  competitionRecommendationProfileV5Schema
} from "@/lib/ai/competition-request-schema";
import { competitionNormalizedQuestionnaireAnswerSchema } from "@/lib/ai/competition-questionnaire";
import {
  COMPETITION_CATALOG_VERSION,
  getCompetitionCatalog,
  getCompetitionPreferenceQuestionTracks
} from "@/lib/competitions/catalog";
import {
  buildCompetitionQualificationSnapshot,
  COMPETITION_SCORER_VERSION
} from "@/lib/competitions/scoring";
import {
  COMPETITION_QUESTIONNAIRE_FIELD_IDS
} from "@/types/competition-recommendation";
import type {
  CompetitionDynamicExchangeV3,
  CompetitionDynamicQuestionV3,
  CompetitionQualificationSnapshotV1,
  CompetitionRecommendationProfileV5
} from "@/types/competition-recommendation";

export const COMPETITION_CONVERSATION_TOKEN_VERSION = "competition-conversation.v6" as const;
export const LEGACY_COMPETITION_CONVERSATION_TOKEN_VERSION = "competition-conversation.v5" as const;
export const OLDEST_COMPETITION_CONVERSATION_TOKEN_VERSION = "competition-conversation.v4" as const;
export const COMPETITION_QUALIFICATION_SNAPSHOT_SUMMARY_VERSION =
  "competition-qualification-snapshot-summary.v1" as const;
export const COMPETITION_CONVERSATION_TOKEN_TTL_SECONDS = 30 * 60;
export const COMPETITION_CONVERSATION_TOKEN_MAX_LENGTH = 48 * 1024;

const exchangeSchema = z.object({
  question: competitionDynamicQuestionV3Schema,
  answer: competitionDynamicAnswerSchema
}).strict();

const qualificationSnapshotSummarySchema = z.object({
  version: z.literal(COMPETITION_QUALIFICATION_SNAPSHOT_SUMMARY_VERSION),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  entryCount: z.number().int().nonnegative(),
  evaluatedAt: z.number().int().nonnegative()
}).strict();

export type CompetitionQualificationSnapshotSummaryV1 = z.infer<
  typeof qualificationSnapshotSummarySchema
>;

const payloadSchema = z
  .object({
    version: z.literal(COMPETITION_CONVERSATION_TOKEN_VERSION),
    catalogVersion: z.literal(COMPETITION_CATALOG_VERSION),
    scorerVersion: z.literal(COMPETITION_SCORER_VERSION),
    issuedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive(),
    sessionId: z.string().uuid(),
    nonce: z.string().uuid(),
    profile: competitionRecommendationProfileV5Schema,
    rawAnswerContext: z.array(competitionNormalizedQuestionnaireAnswerSchema)
      .min(1)
      .max(COMPETITION_QUESTIONNAIRE_FIELD_IDS.length),
    qualificationSnapshot: qualificationSnapshotSummarySchema,
    transcript: z.array(exchangeSchema).max(MAX_COMPETITION_DYNAMIC_QUESTIONS),
    pendingQuestion: competitionDynamicQuestionV3Schema.nullable(),
    completed: z.boolean()
  })
  .strict()
  .superRefine((payload, context) => {
    if (payload.expiresAt <= payload.issuedAt) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Token expiry is invalid", path: ["expiresAt"] });
    }
    if (payload.qualificationSnapshot.evaluatedAt !== payload.issuedAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Qualification snapshot must use the token issue time",
        path: ["qualificationSnapshot", "evaluatedAt"]
      });
    }
    if (payload.completed === Boolean(payload.pendingQuestion)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Completed tokens cannot contain a pending question",
        path: ["completed"]
      });
    }
    const questions = [
      ...payload.transcript.map(({ question }) => question),
      ...(payload.pendingQuestion ? [payload.pendingQuestion] : [])
    ];
    const questionIds = questions.map(({ questionId }) => questionId);
    if (new Set(questionIds).size !== questionIds.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Question IDs must be unique", path: ["transcript"] });
    }
    const signalKeys = questions.map(({ signalKey }) => signalKey);
    if (new Set(signalKeys).size !== signalKeys.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Signal keys must be unique", path: ["transcript"] });
    }
    const families = questions.map(({ signalKey }) => competitionDynamicQuestionFamilyV3(signalKey));
    if (new Set(families).size !== families.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Question families must be unique", path: ["transcript"] });
    }
    const promptFingerprints = questions.map(({ prompt }) => competitionDynamicPromptFingerprint(prompt));
    if (new Set(promptFingerprints).size !== promptFingerprints.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Question prompt fingerprints must be unique",
        path: ["transcript"]
      });
    }
    if (payload.transcript.length >= MAX_COMPETITION_DYNAMIC_QUESTIONS && payload.pendingQuestion) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Question limit reached", path: ["pendingQuestion"] });
    }
    const optionalQuestions = questions.filter(({ impact }) => impact === "optional");
    if (optionalQuestions.length > 1) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Only one optional question is allowed", path: ["transcript"] });
    }
    if (payload.pendingQuestion?.impact === "optional" && payload.transcript.length !== 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Optional refinement is available only before material follow-ups",
        path: ["pendingQuestion"]
      });
    }
    const optionalTranscriptIndex = payload.transcript.findIndex(({ question }) => question.impact === "optional");
    if (optionalTranscriptIndex >= 0 && optionalTranscriptIndex !== payload.transcript.length - 1) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Optional refinement must end the transcript", path: ["transcript"] });
    }
    if (optionalTranscriptIndex >= 0 && payload.pendingQuestion) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "No question may follow optional refinement", path: ["pendingQuestion"] });
    }
    const rawFieldIds = payload.rawAnswerContext.map(({ fieldId }) => fieldId);
    const expectedRawFieldIds = [...payload.profile.confirmedFields, ...payload.profile.confirmedFacts];
    if (
      new Set(rawFieldIds).size !== rawFieldIds.length ||
      rawFieldIds.length !== expectedRawFieldIds.length ||
      expectedRawFieldIds.some((fieldId) => !rawFieldIds.includes(fieldId))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Profile V5 tokens must preserve every signed fixed-questionnaire field exactly once",
        path: ["rawAnswerContext"]
      });
    }

  });

export type CompetitionConversationTokenV6 = {
  version: typeof COMPETITION_CONVERSATION_TOKEN_VERSION;
  catalogVersion: typeof COMPETITION_CATALOG_VERSION;
  scorerVersion: typeof COMPETITION_SCORER_VERSION;
  issuedAt: number;
  expiresAt: number;
  sessionId: string;
  nonce: string;
  profile: CompetitionRecommendationProfileV5;
  rawAnswerContext: z.infer<typeof competitionNormalizedQuestionnaireAnswerSchema>[];
  qualificationSnapshot: CompetitionQualificationSnapshotSummaryV1;
  transcript: CompetitionDynamicExchangeV3[];
  pendingQuestion: CompetitionDynamicQuestionV3 | null;
  completed: boolean;
};

/** @deprecated Use CompetitionConversationTokenV6. */
export type CompetitionConversationTokenV5 = CompetitionConversationTokenV6;
/** @deprecated Use CompetitionConversationTokenV6. */
export type CompetitionConversationTokenV4 = CompetitionConversationTokenV6;
/** @deprecated Use CompetitionConversationTokenV6. */
export type CompetitionConversationTokenV3 = CompetitionConversationTokenV6;
/** @deprecated Use CompetitionConversationTokenV6. */
export type CompetitionConversationTokenV1 = CompetitionConversationTokenV6;

export type CompetitionConversationTokenFailureReason =
  | "missing_secret"
  | "invalid_token"
  | "expired_token"
  | "policy_changed";

function signingSecret() {
  const configured = process.env.AI_CONVERSATION_SIGNING_SECRET?.trim();
  if (configured && configured.length >= 32) return configured;
  if (process.env.NODE_ENV !== "production") {
    return "development-only-competition-token-secret-do-not-deploy";
  }
  return null;
}

function encode(value: string | Uint8Array) {
  return Buffer.from(value).toString("base64url");
}

function signature(encodedPayload: string, secret: string) {
  return createHmac("sha256", secret).update(encodedPayload).digest();
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function summarizeCompetitionQualificationSnapshot(
  snapshot: CompetitionQualificationSnapshotV1,
  evaluatedAt: number
): CompetitionQualificationSnapshotSummaryV1 {
  return {
    version: COMPETITION_QUALIFICATION_SNAPSHOT_SUMMARY_VERSION,
    digest: createHash("sha256").update(canonicalJson(snapshot)).digest("hex"),
    entryCount: snapshot.entries.length,
    evaluatedAt
  };
}

export function buildSignedCompetitionQualificationSnapshot(
  profile: CompetitionRecommendationProfileV5,
  evaluatedAt: number
) {
  const snapshot = buildCompetitionQualificationSnapshot(
    profile,
    getCompetitionCatalog(),
    new Date(evaluatedAt * 1000)
  );
  return {
    snapshot,
    summary: summarizeCompetitionQualificationSnapshot(snapshot, evaluatedAt)
  };
}

export function competitionQualificationSnapshotMatches(
  summary: CompetitionQualificationSnapshotSummaryV1,
  snapshot: CompetitionQualificationSnapshotV1
) {
  const recomputed = summarizeCompetitionQualificationSnapshot(snapshot, summary.evaluatedAt);
  return recomputed.digest === summary.digest && recomputed.entryCount === summary.entryCount;
}

/**
 * Defense in depth for track preference tokens. Even a correctly signed V6
 * token is rejected if an internal bug ever placed an unknown or hard-
 * ineligible track in its options or selected answer.
 */
export function competitionPreferenceQuestionsMatchQualificationSnapshot(
  snapshot: CompetitionQualificationSnapshotV1,
  transcript: readonly CompetitionDynamicExchangeV3[],
  pendingQuestion: CompetitionDynamicQuestionV3 | null
) {
  const questions = [
    ...transcript.map(({ question, answer }) => ({ question, selectedValues: answer.selectedValues })),
    ...(pendingQuestion ? [{ question: pendingQuestion, selectedValues: [] as string[] }] : [])
  ];
  for (const { question, selectedValues } of questions) {
    if (!question.signalKey.startsWith("track:")) continue;
    const competitionId = question.signalKey.slice("track:".length);
    const entry = snapshot.entries.find((item) => item.competitionId === competitionId);
    if (!entry) return false;
    const competition = getCompetitionCatalog().find(({ id }) => id === competitionId);
    if (!competition) return false;
    const preferenceTrackIds = new Set(
      getCompetitionPreferenceQuestionTracks(competition).map(({ id }) => id)
    );
    const allowedTracks = new Set(
      entry.tracks
        .filter(({ status, trackId }) =>
          status !== "ineligible" && preferenceTrackIds.has(trackId)
        )
        .map(({ trackId }) => trackId)
    );
    if (allowedTracks.size === 0) return false;
    if (question.options.some(({ value }) => !allowedTracks.has(value))) return false;
    if (selectedValues.some((value) => !allowedTracks.has(value))) return false;
  }
  return true;
}

export function createCompetitionConversationToken(
  input: {
    profile: CompetitionRecommendationProfileV5;
    rawAnswerContext: readonly z.infer<typeof competitionNormalizedQuestionnaireAnswerSchema>[];
    qualificationSnapshot?: CompetitionQualificationSnapshotSummaryV1;
    sessionId?: string;
    transcript: readonly CompetitionDynamicExchangeV3[];
    pendingQuestion: CompetitionDynamicQuestionV3 | null;
    completed: boolean;
  },
  now = new Date()
): string {
  const secret = signingSecret();
  if (!secret) throw new Error("AI_CONVERSATION_SIGNING_SECRET is required in production");
  const issuedAt = Math.floor(now.getTime() / 1000);
  const qualificationSnapshot = input.qualificationSnapshot ??
    buildSignedCompetitionQualificationSnapshot(input.profile, issuedAt).summary;
  const payload: CompetitionConversationTokenV6 = {
    version: COMPETITION_CONVERSATION_TOKEN_VERSION,
    catalogVersion: COMPETITION_CATALOG_VERSION,
    scorerVersion: COMPETITION_SCORER_VERSION,
    issuedAt,
    expiresAt: issuedAt + COMPETITION_CONVERSATION_TOKEN_TTL_SECONDS,
    sessionId: input.sessionId ?? randomUUID(),
    nonce: randomUUID(),
    profile: input.profile,
    rawAnswerContext: [...input.rawAnswerContext],
    qualificationSnapshot,
    transcript: [...input.transcript],
    pendingQuestion: input.pendingQuestion,
    completed: input.completed
  };
  const validated = payloadSchema.parse(payload);
  const encodedPayload = encode(JSON.stringify(validated));
  const token = `${encodedPayload}.${encode(signature(encodedPayload, secret))}`;
  if (token.length > COMPETITION_CONVERSATION_TOKEN_MAX_LENGTH) {
    throw new Error("Competition conversation token is too large");
  }
  return token;
}

export function verifyCompetitionConversationToken(
  token: string,
  now = new Date()
):
  | { ok: true; payload: CompetitionConversationTokenV6 }
  | { ok: false; reason: CompetitionConversationTokenFailureReason } {
  const secret = signingSecret();
  if (!secret) return { ok: false, reason: "missing_secret" };
  if (token.length > COMPETITION_CONVERSATION_TOKEN_MAX_LENGTH) return { ok: false, reason: "invalid_token" };
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: "invalid_token" };
  try {
    const payloadBytes = Buffer.from(parts[0], "base64url");
    const suppliedSignature = Buffer.from(parts[1], "base64url");
    if (encode(payloadBytes) !== parts[0] || encode(suppliedSignature) !== parts[1]) {
      return { ok: false, reason: "invalid_token" };
    }
    const expectedSignature = signature(parts[0], secret);
    if (
      suppliedSignature.length !== expectedSignature.length ||
      !timingSafeEqual(suppliedSignature, expectedSignature)
    ) {
      return { ok: false, reason: "invalid_token" };
    }
    const decoded = JSON.parse(payloadBytes.toString("utf8")) as unknown;
    if (
      decoded &&
      typeof decoded === "object" &&
      (
        (decoded as { version?: unknown }).version === LEGACY_COMPETITION_CONVERSATION_TOKEN_VERSION ||
        (decoded as { version?: unknown }).version === OLDEST_COMPETITION_CONVERSATION_TOKEN_VERSION
      )
    ) {
      return { ok: false, reason: "policy_changed" };
    }
    const parsed = payloadSchema.safeParse(decoded);
    if (!parsed.success) return { ok: false, reason: "invalid_token" };
    if (parsed.data.expiresAt <= Math.floor(now.getTime() / 1000)) {
      return { ok: false, reason: "expired_token" };
    }
    return { ok: true, payload: parsed.data };
  } catch {
    return { ok: false, reason: "invalid_token" };
  }
}
