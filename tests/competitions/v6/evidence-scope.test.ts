import "./mock-publication-boundary";
import { describe, expect, it, vi } from "vitest";
import {
  buildDecisionContext,
  buildRuleMatchPlan,
  assembleDecisionReport,
} from "@/lib/competitions/v6/engine";
import { isDecisionEvidenceFact } from "@/lib/competitions/v6/evidence";
import {
  validateMatchPlan,
  validateDecisionReport,
} from "@/lib/competitions/v6/validation";
import { runDecisionRecommendation, modelEvidenceRegistry } from "@/lib/competitions/v6/model";
import { withProductObservation } from "@/lib/ai/product-observation";
import { createHash } from "node:crypto";
import { createModelIdentifierCodec } from "@/lib/competitions/v6/model-identifiers";
import { expandMatchingTables } from "@/lib/competitions/v6/model-match-tables";
import { expandCandidateEvidence } from "@/lib/competitions/v6/model-evidence-pack";
import { student } from "./decision-fixtures";

const now = new Date("2026-11-05T08:00:00Z");
describe("scoped recommendation evidence", () => {
  it.each([
    [
      "china-college-computer-design",
      "china-college-computer-design:legacy:fact:eligibility",
    ],
    [
      "china-college-computer-design",
      "china-college-computer-design:v2:deep.requirement.0",
    ],
    [
      "national-advertising-art",
      "national-advertising-art:v2:deep.requirement.1",
    ],
  ])("rejects pending or case-only evidence for %s", (seriesId, factId) => {
    const context = buildDecisionContext(student(), { now });
    const candidate = context.candidates.find(
      (c) => c.record.seriesId === seriesId,
    )!;
    // The researched catalog may replace a pilot; preserve this attack case
    // explicitly instead of requiring that obsolete pilot evidence remain live.
    if (!candidate.record.facts.some(f => f.id === factId)) {
      candidate.record = structuredClone(candidate.record);
      const pending = factId.includes(":legacy:");
      candidate.record.facts.push({...candidate.record.facts[0],id:factId,
        field:pending?"eligibility":"deep.requirement.1",status:pending?"pending_review":"verified_current"});
    }
    const fact = candidate.record.facts.find((f) => f.id === factId)!;
    expect(fact).toBeDefined();
    expect(isDecisionEvidenceFact(candidate.record, fact)).toBe(false);
    // Scope validation must not depend on this series retaining a particular ranking.
    context.candidates=[candidate,...context.candidates.filter(c=>c!==candidate)];
    const plan = buildRuleMatchPlan(context);
    const item = plan.recommendations.find(
      (r) => r.itemId === candidate.record.recordId,
    )!;
    item.reasons = [
      {
        text: "错误地把未核验或子命题要求写成全赛道正式规则。",
        basis: "official",
        studentFactIds: [],
        competitionFactIds: [factId],
        conditions: [],
      },
    ];
    expect(validateMatchPlan(plan, context).ok).toBe(false);
    expect(
      validateDecisionReport(assembleDecisionReport(context, plan), context).ok,
    ).toBe(false);
  });
  it("sends only scoped verified facts in the detailed model packet", async () => {
    let inspected = false;
    const profile = student();
    const { selectPublishedDecisionRecords } = await vi.importActual<typeof import("@/lib/competitions/v6/published-records")>("@/lib/competitions/v6/published-records");
    // Inspect the actual runtime publication pool, not the larger unpublished
    // structural pool permitted only by this suite's attack-fixture mock.
    const actualRecords = selectPublishedDecisionRecords();
    const context = buildDecisionContext(profile, { now, records: actualRecords });
    const attacked = context.candidates.find(candidate => candidate.record.facts.some(fact => fact.kind === "official_fact" && isDecisionEvidenceFact(candidate.record, fact)))!;
    attacked.record = structuredClone(attacked.record);
    const supported = attacked.record.facts.find(fact => fact.kind === "official_fact" && isDecisionEvidenceFact(attacked.record, fact))!;
    const badId = `${supported.id}:unavailable-source-probe`;
    const sourceMap = new Map(supported.sourceIds.map(id => [id, `${id}:unavailable-source-probe`]));
    const clonedSources = supported.sourceIds.map(id => ({ ...attacked.record.sources.find(source => source.id === id)!, id: sourceMap.get(id)! }));
    attacked.record.sources.push(...clonedSources);
    const bad = { ...structuredClone(supported), id: badId, sourceIds: supported.sourceIds.map(id => sourceMap.get(id)!),
      ...(supported.sourceScopes ? { sourceScopes: supported.sourceScopes.map(binding => ({ ...binding, sourceId: sourceMap.get(binding.sourceId)! })) } : {}) };
    attacked.record.facts.push(bad);
    expect(isDecisionEvidenceFact(attacked.record, bad)).toBe(true);
    for (const source of clonedSources) source.accessStatus = "unavailable";
    expect(isDecisionEvidenceFact(attacked.record, bad)).toBe(false);
    const codec = createModelIdentifierCodec({candidates:context.candidates.map(c=>c.record.recordId),series:context.candidates.map(c=>c.record.seriesId),facts:context.candidates.flatMap(c=>c.record.facts.map(f=>f.id)),students:context.profile.facts.filter(f=>f.confirmed&&f.state!=="unknown"&&f.state!=="retracted"&&!context.profile.retractedFactIds.includes(f.id)).map(f=>f.id)});
    const stages: string[] = [];
    let inspectionError: unknown;
    const events: {type:string;details:Record<string,unknown>}[]=[];
    const report = await withProductObservation({observer:event=>{events.push(event);}},()=>runDecisionRecommendation(profile, {
      now,
      context,
      method: "llm", legacyPlanTransport: true,
      modelCall: async (prompt, options) => {
        try {
        stages.push(options.promptVersion!.split(".").at(-1)!);
        const input = codec.decode(expandCandidateEvidence(expandMatchingTables(JSON.parse(prompt)))) as {firstStageEvidenceMode:string;candidates:{itemId:string;eligibility:string;conditions:string[]}[]};
        expect(input.firstStageEvidenceMode).toBe("business_decision_table");
        expect(input.candidates).toHaveLength(context.candidates.length);
        const registry=modelEvidenceRegistry(context);
        const expectedDictionarySha=createHash("sha256").update(JSON.stringify({facts:registry.dictionary,modules:registry.moduleDictionary})).digest("hex");
        expect(events.find(event=>event.type==="decision_model_invocation")?.details.factDictionarySha256).toBe(expectedDictionarySha);
        expect(registry.dictionary).not.toHaveProperty(badId);
        let inspectedFacts = 0;
        for (const candidate of input.candidates) {
          const original = context.candidates.find(
            (c) => c.record.recordId === candidate.itemId,
          )!;
          expect(candidate.eligibility).toBe(original.eligibility);
          expect(candidate.conditions).toEqual(original.conditions);
          // Rank-only first-stage business values have no evidence locator graph.
          // The exact emitted registry digest binds the full scoped facts that
          // independent support verification retrieves after a selection.
          expect(candidate).not.toHaveProperty("facts");
          const facts=original.record.facts.filter(fact=>isDecisionEvidenceFact(original.record,fact)).map(fact=>registry.dictionary[fact.id]);
          expect(facts.map(fact=>fact.id).sort()).toEqual(original.record.facts.filter(fact => isDecisionEvidenceFact(original.record, fact)).map(fact => fact.id).sort());
          for (const fact of facts) {
            const originalFact = original.record.facts.find(item => item.id === fact.id)!;
            expect(
              isDecisionEvidenceFact(
                original.record,
                originalFact,
              ),
            ).toBe(true);
            expect(fact).toMatchObject({field:originalFact.field,kind:originalFact.kind,status:originalFact.status,scope:originalFact.scope,text:originalFact.text});
            inspectedFacts++;
          }
        }
        expect(inspectedFacts).toBeGreaterThan(0);
        inspected = true;
        return {
          ok: false,
          reason: "empty_content",
          model: "test",
          upstreamAttempted: false,
        };
        } catch (error) { inspectionError = error; throw error; }
      },
    }));
    if (inspectionError) throw inspectionError;
    expect(inspected).toBe(true);
    expect(stages).toEqual(["match"]);
    expect(report.fallback.used).toBe(true);
  });
});
