import { createHmac } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import type {
  CompetitionDynamicQuestionV3,
  CompetitionFixedQuestionId,
  CompetitionQuestionnaireFieldId,
  CompetitionRecommendationItemV3,
  CompetitionRecommendationProfileV5,
  CompetitionRecommendationResponseV5
} from "../../src/types/competition-recommendation";
import { expectNoindex } from "./helpers";

const NORMALIZE_PATH = "/api/competitions/recommend/normalize";
const CLARIFY_PATH = "/api/ai/competition-clarify";
const RECOMMEND_PATH = "/api/ai/competition-recommend";
const NORMALIZE_PROMPT_VERSION = "competition-normalize.v1";
const CLARIFY_PROMPT_VERSION = "competition-clarify.v8";
const RANK_PROMPT_VERSION = "competition-rank.v4";
const E2E_CONVERSATION_SIGNING_SECRET =
  "e2e-competition-signing-secret-at-least-thirty-two-characters";

function createSignedLegacyConversationToken(marker: string) {
  const encodedPayload = Buffer.from(JSON.stringify({
    version: "competition-conversation.v5",
    marker
  })).toString("base64url");
  const signature = createHmac("sha256", E2E_CONVERSATION_SIGNING_SECRET)
    .update(encodedPayload)
    .digest("base64url");
  return `${encodedPayload}.${signature}`;
}

const forbiddenDynamicSnippets = [
  "核对当届官方条件后的资格状态",
  "已核对且符合",
  "仍需核对",
  "已确认不符合",
  "可参加赛道",
  "team-eligibility",
  "eligibility:"
] as const;

function expectPreferenceOnlyDynamicPayload(value: unknown, context: string) {
  const serialized = JSON.stringify(value);
  for (const snippet of forbiddenDynamicSnippets) {
    expect(serialized, `${context} 不得包含动态资格或团队追问信号：${snippet}`).not.toContain(snippet);
  }
  expect(serialized, `${context} 的 signalKey 只能属于三类偏好题`).not.toMatch(
    /"signalKey":"(?:team-eligibility|eligibility:[^"]*)"/
  );
}

async function expectCurrentDynamicQuestionPreferenceOnly(page: Page) {
  const text = await page.getByTestId("conversation-current-question").innerText();
  for (const snippet of forbiddenDynamicSnippets.slice(0, 5)) {
    expect(text, `动态问题区域不得显示：${snippet}`).not.toContain(snippet);
  }
  expect(text, "动态问题区域不得询问资格或团队事实").not.toMatch(
    /资格|官方条件|全日制|学籍|学历阶段|入学(?:年份|时间)?|出生(?:日期|年月|年份|时间)?|参赛单位|(?:队伍|团队|参赛|队员|成员)(?:人数|数量|规模)|申诉通道/
  );
}

const runtimeErrors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  runtimeErrors.set(page, errors);
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
});

test.afterEach(async ({ page }) => {
  expect(runtimeErrors.get(page) ?? [], "页面运行期间不应产生 console 或 page errors").toEqual([]);
});

const dynamicQuestions: CompetitionDynamicQuestionV3[] = [
  {
    questionId: "dq_competition_fit",
    signalKey: "competition-fit",
    prompt: "在这组候选赛事中，你最希望重点证明哪类实战能力？",
    selection: "multiple",
    maxSelections: 2,
    options: [
      { value: "software-engineering", label: "软件工程与系统交付" },
      { value: "product-validation", label: "产品验证与用户研究" },
      { value: "research-provenance", label: "研究深度与方法论" }
    ],
    allowsNote: true,
    maxNoteLength: 120,
    impact: "material",
    estimatedPreferenceOutcomeChanges: 3
  },
  {
    questionId: "dq_candidate_goal_tradeoff",
    signalKey: "candidate-goal-tradeoff",
    prompt: "结合当前候选，如果只能优先一种收获，你更看重哪一项？",
    selection: "single",
    options: [
      { value: "project", label: "项目经历" },
      { value: "award", label: "竞赛奖项" },
      { value: "portfolio", label: "作品集" }
    ],
    allowsNote: true,
    maxNoteLength: 120,
    impact: "material",
    estimatedPreferenceOutcomeChanges: 2
  },
  {
    questionId: "dq_track_iot_design",
    signalKey: "track:iot-design",
    prompt: "《物联网设计竞赛》的这些候选方向中，你更想优先准备哪个赛道？",
    selection: "single",
    options: [
      { value: "software", label: "软件与 AI 应用赛道" },
      { value: "hardware", label: "硬件与工程制作赛道" },
      { value: "research", label: "科研与建模赛道" }
    ],
    allowsNote: true,
    maxNoteLength: 120,
    impact: "material",
    estimatedPreferenceOutcomeChanges: 2
  }
];

const canonicalProfileV5: CompetitionRecommendationProfileV5 = {
  profileVersion: "competition-profile.v5",
  questionnaireVersion: "competition-questionnaire.v1",
  confirmedFields: [
    "stage",
    "majorFields",
    "specificSubjects",
    "skills",
    "interests",
    "goals",
    "preferredOutputs",
    "startingPoint",
    "weeklyCommitment",
    "teamStatus",
    "availableResources",
    "participationMode",
    "participationTiming",
    "taskFormats",
    "experienceLevel",
    "evidence"
  ],
  confirmedFacts: ["enrollmentStatus", "teamSize", "teamUnit"],
  stage: "undergraduate-2",
  majorFields: ["computer-science"],
  specificSubjects: ["information-communication"],
  skills: ["programming"],
  interests: ["ai"],
  goals: ["project"],
  preferredOutputs: ["software"],
  startingPoint: "prototype",
  weeklyCommitment: "5-10",
  teamStatus: "looking",
  availableResources: ["mentor"],
  participationMode: "remote",
  participationTiming: "within-3-months",
  taskFormats: ["software"],
  experienceLevel: "participated",
  evidence: ["prototype"],
  enrollmentStatus: "full-time-student",
  teamSize: "unsure",
  teamUnit: "unsure"
};

const syntheticRecommendationData = [
  ["iot-design", "物联网设计竞赛", "人工智能与物联", "best-match"],
  ["future-aircraft-design", "未来飞行器设计大赛", "工程与制造", "practical"],
  ["national-college-math-modeling", "全国大学生数学建模竞赛", "学术科研", "stretch"]
] as const;

function syntheticRecommendation(index: 0 | 1 | 2): CompetitionRecommendationItemV3 {
  const [competitionId, name, category, role] = syntheticRecommendationData[index];
  const subjectTask = 23 - index;
  const skillsEvidence = 18 - index;
  const goalsOutputs = 14;
  const maturity = 8;
  const teamResources = 13;
  const availabilityTiming = 10;
  const dataConfidence = 5;
  const baseMatchScore = subjectTask + skillsEvidence + goalsOutputs + maturity +
    teamResources + availabilityTiming + dataConfidence;
  const rawAlignment = 0.5 * subjectTask / 25 +
    0.3 * skillsEvidence / 20 +
    0.2 * goalsOutputs / 15;
  const alignment = Math.round(rawAlignment * 10_000) / 10_000;
  const evidenceConfidence = dataConfidence / 5;
  const adjustment = Math.round(Math.min(
    8,
    (100 - baseMatchScore) * 0.6 * rawAlignment * evidenceConfidence
  ) * 10) / 10;
  const matchScore = Math.round(Math.min(95, baseMatchScore + adjustment) * 10) / 10;
  return {
    rank: index + 1,
    competitionId,
    role,
    recommendationRole: index === 0 ? "best" : "steady",
    baseMatchScore,
    matchScore,
    scoreCalibration: {
      version: "competition-score-calibration.v1",
      qualified: true,
      alignment,
      evidenceConfidence,
      adjustment
    },
    rankingSource: "deepseek",
    eligibility: { status: "eligible", reasons: ["基础资格条件匹配。"] },
    fit: { score: baseMatchScore, matchedSignals: ["product-validation"], gaps: [] },
    scoreBreakdown: {
      subjectTask,
      skillsEvidence,
      goalsOutputs,
      maturity,
      teamResources,
      availabilityTiming,
      dataConfidence,
      interest: subjectTask,
      background: skillsEvidence,
      goal: goalsOutputs,
      difficulty: maturity,
      access: availabilityTiming,
      feasibility: teamResources,
      completenessPenalty: 0
    },
    registrationStatus: {
      status: "unknown",
      label: "请核验本届通知",
      note: "报名资格与时间以主办方最新通知为准。"
    },
    dataNotices: ["报名资格与时间仍需以官方最新通知为准。"],
    name,
    category,
    summary: `用于验证 V5 推荐流程的目录摘要 ${index + 1}。`,
    sourceUrl: `https://example.com/e2e-competition-${index + 1}`,
    explanationSource: "deepseek",
    explanation: {
      matchReasons: [`动态回答让这项竞赛成为第 ${index + 1} 项推荐。`],
      possibleGaps: ["仍需核验本届报名条件。"],
      preparationTips: ["阅读官方通知。", "整理可展示的项目证据。"]
    }
  };
}

const syntheticAiSuccessResponse: CompetitionRecommendationResponseV5 = {
  responseVersion: "competition-recommendation.v5",
  status: "matched",
  catalogVersion: "e2e-synthetic-catalog.v3",
  scorerVersion: "competition-scorer.v5",
  promptVersion: RANK_PROMPT_VERSION,
  model: "e2e-synthetic-deepseek",
  provider: "deepseek",
  rankingSource: "deepseek",
  fallbackUsed: false,
  fallbackMode: "none",
  recommendations: [
    syntheticRecommendation(0),
    syntheticRecommendation(1),
    syntheticRecommendation(2)
  ]
};

const replacementConsentDisclosure = {
  schemaVersion: "ai-consent-disclosure.v1",
  version: "2099-01-01.e2e",
  heading: "AI 使用说明已更新，请重新确认。",
  body:
    "我已单独同意：将本页已确认的 14 项回答发送给第三方 AI 服务 DeepSeek，仅用于本次结构化确认、追问和推荐排序。",
  privacyHref: "/privacy"
} as const;

type PureTextField = {
  fieldId: CompetitionQuestionnaireFieldId;
  optionLabel: string;
  value: string;
};

type PureTextTurn = {
  questionId: CompetitionFixedQuestionId;
  prompt: string;
  text: string;
  fields: readonly PureTextField[];
};

const visibleQuestionIds = [
  "goals", "stage", "majorFields", "interests", "skills", "experienceLevel", "taskFormats", "weeklyCommitment", "availableResources",
  "preferredOutputs", "startingPoint", "teamStatus", "participationMode"
] as const satisfies readonly CompetitionFixedQuestionId[];

const allTextTurns: readonly PureTextTurn[] = [
  {
    questionId: "stage",
    prompt: "你现在处于哪个学习阶段？",
    text: "目前读本科二年级，是全日制在读",
    fields: [
      { fieldId: "stage", optionLabel: "本科大二", value: "undergraduate-2" },
      { fieldId: "enrollmentStatus", optionLabel: "全日制在读", value: "full-time-student" }
    ]
  },
  {
    questionId: "majorFields",
    prompt: "你目前最接近哪些专业方向？",
    text: "主要学习计算机与信息通信方向",
    fields: [
      { fieldId: "majorFields", optionLabel: "计算机与信息", value: "computer-science" },
      { fieldId: "specificSubjects", optionLabel: "信息通信、芯片与计算机系统", value: "information-communication" }
    ]
  },
  {
    questionId: "skills",
    prompt: "在课程、社团或项目里，你亲自做过哪些事？",
    text: "平时用代码完成项目",
    fields: [{ fieldId: "skills", optionLabel: "编程与软件开发", value: "programming" }]
  },
  {
    questionId: "interests",
    prompt: "你更想探索哪些竞赛方向？",
    text: "想探索人工智能应用",
    fields: [{ fieldId: "interests", optionLabel: "人工智能", value: "ai" }]
  },
  {
    questionId: "taskFormats",
    prompt: "你更愿意在竞赛中完成哪些核心任务？",
    text: "更愿意开发软件和 AI 应用",
    fields: [{ fieldId: "taskFormats", optionLabel: "软件或 AI 应用开发", value: "software" }]
  },
  {
    questionId: "goals",
    prompt: "你最希望这次参赛帮你得到什么？",
    text: "希望积累完整项目经历",
    fields: [{ fieldId: "goals", optionLabel: "积累项目经历", value: "project" }]
  },
  {
    questionId: "preferredOutputs",
    prompt: "你更希望最后做出哪类成果？",
    text: "希望做出可以演示的软件",
    fields: [{ fieldId: "preferredOutputs", optionLabel: "软件或 AI 应用", value: "software" }]
  },
  {
    questionId: "startingPoint",
    prompt: "你目前最接近哪一种项目起点？",
    text: "已经有一版可运行原型",
    fields: [{ fieldId: "startingPoint", optionLabel: "已有原型、作品或代码", value: "prototype" }]
  },
  {
    questionId: "experienceLevel",
    prompt: "回想一项课程作业或项目：你做出了什么？",
    text: "参加过一次还没有获奖，可以展示代码原型",
    fields: [
      { fieldId: "experienceLevel", optionLabel: "参加过，但还没有完整项目或奖项", value: "participated" },
      { fieldId: "evidence", optionLabel: "可演示原型或代码", value: "prototype" }
    ]
  },
  {
    questionId: "weeklyCommitment",
    prompt: "接下来一段时间，每周大约能稳定投入多久？",
    text: "每周可以稳定投入八小时",
    fields: [{ fieldId: "weeklyCommitment", optionLabel: "每周 5–10 小时", value: "5-10" }]
  },
  {
    questionId: "participationTiming",
    prompt: "你希望什么时候开始参加合适的竞赛？",
    text: "希望三个月内开始准备",
    fields: [{ fieldId: "participationTiming", optionLabel: "希望未来 3 个月内开始参赛", value: "within-3-months" }]
  },
  {
    questionId: "teamStatus",
    prompt: "你现在的组队情况是？",
    text: "还没找到队友但愿意组队，人数和同校情况未定",
    fields: [
      { fieldId: "teamStatus", optionLabel: "还没有队友，可以组队", value: "looking" },
      { fieldId: "teamSize", optionLabel: "还没组队或人数未定", value: "unsure" },
      { fieldId: "teamUnit", optionLabel: "还不确定", value: "unsure" }
    ]
  },
  {
    questionId: "availableResources",
    prompt: "目前能稳定使用哪些备赛资源与报名支持？",
    text: "目前可以获得老师指导",
    fields: [{ fieldId: "availableResources", optionLabel: "指导老师", value: "mentor" }]
  },
  {
    questionId: "participationMode",
    prompt: "哪种参赛方式对你最可行？",
    text: "现阶段更适合线上参与",
    fields: [{ fieldId: "participationMode", optionLabel: "线上为主", value: "remote" }]
  }
] as const;

const pureTextTurns = visibleQuestionIds.map(id => allTextTurns.find(turn => turn.questionId === id)!);
const pureTextFields = pureTextTurns.flatMap((turn) =>
  turn.fields.map((field) => ({ ...field, text: turn.text }))
);

type FixedTurnFixture = {
  questionId: CompetitionFixedQuestionId;
  focusLabel: string;
  answers: readonly { role: "checkbox" | "radio"; label: string }[];
};

const allTurnFixtures = [
  {
    questionId: "stage",
    focusLabel: "你现在或最近处于哪个学习阶段？",
    answers: [
      { role: "radio", label: "本科大二" },
      { role: "radio", label: "全日制在读" }
    ]
  },
  {
    questionId: "majorFields",
    focusLabel: "你目前最接近哪些专业方向？",
    answers: [
      { role: "checkbox", label: "计算机与信息" },
      { role: "checkbox", label: "信息通信、芯片与计算机系统" }
    ]
  },
  {
    questionId: "skills",
    focusLabel: "在课程、社团或项目里，你亲自做过哪些事？",
    answers: [{ role: "checkbox", label: "编程与软件开发" }]
  },
  {
    questionId: "interests",
    focusLabel: "你更想探索哪些竞赛方向？",
    answers: [{ role: "checkbox", label: "人工智能" }]
  },
  {
    questionId: "taskFormats",
    focusLabel: "你更愿意在竞赛中完成哪些核心任务？",
    answers: [{ role: "checkbox", label: "软件或 AI 应用开发" }]
  },
  {
    questionId: "goals",
    focusLabel: "你最希望这次参赛帮你得到什么？",
    answers: [{ role: "checkbox", label: "积累项目经历" }]
  },
  {
    questionId: "preferredOutputs",
    focusLabel: "你更希望最后做出哪类成果？",
    answers: [{ role: "checkbox", label: "软件或 AI 应用" }]
  },
  {
    questionId: "startingPoint",
    focusLabel: "你目前最接近哪一种项目起点？",
    answers: [{ role: "radio", label: "已有原型、作品或代码" }]
  },
  {
    questionId: "experienceLevel",
    focusLabel: "你目前的竞赛经历最接近哪种情况？",
    answers: [
      { role: "radio", label: "参加过，但还没有完整项目或奖项" },
      { role: "checkbox", label: "可演示原型或代码" }
    ]
  },
  {
    questionId: "weeklyCommitment",
    focusLabel: "接下来一段时间，每周大约能稳定投入多久？",
    answers: [{ role: "radio", label: "每周 5–10 小时" }]
  },
  {
    questionId: "participationTiming",
    focusLabel: "你希望什么时候开始参加合适的竞赛？",
    answers: [{ role: "radio", label: "希望未来 3 个月内开始参赛" }]
  },
  {
    questionId: "teamStatus",
    focusLabel: "你现在的组队情况是？",
    answers: [
      { role: "radio", label: "还没有队友，可以组队" },
      { role: "radio", label: "还没组队或人数未定" },
      { role: "radio", label: "还不确定" }
    ]
  },
  {
    questionId: "availableResources",
    focusLabel: "目前能稳定使用哪些备赛资源与报名支持？",
    answers: [{ role: "checkbox", label: "暂时没有" }]
  },
  {
    questionId: "participationMode",
    focusLabel: "哪种参赛方式对你最可行？",
    answers: [{ role: "radio", label: "线上为主" }]
  }
] as const satisfies readonly FixedTurnFixture[];

const fixedTurnFixtures = visibleQuestionIds.map(id => allTurnFixtures.find(turn => turn.questionId === id)!);

function normalizeResponse(status: "confirmed" | "needs_confirmation", questionnaireToken: string) {
  return {
    ok: true,
    status,
    questionnaireToken,
    interpretations: status === "needs_confirmation"
      ? pureTextFields.map((field) => ({
        fieldId: field.fieldId,
        explicitValues: [],
        suggestedValues: [field.value],
        source: "model",
        confidence: 0.75,
        status: field.fieldId === "teamUnit" ? "ambiguous" : "ready",
        originalText: field.text,
        evidenceSpan: field.text,
        rationale: "原文与当前字段的白名单选项含义一致。",
        requiresConfirmation: true,
        allowedOptions: [{ value: field.value, label: field.optionLabel }]
      }))
      : [],
    promptVersion: NORMALIZE_PROMPT_VERSION,
    provider: "deepseek",
    model: "e2e-normalizer",
    aiUsed: status === "needs_confirmation",
    ...(status === "confirmed" ? { profile: canonicalProfileV5 } : {})
  };
}

async function selectRadio(page: Page, name: string) {
  await page.getByRole("radio", { name, exact: true }).evaluate((element) => {
    element.closest("label")?.click();
  });
}

async function selectCheckbox(page: Page, name: string) {
  await page.getByRole("checkbox", { name, exact: true }).evaluate((element) => {
    element.closest("label")?.click();
  });
}

async function selectFixedTurnFixture(page: Page, fixture: FixedTurnFixture) {
  const card = page.getByTestId("conversation-current-question");
  for (const answer of fixture.answers) {
    await card.getByRole(answer.role, { name: answer.label, exact: true }).evaluate((element) => {
      element.closest("label")?.click();
    });
  }
}

async function continueFixedTurn(page: Page) {
  const button = page.getByTestId("question-action-bar").getByRole("button", {
    name: "回答好了，继续",
    exact: true
  });
  await expect(button).toBeEnabled();
  await button.evaluate((element) => {
    if (element instanceof HTMLElement) element.click();
  });
}

async function openDeepQuestions(page: Page) {
  await expect(page.getByTestId("assistant-intro")).toHaveCount(0);
  await expect(page.getByRole("group", {name: /你最希望这次参赛帮你得到什么/}).or(page.getByText("你最希望这次参赛帮你得到什么？", {exact:true})).first()).toBeVisible();
  await page.getByRole("button", { name: "想聊得更细" }).click();
}

async function answerDecisionQuestions(page: Page, stageText?: string) {
  for (const fixture of fixedTurnFixtures) {
    const card = page.getByTestId("conversation-current-question");
    if (fixture.questionId === "stage" && stageText) {
      await card.locator('button[aria-expanded="false"]').first().click();
      await card.getByRole("textbox").fill(stageText);
    }
    await selectFixedTurnFixture(page, fixture);
    await continueFixedTurn(page);
  }
  await expect(page.getByRole("heading", { name: /上面的每条回答都可以直接修改/ })).toBeVisible();
  await expect(page.getByTestId("conversation-transcript-turn")).toHaveCount(visibleQuestionIds.length);
}

async function answerAllBaseQuestionsWithPureText(page: Page) {
  for (const turn of pureTextTurns) {
    const currentCard = page.getByTestId("conversation-current-question");
    await currentCard.locator('button[aria-expanded="false"]').evaluate((element) => {
      if (element instanceof HTMLElement) element.click();
    });
    await currentCard.getByRole("textbox", {
      name: `文字回答：${turn.prompt}`,
      exact: true
    }).fill(turn.text);
    await continueFixedTurn(page);
  }
  await expect(page.getByRole("heading", { name: /上面的每条回答都可以直接修改/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "修改这条回答", exact: true, includeHidden: true })).toHaveCount(visibleQuestionIds.length);
  await expect(page.getByTestId("conversation-transcript-turn").first()).toContainText(
    `自填：${pureTextTurns[0].text}`
  );
  await expect(page.getByTestId("conversation-transcript-turn").last()).toContainText(
    `自填：${pureTextTurns.at(-1)?.text}`
  );
}

async function consentAndStart(page: Page) {
  await page.getByRole("checkbox", { name: /我已单独同意/ }).check();
  await page.getByRole("button", { name: "同意，请乐乐开始匹配", exact: true }).click();
}

type OptionFlowMockOptions = {
  prefix: string;
  questions?: readonly CompetitionDynamicQuestionV3[];
  result?: CompetitionRecommendationResponseV5;
};

async function mockOptionFlow(page: Page, {
  prefix,
  questions = dynamicQuestions.slice(0, 2),
  result = syntheticAiSuccessResponse
}: OptionFlowMockOptions) {
  const normalizationPayloads: Array<Record<string, unknown>> = [];
  const clarifyPayloads: Array<Record<string, unknown>> = [];
  const recommendPayloads: Array<Record<string, unknown>> = [];
  const requestOrder: string[] = [];
  const questionnaireToken = `competition-questionnaire.v1:${prefix}:confirmed`;

  await page.route(`**${NORMALIZE_PATH}`, async (route) => {
    normalizationPayloads.push(route.request().postDataJSON() as Record<string, unknown>);
    requestOrder.push("normalize");
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(normalizeResponse("confirmed", questionnaireToken)) });
  });
  await page.route(`**${CLARIFY_PATH}`, async (route) => {
    const payload = route.request().postDataJSON() as Record<string, unknown>;
    clarifyPayloads.push(payload);
    requestOrder.push("clarify");
    const index = clarifyPayloads.length - 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        responseVersion: "competition-clarification.v6",
        status: index < questions.length ? "question" : "completed",
        nextQuestion: index < questions.length ? questions[index] : null,
        conversationToken: index < questions.length
          ? `competition-conversation.v6:${prefix}:${index + 1}`
          : `competition-conversation.v6:${prefix}:complete`,
        askedQuestionCount: Math.min(index, questions.length),
        promptVersion: CLARIFY_PROMPT_VERSION,
        model: "e2e-dynamic-question",
        provider: "deepseek",
        fallback: false
      })
    });
  });
  await page.route(`**${RECOMMEND_PATH}`, async (route) => {
    recommendPayloads.push(route.request().postDataJSON() as Record<string, unknown>);
    requestOrder.push("recommend");
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(result) });
  });

  return { clarifyPayloads, normalizationPayloads, questionnaireToken, recommendPayloads, requestOrder };
}

async function mockOptionalFlow(page: Page, prefix: string) {
  const clarifyPayloads: Array<Record<string, unknown>> = [];
  const optionalQuestion: CompetitionDynamicQuestionV3 = {
    ...dynamicQuestions[1],
    impact: "optional",
    estimatedPreferenceOutcomeChanges: 1
  };
  const questionnaireToken = `competition-questionnaire.v1:${prefix}:confirmed`;

  await page.route(`**${NORMALIZE_PATH}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(normalizeResponse("confirmed", questionnaireToken))
    });
  });
  await page.route(`**${CLARIFY_PATH}`, async (route) => {
    const payload = route.request().postDataJSON() as Record<string, unknown>;
    clarifyPayloads.push(payload);
    const initial = "questionnaireToken" in payload;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        responseVersion: "competition-clarification.v6",
        status: initial ? "optional_question" : "completed",
        nextQuestion: initial ? optionalQuestion : null,
        conversationToken: initial
          ? `competition-conversation.v6:${prefix}:optional`
          : `competition-conversation.v6:${prefix}:complete`,
        askedQuestionCount: initial ? 0 : ("answer" in payload ? 1 : 0),
        promptVersion: CLARIFY_PROMPT_VERSION,
        model: "e2e-deterministic-question",
        provider: "rule",
        fallback: false
      })
    });
  });
  await page.route(`**${RECOMMEND_PATH}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(syntheticAiSuccessResponse)
    });
  });

  return { clarifyPayloads, optionalQuestion };
}

async function mockScrollMatrixFlow(page: Page, prefix: string) {
  const clarificationPayloads: Array<Record<string, unknown>> = [];
  const questionnaireToken = `competition-questionnaire.v1:${prefix}:confirmed`;

  await page.unroute(`**${NORMALIZE_PATH}`);
  await page.unroute(`**${CLARIFY_PATH}`);
  await page.unroute(`**${RECOMMEND_PATH}`);

  await page.route(`**${NORMALIZE_PATH}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(normalizeResponse("confirmed", questionnaireToken))
    });
  });
  await page.route(`**${CLARIFY_PATH}`, async (route) => {
    const payload = route.request().postDataJSON() as Record<string, unknown>;
    clarificationPayloads.push(payload);
    if ("questionnaireToken" in payload) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          responseVersion: "competition-clarification.v6",
          status: "question",
          nextQuestion: dynamicQuestions[0],
          conversationToken: `competition-conversation.v6:${prefix}:1`,
          askedQuestionCount: 0,
          promptVersion: CLARIFY_PROMPT_VERSION,
          model: "e2e-dynamic-question",
          provider: "deepseek",
          fallback: false
        })
      });
      return;
    }

    const conversationToken = String(payload.conversationToken);
    const answer = payload.answer as { selectedValues: string[]; note?: string };
    if (conversationToken.endsWith(":1") && answer.selectedValues.length === 0) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          status: "needs_confirmation",
          interpretationRequired: true,
          interpretation: {
            questionId: dynamicQuestions[0].questionId,
            status: "ready",
            suggestedValues: [dynamicQuestions[0].options[0].value],
            rationale: "只从服务端签名问题的白名单中提出建议。",
            allowedOptions: dynamicQuestions[0].options
          }
        })
      });
      return;
    }

    if (conversationToken.endsWith(":1")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          responseVersion: "competition-clarification.v6",
          status: "question",
          nextQuestion: dynamicQuestions[1],
          conversationToken: `competition-conversation.v6:${prefix}:2`,
          askedQuestionCount: 1,
          promptVersion: CLARIFY_PROMPT_VERSION,
          model: "e2e-dynamic-question",
          provider: "deepseek",
          fallback: false
        })
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        responseVersion: "competition-clarification.v6",
        status: "completed",
        nextQuestion: null,
        conversationToken: `competition-conversation.v6:${prefix}:complete`,
        askedQuestionCount: 2,
        promptVersion: CLARIFY_PROMPT_VERSION,
        model: "e2e-dynamic-question",
        provider: "deepseek",
        fallback: false
      })
    });
  });
  await page.route(`**${RECOMMEND_PATH}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(syntheticAiSuccessResponse)
    });
  });

  return { clarificationPayloads, questionnaireToken };
}

type ObservedCompetitionApiExchange = {
  headers: Record<string, string>;
  path: string;
  requestBody: Record<string, unknown>;
  responseBody: unknown;
  status: number;
  url: string;
};

type CompetitionApiObserver = {
  requests: Array<{ path: string; requestBody: Record<string, unknown> }>;
  responseReads: Array<Promise<ObservedCompetitionApiExchange>>;
};

const observedCompetitionApiPaths = new Set([
  NORMALIZE_PATH,
  CLARIFY_PATH,
  RECOMMEND_PATH
]);

function requestJson(request: { postDataJSON(): unknown }) {
  try {
    const value = request.postDataJSON();
    return value && typeof value === "object" ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function payloadErrorCodeForE2e(payload: unknown) {
  return payload && typeof payload === "object" && "error" in payload
    ? String(payload.error)
    : "";
}

function observeCompetitionApi(page: Page): CompetitionApiObserver {
  const observer: CompetitionApiObserver = { requests: [], responseReads: [] };
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (!observedCompetitionApiPaths.has(path)) return;
    observer.requests.push({ path, requestBody: requestJson(request) });
  });
  page.on("response", (response) => {
    const path = new URL(response.url()).pathname;
    if (!observedCompetitionApiPaths.has(path)) return;
    const requestBody = requestJson(response.request());
    observer.responseReads.push((async () => {
      let responseBody: unknown = null;
      try {
        responseBody = await response.json();
      } catch {
        // A malformed response must remain observable as null instead of
        // making the network observer hide the UI failure state.
      }
      return {
        headers: await response.request().allHeaders(),
        path,
        requestBody,
        responseBody,
        status: response.status(),
        url: response.url()
      };
    })());
  });
  return observer;
}

async function observedCompetitionApiExchanges(observer: CompetitionApiObserver) {
  return Promise.all([...observer.responseReads]);
}

function decodeSignedTokenPayload(token: unknown) {
  expect(typeof token).toBe("string");
  const [encodedPayload, encodedSignature] = String(token).split(".");
  expect(encodedPayload).toBeTruthy();
  expect(encodedSignature).toBeTruthy();
  return JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as Record<string, unknown>;
}

async function currentConversationPhase(page: Page) {
  const stage = page.getByTestId("conversation-stage").last();
  if (await stage.count() === 0) return "";
  return await stage.getAttribute("data-phase") ?? "";
}

async function waitForPreferenceOrTerminalPhase(page: Page) {
  let phase = "";
  await expect.poll(async () => {
    phase = await currentConversationPhase(page);
    return ["followups", "optional_followup", "results", "error"].includes(phase);
  }).toBe(true);
  return phase;
}

async function waitForPreferenceStepToAdvance(page: Page, previousPhase: string, previousPrompt = "") {
  await expect.poll(async () => {
    const phase = await currentConversationPhase(page);
    if (phase !== previousPhase) return true;
    if (phase !== "followups") return false;
    const prompt = page.getByTestId("conversation-question-prompt").last();
    return await prompt.count() === 0 || await prompt.innerText() !== previousPrompt;
  }).toBe(true);
}

async function driveRealPreferenceFlow(
  page: Page,
  terminalPhases: readonly ("results" | "error")[] = ["results"]
) {
  let answeredQuestions = 0;
  for (let step = 0; step < 10; step += 1) {
    const phase = await waitForPreferenceOrTerminalPhase(page);
    if (phase === "results" || phase === "error") {
      expect(terminalPhases).toContain(phase);
      return { answeredQuestions, terminalPhase: phase as "results" | "error" };
    }
    if (phase === "optional_followup") {
      await page.getByRole("button", { name: "直接查看推荐", exact: true }).click();
      await waitForPreferenceStepToAdvance(page, phase);
      continue;
    }

    await expectCurrentDynamicQuestionPreferenceOnly(page);
    const card = page.getByTestId("conversation-current-question");
    const prompt = await card.getByTestId("conversation-question-prompt").innerText();
    const option = card.locator('input[type="radio"], input[type="checkbox"]').first();
    await expect(option).toHaveCount(1);
    await option.evaluate((element) => element.closest("label")?.click());
    await expect(option).toBeChecked();
    const confirm = card.getByRole("button", { name: "确认回答，继续", exact: true });
    await expect(confirm).toBeEnabled();
    await confirm.click();
    answeredQuestions += 1;
    await waitForPreferenceStepToAdvance(page, phase, prompt);
  }
  throw new Error("真实服务端偏好流程超过预期步数，可能出现重复问题或第四个追问。");
}

function consumeExpectedHttpConsoleErrors(page: Page, status: number, minimumCount = 1) {
  const errors = runtimeErrors.get(page) ?? [];
  const marker = `status of ${status}`;
  const expected = errors.filter((error) => error.includes(marker));
  expect(expected.length, `应观察到 ${minimumCount} 个预期的 HTTP ${status} 浏览器错误`).toBeGreaterThanOrEqual(minimumCount);
  runtimeErrors.set(page, errors.filter((error) => !error.includes(marker)));
}

function expectCompletedV6Token(token: unknown) {
  const payload = decodeSignedTokenPayload(token);
  expect(payload).toMatchObject({
    version: "competition-conversation.v6",
    sessionId: expect.stringMatching(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    ),
    completed: true,
    pendingQuestion: null,
    qualificationSnapshot: {
      version: "competition-qualification-snapshot-summary.v1",
      digest: expect.stringMatching(/^[a-f0-9]{64}$/),
      entryCount: expect.any(Number),
      evaluatedAt: expect.any(Number)
    }
  });
  const transcript = payload.transcript as Array<Record<string, unknown>>;
  expect(transcript.length).toBeLessThanOrEqual(3);
  expectPreferenceOnlyDynamicPayload(transcript, "V6 signed transcript");
  return payload;
}

async function attachScreenshot(page: Page, testInfo: TestInfo, name: string) {
  const screenshot = await page.screenshot({ animations: "disabled", fullPage: false });
  await testInfo.attach(name, {
    body: screenshot,
    contentType: "image/png"
  });
  if (process.env.PERSIST_COMPETITION_E2E_SCREENSHOTS === "1") {
    const artifactDirectory = join(
      process.cwd(),
      "artifacts",
      "competition-recommendation",
      "e2e-2026-08-25"
    );
    const artifactName = `${testInfo.project.name}-${name}`.replace(/[^a-zA-Z0-9._-]+/g, "-");
    await mkdir(artifactDirectory, { recursive: true });
    await writeFile(join(artifactDirectory, `${artifactName}.png`), screenshot);
  }
}

async function waitForWindowScrollSettled(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => {
    let previous = window.scrollY;
    let stableFrames = 0;
    const timeout = window.setTimeout(resolve, 4_000);
    const measure = () => {
      const current = window.scrollY;
      stableFrames = Math.abs(current - previous) <= 0.5 ? stableFrames + 1 : 0;
      previous = current;
      if (stableFrames >= 12) {
        window.clearTimeout(timeout);
        resolve();
        return;
      }
      window.requestAnimationFrame(measure);
    };
    window.requestAnimationFrame(measure);
  }));
}

async function expectQuestionAlignedBelowStickyHeader(page: Page, expectedPrompt: string) {
  const card = page.getByTestId("conversation-current-question");
  await waitForWindowScrollSettled(page);
  const viewport = page.viewportSize();
  const reducedMotion = await page.evaluate(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const matrixContext = `${viewport?.width ?? "?"}x${viewport?.height ?? "?"}/${reducedMotion ? "reduce" : "normal"}`;
  const cardBox = await card.boundingBox();
  const headerBox = await page.locator("header").first().boundingBox();
  expect(cardBox).not.toBeNull();
  expect(headerBox).not.toBeNull();
  const gap = cardBox!.y - (headerBox!.y + headerBox!.height);
  expect(gap, `${matrixContext} 题卡与 sticky header 的间距`).toBeGreaterThanOrEqual(8);
  expect(gap, `${matrixContext} 题卡与 sticky header 的间距`).toBeLessThanOrEqual(24);
  const prompt = card.getByTestId("conversation-question-prompt").first();
  await expect(prompt).toHaveText(expectedPrompt);
  await expect(prompt).toBeFocused();
}

async function expectActionBarUsable(page: Page) {
  const actionBar = page.getByTestId("question-action-bar");
  await expect(actionBar).toBeVisible();
  const box = await actionBar.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  const buttons = actionBar.getByRole("button");
  for (let index = 0; index < await buttons.count(); index += 1) {
    const button = buttons.nth(index);
    await expect(button).toBeVisible();
    const buttonBox = await button.boundingBox();
    expect((buttonBox?.height ?? 0) + 0.01).toBeGreaterThanOrEqual(44);
    expect((buttonBox?.width ?? 0) + 0.01).toBeGreaterThanOrEqual(44);
    expect(buttonBox?.y ?? Number.NEGATIVE_INFINITY).toBeGreaterThanOrEqual(0);
    expect((buttonBox?.y ?? 0) + (buttonBox?.height ?? 0)).toBeLessThanOrEqual(viewport!.height + 1);
    expect(await button.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return getComputedStyle(element).pointerEvents !== "none" && Boolean(hit && (hit === element || element.contains(hit)));
    })).toBe(true);
  }
}

async function expectButtonOperable(button: Locator) {
  await expect(button).toBeEnabled();
  await button.click({ trial: true });
}

async function expectTextareaExpansionAndTypingStable(
  page: Page,
  contextLabel: string,
  text: string,
  { clearAfter = false }: { clearAfter?: boolean } = {}
) {
  const card = page.getByTestId("conversation-current-question");
  const toggle = card.locator('button[aria-expanded="false"]');
  await expect(toggle).toHaveCount(1);
  await page.evaluate(() => {
    const scope = window as typeof window & {
      __competitionExpansionScrollListener?: () => void;
      __competitionExpansionScrollSamples?: number[];
    };
    if (scope.__competitionExpansionScrollListener) {
      window.removeEventListener("scroll", scope.__competitionExpansionScrollListener);
    }
    scope.__competitionExpansionScrollSamples = [window.scrollY];
    scope.__competitionExpansionScrollListener = () => scope.__competitionExpansionScrollSamples?.push(window.scrollY);
    window.addEventListener("scroll", scope.__competitionExpansionScrollListener, { passive: true });
  });
  await toggle.click();
  await waitForWindowScrollSettled(page);
  const expansionScrollSamples = await page.evaluate(() => {
    const scope = window as typeof window & {
      __competitionExpansionScrollListener?: () => void;
      __competitionExpansionScrollSamples?: number[];
    };
    if (scope.__competitionExpansionScrollListener) {
      window.removeEventListener("scroll", scope.__competitionExpansionScrollListener);
      delete scope.__competitionExpansionScrollListener;
    }
    return scope.__competitionExpansionScrollSamples ?? [window.scrollY];
  });

  const textarea = card.getByRole("textbox", { name: `文字回答：${contextLabel}`, exact: true });
  await expect(textarea).toBeFocused();
  const textareaBox = await textarea.boundingBox();
  const headerBox = await page.locator("header").first().boundingBox();
  const actionBarBox = await page.getByTestId("question-action-bar").boundingBox();
  expect(textareaBox).not.toBeNull();
  expect(headerBox).not.toBeNull();
  expect(actionBarBox).not.toBeNull();
  expect(textareaBox!.y).toBeGreaterThanOrEqual(headerBox!.y + headerBox!.height);
  expect(
    textareaBox!.y + textareaBox!.height,
    `textarea bottom=${textareaBox!.y + textareaBox!.height}, actionBar top=${actionBarBox!.y}, 展开 scrollY=${JSON.stringify(expansionScrollSamples)}`
  ).toBeLessThanOrEqual(actionBarBox!.y - 31);
  await page.evaluate(() => {
    const scope = window as typeof window & {
      __competitionScrollListener?: () => void;
      __competitionScrollSamples?: number[];
    };
    if (scope.__competitionScrollListener) {
      window.removeEventListener("scroll", scope.__competitionScrollListener);
    }
    scope.__competitionScrollSamples = [window.scrollY];
    scope.__competitionScrollListener = () => scope.__competitionScrollSamples?.push(window.scrollY);
    window.addEventListener("scroll", scope.__competitionScrollListener, { passive: true });
  });
  for (const character of text) {
    await page.keyboard.insertText(character);
  }
  await page.waitForTimeout(150);
  const scrollSamples = await page.evaluate(() => {
    const scope = window as typeof window & {
      __competitionScrollListener?: () => void;
      __competitionScrollSamples?: number[];
    };
    if (scope.__competitionScrollListener) {
      window.removeEventListener("scroll", scope.__competitionScrollListener);
      delete scope.__competitionScrollListener;
    }
    return scope.__competitionScrollSamples ?? [window.scrollY];
  });
  expect(
    Math.max(...scrollSamples) - Math.min(...scrollSamples),
    `已聚焦 textarea 逐字输入期间的 scrollY 序列：${JSON.stringify(scrollSamples)}`
  ).toBeLessThanOrEqual(1);
  await expect(textarea).toHaveValue(text);
  if (clearAfter) await textarea.fill("");
}

test("真实服务器 mock provider 完成固定问卷、签名 V6 偏好会话与三项推荐", async ({ page, isMobile }) => {
  test.setTimeout(180_000);
  test.skip(isMobile, "真实服务端签名链路在 desktop 跑一次；移动布局由独立视口矩阵覆盖。");
  const observer = observeCompetitionApi(page);

  // Intentionally do not install page.route handlers for normalize, clarify,
  // or recommend: this case must exercise all three Next.js route handlers.
  await page.goto("/competitions/recommend");
  await openDeepQuestions(page);
  await answerDecisionQuestions(page);
  await consentAndStart(page);
  const outcome = await driveRealPreferenceFlow(page, ["results", "error"]);
  if (outcome.terminalPhase === "error") {
    throw new Error(`真实 API 链路进入错误态：${JSON.stringify(await observedCompetitionApiExchanges(observer))}`);
  }

  expect(outcome.answeredQuestions).toBeLessThanOrEqual(3);
  await expect(page.getByRole("heading", { name: /这些竞赛值得你优先了解/ })).toBeVisible();
  const cards = page.locator("article[aria-labelledby^='recommendation-title-']");
  await expect(cards).toHaveCount(3);
  await expect(page.getByTestId("ai-test-mode-notice")).toContainText("没有调用 DeepSeek");
  await expect(page.getByText(/补充问题 4/)).toHaveCount(0);

  const exchanges = await observedCompetitionApiExchanges(observer);
  const normalize = exchanges.filter(({ path }) => path === NORMALIZE_PATH);
  const clarify = exchanges.filter(({ path }) => path === CLARIFY_PATH);
  const recommend = exchanges.filter(({ path }) => path === RECOMMEND_PATH);
  expect(normalize).toHaveLength(1);
  expect(clarify.length).toBeGreaterThanOrEqual(2);
  expect(recommend).toHaveLength(1);
  expect(exchanges.every(({ status }) => status === 200)).toBe(true);

  const questionnaire = normalize[0].requestBody.questionnaire as {
    version: string;
    answers: Array<{ fieldId: string; selectedValues: string[] }>;
  };
  expect(questionnaire.version).toBe("competition-questionnaire.v1");
  expect(questionnaire.answers).toHaveLength(visibleQuestionIds.length);
  expect(questionnaire.answers.map(({ fieldId }) => fieldId)).toEqual(visibleQuestionIds);
  expect(new Set(questionnaire.answers.map(({ fieldId }) => fieldId)).size).toBe(visibleQuestionIds.length);
  expect(normalize[0].responseBody).toMatchObject({
    ok: true,
    status: "confirmed",
    promptVersion: NORMALIZE_PROMPT_VERSION
  });

  const initialClarifyRequest = clarify[0].requestBody;
  expect(initialClarifyRequest).toMatchObject({
    questionnaireToken: expect.any(String),
    recentSignalKeys: []
  });
  expect(initialClarifyRequest).not.toHaveProperty("profile");
  for (const [index, exchange] of clarify.entries()) {
    expectPreferenceOnlyDynamicPayload(exchange.requestBody, `real clarify request ${index + 1}`);
    expectPreferenceOnlyDynamicPayload(exchange.responseBody, `real clarify response ${index + 1}`);
  }

  const recommendationBody = recommend[0].responseBody as CompetitionRecommendationResponseV5;
  expect(recommendationBody).toMatchObject({
    responseVersion: "competition-recommendation.v5",
    status: "matched",
    provider: "server",
    model: "structured-fit",
    rankingSource: "evidence-rules",
    fallbackUsed: false,
    fallbackMode: "none"
  });
  expect(recommendationBody.recommendations).toHaveLength(3);
  expect(new Set(recommendationBody.recommendations.map(({ competitionId }) => competitionId)).size).toBe(3);
  const completedPayload = expectCompletedV6Token(recommend[0].requestBody.conversationToken);
  expect(completedPayload.rawAnswerContext).toEqual(expect.arrayContaining([
    expect.objectContaining({ fieldId: "stage" }),
    expect.objectContaining({ fieldId: "teamSize" }),
    expect.objectContaining({ fieldId: "teamUnit" })
  ]));
  expect(recommend[0].requestBody).not.toHaveProperty("profile");
  expect(await page.evaluate(() => ({
    localKeys: Object.keys(window.localStorage),
    sessionKeys: Object.keys(window.sessionStorage)
  }))).toEqual({ localKeys: [], sessionKeys: [] });
});

test("真实 V6 会话过期后自动重建且保留已答题目答案", async ({ page, isMobile }) => {
  test.setTimeout(180_000);
  test.skip(isMobile, "会话恢复协议在 desktop 跑一次；移动布局由独立视口矩阵覆盖。");
  const observer = observeCompetitionApi(page);
  let expiredConversationInjected = false;

  await page.route(`**${CLARIFY_PATH}`, async (route) => {
    const payload = requestJson(route.request());
    if (!expiredConversationInjected && "conversationToken" in payload) {
      expiredConversationInjected = true;
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "CONVERSATION_EXPIRED" })
      });
      return;
    }
    await route.continue();
  });

  await page.goto("/competitions/recommend");
  await openDeepQuestions(page);
  await answerDecisionQuestions(page);
  await consentAndStart(page);
  const outcome = await driveRealPreferenceFlow(page);

  expect(expiredConversationInjected).toBe(true);
  expect(outcome.answeredQuestions).toBeLessThanOrEqual(6);
  await expect(page.getByRole("heading", { name: /这些竞赛值得你优先了解/ })).toBeVisible();
  await expect(page.locator("article[aria-labelledby^='recommendation-title-']")).toHaveCount(3);
  await expect(
    page.getByTestId("conversation-transcript-turn").getByRole("button", {
      name: "修改这条回答",
      exact: true, includeHidden: true
    })
  ).toHaveCount(visibleQuestionIds.length);
  expect(await page.getByTestId("conversation-transcript-clarification").count()).toBeLessThanOrEqual(3);

  const exchanges = await observedCompetitionApiExchanges(observer);
  expect(exchanges.filter(({ path }) => path === NORMALIZE_PATH)).toHaveLength(2);
  const clarify = exchanges.filter(({ path }) => path === CLARIFY_PATH);
  expect(clarify.some(({ status, responseBody }) =>
    status === 400 && payloadErrorCodeForE2e(responseBody) === "CONVERSATION_EXPIRED"
  )).toBe(true);
  const recommend = exchanges.filter(({ path }) => path === RECOMMEND_PATH);
  expect(recommend).toHaveLength(1);
  expectCompletedV6Token(recommend[0].requestBody.conversationToken);
  consumeExpectedHttpConsoleErrors(page, 400);
});

test("AI 同意版本更新时原子换入完整说明、保留已答题目并以新版本继续", async ({ page, isMobile }) => {
  test.setTimeout(180_000);
  test.skip(isMobile, "同意恢复协议在 desktop 验证一次；移动布局由独立视口矩阵覆盖。");
  const normalizationPayloads: Array<Record<string, unknown>> = [];
  const clarifyPayloads: Array<Record<string, unknown>> = [];
  const recommendPayloads: Array<Record<string, unknown>> = [];

  await page.route(`**${NORMALIZE_PATH}`, async (route) => {
    const payload = requestJson(route.request());
    normalizationPayloads.push(payload);
    if (normalizationPayloads.length === 1) {
      await route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({
          ok: false,
          error: "AI_CONSENT_REQUIRED",
          consentVersion: replacementConsentDisclosure.version,
          consentDisclosure: replacementConsentDisclosure,
          message: "AI 使用说明已更新，请重新确认。"
        })
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(normalizeResponse(
        "confirmed",
        "competition-questionnaire.v1:consent-recovered:confirmed"
      ))
    });
  });
  await page.route(`**${CLARIFY_PATH}`, async (route) => {
    clarifyPayloads.push(requestJson(route.request()));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        responseVersion: "competition-clarification.v6",
        status: "completed",
        nextQuestion: null,
        conversationToken: "competition-conversation.v6:consent-recovered:complete",
        askedQuestionCount: 0,
        promptVersion: CLARIFY_PROMPT_VERSION,
        model: "e2e-consent-recovered",
        provider: "deepseek",
        fallback: false
      })
    });
  });
  await page.route(`**${RECOMMEND_PATH}`, async (route) => {
    recommendPayloads.push(requestJson(route.request()));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(syntheticAiSuccessResponse)
    });
  });

  await page.goto("/competitions/recommend");
  await openDeepQuestions(page);
  await answerDecisionQuestions(page);
  await consentAndStart(page);

  await expect(page.getByTestId("ai-consent-disclosure-notice")).toContainText(
    "AI 使用说明已更新"
  );
  await expect(page.getByRole("heading", { name: /上面的每条回答都可以直接修改/ })).toBeVisible();
  await expect(
    page.getByTestId("conversation-transcript-turn").getByRole("button", {
      name: "修改这条回答",
      exact: true, includeHidden: true
    })
  ).toHaveCount(visibleQuestionIds.length);
  await expect(page.getByText(replacementConsentDisclosure.heading, { exact: true })).toBeVisible();
  await expect(page.getByText(/14 项回答发送给第三方 AI 服务 DeepSeek/)).toBeVisible();
  const renewedCheckbox = page.getByRole("checkbox", { name: /我已单独同意/ });
  await expect(renewedCheckbox).toBeEnabled();
  await expect(renewedCheckbox).not.toBeChecked();
  await expect(page.getByRole("button", { name: "同意，请乐乐开始匹配", exact: true })).toBeDisabled();

  await consentAndStart(page);
  await expect(page.getByRole("heading", { name: /这些竞赛值得你优先了解/ })).toBeVisible();
  await expect(page.locator("article[aria-labelledby^='recommendation-title-']")).toHaveCount(3);

  expect(normalizationPayloads).toHaveLength(2);
  expect(normalizationPayloads[0]).toMatchObject({
    aiConsent: { accepted: true, version: expect.not.stringMatching(replacementConsentDisclosure.version) }
  });
  expect(normalizationPayloads[1]).toMatchObject({
    aiConsent: { accepted: true, version: replacementConsentDisclosure.version }
  });
  expect(normalizationPayloads[1].questionnaire).toEqual(normalizationPayloads[0].questionnaire);
  expect(clarifyPayloads).toHaveLength(1);
  expect(clarifyPayloads[0]).toMatchObject({
    aiConsent: { accepted: true, version: replacementConsentDisclosure.version }
  });
  expect(recommendPayloads).toHaveLength(1);
  expect(recommendPayloads[0]).toMatchObject({
    aiConsent: { accepted: true, version: replacementConsentDisclosure.version }
  });
  consumeExpectedHttpConsoleErrors(page, 403);
});

for (const scenario of [
  { label: "缺失", consentDisclosure: undefined },
  {
    label: "非法",
    consentDisclosure: {
      ...replacementConsentDisclosure,
      schemaVersion: "ai-consent-disclosure.v2",
      privacyHref: "https://invalid.example/privacy"
    }
  }
] as const) {
  test(`AI 同意描述对象${scenario.label}时刷新后仍 fail closed 且保留已答题目`, async ({ page, isMobile }) => {
    test.setTimeout(180_000);
    test.skip(isMobile, "同意描述 fail-closed 协议在 desktop 验证。");
    const normalizationPayloads: Array<Record<string, unknown>> = [];
    let disclosureRefreshRequests = 0;
    page.on("request", (request) => {
      const url = new URL(request.url());
      const headers = request.headers();
      if (
        request.method() === "GET" &&
        url.pathname === "/competitions/recommend" &&
        (url.searchParams.has("_rsc") || headers.rsc === "1")
      ) {
        disclosureRefreshRequests += 1;
      }
    });

    await page.route(`**${NORMALIZE_PATH}`, async (route) => {
      normalizationPayloads.push(requestJson(route.request()));
      await route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({
          ok: false,
          error: "AI_CONSENT_REQUIRED",
          consentVersion: replacementConsentDisclosure.version,
          message: "AI 使用说明已更新，请重新确认。",
          ...(scenario.consentDisclosure === undefined
            ? {}
            : { consentDisclosure: scenario.consentDisclosure })
        })
      });
    });

    await page.goto("/competitions/recommend");
    await openDeepQuestions(page);
    await answerDecisionQuestions(page);
    const refreshCountBeforeFailure = disclosureRefreshRequests;
    await consentAndStart(page);

    await expect.poll(() => disclosureRefreshRequests).toBeGreaterThan(refreshCountBeforeFailure);
    await expect(page.getByRole("heading", { name: /上面的每条回答都可以直接修改/ })).toBeVisible();
    await expect(
      page.getByTestId("conversation-transcript-turn").getByRole("button", {
        name: "修改这条回答",
        exact: true
      })
    ).toHaveCount(visibleQuestionIds.length);
    const lockedCheckbox = page.getByRole("checkbox", { name: /我已单独同意/ });
    await expect(lockedCheckbox).toBeDisabled();
    await expect(lockedCheckbox).not.toBeChecked();
    await expect(page.getByRole("button", { name: "等待最新 AI 使用说明", exact: true })).toBeDisabled();
    await expect(page.getByTestId("ai-consent-disclosure-notice")).toContainText(/确认与提交继续锁定|不会发送任何答案/);
    await expect(page.getByText(replacementConsentDisclosure.heading, { exact: true })).toHaveCount(0);

    const manualRefresh = page.getByRole("button", { name: "重新加载最新说明", exact: true });
    await expect(manualRefresh).toBeEnabled();
    const refreshCountBeforeManualRetry = disclosureRefreshRequests;
    await manualRefresh.click();
    await expect.poll(() => disclosureRefreshRequests).toBeGreaterThan(refreshCountBeforeManualRetry);
    await expect(manualRefresh).toBeEnabled();
    await expect(lockedCheckbox).toBeDisabled();
    await expect(page.getByRole("button", { name: "等待最新 AI 使用说明", exact: true })).toBeDisabled();
    expect(normalizationPayloads).toHaveLength(1);
    consumeExpectedHttpConsoleErrors(page, 403);
  });
}

test("403 UNSAFE_REQUEST 显示来源校验错误而不进入同意版本恢复", async ({ page, isMobile }) => {
  test.setTimeout(180_000);
  test.skip(isMobile, "403 错误分流在 desktop 验证一次。");
  let normalizeRequests = 0;
  let downstreamRequests = 0;
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path === CLARIFY_PATH || path === RECOMMEND_PATH) downstreamRequests += 1;
  });
  await page.route(`**${NORMALIZE_PATH}`, async (route) => {
    normalizeRequests += 1;
    await route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({
        ok: false,
        error: "UNSAFE_REQUEST",
        message: "Request origin is not allowed."
      })
    });
  });

  await page.goto("/competitions/recommend");
  await openDeepQuestions(page);
  await answerDecisionQuestions(page);
  await consentAndStart(page);

  await expect(page.getByRole("heading", { name: "抱歉，这次没有顺利完成匹配。", exact: true })).toBeVisible();
  await expect(page.getByText("当前页面来源未通过安全校验，请从当前站点重新打开后再试。", { exact: true })).toBeVisible();
  await expect(page.getByText(/AI 使用说明已更新|同意版本已更新/)).toHaveCount(0);
  await expect(page.getByTestId("ai-consent-disclosure-notice")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "修改这条回答", exact: true, includeHidden: true })).toHaveCount(visibleQuestionIds.length);
  expect(normalizeRequests).toBe(1);
  expect(downstreamRequests).toBe(0);
  consumeExpectedHttpConsoleErrors(page, 403);
});

test("clarify 与 recommend 短暂失败后均可原地重试并继续真实路由", async ({ page, isMobile }) => {
  test.setTimeout(180_000);
  test.skip(isMobile, "请求恢复协议在 desktop 跑一次；移动布局由独立视口矩阵覆盖。");
  const observer = observeCompetitionApi(page);
  const unavailable = { ok: false, error: "COMPETITION_RECOMMENDER_UNAVAILABLE" };

  await page.route(`**${CLARIFY_PATH}`, async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify(unavailable)
    });
  }, { times: 1 });
  await page.route(`**${RECOMMEND_PATH}`, async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify(unavailable)
    });
  }, { times: 1 });

  await page.goto("/competitions/recommend");
  await openDeepQuestions(page);
  await answerDecisionQuestions(page);
  await consentAndStart(page);

  const clarifyFailure = await driveRealPreferenceFlow(page, ["error"]);
  expect(clarifyFailure).toMatchObject({ answeredQuestions: 0, terminalPhase: "error" });
  await expect(page.getByText("竞赛助手暂时没开放，你的答案还在，稍后可以直接重试。", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "修改这条回答", exact: true, includeHidden: true })).toHaveCount(visibleQuestionIds.length);
  await page.getByRole("button", { name: "请乐乐原地重试", exact: true }).click();

  const recommendFailure = await driveRealPreferenceFlow(page, ["error"]);
  expect(recommendFailure.terminalPhase).toBe("error");
  expect(recommendFailure.answeredQuestions).toBeLessThanOrEqual(3);
  await expect(page.locator("article[aria-labelledby^='recommendation-title-']")).toHaveCount(0);
  await page.getByRole("button", { name: "请乐乐原地重试", exact: true }).click();
  await expect(page.getByRole("heading", { name: /这些竞赛值得你优先了解/ })).toBeVisible();
  await expect(page.locator("article[aria-labelledby^='recommendation-title-']")).toHaveCount(3);

  const exchanges = await observedCompetitionApiExchanges(observer);
  expect(exchanges.filter(({ path }) => path === NORMALIZE_PATH)).toHaveLength(1);
  const clarify = exchanges.filter(({ path }) => path === CLARIFY_PATH);
  expect(clarify[0]).toMatchObject({ status: 503 });
  expect(clarify.some(({ status }) => status === 200)).toBe(true);
  const recommend = exchanges.filter(({ path }) => path === RECOMMEND_PATH);
  expect(recommend.map(({ status }) => status)).toEqual([503, 200]);
  expect(recommend[1].responseBody).toMatchObject({
    responseVersion: "competition-recommendation.v5",
    provider: "server",
    rankingSource: "evidence-rules"
  });
  expectCompletedV6Token(recommend[1].requestBody.conversationToken);
  consumeExpectedHttpConsoleErrors(page, 503, 2);
});

test("429 HTTP-date 倒计时结束后从 normalize 原地重试且已答题目不丢失", async ({ page }) => {
  test.setTimeout(180_000);

  const attempts: Array<{ body: Record<string, unknown>; idempotencyKey: string }> = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname !== NORMALIZE_PATH) return;
    attempts.push({
      body: requestJson(request),
      idempotencyKey: request.headers()["idempotency-key"] ?? ""
    });
  });
  const mocks = await mockOptionFlow(page, {
    prefix: "rate-limit-retry",
    questions: []
  });
  // Playwright runs the most recently registered matching route first. After
  // this one-shot 429, the retry reaches mockOptionFlow's successful handler.
  await page.route(`**${NORMALIZE_PATH}`, async (route) => {
    await route.fulfill({
      status: 429,
      contentType: "application/json",
      headers: {
        "Retry-After": new Date(Date.now() + 3_000).toUTCString(),
        "X-RateLimit-Source": "application",
        "X-Request-ID": "e2e-rate-limit-0001"
      },
      body: JSON.stringify({
        ok: false,
        error: "RATE_LIMITED",
        source: "application",
        bucket: "session_start_minute",
        requestId: "e2e-rate-limit-0001"
      })
    });
  }, { times: 1 });

  await page.goto("/competitions/recommend");
  await openDeepQuestions(page);
  await answerDecisionQuestions(page);
  await consentAndStart(page);

  await expect(page.getByRole("heading", {
    name: "抱歉，这次没有顺利完成匹配。",
    exact: true
  })).toBeVisible();
  await expect(page.getByText(
    "今天找乐乐匹配的人有点多，倒计时结束后可在原地重试。",
    { exact: true }
  )).toBeVisible();
  await expect(page.getByRole("button", { name: /请等待 [1-3] 秒/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: "修改这条回答", exact: true, includeHidden: true })).toHaveCount(visibleQuestionIds.length);

  const retry = page.getByRole("button", { name: "请乐乐原地重试", exact: true });
  await expect(retry).toBeEnabled({ timeout: 7_000 });
  await retry.click();
  await expect(page.getByRole("heading", { name: /这些竞赛值得你优先了解/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "修改这条回答", exact: true, includeHidden: true })).toHaveCount(visibleQuestionIds.length);

  expect(attempts).toHaveLength(2);
  expect(attempts[1].body).toEqual(attempts[0].body);
  expect(attempts[0].idempotencyKey).not.toBe("");
  expect(attempts[1].idempotencyKey).toBe(attempts[0].idempotencyKey);
  expect(mocks.normalizationPayloads).toHaveLength(1);
  expect(mocks.requestOrder).toEqual(["normalize", "clarify", "recommend"]);
  consumeExpectedHttpConsoleErrors(page, 429);
});

async function completeQuickUnknowns(page: Page) {
  await page.goto("/competitions/recommend");
  await selectCheckbox(page, "积累项目经历");
  await continueFixedTurn(page);
  await selectRadio(page, "本科大二");
  await continueFixedTurn(page);
  for (let i = 0; i < 7; i += 1) await page.getByRole("button", {name:"暂不确定，跳过这题"}).click();
  await consentAndStart(page);
}

test("快速问答保留未知，结果可以比较、查漏推并修改后重算", async ({ page }) => {
  const result = { ...syntheticAiSuccessResponse, recommendations: [syntheticRecommendation(0), syntheticRecommendation(1)],
    alternatives: [{ competitionId: "national-college-math-modeling", name: "全国大学生数学建模竞赛", reason: "调研与数据分析经验仍待确认。" }],
    candidateAudit: [{ competitionId: "national-college-math-modeling", reason: "目前缺少数据建模经历线索。" }] };
  const requests = await mockOptionFlow(page, { prefix: "quick-compare-and-correct", questions: [], result });
  await completeQuickUnknowns(page);
  await expect(page.getByTestId("conversation-stage")).toHaveAttribute("data-phase", "results");
  expect(requests.normalizationPayloads[0].questionnaire).toMatchObject({answers: [
    {fieldId: "goals", selectedValues: ["goals:project"]}, {fieldId: "stage", selectedValues: ["stage:undergraduate-2"]}
  ]});
  const cards = page.locator("article[aria-labelledby^='recommendation-title-']");
  const before = await cards.evaluateAll(nodes => nodes.map(node => node.getAttribute("aria-labelledby")));
  await page.getByText("这个月能报名吗？", {exact:true}).click();
  const calendar = page.getByTestId("monthly-registration-reference");
  await expect(calendar.locator("[data-monthly-series]")).toHaveCount(2);
  await expect(calendar.locator("[data-monthly-series]").first()).toHaveAttribute("data-monthly-series","iot-design");
  await expect(calendar.locator("[data-monthly-series]").first()).toContainText("全国报名");
  await expect(calendar.getByRole("link").first()).toHaveAttribute("target","_blank");
  await expect(calendar).toContainText("资料核查于");
  await page.getByText("这个月能报名吗？", {exact:true}).click();
  expect(await cards.evaluateAll(nodes => nodes.map(node => node.getAttribute("aria-labelledby")))).toEqual(before);
  expect(requests.recommendPayloads).toHaveLength(1);
  await page.getByText("展开更多候选", { exact: true }).click();
  await expect(page.getByRole("button", {name: "全国大学生数学建模竞赛"})).toBeVisible();
  await page.getByText("比较两到三项竞赛", { exact: true }).click();
  await page.getByRole("checkbox", { name: "物联网设计竞赛", exact: true }).check();
  await page.getByRole("checkbox", { name: "未来飞行器设计大赛", exact: true }).check();
  await expect(page.getByText("任务与赛道", {exact: true})).toHaveCount(2);
  await page.getByText("为什么没推荐某场比赛？", {exact: true}).click();
  await page.getByLabel("输入比赛名称或简称").fill("数学建模");
  await expect(page.getByText("目前缺少数据建模经历线索。")).toBeVisible();
  await page.getByRole("button", {name:"修改条件后重新推荐"}).click();
  await expect(page.getByRole("checkbox", {name:"积累项目经历",exact:true})).toBeChecked();
  await selectCheckbox(page, "积累项目经历");
  await selectCheckbox(page, "提升实习求职竞争力");
  await page.getByRole("button", {name:"回到确认页，用现有回答重新匹配"}).click();
  await consentAndStart(page);
  await expect(page.getByTestId("conversation-stage")).toHaveAttribute("data-phase", "results");
  expect(requests.normalizationPayloads[1].questionnaire).toMatchObject({decisionContext:{primaryGoal:"employment"}});
});

test("暂无可靠结果时允许修改回答且不出现空收藏", async ({page}) => {
  await mockOptionFlow(page, {prefix:"quick-honest-abstention",questions:[],result:{...syntheticAiSuccessResponse,status:"no_match",recommendations:[]}});
  await completeQuickUnknowns(page);
  await expect(page.getByRole("heading", {name:"暂时没有足够依据推荐一场竞赛"})).toBeVisible();
  await expect(page.getByRole("button", {name:"保存并打开我的竞赛"})).toHaveCount(0);
  await expect(page.getByRole("button", {name:"修改条件后重新推荐"})).toBeVisible();
});

test("快速入口首屏可答，未同意前没有模型请求或引流", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", request => { const path = new URL(request.url()).pathname; if ([NORMALIZE_PATH, CLARIFY_PATH, RECOMMEND_PATH].includes(path)) requests.push(path); });
  await page.goto("/competitions/recommend");
  await expectNoindex(page);
  await expect(page.getByText("你最希望这次参赛帮你得到什么？", {exact:true})).toBeVisible();
  await expect(page.getByRole("button", {name:"想聊得更细"})).toBeVisible();
  await expect(page.getByTestId("assistant-intro")).toHaveCount(0);
  await expect(page.locator('a[href="/about#contact"]')).toHaveCount(0);
  await page.getByRole("button", {name:"暂不确定，跳过这题"}).click();
  await expect(page.getByRole("radio", {name:"本科大二",exact:true})).toBeVisible();
  expect(requests).toEqual([]);
});

test("选项路径先完成 V5 normalization，再以 v8 偏好追问和 rank v4 推荐且修改动态题会失效后续结果", async ({ page, isMobile }, testInfo) => {
  if (isMobile) await page.setViewportSize({ width: 390, height: 844 });
  const mocks = await mockOptionFlow(page, { prefix: "option-path" });
  await page.goto("/competitions/recommend");
  await openDeepQuestions(page);
  await answerDecisionQuestions(page);
  await consentAndStart(page);
  await expect(page.getByText("补充问题 1 · 最多3题", { exact: true })).toBeVisible();
  await expectCurrentDynamicQuestionPreferenceOnly(page);
  await selectCheckbox(page, "软件工程与系统交付");
  await page.getByRole("button", { name: "确认回答，继续", exact: true }).click();
  await expect(page.getByText("补充问题 2 · 最多3题", { exact: true })).toBeVisible();
  await expectCurrentDynamicQuestionPreferenceOnly(page);
  await selectRadio(page, "项目经历");
  await page.getByRole("button", { name: "确认回答，继续", exact: true }).click();

  await expect(page.getByRole("heading", { name: /这些竞赛值得你优先了解/ })).toBeVisible();
  const cards = page.locator("article[aria-labelledby^='recommendation-title-']");
  await expect(cards).toHaveCount(3);
  await expect(cards.first().getByText("DeepSeek 排序", { exact: false })).toBeVisible();
  await expect(page.getByText(/报名状态仅供行动参考/)).toBeVisible();
  await attachScreenshot(page, testInfo, `${testInfo.project.name}-option-results`);

  expect(mocks.requestOrder).toEqual(["normalize", "clarify", "clarify", "clarify", "recommend"]);
  expect(mocks.normalizationPayloads).toHaveLength(1);
  const questionnaire = mocks.normalizationPayloads[0].questionnaire as {
    version: string;
    answers: Array<{ fieldId: string; selectedValues: string[]; freeText?: string }>;
  };
  expect(questionnaire.version).toBe("competition-questionnaire.v1");
  expect(questionnaire.answers).toHaveLength(visibleQuestionIds.length);
  expect(questionnaire.answers.map(({ fieldId }) => fieldId)).toEqual(visibleQuestionIds);
  expect(new Set(questionnaire.answers.map(({ fieldId }) => fieldId)).size).toBe(visibleQuestionIds.length);
  expect(questionnaire.answers.every((answer) =>
    answer.selectedValues.every((value) => /^[A-Za-z][A-Za-z0-9]*:[^:]+$/.test(value))
  )).toBe(true);
  expect(questionnaire.answers).toEqual(expect.arrayContaining([
    expect.objectContaining({
      fieldId: "stage",
      selectedValues: ["stage:undergraduate-2", "enrollmentStatus:full-time-student"]
    }),
    expect.objectContaining({
      fieldId: "majorFields",
      selectedValues: ["majorFields:computer-science", "specificSubjects:information-communication"]
    }),
    expect.objectContaining({
      fieldId: "teamStatus",
      selectedValues: ["teamStatus:looking", "teamSize:unsure", "teamUnit:unsure"]
    })
  ]));
  expect(questionnaire.answers.every((answer) => answer.freeText === undefined)).toBe(true);
  expect(mocks.clarifyPayloads[0]).toMatchObject({
    questionnaireToken: mocks.questionnaireToken,
    recentSignalKeys: []
  });
  expect(mocks.clarifyPayloads[0]).not.toHaveProperty("profile");
  expect(mocks.clarifyPayloads[1]).toMatchObject({
    conversationToken: "competition-conversation.v6:option-path:1",
    answer: { selectedValues: ["software-engineering"] },
    recentSignalKeys: [dynamicQuestions[0].signalKey]
  });
  expect(mocks.clarifyPayloads[2]).toMatchObject({
    conversationToken: "competition-conversation.v6:option-path:2",
    answer: { selectedValues: ["project"] },
    recentSignalKeys: [dynamicQuestions[0].signalKey, dynamicQuestions[1].signalKey]
  });
  expect(mocks.recommendPayloads[0]).toMatchObject({ conversationToken: "competition-conversation.v6:option-path:complete" });
  expect(mocks.recommendPayloads[0]).not.toHaveProperty("profile");
  mocks.clarifyPayloads.forEach((payload, index) => {
    expectPreferenceOnlyDynamicPayload(payload, `clarify request ${index + 1}`);
  });
  mocks.recommendPayloads.forEach((payload, index) => {
    expectPreferenceOnlyDynamicPayload(payload, `recommend request ${index + 1}`);
  });

  await page.getByText("回看与修改问答记录", {exact:true}).click();
  const firstDynamicHistory = page.getByTestId("conversation-transcript-clarification").first();
  await firstDynamicHistory.getByRole("button", { name: "修改这条回答", exact: true, includeHidden: true }).click();
  await expect(page.getByTestId("conversation-stage")).toHaveAttribute("data-phase", "followups");
  await expect(page.getByText(dynamicQuestions[0].prompt, { exact: true })).toBeVisible();
  await expect(page.getByText(dynamicQuestions[1].prompt, { exact: true })).toHaveCount(0);
  await expect(page.locator("article[aria-labelledby^='recommendation-title-']")).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "软件工程与系统交付", exact: true })).toBeChecked();
});

test("高价值会话只需一题时立即停止且不会挂载第二或第四题", async ({ page }) => {
  const mocks = await mockOptionFlow(page, {
    prefix: "one-material-question",
    questions: dynamicQuestions.slice(0, 1)
  });
  await page.goto("/competitions/recommend");
  await openDeepQuestions(page);
  await answerDecisionQuestions(page);
  await consentAndStart(page);

  await expect(page.getByText("补充问题 1 · 最多3题", { exact: true })).toBeVisible();
  await selectCheckbox(page, "软件工程与系统交付");
  await page.getByRole("button", { name: "确认回答，继续", exact: true }).click();
  await expect(page.getByRole("heading", { name: /这些竞赛值得你优先了解/ })).toBeVisible();
  await expect(page.getByText(/补充问题 2|补充问题 4/)).toHaveCount(0);

  expect(mocks.clarifyPayloads).toHaveLength(2);
  expect(mocks.recommendPayloads).toHaveLength(1);
  expect(mocks.requestOrder).toEqual(["normalize", "clarify", "clarify", "recommend"]);
});

test("recommend 阶段遇到旧 V5 令牌会保留已答题目、丢弃旧追问并重建 V6 会话", async ({ page }) => {
  const questionnaireToken = "competition-questionnaire.v1:policy-restart:confirmed";
  const pendingLegacyToken = createSignedLegacyConversationToken("policy-restart-pending");
  const completedLegacyToken = createSignedLegacyConversationToken("policy-restart-complete");
  const clarifyPayloads: Array<Record<string, unknown>> = [];
  const recommendPayloads: Array<Record<string, unknown>> = [];
  const requestOrder: string[] = [];
  const policyResponses: Array<{ status: number; body: unknown }> = [];

  page.on("response", async (response) => {
    if (!response.url().endsWith(RECOMMEND_PATH) || response.status() !== 409) return;
    policyResponses.push({ status: response.status(), body: await response.json() as unknown });
  });

  await page.route(`**${NORMALIZE_PATH}`, async (route) => {
    requestOrder.push("normalize");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(normalizeResponse("confirmed", questionnaireToken))
    });
  });
  await page.route(`**${CLARIFY_PATH}`, async (route) => {
    const payload = route.request().postDataJSON() as Record<string, unknown>;
    clarifyPayloads.push(payload);
    requestOrder.push("clarify");
    const callIndex = clarifyPayloads.length - 1;
    const firstQuestion = callIndex === 0;
    const oldConversationCompleted = callIndex === 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        responseVersion: "competition-clarification.v6",
        status: firstQuestion ? "question" : "completed",
        nextQuestion: firstQuestion ? dynamicQuestions[0] : null,
        conversationToken: firstQuestion
          ? pendingLegacyToken
          : oldConversationCompleted
            ? completedLegacyToken
            : "competition-conversation.v6:policy-restart:complete",
        askedQuestionCount: firstQuestion ? 0 : oldConversationCompleted ? 1 : 0,
        promptVersion: CLARIFY_PROMPT_VERSION,
        model: "e2e-policy-restart",
        provider: "server",
        fallback: false
      })
    });
  });
  await page.route(`**${RECOMMEND_PATH}`, async (route) => {
    const payload = route.request().postDataJSON() as Record<string, unknown>;
    recommendPayloads.push(payload);
    requestOrder.push("recommend");
    if (recommendPayloads.length === 1) {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(syntheticAiSuccessResponse)
    });
  });

  await page.goto("/competitions/recommend");
  await openDeepQuestions(page);
  await answerDecisionQuestions(page);
  await consentAndStart(page);
  await selectCheckbox(page, "软件工程与系统交付");
  await page.getByRole("button", { name: "确认回答，继续", exact: true }).click();
  await expect(page.getByRole("heading", { name: /这些竞赛值得你优先了解/ })).toBeVisible();

  expect(requestOrder).toEqual([
    "normalize",
    "clarify",
    "clarify",
    "recommend",
    "clarify",
    "recommend"
  ]);
  expect(clarifyPayloads[2]).toMatchObject({ questionnaireToken, recentSignalKeys: [] });
  expect(recommendPayloads).toEqual([
    expect.objectContaining({ conversationToken: completedLegacyToken }),
    expect.objectContaining({ conversationToken: "competition-conversation.v6:policy-restart:complete" })
  ]);
  expect(policyResponses).toEqual([{
    status: 409,
    body: { ok: false, error: "CONVERSATION_POLICY_CHANGED" }
  }]);
  await expect(page.getByRole("button", { name: "修改这条回答", exact: true, includeHidden: true })).toHaveCount(visibleQuestionIds.length);
  await expect(page.getByText(dynamicQuestions[0].prompt, { exact: true })).toHaveCount(0);
  expect(runtimeErrors.get(page)).toEqual([
    "console: Failed to load resource: the server responded with a status of 409 (Conflict)"
  ]);
  runtimeErrors.set(page, []);
});

test("全纯文字可完成深入提问并确认规范字段，再完成三次动态文字白名单确认并得到推荐", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const normalizePayloads: Array<Record<string, unknown>> = [];
  const clarifyPayloads: Array<Record<string, unknown>> = [];
  const recommendPayloads: Array<Record<string, unknown>> = [];
  const requestOrder: string[] = [];
  const pendingToken = "competition-questionnaire.v1:pure-text:pending";
  const confirmedToken = "competition-questionnaire.v1:pure-text:confirmed";

  await page.route(`**${NORMALIZE_PATH}`, async (route) => {
    const payload = route.request().postDataJSON() as Record<string, unknown>;
    normalizePayloads.push(payload);
    if ("questionnaire" in payload) {
      requestOrder.push("normalize:draft");
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(normalizeResponse("needs_confirmation", pendingToken)) });
      return;
    }
    requestOrder.push("normalize:confirm");
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(normalizeResponse("confirmed", confirmedToken)) });
  });
  await page.route(`**${CLARIFY_PATH}`, async (route) => {
    const payload = route.request().postDataJSON() as Record<string, unknown>;
    clarifyPayloads.push(payload);
    if ("questionnaireToken" in payload) {
      requestOrder.push("clarify:begin");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          responseVersion: "competition-clarification.v6",
          status: "question",
          nextQuestion: dynamicQuestions[0],
          conversationToken: "competition-conversation.v6:pure-text:1",
          askedQuestionCount: 0,
          promptVersion: CLARIFY_PROMPT_VERSION,
          model: "e2e-dynamic-question",
          provider: "deepseek",
          fallback: false
        })
      });
      return;
    }
    const token = String(payload.conversationToken);
    const questionIndex = dynamicQuestions.findIndex((_, index) => token.endsWith(`:${index + 1}`));
    expect(questionIndex).toBeGreaterThanOrEqual(0);
    const question = dynamicQuestions[questionIndex];
    const answer = payload.answer as { selectedValues: string[]; note?: string };
    const expectedValue = question.options[0].value;
    if (answer.selectedValues.length === 0) {
      requestOrder.push(`clarify:${questionIndex + 1}:text`);
      const statuses = ["ready", "ambiguous", "conflict"] as const;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          status: "needs_confirmation",
          interpretationRequired: true,
          interpretation: {
            questionId: question.questionId,
            status: statuses[questionIndex],
            suggestedValues: [expectedValue],
            rationale: "只从服务端签名问题的白名单中提出建议。",
            allowedOptions: question.options
          }
        })
      });
      return;
    }
    expect(payload.interpretationConfirmed).toBe(true);
    requestOrder.push(`clarify:${questionIndex + 1}:confirmed`);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        responseVersion: "competition-clarification.v6",
        status: dynamicQuestions[questionIndex + 1] ? "question" : "completed",
        nextQuestion: dynamicQuestions[questionIndex + 1] ?? null,
        conversationToken: dynamicQuestions[questionIndex + 1]
          ? `competition-conversation.v6:pure-text:${questionIndex + 2}`
          : "competition-conversation.v6:pure-text:complete",
        askedQuestionCount: questionIndex + 1,
        promptVersion: CLARIFY_PROMPT_VERSION,
        model: "e2e-dynamic-question",
        provider: "deepseek",
        fallback: false
      })
    });
  });
  await page.route(`**${RECOMMEND_PATH}`, async (route) => {
    requestOrder.push("recommend");
    recommendPayloads.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(syntheticAiSuccessResponse) });
  });

  await page.goto("/competitions/recommend");
  await openDeepQuestions(page);
  await answerAllBaseQuestionsWithPureText(page);
  await consentAndStart(page);
  await expect(page.getByRole("heading", { name: "请确认我对文字回答的理解", exact: true })).toBeVisible();
  await expect(page.locator("article[aria-labelledby^='interpretation-']")).toHaveCount(pureTextFields.length);
  await expect(page.getByText(pureTextTurns[0].text, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(pureTextTurns.at(-1)!.text, { exact: true })).toBeVisible();
  const confirmAllInterpretations = page.getByRole("button", {
    name: "确认结构化理解并继续",
    exact: true
  });
  await expect(confirmAllInterpretations).toBeDisabled();
  await expect(page.getByText("还有 1 项需要确认", { exact: true })).toBeVisible();
  await page.getByRole("radio", { name: "还不确定", exact: true }).evaluate((element) => {
    element.closest("label")?.click();
  });
  await expect(page.getByText("所有文字回答都已确认", { exact: true })).toBeVisible();
  await expect(confirmAllInterpretations).toBeEnabled();
  await attachScreenshot(page, testInfo, "pure-text-interpretation");
  await confirmAllInterpretations.click();

  const dynamicTexts = [
    "最想证明软件工程与系统交付能力",
    "最看重完整项目经历",
    "更想优先准备软件应用赛道"
  ];
  for (let index = 0; index < dynamicQuestions.length; index += 1) {
    const question = dynamicQuestions[index];
    await expect(page.getByText(`补充问题 ${index + 1} · 最多3题`, { exact: true })).toBeVisible();
    const currentCard = page.getByTestId("conversation-current-question");
    await currentCard.locator('button[aria-expanded="false"]').evaluate((element) => {
      if (element instanceof HTMLElement) element.click();
    });
    await currentCard.getByRole("textbox", { name: `文字回答：${question.prompt}`, exact: true }).fill(dynamicTexts[index]);
    await currentCard.getByRole("button", { name: "确认回答，继续", exact: true }).click();
    await expect(page.getByText(`补充问题 ${index + 1} · 最多3题 · 理解确认`, { exact: true })).toBeVisible();
    await expect(page.getByText(dynamicTexts[index], { exact: true })).toBeVisible();
    const confirmationCard = page.getByTestId("conversation-current-question");
    const expectedOption = question.options[0];
    const role = question.selection === "single" ? "radio" : "checkbox";
    const confirmationOption = confirmationCard.getByRole(role, { name: expectedOption.label, exact: true });
    if (index === 0) {
      await expect(confirmationOption).toBeChecked();
      await expect(confirmationCard.getByRole("button", { name: "确认理解，继续", exact: true })).toBeEnabled();
    } else {
      await expect(confirmationOption).not.toBeChecked();
      await expect(confirmationCard.getByRole("button", { name: "请先确认一项", exact: true })).toBeDisabled();
      await confirmationOption.evaluate((element) => element.closest("label")?.click());
      await expect(confirmationCard.getByRole("button", { name: "确认理解，继续", exact: true })).toBeEnabled();
    }
    await confirmationCard.getByRole("button", { name: "确认理解，继续", exact: true }).click();
  }

  await expect(page.getByRole("heading", { name: /这些竞赛值得你优先了解/ })).toBeVisible();
  await expect(page.locator("article[aria-labelledby^='recommendation-title-']")).toHaveCount(3);
  await attachScreenshot(page, testInfo, "pure-text-results");

  expect(normalizePayloads).toHaveLength(2);
  const draftQuestionnaire = normalizePayloads[0].questionnaire as {
    version: string;
    answers: Array<{ fieldId: string; selectedValues: string[]; freeText?: string }>;
  };
  expect(draftQuestionnaire.version).toBe("competition-questionnaire.v1");
  expect(draftQuestionnaire.answers).toHaveLength(visibleQuestionIds.length);
  expect(draftQuestionnaire.answers.map(({ fieldId }) => fieldId)).toEqual(visibleQuestionIds);
  expect(new Set(draftQuestionnaire.answers.map(({ fieldId }) => fieldId)).size).toBe(visibleQuestionIds.length);
  expect(draftQuestionnaire.answers.every(({ selectedValues }) => selectedValues.length === 0)).toBe(true);
  expect(draftQuestionnaire.answers.map(({ freeText }) => freeText)).toEqual(pureTextTurns.map(({ text }) => text));
  expect(JSON.stringify(normalizePayloads[0]).length).toBeLessThan(64 * 1024);
  expect(normalizePayloads[1]).toMatchObject({
    questionnaireToken: pendingToken,
    confirmations: pureTextFields.map(({ fieldId, value }) => ({ fieldId, values: [value] }))
  });
  expect(normalizePayloads[1]).not.toHaveProperty("questionnaire");
  expect(normalizePayloads[1]).not.toHaveProperty("profile");
  expect(clarifyPayloads).toHaveLength(7);
  expect(clarifyPayloads[0]).toMatchObject({ questionnaireToken: confirmedToken });
  for (let index = 0; index < dynamicQuestions.length; index += 1) {
    const initial = clarifyPayloads[1 + index * 2];
    const confirmed = clarifyPayloads[2 + index * 2];
    expect(initial).toMatchObject({
      conversationToken: `competition-conversation.v6:pure-text:${index + 1}`,
      answer: { selectedValues: [], note: dynamicTexts[index] }
    });
    expect(confirmed).toMatchObject({
      conversationToken: `competition-conversation.v6:pure-text:${index + 1}`,
      answer: { selectedValues: [dynamicQuestions[index].options[0].value], note: dynamicTexts[index] },
      interpretationConfirmed: true
    });
  }
  expect(recommendPayloads).toEqual([
    expect.objectContaining({ conversationToken: "competition-conversation.v6:pure-text:complete" })
  ]);
  expect(recommendPayloads[0]).not.toHaveProperty("profile");
  expect(requestOrder).toEqual([
    "normalize:draft",
    "normalize:confirm",
    "clarify:begin",
    "clarify:1:text",
    "clarify:1:confirmed",
    "clarify:2:text",
    "clarify:2:confirmed",
    "clarify:3:text",
    "clarify:3:confirmed",
    "recommend"
  ]);
  expect(await page.evaluate(() => window.localStorage.length)).toBe(0);
});

test("DeepSeek 文字 normalization 不可用时保留原文并提供重试和返回修改，不进入画像、追问或推荐", async ({ page, isMobile }) => {
  test.skip(isMobile, "恢复路径在 desktop 跑一次；移动交互由视口矩阵覆盖。");
  const normalizationPayloads: Array<Record<string, unknown>> = [];
  let clarifyRequests = 0;
  let recommendRequests = 0;
  await page.route(`**${NORMALIZE_PATH}`, async (route) => {
    normalizationPayloads.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...normalizeResponse("needs_confirmation", "competition-questionnaire.v1:unavailable:pending"),
        interpretations: [{
          fieldId: "stage",
          explicitValues: ["undergraduate-2"],
          suggestedValues: ["undergraduate-2"],
          source: "model",
          confidence: 0.75,
          status: "ready",
          originalText: "目前是本科二年级",
          evidenceSpan: "本科二年级",
          rationale: "DeepSeek 暂时不可用，不能采纳未确认推断。",
          requiresConfirmation: true,
          allowedOptions: [{ value: "undergraduate-2", label: "本科大二" }]
        }],
        fallbackReason: "provider_unavailable"
      })
    });
  });
  await page.route(`**${CLARIFY_PATH}`, async (route) => {
    clarifyRequests += 1;
    await route.abort();
  });
  await page.route(`**${RECOMMEND_PATH}`, async (route) => {
    recommendRequests += 1;
    await route.abort();
  });

  await page.goto("/competitions/recommend");
  await openDeepQuestions(page);
  await answerDecisionQuestions(page, "目前是本科二年级");
  await consentAndStart(page);
  await expect(page.getByRole("heading", { name: "抱歉，这次没有顺利完成匹配。", exact: true })).toBeVisible();
  await expect(page.getByText(/DeepSeek 暂时无法完成文字理解。原回答已经保留/)).toBeVisible();
  await expect(page.getByRole("button", { name: "请乐乐原地重试", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "返回修改答案", exact: true })).toBeVisible();
  await expect(page.locator("article[aria-labelledby^='recommendation-title-']")).toHaveCount(0);
  expect(normalizationPayloads).toHaveLength(1);
  expect(clarifyRequests).toBe(0);
  expect(recommendRequests).toBe(0);
  await page.getByRole("button", { name: "返回修改答案", exact: true }).click();
  await expect(page.locator('[data-turn-id="stage"]')).toContainText(
    "你现在或最近处于哪个学习阶段：本科大二；你目前的全日制与毕业状态是：全日制在读；补充：目前是本科二年级"
  );
  await page.locator('[data-turn-id="stage"]').getByRole("button", { name: "修改这条回答", exact: true, includeHidden: true }).click();
  const restoredText = page.getByRole("textbox", { name: "文字回答：你现在处于哪个学习阶段？", exact: true });
  await expect(restoredText).toBeVisible();
  await expect(restoredText).toHaveValue("目前是本科二年级");
  await expect(page.getByRole("radio", { name: "本科大二", exact: true })).toBeChecked();
  expect(clarifyRequests).toBe(0);
  expect(recommendRequests).toBe(0);
});

test("已返回三项时显示对应推荐卡，修改基础答案会清除旧追问和推荐状态", async ({ page }) => {
  const mocks = await mockOptionFlow(page, { prefix: "quality-backfill" });
  await page.goto("/competitions/recommend");
  await openDeepQuestions(page);
  await answerDecisionQuestions(page);
  await consentAndStart(page);
  await selectCheckbox(page, "软件工程与系统交付");
  await page.getByRole("button", { name: "确认回答，继续", exact: true }).click();
  await selectRadio(page, "项目经历");
  await page.getByRole("button", { name: "确认回答，继续", exact: true }).click();
  await expect(page.getByRole("heading", { name: "这些竞赛值得你优先了解", exact: true })).toBeVisible();
  await expect(page.locator("article[aria-labelledby^='recommendation-title-']")).toHaveCount(3);
  await expect(page.getByText("这次暂时没有找到足够匹配的竞赛。", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("conversation-transcript-clarification")).toHaveCount(2);
  await page.getByText("回看与修改问答记录", {exact:true}).click();
  await page.getByTestId("conversation-transcript-turn").first().getByRole("button", {
    name: "修改这条回答",
    exact: true
  }).click();
  await expect(page.getByTestId("conversation-current-question").getByText("你最希望这次参赛帮你得到什么？", {exact:true})).toBeVisible();
  await expect(page.getByTestId("conversation-transcript-clarification")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "这些竞赛值得你优先了解", exact: true })).toHaveCount(0);
  expect(mocks.recommendPayloads).toHaveLength(1);
});

test("有三项明确匹配时可直接保存快照", async ({ page }) => {
  const [first, ...rest] = syntheticAiSuccessResponse.recommendations;
  await mockOptionFlow(page, { prefix: "three-match", result: {
    ...syntheticAiSuccessResponse, recommendations: [{...first, recommendedTrack:{id:"historical-track",label:"历史实验赛道"}}, ...rest]
  }});
  await page.goto("/competitions/recommend");
  await openDeepQuestions(page);
  await answerDecisionQuestions(page);
  await consentAndStart(page);
  await selectCheckbox(page, "软件工程与系统交付");
  await page.getByRole("button", { name: "确认回答，继续", exact: true }).click();
  await selectRadio(page, "项目经历");
  await page.getByRole("button", { name: "确认回答，继续", exact: true }).click();
  await expect(page.getByRole("heading", { name: "这些竞赛值得你优先了解", exact: true })).toBeVisible();
  await expect(page.locator("article[aria-labelledby^='recommendation-title-']")).toHaveCount(3);
  await expect(page.getByText("这次暂时没有找到足够匹配的竞赛。", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "联系 Emily 学姐" })).toHaveAttribute("href", "/about#contact");
  await page.getByRole("button", { name: /保存并打开/ }).click();
  await expect(page).toHaveURL(/\/competitions\/saved$/);
  await expect(page.getByText("已保存 3 项", { exact: true })).toBeVisible();
  await expect(page.getByTestId("saved-competition-item")).toHaveCount(3);
  const persisted = await page.evaluate(() => ({
    keys: Object.keys(window.localStorage),
    raw: window.localStorage.getItem("saitu.savedCompetitions.v1") ?? "",
    sessionLength: window.sessionStorage.length
  }));
  expect(persisted.keys).toEqual(["saitu.savedCompetitions.v1"]);
  expect(persisted.sessionLength).toBe(0);
  expect(persisted.raw).not.toContain("competition-conversation.v5");
  expect(persisted.raw).not.toContain("competition-conversation.v6");
  expect(persisted.raw).not.toContain("computer-science");
  expect(JSON.parse(persisted.raw)).toMatchObject({
    schemaVersion: "saitu.savedCompetitions.v2",
    entries: expect.arrayContaining([
      expect.objectContaining({
        recommendation: expect.objectContaining({
          baseMatchScore: expect.any(Number),
          matchScore: expect.any(Number),
          scoreCalibration: expect.objectContaining({
            version: "competition-score-calibration.v1"
          })
        })
      })
    ])
  });

  await page.reload();
  await expect(page.getByText("已保存 3 项", { exact: true })).toBeVisible();
  const reloadedItems = page.getByTestId("saved-competition-item");
  await expect(reloadedItems).toHaveCount(3);
  await expect(reloadedItems.first()).toContainText("保存时的赛道：历史实验赛道");
  await expect(reloadedItems.first()).toContainText("当前目录中的赛道已有变化");
  await expect(reloadedItems).toContainText([
    "综合匹配分",
    "综合匹配分",
    "综合匹配分"
  ]);
});

test("同一页面连续两轮均使用新会话且不持久化问题历史", async ({ page, isMobile }) => {
  test.skip(isMobile, "跨轮会话在 desktop 验证一次；移动结果布局由视口矩阵覆盖。");
  const clarifyPayloads: Array<Record<string, unknown>> = [];
  const normalizeIdempotencyKeys: string[] = [];
  let normalizationRound = 0;

  await page.route(`**${NORMALIZE_PATH}`, async (route) => {
    normalizationRound += 1;
    normalizeIdempotencyKeys.push(route.request().headers()["idempotency-key"] ?? "");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(normalizeResponse(
        "confirmed",
        `competition-questionnaire.v1:history-round-${normalizationRound}:confirmed`
      ))
    });
  });
  await page.route(`**${CLARIFY_PATH}`, async (route) => {
    const payload = route.request().postDataJSON() as Record<string, unknown>;
    clarifyPayloads.push(payload);
    const recentSignalKeys = Array.isArray(payload.recentSignalKeys)
      ? payload.recentSignalKeys.filter((value): value is string => typeof value === "string")
      : [];
    const isRoundStart = "questionnaireToken" in payload;
    const nextQuestion = isRoundStart
      ? recentSignalKeys.includes(dynamicQuestions[0].signalKey)
        ? dynamicQuestions[1]
        : dynamicQuestions[0]
      : null;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        responseVersion: "competition-clarification.v6",
        status: nextQuestion ? "question" : "completed",
        nextQuestion,
        conversationToken: nextQuestion
          ? `competition-conversation.v6:history:${nextQuestion.signalKey}`
          : `competition-conversation.v6:history:complete-${clarifyPayloads.length}`,
        askedQuestionCount: nextQuestion ? 0 : 1,
        promptVersion: CLARIFY_PROMPT_VERSION,
        model: "e2e-history-aware-question",
        provider: "deepseek",
        fallback: false
      })
    });
  });
  await page.route(`**${RECOMMEND_PATH}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(syntheticAiSuccessResponse)
    });
  });

  await page.goto("/competitions/recommend");
  await openDeepQuestions(page);
  await answerDecisionQuestions(page);
  await consentAndStart(page);
  await expect(page.getByText(dynamicQuestions[0].prompt, { exact: true })).toBeVisible();
  await selectCheckbox(page, dynamicQuestions[0].options[0].label);
  await page.getByRole("button", { name: "确认回答，继续", exact: true }).click();
  await expect(page.getByRole("heading", { name: /这些竞赛值得你优先了解/ })).toBeVisible();

  await page.getByRole("button", { name: "重新开始", exact: true }).click();
  await openDeepQuestions(page);
  await answerDecisionQuestions(page);
  await consentAndStart(page);
  await expect(page.getByText(dynamicQuestions[0].prompt, { exact: true })).toBeVisible();
  await selectCheckbox(page, dynamicQuestions[0].options[0].label);
  await page.getByRole("button", { name: "确认回答，继续", exact: true }).click();
  await expect(page.getByRole("heading", { name: /这些竞赛值得你优先了解/ })).toBeVisible();

  expect(clarifyPayloads).toHaveLength(4);
  expect(clarifyPayloads[0]).toMatchObject({ recentSignalKeys: [] });
  expect(clarifyPayloads[1]).toMatchObject({
    recentSignalKeys: [dynamicQuestions[0].signalKey]
  });
  expect(clarifyPayloads[2]).toMatchObject({
    recentSignalKeys: []
  });
  expect(clarifyPayloads[3]).toMatchObject({
    recentSignalKeys: [dynamicQuestions[0].signalKey]
  });
  expect(normalizeIdempotencyKeys).toHaveLength(2);
  expect(normalizeIdempotencyKeys.every(Boolean)).toBe(true);
  expect(normalizeIdempotencyKeys[1]).not.toBe(normalizeIdempotencyKeys[0]);
  expect(await page.evaluate(() => ({
    localKeys: Object.keys(window.localStorage),
    sessionKeys: Object.keys(window.sessionStorage)
  }))).toEqual({ localKeys: [], sessionKeys: [] });
});

test("信息已足够时可以跳过可选偏好题并直接查看推荐", async ({ page }) => {
  const mocks = await mockOptionalFlow(page, "optional-skip");
  await page.goto("/competitions/recommend");
  await openDeepQuestions(page);
  await answerDecisionQuestions(page);
  await consentAndStart(page);
  await expect(page.getByRole("heading", { name: "当前信息已经足够，可以直接查看推荐。", exact: true })).toBeVisible();
  await expect(page.getByText("你也可以再回答一个偏好问题，用于完善匹配说明，但结果可能保持不变。", { exact: true })).toBeVisible();
  await expect(page.getByText(/已核对且符合|仍需核对|已确认不符合|可参加赛道/)).toHaveCount(0);
  await page.getByRole("button", { name: "直接查看推荐", exact: true }).click();
  await expect(page.getByRole("heading", { name: /这些竞赛值得你优先了解/ })).toBeVisible();
  await expect(page.getByText(/补充问题 1/)).toHaveCount(0);
  expect(mocks.clarifyPayloads).toHaveLength(2);
  expect(mocks.clarifyPayloads[1]).toMatchObject({
    conversationToken: "competition-conversation.v6:optional-skip:optional",
    action: "skip_optional"
  });
  expect(mocks.clarifyPayloads[1]).not.toHaveProperty("answer");
});

test("信息已足够时也可主动回答一个目标偏好题", async ({ page }) => {
  const mocks = await mockOptionalFlow(page, "optional-answer");
  await page.goto("/competitions/recommend");
  await openDeepQuestions(page);
  await answerDecisionQuestions(page);
  await consentAndStart(page);
  await page.getByRole("button", { name: "再回答一个偏好问题", exact: true }).click();
  await expect(page.getByText("补充问题 1 · 最多3题", { exact: true })).toBeVisible();
  await expect(page.getByText(mocks.optionalQuestion.prompt, { exact: true })).toBeVisible();
  await expectCurrentDynamicQuestionPreferenceOnly(page);
  await selectRadio(page, "项目经历");
  await page.getByRole("button", { name: "确认回答，继续", exact: true }).click();
  await expect(page.getByRole("heading", { name: /这些竞赛值得你优先了解/ })).toBeVisible();
  expect(mocks.clarifyPayloads).toHaveLength(2);
  expect(mocks.clarifyPayloads[1]).toMatchObject({
    conversationToken: "competition-conversation.v6:optional-answer:optional",
    answer: { selectedValues: ["project"] }
  });
});

test("三种视口在正常与减弱动画模式下完整验证深入问答、回退、历史修改和动态确认的滚动焦点", async ({ page, isMobile }, testInfo) => {
  test.setTimeout(360_000);
  const allViewports = isMobile
    ? [{ width: 390, height: 844 }]
    : [{ width: 1280, height: 720 }, { width: 1440, height: 900 }];
  const viewportFilter = process.env.COMPETITION_SCROLL_VIEWPORT;
  const viewports = viewportFilter
    ? allViewports.filter(({ width, height }) => `${width}x${height}` === viewportFilter)
    : allViewports;
  const motionFilter = process.env.COMPETITION_SCROLL_MOTION;
  const motionModes: readonly ("no-preference" | "reduce")[] = motionFilter === "no-preference" || motionFilter === "reduce"
    ? [motionFilter]
    : ["no-preference", "reduce"];
  expect(viewports.length, `未找到调试视口 ${viewportFilter ?? ""}`).toBeGreaterThan(0);
  for (const viewport of viewports) {
    for (const reducedMotion of motionModes) {
      const prefix = `scroll-${viewport.width}x${viewport.height}-${reducedMotion}`;
      const mocks = await mockScrollMatrixFlow(page, prefix);
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion });
      await page.goto("/competitions/recommend");
      await openDeepQuestions(page);
      await expect(page.getByTestId("conversation-current-question")).toHaveCount(1);

      for (let index = 0; index < fixedTurnFixtures.length; index += 1) {
        const fixture = fixedTurnFixtures[index];
        if (index === 0) {
          await expect(page.getByTestId("conversation-current-question").getByTestId("conversation-question-prompt").first()).toBeInViewport();
        } else {
          await expectQuestionAlignedBelowStickyHeader(page, fixture.focusLabel);
        }
        await expectActionBarUsable(page);

        if (index === 0) {
          await expectTextareaExpansionAndTypingStable(
            page,
            pureTextTurns[0].prompt,
            "目前在读本科二年级，课程方向偏工科",
            { clearAfter: true }
          );
        }

        if (index === 1) {
          const back = page.getByTestId("question-action-bar").getByRole("button", {
            name: "← 上一步",
            exact: true
          });
          await expectButtonOperable(back);
          await back.click();
          await expectQuestionAlignedBelowStickyHeader(page, fixedTurnFixtures[0].focusLabel);
          await expectActionBarUsable(page);
          await expect(page.getByRole("checkbox", { name: "积累项目经历", exact: true })).toBeChecked();
          const returnToSecond = page.getByTestId("question-action-bar").getByRole("button", {
            name: "回答好了，继续",
            exact: true
          });
          await expectButtonOperable(returnToSecond);
          await returnToSecond.click();
          await expectQuestionAlignedBelowStickyHeader(page, fixture.focusLabel);
          await expectActionBarUsable(page);
        }

        await selectFixedTurnFixture(page, fixture);
        const continueButton = page.getByTestId("question-action-bar").getByRole("button", {
          name: "回答好了，继续",
          exact: true
        });
        await expectButtonOperable(continueButton);
        await expectActionBarUsable(page);
        await continueButton.click();
      }

      await expect(page.getByRole("heading", { name: /上面的每条回答都可以直接修改/ })).toBeVisible();
      const historyTurns = page.getByTestId("conversation-transcript-turn");
      await expect(historyTurns).toHaveCount(visibleQuestionIds.length);
      await historyTurns.last().getByRole("button", { name: "修改这条回答", exact: true, includeHidden: true }).click();
      await expectQuestionAlignedBelowStickyHeader(page, fixedTurnFixtures.at(-1)!.focusLabel);
      await expectActionBarUsable(page);
      await expect(page.getByRole("radio", { name: "线上为主", exact: true })).toBeChecked();
      await selectRadio(page, "形式都可以");
      const finishHistoryEdit = page.getByTestId("question-action-bar").getByRole("button", {
        name: "回答好了，继续",
        exact: true
      });
      await expectButtonOperable(finishHistoryEdit);
      await finishHistoryEdit.click();
      await expect(page.getByRole("heading", { name: /上面的每条回答都可以直接修改/ })).toBeVisible();
      await expect(historyTurns.last()).toContainText("形式都可以");

      await consentAndStart(page);
      await expect(page.getByText("补充问题 1 · 最多3题", { exact: true })).toBeVisible();
      await expectQuestionAlignedBelowStickyHeader(page, dynamicQuestions[0].prompt);
      await expectActionBarUsable(page);
      const dynamicText = "我最想证明软件工程与系统交付能力";
      await expectTextareaExpansionAndTypingStable(page, dynamicQuestions[0].prompt, dynamicText);
      const submitDynamicText = page.getByTestId("question-action-bar").getByRole("button", {
        name: "确认回答，继续",
        exact: true
      });
      await expectButtonOperable(submitDynamicText);
      await expectActionBarUsable(page);
      await submitDynamicText.click();

      await expect(page.getByText("补充问题 1 · 最多3题 · 理解确认", { exact: true })).toBeVisible();
      await expectQuestionAlignedBelowStickyHeader(page, dynamicQuestions[0].prompt);
      await expectActionBarUsable(page);
      await expect(page.getByRole("checkbox", { name: "软件工程与系统交付", exact: true })).toBeChecked();
      const confirmDynamicInterpretation = page.getByTestId("question-action-bar").getByRole("button", {
        name: "确认理解，继续",
        exact: true
      });
      await expectButtonOperable(confirmDynamicInterpretation);
      await confirmDynamicInterpretation.click();

      await expect(page.getByText("补充问题 2 · 最多3题", { exact: true })).toBeVisible();
      await expectQuestionAlignedBelowStickyHeader(page, dynamicQuestions[1].prompt);
      await expectActionBarUsable(page);
      await selectRadio(page, "项目经历");
      const finishDynamicQuestions = page.getByTestId("question-action-bar").getByRole("button", {
        name: "确认回答，继续",
        exact: true
      });
      await expectButtonOperable(finishDynamicQuestions);
      await expectActionBarUsable(page);
      await finishDynamicQuestions.click();
      await expect(page.getByRole("heading", { name: /这些竞赛值得你优先了解/ })).toBeVisible();
      expect(mocks.clarificationPayloads).toHaveLength(4);
      expect(mocks.clarificationPayloads[0]).toMatchObject({ questionnaireToken: mocks.questionnaireToken });
      expect(mocks.clarificationPayloads[1]).toMatchObject({
        answer: { selectedValues: [], note: dynamicText }
      });
      expect(mocks.clarificationPayloads[2]).toMatchObject({
        answer: { selectedValues: ["software-engineering"], note: dynamicText }
      });
      await attachScreenshot(page, testInfo, `${viewport.width}x${viewport.height}-${reducedMotion}`);
    }
  }
});
