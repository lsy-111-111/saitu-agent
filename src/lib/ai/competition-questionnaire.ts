import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  DEFAULT_DEEPSEEK_MODEL,
  getCompetitionAiProviderFailureReason,
  getConfiguredAiModel,
  getConfiguredAiProvider,
  requestAiJson,
  type AiJsonFailureReason
} from "@/lib/ai/ai-client";
import { containsCompetitionNotePersonalInfo } from "@/lib/ai/competition-note";
import { buildPrompt } from "@/lib/ai/prompt-builder";
import { competitionDecisionContextSchema, competitionRecommendationProfileV5Schema } from "@/lib/ai/competition-request-schema";
import {
  COMPETITION_ELIGIBILITY_FACT_IDS,
  COMPETITION_ENROLLMENT_STATUSES,
  COMPETITION_EVIDENCE,
  COMPETITION_EXPERIENCE_LEVELS,
  COMPETITION_FIXED_QUESTION_IDS,
  COMPETITION_GOALS,
  COMPETITION_INTERESTS,
  COMPETITION_MAJOR_FIELDS,
  COMPETITION_OUTPUTS,
  COMPETITION_PARTICIPATION_PREFERENCES,
  COMPETITION_PARTICIPATION_TIMINGS,
  COMPETITION_PROFILE_FIELD_IDS,
  COMPETITION_PROFILE_V5_VERSION,
  COMPETITION_QUESTIONNAIRE_FIELD_IDS,
  COMPETITION_QUESTIONNAIRE_VERSION,
  COMPETITION_RESOURCES,
  COMPETITION_SKILLS,
  COMPETITION_SPECIFIC_SUBJECTS,
  COMPETITION_STAGES,
  COMPETITION_STARTING_POINTS,
  COMPETITION_TASK_FORMATS,
  COMPETITION_TEAM_SIZES,
  COMPETITION_TEAM_STATUSES,
  COMPETITION_TEAM_UNITS,
  COMPETITION_WEEKLY_HOURS,
  type CompetitionEligibilityFactId,
  type CompetitionFixedQuestionId,
  type CompetitionQuestionnaireV1 as CompetitionQuestionnaireTransportV1,
  type CompetitionQuestionnaireFieldId,
  type CompetitionRecommendationProfileV5
} from "@/types/competition-recommendation";

const CURRENT_COMPETITION_TEAM_SIZES = COMPETITION_TEAM_SIZES.filter(
  (value) => value !== "four-five"
);

export const COMPETITION_QUESTIONNAIRE_TOKEN_VERSION = "competition-questionnaire-token.v2" as const;
const LEGACY_COMPETITION_QUESTIONNAIRE_TOKEN_VERSION = "competition-questionnaire-token.v1" as const;
export const COMPETITION_NORMALIZE_PROMPT_VERSION = "competition-normalize.v1" as const;
export const COMPETITION_QUESTIONNAIRE_TOKEN_TTL_SECONDS = 30 * 60;
export const COMPETITION_QUESTIONNAIRE_TOKEN_MAX_LENGTH = 48 * 1024;
export const COMPETITION_QUESTIONNAIRE_TEXT_MAX_LENGTH = 120;

type Option = { value: string; label: string; aliases?: readonly string[] };
type FieldSpec = {
  selection: "single" | "multiple";
  minSelections: number;
  maxSelections: number;
  exclusiveNone?: boolean;
  options: readonly Option[];
  kind?: "enum" | "year";
};

const option = (value: string, label: string, aliases: readonly string[] = []): Option => ({ value, label, aliases });
const enumerated = (values: readonly string[], labels: readonly string[][]): readonly Option[] =>
  values.map((value, index) => option(value, labels[index]?.[0] ?? value, labels[index]?.slice(1) ?? []));

export const COMPETITION_QUESTIONNAIRE_FIELD_SPECS: Readonly<Record<CompetitionQuestionnaireFieldId, FieldSpec>> = {
  stage: {
    selection: "single", minSelections: 1, maxSelections: 1,
    options: enumerated(COMPETITION_STAGES, [
      ["高职／专科", "高职", "专科", "Vocational高职"], ["本科大一", "大一"], ["本科大二", "大二", "Undergrad大二"],
      ["本科大三", "大三"], ["本科大四", "大四"], ["硕士研究生", "硕士", "Master硕士"],
      ["博士研究生", "博士", "PhD博士"], ["其他或非全日制", "非全日制", "其他"]
    ])
  },
  majorFields: {
    selection: "multiple", minSelections: 1, maxSelections: 3,
    options: enumerated(COMPETITION_MAJOR_FIELDS, [
      ["计算机与信息", "计算机", "计算机与信息科技", "CS计算机"], ["经管与商科", "商科", "经管", "Business商科"], ["设计与艺术", "设计", "Design设计"],
      ["工程与制造", "工程", "Engineering工程"], ["临床医学与健康", "临床医学", "医学", "医药", "Medical医学"], ["数学与理科", "数学", "Math数学"],
      ["人文与社会科学", "人文", "社科"],
      ["生物与生命科学", "生物", "生命科学", "生物工程", "Bio生命科学"],
      ["化学、化工与材料", "化学", "化工", "材料科学", "Chem化学材料"],
      ["农林、水利与环境", "农学", "农业", "林学", "水利", "环境科学", "Agri农业环境"],
      ["土木、建筑与测绘", "土木", "建筑", "城乡规划", "测绘", "Architecture建筑测绘"],
      ["财会、金融与税务", "财会", "会计", "金融", "税务", "财政", "Finance财税"],
      ["公共管理与政策", "公共管理", "公管", "行政管理", "公共政策", "Public Management公管"],
      ["语言、文化与传播", "语言文化", "外语", "中文", "新闻传播", "Language文化传播"],
      ["物理、光电与地学", "物理", "光电", "地质", "地理科学", "Physics光电"],
      ["其他或交叉学科", "交叉学科", "其他"]
    ])
  },
  specificSubjects: {
    selection: "multiple", minSelections: 1, maxSelections: 3,
    options: enumerated(COMPETITION_SPECIFIC_SUBJECTS, [
      ["医学技术、基础医学与健康", "医学技术", "基础医学"],
      ["土木结构与建筑设计", "结构设计", "土木结构"],
      ["视觉传达、广告与数字艺术", "视觉传达", "广告设计", "数字艺术"],
      ["工程实践与智能制造", "工程实践", "智能制造"],
      ["化学、化工与材料实验", "化学实验", "化工实验", "材料实验"],
      ["地质、测绘与地球科学", "地质", "测绘", "地球科学"],
      ["物理、光电与实验科学", "物理实验", "光电"],
      ["力学、机械与材料工程", "力学", "机械工程", "金相"],
      ["信息通信、芯片与计算机系统", "信息通信", "集成电路", "芯片设计", "计算机系统"],
      ["生物与生命科学", "生命科学", "生物学"],
      ["机器人、自动化与智能控制", "机器人", "自动化", "智能控制"],
      ["水利、生态与环境工程", "水利", "生态环境", "环境工程"],
      ["网络安全与系统攻防", "网络安全", "信息安全", "系统攻防"],
      ["数学、统计与建模", "数学建模", "统计建模"],
      ["财税、金融与会计", "财税", "金融", "会计"],
      ["BIM、数字建造与园林", "BIM", "数字建造", "园林"],
      ["农业工程与智能农机", "农业工程", "智能农机"],
      ["外语、中华文化与跨文化传播", "外语", "中华文化", "跨文化"],
      ["公共管理、政策与社会治理", "公共管理", "政策分析", "社会治理"],
      ["职业技能与生产实务", "职业技能", "生产实务"],
      ["合成生物与生物工程", "合成生物", "生物工程"],
      ["文旅策划与旅游管理", "文旅策划", "旅游管理"]
    ])
  },
  skills: {
    selection: "multiple", minSelections: 1, maxSelections: 3,
    options: enumerated(COMPETITION_SKILLS, [
      ["编程与软件开发", "编程", "软件开发", "Coding编程"], ["数据分析与建模", "数据分析", "建模", "数据分析建摸", "Data Analysis数据分析"],
      ["调研与科研验证", "调研", "科研", "Research科研"], ["产品策划与需求分析", "产品策划", "产品", "Product产品策划"],
      ["视觉与创意设计", "视觉设计", "创意设计", "Visual Design视觉设计"], ["硬件与工程实践", "硬件", "Hardware硬件"],
      ["写作与材料整理", "写作", "Writing写作"], ["演讲、路演与答辩", "演讲", "路演", "答辩", "Presentation路演"],
      ["实验操作与安全规范", "实验操作", "实验技能", "实验室技能", "Lab Safety实验规范"],
      ["结构设计与工程制图", "结构设计", "工程制图", "BIM", "BIM工程制图"],
      ["财会与金融分析", "财务分析", "会计实务", "金融分析", "Finance Analysis财务分析"],
      ["政策分析与案例研判", "政策分析", "案例分析", "公管案例", "Policy Analysis政策分析"],
      ["语言表达与跨文化沟通", "外语表达", "跨文化沟通", "翻译", "Cross-cultural Communication跨文化"],
      ["野外调查、测绘与田野实践", "野外调查", "测绘", "田野调查", "实地调研", "Fieldwork田野调查"]
    ])
  },
  interests: {
    selection: "multiple", minSelections: 1, maxSelections: 3,
    options: enumerated(COMPETITION_INTERESTS, [
      ["创新创业"], ["人工智能", "AI", "人工智能和A1", "AI人工智能"], ["数据建模"], ["科研学术", "科研"],
      ["语言传播"], ["科技工程"], ["机器人与智能制造", "机器人", "Robotics机器人"],
      ["工业与产品设计", "产品设计"], ["数字媒体"], ["职业规划", "Career职业规划"], ["商业与创业实践", "创业"],
      ["医学与健康", "临床医学", "健康科学"],
      ["生物与生命科学", "生命科学", "生物创新"],
      ["化学化工与材料", "化学化工", "材料研究"],
      ["农林水利与环境", "智慧农业", "生态环境", "水利环境", "Sustainability环境"],
      ["土木建筑与数字建造", "土木建筑", "数字建造"],
      ["语言文化与经典传播", "语言文化", "经典传播", "中华文化"],
      ["财税金融与企业经营", "财税金融", "税收风险", "企业经营"],
      ["公共管理与社会治理", "公共管理", "社会治理", "公管案例"],
      ["物理光电与地球科学", "物理光电", "地球科学", "地质测绘"]
    ])
  },
  goals: {
    selection: "multiple", minSelections: 1, maxSelections: 2,
    options: enumerated(COMPETITION_GOALS, [
      ["积累项目经历", "项目经历"], ["争取竞赛奖项", "获奖", "奖项"],
      ["为保研、复试做准备", "保研", "复试"], ["提升实习求职竞争力", "求职", "实习", "提高求职竞争力"],
      ["把想法做成作品", "作品集"], ["验证创业想法", "创业"], ["认识队友与指导老师", "拓展人脉"]
    ])
  },
  preferredOutputs: {
    selection: "multiple", minSelections: 1, maxSelections: 2,
    options: enumerated(COMPETITION_OUTPUTS, [
      ["软件或 AI 应用", "软件", "AI应用"], ["实物原型", "原型"], ["研究报告或论文", "论文", "研究报告"],
      ["商业计划书", "商业计划书儿"], ["设计或媒体作品", "设计作品", "媒体作品"], ["路演或演讲", "路演"], ["职业发展方案"]
    ])
  },
  startingPoint: {
    selection: "single", minSelections: 1, maxSelections: 1,
    options: enumerated(COMPETITION_STARTING_POINTS, [
      ["只有方向或创意", "只有想法", "只有一点点创意"], ["有课程作业或调研", "课程作业"],
      ["已有原型、作品或代码", "已有原型"], ["已有实验数据、用户或落地验证", "已有验证"]
    ])
  },
  weeklyCommitment: {
    selection: "single", minSelections: 1, maxSelections: 1,
    options: enumerated(COMPETITION_WEEKLY_HOURS, [
      ["每周 5 小时以内", "5小时以内"], ["每周 5–10 小时", "5-10小时"], ["每周 10 小时以上", "10小时以上"]
    ])
  },
  teamStatus: {
    selection: "single", minSelections: 1, maxSelections: 1,
    options: enumerated(COMPETITION_TEAM_STATUSES, [
      ["想一个人参加", "单人"], ["还没有队友，可以组队", "正在找队友", "正在寻找队友"], ["已有部分队友"], ["已有完整队伍"]
    ])
  },
  availableResources: {
    selection: "multiple", minSelections: 1, maxSelections: 7, exclusiveNone: true,
    options: enumerated(COMPETITION_RESOURCES, [
      ["指导老师", "导师"], ["实验室或创客空间", "实验室", "有实验室和创客间"], ["硬件或设备", "设备"],
      ["数据或行业资源", "数据"], ["一定项目预算", "预算"],
      ["学校报名或盖章支持", "学校报名", "学校盖章", "院校推荐"],
      ["安全、伦理或合规支持", "安全合规", "伦理审查", "生物安全"], ["暂时没有", "没有"]
    ])
  },
  participationMode: {
    selection: "single", minSelections: 1, maxSelections: 1,
    options: enumerated(COMPETITION_PARTICIPATION_PREFERENCES, [
      ["线上为主", "线上"], ["本地线下", "线下"], ["可以跨地区参赛", "可以出行", "可以跨城参加"], ["形式都可以", "都可以"]
    ])
  },
  participationTiming: {
    selection: "single", minSelections: 1, maxSelections: 1,
    options: enumerated(COMPETITION_PARTICIPATION_TIMINGS, [
      ["只看当前届仍可报名的竞赛", "当前届"], ["希望三个月内能开始", "三个月内"],
      ["本届已截止也可为下一届准备", "下一届也可以", "下一届也可"], ["时间都可以", "时间灵活"]
    ])
  },
  taskFormats: {
    selection: "multiple", minSelections: 1, maxSelections: 3,
    options: enumerated(COMPETITION_TASK_FORMATS, [
      ["算法与编程", "算法", "Algorithm算法"], ["数学与数据建模", "建模", "数学建模题", "Modeling建模"], ["软件与系统开发", "软件开发", "Software软件开发"],
      ["硬件与工程制作", "硬件"], ["科研与论文", "科研"], ["产品设计与验证", "产品"],
      ["创业与商业计划", "创业"], ["视觉与创意设计", "设计"], ["语言表达与传播", "语言"], ["职业规划与案例", "职业规划", "Career Planning职业规划"]
    ])
  },
  experienceLevel: {
    selection: "single", minSelections: 1, maxSelections: 1,
    options: enumerated(COMPETITION_EXPERIENCE_LEVELS, [
      ["还没有参赛经历", "没有参赛经历"], ["参加过，但还没有完整项目或奖项", "参加过", "参加过但还未获奖"], ["有完整项目或获奖经历", "有获奖经历"]
    ])
  },
  evidence: {
    selection: "multiple", minSelections: 1, maxSelections: 3, exclusiveNone: true,
    options: enumerated(COMPETITION_EVIDENCE, [
      ["完整项目经历", "项目"], ["论文或研究报告", "论文"], ["可演示原型或代码", "原型", "代码", "有可演示原型和代码"],
      ["作品集或设计作品", "作品集"], ["竞赛奖项", "奖项"], ["暂时没有可展示的材料", "没有"]
    ])
  },
  enrollmentStatus: {
    selection: "single", minSelections: 1, maxSelections: 1,
    options: enumerated(COMPETITION_ENROLLMENT_STATUSES, [
      ["全日制在读", "全日制学生"], ["非全日制在读", "非全日制学生"], ["毕业五年内", "应届或毕业不久", "刚毕业不到五年"],
      ["已毕业超过五年", "已毕业"], ["其他", "不确定"]
    ])
  },
  firstHigherEducationYear: {
    kind: "year", selection: "single", minSelections: 1, maxSelections: 1, options: []
  },
  teamUnit: {
    selection: "single", minSelections: 1, maxSelections: 1,
    options: enumerated(COMPETITION_TEAM_UNITS, [
      ["队员来自同一参赛单位", "同一单位"], ["队员来自不同参赛单位", "跨单位"], ["还不确定", "不确定"]
    ])
  },
  teamSize: {
    selection: "single", minSelections: 1, maxSelections: 1,
    options: enumerated(CURRENT_COMPETITION_TEAM_SIZES, [
      ["一人", "单人"], ["两人"], ["三人"], ["四人", "正好四人"], ["五人", "正好五人"],
      ["六人或更多"], ["还不确定", "不确定"]
    ])
  }
};

function unique(values: readonly string[]) {
  return new Set(values).size === values.length;
}

function normalizedAlias(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase("zh-CN").replace(/[\s·]/g, "").replace(/[—–－]/g, "-");
}

function validateValues(fieldId: CompetitionQuestionnaireFieldId, values: readonly string[]) {
  const spec = COMPETITION_QUESTIONNAIRE_FIELD_SPECS[fieldId];
  if (!unique(values) || values.length < spec.minSelections || values.length > spec.maxSelections) return false;
  if (spec.exclusiveNone && values.length > 1 && values.includes("none")) return false;
  if (spec.kind === "year") return values.length === 1 && /^(?:19[7-9]\d|20(?:[0-2]\d|3[0-5]))$/.test(values[0]);
  const allowed = new Set(spec.options.map(({ value }) => value));
  return values.every((value) => allowed.has(value));
}

export const competitionNormalizedQuestionnaireAnswerSchema = z
  .object({
    fieldId: z.enum(COMPETITION_QUESTIONNAIRE_FIELD_IDS),
    // The structural ceiling covers the widest field. Field-specific limits are
    // enforced below so a seven-resource answer does not loosen other fields.
    selectedValues: z.array(z.string().trim().min(1).max(48)).max(7).refine(unique),
    freeText: z.string().trim().min(1).max(COMPETITION_QUESTIONNAIRE_TEXT_MAX_LENGTH)
      .refine((value) => !containsCompetitionNotePersonalInfo(value), "Personal information is not accepted").optional()
  })
  .strict()
  .superRefine((answer, context) => {
    if (answer.selectedValues.length === 0 && !answer.freeText) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Choose an option or provide text" });
    }
    if (answer.selectedValues.length > 0 && !validateValues(answer.fieldId, answer.selectedValues)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Values are outside the field whitelist", path: ["selectedValues"] });
    }
  });

export type CompetitionNormalizedQuestionnaireAnswerV1 = z.infer<
  typeof competitionNormalizedQuestionnaireAnswerSchema
>;

type NormalizedCompetitionQuestionnaireV1 = {
  version: typeof COMPETITION_QUESTIONNAIRE_VERSION;
  answers: CompetitionNormalizedQuestionnaireAnswerV1[];
};

const QUESTION_FIELDS = {
  stage: ["stage", "enrollmentStatus"],
  majorFields: ["majorFields", "specificSubjects"],
  skills: ["skills"],
  interests: ["interests"],
  taskFormats: ["taskFormats"],
  goals: ["goals"],
  preferredOutputs: ["preferredOutputs"],
  startingPoint: ["startingPoint"],
  experienceLevel: ["experienceLevel", "evidence"],
  weeklyCommitment: ["weeklyCommitment"],
  participationTiming: ["participationTiming"],
  teamStatus: ["teamStatus", "teamSize", "teamUnit"],
  availableResources: ["availableResources"],
  participationMode: ["participationMode"]
} as const satisfies Readonly<Record<CompetitionFixedQuestionId, readonly CompetitionQuestionnaireFieldId[]>>;

const OPTIONAL_QUESTION_FIELDS: Partial<
  Record<CompetitionFixedQuestionId, readonly CompetitionQuestionnaireFieldId[]>
> = {
  stage: ["firstHigherEducationYear"]
};

function decodeQuestionValue(value: string) {
  const separator = value.indexOf(":");
  if (separator <= 0 || separator >= value.length - 1) return null;
  return { fieldId: value.slice(0, separator), value: value.slice(separator + 1) };
}

function selectedValuesForField(
  answer: { selectedValues: readonly string[] },
  fieldId: CompetitionQuestionnaireFieldId
) {
  return answer.selectedValues
    .map(decodeQuestionValue)
    .filter((entry): entry is { fieldId: string; value: string } => Boolean(entry))
    .filter((entry) => entry.fieldId === fieldId)
    .map((entry) => entry.value);
}

export const competitionQuestionnaireAnswerSchema = z.object({
  fieldId: z.enum(COMPETITION_FIXED_QUESTION_IDS),
  selectedValues: z.array(z.string().trim().min(3).max(96)).max(7).refine(unique),
  freeText: z.string().trim().min(1).max(COMPETITION_QUESTIONNAIRE_TEXT_MAX_LENGTH)
    .refine((value) => !containsCompetitionNotePersonalInfo(value), "Personal information is not accepted").optional()
}).strict().superRefine((answer, context) => {
  const requiredFields = QUESTION_FIELDS[answer.fieldId];
  const optionalFields = OPTIONAL_QUESTION_FIELDS[answer.fieldId] ?? [];
  const allowedFields = new Set<string>([...requiredFields, ...optionalFields]);
  const decoded = answer.selectedValues.map(decodeQuestionValue);
  if (decoded.some((entry) => !entry || !allowedFields.has(entry.fieldId))) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Values are outside the question whitelist", path: ["selectedValues"] });
    return;
  }
  for (const fieldId of [...requiredFields, ...optionalFields]) {
    const values = selectedValuesForField(answer, fieldId);
    if (values.length > 0 && !validateValues(fieldId, values)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: `Invalid values for ${fieldId}`, path: ["selectedValues"] });
    }
  }
  if (!answer.freeText && !answer.selectedValues.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Choose an option or provide text", path: ["selectedValues"] });
  }
});

export const competitionQuestionnaireV1Schema = z
  .object({
    version: z.literal(COMPETITION_QUESTIONNAIRE_VERSION),
    decisionContext: competitionDecisionContextSchema.optional(),
    answers: z.array(competitionQuestionnaireAnswerSchema).min(1).max(COMPETITION_FIXED_QUESTION_IDS.length)
  })
  .strict()
  .superRefine((questionnaire, context) => {
    const ids = questionnaire.answers.map(({ fieldId }) => fieldId);
    if (!unique(ids)) context.addIssue({ code: z.ZodIssueCode.custom, message: "Questionnaire fields must be unique", path: ["answers"] });
    for (const fieldId of ["stage"] as const) {
      if (!ids.includes(fieldId)) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: `Missing required question: ${fieldId}`, path: ["answers"] });
      }
    }
  });

export type CompetitionQuestionnaireV1 = z.infer<typeof competitionQuestionnaireV1Schema>;
export type CompetitionQuestionnaireInterpretation = {
  fieldId: CompetitionQuestionnaireFieldId;
  explicitValues: string[];
  suggestedValues: string[];
  source: "explicit" | "deterministic" | "model" | "mixed" | "unresolved";
  confidence: number;
  status: "ready" | "conflict" | "ambiguous" | "unmapped";
  evidenceSpan?: string;
  rationale: string;
  requiresConfirmation: boolean;
};

const interpretationSchema: z.ZodType<CompetitionQuestionnaireInterpretation> = z.object({
  fieldId: z.enum(COMPETITION_QUESTIONNAIRE_FIELD_IDS),
  explicitValues: z.array(z.string().min(1).max(48)).max(7).refine(unique),
  suggestedValues: z.array(z.string().min(1).max(48)).max(7).refine(unique),
  source: z.enum(["explicit", "deterministic", "model", "mixed", "unresolved"]),
  confidence: z.number().min(0).max(1),
  status: z.enum(["ready", "conflict", "ambiguous", "unmapped"]),
  evidenceSpan: z.string().trim().min(1).max(COMPETITION_QUESTIONNAIRE_TEXT_MAX_LENGTH).optional(),
  rationale: z.string().trim().min(1).max(120),
  requiresConfirmation: z.boolean()
}).strict().superRefine((interpretation, context) => {
  for (const key of ["explicitValues", "suggestedValues"] as const) {
    const values = interpretation[key];
    if (values.length > 0 && !validateValues(interpretation.fieldId, values)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Values are outside the field whitelist or selection limit",
        path: [key]
      });
    }
  }
});

function interpretText(fieldId: CompetitionQuestionnaireFieldId, text: string | undefined) {
  if (!text) return [];
  const spec = COMPETITION_QUESTIONNAIRE_FIELD_SPECS[fieldId];
  if (spec.kind === "year") {
    const match = /(?:19[7-9]\d|20(?:[0-2]\d|3[0-5]))/.exec(normalizedAlias(text));
    return match ? [match[0]] : [];
  }
  const aliases = new Map<string, string>();
  for (const entry of spec.options) {
    for (const alias of [entry.value, entry.label, ...(entry.aliases ?? [])]) aliases.set(normalizedAlias(alias), entry.value);
  }
  // UI labels can themselves contain list punctuation (for example
  // “化学、化工与材料”). Match the whole answer before treating punctuation as
  // a separator for genuine multi-value answers.
  const wholeValue = aliases.get(normalizedAlias(text));
  if (wholeValue) return [wholeValue];
  const pieces = spec.selection === "multiple" ? text.split(/[、,，;；/|\n]+/) : [text];
  const values = pieces.map((piece) => aliases.get(normalizedAlias(piece))).filter((value): value is string => Boolean(value));
  return unique(values) && values.length <= spec.maxSelections && values.length === pieces.filter((piece) => piece.trim()).length
    ? values
    : [];
}

const PARTICIPATION_TIMING_SEMANTIC_POLICY = {
  currentCycle: "current-cycle 仅用于明确只看当前届仍开放或必须尽快参赛。",
  withinThreeMonths: "within-3-months 仅用于明确要求三个月内开始。",
  nextCycle: "next-cycle-ok 用于明确以下一届为主、或只表示已截止时可等下一届。",
  flexible: "flexible 用于明确表示时间或届次不受限制，包括当前届与下一届都接受。",
  multiWindow: "枚举多个都可接受的时间窗口不是歧义；只有无法确定用户接受范围时才返回 ambiguous。"
} as const;

function semanticPolicyForField(fieldId: CompetitionQuestionnaireFieldId) {
  return fieldId === "participationTiming" ? PARTICIPATION_TIMING_SEMANTIC_POLICY : undefined;
}

function stronglyRequiresFlexibleTiming(text: string | undefined) {
  if (!text) return false;
  const compact = text.normalize("NFKC").replace(/\s+/g, "");
  const explicitlyUnrestricted =
    /(?:不限定|不设限|不受.{0,4}限制|没有.{0,4}限制|时间.{0,4}灵活)/.test(compact);
  const acceptsAnySuitableCycle =
    /(?:任何|所有|合适的?).{0,6}(?:届次|时间).{0,6}(?:都|均).{0,4}(?:可以|能|接受|考虑)/.test(compact) ||
    /(?:什么时候|何时).{0,6}(?:都|均).{0,4}(?:可以|能|接受|考虑)/.test(compact);
  const acceptsCurrent = /(?:当前届|本届).{0,10}(?:合适就参加|可以参加|能参加|也可以)/.test(compact);
  const acceptsNext =
    /(?:下一届|下届).{0,8}(?:都可以|均可|可以|能|接受)/.test(compact) ||
    /(?:也愿意|也可以|也能).{0,8}(?:等|准备)?(?:下一届|下届)/.test(compact);
  return explicitlyUnrestricted || acceptsAnySuitableCycle || (acceptsCurrent && acceptsNext);
}

function mappingSatisfiesStrongSemanticPolicy(input: {
  fieldId: CompetitionQuestionnaireFieldId;
  freeText: string | undefined;
  status: "unique" | "ambiguous" | "no_match";
  values: readonly string[];
}) {
  if (input.fieldId !== "participationTiming" || !stronglyRequiresFlexibleTiming(input.freeText)) {
    return true;
  }
  return input.status === "unique" && input.values.length === 1 && input.values[0] === "flexible";
}

function expandCompetitionQuestionnaire(
  questionnaire: CompetitionQuestionnaireTransportV1
): NormalizedCompetitionQuestionnaireV1 {
  return {
    version: questionnaire.version,
    answers: questionnaire.answers.flatMap((answer) => {
      const requiredFields = QUESTION_FIELDS[answer.fieldId];
      const optionalFields = OPTIONAL_QUESTION_FIELDS[answer.fieldId] ?? [];
      const selectedOptionalFields = optionalFields.filter(
        (fieldId) => selectedValuesForField(answer, fieldId).length > 0
      );
      const textMentionsYear = answer.fieldId === "stage" && /(?:19[7-9]\d|20(?:[0-2]\d|3[0-5]))/.test(answer.freeText ?? "");
      const fields = [
        ...requiredFields,
        ...selectedOptionalFields,
        ...(textMentionsYear && !selectedOptionalFields.includes("firstHigherEducationYear")
          ? ["firstHigherEducationYear" as const]
          : [])
      ];
      return fields.filter(fieldId => answer.freeText || selectedValuesForField(answer, fieldId).length > 0).map((fieldId) => ({
        fieldId,
        selectedValues: selectedValuesForField(answer, fieldId),
        ...(answer.freeText ? { freeText: answer.freeText } : {})
      }));
    })
  };
}

export function normalizeCompetitionQuestionnaire(input: unknown):
  | { ok: true; questionnaire: NormalizedCompetitionQuestionnaireV1; interpretations: CompetitionQuestionnaireInterpretation[] }
  | { ok: false } {
  const parsed = competitionQuestionnaireV1Schema.safeParse(input);
  if (!parsed.success) return { ok: false };
  const questionnaire = expandCompetitionQuestionnaire(parsed.data);
  const interpretations = questionnaire.answers.map((answer): CompetitionQuestionnaireInterpretation => {
    const suggestedValues = interpretText(answer.fieldId, answer.freeText);
    const hasText = Boolean(answer.freeText);
    const proposed = [...new Set([...answer.selectedValues, ...suggestedValues])];
    const conflict = hasText && suggestedValues.length > 0 && !validateValues(answer.fieldId, proposed);
    return {
      fieldId: answer.fieldId,
      explicitValues: [...answer.selectedValues],
      suggestedValues,
      source: !hasText ? "explicit" : suggestedValues.length === 0 ? "unresolved" : answer.selectedValues.length ? "mixed" : "deterministic",
      confidence: !hasText ? 1 : suggestedValues.length === 0 ? 0 : answer.selectedValues.length ? 0.9 : 0.95,
      status: !hasText ? "ready" : suggestedValues.length === 0 ? "unmapped" : conflict ? "conflict" : "ready",
      ...(hasText && suggestedValues.length > 0 ? { evidenceSpan: answer.freeText } : {}),
      rationale: !hasText
        ? "用户直接选择了白名单选项。"
        : suggestedValues.length === 0
          ? "自由文本暂时无法唯一对应白名单选项，需要用户确认。"
          : conflict
            ? "自由文本与已选单选项不一致，需要用户决定最终值。"
            : "自由文本与白名单选项唯一对应，仍需用户确认后采用。",
      requiresConfirmation: hasText
    };
  });
  return { ok: true, questionnaire, interpretations };
}

export function getCompetitionNormalizeModel() {
  return process.env.AI_COMPETITION_NORMALIZE_MODEL?.trim() || getConfiguredAiModel(DEFAULT_DEEPSEEK_MODEL);
}

export async function enhanceCompetitionQuestionnaireWithAi(
  questionnaire: NormalizedCompetitionQuestionnaireV1,
  interpretations: readonly CompetitionQuestionnaireInterpretation[],
  options: { deadlineEpochMs?: number; signal?: AbortSignal } = {}
): Promise<{
  interpretations: CompetitionQuestionnaireInterpretation[];
  provider: string;
  model: string;
  aiUsed: boolean;
  upstreamAttempted: boolean;
  failureReason?: AiJsonFailureReason;
}> {
  const provider = getConfiguredAiProvider();
  const model = getCompetitionNormalizeModel();
  const unresolved = interpretations.filter(({ source, requiresConfirmation }) => source === "unresolved" && requiresConfirmation);
  if (unresolved.length === 0) {
    return {
      interpretations: [...interpretations],
      provider,
      model: provider === "mock" ? "mock" : model,
      aiUsed: false,
      upstreamAttempted: false
    };
  }
  const providerFailure = getCompetitionAiProviderFailureReason(provider);
  if (providerFailure) {
    return {
      interpretations: [...interpretations],
      provider,
      model: provider === "mock" ? "mock" : model,
      aiUsed: false,
      upstreamAttempted: false,
      failureReason: providerFailure
    };
  }

  const requests = unresolved.map(({ fieldId }) => {
    const answer = questionnaire.answers.find((item) => item.fieldId === fieldId)!;
    const spec = COMPETITION_QUESTIONNAIRE_FIELD_SPECS[fieldId];
    return {
      fieldId,
      freeText: answer.freeText,
      selection: spec.selection,
      maxSelections: spec.maxSelections,
      allowedOptions: spec.options.map(({ value, label }) => ({ value, label })),
      ...(semanticPolicyForField(fieldId)
        ? { semanticPolicy: semanticPolicyForField(fieldId) }
        : {}),
      ...(spec.kind === "year" ? { numericRange: { min: 1970, max: 2035 } } : {})
    };
  });
  const allowedByField = new Map(requests.map(({ fieldId, allowedOptions }) => [
    fieldId,
    new Set(allowedOptions.map(({ value }) => value))
  ]));
  const outputSchema = z.object({
    mappings: z.array(z.object({
      fieldId: z.enum(COMPETITION_QUESTIONNAIRE_FIELD_IDS),
      status: z.enum(["unique", "ambiguous", "no_match"]),
      values: z.array(z.string().trim().min(1).max(48)).max(7).refine(unique),
      evidenceSpan: z.string().trim().min(1).max(COMPETITION_QUESTIONNAIRE_TEXT_MAX_LENGTH).optional(),
      rationale: z.string().trim().min(1).max(120)
    }).strict()).length(requests.length)
  }).strict().superRefine((output, context) => {
    const ids = output.mappings.map(({ fieldId }) => fieldId);
    if (!unique(ids) || requests.some(({ fieldId }) => !ids.includes(fieldId))) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Every requested field must appear exactly once" });
    }
    output.mappings.forEach((mapping, index) => {
      const spec = COMPETITION_QUESTIONNAIRE_FIELD_SPECS[mapping.fieldId];
      const isRequested = allowedByField.has(mapping.fieldId);
      const valid = mapping.status === "unique"
        ? validateValues(mapping.fieldId, mapping.values)
        : mapping.values.length === 0;
      const original = requests.find(({ fieldId }) => fieldId === mapping.fieldId)?.freeText;
      const validSpan = !mapping.evidenceSpan || Boolean(original?.includes(mapping.evidenceSpan));
      if (!isRequested || !valid || !validSpan || (spec.kind !== "year" && mapping.values.some((value) => !allowedByField.get(mapping.fieldId)!.has(value)))) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "Mapping is not a valid unique whitelist interpretation", path: ["mappings", index] });
      }
      if (!mappingSatisfiesStrongSemanticPolicy({
        fieldId: mapping.fieldId,
        freeText: original,
        status: mapping.status,
        values: mapping.values
      })) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Mapping conflicts with the supplied field semantic policy",
          path: ["mappings", index]
        });
      }
    });
  });

  const prompt = await buildPrompt("competition-normalize.v1.md", {
    requestsJson: JSON.stringify(requests)
  });
  const result = await requestAiJson(prompt, {
    model,
    systemPrompt: "Return JSON only. Map user text only to supplied whitelist values and obey each field's semanticPolicy; return ambiguous or no_match instead of guessing.",
    temperature: 0,
    maxTokens: 1400,
    maxAttempts: 2,
    schema: outputSchema,
    thinking: "disabled",
    operation: "competition_normalize",
    promptVersion: COMPETITION_NORMALIZE_PROMPT_VERSION,
    candidateCount: requests.length,
    deadlineEpochMs: options.deadlineEpochMs,
    signal: options.signal,
    retryInstruction: "Return every requested field exactly once. Use only listed values and obey semanticPolicy. For participationTiming, accepting the current and next cycle or explicitly accepting any timing maps uniquely to flexible; multiple accepted windows are not ambiguity. Non-unique meanings must have status ambiguous and an empty values array."
  });
  if (!result.ok) {
    return {
      interpretations: [...interpretations],
      provider,
      model: result.model,
      aiUsed: false,
      upstreamAttempted: result.upstreamAttempted,
      failureReason: result.reason
    };
  }

  const mappingByField = new Map(result.data.mappings.map((mapping) => [mapping.fieldId, mapping]));
  return {
    interpretations: interpretations.map((interpretation) => {
      const mapping = mappingByField.get(interpretation.fieldId);
      if (!mapping) return interpretation;
      if (mapping.status !== "unique" || mapping.values.length === 0) {
        return {
          ...interpretation,
          status: mapping.status === "ambiguous" ? "ambiguous" : "unmapped",
          ...(mapping.evidenceSpan ? { evidenceSpan: mapping.evidenceSpan } : {}),
          rationale: mapping.rationale
        };
      }
      const proposed = [...new Set([...interpretation.explicitValues, ...mapping.values])];
      const conflict = !validateValues(interpretation.fieldId, proposed);
      return {
        ...interpretation,
        suggestedValues: proposed.slice(
          0,
          COMPETITION_QUESTIONNAIRE_FIELD_SPECS[interpretation.fieldId].maxSelections
        ),
        source: interpretation.explicitValues.length ? "mixed" : "model",
        // Confidence is assigned by server policy, never copied from model output.
        confidence: 0.75,
        status: conflict ? "conflict" : "ready",
        ...(mapping.evidenceSpan ? { evidenceSpan: mapping.evidenceSpan } : {}),
        rationale: mapping.rationale
      };
    }),
    provider,
    model: result.model,
    aiUsed: true,
    upstreamAttempted: result.upstreamAttempted
  };
}

export const competitionQuestionnaireConfirmationSchema = z.object({
  fieldId: z.enum(COMPETITION_QUESTIONNAIRE_FIELD_IDS),
  values: z.array(z.string().trim().min(1).max(48)).min(1).max(7).refine(unique)
}).strict().superRefine((confirmation, context) => {
  if (!validateValues(confirmation.fieldId, confirmation.values)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Values are outside the field whitelist or selection limit",
      path: ["values"]
    });
  }
});

const tokenPayloadCoreSchema = z.object({
  issuedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive(),
  nonce: z.string().uuid(),
  decisionContext: competitionDecisionContextSchema.optional(),
  rawAnswerContext: z.array(competitionNormalizedQuestionnaireAnswerSchema)
    .min(1)
    .max(COMPETITION_QUESTIONNAIRE_FIELD_IDS.length),
  interpretations: z.array(interpretationSchema).min(1).max(COMPETITION_QUESTIONNAIRE_FIELD_IDS.length),
  profile: competitionRecommendationProfileV5Schema.nullable(),
  confirmed: z.boolean()
}).strict();

type CompetitionQuestionnaireTokenCore = z.infer<typeof tokenPayloadCoreSchema>;

function validateCompetitionQuestionnaireTokenPayload(
  payload: CompetitionQuestionnaireTokenCore,
  context: z.RefinementCtx
) {
  if (payload.expiresAt <= payload.issuedAt) context.addIssue({ code: z.ZodIssueCode.custom, message: "Token expiry is invalid" });
  if (payload.confirmed !== Boolean(payload.profile)) context.addIssue({ code: z.ZodIssueCode.custom, message: "Confirmed token/profile mismatch" });
  const ids = payload.interpretations.map(({ fieldId }) => fieldId);
  if (!unique(ids)) context.addIssue({ code: z.ZodIssueCode.custom, message: "Interpretation fields must be unique" });
  const rawIds = payload.rawAnswerContext.map(({ fieldId }) => fieldId);
  if (!unique(rawIds) || ids.length !== rawIds.length || ids.some((fieldId) => !rawIds.includes(fieldId))) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Raw answer and interpretation fields must match" });
  }
  if (!rawIds.includes("stage")) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Every fixed-questionnaire field must be preserved",
      path: ["rawAnswerContext"]
    });
  }
  if (payload.confirmed && payload.profile) {
    const rawFactIds = COMPETITION_ELIGIBILITY_FACT_IDS.filter((fieldId) => rawIds.includes(fieldId));
    if (
      rawFactIds.length !== payload.profile.confirmedFacts.length ||
      rawFactIds.some((fieldId) => !payload.profile!.confirmedFacts.includes(fieldId))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Confirmed questionnaire facts must match the preserved raw fields",
        path: ["profile", "confirmedFacts"]
      });
    }
  }
  payload.interpretations.forEach((interpretation, index) => {
    const original = payload.rawAnswerContext.find(({ fieldId }) => fieldId === interpretation.fieldId)?.freeText;
    if (interpretation.evidenceSpan && !original?.includes(interpretation.evidenceSpan)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Evidence span must occur in the original answer", path: ["interpretations", index, "evidenceSpan"] });
    }
  });
}

const tokenPayloadSchema = tokenPayloadCoreSchema.extend({
  version: z.literal(COMPETITION_QUESTIONNAIRE_TOKEN_VERSION),
  sessionId: z.string().uuid()
}).strict().superRefine(validateCompetitionQuestionnaireTokenPayload);

const legacyTokenPayloadSchema = tokenPayloadCoreSchema.extend({
  version: z.literal(LEGACY_COMPETITION_QUESTIONNAIRE_TOKEN_VERSION)
}).strict().superRefine(validateCompetitionQuestionnaireTokenPayload);

export type CompetitionQuestionnaireTokenPayload = z.infer<typeof tokenPayloadSchema>;

function signingSecret() {
  const configured = process.env.AI_CONVERSATION_SIGNING_SECRET?.trim();
  if (configured && configured.length >= 32) return configured;
  if (process.env.NODE_ENV !== "production") return "development-only-competition-token-secret-do-not-deploy";
  return null;
}

function encode(value: string | Uint8Array) { return Buffer.from(value).toString("base64url"); }
function signature(encodedPayload: string, secret: string) { return createHmac("sha256", secret).update(encodedPayload).digest(); }

export function createCompetitionQuestionnaireToken(
  input: Pick<CompetitionQuestionnaireTokenPayload, "rawAnswerContext" | "interpretations" | "profile" | "confirmed" | "decisionContext"> & {
    sessionId?: string;
  },
  now = new Date()
) {
  const secret = signingSecret();
  if (!secret) throw new Error("AI_CONVERSATION_SIGNING_SECRET is required in production");
  const issuedAt = Math.floor(now.getTime() / 1000);
  const payload = tokenPayloadSchema.parse({
    version: COMPETITION_QUESTIONNAIRE_TOKEN_VERSION,
    issuedAt,
    expiresAt: issuedAt + COMPETITION_QUESTIONNAIRE_TOKEN_TTL_SECONDS,
    sessionId: input.sessionId ?? randomUUID(),
    nonce: randomUUID(),
    decisionContext: input.decisionContext,
    rawAnswerContext: input.rawAnswerContext,
    interpretations: input.interpretations,
    profile: input.profile,
    confirmed: input.confirmed
  });
  const encoded = encode(JSON.stringify(payload));
  const token = `${encoded}.${encode(signature(encoded, secret))}`;
  if (token.length > COMPETITION_QUESTIONNAIRE_TOKEN_MAX_LENGTH) throw new Error("Competition questionnaire token is too large");
  return token;
}

export function verifyCompetitionQuestionnaireToken(token: string, now = new Date()):
  | { ok: true; payload: CompetitionQuestionnaireTokenPayload }
  | { ok: false; reason: "missing_secret" | "invalid_token" | "expired_token" } {
  const secret = signingSecret();
  if (!secret) return { ok: false, reason: "missing_secret" };
  if (token.length > COMPETITION_QUESTIONNAIRE_TOKEN_MAX_LENGTH) return { ok: false, reason: "invalid_token" };
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: "invalid_token" };
  try {
    const payloadBytes = Buffer.from(parts[0], "base64url");
    const supplied = Buffer.from(parts[1], "base64url");
    if (encode(payloadBytes) !== parts[0] || encode(supplied) !== parts[1]) return { ok: false, reason: "invalid_token" };
    const expected = signature(parts[0], secret);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return { ok: false, reason: "invalid_token" };
    const decoded = JSON.parse(payloadBytes.toString("utf8")) as unknown;
    const parsed = tokenPayloadSchema.safeParse(decoded);
    let payload: CompetitionQuestionnaireTokenPayload;
    if (parsed.success) {
      payload = parsed.data;
    } else {
      const legacy = legacyTokenPayloadSchema.safeParse(decoded);
      if (!legacy.success) return { ok: false, reason: "invalid_token" };
      payload = {
        ...legacy.data,
        version: COMPETITION_QUESTIONNAIRE_TOKEN_VERSION,
        sessionId: legacy.data.nonce
      };
    }
    if (payload.expiresAt <= Math.floor(now.getTime() / 1000)) return { ok: false, reason: "expired_token" };
    return { ok: true, payload };
  } catch {
    return { ok: false, reason: "invalid_token" };
  }
}

function valueFor(
  interpretations: readonly CompetitionQuestionnaireInterpretation[],
  confirmations: readonly z.infer<typeof competitionQuestionnaireConfirmationSchema>[],
  fieldId: CompetitionQuestionnaireFieldId
) {
  const interpretation = interpretations.find((item) => item.fieldId === fieldId);
  if (!interpretation) return null;
  const values = interpretation.requiresConfirmation
    ? confirmations.find((item) => item.fieldId === fieldId)?.values
    : interpretation.explicitValues;
  return values && validateValues(fieldId, values) ? values : null;
}

export function confirmCompetitionQuestionnaire(
  interpretations: readonly CompetitionQuestionnaireInterpretation[],
  confirmationsInput: unknown,
  decisionContext?: CompetitionRecommendationProfileV5["decisionContext"]
): { ok: true; profile: CompetitionRecommendationProfileV5 } | { ok: false } {
  const parsed = z.array(competitionQuestionnaireConfirmationSchema).max(COMPETITION_QUESTIONNAIRE_FIELD_IDS.length).safeParse(confirmationsInput);
  if (!parsed.success || !unique(parsed.data.map(({ fieldId }) => fieldId))) return { ok: false };
  const required = interpretations.filter(({ requiresConfirmation }) => requiresConfirmation).map(({ fieldId }) => fieldId);
  const supplied = parsed.data.map(({ fieldId }) => fieldId);
  if (required.length !== supplied.length || required.some((fieldId) => !supplied.includes(fieldId))) return { ok: false };

  const values = new Map<CompetitionQuestionnaireFieldId, string[]>();
  for (const interpretation of interpretations) {
    const resolved = valueFor(interpretations, parsed.data, interpretation.fieldId);
    if (!resolved) return { ok: false };
    values.set(interpretation.fieldId, resolved);
  }
  if (!values.has("stage")) return { ok: false };

  const one = (fieldId: CompetitionQuestionnaireFieldId) => values.get(fieldId)?.[0];
  const many = (fieldId: CompetitionQuestionnaireFieldId) => values.get(fieldId) ?? [];
  const confirmedFacts = COMPETITION_ELIGIBILITY_FACT_IDS.filter((fieldId) => values.has(fieldId));
  const candidate = {
    profileVersion: COMPETITION_PROFILE_V5_VERSION,
    questionnaireVersion: COMPETITION_QUESTIONNAIRE_VERSION,
    decisionContext,
    confirmedFields: COMPETITION_PROFILE_FIELD_IDS.filter(field => values.has(field)),
    confirmedFacts: confirmedFacts as CompetitionEligibilityFactId[],
    stage: one("stage"),
    majorFields: many("majorFields"),
    specificSubjects: many("specificSubjects"),
    skills: many("skills"),
    interests: many("interests"),
    goals: many("goals"),
    preferredOutputs: many("preferredOutputs"),
    startingPoint: one("startingPoint") ?? "idea_only",
    weeklyCommitment: one("weeklyCommitment") ?? "under-5",
    teamStatus: one("teamStatus") ?? "solo",
    availableResources: many("availableResources"),
    participationMode: one("participationMode") ?? "flexible",
    participationTiming: one("participationTiming") ?? "flexible",
    taskFormats: many("taskFormats"),
    experienceLevel: one("experienceLevel") ?? "none",
    evidence: many("evidence"),
    ...(values.has("enrollmentStatus") ? { enrollmentStatus: one("enrollmentStatus") } : {}),
    ...(values.has("firstHigherEducationYear") ? { firstHigherEducationYear: Number(one("firstHigherEducationYear")) } : {}),
    ...(values.has("teamUnit") ? { teamUnit: one("teamUnit") } : {}),
    ...(values.has("teamSize") ? { teamSize: one("teamSize") } : {})
  };
  const profile = competitionRecommendationProfileV5Schema.safeParse(candidate);
  return profile.success ? { ok: true, profile: profile.data } : { ok: false };
}

export function questionnaireInterpretationsForClient(
  interpretations: readonly CompetitionQuestionnaireInterpretation[],
  rawAnswerContext: NormalizedCompetitionQuestionnaireV1["answers"]
) {
  return interpretations.map((interpretation) => {
    const spec = COMPETITION_QUESTIONNAIRE_FIELD_SPECS[interpretation.fieldId];
    return {
      ...interpretation,
      originalText: rawAnswerContext.find(({ fieldId }) => fieldId === interpretation.fieldId)?.freeText,
      allowedOptions: spec.options.map(({ value, label }) => ({ value, label })),
      ...(spec.kind === "year" ? { numericRange: { min: 1970, max: 2035 } } : {})
    };
  });
}
