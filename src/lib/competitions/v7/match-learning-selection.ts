import { z } from "zod";
import {
  experienceLevelOptions, getOptionLabel, goalOptions, interestOptions, preferredOutputOptions,
  skillOptions, startingPointOptions, taskFormatOptions,
} from "@/components/competitions/recommend/questionContent";
import type { CatalogFact, CatalogRole } from "../v6/catalog-types";
import type { DecisionClaimV6, StudentFactV6, StudentProfileV6 } from "../v6/contracts";
import { activeStudentFacts, decisionGoalLabels, noviceTaskLabels } from "../v6/profile";
import { matchReasonAnchorPrefixV7 } from "./reason-anchor";

const namedRoleLearningLenses = {
  compare_requirements: "对照几种做法的约束，判断哪些条件会影响选择和交付",
  task_breakdown: "拆开输入、处理步骤和产出，为每一步写出可核对的完成标准",
  solution_tradeoffs: "从数据、准确性和执行成本等角度比较方案，并说明适用条件",
  implementation_checks: "把设计思路落实为可检查的步骤，并区分预期结果和实际表现",
  design_iteration: "把需求转成设计方案，说明关键取舍和下一次迭代需要验证的地方",
  mathematical_reasoning: "把假设、推理和结论连起来，逐步核查结论在哪些条件下成立",
  model_evaluation: "把实际问题转成可分析的变量，检查假设对结果和适用范围的影响",
  evidence_comparison: "按同一口径整理和比较记录，区分直接观察、解释和未确定之处",
  research_design: "把问题转成可观察的指标，梳理怎样记录、比较和解释证据",
  field_investigation: "把实际现象转成可调查的问题，并区分记录、样本范围和可能偏差",
  user_needs: "从使用情境梳理需求，比较方案如何回应不同对象的实际问题",
  business_validation: "区分需求依据、价值假设和待验证的商业判断",
  argument_structure: "把观点和证据对应起来，解释推理依据、可能异议和结论边界",
  audience_explanation: "按照受众的理解顺序组织信息，明确概念、例子和容易误解的地方",
  learning_alignment: "把学习目标与内容安排对应起来，思考怎样检查听众是否理解",
  visual_communication: "用图文层次和呈现顺序突出重点，让读者能对应主张与证据",
  presentation_questions: "把过程和结果组织成可陈述的证据，准备回应关键追问",
  document_traceability: "整理材料与结果的对应关系，让他人看清判断依据和修改过程",
} as const;

const learningLenses = {
  ...namedRoleLearningLenses,
  implementation_checks: "把程序或装置的设计拆成可以实际运行的功能检查，分别记录预期输出与测试结果",
  prediction_observation: "把预期变化与实际观察逐项对照，标出哪些判断有证据支持、哪些差异可能受观测误差影响",
  reasoning_check_questions: "按情境和学习目标设计检查问题，请学习者说明选择依据，再从回答定位误解的环节",
} as const;

const evidenceId = z.string().min(1).max(180);
const bridgeTextSchema = z.string().trim().min(1).max(1600)
  .refine(text => !/[\r\n\v\f\u0085\u2028\u2029]/u.test(text), "bridge_must_be_one_paragraph");
export const groundedBridgeSelectionSchemaV7 = z.object({
  competitionFactIds: z.tuple([evidenceId]),
  studentFactIds: z.array(evidenceId).max(2).refine(ids => new Set(ids).size === ids.length),
  goalIndex: z.number().int().nonnegative().optional(),
  bridge: bridgeTextSchema,
}).strict().refine(choice => choice.studentFactIds.length > 0 || choice.goalIndex !== undefined, {
  message: "choose_actual_student_evidence", path: ["studentFactIds"],
});
export type GroundedBridgeSelectionV7 = z.infer<typeof groundedBridgeSelectionSchemaV7>;

const questionnaireOptions = {
  skills: skillOptions,
  interests: interestOptions,
  goals: goalOptions,
  preferredOutputs: preferredOutputOptions,
  taskFormats: taskFormatOptions,
  startingPoint: startingPointOptions,
  experienceLevel: experienceLevelOptions,
};
const experienceContributionLabels: Readonly<Record<string, string>> = {
  observed: "主要观察学习",
  assisted: "协助完成",
  independent: "独立完成明确部分",
  led: "主导并承担核心工作",
};
const experienceCompletionLabels: Readonly<Record<string, string>> = {
  learning: "跟随学习",
  draft: "形成草稿",
  delivered: "已完成交付",
  feedback: "获得反馈并改进",
};
const fitField = /^(?:(?:goal|goals|primaryGoal|goalIntent|interest|interests|skill|skills|experience)(?:[.:][\p{L}\p{N}_-]+)*|taskFormats(?:\.raw)?|noviceTask|preferredOutputs|startingPoint|experienceLevel)$/u;
const unspecifiedBasis = /^(?:none|unknown|unsure|undecided|idea_only|n\/a|未提供|未知|不确定|暂不确定|无|暂无|暂未决定)$/iu;
function isSpecifiedBasis(value: string): boolean {
  return Boolean(value.trim()) && !unspecifiedBasis.test(value.trim());
}

function displayStudentFact(fact: StudentFactV6, originalText: string): string {
  const value = String(fact.value);
  // A selected option is displayed by its label. Keep free-text sources
  // intact, including qualifications, attribution and negation.
  if (originalText !== value && originalText !== `${fact.field}:${value}`) return originalText;
  const options = Object.hasOwn(questionnaireOptions, fact.field)
    ? questionnaireOptions[fact.field as keyof typeof questionnaireOptions] : undefined;
  if (options) return getOptionLabel(options, value);
  if (["primaryGoal", "goalIntent"].includes(fact.field) && Object.hasOwn(decisionGoalLabels, value)) return decisionGoalLabels[value];
  if (fact.field === "noviceTask" && Object.hasOwn(noviceTaskLabels, value)) return noviceTaskLabels[value];
  if (/^experience\.\d+\.contribution$/.test(fact.field) && Object.hasOwn(experienceContributionLabels, value)) return experienceContributionLabels[value];
  if (/^experience\.\d+\.completion$/.test(fact.field) && Object.hasOwn(experienceCompletionLabels, value)) return experienceCompletionLabels[value];
  return originalText;
}

export function studentLearningOptionsV7(profile: StudentProfileV6) {
  const facts = activeStudentFacts(profile).flatMap(fact =>
    fact.state === "affirmed" && fact.evidenceLevel !== "unknown" && fact.value !== false
    && fitField.test(fact.field) && isSpecifiedBasis(String(fact.value)) && fact.originalText
    && isSpecifiedBasis(fact.originalText) ? [{ id: fact.id, text: displayStudentFact(fact, fact.originalText) }] : []);
  const goals = [...new Set([profile.primaryGoal, ...profile.goals]
    .filter((goal): goal is string => typeof goal === "string" && isSpecifiedBasis(goal))
    .map(goal => Object.hasOwn(decisionGoalLabels, goal) ? decisionGoalLabels[goal] : goal))]
    .map((text, index) => ({ index, text }));
  return { facts, goals };
}

type StudentLearningOptions = ReturnType<typeof studentLearningOptionsV7>;
type LearningBasis = { kind: "fact" | "goal"; text: string };
type LearningRole = Pick<CatalogRole, "name" | "task">;
function editorialRoleText(role: LearningRole): string {
  return `可选分工（编辑建议）「${role.name}」：${role.task}`;
}
function reasonText(fact: CatalogFact, role: LearningRole, basis: LearningBasis, purpose: string, namedRoleOnly: boolean): string {
  const learner = basis.kind === "fact" ? "你提到" : "你的目标是";
  const beginning = `${matchReasonAnchorPrefixV7(fact)}${learner}「${basis.text}」。`;
  if (namedRoleOnly) return `${beginning}从「${role.name}」这项可选分工入手，可以练习${purpose}。`;
  return `${beginning}\n${editorialRoleText(role)}\n学习用途：可以练习${purpose}。`;
}

function selectedStudentTexts(ids: string[], options: StudentLearningOptions): string[] | undefined {
  if (ids.length > 2 || new Set(ids).size !== ids.length) return undefined;
  const selected = ids.map(id => options.facts.find(option => option.id === id)?.text);
  return selected.every((text): text is string => text !== undefined) ? selected : undefined;
}
export const GROUNDED_PRACTICE_LABEL_V7 = "适配练习（可选）";
export const MATCHING_RELATION_LABEL_V764 = "匹配关系";
type GroundedBridgeLabelV7 = typeof GROUNDED_PRACTICE_LABEL_V7 | typeof MATCHING_RELATION_LABEL_V764;

function bridgePrefix(fact: CatalogFact, role: LearningRole, students: string[], goal: string | undefined, label: GroundedBridgeLabelV7): string {
  const studentText = students.length ? `你提到${students.map(text => `「${text}」`).join("、")}。` : "";
  const goalText = goal === undefined ? "" : `你的目标是「${goal}」。`;
  return `${matchReasonAnchorPrefixV7(fact)}${studentText}${goalText}\n${editorialRoleText(role)}\n${label}：`;
}

export function composeGroundedBridgeReasonV7(
  fact: CatalogFact,
  role: LearningRole,
  choice: GroundedBridgeSelectionV7,
  options: StudentLearningOptions,
  label: GroundedBridgeLabelV7 = GROUNDED_PRACTICE_LABEL_V7,
): DecisionClaimV6 | undefined {
  const students = selectedStudentTexts(choice.studentFactIds, options);
  const goal = options.goals.find(option => option.index === choice.goalIndex);
  if (!students || choice.goalIndex !== undefined && !goal || !students.length && !goal) return undefined;
  return {
    text: bridgePrefix(fact, role, students, goal?.text, label) + choice.bridge,
    basis: students.length ? "inference" : "suggestion",
    studentFactIds: [...choice.studentFactIds],
    competitionFactIds: [fact.id],
    conditions: [],
  };
}

/** Recognize the same prefix used to construct the claim. Only its trailing
 * verified paragraph can become the separate wire review subject. */
export function readGroundedBridgeReasonV7(fact: CatalogFact, role: LearningRole, reason: DecisionClaimV6, options: StudentLearningOptions,
  validateBridge = (text: string) => {
    const parsed = bridgeTextSchema.safeParse(text);
    return parsed.success && parsed.data === text;
  }, label: GroundedBridgeLabelV7 = GROUNDED_PRACTICE_LABEL_V7):
  { bridge: string; explicitStudentGoal?: string } | undefined {
  const students = selectedStudentTexts(reason.studentFactIds, options);
  if (!students || reason.basis !== (students.length ? "inference" : "suggestion")
    || reason.conditions.length || reason.competitionFactIds.length !== 1 || reason.competitionFactIds[0] !== fact.id) return undefined;
  const goals = options.goals.map(goal => goal.text);
  let matched: { bridge: string; explicitStudentGoal?: string } | undefined;
  for (const goal of students.length ? [undefined, ...goals] : goals) {
    const prefix = bridgePrefix(fact, role, students, goal, label);
    if (!reason.text.startsWith(prefix)) continue;
    const text = reason.text.slice(prefix.length);
    if (!validateBridge(text)) continue;
    if (matched) return undefined;
    matched = { bridge: text, ...(goal === undefined ? {} : { explicitStudentGoal: goal }) };
  }
  return matched;
}

export function isGroundedBridgeReasonV7(fact: CatalogFact, role: LearningRole, reason: DecisionClaimV6, options: StudentLearningOptions): boolean {
  return readGroundedBridgeReasonV7(fact, role, reason, options) !== undefined;
}

/** Old structured reasons use their original wording and purpose table. */
export function isComposedLearningReasonV7(fact: CatalogFact, role: LearningRole, reason: DecisionClaimV6, options: StudentLearningOptions,
  namedRoleOnly = false): boolean {
  let bases: LearningBasis[];
  if (reason.basis === "inference" && reason.studentFactIds.length === 1) {
    const student = options.facts.find(option => option.id === reason.studentFactIds[0]);
    bases = student ? [{ kind: "fact", text: student.text }] : [];
  } else if (reason.basis === "suggestion" && !reason.studentFactIds.length) {
    bases = options.goals.map(goal => ({ kind: "goal", text: goal.text }));
  } else return false;
  const purposes = Object.values(namedRoleOnly ? namedRoleLearningLenses : learningLenses);
  return bases.some(basis => purposes.some(purpose => reason.text === reasonText(fact, role, basis, purpose, namedRoleOnly)));
}
