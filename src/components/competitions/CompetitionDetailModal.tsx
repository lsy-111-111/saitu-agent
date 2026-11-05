"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { CompetitionDetailContent } from "@/components/competitions/CompetitionDetailContent";
import type { Competition } from "@/content/competitions";
import styles from "./CompetitionDetailModal.module.css";

type CompetitionDetailModalProps = {
  availabilityNow?: Date;
  competition: Competition | null;
  onClose: () => void;
  onSourceClick: (competitionId: string) => void;
};

export function CompetitionDetailModal({
  availabilityNow,
  competition,
  onClose,
  onSourceClick
}: CompetitionDetailModalProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!competition) {
      return;
    }

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab" || !dialogRef.current) {
        return;
      }

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]):not([tabindex="-1"]), [tabindex]:not([tabindex="-1"])'
        )
      );
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeIndex = focusable.indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey && activeIndex <= 0) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (activeIndex === -1 || activeIndex === focusable.length - 1)) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [competition, onClose]);

  if (!competition) {
    return null;
  }

  return (
    <div
      className={`${styles.backdrop} fixed inset-0 z-50 flex items-end justify-center bg-ink/55 px-0 backdrop-blur-sm md:items-center md:px-5 md:py-8`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        aria-labelledby="competition-detail-title"
        aria-modal="true"
        className={`${styles.panel} flex max-h-[92dvh] min-h-[72dvh] w-full flex-col overflow-hidden rounded-t-[26px] border border-border bg-card shadow-lift md:min-h-0 md:max-h-[90dvh] md:max-w-[55rem] md:rounded-card`}
        ref={dialogRef}
        role="dialog"
      >
        <div className="relative z-20 flex shrink-0 items-center justify-between border-b border-border bg-card/95 px-5 py-3 backdrop-blur md:px-7">
          <div aria-hidden="true" className="h-1 w-10 rounded-full bg-ink/20 md:hidden" />
          <p className="hidden text-xs font-semibold tracking-[0.12em] text-brand-700 md:block">竞赛详情</p>
          <button
            aria-label="关闭竞赛详情"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-control-border text-ink hover:border-brand-400 hover:bg-brand-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
            onClick={onClose}
            ref={closeButtonRef}
            type="button"
          >
            <CloseIcon />
          </button>
        </div>
        <div className="conversation-scrollbar min-h-0 flex-1 overflow-y-auto px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5 md:px-8 md:pb-8 md:pt-7">
          <Link href={`/competitions/${competition.id}`} className="mb-2 inline-flex min-h-11 items-center rounded px-2 text-sm font-semibold text-brand-700 underline underline-offset-4">打开可分享的详情页</Link>
          <CompetitionDetailContent
            availabilityNow={availabilityNow}
            competition={competition}
            headingId="competition-detail-title"
            onSourceClick={onSourceClick}
          />
        </div>
      </section>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24">
      <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}
