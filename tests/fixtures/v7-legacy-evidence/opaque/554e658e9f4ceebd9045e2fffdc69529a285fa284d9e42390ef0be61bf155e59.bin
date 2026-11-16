import { describe, expect, it } from "vitest";
import { getCompetitionCatalog } from "@/lib/competitions/catalog";
import {
  buildCompetitionQualificationSnapshot,
  scoreCompetitionRecommendations
} from "@/lib/competitions/scoring";
import { recommendCompetitions } from "@/lib/competitions/recommendation-engine";
import type {
  CompetitionDynamicExchangeV3,
  CompetitionQualificationSnapshotV1,
  CompetitionRecommendationProfileV5
} from "@/types/competition-recommendation";
import { deepSeekLivePersonas } from "../fixtures/deepseek-live-personas";
import {
  QUALITY_BENCHMARK_NOW,
  competitionQualityPersonas,
  competitionRankingHoldoutCases
} from "../fixtures/competition-quality-personas";

const allAuditPersonas = [
  ...competitionQualityPersonas,
  ...competitionRankingHoldoutCases
];

const sourceProfile = competitionRankingHoldoutCases.find(
  ({ id }) => id === "rank-undergraduate-upper-electronics"
)?.profile;
if (!sourceProfile) throw new Error("Missing qualification audit source profile");

const fullyConfirmedProfile: CompetitionRecommendationProfileV5 = {
  ...sourceProfile,
  decisionContext: {fixedTeam:true},
  confirmedFacts: [
    "enrollmentStatus",
    "firstHigherEducationYear",
    "teamUnit",
    "teamSize"
  ],
  enrollmentStatus: "full-time-student",
  firstHigherEducationYear: 2023,
  teamUnit: "same-unit",
  teamSize: "three",
  availableResources: [
    "mentor",
    "lab",
    "equipment",
    "data",
    "budget",
    "school-registration",
    "safety-compliance"
  ]
};

function snapshot(profile: CompetitionRecommendationProfileV5) {
  return buildCompetitionQualificationSnapshot(
    profile,
    undefined,
    QUALITY_BENCHMARK_NOW
  );
}

function entry(
  qualificationSnapshot: CompetitionQualificationSnapshotV1,
  competitionId: string
) {
  const found = qualificationSnapshot.entries.find(
    (candidate) => candidate.competitionId === competitionId
  );
  if (!found) throw new Error(`Missing qualification entry: ${competitionId}`);
  return found;
}

function distribution(profiles: readonly CompetitionRecommendationProfileV5[]) {
  const result = { eligible: 0, needs_clarification: 0, ineligible: 0 };
  for (const profile of profiles) {
    for (const candidate of snapshot(profile).entries) result[candidate.status] += 1;
  }
  return result;
}

function trackPreferenceExchange(
  competitionId: string,
  tracks: readonly { id: string; label: string }[],
  selectedTrackId: string
): CompetitionDynamicExchangeV3 {
  return {
    question: {
      questionId: `qualification_audit_track_${competitionId}`,
      signalKey: `track:${competitionId}`,
      prompt: `《${competitionId}》的这些候选方向中，你更想优先准备哪个赛道？`,
      selection: "single",
      options: tracks.map(({ id, label }) => ({ value: id, label })),
      allowsNote: true,
      maxNoteLength: 120,
      impact: "material",
      estimatedPreferenceOutcomeChanges: 2
    },
    answer: { selectedValues: [selectedTrackId] }
  };
}

/**
 * These official facts cannot be proven by the fixed questionnaire. They must
 * remain explicit blockers until a future typed, signed fact is introduced.
 */
const fixedQuestionUnprovableCompetitionFacts = [
  // Age, citizenship and prior-entry facts.
  "china-international-college-innovation",
  "china-us-young-maker",
  "green-development",
  // Exact major or professional-program membership.
  "geology-skills",
  "embedded-chip-system-design",
  "garden-design-build",
  "graduate-public-management-case",
  // Institution approval, recommendation and registration facts.
  "national-structural-design",
  "water-innovation-design",
  "surveying-innovation",
  "tax-risk-case",
  "graduate-rural-revitalization-agritech",
  "national-college-math-modeling",
  // Track-specific team, selection or submission facts.
  "engineering-practice-innovation",
  "culsc-life-sciences",
  "smart-agricultural-equipment",
  "graduate-ai-innovation",
  "graduate-cybersecurity-innovation",
  "metallographic-skills",
  "mechanical-engineering-innovation",
  "physics-experiment-innovation",
  // Chemistry tracks now have independent official team limits and structured facts.
  "statistical-modeling",
  "enterprise-competition-simulation",
  "world-vocational-skills",
  "robotac",
  "graduate-electronic-design",
  "graduate-culture-china",
  // Project provenance, advisor, prior-participation and compliance facts.
  "challenge-cup-academic-science",
  "challenge-cup-entrepreneurship-plan",
  "icpc-programming",
  "market-research-analysis",
  "understanding-contemporary-china-foreign-language",
  "comap-mcm-icm",
  "igem-collegiate",
  "digital-enterprise-sandbox",
  "keyun-accounting",
  "zhou-peiyuan-mechanics"
] as const;

describe("typed competition qualification audit", () => {
  it("keeps all three states reachable across the 21 live and 175 frozen profiles", () => {
    expect(deepSeekLivePersonas).toHaveLength(21);
    expect(allAuditPersonas).toHaveLength(175);
    const seriesCount = getCompetitionCatalog().length;
    expect(seriesCount).toBeGreaterThanOrEqual(135);

    const live = distribution(deepSeekLivePersonas.map(({ profile }) => profile));
    const frozen = distribution(allAuditPersonas.map(({ profile }) => profile));
    expect(Object.values(live).reduce((sum, value) => sum + value, 0)).toBe(seriesCount * deepSeekLivePersonas.length);
    expect(Object.values(frozen).reduce((sum, value) => sum + value, 0)).toBe(seriesCount * allAuditPersonas.length);
    expect(live.eligible).toBeGreaterThan(0);
    expect(live.needs_clarification).toBeGreaterThan(0);
    expect(live.ineligible).toBeGreaterThan(0);
    expect(frozen.eligible).toBeGreaterThan(0);
    expect(frozen.needs_clarification).toBeGreaterThan(0);
    expect(frozen.ineligible).toBeGreaterThan(0);
  });

  it("marks rule summaries nonblocking only after every typed fixed fact is satisfied", () => {
    const qualificationSnapshot = snapshot(fullyConfirmedProfile);
    for (const competitionId of ["national-college-electronic-design"]) {
      expect(entry(qualificationSnapshot, competitionId)).toMatchObject({
        status: "eligible",
        reasons: [],
        hardFilterReason: null
      });
    }
    expect(entry(
      snapshot({ ...fullyConfirmedProfile, teamSize: "solo" }),
      "matiji-programming"
    )).toMatchObject({
      status: "eligible",
      reasons: [],
      hardFilterReason: null
    });
    expect(entry(snapshot({
      ...fullyConfirmedProfile,
      stage: "master",
      teamSize: "three"
    }), "graduate-math-modeling")).toMatchObject({
      status: "eligible",
      reasons: [],
      hardFilterReason: null
    });
  });

  it("keeps genuine unresolved official facts in needs clarification", () => {
    const doctorate = snapshot({ ...fullyConfirmedProfile, stage: "doctorate" });
    expect(entry(doctorate, "challenge-cup-academic-science")).toMatchObject({
      status: "needs_clarification",
      hardFilterReason: null
    });
    expect(entry(doctorate, "challenge-cup-academic-science").reasons.join(" "))
      .toMatch(/替代通道/);

    const withoutFirstYear = snapshot({
      ...fullyConfirmedProfile,
      confirmedFacts: fullyConfirmedProfile.confirmedFacts.filter(
        (fact) => fact !== "firstHigherEducationYear"
      ),
      firstHigherEducationYear: undefined
    });
    expect(entry(withoutFirstYear, "icpc-programming").status).toBe("needs_clarification");
    expect(entry(withoutFirstYear, "icpc-programming").reasons.join(" "))
      .toMatch(/首次接受高等教育年份/);

    expect(entry(snapshot(fullyConfirmedProfile), "igem-collegiate")).toMatchObject({
      status: "needs_clarification",
      hardFilterReason: null
    });
    expect(entry(snapshot(fullyConfirmedProfile), "igem-collegiate").reasons.join(" "))
      .toMatch(/Primary PI|安全|费用/);
  });

  it("still hard-excludes independently proven contradictions", () => {
    const wrongStage = snapshot({ ...fullyConfirmedProfile, stage: "master" });
    expect(entry(wrongStage, "national-college-math-modeling")).toMatchObject({
      status: "ineligible",
      hardFilterReason: "stage-ineligible"
    });
    expect(entry(wrongStage, "national-college-electronic-design")).toMatchObject({
      status: "ineligible",
      hardFilterReason: "stage-ineligible"
    });
    expect(entry(wrongStage, "engineering-practice-innovation")).toMatchObject({
      status: "ineligible",
      hardFilterReason: "stage-ineligible"
    });
    expect(entry(
      snapshot({ ...fullyConfirmedProfile, stage: "doctorate" }),
      "national-college-math-modeling"
    )).toMatchObject({
      status: "ineligible",
      hardFilterReason: "stage-ineligible"
    });

    const wrongTeamSize = snapshot({ ...fullyConfirmedProfile, teamSize: "two" });
    expect(entry(wrongTeamSize, "national-college-electronic-design")).toMatchObject({
      status: "ineligible",
      hardFilterReason: "team-size-ineligible"
    });
  });

  it("never upgrades a fixed-question-unprovable official fact across all 175 profiles", () => {
    const catalog = getCompetitionCatalog();
    for (const competitionId of fixedQuestionUnprovableCompetitionFacts) {
      expect(catalog.find(({ id }) => id === competitionId)?.recommendation.eligibility)
        .toMatchObject({ blockingClarifications: expect.any(Array) });
    }

    for (const persona of allAuditPersonas) {
      const qualificationSnapshot = snapshot(persona.profile);
      for (const competitionId of fixedQuestionUnprovableCompetitionFacts) {
        expect(
          entry(qualificationSnapshot, competitionId).status,
          `${persona.id}:${competitionId}`
        ).not.toBe("eligible");
      }
    }
  });

  it("keeps unmodeled track facts non-eligible without downgrading factual content tracks", () => {
    const qualificationSnapshot = snapshot({ ...fullyConfirmedProfile, teamSize: "four" });
    const datang = entry(qualificationSnapshot, "datang-ict");
    expect(datang.tracks.find(({ trackId }) => trackId === "5g-innovation"))
      .toMatchObject({ status: "needs_clarification" });
    const foreignLanguage = entry(
      qualificationSnapshot,
      "understanding-contemporary-china-foreign-language"
    );
    expect(foreignLanguage.tracks.find(({ trackId }) => trackId === "international-chinese"))
      .toMatchObject({ status: "needs_clarification" });
    expect(foreignLanguage.tracks.find(({ trackId }) => trackId === "short-video")?.status)
      .not.toBe("ineligible");
  });

  it("settles official track rules only from typed fixed-profile facts", () => {
    const track = (
      profile: CompetitionRecommendationProfileV5,
      competitionId: string,
      trackId: string
    ) => entry(snapshot(profile), competitionId).tracks.find(
      (candidate) => candidate.trackId === trackId
    );

    const twoPerson: CompetitionRecommendationProfileV5 = {
      ...fullyConfirmedProfile,
      teamSize: "two"
    };
    expect(track(twoPerson, "computer-system-ability", "os-function-challenge"))
      .toMatchObject({ status: "eligible", reasons: [], hardFilterReason: null });
    expect(track({
      ...twoPerson,
      enrollmentStatus: "part-time-student"
    }, "computer-system-ability", "os-function-challenge")).toMatchObject({
      status: "ineligible",
      hardFilterReason: "full-time-status-ineligible"
    });
    expect(track({
      ...twoPerson,
      teamUnit: "mixed-unit"
    }, "computer-system-ability", "os-function-challenge")).toMatchObject({
      status: "ineligible",
      hardFilterReason: "same-institution-team-ineligible"
    });

    expect(track(fullyConfirmedProfile, "information-security-confrontation", "game-confrontation"))
      .toMatchObject({ status: "eligible", reasons: [], hardFilterReason: null });
    expect(track(fullyConfirmedProfile, "global-campus-ai-algorithm", "indoor-agriculture"))
      .toMatchObject({ status: "eligible", reasons: [], hardFilterReason: null });
    expect(track({
      ...fullyConfirmedProfile,
      enrollmentStatus: "recent-graduate"
    }, "global-campus-ai-algorithm", "indoor-agriculture")).toMatchObject({
      status: "ineligible",
      hardFilterReason: "enrollment-status-ineligible"
    });
    expect(track(fullyConfirmedProfile, "brics-skills", "technology-innovation"))
      .toMatchObject({ status: "needs_clarification", hardFilterReason: null });
  });

  it("aggregates parent qualification from child tracks and never exposes an impossible parent", () => {
    for (const persona of allAuditPersonas) {
      for (const candidate of snapshot(persona.profile).entries) {
        if (
          candidate.tracks.length > 0 &&
          candidate.tracks.every(({ status }) => status === "ineligible")
        ) {
          expect(candidate.status, `${persona.id}:${candidate.competitionId}`)
            .toBe("ineligible");
        }
      }
    }

    const threePersonSnapshot = snapshot(fullyConfirmedProfile);
    const datang = entry(threePersonSnapshot, "datang-ict");
    expect(datang.tracks.every(({ status }) => status === "ineligible")).toBe(true);
    expect(datang).toMatchObject({
      status: "ineligible",
      hardFilterReason: "team-size-ineligible"
    });

    const fourPersonSnapshot = snapshot({ ...fullyConfirmedProfile, teamSize: "four" });
    expect(entry(fourPersonSnapshot, "datang-ict")).toMatchObject({
      status: "needs_clarification",
      hardFilterReason: null
    });
    expect(entry(fourPersonSnapshot, "datang-ict").tracks.find(
      ({ trackId }) => trackId === "5g-innovation"
    )).toMatchObject({ status: "needs_clarification" });
  });

  it("keeps every scored track's complete qualification result byte-for-byte aligned with the frozen snapshot", () => {
    const catalog = getCompetitionCatalog();
    for (const persona of allAuditPersonas) {
      const qualificationSnapshot = snapshot(persona.profile);
      const defaultScored = scoreCompetitionRecommendations(catalog, persona.profile, {
        now: QUALITY_BENCHMARK_NOW
      });
      for (const scored of defaultScored) {
        const frozenEntry = entry(qualificationSnapshot, scored.competition.id);
        const frozenBranch = scored.recommendedTrack
          ? frozenEntry.tracks.find(({ trackId }) => trackId === scored.recommendedTrack?.id)
          : frozenEntry;
        expect(frozenBranch, `${persona.id}:${scored.competition.id}:default branch`).toBeDefined();
        expect(scored.eligibility, `${persona.id}:${scored.competition.id}:default qualification`)
          .toEqual({ status: frozenBranch!.status, reasons: frozenBranch!.reasons });
      }

      for (const frozenEntry of qualificationSnapshot.entries) {
        if (frozenEntry.tracks.length === 0) continue;
        const competition = catalog.find(({ id }) => id === frozenEntry.competitionId);
        expect(competition, frozenEntry.competitionId).toBeDefined();
        const tracks = competition!.recommendation.tracks ?? [];
        for (const frozenTrack of frozenEntry.tracks) {
          if (frozenTrack.status === "ineligible") continue;
          const selected = scoreCompetitionRecommendations([competition!], persona.profile, {
            now: QUALITY_BENCHMARK_NOW,
            transcript: [trackPreferenceExchange(
              competition!.id,
              tracks,
              frozenTrack.trackId
            )]
          })[0];
          expect(selected, `${persona.id}:${competition!.id}:${frozenTrack.trackId}`).toBeDefined();
          expect(selected?.recommendedTrack?.id).toBe(frozenTrack.trackId);
          expect(selected?.eligibility,
            `${persona.id}:${competition!.id}:${frozenTrack.trackId}:qualification`)
            .toEqual({ status: frozenTrack.status, reasons: frozenTrack.reasons });
        }
      }
    }
  });

  it("attaches only fact-scoped official evidence to qualification snapshots", () => {
    const qualificationFacts = new Set([
      "stages",
      "teamRequirement",
      "eligibility",
      "firstHigherEducationYearCutoff",
      "requiredResources",
      "trackEligibility"
    ]);
    const qualificationSnapshot = snapshot(fullyConfirmedProfile);
    for (const competition of getCompetitionCatalog()) {
      const metadata = competition.recommendation;
      const officialSources = [
        metadata.source,
        metadata.eligibility?.source,
        metadata.eligibility?.firstHigherEducationYearCutoff?.source,
        ...(metadata.supportingSources ?? [])
      ].filter((source) => source && source.sourceType !== "unknown");
      const frozen = entry(qualificationSnapshot, competition.id);
      const refs = new Set([
        ...frozen.sourceRefs,
        ...frozen.tracks.flatMap(({ sourceRefs }) => sourceRefs)
      ]);
      for (const evidenceRef of refs) {
        const sources = officialSources.filter((source) => source?.evidenceRef === evidenceRef);
        expect(sources.length, `${competition.id}:${evidenceRef}:missing source`).toBeGreaterThan(0);
        expect(
          sources.some((source) => source?.facts?.some((fact) =>
            qualificationFacts.has(fact) ||
            (metadata.schedule.state === "cancelled" && fact === "schedule")
          )),
          `${competition.id}:${evidenceRef}:non-qualification evidence`
        ).toBe(true);
      }
    }
  });

  it("models the eight strict-review corrections at the fixed-profile boundary", () => {
    const qualificationSnapshot = snapshot(fullyConfirmedProfile);
    for (const competitionId of [
      "smart-agricultural-equipment",
      "culsc-life-sciences",
      "engineering-practice-innovation"
    ]) {
      expect(entry(qualificationSnapshot, competitionId).status, competitionId)
        .toBe("needs_clarification");
    }
    expect(entry(
      snapshot({ ...fullyConfirmedProfile, stage: "master" }),
      "graduate-ai-innovation"
    ).status).toBe("needs_clarification");

    expect(entry(
      snapshot({ ...fullyConfirmedProfile, teamSize: "two" }),
      "national-college-math-modeling"
    )).toMatchObject({
      status: "needs_clarification",
      hardFilterReason: null
    });
    expect(entry(
      snapshot({ ...fullyConfirmedProfile, teamSize: "two" }),
      "national-college-math-modeling"
    ).reasons.join(" ")).toMatch(/赛区人数/);
    expect(entry(
      snapshot({ ...fullyConfirmedProfile, teamSize: "two" }),
      "national-college-math-modeling"
    ).reasons.join(" ")).not.toMatch(/学校统一报名/);
    expect(entry(
      snapshot({ ...fullyConfirmedProfile, teamSize: "over-five" }),
      "national-college-math-modeling"
    )).toMatchObject({
      status: "ineligible",
      hardFilterReason: expect.stringMatching(/team-size-ineligible|all-tracks-ineligible/)
    });
    expect(entry(
      snapshot({ ...fullyConfirmedProfile, teamUnit: "mixed-unit" }),
      "national-college-math-modeling"
    )).toMatchObject({
      status: "ineligible",
      hardFilterReason: expect.stringMatching(
        /same-institution-team-ineligible|all-tracks-ineligible/
      )
    });
    expect(entry(
      snapshot({ ...fullyConfirmedProfile, teamSize: "solo" }),
      "engineering-practice-innovation"
    )).toMatchObject({
      status: "needs_clarification",
      hardFilterReason: null
    });
    expect(entry(
      snapshot({ ...fullyConfirmedProfile, teamSize: "over-five" }),
      "engineering-practice-innovation"
    )).toMatchObject({
      status: "ineligible",
      hardFilterReason: "team-size-ineligible"
    });

    const undergraduatePartTime = snapshot({
      ...fullyConfirmedProfile,
      enrollmentStatus: "part-time-student"
    });
    expect(entry(undergraduatePartTime, "smart-agricultural-equipment"))
      .toMatchObject({
        status: "ineligible",
        hardFilterReason: "full-time-status-ineligible"
      });
    expect(entry(snapshot({
      ...fullyConfirmedProfile,
      stage: "vocational",
      enrollmentStatus: "part-time-student"
    }), "smart-agricultural-equipment")).toMatchObject({
      status: "ineligible",
      hardFilterReason: "full-time-status-ineligible"
    });
    const graduatePartTime = snapshot({
      ...fullyConfirmedProfile,
      stage: "master",
      enrollmentStatus: "part-time-student"
    });
    expect(entry(graduatePartTime, "smart-agricultural-equipment"))
      .toMatchObject({ status: "needs_clarification", hardFilterReason: null });
    expect(entry(snapshot({
      ...fullyConfirmedProfile,
      stage: "doctorate",
      enrollmentStatus: "part-time-student"
    }), "smart-agricultural-equipment")).toMatchObject({
      status: "needs_clarification",
      hardFilterReason: null
    });
    for (const [stage, enrollmentStatus] of [
      ["master", "recent-graduate"],
      ["doctorate", "graduated"]
    ] as const) {
      expect(entry(snapshot({
        ...fullyConfirmedProfile,
        stage,
        enrollmentStatus
      }), "smart-agricultural-equipment")).toMatchObject({
        status: "ineligible",
        hardFilterReason: "enrollment-status-ineligible"
      });
    }
    expect(entry(snapshot({
      ...fullyConfirmedProfile,
      stage: "master",
      enrollmentStatus: "other"
    }), "smart-agricultural-equipment")).toMatchObject({
      status: "needs_clarification",
      hardFilterReason: null
    });
    const graduateFullTime = entry(snapshot({
      ...fullyConfirmedProfile,
      stage: "master",
      enrollmentStatus: "full-time-student"
    }), "smart-agricultural-equipment");
    expect(graduateFullTime).toMatchObject({
      status: "needs_clarification",
      hardFilterReason: null
    });
    expect(graduateFullTime.reasons.join(" ")).not.toMatch(/全脱产/);

    const graduateMatiji = entry(snapshot({
      ...fullyConfirmedProfile,
      stage: "master",
      teamSize: "solo"
    }), "matiji-programming");
    expect(graduateMatiji).toMatchObject({ status: "eligible", hardFilterReason: null });

    const missingFullTime = snapshot({
      ...fullyConfirmedProfile,
      confirmedFacts: fullyConfirmedProfile.confirmedFacts.filter(
        (fact) => fact !== "enrollmentStatus"
      ),
      enrollmentStatus: undefined,
      teamSize: "solo"
    });
    expect(entry(missingFullTime, "matiji-programming").status).toBe("needs_clarification");
    expect(entry(missingFullTime, "national-college-mathematics").status)
      .toBe("needs_clarification");

    const soloGraduateAi = entry(snapshot({
      ...fullyConfirmedProfile,
      stage: "master",
      teamSize: "solo"
    }), "graduate-ai-innovation");
    const soloTrack = soloGraduateAi.tracks.find(
      ({ trackId }) => trackId === "individual-entry"
    );
    expect(soloTrack).toMatchObject({ status: "needs_clarification" });
    expect(soloTrack?.reasons.join(" ")).toMatch(/仅加入一支队伍/);
    expect(soloTrack?.reasons.join(" ")).not.toMatch(/占比|队长/);

    const teamGraduateAi = entry(snapshot({
      ...fullyConfirmedProfile,
      stage: "master",
      teamSize: "two"
    }), "graduate-ai-innovation").tracks.find(
      ({ trackId }) => trackId === "team-entry"
    );
    expect(teamGraduateAi).toMatchObject({ status: "needs_clarification" });
    expect(teamGraduateAi?.reasons.join(" ")).toMatch(/占比/);
    expect(teamGraduateAi?.reasons.join(" ")).toMatch(/队长/);

    const cumcm = getCompetitionCatalog().find(
      ({ id }) => id === "national-college-math-modeling"
    );
    expect(cumcm?.recommendation.source?.url).toBe(
      "https://www.mcm.edu.cn/upload_cn/node/779/D3txF20S95f4041e22b41b4a1f9e0e22ac8a1389.pdf"
    );
    expect(cumcm?.recommendation.supportingSources?.some(
      ({ evidenceRef }) => evidenceRef ===
        "official:national-college-math-modeling:current-charter"
    )).toBe(true);
    expect(entry(snapshot(fullyConfirmedProfile), "national-college-math-modeling").sourceRefs)
      .toEqual(expect.arrayContaining([
        "official:national-college-math-modeling:2026-08-23",
        "official:national-college-math-modeling:current-charter"
      ]));
    expect(cumcm?.recommendation.tracks?.every(
      ({ preferenceQuestionEligible }) => preferenceQuestionEligible === false
    )).toBe(true);

    const datang = getCompetitionCatalog().find(({ id }) => id === "datang-ict");
    expect(datang?.recommendation.tracks?.map(({ label, teamRequirement }) => ({
      label,
      teamRequirement
    }))).toEqual([
      {
        label: "工程实践赛",
        teamRequirement: { state: "known", mode: "team", minSize: 2, maxSize: 2 }
      },
      {
        label: "产教融合5G+创新应用赛",
        teamRequirement: { state: "known", mode: "team", minSize: 4, maxSize: 6 }
      },
      {
        label: "ICT通识赛",
        teamRequirement: { state: "known", mode: "team", minSize: 2, maxSize: 2 }
      }
    ]);
    for (const track of datang?.recommendation.tracks ?? []) {
      expect(track.evidenceRef, track.id).toMatch(/^official:datang-ict:/);
      expect(track.verifiedFacts, track.id).toEqual(expect.arrayContaining([
        "stages",
        "teamRequirement"
      ]));
    }
    const datangByTeamSize = (teamSize: CompetitionRecommendationProfileV5["teamSize"]) =>
      entry(snapshot({ ...fullyConfirmedProfile, teamSize }), "datang-ict");
    expect(datangByTeamSize("solo").status).toBe("ineligible");
    const datangTeamTwo = datangByTeamSize("two");
    expect(datangTeamTwo.tracks.find(({ trackId }) => trackId === "engineering-practice"))
      .toMatchObject({ status: "needs_clarification" });
    expect(datangTeamTwo.tracks.find(({ trackId }) => trackId === "5g-innovation"))
      .toMatchObject({ status: "ineligible" });
    expect(datangTeamTwo.tracks.find(({ trackId }) => trackId === "ict-general"))
      .toMatchObject({ status: "needs_clarification" });
    expect(datangByTeamSize("three").status).toBe("ineligible");
    expect(datangByTeamSize("four-five").tracks.find(
      ({ trackId }) => trackId === "5g-innovation"
    )).toMatchObject({ status: "needs_clarification" });
    expect(datangByTeamSize("over-five").tracks.find(
      ({ trackId }) => trackId === "5g-innovation"
    )).toMatchObject({ status: "needs_clarification" });
    for (const track of getCompetitionCatalog().find(
      ({ id }) => id === "graduate-ai-innovation"
    )?.recommendation.tracks ?? []) {
      expect(track.evidenceRef, track.id).toMatch(/^official:graduate-ai-innovation:/);
      expect(track.verifiedFacts, track.id).toEqual(expect.arrayContaining([
        "stages",
        "teamRequirement"
      ]));
    }

    for (const competitionId of [
      "national-college-math-modeling",
      "graduate-ai-innovation",
      "smart-agricultural-equipment",
      "culsc-life-sciences",
      "engineering-practice-innovation",
      "datang-ict",
      "matiji-programming",
      "national-college-mathematics"
    ]) {
      expect(entry(snapshot(fullyConfirmedProfile), competitionId).sourceRefs.length,
        competitionId).toBeGreaterThan(0);
    }

    const smartAgriculture = getCompetitionCatalog().find(
      ({ id }) => id === "smart-agricultural-equipment"
    );
    expect(smartAgriculture).toBeDefined();
    expect(smartAgriculture?.recommendation.schedule).toMatchObject({
      state: "scheduled",
      registrationEnd: "2025-11-30"
    });
    const scoredSmartAgriculture = scoreCompetitionRecommendations(
      [smartAgriculture!],
      fullyConfirmedProfile,
      { now: QUALITY_BENCHMARK_NOW }
    )[0];
    expect(scoredSmartAgriculture?.availability.registrationStatus.status).toBe("closed");
    expect(scoredSmartAgriculture?.eligibility.status).toBe("needs_clarification");
    const preferenceTranscript: CompetitionDynamicExchangeV3[] = [{
      question: {
        questionId: "qualification_invariance_fit",
        signalKey: "competition-fit",
        prompt: "你更希望重点证明哪类实战能力？",
        selection: "multiple",
        maxSelections: 2,
        options: [
          { value: "hardware-build", label: "硬件工程" },
          { value: "software-engineering", label: "软件工程" }
        ],
        allowsNote: true,
        maxNoteLength: 120,
        impact: "material",
        estimatedPreferenceOutcomeChanges: 2
      },
      answer: { selectedValues: ["hardware-build"] }
    }];
    const preferenceScored = scoreCompetitionRecommendations(
      [smartAgriculture!],
      fullyConfirmedProfile,
      { now: QUALITY_BENCHMARK_NOW, transcript: preferenceTranscript }
    )[0];
    expect(preferenceScored?.eligibility).toEqual(scoredSmartAgriculture?.eligibility);
  });

  it("offers evidence-backed recommendations with confirmed or conditional eligibility", () => {
    const visible = allAuditPersonas.flatMap(({ profile }) =>
      recommendCompetitions(profile, { now: QUALITY_BENCHMARK_NOW }).recommendations
    );
    expect(visible.some((item) =>
      item.recommendationRole === "best" && item.eligibility.status === "eligible"
    )).toBe(true);
    expect(visible.some((item) =>
      item.scoreCalibration.qualified && item.eligibility.status === "needs_clarification"
    )).toBe(true);
  });
});
