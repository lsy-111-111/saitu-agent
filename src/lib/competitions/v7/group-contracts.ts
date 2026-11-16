import type { AiTokenUsage } from "@/lib/ai/ai-client";
import type { MatchPlanV6, DecisionReportV6 } from "../v6/contracts";
import type { ReviewAssertionV7 } from "./evidence-packet";
import type { DecisionModelOptionsV7, PreparedDecisionCallV7 } from "./model";
import type { OwnerBoundReviewKeyV759 } from "./review-transport";

export type ExplanationGroupIdV7 = "g0" | "g1";
/** Frozen run authority. Lease/fence/owner/resultVersion are intentionally absent. */
export type GroupRunBindingV7 = {
  runId: string;
  stateKey: string;
  generation: number;
  implementationSha256: string;
  effortPolicySha256: string;
  detailDeadlineEpochMs: number;
};
export type ExplanationGroupSpecV7 = {
  schemaVersion: "saitu.explanation-group.v1";
  run: GroupRunBindingV7;
  groupId: ExplanationGroupIdV7;
  profileId: string;
  profileRevision: string;
  profileSha256: string;
  catalogVersion: string;
  candidatePoolSha256: string;
  admittedOrderSha256: string;
  /** JSON-serialized complete frozen context; includes conditions/score/excluded. */
  frozenContextSha256: string;
  contextAsOf: string;
  fullPlanSha256: string;
  fullOrderSha256: string;
  rankPromptVersion: string;
  explanationPromptVersion: string;
  groupPromptVersion: string;
  effortPolicySha256: string;
  itemIds: string[];
  globalRanks: number[];
  comparison: { allowedItemIds: string[] };
};
export type GroupTaskSelectionV758 = {
  itemId: string;
  roleIndex: number;
  taskStepIndex: number;
  competitionFactId: string;
};
export type LearnerBasisSelectionV760 = {
  kind: "student_fact" | "goal";
  index: number;
};
export type LearnerRelationV759 = LearnerBasisSelectionV760 & { quote: string };
export type ConditionalTaskPracticeV763 = { needs: string; action: string };
export type FutureUseSelectionV764 = { futureUse: string; prerequisite?: string };
export type TaskRelationSelectionV766 = { mode: "understand"; taskPoint: string }
  | { mode: "apply"; taskPoint: string; prerequisite?: string };
export type GroupTaskSelectionV7 = GroupTaskSelectionV758 & {
  learnerRelation?: LearnerRelationV759;
  learnerBasisSelection?: LearnerBasisSelectionV760;
  conditionalPractice?: ConditionalTaskPracticeV763;
  futureUseSelection?: FutureUseSelectionV764;
  taskRelation?: TaskRelationSelectionV766;
  taskConnection?: string;
};
export type GroupExplanationEnvelopeV7 = {
  schemaVersion: "saitu.group-explanation.v1";
  groupBindingSha256: string;
  groupId: ExplanationGroupIdV7;
  profileRevision: string;
  catalogVersion: string;
  recommendations: MatchPlanV6["recommendations"];
  taskSelections?: GroupTaskSelectionV7[];
  shortfallReason: string | null;
  comparison?: MatchPlanV6["comparison"];
};
/** Immutable parsed result. Persist this BEFORE calling review. No wall-clock
 * trace, raw provider receipt, hidden reasoning or mutable lease data inside. */
export type PreparedGroupExplanationV7 = {
  schemaVersion: "saitu.prepared-group-explanation.v1";
  groupSpec: ExplanationGroupSpecV7;
  groupBindingSha256: string;
  explanation: GroupExplanationEnvelopeV7;
  explanationSha256: string;
  assertions: ReviewAssertionV7[];
  assertionsSha256: string;
  criticalKeys: string[];
  offlineSamples: (ReviewAssertionV7 & { sampleDigest: string })[];
  generationCallKeys: string[];
  preparedSha256: string;
};
/** Root store returns this after its CAS commit. This is not a DB lease or a
 * substitute for root rechecking current session/run/owner/fence/deadline. */
export type PersistedGroupAckV7 = {
  schemaVersion: "saitu.persisted-group-explanation.v1";
  runId: string;
  groupId: ExplanationGroupIdV7;
  groupBindingSha256: string;
  preparedSha256: string;
  persistedResultVersion: number;
  groupVersion: number;
};
export type GroupReviewPreparationV7 = {
  schemaVersion: "saitu.group-review-preparation.v1";
  groupId: ExplanationGroupIdV7;
  groupBindingSha256: string;
  preparedSha256: string;
  criticalAssertionsSha256: string;
  reviewPacketSha256: string;
  keyMapSha256: string;
  ownerKeyMapSha256?: string;
  call: PreparedDecisionCallV7;
};
export type MatchingRelationReviewBallotV765 = {
  key: string;
  fit: boolean;
  source: boolean;
  learnerAttribution: boolean;
  conditions: boolean;
  reason: string;
};
export type MatchingRelationReviewV765 = {
  requestSha256: string;
  ballotsSha256: string;
  ballots: MatchingRelationReviewBallotV765[];
  ownerKeys: OwnerBoundReviewKeyV759[];
};
export type ReviewedPreparedGroupV7 = {
  schemaVersion: "saitu.reviewed-group-explanation.v1";
  groupId: ExplanationGroupIdV7;
  groupBindingSha256: string;
  preparedSha256: string;
  assertionsSha256: string;
  reviewCallKey: string | null;
  matchingRelationReview?: MatchingRelationReviewV765;
  checks: { key: string; supported: boolean; reason: string }[];
  itemOutcomes: { itemId: string; globalRank: number; status: "ready" | "failed"; unsupportedKeys: string[] }[];
  comparisonFailed: boolean;
  reviewedSha256: string;
};
export type GroupModelOptionsV7 = DecisionModelOptionsV7 & {
  runBinding: GroupRunBindingV7;
  requestId: string;
  /** Exactly run.detailDeadlineEpochMs - 750; no new per-group window. */
  deadlineEpochMs: number;
};
export type ReviewPreparedGroupOptionsV7 = GroupModelOptionsV7 & {
  persisted: PersistedGroupAckV7;
  /** Await the root CAS/store preparation commit before unified invoke proceeds. */
  persistReviewPreparation: (preparation: GroupReviewPreparationV7) => Promise<void>;
};
export type GenerateGroupExplanationResultV7 = {
  prepared: PreparedGroupExplanationV7;
  /** Diagnostic only: do NOT sum across replays/groups for accounting. */
  localTrace: Partial<DecisionReportV6["trace"]>;
};
export type ReviewPreparedGroupResultV7 = {
  reviewed: ReviewedPreparedGroupV7;
  /** Diagnostic only: authoritative trace comes from unique call journal rows. */
  localTrace: Partial<DecisionReportV6["trace"]>;
};
export type UniqueGroupJournalCallV7 = {
  runId: string;
  callId: string;
  reservationId: string | null;
  callKey: string;
  upstreamAttempted: boolean;
  usage: AiTokenUsage | null;
};
export type GroupTraceAccountingV7 = {
  calls: UniqueGroupJournalCallV7[];
  /** Original run lifecycle clock supplied by root, never reset per group. */
  startedAtEpochMs: number;
  completedAtEpochMs: number;
};
