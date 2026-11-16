import { z } from "zod";
import type { StudentFactV6 } from "../v6/contracts";
import type { DecisionContextV6 } from "../v6/engine";
import type { createModelIdentifierCodec } from "../v6/model-identifiers";
import { activeStudentFacts } from "../v6/profile";
import { rankTaskFactsV7 } from "./rank-packet";
import { recommendationMatchRecordV7 } from "./recommendation-advisory-evidence";
import { rankTaskFocusOptionsV7 } from "./role-task-practice";

export const RANK_DIAGNOSTICS_PROMPT_V763 = "先完成所有fit，再在同一回执返回内部rankDiagnostics。codes以给定itemId为键，为每个fit:null各给一个短码，无null时为{}。例如仅@C0为null时写rankDiagnostics:{\"codes\":{\"@C0\":\"L\"}}。L未找到具体学习关系；E有潜在关系但没找到该子步的同项锚点；C所审有据子步的实际操作与本人已确认限制冲突且未找到同项另一关联；B没有可用依据也没有明确目标；U无法定位。报名、费用提醒或未知条件本身不构成操作冲突。witnesses可省略，最多4个不同null项，每项用itemId、原roleIndex、taskStepIndex及一个同项competitionFactIds，可附实际使用的goalIndex或studentBasisIndex。C须有本项见证和一个studentFactIds指向原话中明确的限制；无法给出见证时用U。诊断不改fit，不给置信度、长理由或替代名单。";

const diagnosticCode = z.enum(["L", "E", "C", "B", "U"]);
const candidateAlias = z.string().regex(/^@C\d+$/u).max(16);
const factAlias = z.string().regex(/^@F\d+$/u).max(16);
const studentAlias = z.string().regex(/^@P\d+$/u).max(16);
const index = z.number().int().nonnegative();
const witnessSchema = z.object({
  itemId: candidateAlias,
  roleIndex: index,
  taskStepIndex: index,
  competitionFactIds: z.tuple([factAlias]),
  goalIndex: index.optional(),
  studentBasisIndex: index.optional(),
  studentFactIds: z.tuple([studentAlias]).optional(),
}).strict();
const sidecarSchema = z.object({
  codes: z.record(candidateAlias, diagnosticCode),
  witnesses: z.array(witnessSchema).max(4).optional(),
}).strict();

type RankDiagnosticSidecarV7 = { present: boolean; diagnostic: unknown };
type RankDiagnosticBindingsV7 = {
  context: DecisionContextV6;
  assessments: readonly { itemId: string; fit: unknown }[];
  codec: ReturnType<typeof createModelIdentifierCodec>;
  goalIndices: readonly number[];
  studentBasisCount: number;
};
type RankDiagnosticResultV7 = { status: "absent" } | { status: "invalid"; reason: "shape" | "coverage" | "witness" | "restriction" } | {
  status: "valid";
  codes: { itemId: string; code: z.infer<typeof diagnosticCode> }[];
  witnesses: z.infer<typeof witnessSchema>[];
};

/** Strip only the optional sidecar before strict rank or envelope validation.
 * The provider's raw receipt is captured separately before schema validation. */
export function splitRankDiagnosticsV7(value: unknown): { payload: unknown } & RankDiagnosticSidecarV7 {
  if (value === null || typeof value !== "object" || Array.isArray(value) || !Object.hasOwn(value, "rankDiagnostics"))
    return { payload: value, present: false, diagnostic: undefined };
  const { rankDiagnostics: diagnostic, ...payload } = value as Record<string, unknown>;
  return { payload, present: true, diagnostic };
}

const deniedFields = new Set(["excludedTask", "unavailableResource", "noviceTask"]);
const ambiguousScope = /如果|假如|否则|(?:如|若)(?:无|未|不|能|有)|以前|曾经|听说|(?:老师|导师|朋友|队友)(?:说|计划|表示)/u;
const currentRestriction = /^(?:我|本人)?\s*(?:当前|目前|现在)?\s*(?:(?:无|没有|无法获得|不能使用|未获准使用)(?:实验室|设备|仪器|电脑|网络|场地|账号|样本|材料|数据|授权|许可|权限|团队|队友|导师)|(?:不愿|不做|不得|禁止|只允许|只能|仅允许)\S{2,48})$/u;
const ownCurrentClause = /^(?:我|本人)\s*(?:当前|目前|现在)/u;

function hasExplicitRestriction(fact: StudentFactV6): boolean {
  if (!fact.originalText?.trim() || fact.evidenceLevel === "unknown") return false;
  if (fact.state === "negated" && deniedFields.has(fact.field)) return true;
  return fact.field === "constraints" && !ambiguousScope.test(fact.originalText)
    && fact.originalText.split(/[，,。；;！？?!\n]+/u).map(clause => clause.trim())
      .some((clause, position) => (position === 0 || ownCurrentClause.test(clause)) && currentRestriction.test(clause));
}

/** Diagnostics are model observations. These checks bind their pointers and
 * scope, while the core ranking and retry decision stay independent. */
export function inspectRankDiagnosticsV7(sidecar: RankDiagnosticSidecarV7, bindings: RankDiagnosticBindingsV7): RankDiagnosticResultV7 {
  if (!sidecar.present) return { status: "absent" };
  const parsed = sidecarSchema.safeParse(sidecar.diagnostic);
  if (!parsed.success) return { status: "invalid", reason: "shape" };
  const { context, assessments, codec, goalIndices, studentBasisCount } = bindings;
  const aliasFor = (id: string) => (codec.encode({ id }) as { id: string }).id;
  const candidates = new Map(context.candidates.map(candidate => [aliasFor(candidate.record.recordId), candidate]));
  const nullIds = new Set(assessments.filter(row => row.fit === null).map(row => aliasFor(row.itemId)));
  const entries = Object.entries(parsed.data.codes);
  if (entries.length > 45 || entries.length !== nullIds.size
    || entries.some(([itemId, code]) => !candidates.has(itemId) || !nullIds.has(itemId)
      || code === "B" && (studentBasisCount > 0 || goalIndices.length > 0))) return { status: "invalid", reason: "coverage" };
  const witnesses = parsed.data.witnesses ?? [];
  const witnessed = new Set(witnesses.map(witness => witness.itemId));
  if (witnessed.size !== witnesses.length || entries.some(([itemId, code]) => code === "C" && !witnessed.has(itemId)))
    return { status: "invalid", reason: "witness" };
  const active = new Map(activeStudentFacts(context.profile).map(fact => [aliasFor(fact.id), fact]));
  for (const witness of witnesses) {
    const { itemId, roleIndex, taskStepIndex, competitionFactIds, studentFactIds, goalIndex, studentBasisIndex } = witness;
    const candidate = candidates.get(itemId);
    const role = candidate?.record.roles[roleIndex];
    if (!candidate || !nullIds.has(itemId) || !role || !rankTaskFocusOptionsV7(role.task)[taskStepIndex]
      || !rankTaskFactsV7(recommendationMatchRecordV7(candidate)).some(fact => aliasFor(fact.id) === competitionFactIds[0])
      || goalIndex !== undefined && !goalIndices.includes(goalIndex)
      || studentBasisIndex !== undefined && studentBasisIndex >= studentBasisCount) return { status: "invalid", reason: "witness" };
    if (parsed.data.codes[itemId] === "C") {
      const restriction = studentFactIds && active.get(studentFactIds[0]);
      if (!restriction || !hasExplicitRestriction(restriction)) return { status: "invalid", reason: "restriction" };
    } else if (studentFactIds) return { status: "invalid", reason: "restriction" };
  }
  return { status: "valid", codes: entries.map(([itemId, code]) => ({ itemId: candidates.get(itemId)!.record.recordId, code })),
    witnesses: witnesses.map(witness => codec.decode(witness) as z.infer<typeof witnessSchema>) };
}
