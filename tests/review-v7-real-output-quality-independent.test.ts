import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readPublicDiagnosticFixture } from "./fixtures/v7-public-diagnostics";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { matchPlanSchema } from "@/lib/competitions/v6/contracts";
import { isDecisionEvidenceFact } from "@/lib/competitions/v6/evidence";
import { createModelIdentifierCodec } from "@/lib/competitions/v6/model-identifiers";
import { buildDecisionContextV7, validateDecisionReportV7, validateMatchPlanV7 } from "@/lib/competitions/v7/model";

const root = process.cwd(), sourceDir = "artifacts/continuation-v7-20261109/explanation-diagnostic-01";
const read = (file: string) => readPublicDiagnosticFixture(`${sourceDir}/${file}`);
const input = read("input.json"), result = read("result.json"), registration = read("registration.json");
const context = buildDecisionContextV7(input.originalProfile, { profile: input.profile, records: input.records, now: new Date(registration.asOf) });
const report = result.report;
const codec = createModelIdentifierCodec({ candidates: context.candidates.map(({ record }) => record.recordId), series: context.candidates.map(({ record }) => record.seriesId),
  facts: context.candidates.flatMap(({ record }) => record.facts.map(fact => fact.id)), students: context.profile.facts.map(fact => fact.id) });
const raw = JSON.parse(result.calls[0].saved.receipt.content);
const decoded = codec.decode(Object.fromEntries(Object.entries(raw).filter(([key]) => key !== "type")));
const explanation = matchPlanSchema.parse(decoded);
const outputDir = process.env.SAITU_V7_INDEPENDENT_REVIEW_ARTIFACT_DIR ? path.resolve(process.env.SAITU_V7_INDEPENDENT_REVIEW_ARTIFACT_DIR) : null;
const checks: unknown[] = [];
let newHttpCalls = 0;
beforeEach(() => { vi.stubGlobal("fetch", vi.fn(() => { newHttpCalls++; throw new Error("new_http_forbidden_in_readonly_quality_review"); })); });
afterEach(() => { expect(newHttpCalls).toBe(0); expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
afterAll(() => {
  if (!outputDir) return;
  if (existsSync(path.join(outputDir, "validator-results.json"))) throw new Error("independent_review_output_already_exists");
  mkdirSync(outputDir, { recursive: true });
  const files = ["src/lib/competitions/v7/model.ts", "src/lib/competitions/v6/contracts.ts", "src/lib/competitions/v6/validation.ts",
    "src/lib/competitions/v6/model-identifiers.ts", "tests/review-v7-real-output-quality-independent.test.ts",
    ...["input.json", "result.json", "registration.json"].map(file => `${sourceDir}/${file}`)].map(file => ({ path: file,
      sha256: createHash("sha256").update(readFileSync(path.join(root, file))).digest("hex") }));
  writeFileSync(path.join(outputDir, "validator-results.json"), JSON.stringify({ schemaVersion: "saitu.real-output-independent-validator.v1", files, checks,
    newHttpCalls, newPaidCalls: 0, notAcceptanceEvidence: true, semanticFactualReviewSeparate: true,
    limitations: ["Validator/source identity checks do not prove that a cited fact supports every word of a claim.",
      "This does not assess ranking quality, verify student truthfulness, re-audit live official websites, or establish full-pipeline/browser performance."] }, null, 2) + "\n", { flag: "wx" });
});

describe("independent read-only checks of real explanation-diagnostic-01 output", () => {
  it("revalidates the actual complete report and model explanation with production validators", () => {
    const planValidation = validateMatchPlanV7(explanation, context), reportValidation = validateDecisionReportV7(report, context);
    expect(planValidation).toEqual({ ok: true, issues: [] }); expect(reportValidation).toEqual({ ok: true, issues: [] });
    checks.push({ label: "production_validators", planValidation, reportValidation });
  });

  it("preserves all ten identities and exact model order, new reasons and role claims", () => {
    const ids = result.plan.recommendations.map((item: { itemId: string }) => item.itemId);
    expect(report.recommendations).toHaveLength(10); expect(explanation.recommendations.map(item => item.itemId)).toEqual(ids);
    expect(report.recommendations.map((item: { itemId: string }) => item.itemId)).toEqual(ids);
    for (const [index, item] of explanation.recommendations.entries()) {
      const output = report.recommendations[index], record = context.records.find(record => record.recordId === item.itemId)!;
      expect(output).toMatchObject({ rank: index + 1, itemId: record.recordId, seriesId: record.seriesId, name: record.name, trackLabel: record.track.name, edition: record.edition });
      expect(output.reasons).toEqual(item.reasons); expect(output.currentRole).toEqual(item.roleReason);
      expect(context.candidates.find(candidate => candidate.record.recordId === item.itemId)!.conditions.every(condition => output.eligibilityNotes.includes(condition))).toBe(true);
    }
    expect(new Set(report.recommendations.map((item: { seriesId: string }) => item.seriesId)).size).toBe(10);
    checks.push({ label: "identity_order_model_claim_projection_and_conditions", count: 10, exact: true });
  });

  it("binds the twenty actual review verdicts to precisely the twenty new reason and role claims", () => {
    const expected = explanation.recommendations.flatMap(item => [...item.reasons.map((_reason, index) => `${item.itemId}.reason.${index}`), `${item.itemId}.role`]);
    const review = JSON.parse(result.calls[1].saved.receipt.content);
    expect(expected).toHaveLength(20); expect(review.checks).toHaveLength(20);
    expect(new Set(review.checks.map((check: { key: string }) => check.key)).size).toBe(20);
    expect(review.checks.map((check: { key: string }) => check.key).sort()).toEqual([...expected].sort());
    expect(review.checks.every((check: { supported: boolean }) => check.supported === true)).toBe(true);
    expect(report.trace.supportChecks).toBe(20); expect(report.trace.unsupportedChecks).toBe(0);
    checks.push({ label: "twenty_model_review_verdict_bindings", keys: expected, allModelVerdictsTrue: true, independentSemanticApprovalNotImplied: true });
  });

  it("keeps every cited student fact active and every cited competition fact/source inside its own record", () => {
    let count = 0;
    for (const item of explanation.recommendations) {
      const record = context.records.find(record => record.recordId === item.itemId)!;
      for (const claim of [...item.reasons, item.roleReason!]) {
        count++;
        for (const id of claim.studentFactIds) {
          const student = context.profile.facts.find(fact => fact.id === id)!;
          expect(student.confirmed).toBe(true); expect(student.state).toBe("affirmed");
          expect(student.originalText?.trim()).toBeTruthy(); expect(context.profile.retractedFactIds).not.toContain(id);
        }
        for (const id of claim.competitionFactIds) {
          const fact = record.facts.find(fact => fact.id === id)!;
          expect(fact).toBeDefined(); expect(isDecisionEvidenceFact(record, fact)).toBe(true);
          expect(fact.scope.trim()).toBeTruthy(); expect(fact.sourceIds.length).toBeGreaterThan(0);
          for (const sourceId of fact.sourceIds) {
            const source = record.sources.find(source => source.id === sourceId)!;
            expect(source).toBeDefined(); expect(source.accessStatus).toBe("body_read"); expect(source.integrity).toBe("consistent");
          }
        }
      }
    }
    expect(count).toBe(20); checks.push({ label: "active_self_reports_and_local_fact_source_resolution", claims: count, unresolvedReferences: 0 });
  });
});
