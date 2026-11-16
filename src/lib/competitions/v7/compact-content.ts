import { COMPACT_TASK_COPY_V7 } from "@/content/competitions-v6/compact-task-copy";
import { COMPACT_VALUE_COPY_V7 } from "@/content/competitions-v6/compact-value-copy";
import type { DecisionClaimV6, DecisionRecommendationV6, StudentProfileV6 } from "../v6/contracts";

type CompactGoal = "project" | "award" | "postgraduate" | "employment" | "portfolio" | "entrepreneurship" | "networking" | "explore" | "skill";
type ValueDimension = "governance" | "taskRelevance" | "portfolio" | "learningFeedback" | "industryAcademicAccess" | "recognition";
type CompactGoalProfile = Pick<StudentProfileV6, "primaryGoal" | "goals">;
type CompactValue = DecisionRecommendationV6["values"][number];

const goalLabels: Readonly<Record<CompactGoal, string>> = {
  project: "积累项目经历", award: "争取奖项", postgraduate: "支持升学探索", employment: "探索实习就业",
  portfolio: "积累可展示作品", entrepreneurship: "实践创业想法", networking: "认识合作伙伴",
  explore: "探索适合自己的方向", skill: "练习具体能力",
};
const goalPriorities: Readonly<Record<CompactGoal, readonly ValueDimension[]>> = {
  project: ["portfolio", "taskRelevance"],
  award: ["recognition", "governance"],
  postgraduate: ["learningFeedback", "portfolio"],
  employment: ["portfolio", "taskRelevance"],
  portfolio: ["portfolio", "taskRelevance"],
  entrepreneurship: ["taskRelevance", "portfolio"],
  networking: ["industryAcademicAccess", "learningFeedback"],
  explore: ["taskRelevance", "learningFeedback"],
  skill: ["learningFeedback", "portfolio"],
};
const defaultPriority: readonly ValueDimension[] = ["taskRelevance", "portfolio", "learningFeedback", "governance", "industryAcademicAccess", "recognition"];
// Archived reports used these dimensions before the current six-dimension catalog.
const legacyDimensions: Readonly<Record<string, ValueDimension>> = {
  exploration: "taskRelevance", explore: "taskRelevance", skill: "learningFeedback",
  employment: "industryAcademicAccess", job: "industryAcademicAccess", research: "industryAcademicAccess", award: "recognition",
};

function goalKey(value: string | null | undefined): CompactGoal | undefined {
  return (Object.keys(goalLabels) as CompactGoal[]).find(key => key === value || goalLabels[key] === value);
}

function valuePriority(profile: CompactGoalProfile | null | undefined): ValueDimension[] {
  const primary = goalKey(profile?.primaryGoal);
  const goals = primary ? [primary] : [...new Set((profile?.goals ?? []).flatMap(value => {
    const key = goalKey(value);
    return key ? [key] : [];
  }))];
  // Without a confirmed primary goal, give each selected goal its first relevant
  // dimension before considering their second dimensions. Do not invent a priority.
  const priorities = [0, 1].flatMap(index => goals.map(goal => goalPriorities[goal][index]));
  return [...new Set([...priorities, ...defaultPriority])];
}

function compactValue(value: CompactValue): CompactValue {
  const original = value.claim;
  const copy = Object.hasOwn(COMPACT_VALUE_COPY_V7, original.text) ? COMPACT_VALUE_COPY_V7[original.text] : undefined;
  const matchingSources = copy && copy.sourceFactIds.length === original.competitionFactIds.length &&
    copy.sourceFactIds.every((id, index) => id === original.competitionFactIds[index]);
  const output = structuredClone(value);
  if (copy && original.basis === "suggestion" && original.studentFactIds.length === 0 && matchingSources) output.claim.text = copy.text;
  return output;
}

/** Count displayed Unicode characters; whitespace is layout rather than copy. */
export function compactContentLengthV7(text: string): number {
  return Array.from(text.replace(/\s/gu, "")).length;
}

/** Never replace unknown, differently sourced, or archived task claims with new copy. */
export function compactTaskClaimV7(item: Pick<DecisionRecommendationV6, "itemId" | "coreTask">): DecisionClaimV6 {
  const original = item.coreTask;
  const copy = Object.hasOwn(COMPACT_TASK_COPY_V7, item.itemId) ? COMPACT_TASK_COPY_V7[item.itemId] : undefined;
  const matchingSources = copy && copy.sourceFactIds.length === original.competitionFactIds.length &&
    copy.sourceFactIds.every((id, index) => id === original.competitionFactIds[index]);
  return {
    ...structuredClone(original),
    text: copy && original.basis === "suggestion" && original.studentFactIds.length === 0 &&
      copy.sourceText === original.text && matchingSources ? copy.text : original.text,
  };
}

/** Source-bound presentation copy only; no runtime inference, catalog mutation, or model call. */
export function selectCompactValuesV7(
  item: Pick<DecisionRecommendationV6, "values">,
  profile?: CompactGoalProfile | null,
): DecisionRecommendationV6["values"] {
  const priority = valuePriority(profile);
  const dimensionRank = (value: CompactValue): number => {
    const dimension = legacyDimensions[value.dimension] ?? value.dimension;
    const index = priority.indexOf(dimension as ValueDimension);
    return index < 0 ? priority.length : index;
  };
  const sorted = item.values.map((value, index) => ({ value, index })).sort((left, right) =>
    Number(left.value.claim.basis === "unknown") - Number(right.value.claim.basis === "unknown") ||
    dimensionRank(left.value) - dimensionRank(right.value) || left.index - right.index);
  const seen = new Set<string>();
  const selected: CompactValue[] = [];
  for (const { value } of sorted) {
    const key = value.claim.text.replace(/\s/gu, "");
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push(compactValue(value));
    if (selected.length === 2) break;
  }
  // Fewer than two distinct source claims remains fewer than two; unknown is
  // retained verbatim if it is needed, never relabelled as a promised benefit.
  return selected;
}
