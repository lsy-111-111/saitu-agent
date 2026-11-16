import { z } from "zod";
import { decisionEffortPolicySchema } from "../../ai/effort-contract";
import { comparisonSchema, decisionClaimSchema, decisionRecommendationSchema, decisionReportSchema, studentProfileSchema } from "../v6/contracts";

export const RECOMMENDATION_RESPONSE_VERSION = "competition-recommendation.v7" as const;
export const LEGACY_RECOMMENDATION_POLICY_VERSION = "saitu.policy.2026-11-09.v7" as const;
export const RECOMMENDATION_POLICY_VERSION = "saitu.policy.2026-11-09.v7.top5" as const;
export const RECOMMENDATION_IMPLEMENTATION_VERSION = "saitu.async.2026-11-09.v7.3.top5" as const;
export const RECOMMENDATION_MAX_ITEMS = 5;
// Performance targets and execution cutoffs are deliberately separate.
export const RECOMMENDATION_LIST_DEADLINE_MS = 40_000;
export const RECOMMENDATION_RANK_HARD_TIMEOUT_MS = 60_000;
export const RECOMMENDATION_DETAIL_TARGET_MS = 120_000;
export const RECOMMENDATION_DETAIL_DEADLINE_MS = 150_000;

export const recommendationExecutionPolicySchema = z.object({
  policyVersion: z.enum([LEGACY_RECOMMENDATION_POLICY_VERSION, RECOMMENDATION_POLICY_VERSION]),
  maxItems: z.number().int().min(1).max(10),
  listTargetMs: z.number().int().positive(), rankHardTimeoutMs: z.number().int().positive(),
  detailTargetMs: z.number().int().positive(), detailHardTimeoutMs: z.number().int().positive(),
}).strict().superRefine((value, context) => {
  if(value.listTargetMs>value.rankHardTimeoutMs||value.detailTargetMs>value.detailHardTimeoutMs||value.rankHardTimeoutMs>value.detailHardTimeoutMs)context.addIssue({code:"custom",message:"Invalid target and cutoff ordering"});
  if(value.policyVersion===RECOMMENDATION_POLICY_VERSION&&(value.maxItems!==RECOMMENDATION_MAX_ITEMS||value.listTargetMs!==RECOMMENDATION_LIST_DEADLINE_MS||value.rankHardTimeoutMs!==RECOMMENDATION_RANK_HARD_TIMEOUT_MS||value.detailTargetMs!==RECOMMENDATION_DETAIL_TARGET_MS||value.detailHardTimeoutMs!==RECOMMENDATION_DETAIL_DEADLINE_MS))context.addIssue({code:"custom",message:"Top5 execution policy differs from its versioned contract"});
});
export type RecommendationExecutionPolicyV7 = z.infer<typeof recommendationExecutionPolicySchema>;
/** Persist this snapshot when enqueuing; readers never apply new globals to old runs. */
export const RECOMMENDATION_EXECUTION_POLICY: Readonly<RecommendationExecutionPolicyV7> = Object.freeze({
  policyVersion: RECOMMENDATION_POLICY_VERSION, maxItems: RECOMMENDATION_MAX_ITEMS,
  listTargetMs: RECOMMENDATION_LIST_DEADLINE_MS, rankHardTimeoutMs: RECOMMENDATION_RANK_HARD_TIMEOUT_MS,
  detailTargetMs: RECOMMENDATION_DETAIL_TARGET_MS, detailHardTimeoutMs: RECOMMENDATION_DETAIL_DEADLINE_MS,
});
export const recommendationRunStatusSchema = z.enum(["queued", "ranking", "list_ready", "explaining", "partial_ready", "ready", "failed", "superseded", "expired"]);
export type RecommendationRunStatusV7 = z.infer<typeof recommendationRunStatusSchema>;
export const recommendationListItemSchema = z.object({
  rank: z.number().int().min(1).max(10), itemId: z.string().min(1).max(180), seriesId: z.string().min(1).max(180),
  name: z.string().min(1).max(1600), trackLabel: z.string().max(1600), edition: z.string().max(1600),
  officialUrl: z.string().url().refine(value => /^https?:\/\//.test(value)).nullable(),
  detailStatus: z.enum(["pending", "checking", "ready", "failed"]),
  detail: decisionRecommendationSchema.optional(),
}).strict().superRefine((value, context) => {
  if ((value.detailStatus === "ready") !== Boolean(value.detail)) context.addIssue({code: "custom", message: "Ready detail must have a validated payload"});
  if (value.detail && (value.detail.itemId !== value.itemId || value.detail.seriesId !== value.seriesId || value.detail.rank !== value.rank)) context.addIssue({code: "custom", message: "Detail identity differs from list"});
});
export type RecommendationListItemV7 = z.infer<typeof recommendationListItemSchema>;
export const recommendationRunSchema = z.object({
  responseVersion: z.literal(RECOMMENDATION_RESPONSE_VERSION), runId: z.string().uuid(), decisionToken: z.string().min(32).max(4096),
  profileId: z.string().min(1).max(180), profileRevision: z.string().min(1).max(180), catalogVersion: z.string().min(1).max(180),
  profile:studentProfileSchema,
  policyVersion: z.enum([LEGACY_RECOMMENDATION_POLICY_VERSION, RECOMMENDATION_POLICY_VERSION]), status: recommendationRunStatusSchema,
  implementationVersion: z.string().min(1).max(180).optional(), executionPolicy: recommendationExecutionPolicySchema.optional(),
  executionMode:z.enum(["finite","user-unbounded"]).optional(),
  executionLimits:z.object({modelConcurrencyLimit:z.null(),totalCallLimit:z.null(),totalCostLimitMicros:z.null()}).strict().optional(),
  resultVersion: z.number().int().nonnegative(), submittedAt: z.string().datetime(), expiresAt:z.string().datetime(),
  listTargetAt: z.string().datetime().optional(), rankDeadlineAt: z.string().datetime().optional(),
  detailTargetAt: z.string().datetime().optional(), detailDeadlineAt: z.string().datetime().optional(),
  effortPolicy: decisionEffortPolicySchema.optional(), effortPolicySha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  listReadyAt: z.string().datetime().nullable(), detailsReadyAt: z.string().datetime().nullable(),
  pollAfterMs: z.number().int().min(500).max(5000), items: z.array(recommendationListItemSchema).max(10),
  shortfallReason: z.string().max(1600).nullable(), report: decisionReportSchema.optional(), error: z.string().max(180).optional(),
}).strict().superRefine((value, context) => {
  if(value.profile.profileId!==value.profileId||value.profile.revision!==value.profileRevision)context.addIssue({code:"custom",message:"Profile identity differs from run"});
  if (new Set(value.items.map(item => item.seriesId)).size !== value.items.length) context.addIssue({code:"custom",message:"Duplicate competition series"});
  if (value.items.some((item,index) => item.rank !== index+1)) context.addIssue({code:"custom",message:"Non-contiguous ranks"});
  if (value.policyVersion === RECOMMENDATION_POLICY_VERSION && (value.items.length > RECOMMENDATION_MAX_ITEMS || (value.report?.recommendations.length ?? 0) > RECOMMENDATION_MAX_ITEMS)) context.addIssue({code:"custom",message:"Top5 policy permits at most five recommendations"});
  if (value.executionPolicy && value.executionPolicy.policyVersion !== value.policyVersion) context.addIssue({code:"custom",message:"Execution policy differs from run"});
  if((value.executionMode==="user-unbounded")!==Boolean(value.executionLimits))context.addIssue({code:"custom",message:"Execution mode differs from explicit limits"});
});
export type RecommendationRunV7 = z.infer<typeof recommendationRunSchema>;
export const recommendationChatReplySchema = z.object({
  responseVersion: z.literal("competition-decision-chat.v7"), requestId: z.string(),
  message: z.string().min(1).max(1600), profileRevision: z.string(), decisionToken: z.string(),
  run: recommendationRunSchema.optional(), claims: z.array(decisionClaimSchema).max(8).default([]),
  comparison: comparisonSchema.optional(),
}).strict();
export type RecommendationChatReplyV7 = z.infer<typeof recommendationChatReplySchema>;
export const isRecommendationRunTerminal = (status: RecommendationRunStatusV7) => ["ready", "failed", "superseded", "expired"].includes(status);
