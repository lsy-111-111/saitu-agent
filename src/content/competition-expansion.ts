import type {
  CompetitionDirection,
  CompetitionMetadataSource,
  CompetitionRecommendationMetadata,
  CompetitionSource,
  CompetitionSubjectArea
} from "@/content/competitions";
import type {
  CompetitionFitSignal,
  CompetitionGoal,
  CompetitionInterest,
  CompetitionMajorField,
  CompetitionPreferredOutput,
  CompetitionResource,
  CompetitionSkill,
  CompetitionStudentStage,
  CompetitionWeeklyHours
} from "@/types/competition-recommendation";

export const COMPETITION_EXPANSION_VERIFIED_AT = "2026-08-23";

const undergraduateStages: readonly CompetitionStudentStage[] = [
  "undergraduate-1",
  "undergraduate-2",
  "undergraduate-3",
  "undergraduate-4"
];

const graduateStages: readonly CompetitionStudentStage[] = ["master", "doctorate"];

const collegiateStages: readonly CompetitionStudentStage[] = [
  "vocational",
  ...undergraduateStages,
  ...graduateStages
];

const baseGoalValues: Record<CompetitionGoal, number> = {
  project: 0.72,
  award: 0.68,
  postgraduate: 0.62,
  employment: 0.66,
  portfolio: 0.58,
  entrepreneurship: 0.42,
  networking: 0.48
};

type ExpansionSpec = {
  id: string;
  name: string;
  category: string;
  direction: CompetitionDirection;
  summary: string;
  aliases?: readonly string[];
  organizer: string;
  sourceUrl: string;
  sourceType: CompetitionMetadataSource["sourceType"];
  subjects: readonly CompetitionSubjectArea[];
  majors: readonly CompetitionMajorField[];
  skills: readonly CompetitionSkill[];
  interests: readonly CompetitionInterest[];
  outputs: readonly CompetitionPreferredOutput[];
  evidence: readonly string[];
  qualityTaskPrototypeRequired?: boolean;
  fitSignals: readonly CompetitionFitSignal[];
  preferenceFitSignals?: readonly CompetitionFitSignal[];
  focus: string;
  deliverable: string;
  suitableFor: readonly [string, string, ...string[]];
  stages: CompetitionRecommendationMetadata["stages"];
  teamRequirement: CompetitionRecommendationMetadata["teamRequirement"];
  requiredResources?: readonly CompetitionResource[];
  helpfulResources?: readonly CompetitionResource[];
  weeklyHours?: readonly CompetitionWeeklyHours[];
  difficulty?: CompetitionRecommendationMetadata["difficulty"];
  eligibilityState: NonNullable<CompetitionRecommendationMetadata["eligibility"]>["state"];
  eligibilityNotes: readonly string[];
  blockingClarifications?: readonly string[];
  stageClarificationNotes?: NonNullable<
    CompetitionRecommendationMetadata["eligibility"]
  >["stageClarificationNotes"];
  partTimeStageClarificationNotes?: NonNullable<
    CompetitionRecommendationMetadata["eligibility"]
  >["partTimeStageClarificationNotes"];
  requiresFullTime?: boolean;
  requiresFullTimeStages?: NonNullable<
    CompetitionRecommendationMetadata["eligibility"]
  >["requiresFullTimeStages"];
  requiresCurrentEnrollment?: boolean;
  sameInstitutionTeam?: boolean;
  schedule?: CompetitionRecommendationMetadata["schedule"];
  tracks?: CompetitionRecommendationMetadata["tracks"];
  supportingSources?: readonly CompetitionMetadataSource[];
  additionalDataNotices?: readonly string[];
  featured?: boolean;
  dataCompleteness: number;
};

type ExpansionEvidenceReview = {
  /** Facts actually stated by the primary URL, rather than inferred from its title. */
  primaryFacts: NonNullable<CompetitionMetadataSource["facts"]>;
  /** Participation is unknown unless an official rule describes both submission and finals. */
  participationModes: CompetitionRecommendationMetadata["participationModes"];
  /** A dated official notice/result within 24 months; absence deliberately earns no recency credit. */
  recentActivitySource?: CompetitionMetadataSource;
  /** Field-specific official rules which are not the primary identity page. */
  factSources?: readonly CompetitionMetadataSource[];
};

function goalsFor(spec: ExpansionSpec): Record<CompetitionGoal, number> {
  const values = { ...baseGoalValues };
  if (spec.outputs.includes("research-paper")) {
    values.postgraduate = 0.94;
    values.project = Math.max(values.project, 0.84);
  }
  if (spec.outputs.includes("prototype") || spec.outputs.includes("software")) {
    values.project = 0.96;
    values.employment = 0.88;
  }
  if (spec.outputs.includes("creative-work")) values.portfolio = 0.96;
  if (spec.outputs.includes("business-plan")) values.entrepreneurship = 0.9;
  if (spec.subjects.includes("vocational-skills")) values.employment = 0.94;
  return values;
}

function unknownSchedule(
  sourceUrl: string,
  sourceType: CompetitionMetadataSource["sourceType"]
): CompetitionRecommendationMetadata["schedule"] {
  return {
    state: "unknown",
    datePrecision: "unknown",
    verifiedAt: COMPETITION_EXPANSION_VERIFIED_AT,
    sourceUrl,
    sourceType
  };
}

function toCompetition(spec: ExpansionSpec): CompetitionSource {
  const review = (expansionEvidenceReviews as Record<string, ExpansionEvidenceReview>)[spec.id];
  if (!review) throw new Error(`Missing evidence review for expansion competition: ${spec.id}`);
  const evidenceRef = `official:${spec.id}:${COMPETITION_EXPANSION_VERIFIED_AT}`;
  const source: CompetitionMetadataSource = {
    url: spec.sourceUrl,
    sourceType: spec.sourceType,
    verifiedAt: COMPETITION_EXPANSION_VERIFIED_AT,
    evidenceRef,
    facts: review.primaryFacts
  };
  const reviewedSources = [source, ...(review.factSources ?? []), ...(spec.supportingSources ?? [])];
  const supports = (fact: NonNullable<CompetitionMetadataSource["facts"]>[number]) =>
    reviewedSources.some((item) => item.facts?.includes(fact));
  const sourceFor = (fact: NonNullable<CompetitionMetadataSource["facts"]>[number]) =>
    reviewedSources.find((item) => item.facts?.includes(fact));
  const stages = supports("stages") ? spec.stages : { state: "unknown" } as const;
  const teamRequirement = supports("teamRequirement")
    ? spec.teamRequirement
    : { state: "unknown" } as const;
  const eligibilityState = supports("eligibility") ? spec.eligibilityState : "unknown";
  const requiredResources = spec.requiredResources ?? [];
  const helpfulResources = spec.helpfulResources ?? [];
  const schedule = supports("schedule") && spec.schedule
    ? spec.schedule
    : unknownSchedule(spec.sourceUrl, spec.sourceType);
  const missingFacts = [
    stages.state === "unknown" ? "学段" : null,
    spec.teamRequirement.state === "unknown" ? "组队人数" : null,
    schedule.state === "unknown" ? "当届报名与比赛日期" : null
  ].filter((item): item is string => Boolean(item));

  return {
    id: spec.id,
    identity: {
      canonicalName: spec.name,
      aliases: spec.aliases ?? [],
      organizer: spec.organizer,
      officialDomain: new URL(spec.sourceUrl).hostname.toLowerCase().replace(/^www\./, ""),
      evidenceRef
    },
    name: spec.name,
    category: spec.category,
    direction: spec.direction,
    summary: spec.summary,
    sourceUrl: spec.sourceUrl,
    featured: spec.featured ?? false,
    detail: {
      intro: `${spec.name}聚焦${spec.focus}。选手需把专业知识转化为可检验的${spec.deliverable}，评审通常更关注问题定义、过程证据、完成度与现场表达；具体赛道与资格以当届官方文件为准。`,
      participationPath: `从赛事官方入口查找当届通知，先核对学段、赛道、组队、院校推荐与材料清单，再按节点完成${spec.deliverable}、过程记录和展示材料。官方未公布的日期或规则不应从往届信息推断。`,
      userValue: `备赛可以沉淀${spec.deliverable}与可追溯的项目档案，并练习把专业判断转化为清晰证据链。奖项认定、学分及其他收益以赛事与所在学校政策为准。`,
      suitableFor: spec.suitableFor,
      preparationTips: [
        `先用当届官方通知确认${missingFacts.join("、")}`,
        `围绕${spec.focus}建立“问题—方法—证据—结论”档案`,
        `提前演练${spec.deliverable}的展示、答辩与风险备案`
      ]
    },
    recommendation: {
      stages,
      regions: { state: "unknown" },
      subjects: spec.subjects,
      majors: spec.majors,
      skills: spec.skills,
      interests: spec.interests,
      preferredOutputs: spec.outputs,
      experienceLevels: ["none", "participated", "project-or-award"],
      evidence: spec.evidence,
      goalValues: goalsFor(spec),
      ...(spec.qualityTaskPrototypeRequired
        ? { qualityTaskPrototypeRequired: true }
        : {}),
      difficulty: spec.difficulty ?? "balanced",
      weeklyHours: spec.weeklyHours ?? ["5-10", "over-10"],
      participationModes: review.participationModes,
      teamRequirement,
      usefulResources: [...new Set([...requiredResources, ...helpfulResources])],
      requiredResources,
      helpfulResources,
      eligibility: {
        state: eligibilityState,
        ...(supports("eligibility") && spec.requiresFullTime !== undefined
          ? { requiresFullTime: spec.requiresFullTime }
          : {}),
        ...(supports("eligibility") && spec.requiresFullTimeStages
          ? { requiresFullTimeStages: spec.requiresFullTimeStages }
          : {}),
        ...(supports("eligibility") && spec.requiresCurrentEnrollment !== undefined
          ? { requiresCurrentEnrollment: spec.requiresCurrentEnrollment }
          : {}),
        ...(supports("eligibility") && spec.sameInstitutionTeam !== undefined
          ? { sameInstitutionTeam: spec.sameInstitutionTeam }
          : {}),
        ...(supports("eligibility") && spec.blockingClarifications
          ? { blockingClarifications: spec.blockingClarifications }
          : {}),
        ...(supports("eligibility") && spec.stageClarificationNotes
          ? { stageClarificationNotes: spec.stageClarificationNotes }
          : {}),
        ...(supports("eligibility") && spec.partTimeStageClarificationNotes
          ? { partTimeStageClarificationNotes: spec.partTimeStageClarificationNotes }
          : {}),
        notes: spec.eligibilityNotes,
        source: sourceFor("eligibility") ?? source
      },
      fit: {
        signals: spec.fitSignals,
        ...(spec.preferenceFitSignals
          ? { preferenceSignals: spec.preferenceFitSignals }
          : {}),
        notes: ["学科与任务形式标签为编辑性软匹配，不代表官方报名资格。"]
      },
      ...(spec.tracks
        ? {
            tracks: spec.tracks.map((track) => {
              const trackSource = sourceFor("trackEligibility");
              if (trackSource?.evidenceRef) {
                const verifiedFacts = [
                  ...(track.stages ? (["stages"] as const) : []),
                  ...(track.teamRequirement ? (["teamRequirement"] as const) : []),
                  ...(track.eligibilityNotes?.length ? (["eligibility"] as const) : [])
                ];
                return {
                  ...track,
                  evidenceRef: trackSource.evidenceRef,
                  verifiedFacts
                };
              }
              return {
                  id: track.id,
                  label: track.label,
                  ...(track.preferredOutputs ? { preferredOutputs: track.preferredOutputs } : {}),
                  ...(track.preferenceFitSignals
                    ? { preferenceFitSignals: track.preferenceFitSignals }
                    : {}),
                  ...(track.fitSignals ? { fitSignals: track.fitSignals } : {})
                };
            })
          }
        : {}),
      source,
      ...((spec.supportingSources || review.factSources || review.recentActivitySource)
        ? {
            supportingSources: [
              ...(spec.supportingSources ?? []),
              ...(review.factSources ?? []),
              ...(review.recentActivitySource ? [review.recentActivitySource] : [])
            ]
          }
        : {}),
      schedule,
      dataCompleteness: supports("stages") && supports("teamRequirement") && supports("eligibility")
        ? spec.dataCompleteness
        : Math.min(spec.dataCompleteness, 0.74),
      dataNotices: [
        `资料复核日期：${COMPETITION_EXPANSION_VERIFIED_AT}。`,
        missingFacts.length
          ? `尚待当届官方文件确认：${missingFacts.join("、")}。`
          : "已结构化的资格与日期仍应在报名前复核。",
        ...(spec.additionalDataNotices ?? [])
      ]
    }
  };
}

const engineeringProfile = {
  majors: ["engineering", "mathematics"] as const,
  skills: ["hardware", "research", "design", "presentation"] as const,
  interests: ["engineering", "innovation"] as const,
  outputs: ["prototype", "presentation"] as const,
  evidence: ["project", "prototype"] as const
};

const researchProfile = {
  majors: ["mathematics", "other"] as const,
  skills: ["research", "data-analysis", "writing", "presentation"] as const,
  interests: ["academic-research", "data"] as const,
  outputs: ["research-paper", "presentation"] as const,
  evidence: ["paper", "project"] as const
};

const computingProfile = {
  majors: ["computer-science", "engineering", "mathematics"] as const,
  skills: ["programming", "data-analysis", "hardware"] as const,
  interests: ["ai", "data", "engineering"] as const,
  outputs: ["software", "prototype"] as const,
  evidence: ["project", "prototype", "award"] as const
};

const creativeProfile = {
  majors: ["design", "humanities", "business"] as const,
  skills: ["design", "writing", "presentation", "product"] as const,
  interests: ["design", "media", "innovation"] as const,
  outputs: ["creative-work", "presentation"] as const,
  evidence: ["portfolio", "project"] as const
};

const innovationProfile = {
  majors: ["engineering", "computer-science", "business", "design", "other"] as const,
  skills: ["product", "research", "design", "presentation"] as const,
  interests: ["innovation", "entrepreneurship"] as const,
  outputs: ["prototype", "business-plan", "presentation"] as const,
  evidence: ["project", "prototype"] as const
};

const businessProfile = {
  majors: ["business", "mathematics", "humanities"] as const,
  skills: ["data-analysis", "research", "writing", "presentation"] as const,
  interests: ["career", "data"] as const,
  outputs: ["business-plan", "presentation"] as const,
  evidence: ["project", "paper"] as const
};

const languageProfile = {
  majors: ["humanities", "design", "business"] as const,
  skills: ["writing", "presentation", "research", "design"] as const,
  interests: ["language-communication", "media"] as const,
  outputs: ["creative-work", "presentation"] as const,
  evidence: ["portfolio", "project"] as const
};

const undergraduateTeamRules = {
  stages: { state: "known", values: undergraduateStages },
  teamRequirement: { state: "known", mode: "team" },
  eligibilityState: "partial",
  eligibilityNotes: ["赛事官方入口及公开规则确认面向本科生并采用团队项目形式；当届年级、队伍人数和校内推荐条件须复核。"],
  dataCompleteness: 0.78
} as const;

const undergraduateEitherRules = {
  stages: { state: "known", values: undergraduateStages },
  teamRequirement: { state: "known", mode: "either" },
  eligibilityState: "partial",
  eligibilityNotes: ["赛事官方入口及公开规则确认面向本科生，设个人或团队作品；各赛道人数上限与院校推荐要求以当届通知为准。"],
  dataCompleteness: 0.78
} as const;

const undergraduateIndividualRules = {
  stages: { state: "known", values: undergraduateStages },
  teamRequirement: { state: "known", mode: "individual", minSize: 1, maxSize: 1 },
  eligibilityState: "partial",
  eligibilityNotes: ["赛事官方入口及公开规则确认面向本科生并以个人身份参赛；当届赛区和校内选拔要求须复核。"],
  dataCompleteness: 0.8
} as const;

const collegiateTeamRules = {
  stages: { state: "known", values: collegiateStages },
  teamRequirement: { state: "known", mode: "team" },
  eligibilityState: "partial",
  eligibilityNotes: ["官方赛事体系覆盖高职、本科或研究生中的多个组别并采用团队形式；具体赛道开放学段与人数以当届规则为准。"],
  dataCompleteness: 0.78
} as const;

const graduateTeamRules = {
  stages: { state: "known", values: graduateStages },
  teamRequirement: { state: "known", mode: "team" },
  eligibilityState: "partial",
  eligibilityNotes: ["中国研究生创新实践系列大赛官方页面确认面向在读研究生并采用团队形式；当届学籍与队伍细则须复核。"],
  dataCompleteness: 0.82
} as const;

const vocationalTeamRules = {
  stages: { state: "known", values: ["vocational"] },
  teamRequirement: { state: "known", mode: "team" },
  eligibilityState: "partial",
  eligibilityNotes: ["教育主管部门或赛事官方入口确认面向职业院校学生；赛项、队伍人数和选拔层级以当届规则为准。"],
  dataCompleteness: 0.8
} as const;

export const expansionCompetitionSpecs = [
  {
    ...computingProfile,
    ...graduateTeamRules,
    id: "graduate-cybersecurity-innovation",
    name: "中国研究生网络安全创新大赛",
    aliases: ["研究生网络安全大赛"],
    organizer: "中国学位与研究生教育学会",
    category: "研究生 / 网络安全",
    direction: "人工智能与物联",
    summary: "面向在读研究生的团队性网络安全创新实践赛事，设揭榜挑战、创意作品和实网对抗赛道。",
    sourceUrl: "https://cpipc.acge.org.cn/cw/hp/2c90800c8093eef401809d33b36f0652?language=1",
    sourceType: "official-competition",
    subjects: ["cybersecurity-systems", "information-communication"],
    fitSignals: ["network-systems", "software-engineering", "research-provenance"],
    focus: "网络安全攻防、创新作品与真实命题解决",
    deliverable: "安全方案、技术作品或实网对抗结果",
    suitableFor: ["网络安全相关在读研究生", "具备安全攻防或系统研发能力的团队", "愿意按赛道要求留存可复核技术证据的参赛者"],
    stages: { state: "known", values: graduateStages },
    teamRequirement: { state: "known", mode: "team" },
    eligibilityState: "verified",
    eligibilityNotes: ["2026年官方当届页与邀请函确认赛事面向全国在读研究生，属团体性网络安全创新实践赛事；队伍人数尚须根据当届赛道附件复核。"],
    blockingClarifications: ["当届具体赛道的队伍人数上下限尚未结构化确认。"],
    schedule: {
      state: "scheduled", edition: "2026", registrationStart: "2026-06-18", registrationEnd: "2026-10-18",
      datePrecision: "day", verifiedAt: COMPETITION_EXPANSION_VERIFIED_AT,
      sourceUrl: "https://cpipc.acge.org.cn/cw/hp/2c90800c8093eef401809d33b36f0652?language=1",
      sourceType: "official-competition"
    },
    requiredResources: ["data"],
    dataCompleteness: 0.88,
    featured: true
  },
  {
    ...engineeringProfile,
    ...undergraduateTeamRules,
    id: "national-structural-design",
    name: "全国大学生结构设计竞赛",
    organizer: "全国大学生结构设计竞赛委员会",
    category: "土木工程 / 结构设计",
    direction: "工程与制造",
    summary: "围绕结构方案、计算分析、模型制作与加载验证展开的土木工程实践竞赛。",
    sourceUrl: "https://www.structurecontest.com/home",
    sourceType: "official-competition",
    subjects: ["civil-architecture", "mechanics-materials"],
    fitSignals: ["design-portfolio", "hardware-build"],
    focus: "结构受力、方案优化与模型验证",
    deliverable: "结构模型、计算说明和加载答辩",
    suitableFor: ["土木、力学或工程相关本科生", "擅长建模计算与动手制作的团队", "具备实验场地和指导教师支持的参赛者"],
    stages: { state: "known", values: ["vocational", ...undergraduateStages] },
    teamRequirement: { state: "known", mode: "team", minSize: 3, maxSize: 3 },
    eligibilityState: "verified",
    eligibilityNotes: ["2026年上海分区赛官方赛题文件确认每组3人，参赛者为未毕业的全日制本科或专科生；全国赛资格仍须核对当届章程。"],
    blockingClarifications: ["当前证据仅能确认分区赛规则，全国赛资格仍须核对当届章程。"],
    requiresFullTime: true,
    dataCompleteness: 0.88,
    featured: true
  },
  {
    ...creativeProfile,
    ...undergraduateEitherRules,
    id: "national-advertising-art",
    name: "全国大学生广告艺术大赛",
    aliases: ["大广赛"],
    organizer: "全国大学生广告艺术大赛组委会",
    category: "广告 / 视觉传播",
    direction: "创意与数字",
    summary: "以真实命题推动策划、文案、视觉、影视和交互作品创作的全国性大学生赛事。",
    sourceUrl: "https://www.sun-ada.net/",
    sourceType: "official-competition",
    subjects: ["visual-communication"],
    fitSignals: ["design-portfolio"],
    focus: "品牌洞察、创意策略与媒介表达",
    deliverable: "广告策划案或创意传播作品",
    suitableFor: ["广告、设计、新闻传播相关本科生", "希望用真实命题完善作品集的创作者", "具备策划、文案或影像能力的个人与团队"],
    schedule: {
      state: "scheduled", edition: "2026", registrationStart: "2026-05-10", registrationEnd: "2026-06-12",
      datePrecision: "day", verifiedAt: COMPETITION_EXPANSION_VERIFIED_AT,
      sourceUrl: "https://2025.sun-ada.net/home/about_intrs2.html", sourceType: "official-competition"
    },
    featured: true
  },
  {
    ...engineeringProfile,
    ...undergraduateTeamRules,
    id: "engineering-practice-innovation",
    name: "中国大学生工程实践与创新能力大赛",
    aliases: ["工程实践与创新能力大赛"],
    organizer: "中国大学生工程实践与创新能力大赛组委会",
    category: "工程训练 / 综合实践",
    direction: "工程与制造",
    summary: "覆盖智能制造、新能源车、虚拟仿真等方向，重视工程实现、调试与现场任务完成。",
    sourceUrl: "https://www.gcxl.edu.cn/new/index.html",
    sourceType: "official-competition",
    subjects: ["engineering-practice", "robotics-automation"],
    fitSignals: ["hardware-build", "robotics-integration"],
    focus: "工程系统设计、加工装配与现场调试",
    deliverable: "工程装置、技术文档与现场任务结果",
    suitableFor: ["机械、电气、自动化等本科生", "有工程训练基础的跨专业团队", "可使用实验室和加工设备的参赛者"],
    stages: { state: "known", values: undergraduateStages },
    teamRequirement: {
      state: "known",
      mode: "team",
      maxSize: 4,
      minimumSizeUnknown: true
    },
    eligibilityState: "verified",
    eligibilityNotes: ["大赛官网2027指南确认参赛选手须为普通高等教育本科院校全日制在校本科生，每队不超过4名学生。"],
    blockingClarifications: [
      "官方仅明确以队伍参赛且每队不超过4人，具体赛项的人数下限尚未确认。",
      "每名选手是否仅参加一个项目且仅加入一支队伍尚未由固定问卷确认。"
    ],
    requiresFullTime: true,
    requiredResources: ["mentor", "lab", "equipment"],
    dataCompleteness: 0.9
  },
  {
    ...creativeProfile,
    ...collegiateTeamRules,
    id: "huacan-design-award",
    name: "两岸新锐设计竞赛·华灿奖",
    aliases: ["华灿奖"],
    organizer: "两岸新锐设计竞赛·华灿奖组委会",
    category: "设计 / 文化创意",
    direction: "创意与数字",
    summary: "聚焦视觉、产品、空间与数字创意的青年设计竞赛，强调文化表达与成果转化。",
    sourceUrl: "https://www.huacanjiang.com/home",
    sourceType: "official-competition",
    subjects: ["visual-communication", "language-culture"],
    fitSignals: ["design-portfolio"],
    focus: "文化主题转译、设计创新与完整呈现",
    deliverable: "设计作品、说明文本和展示材料",
    suitableFor: ["设计、艺术或数字媒体学生", "希望积累文化创意作品的个人与团队", "关注两岸青年交流议题的创作者"],
    teamRequirement: { state: "known", mode: "either", minSize: 1, maxSize: 5 },
    eligibilityState: "partial",
    eligibilityNotes: ["2025年第十届官方通知确认在读学生可以个人或团队参赛，团队为1名第一作者加不超过4名成员；通知同时覆盖青年教师和设计师，因此不将学段推断为硬资格。"],
    tracks: [{
      id: "student-group",
      label: "学生组",
      preferenceQuestionEligible: false,
      stages: { state: "known", values: collegiateStages },
      teamRequirement: { state: "known", mode: "either", minSize: 1, maxSize: 5 },
      eligibilityNotes: ["当届通知明确接收高校在读学生个人或团队作品，团队最多5名作者。"],
      blockingClarifications: ["高校在读学生身份组别由官方事实决定，不是备赛偏好。"]
    }],
    dataCompleteness: 0.76
  },
  {
    ...innovationProfile,
    ...undergraduateTeamRules,
    id: "national-innovation-training-annual",
    name: "全国大学生创新创业训练计划年会展示",
    aliases: ["国创年会"],
    organizer: "全国大学生创新创业年会组委会",
    category: "创新训练 / 项目展示",
    direction: "创新创业",
    summary: "集中展示国家级大学生创新创业训练计划成果，重视研究过程、项目证据与交流表达。",
    sourceUrl: "https://gjcxcy.bjtu.edu.cn/Index.aspx",
    sourceType: "official-competition",
    subjects: ["engineering-practice"],
    fitSignals: ["research-provenance", "product-validation"],
    focus: "创新训练过程、项目成果与可复核证据",
    deliverable: "项目报告、实物成果或创业推介",
    suitableFor: ["已参与大学生创新训练计划的本科团队", "有完整研究或创业项目档案的学生", "希望交流和完善项目成果的参赛者"],
    stages: { state: "known", values: undergraduateStages },
    teamRequirement: { state: "unknown" },
    eligibilityState: "partial",
    eligibilityNotes: ["2025年教育部高等教育司通知确认学术论文、改革成果展示和创业推介项目均从“国创计划”中遴选，并非面向个人自由报名；母活动不设置统一队伍人数。"],
    tracks: [{
      id: "innovation-project-exhibition",
      label: "创新训练项目改革成果展示",
      preferenceQuestionEligible: false,
      stages: { state: "known", values: undergraduateStages },
      teamRequirement: { state: "known", mode: "either" },
      eligibilityNotes: ["由高校或地方教育行政部门从已立项“国创计划”项目中推荐，展板需列出项目成员、年级和专业。"],
      blockingClarifications: ["是否属于已立项国创计划且已获得高校或教育行政部门推荐尚未确认。"]
    }],
    dataCompleteness: 0.72
  },
  {
    ...engineeringProfile,
    ...undergraduateTeamRules,
    id: "chemical-engineering-design",
    name: "全国大学生化工设计竞赛",
    organizer: "中国化工学会、中国化工教育协会",
    category: "化工 / 工艺设计",
    direction: "工程与制造",
    summary: "以化工流程设计、设备选型、经济评价和安全环保论证为核心的综合工程竞赛。",
    sourceUrl: "https://iche.zju.edu.cn/",
    sourceType: "official-competition",
    subjects: ["chemistry-chemical"],
    fitSignals: ["design-portfolio", "research-provenance"],
    focus: "化工流程、设备计算、安全环保与经济性",
    deliverable: "工艺设计说明书、图纸与答辩材料",
    suitableFor: ["化工、过程装备等相关本科生", "具备流程模拟与工程计算基础的团队", "能长期协作完成系统设计的参赛者"],
    requiredResources: ["mentor", "data"],
    schedule: {
      state: "scheduled", edition: "2026", registrationStart: "2026-02-28", registrationEnd: "2026-04-13",
      competitionStart: "2026-08-15", competitionEnd: "2026-08-17", datePrecision: "day",
      verifiedAt: COMPETITION_EXPANSION_VERIFIED_AT, sourceUrl: "https://iche.zju.edu.cn/", sourceType: "official-competition"
    },
    dataCompleteness: 0.88
  },
  {
    ...innovationProfile,
    ...undergraduateTeamRules,
    id: "service-outsourcing-innovation",
    name: "中国大学生服务外包创新创业大赛",
    aliases: ["服创大赛"],
    organizer: "中国大学生服务外包创新创业大赛组委会",
    category: "服务外包 / 数字创新",
    direction: "创新创业",
    summary: "围绕企业真实命题开展软件、数据、产品与商业解决方案设计，强调落地验证。",
    sourceUrl: "https://www.fwwb.org.cn/",
    sourceType: "official-competition",
    subjects: ["information-communication"],
    fitSignals: ["software-engineering", "product-validation", "venture-readiness"],
    focus: "企业需求分析、数字方案开发与商业验证",
    deliverable: "软件原型、解决方案和路演材料",
    suitableFor: ["计算机、商科和设计相关本科生", "希望解决企业真实问题的跨专业团队", "已有软件或产品原型的参赛者"],
    schedule: {
      state: "scheduled", edition: "2026", registrationStart: "2026-02-11", registrationEnd: "2026-03-20",
      competitionEnd: "2026-08", datePrecision: "month", verifiedAt: COMPETITION_EXPANSION_VERIFIED_AT,
      sourceUrl: "https://www.fwwb.org.cn/attached/file/20260211/20260211154941_13.pdf", sourceType: "official-competition"
    },
    featured: true
  },
  {
    ...creativeProfile,
    ...collegiateTeamRules,
    id: "milan-design-week-china",
    name: "米兰设计周—中国高校设计学科师生优秀作品展",
    aliases: ["米兰设计周中国高校设计展"],
    organizer: "米兰设计周—中国高校设计学科师生优秀作品展组委会",
    category: "设计 / 作品展",
    direction: "创意与数字",
    summary: "覆盖视觉、产品、环境、数字媒体等设计方向，突出高校设计成果的创意与展示质量。",
    sourceUrl: "https://www.dandad.cn/",
    sourceType: "official-competition",
    subjects: ["visual-communication"],
    fitSignals: ["design-portfolio"],
    focus: "设计概念、专业完成度与展陈叙事",
    deliverable: "设计作品、展板和作品说明",
    suitableFor: ["设计学科本专科及研究生", "需要完善专业作品集的创作者", "具备完整设计成果和展示素材的个人与团队"]
    ,stages: { state: "unknown" },
    teamRequirement: { state: "known", mode: "either", minSize: 1, maxSize: 5 },
    eligibilityState: "partial",
    eligibilityNotes: ["2026年官方规则覆盖在校及近5年毕业的博士、硕士、本科、专科和进修生；作品类团队通常不超过3人，数字媒体类不超过5人。由于同时接受毕业生，不用当前学段做硬排除。"],
    tracks: [{
      id: "currently-enrolled-student-work",
      label: "在校学生作品组",
      preferenceQuestionEligible: false,
      stages: { state: "known", values: collegiateStages },
      teamRequirement: { state: "known", mode: "either" },
      eligibilityNotes: ["当届通知明确接收在校博士、硕士、本科生与高职高专学生的个人或合作作品。"],
      blockingClarifications: ["在校学生作品组由当届在籍身份事实决定，不是备赛偏好。"]
    }],
    schedule: {
      state: "scheduled", edition: "2026", registrationStart: "2025-10", registrationEnd: "2026-04",
      competitionStart: "2026-04", competitionEnd: "2026-08", datePrecision: "month",
      verifiedAt: COMPETITION_EXPANSION_VERIFIED_AT,
      sourceUrl: "https://www.czu.cn/_t1006/2026/0323/c6a171373/page.htm", sourceType: "education-authority"
    },
    dataCompleteness: 0.76
  },
  {
    ...researchProfile,
    ...undergraduateTeamRules,
    id: "geology-skills",
    name: "全国大学生地质技能竞赛",
    organizer: "中国地质学会地质教育研究分会",
    category: "地质 / 野外实践",
    direction: "学术科研",
    summary: "考查地质标本鉴定、读图、野外调查与综合分析能力的专业实践竞赛。",
    sourceUrl: "https://www.geosociety.org.cn/?v1=v14&v2=6a4b786b3ad3f&v3=v41&v4=v21",
    sourceType: "organizer",
    subjects: ["geoscience-surveying"],
    fitSignals: ["research-provenance", "field-research"],
    focus: "地质观察、空间判读与野外证据分析",
    deliverable: "鉴定记录、地质图件和综合报告",
    suitableFor: ["地质、资源勘查等相关本科生", "具备野外调查与标本识别基础的团队", "希望强化专业实践证据的参赛者"],
    stages: { state: "known", values: ["vocational", ...undergraduateStages] },
    teamRequirement: { state: "known", mode: "team", minSize: 3, maxSize: 3 },
    eligibilityState: "verified",
    eligibilityNotes: ["2026年二号通知确认参赛队员须为当年8月仍正式注册的地质学、地质类及相关专业本科生、专科生或留学生，每队严格3名学生，由学校统一报名。"],
    blockingClarifications: ["地质学、地质类或当届认可相关专业资格尚未由固定问卷充分证明。"],
    additionalDataNotices: ["学校统一报名属于报名流程，请按学校通知办理。"],
    sameInstitutionTeam: true,
    schedule: {
      state: "scheduled", edition: "2026", registrationEnd: "2026-08-15",
      competitionStart: "2026-08-26", competitionEnd: "2026-08-28", datePrecision: "day",
      verifiedAt: COMPETITION_EXPANSION_VERIFIED_AT,
      sourceUrl: "https://www.geosociety.org.cn/upload/pdf/notice/20260706173639_29.pdf", sourceType: "organizer"
    },
    requiredResources: ["mentor", "equipment"],
    dataCompleteness: 0.94
  },
  {
    ...engineeringProfile,
    ...undergraduateTeamRules,
    id: "optoelectronic-design",
    name: "全国大学生光电设计竞赛",
    organizer: "全国大学生光电设计竞赛委员会",
    category: "光电 / 仪器设计",
    direction: "工程与制造",
    summary: "面向光学工程与电子信息方向，以光机电系统设计、制作和调试为主要任务。",
    sourceUrl: "https://gd.p.moocollege.com/",
    sourceType: "official-competition",
    subjects: ["physics-optics"],
    fitSignals: ["hardware-build"],
    focus: "光学原理、系统集成与实验验证",
    deliverable: "光电装置、测试数据和现场演示",
    suitableFor: ["光电、物理、电子信息相关本科生", "擅长仪器搭建与调试的团队", "可获得实验设备支持的参赛者"],
    requiredResources: ["mentor", "lab", "equipment"]
  },
  {
    ...engineeringProfile,
    ...undergraduateEitherRules,
    id: "metallographic-skills",
    name: "全国大学生金相技能大赛",
    organizer: "全国大学生金相技能大赛竞赛委员会",
    category: "材料 / 实验技能",
    direction: "工程与制造",
    summary: "考查金相试样制备、显微观察、组织分析与实验规范的材料专业技能赛事。",
    sourceUrl: "https://www.jxds.tech/",
    sourceType: "official-competition",
    subjects: ["mechanics-materials"],
    fitSignals: ["hardware-build", "research-provenance"],
    focus: "试样制备、显微观察与材料组织判断",
    deliverable: "金相试样、分析记录与技能考核结果",
    suitableFor: ["材料类相关本科生", "重视实验规范和精细操作的参赛者", "具备金相实验条件的个人与团队"],
    stages: { state: "known", values: ["vocational", ...undergraduateStages] },
    teamRequirement: { state: "known", mode: "either" },
    eligibilityState: "verified",
    eligibilityNotes: ["2026年当届章程与参赛指南确认实验技能、综合分析和创新应用三个赛道分别组织，具体个人或代表队形式必须按赛道指南确认。"],
    blockingClarifications: ["具体赛道的个人或代表队形式尚未全部结构化确认。"],
    tracks: [{
      id: "experimental-skills",
      label: "实验技能赛道",
      stages: { state: "known", values: ["vocational", ...undergraduateStages] },
      teamRequirement: { state: "known", mode: "individual", minSize: 1, maxSize: 1 },
      eligibilityNotes: ["当届实验技能赛道由参赛高校组织预赛并选拔正式在读本科生或专科生，个人完成金相试样制备与评定。"]
    }],
    requiredResources: ["mentor", "lab", "equipment"]
  },
  {
    ...researchProfile,
    id: "zhou-peiyuan-mechanics",
    name: "全国周培源大学生力学竞赛",
    aliases: ["周培源力学竞赛"],
    organizer: "全国周培源大学生力学竞赛组委会",
    category: "力学 / 基础学科",
    direction: "学术科研",
    summary: "以理论力学、材料力学等基础能力为核心，兼顾个人解题与团体实践赛项。",
    sourceUrl: "https://zpy.cstam.org.cn/",
    sourceType: "official-competition",
    subjects: ["mechanics-materials", "statistics-mathematics"],
    fitSignals: ["modeling-intensive", "research-provenance"],
    focus: "力学建模、推导计算与工程判断",
    deliverable: "个人理论答卷或团体实践成果",
    suitableFor: ["力学、机械、土木等本科生", "数学与物理基础扎实的参赛者", "希望检验工程基础能力的个人"],
    stages: { state: "known", values: [...undergraduateStages, ...graduateStages] },
    teamRequirement: { state: "known", mode: "either" },
    eligibilityState: "verified",
    eligibilityNotes: ["2025中国力学学会通知确认在校大学生及研究生可参加，设个人赛和团体赛；下一届资格须重新核对。"],
    blockingClarifications: ["当前仅有2025届规则证据，下一届资格尚须重新核对。"],
    schedule: {
      state: "scheduled", edition: "2025", competitionStart: "2025-05-18", competitionEnd: "2025-05-18",
      datePrecision: "day", verifiedAt: COMPETITION_EXPANSION_VERIFIED_AT,
      sourceUrl: "https://zhxy.nwsuaf.edu.cn/docs/2025-03/8ee77789b1d048e5aef631299afd9f93.pdf", sourceType: "organizer"
    },
    dataCompleteness: 0.88
  },
  {
    ...engineeringProfile,
    ...undergraduateTeamRules,
    id: "mechanical-engineering-innovation",
    name: "中国大学生机械工程创新创意大赛",
    organizer: "中国机械工程学会",
    category: "机械工程 / 创新设计",
    direction: "工程与制造",
    summary: "由多个机械工程专业赛项构成，覆盖设计、制造、材料、过程装备与工业工程。",
    sourceUrl: "https://www.gczbds.org",
    sourceType: "organizer",
    subjects: ["engineering-practice", "mechanics-materials"],
    fitSignals: ["hardware-build", "design-portfolio"],
    focus: "机械系统创新、工程实现与专业赛项能力",
    deliverable: "机械作品、技术文档和现场答辩",
    suitableFor: ["机械、材料、工业工程相关本科生", "有结构设计和加工调试能力的团队", "希望参加专业细分赛项的参赛者"],
    stages: { state: "known", values: collegiateStages },
    teamRequirement: { state: "known", mode: "team", maxSize: 5 },
    eligibilityState: "verified",
    eligibilityNotes: ["2026年官方校方转发赛项通知确认面向全日制专科、本科和研究生，每队不超过5名学生且不得跨校；各专业赛项可有更严格人数要求。"],
    blockingClarifications: ["当届专业赛项可有更严格的队伍人数要求，尚未结构化确认。"],
    requiresFullTime: true,
    sameInstitutionTeam: true,
    requiredResources: ["mentor", "lab", "equipment"]
  },
  {
    ...innovationProfile,
    id: "china-us-young-maker",
    name: "中美青年创客大赛",
    organizer: "教育部留学服务中心",
    category: "创客 / 国际交流",
    direction: "创新创业",
    summary: "面向中美青年，以可持续发展主题推动创意产品、原型制作和跨文化协作。",
    sourceUrl: "https://chinaus-maker.cscse.edu.cn/",
    sourceType: "education-authority",
    subjects: ["engineering-practice"],
    fitSignals: ["product-validation", "venture-readiness"],
    focus: "社会议题洞察、创客原型与中美青年协作",
    deliverable: "可演示原型、项目说明和路演",
    suitableFor: ["18至40岁的中美青年", "具备原型开发能力的个人或团队", "关注可持续发展议题的创客"],
    stages: { state: "unrestricted" },
    teamRequirement: { state: "known", mode: "either", minSize: 1, maxSize: 5 },
    eligibilityState: "verified",
    eligibilityNotes: ["2026官方规则面向18至40岁的中国或美国公民及合法永久居民，个人或不超过5人的团队可报名，并设职业院校赛道。"],
    blockingClarifications: ["18至40岁的年龄条件以及中美公民或合法永久居民身份尚未由固定问卷确认。"],
    tracks: [{
      id: "vocational",
      label: "职业院校赛道",
      preferenceQuestionEligible: false,
      stages: { state: "known", values: ["vocational"] }
    }],
    schedule: {
      state: "scheduled", edition: "2026", competitionStart: "2026-07-28", competitionEnd: "2026-07-31",
      datePrecision: "day", verifiedAt: COMPETITION_EXPANSION_VERIFIED_AT,
      sourceUrl: "https://chinaus-maker.cscse.edu.cn/", sourceType: "education-authority"
    },
    dataCompleteness: 0.94,
    featured: true
  },
  {
    ...computingProfile,
    ...collegiateTeamRules,
    id: "raicom-robot-developer",
    name: "睿抗机器人开发者大赛（RAICOM）",
    aliases: ["RAICOM", "睿抗机器人开发者大赛"],
    organizer: "工业和信息化部人才交流中心",
    category: "机器人 / 开发实践",
    direction: "人工智能与物联",
    summary: "覆盖机器人编程、智能系统、工程竞技与创新应用，强调开发、调试和任务完成。",
    sourceUrl: "https://www.robocom.com.cn/",
    sourceType: "official-competition",
    subjects: ["robotics-automation"],
    skills: ["programming", "hardware", "product"],
    fitSignals: ["robotics-integration", "software-engineering", "product-validation"],
    preferenceFitSignals: ["robotics-integration"],
    focus: "机器人软件、系统集成与场景任务",
    deliverable: "机器人系统、程序和现场竞技结果",
    suitableFor: ["计算机、自动化、机器人相关学生", "有软硬件联调能力的团队", "希望通过任务赛检验工程能力的参赛者"],
    stages: { state: "known", values: collegiateStages },
    teamRequirement: { state: "known", mode: "team", minSize: 1, maxSize: 3 },
    eligibilityState: "verified",
    eligibilityNotes: ["2026年赛项通知确认参赛者为全日制在籍高校学生，每队1至3人，配1至2名指导教师。"],
    blockingClarifications: ["1至2名符合当届规则的指导教师尚未作为官方资格事实确认。"],
    requiresFullTime: true,
    dataCompleteness: 0.88,
    difficulty: "challenge",
    requiredResources: ["mentor", "lab", "equipment"]
  },
  {
    ...computingProfile,
    ...collegiateTeamRules,
    id: "datang-ict",
    name: "全国大学生新一代信息通信科技大赛",
    aliases: ["大唐杯", "“大唐杯”全国大学生新一代信息通信技术大赛"],
    organizer: "工业和信息化部人才交流中心、中国通信企业协会、中信科移动通信技术股份有限公司",
    category: "通信 / ICT",
    direction: "人工智能与物联",
    summary: "围绕移动通信、5G网络、工程实践与创新应用开展理论、仿真和实操竞赛。",
    sourceUrl: "https://dtcup.dtxiaotangren.com/",
    sourceType: "official-competition",
    subjects: ["information-communication"],
    fitSignals: ["network-systems", "hardware-build"],
    focus: "通信原理、网络规划与工程实操",
    deliverable: "理论测评、网络方案或通信创新作品",
    suitableFor: ["通信、电子信息和计算机相关学生", "希望强化ICT工程实践的团队", "具备通信仿真或设备条件的参赛者"],
    stages: { state: "known", values: collegiateStages },
    teamRequirement: { state: "known", mode: "team" },
    eligibilityState: "verified",
    eligibilityNotes: ["2026年当届邀请函确认全日制高职、普通高等教育本科、硕士、博士在校生及符合条件的“一带一路”留学生可参赛；所有赛道均以同校团队报名。"],
    blockingClarifications: ["队长资格与每名选手、每支队伍的限报规则尚未由固定问卷确认。"],
    requiresFullTime: true,
    sameInstitutionTeam: true,
    schedule: {
      state: "scheduled",
      edition: "2026",
      registrationEnd: "2026-03-10",
      datePrecision: "day",
      verifiedAt: COMPETITION_EXPANSION_VERIFIED_AT,
      sourceUrl: "https://cet.ncepu.edu.cn/docs/2025-12/f7028bf4abba4dedbb1657751fac5746.pdf",
      sourceType: "organizer"
    },
    tracks: [
      {
        id: "engineering-practice",
        label: "工程实践赛",
        preferenceFitSignals: ["network-systems"],
        fitSignals: ["network-systems", "hardware-build"],
        stages: { state: "known", values: collegiateStages },
        teamRequirement: { state: "known", mode: "team", minSize: 2, maxSize: 2 },
        eligibilityNotes: ["每队2名同校全日制在校学生。"]
      },
      {
        id: "5g-innovation",
        label: "产教融合5G+创新应用赛",
        preferenceFitSignals: ["network-systems"],
        fitSignals: ["network-systems", "software-engineering"],
        stages: { state: "known", values: collegiateStages },
        teamRequirement: { state: "known", mode: "team", minSize: 4, maxSize: 6 },
        eligibilityNotes: ["每队4至6名同校全日制在校学生，且至少覆盖2个专业。"],
        blockingClarifications: ["团队是否至少覆盖2个专业尚未由固定问卷确认。"]
      },
      {
        id: "ict-general",
        label: "ICT通识赛",
        preferenceFitSignals: ["network-systems"],
        fitSignals: ["network-systems", "hardware-build"],
        stages: { state: "known", values: collegiateStages },
        teamRequirement: { state: "known", mode: "team", minSize: 2, maxSize: 2 },
        eligibilityNotes: ["每队2名同校全日制在校学生。"]
      }
    ],
    dataCompleteness: 0.93
  },
  {
    ...computingProfile,
    ...collegiateTeamRules,
    id: "huawei-ict",
    name: "华为ICT大赛",
    aliases: ["Huawei ICT Competition"],
    organizer: "华为技术有限公司",
    category: "ICT / 云与网络",
    direction: "人工智能与物联",
    summary: "面向华为ICT学院学生，覆盖网络、云、计算和创新赛道，并连接全球总决赛。",
    sourceUrl: "https://e.huawei.com/cn/talent/ict-academy/#/ict-contest",
    sourceType: "organizer",
    subjects: ["information-communication"],
    fitSignals: ["network-systems", "software-engineering"],
    focus: "网络、云计算、计算系统与ICT创新",
    deliverable: "知识实操成绩或ICT创新解决方案",
    suitableFor: ["华为ICT学院在校学生", "网络、云与计算方向学习者", "希望参加国际化ICT竞技的团队"],
    stages: { state: "known", values: collegiateStages },
    teamRequirement: { state: "known", mode: "team" },
    eligibilityState: "partial",
    eligibilityNotes: ["2025—2026华为官方页确认赛事面向全球高校师生，实践、创新与编程赛均为团队竞赛；各赛道队伍人数需按当届手册复核。"],
    dataCompleteness: 0.82
  },
  {
    ...computingProfile,
    ...undergraduateTeamRules,
    id: "embedded-chip-system-design",
    name: "全国大学生嵌入式芯片与系统设计竞赛",
    organizer: "中国电子学会",
    category: "芯片 / 嵌入式系统",
    direction: "人工智能与物联",
    summary: "围绕芯片应用、嵌入式系统、FPGA与软硬件协同设计开展作品赛和应用赛。",
    sourceUrl: "https://www.socchina.net/",
    sourceType: "official-competition",
    subjects: ["information-communication"],
    fitSignals: ["hardware-build", "software-engineering"],
    focus: "嵌入式软硬件协同、芯片应用与系统验证",
    deliverable: "嵌入式作品、源代码和测试展示",
    suitableFor: ["电子、自动化、计算机相关本科生", "掌握嵌入式开发和硬件调试的团队", "可获得开发板与实验条件的参赛者"],
    stages: { state: "known", values: collegiateStages },
    teamRequirement: { state: "known", mode: "team", minSize: 1, maxSize: 3 },
    eligibilityState: "verified",
    eligibilityNotes: ["2026年芯片应用赛道通知确认国内外高校电子电气相关专业的全日制研究生、本科生和高职高专生可参赛，每队由同校1至3名学生组成。"],
    blockingClarifications: ["电子电气相关专业资格尚未由固定问卷中的宽口径专业标签充分证明。"],
    requiresFullTime: true,
    sameInstitutionTeam: true,
    schedule: {
      state: "scheduled", edition: "2026", registrationEnd: "2026-04-20",
      competitionStart: "2026-07", competitionEnd: "2026-08", datePrecision: "month",
      verifiedAt: COMPETITION_EXPANSION_VERIFIED_AT,
      sourceUrl: "https://computer.cdu.edu.cn/info/1036/12076.htm", sourceType: "education-authority"
    },
    dataCompleteness: 0.79,
    requiredResources: ["mentor", "lab", "equipment"]
  },
  {
    ...researchProfile,
    ...undergraduateTeamRules,
    id: "culsc-life-sciences",
    name: "全国大学生生命科学竞赛（CULSC）",
    aliases: ["CULSC", "全国大学生生命科学竞赛"],
    organizer: "全国大学生生命科学竞赛委员会",
    category: "生命科学 / 实验研究",
    direction: "学术科研",
    summary: "包含科学探究和创新创业等方向，以实验研究、数据证据和完整项目过程为核心。",
    sourceUrl: "https://www.culsc.cn/",
    sourceType: "official-competition",
    subjects: ["biology-life-science"],
    majors: ["medicine", "other"],
    fitSignals: ["research-provenance"],
    focus: "生命科学问题、实验设计与数据论证",
    deliverable: "研究论文、实验记录和答辩材料",
    suitableFor: ["生物、医学、农学等相关本科生", "具备实验研究基础的团队", "可持续记录研究过程与原始数据的参赛者"],
    stages: { state: "known", values: ["vocational", ...undergraduateStages] },
    teamRequirement: { state: "known", mode: "team", maxSize: 5 },
    eligibilityState: "verified",
    eligibilityNotes: ["2026年科学探究类官方通知确认参赛者为全日制非成人教育高校在校本、专科生，每队不超过5名学生，可跨学院和跨校组队。"],
    blockingClarifications: [
      "每名选手当届是否仅加入1支参赛队伍尚未确认。",
      "参赛者在校期间参加该竞赛是否未超过2次尚未确认。"
    ],
    additionalDataNotices: ["学校当届参赛确认与统一报名属于提交流程，请按所在学校通知办理。"],
    requiresFullTime: true,
    sameInstitutionTeam: false,
    schedule: {
      state: "scheduled", edition: "2026", registrationStart: "2025-08-01", registrationEnd: "2026-01-15",
      competitionStart: "2026-06", competitionEnd: "2026-07", datePrecision: "month",
      verifiedAt: COMPETITION_EXPANSION_VERIFIED_AT,
      sourceUrl: "https://futurebs.sysu.edu.cn/sites/default/files/2025-10/%E7%AC%AC%E5%8D%81%E4%B8%80%E5%B1%8A%E7%AB%9E%E8%B5%9B%E9%80%9A%E7%9F%A5%EF%BC%88%E7%A7%91%E5%AD%A6%E6%8E%A2%E7%A9%B6%E7%B1%BB%EF%BC%89.pdf",
      sourceType: "organizer"
    },
    dataCompleteness: 0.94,
    requiredResources: ["mentor", "lab", "equipment", "data"],
    featured: true
  },
  {
    ...researchProfile,
    id: "physics-experiment-innovation",
    name: "全国大学生物理实验竞赛（创新）",
    organizer: "全国大学生物理实验竞赛组织委员会",
    category: "物理 / 实验创新",
    direction: "学术科研",
    summary: "围绕物理实验设计、仪器制作、教学创新和研究报告开展的实验能力竞赛。",
    sourceUrl: "https://wlsycx.moocollege.com/",
    sourceType: "official-competition",
    subjects: ["physics-optics"],
    fitSignals: ["research-provenance", "hardware-build"],
    focus: "物理实验设计、仪器实现与误差分析",
    deliverable: "实验装置、研究报告和演示答辩",
    suitableFor: ["高职或本科阶段物理及工科学生", "具备实验设计和装置制作能力的团队", "可获得实验室指导的参赛者"],
    stages: { state: "known", values: ["vocational", ...undergraduateStages] },
    teamRequirement: { state: "known", mode: "team", maxSize: 5 },
    eligibilityState: "verified",
    eligibilityNotes: ["2026年第十二届第一轮官方通知确认高职与本科学生可参赛，每队学生不超过5人；具体命题组别按当届附件复核。"],
    blockingClarifications: ["具体命题组别的附加资格尚须按当届附件复核。"],
    requiredResources: ["mentor", "lab", "equipment"],
    dataCompleteness: 0.88
  },
  {
    ...engineeringProfile,
    ...undergraduateTeamRules,
    id: "bim-graduation-design",
    name: "国际高校BIM毕业设计创新大赛",
    aliases: ["全国高校BIM毕业设计创新大赛"],
    organizer: "全国高校BIM毕业设计创新大赛组委会",
    category: "BIM / 毕业设计",
    direction: "工程与制造",
    summary: "把BIM建模、协同设计与工程管理用于毕业设计场景，强调专业综合应用。",
    sourceUrl: "https://gxbsxs.glodonedu.com/index",
    sourceType: "official-competition",
    subjects: ["digital-construction", "civil-architecture"],
    fitSignals: ["design-portfolio", "software-engineering"],
    focus: "BIM协同、工程建模与毕业设计创新",
    deliverable: "BIM模型、工程文档和成果汇报",
    suitableFor: ["土木、建筑、工程管理相关学生", "正在完成毕业设计的项目团队", "熟悉BIM软件和协同流程的参赛者"],
    stages: { state: "known", values: collegiateStages },
    teamRequirement: { state: "known", mode: "team", minSize: 3, maxSize: 5 },
    eligibilityState: "partial",
    eligibilityNotes: ["2025—2026年赛制文件覆盖中职、高职、本科和研究生，每队3至5人，研究生同队不超过2人；当前学段枚举不含中职，不将中职误映射为高职。"],
    schedule: {
      state: "scheduled", edition: "2025—2026", competitionStart: "2025-09", competitionEnd: "2026-05",
      datePrecision: "month", verifiedAt: COMPETITION_EXPANSION_VERIFIED_AT,
      sourceUrl: "https://www.gzcc.edu.cn/sjjxzx/upload/files/2025/11/43e8c575b27dad29.pdf", sourceType: "organizer"
    },
    dataCompleteness: 0.9
  },
  {
    ...computingProfile,
    ...undergraduateTeamRules,
    id: "intelligent-robot-creativity",
    name: "中国高校智能机器人创意大赛",
    organizer: "中国高校智能机器人创意大赛组委会",
    category: "智能机器人 / 创意设计",
    direction: "人工智能与物联",
    summary: "面向高校学生开展机器人创意、实体制作和任务竞技，强调创新性与系统实现。",
    sourceUrl: "https://www.robotcontest.cn/",
    sourceType: "official-competition",
    subjects: ["robotics-automation"],
    fitSignals: ["robotics-integration", "hardware-build", "product-validation"],
    focus: "机器人创意、机械电子实现与任务表现",
    deliverable: "机器人作品、技术文档和现场演示",
    suitableFor: ["机械、自动化、计算机相关学生", "具备机器人系统集成能力的团队", "可使用实验室设备的参赛者"],
    stages: { state: "known", values: collegiateStages },
    teamRequirement: { state: "known", mode: "team" },
    eligibilityState: "partial",
    eligibilityNotes: ["2025年全国通知覆盖高职、本科和研究生，不同主题每队1至3人或1至4人；母赛不固化统一人数上限。"],
    dataCompleteness: 0.84,
    difficulty: "challenge",
    requiredResources: ["mentor", "lab", "equipment"],
    schedule: {
      state: "scheduled", edition: "2026", registrationStart: "2026-03-01", registrationEnd: "2026-05-08",
      competitionStart: "2026-07-12", competitionEnd: "2026-07-13", datePrecision: "day",
      verifiedAt: COMPETITION_EXPANSION_VERIFIED_AT, sourceUrl: "https://www.robotcontest.cn/home/homepage", sourceType: "official-competition"
    }
  },
  {
    ...creativeProfile,
    ...collegiateTeamRules,
    id: "china-good-design",
    name: "中国好创意暨全国数字艺术设计大赛",
    aliases: ["中国好创意"],
    organizer: "中国好创意暨全国数字艺术设计大赛组织委员会",
    category: "数字艺术 / 设计",
    direction: "创意与数字",
    summary: "覆盖视觉传达、数字媒体、动画、空间和产品等方向的综合性数字艺术设计赛事。",
    sourceUrl: "https://www.cdec.org.cn/",
    sourceType: "official-competition",
    subjects: ["visual-communication"],
    fitSignals: ["design-portfolio"],
    focus: "数字艺术创意、视觉叙事与专业完成度",
    deliverable: "数字艺术作品、设计说明和展示文件",
    suitableFor: ["艺术设计与数字媒体学生", "需要积累高完成度作品集的创作者", "具备视觉、影像或交互能力的个人与团队"],
    stages: { state: "known", values: collegiateStages },
    teamRequirement: { state: "known", mode: "either", minSize: 1, maxSize: 8 },
    eligibilityState: "verified",
    eligibilityNotes: ["2026年官方管理办法明确学生单元分高职、本科和研究生组，个人或团队均可；每件作品作者不超过8人，跨校合作最多3所院校。"],
    blockingClarifications: ["若为跨校合作，团队涉及的院校数量尚未由固定问卷确认。"],
    schedule: {
      state: "scheduled", edition: "第21届（2026—2027）", registrationStart: "2026-07", registrationEnd: "2027-06",
      competitionStart: "2026-07", competitionEnd: "2027-08", datePrecision: "month",
      verifiedAt: COMPETITION_EXPANSION_VERIFIED_AT, sourceUrl: "https://www.cdec.org.cn/articleDetail/2283", sourceType: "official-competition"
    },
    dataCompleteness: 0.94
  },
  {
    ...computingProfile,
    ...collegiateTeamRules,
    id: "china-robot-ai",
    name: "中国机器人及人工智能大赛",
    organizer: "中国人工智能学会",
    category: "机器人 / 人工智能",
    direction: "人工智能与物联",
    summary: "覆盖机器人竞技、人工智能创新与应用任务，重视算法、系统集成和现场表现。",
    sourceUrl: "https://www.caairobot.com/",
    sourceType: "official-competition",
    subjects: ["robotics-automation"],
    fitSignals: ["robotics-integration", "software-engineering", "product-validation"],
    focus: "机器人感知决策、AI算法与系统集成",
    deliverable: "算法系统、机器人作品和竞技结果",
    suitableFor: ["人工智能、计算机、自动化相关学生", "具备算法和软硬件联调能力的团队", "希望用场景任务验证系统的参赛者"],
    stages: { state: "known", values: [...undergraduateStages, ...graduateStages] },
    teamRequirement: { state: "known", mode: "team", minSize: 1, maxSize: 3 },
    eligibilityState: "partial",
    eligibilityNotes: ["2026年组委会规则包及高校转发的当届文件确认主要面向全日制在读本科生和研究生，通用报名单元每队1至3名学生；特定器材赛项可有更严格人数要求。"],
    difficulty: "challenge",
    requiredResources: ["mentor", "lab", "equipment", "data"]
  },
  {
    ...languageProfile,
    ...collegiateTeamRules,
    id: "chinese-classics",
    name: "中华经典诵写讲大赛",
    organizer: "教育部、国家语言文字工作委员会",
    category: "中华经典 / 语言文化",
    direction: "语言人文",
    summary: "通过诵读、讲解、书写与篆刻等形式传承中华经典，强调文化理解和规范表达。",
    sourceUrl: "https://jdsxj.eduyun.cn/",
    sourceType: "official-competition",
    subjects: ["language-culture"],
    fitSignals: ["language-communication"],
    focus: "经典理解、语言表现与文化阐释",
    deliverable: "诵读视频、讲解作品或书写篆刻作品",
    suitableFor: ["语言、文学、教育和艺术相关学生", "擅长朗诵、讲解或书写的个人与团队", "希望积累中华文化表达作品的参赛者"],
    stages: { state: "known", values: collegiateStages },
    teamRequirement: { state: "known", mode: "either" },
    eligibilityState: "partial",
    eligibilityNotes: ["2025年教育部通知确认大赛设诵读、讲解、书写和篆刻四个赛项，覆盖大学与职业院校组；既有个人参赛项目，也有集体诵读等团队项目，人数必须按附件复核。"],
    dataCompleteness: 0.74
  },
  {
    ...languageProfile,
    id: "intercultural-competence",
    name: "“外教社杯”全国高校学生跨文化能力大赛",
    aliases: ["外教社杯跨文化能力大赛"],
    organizer: "上海外语教育出版社",
    category: "外语 / 跨文化",
    direction: "语言人文",
    summary: "通过案例分析、情境展演和跨文化知识考查学生的问题分析与沟通表达能力。",
    sourceUrl: "https://ict.sflep.com/",
    sourceType: "organizer",
    subjects: ["language-culture"],
    fitSignals: ["language-communication", "field-research"],
    focus: "跨文化案例分析、外语表达与团队协作",
    deliverable: "案例分析、情境展示和现场答辩",
    suitableFor: ["外语及其他专业高校学生", "具有跨文化观察与外语表达能力的团队", "希望训练案例沟通的参赛者"],
    stages: { state: "known", values: collegiateStages },
    teamRequirement: { state: "known", mode: "either" },
    eligibilityState: "partial",
    eligibilityNotes: ["2026官方直通说明确认面向高校学生，大赛包括团队现场赛和短视频赛；各赛道的学段与作者人数并未统一，报名前须查当届章程。"],
    dataCompleteness: 0.82
  },
  {
    ...computingProfile,
    ...collegiateTeamRules,
    id: "baidu-star",
    name: "百度之星程序设计大赛",
    aliases: ["百度之星"],
    organizer: "百度",
    category: "程序设计 / 算法",
    direction: "人工智能与物联",
    summary: "以在线算法题和晋级赛检验程序设计、数据结构与问题求解能力。",
    sourceUrl: "https://www.matiji.net/exam/contest/astar",
    sourceType: "organizer",
    subjects: ["information-communication", "statistics-mathematics"],
    fitSignals: ["algorithm-competition"],
    focus: "算法设计、编码实现与限时问题求解",
    deliverable: "在线评测代码和晋级赛成绩",
    suitableFor: ["计算机及相关专业高职、本科或研究生", "具备算法竞赛基础的个人", "希望用在线评测检验编程能力的参赛者"],
    stages: { state: "known", values: collegiateStages },
    teamRequirement: { state: "known", mode: "individual", minSize: 1, maxSize: 1 },
    eligibilityState: "partial",
    eligibilityNotes: ["2026年当届承办报名平台和正式通知确认为个人竞赛，大学组覆盖高职、本科及以上学段；总决赛学籍审查须以当届章程为准。"],
    dataCompleteness: 0.86
  },
  {
    ...engineeringProfile,
    ...undergraduateTeamRules,
    id: "water-innovation-design",
    name: "全国大学生水利创新设计大赛",
    organizer: "教育部高等学校水利类专业教学指导委员会",
    category: "水利 / 创新设计",
    direction: "工程与制造",
    summary: "围绕水工程、水资源、水生态与智慧水利开展创新设计和实物模型展示。",
    sourceUrl: "https://sljzw.hhu.edu.cn/fenhui/2025/0331/c12009a300360/page.htm",
    sourceType: "organizer",
    subjects: ["water-environment"],
    fitSignals: ["sustainability-impact", "hardware-build"],
    focus: "水利问题、工程创新与模型验证",
    deliverable: "设计作品、实物模型和技术说明",
    suitableFor: ["水利、环境、土木相关本科生", "关注水资源与生态问题的团队", "具备模型制作或仿真能力的参赛者"]
    ,stages: { state: "known", values: undergraduateStages },
    teamRequirement: { state: "known", mode: "either", minSize: 1, maxSize: 5 },
    eligibilityState: "verified",
    eligibilityNotes: ["2025年官方通知确认由会员院校推荐全日制本科生参赛，作品可为个人或小组完成，每件不超过5名学生；赛事两年一届，不将上届日期推为当前开放。"],
    blockingClarifications: ["参赛者所在院校是否为会员院校且能否获得院校推荐尚未确认。"],
    requiresFullTime: true,
    dataCompleteness: 0.88
  },
  {
    ...researchProfile,
    ...undergraduateTeamRules,
    id: "chemical-engineering-experiment",
    name: "全国大学生化工实验大赛",
    organizer: "教育部高等学校化工类专业教学指导委员会",
    category: "化工 / 实验技能",
    direction: "学术科研",
    summary: "考查化工原理、实验操作、数据处理和团队协作的专业实验竞赛。",
    sourceUrl: "https://www.cteic.com/higherEducation-199.html",
    sourceType: "organizer",
    subjects: ["chemistry-chemical"],
    fitSignals: ["research-provenance"],
    focus: "化工实验操作、数据处理与工程判断",
    deliverable: "实验成绩、数据报告和现场考核记录",
    suitableFor: ["化工类专业本科生", "实验操作与计算基础扎实的团队", "能遵守安全规范并复盘数据的参赛者"],
    stages: { state: "known", values: undergraduateStages },
    teamRequirement: { state: "known", mode: "team" },
    eligibilityState: "partial",
    eligibilityNotes: ["2026年中国化工教育协会正式文件与当届赛区通知确认该赛事为化工及制药相关本科生团队赛；母赛队伍人数尚须以当届细则复核。"],
    requiresFullTime: true,
    dataCompleteness: 0.8,
    requiredResources: ["mentor", "lab", "equipment"]
  },
  {
    ...researchProfile,
    ...undergraduateTeamRules,
    id: "chemistry-experiment-innovation",
    name: "全国大学生化学实验创新设计大赛",
    organizer: "全国大学生化学实验创新设计大赛委员会",
    category: "化学 / 实验创新",
    direction: "学术科研",
    summary: "以化学实验方案创新、教学设计和新创实验为主要内容，强调安全、证据和可复现性。",
    sourceUrl: "https://cid.nju.edu.cn/",
    sourceType: "official-competition",
    subjects: ["chemistry-chemical"],
    fitSignals: ["research-provenance"],
    focus: "化学实验创新、安全设计与可复现验证",
    deliverable: "实验方案、研究报告和现场答辩",
    suitableFor: ["化学及相关专业本科生", "具有实验设计和数据分析基础的团队", "可获得实验室与安全指导的参赛者"],
    stages: { state: "known", values: undergraduateStages },
    teamRequirement: { state: "known", mode: "team", minSize: 3, maxSize: 5 },
    eligibilityState: "verified",
    eligibilityNotes: ["2026年3月大赛委员会章程确认参赛者为普通高校全日制在校本科生，团体赛前三类赛道每队3人，数智化实验赛道3至5人。"],
    tracks: [
      { id: "new-experiment", label: "新创实验", skills: ["laboratory", "research", "data-analysis"], preferredOutputs: ["research-paper"], fitSignals: ["research-provenance"], teamRequirement: {state: "known", mode: "team", minSize: 3, maxSize: 3} },
      { id: "improved-experiment", label: "改进实验", skills: ["laboratory", "hardware", "research"], preferredOutputs: ["prototype", "research-paper"], fitSignals: ["research-provenance", "hardware-build"], teamRequirement: {state: "known", mode: "team", minSize: 3, maxSize: 3} },
      { id: "science-outreach", label: "科普实验", skills: ["laboratory", "writing", "presentation"], preferredOutputs: ["presentation", "creative-work"], fitSignals: ["research-provenance", "language-communication"], teamRequirement: {state: "known", mode: "team", minSize: 3, maxSize: 3} },
      { id: "digital-experiment", label: "数智化实验", skills: ["laboratory", "programming", "data-analysis"], preferredOutputs: ["software", "research-paper"], fitSignals: ["research-provenance", "software-engineering"], teamRequirement: {state: "known", mode: "team", minSize: 3, maxSize: 5} }
    ],
    requiresFullTime: true,
    dataCompleteness: 0.92,
    requiredResources: ["mentor", "lab", "equipment"]
  },
  {
    ...computingProfile,
    ...undergraduateTeamRules,
    id: "computer-system-ability",
    qualityTaskPrototypeRequired: true,
    name: "全国大学生计算机系统能力大赛",
    organizer: "全国高等学校计算机教育研究会",
    category: "计算机系统 / 能力竞赛",
    direction: "人工智能与物联",
    summary: "由编译、操作系统、芯片、数据库等赛道构成，强调底层系统理解与工程实现。",
    sourceUrl: "https://www.educg.net/",
    sourceType: "official-competition",
    subjects: ["cybersecurity-systems", "information-communication"],
    fitSignals: ["network-systems", "software-engineering", "hardware-build"],
    focus: "计算机底层系统、软硬件协同与性能验证",
    deliverable: "系统软件、硬件设计或评测结果",
    suitableFor: ["计算机、软件、集成电路相关本科生", "对底层系统和性能优化感兴趣的团队", "具备较强编码或硬件能力的参赛者"],
    stages: { state: "unknown" },
    teamRequirement: { state: "unknown" },
    eligibilityState: "unknown",
    eligibilityNotes: ["母赛包含编译、操作系统、数据库、芯片等多个独立赛道，学段与人数按当届赛道章程确认。"],
    tracks: [{
      id: "os-function-challenge",
      label: "2026操作系统设计赛—OS功能挑战赛道",
      skills: ["programming", "research"],
      interests: ["engineering", "data"],
      preferredOutputs: ["software"],
      fitSignals: ["network-systems", "software-engineering"],
      stages: { state: "known", values: collegiateStages },
      teamRequirement: { state: "known", mode: "either", minSize: 1, maxSize: 3 },
      requiresFullTime: true,
      sameInstitutionTeam: true,
      eligibilityNotes: ["面向普通高校全日制在校专科生、本科生和研究生，每队1至3人，禁止跨校组队。"]
    }],
    dataCompleteness: 0.74
  },
  {
    ...creativeProfile,
    ...undergraduateTeamRules,
    id: "garden-design-build",
    name: "全国大学生花园设计建造竞赛",
    organizer: "中国风景园林学会",
    category: "风景园林 / 建造",
    direction: "创意与数字",
    summary: "把场地研究、花园设计与现场建造结合，强调空间创意、材料策略和团队执行。",
    sourceUrl: "https://www.chsla.org.cn/",
    sourceType: "organizer",
    subjects: ["civil-architecture", "visual-communication"],
    fitSignals: ["design-portfolio", "hardware-build"],
    focus: "场地理解、景观设计与实体建造",
    deliverable: "设计图纸、实体花园和建造记录",
    suitableFor: ["风景园林、建筑、环境设计本科生", "擅长空间设计和现场建造的团队", "可投入集中施工时间的参赛者"],
    stages: { state: "known", values: [...undergraduateStages, ...graduateStages] },
    teamRequirement: { state: "known", mode: "team", minSize: 3, maxSize: 7 },
    eligibilityState: "verified",
    eligibilityNotes: ["2026年同济大学发布的完整赛道通知确认面向国内外相关专业本科生和研究生，每队3至7人，允许跨国、跨校和跨专业组队。"],
    blockingClarifications: ["园林、景观或当届规则认可的相关专业资格尚未由宽口径专业标签充分证明。"],
    dataCompleteness: 0.92,
    requiredResources: ["mentor", "equipment", "budget"]
  },
  {
    ...computingProfile,
    ...undergraduateTeamRules,
    id: "information-security-confrontation",
    name: "全国大学生信息安全与对抗技术竞赛",
    organizer: "全国大学生信息安全与对抗技术竞赛组委会",
    category: "网络安全 / 对抗技术",
    direction: "人工智能与物联",
    summary: "通过信息安全知识、攻防实践和创新作品考查系统安全与对抗技术能力。",
    sourceUrl: "https://www.isclab.org.cn/",
    sourceType: "official-competition",
    subjects: ["cybersecurity-systems"],
    fitSignals: ["algorithm-competition", "network-systems"],
    focus: "网络攻防、系统安全与创新应用",
    deliverable: "安全工具、攻防成绩或创新作品",
    suitableFor: ["网络安全、计算机相关本科生", "具备攻防和系统基础的团队", "能在合规环境开展安全实验的参赛者"],
    stages: { state: "known", values: collegiateStages },
    teamRequirement: { state: "known", mode: "either" },
    eligibilityState: "partial",
    eligibilityNotes: ["2026年第23届官方通知设多个分赛，高校学生组覆盖高职、本科和研究生，个人线上挑战与团队对抗并存；硬资格须按分赛文件复核。"],
    tracks: [{
      id: "game-confrontation",
      label: "博弈对抗赛",
      stages: { state: "known", values: collegiateStages },
      teamRequirement: { state: "known", mode: "team", minSize: 3, maxSize: 3 },
      requiresFullTime: true,
      sameInstitutionTeam: true,
      eligibilityNotes: ["面向全日制在校高校学生，每队3人且由同一学校组队。"]
    }],
    requiredResources: ["mentor", "lab", "equipment"]
  },
  {
    ...researchProfile,
    ...undergraduateTeamRules,
    id: "surveying-innovation",
    name: "全国大学生测绘学科创新创业智能大赛",
    organizer: "全国高等学校测绘学科教学指导委员会",
    category: "测绘 / 智能应用",
    direction: "工程与制造",
    summary: "覆盖测量技能、空间信息应用、无人测绘和创新开发，重视数据采集与工程实践。",
    sourceUrl: "https://smt.whu.edu.cn/",
    sourceType: "organizer",
    subjects: ["geoscience-surveying"],
    fitSignals: ["field-research", "software-engineering"],
    focus: "空间数据采集、测绘智能化与创新应用",
    deliverable: "测绘成果、空间应用系统和技术报告",
    suitableFor: ["测绘、地理信息、遥感相关本科生", "具备空间数据或仪器操作基础的团队", "关注无人化和智能测绘的参赛者"],
    stages: { state: "known", values: undergraduateStages },
    teamRequirement: { state: "known", mode: "either", minSize: 1, maxSize: 4 },
    eligibilityState: "verified",
    eligibilityNotes: ["2026年中国测绘学会通知确认参赛者为在校本科生并需学信网核验；各赛道为单人、2人或不超过4人，由学校统一报名。"],
    blockingClarifications: ["测绘、地理信息或当届认可相关专业资格尚未由固定问卷充分证明。"],
    additionalDataNotices: ["学信网学籍核验与学校统一报名属于报名流程，请按学校通知办理。"],
    dataCompleteness: 0.92,
    requiredResources: ["mentor", "equipment", "data"]
  },
  {
    ...researchProfile,
    id: "statistical-modeling",
    name: "全国大学生统计建模大赛",
    organizer: "中国统计教育学会",
    category: "统计 / 数据建模",
    direction: "学术科研",
    summary: "以现实主题开展数据收集、统计建模、论文写作和成果答辩，强调规范分析。",
    sourceUrl: "https://www.ai-learning.net/dstz/37119.jhtml",
    sourceType: "official-competition",
    subjects: ["statistics-mathematics"],
    fitSignals: ["modeling-intensive", "field-research", "research-provenance"],
    focus: "现实问题、数据治理、统计模型与解释",
    deliverable: "统计建模论文、代码和答辩材料",
    suitableFor: ["本科或研究生阶段学生", "具备统计、编程和论文写作能力的团队", "希望沉淀数据研究成果的参赛者"],
    stages: { state: "known", values: [...undergraduateStages, ...graduateStages] },
    teamRequirement: { state: "known", mode: "team", minSize: 3, maxSize: 3 },
    eligibilityState: "verified",
    eligibilityNotes: ["2026官方通知确认面向全日制本科生和研究生，本科与研究生不得混合组队；每队须满3人且不得跨校。"],
    blockingClarifications: ["队员是否全部与申报人处于同一本科或研究生学段尚未由固定问卷确认。"],
    requiresFullTime: true,
    sameInstitutionTeam: true,
    schedule: {
      state: "scheduled", edition: "2026", competitionStart: "2026-07", competitionEnd: "2026-08",
      datePrecision: "month", verifiedAt: COMPETITION_EXPANSION_VERIFIED_AT,
      sourceUrl: "https://www.ai-learning.net/dstz/37119.jhtml", sourceType: "official-competition"
    },
    dataCompleteness: 0.94,
    featured: true
  },
  {
    ...researchProfile,
    ...undergraduateTeamRules,
    id: "basic-medicine-innovation",
    name: "全国大学生基础医学创新研究暨实验设计论坛（大赛）",
    aliases: ["基础医学创新研究暨实验设计论坛"],
    organizer: "全国大学生基础医学创新研究暨实验设计论坛组委会",
    category: "基础医学 / 实验设计",
    direction: "学术科研",
    summary: "围绕基础医学创新研究、实验设计与成果汇报，强调科学问题、实验证据和学术规范。",
    sourceUrl: "https://www.jcyxds.com/",
    sourceType: "official-competition",
    subjects: ["medicine-health", "biology-life-science"],
    majors: ["medicine"],
    fitSignals: ["research-provenance"],
    focus: "基础医学问题、实验设计与研究证据",
    deliverable: "研究论文、实验方案和学术答辩",
    suitableFor: ["医学及生命科学相关本科生", "有基础医学实验项目的团队", "重视科研伦理和原始数据记录的参赛者"],
    stages: { state: "known", values: ["vocational", ...undergraduateStages] },
    teamRequirement: { state: "known", mode: "team" },
    eligibilityState: "partial",
    eligibilityNotes: ["2026官方第一轮通知与报名系统显示本科及高职高专学生赛道并按团队提交；各医学赛道的人数与专业限制应按附件复核。"],
    schedule: {
      state: "scheduled", edition: "2026", registrationEnd: "2026-04-15",
      competitionStart: "2026-08-14", competitionEnd: "2026-08-18", datePrecision: "day",
      verifiedAt: COMPETITION_EXPANSION_VERIFIED_AT, sourceUrl: "https://www.jcyxds.com/", sourceType: "official-competition"
    },
    requiredResources: ["mentor", "lab", "equipment", "data"],
    dataCompleteness: 0.86
  },
  {
    ...businessProfile,
    id: "tax-risk-case",
    name: "全国本科院校税收风险管控案例大赛",
    organizer: "全国本科院校税收风险管控案例大赛组委会",
    category: "税务 / 案例分析",
    direction: "商业与职业",
    summary: "通过企业涉税数据和案例情境训练税收风险识别、证据分析与合规方案表达。",
    sourceUrl: "https://ssfkds.moocollege.com/home",
    sourceType: "official-competition",
    subjects: ["finance-accounting"],
    fitSignals: ["finance-operations", "field-research"],
    focus: "税收政策、企业数据与风险管控方案",
    deliverable: "案例分析报告、数据底稿和答辩",
    suitableFor: ["财税、会计、审计相关本科或研究生", "擅长案例研究和数据核验的团队", "希望训练企业税务合规能力的参赛者"],
    stages: { state: "known", values: [...undergraduateStages, ...graduateStages] },
    teamRequirement: { state: "known", mode: "team", minSize: 3, maxSize: 3 },
    eligibilityState: "verified",
    eligibilityNotes: ["2026官方赛事平台确认全日制本科生与研究生可参赛，并采用3人团队；赛区与院校推荐要求按当届通知复核。"],
    blockingClarifications: ["赛区与院校推荐条件尚未由固定问卷确认。"],
    requiresFullTime: true,
    dataCompleteness: 0.88
  },
  {
    ...businessProfile,
    id: "enterprise-competition-simulation",
    name: "全国企业竞争模拟大赛",
    organizer: "全国企业竞争模拟大赛组委会",
    category: "企业经营 / 模拟决策",
    direction: "商业与职业",
    summary: "通过企业经营仿真进行战略、营销、生产、财务和团队决策，重视动态分析。",
    sourceUrl: "https://www.ibizsim.cn/main/news/275",
    sourceType: "official-competition",
    subjects: ["finance-accounting"],
    fitSignals: ["finance-operations"],
    focus: "经营决策、竞争分析与财务协同",
    deliverable: "模拟经营结果、决策记录和答辩",
    suitableFor: ["高职、本科和研究生阶段商科学生", "擅长经营分析与团队协作的参赛者", "希望训练综合管理决策的三人团队"],
    stages: { state: "known", values: collegiateStages },
    teamRequirement: { state: "known", mode: "team", minSize: 3, maxSize: 3 },
    eligibilityState: "verified",
    eligibilityNotes: ["2026官方通知设置研究生、本科与高职组，参赛队由3名学生组成；校内选拔和指导教师规则按当届文件执行。"],
    blockingClarifications: ["符合当届规则的指导教师配置尚未由固定问卷确认。"],
    additionalDataNotices: ["校内选拔与统一报名属于参赛流程，请按学校通知办理。"],
    tracks: [
      { id: "graduate", label: "研究生组", preferenceQuestionEligible: false, stages: { state: "known", values: graduateStages } },
      { id: "undergraduate", label: "本科组", preferenceQuestionEligible: false, stages: { state: "known", values: undergraduateStages } },
      { id: "vocational", label: "高职组", preferenceQuestionEligible: false, stages: { state: "known", values: ["vocational"] } }
    ],
    dataCompleteness: 0.9,
    featured: true
  },
  {
    ...businessProfile,
    ...collegiateTeamRules,
    id: "digital-enterprise-sandbox",
    name: "全国高等院校数智化企业经营沙盘大赛",
    organizer: "中国商业联合会、新道科技股份有限公司",
    category: "数字经营 / 沙盘",
    direction: "商业与职业",
    summary: "利用数字化经营沙盘模拟企业战略、供应链、营销与财务管理，强调团队经营协同。",
    sourceUrl: "https://spbk.seentao.com",
    sourceType: "official-competition",
    subjects: ["finance-accounting"],
    fitSignals: ["finance-operations"],
    focus: "数智化经营、资源配置与团队决策",
    deliverable: "沙盘经营结果、决策报告和答辩",
    suitableFor: ["高职或本科阶段商科学生", "熟悉企业经营或财务分析的四人团队", "希望训练协同决策的参赛者"],
    stages: { state: "known", values: undergraduateStages },
    teamRequirement: { state: "known", mode: "team", minSize: 4, maxSize: 4 },
    eligibilityState: "verified",
    eligibilityNotes: ["2026年当届高校通知确认参赛者为截至2026年12月31日仍在籍的全日制本科生，每队4人且不得跨校组队。"],
    blockingClarifications: ["截至2026年12月31日仍在籍的未来学籍状态尚无法由当前在读事实证明。"],
    requiresFullTime: true,
    sameInstitutionTeam: true,
    dataCompleteness: 0.84
  },
  {
    ...engineeringProfile,
    ...collegiateTeamRules,
    id: "digital-building-innovation",
    name: "全国数字建筑创新应用大赛",
    organizer: "全国数字建筑创新应用大赛组委会",
    category: "数字建筑 / 创新应用",
    direction: "工程与制造",
    summary: "围绕数字建造、BIM、工程管理和智能施工开展综合应用，强调真实工程场景。",
    sourceUrl: "https://bisai.ccen.com.cn",
    sourceType: "official-competition",
    subjects: ["digital-construction", "civil-architecture"],
    fitSignals: ["design-portfolio", "software-engineering"],
    focus: "数字建模、工程协同与施工管理创新",
    deliverable: "数字建筑模型、应用方案和答辩材料",
    suitableFor: ["高职或本科建筑工程相关学生", "掌握BIM及数字建造工具的团队", "希望解决真实工程任务的参赛者"]
    ,stages: { state: "known", values: ["vocational", ...undergraduateStages] },
    teamRequirement: { state: "known", mode: "team" },
    eligibilityState: "partial",
    eligibilityNotes: ["2026年中国建设教育协会正式通知确认面向全国全日制本科、高职和中职建筑相关在籍学生，以团队参加选拔和总决赛；母赛队伍人数因赛道而异。"],
    requiresFullTime: true,
    dataCompleteness: 0.82
  },
  {
    ...computingProfile,
    ...collegiateTeamRules,
    id: "global-campus-ai-algorithm",
    qualityTaskPrototypeRequired: true,
    name: "全球校园人工智能算法精英大赛",
    organizer: "全球校园人工智能算法精英大赛组委会",
    category: "人工智能 / 算法应用",
    direction: "人工智能与物联",
    summary: "以真实数据和产业场景为命题，开展机器学习、视觉、语言及智能应用竞赛。",
    sourceUrl: "https://www.aicomp.cn/",
    sourceType: "official-competition",
    subjects: ["information-communication", "statistics-mathematics"],
    fitSignals: ["algorithm-competition", "software-engineering", "modeling-intensive"],
    focus: "AI算法、数据建模与场景落地",
    deliverable: "算法代码、模型结果和技术报告",
    suitableFor: ["高职、本科或研究生AI学习者", "有编程和数据建模基础的团队", "希望参与产业命题实践的参赛者"],
    stages: { state: "known", values: collegiateStages },
    teamRequirement: { state: "unknown" },
    eligibilityState: "partial",
    eligibilityNotes: ["2026年组委会总通知确认参赛者须为高职、本科或研究生正式学籍在读学生；六大赛道队伍人数分别发布，母赛保持未知。"],
    schedule: {
      state: "scheduled", edition: "2026", competitionStart: "2026-04", competitionEnd: "2026-12",
      datePrecision: "month", verifiedAt: COMPETITION_EXPANSION_VERIFIED_AT,
      sourceUrl: "https://www.aicomp.cn/notice/notice-1/3618.html", sourceType: "official-competition"
    },
    tracks: [{
      id: "indoor-agriculture",
      label: "2026算法主题赛（室内农业）",
      subjects: ["statistics-mathematics"],
      skills: ["programming", "data-analysis", "research"],
      interests: ["ai", "data", "innovation"],
      preferredOutputs: ["software", "research-paper"],
      fitSignals: ["algorithm-competition"],
      stages: { state: "known", values: collegiateStages },
      teamRequirement: { state: "known", mode: "either", minSize: 1, maxSize: 3 },
      requiresCurrentEnrollment: true,
      eligibilityNotes: ["面向全球高校和科研院所具有正式学籍的在读专科生、本科生和研究生，可单人或1至3人组队。"]
    }],
    dataCompleteness: 0.76,
    requiredResources: ["data"],
    featured: true
  },
  {
    ...engineeringProfile,
    ...collegiateTeamRules,
    id: "smart-agricultural-equipment",
    name: "国际大学生智能农业装备创新大赛",
    organizer: "国际农业和生物系统工程委员会、中国农业机械学会、中国农业工程学会、农业工程大学国际联盟",
    category: "智慧农业 / 装备创新",
    direction: "工程与制造",
    summary: "把机械、自动化、感知与农业场景结合，开展智能农业装备的设计、制作和验证。",
    sourceUrl: "https://uiaec.ujs.edu.cn",
    sourceType: "official-competition",
    subjects: ["agriculture-equipment", "robotics-automation"],
    fitSignals: ["hardware-build", "robotics-integration", "sustainability-impact"],
    focus: "农业需求、智能装备设计与田间验证",
    deliverable: "装备原型、技术报告和演示视频",
    suitableFor: ["农业工程、机械、自动化相关学生", "具备装备开发能力的跨专业团队", "关注农业生产真实需求的参赛者"],
    stages: { state: "known", values: collegiateStages },
    teamRequirement: { state: "known", mode: "team", minSize: 2, maxSize: 5 },
    eligibilityState: "verified",
    eligibilityNotes: ["2025—2026年官方通知确认参赛者为普通高校或高职高专在校学生，每队2至5人；研究生可为全日制或非全日制但全脱产学习。"],
    requiresFullTimeStages: ["vocational", ...undergraduateStages],
    requiresCurrentEnrollment: true,
    blockingClarifications: [
      "参赛者是否在2025年9月前（含9月）已在所在学校正式注册尚未确认。",
      "每名参赛者当届是否仅申报1件作品尚未确认。"
    ],
    partTimeStageClarificationNotes: {
      master: "研究生如为非全日制，是否满足全脱产学习条件尚未由固定问卷确认。",
      doctorate: "研究生如为非全日制，是否满足全脱产学习条件尚未由固定问卷确认。"
    },
    schedule: {
      state: "scheduled", edition: "2025—2026", registrationEnd: "2025-11-30",
      competitionStart: "2026-01", competitionEnd: "2026-05", datePrecision: "day",
      verifiedAt: COMPETITION_EXPANSION_VERIFIED_AT,
      sourceUrl: "https://uiaec.ujs.edu.cn/news_show.php?id=224", sourceType: "official-competition"
    },
    dataCompleteness: 0.94,
    requiredResources: ["mentor", "lab", "equipment", "budget"]
  },
  {
    ...businessProfile,
    ...collegiateTeamRules,
    id: "keyun-accounting",
    name: "“科云杯”全国大学生财会职业能力大赛",
    aliases: ["科云杯"],
    organizer: "厦门科云信息科技有限公司",
    category: "财会 / 职业能力",
    direction: "商业与职业",
    summary: "通过财务会计、税务、管理会计和数字化业务任务检验财会职业技能与团队协作。",
    sourceUrl: "https://match.xmkeyun.com.cn/",
    sourceType: "organizer",
    subjects: ["finance-accounting", "vocational-skills"],
    fitSignals: ["finance-operations", "career-evidence"],
    focus: "财会业务、业财融合与数字化实务",
    deliverable: "职业技能任务成绩和案例答辩",
    suitableFor: ["高职、本科或研究生财会相关学生", "希望强化职业实务的团队", "熟悉会计、税务与数字工具的参赛者"],
    stages: { state: "known", values: collegiateStages },
    teamRequirement: { state: "known", mode: "team", minSize: 4, maxSize: 4 },
    eligibilityState: "verified",
    eligibilityNotes: ["2025年正式赛事文件确认高职、本科和研究生分组参赛，每队4人且必须同校组队；研究生组赛期不从本科/高职组推测。"],
    blockingClarifications: ["2026届资格与分组规则尚未由当届官方文件确认。"],
    sameInstitutionTeam: true,
    dataCompleteness: 0.92
  },
  {
    ...engineeringProfile,
    id: "world-vocational-skills",
    name: "世界职业院校技能大赛",
    aliases: ["全国职业院校技能大赛"],
    organizer: "教育部",
    category: "职业教育 / 综合技能",
    direction: "商业与职业",
    summary: "由原全国职业院校技能大赛升级，覆盖多专业赛道，以真实生产任务和综合技能为核心。",
    sourceUrl: "https://www.moe.gov.cn/srcsite/A07/s7055/202506/t20250617_1194543.html",
    sourceType: "education-authority",
    subjects: ["vocational-skills"],
    majors: ["engineering", "computer-science", "business", "design", "medicine", "other"],
    skills: ["hardware", "programming", "product", "presentation"],
    interests: ["career", "engineering", "innovation"],
    outputs: ["prototype", "presentation"],
    evidence: ["award", "project", "prototype"],
    fitSignals: ["career-evidence", "hardware-build"],
    focus: "职业技能、真实任务与团队协作",
    deliverable: "分赛项技能成果、过程证据和现场表现",
    suitableFor: ["职业院校在校学生", "希望用真实任务检验职业技能的参赛者", "可通过学校选拔进入相应赛项的个人与团队"],
    stages: { state: "known", values: ["vocational"] },
    teamRequirement: { state: "known", mode: "either" },
    eligibilityState: "verified",
    eligibilityNotes: ["教育部官方文件确认赛事面向职业院校并按多赛项组织，个人或团队形式随赛项变化；具体资格由当届实施方案规定。"],
    blockingClarifications: ["具体赛项的身份、人数与选拔资格尚须按当届实施方案核对。"],
    requiredResources: ["mentor", "equipment"],
    dataCompleteness: 0.86,
    featured: true
  },
  {
    ...computingProfile,
    ...undergraduateTeamRules,
    id: "robotac",
    name: "全国大学生机器人大赛—RoboTac",
    aliases: ["RoboTac"],
    organizer: "全国大学生机器人大赛RoboTac赛事组委会",
    category: "机器人 / 对抗竞技",
    direction: "人工智能与物联",
    summary: "以多机器人协同、战术对抗和现场任务为特点，综合检验机械、控制、视觉和策略。",
    sourceUrl: "https://www.robotac.cn",
    sourceType: "official-competition",
    subjects: ["robotics-automation"],
    fitSignals: ["robotics-integration", "hardware-build"],
    focus: "多机器人协同、控制策略与对抗可靠性",
    deliverable: "参赛机器人、控制程序和现场竞技成绩",
    suitableFor: ["机械、自动化、计算机相关本科生", "能够长期开展机器人迭代的团队", "具备场地、设备和指导资源的参赛者"],
    stages: { state: "known", values: collegiateStages },
    teamRequirement: { state: "known", mode: "team" },
    eligibilityState: "verified",
    eligibilityNotes: ["2026年第二十五届官方通知明确参赛队员须在2026年5月仍注册在籍，包括高校全日制研究生、本科生、专科生和留学生；对抗、挑战与设计赛项队伍人数各不相同。"],
    blockingClarifications: ["所选对抗、挑战或设计赛项的队伍人数与当届在籍时点尚须复核。"],
    requiresFullTime: true,
    sameInstitutionTeam: true,
    schedule: {
      state: "scheduled", edition: "第二十五届（2026）", registrationStart: "2025-11",
      competitionStart: "2026-05", competitionEnd: "2026-08", datePrecision: "month",
      verifiedAt: COMPETITION_EXPANSION_VERIFIED_AT,
      sourceUrl: "https://robotac.cn/sys-nd/1307.html", sourceType: "official-competition"
    },
    dataCompleteness: 0.91,
    difficulty: "challenge",
    requiredResources: ["mentor", "lab", "equipment", "budget"]
  },
  {
    ...engineeringProfile,
    id: "worldskills",
    name: "世界技能大赛",
    aliases: ["WorldSkills Competition", "世赛"],
    organizer: "WorldSkills International",
    category: "职业技能 / 国际赛事",
    direction: "商业与职业",
    summary: "全球高水平职业技能赛事，覆盖制造、信息技术、建筑、创意艺术、社会服务等技能领域。",
    sourceUrl: "https://worldskills.org/",
    sourceType: "official-competition",
    subjects: ["vocational-skills"],
    majors: ["engineering", "computer-science", "business", "design", "other"],
    fitSignals: ["career-evidence", "hardware-build"],
    focus: "国际职业标准、精密操作与现场任务",
    deliverable: "分技能项目的现场任务成果与评分记录",
    suitableFor: ["通过国家或地区选拔的青年技能选手", "具备高强度专项训练条件的参赛者", "希望对标国际职业标准的学习者"],
    stages: { state: "unrestricted" },
    teamRequirement: { state: "known", mode: "either" },
    eligibilityState: "partial",
    eligibilityNotes: ["WorldSkills官方规则按技能项目设置年龄、选拔和个人或团队形式，并非面向所有大学生直接报名；必须先核对国家选拔通道。"],
    schedule: {
      state: "scheduled", edition: "WorldSkills Shanghai 2026", competitionStart: "2026-09-22",
      competitionEnd: "2026-09-27", datePrecision: "day", verifiedAt: COMPETITION_EXPANSION_VERIFIED_AT,
      sourceUrl: "https://worldskills.org/media/news/competition-preparation-week-begins-shanghai/",
      sourceType: "official-competition"
    },
    requiredResources: ["mentor", "equipment", "budget"],
    dataCompleteness: 0.84,
    featured: true
  },
  {
    ...engineeringProfile,
    id: "worldskills-china-selection",
    name: "世界技能大赛中国选拔赛",
    organizer: "中华人民共和国人力资源和社会保障部",
    category: "职业技能 / 国家选拔",
    direction: "商业与职业",
    summary: "面向世界技能大赛国家集训与参赛选手选拔，按技能项目进行高标准实操考核。",
    sourceUrl: "https://worldskillschina.mohrss.gov.cn/",
    sourceType: "education-authority",
    subjects: ["vocational-skills"],
    majors: ["engineering", "computer-science", "business", "design", "other"],
    fitSignals: ["career-evidence", "hardware-build"],
    focus: "国家技能选拔、专项实操与国际标准",
    deliverable: "分技能项目现场任务及选拔成绩",
    suitableFor: ["符合各技能项目年龄和资格要求的青年", "已进入省级或行业选拔体系的技能选手", "具备专项集训资源的参赛者"],
    stages: { state: "unrestricted" },
    teamRequirement: { state: "known", mode: "either" },
    eligibilityState: "partial",
    eligibilityNotes: ["人力资源社会保障部门官方平台确认其为世界技能大赛中国代表队选拔通道；年龄、身份与个人或团队形式均随技能项目变化。"],
    schedule: {
      state: "scheduled", edition: "中华人民共和国第三届职业技能大赛",
      competitionStart: "2025-09-19", competitionEnd: "2025-09-23", datePrecision: "day",
      verifiedAt: COMPETITION_EXPANSION_VERIFIED_AT,
      sourceUrl: "https://chinajob.mohrss.gov.cn/h5/c/2025-09-26/452589.shtml",
      sourceType: "education-authority"
    },
    requiredResources: ["mentor", "equipment"],
    dataCompleteness: 0.82
  },
  {
    ...innovationProfile,
    ...collegiateTeamRules,
    id: "brics-skills",
    name: "一带一路暨金砖国家技能发展与技术创新大赛",
    aliases: ["金砖国家技能大赛"],
    organizer: "金砖国家工商理事会中方理事会",
    category: "技能发展 / 技术创新",
    direction: "商业与职业",
    summary: "由多个技术技能赛项构成，覆盖智能制造、数字技术、商业服务与创新应用。",
    sourceUrl: "https://ppe.ccipe.edu.cn/info/1024/3903.htm",
    sourceType: "education-authority",
    subjects: ["vocational-skills", "engineering-practice"],
    fitSignals: ["career-evidence", "hardware-build", "software-engineering"],
    focus: "职业技能、技术创新与国际合作任务",
    deliverable: "专项技能作品、现场任务和技术报告",
    suitableFor: ["高职、本科或研究生技能型学生", "希望参加专业细分赛项的团队", "具备专项设备和指导条件的参赛者"],
    stages: { state: "unknown" },
    teamRequirement: { state: "unknown" },
    eligibilityState: "unknown",
    eligibilityNotes: ["2026年母赛中国赛区第一批即有182个竞赛项目，参赛对象、队伍人数与报名资格均由各赛项规程确定，不作母赛统一推断。"],
    tracks: [{
      id: "technology-innovation",
      label: "2026技术创新赛",
      stages: { state: "unrestricted" },
      teamRequirement: { state: "known", mode: "either", minSize: 1, maxSize: 5 },
      blockingClarifications: ["俄罗斯国际赛18周岁年龄门槛与参赛主体类别尚未由固定问卷确认。"],
      eligibilityNotes: ["面向金砖及“金砖+”国家企业、科研院所、本科院校、职业院校和行业协会团队，每个项目1至5名选手，可跨单位组队；俄罗斯国际赛要求选手满18周岁。"]
    }],
    schedule: {
      state: "scheduled", edition: "2026第十届", competitionStart: "2026-05", competitionEnd: "2026-12",
      datePrecision: "month", verifiedAt: COMPETITION_EXPANSION_VERIFIED_AT,
      sourceUrl: "https://ppe.ccipe.edu.cn/info/1024/3903.htm", sourceType: "education-authority"
    },
    requiredResources: ["mentor", "equipment"],
    dataCompleteness: 0.84
  },
  {
    ...computingProfile,
    id: "matiji-programming",
    name: "码蹄杯全国大学生程序设计大赛",
    aliases: ["码蹄杯"],
    organizer: "全国高等学校计算机教育研究会",
    category: "程序设计 / 算法",
    direction: "人工智能与物联",
    summary: "设置本科、职业院校等组别，以个人在线编程和算法题检验程序设计基础。",
    sourceUrl: "https://www.matiji.net/matibei",
    sourceType: "official-competition",
    subjects: ["information-communication", "statistics-mathematics"],
    fitSignals: ["algorithm-competition"],
    focus: "算法思维、程序实现与限时评测",
    deliverable: "个人在线评测代码和竞赛成绩",
    suitableFor: ["高职或本科院校的全日制在校编程学习者", "希望系统检验算法基础的个人", "可持续参与在线训练的参赛者"],
    stages: { state: "known", values: ["vocational", ...undergraduateStages, ...graduateStages] },
    teamRequirement: { state: "known", mode: "individual", minSize: 1, maxSize: 1 },
    eligibilityState: "verified",
    eligibilityNotes: ["2026官方规则设置本科院校组和职业院校组，全日制本科、硕士、博士在校生进入本科院校组，高校组别均为个人参赛。"],
    requiresFullTime: true,
    tracks: [
      { id: "undergraduate", label: "本科院校组", preferenceQuestionEligible: false, stages: { state: "known", values: [...undergraduateStages, ...graduateStages] } },
      { id: "vocational", label: "职业院校组", preferenceQuestionEligible: false, stages: { state: "known", values: ["vocational"] } }
    ],
    dataCompleteness: 0.9,
    featured: true
  },
  {
    ...researchProfile,
    id: "national-college-mathematics",
    name: "全国大学生数学竞赛",
    aliases: ["CMC"],
    organizer: "中国数学会",
    category: "数学 / 基础学科",
    direction: "学术科研",
    summary: "以高等数学和专业数学知识为核心的个人竞赛，设置不同专业类别和赛区选拔。",
    sourceUrl: "https://www.cmathc.org.cn/tzgg/545.html",
    sourceType: "organizer",
    subjects: ["statistics-mathematics"],
    fitSignals: ["modeling-intensive"],
    focus: "高等数学、数学分析与限时解题",
    deliverable: "个人理论答卷和竞赛成绩",
    suitableFor: ["高职高专或本科阶段的全日制在校学生", "数学基础扎实并愿意系统训练的个人", "希望检验基础学科能力的参赛者"],
    stages: { state: "known", values: ["vocational", ...undergraduateStages] },
    teamRequirement: { state: "known", mode: "individual", minSize: 1, maxSize: 1 },
    eligibilityState: "verified",
    eligibilityNotes: ["2026年第十八届官方通知确认所有全日制在校大学生可报名，并设数学专业、非数学专业和高职高专类的个人竞赛。"],
    requiresFullTime: true,
    dataCompleteness: 0.9,
    featured: true
  },
  {
    ...creativeProfile,
    ...undergraduateTeamRules,
    id: "red-tourism-creative-planning",
    name: "全国大学生红色旅游创意策划大赛",
    organizer: "文化和旅游部资源开发司",
    category: "红色旅游 / 创意策划",
    direction: "语言人文",
    summary: "围绕红色文化资源开展线路、产品、营销和文创策划，强调调研、叙事与落地性。",
    sourceUrl: "https://www.mct.gov.cn/whzx/bnsj/zykfs/202403/t20240328_951957.html",
    sourceType: "education-authority",
    subjects: ["tourism-planning", "language-culture"],
    fitSignals: ["field-research", "design-portfolio", "product-validation"],
    focus: "红色文化调研、旅游策划与传播设计",
    deliverable: "策划方案、调研证据和路演展示",
    suitableFor: ["旅游、文化、传播、设计相关本科生", "愿意开展实地调研的跨专业团队", "希望完成文旅策划作品的参赛者"]
  },
  {
    ...researchProfile,
    ...graduateTeamRules,
    id: "graduate-math-modeling",
    qualityTaskPrototypeRequired: true,
    name: "中国研究生数学建模竞赛",
    organizer: "中国学位与研究生教育学会",
    category: "研究生 / 数学建模",
    direction: "学术科研",
    summary: "中国研究生创新实践系列大赛核心赛事，以三人团队完成复杂问题建模、计算和论文。",
    sourceUrl: "https://cpipc.acge.org.cn/cw/hp/4",
    sourceType: "official-competition",
    subjects: ["statistics-mathematics"],
    fitSignals: ["modeling-intensive", "research-provenance"],
    focus: "复杂问题抽象、数学建模、计算验证与论文表达",
    deliverable: "建模论文、代码和可复核结果",
    suitableFor: ["在读硕士或博士研究生", "具备数学、编程和论文写作分工的三人团队", "可连续投入竞赛时段的参赛者"],
    teamRequirement: { state: "known", mode: "team", minSize: 3, maxSize: 3 },
    eligibilityState: "verified",
    eligibilityNotes: ["2026官方页面确认面向在读硕士、博士研究生，参赛队由3名研究生组成；报名与资格由培养单位审核。"],
    additionalDataNotices: ["培养单位资格审核与官网提交属于报名流程，请按所在单位通知办理。"],
    schedule: {
      state: "scheduled", edition: "2026", registrationStart: "2026-06-01", registrationEnd: "2026-09-19",
      competitionStart: "2026-09-27", competitionEnd: "2026-09-28", datePrecision: "day",
      verifiedAt: COMPETITION_EXPANSION_VERIFIED_AT, sourceUrl: "https://cpipc.acge.org.cn/cw/hp/4", sourceType: "official-competition"
    },
    dataCompleteness: 0.96,
    featured: true
  },
  {
    ...engineeringProfile,
    ...graduateTeamRules,
    id: "graduate-electronic-design",
    name: "中国研究生电子设计竞赛",
    aliases: ["研电赛"],
    organizer: "中国学位与研究生教育学会",
    category: "研究生 / 电子设计",
    direction: "工程与制造",
    summary: "面向研究生的电子信息创新实践赛事，包含技术作品与商业计划等方向。",
    sourceUrl: "https://cpipc.acge.org.cn/cw/hp/6?language=1",
    sourceType: "official-competition",
    subjects: ["information-communication"],
    fitSignals: ["hardware-build", "software-engineering", "venture-readiness"],
    focus: "电子系统创新、工程实现与成果转化",
    deliverable: "电子作品、技术报告和现场答辩",
    suitableFor: ["电子信息相关在读研究生", "具备软硬件系统开发能力的团队", "希望推进技术成果转化的参赛者"],
    teamRequirement: { state: "known", mode: "team", minSize: 2, maxSize: 3 },
    eligibilityState: "verified",
    eligibilityNotes: ["2026官方页面确认面向在读研究生，技术赛参赛队通常由2至3名学生组成；不同专项与商业赛道规则须分别复核。"],
    blockingClarifications: ["所选技术专项或商业赛道的附加资格尚须分别复核。"],
    schedule: {
      state: "scheduled", edition: "2026", registrationStart: "2026-04-03", registrationEnd: "2026-06-20",
      competitionStart: "2026-08-11", competitionEnd: "2026-08-14", datePrecision: "day",
      verifiedAt: COMPETITION_EXPANSION_VERIFIED_AT, sourceUrl: "https://cpipc.acge.org.cn/cw/hp/6?language=1", sourceType: "official-competition"
    },
    requiredResources: ["mentor", "lab", "equipment"],
    dataCompleteness: 0.95,
    featured: true
  },
  {
    ...computingProfile,
    ...graduateTeamRules,
    id: "graduate-ai-innovation",
    name: "中国研究生人工智能创新大赛",
    organizer: "中国学位与研究生教育学会",
    category: "研究生 / 人工智能",
    direction: "人工智能与物联",
    summary: "以人工智能创新技术和行业应用为主题，重视算法、系统实现、应用价值与答辩。",
    sourceUrl: "https://cpipc.acge.org.cn/cw/hp/2c9088a5696cbf370169a3f8101510bd",
    sourceType: "official-competition",
    subjects: ["information-communication", "statistics-mathematics"],
    fitSignals: ["algorithm-competition", "software-engineering", "product-validation"],
    focus: "AI算法创新、系统实现与行业应用",
    deliverable: "算法系统、技术报告和应用展示",
    suitableFor: ["在读或已获研究生录取资格的学生", "具备AI研发和产品验证能力的个人或团队", "拥有数据与算力条件的参赛者"],
    teamRequirement: { state: "known", mode: "either", minSize: 1, maxSize: 3 },
    eligibilityState: "verified",
    eligibilityNotes: ["2026官方页面确认在读硕士、博士及已取得研究生录取资格者可参赛，个人或不超过3人的团队均可报名。"],
    blockingClarifications: [
      "每名参赛者当届是否仅加入一支队伍尚未确认。"
    ],
    tracks: [
      {
        id: "individual-entry",
        label: "个人参赛",
        preferenceQuestionEligible: false,
        stages: { state: "known", values: graduateStages },
        teamRequirement: { state: "known", mode: "individual", minSize: 1, maxSize: 1 }
      },
      {
        id: "team-entry",
        label: "团队参赛",
        preferenceQuestionEligible: false,
        stages: { state: "known", values: graduateStages },
        teamRequirement: { state: "known", mode: "team", minSize: 2, maxSize: 3 },
        blockingClarifications: [
          "团队中在读研究生是否占比不低于50%尚未由固定问卷确认。",
          "队长是否为在读研究生尚未确认。"
        ]
      }
    ],
    schedule: {
      state: "scheduled", edition: "2026", registrationStart: "2026-05-22", registrationEnd: "2026-08-25",
      datePrecision: "day", verifiedAt: COMPETITION_EXPANSION_VERIFIED_AT,
      sourceUrl: "https://cpipc.acge.org.cn/cw/hp/2c9088a5696cbf370169a3f8101510bd", sourceType: "official-competition"
    },
    requiredResources: ["data"],
    dataCompleteness: 0.94,
    featured: true
  },
  {
    ...businessProfile,
    ...graduateTeamRules,
    id: "graduate-public-management-case",
    name: "中国研究生公共管理案例大赛",
    organizer: "中国学位与研究生教育学会",
    category: "研究生 / 公共管理案例",
    direction: "商业与职业",
    summary: "通过真实公共管理案例的田野调查、理论分析和现场答辩训练政策研究能力。",
    sourceUrl: "https://cpipc.acge.org.cn/cw/hp/8",
    sourceType: "official-competition",
    subjects: ["public-management"],
    fitSignals: ["field-research", "research-provenance"],
    focus: "公共管理问题、田野调查与案例论证",
    deliverable: "案例正文、分析报告和现场答辩",
    suitableFor: ["公共管理相关在读研究生", "愿意开展实地调查的三至五人团队", "重视研究伦理和证据链的参赛者"],
    teamRequirement: { state: "known", mode: "team", minSize: 3, maxSize: 5 },
    eligibilityState: "verified",
    eligibilityNotes: ["2026官方页面确认赛事主要面向MPA研究生，同一培养单位3至5名学生组队；指导教师与案例原创要求按当届规则执行。"],
    blockingClarifications: ["MPA在读身份、指导教师及案例原创性尚未由固定问卷确认。"],
    sameInstitutionTeam: true,
    schedule: {
      state: "scheduled", edition: "2026", registrationStart: "2026-01-13", registrationEnd: "2026-03-13",
      competitionStart: "2026-06-14", competitionEnd: "2026-06-14", datePrecision: "day",
      verifiedAt: COMPETITION_EXPANSION_VERIFIED_AT, sourceUrl: "https://cpipc.acge.org.cn/cw/hp/8", sourceType: "official-competition"
    },
    dataCompleteness: 0.96
  },
  {
    ...languageProfile,
    ...graduateTeamRules,
    id: "graduate-culture-china",
    name: "中国研究生“文化中国”两创大赛",
    organizer: "中国学位与研究生教育学会",
    category: "研究生 / 文化创新",
    direction: "语言人文",
    summary: "围绕中华优秀传统文化创造性转化和创新性发展，开展研究、设计与传播实践。",
    sourceUrl: "https://cpipc.acge.org.cn/cw/hp/2c9080178e896671018e97ce7525018b",
    sourceType: "official-competition",
    subjects: ["language-culture"],
    fitSignals: ["design-portfolio", "research-provenance", "language-communication"],
    focus: "中华文化研究、创意转化与当代表达",
    deliverable: "文化研究、设计作品或传播方案",
    suitableFor: ["人文、设计、传播等在读研究生", "希望推进文化创新项目的个人或团队", "能兼顾研究深度与传播效果的参赛者"],
    teamRequirement: { state: "known", mode: "either", minSize: 1, maxSize: 5 },
    eligibilityState: "verified",
    eligibilityNotes: ["2026官方页面确认面向在读硕士、博士研究生，个人或1至5人团队均可参赛；不同赛道材料要求须复核。"],
    blockingClarifications: ["用户拟选赛道的当届材料与申报要求尚待官方规则复核。"],
    schedule: {
      state: "scheduled", edition: "2026", registrationStart: "2026-05-25", registrationEnd: "2026-09-14",
      datePrecision: "day", verifiedAt: COMPETITION_EXPANSION_VERIFIED_AT,
      sourceUrl: "https://cpipc.acge.org.cn/cw/hp/2c9080178e896671018e97ce7525018b", sourceType: "official-competition"
    },
    dataCompleteness: 0.94
  },
  {
    ...researchProfile,
    id: "comap-mcm-icm",
    name: "COMAP Mathematical Contest in Modeling / Interdisciplinary Contest in Modeling",
    aliases: ["MCM/ICM", "美国大学生数学建模竞赛"],
    organizer: "COMAP",
    category: "数学建模 / 国际赛事",
    direction: "学术科研",
    summary: "国际本科生数学建模赛事，团队在连续赛时内完成英文建模论文与 supporting materials。",
    sourceUrl: "https://www.comap.com/contests/mcm-icm",
    sourceType: "official-competition",
    subjects: ["statistics-mathematics"],
    fitSignals: ["modeling-intensive", "research-provenance"],
    focus: "跨学科问题建模、计算验证与英文论文表达",
    deliverable: "英文建模论文、代码和 supporting materials",
    suitableFor: ["本科阶段数学建模学习者", "具备建模、编程和英文写作分工的团队", "能连续投入官方赛时的参赛者"],
    stages: { state: "known", values: undergraduateStages },
    teamRequirement: { state: "known", mode: "team", minSize: 1, maxSize: 3 },
    eligibilityState: "verified",
    eligibilityNotes: ["COMAP官方页面确认赛事面向本科生，每队最多3名学生并由学校顾问注册；跨校、顾问与提交规则应按2027规则复核。"],
    blockingClarifications: ["学校顾问注册、跨校限制与2027届提交资格尚须复核。"],
    schedule: {
      state: "scheduled", edition: "2027", competitionStart: "2027-01-28", competitionEnd: "2027-02-01",
      datePrecision: "day", verifiedAt: COMPETITION_EXPANSION_VERIFIED_AT,
      sourceUrl: "https://www.comap.com/contests/mcm-icm", sourceType: "official-competition"
    },
    dataCompleteness: 0.95,
    featured: true
  },
  {
    ...researchProfile,
    id: "igem-collegiate",
    name: "iGEM Collegiate Competition",
    aliases: ["iGEM", "国际遗传工程机器大赛"],
    organizer: "iGEM Foundation",
    category: "合成生物学 / 国际赛事",
    direction: "学术科研",
    summary: "国际合成生物学团队赛事，以实验项目、工程循环、Wiki、展示和安全合规为完整交付。",
    sourceUrl: "https://competition.igem.org/registration/overview",
    sourceType: "official-competition",
    subjects: ["synthetic-biology", "biology-life-science"],
    majors: ["medicine", "engineering", "computer-science", "other"],
    fitSignals: ["research-provenance", "product-validation", "sustainability-impact"],
    focus: "合成生物学工程循环、实验验证、社会实践与安全",
    deliverable: "实验项目、团队Wiki、展示视频和现场答辩",
    suitableFor: ["本科或研究生阶段合成生物学团队", "可获得PI、实验室和机构支持的参赛者", "能同时完成实验、建模、设计与社会实践的跨专业团队"],
    stages: { state: "known", values: [...undergraduateStages, ...graduateStages] },
    teamRequirement: { state: "known", mode: "team" },
    eligibilityState: "verified",
    eligibilityNotes: [
      "iGEM 2026官方注册页确认Collegiate Competition由高等教育机构团队注册，官方Team Roster页要求至少一名Primary PI负责注册、安全、付费与合规。",
      "iGEM 2026官方Fees & Deadlines页明确Stage I和Stage II团队费用为参赛必须；Responsibility Safety Policies要求安全表单、白名单及特定实验的事前审批。"
    ],
    blockingClarifications: [
      "Primary PI、高等教育机构团队注册与官方Team Roster尚未核验。",
      "Stage I/II团队费用与安全表单、白名单、事前审批合规状态尚未核验。"
    ],
    requiredResources: ["mentor", "lab", "equipment", "budget", "safety-compliance"],
    helpfulResources: ["data"],
    supportingSources: [
      {
        url: "https://competition.igem.org/registration/team-roster",
        sourceType: "official-competition",
        verifiedAt: COMPETITION_EXPANSION_VERIFIED_AT,
        evidenceRef: `official:igem-collegiate:team-roster:${COMPETITION_EXPANSION_VERIFIED_AT}`,
        facts: ["eligibility", "requiredResources"]
      },
      {
        url: "https://competition.igem.org/registration/fees",
        sourceType: "official-competition",
        verifiedAt: COMPETITION_EXPANSION_VERIFIED_AT,
        evidenceRef: `official:igem-collegiate:fees:${COMPETITION_EXPANSION_VERIFIED_AT}`,
        facts: ["eligibility", "requiredResources"]
      },
      {
        url: "https://responsibility.igem.org/safety-policies",
        sourceType: "official-competition",
        verifiedAt: COMPETITION_EXPANSION_VERIFIED_AT,
        evidenceRef: `official:igem-collegiate:safety:${COMPETITION_EXPANSION_VERIFIED_AT}`,
        facts: ["eligibility", "requiredResources"]
      },
      {
        url: "https://competition.igem.org/about/starting-a-team",
        sourceType: "official-competition",
        verifiedAt: COMPETITION_EXPANSION_VERIFIED_AT,
        evidenceRef: `official:igem-collegiate:commitment:${COMPETITION_EXPANSION_VERIFIED_AT}`,
        facts: ["requiredResources", "teamCommitment"]
      }
    ],
    additionalDataNotices: ["iGEM官方组队指南将实验室赛季通常描述为5月至10月，且团队需持续完成实验、建模、安全、Wiki与展示；应按长周期高投入项目评估，不宜作为短期冲刺赛事。"],
    dataCompleteness: 0.9,
    featured: true
  },
] as const satisfies readonly ExpansionSpec[];

function reviewedEvidenceSource(
  id: string,
  suffix: string,
  url: string,
  facts: NonNullable<CompetitionMetadataSource["facts"]>,
  sourceType: CompetitionMetadataSource["sourceType"] = "official-competition"
): CompetitionMetadataSource {
  return {
    url,
    sourceType,
    verifiedAt: COMPETITION_EXPANSION_VERIFIED_AT,
    evidenceRef: `official:${id}:${suffix}:${COMPETITION_EXPANSION_VERIFIED_AT}`,
    facts
  };
}

const currentRule = (
  id: string,
  url: string,
  options: {
    facts?: NonNullable<CompetitionMetadataSource["facts"]>;
    participationModes?: CompetitionRecommendationMetadata["participationModes"];
    sourceType?: CompetitionMetadataSource["sourceType"];
  } = {}
): ExpansionEvidenceReview => {
  const facts = options.facts ?? ["identity", "stages", "teamRequirement", "eligibility"];
  return {
    primaryFacts: ["identity"],
    participationModes: options.participationModes ?? ["unknown"],
    factSources: [reviewedEvidenceSource(id, "current-rules", url, facts, options.sourceType)],
    recentActivitySource: reviewedEvidenceSource(
      id,
      "recent-activity",
      url,
      ["recentActivity"],
      options.sourceType
    )
  };
};

/**
 * Per-entry evidence audit for the 59 additions. An official landing page proves
 * identity only. Hard facts and recency appear below solely when a dated current
 * rule/notice was reviewed. This intentionally leaves logistics unknown for the
 * remaining entries instead of projecting a shared format onto unrelated events.
 */
export const expansionEvidenceReviews = {
  "graduate-cybersecurity-innovation": currentRule(
    "graduate-cybersecurity-innovation",
    "https://cpipc.acge.org.cn/cw/hp/2c90800c8093eef401809d33b36f0652?language=1",
    { facts: ["stages", "teamRequirement", "eligibility", "schedule"] }
  ),
  "national-structural-design": currentRule(
    "national-structural-design",
    "https://www.sues.edu.cn/_upload/article/files/20/1e/2db459b7465887d8f668885071da/131fb335-fbb3-4ed9-bef3-3894867f2f46.pdf",
    {
      facts: ["stages", "teamRequirement", "eligibility", "participationMode"],
      participationModes: ["offline"],
      sourceType: "education-authority"
    }
  ),
  "national-advertising-art": currentRule(
    "national-advertising-art",
    "https://2025.sun-ada.net/home/about_intrs2.html",
    {
      facts: ["stages", "teamRequirement", "eligibility", "schedule", "participationMode"],
      participationModes: ["hybrid"]
    }
  ),
  "engineering-practice-innovation": currentRule(
    "engineering-practice-innovation",
    "https://www.gcxl.edu.cn/new/index.html",
    { facts: ["stages", "teamRequirement", "eligibility"] }
  ),
  "huacan-design-award": currentRule(
    "huacan-design-award",
    "https://www.huacanjiang.com/home/newsDetails?_refluxos=a10&newsId=105179",
    { facts: ["teamRequirement", "eligibility", "trackEligibility"] }
  ),
  "national-innovation-training-annual": {
    primaryFacts: ["identity"],
    participationModes: ["unknown"],
    factSources: [reviewedEvidenceSource(
      "national-innovation-training-annual",
      "2025-selection-notice",
      "https://www.gjcxcy.cn/PublicColumn/Notice/e9090812-003b-4a84-85d6-aa197d06baab",
      ["stages", "eligibility", "trackEligibility"],
      "education-authority"
    )],
    recentActivitySource: reviewedEvidenceSource(
      "national-innovation-training-annual",
      "2025-annual-meeting",
      "https://www.gjcxcy.cn/PublicColumn/Notice/e90b0a12-1e31-488b-9102-af068a2f2f0b",
      ["recentActivity"],
      "education-authority"
    )
  },
  "chemical-engineering-design": currentRule(
    "chemical-engineering-design",
    "https://iche.zju.edu.cn/index.php/a/sstz/1656.html",
    {
      facts: ["stages", "teamRequirement", "eligibility", "schedule", "participationMode"],
      participationModes: ["hybrid"]
    }
  ),
  "service-outsourcing-innovation": currentRule(
    "service-outsourcing-innovation",
    "https://www.fwwb.org.cn/attached/file/20260211/20260211154941_13.pdf",
    {
      facts: ["stages", "teamRequirement", "eligibility", "schedule", "participationMode"],
      participationModes: ["hybrid"]
    }
  ),
  "milan-design-week-china": {
    primaryFacts: ["identity"],
    participationModes: ["remote"],
    factSources: [reviewedEvidenceSource(
      "milan-design-week-china",
      "2026-rules",
      "https://www.czu.cn/_t1006/2026/0323/c6a171373/page.htm",
      ["teamRequirement", "eligibility", "schedule", "participationMode", "trackEligibility"],
      "education-authority"
    )]
  },
  "geology-skills": currentRule(
    "geology-skills",
    "https://www.geosociety.org.cn/upload/pdf/notice/20260706173639_29.pdf",
    {
      facts: ["stages", "teamRequirement", "eligibility", "schedule", "participationMode"],
      participationModes: ["offline"],
      sourceType: "organizer"
    }
  ),
  "optoelectronic-design": currentRule(
    "optoelectronic-design",
    "https://wdy.nuist.edu.cn/_upload/article/files/e8/cb/f2ed60c748e28c0254c5523a259e/1033eff1-a5c0-49c4-badb-991b00bf2633.pdf",
    { facts: ["stages", "teamRequirement", "eligibility"], sourceType: "organizer" }
  ),
  "metallographic-skills": currentRule(
    "metallographic-skills",
    "https://cdn.jxds.tech/files/20250815/2026%E9%87%91%E7%9B%B8%E5%A4%A7%E8%B5%9B%E7%AB%A0%E7%A8%8B.pdf",
    {
      facts: ["stages", "teamRequirement", "eligibility", "participationMode", "trackEligibility"],
      participationModes: ["offline"]
    }
  ),
  "zhou-peiyuan-mechanics": {
    primaryFacts: ["identity"],
    participationModes: ["offline"],
    factSources: [reviewedEvidenceSource(
      "zhou-peiyuan-mechanics",
      "2025-rules",
      "https://zhxy.nwsuaf.edu.cn/docs/2025-03/8ee77789b1d048e5aef631299afd9f93.pdf",
      ["stages", "teamRequirement", "eligibility", "schedule", "participationMode"],
      "organizer"
    )],
    recentActivitySource: reviewedEvidenceSource(
      "zhou-peiyuan-mechanics",
      "2025-team-event",
      "https://m.cstam.org.cn/148/index.html",
      ["recentActivity"],
      "organizer"
    )
  },
  "mechanical-engineering-innovation": currentRule(
    "mechanical-engineering-innovation",
    "https://aao.nuaa.edu.cn/2026/0422/c19003a397495/page.htm",
    {
      facts: ["stages", "teamRequirement", "eligibility"],
      sourceType: "education-authority"
    }
  ),
  "china-us-young-maker": currentRule(
    "china-us-young-maker",
    "https://chinaus-maker.cscse.edu.cn/",
    {
      facts: ["stages", "teamRequirement", "eligibility", "schedule", "participationMode", "trackEligibility"],
      participationModes: ["hybrid"],
      sourceType: "education-authority"
    }
  ),
  "raicom-robot-developer": currentRule(
    "raicom-robot-developer",
    "https://cxcyxy.ntu.edu.cn/2026/0430/c10412a290318/page.htm",
    {
      facts: ["stages", "teamRequirement", "eligibility"],
      sourceType: "education-authority"
    }
  ),
  "datang-ict": {
    primaryFacts: ["identity"],
    participationModes: ["hybrid"],
    factSources: [
      reviewedEvidenceSource(
        "datang-ict",
        "2026-invitation",
        "https://cet.ncepu.edu.cn/docs/2025-12/f7028bf4abba4dedbb1657751fac5746.pdf",
        ["stages", "teamRequirement", "eligibility", "schedule", "trackEligibility"],
        "organizer"
      ),
      reviewedEvidenceSource(
        "datang-ict",
        "2026-ict-general-format",
        "https://jsjx.cczu.edu.cn/_upload/article/files/c0/85/a03405e247cebd2ba1c80d68f202/4f4503c5-0564-4214-b4e2-2d3482e73438.pdf",
        ["participationMode"],
        "organizer"
      )
    ],
    recentActivitySource: reviewedEvidenceSource(
      "datang-ict",
      "2026-national-final",
      "https://dtcup.dtxiaotangren.com/",
      ["recentActivity"]
    )
  },
  "huawei-ict": currentRule(
    "huawei-ict",
    "https://www.huawei.com/minisite/ict-competition-2025-2026-global/cn/",
    {
      facts: ["stages", "teamRequirement", "eligibility", "participationMode"],
      participationModes: ["hybrid"],
      sourceType: "organizer"
    }
  ),
  "embedded-chip-system-design": currentRule(
    "embedded-chip-system-design",
    "https://computer.cdu.edu.cn/info/1036/12076.htm",
    {
      facts: ["stages", "teamRequirement", "eligibility", "schedule", "participationMode"],
      participationModes: ["hybrid"],
      sourceType: "education-authority"
    }
  ),
  "culsc-life-sciences": currentRule(
    "culsc-life-sciences",
    "https://futurebs.sysu.edu.cn/sites/default/files/2025-10/%E7%AC%AC%E5%8D%81%E4%B8%80%E5%B1%8A%E7%AB%9E%E8%B5%9B%E9%80%9A%E7%9F%A5%EF%BC%88%E7%A7%91%E5%AD%A6%E6%8E%A2%E7%A9%B6%E7%B1%BB%EF%BC%89.pdf",
    {
      facts: ["stages", "teamRequirement", "eligibility", "schedule", "participationMode"],
      participationModes: ["hybrid"],
      sourceType: "organizer"
    }
  ),
  "physics-experiment-innovation": currentRule(
    "physics-experiment-innovation",
    "https://www.teach.ustc.edu.cn/wp-content/uploads/2026/03/2026%E5%B9%B4%E7%AC%AC%E5%8D%81%E4%BA%8C%E5%B1%8A%E5%85%A8%E5%9B%BD%E5%A4%A7%E5%AD%A6%E7%94%9F%E7%89%A9%E7%90%86%E5%AE%9E%E9%AA%8C%E7%AB%9E%E8%B5%9B-%E5%88%9B%E6%96%B0%E7%AC%AC%E4%B8%80%E8%BD%AE%E9%80%9A%E7%9F%A5.pdf",
    {
      facts: ["stages", "teamRequirement", "eligibility", "participationMode"],
      participationModes: ["hybrid"],
      sourceType: "organizer"
    }
  ),
  "bim-graduation-design": currentRule(
    "bim-graduation-design",
    "https://www.gzcc.edu.cn/sjjxzx/upload/files/2025/11/43e8c575b27dad29.pdf",
    {
      facts: ["stages", "teamRequirement", "eligibility", "schedule", "participationMode", "trackEligibility"],
      participationModes: ["remote"],
      sourceType: "organizer"
    }
  ),
  "intelligent-robot-creativity": {
    primaryFacts: ["identity"],
    participationModes: ["hybrid"],
    factSources: [reviewedEvidenceSource(
      "intelligent-robot-creativity",
      "2025-rules",
      "https://rob.zju.edu.cn/2025/0102/c61561a3008838/page.htm",
      ["stages", "teamRequirement", "eligibility", "participationMode", "trackEligibility"],
      "organizer"
    ), reviewedEvidenceSource(
      "intelligent-robot-creativity",
      "2026-schedule",
      "https://www.robotcontest.cn/home/homepage",
      ["schedule"],
      "official-competition"
    )],
    recentActivitySource: reviewedEvidenceSource(
      "intelligent-robot-creativity",
      "2026-season",
      "https://www.robotcontest.cn/home/homepage",
      ["recentActivity"]
    )
  },
  "china-good-design": currentRule(
    "china-good-design",
    "https://www.cdec.org.cn/articleDetail/2283",
    { facts: ["stages", "teamRequirement", "eligibility", "schedule", "participationMode"], participationModes: ["remote"] }
  ),
  "china-robot-ai": {
    primaryFacts: ["identity"],
    participationModes: ["hybrid"],
    factSources: [
      reviewedEvidenceSource(
        "china-robot-ai",
        "2026-current-rules",
        "https://cee.swun.edu.cn/__local/D/19/62/D2160699EF374E55B9873CD7CC4_BD19C149_6EC73.pdf",
        ["stages", "teamRequirement", "eligibility"],
        "education-authority"
      ),
      reviewedEvidenceSource(
        "china-robot-ai",
        "2026-online-final",
        "https://www.caairobot.com/post/notification-online-craic2026/",
        ["participationMode"]
      ),
      reviewedEvidenceSource(
        "china-robot-ai",
        "2026-offline-final",
        "https://www.caairobot.com/post/notification-finalhaerbin-craic2026/",
        ["participationMode"]
      )
    ],
    recentActivitySource: reviewedEvidenceSource(
      "china-robot-ai",
      "2026-rules",
      "https://www.caairobot.com/post/competition-rules-craic2026/",
      ["recentActivity"]
    )
  },
  "chinese-classics": currentRule(
    "chinese-classics",
    "https://www.moe.gov.cn/srcsite/A18/s3137/202503/t20250320_1183929.html",
    {
      facts: ["stages", "teamRequirement", "eligibility"],
      sourceType: "education-authority"
    }
  ),
  "intercultural-competence": currentRule(
    "intercultural-competence",
    "https://ict.sflep.com/index.php?a=show&c=index&catid=15&id=179&m=content",
    {
      facts: ["stages", "teamRequirement", "eligibility", "participationMode"],
      participationModes: ["remote", "offline"],
      sourceType: "organizer"
    }
  ),
  "baidu-star": currentRule(
    "baidu-star",
    "https://www.matiji.net/exam/contest/astar",
    {
      facts: ["stages", "teamRequirement", "eligibility", "participationMode"],
      participationModes: ["remote"],
      sourceType: "organizer"
    }
  ),
  "water-innovation-design": {
    primaryFacts: ["identity"],
    participationModes: ["hybrid"],
    factSources: [reviewedEvidenceSource(
      "water-innovation-design",
      "2025-rules",
      "https://sljzw.hhu.edu.cn/2025/0331/c11808a300361/page.htm",
      ["stages", "teamRequirement", "eligibility", "participationMode"],
      "organizer"
    )],
    recentActivitySource: reviewedEvidenceSource(
      "water-innovation-design",
      "2025-notice",
      "https://sljzw.hhu.edu.cn/fenhui/2025/0331/c12009a300360/page.htm",
      ["recentActivity"],
      "organizer"
    )
  },
  "chemical-engineering-experiment": {
    primaryFacts: ["identity"],
    participationModes: ["unknown"],
    factSources: [reviewedEvidenceSource(
      "chemical-engineering-experiment",
      "2026-official-file",
      "https://hgxy.hfut.edu.cn/_upload/article/files/2a/a3/90f6475b45d3a88778a739e48679/48601720-aee0-42d4-beb5-535c3023d396.pdf",
      ["stages", "teamRequirement", "eligibility"],
      "organizer"
    )],
    recentActivitySource: reviewedEvidenceSource(
      "chemical-engineering-experiment",
      "2026-regional-notice",
      "https://edu.cteic.com/match/profile/upload/2026/05/12/%E4%B8%AD%E5%8C%96%E6%95%99%E5%8D%8F%E5%8F%91%E3%80%942026%E3%80%9536%E5%8F%B7-%E5%85%B3%E4%BA%8E%E4%B8%BE%E5%8A%9E%E7%AC%AC%E4%B9%9D%E5%B1%8A%E5%85%A8%E5%9B%BD%E5%A4%A7%E5%AD%A6%E7%94%9F%E5%8C%96%E5%B7%A5%E5%AE%9E%E9%AA%8C%E5%A4%A7%E8%B5%9B%E8%A5%BF%E5%8D%97%E8%B5%9B%E5%8C%BA%E7%AB%9E%E8%B5%9B%E7%9A%84%E9%80%9A%E7%9F%A5_1__20260512111731A020.pdf",
      ["recentActivity"],
      "organizer"
    )
  },
  "chemistry-experiment-innovation": currentRule(
    "chemistry-experiment-innovation",
    "https://slise.btbu.edu.cn/docs/2026-04/dcd3cd94bdce41a79ddc08d7b8263e4f.pdf",
    {
      facts: ["stages", "teamRequirement", "eligibility", "trackEligibility", "participationMode"],
      participationModes: ["hybrid"],
      sourceType: "organizer"
    }
  ),
  "computer-system-ability": {
    primaryFacts: ["identity"],
    participationModes: ["unknown"],
    factSources: [reviewedEvidenceSource(
      "computer-system-ability",
      "2026-os-function-challenge",
      "https://course.educg.net/pages/contest/contest.jsp?contestCID=0&contestID=Y8zmbRcqh1Q&doVisit=true&my=false",
      ["trackEligibility"]
    )],
    recentActivitySource: reviewedEvidenceSource(
      "computer-system-ability",
      "2026-season",
      "https://pra.xtnl.org.cn/",
      ["recentActivity"]
    )
  },
  "garden-design-build": currentRule(
    "garden-design-build",
    "https://landscape-caup.tongji.edu.cn/c8/f4/c10586a379124/page.htm",
    {
      facts: ["stages", "teamRequirement", "eligibility", "participationMode"],
      participationModes: ["hybrid"],
      sourceType: "organizer"
    }
  ),
  "information-security-confrontation": {
    primaryFacts: ["identity"],
    participationModes: ["hybrid"],
    factSources: [
      reviewedEvidenceSource(
        "information-security-confrontation",
        "2026-general-notice",
        "https://www.isclab.org.cn/2026/03/16/2026%E5%B9%B4%E7%AC%AC23%E5%B1%8A%E4%BF%A1%E6%81%AF%E5%AE%89%E5%85%A8%E4%B8%8E%E5%AF%B9%E6%8A%97%E6%8A%80%E6%9C%AF%E7%AB%9E%E8%B5%9B%E9%80%9A%E7%9F%A5/",
        ["stages", "teamRequirement", "eligibility", "participationMode"]
      ),
      reviewedEvidenceSource(
        "information-security-confrontation",
        "2026-game-confrontation",
        "https://www.isclab.org.cn/2026/07/23/2026%E5%B9%B4%E7%AC%AC23%E5%B1%8A%E4%BF%A1%E6%81%AF%E5%AE%89%E5%85%A8%E4%B8%8E%E5%AF%B9%E6%8A%97%E6%8A%80%E6%9C%AF%E7%AB%9E%E8%B5%9B%E9%80%9A%E7%9F%A5-%E5%8D%9A%E5%BC%88%E5%AF%B9%E6%8A%97%E8%B5%9B/",
        ["trackEligibility"]
      )
    ],
    recentActivitySource: reviewedEvidenceSource(
      "information-security-confrontation",
      "2026-notice",
      "https://www.isclab.org.cn/2026/03/16/2026%E5%B9%B4%E7%AC%AC23%E5%B1%8A%E4%BF%A1%E6%81%AF%E5%AE%89%E5%85%A8%E4%B8%8E%E5%AF%B9%E6%8A%97%E6%8A%80%E6%9C%AF%E7%AB%9E%E8%B5%9B%E9%80%9A%E7%9F%A5/",
      ["recentActivity"]
    )
  },
  "surveying-innovation": currentRule(
    "surveying-innovation",
    "https://amap.csgpc.org/detail/27080.html",
    {
      facts: ["stages", "teamRequirement", "eligibility", "participationMode"],
      participationModes: ["remote"],
      sourceType: "organizer"
    }
  ),
  "statistical-modeling": currentRule(
    "statistical-modeling",
    "https://www.ai-learning.net/dstz/37119.jhtml",
    {
      facts: ["stages", "teamRequirement", "eligibility", "schedule", "participationMode"],
      participationModes: ["hybrid"]
    }
  ),
  "basic-medicine-innovation": currentRule(
    "basic-medicine-innovation",
    "https://www.jcyxds.com/home/newsDetails?newsId=122227",
    {
      facts: ["stages", "teamRequirement", "eligibility", "schedule", "participationMode"],
      participationModes: ["hybrid"]
    }
  ),
  "tax-risk-case": currentRule(
    "tax-risk-case",
    "https://ssfkds.moocollege.com/home",
    { facts: ["stages", "teamRequirement", "eligibility", "schedule"] }
  ),
  "enterprise-competition-simulation": currentRule(
    "enterprise-competition-simulation",
    "https://www.ibizsim.cn/main/news/275",
    { facts: ["stages", "teamRequirement", "eligibility", "trackEligibility"] }
  ),
  "digital-enterprise-sandbox": currentRule(
    "digital-enterprise-sandbox",
    "https://jiaowu.web.hebust.edu.cn/cxcy/xkjs/567d5ff3698f416fb4b380521850c56f.htm",
    {
      facts: ["stages", "teamRequirement", "eligibility"],
      sourceType: "education-authority"
    }
  ),
  "digital-building-innovation": currentRule(
    "digital-building-innovation",
    "https://www.ccen.com.cn/info/1150/5937.htm",
    {
      facts: ["stages", "teamRequirement", "eligibility"],
      sourceType: "organizer"
    }
  ),
  "global-campus-ai-algorithm": {
    primaryFacts: ["identity"],
    participationModes: ["hybrid"],
    factSources: [
      reviewedEvidenceSource(
        "global-campus-ai-algorithm",
        "2026-general-notice",
        "https://www.aicomp.cn/notice/notice-1/3618.html",
        ["stages", "eligibility", "schedule", "participationMode"]
      ),
      reviewedEvidenceSource(
        "global-campus-ai-algorithm",
        "2026-indoor-agriculture",
        "https://www.aicomp.cn/notice/notice-3/4784.html",
        ["trackEligibility"]
      )
    ],
    recentActivitySource: reviewedEvidenceSource(
      "global-campus-ai-algorithm",
      "2026-indoor-agriculture-recent",
      "https://www.aicomp.cn/notice/notice-3/4784.html",
      ["recentActivity"]
    )
  },
  "smart-agricultural-equipment": currentRule(
    "smart-agricultural-equipment",
    "https://uiaec.ujs.edu.cn/news_show.php?id=224",
    {
      facts: ["stages", "teamRequirement", "eligibility", "schedule", "participationMode", "trackEligibility"],
      participationModes: ["hybrid"]
    }
  ),
  "keyun-accounting": currentRule(
    "keyun-accounting",
    "https://jw.tust.edu.cn/docs/2025-10/b3e0bded85af4ec0ae4c0044240152da.pdf",
    {
      facts: ["stages", "teamRequirement", "eligibility", "participationMode"],
      participationModes: ["remote"],
      sourceType: "organizer"
    }
  ),
  "world-vocational-skills": currentRule(
    "world-vocational-skills",
    "https://www.moe.gov.cn/srcsite/A07/s7055/202506/t20250617_1194543.html",
    {
      facts: ["stages", "teamRequirement", "eligibility"],
      sourceType: "education-authority"
    }
  ),
  "robotac": currentRule(
    "robotac",
    "https://robotac.cn/sys-nd/1307.html",
    {
      facts: ["stages", "teamRequirement", "eligibility", "schedule", "participationMode"],
      participationModes: ["hybrid"]
    }
  ),
  "worldskills": {
    primaryFacts: ["identity"],
    participationModes: ["offline"],
    factSources: [
      reviewedEvidenceSource(
        "worldskills",
        "competition-rules-v11",
        "https://worldskills.org/media/news/competition-rules-updated-worldskills-shanghai-2026/",
        ["stages", "teamRequirement", "eligibility"]
      ),
      reviewedEvidenceSource(
        "worldskills",
        "shanghai-2026-schedule",
        "https://worldskills.org/media/news/competition-preparation-week-begins-shanghai/",
        ["schedule", "participationMode"]
      )
    ],
    recentActivitySource: reviewedEvidenceSource(
      "worldskills",
      "2026-preparation",
      "https://worldskills.org/media/news/competition-preparation-week-begins-shanghai/",
      ["recentActivity"]
    )
  },
  "worldskills-china-selection": {
    primaryFacts: ["identity"],
    participationModes: ["offline"],
    factSources: [
      reviewedEvidenceSource(
        "worldskills-china-selection",
        "third-national-skills-rules",
        "https://worldskillschina.mohrss.gov.cn/c/2025-06-30/4526.shtml",
        ["stages", "teamRequirement", "eligibility"],
        "education-authority"
      ),
      reviewedEvidenceSource(
        "worldskills-china-selection",
        "2025-schedule",
        "https://chinajob.mohrss.gov.cn/h5/c/2025-09-26/452589.shtml",
        ["schedule", "participationMode"],
        "education-authority"
      )
    ],
    recentActivitySource: reviewedEvidenceSource(
      "worldskills-china-selection",
      "2025-results",
      "https://chinajob.mohrss.gov.cn/h5/c/2025-09-26/452589.shtml",
      ["recentActivity"],
      "education-authority"
    )
  },
  "brics-skills": {
    primaryFacts: ["identity"],
    participationModes: ["unknown"],
    factSources: [
      reviewedEvidenceSource(
        "brics-skills",
        "2026-first-batch",
        "https://ppe.ccipe.edu.cn/info/1024/3903.htm",
        ["schedule"],
        "education-authority"
      ),
      reviewedEvidenceSource(
        "brics-skills",
        "2026-technology-innovation",
        "https://www.bricsfuture.org.cn/a/20-348.html",
        ["trackEligibility"],
        "organizer"
      )
    ],
    recentActivitySource: reviewedEvidenceSource(
      "brics-skills",
      "2026-current-season",
      "https://ppe.ccipe.edu.cn/info/1024/3903.htm",
      ["recentActivity"],
      "education-authority"
    )
  },
  "matiji-programming": {
    primaryFacts: ["identity"],
    participationModes: ["unknown"],
    factSources: [reviewedEvidenceSource(
      "matiji-programming",
      "2026-official-rules",
      "https://bigdata.cczu.edu.cn/_upload/article/files/5a/d9/15a17cae4667b4c1acc916be257d/cf794916-39aa-49ed-833b-a1f82be934cb.pdf",
      ["stages", "teamRequirement", "eligibility", "trackEligibility"],
      "education-authority"
    )]
  },
  "national-college-mathematics": currentRule(
    "national-college-mathematics",
    "https://www.cmathc.org.cn/tzgg/545.html",
    { sourceType: "organizer" }
  ),
  "red-tourism-creative-planning": {
    primaryFacts: ["identity", "stages", "teamRequirement", "eligibility"],
    participationModes: ["unknown"]
  },
  "graduate-math-modeling": currentRule(
    "graduate-math-modeling",
    "https://cpipc.acge.org.cn/cw/hp/4",
    {
      facts: ["stages", "teamRequirement", "eligibility", "schedule", "participationMode"],
      participationModes: ["remote"]
    }
  ),
  "graduate-electronic-design": currentRule(
    "graduate-electronic-design",
    "https://cpipc.acge.org.cn/cw/hp/6?language=1",
    {
      facts: ["stages", "teamRequirement", "eligibility", "schedule", "participationMode"],
      participationModes: ["hybrid"]
    }
  ),
  "graduate-ai-innovation": currentRule(
    "graduate-ai-innovation",
    "https://cpipc.acge.org.cn/cw/hp/2c9088a5696cbf370169a3f8101510bd",
    { facts: ["stages", "teamRequirement", "eligibility", "schedule", "trackEligibility"] }
  ),
  "graduate-public-management-case": currentRule(
    "graduate-public-management-case",
    "https://cpipc.acge.org.cn/cw/hp/8",
    {
      facts: ["stages", "teamRequirement", "eligibility", "schedule", "participationMode"],
      participationModes: ["hybrid"]
    }
  ),
  "graduate-culture-china": currentRule(
    "graduate-culture-china",
    "https://cpipc.acge.org.cn/cw/hp/2c9080178e896671018e97ce7525018b",
    { facts: ["stages", "teamRequirement", "eligibility", "schedule"] }
  ),
  "comap-mcm-icm": currentRule(
    "comap-mcm-icm",
    "https://www.comap.com/contests/mcm-icm",
    {
      facts: ["stages", "teamRequirement", "eligibility", "schedule", "participationMode"],
      participationModes: ["remote"]
    }
  ),
  "igem-collegiate": currentRule(
    "igem-collegiate",
    "https://competition.igem.org/registration/overview",
    {
      facts: ["stages", "teamRequirement", "eligibility", "participationMode", "requiredResources"],
      participationModes: ["remote", "hybrid"]
    }
  )
} as const satisfies Record<(typeof expansionCompetitionSpecs)[number]["id"], ExpansionEvidenceReview>;

export const expansionCompetitions: readonly CompetitionSource[] = expansionCompetitionSpecs.map(toCompetition);
