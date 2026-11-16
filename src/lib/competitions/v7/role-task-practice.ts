import { z } from "zod";
import { groundedBridgeSelectionSchemaV7 } from "./match-learning-selection";
import type { ConditionalTaskPracticeV763, FutureUseSelectionV764, GroupTaskSelectionV7, LearnerBasisSelectionV760, LearnerRelationV759, TaskRelationSelectionV766 } from "./group-contracts";

export const TASK_PRACTICE_FIT_SCOPE_V761 = "引文正确只证明任务事实。兴趣或目标要对应这个子步能了解的具体对象或内容，无需已有同领域经历、熟练或完成整岗。依据能力或经历做迁移时，说清同一种具体操作或判断怎样用于原任务，以及可核对什么。仅同题材、查出处、找人数或通用记录不足；确有核对来源的目标时，可直接核一个有据的具体主张。";
export const TASK_PRACTICE_CONDITIONS_V761 = "实做依赖未确认设备、现场、样本或授权，先核实再做。只核实际所需条件，确认为可用才执行。未来先核是合法准备，未确认时可做可行的纸面步骤或标待查。未来查找资料、缺项标待查可成立，不能写成已找到。赛事报名资格、日期和费用是提醒，有据的学习练习无需先符合参赛资格。声称当前已有资源、获许可、满足预算或可报名须有直接依据。已知拒做、未获许可或实际安全条件约束依赖它的操作。";
export const TASK_PRACTICE_SOURCE_SCOPE_V762 = "原角色提供可尝试的真实子步。同项引文支持所写对象、操作或判据之一，并直接证明所有写出的既有事实。只有通则时只写通则范围内的准备或未来查找，不写成已掌握具名题、作品或数据。未来可自拟本题步骤和判据，须保留赛事对象并标为建议，不把学生旧项目换进赛事任务，也不说成官方规定。";
export const TASK_PRACTICE_LEARNER_USE_V762 = "原自述由系统原样展示。适配用途只说明下一步怎样用到所选依据，不再重述既往过程。新增重复次数、对照、先后或记录维度写为未来安排。若提到过去具体做法，原话必须支持其含义，保留否定与条件。不能把未说明的具体操作说成已有；同义表达不改变原意。";
export const TASK_PRACTICE_LEARNER_USE_V763 = "原自述由系统原样展示。适配用途只写所选依据怎样用于下一步。算过或做过不证明留有账表、条件记录或原始数据。原话明确的资料可按原范围使用；否则写未来自拟或收集，不给旧经历增补记录、频次或做法。";

const scopedTask = /[()（）「」『』“”‘’"'《》【】；;。？！?!\r\n]|条件下|前提下|否则|如果|除非|只有|仅|至少|至多|必须|不得|不能|不可|禁止|不超过|不使用|不允许|并非|许可|授权|未获/u;
const independentAction = /^(?:选择|设计|检查|检验|测试|比较|区分|整理|梳理|记录|分析|计算|估计|定义|处理|明确|实现|核对|追踪|寻找|保留|说明|组织|辨认|核实|测量|完成|建立|验证|接入|写出|控制|回答)/u;
const comparisonWithoutPair = /^(?:比较|区分)(?!.*[与和及或])/u;

/** Option zero always carries the full original context. Only offer comma
 * clauses if each starts an explicit action and no scoped wording is split. */
export function roleTaskStepOptionsV7(roleTask: string): { index: number; text: string }[] {
  if (!roleTask.trim()) return [];
  const clauses = roleTask.split(/[，,]/u).map(clause => clause.trim());
  const steps = clauses.length > 1 && !scopedTask.test(roleTask)
    && clauses.every(clause => independentAction.test(clause) && !comparisonWithoutPair.test(clause))
    ? [roleTask, ...clauses] : [roleTask];
  return [...new Set(steps)].map((text, index) => ({ index, text }));
}

const focusAction = `${independentAction.source.slice(1)}(?=[^\\s与和及或，,、])`;
const focusActionStart = new RegExp(`^${focusAction}`, "u");
const focusBoundary = new RegExp(`[，,、]\\s*(?:并且?|且)?\\s*(?=${focusAction})`, "u");
const dependentFocus = /无需|不必|限于|只在|只能|不应|不做|先.+再/u;

/** Separate explicitly punctuated actions. Bare conjunctions can be part of a
 * word such as 合并. Object lists and scoped tasks retain their context. */
export function rankTaskFocusOptionsV7(roleTask: string): { index: number; text: string }[] {
  if (!roleTask.trim()) return [];
  const clauses = roleTask.split(focusBoundary).map(clause => clause.trim());
  const steps = clauses.length > 1 && !scopedTask.test(roleTask) && !dependentFocus.test(roleTask)
    && clauses.every(clause => focusActionStart.test(clause) && !comparisonWithoutPair.test(clause))
    ? [roleTask, ...clauses] : [roleTask];
  return [...new Set(steps)].map((text, index) => ({ index, text }));
}

const practiceLabel = "练习：";
const practiceSeparator = `」。${practiceLabel}`;
const checkSeparator = "；核对：";
const connectionSeparator = "；适配用途：";
const practicePrefix = (step: string) => `聚焦「${step}${practiceSeparator}`;
const originalSelection = groundedBridgeSelectionSchemaV7.innerType().shape;
const componentSchema = originalSelection.bridge.refine(value => !value.includes(practiceSeparator) && !value.includes(checkSeparator),
  "task_practice_uses_reserved_separator");

export const taskPracticeSelectionSchemaV7 = z.object({
  competitionFactIds: originalSelection.competitionFactIds,
  taskStepIndex: z.number().int().nonnegative(),
  practice: componentSchema,
  check: componentSchema,
}).strict();
export const taskPracticeFieldsSchemaV7 = taskPracticeSelectionSchemaV7.pick({ practice: true, check: true }).strict();
type TaskPracticeFields = z.infer<typeof taskPracticeFieldsSchemaV7>;
const connectedComponentSchema = componentSchema.refine(value => !value.includes(connectionSeparator), "task_practice_uses_reserved_separator");
export const connectedTaskPracticeFieldsSchemaV758 = z.object({
  practice: connectedComponentSchema,
  check: connectedComponentSchema,
  connection: connectedComponentSchema,
}).strict();
type ConnectedTaskPracticeFields = z.infer<typeof connectedTaskPracticeFieldsSchemaV758>;
const beforeCondition = "。前置核实：";
const afterCondition = "。确认后可";
const sentenceBody = (value: string) => value.replace(/[。；;]+$/u, "").trimEnd();
const unstructuredCondition = (value: string) => value.includes(beforeCondition) || value.includes(afterCondition);
const futureActionComponent = connectedComponentSchema.refine(value => Boolean(sentenceBody(value)) && !unstructuredCondition(value),
  "task_practice_condition_uses_reserved_separator");
export const conditionalTaskPracticeSchemaV763 = z.object({ needs: futureActionComponent, action: futureActionComponent }).strict();
export const futureUseSelectionSchemaV764 = z.object({ futureUse: futureActionComponent, prerequisite: futureActionComponent.optional() }).strict();
export const taskRelationSelectionSchemaV766 = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("understand"), taskPoint: futureActionComponent }).strict(),
  z.object({ mode: z.literal("apply"), taskPoint: futureActionComponent, prerequisite: futureActionComponent.optional() }).strict(),
]);
export const taskConnectionSchemaV767 = connectedComponentSchema.refine(value => Boolean(sentenceBody(value)),
  "empty_task_connection");
export type TaskPracticeProseProtocolV7 = "legacy" | "literal" | "explicit_source" | "matching_relation";
export const learnerBasisSelectionSchemaV760 = z.object({
  kind: z.enum(["student_fact", "goal"]),
  index: z.number().int().nonnegative(),
}).strict();
export const learnerRelationSchemaV759 = learnerBasisSelectionSchemaV760.extend({
  quote: z.string().min(1).max(1600).refine(value => value === value.trim()
    && !/[\r\n\v\f\u0085\u2028\u2029「」]/u.test(value)
    && !value.includes(checkSeparator) && !value.includes(connectionSeparator), "learner_quote_must_remain_verbatim"),
}).strict();
type LearnerBinding = Pick<GroupTaskSelectionV7, "learnerRelation" | "learnerBasisSelection" | "conditionalPractice">;
type TaskPractice = Pick<z.infer<typeof taskPracticeSelectionSchemaV7>, "taskStepIndex" | "practice" | "check">;

export function composeRankBoundTaskPracticeBridgeV7(focus: string, { practice, check }: TaskPracticeFields): string {
  const practiceText = practice.replace(/[。；;]+$/u, "").trimEnd() || practice;
  return `${practicePrefix(focus)}${practiceText}${checkSeparator}${check}`;
}

export function composeConnectedTaskPracticeBridgeV758(focus: string, fields: ConnectedTaskPracticeFields): string {
  return composeRankBoundTaskPracticeBridgeV7(focus, fields) + connectionSeparator + fields.connection;
}

const learnerRelationPrefix = ({ kind, quote }: LearnerRelationV759) =>
  kind === "goal" ? `目标原话片段「${quote}」。` : `自述片段「${quote}」。`;
const indexedLearnerBasisPrefix = ({ kind, index }: LearnerBasisSelectionV760) =>
  kind === "goal" ? "对应上述目标。" : `对应上述第${index + 1}条自述。`;

function conditionedFutureUse({ futureUse, prerequisite }: FutureUseSelectionV764): string {
  return prerequisite === undefined ? futureUse : `前置核实：${sentenceBody(prerequisite)}。条件满足后，${futureUse}`;
}

export function composeMatchingRelationV764(focus: string, basis: LearnerBasisSelectionV760, selection: FutureUseSelectionV764): string {
  return `聚焦「${focus}」。${composeMatchingRelationV765(basis, selection)}`;
}

export function composeMatchingRelationV765(basis: LearnerBasisSelectionV760, selection: FutureUseSelectionV764): string {
  return `${indexedLearnerBasisPrefix(basis)}${conditionedFutureUse(selection)}`;
}

type MatchingRelationBinding = Pick<GroupTaskSelectionV7, "learnerBasisSelection" | "futureUseSelection">;

export function readMatchingRelationV765(bridge: string, binding?: MatchingRelationBinding): string | undefined {
  const basis = binding?.learnerBasisSelection, selection = binding?.futureUseSelection;
  const parsed = futureUseSelectionSchemaV764.safeParse(selection);
  if (!basis || !parsed.success || !selection || parsed.data.futureUse !== selection.futureUse
    || parsed.data.prerequisite !== selection.prerequisite || composeMatchingRelationV765(basis, selection) !== bridge) return undefined;
  return conditionedFutureUse(selection);
}

export function readMatchingRelationV764(focus: string, bridge: string, binding?: MatchingRelationBinding): string | undefined {
  const scope = `聚焦「${focus}」。`;
  return bridge.startsWith(scope) ? readMatchingRelationV765(bridge.slice(scope.length), binding) : undefined;
}

function taskRelationProseV766(relation: TaskRelationSelectionV766): string {
  if (relation.mode === "understand") return `可据此理解：${relation.taskPoint}`;
  return conditionedFutureUse({ futureUse: `可据此尝试：${relation.taskPoint}`, prerequisite: relation.prerequisite });
}

export function composeTaskRelationV766(basis: LearnerBasisSelectionV760, selection: TaskRelationSelectionV766): string {
  return indexedLearnerBasisPrefix(basis) + taskRelationProseV766(selection);
}

export function readTaskRelationV766(bridge: string,
  binding?: Pick<GroupTaskSelectionV7, "learnerBasisSelection" | "taskRelation">): string | undefined {
  const basis = binding?.learnerBasisSelection, selection = binding?.taskRelation;
  const parsed = taskRelationSelectionSchemaV766.safeParse(selection);
  if (!basis || !parsed.success || !selection || parsed.data.taskPoint !== selection.taskPoint
    || parsed.data.mode === "apply" && selection.mode === "apply" && parsed.data.prerequisite !== selection.prerequisite
    || composeTaskRelationV766(basis, parsed.data) !== bridge) return undefined;
  return taskRelationProseV766(parsed.data);
}

export function composeTaskConnectionV767(basis: LearnerBasisSelectionV760, taskConnection: string): string {
  return indexedLearnerBasisPrefix(basis) + taskConnection;
}

export function readTaskConnectionV767(bridge: string,
  binding?: Pick<GroupTaskSelectionV7, "learnerBasisSelection" | "taskConnection">): string | undefined {
  const basis = binding?.learnerBasisSelection;
  const parsed = taskConnectionSchemaV767.safeParse(binding?.taskConnection);
  if (!basis || !parsed.success || parsed.data !== binding?.taskConnection
    || composeTaskConnectionV767(basis, parsed.data) !== bridge) return undefined;
  return parsed.data;
}

function composeBoundConnection(focus: string, fields: ConnectedTaskPracticeFields, basisPrefix: string): string {
  const check = fields.check.replace(/[。；;]+$/u, "").trimEnd() || fields.check;
  return composeConnectedTaskPracticeBridgeV758(focus, { practice: fields.practice, check, connection: basisPrefix + fields.connection });
}

export function composeIndexedTaskPracticeBridgeV760(focus: string, fields: ConnectedTaskPracticeFields, selection: LearnerBasisSelectionV760): string {
  return composeBoundConnection(focus, fields, indexedLearnerBasisPrefix(selection));
}

function conditionalPracticeSuffix({ needs, action }: ConditionalTaskPracticeV763): string {
  return `${beforeCondition}${sentenceBody(needs)}${afterCondition}${sentenceBody(action)}`;
}

export function composeTaskPracticeBridgeV7(roleTask: string, { taskStepIndex, practice, check }: TaskPractice): string | undefined {
  const step = roleTaskStepOptionsV7(roleTask)[taskStepIndex];
  if (!step) return undefined;
  return composeRankBoundTaskPracticeBridgeV7(step.text, { practice, check });
}

/** Validate the stored, displayed bridge against the same original task and
 * format used during generation. Each generated part must stay unambiguous. */
export function isTaskPracticeBridgeV7(roleTask: string, bridge: string): boolean {
  return roleTaskStepOptionsV7(roleTask).filter(({ text }) => readRankBoundTaskPracticeBridgeV7(text, bridge) !== undefined).length === 1;
}

/** Recover the two generated fields without inspecting the original focus. */
export function readTaskPracticeFieldsV7(focus: string, bridge: string): TaskPracticeFields | undefined {
  const prefix = practicePrefix(focus);
  if (!bridge.startsWith(prefix)) return undefined;
  const parts = bridge.slice(prefix.length).split(checkSeparator);
  if (parts.length !== 2 || !parts.every(part => {
    const parsed = componentSchema.safeParse(part);
    return parsed.success && parsed.data === part;
  })) return undefined;
  return { practice: parts[0], check: parts[1] };
}

export function readConnectedTaskPracticeFieldsV758(focus: string, bridge: string): ConnectedTaskPracticeFields | undefined {
  const parts = bridge.split(connectionSeparator);
  if (parts.length !== 2) return undefined;
  const fields = readTaskPracticeFieldsV7(focus, parts[0]);
  const parsed = fields && connectedTaskPracticeFieldsSchemaV758.safeParse({ ...fields, connection: parts[1] });
  return parsed?.success && parsed.data.connection === parts[1] ? parsed.data : undefined;
}

export function readSealedTaskPracticeFieldsV7(focus: string, bridge: string, binding?: LearnerBinding,
  explicitSource = false): ConnectedTaskPracticeFields | undefined {
  const fields = readConnectedTaskPracticeFieldsV758(focus, bridge);
  const condition = binding?.conditionalPractice;
  if (condition !== undefined) {
    const parsed = conditionalTaskPracticeSchemaV763.safeParse(condition);
    if (!explicitSource || !parsed.success || parsed.data.needs !== condition.needs || parsed.data.action !== condition.action) return undefined;
  }
  if (explicitSource && fields) {
    const suffix = condition ? conditionalPracticeSuffix(condition) : "";
    if (!fields.practice.endsWith(suffix)) return undefined;
    const base = fields.practice.slice(0, fields.practice.length - suffix.length);
    if (!futureActionComponent.safeParse(base).success) return undefined;
  }
  const prefix = binding?.learnerBasisSelection ? indexedLearnerBasisPrefix(binding.learnerBasisSelection)
    : binding?.learnerRelation ? learnerRelationPrefix(binding.learnerRelation) : undefined;
  if (prefix === undefined) return fields;
  if (!fields?.connection.startsWith(prefix)) return undefined;
  const application = fields.connection.slice(prefix.length);
  const parsed = (explicitSource ? futureActionComponent : connectedComponentSchema).safeParse(application);
  if (!parsed.success || parsed.data !== application) return undefined;
  if (explicitSource && !futureActionComponent.safeParse(fields.check).success) return undefined;
  const future = { ...fields, connection: application };
  return composeBoundConnection(focus, future, prefix) === bridge ? future : undefined;
}

export function readSealedTaskPracticeReviewV7(focus: string, bridge: string, binding?: LearnerBinding, explicitSource = false): string | undefined {
  const fields = readSealedTaskPracticeFieldsV7(focus, bridge, binding, explicitSource);
  return fields && `${practiceLabel}${fields.practice}${checkSeparator}${fields.check}${connectionSeparator}${fields.connection}`;
}

export function readRankBoundTaskPracticeBridgeV7(focus: string, bridge: string, connected = false): string | undefined {
  if (connected) {
    const fields = readConnectedTaskPracticeFieldsV758(focus, bridge);
    return fields && `${practiceLabel}${fields.practice}${checkSeparator}${fields.check}${connectionSeparator}${fields.connection}`;
  }
  const fields = readTaskPracticeFieldsV7(focus, bridge);
  return fields && `${practiceLabel}${fields.practice}${checkSeparator}${fields.check}`;
}

const modelIdentifier = /@[cfps]\d+/iu;
const priorPersonalAttribution = [
  /(?:你|您|本人|自己)(?:曾经?|之前|此前|以前|过去|原来|原先|上次|已有|已经|已(?:做|用|试|实现|记录)|(?:做|用|试|实现|记录)过)/u,
  /(?:借(?:用|鉴)?|沿用|复用|仿照|照搬|用|按)(?:你|您|本人|自己)(?:的)?(?!未来|将|拟|待|新)[^。！？；;\n]{0,54}(?:经验|经历|习惯|核对法|勾核法|记录法|的(?:做法|方法|方式|记录))/u,
  /(?:用|以|按|参照)(?:你|您|本人|自己)(?:的)?(?!未来|将|拟|待|新)[^。！？；;\n]{0,38}时[^。！？；;\n]{0,40}(?:判定标准|作为判据|问法|追问|的做法|的方式)/u,
  /像(?:你|您|本人|自己)(?!未来|将|拟|待)[^。！？；;\n]{0,80}那样/u,
  /(?:你|您|本人|自己)(?:的)?[^。！？；;\n]{0,18}(?:卡片?|笔记|原型|表单)(?:上|中|里)(?:已(?:经)?|曾经?)?(?:记录|保存|写|标注)的/u,
  /(?:检查|核对|定位)(?:你|您|本人|自己)(?:的)?(?!未来|将|拟|待|新)[^。！？；;\n]{0,14}(?:卡片?|笔记|原型|表单)(?:上|中|里)(?:某|一|其中|已有)[^。！？；;\n]{0,10}(?:提问|问题|记录|标注)/u,
  /\b(?:you(?:'ve| have| previously| used to)|your (?:previous|earlier|existing|prior))\b/iu,
];
const borrowedPastMethod = [
  /(?:借用|借鉴|借(?!用|鉴)|沿用|复用|仿照|照搬)(?!原文|原作|作者|该论文|公开资料)[^。！？；;\n]{0,120}(?:经历|经验|习惯|核对法|勾核法|记录法|时[^。！？；;\n]{0,40}(?:方法|做法|方式|记录|问法|追问|标准))/u,
  /(?:把|将)[^。！？；;\n]{0,120}时[^。！？；;\n]{0,44}(?:方法|做法|方式|记录|问法|追问|习惯|标准)[^。！？；;\n]{0,20}(?:迁移|用于|用到|用来|作为)/u,
  /(?:按|用|定位|检查|对应)(?:此前|原先|上次)?(?:卡片?|笔记|原型|表单)(?:上|中|里)(?:已(?:经)?|曾经?)?记录的/u,
];

/** Check only free generated prose. Original quotes, task text and IDs in
 * typed citation fields keep their exact bindings. */
export function taskPracticeTextIssueV7(fields: TaskPracticeFields, internalIds: readonly string[]): "internal_identifier" | "student_attribution" | undefined {
  return taskPracticeProseIssue(`${fields.practice}\n${fields.check}`, internalIds);
}

function taskPracticeIdentifierIssue(prose: string, internalIds: readonly string[]) {
  const normalized = prose.normalize("NFKC");
  if (modelIdentifier.test(normalized) || internalIds.some(id => id.length >= 8 && /[.:_-]/u.test(id) && normalized.includes(id))) return "internal_identifier" as const;
}

function taskPracticeProseIssue(prose: string, internalIds: readonly string[]) {
  const identifier = taskPracticeIdentifierIssue(prose, internalIds);
  if (identifier) return identifier;
  if (priorPersonalAttribution.some(pattern => pattern.test(prose)) || borrowedPastMethod.some(pattern => pattern.test(prose))) return "student_attribution" as const;
  return undefined;
}

const implementationFieldName = /\b(?:boundFact|factOptions|evidenceOptions|specifiedExcerpt|learnerBasis|practicePreferences|rankedSelection|declaredLearningGoal|currentLimits|studentBasisOptions|studentGoalOptions|taskFocus|taskStepIndex|rowIndex|factIndex|roleIndex|selectedTaskFocus|provisionalRankRelation|provisionalRankSelection)\b/iu;
const lowerBound = "至少|不少于|不低于|大于等于|≥";
const upperBound = "至多|最多|不超过|不高于|小于等于|≤";
const boundOperator = `${lowerBound}|${upperBound}`;
const amount = "[0-9]+(?:\\.[0-9]+)?|[零一二两三四五六七八九十百千万]+";
const classifier = "[个项种名位台套条份]?";
const threshold = new RegExp(`(?<operator>${boundOperator})\\s*(?<amount>${amount})${classifier}(?<unit>(?:(?!且|并|或|和|及|等|须|需|为|的)[\\p{Script=Han}a-zA-Z%°]){1,16})`, "gu");
const requirementLanguage = /(?:原文|题设|题面|选题|官方|规则|赛题)[^。！？；;\n]{0,90}(?:要求|抄(?:成|出)|[“「"‘])|(?:是|属(?:于)?)(?:原文|题设|赛题|官方)(?:的)?(?:要求|规则)/u;
const lowerOperator = new RegExp(`^(?:${lowerBound})$`, "u");
const localExample = /(?:自拟|假设|假想|模拟)[^，。；;、”」]{0,12}$/u;
const localExampleAfter = /^(?:的|作为|用作|做(?:为|成)?|作(?:为)?)?(?:一[个项种])?(?:纸面)?(?:自拟|假设|假想|模拟|示例|样例)/u;
const lowerAfter = /^(?:或(?:更多|以上)|及以上|以上|起)/u;
const upperAfter = /^(?:或(?:更少|以下)|及以下|以下|为限)/u;
const smallAmounts = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];

/** The quoted fact remains authoritative. Catch an omitted bound when the
 * prose gives the same quantity as a rule, without banning exact examples. */
function changesQuotedThreshold(prose: string, factText: string): boolean {
  const requirementClauses = prose.split(/[。！？；;\n]/u).filter(clause => requirementLanguage.test(clause));
  if (!requirementClauses.length) return false;
  for (const { groups } of factText.normalize("NFKC").matchAll(threshold)) {
    if (!groups) continue;
    const { operator, amount: sourceAmount, unit } = groups;
    const smallValue = sourceAmount === "两" ? 2 : smallAmounts.indexOf(sourceAmount);
    const equivalents = smallValue >= 0 ? [sourceAmount, String(smallValue)]
      : /^(?:[0-9]|10)$/u.test(sourceAmount) ? [sourceAmount, smallAmounts[Number(sourceAmount)]] : [sourceAmount];
    if (equivalents.includes("二") || equivalents.includes("2")) equivalents.push("两", "二");
    const values = [...new Set(equivalents)].map(value => value.replaceAll(".", "\\.")).join("|");
    const quantity = new RegExp(`(?<![0-9零一二两三四五六七八九十百千万])(?:(?<operator>${boundOperator})\\s*)?(?:${values})${classifier}${unit}`, "gu");
    for (const clause of requirementClauses) {
      for (const match of clause.matchAll(quantity)) {
        if (match.groups?.operator && lowerOperator.test(match.groups.operator) === lowerOperator.test(operator)) continue;
        const after = clause.slice(match.index + match[0].length);
        if (!match.groups?.operator && (lowerOperator.test(operator) ? lowerAfter : upperAfter).test(after)) continue;
        if (localExample.test(clause.slice(0, match.index)) || localExampleAfter.test(after)) continue;
        return true;
      }
    }
  }
  return false;
}

function sourceProseIssue(prose: string, factText: string) {
  const normalized = prose.normalize("NFKC");
  if (implementationFieldName.test(normalized)) return "internal_identifier" as const;
  if (changesQuotedThreshold(normalized, factText)) return "changed_source_quantifier" as const;
}

export function connectedTaskPracticeTextIssueV758(fields: ConnectedTaskPracticeFields, internalIds: readonly string[], factText: string) {
  const prose = [fields.practice, fields.check, fields.connection].join("\n");
  const issue = taskPracticeProseIssue(prose, internalIds) ?? sourceProseIssue(prose, factText);
  if (issue) return issue;
  if ([fields.practice, fields.check].includes(fields.connection)) return "missing_task_connection" as const;
  return undefined;
}

const existingPersonalArtifact = /(?:把|将|按|用|沿用|复用)(?:你|您|本人|自己)[^。！？；;\n]{0,40}已(?:经)?(?:制作|建立|整理|完成|记录|编写)的[^。！？；;\n]{0,24}(?:表|卡|记录|原型|材料|代码)/u;

/** Only the freely generated future text reaches this guard. The verified
 * quote is rendered separately and cannot be mistaken for generated history. */
export function quotedTaskPracticeTextIssueV759(fields: ConnectedTaskPracticeFields, internalIds: readonly string[], factText: string) {
  const issue = connectedTaskPracticeTextIssueV758(fields, internalIds, factText);
  if (issue) return issue;
  if ([fields.practice, fields.check, fields.connection].some(text => existingPersonalArtifact.test(text))) return "student_attribution" as const;
  return undefined;
}

const ordinalCitation = /(?:核对?|对照|查阅|参考|参照|根据|依据|按|引用|见)\s*\b(fact[0-9]+)\b|\b(fact[0-9]+)\b\s*(?:给(?:出)?|提供|写明|载明|指出|说明|显示|支持)/giu;

function taskPracticeControlIssue(text: string, factText: string, indexed: boolean, protocol: TaskPracticeProseProtocolV7) {
  const prose = text.normalize("NFKC");
  if (protocol !== "legacy") {
    const publicNames = new Set(factText.normalize("NFKC").match(/\b[ts]\d+\b/gu) ?? []);
    const controlSyntax = /\$(?:(?:text|table)["'”’]?\s*:\s*["'“‘]?t\d+\b|scope["'”’]?\s*:\s*["'“‘]?s\d+\b|reviewRef["'”’]?\s*:\s*["'“‘]?\/(?:profile|assertions|sharedCandidateBoundaries)\/)/u;
    const internalSelection = /(?:选(?:择|取|用)?|按字典|读取字典|引用字典|索引)\s*([ts]\d+)\s*(?=[:、，。;；]|$)/gu;
    if (controlSyntax.test(prose) || Array.from(prose.matchAll(internalSelection)).some(match => !publicNames.has(match[1]))) {
      return "internal_identifier" as const;
    }
    if (protocol === "explicit_source" || protocol === "matching_relation") {
      const publicOrdinals = new Set(factText.normalize("NFKC").toLowerCase().match(/\bfact[0-9]+\b/gu) ?? []);
      if ([...prose.matchAll(ordinalCitation)].some(match => !publicOrdinals.has((match[1] ?? match[2]).toLowerCase()))) {
        return "internal_identifier" as const;
      }
    }
  }
  if (indexed && /\b(?:learnerBasisIndex|learnerBasisOptions|learnerBasisSelection)\b/iu.test(prose)) {
    return "internal_identifier" as const;
  }
}

export function sealedTaskPracticeTextIssueV7(fields: ConnectedTaskPracticeFields, internalIds: readonly string[],
  factText: string, binding: LearnerBinding, protocol: TaskPracticeProseProtocolV7 = "legacy") {
  const issue = taskPracticeControlIssue([fields.practice, fields.check, fields.connection].join("\n"), factText, Boolean(binding.learnerBasisSelection), protocol);
  if (issue) return issue;
  return binding.learnerBasisSelection || binding.learnerRelation
    ? quotedTaskPracticeTextIssueV759(fields, internalIds, factText) : connectedTaskPracticeTextIssueV758(fields, internalIds, factText);
}

function matchingRelationProseIssue(prose: string, internalIds: readonly string[], factText: string) {
  return taskPracticeControlIssue(prose, factText, true, "matching_relation") ?? taskPracticeIdentifierIssue(prose, internalIds) ?? sourceProseIssue(prose, factText);
}

export function matchingRelationTextIssueV764(selection: FutureUseSelectionV764, internalIds: readonly string[], factText: string) {
  const prose = selection.prerequisite === undefined ? selection.futureUse : `${selection.prerequisite}\n${selection.futureUse}`;
  return matchingRelationProseIssue(prose, internalIds, factText);
}

export function taskRelationTextIssueV766(selection: TaskRelationSelectionV766, internalIds: readonly string[], factText: string) {
  return matchingRelationTextIssueV764({ futureUse: selection.taskPoint,
    prerequisite: selection.mode === "apply" ? selection.prerequisite : undefined }, internalIds, factText);
}

export function matchingRelationSelectionTextIssueV7(selection: Pick<GroupTaskSelectionV7, "taskConnection" | "taskRelation" | "futureUseSelection">,
  internalIds: readonly string[], factText: string) {
  if (selection.taskConnection !== undefined) return matchingRelationProseIssue(selection.taskConnection, internalIds, factText);
  if (selection.taskRelation) return taskRelationTextIssueV766(selection.taskRelation, internalIds, factText);
  if (selection.futureUseSelection) return matchingRelationTextIssueV764(selection.futureUseSelection, internalIds, factText);
}
