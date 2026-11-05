import { describe, expect, it, vi } from "vitest";
import {
  buildCompetitionClarifyAskableContext,
  buildOptionalGoalTradeoffAskable,
  generateNextCompetitionQuestion,
  materializeCompetitionClarifyQuestion,
  selectMaximumInformationOptionSubset,
  selectAskableQuestionForTurn,
  simulateCompetitionClarifyOutcome,
  type CompetitionClarifyAskableQuestion
} from "../../src/lib/ai/competition-clarify";
import {
  competitionDynamicQuestionFamilyV3,
  competitionDynamicQuestionV3Schema
} from "../../src/lib/ai/competition-dynamic-question";
import { competitionPreferenceQuestionsMatchQualificationSnapshot } from "../../src/lib/ai/competition-conversation-token";
import { getCompetitionRecommendationCandidates } from "../../src/lib/competitions/recommendation-engine";
import {
  getCompetitionCatalog,
  getCompetitionPreferenceQuestionTracks
} from "../../src/lib/competitions/catalog";
import {
  buildCompetitionQualificationSnapshot,
  scoreCompetitionRecommendations
} from "../../src/lib/competitions/scoring";
import {
  QUALITY_BENCHMARK_NOW,
  competitionAnchorPersonas
} from "../fixtures/competition-quality-personas";
import type {
  CompetitionDynamicExchangeV3,
  CompetitionDynamicQuestionV3,
  CompetitionDynamicSignalKeyV3,
  CompetitionRecommendationProfileV5
} from "../../src/types/competition-recommendation";
import { COMPETITION_PROFILE_FIELD_IDS } from "../../src/types/competition-recommendation";

const profile: CompetitionRecommendationProfileV5 = {
  profileVersion: "competition-profile.v5",
  questionnaireVersion: "competition-questionnaire.v1",
  confirmedFields: [...COMPETITION_PROFILE_FIELD_IDS],
  confirmedFacts: [],
  stage: "undergraduate-2",
  majorFields: ["computer-science", "engineering"],
  specificSubjects: ["information-communication", "robotics-automation"],
  skills: ["programming", "hardware", "presentation"],
  interests: ["ai", "innovation"],
  taskFormats: ["software", "hardware"],
  goals: ["project", "employment"],
  preferredOutputs: ["software", "prototype"],
  startingPoint: "coursework",
  weeklyCommitment: "5-10",
  teamStatus: "looking",
  availableResources: ["mentor"],
  participationMode: "flexible",
  participationTiming: "flexible",
  experienceLevel: "participated",
  evidence: ["project", "prototype"]
};

const forbiddenText = /(?:资格|官方条件|已核对且符合|仍需核对|已确认不符合|可参加赛道|入学年|出生年|学籍|学历阶段|队伍人数|团队人数|参赛人数|参赛单位|地区)/;

function fakeAskable(
  signalKey: CompetitionDynamicSignalKeyV3,
  outcomeChanges: number
): CompetitionClarifyAskableQuestion {
  return {
    signalKey,
    target: signalKey.startsWith("track:")
      ? { kind: "competition", competitionId: signalKey.slice(6), competitionName: "测试赛事" }
      : { kind: "candidate-set", competitionIds: ["a", "b", "c"] },
    allowedOptionValues: signalKey === "candidate-goal-tradeoff"
      ? ["project", "employment"]
      : signalKey === "competition-fit"
        ? ["hardware-build", "software-engineering"]
        : ["track-a", "track-b"],
    optionCatalog: signalKey === "candidate-goal-tradeoff"
      ? [{ value: "project", label: "项目经历" }, { value: "employment", label: "就业能力" }]
      : signalKey === "competition-fit"
        ? [{ value: "hardware-build", label: "硬件实现" }, { value: "software-engineering", label: "软件交付" }]
        : [{ value: "track-a", label: "方向甲" }, { value: "track-b", label: "方向乙" }],
    allowedSelections: [signalKey === "competition-fit" ? "multiple" : "single"],
    optionCount: { min: 2, max: 6 },
    requiredOptionCount: 2,
    estimatedPreferenceOutcomeChanges: outcomeChanges,
    estimatedOutcomeChanges: outcomeChanges,
    impact: "material",
    ...(signalKey === "competition-fit" ? { maxSelections: 2 } : {})
  };
}

describe("preference-only competition clarification policy", () => {
  it("selects a high-information seventh option instead of truncating by catalog order", () => {
    const selected = selectMaximumInformationOptionSubset(
      ["a", "b", "c", "d", "e", "f", "g"],
      "single",
      undefined,
      6,
      ([value]) => value === "g" ? "distinct" : "same"
    );

    expect(selected.optionValues).toContain("g");
    expect(selected.outcomeCount).toBe(2);
  });
  it("requires a qualification snapshot at the V5 clarification boundary", () => {
    const candidates = getCompetitionRecommendationCandidates(profile).recommendations;
    if (false) {
      // @ts-expect-error V5 clarification cannot generate questions without its frozen qualification snapshot.
      buildCompetitionClarifyAskableContext(profile, candidates);
    }
    expect(candidates.length).toBeGreaterThanOrEqual(3);
  });

  it("emits only the three approved signal families with unique signals and families", () => {
    const candidates = getCompetitionRecommendationCandidates(profile).recommendations;
    const snapshot = buildCompetitionQualificationSnapshot(profile);
    const askable = buildCompetitionClarifyAskableContext(profile, candidates, [], [], snapshot);

    expect(candidates.length).toBeGreaterThanOrEqual(3);
    expect(new Set(askable.map(({ signalKey }) => signalKey)).size).toBe(askable.length);
    expect(new Set(askable.map(({ signalKey }) => competitionDynamicQuestionFamilyV3(signalKey))).size)
      .toBe(askable.length);
    for (const question of askable) {
      expect(question.signalKey).toMatch(/^(?:competition-fit|candidate-goal-tradeoff|track:[a-z0-9-]+)$/);
      expect(question.signalKey).not.toMatch(/^(?:team-eligibility|eligibility:)/);
      expect(question.impact).toBe("material");
      expect(question.estimatedPreferenceOutcomeChanges).toBeGreaterThanOrEqual(2);
      const materialized = materializeCompetitionClarifyQuestion(question, 1);
      expect(competitionDynamicQuestionV3Schema.safeParse(materialized).success).toBe(true);
      expect(`${materialized.prompt} ${materialized.options.map(({ label }) => label).join(" ")}`)
        .not.toMatch(forbiddenText);
    }
  });

  it("binds goal tradeoff to the server goal whitelist and prioritizes fixed goals", () => {
    const candidates = getCompetitionRecommendationCandidates(profile).recommendations;
    const optional = buildOptionalGoalTradeoffAskable(profile, candidates);

    expect(optional).toMatchObject({
      signalKey: "candidate-goal-tradeoff",
      allowedOptionValues: ["project", "employment"],
      optionCatalog: [
        { value: "project", label: "项目经历" },
        { value: "employment", label: "就业能力" }
      ],
      allowedSelections: ["single"],
      impact: "optional"
    });
    const question = materializeCompetitionClarifyQuestion(optional!, 1);
    expect(question.selection).toBe("single");
    expect(question.options).toHaveLength(2);
  });

  it("selects highest information gain first and uses fit-goal-track only as the tie break", () => {
    const fit = fakeAskable("competition-fit", 2);
    const goal = fakeAskable("candidate-goal-tradeoff", 3);
    const track = fakeAskable("track:fixture", 3);

    expect(selectAskableQuestionForTurn([fit, track, goal])?.signalKey)
      .toBe("candidate-goal-tradeoff");
    expect(selectAskableQuestionForTurn([
      { ...track, estimatedPreferenceOutcomeChanges: 2 },
      fit,
      { ...goal, estimatedPreferenceOutcomeChanges: 2 }
    ])?.signalKey)
      .toBe("competition-fit");
  });

  it("information gain signatures contain only ordered Top3 and selected track, never eligibility", () => {
    const candidates = getCompetitionRecommendationCandidates(profile).recommendations;
    const outcome = simulateCompetitionClarifyOutcome(
      profile,
      candidates,
      "competition-fit",
      "software-engineering"
    );

    expect(outcome).toHaveProperty("topThree");
    expect(outcome).not.toHaveProperty("eligibility");
    expect(JSON.stringify(outcome)).not.toMatch(/eligible|needs_clarification|ineligible/);
  });

  it("keeps counterfactual question ids within the V3 limit for the longest legal track key", () => {
    const catalog = getCompetitionCatalog();
    const source = catalog.find(({ id }) => id === "challenge-cup-academic-science");
    expect(source).toBeDefined();
    if (!source) throw new Error("Missing track source fixture");
    const longCompetitionId = `a${"b".repeat(99)}`;
    const longTrackCompetition = { ...source, id: longCompetitionId };
    const candidates = getCompetitionRecommendationCandidates(profile, {
      now: QUALITY_BENCHMARK_NOW
    }).recommendations;

    expect(() => simulateCompetitionClarifyOutcome(
      profile,
      candidates,
      `track:${longCompetitionId}`,
      "natural-science-paper",
      [],
      {
        now: QUALITY_BENCHMARK_NOW,
        catalog: [longTrackCompetition, ...catalog]
      }
    )).not.toThrow();
  });

  it("does not treat a track change outside the visible final three as material", () => {
    const persona = competitionAnchorPersonas.find(
      ({ id }) => id === "anchor-national-college-math-modeling"
    );
    expect(persona).toBeDefined();
    const candidates = getCompetitionRecommendationCandidates(persona!.profile, {
      now: QUALITY_BENCHMARK_NOW
    }).recommendations;
    const naturalScience = simulateCompetitionClarifyOutcome(
      persona!.profile,
      candidates,
      "track:challenge-cup-academic-science",
      "natural-science-paper"
    );
    const socialSurvey = simulateCompetitionClarifyOutcome(
      persona!.profile,
      candidates,
      "track:challenge-cup-academic-science",
      "social-survey"
    );

    expect(naturalScience.targetTrack).toBeUndefined();
    expect(socialSurvey.targetTrack).toBeUndefined();
    expect(socialSurvey).toEqual(naturalScience);

    const askable = buildCompetitionClarifyAskableContext(
      persona!.profile,
      candidates,
      [],
      [],
      buildCompetitionQualificationSnapshot(persona!.profile, undefined, QUALITY_BENCHMARK_NOW)
    );
    expect(askable.some(({ signalKey }) =>
      signalKey === "track:challenge-cup-academic-science"
    )).toBe(false);
  });

  it("uses each track snapshot even when the parent competition status is ineligible", () => {
    const persona = competitionAnchorPersonas.find(
      ({ id }) => id === "anchor-challenge-cup-academic-science"
    );
    expect(persona).toBeDefined();
    const candidates = getCompetitionRecommendationCandidates(persona!.profile, {
      now: QUALITY_BENCHMARK_NOW
    }).recommendations;
    const originalSnapshot = buildCompetitionQualificationSnapshot(
      persona!.profile,
      undefined,
      QUALITY_BENCHMARK_NOW
    );
    const competitionId = "challenge-cup-academic-science";
    const originalEntry = originalSnapshot.entries.find(
      (entry) => entry.competitionId === competitionId
    );
    expect(originalEntry?.tracks.filter(({ status }) => status !== "ineligible").length)
      .toBeGreaterThanOrEqual(2);
    const parentIneligibleSnapshot = {
      ...originalSnapshot,
      entries: originalSnapshot.entries.map((entry) => entry.competitionId === competitionId
        ? {
            ...entry,
            status: "ineligible" as const,
            reasons: ["parent-only-stage-rule"],
            hardFilterReason: "stage-ineligible"
          }
        : entry)
    };
    const askable = buildCompetitionClarifyAskableContext(
      persona!.profile,
      candidates,
      [],
      [],
      parentIneligibleSnapshot
    ).find(({ signalKey }) => signalKey === `track:${competitionId}`);

    expect(askable).toBeDefined();
    const question = materializeCompetitionClarifyQuestion(askable!, 1);
    expect(question.options.every((option) =>
      originalEntry!.tracks.some((track) =>
        track.trackId === option.value && track.status !== "ineligible"
      )
    )).toBe(true);
    expect(competitionPreferenceQuestionsMatchQualificationSnapshot(
      parentIneligibleSnapshot,
      [],
      question
    )).toBe(true);
  });

  it("does not let non-official editorial stage metadata hide a snapshot-allowed track", () => {
    const persona = competitionAnchorPersonas.find(
      ({ id }) => id === "anchor-challenge-cup-academic-science"
    );
    expect(persona).toBeDefined();
    const competitionId = "challenge-cup-academic-science";
    const candidates = getCompetitionRecommendationCandidates(persona!.profile, {
      now: QUALITY_BENCHMARK_NOW
    }).recommendations.map((candidate) => candidate.competitionId === competitionId
      ? {
          ...candidate,
          competition: {
            ...candidate.competition,
            recommendation: {
              ...candidate.competition.recommendation,
              tracks: candidate.competition.recommendation.tracks?.map((track) => ({
                ...track,
                stages: { state: "known" as const, values: ["doctorate" as const] }
              }))
            }
          }
        }
      : candidate);
    const snapshot = buildCompetitionQualificationSnapshot(
      persona!.profile,
      undefined,
      QUALITY_BENCHMARK_NOW
    );
    const allowedTrackIds = snapshot.entries.find(({ competitionId: id }) => id === competitionId)!
      .tracks.filter(({ status }) => status !== "ineligible")
      .map(({ trackId }) => trackId);
    const askable = buildCompetitionClarifyAskableContext(
      persona!.profile,
      candidates,
      [],
      [],
      snapshot,
      { now: QUALITY_BENCHMARK_NOW }
    ).find(({ signalKey }) => signalKey === `track:${competitionId}`);

    expect(askable).toBeDefined();
    expect(askable?.allowedOptionValues).toEqual(allowedTrackIds.slice(0, 6));
  });

  it("fails closed for track questions when a competition snapshot entry is missing", () => {
    const candidates = getCompetitionRecommendationCandidates(profile).recommendations;
    const snapshot = buildCompetitionQualificationSnapshot(profile);
    const snapshotWithoutEntries = { ...snapshot, entries: [] };
    const askable = buildCompetitionClarifyAskableContext(
      profile,
      candidates,
      [],
      [],
      snapshotWithoutEntries
    );

    expect(askable.some(({ signalKey }) => signalKey.startsWith("track:"))).toBe(false);
  });

  it("keeps factual class tracks in the snapshot but never asks or accepts them as preferences", () => {
    const competitionId = "challenge-cup-entrepreneurship-plan";
    const competition = getCompetitionCatalog().find(({ id }) => id === competitionId);
    expect(competition).toBeDefined();
    expect(competition?.recommendation.tracks?.map(({ id, preferenceQuestionEligible }) => ({
      id,
      preferenceQuestionEligible
    }))).toEqual([
      { id: "registered", preferenceQuestionEligible: false },
      { id: "unregistered", preferenceQuestionEligible: false }
    ]);

    const snapshot = buildCompetitionQualificationSnapshot(profile, undefined, QUALITY_BENCHMARK_NOW);
    const snapshotEntry = snapshot.entries.find((entry) => entry.competitionId === competitionId);
    expect(snapshotEntry?.tracks.map(({ trackId }) => trackId)).toEqual(["registered", "unregistered"]);

    const targetCandidate = getCompetitionRecommendationCandidates(profile, {
      now: QUALITY_BENCHMARK_NOW,
      catalog: [competition!]
    }).recommendations[0];
    expect(targetCandidate).toBeDefined();
    const otherCandidates = getCompetitionRecommendationCandidates(profile, {
      now: QUALITY_BENCHMARK_NOW
    }).recommendations.filter(({ competitionId: id }) => id !== competitionId);
    const candidates = [targetCandidate!, ...otherCandidates].slice(0, 10);
    const askable = buildCompetitionClarifyAskableContext(
      profile,
      candidates,
      [],
      [],
      snapshot,
      { now: QUALITY_BENCHMARK_NOW }
    );
    expect(askable.some(({ signalKey }) => signalKey === `track:${competitionId}`)).toBe(false);

    const injectedQuestion: CompetitionDynamicQuestionV3 = {
      questionId: "dq_factual_classification_injection",
      signalKey: `track:${competitionId}`,
      prompt: "《挑战杯创业计划竞赛》的这些候选方向中，你更想优先准备哪个赛道？",
      selection: "single",
      options: [
        { value: "registered", label: "已创业类" },
        { value: "unregistered", label: "未创业类" }
      ],
      allowsNote: true,
      maxNoteLength: 120,
      impact: "material",
      estimatedPreferenceOutcomeChanges: 2
    };
    expect(competitionDynamicQuestionV3Schema.safeParse(injectedQuestion).success).toBe(false);
    const schemaSafeInternalInjection: CompetitionDynamicQuestionV3 = {
      ...injectedQuestion,
      options: [
        { value: "registered", label: "方向 A" },
        { value: "unregistered", label: "方向 B" }
      ]
    };
    expect(competitionDynamicQuestionV3Schema.safeParse(schemaSafeInternalInjection).success).toBe(true);
    expect(competitionPreferenceQuestionsMatchQualificationSnapshot(
      snapshot,
      [],
      schemaSafeInternalInjection
    )).toBe(false);
  });

  it("classifies every identity or project-source group as non-preference while retaining content tracks", () => {
    const expectedFactTracks = {
      "youth-tech-challenge": ["student-track"],
      "low-altitude-industry": ["student-launch"],
      "huacan-design-award": ["student-group"],
      "national-innovation-training-annual": ["innovation-project-exhibition"],
      "milan-design-week-china": ["currently-enrolled-student-work"],
      "china-us-young-maker": ["vocational"],
      "enterprise-competition-simulation": ["graduate", "undergraduate", "vocational"],
      "matiji-programming": ["undergraduate", "vocational"],
      "understanding-contemporary-china-foreign-language": ["international-chinese"]
    } as const;
    const snapshot = buildCompetitionQualificationSnapshot(profile, undefined, QUALITY_BENCHMARK_NOW);

    for (const [competitionId, factTrackIds] of Object.entries(expectedFactTracks)) {
      const competition = getCompetitionCatalog().find(({ id }) => id === competitionId);
      expect(competition, competitionId).toBeDefined();
      const catalogFactTracks = (competition!.recommendation.tracks ?? [])
        .filter(({ preferenceQuestionEligible }) => preferenceQuestionEligible === false)
        .map(({ id }) => id);
      expect(catalogFactTracks, competitionId).toEqual(factTrackIds);
      const snapshotTrackIds = snapshot.entries.find(
        (entry) => entry.competitionId === competitionId
      )?.tracks.map(({ trackId }) => trackId) ?? [];
      expect(snapshotTrackIds, `${competitionId} snapshot`).toEqual(
        expect.arrayContaining([...factTrackIds])
      );
      const askableTrackIds = getCompetitionPreferenceQuestionTracks(competition!)
        .map(({ id }) => id);
      expect(askableTrackIds, `${competitionId} preference tracks`).not.toEqual(
        expect.arrayContaining([...factTrackIds])
      );
    }

    expect(getCompetitionPreferenceQuestionTracks(
      getCompetitionCatalog().find(({ id }) => id === "datang-ict")!
    ).map(({ id }) => id)).toEqual(["engineering-practice", "5g-innovation", "ict-general"]);
    expect(getCompetitionPreferenceQuestionTracks(
      getCompetitionCatalog().find(
        ({ id }) => id === "understanding-contemporary-china-foreign-language"
      )!
    ).map(({ id }) => id)).toEqual([
      "english-comprehensive",
      "translation",
      "short-video",
      "four-new"
    ]);
  });

  it("keeps all six China International fact-determined groups but never offers them as preferences", () => {
    const competitionId = "china-international-college-innovation";
    const competition = getCompetitionCatalog().find(({ id }) => id === competitionId);
    expect(competition).toBeDefined();
    const tracks = competition!.recommendation.tracks ?? [];
    expect(tracks.map(({ id }) => id)).toEqual([
      "undergraduate-creative",
      "undergraduate-startup",
      "graduate-creative",
      "graduate-startup",
      "vocational-creative",
      "vocational-startup"
    ]);
    expect(tracks.every(({ preferenceQuestionEligible }) =>
      preferenceQuestionEligible === false
    )).toBe(true);
    expect(tracks.find(({ id }) => id === "undergraduate-creative")?.stages).toEqual({
      state: "known",
      values: ["undergraduate-1", "undergraduate-2", "undergraduate-3", "undergraduate-4"]
    });
    expect(tracks.find(({ id }) => id === "vocational-creative")?.stages).toEqual({
      state: "known",
      values: ["vocational"]
    });

    const snapshot = buildCompetitionQualificationSnapshot(profile, undefined, QUALITY_BENCHMARK_NOW);
    const snapshotEntry = snapshot.entries.find((entry) => entry.competitionId === competitionId);
    expect(snapshotEntry?.tracks.map(({ trackId }) => trackId)).toEqual([
      "graduate-creative",
      "graduate-startup",
      "undergraduate-creative",
      "undergraduate-startup",
      "vocational-creative",
      "vocational-startup"
    ]);
    expect(snapshotEntry?.sourceRefs).toContain(competition!.recommendation.source?.evidenceRef);
    expect(snapshotEntry?.tracks.filter(({ trackId }) =>
      trackId.startsWith("undergraduate-")
    ).every(({ status }) => status !== "ineligible")).toBe(true);

    const targetCandidate = getCompetitionRecommendationCandidates(profile, {
      now: QUALITY_BENCHMARK_NOW,
      catalog: [competition!]
    }).recommendations[0];
    expect(targetCandidate).toBeDefined();
    const askable = buildCompetitionClarifyAskableContext(
      profile,
      [targetCandidate!],
      [],
      [],
      snapshot,
      { now: QUALITY_BENCHMARK_NOW }
    );
    expect(askable.some(({ signalKey }) => signalKey === `track:${competitionId}`)).toBe(false);

    const injectedQuestion: CompetitionDynamicQuestionV3 = {
      questionId: "dq_china_international_factual_group_injection",
      signalKey: `track:${competitionId}`,
      prompt: "《中国国际大学生创新大赛》的这些候选方向中，你更想优先准备哪个赛道？",
      selection: "single",
      options: [
        { value: "undergraduate-creative", label: "高教主赛道本科生创意组" },
        { value: "undergraduate-startup", label: "高教主赛道本科生创业组" }
      ],
      allowsNote: true,
      maxNoteLength: 120,
      impact: "material",
      estimatedPreferenceOutcomeChanges: 2
    };
    expect(competitionPreferenceQuestionsMatchQualificationSnapshot(
      snapshot,
      [],
      injectedQuestion
    )).toBe(false);
  });

  it("models career tracks as facts and hard-excludes only the master's growth track", () => {
    const competitionId = "career-planning";
    const competition = getCompetitionCatalog().find(({ id }) => id === competitionId);
    expect(competition).toBeDefined();
    expect(competition!.recommendation.tracks?.map((track) => ({
      id: track.id,
      preferenceQuestionEligible: track.preferenceQuestionEligible,
      stages: track.stages
    }))).toEqual([
      {
        id: "growth",
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
        }
      },
      {
        id: "employment",
        preferenceQuestionEligible: false,
        stages: {
          state: "known",
          values: [
            "vocational",
            "undergraduate-1",
            "undergraduate-2",
            "undergraduate-3",
            "undergraduate-4",
            "master",
            "doctorate"
          ]
        }
      }
    ]);

    const masterProfile: CompetitionRecommendationProfileV5 = { ...profile, stage: "master" };
    const snapshot = buildCompetitionQualificationSnapshot(
      masterProfile,
      undefined,
      QUALITY_BENCHMARK_NOW
    );
    const snapshotEntry = snapshot.entries.find((entry) => entry.competitionId === competitionId);
    expect(snapshotEntry?.tracks.map(({ trackId }) => trackId)).toEqual(["employment", "growth"]);
    expect(snapshotEntry?.tracks.find(({ trackId }) => trackId === "growth")).toMatchObject({
      status: "ineligible",
      hardFilterReason: "stage-ineligible"
    });
    expect(snapshotEntry?.tracks.find(({ trackId }) => trackId === "employment")?.status)
      .not.toBe("ineligible");
    expect(snapshotEntry?.sourceRefs).toContain(competition!.recommendation.source?.evidenceRef);

    const targetCandidate = getCompetitionRecommendationCandidates(masterProfile, {
      now: QUALITY_BENCHMARK_NOW,
      catalog: [competition!]
    }).recommendations[0];
    expect(targetCandidate).toBeDefined();
    const askable = buildCompetitionClarifyAskableContext(
      masterProfile,
      [targetCandidate!],
      [],
      [],
      snapshot,
      { now: QUALITY_BENCHMARK_NOW }
    );
    expect(askable.some(({ signalKey }) => signalKey === `track:${competitionId}`)).toBe(false);
  });

  it("keeps the Challenge Cup doctorate exception as needs clarification, never eligible or hard-excluded", () => {
    const doctorateProfile: CompetitionRecommendationProfileV5 = { ...profile, stage: "doctorate" };
    const snapshot = buildCompetitionQualificationSnapshot(
      doctorateProfile,
      undefined,
      QUALITY_BENCHMARK_NOW
    );
    const entry = snapshot.entries.find(
      ({ competitionId }) => competitionId === "challenge-cup-academic-science"
    );
    const competition = getCompetitionCatalog().find(
      ({ id }) => id === "challenge-cup-academic-science"
    );

    expect(entry).toMatchObject({
      status: "needs_clarification",
      hardFilterReason: null
    });
    expect(entry?.reasons.join(" ")).toMatch(/替代通道/);
    expect(entry?.sourceRefs).toContain(competition?.recommendation.source?.evidenceRef);
  });

  it("keeps counterfactual outcomes on the frozen conversation time across a schedule boundary", () => {
    const persona = competitionAnchorPersonas.find(
      ({ id }) => id === "anchor-graduate-rural-revitalization-agritech"
    );
    expect(persona).toBeDefined();
    const frozenNow = new Date("2026-08-24T12:00:00.000Z");
    const candidates = getCompetitionRecommendationCandidates(persona!.profile, {
      now: frozenNow
    }).recommendations;
    const snapshot = buildCompetitionQualificationSnapshot(
      persona!.profile,
      undefined,
      frozenNow
    );

    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-23T00:00:00.000Z"));
      const beforeBoundary = buildCompetitionClarifyAskableContext(
        persona!.profile,
        candidates,
        [],
        [],
        snapshot,
        { now: frozenNow }
      );
      const beforeSignatures = beforeBoundary.map((askable) => ({
        signalKey: askable.signalKey,
        outcomes: askable.allowedOptionValues.map((value) =>
          simulateCompetitionClarifyOutcome(
            persona!.profile,
            candidates,
            askable.signalKey,
            value,
            [],
            { now: frozenNow }
          )
        )
      }));

      vi.setSystemTime(new Date("2026-08-25T12:00:00.000Z"));
      const afterBoundary = buildCompetitionClarifyAskableContext(
        persona!.profile,
        candidates,
        [],
        [],
        snapshot,
        { now: frozenNow }
      );
      const afterSignatures = afterBoundary.map((askable) => ({
        signalKey: askable.signalKey,
        outcomes: askable.allowedOptionValues.map((value) =>
          simulateCompetitionClarifyOutcome(
            persona!.profile,
            candidates,
            askable.signalKey,
            value,
            [],
            { now: frozenNow }
          )
        )
      }));

      expect(afterSignatures).toEqual(beforeSignatures);
    } finally {
      vi.useRealTimers();
    }
  });

  it("evaluates the entire eligible catalog when simulating a preference change", () => {
    const persona = competitionAnchorPersonas.find(
      ({ id }) => id === "anchor-service-outsourcing-innovation"
    );
    expect(persona).toBeDefined();
    const initialCandidates = getCompetitionRecommendationCandidates(persona!.profile, {
      now: QUALITY_BENCHMARK_NOW
    }).recommendations;
    const initialIds = new Set(initialCandidates.map(({ competitionId }) => competitionId));
    const completeRanking = scoreCompetitionRecommendations(
      getCompetitionCatalog(),
      persona!.profile,
      { now: QUALITY_BENCHMARK_NOW }
    );
    const snapshot = buildCompetitionQualificationSnapshot(
      persona!.profile,
      undefined,
      QUALITY_BENCHMARK_NOW
    );
    expect(initialIds).toEqual(new Set(completeRanking.map(item => item.competition.id)));
    expect(initialIds.has("ecommerce-innovation-creativity-entrepreneurship")).toBe(true);
    const outcome = simulateCompetitionClarifyOutcome(persona!.profile, initialCandidates,
      "competition-fit", "venture-readiness", [], {now:QUALITY_BENCHMARK_NOW});
    expect(outcome.topThree.length).toBeLessThanOrEqual(3);
    expect(outcome.topThree.every(item => initialIds.has(item.competitionId))).toBe(true);
    expect(buildCompetitionQualificationSnapshot(
      persona!.profile,
      undefined,
      QUALITY_BENCHMARK_NOW
    )).toEqual(snapshot);
  });

  it("accepts more than six distinct counterfactual outcomes in the signed question schema", () => {
    const question = materializeCompetitionClarifyQuestion(
      { ...fakeAskable("competition-fit", 12), estimatedOutcomeChanges: 12 },
      1
    );
    expect(question.estimatedPreferenceOutcomeChanges).toBe(12);
    expect(competitionDynamicQuestionV3Schema.safeParse(question).success).toBe(true);
  });

  it("rejects legacy eligibility/team signals and forbidden qualification wording", () => {
    const base = materializeCompetitionClarifyQuestion(fakeAskable("competition-fit", 2), 1);
    expect(competitionDynamicQuestionV3Schema.safeParse({ ...base, signalKey: "team-eligibility" }).success)
      .toBe(false);
    expect(competitionDynamicQuestionV3Schema.safeParse({ ...base, signalKey: "eligibility:fixture" }).success)
      .toBe(false);
    expect(competitionDynamicQuestionV3Schema.safeParse({ ...base, prompt: "你的资格是否已核对且符合？" }).success)
      .toBe(false);
    expect(competitionDynamicQuestionV3Schema.safeParse({
      ...base,
      options: [
        { ...base.options[0], label: "已核对且符合" },
        base.options[1]
      ]
    }).success).toBe(false);

    const pollutedTrack = fakeAskable("track:fixture", 2);
    expect(() => materializeCompetitionClarifyQuestion({
      ...pollutedTrack,
      optionCatalog: [
        { value: "track-a", label: "可参加赛道" },
        { value: "track-b", label: "正常方向" }
      ]
    }, 1)).toThrow();
  });

  it("never asks when fewer than three hard-filtered candidates remain", async () => {
    const candidates = getCompetitionRecommendationCandidates(profile).recommendations.slice(0, 2);
    const snapshot = buildCompetitionQualificationSnapshot(profile);
    expect(buildCompetitionClarifyAskableContext(profile, candidates, [], [], snapshot)).toEqual([]);
    expect(buildOptionalGoalTradeoffAskable(profile, candidates)).toBeNull();
    await expect(generateNextCompetitionQuestion(profile, [], candidates, [], snapshot)).resolves.toMatchObject({
      status: "completed",
      nextQuestion: null
    });
  });

  it("stops at three questions and does not call a model to choose questions", async () => {
    const candidates = getCompetitionRecommendationCandidates(profile).recommendations;
    const transcript: CompetitionDynamicExchangeV3[] = [
      {
        question: materializeCompetitionClarifyQuestion(fakeAskable("competition-fit", 2), 1),
        answer: { selectedValues: ["hardware-build"] }
      },
      {
        question: materializeCompetitionClarifyQuestion(fakeAskable("candidate-goal-tradeoff", 2), 2),
        answer: { selectedValues: ["project"] }
      },
      {
        question: materializeCompetitionClarifyQuestion(fakeAskable("track:fixture", 2), 3),
        answer: { selectedValues: ["track-a"] }
      }
    ];
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(generateNextCompetitionQuestion(
      profile,
      transcript,
      candidates,
      [],
      buildCompetitionQualificationSnapshot(profile)
    )).resolves.toMatchObject({
      status: "completed",
      nextQuestion: null,
      provider: "server"
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
