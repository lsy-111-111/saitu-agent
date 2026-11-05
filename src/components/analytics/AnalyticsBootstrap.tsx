"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { resolveAnalyticsCtaName } from "@/lib/analytics/constants";
import { trackEvent } from "@/lib/analytics/track";

function getClickableText(element: HTMLElement) {
  return element.innerText.replace(/\s+/g, " ").trim().slice(0, 80);
}

function analyticsCtaName(element: HTMLElement) {
  if (element.closest('[data-analytics-suppress="true"]')) {
    return null;
  }

  const text = getClickableText(element);
  const href = element instanceof HTMLAnchorElement ? element.getAttribute("href") ?? "" : "";
  return resolveAnalyticsCtaName(href, text);
}

export function AnalyticsBootstrap() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname === "/") {
      trackEvent("page_view_home");
    }
  }, [pathname]);

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      const clickable = target.closest("a,button");
      if (!(clickable instanceof HTMLElement)) {
        return;
      }

      const ctaName = analyticsCtaName(clickable);
      if (!ctaName) return;

      trackEvent("cta_click", {
        ctaName,
        position: pathname
      });
    }

    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [pathname]);

  return null;
}
