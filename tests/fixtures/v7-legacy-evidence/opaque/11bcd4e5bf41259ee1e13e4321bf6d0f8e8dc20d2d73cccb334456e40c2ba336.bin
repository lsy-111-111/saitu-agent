export const TASK_FAMILIES = ["software-algorithms", "data-modeling", "engineering-prototype", "experimental-research", "investigation", "business-practice", "visual-interaction", "language-communication", "teaching-service"] as const;
export type TaskFamily = (typeof TASK_FAMILIES)[number];
export const DECISION_MODULES = ["task", "eligibility", "track", "participation", "deliverables", "rubric", "skills", "investment", "difficulty", "benefits", "value", "nextStep"] as const;
export type DecisionModule = (typeof DECISION_MODULES)[number];
export const VALUE_DIMENSIONS = ["governance", "taskRelevance", "portfolio", "learningFeedback", "industryAcademicAccess", "recognition"] as const;
export type ValueDimension = (typeof VALUE_DIMENSIONS)[number];
export type CoverageTier = "L0" | "L1" | "L2" | "L3";
export type ClaimKind = "official_fact" | "organizer_claim" | "editorial_inference" | "participant_report" | "published_price" | "unknown";
export type FactStatus = "verified_current" | "historical" | "pending_review" | "conflicting" | "unknown" | "not_applicable";
/** A missing day, timezone or expiry is never inferred from a year in a title. */
export type EvidenceDate = {
  raw: string | null; value: string | null;
  precision: "instant" | "day" | "month" | "year" | "range" | "unknown";
  timezone: string | null;
};
export type CatalogIdentity = {
  editionId: string; trackId: string; groupId: string; scopeId: string;
  stageIds: string[]; supersedesRecordIds: string[]; legacyRecordIds: string[];
};
export type CatalogMilestone = {
  id: string; stageId: string; kind: "registration" | "submission" | "event" | "results";
  label: string; date: EvidenceDate; factIds: string[];
};
export type CatalogAiReview = {
  runId: string; reviewerId: string; model: string; reviewedAt: string;
  contentDigest: string; method: "independent_source_recheck";
  sourceIds: string[]; evidenceArtifact: string;
  checks: { factualSupport: boolean; entityScope: boolean; studentUsefulness: boolean; temporalAccuracy: boolean };
  outcome: "approved" | "changes_requested";
  findings: { id: string; severity: "critical" | "major" | "minor"; description: string; resolved: boolean }[];
};
export type CatalogReview = {
  status: "draft" | "human_reviewed" | "independently_reviewed" | "ai_dual_reviewed";
  reviewerIds: string[]; reviewedAt: string | null;
  policy?: "human_review" | "ai_dual_review";
  authorAgentId?: string;
  humanReview?: { status: "not_performed" | "performed"; reviewerIds: string[]; reviewedAt: string | null };
  aiReviews?: CatalogAiReview[];
};
export const SUBJECT_DOMAINS = ["philosophy", "economics", "law", "education", "literature", "history", "science", "engineering", "agriculture", "medicine", "management", "arts", "interdisciplinary"] as const;
export type SubjectDomain = (typeof SUBJECT_DOMAINS)[number];
export type CatalogEligibilityRule = {
  id: string;
  field: "degree" | "year" | "age" | "major" | "region" | "institution" | "enrolled" | "fullTime" | "teamSize" | "sameInstitutionTeam" | "sameCountryTeam" | "mentor" | "priorQualification" | "professionalDeveloper" | "priorDegree" | "language" | "equipment" | "membership";
  operator: "eq" | "in" | "not_in" | "min" | "max" | "requires_confirmation";
  value: string | number | boolean | string[];
  factIds: string[]; note: string;
};
/** Explicit participation bounds. Missing entries remain unknown, never "not required". */
export type ParticipationRequirements = {
  teamSize: { value: { minimum: number; maximum: number } | null; factIds: string[] };
  mentor: { value: boolean | null; factIds: string[] };
  laboratory: { value: boolean | null; factIds: string[] };
  equipment: { value: string[] | null; factIds: string[] };
  attendance: { value: "remote" | "local" | "travel" | null; factIds: string[] };
  weeklyHours: { value: number | null; factIds: string[]; meaning?: "official_complete_path_weekly_bound" | "official_event_duration" };
};
export type CatalogSource = {
  id: string; url: string; title: string; publisher: string;
  authority: "organizer" | "official_host" | "university_local" | "supplier" | "other";
  scope: string; checkedAt: string | null; publishedAt: string | null;
  accessStatus: "body_read" | "excerpt_read" | "metadata_only" | "unavailable" | "imported_unrechecked";
  locator: string; verificationMethod: "agent_web_read" | "legacy_import" | "human_review";
  retrievedAt?: string | null;
  publicationDate?: EvidenceDate;
  evidenceArtifact?: string;
  integrity?: "unassessed" | "consistent" | "requires_recheck";
  publicPriceCapture?: { sourceArtifact: string; sourceByteSha256: string; bodyArtifact: string; bodySha256: string; retrievedAt: string };
};
export type CatalogFact = {
  id: string; field: string; text: string; kind: ClaimKind; status: FactStatus;
  sourceIds: string[]; scope: string; checkedAt: string | null;
  /** Exact per-source scope bindings; never collapses different documents into one invented scope. */
  sourceScopes?: { sourceId: string; scope: string }[];
  supersedes: string[]; conflictsWith: string[];
  entity?: { editionId: string; trackId: string; groupId: string; scopeId: string };
  validFrom?: EvidenceDate; validUntil?: EvidenceDate;
  retrievedAt?: string | null; lastVerifiedAt?: string | null;
  reviewStatus?: "pending_review" | "ai_dual_reviewed" | "human_reviewed";
  publicPrice?: { currency: "CNY"; maximumUnitFen: number; unit: string; validFrom: string; validThrough: string; applicableScope: string; conditions: string[] };
};
export type DecisionClaim = {
  text: string; kind: ClaimKind; factIds: string[]; conditions: string[];
  /** A reason is mandatory for unknown / not applicable modules. */
  unknownReason?: string;
};
export type CatalogRole = {
  name: string; task: string; skills: string[]; evidenceToAsk: string;
  personalDeliverable: string; prerequisite: "required" | "learnable" | "advantage";
  factIds: string[];
};
export type CatalogDeepDive = {
  status: "draft" | "reviewed";
  representativeTask: string;
  workedExample: { title: string; origin: "editorial_example" | "official_task" | "published_summary" | "published_work"; sourceIds: string[]; sourceBoundary?: string; steps: string[]; reviewQuestions: string[] };
  /** Requirements are not scoring weights. Evidence descriptions are editorial suggestions. */
  requirementMapping?: { requirement: string; evidence: string; factIds: string[] }[];
  rubricMapping: { criterion: string; evidence: string; official: boolean; factIds: string[] }[];
  rolePaths: { role: string; steps: string[]; contributionProof: string }[];
  fourWeekPlan: { week: number; action: string; completionCheck: string }[];
  exitConditions: string[];
  missingForPublication: string[];
};
export type DecisionCompetitionRecord = {
  schemaVersion: "saitu.competition.v2"; catalogVersion: string;
  recordId: string; seriesId: string; name: string; aliases: string[]; organizer: string;
  edition: string; track: { id: string; name: string }; group: string;
  identity?: CatalogIdentity;
  stages?: { id: string; name: string; factIds: string[] }[];
  milestones?: CatalogMilestone[];
  subjectDomains?: SubjectDomain[];
  eligibilityRules?: CatalogEligibilityRule[];
  scope: string; taskFamily: TaskFamily; subjectTags: string[];
  summary: string; pilot: boolean;
  /** Computed by the validator; a draft target is never a published tier. */
  contentTier: CoverageTier; targetTier: "L1" | "L2" | "L3";
  review: CatalogReview;
  registration: { status: "open" | "closed" | "upcoming" | "unknown" | "historical"; checkedAt: string | null; factIds: string[]; note: string };
  cost?: { minimumPersonalCny: number | null; maximumPersonalCny: number | null; factIds: string[]; scope: string; note: string };
  participationRequirements?: ParticipationRequirements;
  participationPlans?: import("./participation-plan").FormalParticipationPlan[];
  sources: CatalogSource[]; facts: CatalogFact[];
  sections: Record<DecisionModule, DecisionClaim[]>;
  roles: CatalogRole[];
  valueDimensions: { dimension: ValueDimension; assessment: DecisionClaim; evidenceLevel: "supported" | "partial" | "unknown" }[];
  difficulty: { stage: "entry" | "completion" | "award"; summary: string; assumptions: string[]; factIds: string[] }[];
  /** Soft discovery signals; never official entry requirements. */
  skills: string[]; interests: string[]; preferredOutputs: string[];
  experienceSignals: string[];
  suitability: { goodFit: string[]; poorFit: string[]; uncertainties: string[] };
  sevenDayTrial: { action: string; output: string; completionCheck: string; reflection: string };
  schoolPolicyReminder: string;
  deepDive?: CatalogDeepDive;
  publication: { mode: "discovery_only" | "conditional_exploration" | "decision_ready"; productionReady: boolean; blockers: string[]; policy?: "human_review" | "ai_dual_review"; humanPolicyReady?: boolean; aiPolicyReady?: boolean };
  migration: { origin: "legacy_135" | "verified_expansion"; originalSeriesId: string; originalCheckedAt: string | null; note: string; legacyTrack?: unknown };
};
export type CatalogValidationIssue = { code: string; path: string; message: string; blocks: "L1" | "L2" | "L3" | "registration" | "publication" | "strict_participation" };
export type CatalogValidation = { tier: CoverageTier; issues: CatalogValidationIssue[]; recommendationMode: DecisionCompetitionRecord["publication"]["mode"]; currentRegistrationVerified: boolean };
export type CoverageProfile = {
  id: string; kind: "core" | "special"; label: string; taskFamily: TaskFamily;
  experience: "beginner" | "coursework";
  resources: "constrained" | "supported";
  education: { degree: "undergraduate"; year: 1 | 2; major: string };
  evidence: string[]; interests: string[]; goals: string[];
  weeklyHours: number; budgetCny: number; team: "none" | "can_form"; mentor: boolean;
  laboratory: boolean; equipment: string[]; mobility: "remote_only" | "local";
  /** Explicit owned services/entitlements, never inferred from equipment or obtainable resources. */
  ownedResources?: { kind: "device" | "connectivity" | "software_license" | "compute_service" | "materials" | "travel_pass" | "lodging_entitlement"; name: string }[];
  resourceAssumptions?: string[];
  constraints: string[]; expectedBehavior: string[];
};
export type ExpansionCandidate = {
  id: string; name: string; priority: "P1"; decision: string;
  sourceUrls: string[]; existingSeriesId: string | null; discoveryReason: string;
  verificationStatus: "pending" | "partial" | "verified" | "rejected" | "merged";
  checkedAt: string | null; findings: string[]; blockers: string[];
  /** Never counted as a published series merely because discovery succeeded. */
  publishable: boolean;
};
export type CatalogChangeProposal = {
  id: string; recordId: string; createdAt: string; sourceId: string;
  field: string; previousValue: unknown; proposedValue: unknown; reason: string;
  risk: "critical" | "editorial"; status: "pending_review" | "approved" | "rejected";
  reviewerId: string | null; reviewedAt: string | null;
};
