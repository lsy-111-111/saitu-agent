import type { ChoiceOption } from "@/components/competitions/recommend/ChoiceGroup";
import type {
  CompetitionEnrollmentStatus,
  CompetitionParticipationTiming,
  CompetitionSpecificSubject,
  CompetitionTaskFormat,
  CompetitionTeamSize,
  CompetitionTeamUnit
} from "@/types/competition-recommendation";

type TypedChoiceOption<Value extends string> = Omit<ChoiceOption, "value"> & { value: Value };

export const stageOptions = [
  { value: "vocational", label: "高职／专科" },
  { value: "undergraduate-1", label: "本科大一" },
  { value: "undergraduate-2", label: "本科大二" },
  { value: "undergraduate-3", label: "本科大三" },
  { value: "undergraduate-4", label: "本科大四" },
  { value: "master", label: "硕士研究生" },
  { value: "doctorate", label: "博士研究生" },
  { value: "other-or-non-full-time", label: "其他或非全日制" }
] as const satisfies readonly ChoiceOption[];

export const enrollmentStatusOptions = [
  { value: "full-time-student", label: "全日制在读" },
  { value: "part-time-student", label: "非全日制在读" },
  { value: "recent-graduate", label: "已毕业 5 年内" },
  { value: "graduated", label: "已毕业超过 5 年" },
  { value: "other", label: "其他或暂不确定" }
] as const satisfies readonly TypedChoiceOption<CompetitionEnrollmentStatus>[];

export const majorFieldOptions = [
  { value: "computer-science", label: "计算机与信息" },
  { value: "business", label: "经管与商科" },
  { value: "design", label: "设计与艺术" },
  { value: "engineering", label: "工程与制造" },
  { value: "medicine", label: "临床医学与健康" },
  { value: "mathematics", label: "数学与理科" },
  { value: "humanities", label: "人文与社会科学" },
  { value: "biology-life-science", label: "生物与生命科学" },
  { value: "chemistry-materials", label: "化学、化工与材料" },
  { value: "agriculture-environment", label: "农林、水利与环境" },
  { value: "civil-architecture", label: "土木、建筑与测绘" },
  { value: "finance-taxation", label: "财会、金融与税务" },
  { value: "public-management", label: "公共管理与政策" },
  { value: "language-culture", label: "语言、文化与传播" },
  { value: "physics-geoscience", label: "物理、光电与地学" },
  { value: "other", label: "其他或交叉学科" }
] as const satisfies readonly ChoiceOption[];

export const specificSubjectOptions = [
  { value: "medicine-health", label: "医学技术、基础医学与健康" },
  { value: "civil-architecture", label: "土木结构与建筑设计" },
  { value: "visual-communication", label: "视觉传达、广告与数字艺术" },
  { value: "engineering-practice", label: "工程实践与智能制造" },
  { value: "chemistry-chemical", label: "化学、化工与材料实验" },
  { value: "geoscience-surveying", label: "地质、测绘与地球科学" },
  { value: "physics-optics", label: "物理、光电与实验科学" },
  { value: "mechanics-materials", label: "力学、机械与材料工程" },
  { value: "information-communication", label: "信息通信、芯片与计算机系统" },
  { value: "biology-life-science", label: "生物与生命科学" },
  { value: "robotics-automation", label: "机器人、自动化与智能控制" },
  { value: "water-environment", label: "水利、生态与环境工程" },
  { value: "cybersecurity-systems", label: "网络安全与系统攻防" },
  { value: "statistics-mathematics", label: "数学、统计与建模" },
  { value: "finance-accounting", label: "财税、金融与会计" },
  { value: "digital-construction", label: "BIM、数字建造与园林" },
  { value: "agriculture-equipment", label: "农业工程与智能农机" },
  { value: "language-culture", label: "外语、中华文化与跨文化传播" },
  { value: "public-management", label: "公共管理、政策与社会治理" },
  { value: "vocational-skills", label: "职业技能与生产实务" },
  { value: "synthetic-biology", label: "合成生物与生物工程" },
  { value: "tourism-planning", label: "文旅策划与旅游管理" },
  { value: "legal-studies", label: "法学、仲裁与模拟法庭" },
  { value: "computing-algorithms", label: "算法与科学计算" },
  { value: "business-innovation", label: "商业与创业实践" },
  { value: "arts-performance", label: "艺术创作与表演" }
] as const satisfies readonly TypedChoiceOption<CompetitionSpecificSubject>[];

export const skillOptions = [
  { value: "programming", label: "编程与软件开发" },
  { value: "data-analysis", label: "数据分析与建模" },
  { value: "research", label: "调研与科研验证" },
  { value: "product", label: "产品策划与需求分析" },
  { value: "design", label: "视觉与创意设计" },
  { value: "hardware", label: "硬件与工程实践" },
  { value: "writing", label: "写作与材料整理" },
  { value: "presentation", label: "演讲、路演与答辩" },
  { value: "laboratory", label: "实验操作与安全规范" },
  { value: "structural-design", label: "结构设计与工程制图" },
  { value: "accounting-finance", label: "财会与金融分析" },
  { value: "policy-analysis", label: "政策分析与案例研判" },
  { value: "language", label: "语言表达与跨文化沟通" },
  { value: "fieldwork", label: "野外调查、测绘与田野实践" }
] as const satisfies readonly ChoiceOption[];

export const experienceLevelOptions = [
  { value: "none", label: "还没有参赛经历" },
  { value: "participated", label: "参加过，但还没有完整项目或奖项" },
  { value: "project-or-award", label: "有完整项目或获奖经历" }
] as const satisfies readonly ChoiceOption[];

export const evidenceOptions = [
  { value: "project", label: "完整项目经历" },
  { value: "paper", label: "论文或研究报告" },
  { value: "prototype", label: "可演示原型或代码" },
  { value: "portfolio", label: "作品集或设计作品" },
  { value: "award", label: "竞赛奖项" },
  { value: "none", label: "暂时没有可展示的材料" }
] as const satisfies readonly ChoiceOption[];

export const interestOptions = [
  { value: "innovation", label: "创新创业" },
  { value: "ai", label: "人工智能" },
  { value: "data", label: "数据建模" },
  { value: "academic-research", label: "科研学术" },
  { value: "language-communication", label: "语言传播" },
  { value: "engineering", label: "科技工程" },
  { value: "robotics", label: "机器人与智能制造" },
  { value: "design", label: "工业与产品设计" },
  { value: "media", label: "数字媒体" },
  { value: "career", label: "职业规划" },
  { value: "entrepreneurship", label: "商业与创业实践" },
  { value: "medicine-health", label: "医学与健康" },
  { value: "biology-life-science", label: "生物与生命科学" },
  { value: "chemistry-materials", label: "化学化工与材料" },
  { value: "agriculture-environment", label: "农林水利与环境" },
  { value: "civil-architecture", label: "土木建筑与数字建造" },
  { value: "culture-language", label: "语言文化与经典传播" },
  { value: "finance-taxation", label: "财税金融与企业经营" },
  { value: "public-management", label: "公共管理与社会治理" },
  { value: "physics-geoscience", label: "物理光电与地球科学" }
] as const satisfies readonly ChoiceOption[];

export const goalOptions = [
  { value: "project", label: "积累项目经历" },
  { value: "award", label: "了解本校认定、综测与评奖机会" },
  { value: "postgraduate", label: "为保研、复试做准备" },
  { value: "employment", label: "提升实习求职竞争力" },
  { value: "portfolio", label: "把想法做成作品" },
  { value: "entrepreneurship", label: "验证创业想法" },
  { value: "networking", label: "认识队友与指导老师" }
] as const satisfies readonly ChoiceOption[];

export const preferredOutputOptions = [
  { value: "software", label: "软件或 AI 应用" },
  { value: "prototype", label: "实物原型" },
  { value: "research-paper", label: "研究报告或论文" },
  { value: "business-plan", label: "商业计划书" },
  { value: "creative-work", label: "设计或媒体作品" },
  { value: "presentation", label: "路演或演讲" },
  { value: "career-plan", label: "职业发展方案" }
] as const satisfies readonly ChoiceOption[];

export const startingPointOptions = [
  { value: "idea_only", label: "只有方向或创意" },
  { value: "coursework", label: "有课程作业或调研" },
  { value: "prototype", label: "已有原型、作品或代码" },
  { value: "validated", label: "已有实验数据、用户或落地验证" }
] as const satisfies readonly ChoiceOption[];

export const weeklyCommitmentOptions = [
  { value: "under-5", label: "每周 5 小时以内" },
  { value: "5-10", label: "每周 5–10 小时" },
  { value: "over-10", label: "每周 10 小时以上" }
] as const satisfies readonly ChoiceOption[];

export const teamStatusOptions = [
  { value: "solo", label: "想一个人参加" },
  { value: "looking", label: "还没有队友，可以组队" },
  { value: "partial", label: "已有部分队友" },
  { value: "ready", label: "已有完整队伍" }
] as const satisfies readonly ChoiceOption[];

export const teamSizeOptions = [
  { value: "solo", label: "目前 1 人" },
  { value: "two", label: "目前 2 人" },
  { value: "three", label: "目前 3 人" },
  { value: "four", label: "目前 4 人" },
  { value: "five", label: "目前 5 人" },
  { value: "over-five", label: "目前 6 人或更多" },
  { value: "unsure", label: "还没组队或人数未定" }
] as const satisfies readonly TypedChoiceOption<CompetitionTeamSize>[];

export const teamUnitOptions = [
  { value: "same-unit", label: "队员都来自同一学校／参赛单位" },
  { value: "mixed-unit", label: "队员可能来自不同学校／参赛单位" },
  { value: "unsure", label: "还不确定" }
] as const satisfies readonly TypedChoiceOption<CompetitionTeamUnit>[];

export const availableResourceOptions = [
  { value: "mentor", label: "指导老师" },
  { value: "lab", label: "实验室或创客空间" },
  { value: "equipment", label: "硬件或设备" },
  { value: "data", label: "数据或行业资源" },
  { value: "budget", label: "一定项目预算" },
  { value: "school-registration", label: "学校报名、推荐或盖章支持" },
  { value: "safety-compliance", label: "安全、伦理或合规支持" },
  { value: "none", label: "暂时没有" }
] as const satisfies readonly ChoiceOption[];

export const regionOptions = [
  { value: "north", label: "华北" },
  { value: "east", label: "华东" },
  { value: "central", label: "华中" },
  { value: "south", label: "华南" },
  { value: "southwest", label: "西南" },
  { value: "northwest", label: "西北" },
  { value: "northeast", label: "东北" },
  { value: "other", label: "港澳台或其他地区" }
] as const satisfies readonly ChoiceOption[];

export const participationModeOptions = [
  { value: "remote", label: "线上为主" },
  { value: "offline-local", label: "本地线下" },
  { value: "travel", label: "可以跨地区参赛" },
  { value: "flexible", label: "形式都可以" }
] as const satisfies readonly ChoiceOption[];

export const participationTimingOptions = [
  { value: "current-cycle", label: "想参加当前可报名或本届赛事" },
  { value: "within-3-months", label: "希望未来 3 个月内开始参赛" },
  { value: "next-cycle-ok", label: "可以为下一届长期准备" },
  { value: "flexible", label: "参赛时间都可以" }
] as const satisfies readonly TypedChoiceOption<CompetitionParticipationTiming>[];

export const taskFormatOptions = [
  { value: "algorithm", label: "算法编程与解题" },
  { value: "modeling", label: "数据建模与分析" },
  { value: "software", label: "软件或 AI 应用开发" },
  { value: "hardware", label: "硬件、嵌入式或工程制作" },
  { value: "research", label: "科研实验、论文或调研" },
  { value: "product", label: "产品策划与用户验证" },
  { value: "entrepreneurship", label: "商业策划与创业实践" },
  { value: "design", label: "设计与数字创意" },
  { value: "language", label: "语言表达与传播" },
  { value: "career", label: "职业规划与展示" }
] as const satisfies readonly TypedChoiceOption<CompetitionTaskFormat>[];

export const constraintOptions = [
  { value: "time", label: "可投入时间有限", description: "希望优先选择节奏更可控的比赛" },
  { value: "team", label: "还缺合适队友", description: "需要补齐合作伙伴或团队角色" },
  { value: "mentor", label: "暂时缺少导师指导" },
  { value: "equipment-data", label: "设备、场地或数据有限" },
  { value: "travel-offline", label: "异地或线下参赛不方便" },
  { value: "none", label: "暂时没有明显限制" }
] as const satisfies readonly ChoiceOption[];

type LabelOption = Pick<ChoiceOption, "value" | "label">;

export function getOptionLabel(options: readonly LabelOption[], value: string) {
  return options.find((option) => option.value === value)?.label ?? value;
}
