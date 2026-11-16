import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StudentFactV6 } from "@/lib/competitions/v6/contracts";
import { createModelIdentifierCodec } from "@/lib/competitions/v6/model-identifiers";
import { getMatchingCatalogRecords } from "@/lib/competitions/v7/catalog";
import { buildDecisionContextV7, rankDecisionV7 } from "@/lib/competitions/v7/model";
import { inspectRankDiagnosticsV7, splitRankDiagnosticsV7 } from "@/lib/competitions/v7/rank-diagnostics";
import { rankTaskFactsV7 } from "@/lib/competitions/v7/rank-packet";
import { student, syntheticRecord } from "../v6/decision-fixtures";

const goal = "探索计算生物而非湿实验";
const noLab: StudentFactV6 = { id: "rank-current-constraint", field: "constraints", value: "无实验室，已有线性代数基础和生物导师",
  label: "当前限制", state: "affirmed", confirmed: true, evidenceLevel: "self_report", originalText: "无实验室，已有线性代数基础和生物导师" };

function setup(records = [syntheticRecord(1), syntheticRecord(2), syntheticRecord(3)]) {
  const context = buildDecisionContextV7(student(), { records });
  context.profile.primaryGoal = goal;
  context.profile.goals = [goal];
  context.profile.facts.push({ ...noLab });
  const codec = createModelIdentifierCodec({ candidates: context.candidates.map(({ record }) => record.recordId),
    series: context.candidates.map(({ record }) => record.seriesId), facts: context.candidates.flatMap(({ record }) => record.facts.map(fact => fact.id)),
    students: context.profile.facts.map(fact => fact.id) });
  const alias = (id: string) => (codec.encode({ id }) as { id: string }).id;
  return { context, codec, alias };
}

function diagnosticFixture() {
  const { context, codec, alias } = setup();
  const [first, second, third] = context.candidates.map(({ record }) => record);
  const target = alias(first.recordId), other = alias(second.recordId), positive = alias(third.recordId);
  const anchor = rankTaskFactsV7(first)[0].id;
  const codes = { [target]: "C", [other]: "E" };
  const witness = { itemId: target, roleIndex: 0, taskStepIndex: 0, competitionFactIds: [alias(anchor)],
    goalIndex: 0, studentFactIds: [alias(noLab.id)] };
  const bindings = { context, codec, assessments: [{ itemId: first.recordId, fit: null }, { itemId: second.recordId, fit: null },
    { itemId: third.recordId, fit: { positive: true } }], goalIndices: [0], studentBasisCount: 0 };
  const inspect = (value: unknown) => inspectRankDiagnosticsV7(splitRankDiagnosticsV7({ rankDiagnostics: value }), bindings);
  return { inspect, bindings, alias, first, second, positive, target, other, anchor, codes, witness };
}

beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => { throw new Error("offline_rank_diagnostics_only"); })));
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe("v763 private rank diagnostics", () => {
  it("separates the sidecar from the core without mutating the receipt or suppressing other keys", () => {
    const original = { assessments: [], shortfallReason: null, unexpected: true, rankDiagnostics: { codes: { "@C0": "U" } } };
    const copy = structuredClone(original);
    expect(splitRankDiagnosticsV7(original)).toEqual({ payload: { assessments: [], shortfallReason: null, unexpected: true },
      diagnostic: original.rankDiagnostics, present: true });
    expect(original).toEqual(copy);
    expect(splitRankDiagnosticsV7({ assessments: [] })).toEqual({ payload: { assessments: [] }, diagnostic: undefined, present: false });
  });

  it("binds canonical owner, original role and exact active task limitation", () => {
    const { inspect, bindings, first, second, anchor, codes, witness } = diagnosticFixture();
    expect(inspectRankDiagnosticsV7(splitRankDiagnosticsV7({}), bindings)).toEqual({ status: "absent" });
    expect(inspect({ codes, witnesses: [witness] })).toEqual({ status: "valid", codes: [
      { itemId: first.recordId, code: "C" }, { itemId: second.recordId, code: "E" }],
      witnesses: [{ ...witness, itemId: first.recordId, competitionFactIds: [anchor], studentFactIds: [noLab.id] }] });
    expect(inspect({ codes: { [witness.itemId]: "U", [Object.keys(codes)[1]]: "E" } })).toMatchObject({ status: "valid", witnesses: [] });
  });

  it("checks coverage and provenance without certifying the diagnostic's claim", () => {
    const { inspect, alias, second, target, other, positive, codes, witness } = diagnosticFixture();
    for (const incomplete of [{ [target]: "U" }, { [target]: "U", [positive]: "L" }, { [target]: "U", "@C999": "E" },
      { [target]: "B", [other]: "L" }]) expect(inspect({ codes: incomplete })).toEqual({ status: "invalid", reason: "coverage" });
    expect(inspect({ codes: { [target]: "unknown", [other]: "L" } })).toEqual({ status: "invalid", reason: "shape" });
    expect(inspect({ codes })).toEqual({ status: "invalid", reason: "witness" });
    expect(inspect({ codes, witnesses: Array.from({ length: 5 }, () => witness) })).toEqual({ status: "invalid", reason: "shape" });
    expect(inspect({ codes, witnesses: [witness, witness] })).toEqual({ status: "invalid", reason: "witness" });
    for (const invalidReference of [{ roleIndex: 99 }, { taskStepIndex: 99 }, { goalIndex: 99 }, { studentBasisIndex: 99 },
      { competitionFactIds: [alias(rankTaskFactsV7(second)[0].id)] }])
      expect(inspect({ codes, witnesses: [{ ...witness, ...invalidReference }] })).toEqual({ status: "invalid", reason: "witness" });
    expect(inspect({ codes: { ...codes, [target]: "L" }, witnesses: [witness] })).toEqual({ status: "invalid", reason: "restriction" });
  });

  it("does not turn positive resources, conditional permission or withdrawn evidence into a conflict", () => {
    const { inspect, bindings, codes, witness } = diagnosticFixture();
    const facts = bindings.context.profile.facts;
    const factIndex = facts.findIndex(fact => fact.id === noLab.id);
    for (const changed of [
      { ...noLab, originalText: "有实验室，已有线性代数基础" },
      { ...noLab, originalText: "如果学校关闭，我无实验室" },
      { ...noLab, originalText: "导师说，无实验室" },
      { ...noLab, originalText: "同组成员转述，无实验室" },
      { ...noLab, state: "unknown" as const, confirmed: false },
      { ...noLab, state: "conditional" as const, confirmed: false },
    ]) {
      facts[factIndex] = changed;
      expect(inspect({ codes, witnesses: [witness] })).toEqual({ status: "invalid", reason: "restriction" });
    }
    facts[factIndex] = { ...noLab, state: "negated", field: "unavailableResource", originalText: "确认无法获得实验室" };
    expect(inspect({ codes, witnesses: [witness] })).toMatchObject({ status: "valid" });
    bindings.context.profile.retractedFactIds.push(noLab.id);
    expect(inspect({ codes, witnesses: [witness] })).toEqual({ status: "invalid", reason: "restriction" });
  });

  it("keeps the same real goal-only binding with valid, malformed and missing sidecars", async () => {
    const { context, alias } = setup(getMatchingCatalogRecords());
    const record = context.candidates.find(candidate => candidate.record.seriesId === "igem-collegiate")!.record;
    const atom = rankTaskFactsV7(record).find(fact => fact.sourceIds.includes("igem-2025-hkust-model"))!;
    const selected = alias(record.recordId), selectedFact = alias(atom.id);
    const plans = [], snapshot = structuredClone(context);
    for (const status of ["valid", "invalid", "absent"] as const) {
      const observations: unknown[] = [];
      let calls = 0;
      const plan = await rankDecisionV7(context, { onObservation: async event => { observations.push(event); }, modelCall: async (prompt, options) => {
        calls++;
        const wire = JSON.parse(prompt);
        expect(wire.candidateIds).toHaveLength(45);
        expect(wire.candidates.flatMap((card: { contributions: unknown[] }) => card.contributions)).toHaveLength(81);
        expect(wire.studentGoalOptions).toEqual([{ index: 0, text: goal }]);
        expect(wire.outputFormat.assessments).toContainEqual(expect.objectContaining({ fit: expect.objectContaining({ goalIndex: 0, studentBasisIndices: [] }) }));
        expect(wire.candidates.find((card: { itemId: string }) => card.itemId === selected).supportingTaskFacts)
          .toContainEqual(expect.objectContaining({ id: selectedFact, status: "historical" }));
        expect(wire.profile.facts).toContainEqual(expect.objectContaining({ originalText: noLab.originalText }));
        expect(options).toMatchObject({ maxTokens: 8192, maxAttempts: 1 });
        const codes = Object.fromEntries((wire.candidateIds as string[]).filter(id => id !== selected).map(id => [id, "L"]));
        const raw = { profileRevision: wire.outputFormat.profileRevision, catalogVersion: wire.outputFormat.catalogVersion,
          shortfallReason: null, assessments: (wire.candidateIds as string[]).map(itemId => ({ itemId, fit: itemId === selected ? {
            roleIndex: 0, taskStepIndex: 0, goalIndex: 0, studentBasisIndices: [], competitionFactIds: [selectedFact], matchKind: "direct",
            rationale: "从作者模型说明了解预测置信和局限的区别。",
          } : null })), ...(status === "absent" ? {} : { rankDiagnostics: status === "valid" ? { codes } : { codes: { ...codes, [selected]: "L" } } }) };
        const original = structuredClone(raw);
        const parsed = options.schema!.safeParse(raw);
        expect(parsed.success).toBe(true);
        expect(raw).toEqual(original);
        if (!parsed.success) throw new Error("unexpected_core_rank_schema_failure");
        return { ok: true, data: parsed.data, model: "deepseek-flash", upstreamAttempted: true, httpStatus: 200, finishReason: "stop", durationMs: 1, attempts: 1 };
      } });
      expect(calls).toBe(1);
      expect(observations.filter(event => (event as { data?: { source?: string } }).data?.source === "rank_diagnostics"))
        .toEqual([expect.objectContaining({ stage: "v7.audit", data: expect.objectContaining({ source: "rank_diagnostics", status }) })]);
      expect(plan.recommendations).toEqual([expect.objectContaining({ itemId: record.recordId, rankGoalIndex: 0, rankRoleIndex: 0, rankTaskStepIndex: 0,
        reasons: [expect.objectContaining({ studentFactIds: [], competitionFactIds: [atom.id] })] })]);
      expect(plan).not.toHaveProperty("rankDiagnostics");
      plans.push(plan);
    }
    expect(plans[0]).toEqual(plans[1]);
    expect(plans[0]).toEqual(plans[2]);
    expect(context).toEqual(snapshot);
  });
});
