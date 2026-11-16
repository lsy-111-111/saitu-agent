"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  isRecommendationRunTerminal,
  recommendationRunSchema,
  type RecommendationRunV7,
} from "@/lib/competitions/v7/contracts";

export const RECOMMENDATION_RUN_STORAGE_KEY = "saitu.recommendationRun.v7";

const frozenRunFields = ["implementationVersion", "executionPolicy", "executionLimits", "effortPolicy", "effortPolicySha256", "listTargetAt", "rankDeadlineAt", "detailTargetAt", "detailDeadlineAt"] as const;

function isEmptyReviewedFailure(run: RecommendationRunV7): boolean {
  return run.status === "failed" && run.error === "NO_SUPPORTED_RECOMMENDATIONS" && !run.items.length && !run.report;
}

function isFinalReviewedSubset(previous: RecommendationRunV7, next: RecommendationRunV7): boolean {
  const report = next.report;
  if (isRecommendationRunTerminal(previous.status) || next.status !== "ready" || next.resultVersion <= previous.resultVersion ||
      !next.items.length || next.items.length >= previous.items.length || next.listReadyAt !== previous.listReadyAt ||
      !report || report.fallback.used || report.catalogVersion !== next.catalogVersion || report.profile.profileId !== next.profileId ||
      report.profile.revision !== next.profileRevision || report.recommendations.length !== next.items.length) return false;
  const priorItems = new Map(previous.items.map(item => [item.itemId, item]));
  let lastPriorRank = 0;
  return next.items.every((item, index) => {
    const prior = priorItems.get(item.itemId);
    if (!prior || prior.rank <= lastPriorRank || prior.seriesId !== item.seriesId || prior.name !== item.name ||
        prior.trackLabel !== item.trackLabel || prior.edition !== item.edition || prior.officialUrl !== item.officialUrl ||
        item.rank !== index + 1 || item.detailStatus !== "ready" || !item.detail ||
        JSON.stringify(item.detail) !== JSON.stringify(report.recommendations[index])) return false;
    lastPriorRank = prior.rank;
    return true;
  });
}

/** Keep the delivered list while polling until its reviewed final subset is available. */
export function mergeRecommendationRun(previous: RecommendationRunV7 | null, next: RecommendationRunV7): RecommendationRunV7 | null {
  if (!previous || previous.runId !== next.runId) return next;
  if (previous.decisionToken !== next.decisionToken || previous.profileId !== next.profileId ||
      previous.profileRevision !== next.profileRevision || previous.catalogVersion !== next.catalogVersion ||
      previous.policyVersion !== next.policyVersion || (previous.executionMode ?? "finite") !== (next.executionMode ?? "finite") || next.resultVersion < previous.resultVersion ||
      previous.submittedAt !== next.submittedAt || previous.expiresAt !== next.expiresAt ||
      frozenRunFields.some(field => previous[field] !== undefined && JSON.stringify(previous[field]) !== JSON.stringify(next[field]))) return null;
  if (!next.items.length && previous.items.length) {
    if (isEmptyReviewedFailure(next)) return !isRecommendationRunTerminal(previous.status) && next.resultVersion > previous.resultVersion && next.listReadyAt === previous.listReadyAt ? next : null;
    return next.status === "ready" ? null : { ...next, items: previous.items, report: next.report ?? previous.report };
  }
  if (previous.items.length && (previous.items.length !== next.items.length || previous.items.some((item, index) => {
    const update = next.items[index];
    return item.itemId !== update.itemId || item.seriesId !== update.seriesId || item.rank !== update.rank;
  }))) return isFinalReviewedSubset(previous, next) ? next : null;
  const delivered = new Map(previous.items.map(item => [item.itemId, item]));
  return { ...next, items: next.items.map(item => {
    const before = delivered.get(item.itemId);
    return before?.detailStatus === "ready" && item.detailStatus !== "ready" ? { ...item, detailStatus: "ready", detail: before.detail } : item;
  }), report: next.report ?? previous.report };
}

function persistRun(run: RecommendationRunV7, delivered: RecommendationRunV7 | null, context: unknown) {
  try {
    if (run.status === "expired" || run.status === "superseded" || Date.now() >= Date.parse(run.expiresAt)) {
      window.sessionStorage.removeItem(RECOMMENDATION_RUN_STORAGE_KEY);
      return;
    }
    window.sessionStorage.setItem(RECOMMENDATION_RUN_STORAGE_KEY, JSON.stringify({
      storageVersion: 1, run, previousList: delivered?.runId !== run.runId ? delivered : null, context,
    }));
  } catch { /* The current result stays usable when browser storage is unavailable. */ }
}

export function useRecommendationRunV7() {
  const [run, setRun] = useState<RecommendationRunV7 | null>(null);
  const [deliveredRun, setDeliveredRun] = useState<RecommendationRunV7 | null>(null);
  const [pollError, setPollError] = useState("");
  const [restoredContext, setRestoredContext] = useState<unknown>(null);
  const current = useRef<RecommendationRunV7 | null>(null);
  const delivered = useRef<RecommendationRunV7 | null>(null);
  const recoveryContext = useRef<unknown>(null);
  const generation = useRef(0);
  const active = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRef = useRef<() => Promise<void>>(async () => undefined);
  const failures = useRef(0);

  const pause = useCallback(() => {
    generation.current += 1;
    active.current = false;
    controller.current?.abort();
    controller.current = null;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const schedule = useCallback((delay: number) => {
    if (timer.current) clearTimeout(timer.current);
    if (active.current && current.current && !isRecommendationRunTerminal(current.current.status)) {
      timer.current = setTimeout(() => { void pollRef.current(); }, delay);
    }
  }, []);

  const install = useCallback((next: RecommendationRunV7) => {
    current.current = next;
    setRun(next);
    if (next.items.length || isEmptyReviewedFailure(next)) {
      delivered.current = next.items.length ? next : null;
      setDeliveredRun(delivered.current);
    }
    persistRun(next, delivered.current, recoveryContext.current);
  }, []);

  const poll = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const snapshot = current.current;
    if (!snapshot || !active.current || isRecommendationRunTerminal(snapshot.status)) return;
    const requestGeneration = generation.current;
    const requestController = new AbortController();
    controller.current?.abort();
    controller.current = requestController;
    try {
      const response = await fetch(`/api/ai/competition-recommend/runs/${encodeURIComponent(snapshot.runId)}`, {
        headers: { Authorization: `Bearer ${snapshot.decisionToken}` },
        cache: "no-store", signal: requestController.signal,
      });
      const payload: unknown = await response.json();
      if (requestGeneration !== generation.current || requestController.signal.aborted) return;
      if (!response.ok) {
        if (response.status === 401 || response.status === 404 || response.status === 410) {
          install({ ...snapshot, status: "expired", error: "RUN_EXPIRED" });
          setPollError("这次匹配已过期。已显示的名单仍可查看，修改画像后可以重新匹配。");
          return;
        }
        throw new Error("连接暂时中断，正在自动恢复。已显示的名单仍可查看。");
      }
      const parsed = recommendationRunSchema.safeParse(payload);
      if (!parsed.success || parsed.data.runId !== snapshot.runId) throw new Error("暂未取得完整更新，正在重试。已显示的名单仍可查看。");
      const merged = mergeRecommendationRun(current.current, parsed.data);
      if (!merged) throw new Error("这条更新与当前匹配不一致，正在重新获取。");
      failures.current = 0;
      setPollError("");
      install(merged);
      schedule(merged.pollAfterMs);
    } catch (error) {
      if (requestGeneration !== generation.current || requestController.signal.aborted) return;
      failures.current += 1;
      setPollError(error instanceof Error && !(error instanceof TypeError) ? error.message : "连接暂时中断，正在自动恢复。已显示的名单仍可查看。");
      schedule(Math.min(15_000, snapshot.pollAfterMs * 2 ** Math.min(failures.current, 4)));
    } finally {
      if (controller.current === requestController) controller.current = null;
    }
  }, [install, schedule]);

  useEffect(() => { pollRef.current = poll; }, [poll]);

  const adopt = useCallback((next: RecommendationRunV7, context?: unknown) => {
    pause();
    if (context !== undefined) recoveryContext.current = context;
    active.current = true;
    failures.current = 0;
    setPollError("");
    install(next);
    schedule(next.pollAfterMs);
  }, [install, pause, schedule]);

  const retryPoll = useCallback(() => {
    if (!current.current || isRecommendationRunTerminal(current.current.status)) return;
    active.current = true;
    failures.current = 0;
    void pollRef.current();
  }, []);

  const clear = useCallback(() => {
    pause();
    current.current = null;
    delivered.current = null;
    recoveryContext.current = null;
    setRun(null);
    setDeliveredRun(null);
    setPollError("");
    setRestoredContext(null);
    try { window.sessionStorage.removeItem(RECOMMENDATION_RUN_STORAGE_KEY); } catch { /* unavailable storage */ }
  }, [pause]);

  const isActive = useCallback(() => active.current, []);

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(RECOMMENDATION_RUN_STORAGE_KEY);
      if (raw) {
        const stored: unknown = JSON.parse(raw);
        if (stored && typeof stored === "object" && "storageVersion" in stored && stored.storageVersion === 1 && "run" in stored) {
          const parsed = recommendationRunSchema.safeParse(stored.run);
          if (parsed.success && Date.now() < Date.parse(parsed.data.expiresAt)) {
            if ("previousList" in stored) {
              const previous = recommendationRunSchema.safeParse(stored.previousList);
              if (previous.success && previous.data.items.length) {
                delivered.current = previous.data;
                setDeliveredRun(previous.data);
              }
            }
            recoveryContext.current = "context" in stored ? stored.context : null;
            setRestoredContext(recoveryContext.current);
            adopt(parsed.data);
            if (!isRecommendationRunTerminal(parsed.data.status)) void pollRef.current();
          } else window.sessionStorage.removeItem(RECOMMENDATION_RUN_STORAGE_KEY);
        }
      }
    } catch { /* A malformed saved session cannot replace current form state. */ }
    window.addEventListener("online", retryPoll);
    return () => { pause(); window.removeEventListener("online", retryPoll); };
  }, [adopt, pause, retryPoll]);

  useEffect(() => {
    if (!run || run.status === "expired" || run.status === "superseded") return;
    const remaining = Date.parse(run.expiresAt) - Date.now();
    const expiry = setTimeout(() => {
      pause();
      recoveryContext.current = null;
      install({ ...current.current!, status: "expired", error: "RUN_EXPIRED" });
      setPollError("本标签页的暂存记录已到期清除，已显示的名单仍可查看。");
    }, Math.max(0, remaining));
    return () => clearTimeout(expiry);
  }, [install, pause, run]);

  return { run, displayRun: run?.items.length ? run : deliveredRun, pollError, restoredContext, adopt, pause, clear, retryPoll, isActive };
}
