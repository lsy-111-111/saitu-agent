"use client";

import Link from "next/link";
import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { OrbitBackdrop } from "@/components/brand/OrbitBackdrop";
import { ClarificationQuestionCard } from "@/components/competitions/recommend/ClarificationQuestionCard";
import { DecisionPreferences } from "./DecisionPreferences";
import { SelectionResultActions } from "./SelectionResultActions";
import {
  AgentMessage,
  ConversationHistory,
  FixedConversationQuestion,
  QuestionEntrance,
} from "@/components/competitions/recommend/ConversationUI";
import { QuestionnaireInterpretationReview } from "@/components/competitions/recommend/QuestionnaireInterpretationReview";
import { RecommendationResultCard } from "@/components/competitions/recommend/RecommendationResultCard";
import {
  MAX_CLARIFICATION_QUESTIONS,
  useRecommendationConversation
} from "@/components/competitions/recommend/useRecommendationConversation";
import { CompetitionDetailModal } from "@/components/competitions/CompetitionDetailModal";
import { competitions } from "@/content/competitions";
import type { AiConsentDisclosureV1 } from "@/lib/ai/client-consent";
const MAX_ALIGNMENT_MONITOR_FRAMES = 180;
const MAX_ALIGNMENT_CORRECTIONS = 2;

export function CompetitionRecommendationWizard({
  aiConsentDisclosure
}: {
  aiConsentDisclosure: AiConsentDisclosureV1;
}) {
  const conversation = useRecommendationConversation(aiConsentDisclosure);
  const activeQuestionKey = conversation.phase === "questions"
    ? `fixed:${conversation.currentTurn.id}`
    : conversation.phase === "followups" && conversation.currentClarification
      ? `dynamic:${conversation.currentClarification.questionId}:${conversation.dynamicAnswerConfirmation ? "confirmation" : "answer"}`
      : null;
  const currentQuestionPromptRef = useRef<HTMLLegendElement>(null);
  const currentQuestionCardRef = useRef<HTMLDivElement | null>(null);
  const currentStageRef = useRef<HTMLElement | null>(null);
  const previousStateRef = useRef<{
    phase: typeof conversation.phase;
    activeQuestionKey: string | null;
  } | null>(null);
  const setCurrentStageRef = useCallback((node: HTMLElement | null) => {
    currentStageRef.current = node;
  }, []);
  const selectedCompetition = useMemo(
    () => competitions.find((competition) => competition.id === conversation.selectedCompetitionId) ?? null,
    [conversation.selectedCompetitionId]
  );

  useLayoutEffect(() => {
    const nextState = { phase: conversation.phase, activeQuestionKey };
    const previousState = previousStateRef.current;
    previousStateRef.current = nextState;

    let target: HTMLElement | null = currentStageRef.current;
    let scrollTarget: HTMLElement | null = currentStageRef.current;
    let shouldFocusTarget = false;
    const questionChanged = Boolean(
      activeQuestionKey && activeQuestionKey !== previousState?.activeQuestionKey
    );
    if (!previousState) return;
    if (questionChanged) {
      target = currentQuestionPromptRef.current;
      scrollTarget = currentQuestionCardRef.current;
      shouldFocusTarget = true;

    } else if (previousState?.phase !== conversation.phase) {
      shouldFocusTarget = true;
    }

    if (!target) return;
    let monitorFrame = 0;
    let rootScrollBehaviorOverridden = false;
    const root = document.documentElement;
    const previousInlineBehavior = root.style.getPropertyValue("scroll-behavior");
    const previousInlinePriority = root.style.getPropertyPriority("scroll-behavior");
    const restoreRootScrollBehavior = () => {
      if (!rootScrollBehaviorOverridden) return;
      rootScrollBehaviorOverridden = false;
      if (previousInlineBehavior) {
        root.style.setProperty("scroll-behavior", previousInlineBehavior, previousInlinePriority);
      } else {
        root.style.removeProperty("scroll-behavior");
      }
    };
    const frame = window.requestAnimationFrame(() => {
      if (shouldFocusTarget) target?.focus({ preventScroll: true });
      if (!scrollTarget) return;
      const instantScroll = window.matchMedia("(prefers-reduced-motion: reduce), (pointer: coarse)").matches;
      scrollTarget.scrollIntoView({
        behavior: instantScroll ? "instant" : "smooth",
        block: questionChanged ? "start" : "nearest",
        inline: "nearest"
      });

      if (!questionChanged) return;
      let previousScrollY = window.scrollY;
      let stableFrames = 0;
      let totalFrames = 0;
      let correctionCount = 0;
      const monitorQuestionAlignment = () => {
        if (!scrollTarget?.isConnected) {
          restoreRootScrollBehavior();
          return;
        }
        const desiredTop = Number.parseFloat(window.getComputedStyle(root).scrollPaddingTop) || 0;
        const actualTop = scrollTarget.getBoundingClientRect().top;
        const scrollStable = Math.abs(window.scrollY - previousScrollY) <= 0.5;
        previousScrollY = window.scrollY;
        stableFrames = scrollStable ? stableFrames + 1 : 0;
        totalFrames += 1;

        if (Math.abs(actualTop - desiredTop) <= 1 && stableFrames >= 4) {
          restoreRootScrollBehavior();
          return;
        }

        const maxScrollY = Math.max(0, root.scrollHeight - window.innerHeight);
        const requestedScrollY = Math.max(0, window.scrollY + actualTop - desiredTop);
        const boundedScrollY = Math.min(maxScrollY, requestedScrollY);
        const reachedScrollBoundary =
          Math.abs(window.scrollY - boundedScrollY) <= 0.5 &&
          Math.abs(actualTop - desiredTop) > 1;
        if (
          totalFrames >= MAX_ALIGNMENT_MONITOR_FRAMES ||
          correctionCount >= MAX_ALIGNMENT_CORRECTIONS ||
          reachedScrollBoundary
        ) {
          restoreRootScrollBehavior();
          return;
        }

        // Smooth scrolling may be superseded by scroll anchoring when a text
        // panel is replaced with its confirmation card. Once scrolling has
        // settled off-target, finish with a synchronous correction before the
        // user has to move the page manually.
        if ((stableFrames >= 4 || totalFrames >= 120) && Math.abs(actualTop - desiredTop) > 1) {
          if (!rootScrollBehaviorOverridden) {
            rootScrollBehaviorOverridden = true;
            root.style.setProperty("scroll-behavior", "auto", "important");
          }
          correctionCount += 1;
          window.scrollTo(window.scrollX, boundedScrollY);
          stableFrames = 0;
        }
        monitorFrame = window.requestAnimationFrame(monitorQuestionAlignment);
      };
      monitorFrame = window.requestAnimationFrame(monitorQuestionAlignment);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (monitorFrame) window.cancelAnimationFrame(monitorFrame);
      restoreRootScrollBehavior();
    };
  }, [
    activeQuestionKey,
    conversation.phase
  ]);

  const visibleRecommendations = conversation.result?.recommendations ?? [];
  const isE2eRuleTestMode =
    process.env.NEXT_PUBLIC_AI_TEST_MODE === "1" &&
    conversation.result?.rankingSource === "evidence-rules";

  const history = (
    <ConversationHistory
              decisionContext={conversation.decisionContext}
              turns={conversation.activeTurns}
              clarificationAnswers={conversation.clarificationAnswers}
              clarificationQuestions={conversation.clarificationQuestions}
              currentClarificationIndex={conversation.phase === "followups"
                ? conversation.clarificationIndex
                : undefined}
              currentTurnId={conversation.phase === "questions" ? conversation.currentTurn.id : undefined}
              onEdit={conversation.editTurn}
              onEditClarification={conversation.editClarification}
              fixedQuestionTextAnswers={conversation.fixedQuestionTextAnswers}
              profile={conversation.profile}
            />
  );

  return (
    <div className="mx-auto max-w-[1516px]">
      {!(conversation.phase === "questions" && conversation.turnIndex === 0) && <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Link
          className="inline-flex min-h-11 items-center text-sm font-semibold text-muted-foreground transition hover:text-brand-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 motion-reduce:transition-none"
          href="/competitions"
        >
          <svg aria-hidden="true" className="mr-2 h-4 w-4" fill="none" viewBox="0 0 20 20">
            <path d="M16 10H4m5-5-5 5 5 5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
          </svg>
          返回竞赛信息
        </Link>
        <button
          className="min-h-11 rounded-full px-3 text-sm font-semibold text-muted-foreground transition hover:text-brand-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 motion-reduce:transition-none"
          onClick={conversation.restart}
          type="button"
        >
          重新开始
        </button>
      </div>}

      <section
        aria-label="与乐乐的竞赛助手对话"
        className="relative isolate overflow-visible rounded-[24px] bg-brand-50/40 py-4 sm:border sm:border-border sm:p-4 md:p-6 lg:p-8"
      >
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
          <OrbitBackdrop className="left-auto bottom-auto h-64 w-64 -translate-y-24 translate-x-20 opacity-35" compact />
        </div>
        <div className="relative z-10 space-y-6">
          {conversation.phase === "questions" && conversation.turnIndex === 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 px-2" data-testid="assistant-welcome-message">
              <div><h1 className="font-serif text-2xl font-semibold text-ink">和乐乐一起选赛</h1>
                <p className="mt-1 text-sm text-muted-foreground">{conversation.depth === "quick" ? "快速选赛 · 建议预留 4–6 分钟" : "深入了解 · 根据你的回答补充细节"}，可跳过不确定的条件。</p></div>
              <button className="min-h-11 rounded-full border border-brand-300 bg-white px-4 text-sm font-semibold text-brand-700" type="button"
                onClick={() => conversation.setDepth(conversation.depth === "quick" ? "deep" : "quick")}>
                {conversation.depth === "quick" ? "想聊得更细" : "切换到快速选赛"}
              </button>
            </div>
          ) : null}

          {conversation.phase !== "results" && history}

            {conversation.phase === "questions" ? (
              <div className="space-y-6">
                <div className="min-h-[34rem]" data-testid="conversation-current-question" ref={currentQuestionCardRef}>
                  <QuestionEntrance key={conversation.currentTurn.id}>
                    <FixedConversationQuestion
                      canGoBack={conversation.turnIndex > 0}
                      index={conversation.turnIndex}
                      total={conversation.activeTurns.length}
                      onSkip={conversation.skipFixedAnswer}
                      hasContextAnswer={conversation.hasContextAnswer}
                      onAnswer={conversation.chooseFixedAnswer}
                      onBack={conversation.goBackFixed}
                      onConfirm={conversation.confirmFixedAnswer}
                      onFreeTextChange={conversation.updateFixedQuestionText}
                      profile={conversation.profile}
                      promptRef={currentQuestionPromptRef}
                      transitionPending={conversation.fixedTransitionPending}
                      textAnswers={conversation.fixedQuestionTextAnswers}
                      turn={conversation.currentTurn}
                    >
                      <DecisionPreferences turn={conversation.currentTurn} profile={conversation.profile}
                        context={conversation.decisionContext} onChange={conversation.changeContext} />
                    </FixedConversationQuestion>
                    {conversation.returnToSummary && <button type="button" className="mt-3 min-h-11 rounded-full border border-brand-300 bg-white px-5 text-sm font-semibold text-brand-700" onClick={conversation.returnToSummary}>回到确认页，用现有回答重新匹配</button>}
                  </QuestionEntrance>
                </div>
              </div>
            ) : null}

            {conversation.phase === "summary" && conversation.questionnaireComplete ? (
              <section
                aria-labelledby="answer-summary-title"
                className="scroll-mt-24 space-y-5 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-400"
                data-testid="conversation-stage"
                data-phase="summary"
                ref={setCurrentStageRef}
                tabIndex={-1}
              >
                <AgentMessage>
                  <h2 className="text-lg font-semibold text-ink" id="answer-summary-title">
                    我已经记下了。上面的每条回答都可以直接修改。
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">请核对回答。本站程序会依据这些条件决定参赛资格、推荐竞赛和顺序。单独同意后，DeepSeek 可以协助理解你填写的文字，并从已确定的推荐依据中挑选适合展示的理由。</p>
                </AgentMessage>

                <AgentMessage>
                  <p className="font-semibold text-ink">{conversation.aiConsentDisclosure.heading}</p>
                  {conversation.consentDisclosureNotice ? (
                    <p
                      className={`mt-4 rounded-[14px] border px-4 py-3 text-sm leading-6 ${conversation.consentDisclosureReady
                        ? "border-brand-200 bg-brand-50 text-brand-700"
                        : "border-warning-200 bg-warning-50 text-warning-700"}`}
                      data-testid="ai-consent-disclosure-notice"
                      role="status"
                    >
                      {conversation.consentDisclosureNotice}
                    </p>
                  ) : null}
                  <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-[16px] border border-brand-200 bg-brand-50 px-4 py-4 text-sm leading-6 text-ink/80">
                    <input
                      checked={conversation.consentAccepted}
                      className="mt-1 h-4 w-4 shrink-0 accent-brand-500"
                      disabled={!conversation.consentDisclosureReady}
                      onChange={(event) => conversation.setConsentAccepted(event.target.checked)}
                      type="checkbox"
                    />
                    <span>
                      {conversation.aiConsentDisclosure.body}详见
                      <Link
                        className="ml-1 font-semibold text-brand-600 underline decoration-brand-300 underline-offset-4"
                        href={conversation.aiConsentDisclosure.privacyHref}
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        隐私政策
                      </Link>。
                    </span>
                  </label>
                  {!conversation.consentDisclosureReady ? (
                    <button
                      className="mt-3 min-h-11 rounded-full border border-control-border bg-white px-5 py-2.5 text-sm font-semibold text-ink hover:border-brand-400 hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
                      disabled={conversation.isConsentRefreshPending}
                      onClick={conversation.refreshConsentDisclosure}
                      type="button"
                    >
                      {conversation.isConsentRefreshPending ? "正在获取最新说明…" : "重新加载最新说明"}
                    </button>
                  ) : null}
                  <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
                    <button
                      className="min-h-11 rounded-full px-4 text-sm font-semibold text-muted-foreground hover:text-brand-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
                      onClick={() => conversation.editTurn(conversation.activeTurns.length - 1)}
                      type="button"
                    >
                      返回修改
                    </button>
                    <button
                      className="min-h-11 rounded-full bg-brand-gradient px-6 py-2.5 text-sm font-semibold text-white shadow-soft transition hover:-translate-y-0.5 hover:shadow-lift disabled:cursor-not-allowed disabled:opacity-35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 motion-reduce:transform-none motion-reduce:transition-none"
                      disabled={
                        !conversation.consentDisclosureReady ||
                        !conversation.consentAccepted ||
                        conversation.requestPending ||
                        conversation.retryAfter > 0
                      }
                      onClick={() => void conversation.runClarify()}
                      type="button"
                    >
                      {!conversation.consentDisclosureReady
                        ? "等待最新 AI 使用说明"
                        : conversation.retryAfter > 0
                        ? `请等待 ${conversation.retryAfter} 秒后重试`
                        : conversation.requestPending
                          ? "正在提交…"
                          : "同意，请乐乐开始匹配"}
                    </button>
                  </div>
                </AgentMessage>
              </section>
            ) : null}

            {conversation.phase === "interpretation" ? (
              <div
                aria-labelledby="questionnaire-interpretation-title"
                className="scroll-mt-24 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-400"
                data-phase="interpretation"
                data-testid="conversation-stage"
                ref={setCurrentStageRef}
                tabIndex={-1}
              >
                <QuestionnaireInterpretationReview
                  items={conversation.interpretationItems}
                  onBack={conversation.backFromInterpretation}
                  onConfirm={() => void conversation.confirmInterpretations()}
                  onResolvedValuesChange={conversation.updateInterpretationValues}
                  pending={conversation.requestPending}
                />
              </div>
            ) : null}

            {conversation.phase === "normalizing" || conversation.phase === "clarifying" || conversation.phase === "recommending" ? (
              <div
                aria-labelledby="assistant-async-status-title"
                className="scroll-mt-24 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-400"
                data-testid="conversation-stage"
                data-phase={conversation.phase}
                ref={setCurrentStageRef}
                role="status"
                tabIndex={-1}
              >
                <AgentMessage>
                  <h2 className="mt-2 text-lg font-semibold text-ink" id="assistant-async-status-title">
                    {conversation.phase === "normalizing"
                      ? "我正在理解你填写的文字回答…"
                      : conversation.phase === "clarifying"
                        ? "我正在判断是否还需要了解几个细节…"
                        : "线索齐了，我正在站内竞赛中为你筛选…"}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {conversation.phase === "normalizing"
                      ? "我会把你的描述整理成几条线索。下一步你可以逐条确认或修改，再用它们选赛。"
                      : conversation.phase === "clarifying"
                        ? "只有在不同回答可能改变推荐时，我才会继续问；最多再问三题。"
                        : "我会先排除明确不符资格的竞赛，结合你确认的目标、任务和经历比较各个赛道，说明值得准备的方向及其依据。"}
                  </p>
                </AgentMessage>
              </div>
            ) : null}

            {conversation.phase === "optional_followup" && conversation.optionalClarification ? (
              <section
                aria-labelledby="optional-followup-title"
                className="scroll-mt-24 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-400"
                data-phase="optional_followup"
                data-testid="conversation-stage"
                ref={setCurrentStageRef}
                tabIndex={-1}
              >
                <AgentMessage>
                  <h2 className="text-lg font-semibold text-ink" id="optional-followup-title">
                    当前信息已经足够，可以直接查看推荐。
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    你也可以再回答一个偏好问题，用于完善匹配说明，但结果可能保持不变。
                  </p>
                  <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                    <button
                      className="min-h-11 rounded-full bg-brand-gradient px-6 py-2.5 text-sm font-semibold text-white shadow-soft transition hover:-translate-y-0.5 hover:shadow-lift disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 motion-reduce:transform-none motion-reduce:transition-none"
                      disabled={conversation.requestPending}
                      onClick={conversation.skipOptionalClarification}
                      type="button"
                    >
                      直接查看推荐
                    </button>
                    <button
                      className="min-h-11 rounded-full border border-control-border bg-white px-6 py-2.5 text-sm font-semibold text-ink hover:border-brand-400 hover:text-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
                      disabled={conversation.requestPending}
                      onClick={conversation.continueOptionalClarification}
                      type="button"
                    >
                      再回答一个偏好问题
                    </button>
                  </div>
                </AgentMessage>
              </section>
            ) : null}

            {conversation.phase === "followups" && conversation.currentClarification ? (
              <section
                aria-label="乐乐的补充问题"
                className="scroll-mt-24 space-y-5"
                data-phase="followups"
                data-testid="conversation-stage"
                ref={setCurrentStageRef}
              >
                <div
                  className="min-h-[34rem]"
                  data-testid="conversation-current-question"
                  ref={currentQuestionCardRef}
                >
                  <QuestionEntrance key={conversation.currentClarification.questionId}>
                    <ClarificationQuestionCard
                      answer={conversation.currentClarificationAnswer}
                      answerConfirmation={conversation.dynamicAnswerConfirmation}
                      index={conversation.clarificationIndex}
                      onAnswerConfirmationCancel={conversation.cancelDynamicAnswerConfirmation}
                      onAnswerConfirmationConfirm={conversation.confirmDynamicAnswerConfirmation}
                      onAnswerConfirmationValuesChange={conversation.updateDynamicAnswerConfirmationValues}
                      onBack={conversation.goBackClarification}
                      onConfirm={conversation.confirmClarification}
                      onNoteChange={conversation.updateClarificationNote}
                      onSelectedValuesChange={conversation.chooseClarification}
                      promptRef={currentQuestionPromptRef}
                      question={conversation.currentClarification}
                      total={MAX_CLARIFICATION_QUESTIONS}
                    />
                  </QuestionEntrance>
                </div>
              </section>
            ) : null}

            {conversation.phase === "error" ? (
              <div
                aria-labelledby="recommendation-error-title"
                className="scroll-mt-24 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-400"
                data-testid="conversation-stage"
                data-phase="error"
                ref={setCurrentStageRef}
                role="alert"
                tabIndex={-1}
              >
                <AgentMessage>
                  <h2 className="text-lg font-semibold text-ink" id="recommendation-error-title">
                    抱歉，这次没有顺利完成匹配。
                  </h2>
                  <p className="mt-2 rounded-[14px] border border-error-200 bg-error-50 px-4 py-3 text-sm leading-6 text-error-700">{conversation.errorMessage}</p>
                  <p className="mt-3 text-xs leading-5 text-muted-foreground">你的答案仍然只在当前页面内存中，不用从头来过。</p>
                  <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                    <button
                      className="min-h-11 rounded-full bg-brand-gradient px-5 py-2.5 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:shadow-soft disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 motion-reduce:transform-none motion-reduce:transition-none"
                      disabled={conversation.requestPending || conversation.retryAfter > 0}
                      onClick={conversation.retry}
                      type="button"
                    >
                      {conversation.retryAfter > 0 ? `请等待 ${conversation.retryAfter} 秒` : "请乐乐原地重试"}
                    </button>
                    <button
                      className="min-h-11 rounded-full border border-control-border px-5 py-2.5 text-sm font-semibold text-ink/80 hover:border-brand-400 hover:text-brand-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
                      onClick={() => conversation.editTurn(conversation.activeTurns.length - 1)}
                      type="button"
                    >
                      返回修改答案
                    </button>
                  </div>
                </AgentMessage>
              </div>
            ) : null}

            {conversation.phase === "results" &&
            conversation.result ? (
              <section
                aria-labelledby="recommendation-results-title"
                className="scroll-mt-24 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-400"
                data-testid="conversation-stage"
                data-phase="results"
                ref={setCurrentStageRef}
                tabIndex={-1}
              >
                <AgentMessage>
                  <div>
                    <h2 className="text-xl font-semibold text-ink md:text-2xl" id="recommendation-results-title">
                      {visibleRecommendations.length ? "这些竞赛值得你优先了解" : "暂时没有足够依据推荐一场竞赛"}
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">点开每一项可以看匹配理由、可能的差距和准备建议。报名资格与时间仍需以官方最新通知为准。</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">本校认定、综测和推免政策需向本校核实。报名状态仅供行动参考。</p>
                  </div>
                  {isE2eRuleTestMode ? (
                    <p
                      className="mt-4 rounded-[14px] border border-brand-200 bg-brand-50 px-4 py-3 text-sm leading-6 text-brand-700"
                      data-testid="ai-test-mode-notice"
                    >
                      E2E 规则测试环境：当前结果用于自动化验收，没有调用 DeepSeek。
                    </p>
                  ) : conversation.result.rankingSource === "rule-fallback" ? (
                    <p className="mt-4 rounded-[14px] border border-warning-200 bg-warning-50 px-4 py-3 text-sm leading-6 text-warning-700">
                      本次按你已确认的条件生成了推荐。可以在每张卡片查看理由与待确认事项。
                    </p>
                  ) : null}
                </AgentMessage>

                <div className="mt-5 grid gap-3">
                  {visibleRecommendations.map((recommendation) => (
                    <RecommendationResultCard
                      key={recommendation.competitionId}
                      onOpenDetails={conversation.openDetails}
                      onSourceClick={conversation.trackSourceClick}
                      recommendation={recommendation}
                    />
                  ))}
                </div>

                <details className="mt-5 rounded-2xl border border-border bg-white p-4">
                  <summary className="cursor-pointer font-semibold text-brand-700">回看与修改问答记录</summary>
                  <div className="mt-4">{history}</div>
                </details>
                <SelectionResultActions result={conversation.result}
                  turns={conversation.activeTurns} editTurn={conversation.editTurn} openDetails={conversation.openDetails} />
              </section>
            ) : null}
          </div>
        </section>

      <CompetitionDetailModal
        competition={selectedCompetition}
        onClose={conversation.closeDetails}
        onSourceClick={conversation.trackSourceClick}
      />
    </div>
  );
}
