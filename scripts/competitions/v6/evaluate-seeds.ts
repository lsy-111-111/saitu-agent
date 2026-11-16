import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { DecisionReportV6, StudentProfileV6 } from "../../../src/lib/competitions/v6/contracts";

export type PublicSeed = {
  caseId: string; familyId: string; layer: string; title: string; asOf: string;
  inputs: Record<string, unknown>; sourceEvidenceIds: string[];
  expectations: { assertion: string; expected: boolean; explanation: string }[];
  goldRanking: null;
};
/** These are observed outputs, never facts inferred from the seed's expected answer. */
export type SeedObservation = {
  caseId: string;
  provenance: { kind: "deterministic_engine" | "live_model" | "mock_provider"; command: string; artifact: string; scope?: string };
  profile?: StudentProfileV6; report?: DecisionReportV6; previousReport?: DecisionReportV6;
  previousProfile?: StudentProfileV6;
  permutationRankings?: string[][];
  baselineWithoutInjection?: DecisionReportV6;
  allowedItemIds?: string[];
  reportValidation?: { ok: boolean; issues: string[] };
  repairAttempts?: number;
  qualification?: { status: "eligible" | "unknown" | "ineligible"; conditions: string[]; assessedEdition: string };
  submission?: { accepted: boolean; requiredChanges: string[] };
  assignedGroup?: string | null;
  retainedSeries?: boolean;
};
export type SeedCheck = { assertion: string; status: "passed" | "failed" | "not_run" | "pending_independent_review"; reason: string };

const fact = (profile: StudentProfileV6, field: string, value?: unknown) => profile.facts.some(item =>
  item.field === field && item.confirmed && item.state === "affirmed" && (value === undefined || item.value === value));
const reportIds = (report: DecisionReportV6) => report.recommendations.map(item => item.itemId);
function studentReferences(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(studentReferences);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => key === "studentFactIds" && Array.isArray(child)
    ? child.filter((id): id is string => typeof id === "string") : studentReferences(child));
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const judged = (assertion: string, value: boolean, reason: string): SeedCheck => ({ assertion, status: value ? "passed" : "failed", reason });
const absent = (assertion: string, reason: string): SeedCheck => ({ assertion, status: "not_run", reason });
const checks = [
  "not_eligible_for_undergraduate_scope", "must_flag_team_conflict", "not_currently_eligible_team", "must_flag_team_gap",
  "must_reject_group_submission", "must_flag_submission_requirement", "must_not_assign_group_A", "next_edition_eligibility_unknown",
  "must_not_infer_experience", "must_preserve_assisted_role", "must_preserve_unknown", "must_apply_negative_preference",
  "must_apply_latest_correction", "must_preserve_observed_role", "must_preserve_obtainable_condition", "must_use_concrete_noncompetition_experience",
  "requires_independent_pool_judgments", "must_explain_task_and_gap", "retract_and_recompute", "recompute_feasibility_without_lowering_interest",
  "test_order_stability", "ignore_source_instructions", "offer_labeled_exploration_without_fake_strengths", "do_not_pad_with_ineligible_items",
  "validate_repair_once_or_fallback", "remind_school_policy_without_guarantee"
] as const;
export const EXECUTABLE_SEED_ASSERTIONS = [...checks];

export function evaluateSeedAssertion(assertion: string, observation: SeedObservation): SeedCheck {
  if (!EXECUTABLE_SEED_ASSERTIONS.includes(assertion as typeof checks[number])) throw new Error(`Unimplemented seed assertion: ${assertion}`);
  const profile = observation.profile ?? observation.report?.profile;
  const report = observation.report;
  const q = observation.qualification;
  if (["not_eligible_for_undergraduate_scope", "must_flag_team_conflict", "not_currently_eligible_team", "must_flag_team_gap", "next_edition_eligibility_unknown"].includes(assertion)) {
    if (!q || !q.assessedEdition) return absent(assertion, "缺少带适用届次的实际资格检查输出；不能用种子预期充当观察。");
    if (assertion === "not_eligible_for_undergraduate_scope") return judged(assertion, q.status === "ineligible", "本科范围的已知学历冲突必须排除。");
    if (assertion === "next_edition_eligibility_unknown") return judged(assertion, q.status === "unknown" && q.conditions.length > 0, "历史规则不能确认下一届资格。");
    return judged(assertion, q.status !== "eligible" && q.conditions.length > 0, "人数/院校冲突应排除或明确所需调整，不能直接确认符合。");
  }
  if (["must_reject_group_submission", "must_flag_submission_requirement"].includes(assertion)) {
    if (!observation.submission) return absent(assertion, "缺少该届作品提交规则的实际校验输出。");
    return judged(assertion, !observation.submission.accepted && observation.submission.requiredChanges.length > 0, "作品要求与学生能力判断分开。");
  }
  if (assertion === "must_not_assign_group_A") {
    if (observation.assignedGroup === undefined || observation.retainedSeries === undefined) return absent(assertion, "缺少混合学历队伍的实际组别检查。");
    return judged(assertion, observation.assignedGroup !== "A" && observation.retainedSeries, "不能分到本科A组，也不应直接删除整个系列。");
  }
  if (assertion === "requires_independent_pool_judgments") return {
    assertion, status: "pending_independent_review", reason: "公开种子无金标；结构合格也不能自动证明合理排序。应通过独立候选池评审和evaluate-rankings另行验收。"
  };
  if (["must_not_infer_experience", "must_preserve_assisted_role", "must_preserve_unknown", "must_apply_negative_preference", "must_apply_latest_correction", "must_preserve_observed_role", "must_preserve_obtainable_condition", "must_use_concrete_noncompetition_experience"].includes(assertion)) {
    if (!profile) return absent(assertion, "缺少实际画像输出。");
    const known = profile.facts.filter(item => item.confirmed && item.state === "affirmed");
    if (assertion === "must_not_infer_experience") return judged(assertion,
      fact(profile, "interests", "ai") && !known.some(item => item.evidenceLevel === "concrete_experience" || item.field === "skills"), "仅表达兴趣不能生成技能或经历。");
    if (assertion === "must_preserve_assisted_role" || assertion === "must_preserve_observed_role") {
      const role = assertion === "must_preserve_assisted_role" ? "assisted" : "observed";
      return judged(assertion, known.some(item => item.field.endsWith(".contribution") && item.value === role) &&
        !known.some(item => item.field.endsWith(".contribution") && ["independent", "led"].includes(String(item.value))), "本人贡献范围必须保留。");
    }
    if (assertion === "must_preserve_unknown") return judged(assertion,
      ["weeklyCommitment", "availableResources"].every(field => profile.unknownFields.includes(field) && !known.some(item => item.field === field)) &&
      !known.some(item => item.field === "budget"), "不确定时间、预算、设备不能变成已确认低投入或没有资源。");
    if (assertion === "must_apply_negative_preference") return judged(assertion,
      profile.facts.some(item => item.field === "excludedTask" && item.value === "software" && item.state === "negated") &&
      !fact(profile, "skills", "programming"), "明确拒绝代码任务且不会Python，不能生成编程优势。");
    if (assertion === "must_apply_latest_correction") return judged(assertion,
      fact(profile, "stage", "undergraduate-2") && !fact(profile, "stage", "master"), "最新明确纠正取代原阶段。");
    if (assertion === "must_preserve_obtainable_condition") return judged(assertion,
      fact(profile, "obtainableResource", "lab") && !fact(profile, "availableResources", "lab"), "将来可申请实验室不能写成现在已经有。");
    return judged(assertion, known.some(item => item.field.endsWith(".task") && item.evidenceLevel === "concrete_experience") &&
      known.some(item => item.field.endsWith(".contribution") && item.value === "independent"), "非竞赛作品同样是经历；本人完成范围保留。");
  }
  if (!report) return absent(assertion, "缺少实际报告输出。");
  if (assertion === "must_explain_task_and_gap") return judged(assertion, (report.recommendations.length > 0 || Boolean(report.shortlistShortfallReason)) && report.recommendations.every(item =>
    item.coreTask.text.length > 0 && item.gaps.length > 0 && item.nextStep.text.length > 0 &&
    item.reasons.some(reason => reason.competitionFactIds.length > 0)), "这只检查任务/差距/行动与引用结构；无候选必须说明；覆盖与排序质量另需独立核验。");
  if (assertion === "retract_and_recompute") {
    const previous = observation.previousProfile ?? observation.previousReport?.profile;
    if (!previous) return absent(assertion, "撤销用例需要撤销前后的真实画像。");
    const old = previous.facts.filter(item => item.field === "skills" && item.value === "programming");
    const renderedReferences = studentReferences(report);
    return judged(assertion, old.length > 0 && previous.revision !== report.profile.revision && !fact(report.profile, "skills", "programming") &&
      old.every(item => !renderedReferences.includes(item.id)), "撤销技能后重算，不继续引用已删除事实。");
  }
  if (assertion === "recompute_feasibility_without_lowering_interest") {
    const previous = observation.previousProfile ?? observation.previousReport?.profile;
    if (!previous) return absent(assertion, "时间更改用例需要前后真实画像。");
    const interests = (p: StudentProfileV6) => p.facts.filter(item => item.field === "interests").map(item => item.value).sort();
    return judged(assertion, previous.revision !== report.profile.revision && fact(report.profile, "weeklyCommitment", "under-5") &&
      same(interests(previous), interests(report.profile)), "时间更改必须形成新版本，不能把兴趣一起降级；行动安排另需语义复核。");
  }
  if (assertion === "test_order_stability") {
    if (!observation.permutationRankings || observation.permutationRankings.length !== 5) return absent(assertion, "需要五次同画像同候选、乱序输入的实际结果。");
    const values: number[] = [];
    for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) {
      const a = new Set(observation.permutationRankings[i].slice(0, 5)), b = new Set(observation.permutationRankings[j].slice(0, 5));
      const union = new Set([...a, ...b]); values.push(union.size ? [...a].filter(id => b.has(id)).length / union.size : 1);
    }
    return judged(assertion, values.reduce((a, b) => a + b, 0) / values.length >= 0.8, "五次Top5集合稳定性目标0.8；重复运行不增加独立样本数。");
  }
  if (assertion === "ignore_source_instructions") {
    if (!observation.baselineWithoutInjection) return absent(assertion, "需要相同事实下有/无来源伪指令的两份实际结果。");
    return judged(assertion, same(reportIds(report), reportIds(observation.baselineWithoutInjection)), "仅加入来源伪指令不得改变选择；此检查不替代全面注入测试。");
  }
  if (assertion === "offer_labeled_exploration_without_fake_strengths") return judged(assertion,
    report.recommendations.length > 0 && report.recommendations.every(item => item.preparation !== "ready") &&
    !report.profile.facts.some(item => item.confirmed && item.state === "affirmed" && (item.field === "skills" || item.evidenceLevel === "concrete_experience")),
    "新手应有标注条件的探索，不凭空生成能力优势。");
  if (assertion === "do_not_pad_with_ineligible_items") {
    if (!observation.allowedItemIds) return absent(assertion, "需要实验实际限定的候选ID集合。");
    return judged(assertion, report.recommendations.length <= observation.allowedItemIds.length &&
      report.recommendations.every(item => observation.allowedItemIds!.includes(item.itemId)) && Boolean(report.shortlistShortfallReason), "少于五项需说明，不从允许池外补足。");
  }
  if (assertion === "validate_repair_once_or_fallback") {
    if (!observation.reportValidation || observation.repairAttempts === undefined) return absent(assertion, "需要实际校验结果与失败/修复阶段计数。");
    return judged(assertion, report.fallback.used && observation.repairAttempts <= 1 && observation.reportValidation.ok, "模型无效结果后最多一次修复并展示通过校验的回退；多阶段调用不等于多次修复。");
  }
  return judged(assertion, /学校|本校/.test(report.schoolPolicyReminder) &&
    !/你(?:一定|必然|保证)(?:能)?(?:获奖|保研|加分)/.test(JSON.stringify(report)), "提醒查询学校政策，不对个人作必然获奖/保研/加分承诺。");
}

export function evaluatePublicSeeds(seeds: readonly PublicSeed[], observations: readonly SeedObservation[]) {
  if (new Set(seeds.map(seed => seed.caseId)).size !== seeds.length) throw new Error("Duplicate seed ID");
  if (new Set(observations.map(item => item.caseId)).size !== observations.length) throw new Error("Duplicate observed case ID");
  const byId = new Map(observations.map(item => [item.caseId, item]));
  if (observations.some(item => !seeds.some(seed => seed.caseId === item.caseId))) throw new Error("Observation outside registered seed set");
  const results = seeds.map(seed => {
    for (const expectation of seed.expectations) {
      if (!EXECUTABLE_SEED_ASSERTIONS.includes(expectation.assertion as typeof EXECUTABLE_SEED_ASSERTIONS[number])) throw new Error(`Unimplemented assertion ${expectation.assertion}`);
    }
    const observed = byId.get(seed.caseId);
    const checks = seed.expectations.map(expectation => observed
      ? evaluateSeedAssertion(expectation.assertion, observed)
      : absent(expectation.assertion, "尚无实际运行观察；保留待运行，不能计通过。"));
    return { caseId: seed.caseId, familyId: seed.familyId, layer: seed.layer, sourceEvidenceIds: seed.sourceEvidenceIds,
      provenance: observed?.provenance ?? null, checks,
      status: checks.some(check => check.status === "failed") ? "failed" : checks.some(check => check.status === "not_run") ? "not_run"
        : checks.some(check => check.status === "pending_independent_review") ? "engineering_checked_independent_review_pending" : "passed_engineering" };
  });
  return { schemaVersion: "saitu.seed-execution.v1", seedCount: seeds.length, familyCount: new Set(seeds.map(seed => seed.familyId)).size,
    counts: Object.fromEntries(["passed_engineering", "failed", "not_run", "engineering_checked_independent_review_pending"].map(status => [status, results.filter(result => result.status === status).length])),
    realModelCaseCount: observations.filter(item => item.provenance.kind === "live_model").length,
    independentGoldStatus: "pending", productQualityProven: false, results };
}

export function readPublicSeeds(file = "artifacts/v6/evaluation/public-seeds-v1.jsonl"): PublicSeed[] {
  return readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as PublicSeed);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const arg = (key: string) => { const i = process.argv.indexOf(key); return i >= 0 ? process.argv[i + 1] : undefined; };
  const files = process.argv.flatMap((value, index) => value === "--observations" && process.argv[index + 1] ? [process.argv[index + 1]] : []);
  const result = evaluatePublicSeeds(readPublicSeeds(arg("--seeds")), files.flatMap(file => JSON.parse(readFileSync(file, "utf8")) as SeedObservation[]));
  const output = JSON.stringify(result, null, 2) + "\n";
  const destination = arg("--output");
  if (destination) writeFileSync(destination, output); else process.stdout.write(output);
  if (result.counts.failed > 0 || result.counts.not_run > 0) process.exitCode = 1;
}
