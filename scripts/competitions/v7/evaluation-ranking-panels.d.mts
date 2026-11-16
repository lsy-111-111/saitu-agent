export interface RawCanonicalReference { path: string; rawSha256: string; canonicalSha256: string }
export interface RankingPanelRules { panels: 2; shardsPerPanel: 24; profilesPerShard: 5; candidatesPerProfile: 45; authors: 48; maxConcurrentAuthors: 6; minimumRawOrdinalAlpha: 0.7; model: "gpt-6.1-sol"; reasoningEffort: "max"; unknownTreatment: "preserve_U_never_zero" }
export interface RankingReviewContract {
  schemaVersion: "saitu.ranking-panels-contract.v7.2"; policyVersion: string; policySha256: string; roundId: string; frozenAt: string;
  publicPlan: RawCanonicalReference; publicAssignments: RawCanonicalReference; sealedCollection: RawCanonicalReference; adjudication: RawCanonicalReference | null;
  catalogSha256: string; rankingSourceSnapshotSha256: string; profilePoolSha256: string; inputMetadataSha256: string; partitionSha256: string; rules: RankingPanelRules;
}
export interface RankingProfileMetadata { profileId: string; caseId: string; familyId: string; taskGroup: string; inputSha256: string }
export interface RankingCandidateMetadata { itemId: string; seriesId: string }
export interface RankingPlanMetadata { profiles: RankingProfileMetadata[]; candidates: RankingCandidateMetadata[]; binding: Record<string, string> }
export interface RankingPlanOptions { roundId: string; seed: number; frozenAt: string; coordinators: string[]; blockedAuthorContextIds: string[] }
export interface RankingPanelPlan extends RankingPlanMetadata, RankingPlanOptions { schemaVersion: string; policyVersion: string; policySha256: string; evidenceClass: "ai_proxy"; inputMetadataSha256: string; partitionSha256: string; shards: { shardId: string; profileIds: string[] }[] }
export interface RankingPanelAssignment { panelId: string; shardId: string; jobId: string; authorContextId: string; profileIds: string[]; expectedPacketPath: string; expectedRawPath: string; model: string; reasoningEffort: string; freshContextRequired: true }
export interface RankingPool { profileId: string; familyId: string; taskGroup: string; poolItemIds: string[]; judgments: { itemId: string; seriesId: string; relevance?: number | "U" }[]; [key: string]: unknown }
export interface RankingPanelContext { evidenceRoot: string; contract: RankingReviewContract; config: Record<string, unknown>; manifest: Record<string, unknown>; migration: Record<string, unknown>; registeredAt: string }
export interface RankingPanelMetadataVerification {
  schemaVersion: "saitu.ranking-panel-metadata-verification.v7.2"; contractSha256: string; publicPlanRawSha256: string; publicPlanCanonicalSha256: string;
  assignmentsRawSha256: string; sealedCollectionRawSha256: string; partitionSha256: string; inputMetadataSha256: string; profilePoolSha256: string;
  originalAuthors: 48; profiles: 120; pairedUnits: 5400; latestOriginalSealedAt: string; adjudicationReference: RawCanonicalReference | null;
  publicDevelopmentManifestSha256: string; rawGradesOpened: false;
}
export interface RankingPanelVerification {
  schemaVersion: "saitu.ranking-panel-originals-verification.v7.2"; policyVersion: string; policySha256: string; metadataVerification: RankingPanelMetadataVerification;
  panels: Record<string, unknown>[]; rows: Record<string, unknown>[]; statPairs: (number | "U")[][]; originalAgreement: Record<string, unknown>;
  unresolved: Record<string, unknown>[]; unresolvedAfterAdjudication: number; resolvedProfiles: RankingPool[] | null; blockers: string[];
  actualAuthorContextIds: string[]; rawOriginalBytesVerified: true; allOriginalsSealedBeforeStatistics: true; coordinatorGeneratedGrades: false; goldReady: boolean; productAcceptance: false;
}
export const RANKING_PANELS_VERSION: "saitu.ranking-panels-contract.v7.2";
export const RANKING_PANEL_RULES: Readonly<RankingPanelRules>;
export function buildRankingPanelPlan(metadata: RankingPlanMetadata, options: RankingPlanOptions): Readonly<RankingPanelPlan>;
export function assignRankingPanelAuthors(plan: Readonly<RankingPanelPlan>, authorContextIds: string[]): RankingPanelAssignment[];
export function rankingPanelProfilePoolSha256(profiles: RankingPool[]): string;
export function validateRankingReviewContract(contract: unknown, context?: { config?: Record<string, unknown>; manifest?: Record<string, unknown>; registeredAt?: string }): RankingReviewContract;
export function verifyRankingPanelMetadata(args: RankingPanelContext): Promise<RankingPanelMetadataVerification>;
export function loadRankingPanelsOriginals(args: RankingPanelContext & { expectedProfiles: RankingPool[]; expectedMetadataVerification?: RankingPanelMetadataVerification }): Promise<RankingPanelVerification>;
export function isVerifiedRankingPanels(value: unknown, context: { contract: RankingReviewContract; manifest: Record<string, unknown>; registeredAt: string; expectedProfiles: RankingPool[] }): boolean;
