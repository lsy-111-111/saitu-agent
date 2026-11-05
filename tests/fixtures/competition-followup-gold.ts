import type { CompetitionDynamicSignalKeyV3 } from "@/types/competition-recommendation";

export type CompetitionFollowupGoldBranch = {
  selectedValues: readonly [string] | readonly [string, string];
  /** Only members that the authored preference has an independent reason to surface. */
  expectedVisibleCompetitionIds: readonly [string, ...string[]];
  /** Members whose presence would contradict this authored preference branch. */
  expectedAbsentCompetitionIds?: readonly [string, ...string[]];
  /** Pairwise order only where the fixed profile and selected preference justify it. */
  expectedRelativeOrder?: readonly (
    readonly [higherCompetitionId: string, lowerCompetitionId: string]
  )[];
  /** Exact track only where the selected ability preference has a content-level implication. */
  expectedTrackByCompetition?: Readonly<Record<string, string>>;
  expectedTrackId?: string;
  precomputedTrackStatus?: "eligible" | "needs_clarification";
};

export type CompetitionFollowupGoldCase = {
  id: string;
  family: "fit" | "goal" | "track";
  personaId: string;
  profileSource: string;
  signalKey: CompetitionDynamicSignalKeyV3;
  /**
   * A literal, independently justified ability preference answered before a
   * goal trade-off. This lets a goal oracle examine a genuinely near-boundary
   * candidate set without changing the fixed V5 profile or qualification.
   */
  priorFitValues?: readonly [string] | readonly [string, string];
  /**
   * Literal answers needed before production may ask this authored track
   * question. Track gold must be reachable within three total V5 turns.
   */
  generateNextPath?: readonly {
    signalKey: "competition-fit" | "candidate-goal-tradeoff";
    selectedValues: readonly [string] | readonly [string, string];
  }[];
  branches: readonly [
    CompetitionFollowupGoldBranch,
    CompetitionFollowupGoldBranch,
    ...CompetitionFollowupGoldBranch[]
  ];
  evidenceRationale: string;
};

/**
 * Expert-authored material preference questions. Branches intentionally record
 * only the visible members, pairwise relations, or selected track supported by
 * the fixed profile and the preference. They do not copy an implementation's
 * entire Top 3 when the preference supplies no independent reason for it.
 */
export const staticCompetitionFollowupGoldCases = [
  {
    id: "fit-01", family: "fit", personaId: "anchor-china-international-college-innovation", profileSource: "competition-quality-anchors-1.ts#anchor-china-international-college-innovation", signalKey: "competition-fit",
    branches: [
      { selectedValues: ["venture-readiness"], expectedVisibleCompetitionIds: ["china-international-college-innovation", "vocational-innovation-entrepreneurship"], expectedRelativeOrder: [["china-international-college-innovation", "vocational-innovation-entrepreneurship"]] },
      { selectedValues: ["product-validation"], expectedVisibleCompetitionIds: ["china-us-young-maker", "china-international-college-innovation"], expectedRelativeOrder: [["china-us-young-maker", "china-international-college-innovation"]] }
    ],
    evidenceRationale: "创业准备直接使用商业计划、路演和团队落地证据；产品验证直接使用已确认的工程原型和创客制作证据。固定画像没有航空任务证据，因此本金标不把低空赛事写成产品验证的必然结果。"
  },
  {
    id: "fit-02", family: "fit", personaId: "anchor-challenge-cup-academic-science", profileSource: "competition-quality-anchors-1.ts#anchor-challenge-cup-academic-science", signalKey: "competition-fit",
    branches: [
      { selectedValues: ["research-provenance"], expectedVisibleCompetitionIds: ["challenge-cup-academic-science"], expectedTrackByCompetition: { "challenge-cup-academic-science": "natural-science-paper" } },
      { selectedValues: ["field-research"], expectedVisibleCompetitionIds: ["challenge-cup-academic-science"], expectedTrackByCompetition: { "challenge-cup-academic-science": "social-survey" } }
    ],
    evidenceRationale: "原创研究证据指向可追溯的自然科学论文，田野调研指向社会调查报告；这里只审核内容赛道变化，不替用户证明作品来源等资格事实。"
  },
  {
    id: "fit-03", family: "fit", personaId: "anchor-national-college-math-modeling", profileSource: "competition-quality-anchors-1.ts#anchor-national-college-math-modeling", signalKey: "competition-fit",
    branches: [
      { selectedValues: ["modeling-intensive"], expectedVisibleCompetitionIds: ["national-college-math-modeling", "comap-mcm-icm"], expectedRelativeOrder: [["national-college-math-modeling", "comap-mcm-icm"]] },
      { selectedValues: ["research-provenance"], expectedVisibleCompetitionIds: ["comap-mcm-icm", "zhou-peiyuan-mechanics"], expectedRelativeOrder: [["comap-mcm-icm", "zhou-peiyuan-mechanics"]] },
      { selectedValues: ["modeling-intensive", "research-provenance"], expectedVisibleCompetitionIds: ["comap-mcm-icm", "national-college-math-modeling"], expectedRelativeOrder: [["comap-mcm-icm", "national-college-math-modeling"]] }
    ],
    evidenceRationale: "建模实战优先国内数模的限时模型、代码和论文交付；研究溯源偏好更支持COMAP的英文建模论文路径。周培源目录明确含statistics-mathematics与research-provenance，因此研究分支可作为次位学术论文路径，但画像未确认力学专项，不应反超COMAP。"
  },
  {
    id: "fit-04", family: "fit", personaId: "anchor-challenge-cup-entrepreneurship-plan", profileSource: "competition-quality-anchors-1.ts#anchor-challenge-cup-entrepreneurship-plan", signalKey: "competition-fit",
    branches: [
      { selectedValues: ["venture-readiness"], expectedVisibleCompetitionIds: ["challenge-cup-entrepreneurship-plan", "ecommerce-innovation-creativity-entrepreneurship"], expectedRelativeOrder: [["challenge-cup-entrepreneurship-plan", "ecommerce-innovation-creativity-entrepreneurship"]] },
      { selectedValues: ["finance-operations"], expectedVisibleCompetitionIds: ["business-elite-innovation", "xuechuangbei-business-simulation"], expectedRelativeOrder: [["business-elite-innovation", "xuechuangbei-business-simulation"]] }
    ],
    evidenceRationale: "创业路演复用画像的商业计划、原型和项目证据；经营财务复用商业学科、数据分析和汇报，并转向经营决策任务。"
  },
  {
    id: "fit-05", family: "fit", personaId: "anchor-national-college-electronic-design", profileSource: "competition-quality-anchors-1.ts#anchor-national-college-electronic-design", signalKey: "competition-fit",
    branches: [
      { selectedValues: ["hardware-build"], expectedVisibleCompetitionIds: ["national-college-electronic-design", "integrated-circuit-innovation"], expectedRelativeOrder: [["national-college-electronic-design", "integrated-circuit-innovation"]] },
      { selectedValues: ["robotics-integration"], expectedVisibleCompetitionIds: ["smart-car", "robocon"], expectedRelativeOrder: [["smart-car", "robocon"]] },
      { selectedValues: ["hardware-build", "robotics-integration"], expectedVisibleCompetitionIds: ["national-college-electronic-design", "smart-car"], expectedRelativeOrder: [["national-college-electronic-design", "smart-car"]] }
    ],
    evidenceRationale: "电路硬件偏好直接对应全国电赛和芯片设计；机器人集成偏好对应智能车与 Robocon 的控制和整机联调；双选应同时保留一项直接硬件赛和一项直接机器人赛。"
  },
  {
    id: "fit-06", family: "fit", personaId: "anchor-integrated-circuit-innovation", profileSource: "competition-quality-anchors-1.ts#anchor-integrated-circuit-innovation", signalKey: "competition-fit",
    branches: [
      { selectedValues: ["hardware-build"], expectedVisibleCompetitionIds: ["integrated-circuit-innovation", "graduate-electronic-design"], expectedRelativeOrder: [["integrated-circuit-innovation", "graduate-electronic-design"]] },
      { selectedValues: ["network-systems"], expectedVisibleCompetitionIds: ["datang-ict", "china-college-computer-contest"], expectedRelativeOrder: [["datang-ict", "china-college-computer-contest"]] }
    ],
    evidenceRationale: "硬件制作由芯片、电路和嵌入式原型直接支撑；网络系统偏好才转向通信网络实操及网络技术任务。"
  },
  {
    id: "fit-07", family: "fit", personaId: "anchor-enterprise-competition-simulation", profileSource: "competition-quality-anchors-4.ts#anchor-enterprise-competition-simulation", signalKey: "competition-fit",
    branches: [
      { selectedValues: ["finance-operations"], expectedVisibleCompetitionIds: ["enterprise-competition-simulation", "tax-risk-case"], expectedRelativeOrder: [["enterprise-competition-simulation", "tax-risk-case"]] },
      { selectedValues: ["field-research"], expectedVisibleCompetitionIds: ["tax-risk-case", "market-research-analysis"], expectedRelativeOrder: [["tax-risk-case", "market-research-analysis"]] }
    ],
    evidenceRationale: "经营财务偏好使用企业沙盘与财税决策证据；田野调研偏好使用税务调查、市场采样和研究报告证据。"
  },
  {
    id: "fit-08", family: "fit", personaId: "anchor-understanding-contemporary-china-foreign-language", profileSource: "competition-quality-anchors-1.ts#anchor-understanding-contemporary-china-foreign-language", signalKey: "competition-fit",
    branches: [
      { selectedValues: ["language-communication"], expectedVisibleCompetitionIds: ["understanding-contemporary-china-foreign-language"], expectedTrackByCompetition: { "understanding-contemporary-china-foreign-language": "english-comprehensive" } },
      { selectedValues: ["field-research"], expectedVisibleCompetitionIds: ["understanding-contemporary-china-foreign-language"], expectedTrackByCompetition: { "understanding-contemporary-china-foreign-language": "four-new" } }
    ],
    evidenceRationale: "语言沟通直接支持英语综合赛道；固定画像的研究和项目证据支持四新专项的调研与建设交付，两个偏好应产生可见赛道变化。"
  },
  {
    id: "fit-09", family: "fit", personaId: "anchor-energy-conservation-emission-reduction", profileSource: "competition-quality-anchors-1.ts#anchor-energy-conservation-emission-reduction", signalKey: "competition-fit",
    branches: [
      { selectedValues: ["sustainability-impact"], expectedVisibleCompetitionIds: ["energy-conservation-emission-reduction", "green-development"], expectedRelativeOrder: [["energy-conservation-emission-reduction", "green-development"]] },
      { selectedValues: ["modeling-intensive"], expectedVisibleCompetitionIds: ["energy-economics-academic-creativity", "energy-conservation-emission-reduction"], expectedRelativeOrder: [["energy-economics-academic-creativity", "energy-conservation-emission-reduction"]] },
      { selectedValues: ["sustainability-impact", "modeling-intensive"], expectedVisibleCompetitionIds: ["energy-conservation-emission-reduction", "energy-economics-academic-creativity"], expectedRelativeOrder: [["energy-conservation-emission-reduction", "energy-economics-academic-creativity"]] }
    ],
    evidenceRationale: "环境成效由节能原型和实验数据直接支持；量化建模由统计与研究报告支持但仍需能源经济补课；双选应保留环境交付主项并提升量化研究。"
  },
  {
    id: "fit-10", family: "fit", personaId: "anchor-ecommerce-innovation-creativity-entrepreneurship", profileSource: "competition-quality-anchors-1.ts#anchor-ecommerce-innovation-creativity-entrepreneurship", signalKey: "competition-fit",
    branches: [
      { selectedValues: ["venture-readiness"], expectedVisibleCompetitionIds: ["ecommerce-innovation-creativity-entrepreneurship", "challenge-cup-entrepreneurship-plan"], expectedRelativeOrder: [["ecommerce-innovation-creativity-entrepreneurship", "challenge-cup-entrepreneurship-plan"]] },
      { selectedValues: ["finance-operations"], expectedVisibleCompetitionIds: ["icbc-fintech-innovation", "business-elite-innovation"], expectedRelativeOrder: [["icbc-fintech-innovation", "business-elite-innovation"]] }
    ],
    evidenceRationale: "创业成熟度直接使用电商运营、市场验证和路演证据；金融经营转向金融科技与商业决策任务。"
  },
  {
    id: "fit-11", family: "fit", personaId: "anchor-smart-car", profileSource: "competition-quality-anchors-1.ts#anchor-smart-car", signalKey: "competition-fit",
    branches: [
      { selectedValues: ["robotics-integration"], expectedVisibleCompetitionIds: ["smart-car", "robocon"], expectedRelativeOrder: [["smart-car", "robocon"]] },
      { selectedValues: ["hardware-build"], expectedVisibleCompetitionIds: ["smart-car", "robotac"], expectedRelativeOrder: [["smart-car", "robotac"]] }
    ],
    evidenceRationale: "画像的智能车整车、电控硬件和现场联调均为直接证据。本金标只比较同为needs_clarification层的智能车、Robocon与RobotAC，不要求偏好跨越任何资格层。"
  },
  {
    id: "fit-12", family: "fit", personaId: "anchor-graduate-electronic-design", profileSource: "competition-quality-anchors-4.ts#anchor-graduate-electronic-design", signalKey: "competition-fit",
    branches: [
      { selectedValues: ["hardware-build"], expectedVisibleCompetitionIds: ["graduate-electronic-design", "integrated-circuit-innovation"], expectedRelativeOrder: [["graduate-electronic-design", "integrated-circuit-innovation"]] },
      { selectedValues: ["network-systems"], expectedVisibleCompetitionIds: ["datang-ict", "china-college-computer-contest"], expectedRelativeOrder: [["datang-ict", "china-college-computer-contest"]] }
    ],
    evidenceRationale: "研究生电子设计和集成电路均直接使用硬件、编程、原型与工程实践证据；网络偏好才支持大唐杯与网络技术赛。本金标只审核同为needs_clarification层的成员与相对顺序，允许eligible的系统能力赛按四层规则先填位。"
  },

  {
    id: "goal-01", family: "goal", personaId: "anchor-understanding-contemporary-china-foreign-language", profileSource: "competition-quality-anchors-1.ts#anchor-understanding-contemporary-china-foreign-language", signalKey: "candidate-goal-tradeoff",
    branches: [
      { selectedValues: ["award"], expectedVisibleCompetitionIds: ["understanding-contemporary-china-foreign-language", "intercultural-competence"], expectedRelativeOrder: [["understanding-contemporary-china-foreign-language", "intercultural-competence"]] },
      { selectedValues: ["portfolio"], expectedVisibleCompetitionIds: ["intercultural-competence", "understanding-contemporary-china-foreign-language"], expectedRelativeOrder: [["intercultural-competence", "understanding-contemporary-china-foreign-language"]] }
    ],
    evidenceRationale: "两项赛事同属语言文化且资格同层：当代中国的award目录值高于跨文化赛，跨文化赛的portfolio目录值更高。追问仅以25%重新加权goalsOutputs，故只审核二者的近边界相对顺序。"
  },
  {
    id: "goal-02", family: "goal", personaId: "anchor-challenge-cup-entrepreneurship-plan", profileSource: "competition-quality-anchors-1.ts#anchor-challenge-cup-entrepreneurship-plan", signalKey: "candidate-goal-tradeoff", priorFitValues: ["field-research"],
    branches: [
      { selectedValues: ["award"], expectedVisibleCompetitionIds: ["challenge-cup-academic-science", "challenge-cup-entrepreneurship-plan"], expectedRelativeOrder: [["challenge-cup-academic-science", "challenge-cup-entrepreneurship-plan"]] },
      { selectedValues: ["entrepreneurship"], expectedVisibleCompetitionIds: ["challenge-cup-entrepreneurship-plan", "challenge-cup-academic-science"], expectedRelativeOrder: [["challenge-cup-entrepreneurship-plan", "challenge-cup-academic-science"]] }
    ],
    evidenceRationale: "field-research先把两项挑战杯放到同一内容近边界，两者资格均为待核验。学术赛的award值高但entrepreneurship值低，创业赛的创业值为满值；25%目标修正只应交换这对近邻顺序。"
  },
  {
    id: "goal-03", family: "goal", personaId: "anchor-national-college-electronic-design", profileSource: "competition-quality-anchors-1.ts#anchor-national-college-electronic-design", signalKey: "candidate-goal-tradeoff", priorFitValues: ["network-systems"],
    branches: [
      { selectedValues: ["award"], expectedVisibleCompetitionIds: ["smart-car"], expectedAbsentCompetitionIds: ["huawei-ict"] },
      { selectedValues: ["employment"], expectedVisibleCompetitionIds: ["huawei-ict"], expectedAbsentCompetitionIds: ["smart-car"] }
    ],
    evidenceRationale: "network-systems偏好后，全国电赛的eligible主项与网络技术候选不受目标追问改变；本金标只审核同为needs_clarification层的第三项。award相对支持智能车竞技成果，employment相对支持华为ICT工程就业，并且只能通过25% goalsOutputs微调换位。"
  },
  {
    id: "goal-04", family: "goal", personaId: "anchor-graduate-rural-revitalization-agritech", profileSource: "competition-quality-anchors-2.ts#anchor-graduate-rural-revitalization-agritech", signalKey: "candidate-goal-tradeoff", priorFitValues: ["sustainability-impact"],
    branches: [
      { selectedValues: ["postgraduate"], expectedVisibleCompetitionIds: ["energy-conservation-emission-reduction", "water-innovation-design"], expectedRelativeOrder: [["energy-conservation-emission-reduction", "water-innovation-design"]] },
      { selectedValues: ["project"], expectedVisibleCompetitionIds: ["water-innovation-design", "energy-conservation-emission-reduction"], expectedRelativeOrder: [["water-innovation-design", "energy-conservation-emission-reduction"]] }
    ],
    evidenceRationale: "sustainability-impact先将节能减排与水利创新置于同一可持续内容层，两者资格均待核验。节能赛的postgraduate值高于水利赛，水利赛的project值更高；因此只对两者近边界顺序建立ororacle。"
  },
  {
    id: "goal-05", family: "goal", personaId: "anchor-xuechuangbei-business-simulation", profileSource: "competition-quality-anchors-2.ts#anchor-xuechuangbei-business-simulation", signalKey: "candidate-goal-tradeoff", priorFitValues: ["sustainability-impact"],
    branches: [
      { selectedValues: ["employment"], expectedVisibleCompetitionIds: ["national-college-logistics-design", "energy-economics-academic-creativity"], expectedRelativeOrder: [["national-college-logistics-design", "energy-economics-academic-creativity"]] },
      { selectedValues: ["award"], expectedVisibleCompetitionIds: ["energy-economics-academic-creativity", "national-college-logistics-design"], expectedRelativeOrder: [["energy-economics-academic-creativity", "national-college-logistics-design"]] }
    ],
    evidenceRationale: "sustainability-impact后的绿色发展主项保持不变，只审核同为needs_clarification层的物流设计与能源经济。employment使物流赛相对回到其满值行业交付；award会减少这项就业优势，使能源研究的原有任务优势在25%微调后恢复。"
  },
  {
    id: "goal-06", family: "goal", personaId: "anchor-computer-system-ability", profileSource: "competition-quality-anchors-3.ts#anchor-computer-system-ability", signalKey: "candidate-goal-tradeoff", priorFitValues: ["algorithm-competition"],
    branches: [
      { selectedValues: ["project"], expectedVisibleCompetitionIds: ["baidu-star", "icpc-programming"], expectedRelativeOrder: [["baidu-star", "icpc-programming"]] },
      { selectedValues: ["employment"], expectedVisibleCompetitionIds: ["icpc-programming", "baidu-star"], expectedRelativeOrder: [["icpc-programming", "baidu-star"]] }
    ],
    evidenceRationale: "algorithm-competition后，百度之星与ICPC都使用已确认的算法、编程和软件证据，且资格同为待核验。百度之星的project值高，ICPC的employment值为满值；目标维仅允许二者小幅交换顺序。"
  },
  {
    id: "goal-07", family: "goal", personaId: "rank-undergraduate-upper-finance-tax", profileSource: "competition-quality-ranking-gold.ts#rank-undergraduate-upper-finance-tax", signalKey: "candidate-goal-tradeoff", priorFitValues: ["finance-operations"],
    branches: [
      { selectedValues: ["employment"], expectedVisibleCompetitionIds: ["icbc-fintech-innovation"], expectedAbsentCompetitionIds: ["enterprise-competition-simulation"] },
      { selectedValues: ["award"], expectedVisibleCompetitionIds: ["enterprise-competition-simulation"], expectedAbsentCompetitionIds: ["icbc-fintech-innovation"] }
    ],
    evidenceRationale: "finance-operations后，税务风险与商业精英保持前两位；本金标只审核同资格层的第三位。ICBC的employment值为满值，而award优先会消除它的就业优势，让同域经营沙盘凭原有任务匹配进入；不要求微调跨越精确财税主项。"
  },
  {
    id: "goal-08", family: "goal", personaId: "anchor-raicom-robot-developer", profileSource: "competition-quality-anchors-3.ts#anchor-raicom-robot-developer", signalKey: "candidate-goal-tradeoff",
    branches: [
      { selectedValues: ["project"], expectedVisibleCompetitionIds: ["china-robot-ai"], expectedAbsentCompetitionIds: ["robocup-china"] },
      { selectedValues: ["employment"], expectedVisibleCompetitionIds: ["robocup-china"], expectedAbsentCompetitionIds: ["china-robot-ai"] }
    ],
    evidenceRationale: "RobotAC与智能机器人在两分支保持主项，本金标只审核同为needs_clarification层的第三位。project优先保留中国机器人AI的应用开发边界优势，employment优先则相对支持RoboCup的系统集成与现场工程价值；两者只能由goalsOutputs微调换位。"
  },
  {
    id: "goal-09", family: "goal", personaId: "anchor-graduate-public-management-case", profileSource: "competition-quality-anchors-4.ts#anchor-graduate-public-management-case", signalKey: "candidate-goal-tradeoff",
    branches: [
      { selectedValues: ["entrepreneurship"], expectedVisibleCompetitionIds: ["china-international-college-innovation"], expectedAbsentCompetitionIds: ["youth-tech-challenge"] },
      { selectedValues: ["project"], expectedVisibleCompetitionIds: ["youth-tech-challenge"], expectedAbsentCompetitionIds: ["china-international-college-innovation"] }
    ],
    evidenceRationale: "公共管理案例与挑战杯社会调查在两分支均保持精确前两位，且所有审核成员资格同层。中国国际大学生创新大赛的entrepreneurship值为满值，青年科技挑战的project值显著高于其创业值；25%修正只决定第三位，不得泄漏其他anchor目标。"
  },
  {
    id: "goal-10", family: "goal", personaId: "rank-vocational-visual-design", profileSource: "competition-quality-ranking-gold.ts#rank-vocational-visual-design", signalKey: "candidate-goal-tradeoff",
    branches: [
      { selectedValues: ["portfolio"], expectedVisibleCompetitionIds: ["huacan-design-award"], expectedAbsentCompetitionIds: ["future-designer-ncda"] },
      { selectedValues: ["award"], expectedVisibleCompetitionIds: ["future-designer-ncda"], expectedAbsentCompetitionIds: ["huacan-design-award"] }
    ],
    evidenceRationale: "中国好设计与米兰设计周保持同域前两位，只审核同为needs_clarification层的第三位。华灿的portfolio值远高于其award值，NCDA在award目标下的相对优势更大；因此微调可换第三项，不得改写设计主任务。"
  },
  {
    id: "goal-11", family: "goal", personaId: "anchor-3d-digital-innovation-design", profileSource: "competition-quality-anchors-3.ts#anchor-3d-digital-innovation-design", signalKey: "candidate-goal-tradeoff", priorFitValues: ["software-engineering"],
    branches: [
      { selectedValues: ["portfolio"], expectedVisibleCompetitionIds: ["china-good-design", "bim-graduation-design"], expectedRelativeOrder: [["china-good-design", "bim-graduation-design"]] },
      { selectedValues: ["project"], expectedVisibleCompetitionIds: ["bim-graduation-design", "china-good-design"], expectedRelativeOrder: [["bim-graduation-design", "china-good-design"]] }
    ],
    evidenceRationale: "software-engineering偏好将中国好设计与BIM毕业设计置于同一数字交付近边界，两者资格均待核验。前者的portfolio值高，后者的project值高；25%修正只审核这对顺序，不对第三项做无因果的完整Top3背书。"
  },
  {
    id: "goal-12", family: "goal", personaId: "rank-master-public-management", profileSource: "competition-quality-ranking-gold.ts#rank-master-public-management", signalKey: "candidate-goal-tradeoff", priorFitValues: ["finance-operations"],
    branches: [
      { selectedValues: ["postgraduate"], expectedVisibleCompetitionIds: ["tax-risk-case", "business-elite-innovation"], expectedRelativeOrder: [["tax-risk-case", "business-elite-innovation"]] },
      { selectedValues: ["project"], expectedVisibleCompetitionIds: ["business-elite-innovation", "tax-risk-case"], expectedRelativeOrder: [["business-elite-innovation", "tax-risk-case"]] }
    ],
    evidenceRationale: "finance-operations后，公共管理案例主项在两分支保持不变，只比较同为needs_clarification层的税务案例与商业精英。税务赛的postgraduate值高于商业精英，商业精英的project值更高；目标追问仅以25%权重交换这对相邻顺序。"
  },

  {
    id: "track-01", family: "track", personaId: "anchor-basic-medicine-innovation", profileSource: "competition-quality-anchors-4.ts#anchor-basic-medicine-innovation", signalKey: "track:challenge-cup-academic-science",
    generateNextPath: [{ signalKey: "competition-fit", selectedValues: ["research-provenance"] }],
    branches: [
      { selectedValues: ["natural-science-paper"], expectedVisibleCompetitionIds: ["challenge-cup-academic-science"], expectedTrackId: "natural-science-paper", precomputedTrackStatus: "needs_clarification" },
      { selectedValues: ["technology-invention"], expectedVisibleCompetitionIds: ["challenge-cup-academic-science"], expectedTrackId: "technology-invention", precomputedTrackStatus: "needs_clarification" }
    ],
    evidenceRationale: "基础医学研究可沉淀自然科学论文，也可把实验结果转为技术发明；作品来源等资格事实仍待核验，方向选择不得升级资格。"
  },
  {
    id: "track-02", family: "track", personaId: "anchor-challenge-cup-academic-science", profileSource: "competition-quality-anchors-1.ts#anchor-challenge-cup-academic-science", signalKey: "track:challenge-cup-academic-science",
    generateNextPath: [{ signalKey: "competition-fit", selectedValues: ["research-provenance"] }],
    branches: [
      { selectedValues: ["natural-science-paper"], expectedVisibleCompetitionIds: ["challenge-cup-academic-science"], expectedTrackId: "natural-science-paper", precomputedTrackStatus: "needs_clarification" },
      { selectedValues: ["social-survey"], expectedVisibleCompetitionIds: ["challenge-cup-academic-science"], expectedTrackId: "social-survey", precomputedTrackStatus: "needs_clarification" }
    ],
    evidenceRationale: "自然科学论文与社会调查是研究对象和交付方式的内容取舍；作品来源等官方事实未确认，两方向均保持待核验。"
  },
  {
    id: "track-03", family: "track", personaId: "anchor-intercultural-competence", profileSource: "competition-quality-anchors-3.ts#anchor-intercultural-competence", signalKey: "track:understanding-contemporary-china-foreign-language",
    generateNextPath: [{ signalKey: "competition-fit", selectedValues: ["language-communication"] }],
    branches: [
      { selectedValues: ["short-video"], expectedVisibleCompetitionIds: ["understanding-contemporary-china-foreign-language"], expectedTrackId: "short-video", precomputedTrackStatus: "needs_clarification" },
      { selectedValues: ["four-new"], expectedVisibleCompetitionIds: ["understanding-contemporary-china-foreign-language"], expectedTrackId: "four-new", precomputedTrackStatus: "needs_clarification" }
    ],
    evidenceRationale: "短视频侧重多媒体国际传播，四新专项侧重学科调研与建设方案，二者均为内容方向；来华留学生身份组不得进入动态问题。"
  },
  {
    id: "track-04", family: "track", personaId: "anchor-understanding-contemporary-china-foreign-language", profileSource: "competition-quality-anchors-1.ts#anchor-understanding-contemporary-china-foreign-language", signalKey: "track:understanding-contemporary-china-foreign-language",
    generateNextPath: [],
    branches: [
      { selectedValues: ["english-comprehensive"], expectedVisibleCompetitionIds: ["understanding-contemporary-china-foreign-language"], expectedTrackId: "english-comprehensive", precomputedTrackStatus: "needs_clarification" },
      { selectedValues: ["translation"], expectedVisibleCompetitionIds: ["understanding-contemporary-china-foreign-language"], expectedTrackId: "translation", precomputedTrackStatus: "needs_clarification" }
    ],
    evidenceRationale: "英语综合与翻译是画像可选择的两种内容交付，用户选择只采用各自预计算资格状态。"
  },
  {
    id: "track-05", family: "track", personaId: "anchor-graduate-rural-revitalization-agritech", profileSource: "competition-quality-anchors-2.ts#anchor-graduate-rural-revitalization-agritech", signalKey: "track:graduate-rural-revitalization-agritech",
    generateNextPath: [{ signalKey: "competition-fit", selectedValues: ["research-provenance"] }],
    branches: [
      { selectedValues: ["technology-invention"], expectedVisibleCompetitionIds: ["graduate-rural-revitalization-agritech"], expectedTrackId: "technology-invention", precomputedTrackStatus: "needs_clarification" },
      { selectedValues: ["natural-science"], expectedVisibleCompetitionIds: ["graduate-rural-revitalization-agritech"], expectedTrackId: "natural-science", precomputedTrackStatus: "needs_clarification" }
    ],
    evidenceRationale: "科技发明复用农业设备原型，自然科学复用实验数据与论文；未确认的官方事实使两者都保持待核验。"
  },
  {
    id: "track-06", family: "track", personaId: "anchor-embedded-chip-system-design", profileSource: "competition-quality-anchors-2.ts#anchor-embedded-chip-system-design", signalKey: "track:datang-ict",
    generateNextPath: [{ signalKey: "competition-fit", selectedValues: ["hardware-build"] }],
    branches: [
      { selectedValues: ["engineering-practice"], expectedVisibleCompetitionIds: ["datang-ict"], expectedTrackId: "engineering-practice", precomputedTrackStatus: "needs_clarification" },
      { selectedValues: ["5g-innovation"], expectedVisibleCompetitionIds: ["datang-ict"], expectedTrackId: "5g-innovation", precomputedTrackStatus: "needs_clarification" }
    ],
    evidenceRationale: "嵌入式芯片画像确认通信信息、编程、硬件和系统原型；工程实践偏设备与系统实操，5G创新偏新一代通信应用。两个纯内容方向都只采用预计算的待核验状态。"
  },
  {
    id: "track-07", family: "track", personaId: "anchor-datang-ict", profileSource: "competition-quality-anchors-3.ts#anchor-datang-ict", signalKey: "track:datang-ict",
    generateNextPath: [{ signalKey: "competition-fit", selectedValues: ["network-systems"] }],
    branches: [
      { selectedValues: ["engineering-practice"], expectedVisibleCompetitionIds: ["datang-ict"], expectedTrackId: "engineering-practice", precomputedTrackStatus: "needs_clarification" },
      { selectedValues: ["5g-innovation"], expectedVisibleCompetitionIds: ["datang-ict"], expectedTrackId: "5g-innovation", precomputedTrackStatus: "needs_clarification" }
    ],
    evidenceRationale: "工程实践侧重通信设备实操，5G 创新侧重新一代通信应用；内容选择不补充队伍和当届报名事实。"
  },
  {
    id: "track-08", family: "track", personaId: "anchor-energy-conservation-emission-reduction", profileSource: "competition-quality-anchors-1.ts#anchor-energy-conservation-emission-reduction", signalKey: "track:challenge-cup-academic-science",
    generateNextPath: [{ signalKey: "competition-fit", selectedValues: ["field-research"] }],
    branches: [
      { selectedValues: ["social-survey"], expectedVisibleCompetitionIds: ["challenge-cup-academic-science"], expectedTrackId: "social-survey", precomputedTrackStatus: "needs_clarification" },
      { selectedValues: ["technology-invention"], expectedVisibleCompetitionIds: ["challenge-cup-academic-science"], expectedTrackId: "technology-invention", precomputedTrackStatus: "needs_clarification" }
    ],
    evidenceRationale: "环保调研复用环境数据与田野报告，技术发明复用节能设备原型；作品来源等事实未确认，两个方向均保持待核验。"
  },
  {
    id: "track-09", family: "track", personaId: "anchor-computer-system-ability", profileSource: "competition-quality-anchors-3.ts#anchor-computer-system-ability", signalKey: "track:datang-ict",
    generateNextPath: [{ signalKey: "competition-fit", selectedValues: ["network-systems"] }],
    branches: [
      { selectedValues: ["engineering-practice"], expectedVisibleCompetitionIds: ["datang-ict"], expectedTrackId: "engineering-practice", precomputedTrackStatus: "needs_clarification" },
      { selectedValues: ["5g-innovation"], expectedVisibleCompetitionIds: ["datang-ict"], expectedTrackId: "5g-innovation", precomputedTrackStatus: "needs_clarification" }
    ],
    evidenceRationale: "工程实践偏通信网络规划与设备实操，5G 创新偏新一代通信应用；已有系统编程和网络证据只能支持内容偏好，不能补资格。"
  },
  {
    id: "track-10", family: "track", personaId: "anchor-culsc-life-sciences", profileSource: "competition-quality-anchors-4.ts#anchor-culsc-life-sciences", signalKey: "track:challenge-cup-academic-science",
    generateNextPath: [{ signalKey: "competition-fit", selectedValues: ["research-provenance"] }],
    branches: [
      { selectedValues: ["natural-science-paper"], expectedVisibleCompetitionIds: ["challenge-cup-academic-science"], expectedTrackId: "natural-science-paper", precomputedTrackStatus: "needs_clarification" },
      { selectedValues: ["technology-invention"], expectedVisibleCompetitionIds: ["challenge-cup-academic-science"], expectedTrackId: "technology-invention", precomputedTrackStatus: "needs_clarification" }
    ],
    evidenceRationale: "生命科学画像同时确认实验数据、研究论文与项目原型：自然科学论文偏研究方法与论文，科技发明偏实验结果的原型化。选择仅改内容赛道，作品来源等事实仍待核验。"
  },
  {
    id: "track-11", family: "track", personaId: "anchor-21st-century-english-speaking", profileSource: "competition-quality-anchors-2.ts#anchor-21st-century-english-speaking", signalKey: "track:understanding-contemporary-china-foreign-language",
    generateNextPath: [],
    branches: [
      { selectedValues: ["english-comprehensive"], expectedVisibleCompetitionIds: ["understanding-contemporary-china-foreign-language"], expectedTrackId: "english-comprehensive", precomputedTrackStatus: "needs_clarification" },
      { selectedValues: ["translation"], expectedVisibleCompetitionIds: ["understanding-contemporary-china-foreign-language"], expectedTrackId: "translation", precomputedTrackStatus: "needs_clarification" }
    ],
    evidenceRationale: "英语综合和翻译都是演讲画像可准备的内容方向，赛道选择采用既有资格状态而不改变快照。"
  },
  {
    id: "track-12", family: "track", personaId: "anchor-national-innovation-training-annual", profileSource: "competition-quality-anchors-2.ts#anchor-national-innovation-training-annual", signalKey: "track:challenge-cup-academic-science",
    generateNextPath: [{ signalKey: "competition-fit", selectedValues: ["product-validation"] }],
    branches: [
      { selectedValues: ["natural-science-paper"], expectedVisibleCompetitionIds: ["challenge-cup-academic-science"], expectedTrackId: "natural-science-paper", precomputedTrackStatus: "needs_clarification" },
      { selectedValues: ["technology-invention"], expectedVisibleCompetitionIds: ["challenge-cup-academic-science"], expectedTrackId: "technology-invention", precomputedTrackStatus: "needs_clarification" }
    ],
    evidenceRationale: "画像已有研究、论文、项目和原型；自然科学论文偏方法与论文，技术发明偏实体原型和验证，资格事实仍待核验。"
  }
] as const satisfies readonly CompetitionFollowupGoldCase[];
