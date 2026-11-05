import type {
  CompetitionFitSignal,
  CompetitionGoal
} from "@/types/competition-recommendation";

export type CompetitionPreferenceOracle = {
  personaId: string;
  /** Priorities are authored from the visible profile facts, never from a scorer output. */
  fitPriority: readonly CompetitionFitSignal[];
  goalPriority: readonly CompetitionGoal[];
  /** A missing key means the visible facts do not justify inventing that track preference. */
  trackPriorityByCompetition: Readonly<Record<string, readonly string[]>>;
  optionalDecision: "answer" | "skip";
  fitRationale: string;
  goalRationale: string;
  trackRationale: string;
  optionalRationale: string;
};

/**
 * Independent, expert-authored preference oracle for the 25 ranking holdouts.
 *
 * These literals were written from each holdout's visible fixed-question facts
 * and task wording. They deliberately contain no expected ranks, scores or
 * generated question order, so the benchmark cannot reverse-engineer the
 * implementation under test.
 */
export const staticCompetitionPreferenceOracles = [
  {
    personaId: "rank-vocational-algorithm",
    fitPriority: ["algorithm-competition", "software-engineering"],
    goalPriority: ["award", "employment"],
    trackPriorityByCompetition: {},
    optionalDecision: "skip",
    fitRationale: "画像明确写出算法编程与软件作品，算法竞速比宽泛的软件交付更贴近要证明的能力。",
    goalRationale: "固定目标同时包含获奖与就业，竞技型算法画像应先按获奖目标做取舍。",
    trackRationale: "码蹄集学段组别由在读事实决定而不是内容偏好；固定画像没有可独立推导的题型方向，因此不替用户作答赛道题。",
    optionalRationale: "算法任务、作品证据与获奖目标已一致，低增益可选题不值得增加一步。"
  },
  {
    personaId: "rank-vocational-business-simulation",
    fitPriority: ["finance-operations", "venture-readiness"],
    goalPriority: ["employment", "award"],
    trackPriorityByCompetition: {},
    optionalDecision: "answer",
    fitRationale: "画像强调企业经营模拟和数据决策，首先验证经营财务决策能力而不是泛创业意向。",
    goalRationale: "就业排在固定目标首位，经营沙盘应优先沉淀可解释的岗位能力。",
    trackRationale: "企业竞争模拟的院校组别属于身份事实，不是动态内容偏好；固定画像没有额外可审定的细分任务方向。",
    optionalRationale: "经营类候选可能在就业与获奖产出上取舍，愿意用一题明确就业优先级。"
  },
  {
    personaId: "rank-vocational-robotics",
    fitPriority: ["robotics-integration", "hardware-build"],
    goalPriority: ["project", "award"],
    trackPriorityByCompetition: {},
    optionalDecision: "skip",
    fitRationale: "机器人画像同时有软硬件证据，但系统集成与现场调试是更完整的任务表述。",
    goalRationale: "固定目标先写项目经历，机器人原型应优先形成可复用项目成果。",
    trackRationale: "固定事实没有机器人细分赛道偏好；学生身份组也不是偏好问题，因此 oracle 明确留空而不编造类别取向。",
    optionalRationale: "机器人集成方向和项目目标都很明确，没有必要为低增益说明延长流程。"
  },
  {
    personaId: "rank-vocational-visual-design",
    fitPriority: ["design-portfolio", "product-validation"],
    goalPriority: ["portfolio", "award"],
    trackPriorityByCompetition: {},
    optionalDecision: "answer",
    fitRationale: "视觉设计画像的明确产出是作品集，设计作品证明应优先于通用产品验证。",
    goalRationale: "作品集是固定问卷中的第一目标，也最能区分视觉设计候选的准备方式。",
    trackRationale: "画像没有媒介或命题偏好；在校作品组由学籍事实决定，不能当作动态赛道偏好，故不补造答案。",
    optionalRationale: "设计赛事的奖项与作品集取向不同，愿意回答一题确认作品集优先。"
  },
  {
    personaId: "rank-vocational-career-language",
    fitPriority: ["career-evidence", "language-communication"],
    goalPriority: ["employment", "networking"],
    trackPriorityByCompetition: {},
    optionalDecision: "answer",
    fitRationale: "画像以求职行动证据为核心，同时具备语言沟通能力，因此职业证据优先。",
    goalRationale: "固定目标先选就业，职业规划候选应优先服务明确的就业成果。",
    trackRationale: "职业规划成长组和就业组由学段及毕业事实决定，不属于目标偏好；画像没有另一项可审定的内容赛道。",
    optionalRationale: "语言展示与职业成果可能分流，愿意用可选题确认就业目标。"
  },
  {
    personaId: "rank-undergraduate-lower-algorithm",
    fitPriority: ["algorithm-competition", "software-engineering"],
    goalPriority: ["award", "employment"],
    trackPriorityByCompetition: {},
    optionalDecision: "skip",
    fitRationale: "低年级本科画像直接聚焦算法竞赛，软件工程仅作为已有实现能力的次优偏好。",
    goalRationale: "固定目标将竞赛奖项置于就业之前，优先选择能检验算法竞技能力的结果。",
    trackRationale: "固定问卷未表达算法题组或应用场景；通用学生组仍是身份事实，oracle 不把它伪装成内容偏好。",
    optionalRationale: "算法能力、竞赛形式与奖项目标已经形成一致信号，可直接推荐。"
  },
  {
    personaId: "rank-undergraduate-lower-business-simulation",
    fitPriority: ["finance-operations", "venture-readiness"],
    goalPriority: ["employment", "award"],
    trackPriorityByCompetition: {},
    optionalDecision: "answer",
    fitRationale: "经营模拟和数据决策是固定任务焦点，应优先财务运营能力而非宽泛创业准备。",
    goalRationale: "就业是第一固定目标，沙盘经营成果首先用于证明岗位决策能力。",
    trackRationale: "企业竞争模拟的本科组由在读阶段决定，不是用户可取舍的内容方向；没有可独立审定的赛道答案。",
    optionalRationale: "经营候选的奖项与就业价值存在取舍，愿意明确就业优先。"
  },
  {
    personaId: "rank-undergraduate-lower-robotics",
    fitPriority: ["robotics-integration", "hardware-build"],
    goalPriority: ["project", "award"],
    trackPriorityByCompetition: {},
    optionalDecision: "skip",
    fitRationale: "画像强调机器人软硬件联调，系统集成比单一硬件搭建更完整地覆盖任务。",
    goalRationale: "项目经历是第一目标，优先沉淀能复用和展示的机器人系统项目。",
    trackRationale: "固定事实未给出机器人类别或平台，学生组又属于身份事实；若出现赛道题，oracle 不补造答案。",
    optionalRationale: "任务和目标足够具体，额外偏好题预计只改变说明而不值得打断流程。"
  },
  {
    personaId: "rank-undergraduate-lower-visual-design",
    fitPriority: ["design-portfolio", "product-validation"],
    goalPriority: ["portfolio", "award"],
    trackPriorityByCompetition: {},
    optionalDecision: "answer",
    fitRationale: "视觉设计固定画像以作品产出为中心，设计作品集是首要能力证明。",
    goalRationale: "作品集排在竞赛奖项之前，应优先可持续展示的设计成果。",
    trackRationale: "用户未确认媒介与命题类别；在校作品组仅对应学籍事实，不能作为偏好答案，故保持空白。",
    optionalRationale: "设计候选常在奖项与作品集之间取舍，愿意确认作品集优先。"
  },
  {
    personaId: "rank-undergraduate-lower-career-language",
    fitPriority: ["career-evidence", "language-communication"],
    goalPriority: ["employment", "networking"],
    trackPriorityByCompetition: {
      "understanding-contemporary-china-foreign-language": ["english-comprehensive", "short-video"]
    },
    optionalDecision: "answer",
    fitRationale: "画像要形成求职行动证据，语言表达是支撑能力而不是最终任务。",
    goalRationale: "就业为第一固定目标，应先评价候选对职业成果的直接支持。",
    trackRationale: "职业规划分组由学段与毕业事实决定而被排除；外语赛事中只保留英语综合和短视频这类内容方向。",
    optionalRationale: "职业与语言候选可能产生不同产出，愿意再确认就业取向。"
  },
  {
    personaId: "rank-undergraduate-upper-chemistry-lab",
    fitPriority: ["research-provenance", "modeling-intensive"],
    goalPriority: ["project", "award"],
    trackPriorityByCompetition: {},
    optionalDecision: "skip",
    fitRationale: "化学实验画像的核心是实验过程、原创性和可追溯证据，应优先研究证据能力。",
    goalRationale: "固定目标先选项目经历，实验成果应形成完整项目记录而非只追逐奖项。",
    trackRationale: "画像没有材料体系或实验专题偏好；青年科技学生组是身份事实，不作为动态内容答案。",
    optionalRationale: "实验方向与项目目标清楚，低增益偏好题没有新增决策价值。"
  },
  {
    personaId: "rank-undergraduate-upper-digital-building",
    fitPriority: ["design-portfolio", "software-engineering"],
    goalPriority: ["project", "award"],
    trackPriorityByCompetition: {},
    optionalDecision: "skip",
    fitRationale: "数字建造画像需要设计成果与工程表达，作品证明优先于通用软件交付。",
    goalRationale: "项目经历为第一目标，优先形成可展示的建筑或建造项目成果。",
    trackRationale: "固定事实没有建筑类型或 BIM 专项偏好；学生组属于身份事实，因此不依据排名补造赛道答案。",
    optionalRationale: "专业任务与项目目标已经明确，可直接查看推荐。"
  },
  {
    personaId: "rank-undergraduate-upper-medical-research",
    fitPriority: ["research-provenance", "product-validation"],
    goalPriority: ["project", "award"],
    trackPriorityByCompetition: {},
    optionalDecision: "skip",
    fitRationale: "医学研究画像首先要求研究来源与实验依据，产品验证只作为转化方向的补充。",
    goalRationale: "固定目标先选项目，应优先完整研究项目和证据链。",
    trackRationale: "固定画像虽有医学实验和论文，但没有必要为基准路径强塞赛道答案；青年科技学生组尤其属于身份事实。",
    optionalRationale: "研究证据与项目目标高度一致，继续追问不会实质改善选择。"
  },
  {
    personaId: "rank-undergraduate-upper-electronics",
    fitPriority: ["hardware-build", "robotics-integration"],
    goalPriority: ["project", "award"],
    trackPriorityByCompetition: {},
    optionalDecision: "skip",
    fitRationale: "电子设计画像明确包含电路和嵌入式实现，硬件搭建应是第一能力偏好。",
    goalRationale: "项目经历优先于奖项，电子作品应先形成可验证的完整项目。",
    trackRationale: "全国电赛单一主项不存在内容取舍，不能为满足测试而生成伪赛道答案；固定画像也没有其他方向偏好。",
    optionalRationale: "电子任务、硬件证据和项目目标已经足够收敛。"
  },
  {
    personaId: "rank-undergraduate-upper-finance-tax",
    fitPriority: ["finance-operations", "field-research"],
    goalPriority: ["employment", "award"],
    trackPriorityByCompetition: {},
    optionalDecision: "answer",
    fitRationale: "税务与金融画像强调分析和经营决策，财务运营能力应排在调研能力之前。",
    goalRationale: "就业是第一固定目标，优先体现财税岗位的实务能力。",
    trackRationale: "企业经营模拟本科组由在读事实决定，不是内容偏好；财税画像没有另一项可独立审定的赛道答案。",
    optionalRationale: "财税案例与经营候选可能服务不同成果，愿意明确就业优先。"
  },
  {
    personaId: "rank-master-modeling",
    fitPriority: ["modeling-intensive", "research-provenance"],
    goalPriority: ["award", "postgraduate"],
    trackPriorityByCompetition: {},
    optionalDecision: "skip",
    fitRationale: "硕士画像明确聚焦数学建模、编程和论文，建模密集型任务最直接。",
    goalRationale: "竞赛奖项排在科研升学之前，应优先具有明确竞赛评价的建模成果。",
    trackRationale: "固定事实没有建模题型或应用领域偏好；学生组属于身份事实，不能从候选名次反推为偏好。",
    optionalRationale: "建模任务、论文产出与奖项目标已足够具体。"
  },
  {
    personaId: "rank-master-electronics",
    fitPriority: ["hardware-build", "software-engineering"],
    goalPriority: ["project", "award"],
    trackPriorityByCompetition: {},
    optionalDecision: "skip",
    fitRationale: "硕士电子画像以电路、芯片和系统实现为证据，硬件搭建优先。",
    goalRationale: "第一目标是项目经历，应先选择能沉淀完整系统成果的候选。",
    trackRationale: "画像未声明器件或系统类别偏好；青年科技学生组是身份事实，细分系统方向继续保持未知。",
    optionalRationale: "硬件任务和项目目标一致，可以直接查看推荐。"
  },
  {
    personaId: "rank-master-ai-research",
    fitPriority: ["algorithm-competition", "research-provenance"],
    goalPriority: ["project", "award"],
    trackPriorityByCompetition: {},
    optionalDecision: "skip",
    fitRationale: "AI 研究画像有算法和代码证据，算法能力是第一偏好，研究证据为次。",
    goalRationale: "项目经历排在奖项之前，应优先可复现的 AI 项目成果。",
    trackRationale: "固定问卷没有 AI 应用场景偏好；学生组不是内容取舍，不能替用户选择或补造任何应用赛道。",
    optionalRationale: "AI 算法任务与项目目标已经明确，不需要低增益补充题。"
  },
  {
    personaId: "rank-master-public-management",
    fitPriority: ["field-research", "research-provenance"],
    goalPriority: ["postgraduate", "project"],
    trackPriorityByCompetition: { "challenge-cup-academic-science": ["social-survey"] },
    optionalDecision: "answer",
    fitRationale: "公共管理画像以案例、调研和数据为核心，实地调研能力应优先。",
    goalRationale: "科研升学是第一固定目标，候选应优先支持规范研究成果。",
    trackRationale: "若询问挑战杯内容方向，硕士公共管理画像只明确支持社会调查；技术发明没有固定工程原型证据。",
    optionalRationale: "调研候选可服务科研或项目，愿意确认科研升学优先。"
  },
  {
    personaId: "rank-master-culture",
    fitPriority: ["language-communication", "research-provenance"],
    goalPriority: ["portfolio", "postgraduate"],
    trackPriorityByCompetition: { "understanding-contemporary-china-foreign-language": ["short-video", "four-new"] },
    optionalDecision: "answer",
    fitRationale: "文化传播画像有语言表达和内容产出，语言沟通比泛设计作品更贴合。",
    goalRationale: "作品集为第一固定目标，应优先形成可公开展示的文化传播成果。",
    trackRationale: "若出现当代中国外语赛道题，只在短视频传播与四新调研等内容方向中选择；国际中文依赖来华留学生身份，不得由偏好回答决定。",
    optionalRationale: "文化研究与传播作品可能取向不同，愿意确认作品集优先。"
  },
  {
    personaId: "rank-doctorate-or-recent-modeling",
    fitPriority: ["modeling-intensive", "research-provenance"],
    goalPriority: ["award", "postgraduate"],
    trackPriorityByCompetition: {},
    optionalDecision: "skip",
    fitRationale: "博士或近期毕业画像仍以建模、编程和论文为核心，建模密集任务优先。",
    goalRationale: "固定目标将竞赛奖项置于科研成果之前，优先明确竞赛评价。",
    trackRationale: "没有建模领域题型偏好，学生组又是身份事实；静态 oracle 不依据模型排序补造赛道。",
    optionalRationale: "任务和目标信号已经收敛，直接推荐更符合流程效率。"
  },
  {
    personaId: "rank-doctorate-or-recent-electronics",
    fitPriority: ["hardware-build", "software-engineering"],
    goalPriority: ["project", "award"],
    trackPriorityByCompetition: {},
    optionalDecision: "skip",
    fitRationale: "电子系统画像具有硬件与嵌入式证据，硬件搭建是第一能力偏好。",
    goalRationale: "项目经历先于奖项，应优先可落地的电子系统项目。",
    trackRationale: "固定事实没有电子系统类别取向，学生组不是偏好；细分赛道不能由测试替用户回答。",
    optionalRationale: "硬件证据和项目目标足够明确，无需追加低增益题。"
  },
  {
    personaId: "rank-doctorate-or-recent-ai-research",
    fitPriority: ["algorithm-competition", "research-provenance"],
    goalPriority: ["project", "award"],
    trackPriorityByCompetition: {},
    optionalDecision: "skip",
    fitRationale: "AI 画像明确算法与研究实现，优先证明算法能力，再考虑研究证据。",
    goalRationale: "项目是第一固定目标，应优先完整、可复现的 AI 项目成果。",
    trackRationale: "没有任何 AI 应用场景事实，学生组属于身份事实；不能因候选存在赛道就杜撰偏好。",
    optionalRationale: "算法方向与项目目标已清晰，可直接进入推荐。"
  },
  {
    personaId: "rank-doctorate-or-recent-public-management",
    fitPriority: ["field-research", "research-provenance"],
    goalPriority: ["postgraduate", "project"],
    trackPriorityByCompetition: {
      "challenge-cup-academic-science": ["social-survey", "technology-invention"]
    },
    optionalDecision: "answer",
    fitRationale: "公共管理固定画像依赖案例和调研证据，实地调研为第一偏好。",
    goalRationale: "科研升学优先于项目经历，应先看规范研究产出。",
    trackRationale: "直博或硕博连读的替代申报通道仍需根据官方事实核验；这里只表达内容方向：公共管理优先社会调查，其次技术发明，绝不把偏好当作资格证据。",
    optionalRationale: "公共管理候选可能偏研究或偏项目，愿意确认科研优先。"
  },
  {
    personaId: "rank-doctorate-or-recent-culture",
    fitPriority: ["language-communication", "research-provenance"],
    goalPriority: ["portfolio", "postgraduate"],
    trackPriorityByCompetition: { "challenge-cup-academic-science": ["social-survey"] },
    optionalDecision: "answer",
    fitRationale: "文化传播画像需要语言表达与内容呈现，语言沟通是第一能力取向。",
    goalRationale: "作品集排在科研升学前，应优先可展示的传播成果。",
    trackRationale: "当代中国外语赛的国际中文依赖来华留学生身份，不能作为偏好；若挑战杯进入问题，文化研究画像只选择可承载文化传播调研的社会调查内容方向，资格仍以预计算快照为准。",
    optionalRationale: "传播作品与科研目标存在取舍，愿意确认作品集优先。"
  }
] as const satisfies readonly CompetitionPreferenceOracle[];
