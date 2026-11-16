import { z } from "zod";
import { matchPlanSchema, type MatchPlanV6 } from "./contracts";
import type { DecisionContextV6 } from "./engine";

// A transport tuple removes repeated JSON keys; the model still supplies the
// actual text and both provenance lists. All existing validators run afterward.
const claim = z.tuple([
  z.string().min(1).max(240),
  z.array(z.string().min(1)).max(8),
  z.array(z.string().min(1)).max(8),
  z.array(z.string().max(300)).max(6),
]);
const compactPlanSchema = z.object({
  selections: z.array(z.tuple([z.string().min(1), z.number().int().min(0).max(30), claim, claim])).max(10),
  shortfallReason: z.string().max(1600).nullable(),
  comparison: claim.optional(),
}).strict();
const anchorPlanSchema = z.object({
  selections: z.array(z.tuple([
    z.string().min(1), z.number().int().min(0).max(30),
    z.array(z.string().min(1)).max(3), z.array(z.string().min(1)).min(1).max(3),
  ])).max(10),
  shortfallReason: z.string().max(1600).nullable(),
}).strict();
export const modelPlanTransportSchema = z.union([anchorPlanSchema, compactPlanSchema, matchPlanSchema]);
type TransportPlan = z.infer<typeof modelPlanTransportSchema>;
const excerpt = (text: string, length: number) => text.length > length ? `${text.slice(0, length)}…` : text;

export function isModelAnchorPlan(value: TransportPlan) {
  return anchorPlanSchema.safeParse(value).success;
}

function expandAnchorPlan(value: z.infer<typeof anchorPlanSchema>, context: DecisionContextV6, decode: (value: unknown) => unknown): MatchPlanV6 {
  const recommendations = value.selections.map(([alias, roleIndex, students, facts]) => {
    const ids = decode({ itemId: alias, studentFactIds: students, competitionFactIds: facts }) as { itemId: string; studentFactIds: string[]; competitionFactIds: string[] };
    const candidate = context.candidates.find(candidate => candidate.record.recordId === ids.itemId);
    const role = candidate?.record.roles[roleIndex];
    const studentText = ids.studentFactIds.map(id => {
      const fact = context.profile.facts.find(fact => fact.id === id);
      if (!fact) return "个人证据无法对应";
      const state = fact.state === "negated" ? "明确否定：" : fact.state === "conditional" ? "仅在条件成立时：" : "";
      return `${state}${excerpt(fact.label, 100)}`;
    }).join("；");
    const competitionText = ids.competitionFactIds.map(id => excerpt(candidate?.record.facts.find(fact => fact.id === id)?.text ?? "赛事证据无法对应", 160)).join("；");
    const basis = ids.studentFactIds.length ? "inference" as const : "suggestion" as const;
    const conditions = ["这是探索建议，不证明独立完成能力；资格、历史范围与资源条件仍须逐项核实。"];
    return {
      itemId: ids.itemId, roleIndex,
      reasons: [{ text: `${studentText ? `对照你确认的「${studentText}」；` : "目前个人依据不足，先作为探索方向；"}赛事资料摘录：「${competitionText}」。先用实际产出检验这项任务联系。`, basis, studentFactIds: ids.studentFactIds, competitionFactIds: ids.competitionFactIds, conditions }],
      roleReason: { text: `可先尝试「${role?.name ?? "待核实分工"}」：${excerpt(role?.task ?? "分工资料无法对应", 450)}。${studentText ? `个人依据是「${studentText}」。` : "这是待体验的分工，尚无个人能力证明。"}不将团队成果或自述技能当作独立完成证据。`, basis, studentFactIds: ids.studentFactIds, competitionFactIds: ids.competitionFactIds, conditions },
    };
  });
  const first = recommendations[0], second = recommendations[1];
  return matchPlanSchema.parse({
    profileRevision: context.profile.revision, catalogVersion: context.catalogVersion, recommendations,
    shortfallReason: value.shortfallReason,
    ...(first && second ? { comparison: {
      text: `先比较两项实际分工：${first.roleReason.text.split("。")[0]}；${second.roleReason.text.split("。")[0]}。以你愿意持续做的任务和可投入资源选择，先核实各自适用条件。`,
      basis: "suggestion", studentFactIds: [...new Set([...first.roleReason.studentFactIds, ...second.roleReason.studentFactIds])],
      competitionFactIds: [...new Set([...first.roleReason.competitionFactIds, ...second.roleReason.competitionFactIds])], conditions: ["排序由模型比较形成；资料和个人状态变化时需要重新计算。"],
    } } : {}),
  });
}

/** Expand only the agreed transport shape, with server-owned revision binding.
 * Aliases inside tuples are decoded only after becoming named provenance fields.
 * This does not insert facts, select candidates or decide semantic support.
 */
export function expandModelPlanTransport(
  value: TransportPlan,
  binding: { profileRevision: string; catalogVersion: string; context?: DecisionContextV6 },
  decode: (value: unknown) => unknown,
): MatchPlanV6 {
  if (!("selections" in value)) return matchPlanSchema.parse(decode(value));
  const anchors = anchorPlanSchema.safeParse(value);
  if (anchors.success) {
    if (!binding.context) throw new Error("anchor_plan_requires_actual_context");
    return expandAnchorPlan(anchors.data, binding.context, decode);
  }
  const compact = compactPlanSchema.parse(value);
  const expand = ([text, studentFactIds, competitionFactIds, conditions]: z.infer<typeof claim>) => ({
    text, basis: studentFactIds.length ? "inference" as const : "suggestion" as const,
    studentFactIds, competitionFactIds, conditions,
  });
  return matchPlanSchema.parse(decode({
    profileRevision: binding.profileRevision, catalogVersion: binding.catalogVersion,
    recommendations: compact.selections.map(([itemId, roleIndex, reason, roleReason]) => ({
      itemId, roleIndex, reasons: [expand(reason)], roleReason: expand(roleReason),
    })),
    shortfallReason: compact.shortfallReason,
    ...(compact.comparison ? { comparison: expand(compact.comparison) } : {}),
  }));
}
