"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import styles from "./AccessibleDirectoryDialog.module.css";

type AccessibleDirectoryDialogProps = {
  children: ReactNode;
  description?: string;
  onClose: () => void;
  open: boolean;
  title: string;
};

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])'
].join(",");

export function AccessibleDirectoryDialog({
  children,
  description,
  onClose,
  open,
  title
}: AccessibleDirectoryDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab" || !dialogRef.current) return;

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector)
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
      } else if (
        !event.shiftKey &&
        (activeIndex === -1 || activeIndex === focusable.length - 1)
      ) {
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
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div
      className={`${styles.backdrop} fixed inset-0 z-[60] flex items-end justify-center bg-ink/45 px-0 backdrop-blur-sm md:items-center md:px-6 md:py-8`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        aria-describedby={description ? descriptionId : undefined}
        aria-labelledby={titleId}
        aria-modal="true"
        className={`${styles.panel} flex max-h-[88dvh] min-h-[58dvh] w-full flex-col overflow-hidden rounded-t-[28px] border border-border bg-white shadow-lift md:min-h-0 md:max-w-[46rem] md:rounded-card`}
        ref={dialogRef}
        role="dialog"
      >
        <header className="relative flex shrink-0 items-center justify-between gap-4 border-b border-border px-5 py-4 sm:px-7 sm:py-5">
          <div className="min-w-0">
            <div aria-hidden="true" className="mb-3 h-1 w-11 rounded-full bg-ink/20 md:hidden" />
            <h2
              className="line-clamp-2 font-serif text-xl font-semibold leading-snug tracking-[-0.02em] text-ink sm:text-2xl"
              id={titleId}
            >
              {title}
            </h2>
            {description ? (
              <p className="sr-only" id={descriptionId}>
                {description}
              </p>
            ) : null}
          </div>
          <button
            aria-label="关闭弹窗"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-brand-50 hover:text-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
            onClick={onClose}
            ref={closeButtonRef}
            type="button"
          >
            <CloseIcon />
          </button>
        </header>
        <div className="conversation-scrollbar min-h-0 flex-1 overflow-y-auto px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-5 sm:px-7 sm:pb-7 sm:pt-6">
          {children}
        </div>
      </section>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" className="h-6 w-6" fill="none" viewBox="0 0 24 24">
      <path
        d="m6 6 12 12M18 6 6 18"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}
