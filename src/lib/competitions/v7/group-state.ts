import type { ExplanationGroupSpecV7, GroupReviewPreparationV7, PreparedGroupExplanationV7, ReviewedPreparedGroupV7 } from "./group-contracts";

export type PersistedDetailGroupV7 = {
  spec: ExplanationGroupSpecV7;
  version: number;
  status: "pending" | "prepared" | "reviewing" | "ready" | "failed";
  prepared?: PreparedGroupExplanationV7;
  preparedResultVersion?: number;
  preparedGroupVersion?: number;
  reviewPreparation?: GroupReviewPreparationV7;
  reviewed?: ReviewedPreparedGroupV7;
  error?: string;
  updatedAt: string;
};
export type PersistedDetailGroupsV7 = {
  schemaVersion: "saitu.persisted-detail-groups.v1";
  groups: PersistedDetailGroupV7[];
};
