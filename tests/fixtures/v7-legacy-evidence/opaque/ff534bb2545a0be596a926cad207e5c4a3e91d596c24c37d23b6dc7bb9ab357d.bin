import { describe, expect, it } from "vitest";
import { findCatalogCompetition, getCompetitionCatalog } from "@/lib/competitions/catalog";
import {
  buildCompetitionFinalQualityPool,
  getCompetitionRecommendationCandidates,
  recommendCompetitions,
  selectCompetitionRecommendationRecall,
  selectFinalQualityRecommendations
} from "@/lib/competitions/recommendation-engine";
import {
  assessCompetitionConfirmedSubjectAlignment,
  hasDominantConfirmedSubjectMatch,
  scoreCompetition,
  scoreCompetitionRecommendations,
  semanticArchetypeFit
} from "@/lib/competitions/scoring";
import {
  competitionHardNegativePersonas,
  competitionRankingHoldoutCases
} from "../fixtures/competition-quality-personas";
import { projectLegacyCompetitionPreferenceTranscript } from "@/lib/competitions/legacy-preference-adapter";
import {
  getLegacyCompetitionRecommendationCandidates,
  recommendLegacyCompetitions,
  scoreLegacyCompetition,
  selectLegacyFinalQualityRecommendations
} from "@/lib/competitions/legacy-scoring-adapter";
import type {
  CompetitionDynamicExchangeV2,
  CompetitionDynamicExchangeV3,
  CompetitionFitSignal,
  CompetitionRecommendationProfileV4,
  CompetitionRecommendationProfileV5,
  CompetitionTeamEligibilitySignal
} from "@/types/competition-recommendation";
import { COMPETITION_PROFILE_FIELD_IDS } from "@/types/competition-recommendation";

const baseProfile: CompetitionRecommendationProfileV4 = {
  profileVersion: "competition-profile.v4",
  stage: "undergraduate-2",
  majorFields: ["computer-science"],
  skills: ["programming", "data-analysis"],
  interests: ["innovation"],
  goals: ["project"],
  preferredOutputs: ["software"],
  startingPoint: "coursework",
  weeklyCommitment: "5-10",
  teamStatus: "partial",
  availableResources: ["mentor"],
  region: "east",
  participationMode: "flexible",
  experienceLevel: "participated",
  evidence: ["project"]
};

function transcript(
  fit: CompetitionFitSignal,
  _team: CompetitionTeamEligibilitySignal
): CompetitionDynamicExchangeV3[] {
  return [
    {
      question: {
        questionId: `dq_fit_${fit.replaceAll("-", "_")}`,
        signalKey: "competition-fit",
        prompt: "接下来最希望重点证明哪一类实战能力？",
        selection: "multiple",
        maxSelections: 2,
        options: [{ value: fit, label: "当前优先方向" }, { value: "product-validation", label: "产品验证" }],
        allowsNote: true,
        maxNoteLength: 120,
        impact: "material",
        estimatedPreferenceOutcomeChanges: 2
      },
      answer: { selectedValues: [fit] }
    }
  ];
}

function eligibilityTranscript(
  _fit: CompetitionFitSignal,
  competitionId: string,
  answer: "eligible" | "needs-check" | "ineligible"
): CompetitionDynamicExchangeV2[] {
  return [
    {
      question: {
        questionId: `dq_eligibility_${competitionId}`,
        signalKey: `eligibility:${competitionId}`,
        prompt: "按当届官方条件自检，你目前的资格状态是？",
        selection: "single",
        options: [
          { value: "eligible", label: "已核对且符合" },
          { value: "needs-check", label: "仍需核对" },
          { value: "ineligible", label: "已确认不符合" }
        ],
        allowsNote: true,
        maxNoteLength: 120
      },
      answer: { selectedValues: [answer] }
    }
  ];
}

type GoldPersona = {
  id: string;
  profile: CompetitionRecommendationProfileV4;
  fit: CompetitionFitSignal;
  team: CompetitionTeamEligibilitySignal;
  idealIds: readonly string[];
  acceptableIds: readonly string[];
  forbiddenIds?: readonly string[];
  /** 2026-08-23 expert audit note for additions made after the catalog grew from 41 to 100. */
  auditRationale?: string;
};

const personas: GoldPersona[] = [
  {
    id: "algorithm-team",
    profile: { ...baseProfile, skills: ["programming"], interests: ["ai", "data"], goals: ["award"], weeklyCommitment: "over-10", teamStatus: "ready", experienceLevel: "project-or-award", evidence: ["award"] },
    fit: "algorithm-competition",
    team: "team-3-same-unit",
    idealIds: ["icpc-programming", "lanqiao-cup"],
    acceptableIds: ["icpc-programming", "lanqiao-cup", "information-security"]
  },
  {
    id: "software-product",
    profile: { ...baseProfile, skills: ["programming", "product"], interests: ["ai", "innovation"], preferredOutputs: ["software"], startingPoint: "prototype", evidence: ["project", "prototype"] },
    fit: "software-engineering",
    team: "team-3-same-unit",
    idealIds: ["china-software-cup", "china-college-computer-design", "service-outsourcing-innovation"],
    acceptableIds: ["china-software-cup", "china-college-computer-design", "iot-design", "service-outsourcing-innovation", "huawei-ict"],
    auditRationale: "服创的企业真实命题、软件原型与产品验证直接命中画像；华为 ICT 创新赛道可作需确认 ICT 学院资格的备选。"
  },
  {
    id: "math-model-undergraduate",
    profile: { ...baseProfile, majorFields: ["mathematics"], skills: ["data-analysis", "programming", "writing"], interests: ["data", "academic-research"], preferredOutputs: ["research-paper"], weeklyCommitment: "over-10", teamStatus: "ready" },
    fit: "modeling-intensive",
    team: "team-3-same-unit",
    idealIds: ["national-college-math-modeling", "comap-mcm-icm", "statistical-modeling"],
    acceptableIds: ["national-college-math-modeling", "comap-mcm-icm", "statistical-modeling", "energy-economics-academic-creativity", "market-research-analysis"],
    auditRationale: "COMAP 与统计建模均有本科赛道、建模论文交付和三人队伍证据，与建模+编程+写作画像直接匹配。"
  },
  {
    id: "math-model-master-hard-negative",
    profile: { ...baseProfile, stage: "master", majorFields: ["mathematics"], skills: ["data-analysis", "programming", "writing"], interests: ["data", "academic-research"], preferredOutputs: ["research-paper"], teamStatus: "ready" },
    fit: "modeling-intensive",
    team: "team-3-same-unit",
    idealIds: ["graduate-math-modeling", "statistical-modeling", "energy-economics-academic-creativity", "market-research-analysis"],
    acceptableIds: ["graduate-math-modeling", "statistical-modeling", "energy-economics-academic-creativity", "market-research-analysis", "challenge-cup-academic-science"],
    forbiddenIds: ["national-college-math-modeling"],
    auditRationale: "中国研究生数学建模明确面向硕博且为三人队；统计建模官方允许研究生组，两者都比旧 41 项中的泛化选项更精确。"
  },
  {
    id: "electronic-design-freshman",
    profile: { ...baseProfile, stage: "undergraduate-1", majorFields: ["engineering"], skills: ["hardware", "programming"], interests: ["engineering"], preferredOutputs: ["prototype"], weeklyCommitment: "over-10", teamStatus: "ready", availableResources: ["lab", "equipment", "mentor"], evidence: ["prototype"] },
    fit: "hardware-build",
    team: "team-3-same-unit",
    idealIds: ["national-college-electronic-design", "embedded-chip-system-design"],
    acceptableIds: ["national-college-electronic-design", "embedded-chip-system-design", "datang-ict", "intelligent-robot-creativity", "smart-car", "iot-design", "integrated-circuit-innovation"],
    auditRationale: "嵌入式赛事与硬件+编程+样机强匹配；大唐 ICT 与智能机器人也有本科工程实作、设备和团队元数据，可作延展备选。"
  },
  {
    id: "electronic-design-master-hard-negative",
    profile: { ...baseProfile, stage: "master", majorFields: ["engineering"], skills: ["hardware", "programming"], interests: ["engineering"], preferredOutputs: ["prototype"], teamStatus: "ready", availableResources: ["lab", "equipment"] },
    fit: "hardware-build",
    team: "team-3-same-unit",
    idealIds: ["graduate-electronic-design", "embedded-chip-system-design", "integrated-circuit-innovation", "iot-design"],
    acceptableIds: ["graduate-electronic-design", "embedded-chip-system-design", "integrated-circuit-innovation", "iot-design", "robocon", "robocup-china"],
    forbiddenIds: ["national-college-electronic-design"],
    auditRationale: "研究生电子设计有硕博学段和 2–3 人技术赛队官方证据；2026 芯片应用赛道通知也明确接受全日制在校研究生、按学籍设研究生组且要求同校 1–3 人，该硕士同校 3 人硬件画像满足已知条件。全国大学生电子设计竞赛仍为本科限定并保持不可接受。"
  },
  {
    id: "freshman-original-research",
    profile: { ...baseProfile, stage: "undergraduate-1", majorFields: ["humanities"], skills: ["research", "data-analysis", "writing"], interests: ["academic-research"], preferredOutputs: ["research-paper"], startingPoint: "prototype", evidence: ["paper"] },
    fit: "research-provenance",
    team: "solo",
    idealIds: ["challenge-cup-academic-science"],
    acceptableIds: ["challenge-cup-academic-science", "market-research-analysis", "energy-economics-academic-creativity"]
  },
  {
    id: "field-research-business",
    profile: { ...baseProfile, majorFields: ["business", "humanities"], skills: ["research", "data-analysis", "writing"], interests: ["data", "academic-research"], preferredOutputs: ["research-paper", "presentation"], teamStatus: "ready", availableResources: ["data", "mentor"] },
    fit: "field-research",
    team: "team-4-5-same-unit",
    idealIds: ["market-research-analysis"],
    acceptableIds: ["market-research-analysis", "challenge-cup-academic-science", "energy-economics-academic-creativity", "national-college-logistics-design"],
    auditRationale: "物流设计是企业案例、数据分析、方案报告与答辩任务，官方元数据支持本科团队，可作商科田野/案例研究的实务备选。"
  },
  {
    id: "entrepreneurship-authorized-product",
    profile: { ...baseProfile, stage: "undergraduate-1", majorFields: ["business", "engineering"], skills: ["product", "presentation"], interests: ["entrepreneurship", "innovation"], goals: ["entrepreneurship"], preferredOutputs: ["business-plan", "presentation"], startingPoint: "validated", teamStatus: "ready", evidence: ["project", "prototype"] },
    fit: "venture-readiness",
    team: "team-4-5-same-unit",
    idealIds: ["challenge-cup-entrepreneurship-plan", "china-international-college-innovation"],
    acceptableIds: ["challenge-cup-entrepreneurship-plan", "china-international-college-innovation", "service-outsourcing-innovation", "ecommerce-innovation-creativity-entrepreneurship", "ican-innovation-entrepreneurship"],
    auditRationale: "服创具有企业真实需求、产品/商业验证、原型和路演交付，适配已验证的创业型团队。"
  },
  {
    id: "innovation-prototype-team",
    profile: { ...baseProfile, stage: "undergraduate-1", majorFields: ["engineering", "business"], skills: ["product", "hardware", "presentation"], interests: ["innovation", "entrepreneurship"], preferredOutputs: ["prototype", "business-plan"], startingPoint: "prototype", teamStatus: "ready", evidence: ["prototype", "project"] },
    fit: "venture-readiness",
    team: "team-4-5-same-unit",
    idealIds: ["china-international-college-innovation"],
    acceptableIds: ["china-international-college-innovation", "challenge-cup-entrepreneurship-plan", "service-outsourcing-innovation", "ican-innovation-entrepreneurship", "ecommerce-innovation-creativity-entrepreneurship"],
    auditRationale: "服创的产品验证和原型交付与工科+商科创新团队一致，但不替代双创类首选。"
  },
  {
    id: "career-action",
    profile: { ...baseProfile, majorFields: ["business"], skills: ["writing", "presentation"], interests: ["career"], goals: ["employment"], preferredOutputs: ["career-plan", "presentation"], weeklyCommitment: "under-5", teamStatus: "solo", evidence: ["portfolio"] },
    fit: "career-evidence",
    team: "solo",
    idealIds: ["career-planning"],
    acceptableIds: ["career-planning"]
  },
  {
    id: "language-undergraduate",
    profile: { ...baseProfile, majorFields: ["humanities"], skills: ["writing", "presentation"], interests: ["language-communication"], goals: ["award", "portfolio"], preferredOutputs: ["presentation"], teamStatus: "solo", evidence: ["portfolio"] },
    fit: "language-communication",
    team: "solo",
    idealIds: ["understanding-contemporary-china-foreign-language", "21st-century-english-speaking", "chinese-classics"],
    acceptableIds: ["understanding-contemporary-china-foreign-language", "21st-century-english-speaking", "chinese-classics"],
    auditRationale: "中华经典诵写讲的语言表达、文化阐释和作品交付与人文写作/展示型画像直接匹配，且官方允许个人或团队赛项。"
  },
  {
    id: "language-doctorate-hard-negative",
    profile: { ...baseProfile, stage: "doctorate", majorFields: ["humanities"], skills: ["writing", "presentation"], interests: ["language-communication"], goals: ["portfolio"], preferredOutputs: ["presentation"], teamStatus: "solo" },
    fit: "language-communication",
    team: "solo",
    idealIds: ["graduate-culture-china", "21st-century-english-speaking"],
    acceptableIds: ["graduate-culture-china", "chinese-classics", "21st-century-english-speaking"],
    forbiddenIds: ["understanding-contemporary-china-foreign-language"],
    auditRationale: "‘文化中国’官方明确面向在读硕博且允许个人/1–5 人团队，是博士语言文化表达的精确新首选；中华经典可作作品型备选。"
  },
  {
    id: "design-portfolio",
    profile: { ...baseProfile, majorFields: ["design"], skills: ["design", "product", "presentation"], interests: ["design", "media"], goals: ["portfolio"], preferredOutputs: ["creative-work"], startingPoint: "prototype", evidence: ["portfolio"] },
    fit: "design-portfolio",
    team: "solo",
    idealIds: ["future-designer-ncda", "national-college-industrial-design", "national-advertising-art"],
    acceptableIds: ["future-designer-ncda", "national-college-industrial-design", "national-advertising-art", "digital-media-creative-tech", "china-college-computer-design"],
    auditRationale: "大广赛的真实命题、视觉/传播作品和本科个人或团队赛道与设计作品集画像直接匹配。"
  },
  {
    id: "robotics-equipped-team",
    profile: { ...baseProfile, majorFields: ["engineering", "computer-science"], skills: ["hardware", "programming"], interests: ["robotics", "engineering"], goals: ["award", "project"], preferredOutputs: ["prototype"], weeklyCommitment: "over-10", teamStatus: "ready", availableResources: ["lab", "equipment", "mentor"], evidence: ["prototype", "award"] },
    fit: "robotics-integration",
    team: "team-over-5",
    idealIds: ["robocon", "robocup-china", "intelligent-robot-creativity", "raicom-robot-developer", "smart-car"],
    acceptableIds: ["robocon", "robocup-china", "intelligent-robot-creativity", "raicom-robot-developer", "smart-car", "siemens-intelligent-manufacturing"],
    auditRationale: "智能机器人创意大赛与 RAICOM 均有机器人集成、软硬件联调、团队和实验室/设备元数据，对该已配备团队是同等强匹配。"
  },
  {
    id: "fintech-supply-chain",
    profile: { ...baseProfile, majorFields: ["business", "computer-science"], skills: ["data-analysis", "product", "presentation"], interests: ["data", "innovation"], goals: ["employment", "project"], preferredOutputs: ["business-plan", "software"], teamStatus: "ready", evidence: ["project"] },
    fit: "finance-operations",
    team: "team-3-same-unit",
    idealIds: ["icbc-fintech-innovation", "national-college-logistics-design"],
    acceptableIds: ["icbc-fintech-innovation", "national-college-logistics-design", "market-research-analysis", "business-elite-innovation"]
  },
  {
    id: "green-low-carbon",
    profile: { ...baseProfile, majorFields: ["engineering", "business"], skills: ["research", "data-analysis", "hardware"], interests: ["engineering", "academic-research"], goals: ["project", "postgraduate"], preferredOutputs: ["prototype", "research-paper"], teamStatus: "ready", availableResources: ["lab", "data"], evidence: ["paper", "prototype"] },
    fit: "sustainability-impact",
    team: "team-3-same-unit",
    idealIds: ["energy-conservation-emission-reduction", "green-development", "water-innovation-design"],
    acceptableIds: ["energy-conservation-emission-reduction", "green-development", "water-innovation-design", "energy-economics-academic-creativity", "challenge-cup-academic-science"],
    auditRationale: "水利创新设计聚焦水资源/生态、工程原型和技术说明，与可持续影响+硬件+研究画像高度一致。"
  },
  {
    id: "medical-research",
    profile: { ...baseProfile, majorFields: ["medicine"], skills: ["research", "data-analysis", "writing"], interests: ["academic-research", "data"], goals: ["postgraduate"], preferredOutputs: ["research-paper"], teamStatus: "partial", availableResources: ["lab", "data", "mentor"], evidence: ["paper"] },
    fit: "research-provenance",
    team: "team-3-same-unit",
    idealIds: ["basic-medicine-innovation", "culsc-life-sciences", "challenge-cup-academic-science"],
    acceptableIds: ["basic-medicine-innovation", "culsc-life-sciences", "challenge-cup-academic-science", "energy-economics-academic-creativity", "market-research-analysis"],
    auditRationale: "基础医学创新与 CULSC 都有医学/生命学科、本科研究、论文/实验证据及团队元数据，比旧目录的泛学术赛事更精确。"
  }
];

describe("expert competition recommendation gold set", () => {
  it("keeps the expert top choice and hard-negative gates while filling three unique items", () => {
    const results = personas.map((persona) => {
      const recommendation = recommendLegacyCompetitions(persona.profile, {
        now: new Date("2026-08-22T00:00:00.000Z"),
        transcript: transcript(persona.fit, persona.team)
      });
      const ids = recommendation.recommendations.slice(0, 3).map(({ competitionId }) => competitionId);
      return { persona, ids };
    });

    // Keep this message actionable when a future catalog change breaks the expert gate.
    const diagnostics = results.map(({ persona, ids }) => `${persona.id}: ${ids.join(", ") || "no_match"}`);
    const topOneIdealCount = results.filter(({ persona, ids }) => persona.idealIds.includes(ids[0])).length;
    const unacceptableTopChoice = results.filter(
      ({ persona, ids }) => !persona.acceptableIds.includes(ids[0])
    );
    const forbidden = results.filter(({ persona, ids }) => ids.some((id) => persona.forbiddenIds?.includes(id)));
    const malformed = results.filter(({ ids }) => ids.length !== 3 || new Set(ids).size !== 3);

    expect(forbidden, diagnostics.join("\n")).toEqual([]);
    expect(unacceptableTopChoice, diagnostics.join("\n")).toEqual([]);
    expect(malformed, diagnostics.join("\n")).toEqual([]);
    expect(topOneIdealCount / results.length, diagnostics.join("\n")).toBeGreaterThanOrEqual(0.9);
  });

  it("fills a low-actionability profile without crossing a hard exclusion", () => {
    const sparseProfile: CompetitionRecommendationProfileV4 = {
      ...baseProfile,
      majorFields: ["other"],
      skills: ["writing"],
      interests: ["career"],
      goals: ["networking"],
      preferredOutputs: ["presentation"],
      startingPoint: "idea_only",
      weeklyCommitment: "under-5",
      teamStatus: "solo",
      availableResources: ["none"],
      experienceLevel: "none",
      evidence: ["none"]
    };
    const result = recommendLegacyCompetitions(sparseProfile, {
      now: new Date("2026-08-22T00:00:00.000Z")
    });
    const recalled = getLegacyCompetitionRecommendationCandidates(sparseProfile, {
      now: new Date("2026-08-22T00:00:00.000Z")
    }).recommendations;

    expect(selectLegacyFinalQualityRecommendations(recalled, sparseProfile).length).toBeLessThanOrEqual(2);
    expect(result.recommendations).toHaveLength(3);
    expect(new Set(result.recommendations.map(({ competitionId }) => competitionId)).size).toBe(3);
    expect(result.recommendations.every(({ eligibility }) => eligibility.status !== "ineligible")).toBe(true);
    expect(result.recommendations.every(({ registrationStatus }) => registrationStatus.status !== "cancelled")).toBe(true);
  });

  it("does not let a dynamic ability preference remove fixed subject/task quality matches", () => {
    const persona = competitionRankingHoldoutCases.find(({ id }) =>
      id === "rank-undergraduate-upper-medical-research"
    );
    expect(persona).toBeDefined();
    if (!persona) throw new Error("Missing medical quality fixture");

    const recalled = getCompetitionRecommendationCandidates(persona.profile, {
      now: new Date("2026-08-22T00:00:00.000Z")
    }).recommendations;
    const fixedSubjectMatch = recalled.find(({ competition }) =>
      hasDominantConfirmedSubjectMatch(
        assessCompetitionConfirmedSubjectAlignment(competition, persona.profile)
      )
    );
    const unrelatedAbilityPreference = transcript("field-research", "team-3-same-unit");
    expect(fixedSubjectMatch).toBeDefined();
    const fixedPoolIds = buildCompetitionFinalQualityPool(recalled, persona.profile)
      .map(({ competitionId }) => competitionId);
    const preferencePoolIds = buildCompetitionFinalQualityPool(
      recalled,
      persona.profile,
      unrelatedAbilityPreference
    ).map(({ competitionId }) => competitionId);

    expect([...preferencePoolIds].sort()).toEqual([...fixedPoolIds].sort());
    expect(preferencePoolIds).toContain(fixedSubjectMatch?.competitionId);
  });

  it("does not add a second editorial stage/team filter after official hard filtering", () => {
    const persona = competitionRankingHoldoutCases.find(({ id }) =>
      id === "rank-undergraduate-upper-medical-research"
    );
    expect(persona).toBeDefined();
    if (!persona) throw new Error("Missing medical quality fixture");

    const recalled = getCompetitionRecommendationCandidates(persona.profile, {
      now: new Date("2026-08-22T00:00:00.000Z")
    }).recommendations;
    const fixedSubjectMatch = recalled.find(({ competition }) =>
      hasDominantConfirmedSubjectMatch(
        assessCompetitionConfirmedSubjectAlignment(competition, persona.profile)
      )
    );
    expect(fixedSubjectMatch).toBeDefined();
    if (!fixedSubjectMatch) throw new Error("Missing fixed subject match");

    const editoriallyContradictory = {
      ...fixedSubjectMatch,
      competition: {
        ...fixedSubjectMatch.competition,
        recommendation: {
          ...fixedSubjectMatch.competition.recommendation,
          stages: { state: "known" as const, values: ["vocational" as const] },
          teamRequirement: { state: "known" as const, mode: "individual" as const }
        }
      }
    };
    const qualityIds = buildCompetitionFinalQualityPool(
      [editoriallyContradictory, ...recalled.filter(({ competitionId }) =>
        competitionId !== fixedSubjectMatch.competitionId
      )],
      persona.profile
    ).map(({ competitionId }) => competitionId);

    expect(qualityIds).toContain(fixedSubjectMatch.competitionId);
  });

  it("recovers fixed mechanical/hardware alternatives after the target is hard excluded", () => {
    const persona = competitionHardNegativePersonas.find(({ id }) =>
      id === "hard-negative-12-mechanical-engineering-innovation-full-time"
    );
    expect(persona).toBeDefined();
    if (!persona) throw new Error("Missing engineering hard-negative fixture");
    const recalled = getCompetitionRecommendationCandidates(persona.profile, {
      now: new Date("2026-08-23T00:00:00.000Z")
    }).recommendations;
    const quality = selectFinalQualityRecommendations(recalled, persona.profile);
    const relevantMechanicalAlternatives = new Set([
      "siemens-intelligent-manufacturing",
      "robocup-china",
      "intelligent-robot-creativity",
      "worldskills-china-selection",
      "world-vocational-skills",
      "worldskills",
      "robotac",
      "robocon",
      "raicom-robot-developer",
      "smart-car"
    ]);
    expect(recalled.map(({ competitionId }) => competitionId)).not.toContain(
      persona.forbiddenCompetitionId
    );
    expect(quality.length, quality.map(({ competitionId }) => competitionId).join(",")).toBeGreaterThanOrEqual(2);
    expect(
      quality.slice(0, 3).filter(({ competitionId }) =>
        relevantMechanicalAlternatives.has(competitionId)
      ).length,
      quality.map(({ competitionId }) => competitionId).join(",")
    ).toBeGreaterThanOrEqual(2);
    expect(quality.slice(0, 3).map(({ competitionId }) => competitionId)).not.toEqual(
      expect.arrayContaining([
        "ecommerce-innovation-creativity-entrepreneurship",
        "china-college-computer-design",
        "challenge-cup-entrepreneurship-plan"
      ])
    );

    const result = recommendCompetitions(persona.profile, {
      now: new Date("2026-08-23T00:00:00.000Z")
    });
    expect(result.recommendations).toHaveLength(3);
    expect(result.recommendations.map(({ competitionId }) => competitionId)).not.toContain(
      persona.forbiddenCompetitionId
    );
    expect(result.recommendations.filter(({ competitionId }) =>
      relevantMechanicalAlternatives.has(competitionId)
    ).length).toBeGreaterThanOrEqual(2);
    expect(result.noMatchReason).toBeUndefined();
  });

  it("keeps all scored entries in fit order for every timing preference", () => {
    const strictProfile: CompetitionRecommendationProfileV5 = {
      profileVersion: "competition-profile.v5",
      questionnaireVersion: "competition-questionnaire.v1",
      confirmedFields: [...COMPETITION_PROFILE_FIELD_IDS],
      confirmedFacts: [],
      stage: baseProfile.stage,
      majorFields: [...baseProfile.majorFields],
      specificSubjects: ["information-communication"],
      skills: [...baseProfile.skills],
      interests: [...baseProfile.interests],
      taskFormats: ["software"],
      goals: [...baseProfile.goals],
      preferredOutputs: [...baseProfile.preferredOutputs],
      startingPoint: baseProfile.startingPoint,
      experienceLevel: baseProfile.experienceLevel,
      weeklyCommitment: baseProfile.weeklyCommitment,
      participationTiming: "current-cycle",
      teamStatus: baseProfile.teamStatus,
      availableResources: [...baseProfile.availableResources],
      participationMode: baseProfile.participationMode,
      evidence: [...baseProfile.evidence]
    };
    const scored = scoreCompetitionRecommendations(getCompetitionCatalog(), strictProfile, {
      now: new Date("2026-08-22T00:00:00.000Z")
    }).slice(0, 12);
    expect(scored).toHaveLength(12);
    const tiered = scored.map((item, index) => ({
      ...item,
      availability: index < 2
        ? { ...item.availability, tier: "current-or-upcoming" as const, tierRank: 1 as const }
        : index < 7
          ? { ...item.availability, tier: "unknown" as const, tierRank: 2 as const }
          : { ...item.availability, tier: "closed" as const, tierRank: 3 as const }
    }));

    const recalled = selectCompetitionRecommendationRecall(tiered, strictProfile);
    expect(recalled.map(item => item.competition.id)).toEqual(tiered.map(item => item.competition.id));
    expect(selectCompetitionRecommendationRecall(tiered, {...strictProfile,participationTiming:"next-cycle-ok"})).toEqual(recalled);
  });

  it("honors decisive counterfactuals in the deterministic fallback", () => {
    const now = new Date("2026-08-22T00:00:00.000Z");
    const icpc = findCatalogCompetition("icpc-programming")!;
    const electronicDesign = findCatalogCompetition("national-college-electronic-design")!;
    const mathModeling = findCatalogCompetition("national-college-math-modeling")!;
    const challengeCup = findCatalogCompetition("challenge-cup-academic-science")!;

    const algorithmProfile: CompetitionRecommendationProfileV4 = {
      ...baseProfile,
      skills: ["programming"],
      weeklyCommitment: "over-10",
      teamStatus: "ready"
    };
    const algorithmScore = scoreLegacyCompetition(
      icpc,
      algorithmProfile,
      now,
      transcript("algorithm-competition", "team-3-same-unit")
    );
    const hardwareAnswerScore = scoreLegacyCompetition(
      icpc,
      algorithmProfile,
      now,
      transcript("hardware-build", "team-3-same-unit")
    );
    expect(algorithmScore!.baseMatchScore - hardwareAnswerScore!.baseMatchScore).toBeGreaterThanOrEqual(12);

    const removedTeamAnswerScore = scoreLegacyCompetition(
      icpc,
      algorithmProfile,
      now,
      transcript("algorithm-competition", "team-3-mixed-unit")
    );
    expect(removedTeamAnswerScore).not.toBeNull();
    expect(removedTeamAnswerScore!.baseMatchScore).toBe(algorithmScore!.baseMatchScore);

    const lowTimeScore = scoreLegacyCompetition(
      icpc,
      { ...algorithmProfile, weeklyCommitment: "under-5" },
      now,
      transcript("algorithm-competition", "team-3-same-unit")
    );
    expect(algorithmScore!.baseMatchScore).toBeGreaterThan(lowTimeScore!.baseMatchScore);

    const noEquipmentScore = scoreLegacyCompetition(
      electronicDesign,
      { ...baseProfile, majorFields: ["engineering"], skills: ["hardware", "programming"], availableResources: ["none"] },
      now,
      transcript("hardware-build", "team-3-same-unit")
    );
    const equippedScore = scoreLegacyCompetition(
      electronicDesign,
      { ...baseProfile, majorFields: ["engineering"], skills: ["hardware", "programming"], availableResources: ["lab", "equipment"] },
      now,
      transcript("hardware-build", "team-3-same-unit")
    );
    expect(noEquipmentScore).not.toBeNull();
    expect(equippedScore).not.toBeNull();
    expect(equippedScore!.baseMatchScore).toBeGreaterThan(noEquipmentScore!.baseMatchScore);

    expect(scoreLegacyCompetition(
      electronicDesign,
      { ...baseProfile, majorFields: ["engineering"], skills: ["hardware", "programming"], availableResources: ["lab", "equipment"] },
      now,
      transcript("hardware-build", "team-2")
    )).not.toBeNull();

    expect(scoreLegacyCompetition(
      mathModeling,
      { ...baseProfile, stage: "undergraduate-2", majorFields: ["mathematics"] },
      now,
      transcript("modeling-intensive", "team-3-same-unit")
    )).not.toBeNull();
    expect(scoreLegacyCompetition(
      mathModeling,
      { ...baseProfile, stage: "master", majorFields: ["mathematics"] },
      now,
      transcript("modeling-intensive", "team-3-same-unit")
    )).toBeNull();

    const originalResearchProfile: CompetitionRecommendationProfileV4 = {
      ...baseProfile,
      majorFields: ["humanities"],
      skills: ["research", "data-analysis", "writing"],
      interests: ["academic-research"],
      preferredOutputs: ["research-paper"],
      evidence: ["paper"]
    };
    expect(scoreLegacyCompetition(
      challengeCup,
      originalResearchProfile,
      now,
      transcript("research-provenance", "solo")
    )).not.toBeNull();
    const beforeRemovedEligibilityAnswer = scoreLegacyCompetition(
      challengeCup,
      originalResearchProfile,
      now,
      projectLegacyCompetitionPreferenceTranscript(
        eligibilityTranscript("research-provenance", challengeCup.id, "ineligible")
      )
    );
    expect(beforeRemovedEligibilityAnswer).not.toBeNull();
    expect(beforeRemovedEligibilityAnswer!.eligibility).toEqual(
      scoreLegacyCompetition(challengeCup, originalResearchProfile, now)!.eligibility
    );
  });
});
