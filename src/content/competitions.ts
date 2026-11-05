import type {
  CompetitionDifficulty,
  CompetitionExperienceLevel,
  CompetitionFitSignal,
  CompetitionGoal,
  CompetitionInterest,
  CompetitionMajorField,
  CompetitionPreferredOutput,
  CompetitionRegion,
  CompetitionResource,
  CompetitionSkill,
  CompetitionStartingPoint,
  CompetitionStudentStage,
  CompetitionTaskFormat,
  CompetitionWeeklyHours
} from "@/types/competition-recommendation";
import {
  competitionGuideTrace,
  guideCompetitions
} from "@/content/competition-guide";
import { researchedCompetitions } from "./competition-series";
import { attachDocumentedTracks } from "./competition-documented-tracks";
import { expansionCompetitions } from "@/content/competition-expansion";
import { enrichCompetitionTaxonomy } from "@/content/competition-taxonomy";

export type CompetitionDetail = {
  intro: string;
  participationPath: string;
  userValue: string;
  suitableFor: readonly string[];
  preparationTips: readonly string[];
};

export type CompetitionDirection =
  | "创意与数字"
  | "工程与制造"
  | "人工智能与物联"
  | "创新创业"
  | "商业与职业"
  | "学术科研"
  | "语言人文";

/**
 * Editorial subject taxonomy used to retain discipline-level distinctions that
 * are intentionally broader than eligibility and do not alter the current UI.
 */
export type CompetitionSubjectArea =
  | "medicine-health"
  | "civil-architecture"
  | "visual-communication"
  | "engineering-practice"
  | "chemistry-chemical"
  | "geoscience-surveying"
  | "physics-optics"
  | "mechanics-materials"
  | "information-communication"
  | "biology-life-science"
  | "robotics-automation"
  | "water-environment"
  | "cybersecurity-systems"
  | "statistics-mathematics"
  | "finance-accounting"
  | "digital-construction"
  | "agriculture-equipment"
  | "language-culture"
  | "public-management"
  | "vocational-skills"
  | "synthetic-biology"
  | "tourism-planning"
  | "legal-studies"
  | "computing-algorithms"
  | "business-innovation"
  | "arts-performance";

export type CompetitionCoverImage = {
  src: string;
  sourceSvgSrc: string;
  metadataSrc: string;
  alt: string;
  credit: string;
  origin: "site-original" | "official-authorized" | "licensed-stock" | "ai-generated";
  rightsStatus:
    | "owned"
    | "written-license"
    | "open-license"
    | "ai-generated-no-human-authorship-claim";
  reviewStatus: "editorial-review-passed";
  reviewedAt: string;
  aiGenerated: boolean;
  humanReviewRequired: boolean;
};

export type CompetitionIdentity = {
  /** Official or organizer-preferred name used for identity matching. */
  canonicalName: string;
  /** Historical names, abbreviations and common bilingual names. */
  aliases: readonly string[];
  /** Explicitly `unknown` when the official page does not identify an organizer. */
  organizer: string;
  officialDomain: string;
  /** Stable composite key: normalized name + organizer + official domain. */
  identityKey: string;
  /** Joins identity data to the recommendation source evidence. */
  evidenceRef: string;
};

export type Competition = {
  id: string;
  identity: CompetitionIdentity;
  name: string;
  category: string;
  direction: CompetitionDirection;
  summary: string;
  sourceUrl: string;
  featured: boolean;
  coverImage: CompetitionCoverImage;
  detail: CompetitionDetail;
  recommendation: CompetitionRecommendationMetadata;
};

export type ThreeStateConstraint<T> =
  | { state: "known"; values: readonly T[] }
  | { state: "unrestricted" }
  | { state: "unknown" };

export type CompetitionTeamRequirement =
  | {
      state: "known";
      mode: "individual" | "team" | "either";
      minSize?: number;
      maxSize?: number;
      /** The official source proves team participation and/or a maximum, but not a numeric lower bound. */
      minimumSizeUnknown?: true;
    }
  | { state: "unrestricted" }
  | { state: "unknown" };

export type CompetitionParticipationMode = "remote" | "offline" | "hybrid" | "unknown";
export type CompetitionScheduleSourceType =
  | "official-competition"
  | "organizer"
  | "education-authority"
  | "unknown";

export type CompetitionMetadataSource = {
  url: string;
  sourceType: CompetitionScheduleSourceType;
  verifiedAt?: string;
  /** Stable pointer that can be surfaced by recommendation explanations. */
  evidenceRef?: string;
  /** Facts supported by this source; never implies that an unknown schedule is known. */
  facts?: readonly (
    | "identity"
    | "stages"
    | "teamRequirement"
    | "eligibility"
    | "schedule"
    | "firstHigherEducationYearCutoff"
    | "requiredResources"
    | "trackEligibility"
    | "teamCommitment"
    | "participationMode"
    | "recentActivity"
  )[];
};

export type CompetitionFirstHigherEducationYearCutoff = {
  state: "verified";
  contestCycle: string;
  /** The first post-secondary study year must be greater than or equal to this value. */
  minimumYear: number;
  alternativeMinimumBirthYear?: number;
  determinationRule: string;
  petitionAvailable?: boolean;
  notes: readonly string[];
  source: CompetitionMetadataSource;
};

export type CompetitionEligibilityMetadata = {
  /** Official specialty restriction; broad questionnaire fields never establish an exact degree. */
  allowedMajorFields?: readonly CompetitionMajorField[];
  /** `verified` means the recorded hard rules came from the official source. */
  state: "verified" | "partial" | "unknown";
  requiresFullTime?: boolean;
  /** Stages for which full-time enrollment is mandatory when official graduate exceptions differ. */
  requiresFullTimeStages?: readonly CompetitionStudentStage[];
  /** The entrant must still be enrolled; `other` remains unresolved rather than hard-ineligible. */
  requiresCurrentEnrollment?: boolean;
  sameInstitutionTeam?: boolean;
  /**
   * Official exception or alternative-route facts that cannot be resolved by
   * the fixed questionnaire. A matching stage remains eligible for scoring,
   * but its qualification snapshot must stay `needs_clarification`.
   */
  stageClarificationNotes?: Partial<Record<CompetitionStudentStage, string>>;
  /** Stage-specific exception facts that matter only for a confirmed part-time enrollment. */
  partTimeStageClarificationNotes?: Partial<Record<CompetitionStudentStage, string>>;
  /**
   * Verified requirements that are not represented by a typed fixed-profile
   * fact. Unlike `notes` (a non-blocking official rule summary), every item
   * here keeps the qualification snapshot at `needs_clarification`.
   */
  blockingClarifications?: readonly string[];
  notes: readonly string[];
  source: CompetitionMetadataSource;
  firstHigherEducationYearCutoff?: CompetitionFirstHigherEducationYearCutoff;
};

export type CompetitionFitMetadata = {
  /** Success-readiness signals are soft fit only and never hard eligibility. */
  signals: readonly CompetitionFitSignal[];
  /**
   * Narrow server-authored axes used when applying a V3 ability preference.
   * Omit when every scoring signal is also an equally representative choice.
   */
  preferenceSignals?: readonly CompetitionFitSignal[];
  startingPoints?: readonly CompetitionStartingPoint[];
  notes?: readonly string[];
};

export type CompetitionTrackMetadata = {
  document?: {title: string; url: string; scope: string};
  /** Editorial task explanation attached to a sourced, named competition track. */
  taskSummary?: string;
  /** Work that cannot be avoided in this role or track; discovery tags are broader. */
  mandatoryTasks?: readonly (CompetitionTaskFormat | "laboratory")[];
  id: string;
  label: string;
  /**
   * False when the "track" is an official fact/eligibility classification
   * rather than a preparation preference. It remains in the qualification
   * snapshot, but can never become a dynamic preference-question option.
   */
  preferenceQuestionEligible?: boolean;
  stages?: ThreeStateConstraint<CompetitionStudentStage>;
  teamRequirement?: CompetitionTeamRequirement;
  /** Track-scoped soft taxonomy used only for fit scoring, never qualification. */
  subjects?: readonly CompetitionSubjectArea[];
  skills?: readonly CompetitionSkill[];
  interests?: readonly CompetitionInterest[];
  preferredOutputs?: readonly CompetitionPreferredOutput[];
  /**
   * Preference-axis signals exposed to the V3 ability comparator. These may
   * be narrower than the track's full scoring taxonomy: a communication track
   * can still require hardware practice while representing the user's
   * `network-systems` choice. Never used for eligibility or base scoring.
   */
  preferenceFitSignals?: readonly CompetitionFitSignal[];
  fitSignals?: readonly CompetitionFitSignal[];
  /** Non-blocking official summary shown as track context. */
  eligibilityNotes?: readonly string[];
  /** Track facts not resolvable from the signed fixed profile. */
  blockingClarifications?: readonly string[];
  /** Typed track-level enrollment and team facts evaluated only from the fixed profile. */
  requiresFullTime?: boolean;
  requiresCurrentEnrollment?: boolean;
  sameInstitutionTeam?: boolean;
  /** Present only when this track's hard metadata is supported by the entry's official source. */
  evidenceRef?: string;
  verifiedFacts?: readonly ("stages" | "teamRequirement" | "eligibility")[];
};

export type CompetitionSchedule = {
  state: "scheduled" | "unknown" | "cancelled";
  edition?: string;
  registrationStart?: string;
  registrationEnd?: string;
  competitionStart?: string;
  competitionEnd?: string;
  datePrecision: "day" | "month" | "unknown";
  verifiedAt?: string;
  sourceUrl: string;
  sourceType: CompetitionScheduleSourceType;
};

export type CompetitionCredibilityCriterion = {
  score: number;
  maxScore: number;
  basis: string;
};

export type CompetitionCredibility = {
  version: "competition-credibility.v1";
  assessedAt: string;
  authority: CompetitionCredibilityCriterion;
  recentActivity: CompetitionCredibilityCriterion;
  nationalOrInternationalCoverage: CompetitionCredibilityCriterion;
  distinctiveness: CompetitionCredibilityCriterion;
  verifiability: CompetitionCredibilityCriterion;
  diversity: CompetitionCredibilityCriterion;
  total: number;
};

export type CompetitionRecommendationMetadata = {
  /** Work that cannot be avoided in this role or track; discovery tags are broader. */
  mandatoryTasks?: readonly (CompetitionTaskFormat | "laboratory")[];
  stages: ThreeStateConstraint<CompetitionStudentStage>;
  regions: ThreeStateConstraint<CompetitionRegion>;
  majors: readonly CompetitionMajorField[];
  skills: readonly CompetitionSkill[];
  /**
   * Optional narrower subset used by the skills/evidence scorer when broad
   * discovery taxonomy is not itself proof of a mother event's task skills.
   */
  skillEvidenceSignals?: readonly CompetitionSkill[];
  interests: readonly CompetitionInterest[];
  subjects?: readonly CompetitionSubjectArea[];
  preferredOutputs: readonly CompetitionPreferredOutput[];
  experienceLevels: readonly CompetitionExperienceLevel[];
  evidence: readonly string[];
  goalValues: Readonly<Record<CompetitionGoal, number>>;
  /**
   * The competition has a specialist task prototype that must be evidenced
   * before a broad subject overlap can clear the quality/calibration gate.
   * This is soft-fit metadata only and never participates in eligibility.
   */
  qualityTaskPrototypeRequired?: boolean;
  difficulty: CompetitionDifficulty;
  weeklyHours: readonly CompetitionWeeklyHours[];
  participationModes: readonly CompetitionParticipationMode[];
  teamRequirement: CompetitionTeamRequirement;
  /** @deprecated Prefer requiredResources/helpfulResources for new metadata. */
  usefulResources: readonly CompetitionResource[];
  requiredResources?: readonly CompetitionResource[];
  helpfulResources?: readonly CompetitionResource[];
  eligibility?: CompetitionEligibilityMetadata;
  fit?: CompetitionFitMetadata;
  tracks?: readonly CompetitionTrackMetadata[];
  source?: CompetitionMetadataSource;
  supportingSources?: readonly CompetitionMetadataSource[];
  schedule: CompetitionSchedule;
  credibility?: CompetitionCredibility;
  dataCompleteness: number;
  dataNotices: readonly string[];
};

export type CompetitionDisplay = Omit<Competition, "recommendation">;

/** Catalog authoring shape; public entries receive normalized identity and a cover at export time. */
export type CompetitionSource = Omit<Competition, "coverImage" | "identity"> & {
  identity?: Omit<CompetitionIdentity, "identityKey"> & { identityKey?: string };
};

export type CompetitionSourceDisplay = Omit<CompetitionSource, "recommendation">;

const competitionDisplayEntries = [
  {
    id: "digital-media-creative-tech",
    name: "全国大学生数字媒体科技作品及创意竞赛",
    category: "数字媒体 / 创意科技",
    direction: "创意与数字",
    summary: "适合数字媒体、交互设计、影像、创意科技方向学生，强调作品导向和展示表达。",
    sourceUrl: "https://www.cmit.cn/html/tongzhigonggao/show-144-45738-1.html",
    featured: true,
    detail: {
      intro:
        "适合数字媒体、交互设计、视觉传达、动画影像、AIGC与创意编程方向学生。赛事侧重“科技+创意”的完整作品，不只看概念，还看选题、用户体验、技术实现、视觉表达与展示叙事；官方通知提到其设有自主命题和指定命题，并鼓励跨专业、跨学校组队。",
      participationPath:
        "参加途径通常是关注数媒竞赛官网和学校创新创业/教务通知，确定赛道后以团队提交作品、说明材料、演示视频等，先走校赛或赛区赛，再冲全国总决赛。备赛建议同步保留作品链接、过程截图、用户调研和迭代记录。",
      userValue:
        "备赛过程可以沉淀一套完整的数字作品与过程档案，并训练选题、用户研究、视觉表达、技术实现和公开展示能力。最终认定与奖励以官方评审及学校政策为准。",
      suitableFor: ["数字媒体、交互或视觉设计方向学生", "具备影像、AIGC或创意编程基础的团队", "希望完成一件可演示数字作品的参赛者"],
      preparationTips: ["先核对自主命题与指定命题的当届规则", "同步准备作品、说明材料和演示视频", "保留调研、分工与每轮迭代记录"]
    }
  },
  {
    id: "future-aircraft-design",
    name: "“创新杯”第十二届全国未来飞行器设计大赛",
    category: "航空航天 / 工程设计",
    direction: "工程与制造",
    summary: "适合航空、机械、工程、控制、材料等方向，重点关注飞行器方案和工程论证。",
    sourceUrl: "https://csaa.org.cn/c/2026-03-23/641581.shtml",
    featured: true,
    detail: {
      intro:
        "适合航空航天、机械、能源动力、控制、材料、工业设计等学生。2026届主题聚焦可重复使用空天飞机，要求围绕构型、动力、气动、热防护、导航制导控制、回收与商业场景做系统论证；它不是单纯画概念图，而是训练“需求-方案-参数-风险-成本”的工程闭环。",
      participationPath:
        "参加途径一般是按所在省市分赛区通知报名，个人或团队均可，作品提交电子版设计图、三视图、内部布局图和文字报告，最终经分赛区推荐进入全国评审。备赛时要提前明确队内分工：总体、气动、结构、控制、仿真和报告各有人负责。",
      userValue:
        "赛事把飞行器总体、气动、动力、结构与控制知识放进同一套方案论证中，适合训练跨专业协作、参数取舍和工程可行性表达。",
      suitableFor: ["航空航天、机械、控制或材料方向学生", "有建模、仿真或工程论证基础的团队", "能获得教师或实验条件支持的参赛者"],
      preparationTips: ["先以当届主题和提交清单确定设计边界", "明确总体、气动、结构、控制与报告分工", "让关键参数、假设和风险都有可追溯依据"]
    }
  },
  {
    id: "vocational-innovation-entrepreneurship",
    name: "第九届中华职业教育创新创业大赛",
    category: "创新创业 / 职业教育",
    direction: "创新创业",
    summary: "适合职教、创新创业、项目实践类团队，强调项目计划、路演和成果转化。",
    sourceUrl:
      "https://zhzjcxcy.com/#/infoDetail?websiteResourceId=1277955422018088960&lightIndex=0&newsId=1277688119686832128&newsTypeId=658611382660186112&newsType=5&currentPage=1&pageSize=10&moduleType=6",
    featured: false,
    detail: {
      intro:
        "适合高职、本科层次职业教育、应用技术型本科和中职团队，尤其适合把专业技能做成可展示、可路演、可转化项目的学生。第九届具身智能赛道包含四足机器人远程操控、人形机器人任务挑战、四足机器人道路识别、机器人与无人机协作等赛项，强调真实设备、真实任务和现场操作。",
      participationPath:
        "参加途径通常是先看省级中华职业教育社或学校创新创业学院通知，由学校推荐团队报名；具身智能赛道多为3名选手、1-2名指导教师，按省级推荐进入全国决赛。备赛要准备设备调试记录、任务演示视频、路演PPT和故障处理方案。",
      userValue:
        "参赛能把专业技能放进真实设备任务中检验，并训练现场调试、团队协作、故障处理和路演说明。具体组别与认定范围需以省级和全国通知为准。",
      suitableFor: ["职业院校与应用技术型本科学生", "具备机器人、无人机或机电设备条件的团队", "希望用真实任务检验操作与调试能力的参赛者"],
      preparationTips: ["先确认所在层次、赛道与学校推荐要求", "提前完成设备联调并记录常见故障", "准备演示视频、路演材料与现场应急方案"]
    }
  },
  {
    id: "iot-design",
    name: "全国大学生物联网设计竞赛",
    category: "物联网 / 工程实践",
    direction: "人工智能与物联",
    summary: "适合 IoT、嵌入式、传感器、硬件原型方向，突出场景、设备和方案落地。",
    sourceUrl: "https://iot.sjtu.edu.cn/show.aspx?info_lb=36&info_id=6061&flag=2",
    featured: true,
    detail: {
      intro:
        "适合IoT、嵌入式、通信、传感器、自动化、软硬件系统集成方向学生。赛事以促进物联网等新一代信息技术相关专业建设和人才培养为目标，往届参赛高校、团队和企业支持规模都较大。它更看重“场景是否真、设备是否通、数据是否跑得起来”。",
      participationPath:
        "参加途径是关注竞赛官网和学校教务/学院通知，通常以团队注册、选赛区、提交方案、代码、硬件原型和演示材料，经过分赛区再进入全国阶段。备赛建议选择真实痛点场景，如智慧农业、工业监测、低功耗终端、边缘计算或校园物联应用。",
      userValue:
        "从传感采集、设备通信到平台展示的完整闭环，有助于训练硬件选型、协议实现、系统联调与现场演示。作品也可继续迭代为课程或毕业设计。",
      suitableFor: ["物联网、嵌入式、通信或自动化方向学生", "能够覆盖硬件、软件与展示环节的团队", "已有真实应用场景或实验条件的参赛者"],
      preparationTips: ["先核对当届赛题、企业命题与器件要求", "尽早跑通传感、通信和平台的最小闭环", "预留联调、断网与设备故障的测试时间"]
    }
  },
  {
    id: "youth-tech-challenge",
    name: "2026年度中国青年科技创新“揭榜挂帅”擂台赛",
    category: "科技创新 / 揭榜攻关",
    direction: "人工智能与物联",
    summary: "适合围绕真实问题做技术攻关的团队，突出命题制、揭榜制和成果导向。",
    sourceUrl: "https://it.ouc.edu.cn/2026/0527/c21608a529602/page.htm",
    featured: true,
    detail: {
      intro:
        "适合已经有技术积累、实验数据或原型成果的团队。它依托“挑战杯”体系，用真实榜题牵引青年做科研攻关，2026年聚焦新一代信息技术、人工智能、新能源、新材料、高端装备、机器人、生物医药、种业科技和海洋科技等前沿领域，核心是对准问题提交可验证方案。",
      participationPath:
        "参加途径是通过“挑战杯”相关平台或学校团委/学院通知申报学生赛道，可个人或团队参赛，团队人数和指导教师按通知限制，先完成报名，再围绕榜题攻关、初审、终审擂台答辩。建议优先选择自己已有论文、专利、实验平台或导师资源支撑的榜题。",
      userValue:
        "围绕真实榜题开展攻关，能系统训练问题拆解、技术路线设计、实验验证和阶段答辩。奖金、实践机会等权益须以具体榜题通知为准。",
      suitableFor: ["已有技术积累、实验数据或原型成果的团队", "有导师、实验室或产业资源支持的学生", "愿意围绕明确榜题持续验证方案的参赛者"],
      preparationTips: ["优先选择与现有研究条件匹配的榜题", "逐项核对资格、知识产权与成果要求", "用可复现实验和量化指标支撑答辩结论"]
    }
  },
  {
    id: "career-planning",
    name: "全国大学生职业规划大赛",
    category: "职业规划 / 成长发展",
    direction: "商业与职业",
    summary: "覆盖各专业与年级，帮助梳理职业目标、成长路径、简历证据、求职能力与现场表达。",
    sourceUrl: "https://www.moe.gov.cn/srcsite/A15/s7063/202510/t20251021_1417550.html",
    featured: false,
    detail: {
      intro:
        "覆盖各专业与年级，适合需要梳理职业方向、成长路径和个人实践的学生。第三届大赛面向学生设置成长赛道和就业赛道：成长赛道关注职业目标、持续行动和能力提升；就业赛道关注岗位认知、简历证据、能力匹配和求职表达。",
      participationPath:
        "参加途径通常是通过全国大学生职业规划大赛平台报名，由学校组织校赛，再进入省赛和全国总决赛；材料包括职业目标、行动计划、支撑经历、就业能力证明、展示PPT等。准备时要把课程、竞赛、实习、项目统一到一个明确目标岗位或升学方向上。",
      userValue:
        "准备过程会促使参赛者把职业目标、简历、行动与阶段结果组织成清晰逻辑，并通过展示与问答检验对专业、岗位和职业环境的理解。",
      suitableFor: ["正在探索职业方向的各年级学生", "已有阶段行动但缺少系统复盘的参赛者", "希望训练公开表达与现场问答能力的学生"],
      preparationTips: ["先按当届规则选择成长或就业赛道", "让职业目标、行动记录和能力证据相互对应", "围绕关键选择与变化准备可核验的回答"]
    }
  },
  {
    id: "low-altitude-industry",
    name: "第二届低空产业创新大赛",
    category: "低空经济 / 产业创新",
    direction: "工程与制造",
    summary: "适合低空经济、无人机、产业方案、商业场景设计方向，重视产业理解和方案表达。",
    sourceUrl: "https://www.cannews.com.cn/dikongjingji/2026/04-09/Zr5y3O6r.html",
    featured: false,
    detail: {
      intro:
        "适合无人机、航空、通信、导航、控制、人工智能、农业科技、城市治理和商业方案方向学生。赛事以“智驭低空，创联世界”为主题，围绕低空产业的政、端、网、云、用五大要素设置学生组“启航赛道”和专业组“领航赛道”，鼓励解决真实产业场景问题。",
      participationPath:
        "参加途径是进入大赛官网注册报名并提交项目，作品形式包括PPT、商业计划书、现场路演、赛事答辩和可选实机演示，入围后在南京等赛场展示。可选场景包括低空监视、反制、巡田监测、机载气象观测、物流配送、应急救援或城市治理。",
      userValue:
        "赛事要求从具体低空场景出发，综合考虑飞行平台、通信感知、运行规则和商业可行性，适合训练跨学科系统方案能力。",
      suitableFor: ["无人机、航空、通信、控制或人工智能方向学生", "关注城市治理、农业或应急等低空场景的团队", "能够完成方案展示或实机验证的参赛者"],
      preparationTips: ["先确认学生组资格和当届场景要求", "选定一个边界清晰、用户明确的应用问题", "在方案中说明安全、合规与落地条件"]
    }
  },
  {
    id: "ican-innovation-entrepreneurship",
    name: "iCAN大学生创新创业大赛",
    category: "创新创业 / 综合实践",
    direction: "创新创业",
    summary: "适合跨学科创新创业项目，突出团队、原型、商业验证和路演能力。",
    sourceUrl: "https://g-ican.com/home/index",
    featured: false,
    detail: {
      intro:
        "适合有原型、有创意产品或想把技术变成商业项目的跨学科团队。iCAN强调原创创新和创业实践，常见赛道包括创新、创业、挑战类项目，既适合传感器、智能硬件、AI应用、信息系统，也适合有明确用户痛点的产品服务方案。",
      participationPath:
        "参加途径是关注iCAN官网和学校通知，按所在赛区组队报名，准备项目说明书、商业计划书、演示视频、答辩PPT和原创性材料，通常经历校内、区域、全国多级选拔。备赛重点是把技术原型、用户场景、商业模式和团队分工讲成一个完整故事。",
      userValue:
        "从问题识别到原型和路演的过程，能够训练用户验证、产品设计、技术实现、团队协作与商业判断。项目成熟度仍以实际验证结果为准。",
      suitableFor: ["有原创产品、技术原型或服务方案的团队", "能够跨技术、设计与商业分工的学生", "希望验证校园创意实际需求的参赛者"],
      preparationTips: ["先核对赛区、赛道和原创性材料要求", "用真实访谈或测试说明用户问题", "让原型、商业假设和团队分工彼此一致"]
    }
  },
  {
    id: "graduate-rural-revitalization-agritech",
    name: "中国研究生乡村振兴科技强农+创新大赛第五届科技作品竞赛",
    category: "农业科技 / 乡村振兴",
    direction: "学术科研",
    summary: "面向在读硕博及获得推免资格的应届本科生，聚焦科技强农、农业农村现代化与乡村全面振兴。",
    sourceUrl: "https://cpipc.acge.org.cn/cw/hp/2c90800c7a132603017a1395f2c105f9",
    featured: true,
    detail: {
      intro:
        "适合农林、生命科学、农业资源与环境、智慧农业、农业工程、农林经济管理及AI+农业方向。当届作品分为科技发明制作、自然科学和社会科学三类，要求围绕农业农村现代化形成可核验的研究或科技作品。",
      participationPath:
        "参赛学生在中国研究生创新实践系列大赛官网注册并完善信息，由所在研究生培养单位完成资格审核后在官网提交作品。初赛采用线上评审，入围作品参加现场答辩；申报前需确认学籍、推免证明、校内审核及作品学术诚信要求。",
      userValue:
        "备赛过程会把农业问题、研究证据、技术实现、单位审核与现场答辩串成完整链路，适合沉淀论文、发明制作、调研报告或农业数字化原型。",
      suitableFor: ["中国境内正式注册的在读硕士、博士研究生", "已获得推免资格并可提供证明的应届本科毕业生", "具备农业科研、技术原型或乡村调研证据的项目"],
      preparationTips: ["先请培养单位确认推荐、审核和官网提交流程", "按科技发明制作、自然科学或社会科学选择作品类别", "保留原始数据、实验或调研记录及学术诚信审核材料"]
    }
  },
  {
    id: "green-development",
    name: "第二届中国青年绿色发展创新大赛",
    category: "绿色发展 / 可持续创新",
    direction: "创新创业",
    summary: "适合低碳、环保、绿色技术、公益创新方向，关注可持续议题和社会价值。",
    sourceUrl: "https://main.yeeol.com/cybs_home.html?id=42",
    featured: false,
    detail: {
      intro:
        "适合关注双碳、环保、能源、材料、循环经济、农业协同、公益养老和可持续商业的学生团队。赛事以绿色发展创新创业项目为核心，关注能源绿色低碳转型、生物基化学品和材料绿色智造、二氧化碳综合利用、资源循环利用、多污染物协同治理等产业命题。",
      participationPath:
        "参加途径是关注中国青年创业就业基金会或大赛官方页面，按创新组、创业组、公益组、行业命题组等方向提交项目材料，团队人数和指导教师按通知执行，经过初赛、半决赛、决赛路演答辩。准备时要突出减排逻辑、社会价值、商业可行性和落地资源。",
      userValue:
        "准备绿色项目需要同时说明环境效益、社会需求、技术路径与实施成本，可训练跨学科调研、影响评估和项目表达能力。",
      suitableFor: ["能源、材料、环境或可持续发展方向学生", "关注公益、社区与绿色商业问题的团队", "具备调研数据或试点场景的参赛者"],
      preparationTips: ["先按项目成熟度选择创新、创业或公益组", "用清晰口径量化环境与社会影响", "同时说明技术可行性、成本和落地资源"]
    }
  },
  {
    id: "xuechuangbei-business-simulation",
    name: "第十三届“学创杯”全国大学生创业综合模拟演训活动",
    category: "商业模拟 / 创业演训",
    direction: "商业与职业",
    summary: "适合经管、商科、创新创业课程团队，强调商业模拟、经营决策和复盘。",
    sourceUrl: "http://www.bster.cn/cyds/article/detail_view?id=2082",
    featured: false,
    detail: {
      intro:
        "适合经管、商科、财会、金融、市场营销以及想系统训练商业决策的学生。它定位为国家级创业模拟演训，常见赛项包括创业综合模拟、数字营销模拟和财务决策模拟，通过软件平台模拟企业研发、生产、采购、销售、财务和营销竞争。",
      participationPath:
        "参加途径一般是学院或创新创业中心组织校赛报名，常见团队为3人，经过校内选拔后参加省赛和国赛；备赛重点不是背概念，而是理解指标、分工决策、复盘经营逻辑。建议提前固定角色，如CEO、营销、财务或运营，并形成每轮决策复盘表。",
      userValue:
        "模拟经营让团队在统一规则下反复检验市场、运营和财务决策，并通过指标变化复盘协作质量。平台版本和计分规则以当届通知为准。",
      suitableFor: ["经管、财会、金融或市场营销方向学生", "希望从模拟经营入门商业竞赛的团队", "能够稳定分工并持续复盘决策的参赛者"],
      preparationTips: ["先通过学校确认报名、平台和团队规则", "固定经营、营销与财务等核心角色", "记录每轮输入、结果与调整依据"]
    }
  },
  {
    id: "business-elite-innovation",
    name: "全国高校商业精英挑战赛",
    category: "商业实践 / 会展营销",
    direction: "商业与职业",
    summary: "覆盖商业、会展、营销、贸易等专项，训练商业策划、谈判、品牌与展示表达。",
    sourceUrl: "https://www.ccpitcsc.org/eduxq/4857",
    featured: false,
    detail: {
      intro:
        "全国高校商业精英挑战赛是覆盖商业、会展、营销、贸易等多个专项的赛事体系，适合商科、经管、国际贸易、市场营销、数据分析及跨专业团队。创新创业竞赛是其中一个专项，2026年设置创业计划、流通业经营模拟、营销模拟决策、创业研究专题、数据智能体应用等赛道。",
      participationPath:
        "参加途径是先根据学校、赛区与赛事组织方通知确认具体专项，再按对应规则完成知识赛、校赛或院校报名，准备商业计划书、案例分析、研究报告、谈判方案、品牌方案或路演材料。不同专项的队伍人数、赛程和提交物不同，不能沿用单一专项规则。",
      userValue:
        "不同专项分别训练商业研究、经营决策、会展策划、品牌营销、贸易谈判、计划书撰写或数据工具应用。参赛者可以按已有能力选择方向，不必同时覆盖所有专项。",
      suitableFor: ["商科、经管、国际贸易或数据分析方向学生", "有商业案例、创业计划或数据应用想法的团队", "能够完成调研、写作与路演协作的参赛者"],
      preparationTips: ["先确认当届具体专项及其知识赛或校内选拔要求", "让行业数据、访谈结论与商业判断可追溯", "按对应专项的正式时长演练报告与现场问答"]
    }
  },
  {
    id: "mechanical-innovation-design",
    name: "第十二届全国大学生机械创新设计大赛",
    category: "机械创新 / 设计制造",
    direction: "工程与制造",
    summary: "适合机械、自动化、产品结构、工程设计方向，突出结构、原型和制造。",
    sourceUrl: "https://umic.moocollege.com/home/newsContain/detail?newsId=102880",
    featured: true,
    detail: {
      intro:
        "适合机械、自动化、机电、材料、工业设计、智能制造等工科学生，是典型的“设计-制造-调试-展示”型竞赛。第十二届常规赛主题为“灵巧·智能，美好生活”，内容包括特定水产品初加工机械、叶菜洁净化处理包装一体化机械、高性能仿生蝴蝶等。",
      participationPath:
        "参加途径通常由学校组织推荐报名，学生小组参赛，每队人数和指导教师有限制，经过校赛、省赛或区域赛后进入全国决赛。备赛要尽早完成需求分析、机构方案、CAD建模、样机加工、运动验证和答辩材料，避免只停留在概念图阶段。",
      userValue:
        "从机构设计到样机调试的完整过程，能够检验机械原理、制造工艺、控制联调和实验验证能力，并留下可复查的工程记录。",
      suitableFor: ["机械、自动化、材料或工业设计方向学生", "能够使用实验室与加工设备的团队", "愿意反复制造、测试和优化样机的参赛者"],
      preparationTips: ["先核对当届主题、组队和作品尺寸要求", "按方案、建模、加工、联调设置明确里程碑", "记录可靠性、安全性与关键失败测试"]
    }
  },
  {
    id: "3d-digital-innovation-design",
    name: "全国三维数字化创新设计大赛",
    category: "三维数字化 / 工业设计",
    direction: "创意与数字",
    summary: "适合 3D 建模、数字孪生、工业设计、三维可视化方向，强调模型与表达能力。",
    sourceUrl: "https://3dds.3ddl.net/index.php?ctl=Informationlist&met=newsdetails&id=714",
    featured: false,
    detail: {
      intro:
        "适合数字工业设计、三维建模、BIM、智能制造、数字文旅、XR、游戏动画、元宇宙空间和AI+3D方向学生。2026第19届主题强调“Ai3D数实融合 全民共创”，开放赛项常覆盖数字工业设计、数字人居设计、数字文化设计、元宇宙创建等方向。",
      participationPath:
        "参加途径是关注3D大赛官网和学校创新创业/教务通知，注册账号、组建团队、按赛项提交三维模型、作品链接、设计说明、演示视频和报名表，经过校内选拔、复赛、总决赛。备赛时要同时准备源文件、渲染图、交互演示和设计逻辑说明。",
      userValue:
        "赛事成果通常由模型、渲染、交互演示与设计说明共同构成，可系统训练三维表达、数字化工具协作和方案讲解。",
      suitableFor: ["三维建模、BIM、工业设计或XR方向学生", "兼具设计表达与数字工具能力的团队", "希望完成一套可公开展示三维成果的参赛者"],
      preparationTips: ["先按工具能力选择具体赛项与提交格式", "同步保存源文件、渲染图、演示视频与说明", "提前检查素材授权、版本兼容和文件命名"]
    }
  }
] satisfies CompetitionSourceDisplay[];

const allStudentStages: readonly CompetitionStudentStage[] = [
  "vocational",
  "undergraduate-1",
  "undergraduate-2",
  "undergraduate-3",
  "undergraduate-4",
  "master",
  "doctorate"
];

const baseGoalValues: Record<CompetitionGoal, number> = {
  project: 0.6,
  award: 0.55,
  postgraduate: 0.5,
  employment: 0.55,
  portfolio: 0.45,
  entrepreneurship: 0.35,
  networking: 0.35
};

function goals(overrides: Partial<Record<CompetitionGoal, number>>): Record<CompetitionGoal, number> {
  return { ...baseGoalValues, ...overrides };
}

function unknownSchedule(sourceUrl: string, edition?: string): CompetitionSchedule {
  return {
    state: "unknown",
    edition,
    datePrecision: "unknown",
    verifiedAt: "2026-08-02",
    sourceUrl,
    sourceType: "unknown"
  };
}

const recommendationProfiles = {
  "digital-media-creative-tech": {
    stages: { state: "known", values: allStudentStages },
    regions: { state: "unrestricted" },
    majors: ["design", "computer-science", "humanities"],
    skills: ["design", "programming", "product", "presentation"],
    interests: ["media", "design", "innovation"],
    preferredOutputs: ["creative-work", "prototype", "presentation"],
    experienceLevels: ["none", "participated", "project-or-award"],
    evidence: ["project", "prototype", "portfolio"],
    goalValues: goals({ project: 0.9, award: 0.75, portfolio: 1, employment: 0.75, postgraduate: 0.7 }),
    difficulty: "challenge",
    weeklyHours: ["5-10", "over-10"],
    participationModes: ["hybrid"],
    teamRequirement: { state: "known", mode: "team", maxSize: 5 },
    usefulResources: ["mentor", "lab", "equipment"],
    schedule: unknownSchedule("https://www.cmit.cn/html/tongzhigonggao/show-144-45738-1.html", "2025（第十三届）"),
    dataCompleteness: 0.82,
    dataNotices: ["当前届次报名日期尚未核验，请以赛事官网最新通知为准。"]
  },
  "future-aircraft-design": {
    stages: { state: "unknown" },
    regions: { state: "unknown" },
    majors: ["engineering", "design", "computer-science"],
    skills: ["research", "design", "hardware", "data-analysis"],
    interests: ["engineering", "design", "innovation"],
    preferredOutputs: ["prototype", "research-paper", "presentation"],
    experienceLevels: ["participated", "project-or-award"],
    evidence: ["project", "paper", "prototype"],
    goalValues: goals({ project: 0.95, award: 0.85, postgraduate: 0.9, employment: 0.8, portfolio: 0.7 }),
    difficulty: "challenge",
    weeklyHours: ["over-10"],
    participationModes: ["unknown"],
    teamRequirement: { state: "known", mode: "either" },
    usefulResources: ["mentor", "lab", "equipment", "data"],
    schedule: unknownSchedule("https://csaa.org.cn/c/2026-03-23/641581.shtml", "2026（第十二届）"),
    dataCompleteness: 0.62,
    dataNotices: ["参赛资格、组队要求和当前报名日期需要在官方通知中再次确认。"]
  },
  "vocational-innovation-entrepreneurship": {
    stages: { state: "unknown" },
    regions: { state: "unknown" },
    majors: ["engineering", "computer-science", "business"],
    skills: ["hardware", "programming", "product", "presentation"],
    interests: ["robotics", "entrepreneurship", "engineering", "innovation"],
    preferredOutputs: ["prototype", "business-plan", "presentation"],
    experienceLevels: ["none", "participated", "project-or-award"],
    evidence: ["project", "prototype"],
    goalValues: goals({ project: 0.9, award: 0.8, employment: 0.85, entrepreneurship: 0.85, networking: 0.7 }),
    difficulty: "challenge",
    weeklyHours: ["5-10", "over-10"],
    participationModes: ["unknown"],
    teamRequirement: { state: "unknown" },
    usefulResources: ["mentor", "lab", "equipment"],
    schedule: unknownSchedule(
      "https://zhzjcxcy.com/#/infoDetail?websiteResourceId=1277955422018088960&lightIndex=0&newsId=1277688119686832128&newsTypeId=658611382660186112&newsType=5&currentPage=1&pageSize=10&moduleType=6",
      "第九届"
    ),
    dataCompleteness: 0.58,
    dataNotices: ["赛事面向不同职教层次，具体组别资格和当前赛程尚待官方核验。"]
  },
  "iot-design": {
    stages: { state: "unknown" },
    regions: { state: "unrestricted" },
    majors: ["computer-science", "engineering"],
    skills: ["programming", "hardware", "data-analysis", "product"],
    interests: ["engineering", "robotics", "data", "innovation"],
    preferredOutputs: ["prototype", "software", "presentation"],
    experienceLevels: ["participated", "project-or-award"],
    evidence: ["project", "prototype"],
    goalValues: goals({ project: 1, award: 0.85, postgraduate: 0.8, employment: 0.95, portfolio: 0.75 }),
    difficulty: "challenge",
    weeklyHours: ["over-10"],
    participationModes: ["hybrid"],
    teamRequirement: { state: "unknown" },
    usefulResources: ["mentor", "lab", "equipment", "data", "budget"],
    schedule: unknownSchedule("https://iot.sjtu.edu.cn/show.aspx?info_lb=36&info_id=6061&flag=2", "2026"),
    dataCompleteness: 0.7,
    dataNotices: ["官方通知以图片/PDF发布；报名截止日期和团队人数未作为结构化事实录入。"]
  },
  "youth-tech-challenge": {
    stages: { state: "unknown" },
    regions: { state: "unknown" },
    majors: ["computer-science", "engineering", "medicine", "mathematics"],
    skills: ["research", "programming", "data-analysis", "hardware", "presentation"],
    interests: ["innovation", "ai", "engineering", "robotics"],
    preferredOutputs: ["prototype", "research-paper", "software", "presentation"],
    experienceLevels: ["project-or-award"],
    evidence: ["project", "paper", "prototype", "award"],
    goalValues: goals({ project: 0.9, award: 1, postgraduate: 1, employment: 0.8, networking: 0.8 }),
    difficulty: "challenge",
    weeklyHours: ["over-10"],
    participationModes: ["unknown"],
    teamRequirement: { state: "unknown" },
    tracks: [{
      id: "student-track",
      label: "学生赛道",
      preferenceQuestionEligible: false,
      stages: { state: "known", values: allStudentStages },
      teamRequirement: { state: "known", mode: "either", minSize: 1, maxSize: 10 },
      eligibilityNotes: ["面向全国高校学生，可个人或不超过10人团队围绕当届榜题揭榜攻关。"],
      blockingClarifications: ["学生赛道由高校学生身份事实决定，不是备赛偏好。"]
    }],
    usefulResources: ["mentor", "lab", "equipment", "data", "budget"],
    schedule: unknownSchedule("https://it.ouc.edu.cn/2026/0527/c21608a529602/page.htm", "2026年度"),
    dataCompleteness: 0.58,
    dataNotices: ["展示来源为高校通知而非赛事官方页面，资格与赛程均按未知处理。"]
  },
  "career-planning": {
    stages: { state: "known", values: allStudentStages },
    regions: { state: "unrestricted" },
    majors: ["computer-science", "business", "design", "engineering", "medicine", "mathematics", "humanities", "other"],
    skills: ["writing", "presentation", "research"],
    interests: ["career"],
    preferredOutputs: ["career-plan", "presentation"],
    experienceLevels: ["none", "participated", "project-or-award"],
    evidence: ["project", "portfolio", "award"],
    goalValues: goals({ employment: 1, postgraduate: 0.7, project: 0.65, networking: 0.8 }),
    difficulty: "balanced",
    weeklyHours: ["under-5", "5-10"],
    participationModes: ["hybrid"],
    teamRequirement: { state: "known", mode: "individual", minSize: 1, maxSize: 1 },
    usefulResources: ["mentor"],
    requiredResources: [],
    helpfulResources: ["mentor"],
    eligibility: {
      state: "verified",
      notes: [
        "成长赛道主要面向本、专科非毕业年级学生；就业赛道面向本、专科高年级计划求职学生和研究生。",
        "往届全国总决赛金、银奖选手不得再报原赛道。"
      ],
      source: {
        url: "https://www.moe.gov.cn/srcsite/A15/s7063/202510/t20251021_1417550.html",
        sourceType: "education-authority",
        verifiedAt: "2026-08-22",
        evidenceRef: "official:career-planning:2026-08-22",
        facts: ["stages", "teamRequirement", "eligibility", "trackEligibility"]
      }
    },
    fit: {
      signals: ["career-evidence"],
      notes: ["赛道选择由年级、是否计划求职、行动证据和就业材料共同决定。"]
    },
    tracks: [
      {
        id: "growth",
        label: "成长赛道",
        preferenceQuestionEligible: false,
        stages: {
          state: "known",
          values: [
            "vocational",
            "undergraduate-1",
            "undergraduate-2",
            "undergraduate-3",
            "undergraduate-4"
          ]
        },
        preferredOutputs: ["career-plan", "presentation"],
        fitSignals: ["career-evidence"],
        eligibilityNotes: ["主要面向本、专科非毕业年级学生；赛道由学段和毕业年级事实决定。"],
        blockingClarifications: ["是否为非毕业年级尚不能由通用学段字段确认。"],
        evidenceRef: "official:career-planning:2026-08-22",
        verifiedFacts: ["stages", "eligibility"]
      },
      {
        id: "employment",
        label: "就业赛道",
        preferenceQuestionEligible: false,
        stages: {
          state: "known",
          values: allStudentStages
        },
        preferredOutputs: ["career-plan", "presentation"],
        fitSignals: ["career-evidence"],
        eligibilityNotes: [
          "面向本、专科高年级计划求职学生和研究生，不含已通过推免等确定升学的毕业年级学生；赛道由学段与求职状态事实决定。"
        ],
        blockingClarifications: ["高年级求职计划及是否已确定升学尚未由固定问卷确认。"],
        evidenceRef: "official:career-planning:2026-08-22",
        verifiedFacts: ["stages", "eligibility"]
      }
    ],
    source: {
      url: "https://www.moe.gov.cn/srcsite/A15/s7063/202510/t20251021_1417550.html",
      sourceType: "education-authority",
      verifiedAt: "2026-08-22",
      evidenceRef: "official:career-planning:2026-08-22",
      facts: ["stages", "teamRequirement", "eligibility", "trackEligibility"]
    },
    schedule: {
      state: "scheduled",
      edition: "第三届（2025-2026）",
      registrationStart: "2025-10-20",
      registrationEnd: "2026-01-31",
      competitionStart: "2025-10-20",
      competitionEnd: "2026-04-25",
      datePrecision: "day",
      verifiedAt: "2026-08-22",
      sourceUrl: "https://www.moe.gov.cn/srcsite/A15/s7063/202510/t20251021_1417550.html",
      sourceType: "education-authority"
    },
    dataCompleteness: 0.96,
    dataNotices: ["第三届已于2026年4月25日结束；下一届报名安排尚未公布。"]
  },
  "low-altitude-industry": {
    stages: { state: "unknown" },
    regions: { state: "unknown" },
    majors: ["engineering", "computer-science", "business", "design"],
    skills: ["hardware", "programming", "data-analysis", "product", "presentation"],
    interests: ["engineering", "robotics", "entrepreneurship", "innovation"],
    preferredOutputs: ["prototype", "business-plan", "presentation"],
    experienceLevels: ["participated", "project-or-award"],
    evidence: ["project", "prototype"],
    goalValues: goals({ project: 0.9, employment: 0.9, entrepreneurship: 0.85, networking: 0.8, award: 0.7 }),
    difficulty: "challenge",
    weeklyHours: ["over-10"],
    participationModes: ["unknown"],
    teamRequirement: { state: "unknown" },
    tracks: [{
      id: "student-launch",
      label: "启航赛道（学生组）",
      preferenceQuestionEligible: false,
      stages: { state: "known", values: allStudentStages },
      teamRequirement: { state: "known", mode: "either" },
      eligibilityNotes: ["面向高等院校全日制在校生，可由团队或个人申报技术创新项目。"],
      blockingClarifications: ["学生启航赛道由全日制在校身份事实决定，不是备赛偏好。"]
    }],
    usefulResources: ["mentor", "lab", "equipment", "data", "budget"],
    schedule: unknownSchedule("https://www.cannews.com.cn/dikongjingji/2026/04-09/Zr5y3O6r.html", "第二届（2026）"),
    dataCompleteness: 0.56,
    dataNotices: ["当前来源并非赛事报名官网，报名状态、资格和团队要求按未知处理。"]
  },
  "ican-innovation-entrepreneurship": {
    stages: { state: "unknown" },
    regions: { state: "unrestricted" },
    majors: ["computer-science", "business", "design", "engineering", "other"],
    skills: ["product", "programming", "hardware", "design", "presentation"],
    interests: ["entrepreneurship", "innovation", "engineering"],
    preferredOutputs: ["prototype", "business-plan", "presentation"],
    experienceLevels: ["none", "participated", "project-or-award"],
    evidence: ["project", "prototype"],
    goalValues: goals({ project: 0.95, entrepreneurship: 1, employment: 0.85, networking: 0.85, portfolio: 0.75 }),
    difficulty: "challenge",
    weeklyHours: ["5-10", "over-10"],
    participationModes: ["unknown"],
    teamRequirement: { state: "unknown" },
    usefulResources: ["mentor", "lab", "equipment", "budget"],
    schedule: unknownSchedule("https://g-ican.com/home/index", "2026"),
    dataCompleteness: 0.65,
    dataNotices: ["官网为动态页面，当前届次日期和团队规则未完成结构化核验。"]
  },
  "graduate-rural-revitalization-agritech": {
    stages: { state: "known", values: ["undergraduate-4", "master", "doctorate"] },
    regions: { state: "unrestricted" },
    majors: ["agriculture-environment", "biology-life-science", "engineering", "computer-science", "public-management", "business", "medicine", "chemistry-materials"],
    skills: ["research", "laboratory", "fieldwork", "data-analysis", "programming", "hardware", "policy-analysis", "writing", "presentation"],
    interests: ["agriculture-environment", "biology-life-science", "ai", "data", "academic-research", "engineering", "public-management", "innovation"],
    subjects: ["agriculture-equipment", "biology-life-science", "water-environment", "public-management"],
    preferredOutputs: ["research-paper", "prototype", "software", "presentation"],
    experienceLevels: ["participated", "project-or-award"],
    evidence: ["project", "paper", "prototype"],
    goalValues: goals({ project: 1, award: 0.9, postgraduate: 1, employment: 0.75, portfolio: 0.75, networking: 0.85 }),
    difficulty: "challenge",
    weeklyHours: ["5-10", "over-10"],
    participationModes: ["hybrid"],
    teamRequirement: { state: "known", mode: "either" },
    usefulResources: ["mentor", "school-registration", "lab", "equipment", "data", "budget"],
    requiredResources: ["mentor", "school-registration"],
    helpfulResources: ["lab", "equipment", "data", "budget"],
    eligibility: {
      state: "verified",
      sameInstitutionTeam: true,
      blockingClarifications: [
        "当届具体赛道的队伍人数上下限尚待官方附件确认。"
      ],
      notes: [
        "参赛人员应为2026年10月1日前在中国正式注册的在读硕士、博士研究生（含留学生），或已获得免试推荐研究生资格的应届本科毕业生。",
        "由参赛学生所在研究生培养单位进行资格审核后在官网提交；集体作品不支持跨校组队。",
        "目录不写入队伍人数上下限，报名前应以当届正式附件和培养单位审核口径复核。"
      ],
      source: {
        url: "https://cpipc.acge.org.cn/cw/contestNews/detail/2c90800c7a132603017a1395f2c105f9/2c9080179dcfa227019dfb1e0e3e1e24?page=0",
        sourceType: "official-competition",
        verifiedAt: "2026-08-23",
        evidenceRef: "official:graduate-rural-revitalization-agritech:invitation:2026-08-23",
        facts: ["stages", "teamRequirement", "eligibility", "schedule", "requiredResources", "trackEligibility", "participationMode", "recentActivity"]
      }
    },
    fit: {
      signals: ["research-provenance", "field-research", "hardware-build", "software-engineering", "sustainability-impact"],
      startingPoints: ["prototype", "validated"],
      notes: ["优先匹配已有实验、田野调研、农业工程原型或AI+农业成果的参赛者。"]
    },
    tracks: [
      {
        id: "technology-invention",
        label: "科技发明制作类",
        preferredOutputs: ["prototype", "software", "presentation"],
        fitSignals: ["hardware-build", "software-engineering", "product-validation"]
      },
      {
        id: "natural-science",
        label: "自然科学类",
        preferredOutputs: ["research-paper", "presentation"],
        fitSignals: ["research-provenance", "field-research"]
      },
      {
        id: "social-science",
        label: "社会科学类",
        preferredOutputs: ["research-paper", "presentation"],
        fitSignals: ["field-research", "sustainability-impact"]
      }
    ],
    source: {
      url: "https://cpipc.acge.org.cn/cw/hp/2c90800c7a132603017a1395f2c105f9",
      sourceType: "official-competition",
      verifiedAt: "2026-08-23",
      evidenceRef: "official:graduate-rural-revitalization-agritech:2026-08-23",
      facts: ["identity", "stages", "eligibility", "schedule", "participationMode", "recentActivity"]
    },
    supportingSources: [
      {
        url: "https://cpipc.acge.org.cn/cw/contestNews/detail/2c90800c7a132603017a1395f2c105f9/2c9080179dcfa227019dfb1e0e3e1e24?page=0",
        sourceType: "official-competition",
        verifiedAt: "2026-08-23",
        evidenceRef: "official:graduate-rural-revitalization-agritech:invitation:2026-08-23",
        facts: ["stages", "teamRequirement", "eligibility", "schedule", "requiredResources", "trackEligibility", "participationMode", "recentActivity"]
      }
    ],
    schedule: {
      state: "scheduled",
      edition: "2026（第五届科技作品竞赛）",
      registrationStart: "2026-05-19",
      registrationEnd: "2026-08-24",
      competitionStart: "2026-09-01",
      competitionEnd: "2026-10-17",
      datePrecision: "day",
      verifiedAt: "2026-08-23",
      sourceUrl: "https://cpipc.acge.org.cn/cw/hp/2c90800c7a132603017a1395f2c105f9",
      sourceType: "official-competition"
    },
    dataCompleteness: 0.97,
    dataNotices: [
      "官网报名期为2026年5月19日至8月24日，资格审查和作品提交均至8月31日截止。",
      "参赛人数不作为目录硬过滤条件，以当届正式附件为准。",
      "培养单位资格审核与官网提交属于报名流程，请按所在单位通知办理。"
    ]
  },
  "green-development": {
    stages: { state: "unknown" },
    regions: { state: "unknown" },
    majors: ["engineering", "business", "medicine", "humanities", "other"],
    skills: ["research", "data-analysis", "product", "writing", "presentation"],
    interests: ["innovation", "entrepreneurship", "engineering"],
    preferredOutputs: ["business-plan", "research-paper", "prototype", "presentation"],
    experienceLevels: ["none", "participated", "project-or-award"],
    evidence: ["project", "paper", "prototype"],
    goalValues: goals({ project: 0.85, entrepreneurship: 0.9, networking: 0.8, postgraduate: 0.75, employment: 0.75 }),
    difficulty: "balanced",
    weeklyHours: ["5-10", "over-10"],
    participationModes: ["unknown"],
    teamRequirement: { state: "unknown" },
    usefulResources: ["mentor", "data", "budget"],
    schedule: unknownSchedule("https://main.yeeol.com/cybs_home.html?id=42", "第二届（2026）"),
    dataCompleteness: 0.58,
    dataNotices: ["报名平台未提供可核验的结构化赛程，日期和资格按未知处理。"]
  },
  "xuechuangbei-business-simulation": {
    stages: { state: "unknown" },
    regions: { state: "unknown" },
    majors: ["business", "mathematics", "computer-science"],
    skills: ["accounting-finance", "data-analysis", "product", "presentation"],
    interests: ["entrepreneurship", "data"],
    preferredOutputs: ["business-plan", "presentation"],
    experienceLevels: ["none", "participated", "project-or-award"],
    evidence: ["project", "award"],
    goalValues: goals({ award: 0.85, employment: 0.9, project: 0.75, networking: 0.75 }),
    difficulty: "starter",
    weeklyHours: ["under-5", "5-10"],
    participationModes: ["remote", "hybrid"],
    teamRequirement: { state: "unknown" },
    usefulResources: ["mentor"],
    schedule: unknownSchedule("http://www.bster.cn/cyds/article/detail_view?id=2082", "第十三届（2026）"),
    dataCompleteness: 0.62,
    dataNotices: ["报名日期和具体赛道团队规则尚待活动官网再次核验。"]
  },
  "business-elite-innovation": {
    stages: { state: "known", values: allStudentStages },
    regions: { state: "unrestricted" },
    majors: ["business", "computer-science", "mathematics", "humanities", "other"],
    skills: ["data-analysis", "product", "research", "writing", "presentation", "design"],
    interests: ["entrepreneurship", "data", "innovation"],
    preferredOutputs: ["business-plan", "research-paper", "presentation"],
    experienceLevels: ["none", "participated", "project-or-award"],
    evidence: ["project", "paper"],
    goalValues: goals({ award: 0.85, employment: 0.95, entrepreneurship: 0.9, networking: 0.85, project: 0.8 }),
    difficulty: "challenge",
    weeklyHours: ["5-10", "over-10"],
    participationModes: ["unknown"],
    teamRequirement: { state: "known", mode: "either" },
    usefulResources: ["mentor", "data"],
    schedule: unknownSchedule("https://www.ccpitcsc.org/eduxq/4857"),
    dataCompleteness: 0.72,
    dataNotices: ["指南显示该赛事体系以团队赛为主，也包含不同形式；各专项的队伍人数、参赛方式和赛程需分别核验。"]
  },
  "mechanical-innovation-design": {
    stages: { state: "unknown" },
    regions: { state: "unknown" },
    majors: ["engineering", "design"],
    skills: ["design", "hardware", "research", "presentation"],
    interests: ["engineering", "robotics", "design", "innovation"],
    preferredOutputs: ["prototype", "presentation"],
    experienceLevels: ["participated", "project-or-award"],
    evidence: ["project", "prototype"],
    goalValues: goals({ project: 1, award: 0.9, postgraduate: 0.85, employment: 0.9, portfolio: 0.8 }),
    difficulty: "challenge",
    weeklyHours: ["over-10"],
    participationModes: ["offline"],
    teamRequirement: { state: "unknown" },
    usefulResources: ["mentor", "lab", "equipment", "budget"],
    schedule: unknownSchedule("https://umic.moocollege.com/home/newsContain/detail?newsId=102880", "2026（第十二届）"),
    dataCompleteness: 0.64,
    dataNotices: ["当前结构化目录未确认报名截止日期和参赛团队人数。"]
  },
  "3d-digital-innovation-design": {
    stages: { state: "unknown" },
    regions: { state: "unknown" },
    majors: ["design", "engineering", "computer-science"],
    skills: ["design", "product", "hardware", "presentation"],
    interests: ["design", "media", "engineering", "ai"],
    preferredOutputs: ["creative-work", "prototype", "presentation"],
    experienceLevels: ["none", "participated", "project-or-award"],
    evidence: ["project", "portfolio", "prototype"],
    goalValues: goals({ portfolio: 1, project: 0.95, employment: 0.85, award: 0.8, postgraduate: 0.7 }),
    difficulty: "challenge",
    weeklyHours: ["5-10", "over-10"],
    participationModes: ["hybrid"],
    teamRequirement: { state: "unknown" },
    usefulResources: ["mentor", "lab", "equipment"],
    schedule: unknownSchedule("https://3dds.3ddl.net/index.php?ctl=Informationlist&met=newsdetails&id=714", "2026（第十九届）"),
    dataCompleteness: 0.66,
    dataNotices: ["报名日期、组队要求和线下安排需要在赛事官网最新通知中确认。"]
  }
} satisfies Record<(typeof competitionDisplayEntries)[number]["id"], CompetitionRecommendationMetadata>;

const existingCompetitions: CompetitionSource[] = competitionDisplayEntries.map((competition) => ({
  ...competition,
  recommendation: recommendationProfiles[competition.id as keyof typeof recommendationProfiles]
}));

const combinedCompetitionsById = new Map(
  [...existingCompetitions, ...guideCompetitions, ...expansionCompetitions].map((competition) => [competition.id, competition])
);
const guideCatalogIds = new Set(competitionGuideTrace.map((trace) => trace.catalogId));

/**
 * Soft-fit inferences derived from each event's work format. They intentionally
 * live outside eligibility/source metadata and must never be used as entry rules.
 */
const competitionFitSignalInferences = {
  "digital-media-creative-tech": ["design-portfolio"],
  "future-aircraft-design": ["design-portfolio", "research-provenance"],
  "vocational-innovation-entrepreneurship": ["venture-readiness"],
  "iot-design": ["hardware-build"],
  "youth-tech-challenge": ["research-provenance"],
  "career-planning": ["career-evidence"],
  "low-altitude-industry": ["product-validation"],
  "ican-innovation-entrepreneurship": ["venture-readiness"],
  "graduate-rural-revitalization-agritech": ["research-provenance", "field-research", "sustainability-impact"],
  "green-development": ["sustainability-impact"],
  "xuechuangbei-business-simulation": ["finance-operations"],
  "business-elite-innovation": ["finance-operations"],
  "mechanical-innovation-design": ["design-portfolio"],
  "3d-digital-innovation-design": ["design-portfolio"],
  "china-international-college-innovation": ["venture-readiness"],
  "challenge-cup-academic-science": ["research-provenance", "field-research"],
  "national-college-math-modeling": ["modeling-intensive"],
  "challenge-cup-entrepreneurship-plan": ["venture-readiness"],
  "national-college-electronic-design": ["hardware-build"],
  "icpc-programming": ["algorithm-competition"],
  "market-research-analysis": ["field-research", "modeling-intensive"],
  "understanding-contemporary-china-foreign-language": ["language-communication"],
  "energy-conservation-emission-reduction": ["sustainability-impact"],
  "ecommerce-innovation-creativity-entrepreneurship": ["venture-readiness"],
  "smart-car": ["robotics-integration", "hardware-build"],
  "china-college-computer-design": ["software-engineering", "design-portfolio"],
  "china-software-cup": ["software-engineering"],
  "information-security": ["algorithm-competition"],
  "integrated-circuit-innovation": ["hardware-build"],
  "advanced-graphics-bim": ["design-portfolio"],
  "national-college-industrial-design": ["design-portfolio"],
  "future-designer-ncda": ["design-portfolio"],
  "energy-economics-academic-creativity": ["modeling-intensive", "sustainability-impact"],
  "national-college-logistics-design": ["finance-operations"],
  "china-college-computer-contest": ["network-systems"],
  robocon: ["robotics-integration"],
  "robocup-china": ["robotics-integration"],
  "siemens-intelligent-manufacturing": ["robotics-integration"],
  "lanqiao-cup": ["algorithm-competition"],
  "21st-century-english-speaking": ["language-communication"],
  "icbc-fintech-innovation": ["finance-operations"]
} as const satisfies Record<string, readonly CompetitionFitSignal[]>;

/**
 * Organizer-backed identity overrides for the original 41 entries. Keeping
 * identity separate from display copy lets historical names remain searchable
 * without changing the visible catalog titles.
 */
const competitionIdentityOverrides = {
  "digital-media-creative-tech": { organizer: "全国大学生数字媒体科技作品及创意竞赛组委会", aliases: ["全国大学生数媒竞赛"] },
  "future-aircraft-design": { organizer: "中国航空学会", aliases: ["创新杯全国未来飞行器设计大赛"] },
  "vocational-innovation-entrepreneurship": { organizer: "中华职业教育社", aliases: ["中华职教双创赛"] },
  "iot-design": { organizer: "全国大学生物联网设计竞赛组委会", aliases: ["全国大学生物联网设计竞赛"] },
  "youth-tech-challenge": { organizer: "中国青年科技创新‘揭榜挂帅’擂台赛组委会", aliases: ["青年科技创新揭榜挂帅擂台赛"] },
  "career-planning": { organizer: "中华人民共和国教育部", aliases: ["全国大学生职业规划大赛"] },
  "low-altitude-industry": { organizer: "低空产业创新大赛组委会", aliases: ["低空产业创新大赛"] },
  "ican-innovation-entrepreneurship": { organizer: "iCAN大学生创新创业大赛组委会", aliases: ["iCAN大赛"] },
  "graduate-rural-revitalization-agritech": {
    organizer: "中国学位与研究生教育学会",
    aliases: ["中国研究生乡村振兴科技强农+创新大赛", "全国农林院校研究生科技作品竞赛", "科技强农大赛科技作品竞赛"]
  },
  "green-development": { organizer: "全国大学生绿色发展与未来创新大赛组委会", aliases: [] },
  "xuechuangbei-business-simulation": { organizer: "全国大学生创业综合模拟大赛组委会", aliases: ["学创杯"] },
  "business-elite-innovation": { organizer: "中国国际贸易促进委员会商业行业委员会", aliases: ["全国高校商业精英挑战赛"] },
  "mechanical-innovation-design": { organizer: "全国大学生机械创新设计大赛组委会", aliases: ["全国大学生机械创新设计大赛"] },
  "3d-digital-innovation-design": { organizer: "全国三维数字化创新设计大赛组委会", aliases: ["全国3D大赛"] },
  "china-international-college-innovation": { organizer: "中华人民共和国教育部", aliases: ["中国国际大学生创新大赛", "互联网+大学生创新创业大赛"] },
  "challenge-cup-academic-science": { organizer: "共青团中央、中国科协、教育部、中国社会科学院、全国学联", aliases: ["挑战杯课外学术科技作品竞赛", "大挑"] },
  "national-college-math-modeling": { organizer: "中国工业与应用数学学会", aliases: ["全国大学生数学建模竞赛", "CUMCM"] },
  "challenge-cup-entrepreneurship-plan": { organizer: "共青团中央、教育部、中国科协、全国学联", aliases: ["挑战杯创业计划竞赛", "小挑"] },
  "national-college-electronic-design": { organizer: "全国大学生电子设计竞赛组委会", aliases: ["全国大学生电子设计竞赛"] },
  "icpc-programming": { organizer: "ICPC Foundation", aliases: ["ICPC", "国际大学生程序设计竞赛"] },
  "market-research-analysis": { organizer: "中国商业统计学会", aliases: ["正大杯市场调查与分析大赛", "市调大赛"] },
  "understanding-contemporary-china-foreign-language": { organizer: "外语教学与研究出版社", aliases: ["外研社·国才杯", "理解当代中国全国大学生外语能力大赛"] },
  "energy-conservation-emission-reduction": { organizer: "全国大学生节能减排社会实践与科技竞赛委员会", aliases: ["节能减排大赛"] },
  "ecommerce-innovation-creativity-entrepreneurship": { organizer: "全国大学生电子商务创新、创意及创业挑战赛竞赛组织委员会", aliases: ["三创赛"] },
  "smart-car": { organizer: "全国大学生智能汽车竞赛组织委员会", aliases: ["全国大学生智能汽车竞赛"] },
  "china-college-computer-design": { organizer: "中国大学生计算机设计大赛组织委员会", aliases: ["中国大学生计算机设计大赛"] },
  "china-software-cup": { organizer: "工业和信息化部、教育部、江苏省人民政府", aliases: ["中国软件杯"] },
  "information-security": { organizer: "全国大学生信息安全竞赛组委会", aliases: ["全国大学生信息安全竞赛"] },
  "integrated-circuit-innovation": { organizer: "工业和信息化部人才交流中心", aliases: ["集创赛"] },
  "advanced-graphics-bim": { organizer: "全国大学生先进成图技术与产品信息建模创新大赛组委会", aliases: ["全国大学生先进成图技术大赛"] },
  "national-college-industrial-design": { organizer: "全国大学生工业设计大赛组委会", aliases: ["NCDA工业设计大赛"] },
  "future-designer-ncda": { organizer: "未来设计师·全国高校数字艺术设计大赛组委会", aliases: ["未来设计师NCDA"] },
  "energy-economics-academic-creativity": { organizer: "全国大学生能源经济学术创意大赛组委会", aliases: ["能源经济学术创意大赛"] },
  "national-college-logistics-design": { organizer: "教育部高等学校物流管理与工程类专业教学指导委员会", aliases: ["全国大学生物流设计大赛"] },
  "china-college-computer-contest": { organizer: "全国高等学校计算机教育研究会", aliases: ["中国高校计算机大赛", "C4"] },
  robocon: { organizer: "全国大学生机器人大赛组委会", aliases: ["ROBOCON", "全国大学生机器人大赛ROBOCON"] },
  "robocup-china": { organizer: "中国自动化学会", aliases: ["RoboCup机器人世界杯中国赛"] },
  "siemens-intelligent-manufacturing": { organizer: "教育部高等学校自动化类专业教学指导委员会、西门子（中国）有限公司", aliases: ["西门子杯"] },
  "lanqiao-cup": { organizer: "工业和信息化部人才交流中心", aliases: ["蓝桥杯"] },
  "21st-century-english-speaking": { organizer: "中国日报社", aliases: ["21世纪杯全国英语演讲比赛", "21st Century Cup"] },
  "icbc-fintech-innovation": { organizer: "中国工商银行", aliases: ["工行杯"] }
} as const satisfies Record<string, { organizer: string; aliases: readonly string[] }>;

const LEGACY_CATALOG_VERIFIED_AT = "2026-08-23";

type LegacyCompetitionEvidenceOverride = {
  sourceUrl: string;
  sourceType?: Exclude<CompetitionScheduleSourceType, "unknown">;
  /** `null` means the source could not be re-opened during this review. */
  verifiedAt?: string | null;
  /** Facts explicitly supported by sourceUrl. Omitted facts stay unknown. */
  facts: readonly NonNullable<CompetitionMetadataSource["facts"]>[number][];
  stages: ThreeStateConstraint<CompetitionStudentStage>;
  subjects: readonly CompetitionSubjectArea[];
  /**
   * Evidence-scoring signals for mother events whose broad subject taxonomy
   * is valid for discovery but does not prove every track uses every skill.
   * This is recommendation metadata only and never participates in eligibility.
   */
  skillEvidenceSignals?: readonly CompetitionSkill[];
  teamRequirement: CompetitionTeamRequirement;
  participationModes: readonly CompetitionParticipationMode[];
  eligibilityState: CompetitionEligibilityMetadata["state"];
  eligibilityNotes: readonly string[];
  stageClarificationNotes?: CompetitionEligibilityMetadata["stageClarificationNotes"];
  blockingClarifications?: CompetitionEligibilityMetadata["blockingClarifications"];
  dataNotices?: readonly string[];
  sameInstitutionTeam?: boolean;
  firstHigherEducationYearCutoff?: Omit<CompetitionFirstHigherEducationYearCutoff, "source">;
  dataCompleteness: number;
};

const legacyStageSets = {
  vocational: { state: "known", values: ["vocational"] },
  undergraduate: {
    state: "known",
    values: ["undergraduate-1", "undergraduate-2", "undergraduate-3", "undergraduate-4"]
  },
  vocationalAndUndergraduate: {
    state: "known",
    values: ["vocational", "undergraduate-1", "undergraduate-2", "undergraduate-3", "undergraduate-4"]
  },
  academicHigherEducation: {
    state: "known",
    values: ["undergraduate-1", "undergraduate-2", "undergraduate-3", "undergraduate-4", "master", "doctorate"]
  },
  allHigherEducation: { state: "known", values: allStudentStages },
  openYouth: { state: "unrestricted" }
} as const satisfies Record<string, ThreeStateConstraint<CompetitionStudentStage>>;

/**
 * Evidence review for the 41 pre-expansion entries. Sources are current official
 * competition, organizer or competent-authority pages checked on 2026-08-23.
 * Dates intentionally remain unknown below when the source does not expose one
 * precise, catalog-wide window; track-specific and regional dates are not merged.
 */
const legacyCompetitionEvidenceOverrides = {
  "digital-media-creative-tech": {
    sourceUrl: "https://www.cmit.cn/html/tongzhigonggao/show-144-45738-1.html",
    facts: ["identity", "stages", "teamRequirement", "eligibility", "recentActivity"],
    stages: legacyStageSets.allHigherEducation,
    subjects: ["visual-communication", "information-communication"],
    teamRequirement: { state: "known", mode: "team", maxSize: 5 },
    participationModes: ["unknown"], eligibilityState: "partial",
    eligibilityNotes: ["2025官方通知列明高职、本科、研究生等高校在校生组别，并明确团队不超过5人；各赛道细则仍需单独复核。"], dataCompleteness: 0.92
  },
  "future-aircraft-design": {
    sourceUrl: "https://csaa.org.cn/c/2026-03-23/641581.shtml", sourceType: "organizer",
    facts: ["identity", "stages", "teamRequirement", "eligibility", "recentActivity"],
    stages: legacyStageSets.academicHigherEducation,
    subjects: ["engineering-practice", "robotics-automation"],
    teamRequirement: { state: "known", mode: "either" }, participationModes: ["unknown"],
    eligibilityState: "partial", eligibilityNotes: ["2026中国航空学会通知确认本届青年赛事及个人/团队报名形态；细分组别以附件为准。"], dataCompleteness: 0.82
  },
  "vocational-innovation-entrepreneurship": {
    sourceUrl: "https://zhzjcxcy.com/#/infoDetail?websiteResourceId=1277955422018088960&lightIndex=0&newsId=1277688119686832128&newsTypeId=658611382660186112&newsType=5&currentPage=1&pageSize=10&moduleType=6",
    facts: ["identity", "stages", "teamRequirement", "eligibility"],
    stages: legacyStageSets.vocational, subjects: ["vocational-skills", "public-management"],
    teamRequirement: { state: "known", mode: "team" }, participationModes: ["unknown"],
    eligibilityState: "partial", eligibilityNotes: ["中华职业教育创新创业大赛官方站通知确认职业教育组别及项目团队参赛路径。"],
    dataNotices: ["未取得可独立核对日期的近24个月活动证据。"], dataCompleteness: 0.8
  },
  "iot-design": {
    sourceUrl: "https://iot.sjtu.edu.cn/ueditor/net/upload/file/20260326/6391013243710844328303068.pdf",
    facts: ["identity", "stages", "teamRequirement", "eligibility", "recentActivity"],
    stages: legacyStageSets.vocationalAndUndergraduate,
    subjects: ["information-communication", "robotics-automation"],
    teamRequirement: { state: "known", mode: "team", maxSize: 4 }, participationModes: ["unknown"],
    eligibilityState: "partial", eligibilityNotes: ["2026官方章程覆盖本科与高职组，确认团队参赛且每队不超过4名学生；其他硬资格仍按赛题细则复核。"], dataCompleteness: 0.9
  },
  "youth-tech-challenge": {
    sourceUrl: "https://www.tiaozhanbei.net/article/15836/",
    facts: ["identity", "trackEligibility", "recentActivity"],
    stages: { state: "unknown" }, subjects: ["engineering-practice", "public-management"],
    teamRequirement: { state: "unknown" }, participationModes: ["unknown"],
    eligibilityState: "unknown", eligibilityNotes: ["2026官方通知将参赛对象分为学生赛道与青年科技人才赛道，母赛不使用统一学段资格；学生赛道的硬条件按代表赛道建模。"], dataCompleteness: 0.72
  },
  "career-planning": {
    sourceUrl: "https://www.moe.gov.cn/srcsite/A15/s7063/202510/t20251021_1417550.html", sourceType: "education-authority",
    facts: ["identity", "stages", "teamRequirement", "eligibility", "trackEligibility", "recentActivity"],
    stages: legacyStageSets.allHigherEducation, subjects: ["public-management", "vocational-skills"],
    teamRequirement: { state: "known", mode: "individual", minSize: 1, maxSize: 1 }, participationModes: ["unknown"],
    eligibilityState: "partial", eligibilityNotes: ["教育部2025当届通知确认高教、职教学生赛道与个人参赛身份；校级、省级和全国赛的具体资格仍需按学校与赛道通知执行。"], dataCompleteness: 0.9
  },
  "low-altitude-industry": {
    sourceUrl: "https://cxcy.usst.edu.cn/2026/0403/c16859a359193/page.psp", sourceType: "education-authority",
    facts: ["identity", "trackEligibility", "recentActivity"],
    stages: { state: "unknown" }, subjects: ["engineering-practice", "robotics-automation"],
    teamRequirement: { state: "unknown" }, participationModes: ["unknown"],
    eligibilityState: "unknown", eligibilityNotes: ["2026当届设面向高校在校生的启航赛道和面向院校、科研院所及从业者的领航赛道，母赛不固化统一学段或队伍人数。"], dataCompleteness: 0.72
  },
  "ican-innovation-entrepreneurship": {
    sourceUrl: "https://g-ican.com/home/index",
    facts: ["identity", "stages", "teamRequirement", "eligibility"],
    stages: legacyStageSets.allHigherEducation, subjects: ["engineering-practice", "information-communication"],
    teamRequirement: { state: "known", mode: "team" }, participationModes: ["unknown"],
    eligibilityState: "partial", eligibilityNotes: ["iCAN官方站当届入口确认高校学生项目团队赛制；各专项赛学段与人数可不同。"], dataCompleteness: 0.82
  },
  "green-development": {
    sourceUrl: "https://main.yeeol.com/cybs_home.html?id=42", sourceType: "organizer",
    facts: ["identity", "stages", "teamRequirement", "eligibility", "participationMode", "recentActivity"],
    stages: { state: "unrestricted" }, subjects: ["water-environment", "public-management"],
    teamRequirement: { state: "known", mode: "either", minSize: 1, maxSize: 8 }, participationModes: ["hybrid"],
    eligibilityState: "verified",
    eligibilityNotes: ["2026第二届官方报名入口及当届通知确认，参赛者为40周岁及以下中国公民，可个人或团队申报，团队总人数不超过8人；初赛为材料评审，半决赛和决赛为线下路演答辩。"],
    blockingClarifications: ["40周岁及以下的年龄条件与中国公民身份尚未由固定问卷确认。"],
    dataCompleteness: 0.9
  },
  "xuechuangbei-business-simulation": {
    sourceUrl: "https://www.bster.cn/cyds/article/detail_view?id=2082",
    facts: ["identity", "stages", "teamRequirement", "eligibility"],
    stages: legacyStageSets.allHigherEducation, subjects: ["finance-accounting", "public-management"],
    teamRequirement: { state: "known", mode: "team" }, participationModes: ["unknown"],
    eligibilityState: "partial", eligibilityNotes: ["学创杯官方当届页面确认高校学生团队以创业模拟平台和项目材料参赛；人数按赛道通知复核。"], dataCompleteness: 0.82
  },
  "business-elite-innovation": {
    sourceUrl: "https://www.ccpitcsc.org/eduxq/4857", sourceType: "organizer",
    facts: ["identity", "stages", "teamRequirement", "eligibility"],
    stages: legacyStageSets.allHigherEducation, subjects: ["finance-accounting", "public-management"],
    teamRequirement: { state: "known", mode: "either" }, participationModes: ["unknown"],
    eligibilityState: "partial", eligibilityNotes: ["贸促会商业行业委员会当届通知确认高校组别，不同专业赛可采个人或团队形式。"], dataCompleteness: 0.84
  },
  "mechanical-innovation-design": {
    sourceUrl: "https://umic.moocollege.com/home/newsContain/detail?newsId=102880",
    facts: ["identity", "stages", "teamRequirement", "eligibility"],
    stages: legacyStageSets.undergraduate, subjects: ["engineering-practice", "robotics-automation"],
    teamRequirement: { state: "known", mode: "team" }, participationModes: ["unknown"],
    eligibilityState: "partial", eligibilityNotes: ["第十二届官方通知确认本科生项目团队和校赛/省赛/全国赛路径；人数按届次参赛办法复核。"],
    dataNotices: ["该页未作为近24个月活动证据。"], dataCompleteness: 0.84
  },
  "3d-digital-innovation-design": {
    sourceUrl: "https://3dds.3ddl.net/index.php?ctl=Informationlist&met=newsdetails&id=714",
    facts: ["identity", "stages", "teamRequirement", "eligibility", "recentActivity"],
    stages: legacyStageSets.allHigherEducation, subjects: ["visual-communication", "digital-construction"],
    teamRequirement: { state: "known", mode: "either" }, participationModes: ["unknown"],
    eligibilityState: "partial", eligibilityNotes: ["2026全国3D大赛官方页确认高校与职业院校组别，赛项可个人或团队参与；具体人数随赛项变化。"], dataCompleteness: 0.84
  },
  "china-international-college-innovation": {
    sourceUrl: "https://www.moe.gov.cn/srcsite/A08/s5672/202607/t20260731_1445670.html", sourceType: "education-authority",
    facts: ["identity", "stages", "teamRequirement", "eligibility", "trackEligibility", "recentActivity"],
    stages: legacyStageSets.allHigherEducation, subjects: ["engineering-practice", "public-management"],
    teamRequirement: { state: "known", mode: "team" }, participationModes: ["unknown"],
    eligibilityState: "partial", eligibilityNotes: ["2026教育部通知确认高教主赛道、职教赛道与产业命题赛道的学生团队参赛路径；各赛道资格边界以附件为准。"],
    blockingClarifications: ["成员年龄与项目往届获奖、重复报赛情形尚未由固定问卷确认。"], dataCompleteness: 0.9
  },
  "challenge-cup-academic-science": {
    sourceUrl: "https://www.tiaozhanbei.net/rules",
    facts: ["identity", "stages", "teamRequirement", "eligibility", "trackEligibility"],
    stages: legacyStageSets.academicHigherEducation, subjects: ["engineering-practice", "public-management"],
    teamRequirement: { state: "known", mode: "either" }, participationModes: ["unknown"],
    eligibilityState: "verified", eligibilityNotes: ["挑战杯官方章程确认全日制高校学生申报个人或集体作品，资格与作品分类按章程执行。"],
    blockingClarifications: ["作品是否属禁止申报的课程、学位论文或教师成果包装尚未确认。"],
    stageClarificationNotes: {
      doctorate: "博士阶段仅有硕博连读或直博生未通过博士资格考试等章程替代通道时，才可按硕士生学历申报；当前固定问卷无法确认该事实。"
    },
    dataCompleteness: 0.92
  },
  "national-college-math-modeling": {
    sourceUrl: "https://www.mcm.edu.cn/upload_cn/node/779/D3txF20S95f4041e22b41b4a1f9e0e22ac8a1389.pdf",
    facts: ["identity", "teamRequirement", "eligibility", "trackEligibility"],
    stages: legacyStageSets.vocationalAndUndergraduate, subjects: ["statistics-mathematics"],
    teamRequirement: { state: "known", mode: "either", minSize: 1, maxSize: 3 }, participationModes: ["unknown"],
    eligibilityState: "verified", eligibilityNotes: ["全国组委会2026第一次通知明确同一学校1至3名大学生组队；本科组面向所有大学生，高职高专学生也可自愿参加本科组。"],
    blockingClarifications: ["赛区人数执行口径（部分赛区要求3人）尚未确认。"],
    dataNotices: ["学校统一报名属于报名流程，请按所在赛区和学校通知办理。"],
    dataCompleteness: 0.94
  },
  "challenge-cup-entrepreneurship-plan": {
    sourceUrl: "https://www.tiaozhanbei.net/rules2",
    facts: ["identity", "stages", "teamRequirement", "eligibility", "trackEligibility"],
    stages: legacyStageSets.allHigherEducation, subjects: ["finance-accounting", "public-management"],
    teamRequirement: { state: "known", mode: "team" }, participationModes: ["unknown"],
    eligibilityState: "partial", eligibilityNotes: ["挑战杯创业计划竞赛官方章程确认高校学生项目团队申报及校、省、全国赛递进路径；届次与组别附加条件仍需当届通知。"],
    blockingClarifications: ["项目权利授权、核心团队及当届组别事实尚未确认。"], dataCompleteness: 0.86
  },
  "national-college-electronic-design": {
    sourceUrl: "https://www.nuedc-training.com.cn/index/news/details/new_id/333",
    facts: ["identity", "stages", "teamRequirement", "eligibility", "trackEligibility", "participationMode"],
    stages: legacyStageSets.undergraduate, subjects: ["information-communication", "engineering-practice"],
    teamRequirement: { state: "known", mode: "team", minSize: 3, maxSize: 3 }, participationModes: ["offline"],
    eligibilityState: "verified", eligibilityNotes: ["全国大学生电子设计竞赛官方通知确认本科学生三人一队，在所在赛区集中完成作品。"], dataCompleteness: 0.94
  },
  "icpc-programming": {
    sourceUrl: "https://icpc.global/regionals/rules/",
    facts: ["identity", "stages", "teamRequirement", "eligibility", "firstHigherEducationYearCutoff", "participationMode"],
    stages: legacyStageSets.academicHigherEducation, subjects: ["information-communication"],
    teamRequirement: { state: "known", mode: "team", minSize: 3, maxSize: 3 }, participationModes: ["offline"],
    eligibilityState: "verified", eligibilityNotes: ["ICPC 2026/27官方区域赛规则确认高校学生资格、每队3名且全员须注册于同一学位授予机构，以及首次接受高等教育年份/出生年份二选一的资格通道。"],
    blockingClarifications: ["教练注册与往届ICPC区域赛、世界决赛参赛次数尚未确认。"],
    sameInstitutionTeam: true,
    firstHigherEducationYearCutoff: {
      state: "verified", contestCycle: "2026/27", minimumYear: 2022,
      alternativeMinimumBirthYear: 2003,
      determinationRule: "以首场资格赛日期判定；若首场资格赛晚于2026-10-01且该日更有利于选手，则以2026-10-01判定。",
      petitionAvailable: true,
      notes: ["符合基本要求且首次接受高等教育于2022年或之后，或出生于2003年或之后，可满足年限通道；中断或延长学业者可由教练申请延长资格。"]
    },
    dataCompleteness: 0.97
  },
  "market-research-analysis": {
    sourceUrl: "https://www.china-cssc.org/show-568-1912-1.html", sourceType: "organizer",
    facts: ["identity", "stages", "teamRequirement", "eligibility", "participationMode", "recentActivity"],
    stages: legacyStageSets.allHigherEducation, subjects: ["statistics-mathematics", "finance-accounting"],
    teamRequirement: { state: "known", mode: "team", minSize: 3, maxSize: 5 }, participationModes: ["hybrid"],
    eligibilityState: "partial", sameInstitutionTeam: true, eligibilityNotes: ["中国商业统计学会2025/2026当届通知确认全日制专科、本科、研究生及在华留学生组；实践赛3–5人且同校组队，含在线知识赛与现场总决赛。"],
    blockingClarifications: ["队员同学历层次与专科、本科选手个人知识网考结果尚未确认。"], dataCompleteness: 0.93
  },
  "understanding-contemporary-china-foreign-language": {
    sourceUrl: "https://ucc.fltrp.com/c/2026-04-15/517928.shtml", sourceType: "organizer",
    facts: ["identity", "stages", "teamRequirement", "eligibility", "trackEligibility", "recentActivity"],
    stages: legacyStageSets.allHigherEducation, subjects: ["language-culture"],
    teamRequirement: { state: "known", mode: "either", minSize: 1, maxSize: 5 }, participationModes: ["unknown"],
    eligibilityState: "partial", eligibilityNotes: ["2026外研社·国才杯官方通知确认多学段高校学生赛道，个人赛项与团队赛项并存；具体赛项资格按当届细则。"],
    blockingClarifications: ["往届同语种同赛项国赛获奖情况与具体赛项资格尚未确认。"], dataCompleteness: 0.88
  },
  "energy-conservation-emission-reduction": {
    sourceUrl: "https://jienengjianpai.org/col.jsp?id=161",
    facts: ["identity", "stages", "teamRequirement", "eligibility"],
    stages: legacyStageSets.academicHigherEducation, subjects: ["water-environment", "engineering-practice"],
    teamRequirement: { state: "known", mode: "team" }, participationModes: ["unknown"],
    eligibilityState: "partial", eligibilityNotes: ["2025修订的官方章程确认高校学生团队申报科技作品或社会实践调查报告；届次资格仍按当届通知。"], dataCompleteness: 0.86
  },
  "ecommerce-innovation-creativity-entrepreneurship": {
    sourceUrl: "https://www.3chuang.net/",
    facts: ["identity", "stages", "teamRequirement", "eligibility"],
    // The mother event accepts technical team members, but its verified task
    // is e-commerce venture planning rather than a generic ICT/hardware task.
    // Preserve the authored subject coverage while preventing that broad ICT
    // tag from becoming universal programming/hardware evidence.
    stages: legacyStageSets.allHigherEducation, subjects: ["finance-accounting", "information-communication"],
    skillEvidenceSignals: ["accounting-finance", "data-analysis", "research", "product", "design", "presentation"],
    teamRequirement: { state: "known", mode: "team" }, participationModes: ["unknown"],
    eligibilityState: "partial", eligibilityNotes: ["三创赛官方入口确认高校学生团队报名与校赛、省赛、全国总决赛路径。"],
    dataNotices: ["未取得可独立核对日期的近24个月活动证据。"], dataCompleteness: 0.84
  },
  "smart-car": {
    sourceUrl: "https://www.smartcar.zone/",
    facts: ["identity", "stages", "teamRequirement", "eligibility", "participationMode"],
    stages: legacyStageSets.undergraduate, subjects: ["robotics-automation", "engineering-practice"],
    teamRequirement: { state: "known", mode: "team" }, participationModes: ["offline"],
    eligibilityState: "partial", eligibilityNotes: ["智能汽车竞赛官方站确认本科生车模团队和分赛区/全国赛线下竞速路径；各组别人数按年度规则复核。"], dataCompleteness: 0.86
  },
  "china-college-computer-design": {
    sourceUrl: "https://jsjds.com.cn/",
    facts: ["identity", "stages", "teamRequirement", "eligibility"],
    stages: legacyStageSets.allHigherEducation, subjects: ["information-communication", "visual-communication"],
    teamRequirement: { state: "known", mode: "team" }, participationModes: ["unknown"],
    eligibilityState: "partial", eligibilityNotes: ["中国大学生计算机设计大赛官网确认高校学生作品团队和省级赛/国赛路径；人数与学段依大类细则。"], dataCompleteness: 0.84
  },
  "china-software-cup": {
    sourceUrl: "https://www.cnsoftbei.com/",
    facts: ["identity", "stages", "teamRequirement", "eligibility"],
    stages: legacyStageSets.allHigherEducation, subjects: ["information-communication"],
    teamRequirement: { state: "known", mode: "team" }, participationModes: ["unknown"],
    eligibilityState: "partial", eligibilityNotes: ["中国软件杯官方站当届通知确认全日制高校在校生按团队选题报名；队员上限按当届参赛须知复核。"], dataCompleteness: 0.84
  },
  "information-security": {
    sourceUrl: "https://www.ciscn.cn/announcement/view/396",
    facts: ["identity", "stages", "teamRequirement", "eligibility", "participationMode"],
    stages: legacyStageSets.undergraduate, subjects: ["cybersecurity-systems"],
    teamRequirement: { state: "known", mode: "team" }, participationModes: ["hybrid"],
    eligibilityState: "partial", eligibilityNotes: ["全国大学生信息安全竞赛官方页确认本科生团队、线上初赛与线下决赛的竞赛路径；队伍人数与赛道限制仍需当届细则。"], dataCompleteness: 0.86
  },
  "integrated-circuit-innovation": {
    sourceUrl: "https://univ.ciciec.com/",
    facts: ["identity", "stages", "teamRequirement", "eligibility"],
    stages: legacyStageSets.allHigherEducation, subjects: ["information-communication", "engineering-practice"],
    teamRequirement: { state: "known", mode: "team" }, participationModes: ["unknown"],
    eligibilityState: "partial", eligibilityNotes: ["集创赛官方高校站确认高校学生按企业杯或赛道组队报名；学段与人数依赛道文件。"], dataCompleteness: 0.84
  },
  "advanced-graphics-bim": {
    sourceUrl: "https://www.chengtudasai.com/",
    facts: ["identity", "stages", "teamRequirement", "eligibility"],
    stages: legacyStageSets.vocationalAndUndergraduate, subjects: ["digital-construction", "civil-architecture"],
    teamRequirement: { state: "known", mode: "team" }, participationModes: ["unknown"],
    eligibilityState: "partial", eligibilityNotes: ["成图大赛官网确认高职与本科组、校级选拔与团体竞赛；各专业类人数按当届规程复核。"], dataCompleteness: 0.84
  },
  "national-college-industrial-design": {
    sourceUrl: "https://www.cuidc.net/",
    facts: ["identity", "stages", "teamRequirement", "eligibility"],
    stages: legacyStageSets.undergraduate, subjects: ["visual-communication", "engineering-practice"],
    teamRequirement: { state: "known", mode: "either" }, participationModes: ["unknown"],
    eligibilityState: "partial", eligibilityNotes: ["全国大学生工业设计大赛官网确认本科院校作品申报，可按个人或团队作者参赛；作者人数按当届办法。"], dataCompleteness: 0.82
  },
  "future-designer-ncda": {
    sourceUrl: "https://www.ncda.org.cn/",
    facts: ["identity", "stages", "teamRequirement", "eligibility"],
    stages: legacyStageSets.allHigherEducation, subjects: ["visual-communication", "language-culture"],
    teamRequirement: { state: "known", mode: "either" }, participationModes: ["unknown"],
    eligibilityState: "partial", eligibilityNotes: ["未来设计师NCDA官网确认高校学生多类别作品申报，个人或团队作者均可能；人数依类别细则。"], dataCompleteness: 0.82
  },
  "energy-economics-academic-creativity": {
    sourceUrl: "https://energy.qibebt.ac.cn/eneco/contribution/", sourceType: "organizer",
    facts: ["identity", "stages", "teamRequirement", "eligibility"],
    stages: legacyStageSets.academicHigherEducation, subjects: ["statistics-mathematics", "finance-accounting", "water-environment"],
    teamRequirement: { state: "known", mode: "team" }, participationModes: ["unknown"],
    eligibilityState: "partial", eligibilityNotes: ["能源经济大赛官方投稿入口确认高校学生学术团队参赛；赛道、队员上限与学籍口径按当届通知。"], dataCompleteness: 0.82
  },
  "national-college-logistics-design": {
    sourceUrl: "https://wlsjds.clpp.org.cn/about", sourceType: "organizer",
    facts: ["identity", "stages", "teamRequirement", "eligibility"],
    stages: legacyStageSets.academicHigherEducation, subjects: ["finance-accounting", "public-management"],
    teamRequirement: { state: "known", mode: "team" }, participationModes: ["unknown"],
    eligibilityState: "partial", eligibilityNotes: ["中国物流与采购联合会官方赛事页确认本科组、研究生组与团队案例设计形式；两组人数不同，以当届细则为准。"], dataCompleteness: 0.84
  },
  "china-college-computer-contest": {
    sourceUrl: "https://net.c4best.cn/",
    facts: ["identity", "stages", "teamRequirement", "eligibility", "participationMode"],
    stages: legacyStageSets.allHigherEducation, subjects: ["cybersecurity-systems", "information-communication"],
    teamRequirement: { state: "known", mode: "team" }, participationModes: ["hybrid"],
    eligibilityState: "partial", eligibilityNotes: ["中国高校计算机大赛网络技术挑战赛官网确认高校学生团队、线上初赛和现场决赛；人数依赛道细则。"], dataCompleteness: 0.84
  },
  robocon: {
    sourceUrl: "https://robocon.org.cn/sys-nd/63.html",
    facts: ["identity", "stages", "teamRequirement", "eligibility", "participationMode", "recentActivity"],
    stages: legacyStageSets.undergraduate, subjects: ["robotics-automation", "engineering-practice"],
    teamRequirement: { state: "known", mode: "team" }, participationModes: ["offline"],
    eligibilityState: "partial", eligibilityNotes: ["2026第二十五届ROBOCON官方办赛通知确认高校战队制和现场机器人对抗；各赛项队伍规模与资格依规则册。"], dataCompleteness: 0.88
  },
  "robocup-china": {
    sourceUrl: "https://rcccaa.drct-caa.org.cn/", sourceType: "organizer",
    facts: ["identity", "stages", "teamRequirement", "eligibility", "participationMode"],
    stages: legacyStageSets.allHigherEducation, subjects: ["robotics-automation", "vocational-skills"],
    teamRequirement: { state: "known", mode: "team" }, participationModes: ["offline"],
    eligibilityState: "partial", eligibilityNotes: ["中国机器人大赛暨RoboCup中国赛官方平台确认高校与职教赛道的机器人团队现场参赛。"],
    dataNotices: ["主页未作为可独立核对日期的近24个月活动证据。"], dataCompleteness: 0.84
  },
  "siemens-intelligent-manufacturing": {
    sourceUrl: "https://www.siemenscup-cimc.org.cn/",
    facts: ["identity", "stages", "teamRequirement", "eligibility"],
    stages: legacyStageSets.allHigherEducation, subjects: ["robotics-automation", "engineering-practice"],
    teamRequirement: { state: "known", mode: "either", minSize: 1, maxSize: 3 }, participationModes: ["unknown"],
    eligibilityState: "partial", eligibilityNotes: ["西门子杯官网确认高校与职业院校学生参赛，赛项可个人或1–3人团队；赛项差异按规则复核。"], dataCompleteness: 0.88
  },
  "lanqiao-cup": {
    sourceUrl: "https://dasai.lanqiao.cn/",
    facts: ["identity", "stages", "teamRequirement", "eligibility"],
    stages: legacyStageSets.allHigherEducation, subjects: ["information-communication"],
    teamRequirement: { state: "known", mode: "individual", minSize: 1, maxSize: 1 }, participationModes: ["unknown"],
    eligibilityState: "partial", eligibilityNotes: ["蓝桥杯官方赛事站确认高校组软件与电子类个人赛、省赛及全国赛路径；学历组别按当届章程。"], dataCompleteness: 0.86
  },
  "21st-century-english-speaking": {
    sourceUrl: "https://contest.i21st.cn/college/", sourceType: "organizer",
    facts: ["identity", "stages", "teamRequirement", "eligibility", "participationMode"],
    stages: legacyStageSets.academicHigherEducation, subjects: ["language-culture"],
    teamRequirement: { state: "known", mode: "individual", minSize: 1, maxSize: 1 }, participationModes: ["hybrid"],
    eligibilityState: "partial", eligibilityNotes: ["21世纪杯高校官方入口确认大学生个人演讲赛、在线选拔与现场轮次；各组别学籍条件需当届复核。"], dataCompleteness: 0.84
  },
  "icbc-fintech-innovation": {
    sourceUrl: "https://www.gonghangbei.com/", sourceType: "organizer",
    facts: ["identity", "stages", "teamRequirement", "eligibility"],
    stages: legacyStageSets.allHigherEducation, subjects: ["finance-accounting", "information-communication"],
    teamRequirement: { state: "known", mode: "team" }, participationModes: ["unknown"],
    eligibilityState: "partial", eligibilityNotes: ["工行杯官网确认高校学生金融科技项目团队、线上提交与后续评审展示；队员上限以当届通知为准。"], dataCompleteness: 0.84
  }
} as const satisfies Record<string, LegacyCompetitionEvidenceOverride>;

const internationalCoverageCompetitionIds = new Set([
  "icpc-programming",
  "china-us-young-maker",
  "worldskills",
  "worldskills-china-selection",
  "comap-mcm-icm",
  "igem-collegiate",
  "huawei-ict"
]);

function buildCompetitionCredibility(input: {
  competition: CompetitionSource;
  source: CompetitionMetadataSource;
  supportingSources: readonly CompetitionMetadataSource[];
  subjects: readonly CompetitionSubjectArea[];
  schedule: CompetitionSchedule;
}): CompetitionCredibility {
  const { competition, source, supportingSources, subjects } = input;
  const criterion = (score: number, maxScore: number, basis: string) => ({
    score,
    maxScore,
    basis
  });

  const authority = source.sourceType === "education-authority"
    ? criterion(30, 30, "教育或政府主管部门的官方来源。")
    : source.sourceType === "organizer"
      ? criterion(29, 30, "主办单位或主管学会的官方来源。")
      : criterion(29, 30, "赛事组委会经营的官方站或当届规则页。");

  const recentActivitySource = [source, ...supportingSources].find(
    (item) => item.facts?.includes("recentActivity")
  );
  const recentActivity = recentActivitySource
    ? criterion(20, 20, `近24个月活动由明确标注该事实的官方证据支持：${recentActivitySource.url}`)
    : criterion(0, 20, "没有具体的近24个月官方通知或结果证据，不计近期活跃度分。")

  const nationalOrInternationalCoverage = internationalCoverageCompetitionIds.has(competition.id)
    ? criterion(15, 15, "官方规则为跨国或国际赛制。")
    : criterion(15, 15, "官方身份与赛制为全国性高校、职业院校或青年赛事。");

  const trackBonus = competition.recommendation.tracks?.length ? 1 : 0;
  const distinctivenessScore = Math.min(15, 11 + Math.min(subjects.length, 3) + trackBonus);
  const distinctiveness = criterion(
    distinctivenessScore,
    15,
    `具有${subjects.length}个细分学科标签${trackBonus ? "并保留官方分赛道" : ""}，可与同类粗粒度赛事区分。`
  );

  const isFullyVerifiable = source.url.startsWith("https://")
    && Boolean(source.verifiedAt && source.evidenceRef)
    && Boolean(source.facts?.length);
  const verifiability = isFullyVerifiable
    ? criterion(10, 10, "HTTPS一手链接、复核日期、稳定evidenceRef及明确的事实支持范围齐全；未支持字段保持未知。")
    : criterion(7, 10, "一手来源可用，但事实支持范围或复核指针仍不完整。");

  const diversityInputs = new Set([
    ...subjects,
    ...competition.recommendation.majors,
    ...competition.recommendation.preferredOutputs
  ]);
  const diversityScore = Math.min(10, 7 + Math.min(3, Math.max(1, diversityInputs.size - 1)));
  const diversity = criterion(
    diversityScore,
    10,
    `目录建模覆盖${subjects.length}个细分学科，并与专业和交付物标签联合建模。`
  );

  const criteria = [
    authority,
    recentActivity,
    nationalOrInternationalCoverage,
    distinctiveness,
    verifiability,
    diversity
  ];
  return {
    version: "competition-credibility.v1",
    assessedAt: newSeriesIds.has(competition.id) ? "2026-11-04" : LEGACY_CATALOG_VERIFIED_AT,
    authority,
    recentActivity,
    nationalOrInternationalCoverage,
    distinctiveness,
    verifiability,
    diversity,
    total: criteria.reduce((sum, item) => sum + item.score, 0)
  };
}

const newSeriesIds = new Set(researchedCompetitions.map(item => item.id));

function withGeneratedCover(competition: CompetitionSource): Competition {
  const recommendation = competition.recommendation;
  const evidenceOverride = (
    legacyCompetitionEvidenceOverrides as Record<string, LegacyCompetitionEvidenceOverride>
  )[competition.id];
  const inferredFitSignals = competitionFitSignalInferences[
    competition.id as keyof typeof competitionFitSignalInferences
  ] ?? recommendation.fit?.signals;
  if (!inferredFitSignals) {
    throw new Error(`Competition is missing soft-fit metadata: ${competition.id}`);
  }
  const effectiveSourceUrl = evidenceOverride?.sourceUrl ?? competition.sourceUrl;
  const evidenceSourceType = evidenceOverride?.sourceType ?? "official-competition";
  const rawSource = evidenceOverride
    ? {
        url: effectiveSourceUrl,
        sourceType: evidenceSourceType,
        ...(evidenceOverride.verifiedAt !== null
          ? { verifiedAt: evidenceOverride.verifiedAt ?? LEGACY_CATALOG_VERIFIED_AT }
          : {}),
        evidenceRef: evidenceOverride.verifiedAt === null
          ? `unverified:${competition.id}`
          : `official:${competition.id}:${evidenceOverride.verifiedAt ?? LEGACY_CATALOG_VERIFIED_AT}`,
        facts: [
          ...evidenceOverride.facts,
          ...(evidenceOverride.firstHigherEducationYearCutoff
            ? (["firstHigherEducationYearCutoff"] as const)
            : [])
        ] as const
      }
    : recommendation.source ?? {
        url: recommendation.schedule.sourceUrl || competition.sourceUrl,
        sourceType: recommendation.schedule.sourceType,
        ...(recommendation.schedule.verifiedAt
          ? { verifiedAt: recommendation.schedule.verifiedAt }
          : {})
      };
  const identityOverride = competitionIdentityOverrides[
    competition.id as keyof typeof competitionIdentityOverrides
  ];
  const officialDomain = (() => {
    try {
      return new URL(effectiveSourceUrl).hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      return "unknown";
    }
  })();
  const normalizeIdentityPart = (value: string) =>
    value.normalize("NFKC").toLowerCase().replace(/[\s·—–\-_'“”‘’（）()，,：:；;\/\\]+/g, "");
  const canonicalName = competition.identity?.canonicalName ?? competition.name;
  const organizer = competition.identity?.organizer ?? identityOverride?.organizer ?? "unknown";
  const identityDomain = competition.identity?.officialDomain ?? officialDomain;
  const evidenceRef = competition.identity?.evidenceRef
    ?? rawSource.evidenceRef
    ?? `official:${competition.id}:${rawSource.verifiedAt ?? "unverified"}`;
  const source: CompetitionMetadataSource = {
    ...rawSource,
    evidenceRef,
    facts: [...new Set(rawSource.facts ?? [])]
  };
  const supportingSources = recommendation.supportingSources ?? [];
  const trackEvidenceSource = [source, ...supportingSources].find(
    (item) => item.facts?.includes("trackEligibility")
  );
  const identityKey = competition.identity?.identityKey
    ?? [canonicalName, organizer, identityDomain].map(normalizeIdentityPart).join("::");
  const normalizedSchedule: CompetitionSchedule = evidenceOverride
    ? {
        state: "unknown",
        datePrecision: "unknown",
        ...(evidenceOverride.verifiedAt !== null
          ? { verifiedAt: evidenceOverride.verifiedAt ?? LEGACY_CATALOG_VERIFIED_AT }
          : {}),
        sourceUrl: effectiveSourceUrl,
        sourceType: evidenceSourceType
      }
    : recommendation.schedule;
  const normalizedSubjects = evidenceOverride?.subjects ?? recommendation.subjects ?? [];
  const enrichedTaxonomy = enrichCompetitionTaxonomy(
    {
      majors: recommendation.majors,
      skills: recommendation.skills,
      interests: recommendation.interests
    },
    normalizedSubjects
  );
  const credibility = buildCompetitionCredibility({
    competition,
    source,
    supportingSources,
    subjects: normalizedSubjects,
    schedule: normalizedSchedule
  });
  return {
    ...competition,
    sourceUrl: effectiveSourceUrl,
    identity: {
      canonicalName,
      aliases: competition.identity?.aliases ?? identityOverride?.aliases ?? [],
      organizer,
      officialDomain: identityDomain,
      identityKey,
      evidenceRef
    },
    recommendation: {
      ...recommendation,
      ...(evidenceOverride
        ? {
            stages: evidenceOverride.stages,
            subjects: evidenceOverride.subjects,
            teamRequirement: evidenceOverride.teamRequirement,
            participationModes: evidenceOverride.participationModes,
            schedule: normalizedSchedule,
            dataCompleteness: evidenceOverride.dataCompleteness,
            dataNotices: [
              evidenceOverride.verifiedAt === null
                ? "本次复核无法重新访问所列官方来源；不得据此确认报名资格或近期活动。"
                : `资料复核日期：${evidenceOverride.verifiedAt ?? LEGACY_CATALOG_VERIFIED_AT}。`,
              "官方来源未给出适用于整个目录条目的单一精确赛期；报名前请按赛道、赛区与学校通知复核。",
              ...(evidenceOverride.dataNotices ?? [])
            ]
          }
        : {}),
      subjects: normalizedSubjects,
      majors: enrichedTaxonomy.majors,
      skills: enrichedTaxonomy.skills,
      ...(evidenceOverride?.skillEvidenceSignals
        ? { skillEvidenceSignals: evidenceOverride.skillEvidenceSignals }
        : {}),
      interests: enrichedTaxonomy.interests,
      requiredResources: recommendation.requiredResources ?? [],
      helpfulResources: recommendation.helpfulResources ?? recommendation.usefulResources,
      source,
      credibility,
      fit: {
        ...recommendation.fit,
        signals: [...new Set([
          ...(recommendation.fit?.signals ?? []),
          ...inferredFitSignals
        ])],
        notes: [
          ...(recommendation.fit?.notes ?? []),
          "适配信号为基于赛项任务形式的软匹配推断，不作为报名资格。"
        ]
      },
      ...(recommendation.tracks
        ? {
            tracks: recommendation.tracks.map((track) => {
              if (!trackEvidenceSource) return track;
              const verifiedFacts = [
                ...(track.stages ? (["stages"] as const) : []),
                ...(track.teamRequirement ? (["teamRequirement"] as const) : []),
                ...(track.eligibilityNotes?.length ? (["eligibility"] as const) : [])
              ];
              return verifiedFacts.length
                ? { ...track, evidenceRef: trackEvidenceSource.evidenceRef, verifiedFacts }
                : track;
            })
          }
        : {}),
      eligibility: evidenceOverride
        ? {
            state: evidenceOverride.eligibilityState,
            notes: evidenceOverride.eligibilityNotes,
            source,
            ...(evidenceOverride.stageClarificationNotes
              ? { stageClarificationNotes: evidenceOverride.stageClarificationNotes }
              : {}),
            ...(evidenceOverride.blockingClarifications
              ? { blockingClarifications: evidenceOverride.blockingClarifications }
              : {}),
            ...(recommendation.eligibility?.requiresFullTime !== undefined
              ? { requiresFullTime: recommendation.eligibility.requiresFullTime }
              : {}),
            ...(evidenceOverride.sameInstitutionTeam !== undefined
              ? { sameInstitutionTeam: evidenceOverride.sameInstitutionTeam }
              : recommendation.eligibility?.sameInstitutionTeam !== undefined
                ? { sameInstitutionTeam: recommendation.eligibility.sameInstitutionTeam }
              : {}),
            ...(evidenceOverride.firstHigherEducationYearCutoff
              ? {
                  firstHigherEducationYearCutoff: {
                    ...evidenceOverride.firstHigherEducationYearCutoff,
                    source
                  }
                }
              : {})
          }
        : recommendation.eligibility ?? {
            state: recommendation.stages.state === "unknown" ? "unknown" : "partial",
            notes: recommendation.dataNotices.length
              ? recommendation.dataNotices.slice(0, 2)
              : ["请在报名前按当届官方通知复核资格。"],
            source
          }
    },
    coverImage: {
      src: `/competition-posters/${competition.id}.png`,
      sourceSvgSrc: `/competition-posters/source/${competition.id}.svg`,
      metadataSrc: "/competition-posters/manifest.json",
      alt: `${competition.name}的竞赛配图，围绕${competition.category}进行抽象构成`,
      credit: "",
      origin: "ai-generated",
      rightsStatus: "ai-generated-no-human-authorship-claim",
      reviewStatus: "editorial-review-passed",
      reviewedAt: newSeriesIds.has(competition.id) ? "2026-11-04" : "2026-08-23",
      aiGenerated: true,
      humanReviewRequired: false
    }
  };
}

export const competitions: Competition[] = [
  ...competitionGuideTrace.map((trace) => {
    const competition = combinedCompetitionsById.get(trace.catalogId);
    if (!competition) {
      throw new Error(`Competition guide trace points to missing catalog entry: ${trace.catalogId}`);
    }
    return withGeneratedCover(competition);
  }),
  ...existingCompetitions
    .filter((competition) => !guideCatalogIds.has(competition.id))
    .map(withGeneratedCover),
  ...expansionCompetitions.map(withGeneratedCover),
  ...researchedCompetitions.map(withGeneratedCover)
].map(attachDocumentedTracks);

export const competitionCategories = Array.from(new Set(competitions.map((competition) => competition.category)));

export const competitionDirections: readonly CompetitionDirection[] = [
  "创意与数字",
  "工程与制造",
  "人工智能与物联",
  "创新创业",
  "商业与职业",
  "学术科研",
  "语言人文"
];

export const featuredCompetitions = competitions.filter((competition) => competition.featured);
