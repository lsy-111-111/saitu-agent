import { businessActivities } from "@/lib/competitions/business-activities";
import {
  availableResourceOptions,
  enrollmentStatusOptions,
  evidenceOptions,
  experienceLevelOptions,
  getOptionLabel,
  goalOptions,
  interestOptions,
  majorFieldOptions,
  participationModeOptions,
  participationTimingOptions,
  preferredOutputOptions,
  skillOptions,
  specificSubjectOptions,
  stageOptions,
  startingPointOptions,
  taskFormatOptions,
  teamSizeOptions,
  teamStatusOptions,
  teamUnitOptions,
  weeklyCommitmentOptions
} from "@/components/competitions/recommend/questionContent";
import type { ChoiceOption } from "@/components/competitions/recommend/ChoiceGroup";
import {
  isCompetitionAnswerTextValid,
  normalizeCompetitionAnswerText
} from "@/components/competitions/recommend/answerText";
import {
  COMPETITION_QUESTIONNAIRE_VERSION,
  type CompetitionFixedQuestionId,
  type CompetitionProfileFieldId,
  type CompetitionQuestionnaireV1,
  type CompetitionRecommendationProfileV5
} from "@/types/competition-recommendation";

export type CompleteCompetitionQuestionnaireProfile = Pick<
  CompetitionRecommendationProfileV5,
  CompetitionProfileFieldId
>;

export type DraftCompetitionProfile = Partial<
  CompleteCompetitionQuestionnaireProfile & Pick<
    CompetitionRecommendationProfileV5,
    "enrollmentStatus" | "teamSize" | "teamUnit"
  >
>;

export const questionTopics = [
  "学业背景",
  "能力与兴趣",
  "目标与投入",
  "现实条件",
  "经历与证据"
] as const;

export type FixedQuestionFieldId =
  | CompetitionProfileFieldId
  | "enrollmentStatus"
  | "teamSize"
  | "teamUnit";

export type FixedQuestionTextAnswers = Partial<Record<CompetitionFixedQuestionId, string>>;

const emptyFixedQuestionTextAnswers: FixedQuestionTextAnswers = {};

export type FixedQuestionField = {
  id: FixedQuestionFieldId;
  label: string;
  options: readonly ChoiceOption[];
  selection: "single" | "multiple";
  hint?: string;
  minSelections?: number;
  maxSelections?: number;
  exclusiveNone?: boolean;
  compact?: boolean;
};

export type FixedQuestionTurn = {
  id: CompetitionFixedQuestionId;
  topicIndex: number;
  prompt: string;
  fields: readonly FixedQuestionField[];
};

const fixedQuestionTurnDefinitions = [
  {
    id: "stage",
    topicIndex: 0,
    prompt: "你现在处于哪个学习阶段？",
    fields: [
      {
        id: "stage",
        label: "你现在或最近处于哪个学习阶段？",
        hint: "当前学段用于核对参赛资格，须选择或填写；全日制与毕业状态可以留空",
        options: stageOptions,
        selection: "single",
        minSelections: 1,
        maxSelections: 1,
        compact: true
      },
      {
        id: "enrollmentStatus",
        label: "你目前的全日制与毕业状态是？",
        options: enrollmentStatusOptions,
        selection: "single",
        minSelections: 1,
        maxSelections: 1,
        compact: true
      }
    ]
  },
  {
    id: "majorFields",
    topicIndex: 0,
    prompt: "你目前最接近哪些专业方向？",
    fields: [
      {
        id: "majorFields",
        label: "你目前最接近哪些专业方向？",
        options: majorFieldOptions,
        selection: "multiple",
        minSelections: 1,
        maxSelections: 3,
        hint: "可选择 1–3 项，交叉学科可以同时选择",
        compact: true
      },
      {
        id: "specificSubjects",
        label: "更具体地说，你的学科或技术方向是？",
        options: specificSubjectOptions,
        selection: "multiple",
        minSelections: 1,
        maxSelections: 3,
        hint: "选择最接近的 1–3 项；没有完全对应项时可以自己填写",
        compact: true
      }
    ]
  },
  {
    id: "skills",
    topicIndex: 1,
    prompt: "在课程、社团或项目里，你亲自做过哪些事？",
    fields: [
      {
        id: "skills",
        label: "在课程、社团或项目里，你亲自做过哪些事？",
        options: skillOptions,
        selection: "multiple",
        minSelections: 1,
        maxSelections: 3,
        hint: "选择最有把握的 1–3 项"
      }
    ]
  },
  {
    id: "interests",
    topicIndex: 1,
    prompt: "你更想探索哪些竞赛方向？",
    fields: [
      {
        id: "interests",
        label: "你更想探索哪些竞赛方向？",
        options: interestOptions,
        selection: "multiple",
        minSelections: 1,
        maxSelections: 3,
        hint: "选择最感兴趣的 1–3 项"
      }
    ]
  },
  {
    id: "goals",
    topicIndex: 2,
    prompt: "你最希望这次参赛帮你得到什么？",
    fields: [
      {
        id: "goals",
        label: "你最希望这次参赛帮你得到什么？",
        options: goalOptions,
        selection: "multiple",
        minSelections: 1,
        maxSelections: 2,
        hint: "先点首要目标，再选一个次要目标"
      }
    ]
  },
  {
    id: "preferredOutputs",
    topicIndex: 2,
    prompt: "你更希望最后做出哪类成果？",
    fields: [
      {
        id: "preferredOutputs",
        label: "你更希望最后做出哪类成果？",
        options: preferredOutputOptions,
        selection: "multiple",
        minSelections: 1,
        maxSelections: 2,
        hint: "选择最想沉淀的 1–2 种成果"
      }
    ]
  },
  {
    id: "taskFormats",
    topicIndex: 1,
    prompt: "你更愿意在竞赛中完成哪些核心任务？",
    fields: [
      {
        id: "taskFormats",
        label: "你更愿意在竞赛中完成哪些核心任务？",
        options: taskFormatOptions,
        selection: "multiple",
        minSelections: 1,
        maxSelections: 3,
        hint: "选择最愿意持续投入的 1–3 种任务"
      }
    ]
  },
  {
    id: "startingPoint",
    topicIndex: 2,
    prompt: "你目前最接近哪一种项目起点？",
    fields: [
      {
        id: "startingPoint",
        label: "你目前最接近哪一种项目起点？",
        options: startingPointOptions,
        selection: "single",
        minSelections: 1,
        maxSelections: 1,
        compact: true
      }
    ]
  },
  {
    id: "weeklyCommitment",
    topicIndex: 2,
    prompt: "接下来一段时间，每周大约能稳定投入多久？",
    fields: [
      {
        id: "weeklyCommitment",
        label: "接下来一段时间，每周大约能稳定投入多久？",
        options: weeklyCommitmentOptions,
        selection: "single",
        minSelections: 1,
        maxSelections: 1,
        compact: true
      }
    ]
  },
  {
    id: "teamStatus",
    topicIndex: 3,
    prompt: "你现在的组队情况是？",
    fields: [
      {
        id: "teamStatus",
        label: "你现在的组队情况是？",
        options: teamStatusOptions,
        selection: "single",
        minSelections: 1,
        maxSelections: 1,
        compact: true
      },
      {
        id: "teamSize",
        label: "如果按现在的情况，队伍有多少人？",
        options: teamSizeOptions,
        selection: "single",
        minSelections: 1,
        maxSelections: 1,
        compact: true
      },
      {
        id: "teamUnit",
        label: "队员是否来自同一学校或参赛单位？",
        options: teamUnitOptions,
        selection: "single",
        minSelections: 1,
        maxSelections: 1,
        compact: true
      }
    ]
  },
  {
    id: "availableResources",
    topicIndex: 3,
    prompt: "目前能稳定使用哪些备赛资源与报名支持？",
    fields: [
      {
        id: "availableResources",
        label: "目前能稳定使用哪些备赛资源与报名支持？",
        options: availableResourceOptions,
        selection: "multiple",
        minSelections: 1,
        maxSelections: 7,
        exclusiveNone: true,
        hint: "可选择所有实际具备的条件；“暂时没有”不能与其他项同时选择",
        compact: true
      }
    ]
  },
  {
    id: "participationMode",
    topicIndex: 3,
    prompt: "哪种参赛方式对你最可行？",
    fields: [
      {
        id: "participationMode",
        label: "哪种参赛方式对你最可行？",
        options: participationModeOptions,
        selection: "single",
        minSelections: 1,
        maxSelections: 1,
        compact: true
      }
    ]
  },
  {
    id: "participationTiming",
    topicIndex: 3,
    prompt: "你希望什么时候开始参加合适的竞赛？",
    fields: [
      {
        id: "participationTiming",
        label: "你希望什么时候开始参加合适的竞赛？",
        options: participationTimingOptions,
        selection: "single",
        minSelections: 1,
        maxSelections: 1,
        compact: true
      }
    ]
  },
  {
    id: "experienceLevel",
    topicIndex: 4,
    prompt: "回想一项课程作业或项目：你做出了什么？",
    fields: [
      {
        id: "experienceLevel",
        label: "你目前的竞赛经历最接近哪种情况？",
        options: experienceLevelOptions,
        selection: "single",
        minSelections: 1,
        maxSelections: 1,
        compact: true
      },
      {
        id: "evidence",
        label: "你现在有哪些可以继续打磨或展示的成果？",
        options: evidenceOptions,
        selection: "multiple",
        minSelections: 1,
        maxSelections: 3,
        exclusiveNone: true,
        hint: "选择 1–3 项；“暂时没有”不能与其他项同时选择"
      }
    ]
  }
] as const satisfies readonly FixedQuestionTurn[];

const fixedQuestionTurnOrder = [
  "stage",
  "majorFields",
  "skills",
  "interests",
  "taskFormats",
  "goals",
  "preferredOutputs",
  "startingPoint",
  "experienceLevel",
  "weeklyCommitment",
  "participationTiming",
  "teamStatus",
  "availableResources",
  "participationMode"
] as const satisfies readonly CompetitionFixedQuestionId[];

export const fixedQuestionTurns: readonly FixedQuestionTurn[] = fixedQuestionTurnOrder.map((id) => {
  const turn = (fixedQuestionTurnDefinitions as readonly FixedQuestionTurn[])
    .find((candidate) => candidate.id === id);
  if (!turn) throw new Error(`Missing fixed competition question: ${id}`);
  return turn;
});

export type SelectionDepth = "quick" | "deep";
export type DecisionContext = NonNullable<CompetitionQuestionnaireV1["decisionContext"]>;

export const experienceRoles = [
  { value: "observed", label: "看过示例或跟着学习" },
  { value: "assisted", label: "协助完成其中一部分" },
  { value: "independent", label: "独立完成具体任务" },
  { value: "led", label: "负责组织并完成关键任务" },
  { value: "unknown", label: "还不确定" }
] as const;
export const avoidableTasks = [...taskFormatOptions, { value: "laboratory", label: "实验室动手实验" } as const];

export function decisionAnswerSummary(turn: FixedQuestionTurn, profile: DraftCompetitionProfile, text: FixedQuestionTextAnswers, context: DecisionContext) {
  const summary = turnAnswerLabel(turn, profile, text);
  const details: string[] = [];
  if (turn.id === "goals" && profile.goals?.length) details.push(`首要目标：${getOptionLabel(goalOptions, profile.goals[0])}`);
  if (turn.id === "teamStatus" && context.fixedTeam) details.push("必须保持当前队伍及人数");
  if (turn.id === "experienceLevel" && context.experienceRole) details.push(`本人参与：${getOptionLabel(experienceRoles, context.experienceRole)}`);
  if (turn.id === "taskFormats" && context.businessActivity) details.push(`希望做的商科任务：${getOptionLabel(businessActivities, context.businessActivity)}`);
  if (turn.id === "taskFormats" && context.excludedTaskFormats?.length) {
    details.push("明确不做：" + context.excludedTaskFormats.map(v => getOptionLabel(avoidableTasks, v)).join("、"));
  }
  if (turn.id === "availableResources") {
    if (context.obtainableResources?.length) details.push("可争取：" + context.obtainableResources.map(v => getOptionLabel(availableResourceOptions, v)).join("、"));
    if (context.unavailableResources?.length) details.push("无法获得：" + context.unavailableResources.map(v => getOptionLabel(availableResourceOptions, v)).join("、"));
  }
  return [summary, ...details].filter(Boolean).join("；") || "暂不确定";
}

export function decisionQuestionTurns(depth: SelectionDepth, profile: DraftCompetitionProfile, text: FixedQuestionTextAnswers = {}) {
  const order: CompetitionFixedQuestionId[] = [
    "goals", "stage", "majorFields", "interests", "skills", "experienceLevel", "taskFormats", "weeklyCommitment", "availableResources"
  ];
  if (depth === "deep") {
    if (profile.goals?.length || text.goals) order.push("preferredOutputs");
    if (profile.evidence?.some(value => value !== "none") || profile.skills?.length || text.experienceLevel || text.skills) order.push("startingPoint");
    order.push("teamStatus", "participationMode");
  }
  return order.map(id => fixedQuestionTurns.find(turn => turn.id === id)!);
}

export function hasDecisionAnswer(turn: FixedQuestionTurn, profile: DraftCompetitionProfile, text: FixedQuestionTextAnswers) {
  const raw = normalizeCompetitionAnswerText(text[turn.id] ?? "");
  if (raw) return isCompetitionAnswerTextValid(raw);
  if (turn.id === "stage") return Boolean(profile.stage);
  return turn.fields.some(field => isStructuredFieldComplete(field, profile));
}

export function getFieldAnswer(
  field: FixedQuestionField,
  profile: DraftCompetitionProfile
): string | string[] | undefined {
  const answer = profile[field.id];
  return typeof answer === "string" || Array.isArray(answer) ? answer : undefined;
}

function isStructuredFieldComplete(field: FixedQuestionField, profile: DraftCompetitionProfile) {
  const answer = getFieldAnswer(field, profile);
  if (field.selection === "single") return typeof answer === "string" && answer.length > 0;
  if (!Array.isArray(answer)) return false;
  const minimum = field.minSelections ?? 1;
  return answer.length >= minimum && (field.maxSelections === undefined || answer.length <= field.maxSelections);
}

export function getFieldTextAnswer(
  field: FixedQuestionField,
  textAnswers: FixedQuestionTextAnswers = emptyFixedQuestionTextAnswers
) {
  return textAnswers[field.id as CompetitionFixedQuestionId] ?? "";
}

export function isFieldComplete(
  field: FixedQuestionField,
  profile: DraftCompetitionProfile,
  textAnswers: FixedQuestionTextAnswers = emptyFixedQuestionTextAnswers
) {
  const textAnswer = normalizeCompetitionAnswerText(getFieldTextAnswer(field, textAnswers));
  if (textAnswer && !isCompetitionAnswerTextValid(textAnswer)) return false;
  return isStructuredFieldComplete(field, profile) || Boolean(textAnswer);
}

export function isTurnComplete(
  turn: FixedQuestionTurn,
  profile: DraftCompetitionProfile,
  textAnswers: FixedQuestionTextAnswers = emptyFixedQuestionTextAnswers
) {
  const textAnswer = normalizeCompetitionAnswerText(textAnswers[turn.id] ?? "");
  if (textAnswer && !isCompetitionAnswerTextValid(textAnswer)) return false;
  return turn.fields.every((field) => isStructuredFieldComplete(field, profile) || Boolean(textAnswer));
}

/*
 * This client-safe draft deliberately contains no `confirmedFields` or profile
 * version. Only the signed normalization flow may promote it to Profile V5.
 */
export function toCompetitionQuestionnaireDraft(
  profile: DraftCompetitionProfile,
  textAnswers: FixedQuestionTextAnswers = emptyFixedQuestionTextAnswers,
  decision?: { turns: readonly FixedQuestionTurn[]; context: DecisionContext }
): CompetitionQuestionnaireV1 | null {
  const turns = decision
    ? decision.turns.filter(turn => hasDecisionAnswer(turn, profile, textAnswers))
    : fixedQuestionTurns;
  if (decision ? !turns.some(turn => turn.id === "stage") : !turns.every(turn => isTurnComplete(turn, profile, textAnswers))) return null;

  return {
    version: COMPETITION_QUESTIONNAIRE_VERSION,
    ...(decision ? { decisionContext: { ...decision.context, primaryGoal: profile.goals?.[0] } } : {}),
    answers: turns.map((turn) => {
      const selectedValues = turn.fields.flatMap((field) => {
        const answer = getFieldAnswer(field, profile);
        const values = Array.isArray(answer) ? answer : answer ? [answer] : [];
        return values.map((value) => `${field.id}:${value}`);
      });
      const freeText = normalizeCompetitionAnswerText(textAnswers[turn.id] ?? "");
      return {
        fieldId: turn.id,
        selectedValues,
        ...(freeText ? { freeText } : {})
      };
    })
  };
}

export function normalizeMultipleAnswer(
  field: FixedQuestionField,
  answer: string[],
  previous: string[] | undefined
) {
  const unique = Array.from(new Set(answer));
  if (field.exclusiveNone && unique.includes("none")) {
    return previous?.includes("none") ? unique.filter((item) => item !== "none") : ["none"];
  }
  const withoutNone = field.exclusiveNone ? unique.filter((item) => item !== "none") : unique;
  return field.maxSelections === undefined ? withoutNone : withoutNone.slice(0, field.maxSelections);
}

export function applyFieldAnswer(
  profile: DraftCompetitionProfile,
  field: FixedQuestionField,
  answer: string | string[]
): DraftCompetitionProfile {
  return { ...profile, [field.id]: answer } as DraftCompetitionProfile;
}

export function fieldAnswerLabel(
  field: FixedQuestionField,
  profile: DraftCompetitionProfile,
  textAnswers: FixedQuestionTextAnswers = emptyFixedQuestionTextAnswers
) {
  const answer = getFieldAnswer(field, profile);
  const values = Array.isArray(answer) ? answer : answer ? [answer] : [];
  const optionLabel = values.map((value) => getOptionLabel(field.options, value)).join("、");
  const textAnswer = normalizeCompetitionAnswerText(getFieldTextAnswer(field, textAnswers));
  if (optionLabel && textAnswer) return `${optionLabel}；补充：${textAnswer}`;
  if (textAnswer) return `自填：${textAnswer}`;
  return optionLabel;
}

export function turnAnswerLabel(
  turn: FixedQuestionTurn,
  profile: DraftCompetitionProfile,
  textAnswers: FixedQuestionTextAnswers = emptyFixedQuestionTextAnswers
) {
  const textAnswer = normalizeCompetitionAnswerText(textAnswers[turn.id] ?? "");
  if (turn.fields.length === 1) {
    return fieldAnswerLabel(turn.fields[0], profile, textAnswers);
  }
  const structured = turn.fields
    .map((field) => {
      const answer = getFieldAnswer(field, profile);
      const values = Array.isArray(answer) ? answer : answer ? [answer] : [];
      const label = values.map((value) => getOptionLabel(field.options, value)).join("、");
      return label ? `${field.label.replace(/[？?]$/, "")}：${label}` : "";
    })
    .filter(Boolean)
    .join("；");
  if (structured && textAnswer) return `${structured}；补充：${textAnswer}`;
  if (textAnswer) return `自填：${textAnswer}`;
  return structured;
}

export function isTopicComplete(
  topicIndex: number,
  profile: DraftCompetitionProfile,
  textAnswers: FixedQuestionTextAnswers = emptyFixedQuestionTextAnswers
) {
  const turns = fixedQuestionTurns.filter((turn) => turn.topicIndex === topicIndex);
  return turns.length > 0 && turns.every((turn) => isTurnComplete(turn, profile, textAnswers));
}

export function toCompleteProfile(
  profile: DraftCompetitionProfile
): CompleteCompetitionQuestionnaireProfile | null {
  if (!fixedQuestionTurns.every((turn) => turn.fields.every((field) => isStructuredFieldComplete(field, profile)))) {
    return null;
  }

  return {
    stage: profile.stage as CompleteCompetitionQuestionnaireProfile["stage"],
    majorFields: (profile.majorFields as CompleteCompetitionQuestionnaireProfile["majorFields"]).slice(0, 3),
    specificSubjects: (
      profile.specificSubjects as CompleteCompetitionQuestionnaireProfile["specificSubjects"]
    ).slice(0, 3),
    skills: (profile.skills as CompleteCompetitionQuestionnaireProfile["skills"]).slice(0, 3),
    interests: (profile.interests as CompleteCompetitionQuestionnaireProfile["interests"]).slice(0, 3),
    goals: (profile.goals as CompleteCompetitionQuestionnaireProfile["goals"]).slice(0, 2),
    preferredOutputs: (profile.preferredOutputs as CompleteCompetitionQuestionnaireProfile["preferredOutputs"]).slice(0, 2),
    startingPoint: profile.startingPoint as CompleteCompetitionQuestionnaireProfile["startingPoint"],
    weeklyCommitment: profile.weeklyCommitment as CompleteCompetitionQuestionnaireProfile["weeklyCommitment"],
    teamStatus: profile.teamStatus as CompleteCompetitionQuestionnaireProfile["teamStatus"],
    availableResources: [...new Set(
      profile.availableResources as CompleteCompetitionQuestionnaireProfile["availableResources"]
    )],
    participationMode: profile.participationMode as CompleteCompetitionQuestionnaireProfile["participationMode"],
    participationTiming: profile.participationTiming as CompleteCompetitionQuestionnaireProfile["participationTiming"],
    taskFormats: (profile.taskFormats as CompleteCompetitionQuestionnaireProfile["taskFormats"]).slice(0, 3),
    experienceLevel: profile.experienceLevel as CompleteCompetitionQuestionnaireProfile["experienceLevel"],
    evidence: (profile.evidence as CompleteCompetitionQuestionnaireProfile["evidence"]).slice(0, 3)
  };
}

export function profileSummary(
  profile: DraftCompetitionProfile,
  textAnswers: FixedQuestionTextAnswers = emptyFixedQuestionTextAnswers
) {
  return fixedQuestionTurns.map((turn, turnIndex) => ({
    title: turn.prompt,
    value: turnAnswerLabel(turn, profile, textAnswers),
    turnIndex
  }));
}
