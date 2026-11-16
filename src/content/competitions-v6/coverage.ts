import { TASK_FAMILIES, type CoverageProfile, type TaskFamily } from "@/lib/competitions/v6/catalog-types";

export const taskFamilyLabels: Record<TaskFamily, string> = {
  "software-algorithms": "算法与软件", "data-modeling": "数据建模", "engineering-prototype": "工程样机",
  "experimental-research": "实验研究", investigation: "调查论证", "business-practice": "商业实践",
  "visual-interaction": "视觉与交互", "language-communication": "语言传播", "teaching-service": "教学服务"
};
const tasks: Record<TaskFamily, { interest: string; artifact: string; major: string }> = {
  "software-algorithms": { interest: "愿意编程实现功能并调试", artifact: "独立做过课程记账程序，能说明输入校验与三个测试用例", major: "计算机类" },
  "data-modeling": { interest: "喜欢用数据解释问题", artifact: "用公开数据完成过课程图表，能解释缺失值处理和一项局限", major: "数学与统计" },
  "engineering-prototype": { interest: "愿意搭建装置并反复测试", artifact: "在课程中完成过传感器小装置，保存接线图和测量误差记录", major: "电子信息" },
  "experimental-research": { interest: "喜欢设计对照并观察实验结果", artifact: "完成过基础实验课报告，能区分对照组和实验组并提供原始记录", major: "生物科学" },
  investigation: { interest: "喜欢访谈和寻找证据", artifact: "完成过校园调研课程作业，能解释抽样偏差和本人访谈工作", major: "社会科学" },
  "business-practice": { interest: "对用户需求与经营成本感兴趣", artifact: "做过一次社团义卖并记过成本、收入和滞销原因", major: "工商管理" },
  "visual-interaction": { interest: "喜欢设计视觉表达和操作流程", artifact: "做过两版活动海报，能解释受众、信息层级与修改依据", major: "设计" },
  "language-communication": { interest: "愿意阅读、写作并向别人讲清内容", artifact: "录过三分钟课程演讲，能解释文本依据和停连调整", major: "文学" },
  "teaching-service": { interest: "喜欢帮助别人理解知识和解决生活问题", artifact: "辅导过同学一道题，保留讲解前后对方回答及修改后的讲义", major: "教育学" }
};

/** Four agreed test combinations; budget is independent of team access. */
const coreCombinations = [
  { experience: "beginner", resources: "constrained", team: "none", budgetCny: 300 },
  { experience: "beginner", resources: "supported", team: "can_form", budgetCny: 1000 },
  { experience: "coursework", resources: "constrained", team: "none", budgetCny: 1000 },
  { experience: "coursework", resources: "supported", team: "can_form", budgetCny: 300 }
] as const;

export const coreCoverageProfiles: CoverageProfile[] = TASK_FAMILIES.flatMap(taskFamily =>
  coreCombinations.map(({ experience, resources, team, budgetCny }) => ({
    id: `core:${taskFamily}:${experience}:${resources}`, kind: "core" as const,
    label: `${taskFamilyLabels[taskFamily]}／${experience === "beginner" ? "新手" : "有课程作品"}／${team === "none" ? "独自" : "可组队"}／${budgetCny}元`,
    taskFamily, experience, resources,
    education: { degree: "undergraduate" as const, year: experience === "beginner" ? 1 as const : 2 as const, major: tasks[taskFamily].major },
    evidence: experience === "beginner" ? ["没有参赛和成型课程作品；仅自述兴趣，能力尚无经历证据"] : [tasks[taskFamily].artifact],
    interests: [tasks[taskFamily].interest], goals: ["探索自己是否喜欢实际任务", "完成能说明个人贡献的作品"],
    weeklyHours: 6, budgetCny, team, mentor: false, laboratory: false,
    equipment: ["个人电脑", "手机"], mobility: "local" as const,
    resourceAssumptions: ["测试固定每周6小时、可在当地活动；它们不是由预算推导的个人事实", "未确认导师与实验室；可组队不代表已具备指导或设备", "resources旧枚举仅标记独自/可组队场景，不代表总体资源丰裕程度"],
    constraints: [team === "none" ? "暂无已确认队友" : "可以联系同校队友，但尚未组成合格队伍", `个人总支出不超过${budgetCny}元`, "导师、实验室及正式参赛名额需另确认"],
    expectedBehavior: ["兴趣不能替代能力证据", "未知资格和成本必须明确，不能视为满足", "同一系列不同赛道最多计一个系列", "至少3个已支持系列及2条不同任务/角色路径才计覆盖达标"]
  }))
);

const specialBase = { ...coreCoverageProfiles[0], weeklyHours: 4, resourceAssumptions: ["特殊画像固定每周4小时、个人预算300元、暂无队友导师实验室", "本地活动可行；专业特殊限制在constraints逐项声明"] };
/** Four distinct stressors not represented by the regular resource/experience grid. */
export const specialCoverageProfiles: CoverageProfile[] = [
  { ...specialBase, id: "special:humanities-evidence", kind: "special", label: "历史新手：喜欢史料辨析，不愿编程或商业推销", taskFamily: "investigation", education: { degree: "undergraduate", year: 1, major: "历史学" }, interests: ["阅读地方史并比较不同史料"], evidence: ["读过两种地方史，但未做正式论文或调查"], constraints: ["无队友、导师，预算300元，每周4小时", "不愿编程、拍广告或销售"], expectedBehavior: ["专业匹配须落实史料研究任务，不能用泛创新赛填满数量", "不足3项如实报告学科覆盖空白"] },
  { ...specialBase, id: "special:education-transfer", kind: "special", label: "教育新手：有辅导经历，缺物理实验基础", taskFamily: "teaching-service", education: { degree: "undergraduate", year: 1, major: "小学教育" }, interests: ["把语文概念讲给小学生听"], evidence: ["为亲戚讲过古诗含义，能描述一次对方的误解"], constraints: ["无物理实验课程或实验室", "无教师职业身份", "预算300元，每周4小时"], expectedBehavior: ["不能因喜欢讲课就认定符合物理实验讲课能力或教师组资格", "考虑学生讲解类或教学作品，提示具体知识差距"] },
  { ...specialBase, id: "special:agriculture-no-lab", kind: "special", label: "农学新手：有田间观察，无湿实验条件", taskFamily: "experimental-research", education: { degree: "undergraduate", year: 1, major: "农学" }, interests: ["比较植物生长与环境因素"], evidence: ["连续两周拍过家中植物，但没有对照实验、无农药操作经历"], constraints: ["没有实验室、导师或实验材料采购预算", "不能离校开展长周期田野研究", "每周4小时"], expectedBehavior: ["不能把植物兴趣推为植保技能或实验能力", "先给安全的观察/文献体验，正式实验路径需资源条件"] },
  { ...specialBase, id: "special:law-language-boundary", kind: "special", label: "法学新手：中文论证兴趣，英文口辩基础弱", taskFamily: "language-communication", education: { degree: "undergraduate", year: 1, major: "法学" }, interests: ["用案例分析公共问题并用中文辩论"], evidence: ["做过一次班级中文辩论，没有法律检索或英文口辩经历"], constraints: ["英文阅读和口辩暂不足以独立分析国际法律案例", "无校队/教练，预算300元，每周4小时"], expectedBehavior: ["不把英语国际模拟法庭作为立即可上手推荐", "提示法律检索证据缺口并比较中文论证或调查路线"] }
];

export const coverageProfiles: CoverageProfile[] = [...coreCoverageProfiles, ...specialCoverageProfiles];
