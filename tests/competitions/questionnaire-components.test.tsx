import { DecisionPreferences } from "@/components/competitions/recommend/DecisionPreferences";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ClarificationQuestionCard } from "@/components/competitions/recommend/ClarificationQuestionCard";
import {
  ConversationHistory,
  FixedConversationQuestion
} from "@/components/competitions/recommend/ConversationUI";
import {
  QuestionnaireInterpretationReview
} from "@/components/competitions/recommend/QuestionnaireInterpretationReview";
import { fixedQuestionTurns } from "@/components/competitions/recommend/questionFlow";
import type { CompetitionDynamicQuestionV3 } from "@/types/competition-recommendation";

const completeProfile = {
  stage: "undergraduate-2" as const,
  enrollmentStatus: "full-time-student" as const,
  majorFields: ["computer-science" as const],
  specificSubjects: ["information-communication" as const],
  skills: ["programming" as const],
  interests: ["ai" as const],
  experienceLevel: "participated" as const,
  evidence: ["prototype" as const],
  goals: ["project" as const],
  preferredOutputs: ["software" as const],
  startingPoint: "coursework" as const,
  weeklyCommitment: "5-10" as const,
  teamStatus: "looking" as const,
  teamSize: "unsure" as const,
  teamUnit: "unsure" as const,
  availableResources: ["mentor" as const],
  participationMode: "remote" as const,
  participationTiming: "within-3-months" as const,
  taskFormats: ["software" as const]
};

const dynamicQuestion: CompetitionDynamicQuestionV3 = {
  questionId: "dq_dynamic_1",
  signalKey: "track:example-competition",
  prompt: "你更希望优先完成哪类作品验证？",
  selection: "multiple",
  options: [
    { value: "demo", label: "可演示原型" },
    { value: "research", label: "研究证据" }
  ],
  maxSelections: 2,
  allowsNote: true,
  maxNoteLength: 120,
  impact: "material",
  estimatedPreferenceOutcomeChanges: 2
};

describe("competition questionnaire components", () => {
  beforeAll(() => vi.stubGlobal("React", React));
  afterAll(() => vi.unstubAllGlobals());

  it("offers finance task preferences without adding a question or forcing a value", () => {
    const turn = fixedQuestionTurns.find(item => item.id === "taskFormats")!;
    const finance = renderToStaticMarkup(<DecisionPreferences turn={turn} profile={{majorFields:["finance-taxation"]}} context={{}} onChange={vi.fn()} />);
    expect(finance).toContain("用经营沙盘做决策");
    expect(finance).toContain("识别税务风险");
    expect(finance).toContain("还没想好");
    const unrelated = renderToStaticMarkup(<DecisionPreferences turn={turn} profile={{majorFields:["medicine"]}} context={{}} onChange={vi.fn()} />);
    expect(unrelated).not.toContain("用经营沙盘做决策");
  });

  it("keeps answered questions permanently expanded as editable dialogue", () => {
    const html = renderToStaticMarkup(
      <ConversationHistory
        currentTurnId="experienceLevel"
        onEdit={vi.fn()}
        profile={completeProfile}
      />
    );

    expect(html).not.toContain("<details");
    expect(html).toContain("data-testid=\"conversation-transcript\"");
    expect(html.match(/data-testid=\"conversation-transcript-turn\"/g)).toHaveLength(8);
    expect(html.match(/修改这条回答/g)).toHaveLength(8);
    expect(html).toContain("min-h-11");
    expect(html).toContain("问题 1/14 · 学业背景");
    expect(html).toContain("本科大二");
    expect(html).not.toContain("你现在有哪些可以继续打磨或展示的成果？");
  });

  it("does not render an empty transcript before the first answer", () => {
    const html = renderToStaticMarkup(
      <ConversationHistory currentTurnId="stage" onEdit={vi.fn()} profile={{}} />
    );

    expect(html).toBe("");
  });

  it("places fixed and dynamic exchanges in the same expanded transcript", () => {
    const html = renderToStaticMarkup(
      <ConversationHistory
        clarificationAnswers={{
          [dynamicQuestion.questionId]: {
            selectedValues: ["demo"],
            note: "周末可以集中完善"
          }
        }}
        clarificationQuestions={[dynamicQuestion]}
        onEdit={vi.fn()}
        onEditClarification={vi.fn()}
        profile={completeProfile}
      />
    );

    expect(html).not.toContain("<details");
    expect(html.match(/data-testid=\"conversation-transcript-turn\"/g)).toHaveLength(14);
    expect(html.match(/data-testid=\"conversation-transcript-clarification\"/g)).toHaveLength(1);
    expect(html).toContain(dynamicQuestion.prompt);
    expect(html).toContain("可演示原型；补充：周末可以集中完善");
    expect(html.match(/修改这条回答/g)).toHaveLength(15);
  });

  it("supports option answers together with a 120-character free note", () => {
    const question = dynamicQuestion;
    const html = renderToStaticMarkup(
      <ClarificationQuestionCard
        answer={{ selectedValues: ["demo"], note: "我的方向比较交叉" }}
        index={0}
        onBack={vi.fn()}
        onConfirm={vi.fn()}
        onNoteChange={vi.fn()}
        onSelectedValuesChange={vi.fn()}
        question={question}
        total={3}
      />
    );

    expect(html).toContain("补充问题 1 · 最多3题");
    expect(html).toContain("收起文字回答");
    expect(html).toContain("可以只填写这里，也可以配合上面的选项补充");
    expect(html).toContain("maxLength=\"120\"");
    expect(html).toContain("我的方向比较交叉");
    expect(html).toContain("确认回答，继续");
  });

  it("allows a pure text answer without selecting a preset option", () => {
    const html = renderToStaticMarkup(
      <ClarificationQuestionCard
        answer={{ selectedValues: [], note: "我的方向比较交叉" }}
        index={0}
        onBack={vi.fn()}
        onConfirm={vi.fn()}
        onNoteChange={vi.fn()}
        onSelectedValuesChange={vi.fn()}
        question={dynamicQuestion}
        total={3}
      />
    );

    expect(html).toContain("确认回答，继续");
    expect(html).not.toContain("disabled=\"\"");
  });

  it("renders dynamic free-text interpretation as an inline, explicit whitelist confirmation", () => {
    const html = renderToStaticMarkup(
      <ClarificationQuestionCard
        answer={{ selectedValues: [], note: "可演示原型" }}
        answerConfirmation={{
          allowedOptions: [...dynamicQuestion.options],
          originalText: "可演示原型",
          questionId: dynamicQuestion.questionId,
          rationale: "文字回答与当前白名单选项唯一对应。",
          resolvedValues: ["demo"],
          status: "ready",
          suggestedValues: ["demo"]
        }}
        index={0}
        onAnswerConfirmationCancel={vi.fn()}
        onAnswerConfirmationConfirm={vi.fn()}
        onAnswerConfirmationValuesChange={vi.fn()}
        onBack={vi.fn()}
        onConfirm={vi.fn()}
        onNoteChange={vi.fn()}
        onSelectedValuesChange={vi.fn()}
        question={dynamicQuestion}
        total={3}
      />
    );

    expect(html).toContain("补充问题 1 · 最多3题 · 理解确认");
    expect(html).toContain("你的原文");
    expect(html).toContain("可演示原型");
    expect(html).toContain("追问回答只用于偏好匹配，不会用于资格判定");
    expect(html).toContain("只有这些白名单选项可用于匹配");
    expect(html).toContain("确认理解，继续");
    expect(html).toContain("← 修改原回答");
    expect(html).not.toContain("<textarea");
  });

  it("keeps an unmapped dynamic text answer blocked until the user chooses an allowed option", () => {
    const html = renderToStaticMarkup(
      <ClarificationQuestionCard
        answer={{ selectedValues: [], note: "我的方向比较交叉" }}
        answerConfirmation={{
          allowedOptions: [...dynamicQuestion.options],
          originalText: "我的方向比较交叉",
          questionId: dynamicQuestion.questionId,
          rationale: "自由文字无法唯一对应当前选项。",
          resolvedValues: [],
          status: "unmapped",
          suggestedValues: []
        }}
        index={0}
        onAnswerConfirmationCancel={vi.fn()}
        onAnswerConfirmationConfirm={vi.fn()}
        onAnswerConfirmationValuesChange={vi.fn()}
        onBack={vi.fn()}
        onConfirm={vi.fn()}
        onNoteChange={vi.fn()}
        onSelectedValuesChange={vi.fn()}
        question={dynamicQuestion}
        total={3}
      />
    );

    expect(html).toContain("暂时无法可靠归类，请你决定");
    expect(html).toContain("请先确认一项");
    expect(html).toContain("disabled");
  });

  it("blocks a free note containing personal or school information", () => {
    const question = dynamicQuestion;
    const html = renderToStaticMarkup(
      <ClarificationQuestionCard
        answer={{ selectedValues: ["demo"], note: "我是星河大学的学生" }}
        index={0}
        onBack={vi.fn()}
        onConfirm={vi.fn()}
        onNoteChange={vi.fn()}
        onSelectedValuesChange={vi.fn()}
        question={question}
        total={1}
      />
    );

    expect(html).toContain("请删除姓名、学校、手机号、邮箱或其他个人信息后再继续。");
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="clarification-dq_dynamic_1-free-text-hint clarification-dq_dynamic_1-free-text-count clarification-dq_dynamic_1-free-text-error"');
    expect(html).toContain("disabled");
  });

  it("allows a text-only fixed answer and blocks it when it contains personal information", () => {
    const turn = fixedQuestionTurns[0];
    const validHtml = renderToStaticMarkup(
      <FixedConversationQuestion
        canGoBack={false}
        index={0}
        onAnswer={vi.fn()}
        onBack={vi.fn()}
        onConfirm={vi.fn()}
        onFreeTextChange={vi.fn()}
        profile={{}}
        textAnswers={{ stage: "目前在读本科二年级，全日制在读" }}
        turn={turn}
      />
    );
    const invalidHtml = renderToStaticMarkup(
      <FixedConversationQuestion
        canGoBack={false}
        index={0}
        onAnswer={vi.fn()}
        onBack={vi.fn()}
        onConfirm={vi.fn()}
        onFreeTextChange={vi.fn()}
        profile={{ stage: "undergraduate-2", enrollmentStatus: "full-time-student" }}
        textAnswers={{ stage: "我是星河大学的学生" }}
        turn={turn}
      />
    );

    expect(validHtml).toContain("回答好了，继续");
    expect(validHtml).toContain("目前在读本科二年级");
    expect(invalidHtml).toContain("请删除姓名、学校、手机号、邮箱或其他个人信息后再继续。");
    expect(invalidHtml).toContain("请选择或填写");
  });

  it.each(["王小华", "北理读大三", "wx：12345678"])(
    "shows the shared privacy error for an expanded PII form: %s",
    (freeText) => {
      const turn = fixedQuestionTurns[0];
      const html = renderToStaticMarkup(
        <FixedConversationQuestion
          canGoBack={false}
          index={0}
          onAnswer={vi.fn()}
          onBack={vi.fn()}
          onConfirm={vi.fn()}
          onFreeTextChange={vi.fn()}
          profile={{ stage: "undergraduate-2", enrollmentStatus: "full-time-student" }}
          textAnswers={{ stage: freeText }}
          turn={turn}
        />
      );

      expect(html).toContain("请删除姓名、学校、手机号、邮箱或其他个人信息后再继续。");
      expect(html).toContain('aria-invalid="true"');
      expect(html).toContain("请选择或填写");
    }
  );

  it("shows both subanswers in the combined experience history turn", () => {
    const html = renderToStaticMarkup(
      <ConversationHistory
        fixedQuestionTextAnswers={{ experienceLevel: "还有一份课程调研报告" }}
        onEdit={vi.fn()}
        profile={completeProfile}
      />
    );

    expect(html).toContain("你目前的竞赛经历最接近哪种情况：参加过，但还没有完整项目或奖项");
    expect(html).toContain("你现在有哪些可以继续打磨或展示的成果：可演示原型或代码；补充：还有一份课程调研报告");
  });

  it("requires explicit confirmation of every interpreted text answer", () => {
    const baseItem = {
      allowedOptions: [
        { value: "undergraduate-1", label: "本科大一" },
        { value: "undergraduate-2", label: "本科大二" }
      ],
      explicitValues: [] as string[],
      fieldId: "stage" as const,
      label: "你现在处于哪个学习阶段？",
      maxSelections: 1,
      minSelections: 1,
      originalText: "目前在读本科二年级",
      rationale: "文字回答与本科大二选项唯一对应。",
      requiresConfirmation: true,
      selection: "single" as const,
      status: "ready" as const,
      suggestedValues: ["undergraduate-2"]
    };
    const unresolvedHtml = renderToStaticMarkup(
      <QuestionnaireInterpretationReview
        items={[{ ...baseItem, resolvedValues: [] }]}
        onBack={vi.fn()}
        onConfirm={vi.fn()}
        onResolvedValuesChange={vi.fn()}
      />
    );
    const confirmedHtml = renderToStaticMarkup(
      <QuestionnaireInterpretationReview
        items={[{ ...baseItem, resolvedValues: ["undergraduate-2"] }]}
        onBack={vi.fn()}
        onConfirm={vi.fn()}
        onResolvedValuesChange={vi.fn()}
      />
    );

    expect(unresolvedHtml).toContain("你的原文");
    expect(unresolvedHtml).toContain("乐乐初步理解为：");
    expect(unresolvedHtml).toContain("还有 1 项需要确认");
    expect(unresolvedHtml).toContain("disabled");
    expect(confirmedHtml).toContain("所有文字回答都已确认");
    expect(confirmedHtml).toContain("确认结构化理解并继续");
  });
});
