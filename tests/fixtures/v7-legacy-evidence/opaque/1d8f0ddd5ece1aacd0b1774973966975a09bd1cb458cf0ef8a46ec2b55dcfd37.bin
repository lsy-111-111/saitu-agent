import type {
  CompetitionMetadataSource,
  CompetitionSource,
  CompetitionSourceDisplay,
  CompetitionRecommendationMetadata
} from "@/content/competitions";
import type { CompetitionGoal, CompetitionStudentStage } from "@/types/competition-recommendation";

export const COMPETITION_GUIDE_SOURCE_CUTOFF = "2026-08-02";
export const COMPETITION_GUIDE_SOURCE_TITLE = "全国大学生最值得参加的竞赛 TOP 50 选赛指南";

export type CompetitionGuideScoreVector = {
  publicCredibility: number;
  campusRecognition: number;
  employmentRelevance: number;
  abilityDevelopment: number;
  coverage: number;
  operationalStability: number;
  outcomeAccumulation: number;
  costFriendliness: number;
  formatFriendliness: number;
  longTermValue: number;
};

export type CompetitionGuideTrace = {
  rank: number;
  catalogId: string;
  score: number;
  grade: "S" | "A" | "B";
  recommendationIndex: number;
  scoreVector: CompetitionGuideScoreVector;
  sourceCutoff: typeof COMPETITION_GUIDE_SOURCE_CUTOFF;
  sourceTitle: typeof COMPETITION_GUIDE_SOURCE_TITLE;
  sourceUrl: string;
  mergeTargetId?: "career-planning" | "business-elite-innovation";
};

const allStudentStages: readonly CompetitionStudentStage[] = [
  "vocational",
  "undergraduate-1",
  "undergraduate-2",
  "undergraduate-3",
  "undergraduate-4",
  "master",
  "doctorate"
];

const secondYearToPostgraduate: readonly CompetitionStudentStage[] = [
  "undergraduate-2",
  "undergraduate-3",
  "undergraduate-4",
  "master",
  "doctorate"
];

const firstYearToSenior: readonly CompetitionStudentStage[] = [
  "undergraduate-1",
  "undergraduate-2",
  "undergraduate-3",
  "undergraduate-4"
];

const secondYearToSenior: readonly CompetitionStudentStage[] = [
  "undergraduate-2",
  "undergraduate-3",
  "undergraduate-4"
];

const vocationalAndUndergraduateStages: readonly CompetitionStudentStage[] = [
  "vocational",
  "undergraduate-1",
  "undergraduate-2",
  "undergraduate-3",
  "undergraduate-4"
];

const challengeCupAcademicStages: readonly CompetitionStudentStage[] = [
  ...vocationalAndUndergraduateStages,
  "master",
  "doctorate"
];

const fltrpEligibleStages: readonly CompetitionStudentStage[] = [
  "undergraduate-1",
  "undergraduate-2",
  "undergraduate-3",
  "undergraduate-4",
  "master"
];

const baseGoalValues: Record<CompetitionGoal, number> = {
  project: 0.65,
  award: 0.65,
  postgraduate: 0.6,
  employment: 0.65,
  portfolio: 0.55,
  entrepreneurship: 0.4,
  networking: 0.45
};

function goals(overrides: Partial<Record<CompetitionGoal, number>>): Record<CompetitionGoal, number> {
  return { ...baseGoalValues, ...overrides };
}

type GuideProfileInput = Pick<
  CompetitionRecommendationMetadata,
  | "stages"
  | "majors"
  | "skills"
  | "interests"
  | "preferredOutputs"
  | "experienceLevels"
  | "evidence"
  | "goalValues"
  | "qualityTaskPrototypeRequired"
  | "difficulty"
  | "weeklyHours"
  | "usefulResources"
> & {
  sourceUrl: string;
  teamRequirement?: CompetitionRecommendationMetadata["teamRequirement"];
  eligibility?: CompetitionRecommendationMetadata["eligibility"];
  fit?: CompetitionRecommendationMetadata["fit"];
  tracks?: CompetitionRecommendationMetadata["tracks"];
  supportingSources?: CompetitionRecommendationMetadata["supportingSources"];
  additionalDataNotices?: readonly string[];
  requiredResources?: CompetitionRecommendationMetadata["requiredResources"];
  helpfulResources?: CompetitionRecommendationMetadata["helpfulResources"];
  schedule?: CompetitionRecommendationMetadata["schedule"];
  dataCompleteness?: number;
};

function guideProfile(input: GuideProfileInput): CompetitionRecommendationMetadata {
  return {
    stages: input.stages,
    regions: { state: "unknown" },
    majors: input.majors,
    skills: input.skills,
    interests: input.interests,
    preferredOutputs: input.preferredOutputs,
    experienceLevels: input.experienceLevels,
    evidence: input.evidence,
    goalValues: input.goalValues,
    ...(input.qualityTaskPrototypeRequired
      ? { qualityTaskPrototypeRequired: true }
      : {}),
    difficulty: input.difficulty,
    weeklyHours: input.weeklyHours,
    participationModes: ["unknown"],
    teamRequirement: input.teamRequirement ?? { state: "unknown" },
    usefulResources: input.usefulResources,
    requiredResources: input.requiredResources ?? [],
    helpfulResources: input.helpfulResources ?? input.usefulResources,
    ...(input.eligibility ? { eligibility: input.eligibility } : {}),
    ...(input.fit ? { fit: input.fit } : {}),
    ...(input.tracks ? { tracks: input.tracks } : {}),
    ...(input.supportingSources ? { supportingSources: input.supportingSources } : {}),
    source: {
      url: input.sourceUrl,
      sourceType: input.eligibility?.source.sourceType ?? "unknown",
      verifiedAt: input.eligibility?.source.verifiedAt ?? COMPETITION_GUIDE_SOURCE_CUTOFF,
      ...(input.eligibility?.source.evidenceRef
        ? { evidenceRef: input.eligibility.source.evidenceRef }
        : {}),
      ...(input.eligibility?.source.facts
        ? { facts: input.eligibility.source.facts }
        : {})
    },
    schedule: input.schedule ?? {
      state: "unknown",
      datePrecision: "unknown",
      verifiedAt: COMPETITION_GUIDE_SOURCE_CUTOFF,
      sourceUrl: input.sourceUrl,
      sourceType: "unknown"
    },
    dataCompleteness: input.dataCompleteness ?? 0.68,
    dataNotices: [
      `指南信息截止至 ${COMPETITION_GUIDE_SOURCE_CUTOFF}，当届赛程请以赛事官网与学校通知为准。`,
      "指南未明确的地区、人数、参赛方式和报名日期均按未知处理。",
      ...(input.additionalDataNotices ?? [])
    ]
  };
}

function verifiedEligibility(
  sourceUrl: string,
  notes: readonly string[],
  options: Pick<
    NonNullable<CompetitionRecommendationMetadata["eligibility"]>,
    | "requiresFullTime"
    | "sameInstitutionTeam"
    | "stageClarificationNotes"
    | "blockingClarifications"
  > & {
    evidenceRef: string;
    facts: NonNullable<CompetitionMetadataSource["facts"]>;
  }
): NonNullable<CompetitionRecommendationMetadata["eligibility"]> {
  const { evidenceRef, facts, ...eligibilityOptions } = options;
  return {
    state: "verified",
    ...eligibilityOptions,
    notes,
    source: {
      url: sourceUrl,
      sourceType: sourceUrl.includes("moe.gov.cn") ? "education-authority" : "official-competition",
      verifiedAt: "2026-08-22",
      evidenceRef,
      facts
    }
  };
}

export const guideCompetitionDisplayEntries = [
  {
    id: "china-international-college-innovation",
    name: "中国国际大学生创新大赛",
    category: "综合创新 / 创业实践",
    direction: "创新创业",
    summary: "面向几乎所有专业，强调真实问题、项目实践、跨学科协作与路演表达。",
    sourceUrl: "https://www.moe.gov.cn/srcsite/A08/s5672/202607/t20260731_1445670.html",
    featured: true,
    detail: {
      intro:
        "面向几乎所有专业，适合已经发现真实问题、有技术方案或服务概念的学生。赛事重点不只是创意，还包括需求验证、项目迭代、团队执行与展示论证。",
      participationPath:
        "通常需要关注教育部、大赛平台及学校创新创业部门通知，根据当届赛道准备项目材料、路演 PPT 和支撑证据，经校级选拔后参与后续阶段。",
      userValue:
        "能够将专业知识转化为可说明、可验证、可迭代的项目，并系统训练用户研究、产品设计、团队协作和现场答辩。",
      suitableFor: ["有真实问题或项目雏形的学生", "可完成技术、设计与商业分工的团队", "愿意长期迭代而非只做材料的参赛者"],
      preparationTips: ["先核对当届赛道、组别和资格要求", "用访谈、数据或实验证明问题与方案", "保留原型、迭代和团队贡献记录"]
    }
  },
  {
    id: "challenge-cup-academic-science",
    name: "“挑战杯”全国大学生课外学术科技作品竞赛",
    category: "学术科技 / 社会调研",
    direction: "学术科研",
    summary: "覆盖自然科学论文、社会调查和科技发明，强调研究过程与证据质量。",
    sourceUrl: "https://www.tiaozhanbei.net/rules",
    featured: true,
    detail: {
      intro:
        "适合理工农医以及人文社科学生，可将实验研究、社会调查或科技发明形成规范作品。评审通常重视问题价值、方法严谨性、原创贡献和作者的真实参与。",
      participationPath:
        "通过大赛官网、学校团委或科研部门获取当届申报要求，围绕合规选题完成论文、调研报告或作品说明及支撑材料，由学校组织选拔。",
      userValue:
        "训练文献检索、研究设计、数据论证和学术表达，成果可沉淀为论文、调研报告、原型或完整实验档案。",
      suitableFor: ["有导师或稳定研究条件的学生", "愿意长期做实证或实验研究的团队", "能说清每个数据和作者贡献的参赛者"],
      preparationTips: ["先核对作品类别与学术规范", "建立可追溯的数据、文献与实验记录", "用反复质询检验研究边界与原创性"]
    }
  },
  {
    id: "national-college-math-modeling",
    name: "全国大学生数学建模竞赛",
    category: "数学建模 / 数据分析",
    direction: "学术科研",
    summary: "面向理工、商科、医学与社科方向，集中训练建模、编程、论文和团队协作。",
    sourceUrl: "https://www.mcm.edu.cn/",
    featured: true,
    detail: {
      intro:
        "适合数学、统计、计算机、工程、经管、医学和部分社科学生。核心是在有限时间内将实际问题转化为可计算模型，完成分析、验证和论文表达。",
      participationPath:
        "关注全国组委会官网与学校数学建模组织通知，在当届规则下完成报名、选题、建模、编程、论文提交与学术规范检查。",
      userValue:
        "能同时训练抽象、定量分析、代码实现和科技写作，并留下模型、代码、数据处理和论文等可复盘成果。",
      suitableFor: ["有数学或数据分析兴趣的学生", "能覆盖建模、编程与写作的团队", "愿意接受高强度限时协作的参赛者"],
      preparationTips: ["提前演练完整限时流程", "建立模型假设、敏感性与验证清单", "严格遵守引用、代码和工具使用规则"]
    }
  },
  {
    id: "challenge-cup-entrepreneurship-plan",
    name: "“挑战杯”中国大学生创业计划竞赛",
    category: "创业计划 / 社会创新",
    direction: "创新创业",
    summary: "适合技术创新、公益创业与产业项目，强调商业计划、调研、路演和资源整合。",
    sourceUrl: "https://www.tiaozhanbei.net/rules2",
    featured: true,
    detail: {
      intro:
        "面向各学科的创新创业团队，适合有技术、产品、服务或社会创新项目的学生。作品需要同时说清问题、解决方案、受益人群、实施路径和可持续性。",
      participationPath:
        "通过挑战杯官网和学校团委获取当届赛道与申报规则，准备商业计划书、用户或行业调研、项目证据和路演材料，按学校选拔流程推进。",
      userValue:
        "将项目从概念推进到有用户、有数据、有执行路线的方案，并训练商业分析、社会价值论证和公开答辩。",
      suitableFor: ["已有创新项目或创业概念的学生", "可跨技术、产品与商业协作的团队", "能够为关键判断提供真实证据的参赛者"],
      preparationTips: ["先选对当届赛道和项目边界", "用真实调研和试点验证关键假设", "让计划书、路演和项目现状保持一致"]
    }
  },
  {
    id: "national-college-electronic-design",
    name: "全国大学生电子设计竞赛",
    category: "电子工程 / 嵌入式",
    direction: "工程与制造",
    summary: "面向电子、通信、自动化等专业，强调电路、嵌入式、系统实现与现场调试。",
    sourceUrl: "https://www.nuedc-training.com.cn/index/news/details/new_id/333",
    featured: true,
    detail: {
      intro:
        "适合电子信息、通信、自动化、电气和嵌入式方向学生。核心是在明确任务约束下完成硬件设计、程序实现、系统联调和性能验证。",
      participationPath:
        "关注赛事官网和学校电子设计竞赛组织通知，先完成校内训练与选拔，按当届题目、器件和时间规则制作作品并接受测评。",
      userValue:
        "可系统检验电路基础、器件选型、嵌入式开发、故障定位和工程取舍，沉淀原理图、代码、实物和测试记录。",
      suitableFor: ["电子、通信、自动化方向学生", "有实验室、仪器和指导条件的团队", "能够承受高强度现场调试的参赛者"],
      preparationTips: ["循序练习模拟、数字与嵌入式模块", "提前建立可复用的硬件与代码库", "记录每次测试条件、故障和修改"]
    }
  },
  {
    id: "icpc-programming",
    name: "ICPC 国际大学生程序设计竞赛",
    category: "算法 / 程序设计",
    direction: "人工智能与物联",
    summary: "面向计算机、软件和人工智能方向，强调算法、编码、限时决策与团队配合。",
    sourceUrl: "https://icpc.global/regionals/rules/",
    featured: true,
    detail: {
      intro:
        "适合计算机、软件工程、人工智能和数学方向的程序设计学生。竞赛聚焦数据结构、算法设计、代码正确性、解题速度和团队策略。",
      participationPath:
        "通过区域官方站点、学校 ACM/ICPC 集训队或学院通知了解资格、选拔和赛站安排，长期进行专题训练、模拟赛和队内分工。",
      userValue:
        "能大幅提升算法思维、边界意识、代码实现和压力下协作，对算法开发与相关技术学习有直接训练价值。",
      suitableFor: ["对算法与编程有持续兴趣的学生", "愿意长期参与集训和模拟赛的参赛者", "能够建立稳定沟通与角色分工的团队"],
      preparationTips: ["按知识树系统训练并复盘错题", "定期做完整时长的团队模拟赛", "统一代码模板、提交策略和队内沟通方式"]
    }
  },
  {
    id: "market-research-analysis",
    name: "全国大学生市场调查与分析大赛",
    category: "市场调研 / 商业分析",
    direction: "商业与职业",
    summary: "适合商科、统计、社会学、新闻与心理方向，聚焦真实调研、数据和报告。",
    sourceUrl: "https://www.china-cssc.org/show-568-1912-1.html",
    featured: false,
    detail: {
      intro:
        "适合市场营销、统计、经济管理、社会学、新闻传播、心理和数据方向学生。核心是围绕真实问题设计调研，获取数据并形成可执行结论。",
      participationPath:
        "从学校统计、经管类院系或教务通知获取当届要求，围绕明确的研究问题完成方案、抽样、问卷或访谈、统计分析、报告和答辩。",
      userValue:
        "能训练从问题定义到数据解释的完整研究链条，成果可沉淀为调研报告、数据集、分析代码和演示材料。",
      suitableFor: ["对用户、市场或社会问题有兴趣的学生", "具备调研、数据和写作分工的团队", "愿意为数据质量投入时间的参赛者"],
      preparationTips: ["先把研究问题缩小到可调查范围", "进行预调研并检查抽样偏差", "让每个结论都能回到数据和方法"]
    }
  },
  {
    id: "understanding-contemporary-china-foreign-language",
    name: "外研社·国才杯“理解当代中国”全国大学生外语能力大赛",
    category: "外语能力 / 跨文化传播",
    direction: "语言人文",
    summary: "面向外语、翻译和国际传播方向，强调演讲、翻译、阅读与综合语言应用。",
    sourceUrl: "https://ucc.fltrp.com/c/2026-04-15/517928.shtml",
    featured: false,
    detail: {
      intro:
        "适合外语、翻译、国际传播以及希望提升外语表达的学生。赛事关注语言基础、中国议题理解、跨文化转换和现场沟通能力。",
      participationPath:
        "关注大赛官网和学校外语院系通知，根据当届赛项选择综合能力、演讲、翻译或相关方向，完成校级选拔与后续赛事。",
      userValue:
        "系统训练阅读、思辨、双语转换、即兴表达和跨文化叙事，并留下演讲稿、翻译作品和展示视频等成果。",
      suitableFor: ["外语、翻译或国际传播方向学生", "有稳定语言训练习惯的参赛者", "愿意研究中国议题并接受现场质询的学生"],
      preparationTips: ["先核对赛项、语种与评分标准", "按话题积累双语素材与可核验事实", "反复演练限时输出、即兴问答和发音"]
    }
  },
  {
    id: "energy-conservation-emission-reduction",
    name: "全国大学生节能减排社会实践与科技竞赛",
    category: "节能减排 / 低碳实践",
    direction: "工程与制造",
    summary: "面向能源、环境、工程和经管方向，聚焦低碳技术、社会实践与成果论证。",
    sourceUrl: "https://jwc.scu.edu.cn/info/1069/9808.htm",
    featured: false,
    detail: {
      intro:
        "适合能源、环境、化工、机械、材料、建筑、经济管理等学生。项目可围绕节能技术、减排装置、资源循环、低碳调研和管理方案展开。",
      participationPath:
        "通过学校教务、能源或环境类院系获取当届通知，根据作品类型完成技术原型、实验数据或社会调研报告及展示材料。",
      userValue:
        "将工程设计或社会调研与可量化的节能减排效果结合，训练实验、测算、生命周期意识和公开表达。",
      suitableFor: ["能源、环境与低碳方向学生", "有原型、实验或真实调研条件的团队", "愿意量化项目环境效益的参赛者"],
      preparationTips: ["明确基准情景和节能减排指标", "用实验或调研数据验证核心结论", "同时说明安全、成本和规模化边界"]
    }
  },
  {
    id: "ecommerce-innovation-creativity-entrepreneurship",
    name: "全国大学生电子商务“创新、创意及创业”挑战赛",
    category: "电子商务 / 数字商业",
    direction: "创新创业",
    summary: "面向电商、商科、产品和技术团队，强调商业计划、产品、运营与路演。",
    sourceUrl: "https://www.3chuang.net/",
    featured: false,
    detail: {
      intro:
        "适合电子商务、市场营销、工商管理、计算机、设计和乡村振兴等方向学生。项目需要将创意转化为产品、运营或创业方案。",
      participationPath:
        "关注三创赛官网和学校创新创业通知，根据当届赛道完成组队、项目计划、产品或运营证据、路演 PPT 和答辩准备。",
      userValue:
        "训练用户需求、电商模式、产品设计、流量运营、数据分析和商业表达，可留下计划书、产品原型与运营记录。",
      suitableFor: ["对电商、数字营销或产品有兴趣的学生", "能组成商业、设计与技术分工的团队", "愿意用实际运营数据验证方案的参赛者"],
      preparationTips: ["先核对赛道和项目提交清单", "尽早完成最小可验证产品或运营试验", "不用虚构数据替代真实用户反馈"]
    }
  },
  {
    id: "smart-car",
    name: "全国大学生智能汽车竞赛",
    category: "智能车 / 控制与嵌入式",
    direction: "人工智能与物联",
    summary: "面向自动化、电子、计算机和机器人方向，聚焦传感、控制、嵌入式与系统调试。",
    sourceUrl: "https://www.smartcar.zone/",
    featured: false,
    detail: {
      intro:
        "适合自动化、电子信息、计算机、控制和机器人方向学生。作品需要在硬件平台上完成感知、决策、控制和运动性能的综合优化。",
      participationPath:
        "通过赛事官网和学校智能车实验室获取当届组别、平台和技术规则，循序完成机械、电气、算法、整车联调和测试。",
      userValue:
        "能形成从传感器、嵌入式软件到运动控制的完整实践，突出训练故障定位、参数优化和工程协作。",
      suitableFor: ["自动化、电子、计算机或机器人方向学生", "有设备、场地和持续调试条件的团队", "愿意从失败测试中反复迭代的参赛者"],
      preparationTips: ["先核对当届组别、车模与硬件限制", "将感知、控制和机械问题分层测试", "保留参数、环境和故障的完整日志"]
    }
  },
  {
    id: "china-college-computer-design",
    name: "中国大学生计算机设计大赛",
    category: "计算机应用 / 数字作品",
    direction: "创意与数字",
    summary: "覆盖软件应用、人工智能和数字媒体，强调作品完成度与展示表达。",
    sourceUrl: "https://jsjds.com.cn/",
    featured: false,
    detail: {
      intro:
        "适合计算机、软件、人工智能、数字媒体、动画和信息可视化方向学生。赛事类别较多，选赛时应以团队的真实技能和可交付作品为核心。",
      participationPath:
        "2026 国赛作品须经省赛推荐。先查所在省赛和学校通知，再按类别准备软件、数字内容、作品说明、演示或答辩材料。",
      userValue:
        "有助于完成一件可运行、可演示的计算机或数字作品，训练需求分析、实现、内容组织、交互与公开讲解。",
      suitableFor: ["计算机、软件或数字媒体方向学生", "希望用比赛完成作品集项目的参赛者", "能够平衡技术实现与内容表达的团队"],
      preparationTips: ["先核对当届类别和作品格式", "尽早做出可运行的最小版本", "检查素材授权、代码原创性和演示稳定性"]
    }
  },
  {
    id: "china-software-cup",
    name: "中国软件杯大学生软件设计大赛",
    category: "软件工程 / 产业命题",
    direction: "人工智能与物联",
    summary: "面向软件、计算机与人工智能方向，以产业命题驱动软件系统和工程文档。",
    sourceUrl: "https://www.cnsoftbei.com/",
    featured: false,
    detail: {
      intro:
        "适合软件工程、计算机、数据科学和人工智能方向学生。题目往往来自产业需求，需要团队完成可运行系统、工程文档和展示。",
      participationPath:
        "关注大赛官网和学校软件类院系通知，根据当届命题选择技术栈，完成需求分析、系统设计、开发测试、代码和文档提交。",
      userValue:
        "能将课程知识放入较完整的工程流程，训练协作开发、系统架构、测试、性能与产品化表达。",
      suitableFor: ["软件、计算机或 AI 方向学生", "能够持续协作开发和提交文档的团队", "愿意围绕产业命题迭代实际系统的参赛者"],
      preparationTips: ["先读懂命题约束与验收指标", "尽早建立可测试、可部署的主干版本", "保留代码、文档、测试和团队贡献记录"]
    }
  },
  {
    id: "information-security",
    name: "全国大学生信息安全竞赛",
    category: "网络安全 / 攻防与创新",
    direction: "人工智能与物联",
    summary: "面向网络安全、计算机、软件和通信方向，聚焦攻防、密码、安全工具与创新作品。",
    sourceUrl: "https://www.ciscn.cn/competition/securityCompetition?compet_id=43",
    featured: false,
    detail: {
      intro:
        "适合网络空间安全、计算机、软件、通信和密码方向学生。不同方向可关注安全创新作品、网络攻防、漏洞分析与安全工程。",
      participationPath:
        "通过大赛官网和学校网安学院或竞赛队通知核对当届方向，在授权环境中完成知识训练、工具开发、攻防演练或作品提交。",
      userValue:
        "训练网络、系统、编程、密码和安全分析的综合能力，可沉淀工具、代码、攻防报告和创新系统。",
      suitableFor: ["网安、计算机、软件或通信方向学生", "愿意长期训练并跟进知识更新的参赛者", "能严格遵守授权边界与安全伦理的团队"],
      preparationTips: ["先核对赛道、环境和工具规则", "只在授权环境中进行攻防测试", "对每个安全结论保留可复现过程与修复建议"]
    }
  },
  {
    id: "integrated-circuit-innovation",
    name: "全国大学生集成电路创新创业大赛",
    category: "集成电路 / EDA 与芯片",
    direction: "工程与制造",
    summary: "面向微电子、集成电路、电子和计算机方向，聚焦芯片设计、验证与企业命题。",
    sourceUrl: "https://univ.ciciec.com/",
    featured: false,
    detail: {
      intro:
        "适合微电子、集成电路、电子信息、自动化和计算机体系结构方向学生。赛题往往需要芯片、EDA、FPGA、模拟或系统验证能力。",
      participationPath:
        "关注大赛官网和学校集成电路类学院通知，按当届赛题准备工具链、设计文件、仿真或硬件验证、技术报告与展示。",
      userValue:
        "能将数字、模拟电路与计算机系统知识放入真实设计流程，沉淀源码、模型、波形、验证报告和技术文档。",
      suitableFor: ["微电子、芯片、电子或计算机方向学生", "有 EDA、FPGA 或硬件验证条件的团队", "愿意进行长周期设计与验证的参赛者"],
      preparationTips: ["先核对企业赛题、工具链和知识产权要求", "将功能正确性、性能和资源消耗分层验证", "保留可复现的脚本、波形和测试记录"]
    }
  },
  {
    id: "advanced-graphics-bim",
    name: "全国大学生先进成图技术与产品信息建模创新大赛",
    category: "工程成图 / BIM 建模",
    direction: "工程与制造",
    summary: "面向机械、建筑、土木和产品设计方向，强调 CAD、BIM、建模和工程表达。",
    sourceUrl: "https://www.chengtudasai.com/",
    featured: false,
    detail: {
      intro:
        "适合机械、土木、建筑、水利、道路桥梁和产品设计方向学生。核心是准确理解工程对象，用二维成图、三维建模或 BIM 表达设计信息。",
      participationPath:
        "通过赛事官网和学校工程图学课程组获取当届类别与软件规则，进行规范、识图、建模、限时操作和作品创新训练。",
      userValue:
        "能系统提升工程图样规范、空间想象、数字建模和设计沟通能力，并留下模型、图纸与信息化成果。",
      suitableFor: ["机械、建筑、土木或工业设计方向学生", "正在学习 CAD、BIM 或三维建模的参赛者", "能够按规范细致检查作品的团队"],
      preparationTips: ["先核对类别、图学规范与软件版本", "同时训练识图正确性和操作速度", "提交前检查单位、尺寸、命名与文件兼容性"]
    }
  },
  {
    id: "national-college-industrial-design",
    name: "全国大学生工业设计大赛",
    category: "工业设计 / 产品创新",
    direction: "创意与数字",
    summary: "面向工业设计、产品设计与工程方向，强调用户研究、产品方案、模型与作品集。",
    sourceUrl: "https://www.cuidc.net/",
    featured: false,
    detail: {
      intro:
        "适合工业设计、产品设计、交互设计、机械和材料方向学生。作品应建立在真实用户与使用情境上，兼顾造型、功能、人机、材料和制造可行性。",
      participationPath:
        "通过大赛官网和学校设计院系通知选择当届命题或类别，准备用户研究、概念推演、模型或样机、展板和设计说明。",
      userValue:
        "训练从用户洞察到产品定义、形态推演、模型验证与视觉叙事的完整过程，直接沉淀作品集素材。",
      suitableFor: ["工业、产品或交互设计方向学生", "希望深化作品集中产品项目的参赛者", "能把调研、工程与视觉表达联系起来的团队"],
      preparationTips: ["先核对当届命题、类别与授权要求", "用真实用户研究推导设计判断", "同步检查模型、展板和产品逻辑的一致性"]
    }
  },
  {
    id: "future-designer-ncda",
    name: "未来设计师·全国高校数字艺术设计大赛",
    category: "数字艺术 / 视觉与新媒体",
    direction: "创意与数字",
    summary: "面向视觉、数字媒体、动画和交互方向，以数字作品、创意表达和作品集为核心。",
    sourceUrl: "https://www.ncda.org.cn/",
    featured: false,
    detail: {
      intro:
        "适合视觉传达、数字媒体、动画、交互、影视、环境和服装等设计方向学生。赛事类别广，选题应突出创意逻辑、完整制作和语境化表达。",
      participationPath:
        "通过大赛官网和学校设计类院系获取当届分类、命题和提交格式，完成设计调研、创意发展、数字制作、版权检查和作品说明。",
      userValue:
        "能将课程习作发展为完整数字作品，训练设计叙事、软件工具、视觉系统和作品集编辑。",
      suitableFor: ["视觉、数媒、动画或交互方向学生", "已有作品雏形并希望系统打磨的参赛者", "重视素材版权与原创过程的团队"],
      preparationTips: ["选择与团队工具能力匹配的类别", "从概念、过程到成品保留迭代证据", "提交前检查版权、尺寸、色彩与视频编码"]
    }
  },
  {
    id: "energy-economics-academic-creativity",
    name: "全国大学生能源经济学术创意大赛",
    category: "能源经济 / 低碳政策",
    direction: "学术科研",
    summary: "面向经济、管理、能源、环境和统计方向，聚焦论文、政策、数据模型与低碳议题。",
    sourceUrl: "https://energy.qibebt.ac.cn/eneco/contribution/",
    featured: false,
    detail: {
      intro:
        "适合经济、管理、能源、环境、统计和公共政策方向学生。可围绕能源市场、双碳政策、产业转型、能效与公平转型开展数据或政策研究。",
      participationPath:
        "关注大赛投稿系统和学校经管、能源类院系通知，根据当届类别完成研究问题、文献、数据、模型、论文或政策报告。",
      userValue:
        "将能源与低碳议题转化为可分析的经济、管理或政策问题，训练实证研究、政策判断和学术写作。",
      suitableFor: ["经济、管理、能源或环境方向学生", "对双碳和能源转型有研究兴趣的参赛者", "愿意处理数据并认真写作的团队"],
      preparationTips: ["先将宏观议题缩小为可验证问题", "说明数据来源、识别策略与研究局限", "让政策建议与实证结果严格对应"]
    }
  },
  {
    id: "national-college-logistics-design",
    name: "全国大学生物流设计大赛",
    category: "物流 / 供应链设计",
    direction: "商业与职业",
    summary: "面向物流、供应链、管理科学与数据方向，以企业案例、优化方案和答辩为核心。",
    sourceUrl: "https://dspt.clppx.org.cn/",
    featured: false,
    detail: {
      intro:
        "适合物流管理、供应链、管理科学、信息管理、交通运输和数据科学方向学生。通常需要从真实企业案例中识别系统瓶颈并提出方案。",
      participationPath:
        "通过大赛或学校经管类院系通知获取当届企业案例，完成问题诊断、数据分析、流程或网络优化、实施评估、方案报告和答辩。",
      userValue:
        "训练供应链思维、运筹优化、数据分析和商业表达，成果可沉淀为供应链方案、模型、数据文件和答辩材料。",
      suitableFor: ["物流、供应链、信管或运筹方向学生", "希望接触真实企业问题的参赛者", "能把定量模型与管理方案结合的团队"],
      preparationTips: ["先绘制案例中的端到端流程", "区分数据事实、假设与外部参考", "对方案的成本、效率、风险和实施条件做权衡"]
    }
  },
  {
    id: "china-college-computer-contest",
    name: "中国高校计算机大赛—网络技术挑战赛",
    category: "计算机网络 / 网络应用",
    direction: "人工智能与物联",
    summary: "聚焦网络技术研究、设计开发与应用管理，不代表中国高校计算机大赛的其他赛项。",
    sourceUrl: "https://net.c4best.cn/",
    featured: false,
    detail: {
      intro:
        "当前目录来源只对应中国高校计算机大赛—网络技术挑战赛，适合计算机网络、网络工程和网络应用方向学生；不能据此泛化为人工智能、大数据或软件类全部赛项。",
      participationPath:
        "从网络技术挑战赛官网或学校计算机学院通知获取当届 A、B 组及具体赛项要求，按赛项准备网络技术作品、方案、演示材料和技术报告。",
      userValue:
        "围绕网络技术完成研究、设计、开发或应用管理实践，并沉淀可演示、可复核的网络方案与工程成果。",
      suitableFor: ["计算机网络或网络工程方向学生", "已有网络系统、协议或应用实践的参赛者", "希望完成网络技术工程项目的团队"],
      preparationTips: ["先核对网络技术挑战赛的具体组别与赛项", "不要用中国高校计算机大赛总名替代分赛项规则", "保留配置、代码、测试指标和演示环境记录"]
    }
  },
  {
    id: "robocon",
    name: "全国大学生机器人大赛 ROBOCON",
    category: "机器人 / 机电系统",
    direction: "人工智能与物联",
    summary: "面向机器人、机电、控制和计算机方向，聚焦大型机器人、系统集成与赛事工程。",
    sourceUrl: "https://www.robocon.org.cn/",
    featured: false,
    detail: {
      intro:
        "适合机器人、机械、自动化、电子和计算机方向学生。赛题往往要求团队完成复杂机器人的机械、电控、感知、决策和场上协同。",
      participationPath:
        "通过大赛官网和学校机器人基地获取当届赛题，组织长周期的系统设计、加工、电控开发、联调、对抗测试和赛场运维。",
      userValue:
        "能完整经历大型复杂工程系统的需求分解、子系统集成、版本管理、可靠性验证和现场快速故障处理。",
      suitableFor: ["机器人、机械、自动化或计算机方向学生", "有实验室、加工和长期指导条件的团队", "能够在长周期项目中稳定协作的参赛者"],
      preparationTips: ["先将赛题拆成可独立验收的子系统", "把安全、可靠性和快速维修纳入设计", "用高频完整模拟检验系统集成问题"]
    }
  },
  {
    id: "robocup-china",
    name: "中国机器人大赛暨 RoboCup 机器人世界杯中国赛",
    category: "机器人 / 人工智能",
    direction: "人工智能与物联",
    summary: "面向机器人、人工智能与控制方向，强调自主系统、视觉、决策和国际化赛项衔接。",
    sourceUrl: "https://www.caa.org.cn/Content/33.html",
    featured: false,
    detail: {
      intro:
        "适合机器人、人工智能、自动化、计算机视觉和机电方向学生。不同赛项可涉及机器人足球、救援、服务、仿真与自主系统。",
      participationPath:
        "通过中国自动化学会赛事页面、赛事组织和学校机器人实验室获取当届赛项规则，选择平台后完成算法、硬件、联调和模拟对抗。",
      userValue:
        "能深入训练感知、定位、规划、控制与多机协同，并将算法效果放到动态、不确定的赛场环境中验证。",
      suitableFor: ["机器人、AI、视觉或控制方向学生", "有机器人平台或仿真条件的团队", "希望接触国际化技术规则的参赛者"],
      preparationTips: ["先核对具体赛项而非只看总赛名", "用仿真和真机分层验证算法", "建立场景测试集、性能指标和可回滚版本"]
    }
  },
  {
    id: "siemens-intelligent-manufacturing",
    name: "“西门子杯”中国智能制造挑战赛",
    category: "智能制造 / 工业自动化",
    direction: "工程与制造",
    summary: "面向自动化、工业软件和智能制造方向，聚焦 PLC、控制、数字孪生与企业工程。",
    sourceUrl: "https://www.siemenscup-cimc.org.cn/",
    featured: false,
    detail: {
      intro:
        "适合自动化、电气、机械电子、工业工程、软件和智能制造方向学生。赛题通常与工业控制、生产过程、仿真和数字化工厂相关。",
      participationPath:
        "关注大赛官网和学校自动化、机电类院系通知，根据当届赛项完成工业平台学习、方案设计、程序仿真、设备联调和答辩。",
      userValue:
        "训练工业控制逻辑、PLC 或相关工业软件、系统集成、数字孪生和工程验证，形成与产业场景接近的项目成果。",
      suitableFor: ["自动化、电气、机电或智造方向学生", "可获得工业软件或设备实训条件的团队", "希望将控制知识用于真实工业问题的参赛者"],
      preparationTips: ["先核对赛项平台、软件版本和设备要求", "用仿真验证后再进入真实设备联调", "记录工艺假设、控制逻辑、异常和安全策略"]
    }
  },
  {
    id: "lanqiao-cup",
    name: "蓝桥杯全国大学生软件和信息技术大赛",
    category: "编程 / 软件与电子",
    direction: "人工智能与物联",
    summary: "面向编程、软件、电子和 AI 方向，便于从个人赛和细分组别开始实践。",
    sourceUrl: "https://dasai.lanqiao.cn/",
    featured: false,
    detail: {
      intro:
        "适合计算机、软件、数据、电子和人工智能方向学生。赛事设有多个软件、嵌入式或设计类组别，适合按自身基础选择切入点。",
      participationPath:
        "通过蓝桥杯官网或学校报名通知选择当届科目与组别，按官方练习环境进行专题训练、模拟测试和参赛环境检查。",
      userValue:
        "为编程基础、算法实现、嵌入式或数字设计提供明确训练目标，并通过限时题目检验准确性与速度。",
      suitableFor: ["希望从明确科目开始竞赛练习的学生", "有编程、电子或数字设计基础的参赛者", "能按计划稳定练习和复盘错题的学生"],
      preparationTips: ["先核对科目、组别和开发环境", "按题型建立错题集和时间分配策略", "用完整模拟检查输入输出、边界和环境熟悉度"]
    }
  },
  {
    id: "21st-century-english-speaking",
    name: "中国日报社“21 世纪杯”全国英语演讲比赛",
    category: "英语演讲 / 国际传播",
    direction: "语言人文",
    summary: "面向英语演讲与国际传播方向，强调主题演讲、即兴表达、问答和现场感染力。",
    sourceUrl: "https://contest.i21st.cn/college/",
    featured: false,
    detail: {
      intro:
        "面向希望提升英语演讲、思辨与国际传播能力的在校学生。评价不只看语言准确性，也关注观点、结构、现场反应和受众沟通。",
      participationPath:
        "通过大赛高校组官网和学校外语院系通知核对当届组别与流程，围绕官方主题准备演讲，并持续训练即兴题、追问和发音。",
      userValue:
        "能系统提升英语口语、公开演讲、观点构建、即兴反应和跨文化表达，沉淀演讲稿、录像和口语训练记录。",
      suitableFor: ["英语、传播或国际交流方向学生", "希望提升公开表达与即兴能力的参赛者", "能长期训练并接受高频反馈的学生"],
      preparationTips: ["先核对组别、主题与视频要求", "用可核验事实和个人观察支撑观点", "同时训练定题演讲、即兴表达和追问"]
    }
  },
  {
    id: "icbc-fintech-innovation",
    name: "“工行杯”全国大学生金融科技创新大赛",
    category: "金融科技 / 产品创新",
    direction: "商业与职业",
    summary: "面向金融、经济、计算机与数据方向，强调金融场景、产品设计、数据和路演。",
    sourceUrl: "https://www.gonghangbei.com/",
    featured: false,
    detail: {
      intro:
        "适合金融、经济、管理、计算机、数据科学和产品设计方向学生。项目需要从真实金融场景出发，平衡用户价值、技术可行性、风险与合规。",
      participationPath:
        "通过大赛官网和学校金融、创新创业类院系通知获取当届命题，完成用户调研、金融场景分析、产品方案、数据或原型验证和路演。",
      userValue:
        "训练将金融业务、数据技术和产品方法结合，能沉淀场景报告、产品原型、模型或计划书与答辩材料。",
      suitableFor: ["金融、经济、计算机或数据方向学生", "对金融场景与产品创新有兴趣的参赛者", "能同时考虑用户、技术、风险和合规的团队"],
      preparationTips: ["先核对当届命题、数据与知识产权要求", "从可验证的小场景开始而非泛化讲平台", "在方案中明确数据边界、风险控制与合规前提"]
    }
  }
] as const satisfies readonly CompetitionSourceDisplay[];

export type GuideCompetitionId = (typeof guideCompetitionDisplayEntries)[number]["id"];

export const guideCompetitionRecommendationProfiles = {
  "china-international-college-innovation": guideProfile({
    stages: { state: "known", values: vocationalAndUndergraduateStages },
    teamRequirement: { state: "known", mode: "team", minSize: 3, maxSize: 15 },
    majors: ["computer-science", "business", "design", "engineering", "medicine", "mathematics", "humanities", "other"],
    skills: ["research", "product", "design", "writing", "presentation"],
    interests: ["innovation", "entrepreneurship", "career"],
    preferredOutputs: ["prototype", "business-plan", "presentation"],
    experienceLevels: ["participated", "project-or-award"],
    evidence: ["project", "prototype"],
    goalValues: goals({ project: 1, award: 1, entrepreneurship: 1, employment: 0.9, networking: 0.9 }),
    difficulty: "challenge",
    weeklyHours: ["over-10"],
    usefulResources: ["mentor", "lab", "equipment", "data", "budget"],
    helpfulResources: ["mentor", "lab", "equipment", "data", "budget"],
    eligibility: verifiedEligibility(
      "https://www.moe.gov.cn/srcsite/A08/s5672/202607/t20260731_1445670.html",
      ["全体成员不超过35岁，团队3–15名实际核心成员。", "往年总决赛获奖项目不可再报，且每个项目只能报一个赛道。"],
      {
        requiresFullTime: true,
        blockingClarifications: [
          "全体成员是否不超过35周岁尚未由固定问卷确认。",
          "项目是否存在往届总决赛获奖或重复报赛情形尚未确认。"
        ],
        evidenceRef: "official:china-international-college-innovation:2026-08-22",
        facts: ["stages", "teamRequirement", "eligibility", "trackEligibility"]
      }
    ),
    fit: { signals: ["venture-readiness"], startingPoints: ["prototype", "validated"] },
    dataCompleteness: 0.97,
    tracks: [
      {
        id: "undergraduate-creative",
        label: "高教主赛道本科生创意组",
        preferenceQuestionEligible: false,
        stages: { state: "known", values: firstYearToSenior },
        fitSignals: ["venture-readiness"],
        eligibilityNotes: ["申报人学段和项目未完成工商等各类登记注册的事实共同决定该组别。"],
        blockingClarifications: ["项目是否已完成工商等各类登记注册尚未由固定问卷确认。"],
        evidenceRef: "official:china-international-college-innovation:2026-08-22",
        verifiedFacts: ["stages", "eligibility"]
      },
      {
        id: "undergraduate-startup",
        label: "高教主赛道本科生创业组",
        preferenceQuestionEligible: false,
        stages: { state: "known", values: firstYearToSenior },
        fitSignals: ["venture-readiness"],
        eligibilityNotes: ["申报人学段和项目已完成工商等各类登记注册的事实共同决定该组别。"],
        blockingClarifications: ["项目是否已完成工商等各类登记注册尚未由固定问卷确认。"],
        evidenceRef: "official:china-international-college-innovation:2026-08-22",
        verifiedFacts: ["stages", "eligibility"]
      },
      {
        id: "graduate-creative",
        label: "高教主赛道研究生创意组",
        preferenceQuestionEligible: false,
        stages: { state: "known", values: ["master", "doctorate"] },
        fitSignals: ["venture-readiness"],
        eligibilityNotes: ["申报人学段和项目未完成工商等各类登记注册的事实共同决定该组别。"],
        blockingClarifications: ["项目是否已完成工商等各类登记注册尚未由固定问卷确认。"],
        evidenceRef: "official:china-international-college-innovation:2026-08-22",
        verifiedFacts: ["stages", "eligibility"]
      },
      {
        id: "graduate-startup",
        label: "高教主赛道研究生创业组",
        preferenceQuestionEligible: false,
        stages: { state: "known", values: ["master", "doctorate"] },
        fitSignals: ["venture-readiness"],
        eligibilityNotes: ["申报人学段和项目已完成工商等各类登记注册的事实共同决定该组别。"],
        blockingClarifications: ["项目是否已完成工商等各类登记注册尚未由固定问卷确认。"],
        evidenceRef: "official:china-international-college-innovation:2026-08-22",
        verifiedFacts: ["stages", "eligibility"]
      },
      {
        id: "vocational-creative",
        label: "职教赛道创意组",
        preferenceQuestionEligible: false,
        stages: { state: "known", values: ["vocational"] },
        fitSignals: ["venture-readiness"],
        eligibilityNotes: ["申报人的职业教育学段和项目未完成工商等各类登记注册的事实共同决定该组别。"],
        blockingClarifications: ["项目是否已完成工商等各类登记注册尚未由固定问卷确认。"],
        evidenceRef: "official:china-international-college-innovation:2026-08-22",
        verifiedFacts: ["stages", "eligibility"]
      },
      {
        id: "vocational-startup",
        label: "职教赛道创业组",
        preferenceQuestionEligible: false,
        stages: { state: "known", values: ["vocational"] },
        fitSignals: ["venture-readiness"],
        eligibilityNotes: ["申报人的职业教育学段和项目已完成工商等各类登记注册的事实共同决定该组别。"],
        blockingClarifications: ["项目是否已完成工商等各类登记注册尚未由固定问卷确认。"],
        evidenceRef: "official:china-international-college-innovation:2026-08-22",
        verifiedFacts: ["stages", "eligibility"]
      }
    ],
    schedule: {
      state: "scheduled",
      edition: "2026",
      registrationStart: "2026-08-10",
      registrationEnd: "2026-09-25",
      competitionStart: "2026-07-01",
      competitionEnd: "2026-11-30",
      datePrecision: "day",
      verifiedAt: "2026-08-22",
      sourceUrl: "https://www.moe.gov.cn/srcsite/A08/s5672/202607/t20260731_1445670.html",
      sourceType: "education-authority"
    },
    sourceUrl: "https://www.moe.gov.cn/srcsite/A08/s5672/202607/t20260731_1445670.html"
  }),
  "challenge-cup-academic-science": guideProfile({
    stages: { state: "known", values: challengeCupAcademicStages },
    teamRequirement: { state: "known", mode: "either" },
    majors: ["computer-science", "business", "design", "engineering", "medicine", "mathematics", "humanities", "other"],
    skills: ["research", "data-analysis", "writing", "presentation"],
    interests: ["academic-research", "innovation", "data"],
    preferredOutputs: ["research-paper", "prototype", "presentation"],
    experienceLevels: ["participated", "project-or-award"],
    evidence: ["project", "paper", "prototype"],
    goalValues: goals({ project: 0.95, award: 1, postgraduate: 1, employment: 0.8, networking: 0.8 }),
    difficulty: "challenge",
    weeklyHours: ["over-10"],
    usefulResources: ["mentor", "lab", "equipment", "data", "budget"],
    helpfulResources: ["mentor", "lab", "equipment", "data", "budget"],
    eligibility: verifiedEligibility(
      "https://www.tiaozhanbei.net/rules",
      ["全日制非成人专科、本科、硕士可报，无统一年级禁入。", "毕业设计、课程/学年/学位论文及教师成果包装不得申报。"],
      {
        requiresFullTime: true,
        blockingClarifications: [
          "作品是否属于禁止申报的毕业设计、课程或学位论文及教师成果包装尚未确认。"
        ],
        stageClarificationNotes: {
          doctorate: "博士阶段仅有硕博连读或直博生未通过博士资格考试等章程替代通道时，才可按硕士生学历申报；当前固定问卷无法确认该事实。"
        },
        evidenceRef: "official:challenge-cup-academic-science:2026-08-22",
        facts: ["stages", "teamRequirement", "eligibility", "trackEligibility"]
      }
    ),
    fit: { signals: ["research-provenance"] },
    dataCompleteness: 0.95,
    tracks: [
      { id: "natural-science-paper", label: "自然科学类学术论文", stages: { state: "known", values: vocationalAndUndergraduateStages }, fitSignals: ["research-provenance"] },
      { id: "social-survey", label: "哲学社会科学类社会调查报告", stages: { state: "known", values: challengeCupAcademicStages }, fitSignals: ["field-research", "research-provenance"] },
      { id: "technology-invention", label: "科技发明制作", stages: { state: "known", values: challengeCupAcademicStages }, fitSignals: ["research-provenance"] }
    ],
    sourceUrl: "https://www.tiaozhanbei.net/rules"
  }),
  "national-college-math-modeling": guideProfile({
    stages: { state: "known", values: allStudentStages },
    teamRequirement: { state: "known", mode: "either", minSize: 1, maxSize: 3 },
    majors: ["computer-science", "business", "engineering", "medicine", "mathematics", "humanities", "other"],
    skills: ["programming", "data-analysis", "research", "writing"],
    interests: ["data", "academic-research", "innovation"],
    preferredOutputs: ["research-paper", "software"],
    experienceLevels: ["none", "participated", "project-or-award"],
    evidence: ["project", "paper"],
    goalValues: goals({ project: 0.9, award: 1, postgraduate: 1, employment: 0.9 }),
    difficulty: "challenge",
    weeklyHours: ["5-10", "over-10"],
    usefulResources: ["mentor", "data"],
    helpfulResources: ["mentor", "data"],
    eligibility: verifiedEligibility(
      "https://www.mcm.edu.cn/upload_cn/node/779/D3txF20S95f4041e22b41b4a1f9e0e22ac8a1389.pdf",
      ["2026第一次通知明确参赛队由同一学校1至3名大学生组成。", "本科组面向所有大学生；高职高专学生也可自愿参加本科组。"],
      {
        sameInstitutionTeam: true,
        blockingClarifications: [
          "赛区人数执行口径（部分赛区要求3人）尚未确认。"
        ],
        evidenceRef: "official:national-college-math-modeling:2026-08-22",
        facts: ["teamRequirement", "eligibility", "trackEligibility"]
      }
    ),
    fit: { signals: ["modeling-intensive"] },
    dataCompleteness: 0.96,
    additionalDataNotices: ["学校统一报名属于报名流程，请按所在赛区和学校通知办理。"],
    supportingSources: [
      {
        url: "https://www.mcm.edu.cn/html_cn/block/44e92058f537729c6b6a62a3662ee417.html",
        sourceType: "organizer",
        verifiedAt: "2026-08-25",
        evidenceRef: "official:national-college-math-modeling:current-charter",
        facts: ["stages", "eligibility"]
      },
      {
        url: "https://www.cmathc.org.cn/mcm/sqdt/522.html",
        sourceType: "organizer",
        verifiedAt: "2026-08-25",
        evidenceRef: "official:national-college-math-modeling:yunnan-2026",
        facts: ["teamRequirement", "eligibility"]
      },
      {
        url: "https://www.cmathc.org.cn/mcm/sqdt/421.html",
        sourceType: "organizer",
        verifiedAt: "2026-08-25",
        evidenceRef: "official:national-college-math-modeling:jiangsu-2026",
        facts: ["teamRequirement", "eligibility"]
      }
    ],
    tracks: [
      {
        id: "undergraduate-group",
        label: "本科组",
        preferenceQuestionEligible: false,
        stages: { state: "known", values: vocationalAndUndergraduateStages }
      },
      {
        id: "vocational-group",
        label: "高职高专组",
        preferenceQuestionEligible: false,
        stages: { state: "known", values: ["vocational"] }
      }
    ],
    sourceUrl: "https://www.mcm.edu.cn/upload_cn/node/779/D3txF20S95f4041e22b41b4a1f9e0e22ac8a1389.pdf"
  }),
  "challenge-cup-entrepreneurship-plan": guideProfile({
    stages: { state: "known", values: allStudentStages },
    teamRequirement: { state: "known", mode: "team", maxSize: 10 },
    majors: ["computer-science", "business", "design", "engineering", "medicine", "mathematics", "humanities", "other"],
    skills: ["research", "product", "writing", "presentation"],
    interests: ["entrepreneurship", "innovation", "career"],
    preferredOutputs: ["business-plan", "prototype", "presentation"],
    experienceLevels: ["participated", "project-or-award"],
    evidence: ["project", "prototype"],
    goalValues: goals({ project: 0.95, award: 1, entrepreneurship: 1, employment: 0.85, networking: 0.9 }),
    difficulty: "challenge",
    weeklyHours: ["over-10"],
    usefulResources: ["mentor", "lab", "equipment", "data", "budget"],
    helpfulResources: ["mentor", "lab", "equipment", "data", "budget"],
    eligibility: verifiedEligibility(
      "https://www.tiaozhanbei.net/rules2",
      ["全日制非成人专科、本科、硕士、博士可报，无统一年级禁入。", "项目须自有或获授权产品/服务，具有核心团队和实施条件。"],
      {
        requiresFullTime: true,
        blockingClarifications: [
          "项目产品或服务的自有或授权权利与核心团队条件尚未由固定问卷确认。"
        ],
        evidenceRef: "official:challenge-cup-entrepreneurship-plan:2026-08-22",
        facts: ["stages", "teamRequirement", "eligibility", "trackEligibility"]
      }
    ),
    fit: { signals: ["venture-readiness"], startingPoints: ["prototype", "validated"] },
    dataCompleteness: 0.95,
    tracks: [
      {
        id: "registered",
        label: "已创业类",
        preferenceQuestionEligible: false,
        fitSignals: ["venture-readiness"],
        eligibilityNotes: ["已登记且运营满3个月。"],
        blockingClarifications: ["项目登记及运营满3个月的事实尚未由固定问卷确认。"]
      },
      {
        id: "unregistered",
        label: "未创业类",
        preferenceQuestionEligible: false,
        fitSignals: ["venture-readiness"],
        eligibilityNotes: ["未登记或登记不满3个月。"],
        blockingClarifications: ["项目登记及运营时长事实尚未由固定问卷确认。"]
      }
    ],
    sourceUrl: "https://www.tiaozhanbei.net/rules2"
  }),
  "national-college-electronic-design": guideProfile({
    stages: { state: "known", values: vocationalAndUndergraduateStages },
    teamRequirement: { state: "known", mode: "team", minSize: 3, maxSize: 3 },
    majors: ["computer-science", "engineering"],
    skills: ["hardware", "programming", "design", "presentation"],
    interests: ["engineering", "robotics", "innovation"],
    preferredOutputs: ["prototype", "software", "presentation"],
    experienceLevels: ["participated", "project-or-award"],
    evidence: ["project", "prototype"],
    goalValues: goals({ project: 1, award: 1, employment: 1, postgraduate: 0.9, portfolio: 0.8 }),
    qualityTaskPrototypeRequired: true,
    difficulty: "challenge",
    weeklyHours: ["over-10"],
    usefulResources: ["mentor", "lab", "equipment", "budget"],
    requiredResources: ["lab", "equipment"],
    helpfulResources: ["mentor", "budget"],
    eligibility: verifiedEligibility(
      "https://www.nuedc-training.com.cn/index/news/details/new_id/333",
      ["主赛面向正式学籍全日制本科或高职高专学生，无统一年级禁入。", "每队正3人且三人必须全程参加。"],
      {
        requiresFullTime: true,
        sameInstitutionTeam: true,
        evidenceRef: "official:national-college-electronic-design:2026-08-22",
        facts: ["stages", "teamRequirement", "eligibility", "trackEligibility"]
      }
    ),
    fit: { signals: ["hardware-build"] },
    dataCompleteness: 0.96,
    tracks: [{ id: "main", label: "全国主赛", stages: { state: "known", values: vocationalAndUndergraduateStages }, teamRequirement: { state: "known", mode: "team", minSize: 3, maxSize: 3 }, fitSignals: ["hardware-build"] }],
    sourceUrl: "https://www.nuedc-training.com.cn/index/news/details/new_id/333"
  }),
  "icpc-programming": guideProfile({
    stages: { state: "known", values: allStudentStages },
    teamRequirement: { state: "known", mode: "team", minSize: 3, maxSize: 3 },
    majors: ["computer-science", "business", "design", "engineering", "medicine", "mathematics", "humanities", "other"],
    skills: ["programming", "data-analysis"],
    interests: ["data", "ai", "academic-research"],
    preferredOutputs: ["software"],
    experienceLevels: ["participated", "project-or-award"],
    evidence: ["project", "award"],
    goalValues: goals({ award: 1, employment: 1, postgraduate: 0.9, project: 0.85, networking: 0.75 }),
    difficulty: "challenge",
    weeklyHours: ["over-10"],
    usefulResources: ["mentor"],
    helpfulResources: ["mentor"],
    eligibility: verifiedEligibility(
      "https://icpc.global/regionals/rules/",
      ["每队3人，队员来自同一授予学位机构，并有1名教练。", "2026/27资格还受首次高等教育年份、出生年份及往届参赛次数限制，仅学历阶段不能充分判定。"],
      {
        sameInstitutionTeam: true,
        blockingClarifications: [
          "教练注册与队员往届ICPC区域赛、世界决赛参赛次数尚未由固定问卷确认。"
        ],
        evidenceRef: "official:icpc-programming:2026-08-22",
        facts: ["stages", "teamRequirement", "eligibility", "firstHigherEducationYearCutoff"]
      }
    ),
    fit: { signals: ["algorithm-competition"] },
    dataCompleteness: 0.95,
    sourceUrl: "https://icpc.global/regionals/rules/"
  }),
  "market-research-analysis": guideProfile({
    stages: { state: "known", values: allStudentStages },
    teamRequirement: { state: "known", mode: "team", minSize: 3, maxSize: 5 },
    majors: ["business", "mathematics", "humanities", "computer-science", "other"],
    skills: ["research", "data-analysis", "writing", "presentation"],
    interests: ["data", "academic-research", "career"],
    preferredOutputs: ["research-paper", "presentation"],
    experienceLevels: ["none", "participated", "project-or-award"],
    evidence: ["project", "paper"],
    goalValues: goals({ project: 0.9, employment: 0.9, award: 0.85, postgraduate: 0.8 }),
    difficulty: "balanced",
    weeklyHours: ["5-10", "over-10"],
    usefulResources: ["mentor", "data"],
    requiredResources: ["data"],
    helpfulResources: ["mentor"],
    eligibility: verifiedEligibility(
      "https://www.china-cssc.org/show-568-1912-1.html",
      ["专科、本科、研究生分组，团队3–5人且成员必须同学历层次、同一参赛单位。", "专科与本科选手须先通过个人知识网考才能组队实践赛。"],
      {
        sameInstitutionTeam: true,
        blockingClarifications: [
          "队员是否全部同学历层次，以及专科、本科选手是否已通过个人知识网考尚未确认。"
        ],
        evidenceRef: "official:market-research-analysis:2026-08-22",
        facts: ["stages", "teamRequirement", "eligibility"]
      }
    ),
    fit: { signals: ["field-research"] },
    dataCompleteness: 0.94,
    schedule: {
      state: "scheduled",
      edition: "第十六届（2025-2026）",
      competitionEnd: "2026-05-31",
      datePrecision: "month",
      verifiedAt: "2026-08-22",
      sourceUrl: "https://www.china-cssc.org/show-568-1912-1.html",
      sourceType: "organizer"
    },
    sourceUrl: "https://www.china-cssc.org/show-568-1912-1.html"
  }),
  "understanding-contemporary-china-foreign-language": guideProfile({
    stages: { state: "known", values: fltrpEligibleStages },
    teamRequirement: { state: "known", mode: "either", minSize: 1, maxSize: 5 },
    majors: ["computer-science", "business", "design", "engineering", "medicine", "mathematics", "humanities", "other"],
    skills: ["writing", "presentation", "research"],
    interests: ["language-communication", "career", "academic-research"],
    preferredOutputs: ["creative-work", "research-paper", "presentation"],
    experienceLevels: ["none", "participated", "project-or-award"],
    evidence: ["portfolio", "award"],
    goalValues: goals({ award: 0.95, employment: 0.85, postgraduate: 0.85, portfolio: 0.9, networking: 0.8 }),
    difficulty: "balanced",
    weeklyHours: ["5-10", "over-10"],
    usefulResources: ["mentor"],
    helpfulResources: ["mentor"],
    eligibility: verifiedEligibility(
      "https://ucc.fltrp.com/c/2026-04-15/517928.shtml",
      ["英语与多语种组面向全日制本科生和硕士研究生；国际中文组另有来华留学生资格。", "往届同语种同赛项国赛前三不得再参加。"],
      {
        requiresFullTime: true,
        blockingClarifications: [
          "是否存在往届同语种同赛项国赛前三名的禁止重复参赛情形尚未确认。"
        ],
        evidenceRef: "official:understanding-contemporary-china-foreign-language:2026-08-22",
        facts: ["stages", "teamRequirement", "eligibility", "trackEligibility"]
      }
    ),
    fit: { signals: ["language-communication"] },
    dataCompleteness: 0.96,
    tracks: [
      { id: "english-comprehensive", label: "英语组国际传播综合能力", stages: { state: "known", values: ["undergraduate-1", "undergraduate-2", "undergraduate-3", "undergraduate-4", "master"] }, teamRequirement: { state: "known", mode: "individual", minSize: 1, maxSize: 1 }, fitSignals: ["language-communication"] },
      { id: "translation", label: "英语组笔译", stages: { state: "known", values: ["undergraduate-1", "undergraduate-2", "undergraduate-3", "undergraduate-4", "master"] }, teamRequirement: { state: "known", mode: "individual", minSize: 1, maxSize: 1 }, fitSignals: ["language-communication"] },
      { id: "short-video", label: "英语组短视频", stages: { state: "known", values: ["undergraduate-1", "undergraduate-2", "undergraduate-3", "undergraduate-4", "master"] }, teamRequirement: { state: "known", mode: "either", minSize: 1, maxSize: 5 }, fitSignals: ["language-communication"] },
      { id: "four-new", label: "英语组“四新”专项", stages: { state: "known", values: ["undergraduate-1", "undergraduate-2", "undergraduate-3", "undergraduate-4", "master"] }, teamRequirement: { state: "known", mode: "either", minSize: 1, maxSize: 5 }, fitSignals: ["language-communication", "field-research"] },
      {
        id: "international-chinese",
        label: "国际中文组",
        preferenceQuestionEligible: false,
        teamRequirement: { state: "known", mode: "either", minSize: 1, maxSize: 5 },
        fitSignals: ["language-communication"],
        eligibilityNotes: ["国际中文组面向符合当届规则的来华留学生。"],
        blockingClarifications: ["来华留学生身份尚未由固定问卷确认。"],
        evidenceRef: "official:understanding-contemporary-china-foreign-language:2026-08-22",
        verifiedFacts: ["teamRequirement", "eligibility"]
      }
    ],
    schedule: {
      state: "scheduled",
      edition: "2026",
      competitionStart: "2026-04-01",
      competitionEnd: "2026-12-31",
      datePrecision: "month",
      verifiedAt: "2026-08-22",
      sourceUrl: "https://ucc.fltrp.com/c/2026-04-15/517928.shtml",
      sourceType: "official-competition"
    },
    sourceUrl: "https://ucc.fltrp.com/c/2026-04-15/517928.shtml"
  }),
  "energy-conservation-emission-reduction": guideProfile({
    stages: { state: "known", values: secondYearToPostgraduate },
    teamRequirement: { state: "known", mode: "team" },
    majors: ["engineering", "business", "mathematics", "other"],
    skills: ["research", "data-analysis", "hardware", "design", "writing", "presentation"],
    interests: ["engineering", "innovation"],
    preferredOutputs: ["prototype", "research-paper", "presentation"],
    experienceLevels: ["participated", "project-or-award"],
    evidence: ["project", "paper", "prototype"],
    goalValues: goals({ project: 1, award: 0.9, postgraduate: 0.9, employment: 0.85 }),
    difficulty: "challenge",
    weeklyHours: ["over-10"],
    usefulResources: ["mentor", "lab", "equipment", "data", "budget"],
    sourceUrl: "https://jwc.scu.edu.cn/info/1069/9808.htm"
  }),
  "ecommerce-innovation-creativity-entrepreneurship": guideProfile({
    stages: { state: "known", values: allStudentStages },
    teamRequirement: { state: "known", mode: "team" },
    majors: ["business", "computer-science", "design", "humanities", "other"],
    skills: ["research", "product", "design", "data-analysis", "presentation"],
    interests: ["entrepreneurship", "innovation", "career", "data"],
    preferredOutputs: ["business-plan", "prototype", "presentation"],
    experienceLevels: ["none", "participated", "project-or-award"],
    evidence: ["project", "prototype"],
    goalValues: goals({ entrepreneurship: 1, project: 0.95, employment: 0.9, award: 0.85, networking: 0.8 }),
    difficulty: "challenge",
    weeklyHours: ["5-10", "over-10"],
    usefulResources: ["mentor", "data", "budget"],
    sourceUrl: "https://www.3chuang.net/"
  }),
  "smart-car": guideProfile({
    stages: { state: "known", values: allStudentStages },
    teamRequirement: { state: "known", mode: "team" },
    majors: ["computer-science", "engineering"],
    skills: ["hardware", "programming", "data-analysis", "design"],
    interests: ["robotics", "engineering", "ai", "innovation"],
    preferredOutputs: ["prototype", "software", "presentation"],
    experienceLevels: ["participated", "project-or-award"],
    evidence: ["project", "prototype"],
    goalValues: goals({ project: 1, award: 0.95, employment: 1, postgraduate: 0.9, portfolio: 0.8 }),
    difficulty: "challenge",
    weeklyHours: ["over-10"],
    usefulResources: ["mentor", "lab", "equipment", "budget"],
    sourceUrl: "https://www.smartcar.zone/"
  }),
  "china-college-computer-design": guideProfile({
    stages: { state: "known", values: firstYearToSenior },
    teamRequirement: { state: "known", mode: "either" },
    majors: ["computer-science", "design", "business", "engineering", "humanities", "other"],
    skills: ["programming", "design", "product", "writing", "presentation"],
    interests: ["innovation", "ai", "design", "media"],
    preferredOutputs: ["software", "creative-work", "prototype", "presentation"],
    experienceLevels: ["none", "participated", "project-or-award"],
    evidence: ["project", "portfolio", "prototype"],
    goalValues: goals({ project: 0.95, portfolio: 1, employment: 0.85, award: 0.85 }),
    difficulty: "balanced",
    weeklyHours: ["5-10", "over-10"],
    usefulResources: ["mentor", "lab", "equipment"],
    sourceUrl: "https://jsjds.com.cn/"
  }),
  "china-software-cup": guideProfile({
    stages: { state: "known", values: secondYearToPostgraduate },
    teamRequirement: { state: "known", mode: "team" },
    majors: ["computer-science", "engineering", "business", "mathematics"],
    skills: ["programming", "product", "data-analysis", "writing", "presentation"],
    interests: ["ai", "data", "innovation", "career"],
    preferredOutputs: ["software", "prototype", "presentation"],
    experienceLevels: ["participated", "project-or-award"],
    evidence: ["project", "prototype"],
    goalValues: goals({ project: 1, employment: 1, award: 0.9, portfolio: 0.8, networking: 0.75 }),
    difficulty: "challenge",
    weeklyHours: ["over-10"],
    usefulResources: ["mentor", "data", "budget"],
    sourceUrl: "https://www.cnsoftbei.com/"
  }),
  "information-security": guideProfile({
    stages: { state: "known", values: secondYearToPostgraduate },
    teamRequirement: { state: "known", mode: "either" },
    majors: ["computer-science", "engineering", "mathematics"],
    skills: ["programming", "research", "data-analysis"],
    interests: ["engineering", "academic-research", "innovation"],
    preferredOutputs: ["software", "prototype", "research-paper"],
    experienceLevels: ["participated", "project-or-award"],
    evidence: ["project", "paper", "prototype", "award"],
    goalValues: goals({ project: 1, employment: 1, award: 0.95, postgraduate: 0.9 }),
    difficulty: "challenge",
    weeklyHours: ["over-10"],
    usefulResources: ["mentor", "lab", "equipment"],
    sourceUrl: "https://www.ciscn.cn/competition/securityCompetition?compet_id=43"
  }),
  "integrated-circuit-innovation": guideProfile({
    stages: { state: "known", values: secondYearToPostgraduate },
    teamRequirement: { state: "known", mode: "team" },
    majors: ["computer-science", "engineering", "mathematics"],
    skills: ["hardware", "programming", "research", "data-analysis", "presentation"],
    interests: ["engineering", "academic-research", "innovation"],
    preferredOutputs: ["prototype", "software", "research-paper", "presentation"],
    experienceLevels: ["participated", "project-or-award"],
    evidence: ["project", "prototype", "paper"],
    goalValues: goals({ project: 1, employment: 1, postgraduate: 0.95, award: 0.9 }),
    difficulty: "challenge",
    weeklyHours: ["over-10"],
    usefulResources: ["mentor", "lab", "equipment", "budget"],
    sourceUrl: "https://univ.ciciec.com/"
  }),
  "advanced-graphics-bim": guideProfile({
    stages: { state: "known", values: firstYearToSenior },
    teamRequirement: { state: "known", mode: "either" },
    majors: ["engineering"],
    skills: ["design", "data-analysis", "presentation"],
    interests: ["engineering"],
    preferredOutputs: ["prototype", "presentation"],
    experienceLevels: ["none", "participated", "project-or-award"],
    evidence: ["project", "portfolio", "prototype"],
    goalValues: goals({ project: 0.95, employment: 0.95, portfolio: 0.9, award: 0.85 }),
    difficulty: "challenge",
    weeklyHours: ["5-10", "over-10"],
    usefulResources: ["mentor", "lab", "equipment"],
    sourceUrl: "https://www.chengtudasai.com/"
  }),
  "national-college-industrial-design": guideProfile({
    stages: { state: "known", values: secondYearToPostgraduate },
    teamRequirement: { state: "known", mode: "either" },
    majors: ["design", "engineering"],
    skills: ["research", "design", "product", "presentation"],
    interests: ["design"],
    preferredOutputs: ["creative-work", "prototype", "presentation"],
    experienceLevels: ["none", "participated", "project-or-award"],
    evidence: ["project", "portfolio", "prototype"],
    goalValues: goals({ portfolio: 1, project: 1, employment: 0.9, award: 0.85 }),
    difficulty: "balanced",
    weeklyHours: ["5-10", "over-10"],
    usefulResources: ["mentor", "lab", "equipment", "budget"],
    sourceUrl: "https://www.cuidc.net/"
  }),
  "future-designer-ncda": guideProfile({
    stages: { state: "known", values: allStudentStages },
    teamRequirement: { state: "known", mode: "either" },
    majors: ["design", "computer-science", "humanities", "other"],
    skills: ["design", "product", "writing", "presentation"],
    interests: ["design", "media"],
    preferredOutputs: ["creative-work", "presentation"],
    experienceLevels: ["none", "participated", "project-or-award"],
    evidence: ["project", "portfolio"],
    goalValues: goals({ portfolio: 1, project: 0.9, employment: 0.85, award: 0.8 }),
    difficulty: "balanced",
    weeklyHours: ["5-10", "over-10"],
    usefulResources: ["mentor", "equipment"],
    sourceUrl: "https://www.ncda.org.cn/"
  }),
  "energy-economics-academic-creativity": guideProfile({
    stages: { state: "known", values: secondYearToPostgraduate },
    teamRequirement: { state: "known", mode: "either" },
    majors: ["business", "mathematics", "engineering", "humanities", "other"],
    skills: ["research", "data-analysis", "writing", "presentation"],
    interests: ["academic-research", "data", "innovation"],
    preferredOutputs: ["research-paper", "presentation"],
    experienceLevels: ["participated", "project-or-award"],
    evidence: ["paper", "project"],
    goalValues: goals({ postgraduate: 0.95, project: 0.9, employment: 0.85, award: 0.8 }),
    difficulty: "challenge",
    weeklyHours: ["5-10", "over-10"],
    usefulResources: ["mentor", "data"],
    sourceUrl: "https://energy.qibebt.ac.cn/eneco/contribution/"
  }),
  "national-college-logistics-design": guideProfile({
    stages: { state: "known", values: secondYearToPostgraduate },
    teamRequirement: { state: "known", mode: "team" },
    majors: ["business", "mathematics", "computer-science", "engineering"],
    skills: ["research", "data-analysis", "product", "writing", "presentation"],
    interests: ["data", "career"],
    preferredOutputs: ["business-plan", "research-paper", "presentation"],
    experienceLevels: ["participated", "project-or-award"],
    evidence: ["project", "paper"],
    goalValues: goals({ employment: 1, project: 0.95, award: 0.85, networking: 0.8 }),
    difficulty: "balanced",
    weeklyHours: ["5-10", "over-10"],
    usefulResources: ["mentor", "data"],
    sourceUrl: "https://dspt.clppx.org.cn/"
  }),
  "china-college-computer-contest": guideProfile({
    stages: { state: "known", values: allStudentStages },
    majors: ["computer-science", "engineering"],
    skills: ["programming", "research", "presentation"],
    interests: ["engineering"],
    preferredOutputs: ["prototype", "presentation"],
    experienceLevels: ["participated", "project-or-award"],
    evidence: ["project", "prototype"],
    goalValues: goals({ project: 1, employment: 0.95, award: 0.85, portfolio: 0.8 }),
    difficulty: "challenge",
    weeklyHours: ["over-10"],
    usefulResources: ["mentor", "lab", "equipment"],
    sourceUrl: "https://net.c4best.cn/"
  }),
  robocon: guideProfile({
    stages: { state: "known", values: allStudentStages },
    teamRequirement: { state: "known", mode: "team" },
    majors: ["engineering", "computer-science", "mathematics"],
    skills: ["hardware", "programming", "design", "data-analysis", "presentation"],
    interests: ["robotics", "engineering", "ai", "innovation"],
    preferredOutputs: ["prototype", "software", "presentation"],
    experienceLevels: ["participated", "project-or-award"],
    evidence: ["project", "prototype", "award"],
    goalValues: goals({ project: 1, employment: 1, award: 0.95, postgraduate: 0.9, networking: 0.85 }),
    difficulty: "challenge",
    weeklyHours: ["over-10"],
    usefulResources: ["mentor", "lab", "equipment", "budget"],
    sourceUrl: "https://www.robocon.org.cn/"
  }),
  "robocup-china": guideProfile({
    stages: { state: "known", values: secondYearToPostgraduate },
    teamRequirement: { state: "known", mode: "team" },
    majors: ["engineering", "computer-science", "mathematics"],
    skills: ["programming", "hardware", "data-analysis", "research"],
    interests: ["robotics", "ai", "engineering", "academic-research"],
    preferredOutputs: ["prototype", "software", "research-paper"],
    experienceLevels: ["participated", "project-or-award"],
    evidence: ["project", "prototype", "paper", "award"],
    goalValues: goals({ project: 1, employment: 1, postgraduate: 0.95, award: 0.9, networking: 0.85 }),
    difficulty: "challenge",
    weeklyHours: ["over-10"],
    usefulResources: ["mentor", "lab", "equipment", "budget"],
    sourceUrl: "https://www.caa.org.cn/Content/33.html"
  }),
  "siemens-intelligent-manufacturing": guideProfile({
    stages: { state: "known", values: allStudentStages },
    teamRequirement: { state: "known", mode: "either", minSize: 1, maxSize: 3 },
    majors: ["engineering", "computer-science", "business"],
    skills: ["hardware", "programming", "data-analysis", "design", "presentation"],
    interests: ["engineering", "robotics", "innovation", "career"],
    preferredOutputs: ["prototype", "software", "presentation"],
    experienceLevels: ["participated", "project-or-award"],
    evidence: ["project", "prototype"],
    goalValues: goals({ employment: 1, project: 1, award: 0.85, postgraduate: 0.8 }),
    difficulty: "challenge",
    weeklyHours: ["over-10"],
    usefulResources: ["mentor", "lab", "equipment"],
    sourceUrl: "https://www.siemenscup-cimc.org.cn/"
  }),
  "lanqiao-cup": guideProfile({
    stages: { state: "known", values: firstYearToSenior },
    teamRequirement: { state: "known", mode: "individual", minSize: 1, maxSize: 1 },
    majors: ["computer-science", "engineering", "mathematics", "design"],
    skills: ["programming", "hardware", "data-analysis", "design"],
    interests: ["data", "ai", "engineering", "innovation"],
    preferredOutputs: ["software", "prototype", "creative-work"],
    experienceLevels: ["none", "participated", "project-or-award"],
    evidence: ["project", "award"],
    goalValues: goals({ award: 0.9, employment: 0.9, project: 0.85, postgraduate: 0.75 }),
    difficulty: "balanced",
    weeklyHours: ["5-10", "over-10"],
    usefulResources: ["mentor", "equipment"],
    sourceUrl: "https://dasai.lanqiao.cn/"
  }),
  "21st-century-english-speaking": guideProfile({
    stages: { state: "known", values: allStudentStages },
    teamRequirement: { state: "known", mode: "individual", minSize: 1, maxSize: 1 },
    majors: ["humanities", "business", "other"],
    skills: ["writing", "presentation", "research"],
    interests: ["language-communication"],
    preferredOutputs: ["creative-work", "presentation"],
    experienceLevels: ["none", "participated", "project-or-award"],
    evidence: ["portfolio", "award"],
    goalValues: goals({ portfolio: 0.95, award: 0.9, employment: 0.85, networking: 0.85 }),
    difficulty: "balanced",
    weeklyHours: ["5-10", "over-10"],
    usefulResources: ["mentor"],
    sourceUrl: "https://contest.i21st.cn/college/"
  }),
  "icbc-fintech-innovation": guideProfile({
    stages: { state: "known", values: secondYearToPostgraduate },
    teamRequirement: { state: "known", mode: "team" },
    majors: ["business", "computer-science", "mathematics", "design", "other"],
    skills: ["research", "data-analysis", "product", "design", "presentation"],
    interests: ["career", "data"],
    preferredOutputs: ["business-plan", "prototype", "software", "presentation"],
    experienceLevels: ["participated", "project-or-award"],
    evidence: ["project", "prototype"],
    goalValues: goals({ employment: 1, project: 0.95, entrepreneurship: 0.4, award: 0.8, networking: 0.8 }),
    difficulty: "challenge",
    weeklyHours: ["5-10", "over-10"],
    usefulResources: ["mentor", "data", "budget"],
    sourceUrl: "https://www.gonghangbei.com/"
  })
} satisfies Record<GuideCompetitionId, CompetitionRecommendationMetadata>;

export const guideCompetitions: readonly CompetitionSource[] = guideCompetitionDisplayEntries.map((competition) => ({
  ...competition,
  recommendation: guideCompetitionRecommendationProfiles[competition.id]
}));

function scoreVector(
  values: readonly [number, number, number, number, number, number, number, number, number, number]
): CompetitionGuideScoreVector {
  const [
    publicCredibility,
    campusRecognition,
    employmentRelevance,
    abilityDevelopment,
    coverage,
    operationalStability,
    outcomeAccumulation,
    costFriendliness,
    formatFriendliness,
    longTermValue
  ] = values;

  return {
    publicCredibility,
    campusRecognition,
    employmentRelevance,
    abilityDevelopment,
    coverage,
    operationalStability,
    outcomeAccumulation,
    costFriendliness,
    formatFriendliness,
    longTermValue
  };
}

type TraceInput = Omit<
  CompetitionGuideTrace,
  "sourceCutoff" | "sourceTitle" | "scoreVector"
> & {
  vector: readonly [number, number, number, number, number, number, number, number, number, number];
};

function trace(input: TraceInput): CompetitionGuideTrace {
  const { vector, ...rest } = input;
  return {
    ...rest,
    scoreVector: scoreVector(vector),
    sourceCutoff: COMPETITION_GUIDE_SOURCE_CUTOFF,
    sourceTitle: COMPETITION_GUIDE_SOURCE_TITLE
  };
}

export const GUIDE_ALLOWED_RANKS = [
  1, 2, 3, 4, 5, 6, 8, 10, 12, 13, 15, 16, 17, 21, 22, 24, 26, 27, 28, 31, 32, 33, 39, 40, 41, 42, 43, 47, 49
] as const;

export const GUIDE_NEW_RANKS = [
  1, 2, 3, 4, 5, 6, 8, 10, 12, 13, 15, 16, 17, 22, 24, 26, 27, 28, 31, 33, 39, 40, 41, 42, 43, 47, 49
] as const;

export const GUIDE_MERGED_RANKS = [21, 32] as const;

/**
 * PDF 排名与评分的内部溯源记录。该数据不代替当届官方赛事通知。
 * #21 与 #32 仅更新站内已有条目，不新增重复卡片。
 */
export const competitionGuideTrace = [
  trace({ rank: 1, catalogId: "china-international-college-innovation", score: 96, grade: "S", recommendationIndex: 9.8, vector: [15, 15, 14, 15, 10, 10, 8, 4, 2, 3], sourceUrl: "https://www.moe.gov.cn/srcsite/A08/s5672/202505/t20250509_1189810.html" }),
  trace({ rank: 2, catalogId: "challenge-cup-academic-science", score: 94, grade: "S", recommendationIndex: 9.6, vector: [15, 15, 13, 15, 9, 10, 8, 4, 2, 3], sourceUrl: "https://www.tiaozhanbei.net/" }),
  trace({ rank: 3, catalogId: "national-college-math-modeling", score: 93, grade: "S", recommendationIndex: 9.5, vector: [15, 15, 13, 15, 10, 10, 7, 5, 2, 1], sourceUrl: "https://www.mcm.edu.cn/" }),
  trace({ rank: 4, catalogId: "challenge-cup-entrepreneurship-plan", score: 92, grade: "S", recommendationIndex: 9.4, vector: [15, 15, 13, 14, 9, 10, 8, 4, 1, 3], sourceUrl: "https://www.tiaozhanbei.net/" }),
  trace({ rank: 5, catalogId: "national-college-electronic-design", score: 91, grade: "S", recommendationIndex: 9.3, vector: [15, 14, 15, 15, 7, 10, 8, 3, 2, 2], sourceUrl: "https://www.nuedc-training.com.cn/" }),
  trace({ rank: 6, catalogId: "icpc-programming", score: 90, grade: "S", recommendationIndex: 9.2, vector: [14, 14, 15, 15, 6, 10, 8, 4, 1, 3], sourceUrl: "https://icpc.pku.edu.cn/" }),
  trace({ rank: 8, catalogId: "market-research-analysis", score: 88, grade: "S", recommendationIndex: 9, vector: [13, 13, 14, 14, 10, 9, 8, 4, 2, 1], sourceUrl: "https://stat.ecnu.edu.cn/f8/02/c9708a718850/page.htm" }),
  trace({ rank: 10, catalogId: "understanding-contemporary-china-foreign-language", score: 87, grade: "S", recommendationIndex: 8.9, vector: [14, 13, 12, 14, 10, 9, 8, 4, 1, 2], sourceUrl: "https://ucc.fltrp.com/" }),
  trace({ rank: 12, catalogId: "energy-conservation-emission-reduction", score: 86, grade: "A", recommendationIndex: 8.8, vector: [14, 13, 13, 15, 9, 9, 8, 3, 1, 1], sourceUrl: "https://jwc.scu.edu.cn/info/1069/9808.htm" }),
  trace({ rank: 13, catalogId: "ecommerce-innovation-creativity-entrepreneurship", score: 85, grade: "A", recommendationIndex: 8.7, vector: [13, 13, 13, 14, 10, 9, 8, 4, 1, 0], sourceUrl: "https://www.3chuang.net/" }),
  trace({ rank: 15, catalogId: "smart-car", score: 84, grade: "A", recommendationIndex: 8.6, vector: [14, 13, 15, 15, 6, 9, 8, 2, 1, 1], sourceUrl: "https://www.smartcar.zone/" }),
  trace({ rank: 16, catalogId: "china-college-computer-design", score: 84, grade: "A", recommendationIndex: 8.6, vector: [13, 12, 13, 14, 10, 9, 8, 3, 1, 1], sourceUrl: "https://jsjds.com.cn/" }),
  trace({ rank: 17, catalogId: "china-software-cup", score: 83, grade: "A", recommendationIndex: 8.5, vector: [14, 13, 15, 14, 7, 9, 8, 2, 0, 1], sourceUrl: "https://www.cnsoftbei.com/" }),
  trace({ rank: 21, catalogId: "career-planning", score: 81, grade: "A", recommendationIndex: 8.3, vector: [15, 12, 15, 11, 10, 6, 6, 4, 1, 1], sourceUrl: "https://www.moe.gov.cn/srcsite/A15/s7063/202510/t20251021_1417550.html", mergeTargetId: "career-planning" }),
  trace({ rank: 22, catalogId: "information-security", score: 81, grade: "A", recommendationIndex: 8.3, vector: [14, 13, 15, 15, 6, 9, 8, 1, 0, 0], sourceUrl: "https://www.ciscn.cn/competition/securityCompetition?compet_id=43" }),
  trace({ rank: 24, catalogId: "integrated-circuit-innovation", score: 80, grade: "A", recommendationIndex: 8.2, vector: [14, 12, 15, 15, 6, 9, 8, 0, 0, 1], sourceUrl: "https://univ.ciciec.com/" }),
  trace({ rank: 26, catalogId: "advanced-graphics-bim", score: 79, grade: "A", recommendationIndex: 8.1, vector: [13, 12, 14, 14, 8, 9, 8, 1, 0, 0], sourceUrl: "https://www.chengtudasai.com/" }),
  trace({ rank: 27, catalogId: "national-college-industrial-design", score: 78, grade: "A", recommendationIndex: 8, vector: [13, 12, 14, 14, 8, 9, 7, 1, 0, 0], sourceUrl: "https://www.cuidc.net/" }),
  trace({ rank: 28, catalogId: "future-designer-ncda", score: 78, grade: "A", recommendationIndex: 8, vector: [12, 11, 13, 14, 10, 9, 8, 1, 0, 0], sourceUrl: "https://www.ncda.org.cn/" }),
  trace({ rank: 31, catalogId: "energy-economics-academic-creativity", score: 76, grade: "A", recommendationIndex: 7.8, vector: [12, 12, 13, 14, 8, 8, 7, 1, 0, 1], sourceUrl: "https://energy.qibebt.ac.cn/eneco/contribution/" }),
  trace({ rank: 32, catalogId: "business-elite-innovation", score: 76, grade: "A", recommendationIndex: 7.8, vector: [12, 11, 14, 13, 9, 8, 7, 1, 0, 1], sourceUrl: "https://www.ccpitcsc.org/eduxq/4857", mergeTargetId: "business-elite-innovation" }),
  trace({ rank: 33, catalogId: "national-college-logistics-design", score: 75, grade: "A", recommendationIndex: 7.7, vector: [12, 11, 15, 14, 6, 8, 8, 1, 0, 0], sourceUrl: "https://dspt.clppx.org.cn/" }),
  trace({ rank: 39, catalogId: "china-college-computer-contest", score: 72, grade: "B", recommendationIndex: 7.4, vector: [12, 11, 14, 14, 8, 8, 5, 0, 0, 0], sourceUrl: "https://net.c4best.cn/" }),
  trace({ rank: 40, catalogId: "robocon", score: 72, grade: "B", recommendationIndex: 7.4, vector: [13, 12, 15, 15, 4, 8, 5, 0, 0, 0], sourceUrl: "https://www.robocon.org.cn/" }),
  trace({ rank: 41, catalogId: "robocup-china", score: 71, grade: "B", recommendationIndex: 7.3, vector: [12, 11, 15, 15, 4, 8, 5, 0, 0, 1], sourceUrl: "https://www.caa.org.cn/Content/33.html" }),
  trace({ rank: 42, catalogId: "siemens-intelligent-manufacturing", score: 71, grade: "B", recommendationIndex: 7.3, vector: [12, 11, 15, 15, 5, 8, 4, 0, 0, 1], sourceUrl: "https://www.siemenscup-cimc.org.cn/" }),
  trace({ rank: 43, catalogId: "lanqiao-cup", score: 70, grade: "B", recommendationIndex: 7.2, vector: [11, 10, 14, 13, 9, 8, 4, 1, 0, 0], sourceUrl: "https://dasai.lanqiao.cn/" }),
  trace({ rank: 47, catalogId: "21st-century-english-speaking", score: 69, grade: "B", recommendationIndex: 7.1, vector: [12, 10, 12, 13, 9, 8, 4, 1, 0, 0], sourceUrl: "https://contest.i21st.cn/college/" }),
  trace({ rank: 49, catalogId: "icbc-fintech-innovation", score: 67, grade: "B", recommendationIndex: 6.9, vector: [11, 9, 15, 14, 7, 7, 3, 1, 0, 0], sourceUrl: "https://www.gonghangbei.com/" })
] as const satisfies readonly CompetitionGuideTrace[];
