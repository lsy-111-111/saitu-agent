"use client";

import type { Ref } from "react";
import { ChoiceGroup } from "@/components/competitions/recommend/ChoiceGroup";
import { FreeTextAnswer } from "@/components/competitions/recommend/FreeTextAnswer";
import {
  AgentMessage,
  QuestionActionBar
} from "@/components/competitions/recommend/ConversationUI";
import {
  isCompetitionAnswerTextValid,
  normalizeCompetitionAnswerText
} from "@/components/competitions/recommend/answerText";
import {
  isDynamicAnswerConfirmationResolved,
  type DynamicAnswerConfirmation
} from "@/components/competitions/recommend/dynamicAnswerConfirmation";
import type {
  CompetitionClarificationAnswer,
  CompetitionDynamicQuestionV3
} from "@/types/competition-recommendation";

type ClarificationQuestionCardProps = {
  answer: CompetitionClarificationAnswer | undefined;
  answerConfirmation?: DynamicAnswerConfirmation | null;
  index: number;
  onAnswerConfirmationCancel?: () => void;
  onAnswerConfirmationConfirm?: () => void;
  onAnswerConfirmationValuesChange?: (values: string[]) => void;
  onBack: () => void;
  onConfirm: () => void;
  onNoteChange: (note: string) => void;
  onSelectedValuesChange: (values: string[]) => void;
  promptRef?: Ref<HTMLLegendElement>;
  question: CompetitionDynamicQuestionV3;
  total: number;
};

export function ClarificationQuestionCard({
  answer,
  answerConfirmation,
  index,
  onAnswerConfirmationCancel,
  onAnswerConfirmationConfirm,
  onAnswerConfirmationValuesChange,
  onBack,
  onConfirm,
  onNoteChange,
  onSelectedValuesChange,
  promptRef,
  question,
  total
}: ClarificationQuestionCardProps) {
  const selectedValues = answer?.selectedValues ?? [];
  const note = answer?.note ?? "";
  const normalizedNote = normalizeCompetitionAnswerText(note, question.maxNoteLength);
  const noteValid = !normalizedNote || isCompetitionAnswerTextValid(note, question.maxNoteLength);
  const complete = (selectedValues.length > 0 || Boolean(normalizedNote)) && noteValid;

  if (answerConfirmation?.questionId === question.questionId) {
    const confirmationComplete = isDynamicAnswerConfirmationResolved(answerConfirmation, question);
    const suggestionLabels = answerConfirmation.suggestedValues.map((value) =>
      answerConfirmation.allowedOptions.find((option) => option.value === value)?.label ?? value
    );
    const statusLabel = answerConfirmation.status === "conflict"
      ? "原回答存在冲突，请你决定"
      : answerConfirmation.status === "ambiguous"
        ? "原回答有多种理解，请你决定"
        : suggestionLabels.length > 0
          ? "已找到可能理解，等待你确认"
          : "暂时无法可靠归类，请你决定";

    return (
      <AgentMessage>
        <p className="mb-3 text-xs font-semibold text-brand-600">
          补充问题 {index + 1} · 最多{total}题 · 理解确认
        </p>
        <div className="pb-24">
          <fieldset>
            <legend
              className="text-base font-semibold leading-7 text-ink outline-none md:text-[17px]"
              data-testid="conversation-question-prompt"
              ref={promptRef}
              tabIndex={-1}
            >
              {question.prompt}
            </legend>
            <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
              这是确认步骤，不另外计入追问数。追问回答只用于偏好匹配，不会用于资格判定。
            </p>
          </fieldset>

          <div className="mt-5 rounded-[16px] border border-brand-200 bg-brand-50/60 px-4 py-3.5">
            <p className="text-xs font-semibold text-muted-foreground">你的原文</p>
            <p className="mt-1 break-words text-sm leading-6 text-ink">
              {answerConfirmation.originalText}
            </p>
          </div>

          <div aria-live="polite" className="mt-4 rounded-[16px] border border-border bg-white px-4 py-3.5">
            <p className="text-sm font-semibold text-ink">{statusLabel}</p>
            {suggestionLabels.length > 0 ? (
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                乐乐初步理解为：
                <strong className="font-semibold text-ink">{suggestionLabels.join("、")}</strong>
              </p>
            ) : null}
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              理解依据：{answerConfirmation.rationale}
            </p>
          </div>

          <div className="mt-5 border-t border-border pt-5">
            <ChoiceGroup
              compact
              disabled={!onAnswerConfirmationValuesChange}
              hint={question.selection === "multiple"
                ? `请确认 1–${question.maxSelections ?? answerConfirmation.allowedOptions.length} 项；只有这些白名单选项可用于匹配`
                : "请确认一项；只有这些白名单选项可用于匹配"}
              label="确认后的结构化答案"
              maxSelections={question.selection === "single" ? 1 : question.maxSelections}
              multiple={question.selection === "multiple"}
              name={`clarification-confirmation-${question.questionId}`}
              onChange={(value) => onAnswerConfirmationValuesChange?.(
                Array.isArray(value) ? value : [value]
              )}
              options={answerConfirmation.allowedOptions}
              value={answerConfirmation.resolvedValues}
            />
          </div>
        </div>

        <QuestionActionBar
          backLabel="修改原回答"
          canGoBack={Boolean(onAnswerConfirmationCancel)}
          confirmDisabled={!confirmationComplete || !onAnswerConfirmationConfirm}
          confirmLabel={confirmationComplete ? "确认理解，继续" : "请先确认一项"}
          onBack={() => onAnswerConfirmationCancel?.()}
          onConfirm={() => onAnswerConfirmationConfirm?.()}
        />
      </AgentMessage>
    );
  }

  return (
    <AgentMessage>
      <p className="mb-3 text-xs font-semibold text-brand-600">
        补充问题 {index + 1} · 最多{total}题
      </p>
      <div className="pb-24">
        <ChoiceGroup
          hint={question.selection === "multiple"
            ? `最多选择 ${question.maxSelections ?? 2} 项；也可只填写文字回答`
            : "选择最接近的一项；也可只填写文字回答"}
          label={question.prompt}
          maxSelections={question.maxSelections}
          multiple={question.selection === "multiple"}
          name={`clarification-${question.questionId}`}
          onChange={(value) => onSelectedValuesChange(Array.isArray(value) ? value : [value])}
          options={question.options}
          promptRef={promptRef}
          value={selectedValues}
        />
        <FreeTextAnswer
          contextLabel={question.prompt}
          id={`clarification-${question.questionId}-free-text`}
          maxLength={question.maxNoteLength}
          onChange={onNoteChange}
          placeholder="例如：我更想完成一个可展示的软件作品（请勿填写姓名、学校或联系方式）"
          value={note}
        />
      </div>

      <QuestionActionBar
        backLabel="上一步"
        canGoBack
        confirmDisabled={!complete}
        confirmLabel={complete ? "确认回答，继续" : "请选择或填写回答"}
        onBack={onBack}
        onConfirm={onConfirm}
      />
    </AgentMessage>
  );
}
