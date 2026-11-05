import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { competitions, type Competition } from "@/content/competitions";
import {
  competitionQuestionnaireV1Schema,
  normalizeCompetitionQuestionnaire
} from "@/lib/ai/competition-questionnaire";
import {
  getCompetitionRecommendationCandidates,
  recommendCompetitions
} from "@/lib/competitions/recommendation-engine";
import {
  generateNextCompetitionQuestion,
  simulateCompetitionClarifyOutcome
} from "@/lib/ai/competition-clarify";
import { projectLegacyCompetitionPreferenceTranscript } from "@/lib/competitions/legacy-preference-adapter";
import {
  buildCompetitionQualificationSnapshot,
  getHardFilterReason,
  scoreCompetition,
  scoreCompetitionRecommendations
} from "@/lib/competitions/scoring";
import {
  getCompetitionCatalog,
  getCompetitionPreferenceQuestionTracks
} from "@/lib/competitions/catalog";
import {
  COMPETITION_QUESTIONNAIRE_FIELD_SPECS
} from "@/lib/ai/competition-questionnaire";
import {
  QUALITY_BENCHMARK_NOW,
  QUALITY_STAGE_GROUPS,
  competitionAnchorPersonas,
  competitionHardNegativePersonas,
  competitionNoMatchPersonas,
  competitionQualityPersonas,
  competitionRankingHoldoutCases,
  competitionYearConstraintBoundaryPersonas,
  qualityPersonaStageGroup,
  type CompetitionAnchorPersona,
  type CompetitionHardNegativeDecisiveFact,
  type CompetitionRankingHoldoutCase,
  type QualityStageGroup
} from "../fixtures/competition-quality-personas";
import {
  competitionFreeTextSamples,
  questionnaireForFreeTextSample
} from "../fixtures/competition-free-text-samples";
import {
  staticCompetitionPreferenceOracles,
  type CompetitionPreferenceOracle
} from "../fixtures/competition-preference-oracle";
import {
  COMPETITION_FIXED_QUESTION_IDS,
  type CompetitionDynamicExchangeV2,
  type CompetitionDynamicExchangeV3,
  type CompetitionDynamicQuestionV3,
  type CompetitionQualificationSnapshotV1,
  type CompetitionQuestionnaireFieldId,
  type CompetitionRecommendationProfileV5,
  type CompetitionTeamSize
} from "@/types/competition-recommendation";

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const reproducibleProfile = (profile: CompetitionRecommendationProfileV5) => JSON.stringify(profile);
const benchmarkPreferenceTranscript = (transcript: readonly CompetitionDynamicExchangeV2[]) =>
  projectLegacyCompetitionPreferenceTranscript(transcript);

function recommendedAnchorIds(persona: CompetitionAnchorPersona) {
  return getCompetitionRecommendationCandidates(persona.profile, {
    now: QUALITY_BENCHMARK_NOW,
    transcript: benchmarkPreferenceTranscript(persona.transcript)
  }).recommendations.slice(0, 10).map(({ competitionId }) => competitionId);
}

function hitAt(ids: readonly string[], relevant: readonly string[], k: number) {
  const relevantSet = new Set(relevant);
  return ids.slice(0, k).some((id) => relevantSet.has(id)) ? 1 : 0;
}

function precisionAt(ids: readonly string[], relevant: readonly string[], k: number) {
  const relevantSet = new Set(relevant);
  const predicted = ids.slice(0, k);
  return predicted.length ? predicted.filter((id) => relevantSet.has(id)).length / predicted.length : 0;
}

function ndcgAt3(ids: readonly string[], persona: CompetitionRankingHoldoutCase) {
  const relevanceById = new Map(persona.labels.map(({ competitionId, relevance }) => [competitionId, relevance]));
  const relevance = (id: string) => relevanceById.get(id) ?? 0;
  const dcg = ids.slice(0, 3).reduce<number>((sum, id, index) =>
    sum + (2 ** relevance(id) - 1) / Math.log2(index + 2), 0
  );
  const idealRelevances = persona.labels
    .map(({ relevance }) => relevance)
    .sort((left, right) => right - left)
    .slice(0, 3);
  const idealDcg = idealRelevances.reduce<number>((sum, value, index) =>
    sum + (2 ** value - 1) / Math.log2(index + 2), 0
  );
  return idealDcg ? dcg / idealDcg : 0;
}

function mean(values: readonly number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function qualificationSnapshotFingerprint(snapshot: CompetitionQualificationSnapshotV1) {
  return JSON.stringify(snapshot.entries.map((entry) => ({
    competitionId: entry.competitionId,
    status: entry.status,
    reasons: entry.reasons,
    hardFilterReason: entry.hardFilterReason,
    sourceRefs: entry.sourceRefs,
    tracks: entry.tracks.map((track) => ({
      trackId: track.trackId,
      status: track.status,
      reasons: track.reasons,
      hardFilterReason: track.hardFilterReason,
      sourceRefs: track.sourceRefs
    }))
  })));
}

function legalQuestionAnswers(question: CompetitionDynamicQuestionV3) {
  const values = question.options.map(({ value }) => value);
  const answers = values.map((value) => [value]);
  if (question.selection !== "multiple" || (question.maxSelections ?? 1) < 2) return answers;
  for (let left = 0; left < values.length; left += 1) {
    for (let right = left + 1; right < values.length; right += 1) {
      answers.push([values[left]!, values[right]!]);
    }
  }
  return answers;
}

function oracleAnswer(
  oracle: CompetitionPreferenceOracle,
  question: CompetitionDynamicQuestionV3
): string[] | null {
  const allowed = new Set(question.options.map(({ value }) => value));
  const priorities = question.signalKey === "competition-fit"
    ? oracle.fitPriority
    : question.signalKey === "candidate-goal-tradeoff"
      ? oracle.goalPriority
      : oracle.trackPriorityByCompetition[question.signalKey.slice("track:".length)] ?? [];
  const selected = priorities.find((value) => allowed.has(value));
  if (!selected) {
    if (question.signalKey.startsWith("track:")) return null;
    throw new Error(
      `${oracle.personaId}: static oracle has no legal answer for ${question.signalKey}; ` +
      `allowed=${[...allowed].join(",")}`
    );
  }
  return [selected];
}

function scoringQualificationDivergences(
  profile: CompetitionRecommendationProfileV5,
  transcript: readonly CompetitionDynamicExchangeV3[],
  snapshot: CompetitionQualificationSnapshotV1
) {
  return scoreCompetitionRecommendations(getCompetitionCatalog(), profile, {
    now: QUALITY_BENCHMARK_NOW,
    transcript
  }).flatMap(({ competition, recommendedTrack, eligibility }) => {
    const entry = snapshot.entries.find(({ competitionId }) => competitionId === competition.id);
    const expected = recommendedTrack
      ? entry?.tracks.find(({ trackId }) => trackId === recommendedTrack.id)
      : entry;
    return expected &&
      expected.status === eligibility.status &&
      JSON.stringify(expected.reasons) === JSON.stringify(eligibility.reasons)
      ? []
      : [`${competition.id}:${recommendedTrack?.id ?? "mother"}`];
  });
}

type TrueV5PreferenceTurn = {
  status: "question" | "optional_question";
  question: CompetitionDynamicQuestionV3;
  selectedValues: string[] | null;
  actualPreferenceOutcomeChanges: number;
  qualificationSnapshotUnchanged: boolean;
  scoringQualificationDivergences: string[];
  precomputedTrackStatus: "eligible" | "needs_clarification" | null;
  trackAdoptionVerified: boolean | null;
};

type TrueV5PreferencePathResult = {
  persona: CompetitionRankingHoldoutCase;
  oracle: CompetitionPreferenceOracle;
  transcript: CompetitionDynamicExchangeV3[];
  turns: TrueV5PreferenceTurn[];
  terminalStatus:
    | "completed"
    | "optional_answered"
    | "optional_skipped"
    | "oracle_unanswered_track"
    | "max_questions";
  fixedTopTen: string[];
  fixedTopThree: string[];
  fullTopTen: string[];
  fullTopThree: string[];
};

let trueV5PreferencePathPromise: Promise<TrueV5PreferencePathResult[]> | undefined;

function runTrueV5PreferencePaths() {
  trueV5PreferencePathPromise ??= Promise.all(competitionRankingHoldoutCases.map(async (persona) => {
    const oracle = staticCompetitionPreferenceOracles.find(({ personaId }) => personaId === persona.id);
    if (!oracle) throw new Error(`${persona.id}: missing static preference oracle`);
    const snapshot = buildCompetitionQualificationSnapshot(
      persona.profile,
      undefined,
      QUALITY_BENCHMARK_NOW
    );
    const frozenSnapshotFingerprint = qualificationSnapshotFingerprint(snapshot);
    const transcript: CompetitionDynamicExchangeV3[] = [];
    const turns: TrueV5PreferenceTurn[] = [];
    let terminalStatus: TrueV5PreferencePathResult["terminalStatus"] = "max_questions";

    const fixedTopTen = getCompetitionRecommendationCandidates(persona.profile, {
      now: QUALITY_BENCHMARK_NOW,
      transcript: []
    }).recommendations.slice(0, 10).map(({ competitionId }) => competitionId);
    const fixedTopThree = recommendCompetitions(persona.profile, {
      now: QUALITY_BENCHMARK_NOW,
      transcript: []
    }).recommendations.map(({ competitionId }) => competitionId);

    for (let turnIndex = 0; turnIndex < 3; turnIndex += 1) {
      const candidates = getCompetitionRecommendationCandidates(persona.profile, {
        now: QUALITY_BENCHMARK_NOW,
        transcript
      }).recommendations;
      const response = await generateNextCompetitionQuestion(
        persona.profile,
        transcript,
        candidates,
        transcript.map(({ question }) => question.signalKey),
        snapshot,
        { now: QUALITY_BENCHMARK_NOW }
      );
      if (response.status === "completed" || !response.nextQuestion) {
        terminalStatus = "completed";
        break;
      }

      const question = response.nextQuestion;
      const actualPreferenceOutcomeChanges = response.status === "question"
        ? new Set(legalQuestionAnswers(question).map((selectedValues) => JSON.stringify(
            simulateCompetitionClarifyOutcome(
              persona.profile,
              candidates,
              question.signalKey,
              selectedValues,
              transcript,
              { now: QUALITY_BENCHMARK_NOW }
            )
          ))).size
        : 0;

      if (response.status === "optional_question" && oracle.optionalDecision === "skip") {
        turns.push({
          status: response.status,
          question,
          selectedValues: null,
          actualPreferenceOutcomeChanges,
          qualificationSnapshotUnchanged: true,
          scoringQualificationDivergences: [],
          precomputedTrackStatus: null,
          trackAdoptionVerified: null
        });
        terminalStatus = "optional_skipped";
        break;
      }

      const selectedValues = oracleAnswer(oracle, question);
      if (selectedValues === null) {
        turns.push({
          status: response.status,
          question,
          selectedValues: null,
          actualPreferenceOutcomeChanges,
          qualificationSnapshotUnchanged: true,
          scoringQualificationDivergences: [],
          precomputedTrackStatus: null,
          trackAdoptionVerified: null
        });
        terminalStatus = "oracle_unanswered_track";
        break;
      }
      const exchange: CompetitionDynamicExchangeV3 = {
        question,
        answer: { selectedValues }
      };
      transcript.push(exchange);
      const afterSnapshot = buildCompetitionQualificationSnapshot(
        persona.profile,
        undefined,
        QUALITY_BENCHMARK_NOW
      );
      const targetCompetitionId = question.signalKey.startsWith("track:")
        ? question.signalKey.slice("track:".length)
        : null;
      const selectedTrack = targetCompetitionId
        ? snapshot.entries
            .find(({ competitionId }) => competitionId === targetCompetitionId)
            ?.tracks.find(({ trackId }) => trackId === selectedValues[0])
        : undefined;
      const scoredTarget = targetCompetitionId
        ? scoreCompetitionRecommendations(getCompetitionCatalog(), persona.profile, {
            now: QUALITY_BENCHMARK_NOW,
            transcript
          }).find(({ competition }) => competition.id === targetCompetitionId)
        : undefined;
      turns.push({
        status: response.status,
        question,
        selectedValues,
        actualPreferenceOutcomeChanges,
        qualificationSnapshotUnchanged:
          qualificationSnapshotFingerprint(afterSnapshot) === frozenSnapshotFingerprint,
        scoringQualificationDivergences: scoringQualificationDivergences(
          persona.profile,
          transcript,
          snapshot
        ),
        precomputedTrackStatus: selectedTrack?.status === "eligible" || selectedTrack?.status === "needs_clarification"
          ? selectedTrack.status
          : null,
        trackAdoptionVerified: targetCompetitionId
          ? Boolean(
              selectedTrack &&
              selectedTrack.status !== "ineligible" &&
              scoredTarget?.recommendedTrack?.id === selectedTrack.trackId &&
              scoredTarget.eligibility.status === selectedTrack.status &&
              JSON.stringify(scoredTarget.eligibility.reasons) === JSON.stringify(selectedTrack.reasons)
            )
          : null
      });
      if (response.status === "optional_question") {
        terminalStatus = "optional_answered";
        break;
      }
    }

    if (terminalStatus === "max_questions") {
      const candidates = getCompetitionRecommendationCandidates(persona.profile, {
        now: QUALITY_BENCHMARK_NOW,
        transcript
      }).recommendations;
      const afterThird = await generateNextCompetitionQuestion(
        persona.profile,
        transcript,
        candidates,
        transcript.map(({ question }) => question.signalKey),
        snapshot,
        { now: QUALITY_BENCHMARK_NOW }
      );
      if (afterThird.status !== "completed" || afterThird.nextQuestion !== null) {
        throw new Error(`${persona.id}: generated a forbidden fourth preference question`);
      }
    }

    const fullTopTen = getCompetitionRecommendationCandidates(persona.profile, {
      now: QUALITY_BENCHMARK_NOW,
      transcript
    }).recommendations.slice(0, 10).map(({ competitionId }) => competitionId);
    const fullTopThree = recommendCompetitions(persona.profile, {
      now: QUALITY_BENCHMARK_NOW,
      transcript
    }).recommendations.map(({ competitionId }) => competitionId);

    return {
      persona,
      oracle,
      transcript,
      turns,
      terminalStatus,
      fixedTopTen,
      fixedTopThree,
      fullTopTen,
      fullTopThree
    };
  }));
  return trueV5PreferencePathPromise;
}

function teamSizeNumber(teamSize: CompetitionTeamSize | undefined) {
  return teamSize === "solo" ? 1
    : teamSize === "two" ? 2
      : teamSize === "three" ? 3
        : teamSize === "four" ? 4
          : teamSize === "five" || teamSize === "four-five" ? 5
            : teamSize === "over-five" ? 6
              : null;
}

/** Independent benchmark-side check for sourced hard constraints. */
function officialEligibilityViolation(
  competition: Competition,
  profile: CompetitionRecommendationProfileV5,
  recommendedTrackId?: string | null
): string | null {
  const metadata = competition.recommendation;
  const eligibility = metadata.eligibility;
  const sources = [
    metadata.source,
    eligibility?.source,
    ...(metadata.supportingSources ?? [])
  ].filter((source): source is NonNullable<typeof source> => Boolean(source));
  const isOfficialSource = (source: (typeof sources)[number]) =>
    source.sourceType !== "unknown" && source.url.startsWith("https://");
  const hasOfficialFact = (fact: NonNullable<(typeof sources)[number]["facts"]>[number]) =>
    sources.some((source) => isOfficialSource(source) && source.facts?.includes(fact));
  if (!sources.some(isOfficialSource)) return null;
  const selectedTrack = recommendedTrackId
    ? metadata.tracks?.find(({ id }) => id === recommendedTrackId)
    : undefined;
  const selectedTrackSource = selectedTrack?.evidenceRef
    ? sources.find((source) => source.evidenceRef === selectedTrack.evidenceRef && isOfficialSource(source))
    : undefined;
  const selectedTrackHasOfficialFact = (fact: "stages" | "teamRequirement") => Boolean(
    selectedTrackSource && selectedTrack?.verifiedFacts?.includes(fact)
  );
  const stages = selectedTrack && selectedTrackHasOfficialFact("stages") && selectedTrack.stages
    ? selectedTrack.stages
    : metadata.stages;
  const stagesAreOfficial = selectedTrack && selectedTrackHasOfficialFact("stages")
    ? true
    : hasOfficialFact("stages");
  if (stagesAreOfficial && stages.state === "known" && !stages.values.includes(profile.stage)) return "stage";
  if (
    hasOfficialFact("eligibility") &&
    profile.confirmedFacts.includes("enrollmentStatus") &&
    (
      eligibility?.requiresFullTime ||
      eligibility?.requiresFullTimeStages?.includes(profile.stage)
    ) &&
    profile.enrollmentStatus !== "full-time-student" &&
    profile.enrollmentStatus !== "other"
  ) return "full-time";
  if (
    hasOfficialFact("eligibility") &&
    profile.confirmedFacts.includes("enrollmentStatus") &&
    eligibility?.requiresCurrentEnrollment &&
    (
      profile.enrollmentStatus === "recent-graduate" ||
      profile.enrollmentStatus === "graduated"
    )
  ) return "enrollment-status";
  if (
    hasOfficialFact("eligibility") &&
    profile.confirmedFacts.includes("teamUnit") &&
    eligibility?.sameInstitutionTeam &&
    profile.teamUnit === "mixed-unit"
  ) return "same-unit";
  if (
    profile.confirmedFields.includes("availableResources") &&
    hasOfficialFact("requiredResources") &&
    (metadata.requiredResources ?? []).some(
      (resource) => resource !== "none" && !profile.availableResources.includes(resource)
    )
  ) return "required-resource";
  const cutoff = eligibility?.firstHigherEducationYearCutoff;
  if (
    cutoff?.state === "verified" &&
    hasOfficialFact("firstHigherEducationYearCutoff") &&
    profile.confirmedFacts.includes("firstHigherEducationYear") &&
    profile.firstHigherEducationYear !== undefined &&
    profile.firstHigherEducationYear < cutoff.minimumYear &&
    cutoff.alternativeMinimumBirthYear === undefined &&
    cutoff.petitionAvailable !== true
  ) return "first-higher-education-year";
  const teamSize = profile.confirmedFacts.includes("teamSize")
    ? teamSizeNumber(profile.teamSize)
    : null;
  const requirement = selectedTrack && selectedTrackHasOfficialFact("teamRequirement") && selectedTrack.teamRequirement
    ? selectedTrack.teamRequirement
    : metadata.teamRequirement;
  const requirementIsOfficial = selectedTrack && selectedTrackHasOfficialFact("teamRequirement")
    ? true
    : hasOfficialFact("teamRequirement");
  if (teamSize !== null && requirementIsOfficial && requirement.state === "known" && requirement.mode !== "either") {
    if (requirement.mode === "individual" && teamSize !== 1) return "individual-only";
    if (
      requirement.mode === "team" &&
      teamSize === 1 &&
      !requirement.minimumSizeUnknown
    ) return "team-only";
    if (requirement.minSize !== undefined && teamSize < requirement.minSize) return "team-min";
    if (requirement.maxSize !== undefined && teamSize > requirement.maxSize) return "team-max";
  }
  return null;
}

function binaryF1(labels: readonly boolean[], predictions: readonly boolean[]) {
  const truePositive = labels.filter((label, index) => label && predictions[index]).length;
  const falsePositive = labels.filter((label, index) => !label && predictions[index]).length;
  const falseNegative = labels.filter((label, index) => label && !predictions[index]).length;
  const precision = truePositive / Math.max(1, truePositive + falsePositive);
  const recall = truePositive / Math.max(1, truePositive + falseNegative);
  return precision + recall ? 2 * precision * recall / (precision + recall) : 0;
}

describe("competition quality benchmark fixtures", () => {
  it("contains exactly 100 auditable anchors, 30 hard negatives and 20 no-match personas", () => {
    expect(competitionAnchorPersonas).toHaveLength(100);
    expect(competitionHardNegativePersonas).toHaveLength(30);
    expect(competitionNoMatchPersonas).toHaveLength(20);
    expect(competitionQualityPersonas).toHaveLength(150);
    expect(new Set(competitionQualityPersonas.map(({ id }) => id)).size).toBe(150);

    expect(competitionAnchorPersonas.map(({ expectedId }) => expectedId).sort()).toEqual(
      competitions.map(({ id }) => id).sort()
    );
    const invalidConstraintEvidenceRefs: string[] = [];
    for (const persona of competitionAnchorPersonas) {
      const competition = competitions.find(({ id }) => id === persona.expectedId);
      const catalogEvidenceRefs = new Set([
        competition?.recommendation.source,
        competition?.recommendation.eligibility?.source,
        ...(competition?.recommendation.supportingSources ?? [])
      ].flatMap((source) => source?.evidenceRef ? [source.evidenceRef] : []));
      expect(competition, persona.id).toBeDefined();
      expect(persona.expectedName, persona.id).toBe(competition?.name);
      expect(persona.evidenceRef, persona.id).toBe(competition?.identity.evidenceRef);
      expect(persona.constraintEvidenceRefs.length, persona.id).toBeGreaterThan(0);
      invalidConstraintEvidenceRefs.push(...persona.constraintEvidenceRefs
        .filter((evidenceRef) => !catalogEvidenceRefs.has(evidenceRef))
        .map((evidenceRef) => `${persona.id}: ${evidenceRef}`));
      expect(persona.rationale.length, persona.id).toBeGreaterThan(10);
      expect(persona.officialConstraintRationale.length, persona.id).toBeGreaterThan(20);
      expect(qualityPersonaStageGroup(persona.profile), persona.id).toBe(persona.stageGroup);
      expect(persona.profile.confirmedFields, persona.id).toContain("specificSubjects");
      expect(persona.profile.specificSubjects.length, persona.id).toBeGreaterThanOrEqual(1);
      expect(persona.profile.specificSubjects.length, persona.id).toBeLessThanOrEqual(3);
      expect(
        persona.transcript.every(({ question, answer }) =>
          !question.signalKey.startsWith("track:") &&
          !question.signalKey.startsWith("eligibility:") &&
          !answer.selectedValues.includes("ineligible")
        ),
        `${persona.id} must not inject target identity or eligibility into recall`
      ).toBe(true);
    }
    expect(invalidConstraintEvidenceRefs, invalidConstraintEvidenceRefs.join("\n")).toEqual([]);

    const fixtureDirectory = path.join(process.cwd(), "tests", "fixtures");
    const staticFixtureFiles = readdirSync(fixtureDirectory)
      .filter((name) => /^competition-quality-(?:anchors-\d|ranking-gold|negative-gold|no-match-gold|year-gold)\.ts$/.test(name));
    expect(staticFixtureFiles).toHaveLength(8);
    for (const fileName of staticFixtureFiles) {
      const source = readFileSync(path.join(fixtureDirectory, fileName), "utf8");
      expect(source, fileName).not.toContain("@/content/competitions");
      expect(source, fileName).not.toContain("profileForCompetition");
      expect(source, fileName).not.toContain("competitions.map");
      expect(source, fileName).not.toContain("targetCompetitionId");
    }

    expect(competitionRankingHoldoutCases).toHaveLength(25);
    expect(new Set(competitionRankingHoldoutCases.map(({ id }) => id)).size).toBe(25);
    const anchorProfiles = new Set(competitionAnchorPersonas.map(({ profile }) => reproducibleProfile(profile)));
    const ineligibleRankingLabels: string[] = [];
    for (const persona of competitionRankingHoldoutCases) {
      expect(persona.profileOrigin, persona.id).toBe("expert-authored-independent");
      expect(persona.visibleFacts.length, persona.id).toBeGreaterThanOrEqual(4);
      expect(persona.rationale.length, persona.id).toBeGreaterThan(10);
      expect(persona.profile.confirmedFields, persona.id).toContain("specificSubjects");
      expect(persona.profile.specificSubjects.length, persona.id).toBeGreaterThanOrEqual(1);
      expect(
        persona.transcript.every(({ question }) => question.signalKey === "competition-fit"),
        `${persona.id} must not inject a target-specific track or eligibility answer`
      ).toBe(true);
      expect(anchorProfiles.has(reproducibleProfile(persona.profile)), `${persona.id} duplicates a target-derived anchor`).toBe(false);
      expect(persona.labels.some(({ relevance }) => relevance === 2), persona.id).toBe(true);
      expect(new Set(persona.labels.map(({ competitionId }) => competitionId)).size, persona.id).toBe(persona.labels.length);
      for (const label of persona.labels) {
        const competition = competitions.find(({ id }) => id === label.competitionId);
        expect(competition, `${persona.id}:${label.competitionId}`).toBeDefined();
        expect(label.evidenceRef, `${persona.id}:${label.competitionId}`).toBe(competition?.identity.evidenceRef);
        expect(label.rationale.length, `${persona.id}:${label.competitionId}`).toBeGreaterThan(10);
        const violation = competition ? officialEligibilityViolation(competition, persona.profile) : "missing";
        if (violation) ineligibleRankingLabels.push(`${persona.id}:${label.competitionId}:${violation}`);
      }
    }
    expect(ineligibleRankingLabels, ineligibleRankingLabels.join("\n")).toEqual([]);

    expect(new Set(competitionNoMatchPersonas.map(({ rationale }) => rationale)).size).toBe(20);
    expect(new Set(competitionNoMatchPersonas.map(({ profile }) => reproducibleProfile(profile))).size).toBe(20);
    for (const persona of competitionNoMatchPersonas) {
      expect(persona.profile.confirmedFields, persona.id).toContain("specificSubjects");
      expect(persona.profile.specificSubjects.length, persona.id).toBeGreaterThanOrEqual(1);
    }
    for (const stageGroup of QUALITY_STAGE_GROUPS) {
      expect(
        competitionRankingHoldoutCases.filter((persona) => persona.stageGroup === stageGroup),
        stageGroup
      ).toHaveLength(5);
    }

    const groupCounts = new Map<QualityStageGroup, number>(QUALITY_STAGE_GROUPS.map((group) => [group, 0]));
    for (const persona of competitionQualityPersonas) {
      groupCounts.set(persona.stageGroup, (groupCounts.get(persona.stageGroup) ?? 0) + 1);
    }
    const diagnostics = [...groupCounts].map(([group, count]) => `${group}=${count}`).join(", ");
    for (const group of QUALITY_STAGE_GROUPS) {
      expect(groupCounts.get(group), diagnostics).toBeGreaterThanOrEqual(15);
    }
  });

  it("represents evidenced exact-four team rules without widening them to a legacy bucket", () => {
    const anchorsByCompetitionId = new Map(
      competitionAnchorPersonas.map((persona) => [persona.expectedId, persona])
    );
    const exactFourCompetitions = competitions.filter((competition) => {
      const requirement = competition.recommendation.teamRequirement;
      const facts = new Set([
        competition.recommendation.source,
        competition.recommendation.eligibility?.source,
        ...(competition.recommendation.supportingSources ?? [])
      ].flatMap((source) => source?.facts ?? []));
      return facts.has("teamRequirement") &&
        requirement.state === "known" &&
        requirement.minSize === 4 &&
        requirement.maxSize === 4;
    });

    expect(exactFourCompetitions.length).toBeGreaterThan(0);
    for (const competition of exactFourCompetitions) {
      const anchor = anchorsByCompetitionId.get(competition.id);
      expect(anchor?.profile.confirmedFacts, competition.id).toContain("teamSize");
      expect(anchor?.profile.teamSize, competition.id).toBe("four");
      expect(anchor?.transcript, competition.id).toEqual([]);
    }
  });
});

describe("independent V5 preference oracle", () => {
  it("contains one static, auditable decision record for every independent holdout", () => {
    expect(staticCompetitionPreferenceOracles).toHaveLength(25);
    expect(new Set(staticCompetitionPreferenceOracles.map(({ personaId }) => personaId)).size).toBe(25);
    expect(
      staticCompetitionPreferenceOracles.map(({ personaId }) => personaId).sort()
    ).toEqual(competitionRankingHoldoutCases.map(({ id }) => id).sort());

    const source = readFileSync(
      path.join(process.cwd(), "tests", "fixtures", "competition-preference-oracle.ts"),
      "utf8"
    );
    expect(source).not.toContain("@/content/competitions");
    expect(source).not.toContain("@/lib/competitions/scoring");
    expect(source).not.toContain("@/lib/competitions/recommendation-engine");
    expect(source).not.toContain("@/lib/ai/competition-clarify");
    expect(source).not.toContain("baseMatchScore");
    expect(source).not.toContain("expectedTop");
    expect(staticCompetitionPreferenceOracles.some(({ optionalDecision }) => optionalDecision === "answer")).toBe(true);
    expect(staticCompetitionPreferenceOracles.some(({ optionalDecision }) => optionalDecision === "skip")).toBe(true);

    for (const oracle of staticCompetitionPreferenceOracles) {
      const persona = competitionRankingHoldoutCases.find(({ id }) => id === oracle.personaId)!;
      expect(oracle.fitPriority.length, oracle.personaId).toBeGreaterThan(0);
      expect(oracle.goalPriority.length, oracle.personaId).toBeGreaterThan(0);
      expect(oracle.goalPriority.every((goal) => persona.profile.goals.includes(goal)), oracle.personaId).toBe(true);
      expect(Object.values(oracle.trackPriorityByCompetition).every((values) => values.length > 0), oracle.personaId).toBe(true);
      expect(oracle.fitRationale.length, oracle.personaId).toBeGreaterThanOrEqual(20);
      expect(oracle.goalRationale.length, oracle.personaId).toBeGreaterThanOrEqual(20);
      expect(oracle.trackRationale.length, oracle.personaId).toBeGreaterThanOrEqual(20);
      expect(oracle.optionalRationale.length, oracle.personaId).toBeGreaterThanOrEqual(20);
      expect(["answer", "skip"], oracle.personaId).toContain(oracle.optionalDecision);
    }
  });

  it("keeps every authored track priority inside the content-preference whitelist and frozen snapshot", () => {
    const failures: string[] = [];
    for (const oracle of staticCompetitionPreferenceOracles) {
      const persona = competitionRankingHoldoutCases.find(({ id }) => id === oracle.personaId)!;
      const snapshot = buildCompetitionQualificationSnapshot(
        persona.profile,
        undefined,
        QUALITY_BENCHMARK_NOW
      );
      for (const [competitionId, trackIds] of Object.entries(oracle.trackPriorityByCompetition)) {
        const competition = getCompetitionCatalog().find(({ id }) => id === competitionId);
        const preferenceTrackIds = new Set(
          competition ? getCompetitionPreferenceQuestionTracks(competition).map(({ id }) => id) : []
        );
        const entry = snapshot.entries.find((item) => item.competitionId === competitionId);
        for (const trackId of trackIds) {
          if (!preferenceTrackIds.has(trackId)) {
            failures.push(`${oracle.personaId}:${competitionId}:${trackId}:not-preference-question-eligible`);
          }
          const track = entry?.tracks.find((item) => item.trackId === trackId);
          if (!track || track.status === "ineligible") {
            failures.push(`${oracle.personaId}:${competitionId}:${trackId}:${track?.status ?? "missing"}`);
          }
        }
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("keeps V2 holdout answers isolated behind the legacy adapter regression", () => {
    for (const persona of competitionRankingHoldoutCases) {
      const projected = projectLegacyCompetitionPreferenceTranscript(persona.transcript);
      expect(projected.every(({ question }) =>
        question.signalKey === "competition-fit" || question.signalKey.startsWith("track:")
      ), persona.id).toBe(true);
      expect(projected.some(({ question }) => {
        const signalKey: string = question.signalKey;
        return signalKey.startsWith("eligibility:") || signalKey === "team-eligibility";
      }), persona.id).toBe(false);
    }
  });
});

describe("100-competition deterministic recommendation quality gates", () => {
  const anchorResults = competitionAnchorPersonas.map((persona) => ({
    persona,
    ids: recommendedAnchorIds(persona)
  }));

  it("achieves 100% per-competition Recall@10", () => {
    const missed = anchorResults.filter(({ persona, ids }) => !ids.includes(persona.expectedId));
    const recallAt10 = 1 - missed.length / anchorResults.length;
    const diagnostics = missed.map(({ persona, ids }) =>
      [
        `persona=${persona.id}`,
        `expected=${persona.expectedId}`,
        `actualTop10=${ids.join(", ") || "no_match"}`,
        `profile=${reproducibleProfile(persona.profile)}`,
        `transcript=${JSON.stringify(persona.transcript)}`
      ].join(" | ")
    ).join("\n");
    expect(recallAt10, `Recall@10=${percent(recallAt10)}\n${diagnostics}`).toBe(1);
  });

  it("executes the real V5 server-question loop with material gain and frozen qualification", async () => {
    const results = await runTrueV5PreferencePaths();
    const failures: string[] = [];
    for (const result of results) {
      if (result.transcript.length > 3) failures.push(`${result.persona.id}: more than three questions`);
      const families = result.transcript.map(({ question }) =>
        question.signalKey === "competition-fit"
          ? "fit"
          : question.signalKey === "candidate-goal-tradeoff"
            ? "goal"
            : "track"
      );
      if (new Set(families).size !== families.length) {
        failures.push(`${result.persona.id}: repeated question family ${families.join(",")}`);
      }
      for (const turn of result.turns) {
        if (turn.status === "question" && turn.question.impact !== "material") {
          failures.push(`${result.persona.id}:${turn.question.signalKey}: material response has wrong impact`);
        }
        if (turn.status === "question" && turn.actualPreferenceOutcomeChanges < 2) {
          failures.push(
            `${result.persona.id}:${turn.question.signalKey}: only ${turn.actualPreferenceOutcomeChanges} visible outcomes`
          );
        }
        if (turn.question.signalKey === "competition-fit" ||
          turn.question.signalKey === "candidate-goal-tradeoff") {
          if (!turn.qualificationSnapshotUnchanged) {
            failures.push(`${result.persona.id}:${turn.question.signalKey}: full qualification snapshot changed`);
          }
        }
        if (turn.scoringQualificationDivergences.length > 0) {
          failures.push(
            `${result.persona.id}:${turn.question.signalKey}: scorer diverged from snapshot at ` +
            turn.scoringQualificationDivergences.join(",")
          );
        }
        if (turn.question.signalKey.startsWith("track:") &&
          turn.selectedValues !== null &&
          turn.precomputedTrackStatus === null) {
          failures.push(`${result.persona.id}:${turn.question.signalKey}: selected missing/ineligible track`);
        }
        if (turn.question.signalKey.startsWith("track:") &&
          turn.selectedValues !== null &&
          turn.trackAdoptionVerified !== true) {
          failures.push(`${result.persona.id}:${turn.question.signalKey}: scorer did not adopt precomputed track state`);
        }
        if (turn.question.signalKey.startsWith("track:") && turn.selectedValues === null) {
          const competitionId = turn.question.signalKey.slice("track:".length);
          const authored = result.oracle.trackPriorityByCompetition[competitionId] ?? [];
          const allowed = new Set(turn.question.options.map(({ value }) => value));
          if (authored.some((trackId) => allowed.has(trackId))) {
            failures.push(`${result.persona.id}:${turn.question.signalKey}: skipped despite a legal authored content preference`);
          }
        }
      }
      if (result.transcript.some(({ question }) =>
        !/^(?:competition-fit|candidate-goal-tradeoff|track:[a-z0-9-]+)$/.test(question.signalKey)
      )) {
        failures.push(`${result.persona.id}: non-V3 question escaped into transcript`);
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("meets fixed-question and true V5 full-path ranking gates", async () => {
    const results = await runTrueV5PreferencePaths();
    const relevantIds = ({ labels }: CompetitionRankingHoldoutCase) =>
      labels.map(({ competitionId }) => competitionId);
    const idealIds = ({ labels }: CompetitionRankingHoldoutCase) =>
      labels.filter(({ relevance }) => relevance === 2).map(({ competitionId }) => competitionId);
    const metrics = (pathName: "fixed" | "full") => {
      const topTenOf = (result: TrueV5PreferencePathResult) =>
        pathName === "fixed" ? result.fixedTopTen : result.fullTopTen;
      const topThreeOf = (result: TrueV5PreferencePathResult) =>
        pathName === "fixed" ? result.fixedTopThree : result.fullTopThree;
      return {
        recall10: mean(results.map((result) =>
          hitAt(topTenOf(result), relevantIds(result.persona), 10)
        )),
        hit3: mean(results.map((result) =>
          hitAt(topThreeOf(result), relevantIds(result.persona), 3)
        )),
        top1: mean(results.map((result) =>
          idealIds(result.persona).includes(topThreeOf(result)[0]) ? 1 : 0
        )),
        precision3: mean(results.map((result) =>
          precisionAt(topThreeOf(result), relevantIds(result.persona), 3)
        )),
        ndcg3: mean(results.map((result) => ndcgAt3(topThreeOf(result), result.persona)))
      };
    };
    const fixed = metrics("fixed");
    const full = metrics("full");
    const stageDiagnostics: string[] = [];
    for (const stageGroup of QUALITY_STAGE_GROUPS) {
      const grouped = results.filter(({ persona }) => persona.stageGroup === stageGroup);
      const fixedHit3 = mean(grouped.map((result) =>
        hitAt(result.fixedTopThree, relevantIds(result.persona), 3)
      ));
      const fullHit3 = mean(grouped.map((result) =>
        hitAt(result.fullTopThree, relevantIds(result.persona), 3)
      ));
      stageDiagnostics.push([
        `${stageGroup}: fixed=${fixedHit3.toFixed(3)}, full=${fullHit3.toFixed(3)}`,
        ...grouped
          .filter((result) =>
            hitAt(result.fixedTopThree, relevantIds(result.persona), 3) !== 1 ||
            hitAt(result.fullTopThree, relevantIds(result.persona), 3) !== 1
          )
          .map((result) =>
            `${result.persona.id}: fixed=${result.fixedTopThree.join(",")} | ` +
            `full=${result.fullTopThree.join(",")} | relevant=${relevantIds(result.persona).join(",")}`
          )
      ].join("\n"));
      expect(fixedHit3, stageDiagnostics.join("\n")).toBe(1);
      expect(fullHit3, stageDiagnostics.join("\n")).toBe(1);
    }
    const diagnostics = [
      `fixed Recall@10=${fixed.recall10.toFixed(3)}, Hit@3=${fixed.hit3.toFixed(3)}, ` +
        `Top1=${fixed.top1.toFixed(3)}, Precision@3=${fixed.precision3.toFixed(3)}, nDCG@3=${fixed.ndcg3.toFixed(4)}`,
      `full Recall@10=${full.recall10.toFixed(3)}, Hit@3=${full.hit3.toFixed(3)}, ` +
        `Top1=${full.top1.toFixed(3)}, Precision@3=${full.precision3.toFixed(3)}, nDCG@3=${full.ndcg3.toFixed(4)}`,
      ...stageDiagnostics,
      ...results.map(({ persona, fixedTopThree, fullTopThree, transcript, terminalStatus }) =>
        `${persona.id}: fixed=${fixedTopThree.join(",")} | full=${fullTopThree.join(",")} | ` +
        `answers=${transcript.map(({ question, answer }) =>
          `${question.signalKey}:${answer.selectedValues.join("+")}`).join(";") || "none"} | terminal=${terminalStatus}`
      )
    ].join("\n");
    expect(fixed.recall10, diagnostics).toBe(1);
    expect(fixed.hit3, diagnostics).toBe(1);
    expect(fixed.top1, diagnostics).toBeGreaterThanOrEqual(0.92);
    expect(fixed.precision3, diagnostics).toBeGreaterThanOrEqual(0.88);
    expect(fixed.ndcg3, diagnostics).toBeGreaterThanOrEqual(0.94);
    expect(full.recall10, diagnostics).toBe(1);
    expect(full.hit3, diagnostics).toBe(1);
    expect(full.top1, diagnostics).toBeGreaterThanOrEqual(0.92);
    expect(full.precision3, diagnostics).toBeGreaterThanOrEqual(0.88);
    expect(full.ndcg3, diagnostics).toBeGreaterThanOrEqual(0.95);
    expect(full.ndcg3, diagnostics).toBeGreaterThanOrEqual(fixed.ndcg3);
  });

  it("audits calibration saturation and zero-adjustment references", async () => {
    const anchorItems = competitionAnchorPersonas.flatMap((persona) =>
      recommendCompetitions(persona.profile, {
        now: QUALITY_BENCHMARK_NOW,
        transcript: benchmarkPreferenceTranscript(persona.transcript)
      }).recommendations
    );
    const preferencePaths = await runTrueV5PreferencePaths();
    const holdoutItems = preferencePaths.flatMap(({ persona, transcript }) =>
      recommendCompetitions(persona.profile, {
        now: QUALITY_BENCHMARK_NOW,
        transcript
      }).recommendations
    );
    const anchorMean = mean(anchorItems.map(({ matchScore }) => matchScore));
    const holdoutMean = mean(holdoutItems.map(({ matchScore }) => matchScore));
    const allAuditedItems = [...anchorItems, ...holdoutItems];
    const saturationRatio = allAuditedItems.filter(({ matchScore }) => matchScore === 95).length /
      Math.max(1, allAuditedItems.length);
    const noMatchItems = competitionNoMatchPersonas.flatMap((persona) =>
      recommendCompetitions(persona.profile, {
        now: QUALITY_BENCHMARK_NOW,
        transcript: benchmarkPreferenceTranscript(persona.transcript)
      }).recommendations
    );
    const referenceViolations = [...allAuditedItems, ...noMatchItems].filter((item) =>
      (item.recommendationRole === "reference" || !item.scoreCalibration.qualified) &&
      item.scoreCalibration.adjustment !== 0
    );
    const noMatchViolations = noMatchItems.filter(({ scoreCalibration }) =>
      scoreCalibration.adjustment !== 0
    );
    const diagnostics = [
      `anchor mean=${anchorMean.toFixed(2)}`,
      `holdout mean=${holdoutMean.toFixed(2)}`,
      `95 saturation=${percent(saturationRatio)}`,
      `reference adjustment violations=${referenceViolations.length}`,
      `no-match adjustment violations=${noMatchViolations.length}`
    ].join("\n");
    expect(saturationRatio, diagnostics).toBeLessThanOrEqual(0.07);
    expect(allAuditedItems.some(({ matchScore }) => matchScore === 100), diagnostics).toBe(false);
    expect(referenceViolations, diagnostics).toEqual([]);
    expect(noMatchViolations, diagnostics).toEqual([]);
  });

  it("has zero official hard-eligibility violations in all returned candidates", async () => {
    const trueV5Paths = new Map(
      (await runTrueV5PreferencePaths()).map(({ persona, transcript }) => [persona.id, transcript])
    );
    const allEligibilityPersonas = [...competitionQualityPersonas, ...competitionRankingHoldoutCases]
      .map((persona) => ({
        persona,
        transcript: trueV5Paths.get(persona.id) ?? benchmarkPreferenceTranscript(persona.transcript)
      }));
    const violations = allEligibilityPersonas.flatMap(({ persona, transcript }) => {
      const recommendations = getCompetitionRecommendationCandidates(persona.profile, {
        now: QUALITY_BENCHMARK_NOW,
        transcript
      }).recommendations.slice(0, 10);
      return recommendations.flatMap(({ competition, recommendedTrack }) => {
        const violation = officialEligibilityViolation(
          competition,
          persona.profile,
          recommendedTrack?.id
        );
        return violation ? [[
          `persona=${persona.id}`,
          `forbiddenByOfficialRule=${competition.id}:${violation}`,
          `recommendedTrack=${recommendedTrack?.id ?? "mother"}`,
          `motherHardFilter=${getHardFilterReason(competition, persona.profile) ?? "none"}`,
          `facts=${JSON.stringify({
            stage: persona.profile.stage,
            enrollmentStatus: persona.profile.enrollmentStatus,
            teamUnit: persona.profile.teamUnit,
            teamSize: persona.profile.teamSize,
            availableResources: persona.profile.availableResources
          })}`
        ].join(" | ")] : [];
      });
    });
    expect(
      violations.length,
      `official hard-eligibility violations=${violations.length}\n${violations.slice(0, 50).join("\n")}`
    ).toBe(0);
  });

  it("hard-excludes all 30 near-neighbor personas only through sourced structured facts", () => {
    const coverage = Object.fromEntries(
      (["stage", "full-time", "team-size", "same-institution", "required-resource"] as const)
        .map((fact) => [
          fact,
          competitionHardNegativePersonas.filter((persona) => persona.decisiveFact === fact).length
        ])
    ) as Record<CompetitionHardNegativeDecisiveFact, number>;
    expect(coverage).toEqual({
      stage: 10,
      "full-time": 6,
      "team-size": 10,
      "same-institution": 2,
      "required-resource": 2
    });
    const failures = competitionHardNegativePersonas.flatMap((persona) => {
      const competition = competitions.find(({ id }) => id === persona.forbiddenCompetitionId)!;
      const hardReason = getHardFilterReason(competition, persona.profile);
      const evidenceRefs = new Set([
        competition.recommendation.source,
        competition.recommendation.eligibility?.source,
        ...(competition.recommendation.supportingSources ?? [])
      ].flatMap((source) => source?.evidenceRef ? [source.evidenceRef] : []));
      const ids = recommendCompetitions(persona.profile, {
        now: QUALITY_BENCHMARK_NOW,
        transcript: benchmarkPreferenceTranscript(persona.transcript)
      }).recommendations.map(({ competitionId }) => competitionId);
      const injectedEligibility = persona.transcript.some(({ question, answer }) =>
        question.signalKey === `eligibility:${persona.forbiddenCompetitionId}` ||
        answer.selectedValues.includes("ineligible")
      );
      return hardReason === persona.expectedHardFilterReason &&
        !ids.includes(persona.forbiddenCompetitionId) &&
        evidenceRefs.has(persona.sourceEvidenceRef) &&
        persona.officialConstraintRationale.includes(persona.sourceEvidenceRef) &&
        !injectedEligibility
        ? []
        : [[
            persona.id,
            `expectedReason=${persona.expectedHardFilterReason}`,
            `actualReason=${hardReason ?? "none"}`,
            `evidence=${persona.sourceEvidenceRef}`,
            `injectedEligibility=${injectedEligibility}`,
            `results=${ids.join(", ")}`
          ].join(" | ")];
    });
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("covers the official first-higher-education-year boundary without falsely hard-excluding an alternative route", () => {
    expect(competitionYearConstraintBoundaryPersonas).toHaveLength(1);
    for (const persona of competitionYearConstraintBoundaryPersonas) {
      const competition = competitions.find(({ id }) => id === persona.competitionId);
      expect(competition, persona.id).toBeDefined();
      const cutoffSource = competition?.recommendation.eligibility?.firstHigherEducationYearCutoff?.source;
      expect(cutoffSource?.evidenceRef, persona.id).toBe(persona.sourceEvidenceRef);
      expect(cutoffSource?.facts, persona.id).toContain("firstHigherEducationYearCutoff");
      expect(
        getHardFilterReason(competition!, persona.profile),
        persona.officialConstraintRationale
      ).toBe(persona.expectedHardFilterReason);
      expect(
        scoreCompetition(
          competition!,
          persona.profile,
          QUALITY_BENCHMARK_NOW,
          benchmarkPreferenceTranscript(persona.transcript)
        )?.eligibility.status,
        persona.officialConstraintRationale
      ).toBe(persona.expectedEligibilityStatus);
    }
  });

  it("reaches no-match F1 = 1 without suppressing valid anchors", () => {
    const evaluated = competitionQualityPersonas.map((persona) => {
      const result = recommendCompetitions(persona.profile, {
        now: QUALITY_BENCHMARK_NOW,
        transcript: benchmarkPreferenceTranscript(persona.transcript)
      });
      return {
        persona,
        predictedNoMatch: result.recommendations.length === 0 || Boolean(result.noMatchReason)
      };
    });
    const labels = evaluated.map(({ persona }) => persona.kind === "no-match");
    const predictions = evaluated.map(({ predictedNoMatch }) => predictedNoMatch);
    const f1 = binaryF1(labels, predictions);
    const falseNegatives = evaluated.filter(({ persona, predictedNoMatch }) =>
      persona.kind === "no-match" && !predictedNoMatch
    ).map(({ persona }) => {
      if (persona.kind !== "no-match") throw new Error("Expected a no-match persona");
      const actual = recommendCompetitions(persona.profile, {
        now: QUALITY_BENCHMARK_NOW,
        transcript: benchmarkPreferenceTranscript(persona.transcript)
      }).recommendations.map(({ competitionId }) => competitionId).slice(0, 10);
      return [
        `persona=${persona.id}`,
        `expected=no_match:${persona.expectedReason}`,
        `actualTop10=${actual.join(",") || "no_match"}`,
        `profile=${reproducibleProfile(persona.profile)}`
      ].join(" | ");
    });
    const falsePositives = evaluated.filter(({ persona, predictedNoMatch }) =>
      persona.kind !== "no-match" && predictedNoMatch
    ).map(({ persona }) => persona.id);
    const diagnostics = [
      `no-match F1=${f1.toFixed(3)}`,
      `false negatives: ${falseNegatives.join(", ") || "none"}`,
      `false positives: ${falsePositives.join(", ") || "none"}`
    ].join("\n");
    expect(f1, diagnostics).toBe(1);
  });
});

function sampleSetF1(expected: readonly string[], actual: readonly string[]) {
  if (expected.length === 0 && actual.length === 0) return 1;
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const intersection = [...actualSet].filter((value) => expectedSet.has(value)).length;
  const precision = intersection / Math.max(1, actualSet.size);
  const recall = intersection / Math.max(1, expectedSet.size);
  return precision + recall ? 2 * precision * recall / (precision + recall) : 0;
}

describe("300-sample free-text interpretation and safety gates", () => {
  it("ships a balanced, uniquely identified 300-sample reusable fixture", () => {
    expect(competitionFreeTextSamples).toHaveLength(300);
    expect(new Set(competitionFreeTextSamples.map(({ id }) => id)).size).toBe(300);
    expect(Object.fromEntries([
      "synonym", "colloquial", "bilingual", "numeric", "typo", "conflict", "ambiguity", "prompt-injection", "pii"
    ].map((category) => [
      category,
      competitionFreeTextSamples.filter((sample) => sample.category === category).length
    ]))).toEqual({
      synonym: 100,
      colloquial: 74,
      bilingual: 40,
      numeric: 6,
      typo: 15,
      conflict: 20,
      ambiguity: 15,
      "prompt-injection": 15,
      pii: 15
    });
    for (const sample of competitionFreeTextSamples) {
      expect(sample.text.trim().length, sample.id).toBeGreaterThan(0);
      expect(sample.rationale.length, sample.id).toBeGreaterThan(10);
    }
  });

  it("encodes every sample as exactly fourteen question envelopes", () => {
    const compositeOwner: Partial<Record<CompetitionQuestionnaireFieldId, string>> = {
      enrollmentStatus: "stage",
      firstHigherEducationYear: "stage",
      specificSubjects: "majorFields",
      evidence: "experienceLevel",
      teamSize: "teamStatus",
      teamUnit: "teamStatus"
    };
    for (const sample of competitionFreeTextSamples) {
      const questionnaire = questionnaireForFreeTextSample(sample);
      expect(questionnaire.answers, sample.id).toHaveLength(14);
      expect(questionnaire.answers.map(({ fieldId }) => fieldId).sort(), sample.id).toEqual(
        [...COMPETITION_FIXED_QUESTION_IDS].sort()
      );
      const textEnvelopes = questionnaire.answers.filter(({ freeText }) => freeText === sample.text);
      expect(textEnvelopes, sample.id).toHaveLength(1);
      expect(textEnvelopes[0].fieldId, sample.id).toBe(compositeOwner[sample.fieldId] ?? sample.fieldId);
      expect(
        textEnvelopes[0].selectedValues.filter((value) => value.startsWith(`${sample.fieldId}:`)),
        sample.id
      ).toEqual((sample.selectedValues ?? []).map((value) => `${sample.fieldId}:${value}`));
      expect(
        questionnaire.answers.flatMap(({ selectedValues }) => selectedValues).every((value) => value.includes(":")),
        sample.id
      ).toBe(true);
    }
  });

  it("parses every explicit whitelist option exactly", () => {
    const failures: string[] = [];
    for (const [fieldId, spec] of Object.entries(COMPETITION_QUESTIONNAIRE_FIELD_SPECS)) {
      for (const option of spec.options) {
        const sample = {
          id: `explicit-${fieldId}-${option.value}`,
          category: "synonym" as const,
          fieldId: fieldId as keyof typeof COMPETITION_QUESTIONNAIRE_FIELD_SPECS,
          text: option.label,
          expectedValues: [option.value],
          expectedStatus: "ready" as const,
          selectedValues: [option.value],
          rationale: "Explicit whitelist coverage fixture."
        };
        const normalized = normalizeCompetitionQuestionnaire(questionnaireForFreeTextSample(sample));
        const interpretation = normalized.ok
          ? normalized.interpretations.find((entry) => entry.fieldId === fieldId)
          : undefined;
        if (!interpretation || interpretation.explicitValues.join("|") !== option.value) {
          failures.push(`${fieldId}:${option.value}`);
        }
      }
    }
    expect(failures, failures.join(", ")).toEqual([]);
  });

  it("achieves free-text macro-F1 >= 0.92 while leaving ambiguity and injection unmapped", () => {
    const scored = competitionFreeTextSamples
      .filter(({ expectedStatus }) => expectedStatus !== "rejected")
      .map((sample) => {
        const normalized = normalizeCompetitionQuestionnaire(questionnaireForFreeTextSample(sample));
        const interpretation = normalized.ok
          ? normalized.interpretations.find(({ fieldId }) => fieldId === sample.fieldId)
          : undefined;
        const actual = interpretation?.suggestedValues ?? [];
        return {
          sample,
          actual,
          f1: sampleSetF1(sample.expectedValues, actual)
        };
      });
    const macroF1 = mean(scored.map(({ f1 }) => f1));
    const failures = scored.filter(({ f1 }) => f1 < 1).map(({ sample, actual }) =>
      `${sample.id} (${sample.text}): expected=${sample.expectedValues.join("|") || "unmapped"}, actual=${actual.join("|") || "unmapped"}`
    );
    expect(macroF1, `macro-F1=${macroF1.toFixed(3)}\n${failures.join("\n")}`).toBeGreaterThanOrEqual(0.92);
  });

  it("detects every explicit-option/free-text conflict", () => {
    const conflicts = competitionFreeTextSamples.filter(({ category }) => category === "conflict");
    const failures = conflicts.flatMap((sample) => {
      const normalized = normalizeCompetitionQuestionnaire(questionnaireForFreeTextSample(sample));
      const interpretation = normalized.ok
        ? normalized.interpretations.find(({ fieldId }) => fieldId === sample.fieldId)
        : undefined;
      return interpretation?.status === "conflict" && interpretation.requiresConfirmation
        ? []
        : [sample.id];
    });
    expect(failures, failures.join(", ")).toEqual([]);
  });

  it("rejects every PII sample before normalization", () => {
    const piiSamples = competitionFreeTextSamples.filter(({ category }) => category === "pii");
    const accepted = piiSamples.filter((sample) =>
      competitionQuestionnaireV1Schema.safeParse(questionnaireForFreeTextSample(sample)).success
    );
    expect(accepted.map(({ id }) => id), accepted.map(({ id, text }) => `${id}: ${text}`).join("\n")).toEqual([]);
  });

  it("rejects duplicate fields, non-whitelist values, blank text and overlong text", () => {
    const valid = questionnaireForFreeTextSample(competitionFreeTextSamples[0]);
    const duplicate = { ...valid, answers: [...valid.answers, valid.answers[0]] };
    const invalidWhitelist = {
      ...valid,
      answers: valid.answers.map((answer) => answer.fieldId === "stage"
        ? { ...answer, selectedValues: ["invented-stage"] }
        : answer)
    };
    const blank = {
      ...valid,
      answers: valid.answers.map((answer) => answer.fieldId === "stage"
        ? { fieldId: "stage", selectedValues: [], freeText: "   " }
        : answer)
    };
    const overlong = {
      ...valid,
      answers: valid.answers.map((answer) => answer.fieldId === "stage"
        ? { fieldId: "stage", selectedValues: [], freeText: "编".repeat(121) }
        : answer)
    };
    expect(competitionQuestionnaireV1Schema.safeParse(duplicate).success).toBe(false);
    expect(competitionQuestionnaireV1Schema.safeParse(invalidWhitelist).success).toBe(false);
    expect(competitionQuestionnaireV1Schema.safeParse(blank).success).toBe(false);
    expect(competitionQuestionnaireV1Schema.safeParse(overlong).success).toBe(false);
  });
});
