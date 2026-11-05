export const competitionClarificationQuestionIds = [
  "major_direction",
  "preferred_output",
  "starting_point",
  "weekly_commitment",
  "team_status",
  "available_resources",
  "current_region",
  "participation_mode"
] as const;

export type CompetitionClarificationQuestionId = (typeof competitionClarificationQuestionIds)[number];

export type CompetitionClarificationQuestionOption = {
  value: string;
  label: string;
};

export type CompetitionClarificationQuestionV2 = {
  questionId: CompetitionClarificationQuestionId;
  prompt: string;
  selection: "single" | "multiple";
  options: CompetitionClarificationQuestionOption[];
  maxSelections?: number;
  allowsNote: true;
  maxNoteLength: 120;
};

export const competitionClarificationQuestions: readonly CompetitionClarificationQuestionV2[] = [
  {
    questionId: "major_direction",
    prompt: "为了判断参赛门槛，你目前最接近哪些专业方向？",
    selection: "multiple",
    maxSelections: 2,
    allowsNote: true,
    maxNoteLength: 120,
    options: [
      { value: "computer-science", label: "计算机与信息" },
      { value: "business", label: "经管与商科" },
      { value: "design", label: "设计与艺术" },
      { value: "engineering", label: "工程与制造" },
      { value: "medicine", label: "医学与生命科学" },
      { value: "mathematics", label: "数学与理科" },
      { value: "humanities", label: "人文与社会科学" },
      { value: "other", label: "其他或交叉学科" }
    ]
  },
  {
    questionId: "preferred_output",
    prompt: "如果参赛，你更希望最后做出哪类成果？",
    selection: "multiple",
    maxSelections: 2,
    allowsNote: true,
    maxNoteLength: 120,
    options: [
      { value: "software", label: "软件或 AI 应用" },
      { value: "prototype", label: "实物原型" },
      { value: "research-paper", label: "研究报告或论文" },
      { value: "business-plan", label: "商业计划书" },
      { value: "creative-work", label: "设计或媒体作品" },
      { value: "presentation", label: "路演或演讲" },
      { value: "career-plan", label: "职业发展方案" }
    ]
  },
  {
    questionId: "starting_point",
    prompt: "你目前最接近哪一种项目起点？",
    selection: "single",
    allowsNote: true,
    maxNoteLength: 120,
    options: [
      { value: "idea_only", label: "只有方向或创意" },
      { value: "coursework", label: "有课程作业或调研" },
      { value: "prototype", label: "已有原型、作品或代码" },
      { value: "validated", label: "已有实验数据、用户或落地验证" }
    ]
  },
  {
    questionId: "weekly_commitment",
    prompt: "接下来一段时间，你每周大约能稳定投入多少时间？",
    selection: "single",
    allowsNote: true,
    maxNoteLength: 120,
    options: [
      { value: "under-5", label: "每周 5 小时以内" },
      { value: "5-10", label: "每周 5–10 小时" },
      { value: "over-10", label: "每周 10 小时以上" }
    ]
  },
  {
    questionId: "team_status",
    prompt: "你现在的组队情况是？",
    selection: "single",
    allowsNote: true,
    maxNoteLength: 120,
    options: [
      { value: "solo", label: "想一个人参加" },
      { value: "looking", label: "还没有队友，可以组队" },
      { value: "partial", label: "已有部分队友" },
      { value: "ready", label: "已有完整队伍" }
    ]
  },
  {
    questionId: "available_resources",
    prompt: "目前你能稳定使用哪些备赛资源？",
    selection: "multiple",
    maxSelections: 2,
    allowsNote: true,
    maxNoteLength: 120,
    options: [
      { value: "mentor", label: "指导老师" },
      { value: "lab", label: "实验室或创客空间" },
      { value: "equipment", label: "硬件或设备" },
      { value: "data", label: "数据或行业资源" },
      { value: "budget", label: "一定项目预算" },
      { value: "none", label: "暂时没有" }
    ]
  },
  {
    questionId: "current_region",
    prompt: "你目前主要在哪个大区学习或生活？",
    selection: "single",
    allowsNote: true,
    maxNoteLength: 120,
    options: [
      { value: "north", label: "华北" },
      { value: "east", label: "华东" },
      { value: "central", label: "华中" },
      { value: "south", label: "华南" },
      { value: "southwest", label: "西南" },
      { value: "northwest", label: "西北" },
      { value: "northeast", label: "东北" },
      { value: "other", label: "港澳台或其他地区" }
    ]
  },
  {
    questionId: "participation_mode",
    prompt: "哪些参赛方式对你来说可行？",
    selection: "multiple",
    maxSelections: 2,
    allowsNote: true,
    maxNoteLength: 120,
    options: [
      { value: "remote", label: "线上为主" },
      { value: "offline-local", label: "本地线下" },
      { value: "travel", label: "可以跨地区参赛" },
      { value: "flexible", label: "形式都可以" }
    ]
  }
];

const questionById = new Map(competitionClarificationQuestions.map((question) => [question.questionId, question]));

export function getCompetitionClarificationQuestions(ids: readonly CompetitionClarificationQuestionId[]) {
  return ids
    .map((id) => questionById.get(id))
    .filter((question): question is CompetitionClarificationQuestionV2 => Boolean(question));
}

export function isValidCompetitionClarificationAnswer(
  questionId: string,
  answer: { selectedValues: readonly string[]; note?: string }
) {
  const question = questionById.get(questionId as CompetitionClarificationQuestionId);
  if (!question) return false;

  const values = answer.selectedValues;
  const note = answer.note?.trim();
  if (question.selection === "single" && values.length > 1) return false;
  if (question.maxSelections !== undefined && values.length > question.maxSelections) return false;
  if (new Set(values).size !== values.length) return false;
  if (questionId === "available_resources" && values.length > 1 && values.includes("none")) return false;

  const allowedValues = new Set(question.options.map((option) => option.value));
  return (
    (values.length > 0 || Boolean(note)) &&
    (!note || note.length <= question.maxNoteLength) &&
    values.every((value) => allowedValues.has(value))
  );
}
