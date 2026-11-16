import { DECISION_MODULES, VALUE_DIMENSIONS, type CatalogChangeProposal, type CatalogValidation, type CatalogValidationIssue, type DecisionClaim, type DecisionCompetitionRecord } from "./catalog-types";
import { hasTrustedPlanDualReview } from "./trusted-plan-review";
import { hasDualAiReview, hasHumanReview } from "./catalog-review";
import { inspectFormalParticipationPlan, planFactIds } from "./participation-plan";
import { participationRequirementsSchema } from "./participation-requirements";

const substantial = (value: unknown): value is string => typeof value === "string" && value.trim().length >= 8;
const generic = /^(提升综合能力|锻炼综合能力|提升竞争力|含金量高|适合所有学生|待补充|待完善)[。！!]?$/;
const meaningful = (claim: DecisionClaim) => substantial(claim.text) && !generic.test(claim.text.trim()) && claim.kind !== "unknown";
const officialAuthorities = new Set(["organizer", "official_host", "university_local"]);

/** Computes publication quality from evidence and content. Never trusts contentTier/targetTier. */
export function validateDecisionRecord(record: DecisionCompetitionRecord, now: Date = new Date()): CatalogValidation {
  const issues: CatalogValidationIssue[] = [];
  const add = (code: string, path: string, message: string, blocks: CatalogValidationIssue["blocks"] = "L2") => issues.push({ code, path, message, blocks });
  const sources = new Map(record.sources.map(source => [source.id, source]));
  const facts = new Map(record.facts.map(fact => [fact.id, fact]));
  const supportedFact = (id: string) => {
    const fact = facts.get(id);
    return Boolean(fact && fact.kind === "official_fact" && ["verified_current", "historical"].includes(fact.status) && substantial(fact.scope) && fact.sourceIds.length && fact.sourceIds.every(sourceId => {
      const source = sources.get(sourceId);
      return source && source.accessStatus === "body_read" && source.integrity !== "requires_recheck" && officialAuthorities.has(source.authority) && substantial(source.scope) && substantial(source.locator) && source.checkedAt;
    }));
  };
  const checkRefs = (ids: string[], path: string) => ids.forEach(id => { if (!facts.has(id)) add("dangling_fact", path, `不存在的事实引用：${id}`); });
  if (!record.recordId || !record.seriesId || !record.name || !record.edition || !record.track.id || !record.group || !record.scope) add("missing_identity", "identity", "缺少赛事、届次、赛道、组别或适用范围。", "L1");
  if (!record.sources.length) add("missing_sources", "sources", "至少需要一条可追溯来源。", "L1");
  if (sources.size !== record.sources.length || facts.size !== record.facts.length) add("duplicate_reference", "sources/facts", "来源与事实 ID 必须唯一。", "L1");
  for (const source of record.sources) {
    if (!/^https?:\/\//.test(source.url) || !source.scope) add("invalid_source", `sources.${source.id}`, "来源网址与适用范围必须明确。", "L1");
  }
  for (const fact of record.facts) {
    for (const id of fact.sourceIds) if (!sources.has(id)) add("dangling_source", `facts.${fact.id}`, `不存在的来源：${id}`);
    checkRefs([...fact.supersedes, ...fact.conflictsWith], `facts.${fact.id}`);
    if (fact.kind === "official_fact" && !fact.sourceIds.length) add("unsupported_official_fact", `facts.${fact.id}`, "官方事实必须引用来源。");
    if (fact.status === "conflicting") add("unresolved_conflict", `facts.${fact.id}`, "规则存在未处理冲突。");
  }
  for (const rule of record.eligibilityRules ?? []) {
    checkRefs(rule.factIds, `eligibilityRules.${rule.id}`);
    // A confirmation-only placeholder reports what is still unknown. It is
    // not an enforceable eligibility fact: eligibility.ts keeps unsupported
    // evidence unknown even if the student answers this placeholder "yes".
    const confirmationOnly = rule.operator === "requires_confirmation" && substantial(rule.note) && rule.factIds.length > 0 && rule.factIds.every(id => {
      const fact = facts.get(id);
      return fact?.field.startsWith("eligibility") && ["pending_review", "unknown"].includes(fact.status)
        && substantial(fact.text) && fact.sourceIds.every(sourceId => sources.has(sourceId));
    });
    if (!confirmationOnly && (!rule.factIds.length || !rule.factIds.every(id => supportedFact(id)))) add("unsupported_eligibility_rule", `eligibilityRules.${rule.id}`, "结构化资格必须绑定当前记录的已读官方事实，不能从名称、编辑标签或相邻赛道推导。");
    if (["min", "max"].includes(rule.operator) && (typeof rule.value !== "number" || !Number.isFinite(rule.value))) add("invalid_eligibility_value", `eligibilityRules.${rule.id}`, "资格上下限必须是有效数值。");
  }
  if (!(record.sections.task ?? []).some(meaningful)) add("missing_task", "sections.task", "必须描述学生实际做的具体任务。", "L1");
  for (const sectionName of DECISION_MODULES) {
    const claims = record.sections[sectionName] ?? [];
    if (!claims.length) add("empty_module", `sections.${sectionName}`, "不能用空数组冒充完整决策模块。");
    for (const [index, claim] of claims.entries()) {
      const path = `sections.${sectionName}.${index}`;
      checkRefs(claim.factIds, path);
      if (!substantial(claim.text) || generic.test(claim.text.trim())) add("empty_or_generic_claim", path, "内容过空泛，不能用于学生决策。");
      if (claim.kind === "unknown" && !substantial(claim.unknownReason)) add("unknown_without_reason", path, "未知内容需要说明缺失原因与待核验事项。");
      if (claim.kind === "official_fact" && (!claim.factIds.length || !claim.factIds.every(supportedFact))) add("unsupported_claim", path, "官方结论须由已读原文和适用事实共同支持。");
    }
  }
  for (const sectionName of ["eligibility", "track", "participation", "deliverables"] as const) {
    if (!(record.sections[sectionName] ?? []).some(claim => meaningful(claim) && claim.kind === "official_fact" && claim.factIds.length && claim.factIds.every(supportedFact))) add("unknown_core_module", `sections.${sectionName}`, "关键决策信息须有原文支持，不能全部未知或由编辑推断。");
  }
  for (const sectionName of ["skills", "benefits", "nextStep"] as const) if (!(record.sections[sectionName] ?? []).some(meaningful)) add("missing_decision_content", `sections.${sectionName}`, "需要具体能力、成果条件和行动建议。");
  if (!record.roles.length || record.roles.some(role => !role.skills.length || !substantial(role.task) || !substantial(role.personalDeliverable) || !substantial(role.evidenceToAsk))) add("missing_role_mapping", "roles", "至少明确一个任务、技能、角色及个人贡献证据。");
  for (const [index, role] of record.roles.entries()) checkRefs(role.factIds, `roles.${index}`);
  if (record.valueDimensions.length !== VALUE_DIMENSIONS.length || VALUE_DIMENSIONS.some(dimension => record.valueDimensions.filter(item => item.dimension === dimension).length !== 1)) add("value_dimensions_not_unique", "valueDimensions", "六个价值维度须各出现一次。");
  if (!record.valueDimensions.some(item => item.evidenceLevel !== "unknown" && meaningful(item.assessment))) add("all_value_unknown", "valueDimensions", "所有价值均未知，尚不能形成决策级内容。");
  for (const value of record.valueDimensions) {
    checkRefs(value.assessment.factIds, `valueDimensions.${value.dimension}`);
    if (value.assessment.kind === "official_fact" && (!value.assessment.factIds.length || !value.assessment.factIds.every(supportedFact))) add("unsupported_value", `valueDimensions.${value.dimension}`, "价值事实缺少适用的原文依据。");
  }
  if (record.difficulty.length !== 3 || ["entry", "completion", "award"].some(stage => record.difficulty.filter(item => item.stage === stage).length !== 1)) add("difficulty_stages_not_unique", "difficulty", "入门、完赛、获奖必须分别出现一次。");
  for (const item of record.difficulty) {
    checkRefs(item.factIds, `difficulty.${item.stage}`);
    if (!substantial(item.summary) || !item.assumptions.length) add("missing_difficulty_basis", `difficulty.${item.stage}`, "难度须说明阶段与个人/团队前提。");
  }
  if (!substantial(record.sevenDayTrial.action) || !substantial(record.sevenDayTrial.completionCheck)) add("missing_trial", "sevenDayTrial", "体验任务须有可观察的完成标准。");
  const reviewPassed = (record.participationPlans === undefined || hasTrustedPlanDualReview(record)) && (record.review.policy === "ai_dual_review" ? hasDualAiReview(record) : hasHumanReview(record));
  if (!reviewPassed) add(record.review.policy === "ai_dual_review" ? "ai_review_pending" : "human_review_pending", "review", record.review.policy === "ai_dual_review" ? "用户授权的AI双审尚未完成：须由两位独立审核代理重读来源，并绑定当前内容摘要；不冒充人工审核。" : "关键事实与学生表述仍待真实人工审核；模型自审不算人工审核。", "publication");
  if (record.review.status === "independently_reviewed" && new Set(record.review.reviewerIds).size < 2) add("independent_review_missing", "review", "独立评审需要两位不同审核人。", "publication");
  const deep = record.deepDive;
  if (!deep || deep.status !== "reviewed" || deep.missingForPublication.length || !["published_work", "official_task"].includes(deep.workedExample.origin) || !deep.workedExample.sourceIds.length || !deep.workedExample.sourceIds.every(id => sources.get(id)?.accessStatus === "body_read") || !substantial(deep.representativeTask) || deep.workedExample.steps.length < 3 || deep.workedExample.steps.some(step => !substantial(step)) || !deep.workedExample.reviewQuestions.length || deep.fourWeekPlan.length !== 4 || new Set(deep.fourWeekPlan.map(item => item.week)).size !== 4 || deep.fourWeekPlan.some(item => !substantial(item.action) || !substantial(item.completionCheck)) || !deep.rolePaths.length || deep.rolePaths.some(item => !item.steps.length || !substantial(item.contributionProof)) || !deep.rubricMapping.some(item => item.official && item.factIds.length && item.factIds.every(id => supportedFact(id) && /(^|\.)rubric(\.|$)/.test(facts.get(id)?.field ?? ""))) || !deep.exitConditions.length) add("deep_dive_not_reviewed", "deepDive", "L3须完成真实题目/完整公开作品及适用官方评审映射、四周角色路线和内容审核；作品摘要与未读附件不能充数。", "L3");
  if (deep) {
    for (const map of deep.rubricMapping) checkRefs(map.factIds, "deepDive.rubricMapping");
    for (const map of deep.requirementMapping ?? []) checkRefs(map.factIds, "deepDive.requirementMapping");
    for (const id of deep.workedExample.sourceIds) if (!sources.has(id)) add("dangling_deep_source", "deepDive.workedExample", `不存在的案例来源：${id}`, "L3");
  }
  if (record.cost) {
    checkRefs(record.cost.factIds, "cost.factIds");
    if ([record.cost.minimumPersonalCny, record.cost.maximumPersonalCny].some(value => value !== null && (!Number.isFinite(value) || value < 0))) add("invalid_cost", "cost", "费用须为非负数字或明确未知。");
    if (record.cost.minimumPersonalCny !== null && record.cost.maximumPersonalCny !== null && record.cost.maximumPersonalCny < record.cost.minimumPersonalCny) add("invalid_cost_range", "cost", "费用上限不能小于下限。");
    if ((record.cost.minimumPersonalCny !== null || record.cost.maximumPersonalCny !== null) && (!record.cost.factIds.length || !record.cost.factIds.every(supportedFact) || record.cost.scope !== record.scope)) add("unsupported_cost", "cost", "可计算自费边界须有同适用范围的费用依据。");
  }
  const planInspections = Array.isArray(record.participationPlans) ? record.participationPlans.map(plan => inspectFormalParticipationPlan(record, plan, now)) : [];
  if (record.participationPlans !== undefined && (!Array.isArray(record.participationPlans) || !record.participationPlans.length)) add("invalid_formal_participation_plans", "participationPlans", "Expected a nonempty typed plan array.");
  for (const result of planInspections) {
    if (!result.plan) add("invalid_formal_participation_plan", "participationPlans", "Invalid typed formal path assessment.");
    else {
      checkRefs(planFactIds(result.plan), "participationPlans");
      for (const reason of result.reasons) add(reason, "participationPlans", "Formal participation feasibility remains unproved; this is not a registration fact.", "strict_participation");
    }
  }
  if (record.participationRequirements !== undefined) {
    const parsed=participationRequirementsSchema.safeParse(record.participationRequirements);
    if(!parsed.success)add("invalid_participation_requirements", "participationRequirements", "资源条件必须逐项显式使用合法值或null；空串、缺字段或错误类型不能冒充无需资源。");
    for (const [key, requirement] of Object.entries(parsed.success?parsed.data:{})) {
      checkRefs(requirement.factIds, `participationRequirements.${key}`);
      const derived = planInspections.some(result => result.plan && (key === "weeklyHours" ? result.plan.workload.kind === "editorial_estimate" && requirement.value === null : result.plan.resourceDerivations.some(d => d.field === key && requirement.factIds.length === 1 && requirement.factIds[0] === d.conclusionFactId)));
      if (!derived && requirement.value !== null && (!requirement.factIds.length || !requirement.factIds.every(id => supportedFact(id) && facts.get(id)?.field === `participation.${key}`))) add("unsupported_participation_requirement", `participationRequirements.${key}`, "资源与时间要求须逐字段绑定适用原文；缺失不能解释为无需资源。");
    }
  }
  const checked = Date.parse(record.registration.checkedAt ?? "");
  const age = now.getTime() - checked;
  const currentRegistrationVerified = record.registration.status === "open" && Number.isFinite(checked) && age >= 0 && age <= 72 * 60 * 60 * 1000 && record.registration.factIds.length > 0 && record.registration.factIds.every(id => supportedFact(id) && facts.get(id)?.status === "verified_current" && facts.get(id)?.field.startsWith("registration")) && !issues.some(issue => issue.blocks === "L1" || issue.blocks === "L2" || issue.blocks === "publication" || issue.code === "unresolved_conflict");
  checkRefs(record.registration.factIds, "registration.factIds");
  if (record.registration.status === "open" && !currentRegistrationVerified) add("registration_not_current", "registration", "当前可报名需要72小时内适用事实核验及所选发布政策要求的审核。", "registration");
  const tier = issues.some(issue => issue.blocks === "L1") ? "L0" : issues.some(issue => issue.blocks === "L2") ? "L1" : issues.some(issue => issue.blocks === "L3") ? "L2" : "L3";
  return { tier, issues, currentRegistrationVerified, recommendationMode: tier === "L0" ? "discovery_only" : tier === "L1" ? "conditional_exploration" : "decision_ready" };
}

const criticalFields = /^(eligibility|registration|edition|track|group|scope|sources|facts|cost|participationRequirements|participationPlans|sections\.(eligibility|participation|deliverables|investment)|intellectualProperty|aiUsage|fee|deadline|review|publication|contentTier)(\.|$)/;
/** Extraction creates a proposal only. It never mutates/publishes a catalog record. */
export function createCatalogChangeProposal(input: Omit<CatalogChangeProposal, "risk" | "status" | "reviewerId" | "reviewedAt">): CatalogChangeProposal {
  if (!input.id || !input.recordId || !input.sourceId || !input.field || /(^|\.)(__proto__|prototype|constructor)(\.|$)/.test(input.field)) throw new Error("变更提案标识、来源或字段不合法");
  return { ...input, risk: criticalFields.test(input.field) ? "critical" : "editorial", status: "pending_review", reviewerId: null, reviewedAt: null };
}

export function validateCatalogSnapshot(records: DecisionCompetitionRecord[], now: Date = new Date()) {
  const duplicates = records.map(record => record.recordId).filter((id, index, all) => all.indexOf(id) !== index);
  const results = records.map(record => ({ recordId: record.recordId, ...validateDecisionRecord(record, now) }));
  return { valid: !duplicates.length && results.every(result => !result.issues.some(issue => issue.blocks === "L1")), structurallyValid: !duplicates.length && results.every(result => !result.issues.some(issue => issue.blocks === "L1")), allDecisionReady: results.every(result => ["L2", "L3"].includes(result.tier)), allPublicationReady: results.every(result => !result.issues.some(issue => ["L1", "L2", "publication"].includes(issue.blocks))), duplicateRecordIds: [...new Set(duplicates)], records: results };
}
