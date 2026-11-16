import type { PilotContent } from "./pilots";
import type { CatalogDeepDive, CatalogMilestone, CatalogSource, SubjectDomain, CatalogEligibilityRule } from "@/lib/competitions/v6/catalog-types";

export type ResearchedContent = PilotContent & {
  name: string; organizer: string; aliases: string[];
  authorAgentId?: string;
  editionId: string; group: string; groupId: string; scopeId: string;
  subjectDomains: SubjectDomain[];
  origin: "legacy_135" | "verified_expansion";
  registrationStatus: "historical" | "closed" | "upcoming" | "unknown";
  registrationNote: string;
  milestones?: CatalogMilestone[];
  eligibilityRules?: CatalogEligibilityRule[];
  /** Source-authored atomic eligibility evidence; unrelated task/track facts cannot stand in for it. */
  eligibilityFacts?: { idSuffix: string; text: string; sourceIds: string[]; kind?: "official_fact" | "unknown"; scope?: string; status?: "historical" | "verified_current" | "pending_review" | "unknown" }[];
  /** Complete authored case; review status remains draft until two actual independent reviews. */
  deepCase?: CatalogDeepDive;
};

export function readSource(id: string, url: string, title: string, publisher: string, scope: string, locator: string, publishedAt: string | null = null): CatalogSource {
  return { id, url, title, publisher, scope, locator, publishedAt,
    checkedAt: "2026-11-05", retrievedAt: "2026-11-05", accessStatus: "body_read", authority: "organizer", verificationMethod: "agent_web_read", integrity: "consistent",
    evidenceArtifact: "artifacts/v6/content-research/batch-01-reading-log.json" };
}

/** Only structural normalization: every action, check and mapping is authored for the actual source. */
export function authoredDeepCase(input: {
  seriesId: string; task: string; title: string; sourceIds: string[]; boundary: string;
  steps: string[]; questions: string[]; rubrics: [string, string][];
  roles: { role: string; steps: string[]; contributionProof: string }[];
  weeks: [[string,string], [string,string], [string,string], [string,string]];
  exits: string[]; missing?: string[];
}): CatalogDeepDive {
  return { status: "draft", representativeTask: input.task,
    workedExample: { title: input.title, origin: "official_task", sourceIds: input.sourceIds, sourceBoundary: input.boundary, steps: input.steps, reviewQuestions: input.questions },
    rubricMapping: input.rubrics.map(([criterion,evidence]) => ({ criterion, evidence, official: true, factIds: [`${input.seriesId}:v2:rubric`] })),
    rolePaths: input.roles, fourWeekPlan: input.weeks.map(([action,completionCheck], index) => ({ week: index + 1, action, completionCheck })),
    exitConditions: input.exits, missingForPublication: input.missing ?? [] };
}
