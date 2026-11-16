import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildDecisionContextV7, rankDecisionV7 } from "@/lib/competitions/v7/model";
import { createRankVersionTransportV7 } from "@/lib/competitions/v7/rank-version-transport";
import { student, syntheticRecord } from "../v6/decision-fixtures";
import { echoRankWireHeaders, rankFixtureAssessmentReply, rankFixtureEvidence } from "./rank-wire-fixture";

const success = (data: unknown) => ({ ok: true as const, data, model: "deepseek-flash", upstreamAttempted: true as const,
  httpStatus: 200, finishReason: "stop", attempts: 1, durationMs: 1 });
function fixture() {
  const context = buildDecisionContextV7(student({ skills: ["data-analysis"], confirmedFields: ["stage", "skills"] }), { records: [syntheticRecord(1)] });
  const body = { recommendations: [{ itemId: context.candidates[0].record.recordId, roleIndex: 0, rationale: "用自报能力清理数据并核对处理决策。", ...rankFixtureEvidence(context, context.candidates[0].record.recordId) }],
    shortfallReason: "冻结测试范围内有一条具体关联。" };
  const headers = { profileRevision: context.profile.revision, catalogVersion: context.catalogVersion };
  return { context, body, headers };
}
beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => { throw new Error("rank_alias_test_forbids_http"); })));
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe("strict rank version transport", () => {
  it("uses stable scoped short aliases, restores true headers, and leaves text and evidence intact", async () => {
    const { context, body, headers } = fixture(), prompts: string[] = [];
    for (const requestId of ["first-rank", "second-rank"]) {
      const plan = await rankDecisionV7(context, { requestId, modelCall: async (prompt, options) => {
        prompts.push(prompt);
        const input = JSON.parse(prompt), raw = rankFixtureAssessmentReply(context, echoRankWireHeaders(prompt, body));
        expect(raw.profileRevision).toMatch(/^RP[a-f0-9]{8}$/);
        expect(raw.catalogVersion).toMatch(/^RC[a-f0-9]{8}$/);
        expect(input.rankVersionBindingSha256).toMatch(/^[a-f0-9]{64}$/);
        expect(input.profile.revision).toBe(raw.profileRevision);
        expect(prompt).not.toContain(headers.profileRevision);
        expect(prompt).not.toContain(headers.catalogVersion);
        expect(options.schema!.safeParse(raw).success).toBe(true);
        return success(raw);
      } });
      expect(plan).toMatchObject(headers);
      expect(plan.recommendations[0].itemId).toBe(body.recommendations[0].itemId);
      expect(plan.recommendations[0].reasons[0].text).toBe(body.recommendations[0].rationale);
    }
    expect(prompts[0]).toBe(prompts[1]);
    const marker = `${headers.profileRevision} ${headers.catalogVersion}`;
    const transport = createRankVersionTransportV7(headers, { promptVersion: "test", effortPolicySha256: "a".repeat(64), repair: false });
    expect(transport.encodeRequest({ ...headers, outputFormat: headers, profile: { revision: headers.profileRevision, originalText: marker }, taskEvidence: marker }, false)).toMatchObject({
      profile: { originalText: marker }, taskEvidence: marker,
    });
  });

  it.each(["long-current", "long-old", "typo", "swapped", "missing-one", "missing-both", "other-catalog"])("rejects %s without a fresh full ranking", async defect => {
    const { context, body, headers } = fixture();
    let previousCatalogAlias: string | undefined;
    if (defect === "other-catalog") {
      await rankDecisionV7({ ...context, catalogVersion: "v7-unrelated-catalog" }, { modelCall: async prompt => {
        const raw = rankFixtureAssessmentReply(context, echoRankWireHeaders(prompt, body)); previousCatalogAlias = raw.catalogVersion; return success(raw);
      } });
    }
    const modelCall = vi.fn(async (prompt: string) => {
      const raw = rankFixtureAssessmentReply(context, echoRankWireHeaders(prompt, body));
      if (defect === "long-current") raw.catalogVersion = headers.catalogVersion;
      if (defect === "long-old") raw.catalogVersion = "v7-old-real-version";
      if (defect === "typo") raw.catalogVersion = raw.catalogVersion.slice(0, -1);
      if (defect === "swapped") [raw.profileRevision, raw.catalogVersion] = [raw.catalogVersion, raw.profileRevision];
      if (defect === "missing-one" || defect === "missing-both") Reflect.deleteProperty(raw, "catalogVersion");
      if (defect === "missing-both") Reflect.deleteProperty(raw, "profileRevision");
      if (defect === "other-catalog") raw.catalogVersion = previousCatalogAlias!;
      // A seam that skips the actual provider schema still cannot bypass
      // the second check or become evidence for an envelope repair.
      return success(raw);
    });
    await expect(rankDecisionV7(context, { modelCall })).rejects.toThrow("invalid_output");
    expect(modelCall).toHaveBeenCalledTimes(1);
  });
});
