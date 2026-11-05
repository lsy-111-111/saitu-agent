import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildCompetitionClarifyAskableContext,
  generateNextCompetitionQuestion,
  materializeCompetitionClarifyQuestion,
  simulateCompetitionClarifyOutcome,
  type CompetitionClarifyAskableQuestion
} from "@/lib/ai/competition-clarify";
import {
  competitionDynamicQuestionFamilyV3,
  competitionDynamicQuestionV3Schema
} from "@/lib/ai/competition-dynamic-question";
import {
  getCompetitionRecommendationCandidates,
  type DeterministicCompetitionRecommendation
} from "@/lib/competitions/recommendation-engine";
import {
  COMPETITION_CORE_MISMATCH_TRANSFER_RATIOS,
  COMPETITION_SCORE_WEIGHTS,
  assessCompetitionConfirmedSubjectAlignment,
  buildCompetitionQualificationSnapshot,
  hasCompetitionFixedCoreMatch,
  scoreCompetitionRecommendations
} from "@/lib/competitions/scoring";
import {
  getCompetitionCatalog,
  getCompetitionPreferenceQuestionTracks
} from "@/lib/competitions/catalog";
import type {
  CompetitionDynamicExchangeV3,
  CompetitionDynamicQuestionV3,
  CompetitionDynamicSignalKeyV3,
  CompetitionQualificationSnapshotV1,
  CompetitionRecommendationProfileV5
} from "@/types/competition-recommendation";
import { COMPETITION_CLARIFICATION_NOTE_MAX_LENGTH } from "@/types/competition-recommendation";
import {
  QUALITY_BENCHMARK_NOW,
  competitionAnchorPersonas,
  competitionHardNegativePersonas,
  competitionNoMatchPersonas,
  competitionRankingHoldoutCases
} from "../fixtures/competition-quality-personas";
import {
  staticCompetitionFollowupGoldCases,
  type CompetitionFollowupGoldBranch,
  type CompetitionFollowupGoldCase
} from "../fixtures/competition-followup-gold";

function snapshotFingerprint(snapshot: CompetitionQualificationSnapshotV1) {
  return snapshot.entries.map((entry) => ({
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
  }));
}

function legalAnswerSets(gold: CompetitionFollowupGoldCase, values: readonly string[]) {
  const answers = values.map((value) => [value]);
  if (gold.family !== "fit") return answers;
  for (let left = 0; left < values.length; left += 1) {
    for (let right = left + 1; right < values.length; right += 1) {
      answers.push([values[left]!, values[right]!]);
    }
  }
  return answers;
}

function visiblePreferenceSignature(outcome: ReturnType<typeof simulateCompetitionClarifyOutcome>) {
  return JSON.stringify(outcome.topThree.map(({ competitionId, recommendedTrackId }) => [
    competitionId,
    recommendedTrackId ?? null
  ]));
}

function authoredExpectationSignature(branch: CompetitionFollowupGoldBranch) {
  return JSON.stringify({
    visible: branch.expectedVisibleCompetitionIds,
    absent: branch.expectedAbsentCompetitionIds ?? [],
    relativeOrder: branch.expectedRelativeOrder ?? [],
    tracks: branch.expectedTrackByCompetition ?? {},
    targetTrack: branch.expectedTrackId ?? null
  });
}

type PreparedGoldContext = {
  candidates: DeterministicCompetitionRecommendation[];
  snapshot: CompetitionQualificationSnapshotV1;
  priorTranscript: CompetitionDynamicExchangeV3[];
  askedSignalKeys: CompetitionDynamicSignalKeyV3[];
  askable: CompetitionClarifyAskableQuestion | undefined;
  setupFailures: string[];
};

type ReachedTrackGoldContext = {
  candidates: DeterministicCompetitionRecommendation[];
  snapshot: CompetitionQualificationSnapshotV1;
  priorTranscript: CompetitionDynamicExchangeV3[];
  targetQuestion: CompetitionDynamicQuestionV3 | null;
  setupFailures: string[];
};

/**
 * Replays only a literal, authored prior fit answer. The V5 profile, clock and
 * qualification snapshot remain fixed, while the candidate boundary is
 * recomputed through the same production path before asking the goal question.
 */
function prepareGoldContext(
  gold: CompetitionFollowupGoldCase,
  profile: CompetitionRecommendationProfileV5
): PreparedGoldContext {
  const snapshot = buildCompetitionQualificationSnapshot(
    profile,
    undefined,
    QUALITY_BENCHMARK_NOW
  );
  let priorTranscript: CompetitionDynamicExchangeV3[] = [];
  let askedSignalKeys: CompetitionDynamicSignalKeyV3[] = [];
  let candidates = getCompetitionRecommendationCandidates(profile, {
    now: QUALITY_BENCHMARK_NOW
  }).recommendations;
  const setupFailures: string[] = [];

  if (gold.priorFitValues) {
    if (gold.family !== "goal") {
      setupFailures.push(`${gold.id}: only goal gold may declare a prior fit answer`);
    }
    const fitAskable = buildCompetitionClarifyAskableContext(
      profile,
      candidates,
      [],
      [],
      snapshot,
      { now: QUALITY_BENCHMARK_NOW }
    ).find(({ signalKey }) => signalKey === "competition-fit");
    if (!fitAskable) {
      setupFailures.push(`${gold.id}: authored prior competition-fit question is absent`);
    } else if (!gold.priorFitValues.every((value) =>
      fitAskable.allowedOptionValues.includes(value)
    )) {
      setupFailures.push(
        `${gold.id}: prior fit contains a non-whitelisted value ${gold.priorFitValues.join(",")}`
      );
    } else {
      priorTranscript = [{
        question: materializeCompetitionClarifyQuestion(fitAskable, 1),
        answer: { selectedValues: [...gold.priorFitValues] }
      }];
      askedSignalKeys = ["competition-fit"];
      candidates = getCompetitionRecommendationCandidates(profile, {
        now: QUALITY_BENCHMARK_NOW,
        transcript: priorTranscript
      }).recommendations;
    }
  }

  const askable = buildCompetitionClarifyAskableContext(
    profile,
    candidates,
    askedSignalKeys,
    priorTranscript,
    snapshot,
    { now: QUALITY_BENCHMARK_NOW }
  ).find(({ signalKey }) => signalKey === gold.signalKey);
  return {
    candidates,
    snapshot,
    priorTranscript,
    askedSignalKeys,
    askable,
    setupFailures
  };
}

/**
 * Replays the fixture's literal path through the production V5 question
 * generator. The returned candidate boundary and transcript are therefore the
 * exact context in which the server actually emitted the target track question.
 */
async function reachAuthoredTrackQuestion(
  gold: CompetitionFollowupGoldCase,
  profile: CompetitionRecommendationProfileV5
): Promise<ReachedTrackGoldContext> {
  const snapshot = buildCompetitionQualificationSnapshot(
    profile,
    undefined,
    QUALITY_BENCHMARK_NOW
  );
  const priorTranscript: CompetitionDynamicExchangeV3[] = [];
  const setupFailures: string[] = [];
  let pathReached = true;

  for (const pathStep of gold.generateNextPath ?? []) {
    const candidates = getCompetitionRecommendationCandidates(profile, {
      now: QUALITY_BENCHMARK_NOW,
      transcript: priorTranscript
    }).recommendations;
    const response = await generateNextCompetitionQuestion(
      profile,
      priorTranscript,
      candidates,
      priorTranscript.map(({ question }) => question.signalKey),
      snapshot,
      { now: QUALITY_BENCHMARK_NOW }
    );
    const question = response.nextQuestion;
    if (response.status !== "question" || !question) {
      setupFailures.push(
        `${gold.id}: path stopped before ${pathStep.signalKey} at turn ${priorTranscript.length + 1}`
      );
      pathReached = false;
      break;
    }
    if (question.signalKey !== pathStep.signalKey) {
      setupFailures.push(
        `${gold.id}: expected path signal=${pathStep.signalKey}, actual=${question.signalKey}`
      );
      pathReached = false;
      break;
    }
    if (!pathStep.selectedValues.every((value) =>
      question.options.some((option) => option.value === value)
    )) {
      setupFailures.push(
        `${gold.id}/${pathStep.signalKey}: authored path answer is not server-whitelisted`
      );
      pathReached = false;
      break;
    }
    priorTranscript.push({
      question,
      answer: { selectedValues: [...pathStep.selectedValues] }
    });
  }

  const candidates = getCompetitionRecommendationCandidates(profile, {
    now: QUALITY_BENCHMARK_NOW,
    transcript: priorTranscript
  }).recommendations;
  if (!pathReached) {
    return { candidates, snapshot, priorTranscript, targetQuestion: null, setupFailures };
  }

  const response = await generateNextCompetitionQuestion(
    profile,
    priorTranscript,
    candidates,
    priorTranscript.map(({ question }) => question.signalKey),
    snapshot,
    { now: QUALITY_BENCHMARK_NOW }
  );
  const targetQuestion = response.nextQuestion;
  if (
    response.status !== "question" ||
    !targetQuestion ||
    targetQuestion.signalKey !== gold.signalKey
  ) {
    setupFailures.push(
      `${gold.id}: target track was not generated by turn ${priorTranscript.length + 1}; ` +
      `actual=${targetQuestion?.signalKey ?? response.status}`
    );
    return { candidates, snapshot, priorTranscript, targetQuestion: null, setupFailures };
  }
  if (priorTranscript.length + 1 > 3) {
    setupFailures.push(`${gold.id}: target track required a forbidden fourth turn`);
  }

  return { candidates, snapshot, priorTranscript, targetQuestion, setupFailures };
}

function branchOracleFailures(
  gold: CompetitionFollowupGoldCase,
  branch: CompetitionFollowupGoldBranch,
  actual: ReturnType<typeof simulateCompetitionClarifyOutcome>
) {
  const failures: string[] = [];
  const branchId = `${gold.id}/${branch.selectedValues.join("+")}`;
  const actualIds = actual.topThree.map(({ competitionId }) => competitionId);
  for (const expectedCompetitionId of branch.expectedVisibleCompetitionIds) {
    if (!actualIds.includes(expectedCompetitionId)) {
      failures.push(
        `${branchId}: expected visible member=${expectedCompetitionId}, actual=${actualIds.join(",")}`
      );
    }
  }
  for (const expectedAbsentCompetitionId of branch.expectedAbsentCompetitionIds ?? []) {
    if (actualIds.includes(expectedAbsentCompetitionId)) {
      failures.push(
        `${branchId}: expected absent member=${expectedAbsentCompetitionId}, actual=${actualIds.join(",")}`
      );
    }
  }
  for (const [higherCompetitionId, lowerCompetitionId] of
    branch.expectedRelativeOrder ?? []) {
    const higherIndex = actualIds.indexOf(higherCompetitionId);
    const lowerIndex = actualIds.indexOf(lowerCompetitionId);
    if (higherIndex < 0 || lowerIndex < 0 || higherIndex >= lowerIndex) {
      failures.push(
        `${branchId}: expected ${higherCompetitionId}>${lowerCompetitionId}, actual=${actualIds.join(",")}`
      );
    }
  }
  for (const [competitionId, expectedTrackId] of Object.entries(
    branch.expectedTrackByCompetition ?? {}
  )) {
    const actualTrackId = actual.topThree.find((item) =>
      item.competitionId === competitionId
    )?.recommendedTrackId;
    if (actualTrackId !== expectedTrackId) {
      failures.push(
        `${branchId}: expected ${competitionId} track=${expectedTrackId}, actual=${actualTrackId ?? "none"}`
      );
    }
  }
  if (
    branch.expectedTrackId !== undefined &&
    actual.targetTrack?.recommendedTrackId !== branch.expectedTrackId
  ) {
    failures.push(
      `${branchId}: expected target track=${branch.expectedTrackId}, ` +
      `actual=${actual.targetTrack?.recommendedTrackId ?? "none"}`
    );
  }
  return failures;
}

describe("static competition preference follow-up gold audit", () => {
  const factDeterminedTrackSignals = new Set([
    "track:career-planning",
    "track:challenge-cup-entrepreneurship-plan",
    "track:china-international-college-innovation",
    "track:enterprise-competition-simulation"
  ]);
  const factDeterminedTrackValues = new Set([
    "track:understanding-contemporary-china-foreign-language#international-chinese"
  ]);
  const personas = new Map([
    ...competitionAnchorPersonas,
    ...competitionRankingHoldoutCases,
    ...competitionHardNegativePersonas,
    ...competitionNoMatchPersonas
  ].map((persona) => [persona.id, persona]));

  it("contains 12 literal cases for each approved question family", () => {
    expect(staticCompetitionFollowupGoldCases).toHaveLength(36);
    expect(new Set(staticCompetitionFollowupGoldCases.map(({ id }) => id)).size).toBe(36);
    expect(staticCompetitionFollowupGoldCases.filter(({ family }) => family === "fit")).toHaveLength(12);
    expect(staticCompetitionFollowupGoldCases.filter(({ family }) => family === "goal")).toHaveLength(12);
    expect(staticCompetitionFollowupGoldCases.filter(({ family }) => family === "track")).toHaveLength(12);

    const source = readFileSync(
      path.join(process.cwd(), "tests", "fixtures", "competition-followup-gold.ts"),
      "utf8"
    );
    expect(source).not.toContain("@/content/competitions");
    expect(source).not.toContain("@/lib/competitions/scoring");
    expect(source).not.toContain("@/lib/ai/competition-clarify");
    expect(source).not.toContain("scoreCompetition(");
    expect(source).not.toContain("competitions.map");

    for (const gold of staticCompetitionFollowupGoldCases) {
      const auditedGold: CompetitionFollowupGoldCase = gold;
      expect(personas.has(gold.personaId), gold.id).toBe(true);
      expect(gold.profileSource, gold.id).toContain(gold.personaId);
      expect(gold.branches.length, gold.id).toBeGreaterThanOrEqual(2);
      expect(
        new Set(gold.branches.map(({ selectedValues }) => selectedValues.join("+"))).size,
        gold.id
      ).toBe(gold.branches.length);
      expect(
        new Set(gold.branches.map(authoredExpectationSignature)).size,
        `${gold.id}: authored branch expectations must describe at least two distinct outcomes`
      ).toBeGreaterThanOrEqual(2);
      expect(gold.evidenceRationale.length, gold.id).toBeGreaterThanOrEqual(20);
      expect(gold.signalKey, gold.id).toMatch(/^(?:competition-fit|candidate-goal-tradeoff|track:[a-z0-9-]+)$/);
      expect(gold.signalKey, gold.id).not.toMatch(/^(?:eligibility:|team-eligibility$)/);
      expect(competitionDynamicQuestionFamilyV3(gold.signalKey), gold.id).toBe(gold.family);
      expect(factDeterminedTrackSignals.has(gold.signalKey), gold.id).toBe(false);
      if ("priorFitValues" in gold && gold.priorFitValues) {
        expect(gold.family, gold.id).toBe("goal");
        expect(gold.priorFitValues.length, gold.id).toBeGreaterThanOrEqual(1);
        expect(gold.priorFitValues.length, gold.id).toBeLessThanOrEqual(2);
        expect(new Set(gold.priorFitValues).size, gold.id).toBe(gold.priorFitValues.length);
      }
      if (gold.family === "track") {
        expect(auditedGold.generateNextPath, gold.id).toBeDefined();
        expect(auditedGold.generateNextPath?.length, gold.id).toBeLessThanOrEqual(2);
        for (const step of auditedGold.generateNextPath ?? []) {
          expect(step.signalKey, gold.id).toMatch(/^(?:competition-fit|candidate-goal-tradeoff)$/);
          expect(step.selectedValues.length, gold.id).toBeGreaterThanOrEqual(1);
          expect(step.selectedValues.length, gold.id)
            .toBeLessThanOrEqual(step.signalKey === "competition-fit" ? 2 : 1);
        }
      } else {
        expect(auditedGold.generateNextPath, gold.id).toBeUndefined();
      }
      for (const branch of gold.branches) {
        const auditedBranch: CompetitionFollowupGoldBranch = branch;
        expect(branch.selectedValues.length, gold.id).toBeGreaterThanOrEqual(1);
        expect(branch.selectedValues.length, gold.id).toBeLessThanOrEqual(gold.family === "fit" ? 2 : 1);
        expect(new Set(branch.selectedValues).size, gold.id).toBe(branch.selectedValues.length);
        for (const value of branch.selectedValues) {
          expect(value.length, gold.id).toBeGreaterThan(0);
          expect(factDeterminedTrackValues.has(`${gold.signalKey}#${value}`), gold.id).toBe(false);
        }
        expect(branch.expectedVisibleCompetitionIds.length, gold.id).toBeGreaterThanOrEqual(1);
        expect(new Set(branch.expectedVisibleCompetitionIds).size, gold.id)
          .toBe(branch.expectedVisibleCompetitionIds.length);
        if (auditedBranch.expectedAbsentCompetitionIds) {
          expect(new Set(auditedBranch.expectedAbsentCompetitionIds).size, gold.id)
            .toBe(auditedBranch.expectedAbsentCompetitionIds.length);
          for (const absentCompetitionId of auditedBranch.expectedAbsentCompetitionIds) {
            expect(branch.expectedVisibleCompetitionIds, gold.id)
              .not.toContain(absentCompetitionId);
          }
        }
        for (const relation of auditedBranch.expectedRelativeOrder ?? []) {
          expect(relation, gold.id).toHaveLength(2);
          expect(relation[0], gold.id).not.toBe(relation[1]);
          expect(branch.expectedVisibleCompetitionIds, gold.id).toContain(relation[0]);
          expect(branch.expectedVisibleCompetitionIds, gold.id).toContain(relation[1]);
        }
        for (const competitionId of Object.keys(auditedBranch.expectedTrackByCompetition ?? {})) {
          expect(branch.expectedVisibleCompetitionIds, gold.id).toContain(competitionId);
        }
        if (gold.family === "track") {
          expect("expectedTrackId" in branch ? branch.expectedTrackId : undefined, gold.id)
            .toBe(branch.selectedValues[0]);
          expect(
            "precomputedTrackStatus" in branch ? branch.precomputedTrackStatus : undefined,
            gold.id
          )
            .toMatch(/^(?:eligible|needs_clarification)$/);
        } else {
          expect("precomputedTrackStatus" in branch ? branch.precomputedTrackStatus : undefined, gold.id)
            .toBeUndefined();
        }
      }
    }

    for (const goldId of ["goal-03", "goal-07", "goal-08", "goal-09", "goal-10"]) {
      const gold = staticCompetitionFollowupGoldCases.find(({ id }) => id === goldId)!;
      for (const branch of gold.branches) {
        const auditedBranch: CompetitionFollowupGoldBranch = branch;
        const otherBranchVisibleIds: string[] = gold.branches
          .filter((candidate) => candidate !== branch)
          .flatMap(({ expectedVisibleCompetitionIds }) => [...expectedVisibleCompetitionIds]);
        expect(auditedBranch.expectedAbsentCompetitionIds?.length, goldId)
          .toBeGreaterThanOrEqual(1);
        expect(
          auditedBranch.expectedAbsentCompetitionIds?.some((competitionId) =>
            otherBranchVisibleIds.includes(competitionId)
          ),
          `${goldId}: each branch must explicitly exclude a member supported by another branch`
        ).toBe(true);
      }
    }
  });

  it("reaches each track oracle through V5 and proves both emitted branches are distinct", async () => {
    const failures: string[] = [];
    for (const gold of staticCompetitionFollowupGoldCases.filter(
      ({ family }) => family === "track"
    )) {
      const persona = personas.get(gold.personaId)!;
      const reached = await reachAuthoredTrackQuestion(gold, persona.profile);
      failures.push(...reached.setupFailures);
      if (!reached.targetQuestion) {
        continue;
      }
      if (
        reached.targetQuestion.impact !== "material" ||
        reached.targetQuestion.estimatedPreferenceOutcomeChanges < 2
      ) {
        failures.push(`${gold.id}: emitted target question is not material`);
      }
      const serverOptions = new Set(reached.targetQuestion.options.map(({ value }) => value));
      const branchSignatures = new Set<string>();
      for (const branch of gold.branches) {
        for (const value of branch.selectedValues) {
          if (!serverOptions.has(value)) {
            failures.push(
              `${gold.id}: authored track ${value} is absent from the actually generated question`
            );
          }
        }
        if (!branch.selectedValues.every((value) => serverOptions.has(value))) continue;
        const actual = simulateCompetitionClarifyOutcome(
          persona.profile,
          reached.candidates,
          gold.signalKey,
          branch.selectedValues,
          reached.priorTranscript,
          { now: QUALITY_BENCHMARK_NOW }
        );
        branchSignatures.add(visiblePreferenceSignature(actual));
        failures.push(...branchOracleFailures(gold, branch, actual));
      }
      if (branchSignatures.size !== gold.branches.length) {
        failures.push(
          `${gold.id}: ${gold.branches.length} authored branches produced only ` +
          `${branchSignatures.size} distinct visible outcomes in the reached context`
        );
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("keeps every authored question material and its own branches outcome-distinct", () => {
    const failures: string[] = [];
    for (const gold of staticCompetitionFollowupGoldCases.filter(
      ({ family }) => family !== "track"
    )) {
      const persona = personas.get(gold.personaId)!;
      const prepared = prepareGoldContext(gold, persona.profile);
      failures.push(...prepared.setupFailures);
      const { askable, candidates, priorTranscript } = prepared;
      if (!askable) {
        failures.push(`${gold.id}: expected material askable ${gold.signalKey} was absent`);
        continue;
      }
      if (askable.impact !== "material" || askable.estimatedPreferenceOutcomeChanges < 2) {
        failures.push(`${gold.id}: non-material askable metadata`);
      }
      const authoredSignatures = new Set<string>();
      for (const branch of gold.branches) {
        if (!branch.selectedValues.every((value) => askable.allowedOptionValues.includes(value))) {
          failures.push(`${gold.id}: branch contains a non-whitelisted option ${branch.selectedValues.join(",")}`);
          continue;
        }
        const actual = simulateCompetitionClarifyOutcome(
          persona.profile,
          candidates,
          gold.signalKey,
          branch.selectedValues,
          priorTranscript,
          { now: QUALITY_BENCHMARK_NOW }
        );
        authoredSignatures.add(visiblePreferenceSignature(actual));
      }
      if (authoredSignatures.size < 2) {
        failures.push(`${gold.id}: authored branches collapse to one visible preference outcome`);
      }

      const signatures = new Set(
        legalAnswerSets(gold, askable.allowedOptionValues).map((selectedValues) => visiblePreferenceSignature(
          simulateCompetitionClarifyOutcome(
            persona.profile,
            candidates,
            gold.signalKey,
            selectedValues,
            priorTranscript,
            { now: QUALITY_BENCHMARK_NOW }
          )
        ))
      );
      if (signatures.size < 2) failures.push(`${gold.id}: all legal answers collapse to one preference outcome`);
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("matches the authored fit and goal minimal member, relation and track oracles", () => {
    const failures: string[] = [];
    for (const gold of staticCompetitionFollowupGoldCases.filter(
      ({ family }) => family !== "track"
    )) {
      const persona = personas.get(gold.personaId)!;
      const prepared = prepareGoldContext(gold, persona.profile);
      failures.push(...prepared.setupFailures);
      if (!prepared.askable) {
        failures.push(`${gold.id}: expected material askable ${gold.signalKey} was absent`);
        continue;
      }
      for (const branch of gold.branches) {
        if (!branch.selectedValues.every((value) =>
          prepared.askable!.allowedOptionValues.includes(value)
        )) continue;
        const actual = simulateCompetitionClarifyOutcome(
          persona.profile,
          prepared.candidates,
          gold.signalKey,
          branch.selectedValues,
          prepared.priorTranscript,
          { now: QUALITY_BENCHMARK_NOW }
        );
        failures.push(...branchOracleFailures(gold, branch, actual));
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("keeps fit and goal answers qualification-invariant across the complete frozen snapshot", () => {
    const failures: string[] = [];
    for (const gold of staticCompetitionFollowupGoldCases.filter(({ family }) => family !== "track")) {
      const persona = personas.get(gold.personaId)!;
      const catalog = getCompetitionCatalog();
      const prepared = prepareGoldContext(gold, persona.profile);
      failures.push(...prepared.setupFailures);
      const {
        askable,
        priorTranscript,
        snapshot: beforeSnapshot
      } = prepared;
      const beforeScoredCompetitionIds = scoreCompetitionRecommendations(catalog, persona.profile, {
        now: QUALITY_BENCHMARK_NOW,
        transcript: priorTranscript
      }).map(({ competition }) => competition.id).sort();
      if (!askable) {
        failures.push(`${gold.id}: expected material askable ${gold.signalKey} was absent`);
        continue;
      }
      const question = materializeCompetitionClarifyQuestion(
        askable,
        priorTranscript.length + 1
      );
      const expectedEligibilityFor = (competitionId: string, trackId: string | null) => {
        const entry = beforeSnapshot.entries.find((item) => item.competitionId === competitionId);
        return trackId
          ? entry?.tracks.find((track) => track.trackId === trackId)
          : entry;
      };

      for (const selectedValues of legalAnswerSets(gold, askable.allowedOptionValues)) {
        const transcript: CompetitionDynamicExchangeV3[] = [
          ...priorTranscript,
          { question, answer: { selectedValues } }
        ];
        const afterSnapshot = buildCompetitionQualificationSnapshot(
          persona.profile,
          undefined,
          QUALITY_BENCHMARK_NOW
        );
        if (JSON.stringify(snapshotFingerprint(afterSnapshot)) !== JSON.stringify(snapshotFingerprint(beforeSnapshot))) {
          failures.push(`${gold.id}/${selectedValues.join("+")}: qualification snapshot changed`);
        }
        const afterEligibility = scoreCompetitionRecommendations(catalog, persona.profile, {
          now: QUALITY_BENCHMARK_NOW,
          transcript
        })
          .map(({ competition, recommendedTrack, eligibility }) => ({
            competitionId: competition.id,
            trackId: recommendedTrack?.id ?? null,
            eligibility
          }));
        const afterScoredCompetitionIds = afterEligibility
          .map(({ competitionId }) => competitionId)
          .sort();
        if (JSON.stringify(afterScoredCompetitionIds) !== JSON.stringify(beforeScoredCompetitionIds)) {
          failures.push(`${gold.id}/${selectedValues.join("+")}: preference answer changed the hard-filtered competition set`);
        }
        const qualificationChanges = afterEligibility.flatMap((item) => {
          const precomputed = expectedEligibilityFor(item.competitionId, item.trackId);
          return precomputed &&
            precomputed.status === item.eligibility.status &&
            JSON.stringify(precomputed.reasons) === JSON.stringify(item.eligibility.reasons)
            ? []
            : [`${item.competitionId}:${item.trackId ?? "none"}`];
        });
        if (qualificationChanges.length > 0) {
          failures.push(`${gold.id}/${selectedValues.join("+")}: scoring eligibility diverged from snapshot for ${qualificationChanges.join(",")}`);
        }
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("limits goal trade-offs to the authored 75/25 goalsOutputs refinement", () => {
    const failures: string[] = [];
    const stableDimensions = [
      "subjectTask",
      "skillsEvidence",
      "maturity",
      "teamResources",
      "availabilityTiming",
      "dataConfidence"
    ] as const;

    for (const gold of staticCompetitionFollowupGoldCases.filter(
      ({ family }) => family === "goal"
    )) {
      const persona = personas.get(gold.personaId)!;
      const prepared = prepareGoldContext(gold, persona.profile);
      failures.push(...prepared.setupFailures);
      if (!prepared.askable) {
        failures.push(`${gold.id}: expected material goal question was absent`);
        continue;
      }
      const question = materializeCompetitionClarifyQuestion(
        prepared.askable,
        prepared.priorTranscript.length + 1
      );
      const baseline = new Map(scoreCompetitionRecommendations(
        getCompetitionCatalog(),
        persona.profile,
        { now: QUALITY_BENCHMARK_NOW, transcript: prepared.priorTranscript }
      ).map((item) => [item.competition.id, item]));

      for (const selectedValues of legalAnswerSets(
        gold,
        prepared.askable.allowedOptionValues
      )) {
        const selectedGoal = selectedValues[0]!;
        const transcript: CompetitionDynamicExchangeV3[] = [
          ...prepared.priorTranscript,
          { question, answer: { selectedValues } }
        ];
        const after = scoreCompetitionRecommendations(
          getCompetitionCatalog(),
          persona.profile,
          { now: QUALITY_BENCHMARK_NOW, transcript }
        );
        if (after.length !== baseline.size) {
          failures.push(`${gold.id}/${selectedGoal}: goal answer changed the scored catalog set`);
        }
        for (const item of after) {
          const before = baseline.get(item.competition.id);
          if (!before) {
            failures.push(`${gold.id}/${selectedGoal}: new scored member ${item.competition.id}`);
            continue;
          }
          for (const dimension of stableDimensions) {
            if (item.scoreBreakdown[dimension] !== before.scoreBreakdown[dimension]) {
              failures.push(
                `${gold.id}/${selectedGoal}/${item.competition.id}: ${dimension} changed ` +
                `${before.scoreBreakdown[dimension]} -> ${item.scoreBreakdown[dimension]}`
              );
            }
          }

          const beforeGoals = before.scoreBreakdown.goalsOutputs;
          const afterGoals = item.scoreBreakdown.goalsOutputs;
          if (beforeGoals === undefined || afterGoals === undefined) {
            failures.push(`${gold.id}/${selectedGoal}/${item.competition.id}: goalsOutputs missing`);
            continue;
          }
          const subjectAssessment = assessCompetitionConfirmedSubjectAlignment(
            item.competition,
            persona.profile
          );
          const hasConfirmedSubjectIntent = Boolean(
            subjectAssessment &&
            (
              subjectAssessment.requestedPrimaryMajors.length > 0 ||
              subjectAssessment.requestedSpecificSubjects.length > 0
            )
          );
          const fixedCoreMismatch = Boolean(
            hasConfirmedSubjectIntent &&
            persona.profile.confirmedFields.includes("taskFormats") &&
            persona.profile.taskFormats.length > 0 &&
            !hasCompetitionFixedCoreMatch(item.competition, persona.profile)
          );
          const transfer = fixedCoreMismatch
            ? COMPETITION_CORE_MISMATCH_TRANSFER_RATIOS.goalsOutputs
            : 1;
          const priorityRatio = item.competition.recommendation.goalValues[
            selectedGoal as keyof typeof item.competition.recommendation.goalValues
          ];
          const expectedFromRoundedBaseline =
            beforeGoals * 0.75 +
            COMPETITION_SCORE_WEIGHTS.goalsOutputs * priorityRatio * transfer * 0.25;
          if (Math.abs(afterGoals - expectedFromRoundedBaseline) > 0.11) {
            failures.push(
              `${gold.id}/${selectedGoal}/${item.competition.id}: goalsOutputs ${afterGoals} ` +
              `does not follow 0.75*${beforeGoals}+0.25*priority ` +
              `(rounded expectation ${expectedFromRoundedBaseline.toFixed(2)})`
            );
          }
          if (Math.abs(afterGoals - beforeGoals) > 3.75) {
            failures.push(
              `${gold.id}/${selectedGoal}/${item.competition.id}: goalsOutputs moved ` +
              `${Math.abs(afterGoals - beforeGoals).toFixed(1)} points (>3.75)`
            );
          }
        }
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("keeps every authored goal relation and fit-11/12 relation inside one qualification tier", () => {
    const failures: string[] = [];
    const auditedCases = staticCompetitionFollowupGoldCases.filter((gold) =>
      gold.family === "goal" || gold.id === "fit-11" || gold.id === "fit-12"
    );
    for (const gold of auditedCases) {
      const persona = personas.get(gold.personaId)!;
      const snapshot = buildCompetitionQualificationSnapshot(
        persona.profile,
        undefined,
        QUALITY_BENCHMARK_NOW
      );
      const authoredIds = [...new Set(gold.branches.flatMap(
        ({ expectedVisibleCompetitionIds }) => expectedVisibleCompetitionIds
      ))];
      const statuses = authoredIds.map((competitionId) => ({
        competitionId,
        status: snapshot.entries.find((entry) => entry.competitionId === competitionId)?.status
      }));
      const missing = statuses.filter(({ status }) => !status);
      if (missing.length > 0) {
        failures.push(`${gold.id}: snapshot missing ${missing.map(({ competitionId }) => competitionId).join(",")}`);
        continue;
      }
      const distinctStatuses = new Set(statuses.map(({ status }) => status));
      if (distinctStatuses.size !== 1) {
        failures.push(
          `${gold.id}: authored preference crosses qualification tiers ` +
          statuses.map(({ competitionId, status }) => `${competitionId}=${status}`).join(",")
        );
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("allows reached track answers only from precomputed states and never upgrades needs_clarification", async () => {
    const failures: string[] = [];
    const authoredStatuses = new Set<"eligible" | "needs_clarification">();
    for (const gold of staticCompetitionFollowupGoldCases.filter(({ family }) => family === "track")) {
      const persona = personas.get(gold.personaId)!;
      const reached = await reachAuthoredTrackQuestion(gold, persona.profile);
      failures.push(...reached.setupFailures);
      const targetCompetitionId = gold.signalKey.slice("track:".length);
      const catalogCompetition = getCompetitionCatalog().find(({ id }) => id === targetCompetitionId);
      const entry = reached.snapshot.entries.find(
        ({ competitionId }) => competitionId === targetCompetitionId
      );
      const question = reached.targetQuestion;
      if (!entry || !question || !catalogCompetition) {
        failures.push(`${gold.id}: target catalog, snapshot or generated question missing`);
        continue;
      }
      const preferenceTrackIds = new Set(
        getCompetitionPreferenceQuestionTracks(catalogCompetition).map(({ id }) => id)
      );
      for (const selectedTrackId of new Set([
        ...question.options.map(({ value }) => value),
        ...gold.branches.flatMap(({ selectedValues }) => selectedValues)
      ])) {
        if (!preferenceTrackIds.has(selectedTrackId)) {
          failures.push(`${gold.id}/${selectedTrackId}: track is not in the authored preference-question whitelist`);
        }
      }
      for (const selectedTrackId of question.options.map(({ value }) => value)) {
        const branch = gold.branches.find(({ selectedValues }) => selectedValues[0] === selectedTrackId);
        const precomputed = entry.tracks.find(({ trackId }) => trackId === selectedTrackId);
        if (!precomputed || precomputed.status === "ineligible") {
          failures.push(`${gold.id}/${selectedTrackId}: option is absent or hard-ineligible in snapshot`);
          continue;
        }
        const expectedStatus = branch && "precomputedTrackStatus" in branch
          ? branch.precomputedTrackStatus
          : undefined;
        if (expectedStatus && precomputed.status !== expectedStatus) {
          failures.push(`${gold.id}/${selectedTrackId}: expected precomputed=${expectedStatus}, actual=${precomputed.status}`);
        }
        if (branch && (precomputed.status === "eligible" || precomputed.status === "needs_clarification")) {
          authoredStatuses.add(precomputed.status);
        }
        const transcript: CompetitionDynamicExchangeV3[] = [
          ...reached.priorTranscript,
          { question, answer: { selectedValues: [selectedTrackId] } }
        ];
        const selected = scoreCompetitionRecommendations(
          getCompetitionCatalog(),
          persona.profile,
          { now: QUALITY_BENCHMARK_NOW, transcript }
        ).find(({ competition }) => competition.id === targetCompetitionId);
        if (selected?.recommendedTrack?.id !== selectedTrackId) {
          failures.push(`${gold.id}/${selectedTrackId}: scorer did not adopt the selected precomputed track`);
        }
        if (selected?.eligibility.status !== precomputed.status) {
          failures.push(`${gold.id}/${selectedTrackId}: precomputed status=${precomputed.status}, selected status=${selected?.eligibility.status ?? "missing"}`);
        }
        if (precomputed.status === "needs_clarification" && selected?.eligibility.status === "eligible") {
          failures.push(`${gold.id}/${selectedTrackId}: user choice upgraded needs_clarification to eligible`);
        }
        const afterSnapshot = buildCompetitionQualificationSnapshot(
          persona.profile,
          undefined,
          QUALITY_BENCHMARK_NOW
        );
        if (
          JSON.stringify(snapshotFingerprint(afterSnapshot)) !==
          JSON.stringify(snapshotFingerprint(reached.snapshot))
        ) {
          failures.push(`${gold.id}/${selectedTrackId}: track answer mutated the frozen snapshot`);
        }
      }
    }
    if (!authoredStatuses.has("needs_clarification")) {
      failures.push("authored track gold does not exercise any needs_clarification selection");
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("adopts a synthetic eligible content-track selection without changing its status", () => {
    const persona = personas.get("anchor-national-college-electronic-design")!;
    const baseCompetition = getCompetitionCatalog().find(
      ({ id }) => id === "national-college-electronic-design"
    );
    expect(baseCompetition).toBeDefined();
    const syntheticCompetition = {
      ...baseCompetition!,
      id: "synthetic-eligible-content-tracks",
      name: "合成已确认内容赛道",
      recommendation: {
        ...baseCompetition!.recommendation,
        tracks: [
          { id: "circuit-prototype", label: "电路原型方向", preferenceQuestionEligible: true, fitSignals: ["hardware-build"] as const },
          { id: "embedded-system", label: "嵌入式系统方向", preferenceQuestionEligible: true, fitSignals: ["hardware-build"] as const }
        ]
      }
    };
    const preferenceTracks = getCompetitionPreferenceQuestionTracks(syntheticCompetition);
    expect(preferenceTracks.map(({ id }) => id)).toEqual(["circuit-prototype", "embedded-system"]);
    const snapshot = buildCompetitionQualificationSnapshot(
      persona.profile,
      [syntheticCompetition],
      QUALITY_BENCHMARK_NOW
    );
    const entry = snapshot.entries[0];
    expect(entry?.tracks.map(({ status }) => status)).toEqual(["eligible", "eligible"]);
    const question = competitionDynamicQuestionV3Schema.parse({
      questionId: "dq_synthetic_eligible_content_track",
      signalKey: "track:synthetic-eligible-content-tracks",
      prompt: "《合成已确认内容赛道》的这些候选方向中，你更想优先准备哪个赛道？",
      selection: "single",
      options: preferenceTracks.map(({ id, label }) => ({ value: id, label })),
      allowsNote: true,
      maxNoteLength: COMPETITION_CLARIFICATION_NOTE_MAX_LENGTH,
      impact: "material",
      estimatedPreferenceOutcomeChanges: 2
    });
    const selected = scoreCompetitionRecommendations(
      [syntheticCompetition],
      persona.profile,
      {
        now: QUALITY_BENCHMARK_NOW,
        transcript: [{ question, answer: { selectedValues: ["embedded-system"] } }]
      }
    )[0];
    expect(selected?.recommendedTrack?.id).toBe("embedded-system");
    expect(selected?.eligibility.status).toBe("eligible");
  });
});
