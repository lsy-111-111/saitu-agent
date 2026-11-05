"use client";

import Image from "next/image";
import { useEffect, useState, type ReactNode, type Ref } from "react";
import { GradientProgress } from "@/components/brand/GradientProgress";
import { ChoiceGroup } from "@/components/competitions/recommend/ChoiceGroup";
import { FreeTextAnswer } from "@/components/competitions/recommend/FreeTextAnswer";
import {
  fixedQuestionTurns,
  hasDecisionAnswer,
  getFieldAnswer,
  isTurnComplete,
  profileSummary,
  questionTopics,
  decisionAnswerSummary,
  type DecisionContext,
  type DraftCompetitionProfile,
  type FixedQuestionField,
  type FixedQuestionTextAnswers,
  type FixedQuestionTurn
} from "@/components/competitions/recommend/questionFlow";
import { cn } from "@/lib/utils";
import type {
  CompetitionClarificationAnswers,
  CompetitionDynamicQuestionV3
} from "@/types/competition-recommendation";

type LeleAvatarProps = {
  size?: "small" | "medium";
  className?: string;
};

export function LeleAvatar({ size = "medium", className }: LeleAvatarProps) {
  const [failed, setFailed] = useState(false);
  const pixels = size === "small" ? 34 : 46;

  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-white bg-brand-50 text-brand-500 shadow-soft",
        size === "small" ? "h-9 w-9" : "h-12 w-12",
        className
      )}
    >
      {failed ? (
        <span className={size === "small" ? "text-base" : "text-xl"}>✶</span>
      ) : (
        <Image
          alt=""
          className="h-full w-full object-cover object-top"
          height={pixels}
          onError={() => setFailed(true)}
          src="/brand/lele-avatar.png"
          width={pixels}
        />
      )}
    </span>
  );
}

export function AgentMessage({ children, live = false }: { children: ReactNode; live?: boolean }) {
  return (
    <div className="flex animate-message-enter items-start gap-1.5 sm:gap-3 motion-reduce:animate-none" {...(live ? { "aria-live": "polite", role: "status" } : {})}>
      <span className="hidden sm:block"><LeleAvatar /></span>
      <div className="min-w-0 w-full">
        <p className="mb-1.5 text-xs font-semibold tracking-wide text-brand-600">乐乐</p>
        <div className="break-words rounded-[8px_22px_22px_22px] border border-border bg-white px-4 py-4 text-sm leading-7 text-ink shadow-soft [overflow-wrap:anywhere] md:px-5">
          {children}
        </div>
      </div>
    </div>
  );
}

export function UserMessage({ children, onEdit }: { children: ReactNode; onEdit?: () => void }) {
  return (
    <div className="flex animate-message-enter justify-end pl-12 motion-reduce:animate-none">
      <div className="max-w-[min(88%,640px)] text-right">
        <div className="inline-block break-words rounded-[22px_8px_22px_22px] bg-brand-500 px-4 py-3 text-left text-sm font-medium leading-6 text-white shadow-soft [overflow-wrap:anywhere]">
          {children}
        </div>
        {onEdit ? (
          <button
            className="mt-1.5 block min-h-11 w-full text-right text-xs font-semibold text-muted-foreground underline decoration-brand-300 underline-offset-4 hover:text-brand-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
            onClick={onEdit}
            type="button"
          >
            修改这条回答
          </button>
        ) : null}
      </div>
    </div>
  );
}

type ConversationHistoryProps = {
  turns?: readonly FixedQuestionTurn[];
  decisionContext?: DecisionContext;
  profile: DraftCompetitionProfile;
  currentTurnId?: FixedQuestionTurn["id"];
  onEdit: (index: number) => void;
  fixedQuestionTextAnswers?: FixedQuestionTextAnswers;
  clarificationAnswers?: CompetitionClarificationAnswers;
  clarificationQuestions?: readonly CompetitionDynamicQuestionV3[];
  currentClarificationIndex?: number;
  onEditClarification?: (index: number) => void;
};

function clarificationAnswerLabel(
  question: CompetitionDynamicQuestionV3,
  answers: CompetitionClarificationAnswers
) {
  const answer = answers[question.questionId];
  const selected = answer?.selectedValues
    .map((value) => question.options.find((option) => option.value === value)?.label ?? value)
    .join("、");
  const note = answer?.note?.trim();
  if (selected && note) return `${selected}；补充：${note}`;
  if (note) return `自填：${note}`;
  return selected ?? "";
}

export function ConversationHistory({
  turns = fixedQuestionTurns,
  decisionContext = {},
  profile,
  currentTurnId,
  onEdit,
  fixedQuestionTextAnswers = {},
  clarificationAnswers = {},
  clarificationQuestions = [],
  currentClarificationIndex,
  onEditClarification
}: ConversationHistoryProps) {
  const currentTurnIndex = currentTurnId
    ? turns.findIndex((turn) => turn.id === currentTurnId)
    : turns.length;
  const completedTurns = turns
    .map((turn, index) => ({ turn, index }))
    .filter(({ index }) => (
      index < currentTurnIndex
    ));
  const completedClarifications = clarificationQuestions
    .map((question, index) => ({
      answerLabel: clarificationAnswerLabel(question, clarificationAnswers),
      index,
      question
    }))
    .filter(({ answerLabel, index }) => (
      Boolean(answerLabel) &&
      (currentClarificationIndex === undefined || index < currentClarificationIndex)
    ));

  if (completedTurns.length === 0 && completedClarifications.length === 0) return null;

  return (
    <div
      aria-label="已回答的问答记录"
      className="space-y-4"
      data-testid="conversation-transcript"
      role="log"
    >
      {completedTurns.map(({ turn, index }) => (
        <div className="space-y-3" data-testid="conversation-transcript-turn" data-turn-id={turn.id} key={turn.id}>
          <AgentMessage>
            <p className="text-xs font-semibold text-brand-600">问题 {index + 1}/{turns.length} · {questionTopics[turn.topicIndex]}</p>
            <p className="mt-1 font-semibold text-ink">{turn.prompt}</p>
          </AgentMessage>
          <UserMessage onEdit={() => onEdit(index)}>
            {decisionAnswerSummary(turn, profile, fixedQuestionTextAnswers, decisionContext)}
          </UserMessage>
        </div>
      ))}
      {completedClarifications.map(({ answerLabel, index, question }) => (
        <div className="space-y-3" data-question-id={question.questionId} data-testid="conversation-transcript-clarification" key={question.questionId}>
          <AgentMessage>
            <p className="text-xs font-semibold text-brand-600">补充问题 {index + 1}</p>
            <p className="mt-1 font-semibold text-ink">{question.prompt}</p>
          </AgentMessage>
          <UserMessage onEdit={onEditClarification ? () => onEditClarification(index) : undefined}>
            {answerLabel}
          </UserMessage>
        </div>
      ))}
    </div>
  );
}

export function QuestionEntrance({ children }: { children: ReactNode }) {
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setEntered(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      className={`transition-[opacity,transform] duration-200 ease-out motion-reduce:translate-y-0 motion-reduce:opacity-100 motion-reduce:transition-none ${
        entered ? "translate-y-0 opacity-100" : "translate-y-1.5 opacity-0"
      }`}
    >
      {children}
    </div>
  );
}

type QuestionActionBarProps = {
  backLabel?: string;
  canGoBack: boolean;
  confirmDisabled: boolean;
  confirmLabel: string;
  onBack: () => void;
  onConfirm: () => void;
  showConfirm?: boolean;
  statusText?: string;
};

export function QuestionActionBar({
  backLabel = "上一步",
  canGoBack,
  confirmDisabled,
  confirmLabel,
  onBack,
  onConfirm,
  showConfirm = true,
  statusText
}: QuestionActionBarProps) {
  return (
    <div
      className="sticky bottom-0 z-20 -mx-4 -mb-4 -mt-20 flex flex-wrap items-center justify-between gap-3 rounded-b-[20px] border-t border-border bg-white/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-14px_24px_-22px_rgba(30,27,75,0.5)] backdrop-blur-md supports-[backdrop-filter]:bg-white/85 md:-mx-5 md:px-5"
      data-testid="question-action-bar"
    >
      <button
        className="min-h-11 rounded-full px-3 text-sm font-semibold text-muted-foreground hover:text-brand-600 disabled:cursor-not-allowed disabled:opacity-35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
        disabled={!canGoBack}
        onClick={onBack}
        type="button"
      >
        ← {backLabel}
      </button>
      {showConfirm ? (
        <button
          className="min-h-11 rounded-full bg-brand-gradient px-5 py-2.5 text-sm font-semibold text-white shadow-soft transition-colors hover:shadow-lift disabled:cursor-not-allowed disabled:opacity-35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 motion-reduce:transform-none motion-reduce:transition-none"
          disabled={confirmDisabled}
          onClick={onConfirm}
          type="button"
        >
          {confirmLabel}
        </button>
      ) : (
        <p aria-live="polite" className="min-h-11 py-3 text-sm font-semibold text-brand-600">
          {statusText}
        </p>
      )}
    </div>
  );
}

export function FixedConversationQuestion({
  index,
  total = fixedQuestionTurns.length,
  onSkip,
  children,
  hasContextAnswer,
  turn,
  profile,
  onAnswer,
  onConfirm,
  onBack,
  canGoBack,
  promptRef,
  transitionPending = false,
  textAnswers,
  onFreeTextChange
}: {
  index: number;
  total?: number;
  onSkip?: () => void;
  children?: ReactNode;
  hasContextAnswer?: boolean;
  turn: FixedQuestionTurn;
  profile: DraftCompetitionProfile;
  onAnswer: (field: FixedQuestionField, answer: string | string[]) => void;
  onConfirm: () => void;
  onBack: () => void;
  canGoBack: boolean;
  promptRef?: Ref<HTMLLegendElement>;
  transitionPending?: boolean;
  textAnswers: FixedQuestionTextAnswers;
  onFreeTextChange: (questionId: FixedQuestionTurn["id"], value: string) => void;
}) {
  const questionNumber = index + 1;
  const turnComplete = onSkip ? (hasDecisionAnswer(turn, profile, textAnswers) || hasContextAnswer) : isTurnComplete(turn, profile, textAnswers);

  return (
    <AgentMessage>
      <div className="mb-5 border-b border-border pb-4">
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="text-xs font-semibold tracking-wide text-brand-600">
            问题 {questionNumber}/{total} · {questionTopics[turn.topicIndex]}
          </p>
          <span className="text-[11px] font-medium text-muted-foreground">
            {Math.round((questionNumber / total) * 100)}%
          </span>
        </div>
        <GradientProgress
          label={`竞赛助手进度：问题 ${questionNumber} / ${total}`}
          value={(questionNumber / total) * 100}
        />
      </div>
      <div className="pb-24">
        <div>
          {turn.fields.map((field, index) => (
            <div
              className={index > 0 ? "mt-8 border-t border-border pt-8" : undefined}
              key={field.id}
            >
              <ChoiceGroup
                compact={field.compact}
                disabled={transitionPending}
                hint={field.hint ? `${field.hint}；也可直接填写文字回答` : "也可直接填写文字回答"}
                label={field.label}
                maxSelections={field.maxSelections}
                multiple={field.selection === "multiple"}
                name={`fixed-${turn.id}-${field.id}`}
                onChange={(answer) => onAnswer(field, answer)}
                options={field.options}
                promptRef={index === 0 ? promptRef : undefined}
                value={getFieldAnswer(field, profile)}
              />
            </div>
          ))}
          <div className="mt-4 space-y-4">{children}</div>
          <FreeTextAnswer
            contextLabel={turn.prompt}
            disabled={transitionPending}
            id={`fixed-${turn.id}-free-text`}
            onChange={(value) => onFreeTextChange(turn.id, value)}
            placeholder={turn.id === "stage"
              ? "例如：2022 年首次接受高等教育，目前为全日制在读（请勿填写姓名、学校或联系方式）"
              : undefined}
            value={textAnswers[turn.id] ?? ""}
          />
          {onSkip && turn.id !== "stage" ? <button type="button" onClick={onSkip} className="mt-2 min-h-10 px-2 text-sm font-semibold text-brand-700 underline underline-offset-4">暂不确定，跳过这题</button> : null}
        </div>
      </div>
      <QuestionActionBar
        canGoBack={canGoBack}
        confirmDisabled={!turnComplete || transitionPending}
        confirmLabel={turnComplete ? "回答好了，继续" : "请选择或填写"}
        onBack={onBack}
        onConfirm={onConfirm}
        showConfirm
      />
    </AgentMessage>
  );
}

export function ProfileSummary({
  profile,
  onEdit,
  fixedQuestionTextAnswers = {}
}: {
  profile: DraftCompetitionProfile;
  onEdit: (turnIndex: number) => void;
  fixedQuestionTextAnswers?: FixedQuestionTextAnswers;
}) {
  return (
    <dl className="divide-y divide-border rounded-[18px] border border-border bg-white">
      {profileSummary(profile, fixedQuestionTextAnswers).map((row, index) => (
        <div className="grid gap-1.5 px-4 py-3.5 sm:grid-cols-[132px_1fr_auto] sm:items-start" key={row.title}>
          <dt className="text-xs font-semibold text-brand-600">{index + 1}. {row.title}</dt>
          <dd className="break-words text-sm leading-6 text-ink/80">{row.value}</dd>
          <button
            className="min-h-11 justify-self-start text-xs font-semibold text-muted-foreground underline decoration-brand-300 underline-offset-4 hover:text-brand-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
            onClick={() => onEdit(row.turnIndex)}
            type="button"
          >
            修改
          </button>
        </div>
      ))}
    </dl>
  );
}
