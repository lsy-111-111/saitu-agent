import "./mock-publication-boundary";
import { describe, expect, it } from "vitest";
import { createStudentProfile } from "@/lib/competitions/v6/profile";
import {
  assembleDecisionReport,
  buildDecisionContext,
  buildRuleDecisionReport,
  buildRuleMatchPlan,
} from "@/lib/competitions/v6/engine";
import {
  validateDecisionReport,
  validateMatchPlan,
} from "@/lib/competitions/v6/validation";
import { describeDecisionChanges } from "@/lib/competitions/v6/contracts";
import { student, syntheticCatalog } from "./decision-fixtures";

const now = new Date("2026-11-05T08:00:00Z");
const opts = { records: syntheticCatalog, now };
describe("v6 evidence decision behavior", () => {
  it("does not sort on an unconfirmed first goal or reuse it after choosing exploration", () => {
    const base = student({
      goals: ["award", "portfolio"],
      confirmedFields: ["stage", "goals"],
      decisionContext: { goalIntent: "portfolio" },
    });
    const reversed = {
      ...base,
      goals: ["portfolio", "award"] as typeof base.goals,
    };
    const scores = (profile: typeof base) =>
      buildDecisionContext(profile, { now }).candidates.map((c) => [
        c.record.recordId,
        c.score?.decisionFit?.lower,
      ]);
    expect(scores(base)).toEqual(scores(reversed));
    expect(
      scores({
        ...base,
        decisionContext: { goalIntent: "explore", goalResolution: "confirmed" },
      }),
    ).toEqual(
      scores({
        ...base,
        goals: [],
        confirmedFields: ["stage"],
        decisionContext: { goalIntent: "explore", goalResolution: "confirmed" },
      }),
    );
    expect(
      createStudentProfile(
        student({
          goals: ["award", "portfolio"],
          confirmedFields: ["stage", "goals"],
          decisionContext: { primaryGoal: "portfolio" },
        }),
      ).tradeoffStatus,
    ).toBe("confirmed");
  });
  it("does not turn legacy defaults into personal facts", () => {
    const p = createStudentProfile(student());
    expect(p.facts.map((f) => f.field)).toEqual(["stage"]);
    expect(p.unknownFields).toEqual(
      expect.arrayContaining([
        "weeklyCommitment",
        "teamStatus",
        "experienceLevel",
      ]),
    );
  });
  it("gives zero-experience students conditional exploration without an ability deficit", () => {
    const report = buildRuleDecisionReport(student(), opts);
    expect(report.recommendations).toHaveLength(6);
    expect(report.summary.focusItemIds).toEqual(report.recommendations.slice(0, 3).map(item => item.itemId));
    expect(
      report.recommendations.every((r) => r.preparation === "explore"),
    ).toBe(true);
    expect(JSON.stringify(report)).not.toContain("能力不足");
    expect(
      validateDecisionReport(report, buildDecisionContext(student(), opts)),
    ).toEqual({ ok: true, issues: [] });
  });
  it("requires explicit goal resolution and preserves per-experience contribution", () => {
    const p = createStudentProfile(
      student({
        decisionContext: {
          goalIntent: "portfolio",
          goalResolution: "undecided",
          experiences: [
            {
              id: "one",
              task: "小组项目中制作展示页",
              contribution: "assisted",
              completion: "delivered",
              challenge: "向队友确认数据来源",
              confirmed: true,
            },
            {
              id: "two",
              task: "清洗课程作业数据",
              contribution: "independent",
              completion: "draft",
              challenge: "处理重复数据",
              confirmed: true,
            },
          ],
        },
      }),
    );
    expect(p.primaryGoal).toBeNull();
    expect(
      p.facts.find((f) => f.field === "experience.1.contribution")?.value,
    ).toBe("assisted");
    expect(
      p.facts.find((f) => f.field === "experience.2.contribution")?.value,
    ).toBe("independent");
    expect(
      createStudentProfile(
        student({ decisionContext: { goalIntent: "award" } }),
      ).primaryGoal,
    ).toBeNull();
  });
  it("excludes unconfirmed experiences from model evidence", () => {
    const p = createStudentProfile(
      student({
        decisionContext: {
          experiences: [
            {
              id: "one",
              task: "声称独立开发网站",
              contribution: "independent",
              completion: "delivered",
              challenge: "",
              confirmed: false,
            },
          ],
        },
      }),
    );
    expect(p.facts.some((f) => f.field.startsWith("experience."))).toBe(false);
  });
  it("recomputes revision, budget conditions and workload after corrections", () => {
    const before = buildRuleDecisionReport(
      student({
        confirmedFields: ["stage", "weeklyCommitment"],
        weeklyCommitment: "5-10",
      }),
      opts,
    );
    const after = buildRuleDecisionReport(
      student({
        confirmedFields: ["stage", "weeklyCommitment"],
        weeklyCommitment: "under-5",
        decisionContext: {
          budget: { range: "zero", maximumYuan: 0, scope: "personal" },
        },
      }),
      opts,
    );
    expect(before.profile.revision).not.toBe(after.profile.revision);
    expect(after.recommendations[0].nextStep.text).toContain("先缩小范围");
    expect(after.recommendations[0].eligibilityNotes.join()).toContain(
      "核实总费用为零",
    );
    expect(describeDecisionChanges(before, after).join()).toContain(
      "已替换或撤销",
    );
  });
  it("never fills a shortage with L1 records", () => {
    const records = syntheticCatalog.map((r, i) =>
      i < 2 ? r : { ...r, contentTier: "L1" as const },
    );
    const report = buildRuleDecisionReport(student(), { records, now });
    expect(report.recommendations).toHaveLength(2);
    expect(report.shortlistShortfallReason).toBeTruthy();
  });
  it("deduplicates series and separates historical registration from qualification", () => {
    const records = [
      ...syntheticCatalog,
      {
        ...syntheticCatalog[0],
        recordId: "other-track",
        track: { id: "other", name: "其他任务" },
      },
    ];
    const report = buildRuleDecisionReport(student(), { records, now });
    expect(new Set(report.recommendations.map((r) => r.seriesId)).size).toBe(
      report.recommendations.length,
    );
    expect(
      report.recommendations.every(
        (r) =>
          r.registration.status === "historical" &&
          r.eligibilityStatus === "unknown",
      ),
    ).toBe(true);
  });
  it("rejects stale revisions, missing evidence, duplicate series and unexplained shortfalls", () => {
    const context = buildDecisionContext(student(), opts);
    const plan = buildRuleMatchPlan(context);
    expect(
      validateMatchPlan({ ...plan, profileRevision: "old" }, context).ok,
    ).toBe(false);
    expect(
      validateMatchPlan(
        {
          ...plan,
          recommendations: [plan.recommendations[0], plan.recommendations[0]],
        },
        context,
      ).ok,
    ).toBe(false);
    expect(
      validateMatchPlan(
        { ...plan, recommendations: [], shortfallReason: null },
        context,
      ).ok,
    ).toBe(false);
  });
  it("checks sources in summaries, benefits, comparisons and not-recommended reasons", () => {
    const context = buildDecisionContext(student(), opts);
    const original = assembleDecisionReport(
      context,
      buildRuleMatchPlan(context),
    );
    const mutations = [
      (r: typeof original) => {
        r.summary.focusItemIds = ["fake"];
      },
      (r: typeof original) => {
        r.recommendations[0].values[0].claim.competitionFactIds = ["fake"];
      },
      (r: typeof original) => {
        r.comparisons[0].tradeoff.competitionFactIds = ["fake"];
      },
      (r: typeof original) => {
        r.candidateAudit[0].reason.studentFactIds = ["fake"];
      },
      (r: typeof original) => {
        r.recommendations[0].sources[0].url = "https://example.org/changed";
      },
    ];
    for (const mutate of mutations) {
      const report = structuredClone(original);
      mutate(report);
      expect(validateDecisionReport(report, context).ok).toBe(false);
    }
  });
  it("rejects facts retracted only in the top-level list", () => {
    const context = buildDecisionContext(
      student({ confirmedFields: ["stage", "interests"], interests: ["data"] }),
      opts,
    );
    const plan = buildRuleMatchPlan(context);
    context.profile.retractedFactIds.push(
      context.profile.facts.find((f) => f.field === "interests")!.id,
    );
    expect(validateMatchPlan(plan, context).ok).toBe(false);
  });
});
