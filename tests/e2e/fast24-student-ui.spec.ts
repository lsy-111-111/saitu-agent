import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { AI_EVIDENCE_EXPLANATION_CONSENT_VERSION } from "../../src/lib/ai/consent-disclosure";
import type { DecisionClaimV6, DecisionReportV6 } from "../../src/lib/competitions/v6/contracts";
import { recommendationRunSchema, type RecommendationRunV7 } from "../../src/lib/competitions/v7/contracts";
import { COMPETITION_CLARIFICATION_RESPONSE_VERSION } from "../../src/types/competition-recommendation";
import { majorFieldOptions, skillOptions, stageOptions } from "../../src/components/competitions/recommend/questionContent";
import { runItemDetail, topFiveRunFixture } from "../fixtures/recommendation-run-v7";
import plan from "./fixtures/fast24-student-plan.json";
import { checkFast24Comparison, checkFast24Details, checkFast24PageHealth, checkFast24SavedResult, fillFast24Chat, fillFast24StudentProfile, saveFast24FirstResult, type Fast24StudentCase } from "./fast24-student-journey";

// Browser plugin not available. Playwright uses F's shared app. Every /api
// request is intercepted before navigation, so this rehearsal cannot spend.
const key = "saitu.recommendationRun.v7";
const savedKey = "saitu.savedDecisionChoices.v6";
const cases = plan.cases as Fast24StudentCase[];
const claim = (text: string, patch: Partial<DecisionClaimV6> = {}): DecisionClaimV6 => ({ text, basis: "suggestion", studentFactIds: [], competitionFactIds: [], conditions: [], ...patch });

function initialRun(entry: Fast24StudentCase): RecommendationRunV7 {
  const runId = randomUUID(), profileId = `synthetic-${entry.caseId}`, revision = `${entry.caseId}-r1`;
  const facts: NonNullable<RecommendationRunV7["profile"]>["facts"] = [
    { id: "student-stage", field: "stage", value: stageOptions.find(option => option.label === entry.stage)!.value, label: entry.stage, state: "affirmed", confirmed: true, evidenceLevel: "self_report" },
    { id: "student-major", field: "majorFields", value: majorFieldOptions.find(option => option.label === entry.major)!.value, label: entry.major, state: "affirmed", confirmed: true, evidenceLevel: "self_report" },
  ];
  if (entry.skill) facts.push({ id: "student-skill", field: "skills", value: skillOptions.find(option => option.label === entry.skill)!.value, label: entry.skill, state: "affirmed", confirmed: true, evidenceLevel: "self_report" });
  if (entry.budget !== null) facts.push({ id: "student-budget", field: "budget.maximumYuan", value: entry.budget, label: `个人预算${entry.budget}元`, state: "affirmed", confirmed: true, evidenceLevel: "self_report" });
  if (entry.experience) facts.push({ id: "student-role", field: "experience.1.contribution", value: entry.experience.contribution, label: "本人独立完成课程任务", state: "affirmed", confirmed: true, evidenceLevel: "concrete_experience" });
  const run = topFiveRunFixture({ runId, profileId, profileRevision: revision, catalogVersion: "fast24-synthetic-ui-catalog-45",
    decisionToken: `synthetic-${runId}-opaque-token`,
    profile: { schemaVersion: "saitu.profile.v6", profileId, revision, facts, unknownFields: entry.undecided ? ["skills", "weeklyCommitment", "budget.maximumYuan"] : [],
      retractedFactIds: [], goals: [], primaryGoal: entry.undecided ? null : "explore", tradeoffStatus: entry.undecided ? "undecided" : "confirmed", mode: "quick" },
  });
  const count = entry.journey === "fewer" ? 2 : 5;
  run.items = run.items.slice(0, count).map((item, index) => ({ ...item, name: `${entry.discipline}模拟候选${index + 1}`, trackLabel: entry.subject }));
  run.shortfallReason = count < 5 ? "本次只有2项有充分依据，其他方向与当前任务限制不符，不补齐数量。" : null;
  return recommendationRunSchema.parse(run);
}

function completedRun(initial: RecommendationRunV7, entry: Fast24StudentCase): RecommendationRunV7 {
  const items = initial.items.map((item, index) => {
    const sourceId = `synthetic-source-${index}`, factId = `synthetic-task-${index}`;
    const detail = { ...runItemDetail(index), name: item.name, trackLabel: item.trackLabel!, edition: item.edition!, itemId: item.itemId, seriesId: item.seriesId,
      coreTask: claim(`围绕${entry.subject}收集资料，完成一个可解释的实践成果。`, { basis: "official", competitionFactIds: [factId] }),
      reasons: [claim(`结合你自报的${entry.major}背景，从明确的小任务开始。`, { basis: "inference", studentFactIds: ["student-major"], competitionFactIds: [factId], conditions: ["任务范围须按官网当届要求再核实"] })],
      currentRole: claim(entry.skill ? `先结合你自报的${entry.skill}，完成一个范围明确的小任务。` : "先试着整理一页资料，不据此判断已有技能。"),
      eligibilityNotes: entry.journey === "saved" ? ["预算提醒：先按官网核对费用。"] : [],
      sources: [{ id: sourceId, title: `${entry.discipline}模拟任务参考`, url: `https://historical.example.org/${entry.caseId}/${index}`, scope: "模拟历史任务资料，不代表当届开放", checkedAt: "2026-11-09" }],
      evidenceFacts: [{ id: factId, text: `${entry.discipline}模拟任务要求：提交任务过程与可解释成果。`, sourceIds: [sourceId], scope: "模拟历史任务", status: "reviewed", kind: "task" }],
    };
    return { ...item, detailStatus: "ready" as const, detail };
  });
  const report: DecisionReportV6 = {
    schemaVersion: "saitu.report.v6", reportId: `synthetic-report-${initial.runId}`, generatedAt: new Date().toISOString(), catalogVersion: initial.catalogVersion, profile: initial.profile!,
    summary: { direction: claim("先通过小任务比较方向，再决定长期投入。"), personalEvidence: [claim("采用你自报的专业、任务与投入条件。")], mainGap: claim("仍需确认当届任务与可用资源。"), nextStep: claim("用一周完成一页任务样例。"), focusItemIds: items.slice(0, 2).map(item => item.itemId) },
    recommendations: items.map(item => item.detail), shortlistShortfallReason: initial.shortfallReason, comparisons: [], goalPaths: [], candidateAudit: [], pendingQuestions: [],
    usefulQuestions: entry.journey === "unknown" ? [{ id: "synthetic-mentor", field: "availableResources", prompt: "目前能否获得校内导师的任务反馈？", expectedChange: "只用于确定准备条件，不确认参赛资格。", options: [{ value: "yes", label: "已有导师支持" }, { value: "no", label: "暂时没有导师" }], candidateIds: items.map(item => item.itemId) }] : [],
    schoolPolicyReminder: "校内认定与当届安排请另外核实。", fallback: { used: false, reason: null },
    trace: { engineVersion: "synthetic-ui-rehearsal", method: "llm", model: "synthetic-no-provider", promptVersion: "synthetic-only", candidateCount: 45, callCount: 0, elapsedMs: 0, verification: "model_reviewed", inputTokens: null, outputTokens: null, costCny: null },
  };
  return recommendationRunSchema.parse({ ...initial, status: "ready", resultVersion: initial.resultVersion + 2, detailsReadyAt: new Date().toISOString(), items, report });
}

for (const entry of cases) {
  test(`${entry.caseId}: ${entry.discipline} ${entry.journey}`, async ({ page }, testInfo) => {
    await page.setViewportSize(entry.viewport === "mobile" ? { width: 393, height: 851 } : { width: 1440, height: 1000 });
    const pageErrors: string[] = [], consoleErrors: string[] = [], blocked: string[] = [];
    const observedRequests: { path: string; method: string; body?: unknown }[] = [];
    const runs = new Map<string, RecommendationRunV7>();
    const initial = initialRun(entry);
    let active = initial, submitCount = 0, chatCount = 0, normalizedQuestionnaire: unknown = null;
    runs.set(initial.runId, initial);
    page.on("pageerror", error => pageErrors.push(error.message));
    page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
    await page.route("**/api/**", async route => {
      const request = route.request(), pathname = new URL(request.url()).pathname;
      observedRequests.push({ path: pathname, method: request.method(), ...(request.method() === "POST" ? { body: request.postDataJSON() } : {}) });
      if (pathname === "/api/track") { await route.fulfill({ status: 204 }); return; }
      if (pathname === "/api/competitions/recommend/normalize") {
        const input = request.postDataJSON(); expect(input.recommendationPolicy).toBe("v7"); normalizedQuestionnaire = input.questionnaire;
        await route.fulfill({ json: { status: "confirmed", questionnaireToken: "synthetic-fast24-normalized-token-12345678901234567890" } }); return;
      }
      if (pathname === "/api/ai/competition-clarify") {
        await route.fulfill({ json: { responseVersion: COMPETITION_CLARIFICATION_RESPONSE_VERSION, status: "completed", nextQuestion: null, conversationToken: "synthetic-fast24-conversation-token-12345678901234567890" } }); return;
      }
      if (pathname === "/api/ai/competition-recommend") {
        submitCount += 1; expect(request.postDataJSON().reportVersion).toBe(initial.responseVersion);
        await route.fulfill({ status: 202, json: initial }); return;
      }
      if (pathname === "/api/ai/competition-chat") {
        chatCount += 1; const input = request.postDataJSON();
        expect(input.decisionToken).toBe(active.decisionToken); expect(input.expectedRevision).toBe(active.profileRevision);
        const correction = ["correction", "self_other", "withdraw", "corrected_refresh", "dislike"].includes(entry.journey);
        if (correction) {
          const old = active;
          const profile = structuredClone(old.profile!);
          profile.revision = `${entry.caseId}-r2`;
          if (entry.expectedField) {
            const replaced = profile.facts.filter(fact => fact.field === entry.expectedField);
            profile.retractedFactIds = [...profile.retractedFactIds, ...replaced.map(fact => fact.id)];
            profile.facts = profile.facts.map(fact => replaced.some(value => value.id === fact.id) ? { ...fact, state: "retracted" as const } : fact);
            if (entry.journey !== "withdraw") profile.facts.push({ id: "student-correction", field: entry.expectedField, value: entry.expectedValue!, label: `采用更正：${entry.expectedValue}`, state: "affirmed", confirmed: true, evidenceLevel: "self_report" });
          }
          active = recommendationRunSchema.parse({ ...old, runId: randomUUID(), decisionToken: `synthetic-corrected-${randomUUID()}`, profileRevision: profile.revision, profile,
            status: "ranking", resultVersion: 0, listReadyAt: null, detailsReadyAt: null, items: [], report: undefined });
          runs.set(active.runId, active);
          await route.fulfill({ json: { responseVersion: "competition-decision-chat.v7", requestId: input.requestId, message: "已采用你的更正，正在按更新后的画像重新匹配。", profileRevision: active.profileRevision, decisionToken: active.decisionToken, run: active, claims: [] } }); return;
        }
        if (input.action.type === "skip_question") {
          expect(input.action.disposition).toBe("unknown");
          active = { ...active, resultVersion: active.resultVersion + 1, report: { ...active.report!, usefulQuestions: [] } };
          runs.set(active.runId, active);
        }
        await route.fulfill({ json: { responseVersion: "competition-decision-chat.v7", requestId: input.requestId,
          message: input.action.type === "skip_question" ? "这个条件继续保持未知，不作为已有导师支持。" : entry.journey === "why_not" ? "未入选不代表不适合，现有资料尚不足以作更确定判断。" : "两项需要完成的任务与投入不同，请结合你更愿意持续做的事取舍。",
          profileRevision: active.profileRevision, decisionToken: active.decisionToken, ...(input.action.type === "skip_question" ? { run: active } : {}), claims: [] } }); return;
      }
      const runId = pathname.match(/^\/api\/ai\/competition-recommend\/runs\/([^/]+)$/)?.[1];
      if (request.method() === "GET" && runId && runs.has(runId)) {
        expect(request.headers().authorization).toBe(`Bearer ${runs.get(runId)!.decisionToken}`);
        await route.fulfill({ json: runs.get(runId) }); return;
      }
      blocked.push(`${request.method()} ${pathname}`); await route.abort("blockedbyclient");
    });

    await fillFast24StudentProfile(page, entry, testInfo.project.use.baseURL!);
    await page.getByRole("button", { name: "同意，请乐乐开始匹配", exact: true }).click();
    const report = page.getByTestId("decision-report-v7");
    await expect(report).toHaveAttribute("data-run-id", initial.runId);
    await expect(report.getByTestId("recommendation-run-item")).toHaveCount(initial.items.length);
    await expect(report.getByTestId("recommendation-run-progress")).toContainText(`0/${initial.items.length} 项`);
    const first = report.getByTestId("recommendation-run-item").first();
    await first.locator("summary").first().click();
    await expect(first).toContainText("匹配理由还在准备");
    await first.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("list-before-details.png"), fullPage: false });
    if (entry.journey === "refresh") {
      await page.reload(); await expect(report).toHaveAttribute("data-run-id", initial.runId); expect(submitCount).toBe(1);
    }
    active = completedRun(initial, entry); runs.set(active.runId, active);
    await expect(report).toHaveAttribute("data-run-status", "ready");
    await checkFast24Details(page, active.items[0]);
    if (entry.journey === "compare") {
      await checkFast24Comparison(page);
      await fillFast24Chat(page, "这两项主要区别是什么？结合我的时间和目标说明怎么取舍。", "比较两项");
    }
    if (entry.journey === "why_not") await fillFast24Chat(page, "为什么没有推荐全国大学生数学建模竞赛？未入选是否说明不适合我？", "为什么没推荐？");
    if (entry.journey === "dislike") await fillFast24Chat(page, "我不喜欢需要现场路演的方向，明确不想做路演。请按这个偏好重新匹配。", "不喜欢这些推荐");
    if (entry.chatText) await fillFast24Chat(page, entry.chatText, "更正或撤回回答");
    if (["compare", "why_not", "dislike", "correction", "self_other", "withdraw", "corrected_refresh"].includes(entry.journey)) {
      const previous = active;
      await page.getByTestId("decision-chat-v7").getByRole("button", { name: "发送", exact: true }).click();
      await expect.poll(() => chatCount).toBe(1);
      if (["dislike", "correction", "self_other", "withdraw", "corrected_refresh"].includes(entry.journey)) {
        await expect(report).toHaveAttribute("data-run-id", active.runId);
        await expect(report).toHaveAttribute("data-display-run-id", previous.runId);
        await expect(report.getByTestId("recommendation-run-item")).toHaveCount(previous.items.length);
        await expect(page.getByTestId("decision-update-proposal")).toHaveCount(0);
        const correctedList = { ...active, status: "list_ready" as const, resultVersion: 1, listReadyAt: new Date().toISOString(), items: previous.items.map(item => ({ ...item, name: `更新后${item.name}`, detailStatus: "pending" as const, detail: undefined })) };
        active = completedRun(correctedList, entry); runs.set(active.runId, active);
        await expect(report).toHaveAttribute("data-display-run-id", active.runId);
        await expect(report.getByTestId("recommendation-run-item").first()).toContainText("更新后");
        if (entry.expectedField) {
          const facts = active.profile!.facts.filter(fact => fact.field === entry.expectedField && fact.state === "affirmed" && !active.profile!.retractedFactIds.includes(fact.id));
          if (entry.journey === "withdraw") expect(facts).toHaveLength(0);
          else expect(facts.map(fact => fact.value)).toEqual([entry.expectedValue]);
        }
        if (entry.journey === "corrected_refresh") { await page.reload(); await expect(report).toHaveAttribute("data-run-id", active.runId); expect(chatCount).toBe(1); }
        await checkFast24Details(page, active.items[0]);
      } else await expect(page.getByTestId("decision-chat-v7")).toContainText(entry.journey === "why_not" ? "未入选不代表不适合" : "两项需要完成的任务与投入不同");
    }
    if (entry.journey === "unknown") {
      await page.getByTestId("decision-chat-v7").getByRole("button", { name: "暂不确定", exact: true }).click();
      await expect(page.getByTestId("decision-chat-v7")).toContainText("这个条件暂不确定");
      await expect(page.getByTestId("decision-chat-v7")).toContainText("继续保持未知");
      expect(active.profile!.unknownFields).toContain("skills");
    }
    if (entry.journey === "fewer") {
      await expect(report).toHaveAttribute("data-total-items", "2");
      await expect(report.getByTestId("recommendation-shortfall")).toHaveText("当前显示 2 项推荐，可修改回答或向乐乐追问。");
      await expect(report).not.toContainText(active.shortfallReason!);
      expect(active.shortfallReason).toContain("其他方向与当前任务限制不符");
      await report.getByTestId("recommendation-shortfall").scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath("count-only-shortfall.png"), fullPage: false });
    }
    if (entry.journey === "saved") {
      const legacyDetail = { ...runItemDetail(9), itemId: "legacy-v6-saved", name: "历史v6已收藏项目" };
      const legacy = { savedAt: "2026-11-05T01:00:00.000Z", reportId: "legacy-report", catalogVersion: "legacy-catalog", profileRevision: "legacy-r1", recommendation: legacyDetail };
      await page.evaluate(({ key, legacy }) => localStorage.setItem(key, JSON.stringify({ schemaVersion: key, items: [legacy] })), { key: savedKey, legacy });
      const saved = await saveFast24FirstResult(page);
      const stored = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), savedKey);
      expect(stored.items).toHaveLength(2); expect(stored.items.find((item: { reportId: string }) => item.reportId === "legacy-report")).toEqual(legacy);
      await report.getByRole("link", { name: "打开我的竞赛", exact: true }).click();
      await expect(page.getByTestId("saved-decision-list")).toContainText(saved.name);
      await expect(page.getByTestId("saved-decision-list")).toContainText(legacyDetail.name);
      await page.reload();
      await checkFast24SavedResult(page, active.items[0]);
    }
    await checkFast24PageHealth(page);
    expect(submitCount).toBe(1); expect(blocked).toEqual([]); expect(pageErrors).toEqual([]); expect(consoleErrors).toEqual([]);
    if (entry.journey !== "saved") expect(await page.evaluate(key => localStorage.getItem(key), key)).toBeNull();
    const evidenceTarget = entry.journey === "saved" ? page.getByTestId("saved-decision-list") : ["compare", "why_not", "dislike", "correction", "self_other", "withdraw", "corrected_refresh", "unknown"].includes(entry.journey) ? page.getByTestId("decision-chat-v7") : report.getByTestId("recommendation-run-item").first();
    await evidenceTarget.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("journey.png"), fullPage: false });
    await testInfo.attach("ui-observation", { contentType: "application/json", body: Buffer.from(JSON.stringify({
      evidenceClass: "synthetic_ui_rehearsal", caseId: entry.caseId, discipline: entry.discipline, actualModelCalls: 0,
      url: page.url(), title: await page.title(), viewport: page.viewportSize(), initialRunId: initial.runId, activeRunId: active.runId,
      submitCount, chatCount, blocked, pageErrors, consoleErrors, acceptedConsentVersion: AI_EVIDENCE_EXPLANATION_CONSENT_VERSION,
      normalizedQuestionnaire, requests: observedRequests, text: await page.locator("main").innerText(),
    }, null, 2)) });
  });
}
