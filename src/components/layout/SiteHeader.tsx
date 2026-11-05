"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BrandMark } from "@/components/brand/BrandMark";
import type { NavigationItem } from "@/content/navigation";
import { cn } from "@/lib/utils";

function normalizePath(href: string) {
  const path = href.split("?")[0] || "/";
  return path.length > 1 ? path.replace(/\/$/, "") : path;
}

function isActiveNavItem(pathname: string, href: string) {
  const target = normalizePath(href);
  const current = normalizePath(pathname);
  if (target === "/competitions") return current === target;
  return current === target || (target !== "/" && current.startsWith(`${target}/`));
}

const dualActionPaths = new Set(["/competitions", "/teams", "/about"]);

function getHeaderActions(pathname: string) {
  const current = normalizePath(pathname);
  if (current === "/competitions/recommend") {
    return [{ href: "/", label: "回到首页" }] as const;
  }
  if (dualActionPaths.has(current)) {
    return [
      { href: "/competitions/recommend", label: "打开竞赛助手" },
      { href: "/", label: "回到首页" }
    ] as const;
  }
  return [{ href: "/competitions/recommend", label: "打开竞赛助手" }] as const;
}

export function SiteHeader({ items }: { items: readonly NavigationItem[] }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const menuDialogRef = useRef<HTMLDivElement>(null);
  const actions = getHeaderActions(pathname);

  useEffect(() => setMenuOpen(false), [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
        return;
      }

      if (event.key !== "Tab" || !menuDialogRef.current) {
        return;
      }

      const focusable = Array.from(
        menuDialogRef.current.querySelectorAll<HTMLElement>(
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
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  const closeMenu = () => {
    setMenuOpen(false);
    window.requestAnimationFrame(() => menuButtonRef.current?.focus());
  };

  return (
    <header className="sticky top-0 z-50 border-b border-border/80 bg-white/90 backdrop-blur-xl">
      <div className="mx-auto flex min-h-[72px] max-w-[1512px] items-center justify-between gap-5 px-5 sm:px-7 xl:min-h-[86px] xl:px-5">
        <Link aria-label="赛途 Campus 首页" className="rounded-lg" href="/"><BrandMark priority /></Link>
        <nav aria-label="主导航" className="hidden items-center gap-1 xl:flex">
          {items.map((item) => {
            const active = isActiveNavItem(pathname, item.href);
            return (
              <Link aria-current={active ? "page" : undefined} className={cn("relative flex min-h-11 items-center rounded-lg px-4 text-sm font-semibold transition-colors", active ? "text-brand-700" : "text-ink/65 hover:bg-brand-50/70 hover:text-ink")} href={item.href} key={item.href}>
                {item.label}
                {active ? <span className="absolute inset-x-4 -bottom-[22px] h-0.5 rounded-full bg-orbit-gradient" /> : null}
              </Link>
            );
          })}
        </nav>
        <div className="hidden items-center gap-2 xl:flex">
          {actions.map((action, index) => (
            <Link
              className={cn(
                "inline-flex min-h-[52px] items-center justify-center rounded-button px-5 text-sm font-semibold transition duration-200 hover:-translate-y-0.5 motion-reduce:transform-none",
                index === 0
                  ? "bg-brand-gradient text-white shadow-soft hover:shadow-lift"
                  : "border border-control-border bg-white text-ink hover:border-brand-500 hover:bg-brand-50 hover:text-brand-700"
              )}
              href={action.href}
              key={action.href}
            >
              {action.label}
            </Link>
          ))}
        </div>
        <button aria-controls="mobile-navigation" aria-expanded={menuOpen} aria-label="打开导航菜单" className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-control-border bg-white text-ink transition hover:border-brand-500 hover:bg-brand-50 hover:text-brand-600 xl:hidden" onClick={() => setMenuOpen(true)} ref={menuButtonRef} type="button">
          <svg aria-hidden="true" fill="none" height="22" viewBox="0 0 24 24" width="22"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" /></svg>
        </button>
      </div>
      {menuOpen ? (
        <div aria-label="主导航菜单" aria-modal="true" className="fixed inset-0 z-[70] bg-ink/25 backdrop-blur-sm xl:hidden" id="mobile-navigation" ref={menuDialogRef} role="dialog">
          <button aria-hidden="true" className="absolute inset-0 h-full w-full cursor-default" onClick={closeMenu} tabIndex={-1} type="button" />
          <div className="absolute inset-x-3 top-3 rounded-2xl border border-border bg-white p-4 shadow-lift sm:left-auto sm:right-5 sm:w-[360px]">
            <div className="flex items-center justify-between gap-4 border-b border-border pb-4">
              <BrandMark />
              <button aria-label="关闭导航菜单" className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-control-border text-ink transition hover:border-brand-500 hover:bg-brand-50 hover:text-brand-700" onClick={closeMenu} ref={closeButtonRef} type="button">
                <svg aria-hidden="true" fill="none" height="22" viewBox="0 0 24 24" width="22"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" /></svg>
              </button>
            </div>
            <nav aria-label="移动端主导航" className="mt-3 grid gap-1">
              {items.map((item) => {
                const active = isActiveNavItem(pathname, item.href);
                return <Link aria-current={active ? "page" : undefined} className={cn("flex min-h-12 items-center justify-between rounded-lg border px-4 text-base font-semibold", active ? "border-brand-300 bg-brand-50 text-brand-700" : "border-transparent text-ink hover:bg-surface")} href={item.href} key={item.href} onClick={() => setMenuOpen(false)}>{item.label}<span aria-hidden="true">→</span></Link>;
              })}
            </nav>
            <div className="mt-4 grid gap-2">
              {actions.map((action, index) => (
                <Link
                  className={cn(
                    "inline-flex min-h-12 w-full items-center justify-center rounded-button px-5 text-sm font-semibold",
                    index === 0
                      ? "bg-brand-gradient text-white shadow-soft"
                      : "border border-control-border bg-white text-ink"
                  )}
                  href={action.href}
                  key={action.href}
                  onClick={() => setMenuOpen(false)}
                >
                  {action.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}
