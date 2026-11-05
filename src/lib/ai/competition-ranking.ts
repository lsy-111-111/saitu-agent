import { getDocumentedCompetitionAvailability } from "@/lib/competitions/documented-availability";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  DEFAULT_DEEPSEEK_MODEL,
  getCompetitionAiProviderFailureReason,
  getConfiguredAiModel,
  getConfiguredAiProvider,
  requestAiJson,
  type AiJsonFailureReason
} from "@/lib/ai/ai-client";
import { buildPrompt } from "@/lib/ai/prompt-builder";
import {
  sanitizeCompetitionProfileForAi,
  sanitizeCompetitionTranscriptForAi
} from "@/lib/ai/competition-request-schema";
import type { CompetitionMetadataSource } from "@/content/competitions";
import type { DeterministicCompetitionRecommendation } from "@/lib/competitions/recommendation-engine";
import {
  assessCompetitionConfirmedSubjectAlignment,
  type CompetitionConfirmedSubjectAssessment
} from "@/lib/competitions/scoring";
import type {
  CompetitionDynamicExchangeV3,
  CompetitionPreferredOutput,
  CompetitionRecommendationExplanation,
  CompetitionRecommendationItemV3,
  CompetitionRecommendationProfileV5,
  CompetitionRecommendationRankingSource
} from "@/types/competition-recommendation";

export const COMPETITION_RANK_PROMPT_VERSION = "competition-rank.v4" as const;

type RankingProfile = CompetitionRecommendationProfileV5;
type EvidenceKind = "match" | "gap" | "tip";
type OfficialEvidenceFact = NonNullable<CompetitionMetadataSource["facts"]>[number];
type EvidenceProvenance =
  | { type: "official-fact"; fact: OfficialEvidenceFact; sourceRef: string; sourceUrl: string }
  | { type: "editorial-inference" }
  | { type: "user-confirmed" }
  | { type: "preparation" };
type EvidenceEntry = {
  ref: string;
  kind: EvidenceKind;
  text: string;
  provenance: EvidenceProvenance;
};
type CandidateEvidenceContext = {
  candidate: DeterministicCompetitionRecommendation;
  sourceRef: string;
  officialSources: CompetitionMetadataSource[];
  evidenceCatalog: EvidenceEntry[];
  recommendedTrack: { id: string; label: string; evidenceRef?: string } | null;
  confirmedFitSignalAssessment: {
    requested: string[];
    supported: string[];
    matched: string[];
  };
  confirmedSubjectAssessment: CompetitionConfirmedSubjectAssessment;
};

const preferredOutputLabels: Record<CompetitionPreferredOutput, string> = {
  software: "软件或 AI 应用",
  prototype: "实物原型",
  "research-paper": "研究报告或论文",
  "business-plan": "商业计划书",
  "creative-work": "设计或媒体作品",
  presentation: "路演或演讲",
  "career-plan": "职业发展方案"
};

const rankedItemSchema = z.object({
  competitionId: z.string().min(1).max(100),
  matchEvidenceRefs: z.array(z.string().trim().min(1).max(160)).min(1).max(3),
  gapEvidenceRefs: z.array(z.string().trim().min(1).max(160)).min(1).max(3),
  preparationTipRefs: z.array(z.string().trim().min(1).max(160)).min(2).max(3)
}).strict();

type DiagnosticSchema<T> = {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
};

function withTestOnlyRankSchemaDiagnostics<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>): DiagnosticSchema<T> {
  return {
    safeParse(value: unknown) {
      const result = schema.safeParse(value);
      if (!result.success && process.env.AI_TEST_MODE === "1" && process.env.AI_RANK_SCHEMA_DIAGNOSTICS === "1") {
        console.warn(JSON.stringify({
          event: "competition_rank_schema_rejection",
          promptVersion: COMPETITION_RANK_PROMPT_VERSION,
          issues: result.error.issues.map(({ code, path }) => ({ code, path }))
        }));
      }
      return result.success ? { success: true as const, data: result.data } : { success: false as const };
    }
  };
}

function hashRef(prefix: string, value: string) {
  return `${prefix}:${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
}

function officialSources(candidate: DeterministicCompetitionRecommendation) {
  const metadata = candidate.competition.recommendation;
  const sources = [
    metadata.source,
    metadata.eligibility?.source,
    metadata.eligibility?.firstHigherEducationYearCutoff?.source,
    ...(metadata.supportingSources ?? [])
  ].filter((source): source is CompetitionMetadataSource => Boolean(
    source?.evidenceRef &&
    source.sourceType !== "unknown" &&
    /^https:\/\//i.test(source.url)
  ));
  return sources.filter((source, index) =>
    sources.findIndex(({ evidenceRef }) => evidenceRef === source.evidenceRef) === index
  );
}

function sourceForFact(
  sources: readonly CompetitionMetadataSource[],
  fact: OfficialEvidenceFact,
  preferredRef?: string
) {
  return sources.find((source) =>
    source.evidenceRef === preferredRef && source.facts?.includes(fact)
  ) ?? sources.find((source) => source.facts?.includes(fact));
}

/** Compatibility pointer until every catalog source exposes a stable evidenceRef. */
export function stableCompetitionEvidenceRef(candidate: DeterministicCompetitionRecommendation) {
  const sources = officialSources(candidate);
  return sourceForFact(sources, "identity", candidate.competition.identity?.evidenceRef)?.evidenceRef ||
    candidate.competition.identity?.evidenceRef ||
    sourceForFact(sources, "identity")?.evidenceRef ||
    hashRef("official-source", candidate.sourceUrl);
}

function addEvidence(
  target: EvidenceEntry[],
  kind: EvidenceKind,
  ref: string,
  text: string,
  provenance: EvidenceProvenance
) {
  if (!target.some((entry) => entry.ref === ref)) target.push({ ref, kind, text, provenance });
}

function addOfficialEvidence(
  target: EvidenceEntry[],
  sources: readonly CompetitionMetadataSource[],
  kind: EvidenceKind,
  ref: string,
  text: string,
  fact: OfficialEvidenceFact,
  preferredRef?: string
) {
  const source = sourceForFact(sources, fact, preferredRef);
  if (!source?.evidenceRef) return false;
  addEvidence(target, kind, ref, text, {
    type: "official-fact",
    fact,
    sourceRef: source.evidenceRef,
    sourceUrl: source.url
  });
  return true;
}

function officialFactForEligibilityText(text: string): OfficialEvidenceFact {
  if (/首次.*高等教育|高等教育年份/.test(text)) return "firstHigherEducationYearCutoff";
  if (/参赛人数|队伍人数|团队人数/.test(text)) return "teamRequirement";
  return "eligibility";
}

function officialFactForGapText(text: string): OfficialEvidenceFact | null {
  if (/缺少必需资源/.test(text)) return "requiredResources";
  if (/报名|赛期|赛程|截止|开放|下一届/.test(text)) return "schedule";
  if (/首次.*高等教育|高等教育年份/.test(text)) return "firstHigherEducationYearCutoff";
  if (/参赛人数|队伍人数|团队人数/.test(text)) return "teamRequirement";
  if (/资格|全日制|同一参赛单位|同校/.test(text)) return "eligibility";
  return null;
}

function buildCandidateEvidence(
  profile: RankingProfile,
  candidate: DeterministicCompetitionRecommendation,
  transcript: readonly CompetitionDynamicExchangeV3[]
): CandidateEvidenceContext {
  const sourceRef = stableCompetitionEvidenceRef(candidate);
  const sources = officialSources(candidate);
  const catalog: EvidenceEntry[] = [];
  const metadata = candidate.competition.recommendation;
  const selectedTrackId = transcript.find(({ question }) => question.signalKey === `track:${candidate.competitionId}`)?.answer.selectedValues[0];
  const selectedTrack = candidate.competition.recommendation.tracks?.find(({ id }) => id === selectedTrackId);
  const recommendedTrack = selectedTrack
    ? {
        id: selectedTrack.id,
        label: selectedTrack.label,
        ...(selectedTrack.evidenceRef ? { evidenceRef: selectedTrack.evidenceRef } : {})
      }
    : candidate.recommendedTrack;
  const recommendedTrackMetadata = recommendedTrack
    ? metadata.tracks?.find(({ id }) => id === recommendedTrack.id)
    : undefined;
  const requestedFitSignals = [...new Set(transcript
    .filter(({ question }) => question.signalKey === "competition-fit")
    .flatMap(({ answer }) => answer.selectedValues))];
  const supportedFitSignals = [...new Set(recommendedTrackMetadata?.fitSignals ?? metadata.fit?.signals ?? [])];
  const supportedFitSignalSet = new Set<string>(supportedFitSignals);
  const matchedConfirmedFitSignals = requestedFitSignals.filter((signal) => supportedFitSignalSet.has(signal));
  const prioritizedGoal = transcript.find(
    ({ question }) => question.signalKey === "candidate-goal-tradeoff"
  )?.answer.selectedValues[0];
  const confirmedSubjectAssessment = assessCompetitionConfirmedSubjectAlignment(candidate.competition, profile);
  for (const major of confirmedSubjectAssessment.matchedPrimaryMajors) {
    addEvidence(
      catalog,
      "match",
      `profile.major:${major}`,
      `已确认主学科“${major}”命中目录专业标签；这是编辑推断，不是赛事官方结论。`,
      { type: "editorial-inference" }
    );
  }
  for (const subject of confirmedSubjectAssessment.matchedSpecificSubjects) {
    addEvidence(
      catalog,
      "match",
      `profile.subject:${subject}`,
      `已确认细分学科“${subject}”命中目录学科标签；这是编辑推断，不是赛事官方结论。`,
      { type: "editorial-inference" }
    );
  }
  for (const signal of matchedConfirmedFitSignals) {
    addEvidence(
      catalog,
      "match",
      `candidate.fit:${signal}`,
      `系统依据你确认的条件与目录赛项标签“${signal}”作出匹配推断；这不是赛事官方结论。`,
      { type: "editorial-inference" }
    );
  }
  if (
    prioritizedGoal &&
    Object.prototype.hasOwnProperty.call(metadata.goalValues, prioritizedGoal)
  ) {
    addEvidence(
      catalog,
      "match",
      `profile.goal-priority:${prioritizedGoal}`,
      `系统根据你追问中确认的优先收获“${prioritizedGoal}”与目录目标标签作出匹配推断；这不是获奖或录取承诺。`,
      { type: "user-confirmed" }
    );
  }
  for (const skill of profile.skills.filter((value) => metadata.skills.includes(value))) {
    addEvidence(
      catalog,
      "match",
      `profile.skill:${skill}`,
      `系统依据你确认的技能“${skill}”与目录能力标签作出匹配推断；这不是赛事官方结论。`,
      { type: "editorial-inference" }
    );
  }
  for (const interest of profile.interests.filter((value) => metadata.interests.includes(value))) {
    addEvidence(
      catalog,
      "match",
      `profile.interest:${interest}`,
      `系统依据你确认的兴趣“${interest}”与目录方向标签作出匹配推断；这不是赛事官方结论。`,
      { type: "editorial-inference" }
    );
  }
  for (const output of profile.preferredOutputs.filter((value) => metadata.preferredOutputs.includes(value))) {
    addEvidence(
      catalog,
      "match",
      `profile.output:${output}`,
      `系统依据目录成果类型标签，推断它适合你偏好的${preferredOutputLabels[output]}；这不是赛事官方承诺。`,
      { type: "editorial-inference" }
    );
  }
  for (const signal of candidate.fit.matchedSignals) {
    addEvidence(
      catalog,
      "match",
      `candidate.fit:${signal}`,
      `系统依据你的已确认信息与目录标签“${signal}”作出匹配推断；这不是赛事官方结论。`,
      { type: "editorial-inference" }
    );
  }
  if (!catalog.some(({ kind }) => kind === "match")) {
    addEvidence(
      catalog,
      "match",
      `candidate.score:${candidate.competitionId}`,
      `系统结构化召回分为 ${candidate.baseMatchScore} 分；这是匹配推断，不代表赛事官方评价或获奖概率。`,
      { type: "editorial-inference" }
    );
  }
  candidate.fit.gaps.forEach((gap) => {
    const fact = officialFactForGapText(gap);
    const addedOfficial = fact
      ? addOfficialEvidence(
          catalog,
          sources,
          "gap",
          hashRef("candidate.gap", gap),
          gap,
          fact,
          fact === "trackEligibility" ? recommendedTrack?.evidenceRef : undefined
        )
      : false;
    if (!addedOfficial) {
      addEvidence(
        catalog,
        "gap",
        hashRef("candidate.gap", gap),
        `系统可行性推断：${gap}；请以当届官方规则为准。`,
        { type: "editorial-inference" }
      );
    }
  });
  candidate.eligibility.reasons.forEach((reason) => {
    const fact = officialFactForEligibilityText(reason);
    if (!addOfficialEvidence(
      catalog,
      sources,
      "gap",
      hashRef("candidate.eligibility", reason),
      reason,
      fact
    )) {
      addEvidence(
        catalog,
        "gap",
        hashRef("candidate.eligibility", reason),
        `资格信息仍需在当届官方规则中核对：${reason}`,
        { type: "preparation" }
      );
    }
  });
  candidate.dataNotices.slice(0, 3).forEach((notice) => {
    const fact = officialFactForGapText(notice);
    if (!fact || !addOfficialEvidence(
      catalog,
      sources,
      "gap",
      hashRef("candidate.notice", notice),
      notice,
      fact
    )) {
      addEvidence(
        catalog,
        "gap",
        hashRef("candidate.notice", notice),
        `目录核验提醒：${notice}`,
        { type: "preparation" }
      );
    }
  });
  if (candidate.registrationStatus.status === "closed") {
    addOfficialEvidence(
      catalog,
      sources,
      "gap",
      `candidate.schedule:${candidate.competitionId}`,
      "本届报名已截止，只能作为下一届备赛参考。",
      "schedule"
    );
  }
  if (!catalog.some(({ kind }) => kind === "gap")) {
    addEvidence(
      catalog,
      "gap",
      `candidate.verify:${candidate.competitionId}`,
      "提交前仍需在官方来源核对当届资格、赛道与报名时间。",
      { type: "preparation" }
    );
  }
  addEvidence(
    catalog,
    "tip",
    `tip.official:${candidate.competitionId}`,
    "先查看官方通知，逐项核对当届资格、赛道、提交物与时间。",
    { type: "preparation" }
  );
  addEvidence(
    catalog,
    "tip",
    `tip.output:${candidate.competitionId}`,
    `围绕${preferredOutputLabels[profile.preferredOutputs[0]] ?? "目标成果"}整理现有基础、过程证据与下一步任务。`,
    { type: "preparation" }
  );
  addEvidence(
    catalog,
    "tip",
    profile.teamStatus !== "ready" ? `tip.team:${candidate.competitionId}` : `tip.milestone:${candidate.competitionId}`,
    profile.teamStatus !== "ready"
      ? "尽早确认队友角色、组队单位要求与每周推进节奏。"
      : "把赛题拆成可验证里程碑，并保留每轮迭代和测试证据。",
    { type: "preparation" }
  );
  return {
    candidate,
    sourceRef,
    officialSources: sources,
    evidenceCatalog: catalog,
    recommendedTrack,
    confirmedFitSignalAssessment: {
      requested: requestedFitSignals,
      supported: supportedFitSignals,
      matched: matchedConfirmedFitSignals
    },
    confirmedSubjectAssessment
  };
}

function rankingOutputSchema(contexts: readonly CandidateEvidenceContext[]) {
  const expectedIds = contexts.map(({ candidate }) => candidate.competitionId);
  const contextById = new Map(contexts.map((context) => [context.candidate.competitionId, context]));
  return z.object({ recommendations: z.array(rankedItemSchema).length(expectedIds.length) }).strict().superRefine((output, refinement) => {
    const ids = output.recommendations.map(({ competitionId }) => competitionId);
    if (new Set(ids).size !== ids.length || expectedIds.some((id) => !ids.includes(id))) {
      refinement.addIssue({ code: z.ZodIssueCode.custom, message: "Output must be a complete unique permutation of candidate IDs" });
    }
    output.recommendations.forEach((item, index) => {
      const candidateContext = contextById.get(item.competitionId);
      if (!candidateContext) {
        refinement.addIssue({ code: z.ZodIssueCode.custom, message: "Unknown candidate ID", path: ["recommendations", index, "competitionId"] });
        return;
      }
      const exposedEvidenceCatalog = compactEvidenceCatalog(candidateContext.evidenceCatalog);
      const refs = (kind: EvidenceKind) => new Set(
        exposedEvidenceCatalog.filter((entry) => entry.kind === kind).map(({ ref }) => ref)
      );
      const checks: Array<[readonly string[], EvidenceKind, string]> = [
        [item.matchEvidenceRefs, "match", "matchEvidenceRefs"],
        [item.gapEvidenceRefs, "gap", "gapEvidenceRefs"],
        [item.preparationTipRefs, "tip", "preparationTipRefs"]
      ];
      for (const [selected, kind, path] of checks) {
        if (new Set(selected).size !== selected.length || selected.some((ref) => !refs(kind).has(ref))) {
          refinement.addIssue({ code: z.ZodIssueCode.custom, message: `Invalid ${kind} evidence reference`, path: ["recommendations", index, path] });
        }
      }
    });
  });
}

export type CompetitionRankingResult = {
  recommendations: CompetitionRecommendationItemV3[];
  promptVersion: typeof COMPETITION_RANK_PROMPT_VERSION;
  model: string;
  provider: string;
  upstreamAttempted: boolean;
  rankingSource: CompetitionRecommendationRankingSource;
  fallbackUsed: boolean;
  fallbackMode: "none" | "full";
  fallbackReason?: AiJsonFailureReason;
};

export function getCompetitionRecommendModel() {
  return process.env.AI_COMPETITION_RECOMMEND_MODEL?.trim() || getConfiguredAiModel(DEFAULT_DEEPSEEK_MODEL);
}

function serverRole(candidate: DeterministicCompetitionRecommendation, rank: number): CompetitionRecommendationItemV3["role"] {
  if (!candidate.scoreCalibration.qualified) return "reference";
  if (rank === 1) return "best-match";
  if (candidate.competition.recommendation.difficulty === "challenge") return "stretch";
  if (candidate.competition.recommendation.goalValues.portfolio >= 0.8) return "portfolio";
  return "practical";
}

type EvidenceSelection = {
  matchEvidenceRefs: string[];
  gapEvidenceRefs: string[];
  preparationTipRefs: string[];
};

function explanationFromRefs(
  context: CandidateEvidenceContext,
  selection: EvidenceSelection
): CompetitionRecommendationExplanation {
  const byRef = new Map(context.evidenceCatalog.map((entry) => [entry.ref, entry]));
  const text = (refs: readonly string[]) => refs.map((ref) => byRef.get(ref)!.text);
  return {
    matchReasons: text(selection.matchEvidenceRefs).slice(0, 3),
    possibleGaps: text(selection.gapEvidenceRefs).slice(0, 3),
    preparationTips: text(selection.preparationTipRefs).slice(0, 3)
  };
}

function authoritativeItem(
  context: CandidateEvidenceContext,
  rank: number,
  rankingSource: CompetitionRecommendationRankingSource,
  explanationSource: CompetitionRecommendationItemV3["explanationSource"],
  selection: EvidenceSelection
): CompetitionRecommendationItemV3 {
  const candidate = context.candidate;
  const selectedRefs = new Set([
    ...selection.matchEvidenceRefs,
    ...selection.gapEvidenceRefs,
    ...selection.preparationTipRefs
  ]);
  const selectedEvidence = context.evidenceCatalog.filter(({ ref }) => selectedRefs.has(ref));
  const officialFacts = context.officialSources.flatMap((source) =>
    (source.facts ?? []).map((fact) => ({
      fact,
      sourceRef: source.evidenceRef!,
      sourceUrl: source.url
    }))
  ).filter((entry, index, entries) =>
    entries.findIndex(({ fact, sourceRef }) => fact === entry.fact && sourceRef === entry.sourceRef) === index
  );
  const explanation = explanationFromRefs(context, selection);
  return {
    rank,
    ...(candidate.decisionFit ? {fitEvidence: candidate.decisionFit.evidence} : {}),
    ...(context.recommendedTrack ? {evaluatedTrackId: context.recommendedTrack.id} : {}),
    competitionId: candidate.competitionId,
    role: serverRole(candidate, rank),
    recommendationRole: !candidate.scoreCalibration.qualified
      ? "reference"
      : rank === 1
        ? "best"
        : "steady",
    baseMatchScore: candidate.baseMatchScore,
    matchScore: candidate.matchScore,
    scoreCalibration: candidate.scoreCalibration,
    rankingSource,
    scoreBreakdown: candidate.scoreBreakdown,
    registrationStatus: candidate.registrationStatus,
    eligibility: candidate.eligibility,
    fit: candidate.fit,
    evidenceRefs: {
      match: [...selection.matchEvidenceRefs],
      gaps: [...selection.gapEvidenceRefs],
      tips: [...selection.preparationTipRefs],
      source: [...new Set<string>([
        context.sourceRef,
        ...context.officialSources.flatMap(({ evidenceRef }) => evidenceRef ? [evidenceRef] : []),
        ...(context.recommendedTrack?.evidenceRef ? [context.recommendedTrack.evidenceRef] : [])
      ])],
      details: selectedEvidence.map((entry) => ({
        evidenceRef: entry.ref,
        kind: entry.kind,
        provenance: entry.provenance.type,
        ...(entry.provenance.type === "official-fact"
          ? {
              fact: entry.provenance.fact,
              sourceRef: entry.provenance.sourceRef,
              sourceUrl: entry.provenance.sourceUrl
            }
          : {})
      })),
      officialFacts
    },
    recommendedTrack: context.recommendedTrack,
    dataNotices: candidate.dataNotices,
    name: candidate.name,
    category: candidate.category,
    summary: candidate.summary,
    sourceUrl: candidate.sourceUrl,
    explanationSource,
    explanation
  };
}

function defaultSelection(context: CandidateEvidenceContext) {
  return {
    matchEvidenceRefs: context.evidenceCatalog.filter(({ kind }) => kind === "match").slice(0, 2).map(({ ref }) => ref),
    gapEvidenceRefs: context.evidenceCatalog.filter(({ kind }) => kind === "gap").slice(0, 2).map(({ ref }) => ref),
    preparationTipRefs: context.evidenceCatalog.filter(({ kind }) => kind === "tip").slice(0, 3).map(({ ref }) => ref)
  };
}

function fallbackResult(
  contexts: readonly CandidateEvidenceContext[],
  provider: string,
  model: string,
  reason: AiJsonFailureReason,
  upstreamAttempted = false
): CompetitionRankingResult {
  return {
    recommendations: contexts.map((context, index) => {
      const selection = defaultSelection(context);
      return authoritativeItem(context, index + 1, "rule-fallback", "rule", selection);
    }),
    promptVersion: COMPETITION_RANK_PROMPT_VERSION,
    model,
    provider,
    upstreamAttempted,
    rankingSource: "rule-fallback",
    fallbackUsed: true,
    fallbackMode: "full",
    fallbackReason: reason
  };
}

function compactEvidenceCatalog(evidenceCatalog: readonly EvidenceEntry[]) {
  // The model only selects refs; the server retains the complete evidence text
  // and expands the selected refs after validation. Keep the prompt catalog at
  // the protocol minimum needed for a useful choice so Top10 remains bounded.
  // For gaps, retain official fact-scoped evidence before editorial/preparation
  // entries so context compaction never severs a factual claim from sourceRef.
  const limits: Record<EvidenceKind, number> = { match: 3, gap: 2, tip: 2 };
  return (["match", "gap", "tip"] as const).flatMap((kind) =>
    evidenceCatalog
      .filter((entry) => entry.kind === kind)
      .filter((entry, index, entries) => entries.findIndex(({ text }) => text === entry.text) === index)
      .sort((left, right) =>
        Number(right.provenance.type === "official-fact") -
        Number(left.provenance.type === "official-fact")
      )
      .slice(0, limits[kind])
      .map(({ ref, kind: evidenceKind, text, provenance }) => ({
        ref,
        kind: evidenceKind,
        text,
        provenance: provenance.type,
        ...(provenance.type === "official-fact"
          ? { fact: provenance.fact, sourceRef: provenance.sourceRef }
          : {})
      }))
  );
}

export function promptCandidates(contexts: readonly CandidateEvidenceContext[]) {
  return contexts.map(({
    candidate,
    sourceRef,
    evidenceCatalog,
    recommendedTrack,
    confirmedFitSignalAssessment,
    confirmedSubjectAssessment
  }) => ({
    competitionId: candidate.competitionId,
    name: candidate.name,
    category: candidate.category,
    direction: candidate.competition.direction,
    summary: candidate.summary,
    metadata: {
      stages: candidate.competition.recommendation.stages,
      majors: candidate.competition.recommendation.majors,
      skills: candidate.competition.recommendation.skills,
      interests: candidate.competition.recommendation.interests,
      preferredOutputs: candidate.competition.recommendation.preferredOutputs,
      teamRequirement: candidate.competition.recommendation.teamRequirement,
      fitSignals: confirmedFitSignalAssessment.supported
    },
    sourceRef,
    baseMatchScore: candidate.baseMatchScore,
    scoreBreakdown: candidate.scoreBreakdown,
    ...(confirmedSubjectAssessment.matchedPrimaryMajors.length ||
      confirmedSubjectAssessment.matchedSpecificSubjects.length
      ? {
          confirmedSubjectAssessment: {
            ...(confirmedSubjectAssessment.matchedPrimaryMajors.length
              ? { matchedPrimaryMajors: confirmedSubjectAssessment.matchedPrimaryMajors }
              : {}),
            ...(confirmedSubjectAssessment.matchedSpecificSubjects.length
              ? { matchedSpecificSubjects: confirmedSubjectAssessment.matchedSpecificSubjects }
              : {})
          }
        }
      : {}),
    confirmedFitSignalAssessment,
    eligibilityAssessment: candidate.eligibility,
    fitAssessment: {
      matchedSignals: candidate.fit.matchedSignals,
      gaps: candidate.fit.gaps
    },
    registrationStatus: candidate.registrationStatus,
    recommendedTrack,
    evidenceCatalog: compactEvidenceCatalog(evidenceCatalog)
  }));
}

export function buildCompetitionRankingPromptCandidates(
  profile: RankingProfile,
  transcript: readonly CompetitionDynamicExchangeV3[],
  candidates: readonly DeterministicCompetitionRecommendation[]
) {
  return promptCandidates(candidates.slice(0, 10).map((candidate) => buildCandidateEvidence(profile, candidate, transcript)));
}

/** Presentation is derived after the shortlist is fixed. No model, schedule or contact data participates in selection. */
export function explainDecisionShortlist(
  profile: RankingProfile, transcript: readonly CompetitionDynamicExchangeV3[],
  candidates: readonly DeterministicCompetitionRecommendation[]
): CompetitionRecommendationItemV3[] {
  return candidates.map((candidate, index) => {
    const display = getDocumentedCompetitionAvailability(candidate.competition);
    const context = buildCandidateEvidence(profile, {...candidate,registrationStatus: display.registrationStatus, dataNotices: display.registrationStatus.note ? [display.registrationStatus.note] : []}, transcript);
    const evidence = candidate.decisionFit?.evidence;
    if (evidence) {
      for (const [dimension, reasons] of Object.entries(evidence)) {
        const kind = dimension === "unknowns" || dimension === "readiness" ? "gap" : "match";
        reasons.forEach((reason, n) => context.evidenceCatalog.unshift({kind, ref: `decision.${dimension}:${n}`,
          text: reason, provenance: {type: "editorial-inference"}}));
      }
    }
    return authoritativeItem(context, index + 1, "evidence-rules", "rule", defaultSelection(context));
  });
}

export async function rankCompetitionRecommendations(
  profile: RankingProfile,
  transcript: readonly CompetitionDynamicExchangeV3[],
  candidates: readonly DeterministicCompetitionRecommendation[],
  options: { deadlineEpochMs?: number; signal?: AbortSignal } = {}
): Promise<CompetitionRankingResult> {
  const model = getCompetitionRecommendModel();
  const provider = getConfiguredAiProvider();
  const contexts = candidates.slice(0, 10).map((candidate) => buildCandidateEvidence(profile, candidate, transcript));
  if (contexts.length === 0) return fallbackResult(contexts, provider, provider === "mock" ? "mock" : model, "invalid_output");
  const providerFailure = getCompetitionAiProviderFailureReason(provider);
  if (providerFailure) {
    return fallbackResult(contexts, provider, provider === "mock" ? "mock" : model, providerFailure);
  }
  const prompt = await buildPrompt("competition-rank.v4.md", {
    profileJson: JSON.stringify(sanitizeCompetitionProfileForAi(profile)),
    confirmedSubjectIntentJson: JSON.stringify({
      requestedPrimaryMajors: contexts[0]?.confirmedSubjectAssessment.requestedPrimaryMajors ?? [],
      requestedSpecificSubjects: contexts[0]?.confirmedSubjectAssessment.requestedSpecificSubjects ?? [],
      ignoredConflictingSpecificSubjects:
        contexts[0]?.confirmedSubjectAssessment.ignoredConflictingSpecificSubjects ?? []
    }),
    transcriptJson: JSON.stringify(sanitizeCompetitionTranscriptForAi(transcript)),
    candidatesJson: JSON.stringify(promptCandidates(contexts)),
    candidateCount: contexts.length
  });
  const result = await requestAiJson(prompt, {
    model,
    systemPrompt: `Return JSON only. Return one complete unique ordering of all ${contexts.length} supplied candidates, preserve confirmed primary-subject and fit-signal precedence, and use only each candidate's typed evidence refs.`,
    temperature: 0,
    maxTokens: 3200,
    maxAttempts: 2,
    schema: withTestOnlyRankSchemaDiagnostics(rankingOutputSchema(contexts)),
    thinking: "disabled",
    operation: "competition_recommend",
    promptVersion: COMPETITION_RANK_PROMPT_VERSION,
    candidateCount: contexts.length,
    deadlineEpochMs: options.deadlineEpochMs,
    signal: options.signal,
    retryInstruction: "Return every candidate ID exactly once. Copy only evidence refs listed for that same candidate and the required evidence kind."
  });
  if (!result.ok) {
    return fallbackResult(
      contexts,
      provider,
      result.model,
      result.reason,
      result.upstreamAttempted
    );
  }
  const contextById = new Map(contexts.map((context) => [context.candidate.competitionId, context]));
  return {
    recommendations: result.data.recommendations.map((selection, index) => {
      const context = contextById.get(selection.competitionId)!;
      return authoritativeItem(context, index + 1, "deepseek", "deepseek", selection);
    }),
    promptVersion: COMPETITION_RANK_PROMPT_VERSION,
    model: result.model,
    provider,
    upstreamAttempted: result.upstreamAttempted,
    rankingSource: "deepseek",
    fallbackUsed: false,
    fallbackMode: "none"
  };
}
