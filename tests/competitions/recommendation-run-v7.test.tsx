import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DecisionRunReport } from "@/components/competitions/recommend/DecisionRunReport";
import { CompactDecisionDetails } from "@/components/competitions/recommend/CompactDecisionDetails";
import { mergeRecommendationRun } from "@/components/competitions/recommend/useRecommendationRunV7";
import { readSavedDecisions, saveSelectedRunDecisions } from "@/lib/competitions/v6/saved-decisions";
import { recommendationRunSchema } from "@/lib/competitions/v7/contracts";
import { completedRunFixture, legacyTenRunFixture, nextRunFixtureId, recommendationRunFixture, runItemDetail, topFiveRunFixture } from "../fixtures/recommendation-run-v7";
import { SYNTHETIC_COMPACT_REASONS } from "../fixtures/compact-long-reasons";

describe("v7 list delivery and recovery boundaries", () => {
  beforeAll(() => vi.stubGlobal("React", React));
  afterAll(() => vi.unstubAllGlobals());

  it("renders a useful list and official links before any detail exists", () => {
    const run = recommendationRunFixture();
    const html = renderToStaticMarkup(<DecisionRunReport run={run} displayRun={run} pollError="" onRetry={vi.fn()} turns={[]} onEdit={vi.fn()} />);
    expect(html.match(/data-testid="recommendation-run-item"/g)).toHaveLength(3);
    expect(html).toContain('href="https://official.example.org/entry-0"');
    expect(html).not.toContain("详情中的专属匹配理由");
    expect(html).not.toContain("资格初筛通过");
    expect(html).not.toContain("报名窗口开放");
    expect(html).toContain("参赛资格和开赛时间请自行核查官网");
    expect(html).toContain("当前显示 3 项推荐");
    expect(html).not.toContain(run.shortfallReason!);
  });

  it("rejects a stale version or changed identity while retaining delivered lists and detail", () => {
    const ready = completedRunFixture();
    for (const patch of [{ resultVersion: 1 }, { decisionToken: "another-token-that-is-long-enough-for-v7" }, { profileRevision: "foreign" }, { catalogVersion: "foreign" }, { profileId: "foreign" }]) {
      expect(mergeRecommendationRun(ready, { ...ready, ...patch })).toBeNull();
    }
    expect(mergeRecommendationRun(ready, { ...ready, items: [], status: "failed", resultVersion: 4 })?.items).toEqual(ready.items);
    const pendingAgain = recommendationRunFixture({ resultVersion: 4 });
    const merged = mergeRecommendationRun(ready, pendingAgain);
    expect(merged?.items[0].detail).toEqual(ready.items[0].detail);
    expect(merged?.items[0].detailStatus).toBe("ready");
    const next = recommendationRunFixture({ runId: nextRunFixtureId, items: [] });
    expect(mergeRecommendationRun(ready, next)).toEqual(next);
  });

  it("keeps original submission, expiry and persisted deadlines fixed across poll updates", () => {
    const run = recommendationRunFixture({ rankDeadlineAt: new Date(Date.now() + 45_000).toISOString(), detailDeadlineAt: new Date(Date.now() + 90_000).toISOString() });
    for (const field of ["submittedAt", "expiresAt", "rankDeadlineAt", "detailDeadlineAt"] as const) {
      expect(mergeRecommendationRun(run, { ...run, resultVersion: 2, [field]: new Date(Date.parse(run[field]!) + 1000).toISOString() })).toBeNull();
    }
    expect(mergeRecommendationRun(run, { ...run, rankDeadlineAt: undefined })).toBeNull();
    const legacyCache = { ...run, rankDeadlineAt: undefined, detailDeadlineAt: undefined };
    expect(mergeRecommendationRun(legacyCache, run)?.rankDeadlineAt).toBe(run.rankDeadlineAt);
  });

  it("shows all five new recommendations with the real progress denominator and no hidden remainder", () => {
    const run = topFiveRunFixture();
    expect(recommendationRunSchema.safeParse(run).success).toBe(true);
    const html = renderToStaticMarkup(<DecisionRunReport run={run} displayRun={run} pollError="" onRetry={vi.fn()} turns={[]} onEdit={vi.fn()} />);
    expect(html.match(/data-testid="recommendation-run-item"/g)).toHaveLength(5);
    expect(html).toContain('data-total-items="5"');
    expect(html).toContain("详细说明已完成 0/5 项");
    expect(html).not.toContain("查看其余");
  });

  it("reads historical ten-item runs without applying the new count or deadlines and saves the tenth item", () => {
    const old = legacyTenRunFixture();
    const run = { ...old, status: "ready" as const, items: old.items.map((item, index) => ({ ...item, detailStatus: "ready" as const, detail: { ...runItemDetail(index), name: item.name } })) };
    expect(recommendationRunSchema.safeParse(run).success).toBe(true);
    const html = renderToStaticMarkup(<DecisionRunReport run={run} displayRun={run} pollError="" onRetry={vi.fn()} turns={[]} onEdit={vi.fn()} />);
    expect(html).toContain('data-total-items="10"');
    expect(html).toContain("查看其余 5 项");
    expect(mergeRecommendationRun(run, { ...run, resultVersion: 2 })?.items).toHaveLength(10);
    expect(mergeRecommendationRun(run, { ...run, resultVersion: 2 })?.detailDeadlineAt).toBe(old.detailDeadlineAt);
    const data = new Map<string, string>();
    const saved = saveSelectedRunDecisions(run, ["run-item-9"], { getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); } });
    expect(saved.ok).toBe(true);
    if (saved.ok) expect(saved.value.items[0].recommendation.itemId).toBe("run-item-9");
  });

  it("does not replace a run's frozen Top5 policy, targets or delivered order during polling", () => {
    const run = topFiveRunFixture();
    for (const patch of [{ implementationVersion: "foreign" }, { executionPolicy: { ...run.executionPolicy!, rankHardTimeoutMs: 70_000 } },
      { listTargetAt: new Date(Date.parse(run.listTargetAt!) + 1000).toISOString() }, { detailTargetAt: new Date(Date.parse(run.detailTargetAt!) + 1000).toISOString() },
      { items: run.items.slice(0, 4) }, { items: [...run.items].reverse() }]) {
      expect(mergeRecommendationRun(run, { ...run, ...patch, resultVersion: 2 })).toBeNull();
    }
  });
  it("freezes explicit unbounded limits and treats absent historical mode as finite during recovery", () => {
    const limits = { modelConcurrencyLimit: null, totalCallLimit: null, totalCostLimitMicros: null };
    const old = topFiveRunFixture(), current = topFiveRunFixture({ executionMode: "user-unbounded", executionLimits: limits });
    expect(mergeRecommendationRun(old, { ...old, executionMode: "finite", resultVersion: 2 })?.items).toHaveLength(5);
    expect(mergeRecommendationRun(old, { ...current, resultVersion: 2 })).toBeNull();
    expect(mergeRecommendationRun(current, { ...current, executionMode: "finite", resultVersion: 2 })).toBeNull();
    expect(mergeRecommendationRun(current, { ...current, executionLimits: undefined, resultVersion: 2 })).toBeNull();
    expect(mergeRecommendationRun(current, { ...current, resultVersion: 2 })?.executionLimits).toEqual(limits);
  });

  it("keeps reason text behind a closed details control and does not substitute source URLs for the official URL", () => {
    const run = completedRunFixture();
    const html = renderToStaticMarkup(<DecisionRunReport run={run} displayRun={run} pollError="" onRetry={vi.fn()} turns={[]} onEdit={vi.fn()} />);
    expect(html).toContain("详情中的专属匹配理由1");
    expect(html).toContain('href="https://official.example.org/entry-0"');
    expect(html).not.toContain('href="https://sources.example.org/task-0"');
    expect(html).not.toMatch(/<details[^>]*\sopen(?:[\s=>])/);
    expect(html.indexOf("查看比赛详情")).toBeLessThan(html.indexOf("详情中的专属匹配理由1"));
    expect(html).toContain("其他比赛仍可查看");
  });

  it("keeps the compact report focused on task, personal fit and two relevant values", () => {
    const run = completedRunFixture();
    const detail = run.items[0].detail!;
    detail.values = [
      { dimension: "portfolio", claim: { ...detail.coreTask, text: "整理可以回看的作品" } },
      { dimension: "learningFeedback", claim: { ...detail.coreTask, text: "通过反馈改进表达" } },
      { dimension: "recognition", claim: { ...detail.coreTask, text: "第三条收益不在首轮展示" } },
    ];
    const html = renderToStaticMarkup(<DecisionRunReport run={run} displayRun={run} pollError="" onRetry={vi.fn()} turns={[]} onEdit={vi.fn()} />);
    expect(html).toContain("具体做什么");
    expect(html).toContain("为什么适合你");
    expect(html).toContain("价值与收获");
    expect(html).toContain("修改回答");
    expect(html).toContain("追问乐乐");
    expect(html).not.toContain("第三条收益不在首轮展示");
    for (const removed of ["你现在可以从哪里开始", "想走得更远，需要补什么", "三个阶段的难度", "主要投入与机会成本", "先做这一件事", "比较两到三项，看清怎么取舍"]) expect(html).not.toContain(removed);
    expect(html.indexOf("修改回答")).toBeLessThan(html.indexOf("这些竞赛值得你了解"));
  });

  it.each(SYNTHETIC_COMPACT_REASONS)("renders a complete $length-character synthetic reason once per collapsed recommendation", sample => {
    expect(Array.from(sample.text).length).toBe(sample.length);
    const base = topFiveRunFixture();
    const run = { ...base, status: "ready" as const, items: base.items.map((item, index) => {
      const detail = runItemDetail(index);
      detail.reasons = [{ ...detail.reasons[0], text: sample.text }];
      detail.values = [detail.values[0], { dimension: "portfolio", claim: { ...detail.values[0].claim, text: "保留本人处理步骤与修改记录" } }];
      return { ...item, detailStatus: "ready" as const, detail };
    }) };
    const before = JSON.stringify(run);
    const html = renderToStaticMarkup(<DecisionRunReport run={run} displayRun={run} pollError="" onRetry={vi.fn()} turns={[]} onEdit={vi.fn()} />);
    expect(html.match(/data-testid="recommendation-run-item"/g)).toHaveLength(5);
    expect(html.match(/data-claim-field="reason"/g)).toHaveLength(5);
    expect(html.split(sample.text)).toHaveLength(6);
    expect(html.match(/data-claim-field="value"/g)).toHaveLength(10);
    expect(html).not.toMatch(/<details[^>]*\sopen(?:[\s=>])/);
    expect(html).toContain("追问乐乐");
    expect(html).toContain("修改回答");
    expect(JSON.stringify(run)).toBe(before);
  });

  it("reads a legacy synthetic 70–100-character reason without padding it to the new generation range", () => {
    const text = "你可结合自报的信息与给定分析任务，先整理一份本人练习记录，说明数据处理决策并检查结果是否可复现；这是未来可尝试的学习路径，资源和参加条件仍需核实，不把团队成果当作本人已有能力。";
    expect(Array.from(text).length).toBeGreaterThanOrEqual(70);
    expect(Array.from(text).length).toBeLessThanOrEqual(100);
    const old = legacyTenRunFixture(), detail = runItemDetail(0);
    detail.reasons = [{ ...detail.reasons[0], text }];
    const run = { ...old, status: "partial_ready" as const, items: old.items.map((item, index) => index === 0 ? { ...item, detailStatus: "ready" as const, detail } : item) };
    const before = JSON.stringify(run);
    expect(recommendationRunSchema.safeParse(run).success).toBe(true);
    const html = renderToStaticMarkup(<DecisionRunReport run={run} displayRun={run} pollError="" onRetry={vi.fn()} turns={[]} onEdit={vi.fn()} />);
    expect(html).toContain(text);
    expect(JSON.stringify(run)).toBe(before);
    expect(run.items[0].detail!.reasons[0].text).toBe(text);
  });

  it("keeps precise per-claim source links and critical conditions without a separate evidence panel", () => {
    const run = completedRunFixture(), detail = run.items[0].detail!;
    detail.coreTask = { ...detail.coreTask, basis: "official", competitionFactIds: ["task-fact"] };
    detail.evidenceFacts = [{ id: "task-fact", text: "官方任务说明", sourceIds: ["task-source-0"], scope: "2026测试赛道", status: "reviewed", kind: "task" }];
    detail.reasons[0].competitionFactIds = ["task-fact"];
    detail.reasons[0].conditions = ["材料使用许可仍需确认"];
    const html = renderToStaticMarkup(<DecisionRunReport run={run} displayRun={run} pollError="" onRetry={vi.fn()} turns={[]} onEdit={vi.fn()} />);
    expect(html).toContain('data-source-id="task-source-0"');
    expect(html).toContain('href="https://sources.example.org/task-0"');
    expect(html).toContain("材料使用许可仍需确认");
    expect(html).not.toContain("查看依据与条件");
  });

  it("preserves participant-report facts and names their sources without changing citations or the official entry", () => {
    const run = completedRunFixture(), detail = run.items[0].detail!;
    detail.reasons[0].competitionFactIds = ["author-report"];
    detail.evidenceFacts = [{ id: "author-report", text: "作者公开材料中的任务记录", sourceIds: ["author-source"], scope: "原作品页", status: "reviewed", kind: "participant_report" }];
    detail.sources = [{ id: "author-source", title: "高校发布的作者材料", url: "https://university.example.org/author-report", scope: "原作品页", checkedAt: null }];
    const parsed = recommendationRunSchema.parse(run);
    expect(parsed.items[0].detail!.evidenceFacts[0].kind).toBe("participant_report");
    const html = renderToStaticMarkup(<DecisionRunReport run={parsed} displayRun={parsed} pollError="" onRetry={vi.fn()} turns={[]} onEdit={vi.fn()} />);
    expect(html).toContain('aria-label="来源（含作者或参与者资料）：高校发布的作者材料（原作品页）"');
    expect(html).toContain('title="作者或参与者资料 · 高校发布的作者材料 · 原作品页"');
    expect(html).toContain('href="https://university.example.org/author-report"');
    expect(html).toContain('href="https://official.example.org/entry-0"');
    expect(html).toContain("[1]</a>");
    expect(detail.reasons[0].text).toBe(parsed.items[0].detail!.reasons[0].text);
  });

  it("labels mixed same-source evidence only for the claim that actually cites the participant fact", () => {
    const detail = runItemDetail(0), source = { id: "mixed-source", title: "原始资料标题", url: "https://university.example.org/works", scope: "同一作品范围", checkedAt: null };
    detail.sources = [source];
    detail.evidenceFacts = [
      { id: "official-atom", text: "核验的赛事要求", sourceIds: [source.id], scope: source.scope, status: "reviewed", kind: "official_fact" },
      { id: "author-atom", text: "作者说明的作品内容", sourceIds: [source.id], scope: source.scope, status: "reviewed", kind: "participant_report" },
    ];
    detail.coreTask.competitionFactIds = ["official-atom", "author-atom"];
    detail.reasons[0].competitionFactIds = ["official-atom"];
    const html = renderToStaticMarkup(<CompactDecisionDetails item={detail} />);
    const taskLink = html.match(/<a [^>]*data-claim-field="coreTask"[^>]*>/)?.[0];
    const reasonLink = html.match(/<a [^>]*data-claim-field="reason"[^>]*>/)?.[0];
    expect(taskLink).toContain("来源（含作者或参与者资料）");
    expect(reasonLink).toContain('aria-label="来源：原始资料标题（同一作品范围）"');
    expect(reasonLink).not.toContain("作者或参与者资料");
    expect(detail.sources).toEqual([source]);
  });

  it("shows concrete limits after the full reason and leaves general eligibility notes out of the compact card", () => {
    const detail = runItemDetail(0);
    const reason = `${SYNTHETIC_COMPACT_REASONS[1].text}可以先了解任务。`;
    const eligibility = "参赛提醒：正式提交仅面向在读研究生。";
    const budget = "预算提醒：已核实的个人费用超出你的预算。";
    const task = "任务边界：正式任务包含你希望避开的编程工作。";
    detail.reasons[0].text = reason;
    detail.eligibilityNotes.push(eligibility, budget, task, eligibility);
    const html = renderToStaticMarkup(<CompactDecisionDetails item={detail} />);
    expect(html).toContain(reason);
    expect(html).toContain(budget);
    expect(html).toContain(task);
    expect(html.split(eligibility)).toHaveLength(2);
    expect(html.indexOf(eligibility)).toBeGreaterThan(html.indexOf(reason));
    expect(html.indexOf(task)).toBeLessThan(html.indexOf("价值与收获"));
    expect(html).not.toContain("资格请核查官网");
  });

  it("keeps saved historical alias citations bound to their frozen source after another item reuses the alias", () => {
    const run = completedRunFixture(), detail = run.items[0].detail!, data = new Map<string, string>();
    detail.coreTask.competitionFactIds = ["@F0"];
    detail.reasons[0].competitionFactIds = ["@F0"];
    detail.evidenceFacts = [{ id: "@F0", text: "旧报告保存的作者材料", sourceIds: ["frozen-source"], scope: "旧届次作品", status: "historical", kind: "participant_report" }];
    detail.sources = [{ id: "frozen-source", title: "旧作者原文", url: "https://old.example.org/frozen-work", scope: "旧届次作品", checkedAt: null }];
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
    expect(saveSelectedRunDecisions(run, [detail.itemId], storage).ok).toBe(true);
    const saved = readSavedDecisions(storage);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const frozen = saved.value.items[0].recommendation, newer = structuredClone(frozen);
    newer.evidenceFacts[0].text = "新材料的同名短编号";
    newer.sources[0].url = "https://new.example.org/new-work";
    expect(renderToStaticMarkup(<CompactDecisionDetails item={newer} />)).toContain(newer.sources[0].url);
    const oldHtml = renderToStaticMarkup(<CompactDecisionDetails item={frozen} />);
    expect(oldHtml).toContain("https://old.example.org/frozen-work");
    expect(oldHtml).not.toContain("https://new.example.org/new-work");
    expect(frozen.evidenceFacts[0].kind).toBe("participant_report");
    expect(frozen.evidenceFacts[0].id).toBe("@F0");
    expect(saved.value.items[0].catalogVersion).toBe(run.catalogVersion);
  });

  it("shows a completed reasonable empty result without promising another list", () => {
    const run = recommendationRunFixture({ status: "ready", items: [], shortfallReason: "当前明确限制下没有合适候选。" });
    const html = renderToStaticMarkup(<DecisionRunReport run={run} displayRun={run} pollError="" onRetry={vi.fn()} turns={[]} onEdit={vi.fn()} />);
    expect(html).toContain("暂时没有合适的竞赛");
    expect(html).toContain("当前明确限制下没有合适候选");
    expect(html).not.toContain("正在为你整理竞赛名单");
  });

  it.each([1, 4])("shows only the delivered count for a completed %i-item shortlist without rewriting its stored explanation", count => {
    const originalReason = "其余候选都属于编程、商业或实验任务，与当前限制完全不符。";
    const base = topFiveRunFixture();
    const run = { ...base, status: "ready" as const, shortfallReason: originalReason,
      items: base.items.slice(0, count).map((item, index) => ({ ...item, detailStatus: "ready" as const, detail: runItemDetail(index) })) };
    const html = renderToStaticMarkup(<DecisionRunReport run={run} displayRun={run} pollError="" onRetry={vi.fn()} turns={[]} onEdit={vi.fn()} />);
    expect(html).toContain(`当前显示 ${count} 项推荐，可修改回答或向乐乐追问。`);
    expect(html).toContain("本次匹配已完成");
    expect(html).not.toContain(originalReason);
    expect(html).not.toContain("暂时没有合适的竞赛");
    expect(run.shortfallReason).toBe(originalReason);
  });

  it("does not present an unfinished or failed empty run as a completed empty recommendation", () => {
    for (const status of ["ranking", "failed"] as const) {
      const reason = "当前限制下没有候选。";
      const run = recommendationRunFixture({ status, items: [], shortfallReason: reason });
      const html = renderToStaticMarkup(<DecisionRunReport run={run} displayRun={run} pollError="" onRetry={vi.fn()} turns={[]} onEdit={vi.fn()} />);
      expect(html).not.toContain(reason);
      expect(html).not.toContain("暂时没有合适的竞赛");
      expect(html).not.toContain("本次匹配已完成");
      expect(html).toContain(status === "failed" ? "这次匹配暂未完成" : "正在为你整理竞赛名单");
    }
  });

  it("clears all provisional cards after an explicitly reviewed empty failure", () => {
    const initial = topFiveRunFixture();
    const failed = recommendationRunSchema.parse({ ...initial, status: "failed", resultVersion: initial.resultVersion + 1,
      items: [], shortfallReason: "本次未能生成可核实的推荐。", error: "NO_SUPPORTED_RECOMMENDATIONS" });
    expect(mergeRecommendationRun(initial, failed)).toEqual(failed);
    expect(mergeRecommendationRun(initial, { ...failed, resultVersion: initial.resultVersion })).toBeNull();
    expect(mergeRecommendationRun(initial, { ...failed, status: "ready", error: undefined })).toBeNull();
    const html = renderToStaticMarkup(<DecisionRunReport run={failed} displayRun={initial} pollError="" onRetry={vi.fn()} turns={[]} onEdit={vi.fn()} />);
    expect(html).toContain("本次未能生成可核实的推荐");
    expect(html).toContain('data-total-items="0"');
    expect(html).not.toContain('data-testid="recommendation-run-item"');
    expect(html).not.toContain("收藏所选");
    expect(html).not.toContain("本次匹配已完成");
  });

  it("saves only actively selected ready details and refuses to write pending selections", () => {
    const data = new Map<string, string>();
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: vi.fn((key: string, value: string) => { data.set(key, value); }) };
    expect(saveSelectedRunDecisions(recommendationRunFixture(), ["run-item-0"], storage).ok).toBe(false);
    expect(storage.setItem).not.toHaveBeenCalled();
    const result = saveSelectedRunDecisions(completedRunFixture(), ["run-item-1"], storage);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.items.map(item => item.recommendation.itemId)).toEqual(["run-item-1"]);
  });

  it("stops promising background updates after failure or expiry and keeps an explicit request retry", () => {
    const shown = recommendationRunFixture();
    for (const status of ["failed", "expired"] as const) {
      const run = { ...shown, status };
      const html = renderToStaticMarkup(<DecisionRunReport run={run} displayRun={run} pollError="" onRetry={vi.fn()} turns={[]} onEdit={vi.fn()} />);
      expect(html).toContain("本次更新已结束");
      expect(html).not.toContain("完成后会自动显示");
    }
    const replacement = recommendationRunFixture({ runId: nextRunFixtureId, status: "failed", items: [] });
    const html = renderToStaticMarkup(<DecisionRunReport run={replacement} displayRun={shown} pollError="提交失败" requestFailed onRetry={vi.fn()} turns={[]} onEdit={vi.fn()} />);
    expect(html).toContain("下方为上次推荐及详情，尚未按本次更正更新");
    expect(html).not.toContain("正在按更新后的画像重新匹配");
    expect(html).toContain("重试这次匹配");
  });
});
