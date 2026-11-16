import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { competitions } from "@/content/competitions";
import { competitionDynamicQuestionV3Schema } from "@/lib/ai/competition-dynamic-question";
import { getCompetitionPreferenceQuestionTracks } from "@/lib/competitions/catalog";
import {
  COMPETITION_CORE_MISMATCH_MAX_SUBJECT_TASK_POINTS,
  COMPETITION_SCORE_WEIGHTS,
  assessCompetitionConfirmedSubjectAlignment,
  buildCompetitionQualificationSnapshot,
  getHardFilterReason,
  hasDominantConfirmedSubjectMatch,
  scoreCompetitionRecommendations,
  semanticArchetypeFit
} from "@/lib/competitions/scoring";
import { calibrateCompetitionScore } from "@/lib/competitions/recommendation-engine";
import {
  COMPETITION_CLARIFICATION_NOTE_MAX_LENGTH,
  type CompetitionDynamicExchangeV3,
  type CompetitionRecommendationProfileV5
} from "@/types/competition-recommendation";
import {
  QUALITY_BENCHMARK_NOW,
  competitionRankingHoldoutCases
} from "../fixtures/competition-quality-personas";
import {
  staticCompetitionScoringGoldOrderingEdges,
  staticCompetitionScoringGoldPairs,
  type CompetitionScoringGoldOrderingEdge,
  type CompetitionScoringGoldPair
} from "../fixtures/competition-scoring-gold";

const scoreDimensions = Object.keys(COMPETITION_SCORE_WEIGHTS) as (
  keyof typeof COMPETITION_SCORE_WEIGHTS
)[];

function median(values: readonly number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 0) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

type LabelDerivedScoringGoldOrderingEdge = Pick<
  CompetitionScoringGoldOrderingEdge,
  "higherPairId" | "lowerPairId" | "relation"
>;

function deriveAllLabelImpliedScoringGoldOrderingEdges(
  pairs: readonly CompetitionScoringGoldPair[]
): LabelDerivedScoringGoldOrderingEdge[] {
  const edges: LabelDerivedScoringGoldOrderingEdge[] = [];
  for (const comparisonGroupId of new Set(pairs.map((pair) => pair.comparisonGroupId))) {
    const group = pairs.filter((pair) => pair.comparisonGroupId === comparisonGroupId);
    const strong = group.filter(({ level }) => level === "strong");
    const acceptable = group.filter(({ level }) => level === "acceptable");
    const weak = group.filter(({ level }) => level === "weak");
    for (const higher of strong) {
      for (const lower of acceptable) {
        edges.push({
          higherPairId: higher.id,
          lowerPairId: lower.id,
          relation: "strong-over-acceptable"
        });
      }
      for (const lower of weak) {
        edges.push({
          higherPairId: higher.id,
          lowerPairId: lower.id,
          relation: "strong-over-weak"
        });
      }
    }
    for (const higher of acceptable) {
      for (const lower of weak) {
        edges.push({
          higherPairId: higher.id,
          lowerPairId: lower.id,
          relation: "acceptable-over-weak"
        });
      }
    }
  }
  return edges;
}

function authoredTrackTranscript(
  gold: (typeof staticCompetitionScoringGoldPairs)[number],
  competition: (typeof competitions)[number],
  profile: CompetitionRecommendationProfileV5
): CompetitionDynamicExchangeV3[] {
  if (!("trackJudgement" in gold) || !gold.trackJudgement) return [];
  const { intendedTrackId } = gold.trackJudgement;
  const snapshotEntry = buildCompetitionQualificationSnapshot(
    profile,
    [competition],
    QUALITY_BENCHMARK_NOW
  ).entries[0];
  const legalTracks = getCompetitionPreferenceQuestionTracks(competition).filter((track) =>
    snapshotEntry?.tracks.find(({ trackId }) => trackId === track.id)?.status !== "ineligible"
  );
  const question = competitionDynamicQuestionV3Schema.parse({
    questionId: `dq_score_gold_track_${gold.id}`,
    signalKey: `track:${gold.competitionId}`,
    prompt: `《${gold.competitionId}》的这些候选方向中，你更想优先准备哪个赛道？`,
    selection: "single",
    options: legalTracks.map(({ id, label }) => ({ value: id, label })),
    allowsNote: true,
    maxNoteLength: COMPETITION_CLARIFICATION_NOTE_MAX_LENGTH,
    impact: "material",
    estimatedPreferenceOutcomeChanges: 2
  });
  return [{
    question,
    answer: { selectedValues: [intendedTrackId] }
  }];
}

describe("static competition scoring gold audit", () => {
  const personas = new Map(competitionRankingHoldoutCases.map((persona) => [persona.id, persona]));
  const catalog = new Map(competitions.map((competition) => [competition.id, competition]));
  const evaluated = staticCompetitionScoringGoldPairs.map((gold) => {
    const persona = personas.get(gold.personaId);
    const competition = catalog.get(gold.competitionId);
    const transcript = persona && competition
      ? authoredTrackTranscript(gold, competition, persona.profile)
      : [];
    const scored = persona && competition
      ? scoreCompetitionRecommendations([competition], persona.profile, {
          now: QUALITY_BENCHMARK_NOW,
          transcript
        })[0] ?? null
      : null;
    return { gold, persona, competition, transcript, scored };
  });
  const evaluatedByPairId = new Map<string, (typeof evaluated)[number]>(
    evaluated.map((item) => [item.gold.id, item])
  );
  const labelDerivedOrderingEdges = deriveAllLabelImpliedScoringGoldOrderingEdges(
    staticCompetitionScoringGoldPairs
  );

  it("locks exactly 96 literal judgements with the authored 44/28/24 level distribution", () => {
    expect(staticCompetitionScoringGoldPairs).toHaveLength(96);
    expect(new Set(staticCompetitionScoringGoldPairs.map(({ id }) => id)).size)
      .toBe(staticCompetitionScoringGoldPairs.length);
    expect({
      strong: staticCompetitionScoringGoldPairs.filter(({ level }) => level === "strong").length,
      acceptable: staticCompetitionScoringGoldPairs.filter(
        ({ level }) => level === "acceptable"
      ).length,
      weak: staticCompetitionScoringGoldPairs.filter(({ level }) => level === "weak").length
    }).toEqual({ strong: 44, acceptable: 28, weak: 24 });

    const source = readFileSync(
      path.join(process.cwd(), "tests", "fixtures", "competition-scoring-gold.ts"),
      "utf8"
    );
    expect(source).not.toContain("@/content/competitions");
    expect(source).not.toContain("@/lib/competitions/scoring");
    expect(source).not.toContain("scoreCompetition(");
    expect(source).not.toContain("competitions.map");

    for (const { gold, persona, competition } of evaluated) {
      expect(persona, gold.id).toBeDefined();
      expect(competition, gold.id).toBeDefined();
      expect(gold.profileSource, gold.id).toContain(gold.personaId);
      expect(gold.evidenceRationale.length, gold.id).toBeGreaterThanOrEqual(20);
      if ("independentRankingOverrideRationale" in gold && gold.independentRankingOverrideRationale) {
        expect(gold.independentRankingOverrideRationale.length, gold.id).toBeGreaterThanOrEqual(30);
      }
      expect(gold.allowedBaseMatchScore[0], gold.id).toBeGreaterThanOrEqual(0);
      expect(gold.allowedBaseMatchScore[0], gold.id).toBeLessThan(gold.allowedBaseMatchScore[1]);
      expect(gold.allowedBaseMatchScore[1], gold.id).toBeLessThanOrEqual(100);
      if (gold.level === "weak") {
        expect(gold.allowedBaseMatchScore[0], gold.id).toBe(0);
        expect(gold.allowedBaseMatchScore[1], gold.id).toBeLessThanOrEqual(50);
      } else {
        expect(gold.allowedBaseMatchScore[1] - gold.allowedBaseMatchScore[0], gold.id)
          .toBeLessThanOrEqual(15);
      }
    }

    for (const comparisonGroupId of new Set(
      staticCompetitionScoringGoldPairs.map(({ comparisonGroupId }) => comparisonGroupId)
    )) {
      const group = staticCompetitionScoringGoldPairs.filter(
        (gold) => gold.comparisonGroupId === comparisonGroupId
      );
      expect(group.length, comparisonGroupId).toBeGreaterThanOrEqual(2);
      expect(new Set(group.map(({ personaId }) => personaId)).size, comparisonGroupId).toBe(1);
      expect(new Set(group.map(({ competitionId }) => competitionId)).size, comparisonGroupId)
        .toBe(group.length);
    }
  });

  it("maps every scored strong/acceptable judgement to exact ranking relevance", () => {
    const failures = evaluated.flatMap(({ gold, persona }) => {
      if (gold.level === "weak") return [];
      const relevance = persona?.labels.find(
        ({ competitionId }) => competitionId === gold.competitionId
      )?.relevance;
      const expectedRelevance = gold.level === "strong" ? 2 : 1;
      return relevance === expectedRelevance
        ? []
        : [
            `${gold.id}: ${gold.level} requires ranking relevance=${expectedRelevance}, ` +
            `actual=${relevance ?? "missing"}`
          ];
    });
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("keeps every ranking relevance label reachable in its frozen parent/track snapshot", () => {
    const failures: string[] = [];
    for (const persona of competitionRankingHoldoutCases) {
      const snapshot = buildCompetitionQualificationSnapshot(
        persona.profile,
        undefined,
        QUALITY_BENCHMARK_NOW
      );
      for (const label of persona.labels) {
        const entry = snapshot.entries.find(
          ({ competitionId }) => competitionId === label.competitionId
        );
        if (!entry) {
          failures.push(`${persona.id}/${label.competitionId}: snapshot entry missing`);
          continue;
        }
        if (entry.status === "ineligible") {
          failures.push(
            `${persona.id}/${label.competitionId}: parent snapshot is ineligible ` +
            `(${entry.hardFilterReason ?? "unknown"})`
          );
        }
        if (
          entry.tracks.length > 0 &&
          entry.tracks.every(({ status }) => status === "ineligible")
        ) {
          failures.push(`${persona.id}/${label.competitionId}: every real track is ineligible`);
        }
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("uses exact authored track selections and preserves their precomputed qualification state", () => {
    const trackJudgements = evaluated.filter(({ gold }) =>
      "trackJudgement" in gold && Boolean(gold.trackJudgement)
    );
    expect(trackJudgements.length).toBeGreaterThanOrEqual(2);
    const failures: string[] = [];
    for (const { gold, persona, competition, transcript, scored } of trackJudgements) {
      if (!("trackJudgement" in gold) || !gold.trackJudgement || !persona) continue;
      const snapshot = buildCompetitionQualificationSnapshot(
        persona.profile,
        undefined,
        QUALITY_BENCHMARK_NOW
      );
      const entry = snapshot.entries.find(({ competitionId }) => competitionId === gold.competitionId);
      const authored = entry?.tracks.find(({ trackId }) =>
        trackId === gold.trackJudgement!.intendedTrackId
      );
      if (!authored || authored.status === "ineligible") {
        failures.push(`${gold.id}: authored track is absent or hard-ineligible`);
        continue;
      }
      if (!transcript[0]?.question.options.some(({ value }) =>
        value === gold.trackJudgement!.intendedTrackId
      )) {
        failures.push(`${gold.id}: intended track is absent from the schema-validated legal V3 question`);
      }
      const trackMetadata = competition?.recommendation.tracks?.find(({ id }) =>
        id === gold.trackJudgement!.intendedTrackId
      );
      const parentEligibility = competition?.recommendation.eligibility;
      const catalogEvidenceRef = trackMetadata?.evidenceRef ?? parentEligibility?.source.evidenceRef;
      if (catalogEvidenceRef !== gold.trackJudgement.officialEvidenceRef) {
        failures.push(`${gold.id}: catalog evidence=${catalogEvidenceRef ?? "missing"}, authored=${gold.trackJudgement.officialEvidenceRef}`);
      }
      if (authored.status !== gold.trackJudgement.expectedEligibility) {
        failures.push(`${gold.id}: expected snapshot=${gold.trackJudgement.expectedEligibility}, actual=${authored.status}`);
      }
      if (scored?.recommendedTrack?.id !== gold.trackJudgement.intendedTrackId) {
        failures.push(`${gold.id}: expected recommendedTrack=${gold.trackJudgement.intendedTrackId}, actual=${scored?.recommendedTrack?.id ?? "filtered"}`);
      }
      if (scored?.eligibility.status !== gold.trackJudgement.expectedEligibility) {
        failures.push(`${gold.id}: expected scored eligibility=${gold.trackJudgement.expectedEligibility}, actual=${scored?.eligibility.status ?? "filtered"}`);
      }
      if (gold.trackJudgement.profileFactRationale.length < 20) {
        failures.push(`${gold.id}: profile/track rationale is not auditable`);
      }
      if (!gold.trackJudgement.officialEvidenceRef.startsWith("official:")) {
        failures.push(`${gold.id}: official evidence reference is malformed`);
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("keeps all seven dimensions inside their caps and derives base score from their exact sum", () => {
    const failures: string[] = [];
    for (const { gold, persona, competition, scored } of evaluated) {
      if (!scored) {
        failures.push(`${gold.id}: production recommendation scorer returned no eligible result (hardFilter=${
          persona && competition ? getHardFilterReason(competition, persona.profile) ?? "track-level" : "missing-fixture"
        })`);
        continue;
      }
      const dimensions = scoreDimensions.map((dimension) => ({
        dimension,
        points: scored.scoreBreakdown[dimension] ?? Number.NaN,
        maximum: COMPETITION_SCORE_WEIGHTS[dimension]
      }));
      for (const { dimension, points, maximum } of dimensions) {
        if (!Number.isFinite(points) || points < 0 || points > maximum) {
          failures.push(`${gold.id}: ${dimension}=${points}, cap=${maximum}`);
        }
      }
      const sum = dimensions.reduce((total, { points }) => total + points, 0);
      if (Math.abs(sum - scored.baseMatchScore) > 1e-9) {
        failures.push(`${gold.id}: seven-dimension sum=${sum}, base=${scored.baseMatchScore}`);
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("places at least 90% of gold pairs inside their human-approved base-score intervals", () => {
    const misses = evaluated.flatMap(({ gold, scored }) => {
      const [minimum, maximum] = gold.allowedBaseMatchScore;
      return scored && scored.baseMatchScore >= minimum && scored.baseMatchScore <= maximum
        ? []
        : [`${gold.id}: expected ${minimum}-${maximum}, actual ${scored?.baseMatchScore ?? "filtered"}`];
    });
    const passRate = (evaluated.length - misses.length) / evaluated.length;
    expect(passRate, `gold interval pass rate=${(passRate * 100).toFixed(1)}%\n${misses.join("\n")}`)
      .toBeGreaterThanOrEqual(0.9);
  });

  it("gives every human-labelled weak pair zero calibration uplift", () => {
    const failures = evaluated.flatMap(({ gold, persona, scored }) => {
      if (gold.level !== "weak") return [];
      if (!persona || !scored) return [`${gold.id}: missing scored pair`];
      const calibration = calibrateCompetitionScore(persona.profile, scored).scoreCalibration;
      return !calibration.qualified && calibration.adjustment === 0
        ? []
        : [
            `${gold.id}: base=${scored.baseMatchScore}, ` +
            `subjectTask=${scored.scoreBreakdown.subjectTask}, ` +
            `teamResources=${scored.scoreBreakdown.teamResources}, ` +
            `qualified=${calibration.qualified}, adjustment=${calibration.adjustment}`
          ];
    });
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("keeps every audited cross-core transfer below the subject/task qualification gate", () => {
    const crossCore = evaluated.filter(({ persona, competition }) =>
      Boolean(persona && competition) &&
      !hasDominantConfirmedSubjectMatch(
        assessCompetitionConfirmedSubjectAlignment(competition!, persona!.profile)
      ) &&
      (semanticArchetypeFit(competition!, persona!.profile) ?? 0) === 0
    );
    const failures = crossCore.flatMap(({ gold, persona, scored }) => {
      if (!persona || !scored) return [`${gold.id}: missing scored pair`];
      const calibration = calibrateCompetitionScore(persona.profile, scored).scoreCalibration;
      return (scored.scoreBreakdown.subjectTask ?? 0) <=
          COMPETITION_CORE_MISMATCH_MAX_SUBJECT_TASK_POINTS &&
        !calibration.qualified &&
        calibration.adjustment === 0
        ? []
        : [
            `${gold.id}: base=${scored.baseMatchScore}, ` +
            `subjectTask=${scored.scoreBreakdown.subjectTask}, ` +
            `qualified=${calibration.qualified}, adjustment=${calibration.adjustment}`
          ];
    });
    expect(crossCore.length).toBeGreaterThan(0);
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("derives the exact 104 label-implied edges and validates 40 literal rationale samples", () => {
    expect(labelDerivedOrderingEdges).toHaveLength(104);
    expect({
      strongOverAcceptable: labelDerivedOrderingEdges.filter(
        ({ relation }) => relation === "strong-over-acceptable"
      ).length,
      acceptableOverWeak: labelDerivedOrderingEdges.filter(
        ({ relation }) => relation === "acceptable-over-weak"
      ).length,
      strongOverWeak: labelDerivedOrderingEdges.filter(
        ({ relation }) => relation === "strong-over-weak"
      ).length
    }).toEqual({
      strongOverAcceptable: 32,
      acceptableOverWeak: 28,
      strongOverWeak: 44
    });
    const derivedKeys = new Set(labelDerivedOrderingEdges.map((edge) =>
      `${edge.higherPairId}>${edge.lowerPairId}:${edge.relation}`
    ));
    expect(derivedKeys.size).toBe(104);

    expect(staticCompetitionScoringGoldOrderingEdges).toHaveLength(40);
    expect(new Set(staticCompetitionScoringGoldOrderingEdges.map(({ id }) => id)).size)
      .toBe(staticCompetitionScoringGoldOrderingEdges.length);
    expect(staticCompetitionScoringGoldOrderingEdges.some(({ relation }) => relation === "strong-over-acceptable"))
      .toBe(true);
    expect(staticCompetitionScoringGoldOrderingEdges.some(({ relation }) => relation === "acceptable-over-weak"))
      .toBe(true);
    expect(staticCompetitionScoringGoldOrderingEdges.some(({ relation }) => relation === "strong-over-weak"))
      .toBe(true);

    const failures: string[] = [];
    for (const edge of labelDerivedOrderingEdges) {
      const higher = evaluatedByPairId.get(edge.higherPairId);
      const lower = evaluatedByPairId.get(edge.lowerPairId);
      if (!higher || !lower) {
        failures.push(`derived edge has a missing pair: ${edge.higherPairId}>${edge.lowerPairId}`);
        continue;
      }
      if (
        higher.gold.personaId !== lower.gold.personaId ||
        higher.gold.comparisonGroupId !== lower.gold.comparisonGroupId
      ) {
        failures.push(`derived edge crosses a frozen persona/group: ${edge.higherPairId}>${edge.lowerPairId}`);
      }
    }
    for (const edge of staticCompetitionScoringGoldOrderingEdges) {
      const higher = evaluatedByPairId.get(edge.higherPairId);
      const lower = evaluatedByPairId.get(edge.lowerPairId);
      if (!higher || !lower) {
        failures.push(`${edge.id}: missing pair reference`);
        continue;
      }
      const expectedLevels = edge.relation === "strong-over-acceptable"
        ? ["strong", "acceptable"]
        : edge.relation === "acceptable-over-weak"
          ? ["acceptable", "weak"]
          : ["strong", "weak"];
      if (higher.gold.level !== expectedLevels[0] || lower.gold.level !== expectedLevels[1]) {
        failures.push(`${edge.id}: relation does not match authored levels`);
      }
      if (higher.gold.personaId !== lower.gold.personaId) {
        failures.push(`${edge.id}: strict edge crosses personas`);
      }
      if (higher.gold.comparisonGroupId !== lower.gold.comparisonGroupId) {
        failures.push(`${edge.id}: strict edge crosses comparison groups`);
      }
      if (edge.taskGapRationale.length < 20) {
        failures.push(`${edge.id}: task-gap rationale is not auditable`);
      }
      if (
        edge.rationaleEvidence.higher.length < 2 ||
        !edge.taskGapRationale.includes(edge.rationaleEvidence.higher)
      ) {
        failures.push(`${edge.id}: rationale does not name its higher endpoint evidence`);
      }
      if (
        edge.rationaleEvidence.lower.length < 2 ||
        !edge.taskGapRationale.includes(edge.rationaleEvidence.lower)
      ) {
        failures.push(`${edge.id}: rationale does not name its lower endpoint evidence`);
      }
      if (!derivedKeys.has(`${edge.higherPairId}>${edge.lowerPairId}:${edge.relation}`)) {
        failures.push(`${edge.id}: literal rationale sample is absent from the complete matrix`);
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("passes 100% of the 104 mechanically label-derived ordering edges in production", () => {
    const failures: string[] = [];
    for (const edge of labelDerivedOrderingEdges) {
      const higher = evaluatedByPairId.get(edge.higherPairId);
      const lower = evaluatedByPairId.get(edge.lowerPairId);
      if (!higher?.scored || !lower?.scored) {
        failures.push(
          `${edge.relation}/${edge.higherPairId}>${edge.lowerPairId}: ` +
          "production scorer filtered an edge endpoint"
        );
      } else if (!(higher.scored.baseMatchScore > lower.scored.baseMatchScore)) {
        failures.push(
          `${edge.relation}: ${edge.higherPairId}=${higher.scored.baseMatchScore} <= ` +
          `${edge.lowerPairId}=${lower.scored.baseMatchScore}`
        );
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("keeps the median valid-to-weak base-score separation at least 20 points", () => {
    const valid = evaluated.flatMap(({ gold, scored }) =>
      scored && gold.level !== "weak" ? [scored.baseMatchScore] : []
    );
    const weak = evaluated.flatMap(({ gold, scored }) =>
      scored && gold.level === "weak" ? [scored.baseMatchScore] : []
    );
    const gap = median(valid) - median(weak);
    expect(
      gap,
      `valid median=${median(valid).toFixed(1)}, weak median=${median(weak).toFixed(1)}, gap=${gap.toFixed(1)}`
    ).toBeGreaterThanOrEqual(20);
  });
});
