import series from "./competition-series-20261104.json";
import factSheets from "./competition-fact-sheets.json";
import type {
  CompetitionDirection,
  CompetitionRecommendationMetadata,
  CompetitionSource,
  CompetitionTrackMetadata
} from "./competitions";
import type {
  CompetitionEvidence,
  CompetitionTaskFormat,
  CompetitionStudentStage
} from "@/types/competition-recommendation";

type Signals = Pick<
  CompetitionRecommendationMetadata,
  "majors" | "skills" | "interests" | "preferredOutputs" | "subjects"
> & {
  direction: CompetitionDirection;
  signal: NonNullable<CompetitionRecommendationMetadata["fit"]>["signals"][number];
};

const signals: Record<string, Signals> = {
  algo: {
    direction: "人工智能与物联",
    signal: "algorithm-competition",
    majors: ["computer-science"],
    skills: ["programming"],
    interests: ["data"],
    preferredOutputs: ["software"],
    subjects: ["computing-algorithms"]
  },
  compute: {
    direction: "人工智能与物联",
    signal: "software-engineering",
    majors: ["computer-science"],
    skills: ["programming", "data-analysis"],
    interests: ["engineering", "data"],
    preferredOutputs: ["software", "research-paper"],
    subjects: ["computing-algorithms"]
  },
  robot: {
    direction: "工程与制造",
    signal: "robotics-integration",
    majors: ["engineering", "computer-science"],
    skills: ["hardware", "programming", "structural-design"],
    interests: ["robotics", "engineering"],
    preferredOutputs: ["prototype"],
    subjects: ["robotics-automation"]
  },
  biomed: {
    direction: "工程与制造",
    signal: "product-validation",
    majors: ["medicine", "engineering"],
    skills: ["hardware", "research", "product"],
    interests: ["medicine-health", "engineering"],
    preferredOutputs: ["prototype"],
    subjects: ["medicine-health"]
  },
  pharma: {
    direction: "学术科研",
    signal: "research-provenance",
    majors: ["medicine", "chemistry-materials"],
    skills: ["research", "laboratory", "writing"],
    interests: ["medicine-health", "academic-research"],
    preferredOutputs: ["research-paper", "presentation"],
    subjects: ["medicine-health"]
  },
  transport: {
    direction: "工程与制造",
    signal: "modeling-intensive",
    majors: ["civil-architecture", "engineering"],
    skills: ["data-analysis", "structural-design", "fieldwork"],
    interests: ["engineering", "data"],
    preferredOutputs: ["prototype", "research-paper"],
    subjects: ["civil-architecture"]
  },
  materials: {
    direction: "工程与制造",
    signal: "hardware-build",
    majors: ["engineering", "chemistry-materials"],
    skills: ["laboratory", "structural-design", "research"],
    interests: ["engineering", "chemistry-materials"],
    preferredOutputs: ["prototype", "research-paper"],
    subjects: ["mechanics-materials"]
  },
  gis: {
    direction: "学术科研",
    signal: "field-research",
    majors: ["physics-geoscience", "civil-architecture"],
    skills: ["data-analysis", "fieldwork"],
    interests: ["physics-geoscience", "data"],
    preferredOutputs: ["software", "presentation"],
    subjects: ["geoscience-surveying"]
  },
  language: {
    direction: "语言人文",
    signal: "language-communication",
    majors: ["language-culture", "humanities"],
    skills: ["language", "writing"],
    interests: ["culture-language", "language-communication"],
    preferredOutputs: ["presentation"],
    subjects: ["language-culture"]
  },
  oral: {
    direction: "语言人文",
    signal: "language-communication",
    majors: ["language-culture", "humanities"],
    skills: ["language", "presentation"],
    interests: ["language-communication"],
    preferredOutputs: ["presentation"],
    subjects: ["language-culture"]
  },
  law: {
    direction: "语言人文",
    signal: "language-communication",
    majors: ["humanities", "public-management", "language-culture"],
    skills: ["writing", "research", "language", "presentation"],
    interests: ["public-management", "language-communication", "academic-research"],
    preferredOutputs: ["presentation", "research-paper"],
    subjects: ["legal-studies"]
  },
  lawcn: {
    direction: "语言人文",
    signal: "research-provenance",
    majors: ["humanities", "public-management"],
    skills: ["writing", "research", "policy-analysis", "presentation"],
    interests: ["public-management", "academic-research"],
    preferredOutputs: ["presentation", "research-paper"],
    subjects: ["legal-studies"]
  },
  finance: {
    direction: "商业与职业",
    signal: "finance-operations",
    majors: ["business", "finance-taxation"],
    skills: ["accounting-finance", "data-analysis", "presentation"],
    interests: ["finance-taxation", "career"],
    preferredOutputs: ["presentation", "business-plan"],
    subjects: ["finance-accounting"]
  },
  brand: {
    direction: "商业与职业",
    signal: "product-validation",
    majors: ["business", "humanities", "design"],
    skills: ["product", "presentation", "writing", "design"],
    interests: ["media", "entrepreneurship"],
    preferredOutputs: ["business-plan", "presentation"],
    subjects: ["business-innovation"]
  },
  venture: {
    direction: "创新创业",
    signal: "venture-readiness",
    majors: ["business", "public-management"],
    skills: ["product", "fieldwork", "presentation"],
    interests: ["entrepreneurship", "innovation"],
    preferredOutputs: ["business-plan"],
    subjects: ["business-innovation"]
  },
  design: {
    direction: "创意与数字",
    signal: "design-portfolio",
    majors: ["design", "engineering"],
    skills: ["design", "product"],
    interests: ["design", "innovation"],
    preferredOutputs: ["creative-work", "prototype"],
    subjects: ["visual-communication"]
  },
  field: {
    direction: "创新创业",
    signal: "field-research",
    majors: ["agriculture-environment", "public-management"],
    skills: ["fieldwork", "research", "product"],
    interests: ["agriculture-environment", "innovation"],
    preferredOutputs: ["business-plan", "research-paper"],
    subjects: ["public-management"]
  },
  startup: {
    direction: "创新创业",
    signal: "product-validation",
    majors: ["computer-science", "business"],
    skills: ["programming", "product", "presentation"],
    interests: ["ai", "entrepreneurship"],
    preferredOutputs: ["software", "business-plan"],
    subjects: ["business-innovation"]
  },
  chem: {
    direction: "学术科研",
    signal: "research-provenance",
    majors: ["chemistry-materials"],
    skills: ["laboratory", "research", "data-analysis"],
    interests: ["chemistry-materials", "academic-research"],
    preferredOutputs: ["research-paper"],
    subjects: ["chemistry-chemical"]
  },
  process: {
    direction: "工程与制造",
    signal: "modeling-intensive",
    majors: ["chemistry-materials", "medicine", "engineering"],
    skills: ["structural-design", "research", "data-analysis"],
    interests: ["chemistry-materials", "engineering"],
    preferredOutputs: ["prototype", "research-paper"],
    subjects: ["chemistry-chemical"]
  },
  cosmetic: {
    direction: "创意与数字",
    signal: "product-validation",
    majors: ["chemistry-materials", "design", "medicine"],
    skills: ["laboratory", "design", "product"],
    interests: ["chemistry-materials", "design"],
    preferredOutputs: ["prototype", "creative-work"],
    subjects: ["chemistry-chemical"]
  },
  arts: {
    direction: "创意与数字",
    signal: "design-portfolio",
    majors: ["design", "humanities"],
    skills: ["design", "presentation"],
    interests: ["design", "culture-language", "media"],
    preferredOutputs: ["creative-work", "presentation"],
    subjects: ["arts-performance"]
  },
  vehicle: {
    direction: "工程与制造",
    signal: "hardware-build",
    majors: ["engineering"],
    skills: ["structural-design", "hardware", "data-analysis"],
    interests: ["engineering", "robotics"],
    preferredOutputs: ["prototype"],
    subjects: ["engineering-practice"]
  },
  math: {
    direction: "学术科研",
    signal: "algorithm-competition",
    majors: ["mathematics", "computer-science"],
    skills: ["research", "programming", "data-analysis"],
    interests: ["academic-research", "data"],
    preferredOutputs: ["research-paper", "software"],
    subjects: ["statistics-mathematics"]
  },
  geo: {
    direction: "学术科研",
    signal: "modeling-intensive",
    majors: ["physics-geoscience"],
    skills: ["data-analysis", "research", "fieldwork"],
    interests: ["physics-geoscience", "data"],
    preferredOutputs: ["research-paper", "presentation"],
    subjects: ["geoscience-surveying"]
  }
};

const undergraduates: readonly CompetitionStudentStage[] = [
  "undergraduate-1",
  "undergraduate-2",
  "undergraduate-3",
  "undergraduate-4"
];
const graduateAndUndergraduate: readonly CompetitionStudentStage[] = [
  ...undergraduates,
  "master",
  "doctorate"
];
type Rules = {
  stages?: readonly CompetitionStudentStage[];
  team?: CompetitionRecommendationMetadata["teamRequirement"];
  fullTime?: boolean;
  sameInstitution?: boolean;
  notes: string;
};
const rules: Record<string, Rules> = {
  N03: {
    stages: undergraduates,
    team: { state: "known", mode: "team", minSize: 5, maxSize: 5 },
    notes: "ASC 2026 注册指南要求五名本科生和一名高校指导教师，另核当届规则。"
  },
  N04: {
    stages: graduateAndUndergraduate,
    fullTime: true,
    team: { state: "known", mode: "team", minimumSizeUnknown: true, maxSize: 5 },
    notes: "第十一届通知要求全日制本科或研究生，决赛终审时的学历状态仍须按规则确认。"
  },
  N05: {
    stages: [...undergraduates, "master"],
    team: { state: "known", mode: "team", minimumSizeUnknown: true, maxSize: 5 },
    notes: "药学科学接受本科期间成果及符合条件的当届研一学生，药学服务另有临床药学专业条件。"
  },
  N06: {
    stages: graduateAndUndergraduate,
    team: { state: "known", mode: "team", minimumSizeUnknown: true, maxSize: 5 },
    notes: "需由高校组织推荐，区分本科生、研究生和当届主题赛道。"
  },
  N11: {
    team: { state: "known", mode: "team", minSize: 2, maxSize: 5 },
    sameInstitution: true,
    notes: "Jessup 2027 每校一队，先确认本校可派队及本人执业经历符合规定。"
  },
  N12: {
    team: { state: "known", mode: "team", minSize: 2 },
    sameInstitution: true,
    notes: "第34届按院校派队；每场口辩2人并非团队总人数上限。既往口辩和执业资格须另核。"
  },
  N14: {
    stages: graduateAndUndergraduate,
    team: { state: "known", mode: "team", minSize: 3, maxSize: 5 },
    notes: "查本地承办方与院校参队路径，还须核对个人从业经历限制。"
  },
  N15: {
    stages: graduateAndUndergraduate,
    team: { state: "known", mode: "team", minSize: 3, maxSize: 5 },
    sameInstitution: true,
    notes: "以第十六届中国赛为参照，需核对院校与区域通道。"
  },
  N16: {
    stages: undergraduates,
    fullTime: true,
    notes: "2026 中国大陆赛要求中国大陆高校注册的全日制本科生，查所适用的地区规则。"
  },
  N18: {
    team: { state: "known", mode: "team", minSize: 2, maxSize: 4 },
    notes: "2027 报名页要求在读学位项目，并有年龄限制，条款年份须再核。"
  },
  N19: {
    team: { state: "known", mode: "either" },
    notes: "James Dyson Award 可个人或组队；个人或队长须符合专业、毕业年限和参赛地区要求，其他成员另核。"
  },
  N20: {
    team: { state: "known", mode: "either", minSize: 1, maxSize: 4 },
    notes: "学生奖接受个人或最多四人团队，请核对在读或毕业两年以内等规定。"
  },
  N22: {
    team: { state: "known", mode: "team", minSize: 3, maxSize: 7 },
    notes: "第六届通知鼓励跨校跨专业组队；具体年龄、学籍及各赛道要求另核。"
  },
  A1: { stages: undergraduates, notes: "章程面向化学类专业本科生；具体专业和所在学校的选拔资格须确认。" },
  A2: {
    team: { state: "known", mode: "team", minSize: 6, maxSize: 6 },
    sameInstitution: true,
    notes: "第十三届为同校六人队，研究生比例不超过一半，须核对本届与校内名额。"
  },
  A9: {
    team: { state: "known", mode: "team", minSize: 3, maxSize: 5 },
    sameInstitution: true,
    notes: "第十届规定每队代表一所高校，不允许跨校组队。"
  },
  A12: {
    stages: ["vocational", ...graduateAndUndergraduate],
    fullTime: true,
    notes: "第八届学生艺术表演、作品和实践工作坊面向全日制在籍本专科及研究生，院校报送。"
  },
  A13: {
    stages: [...undergraduates, "master"],
    fullTime: true,
    notes: "所附 2025 指南面向国内全日制本科、硕士在读学生，须核对新届条款。"
  }
};

// Track labels follow the cited edition. Skills and outputs describe the work, not entry rules.
const tracksBySeries: Record<string, CompetitionTrackMetadata[]> = {
  N04: [
    {
      id: "assigned-problem",
      label: "命题项目",
      skills: ["research", "product"],
      preferredOutputs: ["prototype"],
      blockingClarifications: ["先核对所选题目的选手类别限制。"]
    },
    {
      id: "student-proposal",
      label: "自选项目",
      skills: ["research", "hardware"],
      preferredOutputs: ["prototype", "research-paper"]
    }
  ],
  N05: [
    {
      id: "pharmacy-science",
      label: "药学科学",
      skills: ["laboratory", "research"],
      preferredOutputs: ["research-paper"],
      eligibilityNotes: ["本届接受符合条件的本科生及研一学生的药学创新实验成果。"],
      blockingClarifications: ["需核对实验成果的形成时间和研究生年级。"]
    },
    {
      id: "pharmacy-service",
      label: "药学服务",
      skills: ["presentation", "writing"],
      preferredOutputs: ["presentation"],
      eligibilityNotes: ["本届面向临床药学专业本科生及研一学生，选题源自药学服务实践。"],
      blockingClarifications: ["需确认是临床药学专业并有服务实践，研究生须核对年级。"]
    }
  ],
  N06: [
    {
      id: "undergraduate",
      label: "本科生赛道",
      stages: { state: "known", values: undergraduates },
      skills: ["structural-design", "product"],
      preferredOutputs: ["prototype", "research-paper"]
    },
    {
      id: "graduate",
      label: "研究生赛道",
      stages: { state: "known", values: ["master", "doctorate"] },
      skills: ["research", "data-analysis"],
      preferredOutputs: ["research-paper"]
    },
    {
      id: "themed",
      label: "主题赛道",
      skills: ["research", "data-analysis"],
      preferredOutputs: ["research-paper", "presentation"],
      blockingClarifications: ["确认作品与本届交通智能转型或绿色发展主题相符。"]
    }
  ],
  A3: [
    {
      id: "ingredients",
      label: "原料开发组",
      skills: ["research", "laboratory"],
      preferredOutputs: ["prototype"]
    },
    {
      id: "formulation",
      label: "产品创意和配方设计组",
      skills: ["laboratory", "product"],
      preferredOutputs: ["prototype"]
    },
    {
      id: "packaging",
      label: "包装设计组",
      skills: ["design", "product"],
      preferredOutputs: ["creative-work"]
    }
  ],
  A12: [
    { id: "performance", label: "艺术表演", skills: ["presentation"], preferredOutputs: ["presentation"] },
    { id: "artwork", label: "艺术作品", skills: ["design"], preferredOutputs: ["creative-work"] },
    {
      id: "workshop",
      label: "艺术实践工作坊",
      skills: ["design", "presentation"],
      preferredOutputs: ["creative-work", "presentation"]
    }
  ]
};

// These are editorial descriptions of the work in each series, not eligibility criteria.
const distinctWork: Record<string, Partial<Pick<Signals, "skills" | "preferredOutputs" | "interests">>> = {
  N11: {
    skills: ["research", "language", "writing", "presentation"],
    preferredOutputs: ["research-paper", "presentation"]
  },
  N12: {
    skills: ["language", "writing", "presentation", "policy-analysis"],
    preferredOutputs: ["presentation", "research-paper"]
  },
  N13: {
    skills: ["research", "policy-analysis", "presentation"],
    preferredOutputs: ["research-paper", "presentation"]
  },
  N14: {
    skills: ["accounting-finance", "data-analysis", "writing"],
    preferredOutputs: ["research-paper", "presentation"]
  },
  N15: {
    skills: ["accounting-finance", "data-analysis", "presentation"],
    preferredOutputs: ["presentation", "business-plan"]
  },
  N16: {
    skills: ["accounting-finance", "language", "presentation"],
    preferredOutputs: ["business-plan", "presentation"]
  },
  N17: { skills: ["product", "design", "presentation"], preferredOutputs: ["creative-work", "presentation"] },
  N18: { skills: ["research", "product", "presentation"], preferredOutputs: ["business-plan", "prototype"] },
  N19: { skills: ["product", "design", "structural-design"], preferredOutputs: ["prototype"] },
  N20: { skills: ["design", "research"], preferredOutputs: ["creative-work", "prototype"] },
  A7: { skills: ["writing", "policy-analysis", "presentation"], preferredOutputs: ["presentation"] },
  A8: {
    skills: ["language", "policy-analysis", "writing"],
    preferredOutputs: ["research-paper", "presentation"]
  },
  A11: {
    skills: ["policy-analysis", "fieldwork", "presentation"],
    preferredOutputs: ["research-paper", "presentation"]
  },
  A13: {
    skills: ["presentation", "language", "accounting-finance"],
    preferredOutputs: ["career-plan", "presentation"]
  },
  A14: { skills: ["structural-design", "hardware", "data-analysis"], preferredOutputs: ["prototype"] },
  A15: { skills: ["hardware", "structural-design", "laboratory"], preferredOutputs: ["prototype"] },
  A16: {
    skills: ["research", "programming", "data-analysis"],
    preferredOutputs: ["research-paper", "software"]
  }
};

const necessaryTasks: Record<string, readonly (CompetitionTaskFormat | "laboratory")[]> = {
  N01: ["algorithm"],
  N03: ["software"],
  N07: ["laboratory"],
  N09: ["language"],
  N10: ["language"],
  N11: ["language"],
  N12: ["language"],
  N18: ["entrepreneurship"],
  N23: ["software"],
  A1: ["laboratory"],
  A16: ["research"]
};

const transferableEvidence: Record<string, readonly CompetitionEvidence[]> = {
  algo: ["project"],
  compute: ["project", "paper"],
  robot: ["prototype", "project"],
  biomed: ["prototype", "project"],
  pharma: ["paper", "project"],
  transport: ["project", "paper"],
  materials: ["prototype", "project"],
  gis: ["project", "portfolio"],
  language: [],
  oral: [],
  law: ["paper"],
  lawcn: ["paper"],
  finance: ["project"],
  brand: ["project", "portfolio"],
  venture: ["project", "prototype"],
  design: ["prototype", "portfolio"],
  field: ["project", "paper"],
  startup: ["project", "prototype"],
  chem: ["project"],
  process: ["project"],
  cosmetic: ["prototype", "portfolio"],
  arts: ["portfolio"],
  vehicle: ["prototype", "project"],
  math: ["paper", "project"],
  geo: ["project", "paper"]
};

export const researchedCompetitions: CompetitionSource[] = series.map((item) => {
  const { direction, signal, ...match } = { ...signals[item.theme], ...distinctWork[item.researchId] };
  const rule = rules[item.researchId];
  const verifiedAt = "2026-11-04";
  const tracks = tracksBySeries[item.researchId];
  const referencedRules: Record<string, string> = {
    N11: factSheets.N11.sources[1].url,
    N12: factSheets.N12.sources[1].url,
    N15: factSheets.N15.sources[1].url,
    N22: factSheets.N22.sources[1].url
  };
  const ruleUrl = referencedRules[item.researchId] ?? item.sourceUrl;
  const source = {
    url: ruleUrl,
    sourceType: (/\.edu\.cn(?:\/|$)/.test(ruleUrl) ? "education-authority" : "official-competition") as
      | "education-authority"
      | "official-competition",
    verifiedAt,
    evidenceRef: "rules:" + item.id,
    facts: [
      "identity",
      ...(rule?.stages ? ["stages" as const] : []),
      ...(rule?.team ? ["teamRequirement" as const] : []),
      ...(rule ? ["eligibility" as const] : []),
      ...(tracks ? ["trackEligibility" as const] : [])
    ] as NonNullable<CompetitionRecommendationMetadata["source"]>["facts"]
  };
  const unknown = { state: "unknown" } as const;
  const notes = rule?.notes ?? "请按本人身份、地区和所选项目核对正式办法及院校参赛通道。";
  const goals = {
    project: 0.8,
    award: 0.45,
    postgraduate: 0.55,
    employment: 0.6,
    portfolio: 0.45,
    entrepreneurship: 0.25,
    networking: 0.55
  };
  if (match.preferredOutputs.includes("research-paper")) goals.postgraduate = 0.9;
  if (match.preferredOutputs.includes("creative-work")) goals.portfolio = 0.95;
  if (match.preferredOutputs.includes("business-plan")) goals.entrepreneurship = 0.82;
  if (["finance", "vehicle", "compute", "startup"].includes(item.theme)) goals.employment = 0.88;
  return {
    id: item.id,
    name: item.name,
    identity: {
      canonicalName: item.name,
      aliases: [],
      organizer: item.organizer,
      officialDomain: new URL(item.sourceUrl).hostname.replace(/^www\./, ""),
      evidenceRef: source.evidenceRef
    },
    category: item.category,
    direction,
    sourceUrl: item.sourceUrl,
    featured: false,
    summary: item.task + "。",
    detail: {
      intro: item.task + "。你可以围绕「" + item.deliverable + "」判断是否喜欢这项工作。",
      participationPath: notes,
      userValue:
        "可以留下" +
        item.deliverable +
        "，用于复盘本人贡献。能否用于评奖、学分或升学材料，须按本校政策核对。",
      suitableFor: [item.role, "希望积累" + item.deliverable + "的学生"],
      preparationTips: [item.firstStep, item.investment]
    },
    recommendation: {
      ...match,
      fit: { signals: [signal] },
      stages: rule?.stages ? { state: "known", values: rule.stages } : unknown,
      regions: unknown,
      source,
      teamRequirement: rule?.team ?? unknown,
      eligibility: {
        state: rule ? "partial" : "unknown",
        ...(rule?.fullTime ? { requiresFullTime: true } : {}),
        ...(rule?.sameInstitution ? { sameInstitutionTeam: true } : {}),
        ...(item.researchId === "A1" ? { allowedMajorFields: ["chemistry-materials" as const] } : {}),
        notes: [notes],
        blockingClarifications: [notes],
        source
      },
      tracks,
      mandatoryTasks: necessaryTasks[item.researchId],
      experienceLevels: [],
      evidence: transferableEvidence[item.theme],
      goalValues: goals,
      difficulty: "balanced",
      weeklyHours: [],
      participationModes: ["unknown"],
      usefulResources: [],
      schedule: {
        state: "unknown",
        datePrecision: "unknown",
        verifiedAt,
        sourceType: source.sourceType,
        sourceUrl: item.sourceUrl
      },
      dataCompleteness: rule ? 0.65 : 0.45,
      dataNotices: ["高校文件仅说明该校通道；未知费用须询问主办方。"]
    }
  };
});
