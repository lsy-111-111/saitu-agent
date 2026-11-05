import { getCompetitionFactSheet } from "@/content/competition-facts";
import series from "@/content/competition-series-20261104.json";
import { describe, expect, it } from "vitest";
import { competitions } from "@/content/competitions";
import {
  COMPETITION_EXPANSION_VERIFIED_AT,
  expansionEvidenceReviews,
  expansionCompetitionSpecs
} from "@/content/competition-expansion";
import {
  competitionGuideTrace,
  GUIDE_ALLOWED_RANKS,
  GUIDE_MERGED_RANKS,
  GUIDE_NEW_RANKS,
  guideCompetitionRecommendationProfiles
} from "@/content/competition-guide";
import {
  COMPETITION_CATALOG_VERSION,
  COMPETITION_LEGACY_ID_MIGRATIONS,
  findCanonicalCatalogCompetition,
  findCatalogCompetition,
  isCatalogCompetitionId,
  resolveCatalogCompetitionId
} from "@/lib/competitions/catalog";

const researchedSeriesIds = new Set(series.map((row) => row.id));

const stableCompetitionIds = [
  "digital-media-creative-tech",
  "future-aircraft-design",
  "vocational-innovation-entrepreneurship",
  "iot-design",
  "youth-tech-challenge",
  "career-planning",
  "low-altitude-industry",
  "ican-innovation-entrepreneurship",
  "graduate-rural-revitalization-agritech",
  "green-development",
  "xuechuangbei-business-simulation",
  "business-elite-innovation",
  "mechanical-innovation-design",
  "3d-digital-innovation-design"
];

describe("competition recommendation catalog", () => {
  it("keeps the 14 stable IDs inside the unique catalog with complete matching metadata", () => {
    expect(competitions).toHaveLength(100 + series.length);
    expect(competitions.map((competition) => competition.id)).toEqual(
      expect.arrayContaining(stableCompetitionIds)
    );
    expect(new Set(competitions.map((competition) => competition.id)).size).toBe(competitions.length);
    expect(COMPETITION_CATALOG_VERSION).toMatch(/^2026-11-04\./);

    for (const competition of competitions) {
      const metadata = competition.recommendation;
      expect(findCatalogCompetition(competition.id)).toBe(competition);
      expect(metadata.majors.length).toBeGreaterThan(0);
      expect(metadata.skills.length).toBeGreaterThan(0);
      expect(metadata.interests.length).toBeGreaterThan(0);
      expect(metadata.preferredOutputs.length).toBeGreaterThan(0);
      if (!researchedSeriesIds.has(competition.id)) expect(metadata.weeklyHours.length).toBeGreaterThan(0);
      else expect(metadata.weeklyHours, "Unmeasured hours must stay unknown").toEqual([]);
      expect(Object.keys(metadata.goalValues)).toHaveLength(7);
      expect(metadata.dataCompleteness).toBeGreaterThanOrEqual(0);
      expect(metadata.dataCompleteness).toBeLessThanOrEqual(1);
      expect(metadata.schedule.sourceUrl).toBeTruthy();
      expect(["known", "unrestricted", "unknown"]).toContain(metadata.stages.state);
      expect(["known", "unrestricted", "unknown"]).toContain(metadata.regions.state);
    }
  });

  it("publishes 59 additions with conservative field-level evidence", () => {
    expect(expansionCompetitionSpecs).toHaveLength(59);
    expect(Object.keys(expansionEvidenceReviews)).toHaveLength(59);
    const expansionIds = new Set<string>(expansionCompetitionSpecs.map((entry) => entry.id));
    const additions = competitions.filter((entry) => expansionIds.has(entry.id));
    expect(additions).toHaveLength(59);

    for (const competition of additions) {
      const metadata = competition.recommendation;
      const sources = [metadata.source, ...(metadata.supportingSources ?? [])].filter(
        (source): source is NonNullable<typeof source> => Boolean(source)
      );
      const supportedFacts = new Set(sources.flatMap((source) => source.facts ?? []));
      expect(metadata.source?.facts, competition.id).toContain("identity");
      if (metadata.stages.state !== "unknown") expect(supportedFacts.has("stages"), competition.id).toBe(true);
      if (metadata.teamRequirement.state !== "unknown") {
        expect(supportedFacts.has("teamRequirement"), competition.id).toBe(true);
      }
      if (metadata.eligibility?.state !== "unknown") {
        expect(supportedFacts.has("eligibility"), competition.id).toBe(true);
      }
      if (metadata.schedule.state === "scheduled") expect(supportedFacts.has("schedule"), competition.id).toBe(true);
      if (!metadata.participationModes.includes("unknown")) {
        expect(supportedFacts.has("participationMode"), competition.id).toBe(true);
      }
      const hasCompleteCoreEvidence = ["stages", "teamRequirement", "eligibility"]
        .every((fact) => supportedFacts.has(fact as never));
      if (!hasCompleteCoreEvidence) expect(metadata.dataCompleteness, competition.id).toBeLessThan(0.75);
      expect(metadata.source?.verifiedAt, competition.id).toBe(COMPETITION_EXPANSION_VERIFIED_AT);
      expect(metadata.source?.sourceType, competition.id).not.toBe("unknown");
      expect(metadata.source?.evidenceRef, competition.id).toBe(
        `official:${competition.id}:${COMPETITION_EXPANSION_VERIFIED_AT}`
      );
      expect(competition.identity.evidenceRef, competition.id).toBe(metadata.source?.evidenceRef);
      expect(competition.identity.officialDomain, competition.id).not.toBe("unknown");
      expect(competition.identity.organizer.trim(), competition.id).not.toBe("");
      expect(metadata.participationModes, competition.id).toEqual(
        expansionEvidenceReviews[
          competition.id as keyof typeof expansionEvidenceReviews
        ].participationModes
      );
    }
    expect(new Set(additions.flatMap((entry) => entry.recommendation.participationModes))).toEqual(
      new Set(["unknown", "hybrid", "remote", "offline"])
    );
  });

  it("never presents an unreferenced catalog field as reviewed fact", () => {
    for (const competition of competitions) {
      const metadata = competition.recommendation;
      const sources = [metadata.source, ...(metadata.supportingSources ?? [])].filter(
        (source): source is NonNullable<typeof source> => Boolean(source)
      );
      const facts = new Set(sources.flatMap((source) => source.facts ?? []));
      expect(metadata.subjects?.length, competition.id).toBeGreaterThan(0);
      expect(metadata.participationModes.length, competition.id).toBeGreaterThan(0);
      expect(metadata.source?.url, competition.id).toMatch(/^https:\/\//);
      expect(metadata.source?.verifiedAt, competition.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(metadata.source?.sourceType, competition.id).not.toBe("unknown");
      expect(metadata.source?.evidenceRef, competition.id).toBeTruthy();
      expect(facts.has("identity"), competition.id).toBe(true);
      if (metadata.stages.state !== "unknown") expect(facts.has("stages"), competition.id).toBe(true);
      if (metadata.teamRequirement.state !== "unknown") expect(facts.has("teamRequirement"), competition.id).toBe(true);
      if (metadata.eligibility?.state !== "unknown") expect(facts.has("eligibility"), competition.id).toBe(true);
      if (!metadata.participationModes.includes("unknown")) expect(facts.has("participationMode"), competition.id).toBe(true);

      const schedule = metadata.schedule;
      expect(schedule.sourceUrl, competition.id).toMatch(/^https:\/\//);
      expect(schedule.verifiedAt, competition.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(schedule.sourceType, competition.id).not.toBe("unknown");
      if (schedule.state === "unknown") {
        expect(schedule.datePrecision, competition.id).toBe("unknown");
        expect(schedule.registrationStart, competition.id).toBeUndefined();
        expect(schedule.registrationEnd, competition.id).toBeUndefined();
        expect(schedule.competitionStart, competition.id).toBeUndefined();
        expect(schedule.competitionEnd, competition.id).toBeUndefined();
      }
      if (schedule.state === "scheduled") expect(facts.has("schedule"), competition.id).toBe(true);
    }
  });

  it("requires official core eligibility evidence at the event or representative-track level", () => {
    const gaps: string[] = [];

    for (const competition of competitions) {
      const metadata = competition.recommendation;
      const sources = [metadata.source, ...(metadata.supportingSources ?? [])].filter(
        (source): source is NonNullable<typeof source> => Boolean(source)
      );
      const officialSources = sources.filter(
        (source) => source.sourceType !== "unknown" && Boolean(source.evidenceRef)
      );
      const facts = new Set(officialSources.flatMap((source) => source.facts ?? []));
      const parentHasCore = metadata.stages.state !== "unknown"
        && metadata.teamRequirement.state !== "unknown"
        && Boolean(metadata.eligibility && metadata.eligibility.state !== "unknown")
        && facts.has("stages")
        && facts.has("teamRequirement")
        && facts.has("eligibility");

      const trackEvidenceRefs = new Set(
        officialSources
          .filter((source) => source.facts?.includes("trackEligibility"))
          .map((source) => source.evidenceRef)
          .filter((ref): ref is string => Boolean(ref))
      );
      const representativeTrackHasCore = (metadata.tracks ?? []).some((track) => {
        const verifiedFacts = new Set(track.verifiedFacts ?? []);
        return Boolean(track.stages && track.stages.state !== "unknown")
          && Boolean(track.teamRequirement && track.teamRequirement.state !== "unknown")
          && Boolean(track.eligibilityNotes?.length)
          && Boolean(track.evidenceRef && trackEvidenceRefs.has(track.evidenceRef))
          && ["stages", "teamRequirement", "eligibility"].every((fact) => verifiedFacts.has(
            fact as "stages" | "teamRequirement" | "eligibility"
          ));
      });

      if (!parentHasCore && !representativeTrackHasCore) {
        if (researchedSeriesIds.has(competition.id)) {
          expect(metadata.eligibility?.state).not.toBe("verified");
          expect(metadata.eligibility?.blockingClarifications?.length).toBeGreaterThan(0);
          expect(getCompetitionFactSheet(competition.id)?.sources.length).toBeGreaterThan(0);
        } else gaps.push(competition.id);
      }
    }

    expect(gaps).toEqual([]);
  });

  it("publishes a bounded, evidence-based 100-point credibility score for every entry", () => {
    const expectedMaximums = {
      authority: 30,
      recentActivity: 20,
      nationalOrInternationalCoverage: 15,
      distinctiveness: 15,
      verifiability: 10,
      diversity: 10
    } as const;
    const totals = new Set<number>();

    for (const competition of competitions) {
      const credibility = competition.recommendation.credibility;
      expect(credibility, competition.id).toBeDefined();
      if (!credibility) continue;

      const criteria = Object.entries(expectedMaximums).map(([key, maxScore]) => {
        const criterion = credibility[key as keyof typeof expectedMaximums];
        expect(criterion.maxScore, `${competition.id}/${key}`).toBe(maxScore);
        expect(criterion.score, `${competition.id}/${key}`).toBeGreaterThanOrEqual(0);
        expect(criterion.score, `${competition.id}/${key}`).toBeLessThanOrEqual(maxScore);
        expect(criterion.basis.trim(), `${competition.id}/${key}`).not.toBe("");
        return criterion;
      });

      expect(credibility.total, competition.id).toBe(
        criteria.reduce((sum, criterion) => sum + criterion.score, 0)
      );
      if (!researchedSeriesIds.has(competition.id)) expect(credibility.total, competition.id).toBeGreaterThanOrEqual(75);
      else expect(credibility.authority.basis.trim(), competition.id).not.toBe("");
      expect(credibility.total, competition.id).toBeLessThanOrEqual(100);
      totals.add(credibility.total);
    }

    expect(totals.size).toBeGreaterThan(3);
    expect(competitions.some((competition) => competition.recommendation.credibility?.total === 100))
      .toBe(false);
    expect(
      findCatalogCompetition("red-tourism-creative-planning")?.recommendation.credibility
        ?.recentActivity.score
    ).toBe(0);
    expect(
      findCatalogCompetition("graduate-culture-china")?.recommendation.credibility
        ?.recentActivity.score
    ).toBeGreaterThanOrEqual(18);
  });

  it("deduplicates all entries by canonical name, organizer and official domain", () => {
    const normalize = (value: string) =>
      value.normalize("NFKC").toLowerCase().replace(/[\s·—–\-_'“”‘’（）()，,：:；;\/\\]+/g, "");
    const compositeKeys = competitions.map((competition) =>
      [
        competition.identity.canonicalName,
        competition.identity.organizer,
        competition.identity.officialDomain
      ].map(normalize).join("::")
    );

    for (const competition of competitions) {
      expect(competition.identity.organizer, competition.id).not.toBe("unknown");
      expect(competition.identity.officialDomain, competition.id).not.toBe("unknown");
      expect(competition.identity.evidenceRef, competition.id).toBe(
        competition.recommendation.source?.evidenceRef
      );
      expect(competition.recommendation.source?.facts, competition.id).toContain("identity");
    }
    expect(new Set(compositeKeys).size).toBe(competitions.length);
    expect(competitions.map((competition) => competition.identity.identityKey)).toEqual(compositeKeys);
  });

  it("keeps retired IDs out of the canonical/AI contract while resolving old saved lookups", () => {
    expect(COMPETITION_LEGACY_ID_MIGRATIONS).toEqual({
      "china-medical-skills": "graduate-cybersecurity-innovation",
      "ai-application-scenarios": "graduate-rural-revitalization-agritech"
    });

    for (const [retiredId, replacementId] of Object.entries(COMPETITION_LEGACY_ID_MIGRATIONS)) {
      expect(competitions.some((competition) => competition.id === retiredId)).toBe(false);
      expect(isCatalogCompetitionId(retiredId)).toBe(false);
      expect(isCatalogCompetitionId(replacementId)).toBe(true);
      expect(resolveCatalogCompetitionId(retiredId)).toBe(replacementId);
      expect(findCatalogCompetition(retiredId)?.id).toBe(replacementId);
      expect(findCanonicalCatalogCompetition(retiredId)).toBeNull();
      expect(findCanonicalCatalogCompetition(replacementId)?.id).toBe(replacementId);
    }
  });

  it("publishes the rural revitalization replacement from current CPIPC evidence", () => {
    const competition = findCatalogCompetition("graduate-rural-revitalization-agritech");
    expect(competition).toMatchObject({
      id: "graduate-rural-revitalization-agritech",
      name: "中国研究生乡村振兴科技强农+创新大赛第五届科技作品竞赛",
      sourceUrl: "https://cpipc.acge.org.cn/cw/hp/2c90800c7a132603017a1395f2c105f9",
      identity: {
        organizer: "中国学位与研究生教育学会",
        officialDomain: "cpipc.acge.org.cn",
        evidenceRef: "official:graduate-rural-revitalization-agritech:2026-08-23"
      }
    });
    expect(competition?.recommendation.stages).toEqual({
      state: "known",
      values: ["undergraduate-4", "master", "doctorate"]
    });
    expect(competition?.recommendation.teamRequirement).toEqual({ state: "known", mode: "either" });
    expect(competition?.recommendation.eligibility).toMatchObject({
      state: "verified",
      sameInstitutionTeam: true
    });
    expect(competition?.recommendation.schedule).toMatchObject({
      state: "scheduled",
      registrationStart: "2026-05-19",
      registrationEnd: "2026-08-24",
      competitionStart: "2026-09-01",
      competitionEnd: "2026-10-17"
    });
    const facts = new Set([
      ...(competition?.recommendation.source?.facts ?? []),
      ...(competition?.recommendation.supportingSources ?? []).flatMap((source) => source.facts ?? [])
    ]);
    for (const fact of [
      "identity",
      "stages",
      "teamRequirement",
      "eligibility",
      "schedule",
      "requiredResources",
      "participationMode",
      "recentActivity"
    ] as const) expect(facts.has(fact), fact).toBe(true);
    expect(competition?.recommendation.credibility?.total).toBeGreaterThanOrEqual(75);
    expect(JSON.stringify(competition)).not.toMatch(/CICAS|cicas|AI应用场景|人工智能应用场景/);
  });

  it("imports exactly the approved guide ranks and merges ranks 21 and 32", () => {
    expect(GUIDE_ALLOWED_RANKS).toEqual([
      1, 2, 3, 4, 5, 6, 8, 10, 12, 13, 15, 16, 17, 21, 22, 24, 26, 27, 28,
      31, 32, 33, 39, 40, 41, 42, 43, 47, 49
    ]);
    expect(GUIDE_NEW_RANKS).toHaveLength(27);
    expect(GUIDE_MERGED_RANKS).toEqual([21, 32]);
    expect(competitionGuideTrace.map((trace) => trace.rank)).toEqual(GUIDE_ALLOWED_RANKS);
    expect(competitionGuideTrace.find((trace) => trace.rank === 21)).toMatchObject({
      catalogId: "career-planning",
      mergeTargetId: "career-planning"
    });
    expect(competitionGuideTrace.find((trace) => trace.rank === 32)).toMatchObject({
      catalogId: "business-elite-innovation",
      mergeTargetId: "business-elite-innovation"
    });
    expect(findCatalogCompetition("career-planning")?.name).toBe("全国大学生职业规划大赛");
    expect(findCatalogCompetition("business-elite-innovation")?.name).toBe("全国高校商业精英挑战赛");
    expect(findCatalogCompetition("business-elite-innovation")?.recommendation.teamRequirement).toEqual({
      state: "known",
      mode: "either"
    });
  });

  it("does not import excluded guide ranks or invent unknown logistics", () => {
    const excludedRanks = [
      7, 9, 11, 14, 18, 19, 20, 23, 25, 29, 30, 34, 35, 36, 37, 38, 44, 45,
      46, 48, 50
    ];
    const tracedRanks = new Set(competitionGuideTrace.map((trace) => trace.rank));
    for (const rank of excludedRanks) expect(tracedRanks.has(rank)).toBe(false);

    const newRanks = new Set<number>(GUIDE_NEW_RANKS);
    const importedIds = new Set(
      competitionGuideTrace
        .filter((trace) => newRanks.has(trace.rank))
        .map((trace) => trace.catalogId)
    );
    for (const competition of competitions.filter((entry) => importedIds.has(entry.id))) {
      expect(competition.coverImage).toMatchObject({
        src: `/competition-posters/${competition.id}.png`,
        sourceSvgSrc: `/competition-posters/source/${competition.id}.svg`,
        metadataSrc: "/competition-posters/manifest.json",
        origin: "ai-generated",
        rightsStatus: "ai-generated-no-human-authorship-claim",
        reviewStatus: "editorial-review-passed",
        reviewedAt: "2026-08-23",
        aiGenerated: true,
        humanReviewRequired: false
      });
      const schedule = competition.recommendation.schedule;
      if (schedule.state === "scheduled") {
        expect(schedule.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(["official-competition", "organizer", "education-authority"]).toContain(
          schedule.sourceType
        );
      } else {
        expect(schedule.state).toBe("unknown");
      }
      expect(competition.recommendation.regions.state).toBe("unknown");
      const assertedParticipation = !competition.recommendation.participationModes.includes("unknown");
      expect(
        competition.recommendation.source?.facts?.includes("participationMode") ?? false,
        competition.id
      ).toBe(assertedParticipation);
    }
  });

  it("structures team formats only when the guide states them explicitly", () => {
    const requirement = (competitionId: string) =>
      findCatalogCompetition(competitionId)?.recommendation.teamRequirement;

    expect(requirement("national-college-math-modeling")).toEqual({
      state: "known",
      mode: "either",
      minSize: 1,
      maxSize: 3
    });
    expect(requirement("icpc-programming")).toEqual({
      state: "known",
      mode: "team",
      minSize: 3,
      maxSize: 3
    });
    expect(requirement("market-research-analysis")).toEqual({
      state: "known",
      mode: "team",
      minSize: 3,
      maxSize: 5
    });
    expect(requirement("understanding-contemporary-china-foreign-language")).toEqual({
      state: "known",
      mode: "either",
      minSize: 1,
      maxSize: 5
    });
    expect(requirement("lanqiao-cup")).toEqual({
      state: "known",
      mode: "individual",
      minSize: 1,
      maxSize: 1
    });
    expect(requirement("21st-century-english-speaking")).toEqual({
      state: "known",
      mode: "individual",
      minSize: 1,
      maxSize: 1
    });
    expect(requirement("icbc-fintech-innovation")).toEqual({ state: "known", mode: "team" });

    expect(requirement("challenge-cup-academic-science")).toEqual({
      state: "known",
      mode: "either"
    });
    expect(requirement("siemens-intelligent-manufacturing")).toEqual({
      state: "known",
      mode: "either",
      minSize: 1,
      maxSize: 3
    });
    expect(requirement("china-college-computer-contest")).toEqual({
      state: "known",
      mode: "team"
    });
  });

  it("links every hard track rule to the official entry evidence", () => {
    for (const competition of competitions) {
      for (const track of competition.recommendation.tracks ?? []) {
        const expectedFacts = [
          ...(track.stages ? ["stages"] : []),
          ...(track.teamRequirement ? ["teamRequirement"] : []),
          ...(track.eligibilityNotes?.length ? ["eligibility"] : [])
        ];
        if (!expectedFacts.length) continue;

        const trackEvidenceRefs = [
          competition.recommendation.source,
          ...(competition.recommendation.supportingSources ?? [])
        ]
          .filter((source) => source?.facts?.includes("trackEligibility"))
          .map((source) => source?.evidenceRef);
        expect(trackEvidenceRefs, `${competition.id}/${track.id}`).toContain(track.evidenceRef);
        expect(track.verifiedFacts, `${competition.id}/${track.id}`).toEqual(
          expect.arrayContaining(expectedFacts)
        );
      }
    }
  });

  it("separates submission workflows and activity notices from qualification blockers", () => {
    const cases = [
      ["national-college-math-modeling", "学校统一报名", "赛区人数"],
      ["graduate-math-modeling", "培养单位资格审核", null],
      ["graduate-rural-revitalization-agritech", "培养单位资格审核", "队伍人数"],
      ["culsc-life-sciences", "学校当届参赛确认", "仅加入1支参赛队伍"]
    ] as const;

    for (const [competitionId, workflowNotice, remainingBlocker] of cases) {
      const metadata = findCatalogCompetition(competitionId)?.recommendation;
      expect(metadata?.dataNotices.join(" "), competitionId).toContain(workflowNotice);
      expect(
        metadata?.eligibility?.blockingClarifications?.join(" ") ?? "",
        competitionId
      ).not.toContain(workflowNotice);
      if (remainingBlocker) {
        expect(
          metadata?.eligibility?.blockingClarifications?.join(" ") ?? "",
          competitionId
        ).toContain(remainingBlocker);
      }
    }

    for (const competitionId of [
      "vocational-innovation-entrepreneurship",
      "mechanical-innovation-design",
      "ecommerce-innovation-creativity-entrepreneurship",
      "robocup-china"
    ]) {
      const metadata = findCatalogCompetition(competitionId)?.recommendation;
      expect(metadata?.dataNotices.join(" "), competitionId).toMatch(/近24个月/);
      expect(metadata?.eligibility?.notes.join(" "), competitionId).not.toMatch(/近24个月/);
    }
  });

  it("records fixed-profile track eligibility facts as typed metadata", () => {
    expect(findCatalogCompetition("computer-system-ability")?.recommendation.tracks?.[0])
      .toMatchObject({
        teamRequirement: { state: "known", mode: "either", minSize: 1, maxSize: 3 },
        requiresFullTime: true,
        sameInstitutionTeam: true,
        verifiedFacts: expect.arrayContaining(["stages", "teamRequirement", "eligibility"])
      });
    expect(findCatalogCompetition("information-security-confrontation")?.recommendation.tracks?.[0])
      .toMatchObject({ requiresFullTime: true, sameInstitutionTeam: true });
    expect(findCatalogCompetition("global-campus-ai-algorithm")?.recommendation.tracks?.[0])
      .toMatchObject({ requiresCurrentEnrollment: true });
    expect(findCatalogCompetition("brics-skills")?.recommendation.tracks?.[0]
      .blockingClarifications?.join(" ")).toMatch(/18周岁/);
  });

  it("keeps verified guide eligibility fact-scoped and separates factual groups from preferences", () => {
    for (const [competitionId, metadata] of Object.entries(
      guideCompetitionRecommendationProfiles
    )) {
      if (!metadata.eligibility) continue;
      expect(metadata.eligibility.source.evidenceRef, competitionId).toBeTruthy();
      expect(metadata.eligibility.source.facts, competitionId).toContain("eligibility");
      const officialFactSources = [
        metadata.eligibility.source,
        ...(metadata.supportingSources ?? [])
      ];
      if (metadata.stages.state === "known") {
        expect(officialFactSources.some(({ facts }) => facts?.includes("stages")), competitionId)
          .toBe(true);
      }
      if (metadata.teamRequirement.state === "known") {
        expect(officialFactSources.some(({ facts }) => facts?.includes("teamRequirement")), competitionId)
          .toBe(true);
      }
      expect(metadata.source?.evidenceRef, competitionId)
        .toBe(metadata.eligibility.source.evidenceRef);
      expect(metadata.source?.facts, competitionId)
        .toEqual(metadata.eligibility.source.facts);
    }

    const factTrackIds = (competitionId: string) =>
      findCatalogCompetition(competitionId)?.recommendation.tracks
        ?.filter(({ preferenceQuestionEligible }) => preferenceQuestionEligible === false)
        .map(({ id }) => id) ?? [];
    expect(factTrackIds("challenge-cup-entrepreneurship-plan"))
      .toEqual(["registered", "unregistered"]);
    expect(factTrackIds("china-international-college-innovation")).toEqual([
      "undergraduate-creative",
      "undergraduate-startup",
      "graduate-creative",
      "graduate-startup",
      "vocational-creative",
      "vocational-startup"
    ]);
    expect(factTrackIds("career-planning")).toEqual(["growth", "employment"]);
  });

  it("structures the current ICPC entry-year cutoff without inferring it from notes", () => {
    const icpc = findCatalogCompetition("icpc-programming");
    expect(icpc?.recommendation.eligibility?.firstHigherEducationYearCutoff).toMatchObject({
      state: "verified",
      contestCycle: "2026/27",
      minimumYear: 2022,
      alternativeMinimumBirthYear: 2003,
      petitionAvailable: true
    });
    expect(icpc?.recommendation.source?.facts).toContain("firstHigherEducationYearCutoff");
    expect(icpc?.recommendation.eligibility?.firstHigherEducationYearCutoff?.source.evidenceRef)
      .toBe(icpc?.recommendation.source?.evidenceRef);

    const entriesWithCutoff = competitions.filter(
      (competition) => competition.recommendation.eligibility?.firstHigherEducationYearCutoff
    );
    expect(entriesWithCutoff.map((competition) => competition.id)).toEqual(["icpc-programming"]);
  });

  it("models iGEM's PI, laboratory, fee and safety requirements with separate official evidence", () => {
    const igem = findCatalogCompetition("igem-collegiate");
    expect(igem?.recommendation.requiredResources).toEqual(
      expect.arrayContaining(["mentor", "lab", "equipment", "budget", "safety-compliance"])
    );
    expect(igem?.recommendation.dataNotices.join(" ")).toContain("长周期高投入");

    const sources = igem?.recommendation.supportingSources ?? [];
    expect(sources.map((source) => source.url)).toEqual(expect.arrayContaining([
      "https://competition.igem.org/registration/team-roster",
      "https://competition.igem.org/registration/fees",
      "https://responsibility.igem.org/safety-policies",
      "https://competition.igem.org/about/starting-a-team"
    ]));
    for (const source of sources) {
      expect(source.verifiedAt).toBe(COMPETITION_EXPANSION_VERIFIED_AT);
      expect(source.evidenceRef).toBeTruthy();
      expect(source.facts?.length).toBeGreaterThan(0);
    }
  });

  it("preserves guide score grades, recommendation indices and ten-dimensional vectors", () => {
    for (const trace of competitionGuideTrace) {
      expect(["S", "A", "B"]).toContain(trace.grade);
      expect(trace.recommendationIndex).toBeGreaterThan(0);
      expect(Object.values(trace.scoreVector)).toHaveLength(10);
      expect(Object.values(trace.scoreVector).reduce((sum, value) => sum + value, 0)).toBe(trace.score);
    }
  });

  it("only treats sourced schedules as structured and preserves their verified precision", () => {
    for (const competition of competitions) {
      const schedule = competition.recommendation.schedule;
      if (schedule.state === "scheduled") {
        expect(["day", "month"]).toContain(schedule.datePrecision);
        expect(schedule.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(["official-competition", "organizer", "education-authority"]).toContain(
          schedule.sourceType
        );
      } else {
        expect(schedule.datePrecision).toBe("unknown");
        expect(["official-competition", "organizer", "education-authority", "unknown"]).toContain(
          schedule.sourceType
        );
      }
    }
  });
});
