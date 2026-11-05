"use client";

import { ChoiceGroup, type ChoiceOption } from "@/components/competitions/recommend/ChoiceGroup";
import { AgentMessage } from "@/components/competitions/recommend/ConversationUI";
import { normalizeCompetitionAnswerText } from "@/components/competitions/recommend/answerText";
import type {
  CompetitionQuestionnaireClientInterpretation,
  CompetitionQuestionnaireFieldId
} from "@/types/competition-recommendation";

export type QuestionnaireInterpretationReviewItem = Pick<
  CompetitionQuestionnaireClientInterpretation,
  | "allowedOptions"
  | "explicitValues"
  | "fieldId"
  | "originalText"
  | "rationale"
  | "requiresConfirmation"
  | "status"
  | "suggestedValues"
> & {
  exclusiveNone?: boolean;
  label: string;
  maxSelections?: number;
  minSelections?: number;
  resolvedValues: readonly string[];
  selection: "single" | "multiple";
};

type QuestionnaireInterpretationReviewProps = {
  items: readonly QuestionnaireInterpretationReviewItem[];
  onBack: () => void;
  onConfirm: () => void;
  onResolvedValuesChange: (fieldId: CompetitionQuestionnaireFieldId, values: string[]) => void;
  pending?: boolean;
};

function labelsFor(options: readonly ChoiceOption[], values: readonly string[]) {
  return values.map((value) => options.find((option) => option.value === value)?.label ?? value);
}

export function isQuestionnaireInterpretationResolved(
  item: QuestionnaireInterpretationReviewItem
) {
  if (!item.requiresConfirmation) return true;
  const values = Array.from(new Set(item.resolvedValues));
  const minimum = item.minSelections ?? 1;
  const maximum = item.selection === "single" ? 1 : item.maxSelections ?? values.length;
  const allowed = new Set(item.allowedOptions.map((option) => option.value));
  return (
    values.length >= minimum &&
    values.length <= maximum &&
    values.every((value) => allowed.has(value)) &&
    !(item.exclusiveNone && values.length > 1 && values.includes("none"))
  );
}

export function QuestionnaireInterpretationReview({
  items,
  onBack,
  onConfirm,
  onResolvedValuesChange,
  pending = false
}: QuestionnaireInterpretationReviewProps) {
  const confirmationItems = items.filter((item) => item.requiresConfirmation);
  const unresolvedCount = confirmationItems.filter(
    (item) => !isQuestionnaireInterpretationResolved(item)
  ).length;
  const complete = unresolvedCount === 0;

  return (
    <section aria-labelledby="questionnaire-interpretation-title" className="space-y-5">
      <AgentMessage>
        <h2 className="text-lg font-semibold text-ink" id="questionnaire-interpretation-title">
          请确认我对文字回答的理解
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          你的原文不会被悄悄改成系统选项。请逐项确认或修正，确认后的结构化结果才会用于追问和推荐。
        </p>
      </AgentMessage>

      <div className="space-y-4">
        {confirmationItems.map((item, index) => {
          const originalText = normalizeCompetitionAnswerText(item.originalText);
          const explicitLabels = labelsFor(item.allowedOptions, item.explicitValues);
          const suggestionLabels = labelsFor(item.allowedOptions, item.suggestedValues);
          const resolved = isQuestionnaireInterpretationResolved(item);

          return (
            <article
              aria-labelledby={`interpretation-${item.fieldId}-title`}
              className="rounded-[20px] border border-border bg-white p-4 shadow-soft md:p-5"
              key={item.fieldId}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-brand-600">待确认 {index + 1}/{confirmationItems.length}</p>
                  <h3 className="mt-1 font-semibold text-ink" id={`interpretation-${item.fieldId}-title`}>
                    {item.label}
                  </h3>
                </div>
                <span
                  className={resolved
                    ? "rounded-full bg-success-50 px-3 py-1 text-xs font-semibold text-success-700"
                    : "rounded-full bg-warning-50 px-3 py-1 text-xs font-semibold text-warning-700"}
                >
                  {resolved
                    ? "已选定，待统一确认"
                    : item.status === "conflict"
                      ? "选项与文字有冲突"
                      : item.status === "ambiguous"
                        ? "存在多种理解"
                        : item.status === "unmapped"
                          ? "暂未能归类"
                          : "需要选择"}
                </span>
              </div>

              {originalText ? (
                <div className="mt-4 rounded-[14px] border border-border bg-brand-50/60 px-4 py-3">
                  <p className="text-xs font-semibold text-muted-foreground">你的原文</p>
                  <p className="mt-1 break-words text-sm leading-6 text-ink">{originalText}</p>
                </div>
              ) : null}

              {explicitLabels.length > 0 ? (
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  你同时选择了：<span className="font-semibold text-ink">{explicitLabels.join("、")}</span>
                </p>
              ) : null}

              <div aria-live="polite" className="mt-3 text-sm leading-6 text-muted-foreground">
                {suggestionLabels.length > 0
                  ? <>乐乐初步理解为：<strong className="font-semibold text-ink">{suggestionLabels.join("、")}</strong></>
                  : <span className="font-medium text-warning-700">暂时无法可靠归类，请你从下面的选项中确认。</span>}
              </div>
              {item.rationale ? (
                <p className="mt-2 text-xs leading-5 text-muted-foreground">理解依据：{item.rationale}</p>
              ) : null}

              <div className="mt-5 border-t border-border pt-5">
                <ChoiceGroup
                  compact
                  disabled={pending}
                  hint={item.selection === "multiple"
                    ? `请选择 ${item.minSelections ?? 1}–${item.maxSelections ?? item.allowedOptions.length} 项作为最终理解`
                    : "请选择一项作为最终理解"}
                  label="确认后的结构化答案"
                  maxSelections={item.selection === "single" ? 1 : item.maxSelections}
                  multiple={item.selection === "multiple"}
                  name={`interpretation-${item.fieldId}`}
                  onChange={(value) => onResolvedValuesChange(
                    item.fieldId,
                    Array.isArray(value) ? value : [value]
                  )}
                  options={item.allowedOptions}
                  value={[...item.resolvedValues]}
                />
              </div>
            </article>
          );
        })}
      </div>

      <AgentMessage>
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button
            className="min-h-11 rounded-full px-4 text-sm font-semibold text-muted-foreground hover:text-brand-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
            disabled={pending}
            onClick={onBack}
            type="button"
          >
            返回修改原回答
          </button>
          <div className="text-left sm:text-right">
            <p
              aria-live="polite"
              className="mb-2 text-xs text-muted-foreground"
              role={unresolvedCount > 0 ? "alert" : undefined}
            >
              {unresolvedCount > 0 ? `还有 ${unresolvedCount} 项需要确认` : "所有文字回答都已确认"}
            </p>
            <button
              className="min-h-11 rounded-full bg-brand-gradient px-6 py-2.5 text-sm font-semibold text-white shadow-soft transition hover:-translate-y-0.5 hover:shadow-lift disabled:cursor-not-allowed disabled:opacity-35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 motion-reduce:transform-none motion-reduce:transition-none"
              disabled={!complete || pending}
              onClick={onConfirm}
              type="button"
            >
              {pending ? "正在确认…" : "确认结构化理解并继续"}
            </button>
          </div>
        </div>
      </AgentMessage>
    </section>
  );
}
