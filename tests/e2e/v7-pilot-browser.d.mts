import type { Page } from "@playwright/test";
export function pilotProbeBootstrap(options: { key: string }): void;
export function startPilotClock(page: Page, key: string): Promise<number>;
export function bindPilotRunClock(page: Page, key: string, runId: string, originalClickEpochMs: number): Promise<void>;
export function snapshotPilotAccountingLog(log: { path: string; sourceSha256: string }): Promise<unknown>;
export function capturePilotAccountingTrace(log: { path: string; sourceSha256: string }, before: unknown, httpOriginals: { requestId: string }[]): Promise<{ complete: boolean; issues: string[]; events: unknown[] }>;
export function selectPilotOwnedLedgerRows(allRows: any[], calls: any[], accountingTrace: any, httpOriginals: any[]): any;
export function pilotBatchLedgerClosure(allRows: any[], observations: any[]): any;
