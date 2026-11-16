import type { RankingPanelVerification } from "./evaluation-ranking-panels.mjs";
export interface ScoringOriginalContext { bundle: unknown; matrix: unknown; registration: unknown }
export interface RawScoringVerification { schemaVersion: string; rawOriginalBytesVerified: true; [key: string]: unknown }
export function isVerifiedOriginals(value: unknown, context: ScoringOriginalContext): boolean;
export function getVerifiedRankingPanels(value: unknown, context: ScoringOriginalContext): RankingPanelVerification | null;
export function loadScoringOriginals(args: { evidenceRoot: string; bundle: Record<string, unknown>; ranking: { registration: Record<string, unknown>; matrix: Record<string, unknown>; freezeManifestSha256?: string } }): Promise<RawScoringVerification>;
