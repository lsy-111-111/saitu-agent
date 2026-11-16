import { buildDecisionContextV7 } from "@/lib/competitions/v7/model";
import { getMatchingCatalogRecords } from "@/lib/competitions/v7/catalog";
import { createStudentProfileV7, applySelfReportedFactsV7 } from "@/lib/competitions/v7/profile";
import { draftDecisionChatV7 } from "@/lib/competitions/v7/chat";
import { migrationContext, migrationRecords, migrationStudent, rankMigrationContext } from "./legacy-v7-migration.fixture";
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

  it("v7 applies a directly submitted track preference without the retired V5 question path", async () => {
    const records = migrationRecords(3);
    records[1] = { ...records[1], seriesId: records[0].seriesId, recordId: `${records[0].seriesId}.2026.alternative`, track: { id: "alternative", name: "另一任务方向" } };
    const original = JSON.stringify(records);
    const question = competitionDynamicQuestionV3Schema.parse({
      questionId: "dq_v7_direct_track", signalKey: `track:${records[0].seriesId}`,
      prompt: "这两个任务方向，你希望优先准备哪个？", selection: "single",
      options: [{ value: "analysis", label: "数据任务" }, { value: "alternative", label: "另一任务方向" }],
      allowsNote: true, maxNoteLength: COMPETITION_CLARIFICATION_NOTE_MAX_LENGTH,
      impact: "material", estimatedPreferenceOutcomeChanges: 2
    });
    for (const selectedValue of ["analysis", "alternative"]) {
      const context = buildDecisionContextV7(migrationStudent(), { records, transcript: [{ question, answer: { selectedValues: [selectedValue] } }] });
      expect(context.candidates.filter(candidate => candidate.record.seriesId === records[0].seriesId).map(candidate => candidate.record.track.id)).toEqual([selectedValue]);
      expect(context.candidates.some(candidate => candidate.record.recordId === records[2].recordId)).toBe(true);
      const selectedIds = context.candidates.map(candidate => candidate.record.recordId);
      const { plan } = await rankMigrationContext(context, selectedIds);
      expect(plan.recommendations.map(item => item.itemId)).toEqual(selectedIds);
      expect(context.candidates.every(candidate => candidate.eligibility === "unknown" && candidate.score === null)).toBe(true);
    }
    expect(JSON.stringify(records)).toBe(original);
  });

  it("v7 adopts a clear self report immediately and keeps interest separate from ability", async () => {
    const legacy = migrationStudent();
    let extractionCalls = 0;
    const reply = await draftDecisionChatV7({ legacy, profile: createStudentProfileV7(legacy) }, "我会Python。", [], {
      modelCall: async () => { extractionCalls++; throw new Error("clear_self_report_must_not_require_a_call"); }
    });
    expect(extractionCalls).toBe(0);
    expect(reply.profile?.facts.find(fact => fact.field === "skills" && fact.value === "programming")).toMatchObject({ state: "affirmed", confirmed: true, evidenceLevel: "self_report", originalText: "我会Python。" });
    expect(reply.profile?.facts.some(fact => fact.field.startsWith("experience."))).toBe(false);
    const context = buildDecisionContextV7(legacy, { profile: reply.profile!, records: migrationRecords() });
    const ranked = await rankMigrationContext(context, context.candidates.slice(0, 2).map(candidate => candidate.record.recordId));
    expect(ranked.packets[0].profile.facts.find(fact => fact.field === "skills" && fact.value === "programming")).toMatchObject({ confirmed: true, originalText: "我会Python。" });
    const text = "我对数据感兴趣，想学分析。";
    const source = { answerId: "v7-interest", text, at: "2026-11-09T00:00:00.000Z" };
    const interested = applySelfReportedFactsV7(createStudentProfileV7(legacy), { facts: [{ field: "interests", value: "data", state: "affirmed", confirmed: false, evidenceLevel: "self_report", sourceText: text }], unknownFields: [] }, source, legacy);
    expect(interested.facts.find(fact => fact.field === "interests")?.value).toBe("data");
    expect(interested.facts.some(fact => fact.field === "skills")).toBe(false);
    expect(() => applySelfReportedFactsV7(createStudentProfileV7(legacy), { facts: [{ field: "skills", value: "data-analysis", state: "affirmed", confirmed: false, evidenceLevel: "self_report", sourceText: text }], unknownFields: [] }, source, legacy)).toThrow("interest_cannot_become_ability");
  });

  it("v7 lets C choose different full-pool orders without a fixed fit or goal relation oracle", async () => {
    const context = migrationContext();
    const selectedIds = context.candidates.slice(-10).map(candidate => candidate.record.recordId);
    const forward = await rankMigrationContext(context, selectedIds);
    const reverse = await rankMigrationContext(context, [...selectedIds].reverse());
    for (const run of [forward, reverse]) {
      expect(run.packets[0].candidates.map(candidate => candidate.itemId)).toEqual(context.candidates.map(candidate => candidate.record.recordId));
      expect(run.calls).toEqual([{ operation: "competition_v7_rank", effort: "high", maxAttempts: 1 }]);
      expect(run.plan.recommendations).toHaveLength(10);
    }
    expect(forward.plan.recommendations.map(item => item.itemId)).toEqual(selectedIds);
    expect(reverse.plan.recommendations.map(item => item.itemId)).toEqual([...selectedIds].reverse());
    expect(reverse.plan.recommendations[0].itemId).not.toBe(forward.plan.recommendations[0].itemId);
  });

  it("v7 keeps unknown readiness and registration metadata out of the legal pool for every old fit and goal input", () => {
    const records = migrationRecords();
    const historical = structuredClone(records);
    for (const [index, record] of historical.entries()) {
      record.registration = { status: index % 2 ? "closed" : "unknown", checkedAt: null, factIds: [], note: "报名与资格留待官方核查" };
      record.contentTier = "L1";
      record.publication = { mode: "discovery_only", productionReady: false, blockers: ["current_registration_unknown"] };
    }
    for (const gold of staticCompetitionFollowupGoldCases.filter(gold => gold.family !== "track")) {
      const profile = personas.get(gold.personaId)!.profile;
      const normal = migrationContext(profile, records), unknown = migrationContext(profile, historical);
      expect(unknown.candidates.map(candidate => candidate.record.recordId), gold.id).toEqual(normal.candidates.map(candidate => candidate.record.recordId));
      expect(unknown.excluded, gold.id).toEqual(normal.excluded);
      expect(unknown.candidates.every(candidate => candidate.score === null && candidate.eligibility === "unknown"), gold.id).toBe(true);
      expect(unknown.candidates.every(candidate => candidate.conditions.some(condition => condition.includes("官方"))), gold.id).toBe(true);
    }
  });

  it("v7 sends each explicit goal to C without a 75/25 rule score refinement", async () => {
    for (const goal of ["project", "award", "postgraduate", "employment", "portfolio", "entrepreneurship", "networking"] as const) {
      const context = migrationContext(migrationStudent({ goals: [goal], confirmedFields: ["stage", "goals"] }));
      const selected = context.candidates.slice(-2).map(candidate => candidate.record.recordId).reverse();
      const ranked = await rankMigrationContext(context, selected);
      expect(ranked.packets[0].profile.facts.some(fact => fact.field === "goals" && fact.value === goal && fact.confirmed), goal).toBe(true);
      expect(ranked.packets[0].profile.primaryGoal, goal).toBe(context.profile.primaryGoal);
      expect(context.candidates.every(candidate => candidate.score === null && candidate.nativeScore === undefined), goal).toBe(true);
      expect(ranked.packets[0].candidates.every(candidate => !("score" in candidate) && !("scoreBreakdown" in candidate)), goal).toBe(true);
      expect(ranked.plan.recommendations.map(item => item.itemId), goal).toEqual(selected);
    }
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

  it("v7 excludes only a reviewed explicit audience conflict and keeps the same unknown identity eligible for matching", async () => {
    const records = getMatchingCatalogRecords();
    const comap = records.find(record => record.seriesId === "comap-mcm-icm")!;
    const biomod = records.find(record => record.seriesId === "biomod")!;
    expect(comap).toBeDefined(); expect(biomod).toBeDefined();
    const legacy = migrationStudent({ stage: "master", confirmedFields: ["stage"] });
    const confirmed = migrationContext(legacy, [comap, biomod]);
    expect(confirmed.excluded.has(comap.recordId)).toBe(true);
    expect(confirmed.candidates.map(candidate => candidate.record.recordId)).toEqual([biomod.recordId]);
    const unknownProfile = createStudentProfileV7(legacy);
    unknownProfile.facts = unknownProfile.facts.map(fact => fact.field === "stage" ? { ...fact, state: "unknown", confirmed: false } : fact);
    unknownProfile.unknownFields = [...new Set([...unknownProfile.unknownFields, "stage"])];
    const unknown = buildDecisionContextV7(undefined, { profile: unknownProfile, records: [comap, biomod] });
    expect(unknown.excluded.size).toBe(0);
    expect(new Set(unknown.candidates.map(candidate => candidate.record.recordId))).toEqual(new Set([comap.recordId, biomod.recordId]));
    const chosen = [comap.recordId, biomod.recordId];
    const ranked = await rankMigrationContext(unknown, chosen);
    expect(ranked.plan.recommendations.map(item => item.itemId)).toEqual(chosen);
    expect(unknown.candidates.every(candidate => candidate.eligibility === "unknown")).toBe(true);
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


/** Saved V5 compatibility evidence; it does not grade current V7 model relevance. */
describe("policy migration candidate preference safety independent of reachability", () => {
  it("checks every literal fit/goal branch against the full precomputed qualification pool", () => {
    const personas = new Map([...competitionAnchorPersonas, ...competitionRankingHoldoutCases]
      .map(persona => [persona.id, persona]));
    const catalog = getCompetitionCatalog();
    const failures: string[] = [];
    let checkedBranches = 0;
    for (const gold of staticCompetitionFollowupGoldCases.filter(item => item.family !== "track")) {
      const profile = personas.get(gold.personaId)!.profile;
      const frozenProfile = JSON.stringify(profile);
      const snapshot = buildCompetitionQualificationSnapshot(profile, catalog, QUALITY_BENCHMARK_NOW);
      expect(snapshot.entries).toHaveLength(catalog.length);
      const before = scoreCompetitionRecommendations(catalog, profile, { now: QUALITY_BENCHMARK_NOW });
      // Replay authored preference semantics directly. This does not assert that
      // the production generator currently offers this question or these options.
      const values = [...new Set(gold.branches.flatMap(branch => [...branch.selectedValues]))];
      const question = competitionDynamicQuestionV3Schema.parse({
        questionId: `dq_migration_${gold.id}`, signalKey: gold.signalKey,
        prompt: "请选择希望优先比较的任务或目标。", selection: gold.family === "fit" ? "multiple" : "single",
        ...(gold.family === "fit" ? { maxSelections: 2 } : {}),
        options: values.map(value => ({ value, label: value })), allowsNote: true,
        maxNoteLength: COMPETITION_CLARIFICATION_NOTE_MAX_LENGTH,
        impact: "material", estimatedPreferenceOutcomeChanges: 2
      });
      for (const branch of gold.branches) {
        checkedBranches += 1;
        const after = scoreCompetitionRecommendations(catalog, profile, { now: QUALITY_BENCHMARK_NOW,
          transcript: [{ question, answer: { selectedValues: [...branch.selectedValues] } }]
        });
        if (JSON.stringify(profile) !== frozenProfile) failures.push(`${gold.id}: profile facts mutated`);
        if (JSON.stringify(after.map(row => row.competition.id).sort()) !==
          JSON.stringify(before.map(row => row.competition.id).sort())) {
          failures.push(`${gold.id}/${branch.selectedValues.join("+")}: changed hard-filtered candidate membership`);
        }
        for (const row of after) {
          const parent = snapshot.entries.find(entry => entry.competitionId === row.competition.id)!;
          const expected = row.recommendedTrack
            ? parent.tracks.find(track => track.trackId === row.recommendedTrack!.id) : parent;
          if (!expected || expected.status !== row.eligibility.status ||
            JSON.stringify(expected.reasons) !== JSON.stringify(row.eligibility.reasons)) {
            failures.push(`${gold.id}/${branch.selectedValues.join("+")}/${row.competition.id}: preference changed precomputed eligibility`);
          }
        }
      }
    }
    expect(checkedBranches).toBe(51);
    expect(failures, failures.join("\n")).toEqual([]);
  });
});

describe("five-dimensional goal isolation migration candidate", () => {
  it("keeps non-goal contributions fixed for every authored goal answer on unchanged track-free tasks", () => {
    const personas = new Map([...competitionAnchorPersonas, ...competitionRankingHoldoutCases]
      .map(persona => [persona.id, persona]));
    const catalog = getCompetitionCatalog().filter(item => !item.recommendation.tracks?.length);
    expect(catalog.length).toBeGreaterThan(0);
    const failures: string[] = [];
    let checkedBranches = 0;
    let comparedCandidates = 0;
    for (const gold of staticCompetitionFollowupGoldCases.filter(item => item.family === "goal")) {
      const profile = personas.get(gold.personaId)!.profile;
      const before = new Map(scoreCompetitionRecommendations(catalog, profile, { now: QUALITY_BENCHMARK_NOW })
        .map(row => [row.competition.id, row]));
      const values = [...new Set(gold.branches.flatMap(branch => [...branch.selectedValues]))];
      const question = competitionDynamicQuestionV3Schema.parse({
        questionId: `dq_goal_isolation_${gold.id}`, signalKey: gold.signalKey,
        prompt: "在任务不变时，选择希望优先比较的目标。", selection: "single",
        options: values.map(value => ({ value, label: value })), allowsNote: true,
        maxNoteLength: COMPETITION_CLARIFICATION_NOTE_MAX_LENGTH,
        impact: "material", estimatedPreferenceOutcomeChanges: 2
      });
      for (const branch of gold.branches) {
        checkedBranches += 1;
        const after = scoreCompetitionRecommendations(catalog, profile, { now: QUALITY_BENCHMARK_NOW,
          transcript: [{ question, answer: { selectedValues: [...branch.selectedValues] } }]
        });
        for (const row of after) {
          comparedCandidates += 1;
          const previous = before.get(row.competition.id);
          if (!previous?.decisionFit || !row.decisionFit) {
            failures.push(`${gold.id}/${row.competition.id}: missing five-dimensional assessment`);
            continue;
          }
          for (const dimension of ["task", "experience", "readiness", "growth"] as const) {
            if (previous.decisionFit.dimensions[dimension] !== row.decisionFit.dimensions[dimension]) {
              failures.push(`${gold.id}/${branch.selectedValues}/${row.competition.id}: changed ${dimension} without new facts`);
            }
          }
          if (branch.selectedValues[0] === "award" &&
            (row.decisionFit.dimensions.goal !== 0 || row.decisionFit.upper - row.decisionFit.lower < 30 - 1e-9)) {
            failures.push(`${gold.id}/${row.competition.id}: award recognition was treated as known`);
          }
        }
      }
    }
    expect(checkedBranches).toBe(24);
    expect(comparedCandidates).toBeGreaterThan(0);
    expect(failures, failures.join("\n")).toEqual([]);
  });
});
