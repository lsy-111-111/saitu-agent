import { createHash } from "node:crypto";
import { getCompetitionCatalog } from "@/lib/competitions/catalog";
import {
  scoreCompetitionRecommendations,
  type ScoredCompetition,
} from "@/lib/competitions/scoring";
import type {
  CompetitionDynamicExchangeV3,
  CompetitionRecommendationProfileV5,
} from "@/types/competition-recommendation";
import { getDecisionCatalog } from "./catalog";
import { selectPublishedDecisionRecords } from "./published-records";
import type { DecisionCompetitionRecord, DecisionClaim } from "./catalog-types";
import { activeStudentFacts, applyProfileMutations, createStudentProfile, decisionGoalLabels, projectProfileToLegacy } from "./profile";
import { experienceEvidence, experienceRoleIndex } from "./experience-fit";
import { scoreNativeDecision, type NativeFitScore } from "./native-score";
import { isDecisionEvidenceFact, isEvidenceForRecord } from "./evidence";
import { evaluateRecordEligibility } from "./eligibility";
import {
  compareDecisionItems,
  DECISION_ENGINE_VERSION,
  decisionReportSchema,
  type DecisionClaimV6,
  type DecisionRecommendationV6,
  type DecisionReportV6,
  type MatchPlanV6,
  type StudentProfileV6,
} from "./contracts";

export type DecisionCandidate = {
  record: DecisionCompetitionRecord;
  score: ScoredCompetition | null;
  nativeScore?: NativeFitScore;
  eligibility: "eligible" | "unknown";
  conditions: string[];
  relevant: boolean;
};
export type DecisionContextV6 = {
  profile: StudentProfileV6;
  candidates: DecisionCandidate[];
  records: DecisionCompetitionRecord[];
  excluded: Map<string, string>;
  catalogVersion: string;
  now: Date;
  originalProfile?: CompetitionRecommendationProfileV5;
  questionHistory?: {questionId:string;field?:string;catalogVersion:string}[];
};
export type DecisionBuildOptions = {
  /** Internal V5 presentation bridge: only the exact reviewed record supplies qualification. */
  qualificationSource?: "record_only";
  now?: Date;
  transcript?: readonly CompetitionDynamicExchangeV3[];
  profileId?: string;
  records?: DecisionCompetitionRecord[];
  profile?: StudentProfileV6;
  answerContext?: readonly {fieldId:string;selectedValues:readonly string[];freeText?:string}[];
  answeredAt?: string;
  questionHistory?: {questionId:string;field?:string;catalogVersion:string}[];
};
export function claim(
  text: string,
  basis: DecisionClaimV6["basis"] = "suggestion",
  studentFactIds: string[] = [],
  competitionFactIds: string[] = [],
  conditions: string[] = [],
): DecisionClaimV6 {
  return { text, basis, studentFactIds, competitionFactIds, conditions };
}
function fromCatalog(
  value: DecisionClaim | undefined,
  record: DecisionCompetitionRecord,
  fallback: string,
): DecisionClaimV6 {
  if (!value) return claim(fallback, "unknown");
  const facts = value.factIds.filter((id) =>
    record.facts.some((f) => f.id === id && isDecisionEvidenceFact(record, f)),
  );
  if (
    value.kind === "official_fact" &&
    (!facts.length || facts.length !== value.factIds.length)
  )
    return claim(
      "该项规则尚未完成正文或适用范围核验，暂不作为正式依据。",
      "unknown",
    );
  return claim(
    value.text,
    value.kind === "unknown"
      ? "unknown"
      : value.kind === "official_fact" && facts.length
        ? "official"
        : "suggestion",
    [],
    facts,
    value.conditions,
  );
}
function usableFacts(record: DecisionCompetitionRecord) {
  return record.facts.filter((fact) => isDecisionEvidenceFact(record, fact));
}
function investmentEvidenceFactIds(record: DecisionCompetitionRecord, investment: DecisionClaim | undefined): string[] {
  const existing = investment?.factIds ?? [];
  // This reviewed 2025 entry-fee clause shares an existing participation fact.
  // Bind that clause only; the weekly time estimate remains editorial advice.
  if (record.recordId !== "if-student-award:2025-entry-guide:sdg-design:design-students-graduates:global-2025:v3" ||
    investment?.text !== "编辑建议四周每周3—5小时；2025参赛费明确为零，制作测试预算另计。") return existing;
  const fact = record.facts.find(value => value.id === "if-student-award:v2:participation" && value.field === "participation" &&
    value.kind === "official_fact" && value.status === "historical" &&
    value.text === "英文在线提交；指南声明参赛免费，不包括自主制作和其他支出。" &&
    value.scope === "2025全球学生奖参赛与展示规范" && value.sourceIds.length === 1 && value.sourceIds[0] === "b-if-guide" &&
    isDecisionEvidenceFact(record, value));
  if (!fact || !record.sections.participation.some(section => section.kind === "official_fact" && section.text === fact.text &&
    section.factIds.length === 1 && section.factIds[0] === fact.id)) return existing;
  return [...new Set([...existing, fact.id])];
}
const noviceFamily: Record<string, string[]> = {
  "organize-information": ["investigation", "data-modeling"],
  "explain-ideas": ["language-communication", "teaching-service"],
  "observe-record": ["experimental-research", "investigation"],
  "make-content": ["visual-interaction", "language-communication"],
  "build-tool": ["software-algorithms", "engineering-prototype"],
};
const taskFamilies: Record<string, string[]> = {
  algorithm: ["software-algorithms"],
  modeling: ["data-modeling"],
  software: ["software-algorithms"],
  hardware: ["engineering-prototype"],
  research: ["experimental-research", "investigation", "data-modeling"],
  product: [
    "business-practice",
    "investigation",
    "software-algorithms",
    "visual-interaction",
  ],
  entrepreneurship: ["business-practice"],
  design: ["visual-interaction"],
  language: ["language-communication", "teaching-service"],
  career: ["teaching-service"],
};
const skillFamilies: Record<string, string[]> = {
  programming: ["software-algorithms"],
  "data-analysis": ["data-modeling", "investigation"],
  design: ["visual-interaction"],
  hardware: ["engineering-prototype"],
  laboratory: ["experimental-research"],
  "structural-design": ["engineering-prototype"],
  "accounting-finance": ["business-practice"],
  "policy-analysis": ["investigation", "teaching-service"],
  language: ["language-communication"],
  fieldwork: ["investigation", "experimental-research"],
};

/** Broad transferable skills are useful for roles, but never override a stated task direction. */
function taskAlignment(
  record: DecisionCompetitionRecord,
  active: StudentProfileV6["facts"],
): boolean {
  const formats = active.filter((f) => f.field === "taskFormats");
  const novice = active.filter((f) => f.field === "noviceTask");
  if (formats.length || novice.length)
    return (
      formats.some((f) =>
        taskFamilies[String(f.value)]?.includes(record.taskFamily),
      ) ||
      novice.some((f) =>
        noviceFamily[String(f.value)]?.includes(record.taskFamily),
      )
    );
  const interests = active.filter(
    (f) =>
      f.field === "interests" &&
      !["career", "innovation"].includes(String(f.value)),
  );
  if (interests.length)
    return interests.some((f) => record.interests.includes(String(f.value)));
  const specificSkills = active.filter(
    (f) => f.field === "skills" && skillFamilies[String(f.value)],
  );
  if (specificSkills.length)
    return specificSkills.some((f) =>
      skillFamilies[String(f.value)]?.includes(record.taskFamily),
    );
  return true; // No confirmed task preference: clearly labelled exploration remains possible.
}

/** Score each exact catalog track before series de-duplication. Never borrow a sibling's qualification. */
export function compareRuleCandidates(a: DecisionCandidate, b: DecisionCandidate): number {
  return Number(b.relevant) - Number(a.relevant) ||
    (b.nativeScore?.lower ?? 0) - (a.nativeScore?.lower ?? 0) ||
    (b.nativeScore?.upper ?? 0) - (a.nativeScore?.upper ?? 0) ||
    a.record.recordId.localeCompare(b.record.recordId);
}

export function buildDecisionContext(
  legacy: CompetitionRecommendationProfileV5,
  options: DecisionBuildOptions = {},
): DecisionContextV6 {
  const now = options.now ?? new Date();
  const profile = options.profile ?? createStudentProfile(legacy, {
    profileId: options.profileId, answerContext: options.answerContext, answeredAt: options.answeredAt,
  });
  if (options.profile) legacy = projectProfileToLegacy(profile, legacy);
  const records = options.records ?? getDecisionCatalog();
  const catalogVersion = `v6-${createHash("sha256").update(JSON.stringify(records)).digest("hex").slice(0, 24)}`;
  const legacyCatalog = new Map(getCompetitionCatalog().map((c) => [c.id, c]));
  const excluded = new Map<string, string>();
  const candidates: DecisionCandidate[] = [];
  const rankingProfile: CompetitionRecommendationProfileV5 =
    profile.tradeoffStatus === "undecided" ||
    (legacy.decisionContext?.goalResolution === "confirmed" &&
      ["explore", "skill"].includes(legacy.decisionContext.goalIntent ?? ""))
      ? {
          ...legacy,
          goals: [],
          confirmedFields: legacy.confirmedFields.filter((f) => f !== "goals"),
          decisionContext: {
            ...legacy.decisionContext,
            primaryGoal: undefined,
          },
        }
      : legacy.decisionContext?.goalResolution === "confirmed" &&
          legacy.decisionContext.goalIntent &&
          !["explore", "skill"].includes(legacy.decisionContext.goalIntent)
        ? {
            ...legacy,
            goals: [
              legacy.decisionContext
                .goalIntent as CompetitionRecommendationProfileV5["goals"][number],
            ],
            decisionContext: {
              ...legacy.decisionContext,
              primaryGoal: legacy.decisionContext
                .goalIntent as CompetitionRecommendationProfileV5["goals"][number],
            },
          }
        : legacy;
  const activeFacts = activeStudentFacts(profile).filter((f) => f.state === "affirmed");
  const published = new Set(selectPublishedDecisionRecords(records));
  for (const record of records) {
    if (!published.has(record)) continue;
    const recordEligibility = evaluateRecordEligibility(record, profile);
    if (recordEligibility?.status === "ineligible") {
      excluded.set(record.recordId, recordEligibility.conditions.join("；"));
      continue;
    }
    const selectedTrack = options.transcript?.find(row => row.question.signalKey === `track:${record.seriesId}`)?.answer.selectedValues[0];
    if (options.qualificationSource === "record_only" && selectedTrack && selectedTrack !== record.track.id) {
      excluded.set(record.recordId, "你选择的是另一个具体赛道；不能用本赛道替代其资格或任务。");
      continue;
    }
    const old = options.qualificationSource === "record_only" ? undefined : legacyCatalog.get(record.seriesId);
    let score: ScoredCompetition | null = null;
    if (old) {
      const tracks = old.recommendation.tracks ?? [];
      const exact = tracks.find((t) => t.id === record.track.id);
      // A newly researched V6 track owns its qualification evidence. It must not
      // borrow a different historical V5 track, or be excluded merely because
      // its new task identifier did not exist in the old catalog.
      const independentlyScoped = Boolean(recordEligibility && record.eligibilityRules?.length &&
        record.eligibilityRules.every(rule => rule.factIds.length > 0 && rule.factIds.every(id =>
          record.facts.some(fact => fact.id === id && fact.entity && isEvidenceForRecord(record, fact) && fact.kind === "official_fact" &&
            fact.field.startsWith("eligibility") && isDecisionEvidenceFact(record, fact)))));
      if (tracks.length && !exact && !independentlyScoped) {
        excluded.set(
          record.recordId,
          "具体赛道与资格记录尚未对应，不能借用其他赛道的资格。",
        );
        continue;
      }
      const scoped = exact
        ? { ...old, recommendation: { ...old.recommendation, tracks: [exact] } }
        : old;
      if (exact || !tracks.length) score =
        scoreCompetitionRecommendations([scoped], rankingProfile, {
          now,
          transcript: options.transcript,
        })[0] ?? null;
      if ((exact || !tracks.length) && !score) {
        excluded.set(
          record.recordId,
          "此赛道与已确认的资格、明确限制或已选择赛道冲突。",
        );
        continue;
      }
    }
    const avoided = profile.facts.some(
      (f) =>
        f.confirmed && !profile.retractedFactIds.includes(f.id) &&
        ((f.field === "noviceTask" && f.state === "negated" && noviceFamily[String(f.value)]?.includes(record.taskFamily)) ||
         (f.field === "excludedTask" && f.state === "negated" && taskFamilies[String(f.value)]?.includes(record.taskFamily))),
    );
    if (avoided) {
      excluded.set(record.recordId, "此任务方向与你明确不想做的工作冲突。");
      continue;
    }
    const conditions = [
      ...(recordEligibility?.conditions ?? []),
      ...(score?.eligibility.reasons ?? []),
      ...record.suitability.uncertainties,
    ];
    const budget = activeFacts.find((f) => f.field === "budget");
    const budgetContext = legacy.decisionContext?.budget;
    const maximum =
      budgetContext?.scope === "personal"
        ? (budgetContext.maximumYuan ??
          (budgetContext.range === "zero"
            ? 0
            : budgetContext.range === "under100"
              ? 100
              : budgetContext.range === "100-500"
                ? 500
                : undefined))
        : undefined;
    const cost = record.cost;
    const costVerified = Boolean(
      cost?.factIds.length &&
        cost.factIds.every((id) =>
          record.facts.some(
            (f) =>
              f.id === id &&
              f.status === "verified_current" &&
              f.kind === "official_fact" &&
              isDecisionEvidenceFact(record, f) &&
              f.scope === cost.scope,
          ),
        ),
    );
    if (
      maximum !== undefined &&
      costVerified &&
      cost?.minimumPersonalCny !== null &&
      cost?.minimumPersonalCny !== undefined &&
      cost.minimumPersonalCny > maximum
    ) {
      excluded.set(
        record.recordId,
        `已核实的个人支出至少${cost.minimumPersonalCny}元，超过你确认的${maximum}元上限。`,
      );
      continue;
    }
    if (
      budget &&
      !(
        costVerified &&
        cost?.maximumPersonalCny !== null &&
        cost?.maximumPersonalCny !== undefined &&
        maximum !== undefined &&
        cost.maximumPersonalCny <= maximum
      )
    )
      conditions.push(
        "报名费、材料、差旅和作品制作的个人总支出仍需核实；尚不能认定符合你的预算。",
      );
    if (
      legacy.decisionContext?.budget?.maximumYuan === 0 ||
      legacy.decisionContext?.budget?.range === "zero"
    )
      conditions.push(
        "你不愿发生支出；只有核实总费用为零或已落实资助后再考虑报名。",
      );
    const localEligibility = record.facts.some(
      (f) =>
        f.field === "eligibility" &&
        f.sourceIds.some((id) =>
          record.sources.some(
            (s) => s.id === id && s.authority === "university_local",
          ),
        ),
    );
    const needsCurrentCheck =
      record.registration.status === "historical" ||
      record.facts.some(
        (f) => f.field === "eligibility" && f.status !== "verified_current",
      );
    if (needsCurrentCheck)
      conditions.push("历史届次资料只用于准备；下一届资格和任务须重新核实。");
    if (localEligibility)
      conditions.push(
        "资格来源含高校本地通知；尚未确认你的适用范围，不能把该校规则当作全国统一入口。",
      );
    if (!old && !recordEligibility)
      conditions.push("本系列尚未接入结构化资格规则，需要核对官方条件。");
    candidates.push({
      record,
      score,
      nativeScore: scoreNativeDecision(record, profile),
      eligibility:
        (recordEligibility ? recordEligibility.status === "eligible" : score?.eligibility.status === "eligible") &&
        !needsCurrentCheck &&
        !localEligibility
          ? "eligible"
          : "unknown",
      conditions: [...new Set(conditions)],
      relevant: taskAlignment(record, activeFacts),
    });
  }
  candidates.sort(compareRuleCandidates);
  return { profile, candidates, records, excluded, catalogVersion, now, originalProfile: legacy, questionHistory:options.questionHistory };
}

export function candidateEvidence(
  candidate: DecisionCandidate,
  profile: StudentProfileV6,
): DecisionClaimV6[] {
  const { record } = candidate;
  const task = record.sections.task[0];
  const taskDescription=(task?.text ?? record.summary).replace(/[。.!！]+$/u,"");
  const taskAttribution=task?.kind==="official_fact"
    ? `该届资料描述的任务是：${taskDescription}。`
    : `目录建议从这项练习入手：${taskDescription}。`;
  const taskRefs =
    task?.factIds.filter((id) =>
      usableFacts(record).some((f) => f.id === id),
    ) ?? [];
  const evidence: DecisionClaimV6[] = experienceEvidence(record, profile).slice(0, 2).map(item => claim(
    `${item.task.label}；${item.contribution.label}。这段经历与本赛道的${record.roles[experienceRoleIndex(record, profile) ?? 0]?.task ?? task?.text ?? "具体任务"}有任务联系，可以从已做过的部分开始；仍需通过实际产出检验。`,
    "inference", item.factIds, taskRefs, ["这是本人确认的具体经历，不是能力认证；协助和独立完成分别判断。"],
  ));
  for (const fact of activeStudentFacts(profile)) {
    if (fact.state !== "affirmed") continue;
    if (fact.field === "skills" && record.skills.includes(String(fact.value)))
      evidence.push(
        claim(
          `${fact.label}。这只是你的自述，可以先尝试“${record.roles[0]?.task ?? task?.text ?? record.summary}”，用一个实际产出验证起点。`,
          "inference",
          [fact.id],
          taskRefs,
          ["自述技能不等于已经具备完整参赛能力。"],
        ),
      );
    if (
      fact.field === "interests" &&
      record.interests.includes(String(fact.value))
    )
      evidence.push(
        claim(
          `${fact.label}。${taskAttribution}先体验这项任务，确认你是否愿意持续投入。`,
          "inference",
          [fact.id],
          taskRefs,
        ),
      );
    if (
      fact.field === "noviceTask" &&
      noviceFamily[String(fact.value)]?.includes(record.taskFamily)
    )
      evidence.push(
        claim(
          `${fact.label}。可以用本赛道的具体任务检验这种兴趣，目前不据此判断熟练程度。`,
          "inference",
          [fact.id],
          taskRefs,
        ),
      );
    if (
      fact.field === "taskFormats" &&
      taskFamilies[String(fact.value)]?.includes(record.taskFamily)
    )
      evidence.push(
        claim(
          `${fact.label}。${taskAttribution}这说明任务与你的偏好有关；可以用一次具体产出来检验起点。`,
          "inference",
          [fact.id],
          taskRefs,
        ),
      );
  }
  if (!evidence.length)
    evidence.push(
      claim(
        `这是一个待验证的探索方向：${task?.text ?? record.summary}。目前缺少足够个人证据，先体验再决定，不代表你已具备参赛能力。`,
        "suggestion",
        [],
        taskRefs,
        ["需要你确认是否喜欢这类工作，以及是否能获得必要资源。"],
      ),
    );
  return evidence.slice(0, 3);
}

function toDecisionItem(
  candidate: DecisionCandidate,
  profile: StudentProfileV6,
  rank: number,
  decision?: MatchPlanV6["recommendations"][number],
  profilePolicy?: "self_report",
): DecisionRecommendationV6 {
  const { record } = candidate;
  const active = activeStudentFacts(profile).filter((f) => f.state === "affirmed");
  const role =
    decision?.roleIndex !== undefined
      ? record.roles[decision.roleIndex]
      : (record.roles[experienceRoleIndex(record, profile) ?? -1] ?? record.roles.find((r) =>
          active.some(
            (f) => f.field === "skills" && r.skills.includes(String(f.value)),
          ),
        ) ?? record.roles[0]);
  const roleSkillIds = active
    .filter(
      (f) => f.field === "skills" && role?.skills.includes(String(f.value)),
    )
    .map((f) => f.id);
  const gaps: DecisionClaimV6[] = candidate.conditions.map((t) =>
    claim(t, "unknown"),
  );
  if (profilePolicy !== "self_report" && !active.some((f) => f.field.startsWith("experience.")))
    gaps.push(
      claim(
        "尚未确认一段具体经历，暂不判断你能否独立完成赛道任务。",
        "unknown",
      ),
    );
  if (!active.some((f) => f.field === "weeklyCommitment" || (profilePolicy === "self_report" && f.field === "weeklyHours")))
    gaps.push(
      claim(
        "每周投入尚未确认，先估算任务所需时间，再决定备赛规模。",
        "unknown",
      ),
    );
  const time = profilePolicy === "self_report" ? (active.findLast((f) => f.field === "weeklyHours") ?? active.find((f) => f.field === "weeklyCommitment")) : active.find((f) => f.field === "weeklyCommitment");
  const limitedTime = time?.value === "under-5" || (profilePolicy === "self_report" && typeof time?.value === "number" && time.value < 5);
  if (limitedTime)
    gaps.push(
      claim(
        profilePolicy === "self_report" && typeof time?.value === "number" ? `你填报每周投入${time.value}小时。先缩小本周任务范围，再结合准备周期和团队分工安排。` : "你确认每周投入少于5小时。先完成一个小任务；完整作品是否可行还取决于准备周期与团队分工。",
        "inference",
        time ? [time.id] : [],
        [],
        ["不能据此推断一定能在赛前完成。"],
      ),
    );
  if (!gaps.length)
    gaps.push(
      claim(
        "先核对最新任务书、自己的分工和时间表，再判断是否进入完整备赛。",
        "suggestion",
      ),
    );
  const task = fromCatalog(
    record.sections.task[0],
    record,
    "具体任务仍待核实。",
  );
  const reasons = decision?.reasons ?? candidateEvidence(candidate, profile);
  const exploration = reasons.every(
    (r) => r.basis === "suggestion" || r.studentFactIds.length === 0,
  );
  const preparation = exploration
    ? "explore"
    : profilePolicy !== "self_report" && (record.registration.status === "closed" ||
        record.registration.status === "historical")
      ? "future"
      : candidate.eligibility === "unknown" ||
          gaps.some((g) => g.basis === "unknown")
        ? "conditional"
        : "ready";
  const investment = record.sections.investment[0];
  const opportunity = claim(
    `${investment?.text ?? "总时间与费用尚未确认。"} 选择这项任务意味着把相同时间用于${record.taskFamily === "software-algorithms" ? "程序训练或软件制作" : "该方向的持续实践"}；请与其他课程、作品或实习准备的优先级比较。`,
    "suggestion",
    time ? [time.id] : [],
    investmentEvidenceFactIds(record, investment),
    ["投入估计是准备建议，实际成本需逐项核对。"],
  );
  const nextAction =
    limitedTime
      ? `先缩小范围：${record.sevenDayTrial.action.replace(/[。.!！]+$/u, "")}。本周只完成其中一个可检查的产出，不同时启动多项比赛。`
      : record.sevenDayTrial.action;
  const roleClaim = decision?.roleReason ?? claim(
    (role
      ? `建议从“${role.name}”尝试：${role.task}；个人产出可以是${role.personalDeliverable}。`
      : "先选择一个能独立说明本人贡献的小任务。"),
    "suggestion",
    [
      ...new Set([
        ...experienceEvidence(record, profile).flatMap(e => e.factIds),
        ...roleSkillIds,
        ...(decision?.roleReason?.studentFactIds ?? []),
      ]),
    ],
    [
      ...new Set([
        ...(role?.factIds ?? []),
        ...(decision?.roleReason?.competitionFactIds ?? []),
      ]),
    ],
    [
      profilePolicy === "self_report" ? "这是可以根据你的目标、时间与队伍安排调整的分工建议。" : "这是待验证的分工建议，不是能力认证。",
      ...(decision?.roleReason?.conditions ?? []),
    ],
  );
  return {
    rank,
    itemId: record.recordId,
    seriesId: record.seriesId,
    name: record.name,
    trackLabel: record.track.name,
    edition: record.edition,
    contentTier: record.contentTier,
    eligibilityStatus: candidate.eligibility,
    eligibilityNotes: candidate.conditions,
    registration: {
      status: record.registration.status,
      note: record.registration.note,
    },
    preparation,
    coreTask: task,
    reasons,
    currentRole: roleClaim,
    gaps: gaps.slice(0, 12),
    values: record.valueDimensions.map((v) => ({
      dimension: v.dimension,
      claim: fromCatalog(v.assessment, record, "该维度暂无足够依据。"),
    })),
    difficulty: record.difficulty.map((d) => ({
      stage: d.stage,
      claim: claim(d.summary, "suggestion", [], d.factIds, d.assumptions),
    })),
    opportunityCost: opportunity,
    nextStep: claim(
      nextAction,
      "suggestion",
      time ? [time.id] : [],
      record.sections.nextStep[0]?.factIds ?? [],
      [record.sevenDayTrial.reflection],
    ),
    checkpoint: record.sevenDayTrial.completionCheck,
    sources: record.sources
      .filter((s) => /^https?:\/\//.test(s.url))
      .map((s) => ({
        id: s.id,
        title: s.title,
        url: s.url,
        scope: s.scope,
        checkedAt: s.checkedAt,
      })),
    evidenceFacts: record.facts.map((f) => ({
      id: f.id,
      text: f.text,
      sourceIds: f.sourceIds,
      scope: f.scope,
      status: f.status,
      kind: f.kind,
    })),
  };
}

/** Old reports remain displayable, but cannot source a new action after publication,
 * eligibility or catalog content changes. Never silently substitute a newer record. */
export function assertCurrentReportCandidates(context: DecisionContextV6, report: DecisionReportV6): void {
  const current = restrictDecisionContextToPublished(context);
  const ids = new Set(current.candidates.map(c => c.record.recordId));
  if (report.catalogVersion !== current.catalogVersion || report.recommendations.some(item => !ids.has(item.itemId)))
    throw new Error("DECISION_CATALOG_CHANGED");
}

/** Recheck supplied/reused contexts before they can enter model or report selection. */
export function restrictDecisionContextToPublished(context: DecisionContextV6): DecisionContextV6 {
  const published = new Set(selectPublishedDecisionRecords(context.candidates.map(c => c.record)));
  return { ...context, candidates: context.candidates.filter(c => published.has(c.record)) };
}

export function buildRuleMatchPlan(context: DecisionContextV6): MatchPlanV6 {
  context = restrictDecisionContextToPublished(context);
  const unique: DecisionCandidate[] = [];
  const series = new Set<string>();
  for (const candidate of context.candidates) {
    if (!candidate.relevant || series.has(candidate.record.seriesId)) continue;
    series.add(candidate.record.seriesId);
    unique.push(candidate);
    if (unique.length === 10) break;
  }
  return {
    profileRevision: context.profile.revision,
    catalogVersion: context.catalogVersion,
    recommendations: unique.map((c) => ({
      itemId: c.record.recordId,
      reasons: candidateEvidence(c, context.profile),
    })),
    shortfallReason:
      unique.length < 5
        ? "当前通过内容门槛、资格检查且有合理任务联系的系列不足五项；没有使用资料不完整或已知冲突的比赛补足数量。"
        : null,
  };
}

export function assembleDecisionReport(
  context: DecisionContextV6,
  plan: MatchPlanV6,
  trace: Partial<DecisionReportV6["trace"]> = {},
  fallback: DecisionReportV6["fallback"] = { used: false, reason: null },
  options: { admissionPolicy?: "matching"; profilePolicy?: "self_report" } = {},
): DecisionReportV6 {
  if (options.admissionPolicy !== "matching") context = restrictDecisionContextToPublished(context);
  const byId = new Map(context.candidates.map((c) => [c.record.recordId, c]));
  const recommendations = plan.recommendations.map((item, i) => {
    const candidate = byId.get(item.itemId);
    if (!candidate) throw new Error("Unknown decision candidate");
    return toDecisionItem(candidate, context.profile, i + 1, item, options.profilePolicy);
  });
  const first = recommendations[0];
  const selected = new Set(recommendations.map((i) => i.itemId));
  const published = new Set(options.admissionPolicy === "matching" ? context.records : selectPublishedDecisionRecords(context.records));
  const active = activeStudentFacts(context.profile).filter((f) => f.state === "affirmed");
  const personal = active
    .filter(
      (f) =>
        ["interests", "skills", "noviceTask"].includes(f.field) ||
        f.field.startsWith("experience."),
    )
    .slice(0, 2)
    .map((f) => claim(f.label, "student", [f.id]));
  const goal = context.profile.primaryGoal ?? "探索并比较适合自己的任务";
  const goalPaths: DecisionReportV6["goalPaths"] =
    options.admissionPolicy !== "matching" && context.profile.tradeoffStatus === "undecided" &&
    context.profile.goals.length >= 2
      ? context.profile.goals.slice(0, 2).map((goal) => ({
          goal,
          condition: goal.includes("奖项")
            ? "如果你优先争取奖项，先核实评分与晋级要求、投入条件和本校认定；现有信息不能给出个人获奖概率。"
            : goal.includes("作品") || goal.includes("项目")
              ? "如果你优先积累作品，先看能交付什么、本人能完成哪一部分，以及是否允许公开展示；获奖不是这条路径唯一的收益条件。"
              : `如果你把“${goal}”放在首位，先确认下面的体验任务是否直接服务这个目标，再决定完整备赛。`,
          ...goalPathCandidates(context, goal),
          nextStep: claim(
            "先用下方的具体任务做一次体验，再确认优先目标并重新计算推荐。两条路径尚未替你选定先后。",
            "suggestion",
            active
              .filter((f) => f.field === "goals" || f.field === "goalIntent")
              .map((f) => f.id),
          ),
        }))
      : [];
  const direction = first
    ? claim(
        `围绕“${goal}”，先比较${recommendations
          .slice(0, 2)
          .map((r) => r.name + "·" + r.trackLabel)
          .join("与")}的实际任务。先尝试一项，再决定是否完整备赛。`,
        "suggestion",
        [],
        first.coreTask.competitionFactIds,
      )
    : claim(
        "当前资料还不足以形成完整推荐。可以先补充一项愿意尝试的任务，或查看待完善的竞赛资料。",
        "unknown",
      );
  const report: DecisionReportV6 = {
    schemaVersion: "saitu.report.v6",
    reportId: `report-${context.profile.revision.slice(0, 16)}-${createHash("sha256").update(JSON.stringify(plan)).digest("hex").slice(0, 12)}`,
    generatedAt: context.now.toISOString(),
    catalogVersion: context.catalogVersion,
    profile: context.profile,
    summary: {
      direction,
      personalEvidence: personal,
      mainGap:
        first?.gaps[0] ??
        claim("当前可用于决策的竞赛内容或个人信息不足。", "unknown"),
      nextStep:
        first?.nextStep ??
        claim(
          "从整理资料、制作内容、观察记录、解释问题中选一个愿意尝试的任务。",
          "suggestion",
        ),
      focusItemIds: recommendations.slice(0, 3).map((i) => i.itemId),
    },
    recommendations,
    shortlistShortfallReason: plan.shortfallReason,
    goalPaths,
    comparisons:
      recommendations.length >= 2
        ? [compareDecisionItems(recommendations.slice(0, 2))]
        : [],
    candidateAudit: context.records.map((record) => ({
      recordId: record.recordId,
      seriesId: record.seriesId,
      name: record.name,
      status: !published.has(record)
        ? "content_pending"
        : selected.has(record.recordId)
        ? "selected"
        : context.excluded.has(record.recordId)
          ? "excluded"
          : "not_selected",
      reason: claim(
        !published.has(record)
          ? "该条资料尚未通过当前内容的独立审查与发布门槛，暂不进入推荐；这不是对你能力的否定。"
          : selected.has(record.recordId)
          ? "已纳入本次选择；查看具体赛道的依据和条件。"
          : (context.excluded.get(record.recordId) ??
              "已比较，但本次有更优先或更明确的任务联系；可以修改目标后重新比较。"),
        "suggestion",
      ),
    })),
    usefulQuestions: options.admissionPolicy === "matching" ? [] : selectUsefulQuestions(context),
    pendingQuestions:
      context.profile.tradeoffStatus === "undecided"
        ? [
            "你尚未决定目标取舍。先比较投入、作品和奖项机会，再确认最优先的一项；目前不给唯一目标结论。",
          ]
        : context.profile.unknownFields.includes("weeklyCommitment")
          ? ["每周愿意投入多少时间？这会改变任务规模与准备建议。"]
          : [],
    schoolPolicyReminder:
      "综测、奖学金、推免等认可，请核对你所在学校当年的正式政策。",
    fallback,
    trace: {
      engineVersion: DECISION_ENGINE_VERSION,
      method: "rules",
      model: "server",
      promptVersion: "decision-rules.v6",
      candidateCount: context.candidates.length,
      callCount: 0,
      elapsedMs: 0,
      verification: "deterministic",
      inputTokens: null,
      outputTokens: null,
      costCny: null,
      ...trace,
    },
  };
  if (plan.comparison && report.comparisons[0])
    report.comparisons[0].tradeoff = plan.comparison;
  return decisionReportSchema.parse(report);
}

export function buildRuleDecisionReport(
  profile: CompetitionRecommendationProfileV5,
  options: DecisionBuildOptions = {},
): DecisionReportV6 {
  const start = Date.now();
  const context = buildDecisionContext(profile, options);
  return assembleDecisionReport(context, buildRuleMatchPlan(context), {
    elapsedMs: Date.now() - start,
  });
}


function goalPathCandidates(context: DecisionContextV6, goal: string) {
  const key = Object.entries(decisionGoalLabels).find(([, label]) => label === goal)?.[0];
  if (!context.originalProfile || !key) return { itemIds: [], itemNames: [] };
  const legacy = structuredClone(context.originalProfile);
  legacy.decisionContext = { ...legacy.decisionContext, goalIntent: key as NonNullable<typeof legacy.decisionContext>["goalIntent"], goalResolution: "confirmed" };
  const alternative = buildDecisionContext(legacy, { records: context.records, now: context.now });
  const ids = buildRuleMatchPlan(alternative).recommendations.slice(0, 2).map(item => item.itemId);
  return { itemIds: ids, itemNames: ids.map(id => alternative.candidates.find(c => c.record.recordId === id)!.record.name) };
}

/** Counterfactual decision changes, not empty-field counts, determine whether a question is useful. */
export function selectUsefulQuestions(context: DecisionContextV6): NonNullable<DecisionReportV6["usefulQuestions"]> {
  context = restrictDecisionContextToPublished(context);
  if (!context.originalProfile) return [];
  const dismissed = new Set(context.questionHistory?.filter(entry=>entry.catalogVersion===context.catalogVersion).map(entry=>entry.questionId));
  const dismissedFields = new Set(context.questionHistory?.filter(entry=>entry.catalogVersion===context.catalogVersion).map(entry=>entry.field));
  const shortlist = context.candidates.filter(candidate => candidate.relevant).slice(0, 12);
  for (const candidate of shortlist) {
    for (const rule of candidate.record.eligibilityRules ?? []) {
      if(dismissed.has(`question.${rule.id}`))continue;
      const field = rule.operator === "requires_confirmation" ? `qualification.${rule.id}` : `eligibility.${rule.field}`;
      if (dismissedFields.has(field) || context.profile.facts.some(f => f.field === field && f.confirmed)) continue;
      const base = evaluateRecordEligibility(candidate.record, context.profile);
      if (base?.status !== "unknown") continue;
      let options: {value:string;label:string}[] = [];
      if (rule.operator === "requires_confirmation") options = [{value:"true",label:"已核对，我符合这项条件"},{value:"false",label:"已确认，我不符合这项条件"}];
      else if (typeof rule.value === "boolean") options = [{value:"true",label:"是"},{value:"false",label:"否"}];
      else if (["age", "teamSize", "year"].includes(rule.field) && typeof rule.value === "number") {
        const first = rule.operator === "max" ? rule.value : Math.max(0,rule.value - 1);
        const second = rule.operator === "max" ? rule.value + 1 : rule.value;
        const unit = rule.field === "age" ? "岁" : rule.field === "teamSize" ? "人" : "年级";
        options = [{value:String(first),label:`${first}${unit}`},{value:String(second),label:`${second}${unit}`}];
      }
      if (!options.length) continue;
      const outcomes = options.map(option => {
        const text = `${rule.note} ${option.label}`;
        try {
          const value = rule.operator === "requires_confirmation" || typeof rule.value === "boolean" ? option.value === "true" : Number(option.value);
          const profile = applyProfileMutations(context.profile,[{operation:"set",field,value,targetFactIds:[],quote:text}],{answerId:`counterfactual-${rule.id}-${option.value}`,text,at:context.now.toISOString()},context.originalProfile!);
          return evaluateRecordEligibility(candidate.record,profile);
        } catch { return null; }
      });
      if (JSON.stringify(outcomes[0]) !== JSON.stringify(outcomes[1])) return [{id:`question.${rule.id}`,field,prompt:`${candidate.record.name}：${rule.note}`,options,candidateIds:[candidate.record.recordId],expectedChange:"不同回答会改变这项比赛的资格判断或必须核实的条件。可以暂不回答；确认后才会更新画像。"}];
    }
  }
  const questions = [
    { field: "weeklyCommitment", prompt: "每周准备投入多少时间？", options: [{value:"under-5",label:"少于5小时"},{value:"over-10",label:"10小时以上"}] },
    { field: "teamStatus", prompt: "这次你准备如何组队？", options: [{value:"solo",label:"目前独自准备"},{value:"ready",label:"已经有稳定队伍"}] },
  ];
  for (const question of questions) {
    if(dismissed.has(`question.${question.field}`)||dismissedFields.has(question.field))continue;
    if (!context.profile.unknownFields.includes(question.field)) continue;
    const trials = question.options.map(option => {
      const legacy = structuredClone(context.originalProfile!);
      Object.assign(legacy, { [question.field]: option.value });
      legacy.confirmedFields = [...new Set([...legacy.confirmedFields, question.field as "weeklyCommitment" | "teamStatus"])];
      const trial = buildDecisionContext(legacy, { records: context.records, now: context.now });
      return buildRuleMatchPlan(trial).recommendations.slice(0, 5).map((item, index) => toDecisionItem(trial.candidates.find(c => c.record.recordId === item.itemId)!, trial.profile, index + 1, item));
    });
    const signature = (items: DecisionRecommendationV6[]) => JSON.stringify(items.map(item => [item.itemId, item.preparation, item.eligibilityNotes, item.currentRole.text, item.nextStep.text]));
    if (signature(trials[0]) !== signature(trials[1])) return [{ id: `question.${question.field}`, ...question,
      candidateIds: [...new Set(trials.flatMap(items => items.map(item => item.itemId)))],
      expectedChange: "分别代入这两个回答后，前五候选、参与条件、分工或第一步会改变；回答后先确认理解，再重新匹配。" }];
  }
  return [];
}
