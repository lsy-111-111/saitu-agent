import type { GroundedBridgeSelectionV7 } from "@/lib/competitions/v7/match-learning-selection";
import type { LearnerBasisSelectionV760, MatchingRelationReviewBallotV765 } from "@/lib/competitions/v7/group-contracts";
import { expandGroundedReviewEvidenceV7 } from "@/lib/competitions/v7/review-transport";

export function groundedBridgeFixture(competitionFactId: string, studentBasis: string | number,
  bridge: string): GroundedBridgeSelectionV7 {
  return {
    competitionFactIds: [competitionFactId],
    studentFactIds: typeof studentBasis === "string" ? [studentBasis] : [],
    ...(typeof studentBasis === "number" ? { goalIndex: studentBasis } : {}),
    bridge,
  };
}

export const studentFactBasis = (index = 0): LearnerBasisSelectionV760 => ({ kind: "student_fact", index });
export const goalBasis = { kind: "goal", index: 0 } as const;

export function matchingRelationReviewBallotFixture(key: string, reason: string,
  overrides: Partial<Omit<MatchingRelationReviewBallotV765, "key" | "reason">> = {}): MatchingRelationReviewBallotV765 {
  return { key, fit: true, source: true, learnerAttribution: true, conditions: true, reason, ...overrides };
}

export function taskConnectionReasonFixture(taskConnection = "原任务中各项处理决定怎样通过数据分析核对。", learnerBasisIndex?: number) {
  return { taskConnection, ...(learnerBasisIndex === undefined ? {} : { learnerBasisIndex }) };
}

export { taskConnectionReasonFixture as serverBoundGroupReasonFixture };

export function groupReasonFixture(factIndex: number | undefined, studentBasisIndex: number, taskConnection?: string, learnerBasisIndex?: number) {
  return { ...(factIndex === undefined ? {} : { factIndex }), studentBasisIndices: [studentBasisIndex],
    ...taskConnectionReasonFixture(taskConnection, learnerBasisIndex) };
}

export function decodedGroupWire(prompt: string) {
  return expandGroundedReviewEvidenceV7(JSON.parse(prompt));
}
