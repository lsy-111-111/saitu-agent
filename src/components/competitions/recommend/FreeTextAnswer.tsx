"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  COMPETITION_ANSWER_TEXT_MAX_LENGTH,
  normalizeCompetitionAnswerText
} from "@/components/competitions/recommend/answerText";
import {
  COMPETITION_NOTE_PRIVACY_MESSAGE,
  containsCompetitionNotePersonalInfo
} from "@/lib/ai/competition-note";

type FreeTextAnswerProps = {
  contextLabel?: string;
  disabled?: boolean;
  id: string;
  maxLength?: number;
  onChange: (value: string) => void;
  placeholder?: string;
  value: string;
};

const useBrowserLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function FreeTextAnswer({
  contextLabel,
  disabled = false,
  id,
  maxLength = COMPETITION_ANSWER_TEXT_MAX_LENGTH,
  onChange,
  placeholder = "例如：补充一项会影响匹配的实际情况（请勿填写姓名、学校或联系方式）",
  value
}: FreeTextAnswerProps) {
  const [expanded, setExpanded] = useState(() => Boolean(value.trim()));
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const panelId = `${id}-panel`;
  const hintId = `${id}-hint`;
  const countId = `${id}-count`;
  const errorId = `${id}-error`;
  const normalized = normalizeCompetitionAnswerText(value, maxLength);
  const hasPersonalInfo = Boolean(normalized) && containsCompetitionNotePersonalInfo(normalized);
  const describedBy = [hintId, countId, hasPersonalInfo ? errorId : null]
    .filter(Boolean)
    .join(" ");

  useBrowserLayoutEffect(() => {
    if (!expanded) return;
    const textarea = textareaRef.current;
    if (!textarea) return;

    const root = document.documentElement;
    const previousInlineBehavior = root.style.getPropertyValue("scroll-behavior");
    const previousInlinePriority = root.style.getPropertyPriority("scroll-behavior");
    let frame = 0;
    let stopped = false;
    let alignedFrames = 0;
    let measuredFrames = 0;
    let previousScrollY = window.scrollY;

    // The document normally scrolls smoothly. Keep it synchronous while the
    // newly expanded panel and sticky action bar finish their layout, otherwise
    // a pending animation can continue moving the caret as typing begins.
    root.style.setProperty("scroll-behavior", "auto", "important");
    // Abort a smooth scroll that may already have been started by the question
    // transition or browser scroll-into-view before this panel was mounted.
    window.scrollTo({ left: window.scrollX, top: window.scrollY, behavior: "auto" });
    textarea.focus({ preventScroll: true });

    const finish = () => {
      if (stopped) return;
      stopped = true;
      if (previousInlineBehavior) {
        root.style.setProperty("scroll-behavior", previousInlineBehavior, previousInlinePriority);
      } else {
        root.style.removeProperty("scroll-behavior");
      }
    };

    const alignTextarea = () => {
      if (!textarea.isConnected) {
        finish();
        return;
      }

      const actionBar = document.querySelector<HTMLElement>("[data-testid='question-action-bar']");
      const scrollPaddingTop = Number.parseFloat(
        window.getComputedStyle(root).scrollPaddingTop
      ) || 0;
      const textareaRect = textarea.getBoundingClientRect();
      const visibleBottom = Math.min(
        window.innerHeight,
        actionBar?.getBoundingClientRect().top ?? window.innerHeight
      ) - 32;
      const scrollDelta = textareaRect.top < scrollPaddingTop
        ? textareaRect.top - scrollPaddingTop
        : textareaRect.bottom > visibleBottom
          ? textareaRect.bottom - visibleBottom
          : 0;

      const scrollIsStable = Math.abs(window.scrollY - previousScrollY) <= 0.5;
      previousScrollY = window.scrollY;
      if (Math.abs(scrollDelta) > 0.5) {
        alignedFrames = 0;
        window.scrollTo(window.scrollX, Math.max(0, window.scrollY + scrollDelta));
      } else if (scrollIsStable) {
        alignedFrames += 1;
      } else {
        alignedFrames = 0;
      }

      measuredFrames += 1;
      // Require several consecutive aligned paints so late sticky positioning,
      // font metrics, or entrance transitions cannot undo the correction.
      if (alignedFrames >= 6 || measuredFrames >= 120) {
        finish();
        return;
      }
      frame = window.requestAnimationFrame(alignTextarea);
    };

    alignTextarea();
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      finish();
    };
  }, [expanded]);

  return (
    <div className="mt-5">
      <button
        aria-controls={panelId}
        aria-expanded={expanded}
        aria-label={contextLabel
          ? `${expanded ? "收起" : "展开"}“${contextLabel.replace(/[？?]$/, "")}”的文字回答`
          : undefined}
        className="inline-flex min-h-11 items-center rounded-full border border-control-border bg-white px-4 text-sm font-semibold text-brand-700 transition hover:border-brand-500 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 motion-reduce:transition-none"
        disabled={disabled}
        onClick={() => setExpanded((current) => !current)}
        type="button"
      >
        {expanded
          ? "收起文字回答"
          : value.trim()
            ? "已填写补充，展开修改"
            : "自己填写或补充"}
      </button>

      {expanded ? (
        <div className="mt-4" id={panelId}>
          <label className="block" htmlFor={id}>
            <span className="text-sm font-semibold text-ink">文字回答</span>
            <span className="mt-1 block text-xs leading-5 text-muted-foreground" id={hintId}>
              可以只填写这里，也可以配合上面的选项补充。请勿填写姓名、学校或联系方式。
            </span>
            <textarea
              aria-label={contextLabel ? `文字回答：${contextLabel}` : undefined}
              aria-describedby={describedBy}
              aria-invalid={hasPersonalInfo || undefined}
              className="mt-2 min-h-24 w-full scroll-mb-28 resize-y rounded-[16px] border border-control-border bg-white px-4 py-3 text-sm leading-6 text-ink outline-none transition placeholder:text-muted-foreground/70 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 disabled:cursor-not-allowed disabled:opacity-55 motion-reduce:transition-none"
              disabled={disabled}
              id={id}
              maxLength={maxLength}
              onChange={(event) => onChange(event.target.value.slice(0, maxLength))}
              placeholder={placeholder}
              ref={textareaRef}
              value={value}
            />
          </label>
          <span className="mt-1 block text-right text-xs text-muted-foreground" id={countId}>
            {value.length}/{maxLength}
          </span>
          {hasPersonalInfo ? (
            <p className="mt-2 text-sm font-medium text-error-700" id={errorId} role="alert">
              {COMPETITION_NOTE_PRIVACY_MESSAGE}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
