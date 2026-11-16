import { z } from "zod";
import { decisionEffortPolicySchema } from "../../ai/effort-contract.mjs";

export const DECISION_RESPONSE_VERSION =
  "competition-recommendation.v6" as const;
export const DECISION_ENGINE_VERSION = "saitu-decision.2026-11.v2" as const;
const text = z.string().trim().min(1).max(1600);
const id = z.string().min(1).max(180);
const ids = z
  .array(id)
  .max(80)
  .refine((v) => new Set(v).size === v.length);
export const decisionClaimSchema = z
  .object({
    text,
    basis: z.enum([
      "student",
      "official",
      "inference",
      "suggestion",
      "unknown",
    ]),
    studentFactIds: ids,
    competitionFactIds: ids,
    conditions: z.array(text).max(12),
  })
  .strict();
export type DecisionClaimV6 = z.infer<typeof decisionClaimSchema>;
export const studentFactSchema = z
  .object({
    id,
    field: id,
    value: z.union([z.string(), z.number(), z.boolean()]),
    label: text,
    state: z.enum(["affirmed", "negated", "unknown", "conditional", "retracted"]),
    confirmed: z.boolean(),
    evidenceLevel: z.enum(["self_report", "concrete_experience", "unknown"]),
    answerId: id.optional(),
    originalText: z.string().max(1600).optional(),
    sourceSpan: z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() }).strict().optional(),
    updatedAt: z.string().datetime().nullable().optional(),
    supersedesFactIds: ids.optional(),
  })
  .strict();
export const studentProfileSchema = z
  .object({
    schemaVersion: z.literal("saitu.profile.v6"),
    profileId: id,
    revision: id,
    facts: z.array(studentFactSchema).max(160),
    unknownFields: ids,
    retractedFactIds: ids,
    goals: z.array(text).max(5),
    primaryGoal: text.nullable(),
    tradeoffStatus: z.enum(["confirmed", "undecided", "not_needed"]),
    mode: z.enum(["quick", "deep"]),
    updates: z.array(z.object({
      id, answerId: id, originalText: text, updatedAt: z.string().datetime(),
      previousRevision: id, removedFactIds: ids, addedFactIds: ids,
    }).strict()).max(80).optional(),
  })
  .strict();
export type StudentProfileV6 = z.infer<typeof studentProfileSchema>;
export type StudentFactV6 = z.infer<typeof studentFactSchema>;

const sourceSchema = z
  .object({
    id,
    title: text,
    url: z
      .string()
      .url()
      .refine((v) => /^https?:\/\//.test(v)),
    scope: text,
    checkedAt: z.string().nullable(),
  })
  .strict();
const evidenceFactSchema = z
  .object({
    id,
    text,
    sourceIds: ids,
    scope: text,
    status: z.string(),
    kind: z.string(),
  })
  .strict();
export const decisionRecommendationSchema = z
  .object({
    rank: z.number().int().min(1).max(10),
    itemId: id,
    seriesId: id,
    name: text,
    trackLabel: text,
    edition: text,
    contentTier: z.enum(["L0", "L1", "L2", "L3"]),
    eligibilityStatus: z.enum(["eligible", "unknown"]),
    eligibilityNotes: z.array(text).max(20),
    registration: z
      .object({
        status: z.enum(["open", "closed", "upcoming", "unknown", "historical"]),
        note: text,
      })
      .strict(),
    preparation: z.enum(["ready", "conditional", "explore", "future"]),
    coreTask: decisionClaimSchema,
    reasons: z.array(decisionClaimSchema).min(1).max(8),
    currentRole: decisionClaimSchema,
    gaps: z.array(decisionClaimSchema).min(1).max(12),
    values: z
      .array(z.object({ dimension: id, claim: decisionClaimSchema }).strict())
      .min(1)
      .max(6),
    difficulty: z
      .array(
        z
          .object({
            stage: z.enum(["entry", "completion", "award"]),
            claim: decisionClaimSchema,
          })
          .strict(),
      )
      .length(3),
    opportunityCost: decisionClaimSchema,
    nextStep: decisionClaimSchema,
    checkpoint: text,
    sources: z.array(sourceSchema).max(80),
    evidenceFacts: z.array(evidenceFactSchema).max(160),
  })
  .strict();
export type DecisionRecommendationV6 = z.infer<
  typeof decisionRecommendationSchema
>;
export const comparisonSchema = z
  .object({
    itemIds: ids.refine((v) => v.length >= 2 && v.length <= 3),
    dimensions: z
      .array(
        z
          .object({
            label: text,
            values: z
              .array(
                z.object({ itemId: id, claim: decisionClaimSchema }).strict(),
              )
              .min(2)
              .max(3),
          })
          .strict(),
      )
      .min(1)
      .max(8),
    tradeoff: decisionClaimSchema,
  })
  .strict();
export type DecisionComparisonV6 = z.infer<typeof comparisonSchema>;
export const decisionReportSchema = z
  .object({
    schemaVersion: z.literal("saitu.report.v6"),
    reportId: id,
    generatedAt: z.string(),
    catalogVersion: id,
    profile: studentProfileSchema,
    summary: z
      .object({
        direction: decisionClaimSchema,
        personalEvidence: z.array(decisionClaimSchema).max(3),
        mainGap: decisionClaimSchema,
        nextStep: decisionClaimSchema,
        focusItemIds: ids.refine((v) => v.length <= 3),
      })
      .strict(),
    recommendations: z.array(decisionRecommendationSchema).max(10),
    shortlistShortfallReason: z.string().max(1600).nullable(),
    comparisons: z.array(comparisonSchema).max(10),
    goalPaths: z
      .array(
        z
          .object({
            goal: text,
            condition: text,
            itemIds: ids.refine((v) => v.length <= 2),
            itemNames: z.array(text).max(2).optional(),
            nextStep: decisionClaimSchema,
          })
          .strict(),
      )
      .max(2)
      .default([]),
    candidateAudit: z
      .array(
        z
          .object({
            recordId: id.optional(),
            seriesId: id,
            name: text,
            status: z.enum([
              "selected",
              "not_selected",
              "excluded",
              "content_pending",
            ]),
            reason: decisionClaimSchema,
          })
          .strict(),
      )
      .max(1000),
    pendingQuestions: z.array(text).max(6),
    usefulQuestions: z.array(z.object({
      id, prompt: text, field: id,
      options: z.array(z.object({value: text, label: text}).strict()).min(2).max(5),
      candidateIds: ids, expectedChange: text,
    }).strict()).max(3).optional(),
    schoolPolicyReminder: text,
    fallback: z
      .object({ used: z.boolean(), reason: z.string().max(300).nullable() })
      .strict(),
    trace: z
      .object({
        engineVersion: id,
        method: z.enum(["rules", "llm", "semantic", "hybrid"]),
        reasoningEffort: z.enum(["max", "high", "low", "mixed"]).optional(),
        effortPolicy: decisionEffortPolicySchema.optional(),
        effortPolicySha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
        explanationSource: z.enum(["model_text", "server_evidence_anchors"]).optional(),
        invocationId: id.optional(),
        candidateOrderSha256: id.optional(),
        roleSource: z.literal("reviewed_catalog_suggestion").optional(),
        supportChecks: z.number().int().min(0).max(64).optional(),
        unsupportedChecks: z.number().int().min(0).max(64).optional(),
        lastValidModelItemIds: z.array(id).max(10).optional(),
        cachedInputTokens: z.number().nonnegative().nullable().optional(),
        priceVersion: z.string().optional(),
        costStatus: z.enum(["usage_upper_bound", "unknown"]).optional(),
        model: id,
        promptVersion: id,
        candidateCount: z.number().int().nonnegative(),
        callCount: z.number().int().nonnegative(),
        elapsedMs: z.number().nonnegative(),
        verification: z.enum(["deterministic", "model_reviewed"]),
        inputTokens: z.number().nonnegative().nullable(),
        outputTokens: z.number().nonnegative().nullable(),
        costCny: z.number().nonnegative().nullable(),
      })
      .strict().superRefine((trace, context) => {
        if (trace.reasoningEffort === "mixed" && !trace.effortPolicy) context.addIssue({code:"custom",message:"Mixed effort requires its stage policy"});
        if (trace.effortPolicy) {
          const {rank, explain, review} = trace.effortPolicy;
          const summary = trace.effortPolicy.version === "saitu.effort-policy.v2" ? "mixed" : new Set([rank, explain, review]).size === 1 ? rank : "mixed";
          if (trace.reasoningEffort !== summary) context.addIssue({code:"custom",message:"Effort summary differs from stage policy"});
        }
      }),
  })
  .strict();
export type DecisionReportV6 = z.infer<typeof decisionReportSchema>;
export const decisionResponseSchema = z
  .object({
    responseVersion: z.literal(DECISION_RESPONSE_VERSION),
    report: decisionReportSchema,
    decisionToken: z.string().max(4096).optional(),
  })
  .strict();
export type DecisionResponseV6 = z.infer<typeof decisionResponseSchema>;

export const matchPlanSchema = z
  .object({
    profileRevision: id,
    catalogVersion: id,
    recommendations: z
      .array(
        z
          .object({
            itemId: id,
            reasons: z.array(decisionClaimSchema).min(1).max(3),
            // Internal, optional identity of the role chosen by the rank stage.
            // No default: historic plans retain their original canonical body.
            rankRoleIndex: z.number().int().min(0).max(30).optional(),
            rankGoalIndex: z.number().int().nonnegative().optional(),
            rankTaskStepIndex: z.number().int().nonnegative().optional(),
            roleIndex: z.number().int().min(0).max(30).optional(),
            roleReason: decisionClaimSchema.optional(),
          })
          .strict(),
      )
      .max(10),
    shortfallReason: z.string().max(1600).nullable(),
    comparison: decisionClaimSchema.optional(),
  })
  .strict();
export type MatchPlanV6 = z.infer<typeof matchPlanSchema>;

export function compareDecisionItems(
  items: readonly DecisionRecommendationV6[],
): DecisionComparisonV6 {
  if (items.length < 2 || items.length > 3)
    throw new Error("Compare two or three decisions");
  return {
    itemIds: items.map((i) => i.itemId),
    dimensions: [
      {
        label: "主要任务",
        values: items.map((i) => ({ itemId: i.itemId, claim: i.coreTask })),
      },
      {
        label: "现在的切入点",
        values: items.map((i) => ({ itemId: i.itemId, claim: i.currentRole })),
      },
      {
        label: "主要代价",
        values: items.map((i) => ({
          itemId: i.itemId,
          claim: i.opportunityCost,
        })),
      },
      {
        label: "先验证什么",
        values: items.map((i) => ({ itemId: i.itemId, claim: i.nextStep })),
      },
    ],
    tradeoff: {
      text: `${items[0].name}目前列在前面，可先用“${items[0].checkpoint}”检查起点；如果你更愿意做${items[1].trackLabel}的任务，则用“${items[1].checkpoint}”检验第二条路径。先做一个体验产出，若兴趣、时间或资源改变，再重新比较；目前顺序不表示获奖机会更高。`,
      basis: "suggestion",
      studentFactIds: [
        ...new Set(
          items
            .slice(0, 2)
            .flatMap((i) => i.reasons.flatMap((r) => r.studentFactIds)),
        ),
      ],
      competitionFactIds: [
        ...new Set(
          items.slice(0, 2).flatMap((i) => i.coreTask.competitionFactIds),
        ),
      ],
      conditions: ["这是选择建议，不是获奖或就业承诺。"],
    },
  };
}

export function describeDecisionChanges(
  previous: DecisionReportV6,
  current: DecisionReportV6,
): string[] {
  const oldFacts = new Map(
    previous.profile.facts.filter(f => f.state !== "retracted").map((f) => [f.field + ":" + f.id, f]),
  );
  const facts = new Map(
    current.profile.facts.filter(f => f.state !== "retracted").map((f) => [f.field + ":" + f.id, f]),
  );
  const changes: string[] = [];
  for (const [key, fact] of oldFacts)
    if (!facts.has(key) || facts.get(key)?.value !== fact.value)
      changes.push(`已替换或撤销：${fact.label}`);
  for (const [key, fact] of facts)
    if (!oldFacts.has(key) || oldFacts.get(key)?.value !== fact.value)
      changes.push(`本次采用：${fact.label}`);
  const before = previous.recommendations.map((i) => i.itemId).join("|");
  const after = current.recommendations.map((i) => i.itemId).join("|");
  changes.push(
    before === after
      ? "候选顺序未变；已按新回答重新计算依据、条件与行动建议。"
      : "候选或顺序已重新计算；请查看新的依据、条件与行动建议。",
  );
  return changes;
}
