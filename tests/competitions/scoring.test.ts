import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { competitions, type Competition } from "@/content/competitions";
import {
  COMPETITION_CLARIFICATION_SIGNAL_VERSION,
  COMPETITION_GOAL_WEIGHT_PRESETS,
  COMPETITION_GOAL_WEIGHT_PRESET_VERSION,
  COMPETITION_SEMANTIC_ARCHETYPE_WEIGHTS,
  buildCompetitionQualificationSnapshot,
  getHardFilterReason,
  scoreCompetition,
  scoreCompetitionRecommendations,
  semanticArchetypeFit,
  selectCompetitionRecommendations,
  type ScoredCompetition
} from "@/lib/competitions/scoring";
import {
  calibrateCompetitionScore,
  getCompetitionRecommendationCandidates,
  recommendCompetitions,
  selectFinalThreeRecommendations
} from "@/lib/competitions/recommendation-engine";
import { projectLegacyCompetitionPreferenceTranscript } from "@/lib/competitions/legacy-preference-adapter";
import {
  getLegacyCompetitionHardFilterReason,
  getLegacyCompetitionRecommendationCandidates,
  normalizeLegacyCompetitionScoringProfile,
  recommendLegacyCompetitions,
  sanitizeLegacyCompetitionScoringTranscript,
  scoreLegacyCompetition,
  scoreLegacyCompetitionRecommendations
} from "@/lib/competitions/legacy-scoring-adapter";
import {
  COMPETITION_PROFILE_FIELD_IDS,
  type CompetitionDynamicExchangeV2,
  type CompetitionDynamicExchangeV3,
  type CompetitionRecommendationProfileV2,
  type CompetitionRecommendationProfileV3,
  type CompetitionRecommendationProfileV4,
  type CompetitionRecommendationProfileV5
} from "@/types/competition-recommendation";

const profile: CompetitionRecommendationProfileV4 = {
  profileVersion: "competition-profile.v4",
  stage: "undergraduate-3",
  majorFields: ["computer-science", "mathematics"],
  skills: ["programming", "data-analysis", "research"],
  interests: ["ai", "innovation"],
  goals: ["project"],
  preferredOutputs: ["software"],
  startingPoint: "prototype",
  weeklyCommitment: "5-10",
  teamStatus: "partial",
  availableResources: ["mentor"],
  region: "east",
  participationMode: "flexible",
  experienceLevel: "participated",
  evidence: ["project"]
};

const profileV5: CompetitionRecommendationProfileV5 = {
  profileVersion: "competition-profile.v5",
  questionnaireVersion: "competition-questionnaire.v1",
  confirmedFields: [...COMPETITION_PROFILE_FIELD_IDS],
  confirmedFacts: [],
  stage: profile.stage,
  majorFields: [...profile.majorFields],
  specificSubjects: ["information-communication", "statistics-mathematics"],
  skills: [...profile.skills],
  interests: [...profile.interests],
  goals: [...profile.goals],
  preferredOutputs: [...profile.preferredOutputs],
  startingPoint: profile.startingPoint,
  weeklyCommitment: profile.weeklyCommitment,
  teamStatus: profile.teamStatus,
  availableResources: [...profile.availableResources],
  participationMode: profile.participationMode,
  participationTiming: "flexible",
  taskFormats: ["software"],
  experienceLevel: profile.experienceLevel,
  evidence: [...profile.evidence]
};

function competitionWith(overrides: Partial<Competition["recommendation"]>): Competition {
  const base = competitions.find((competition) => competition.id === "china-software-cup")!;
  return { ...base, recommendation: { ...base.recommendation, ...overrides } };
}

describe("competition scoring", () => {
  it("keeps legacy adapters out of current scorer, recommendation and API modules", () => {
    const productionFiles = [
      "src/lib/competitions/scoring.ts",
      "src/lib/competitions/recommendation-engine.ts",
      "src/lib/ai/competition-ranking.ts",
      "src/lib/ai/competition-clarify.ts",
      "src/app/api/ai/competition-clarify/route.ts",
      "src/app/api/ai/competition-recommend/route.ts"
    ];
    for (const file of productionFiles) {
      const source = readFileSync(path.join(process.cwd(), file), "utf8");
      expect(source, file).not.toMatch(/legacy-(?:scoring|preference)-adapter/);
      expect(source, file).not.toContain("__legacyCompetition");
    }

    for (const file of productionFiles.slice(0, 2)) {
      const source = readFileSync(path.join(process.cwd(), file), "utf8");
      expect(source, file).not.toMatch(/CompetitionRecommendationProfileV[234]/);
      expect(source, file).not.toContain("CompetitionDynamicExchangeV2");
    }
  });

  it("keeps V2/V3/V4 profiles outside the current scorer and recommendation API", () => {
    const candidate = competitionWith({});
    const profileV2 = {} as CompetitionRecommendationProfileV2;
    const profileV3 = {} as CompetitionRecommendationProfileV3;
    if (false) {
      // @ts-expect-error Current scoring accepts only the signed V5 profile.
      scoreCompetition(candidate, profileV2);
      // @ts-expect-error Current scoring accepts only the signed V5 profile.
      scoreCompetition(candidate, profileV3);
      // @ts-expect-error Current scoring accepts only the signed V5 profile.
      scoreCompetition(candidate, profile);
      // @ts-expect-error Current recommendation accepts only the signed V5 profile.
      getCompetitionRecommendationCandidates(profile);
    }
    expect(scoreLegacyCompetition(candidate, profile)).not.toBeNull();
  });

  it("drops legacy eligibility and team families before compatibility scoring", () => {
    const removedTranscript = [{
      question: {
        questionId: "legacy_team",
        signalKey: "team-eligibility",
        prompt: "旧资格问题",
        selection: "single",
        options: [{ value: "team-3-same-unit", label: "旧答案" }],
        allowsNote: true,
        maxNoteLength: 120
      },
      answer: { selectedValues: ["team-3-same-unit"], note: "不得进入评分" }
    }, {
      question: {
        questionId: "legacy_eligibility",
        signalKey: "eligibility:china-software-cup",
        prompt: "旧资格问题",
        selection: "single",
        options: [{ value: "eligible", label: "旧答案" }],
        allowsNote: true,
        maxNoteLength: 120
      },
      answer: { selectedValues: ["eligible"], note: "不得进入评分" }
    }] as CompetitionDynamicExchangeV2[];

    expect(sanitizeLegacyCompetitionScoringTranscript(removedTranscript)).toEqual([]);
  });

  it("hard-filters explicit stage ineligibility while retaining uncertain facts", () => {
    const unknown = competitionWith({ stages: { state: "unknown" }, teamRequirement: { state: "unknown" } });
    const wrongStage = competitionWith({
      stages: { state: "known", values: ["master"] },
      source: {
        url: "https://example.test/rules",
        sourceType: "organizer",
        verifiedAt: "2026-08-22",
        evidenceRef: "official:fixture:stage-rules",
        facts: ["stages", "eligibility"]
      },
      eligibility: {
        state: "verified",
        notes: [],
        source: {
          url: "https://example.test/rules",
          sourceType: "organizer",
          verifiedAt: "2026-08-22",
          evidenceRef: "official:fixture:stage-rules",
          facts: ["stages", "eligibility"]
        }
      }
    });
    const requiresTeam = competitionWith({ teamRequirement: { state: "known", mode: "team", minSize: 3 } });

    expect(getLegacyCompetitionHardFilterReason(unknown, profile)).toBeNull();
    expect(getLegacyCompetitionHardFilterReason(wrongStage, profile)).toBe("stage-ineligible");
    expect(getLegacyCompetitionHardFilterReason(requiresTeam, { ...profile, teamStatus: "solo" })).toBeNull();
  });

  it("keeps verified and unverified cancellations out of qualification", () => {
    const cancelledSchedule = {
      ...competitionWith({}).recommendation.schedule,
      state: "cancelled" as const
    };
    const unverified = competitionWith({
      schedule: cancelledSchedule,
      source: { url: "", sourceType: "unknown", facts: [] },
      supportingSources: [],
      eligibility: undefined
    });

    expect(getHardFilterReason(unverified, profileV5)).toBeNull();
    expect(buildCompetitionQualificationSnapshot(profileV5, [unverified]).entries[0]).toMatchObject({
      status: "needs_clarification",
      hardFilterReason: null,
      reasons: ["当届官方资格仍需复核。"]
    });

    const scheduleSource = {
      url: "https://example.test/official-cancellation",
      sourceType: "organizer" as const,
      verifiedAt: "2026-08-25",
      evidenceRef: "official:fixture:cancelled-schedule",
      facts: ["schedule"] as const
    };
    const verified = competitionWith({
      schedule: cancelledSchedule,
      source: scheduleSource,
      supportingSources: [],
      eligibility: undefined
    });
    expect(getHardFilterReason(verified, profileV5)).toBeNull();
    expect(buildCompetitionQualificationSnapshot(profileV5, [verified]).entries[0]).toMatchObject({
      status: "needs_clarification",
      hardFilterReason: null,
      sourceRefs: []
    });
  });

  it("keeps the current 0.43 semantic weight and the isolated old-profile 0.55 policy", () => {
    expect(COMPETITION_SEMANTIC_ARCHETYPE_WEIGHTS).toEqual({
      currentProfile: 0.43,
      legacyCompatibility: 0.55
    });
    const normalized = normalizeLegacyCompetitionScoringProfile(profile);
    const differences = competitions.flatMap((competition) => {
      const current = scoreCompetition(competition, normalized);
      const compatible = scoreLegacyCompetition(competition, profile);
      return current && compatible && current.baseMatchScore !== compatible.baseMatchScore
        ? [{ competitionId: competition.id, current: current.baseMatchScore, compatible: compatible.baseMatchScore }]
        : [];
    });
    expect(differences.length).toBeGreaterThan(0);
  });

  it("hard-filters a resource confirmed impossible only when an official source marks it required", () => {
    const officialSource = {
      url: "https://example.test/official-resource-rules",
      sourceType: "organizer" as const,
      verifiedAt: "2026-08-23",
      evidenceRef: "official:fixture:resource-rules",
      facts: ["eligibility", "requiredResources"] as const
    };
    const candidate = competitionWith({
      requiredResources: ["mentor", "lab"],
      source: officialSource,
      eligibility: { state: "verified", notes: [], source: officialSource }
    });

    expect(getHardFilterReason(candidate, {
      ...profileV5,
      decisionContext: {unavailableResources:["lab"]},
      availableResources: ["mentor"]
    })).toBe("required-resource-unavailable");
    expect(getHardFilterReason(candidate, {
      ...profileV5,
      availableResources: ["mentor", "lab"]
    })).toBeNull();

    const editorialOnly = competitionWith({
      requiredResources: ["mentor", "lab"],
      source: { ...officialSource, facts: ["eligibility"] },
      eligibility: {
        state: "verified",
        notes: [],
        source: { ...officialSource, facts: ["eligibility"] }
      }
    });
    expect(getHardFilterReason(editorialOnly, {
      ...profileV5,
      decisionContext: {unavailableResources:["lab"]},
      availableResources: ["mentor"]
    })).toBeNull();
  });

  it("trusts each official fact independently when aggregate eligibility remains partial", () => {
    const unknownSource = {
      url: "",
      sourceType: "unknown" as const,
      facts: [] as const
    };
    const supportingSource = {
      url: "https://example.test/partial-entry-rules",
      sourceType: "organizer" as const,
      verifiedAt: "2026-08-23",
      evidenceRef: "official:fixture:partial-entry-rules",
      facts: ["stages", "teamRequirement", "eligibility"] as const
    };
    const partialEligibility = {
      state: "partial" as const,
      requiresFullTime: true,
      sameInstitutionTeam: true,
      notes: ["其他资格项仍待核验。"],
      source: unknownSource
    };
    const partialBase = {
      source: unknownSource,
      supportingSources: [supportingSource],
      eligibility: partialEligibility
    };

    expect(getHardFilterReason(competitionWith({
      ...partialBase,
      stages: { state: "known", values: ["master"] }
    }), profileV5)).toBe("stage-ineligible");

    expect(getHardFilterReason(competitionWith({
      ...partialBase,
      stages: { state: "unrestricted" },
      teamRequirement: { state: "unknown" }
    }), {
      ...profileV5, decisionContext:{fixedTeam:true},
      confirmedFacts: ["enrollmentStatus"],
      enrollmentStatus: "part-time-student"
    })).toBe("full-time-status-ineligible");

    expect(getHardFilterReason(competitionWith({
      ...partialBase,
      stages: { state: "unrestricted" },
      teamRequirement: { state: "unknown" }
    }), {
      ...profileV5, decisionContext:{fixedTeam:true},
      confirmedFacts: ["teamUnit"],
      teamUnit: "mixed-unit"
    })).toBe("same-institution-team-ineligible");

    expect(getHardFilterReason(competitionWith({
      ...partialBase,
      stages: { state: "unrestricted" },
      eligibility: { ...partialEligibility, requiresFullTime: false, sameInstitutionTeam: false },
      teamRequirement: { state: "known", mode: "individual", minSize: 1, maxSize: 1 }
    }), {
      ...profileV5, decisionContext:{fixedTeam:true},
      confirmedFacts: ["teamSize"],
      teamSize: "three"
    })).toBe("team-size-ineligible");

    const missingEvidenceRef = {
      ...supportingSource,
      evidenceRef: undefined
    };
    expect(getHardFilterReason(competitionWith({
      ...partialBase,
      supportingSources: [missingEvidenceRef],
      stages: { state: "known", values: ["master"] }
    }), profileV5)).toBeNull();
  });

  it("keeps explanatory notes out of pending reasons and preserves real blockers", () => {
    const source = {
      url: "https://example.test/partial-qualification",
      sourceType: "organizer" as const,
      verifiedAt: "2026-08-25",
      evidenceRef: "official:fixture:partial-qualification",
      facts: ["eligibility", "stages", "teamRequirement"] as const
    };
    const explanatoryNote = "已确认该赛事面向高校学生并持续举办。";
    const partial = competitionWith({
      stages: { state: "unrestricted" },
      teamRequirement: { state: "unrestricted" },
      source,
      eligibility: {
        state: "partial",
        notes: [explanatoryNote],
        source
      }
    });
    const assessed = scoreCompetition(partial, profileV5)?.eligibility;
    expect(assessed).toMatchObject({ status: "needs_clarification" });
    expect(assessed?.reasons).not.toContain(explanatoryNote);
    expect(assessed?.reasons.join(" ")).toMatch(/未结构化.*资格事实/);

    const realBlocker = "参赛者年龄是否满足当届上限尚未确认。";
    const blocked = scoreCompetition(competitionWith({
      ...partial.recommendation,
      eligibility: {
        ...partial.recommendation.eligibility!,
        blockingClarifications: [realBlocker]
      }
    }), profileV5)?.eligibility;
    expect(blocked).toMatchObject({ status: "needs_clarification" });
    expect(blocked?.reasons).toContain(realBlocker);
  });

  it("lets fully evidenced track rules override only a partial mother note", () => {
    const motherSource = {
      url: "https://example.test/mother-summary",
      sourceType: "organizer" as const,
      verifiedAt: "2026-08-25",
      evidenceRef: "official:fixture:partial-mother",
      facts: ["eligibility"] as const
    };
    const trackSource = {
      url: "https://example.test/track-rules",
      sourceType: "organizer" as const,
      verifiedAt: "2026-08-25",
      evidenceRef: "official:fixture:verified-track",
      facts: ["trackEligibility"] as const
    };
    const motherNote = "母赛另有多个规则尚未统一描述。";
    const competition = competitionWith({
      stages: { state: "unknown" },
      teamRequirement: { state: "unknown" },
      source: motherSource,
      supportingSources: [trackSource],
      eligibility: { state: "partial", notes: [motherNote], source: motherSource },
      tracks: [{
        id: "verified-undergraduate-team",
        label: "已核验本科团队赛道",
        stages: { state: "known", values: ["undergraduate-3"] },
        teamRequirement: { state: "known", mode: "team", minSize: 2, maxSize: 2 },
        eligibilityNotes: ["该赛道面向本科生两人团队。"],
        evidenceRef: trackSource.evidenceRef,
        verifiedFacts: ["eligibility", "stages", "teamRequirement"]
      }]
    });
    const fixedProfile: CompetitionRecommendationProfileV5 = {
      ...profileV5,
      confirmedFacts: ["teamSize"],
      teamSize: "two"
    };
    expect(scoreCompetition(competition, fixedProfile)?.eligibility).toMatchObject({
      status: "needs_clarification"
    });

    const snapshot = buildCompetitionQualificationSnapshot(fixedProfile, [competition]);
    expect(snapshot.entries[0].tracks[0]).toMatchObject({
      status: "eligible",
      reasons: []
    });
    const baseline = scoreCompetitionRecommendations([competition], fixedProfile);
    expect(baseline[0].eligibility).toMatchObject({ status: "eligible", reasons: [] });
    expect(baseline[0].eligibility.reasons).not.toContain(motherNote);

    const preferenceTranscripts: CompetitionDynamicExchangeV3[][] = [
      [{
        question: {
          questionId: "fit_invariance",
          signalKey: "competition-fit",
          prompt: "能力偏好",
          selection: "multiple",
          maxSelections: 2,
          options: [
            { value: "software-engineering", label: "软件工程" },
            { value: "algorithm-competition", label: "算法竞赛" }
          ],
          allowsNote: true,
          maxNoteLength: 120,
          impact: "material",
          estimatedPreferenceOutcomeChanges: 2
        },
        answer: { selectedValues: ["software-engineering"] }
      }],
      [{
        question: {
          questionId: "goal_invariance",
          signalKey: "candidate-goal-tradeoff",
          prompt: "目标偏好",
          selection: "multiple",
          maxSelections: 2,
          options: [{ value: "project", label: "项目经历" }],
          allowsNote: true,
          maxNoteLength: 120,
          impact: "material",
          estimatedPreferenceOutcomeChanges: 2
        },
        answer: { selectedValues: ["project"] }
      }]
    ];
    for (const transcript of preferenceTranscripts) {
      expect(scoreCompetitionRecommendations([competition], fixedProfile, { transcript })[0]
        .eligibility).toEqual(baseline[0].eligibility);
      expect(buildCompetitionQualificationSnapshot(fixedProfile, [competition]))
        .toEqual(snapshot);
    }
    expect(competition.recommendation.eligibility?.state).toBe("partial");
  });

  it("gives unknown catalog dimensions no credit instead of re-normalizing other dimensions upward", () => {
    const unknownAccess = competitionWith({
      regions: { state: "unknown" },
      participationModes: ["unknown"],
      dataCompleteness: 1
    });
    const knownAccess = competitionWith({
      regions: { state: "unrestricted" },
      participationModes: ["remote"],
      dataCompleteness: 1
    });

    const unknownScore = scoreLegacyCompetition(unknownAccess, profile, new Date("2026-06-01T00:00:00Z"))!;
    const knownScore = scoreLegacyCompetition(
      knownAccess,
      { ...profile, participationMode: "remote" },
      new Date("2026-06-01T00:00:00Z")
    )!;

    expect(unknownScore.scoreBreakdown.availabilityTiming!).toBeLessThan(
      knownScore.scoreBreakdown.availabilityTiming!
    );
    expect(unknownScore.baseMatchScore).toBeLessThan(knownScore.baseMatchScore);
    expect(unknownScore.scoreBreakdown.completenessPenalty).toBe(0);
  });

  it("uses catalog confidence as a positive five-point dimension without a second penalty", () => {
    const complete = scoreLegacyCompetition(competitionWith({ dataCompleteness: 1 }), profile, new Date("2026-06-01T00:00:00Z"))!;
    const incomplete = scoreLegacyCompetition(competitionWith({ dataCompleteness: 0 }), profile, new Date("2026-06-01T00:00:00Z"))!;

    expect(complete.scoreBreakdown.completenessPenalty).toBe(0);
    expect(incomplete.scoreBreakdown.completenessPenalty).toBe(0);
    expect(complete.scoreBreakdown.dataConfidence).toBeGreaterThan(incomplete.scoreBreakdown.dataConfidence!);
    expect(complete.baseMatchScore).toBeGreaterThan(incomplete.baseMatchScore);
    expect(complete.baseMatchScore - incomplete.baseMatchScore).toBeLessThanOrEqual(5);
  });

  it("uses the structured credibility total inside the five-point data-confidence dimension", () => {
    const baseline = competitionWith({});
    const credibility = baseline.recommendation.credibility!;
    const highCredibility = scoreLegacyCompetition(competitionWith({
      credibility: { ...credibility, total: 100 }
    }), profile, new Date("2026-06-01T00:00:00Z"))!;
    const lowCredibility = scoreLegacyCompetition(competitionWith({
      credibility: { ...credibility, total: 0 }
    }), profile, new Date("2026-06-01T00:00:00Z"))!;

    expect(highCredibility.scoreBreakdown.dataConfidence).toBeGreaterThan(
      lowCredibility.scoreBreakdown.dataConfidence!
    );
    expect(highCredibility.baseMatchScore - lowCredibility.baseMatchScore).toBe(2.5);
  });

  it("uses versioned priorities when two goals are selected instead of an equal average", () => {
    const projectOnlyValue = competitionWith({
      goalValues: {
        project: 1,
        award: 0,
        postgraduate: 0,
        employment: 0,
        portfolio: 0,
        entrepreneurship: 0,
        networking: 0
      }
    });
    const awardOnlyValue = competitionWith({
      goalValues: {
        project: 0,
        award: 1,
        postgraduate: 0,
        employment: 0,
        portfolio: 0,
        entrepreneurship: 0,
        networking: 0
      }
    });
    const projectWeighted = scoreLegacyCompetition(projectOnlyValue, { ...profile, goals: ["project", "award"] })!;
    const awardWeighted = scoreLegacyCompetition(awardOnlyValue, { ...profile, goals: ["project", "award"] })!;

    expect(COMPETITION_GOAL_WEIGHT_PRESET_VERSION).toMatch(/^goal-priorities-/);
    expect(COMPETITION_GOAL_WEIGHT_PRESETS.award).toBeGreaterThan(COMPETITION_GOAL_WEIGHT_PRESETS.networking);
    expect(awardWeighted.scoreBreakdown.goal!).toBeGreaterThan(projectWeighted.scoreBreakdown.goal!);
    expect(projectWeighted.scoreBreakdown.goal).not.toBe(awardWeighted.scoreBreakdown.goal);
  });

  it("keeps legacy preferred-output compatibility behind the V5 preference-only signal version", () => {
    const shared = competitionWith({
      dataCompleteness: 1,
      interests: [],
      preferredOutputs: []
    });
    const aiCandidate: Competition = {
      ...shared,
      id: "ai-clarification-fixture",
      category: "人工智能 / 软件",
      recommendation: {
        ...shared.recommendation,
        interests: ["ai", "data"],
        preferredOutputs: ["software"]
      }
    };
    const designCandidate: Competition = {
      ...shared,
      id: "design-clarification-fixture",
      category: "数字媒体 / 创意设计",
      recommendation: {
        ...shared.recommendation,
        interests: ["design", "media"],
        preferredOutputs: ["creative-work"]
      }
    };
    const neutralProfile: CompetitionRecommendationProfileV4 = {
      ...profile,
      interests: ["innovation"]
    };
    const aiFirst = scoreLegacyCompetitionRecommendations(
      [aiCandidate, designCandidate],
      { ...neutralProfile, preferredOutputs: ["software"] },
      { now: new Date("2026-06-01T00:00:00Z") }
    );
    const designFirst = scoreLegacyCompetitionRecommendations(
      [aiCandidate, designCandidate],
      { ...neutralProfile, preferredOutputs: ["creative-work"] },
      { now: new Date("2026-06-01T00:00:00Z") }
    );

    expect(COMPETITION_CLARIFICATION_SIGNAL_VERSION).toMatch(/^profile-v5-preference-only-signals-/);
    expect(aiFirst[0].competition.id).toBe(aiCandidate.id);
    expect(designFirst[0].competition.id).toBe(designCandidate.id);
    expect(aiFirst[0].baseMatchScore).toBeGreaterThan(aiFirst[1].baseMatchScore);
    expect(designFirst[0].baseMatchScore).toBeGreaterThan(designFirst[1].baseMatchScore);
  });

  it("keeps professional/task signals separate from skill/evidence signals", () => {
    const candidate = competitionWith({
      majors: ["computer-science"],
      skills: ["programming"],
      interests: ["ai"],
      evidence: ["project"],
      fit: { signals: ["software-engineering"] }
    });
    const baseline = scoreCompetition(candidate, {
      ...profileV5,
      majorFields: ["computer-science"],
      skills: ["programming"],
      taskFormats: ["software"],
      evidence: ["project"]
    })!;
    const majorMismatch = scoreCompetition(candidate, {
      ...profileV5,
      majorFields: ["other"],
      skills: ["programming"],
      taskFormats: ["software"],
      evidence: ["project"]
    })!;
    const taskMismatch = scoreCompetition(candidate, {
      ...profileV5,
      majorFields: ["computer-science"],
      skills: ["programming"],
      taskFormats: ["career"],
      evidence: ["project"]
    })!;
    const skillMismatch = scoreCompetition(candidate, {
      ...profileV5,
      majorFields: ["computer-science"],
      skills: ["writing"],
      taskFormats: ["software"],
      evidence: ["project"]
    })!;
    const evidenceMissing = scoreCompetition(candidate, {
      ...profileV5,
      majorFields: ["computer-science"],
      skills: ["programming"],
      taskFormats: ["software"],
      evidence: ["none"]
    })!;

    expect(majorMismatch.scoreBreakdown.subjectTask).toBeLessThan(baseline.scoreBreakdown.subjectTask!);
    expect(taskMismatch.scoreBreakdown.subjectTask).toBeLessThan(baseline.scoreBreakdown.subjectTask!);
    expect(majorMismatch.scoreBreakdown.skillsEvidence).toBe(baseline.scoreBreakdown.skillsEvidence);
    expect(taskMismatch.scoreBreakdown.skillsEvidence).toBe(baseline.scoreBreakdown.skillsEvidence);
    expect(skillMismatch.scoreBreakdown.skillsEvidence).toBeLessThan(baseline.scoreBreakdown.skillsEvidence!);
    expect(evidenceMissing.scoreBreakdown.skillsEvidence).toBeLessThan(baseline.scoreBreakdown.skillsEvidence!);
    expect(skillMismatch.scoreBreakdown.subjectTask).toBe(baseline.scoreBreakdown.subjectTask);
    expect(evidenceMissing.scoreBreakdown.subjectTask).toBe(baseline.scoreBreakdown.subjectTask);
  });

  it("distinguishes explicit competitive-programming intent from broad AI algorithm application", () => {
    const competitiveProgrammingProfile: CompetitionRecommendationProfileV5 = {
      ...profileV5,
      taskFormats: ["algorithm", "software"],
      skills: ["programming", "data-analysis"],
      preferredOutputs: ["software"],
      interests: ["ai", "data"]
    };
    const programmingContest = competitions.find(({ id }) => id === "baidu-star")!;
    const broadAiAlgorithmContest = competitions.find(({ id }) => id === "global-campus-ai-algorithm")!;

    expect(semanticArchetypeFit(programmingContest, competitiveProgrammingProfile)).toBeGreaterThan(
      semanticArchetypeFit(broadAiAlgorithmContest, competitiveProgrammingProfile)!
    );
  });

  it("scores competition-track units, honors a confirmed track, and deduplicates to the parent", () => {
    const parent = competitionWith({
      tracks: [
        {
          id: "software-track",
          label: "软件赛道",
          preferredOutputs: ["software"],
          fitSignals: ["software-engineering"]
        },
        {
          id: "career-track",
          label: "职业赛道",
          preferredOutputs: ["career-plan"],
          fitSignals: ["career-evidence"]
        }
      ]
    });
    const automatic = scoreCompetitionRecommendations([parent], profileV5);
    expect(automatic).toHaveLength(1);
    expect(automatic[0].recommendedTrack).toEqual({ id: "software-track", label: "软件赛道" });

    const confirmedCareer = scoreCompetitionRecommendations([parent], profileV5, {
      transcript: [{
        question: {
          questionId: "dq_track_fixture",
          signalKey: `track:${parent.id}`,
          prompt: "你更适合哪个赛道？",
          selection: "single",
          options: [{ value: "career-track", label: "职业赛道" }],
          allowsNote: true,
          maxNoteLength: 120,
          impact: "material",
          estimatedPreferenceOutcomeChanges: 2
        },
        answer: { selectedValues: ["career-track"] }
      }]
    });
    expect(confirmedCareer).toHaveLength(1);
    expect(confirmedCareer[0].recommendedTrack).toEqual({ id: "career-track", label: "职业赛道" });

    const injectedUnknownTrack = scoreCompetitionRecommendations([parent], profileV5, {
      transcript: [{
        question: {
          questionId: "dq_track_injected",
          signalKey: `track:${parent.id}`,
          prompt: "候选赛道",
          selection: "single",
          options: [{ value: "missing-track", label: "不存在的赛道" }],
          allowsNote: true,
          maxNoteLength: 120,
          impact: "material",
          estimatedPreferenceOutcomeChanges: 2
        },
        answer: { selectedValues: ["missing-track"] }
      }]
    });
    expect(injectedUnknownTrack).toEqual([]);
  });

  it("keeps a selected track at its precomputed needs-clarification status", () => {
    const source = {
      url: "https://example.test/track-qualification",
      sourceType: "organizer" as const,
      verifiedAt: "2026-08-23",
      evidenceRef: "official:fixture:track-qualification",
      facts: ["eligibility"] as const
    };
    const parent = competitionWith({
      stages: { state: "unrestricted" },
      teamRequirement: { state: "unrestricted" },
      source,
      eligibility: { state: "verified", notes: [], source },
      tracks: [{
        id: "pending-track",
        label: "专项待核验赛道",
        fitSignals: ["software-engineering"],
        eligibilityNotes: ["该专项的当届分组条件仍需核验。"],
        blockingClarifications: ["该专项的当届分组条件仍需核验。"]
      }, {
        id: "settled-track",
        label: "已核验赛道",
        fitSignals: ["software-engineering"]
      }]
    });
    const snapshot = buildCompetitionQualificationSnapshot(profileV5, [parent]);
    const pendingSnapshotTrack = snapshot.entries[0].tracks.find(({ trackId }) =>
      trackId === "pending-track"
    );
    expect(pendingSnapshotTrack).toMatchObject({
      status: "needs_clarification",
      reasons: ["该专项的当届分组条件仍需核验。"]
    });

    const selected = scoreCompetitionRecommendations([parent], profileV5, {
      transcript: [{
        question: {
          questionId: "dq_track_pending_fixture",
          signalKey: `track:${parent.id}`,
          prompt: "这些候选方向中，你更想优先准备哪个赛道？",
          selection: "single",
          options: [
            { value: "pending-track", label: "专项待核验赛道" },
            { value: "settled-track", label: "已核验赛道" }
          ],
          allowsNote: true,
          maxNoteLength: 120,
          impact: "material",
          estimatedPreferenceOutcomeChanges: 2
        },
        answer: { selectedValues: ["pending-track"] }
      }]
    });
    expect(selected).toHaveLength(1);
    expect(selected[0].recommendedTrack?.id).toBe("pending-track");
    expect(selected[0].eligibility).toMatchObject({
      status: "needs_clarification",
      reasons: ["该专项的当届分组条件仍需核验。"]
    });
  });

  it("never hard-excludes from an unverified track override and propagates verified track evidence", () => {
    const eligibility = {
      state: "verified" as const,
      notes: [] as string[],
      source: {
        url: "https://example.test/parent-rules",
        sourceType: "organizer" as const,
        verifiedAt: "2026-08-23",
        evidenceRef: "official:fixture:parent-rules",
        facts: ["eligibility"] as const
      }
    };
    const unverifiedTrack = competitionWith({
      stages: { state: "unrestricted" },
      source: {
        url: "https://example.test/parent-rules",
        sourceType: "organizer",
        verifiedAt: "2026-08-23",
        evidenceRef: "official:fixture:parent-rules",
        facts: ["stages", "eligibility"]
      },
      eligibility,
      tracks: [{
        id: "graduate-only",
        label: "研究生赛道",
        stages: { state: "known", values: ["master"] },
        fitSignals: ["software-engineering"]
      }]
    });
    const unverifiedResult = scoreCompetitionRecommendations([unverifiedTrack], {
      ...profileV5,
      stage: "undergraduate-3"
    });
    expect(unverifiedResult).toHaveLength(1);

    const verifiedTrack = competitionWith({
      stages: { state: "unrestricted" },
      source: {
        url: "https://example.test/parent-rules",
        sourceType: "organizer",
        verifiedAt: "2026-08-23",
        evidenceRef: "official:fixture:parent-rules",
        facts: ["stages", "eligibility"]
      },
      supportingSources: [{
        url: "https://example.test/graduate-track-rules",
        sourceType: "organizer",
        verifiedAt: "2026-08-23",
        evidenceRef: "official:fixture:graduate-track",
        facts: ["trackEligibility"]
      }],
      eligibility,
      tracks: [{
        id: "graduate-only",
        label: "研究生赛道",
        stages: { state: "known", values: ["master"] },
        fitSignals: ["software-engineering"],
        evidenceRef: "official:fixture:graduate-track",
        verifiedFacts: ["stages"]
      }]
    });
    expect(scoreCompetitionRecommendations([verifiedTrack], {
      ...profileV5,
      stage: "undergraduate-3"
    })).toEqual([]);
    const eligibleTrack = scoreCompetitionRecommendations([verifiedTrack], {
      ...profileV5,
      stage: "master"
    });
    expect(eligibleTrack[0].recommendedTrack).toEqual({
      id: "graduate-only",
      label: "研究生赛道",
      evidenceRef: "official:fixture:graduate-track"
    });
  });

  it("does not label unknown user facts eligible without confirmation", () => {
    const official = competitionWith({
      source: {
        url: "https://example.test/eligibility",
        sourceType: "organizer",
        verifiedAt: "2026-08-23",
        evidenceRef: "official:fixture:eligibility",
        facts: ["eligibility", "teamRequirement"]
      },
      eligibility: {
        state: "verified",
        requiresFullTime: true,
        notes: [],
        source: {
          url: "https://example.test/eligibility",
          sourceType: "organizer",
          verifiedAt: "2026-08-23",
          evidenceRef: "official:fixture:eligibility",
          facts: ["eligibility", "teamRequirement"]
        }
      },
      teamRequirement: { state: "known", mode: "team", minSize: 3 }
    });
    const unknownFacts = scoreCompetition(official, profileV5)!;
    expect(unknownFacts.eligibility.status).toBe("needs_clarification");

    const confirmedFacts = scoreCompetition(official, {
      ...profileV5,
      confirmedFacts: ["enrollmentStatus", "teamSize"],
      enrollmentStatus: "full-time-student",
      teamSize: "three"
    })!;
    expect(confirmedFacts.eligibility.status).toBe("eligible");

    const explicitlyUnresolvedEnrollment: CompetitionRecommendationProfileV5 = {
      ...profileV5,
      confirmedFacts: ["enrollmentStatus", "teamSize"],
      enrollmentStatus: "other",
      teamSize: "three"
    };
    expect(getHardFilterReason(official, explicitlyUnresolvedEnrollment)).toBeNull();
    expect(scoreCompetition(official, explicitlyUnresolvedEnrollment)?.eligibility.status)
      .toBe("needs_clarification");
  });

  it("uses a verified first-higher-education cutoff only after explicit V5 confirmation", () => {
    const source = {
      url: "https://example.test/year-rules",
      sourceType: "organizer" as const,
      verifiedAt: "2026-08-23",
      evidenceRef: "official:fixture:year-rules",
      facts: ["eligibility", "firstHigherEducationYearCutoff"] as const
    };
    const withCutoff = (allowsAlternative: boolean) => competitionWith({
      source,
      eligibility: {
        state: "verified",
        notes: [],
        source,
        firstHigherEducationYearCutoff: {
          state: "verified",
          contestCycle: "2026",
          minimumYear: 2022,
          ...(allowsAlternative
            ? { alternativeMinimumBirthYear: 2003, petitionAvailable: true }
            : {}),
          determinationRule: "首次接受高等教育年份不得早于 2022 年。",
          notes: [],
          source
        }
      }
    });

    const unknown = scoreCompetition(withCutoff(false), profileV5)!;
    expect(getHardFilterReason(withCutoff(false), profileV5)).toBeNull();
    expect(unknown.eligibility).toMatchObject({
      status: "needs_clarification",
      reasons: [expect.stringContaining("尚未确认")]
    });

    const confirmedEligible: CompetitionRecommendationProfileV5 = {
      ...profileV5,
      confirmedFacts: ["firstHigherEducationYear"],
      firstHigherEducationYear: 2023
    };
    expect(scoreCompetition(withCutoff(false), confirmedEligible)!.eligibility.status).toBe("eligible");

    const confirmedTooEarly: CompetitionRecommendationProfileV5 = {
      ...confirmedEligible,
      firstHigherEducationYear: 2020
    };
    expect(getHardFilterReason(withCutoff(false), confirmedTooEarly)).toBe(
      "first-higher-education-year-ineligible"
    );

    // An official alternative birth-year route or petition prevents an
    // irreversible exclusion until that candidate-specific route is checked.
    expect(getHardFilterReason(withCutoff(true), confirmedTooEarly)).toBeNull();
    expect(scoreCompetition(withCutoff(true), confirmedTooEarly)!.eligibility.status).toBe(
      "needs_clarification"
    );

    const yearQuestion = {
      questionId: "dq_year_cutoff_fixture",
      signalKey: `eligibility:${withCutoff(false).id}` as const,
      prompt: "官方年限门槛为首次接受高等教育不早于 2022 年，你的情况是？",
      selection: "single" as const,
      options: [
        { value: "first-higher-ed-on-or-after", label: "2022 年或之后" },
        { value: "first-higher-ed-before", label: "早于 2022 年" },
        { value: "first-higher-ed-unsure", label: "不确定，需要再核对" }
      ],
      allowsNote: true as const,
      maxNoteLength: 120 as const
    };
    const removedEligibilityAnswer = [{
      question: yearQuestion,
      answer: { selectedValues: ["first-higher-ed-before"] }
    }] satisfies CompetitionDynamicExchangeV2[];
    // Production scoring is compile-time isolated from the old transcript.
    // The independent compatibility adapter drops qualification facts before
    // the V3-only scorer can see them.
    // @ts-expect-error V2 qualification exchanges are not accepted by the scorer.
    const compileTimeRejected: Parameters<typeof scoreCompetition>[3] = removedEligibilityAnswer;
    expect(compileTimeRejected).toBe(removedEligibilityAnswer);
    const projectedPreferenceTranscript = projectLegacyCompetitionPreferenceTranscript(
      removedEligibilityAnswer
    );
    expect(projectedPreferenceTranscript).toEqual([]);
    expect(scoreCompetition(
      withCutoff(false),
      profileV5,
      new Date("2026-08-23T00:00:00Z"),
      projectedPreferenceTranscript
    )!.eligibility.status).toBe("needs_clarification");
    expect(getHardFilterReason(withCutoff(true), profileV5)).toBeNull();
  });

  it("hard-excludes confirmed team size against both individual-only and team-only official rules", () => {
    const source = {
      url: "https://example.test/team-rules",
      sourceType: "organizer" as const,
      verifiedAt: "2026-08-23",
      evidenceRef: "official:fixture:team-rules",
      facts: ["eligibility", "teamRequirement"] as const
    };
    const official = {
      state: "verified" as const,
      notes: [] as string[],
      source
    };
    const teamOfThree: CompetitionRecommendationProfileV5 = {
      ...profileV5, decisionContext:{fixedTeam:true},
      confirmedFacts: ["teamSize"],
      teamSize: "three"
    };
    const solo: CompetitionRecommendationProfileV5 = {
      ...profileV5, decisionContext:{fixedTeam:true},
      confirmedFacts: ["teamSize"],
      teamSize: "solo"
    };
    const individualOnly = competitionWith({
      source,
      eligibility: official,
      teamRequirement: { state: "known", mode: "individual", minSize: 1, maxSize: 1 }
    });
    const teamOnly = competitionWith({
      source,
      eligibility: official,
      teamRequirement: { state: "known", mode: "team" }
    });
    expect(getHardFilterReason(individualOnly, teamOfThree)).toBe("team-size-ineligible");
    expect(getHardFilterReason(teamOnly, solo)).toBe("team-size-ineligible");
  });

  it("projects only preference signals across the isolated V2 compatibility boundary", () => {
    const legacyTranscript: CompetitionDynamicExchangeV2[] = [
      {
        question: {
          questionId: "legacy_fit",
          signalKey: "competition-fit",
          prompt: "能力偏好",
          selection: "single",
          options: [
            { value: "algorithm-competition", label: "算法竞赛" },
            { value: "product-validation", label: "产品验证" }
          ],
          allowsNote: true,
          maxNoteLength: 120
        },
        answer: {
          selectedValues: ["algorithm-competition"],
          note: "LEGACY_NOTE_MUST_NOT_REACH_V3"
        }
      },
      {
        question: {
          questionId: "legacy_track",
          signalKey: "track:fixture",
          prompt: "赛道偏好",
          selection: "single",
          options: [
            { value: "software", label: "软件" },
            { value: "career", label: "职业" }
          ],
          allowsNote: true,
          maxNoteLength: 120
        },
        answer: { selectedValues: ["software"] }
      },
      {
        question: {
          questionId: "legacy_team",
          signalKey: "team-eligibility",
          prompt: "旧团队资格题",
          selection: "single",
          options: [
            { value: "team-3-same-unit", label: "三人同校" },
            { value: "unsure", label: "不确定" }
          ],
          allowsNote: true,
          maxNoteLength: 120
        },
        answer: { selectedValues: ["team-3-same-unit"] }
      },
      {
        question: {
          questionId: "legacy_eligibility",
          signalKey: "eligibility:fixture",
          prompt: "旧资格题",
          selection: "single",
          options: [
            { value: "eligible", label: "符合" },
            { value: "ineligible", label: "不符合" }
          ],
          allowsNote: true,
          maxNoteLength: 120
        },
        answer: { selectedValues: ["eligible"] }
      }
    ];

    const projected = projectLegacyCompetitionPreferenceTranscript(legacyTranscript);
    expect(projected.map(({ question }) => question.signalKey)).toEqual([
      "competition-fit",
      "track:fixture"
    ]);
    expect(projected.map(({ answer }) => answer.selectedValues)).toEqual([
      ["algorithm-competition"],
      ["software"]
    ]);
    expect(projected.every(({ question }) =>
      question.impact === "optional" && question.estimatedPreferenceOutcomeChanges === 1
    )).toBe(true);
    expect(JSON.stringify(projected)).not.toContain("LEGACY_NOTE_MUST_NOT_REACH_V3");
  });

  it("averages only applicable maturity and current team/resource inputs", () => {
    const candidate = competitionWith({
      difficulty: "balanced",
      weeklyHours: ["5-10"],
      teamRequirement: { state: "known", mode: "team", minSize: 2 },
      requiredResources: [],
      helpfulResources: ["mentor"],
      usefulResources: ["mentor"],
      fit: { signals: ["software-engineering"] }
    });
    const withoutStartingPointMetadata = scoreCompetition(candidate, {
      ...profileV5,
      experienceLevel: "participated",
      weeklyCommitment: "5-10",
      teamStatus: "ready",
      availableResources: ["mentor"]
    })!;
    const withMatchingStartingPointMetadata = scoreCompetition({
      ...candidate,
      recommendation: {
        ...candidate.recommendation,
        fit: {
          ...candidate.recommendation.fit,
          signals: candidate.recommendation.fit?.signals ?? [],
          startingPoints: [profileV5.startingPoint]
        }
      }
    }, {
      ...profileV5,
      experienceLevel: "participated",
      weeklyCommitment: "5-10",
      teamStatus: "ready",
      availableResources: ["mentor"]
    })!;

    expect(withoutStartingPointMetadata.scoreBreakdown.maturity).toBe(
      withMatchingStartingPointMetadata.scoreBreakdown.maturity
    );
    expect(withoutStartingPointMetadata.scoreBreakdown.teamResources).toBe(15);

    const unknownTeamMetadata = scoreCompetition(competitionWith({
      weeklyHours: ["5-10"],
      teamRequirement: { state: "unknown" },
      requiredResources: [],
      helpfulResources: ["mentor"],
      usefulResources: ["mentor"]
    }), {
      ...profileV5,
      weeklyCommitment: "5-10",
      teamStatus: "ready",
      availableResources: ["mentor"]
    })!;
    expect(unknownTeamMetadata.scoreBreakdown.teamResources).toBe(15);

    const teamSizeNeutralCandidate = competitionWith({
      weeklyHours: ["5-10"],
      teamRequirement: { state: "known", mode: "team", minSize: 3 },
      requiredResources: [],
      helpfulResources: ["mentor"],
      usefulResources: ["mentor"],
      source: { url: "", sourceType: "unknown", facts: [] },
      supportingSources: [],
      eligibility: undefined
    });
    const withThree = scoreCompetition(teamSizeNeutralCandidate, {
      ...profileV5,
      confirmedFacts: ["teamSize"],
      teamSize: "three",
      weeklyCommitment: "5-10",
      teamStatus: "ready",
      availableResources: ["mentor"]
    })!;
    const withSoloFact = scoreCompetition(teamSizeNeutralCandidate, {
      ...profileV5,
      confirmedFacts: ["teamSize"],
      teamSize: "solo",
      weeklyCommitment: "5-10",
      teamStatus: "ready",
      availableResources: ["mentor"]
    })!;
    expect(withSoloFact.scoreBreakdown.teamResources).toBe(
      withThree.scoreBreakdown.teamResources
    );
  });

  it("keeps an unknown school recognition benefit outside the supported goal score", () => {
    const candidate = competitionWith({
      goalValues: {
        project: 0,
        award: 1,
        postgraduate: 0,
        employment: 0,
        portfolio: 0,
        entrepreneurship: 0,
        networking: 0
      }
    });
    const priorityTranscript: CompetitionDynamicExchangeV3[] = [{
      question: {
        questionId: "dq_goal_award",
        signalKey: "candidate-goal-tradeoff",
        prompt: "如果只能优先一种收获，你更看重哪一项？",
        selection: "single",
        options: [
          { value: "project", label: "项目经历" },
          { value: "award", label: "竞赛奖项" }
        ],
        allowsNote: true,
        maxNoteLength: 120,
        impact: "material",
        estimatedPreferenceOutcomeChanges: 2
      },
      answer: { selectedValues: ["award"] }
    }];
    const goalProfile: CompetitionRecommendationProfileV5 = {
      ...profileV5,
      goals: ["project"],
      preferredOutputs: []
    };
    const baseline = scoreCompetition(candidate, goalProfile)!;
    const refined = scoreCompetition(candidate, goalProfile, new Date(), priorityTranscript)!;
    const legacyShapedGoalAnswer = [{
      question: {
        questionId: "dq_legacy_goal",
        signalKey: "candidate-goal-tradeoff",
        prompt: "旧版兼容记录不得影响新评分。",
        selection: "single",
        options: [
          { value: "project", label: "项目经历" },
          { value: "award", label: "竞赛奖项" }
        ],
        allowsNote: true,
        maxNoteLength: 120
      },
      answer: { selectedValues: ["award"] }
    }] as unknown as CompetitionDynamicExchangeV2[];
    const ignoredLegacy = scoreCompetition(
      candidate,
      goalProfile,
      new Date(),
      projectLegacyCompetitionPreferenceTranscript(legacyShapedGoalAnswer)
    )!;

    expect(refined.scoreBreakdown.goalsOutputs).toBe(0);
    expect(refined.decisionFit?.evidence.unknowns.join("")).toContain("本校");
    expect({ ...refined.scoreBreakdown, goalsOutputs: 0, goal: 0 }).toEqual({
      ...baseline.scoreBreakdown,
      goalsOutputs: 0,
      goal: 0
    });
    expect(ignoredLegacy.scoreBreakdown.goalsOutputs).toBe(baseline.scoreBreakdown.goalsOutputs);
  });

  it("calibrates only actionable matches and caps the visible score below 100", () => {
    const strong = scoreLegacyCompetition(competitionWith({}), profile)!;
    const calibrated = calibrateCompetitionScore(profileV5, strong);
    expect(calibrated.scoreCalibration).toMatchObject({
      version: "competition-score-calibration.v1",
      qualified: true
    });
    expect(calibrated.scoreCalibration.adjustment).toBeGreaterThan(0);
    expect(calibrated.scoreCalibration.adjustment).toBeLessThanOrEqual(8);
    expect(calibrated.matchScore).toBeLessThanOrEqual(95);

    const weak = calibrateCompetitionScore(profileV5, {
      baseMatchScore: 54,
      scoreBreakdown: {
        subjectTask: 20,
        skillsEvidence: 12,
        goalsOutputs: 10,
        maturity: 4,
        teamResources: 5,
        availabilityTiming: 2,
        dataConfidence: 1,
        interest: 20,
        background: 12,
        goal: 10,
        difficulty: 4,
        feasibility: 5,
        access: 2,
        completenessPenalty: 0
      }
    });
    expect(weak.scoreCalibration.qualified).toBe(false);
    expect(weak.scoreCalibration.adjustment).toBe(0);
    expect(weak.matchScore).toBe(54);

    const otherwiseStrongBreakdown = {
      subjectTask: 20,
      skillsEvidence: 16,
      goalsOutputs: 12,
      maturity: 8,
      teamResources: 12,
      availabilityTiming: 7,
      dataConfidence: 5,
      interest: 20,
      background: 16,
      goal: 12,
      difficulty: 8,
      feasibility: 12,
      access: 7,
      completenessPenalty: 0
    };
    const lowActionability = calibrateCompetitionScore({
      ...profileV5,
      majorFields: ["other"],
      specificSubjects: [],
      skills: [],
      evidence: ["none"],
      startingPoint: "idea_only",
      experienceLevel: "none",
      weeklyCommitment: "under-5",
      availableResources: ["none"],
      teamStatus: "solo",
      confirmedFacts: []
    }, {
      baseMatchScore: 80,
      scoreBreakdown: otherwiseStrongBreakdown
    });
    expect(lowActionability.scoreCalibration.qualified).toBe(false);
    expect(lowActionability.scoreCalibration.adjustment).toBe(0);
    expect(lowActionability.matchScore).toBe(80);

    const insufficientInformation = calibrateCompetitionScore(profileV5, {
      baseMatchScore: 75,
      scoreBreakdown: {
        ...otherwiseStrongBreakdown,
        dataConfidence: 0
      }
    });
    expect(insufficientInformation.scoreCalibration.qualified).toBe(true);
    expect(insufficientInformation.scoreCalibration.evidenceConfidence).toBe(0);
    expect(insufficientInformation.scoreCalibration.adjustment).toBe(0);
    expect(insufficientInformation.matchScore).toBe(75);

    const boundary = calibrateCompetitionScore(profileV5, {
      baseMatchScore: 55,
      scoreBreakdown: {
        subjectTask: 7.5,
        skillsEvidence: 0,
        goalsOutputs: 7.6,
        maturity: 10,
        teamResources: 3,
        availabilityTiming: 10,
        dataConfidence: 3.5,
        interest: 7.5,
        background: 0,
        goal: 7.6,
        difficulty: 10,
        feasibility: 3,
        access: 10,
        completenessPenalty: 0
      }
    });
    expect(boundary.scoreCalibration).toMatchObject({
      alignment: 0.2513,
      evidenceConfidence: 0.7,
      adjustment: 4.8
    });
    expect(boundary.matchScore).toBe(59.8);
  });

  it("builds a stable all-track qualification snapshot from fixed facts only", () => {
    const candidate = competitionWith({
      tracks: [
        { id: "z-track", label: "Z", fitSignals: ["software-engineering"] },
        { id: "a-track", label: "A", fitSignals: ["career-evidence"] }
      ]
    });
    const snapshot = buildCompetitionQualificationSnapshot(profileV5, [candidate]);
    expect(snapshot).toMatchObject({
      version: "competition-qualification-snapshot.v1",
      scorerVersion: "evidence-fit-2026-11.v1"
    });
    expect(snapshot.entries).toHaveLength(1);
    expect(snapshot.entries[0].tracks.map(({ trackId }) => trackId)).toEqual(["a-track", "z-track"]);
    expect(snapshot.entries[0].sourceRefs).toEqual([...snapshot.entries[0].sourceRefs].sort());
    expect(buildCompetitionQualificationSnapshot(profileV5, [candidate])).toEqual(snapshot);
  });
});

function selectedFixture(score: number, tier: 1 | 2 | 3): ScoredCompetition {
  const registrationStatus =
    tier === 1
      ? ({ status: "open", label: "open" } as const)
      : tier === 2
        ? ({ status: "unknown", label: "unknown" } as const)
        : ({ status: "closed", label: "closed" } as const);
  return {
    competition: competitions[0],
    baseMatchScore: score,
    scoreBreakdown: {
      interest: 0,
      background: 0,
      goal: 0,
      difficulty: 0,
      access: 0,
      feasibility: 0,
      completenessPenalty: 0
    },
    availability: {
      registrationStatus,
      tier: tier === 1 ? "current-or-upcoming" : tier === 2 ? "unknown" : "closed",
      tierRank: tier
    },
    eligibility: { status: "eligible", reasons: [] },
    fit: { score, matchedSignals: [], gaps: [] },
    dataNotices: []
  };
}

describe("deterministic recommendation fallback", () => {
  it("always caps the rule fallback at exactly three when enough candidates exist", () => {
    expect(selectCompetitionRecommendations([90, 84, 78, 70, 70].map((score) => selectedFixture(score, 1)))).toHaveLength(3);
  });

  it("preserves match-first ordering and allows a closed best match as next-edition preparation", () => {
    const matchOrdered = [
      selectedFixture(99, 3),
      selectedFixture(90, 1),
      selectedFixture(80, 2),
      selectedFixture(70, 2)
    ];

    expect(selectCompetitionRecommendations(matchOrdered)).toHaveLength(3);
    expect(selectCompetitionRecommendations(matchOrdered)[0].availability.tier).toBe("closed");
    expect(selectCompetitionRecommendations(matchOrdered).map(({ baseMatchScore }) => baseMatchScore)).toEqual([99, 90, 80]);
  });

  it("returns a ranked Top10 catalog-only recall for upstream ranking", () => {
    const result = getLegacyCompetitionRecommendationCandidates(profile, {
      now: new Date("2026-08-02T04:00:00.000Z")
    });

    expect(result.recommendations).toHaveLength(10);
    expect(result.recommendations.map((item) => item.rank)).toEqual(
      result.recommendations.map((_, index) => index + 1)
    );
    expect(result.recommendations.every((item) => competitions.includes(item.competition))).toBe(true);
  });

  it("fills the final three through the four qualification/quality tiers", () => {
    const tiered = (
      id: string,
      qualified: boolean,
      eligibility: ScoredCompetition["eligibility"]["status"]
    ): ScoredCompetition => {
      const base = selectedFixture(qualified ? 80 : 50, 1);
      return {
        ...base,
        competition: { ...base.competition, id },
        baseMatchScore: qualified ? 80 : 50,
        scoreBreakdown: qualified
          ? {
              subjectTask: 20,
              skillsEvidence: 16,
              goalsOutputs: 12,
              maturity: 8,
              teamResources: 12,
              availabilityTiming: 8,
              dataConfidence: 4,
              interest: 20,
              background: 16,
              goal: 12,
              difficulty: 8,
              feasibility: 12,
              access: 8,
              completenessPenalty: 0
            }
          : {
              subjectTask: 6,
              skillsEvidence: 10,
              goalsOutputs: 8,
              maturity: 6,
              teamResources: 8,
              availabilityTiming: 8,
              dataConfidence: 4,
              interest: 6,
              background: 10,
              goal: 8,
              difficulty: 6,
              feasibility: 8,
              access: 8,
              completenessPenalty: 0
            },
        eligibility: {
          status: eligibility,
          reasons: eligibility === "eligible" ? [] : ["待核验"]
        }
      };
    };
    const selected = selectFinalThreeRecommendations([
      tiered("unqualified-needs", false, "needs_clarification"),
      tiered("qualified-needs", true, "needs_clarification"),
      tiered("qualified-ineligible", true, "ineligible"),
      tiered("unqualified-eligible", false, "eligible"),
      tiered("qualified-eligible", true, "eligible")
    ], profileV5);

    expect(selected.map(({ competition }) => competition.id)).toEqual([
      "qualified-eligible",
      "qualified-needs",
      "unqualified-eligible"
    ]);
  });

  it("returns one to three final items after the shared item-quality line", () => {
    const result = recommendLegacyCompetitions(profile, { now: new Date("2026-08-02T04:00:00.000Z") });

    expect(result.recommendations.length).toBeGreaterThanOrEqual(1);
    expect(result.recommendations.length).toBeLessThanOrEqual(3);
    expect(result.recommendations.map((item) => item.rank)).toEqual(
      result.recommendations.map((_, index) => index + 1)
    );
  });
});
