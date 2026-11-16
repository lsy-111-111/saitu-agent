import { isolateResearchedLegacyReferences } from "@/content/competitions-v6/legacy-track-fact-overrides";
import { competitions, type Competition } from "@/content/competitions";
import { getCompetitionFactSheet } from "@/content/competition-facts";
import { getCompetitionFieldGuide } from "@/content/competition-field-guides";
import { coverageProfiles } from "@/content/competitions-v6/coverage";
import { pilotContents, type PilotContent } from "@/content/competitions-v6/pilots";
import { deepEvidence } from "@/content/competitions-v6/deep-evidence";
import expansionCandidates from "@/content/competitions-v6/expansion-candidates.json";
import { DECISION_MODULES, VALUE_DIMENSIONS, type CatalogFact, type CatalogSource, type DecisionClaim, type DecisionCompetitionRecord, type DecisionModule, type ExpansionCandidate, type TaskFamily } from "./catalog-types";
import { validateDecisionRecord } from "./catalog-validation";
import { bindRecordIdentity, migrateLegacyTrack } from "./catalog-identity";
import { hasDualAiReview, hasHumanReview } from "./catalog-review";
import { researchedContents } from "@/content/competitions-v6/research-records";
import type { ResearchedContent } from "@/content/competitions-v6/research-types";
import activeSnapshot from "@/content/competitions-v6/active-snapshot.json";
import { checkSnapshot, type CatalogSnapshot } from "./catalog-snapshot";
import reviewLedger from "@/content/competitions-v6/ai-review-ledger.json";
import { readRuntimeCatalogSnapshot } from "./catalog-runtime";
import { authoredEligibilityFacts } from "./catalog-eligibility-facts";

export const DECISION_CATALOG_VERSION = "saitu.catalog.v3.20261105.1";
const claim = (text: string, kind: DecisionClaim["kind"] = "editorial_inference", factIds: string[] = [], conditions: string[] = []): DecisionClaim => ({ text, kind, factIds, conditions });
const unknown = (text: string): DecisionClaim => ({ ...claim(text, "unknown"), unknownReason: text });

function familyFor(competition: Competition): TaskFamily {
  const signals = competition.recommendation.fit?.signals ?? [];
  if (signals.includes("software-engineering") || signals.includes("algorithm-competition") || signals.includes("network-systems")) return "software-algorithms";
  if (signals.includes("modeling-intensive")) return "data-modeling";
  if (signals.includes("hardware-build") || signals.includes("robotics-integration")) return "engineering-prototype";
  if (signals.includes("research-provenance")) return "experimental-research";
  if (signals.includes("field-research")) return "investigation";
  if (signals.includes("design-portfolio")) return "visual-interaction";
  if (signals.includes("language-communication")) return "language-communication";
  return "business-practice";
}

function migrateSeries(competition: Competition): DecisionCompetitionRecord {
  const sheet = getCompetitionFactSheet(competition.id);
  const guide = getCompetitionFieldGuide(competition.id);
  const prefix = `${competition.id}:legacy`;
  const sources: CatalogSource[] = (sheet?.sources.length ? sheet.sources : [{ title: competition.name, url: competition.sourceUrl, scope: "旧库来源入口；本轮未重新核验具体适用范围" }]).map((item, index) => ({
    id: `${prefix}:source:${index + 1}`, url: item.url, title: item.title,
    publisher: "旧库所列发布方待复核", authority: /\.edu\.cn/.test(item.url) ? "university_local" : "other",
    scope: item.scope, checkedAt: sheet?.checkedAt ?? null, publishedAt: null,
    accessStatus: "imported_unrechecked", locator: "旧版事实表的来源序号；原文定位待本轮复核", verificationMethod: "legacy_import"
  }));
  const facts: CatalogFact[] = (["eligibility", "team", "mentor", "fee"] as const).map(field => {
    const text = sheet?.[field] ?? "该事项缺少已核验资料，待补充适用原文。";
    const sourceIndexes = [...text.matchAll(/〔(\d+)〕/g)].map(match => Number(match[1]) - 1);
    const unresolved = /待核|待确认|未核|不明/.test(text);
    return { id: `${prefix}:fact:${field}`, field, text, kind: unresolved ? "unknown" : "official_fact", status: unresolved ? "unknown" : "pending_review", sourceIds: sourceIndexes.filter(index => sources[index]).map(index => sources[index].id), scope: `${sheet?.edition ?? "届次待核"}；${sources[0]?.scope ?? "适用范围待核"}`, checkedAt: sheet?.checkedAt ?? null, supersedes: [], conflictsWith: [] };
  });
  const sections = Object.fromEntries(DECISION_MODULES.map(sectionName => [sectionName, [unknown(`${competition.name}的${sectionName}模块尚缺逐项原文核验；保留已知内容，不能推断未知条件。`)]])) as Record<DecisionModule, DecisionClaim[]>;
  sections.task = [claim(guide?.task ?? competition.summary)];
  sections.eligibility = [claim(facts[0].text, facts[0].kind, [facts[0].id])];
  if (facts[0].kind === "unknown") sections.eligibility = [unknown(facts[0].text)];
  sections.track = [unknown("当前为系列迁移概览，尚未选定并核验具体赛道、组别及适用地区。")];
  sections.participation = [claim(competition.detail.participationPath)];
  sections.deliverables = [claim(guide?.deliverable ?? "交付物须按具体届次与赛道核验，本系列概览不提供完整清单。")];
  sections.skills = [claim(`${guide?.experience ?? "先补充一次相关课程或项目经历"}；这些是编辑发现线索，不能作为官方资格。`)];
  sections.investment = [claim(guide?.investment ?? "实际时间和资源须结合具体任务确认。"), unknown(sheet?.fee ?? "报名、材料与差旅费用均尚待核实。")];
  sections.difficulty = [claim("先区分能否上手、能否完成交付与是否具备竞争力；需结合个人经历和团队条件判断。")];
  sections.benefits = [claim(`如果实际完成且允许展示，可保留${guide?.deliverable ?? "成果及过程记录"}，并说明本人贡献；不保证获奖或招聘认可。`)];
  sections.value = [claim("根据任务关联、作品与可核实认可分别判断价值；不沿用旧库综合分作为全国通用含金量。")];
  sections.nextStep = [claim(guide?.firstStep ?? "先选择一个具体任务，说明要产出什么，再核对是否具备必要条件。")];
  const record: DecisionCompetitionRecord = {
    schemaVersion: "saitu.competition.v2", catalogVersion: DECISION_CATALOG_VERSION,
    recordId: `${competition.id}:overview:v2`, seriesId: competition.id, name: competition.name,
    aliases: [...competition.identity.aliases], organizer: competition.identity.organizer,
    edition: sheet?.edition ?? "届次待核验", track: { id: "series-overview", name: "系列概览，赛道待核验" }, group: "具体参赛组别待核验",
    scope: "保留各来源原有范围，不将学校或往届条件升级为全国当前规则", taskFamily: familyFor(competition), subjectTags: [...(competition.recommendation.subjects ?? [])],
    summary: guide?.task ?? competition.summary, pilot: false, contentTier: "L1", targetTier: "L2",
    review: { status: "draft", reviewerIds: [], reviewedAt: null },
    registration: { status: "unknown", checkedAt: null, factIds: [], note: "迁移不等于当届报名核验；旧日期不自动续期，不显示当前可报名。" },
    sources, facts, sections,
    roles: [{ name: "待核验角色路径", task: guide?.role ?? "结合具体交付物明确本人能承担的任务。", skills: [...competition.recommendation.skills], evidenceToAsk: `${guide?.experience ?? "请描述一项自己完成的相关工作"}；说明你亲自做了哪一步。`, personalDeliverable: `本人过程记录与${guide?.deliverable ?? "可检验的小成果"}`, prerequisite: "learnable", factIds: [] }],
    valueDimensions: VALUE_DIMENSIONS.map(dimension => ({ dimension, assessment: dimension === "portfolio" ? sections.benefits[0] : unknown("本维度尚缺具体届次的适用证据，不作认可或机会承诺。"), evidenceLevel: dimension === "portfolio" ? "partial" : "unknown" })),
    difficulty: [
      { stage: "entry", summary: `先用小任务检验兴趣和基础：${guide?.firstStep ?? "描述一个计划完成的具体成果"}`, assumptions: ["当前能力仅能从真实经历推断"], factIds: [] },
      { stage: "completion", summary: `主要投入线索：${guide?.investment ?? "交付、团队、资源与时间仍需核验"}`, assumptions: ["不把团队整体能力当作个人能力"], factIds: [] },
      { stage: "award", summary: "缺少适用赛道数据与校准模型，不估计个人获奖率；需另核评审依据。", assumptions: ["完成不等于获奖，奖项也不保证学校或招聘认可"], factIds: [] }
    ],
    skills: [...competition.recommendation.skills], interests: [...competition.recommendation.interests], preferredOutputs: [...competition.recommendation.preferredOutputs], experienceSignals: [guide?.experience ?? "经历证据待补充"],
    suitability: { goodFit: [...competition.detail.suitableFor], poorFit: ["未确认资格、时间和资源前，不应把系列概览当作已可报名结论"], uncertainties: ["关键事实仍为旧库迁移，未完成本轮逐项原文复核"] },
    sevenDayTrial: { action: guide?.firstStep ?? "选定一个具体任务并拆成可以观察的第一步。", output: `一份${guide?.deliverable ?? "小成果"}的缩小样例及本人过程记录`, completionCheck: "能向另一人说明本人做了什么、依据是什么，以及尚未解决的一个问题。", reflection: "实际做任务时是否仍有兴趣？希望继续承担哪个角色？" },
    schoolPolicyReminder: "请按本人学校、学院及当前年度政策核实认定；本项目不承诺加分、推免或就业结果。",
    publication: { mode: "conditional_exploration", productionReady: false, blockers: [] },
    migration: { origin: "legacy_135", originalSeriesId: competition.id, originalCheckedAt: sheet?.checkedAt ?? null, note: "保留135系列身份与原核验日期；不沿用旧评分、完整度或校内通知作为新发布证明。" }
  };
  return record;
}

function applyPilot(record: DecisionCompetitionRecord, pilot: PilotContent): void {
  if (pilot.authorAgentId) record.review.authorAgentId = pilot.authorAgentId;
  record.pilot = true;
  record.targetTier = pilot.deep ? "L3" : "L2";
  record.track = { id: pilot.trackId, name: pilot.trackName };
  record.recordId = `${record.seriesId}:${pilot.trackId}:v2`;
  record.edition = pilot.edition;
  record.scope = pilot.scope;
  record.group = "本科生；详细学籍、赛段和组别条件见资格模块";
  record.taskFamily = pilot.taskFamily;
  record.summary = pilot.task;
  record.sources.push(...pilot.sources);
  const refs: Partial<Record<DecisionModule, string>> = {};
  for (const sectionName of Object.keys(pilot.verified) as DecisionModule[]) {
    const entry = pilot.verified[sectionName]!;
    const evidence = (entry.sources ?? (Array.isArray(entry.source) ? entry.source : [entry.source])).map(index => pilot.sources[index]);
    if (!evidence.length || evidence.some(source => !source)) throw new Error(`Missing source for ${pilot.seriesId}:${sectionName}`);
    const id = `${record.seriesId}:v2:${sectionName}`;
    record.facts.push({ id, field: sectionName, text: entry.text, kind: "official_fact", status: pilot.factStatus ?? "historical", sourceIds: evidence.map(source => source.id), sourceScopes: evidence.map(source => ({ sourceId: source.id, scope: source.scope })), scope: evidence.map(source => source.scope).join("；"), checkedAt: evidence[0].checkedAt, supersedes: [], conflictsWith: [] });
    record.sections[sectionName] = [claim(entry.text, "official_fact", [id])];
    refs[sectionName] = id;
  }
  record.sections.task = [claim(pilot.task, "editorial_inference", refs.track ? [refs.track] : [])];
  const roleEvidenceId = pilot.roleEvidenceField === undefined ? refs.task ?? refs.deliverables : refs[pilot.roleEvidenceField];
  if (pilot.roleEvidenceField !== undefined && roleEvidenceId === undefined) throw new Error(`Missing role evidence for ${pilot.seriesId}:${pilot.roleEvidenceField}`);
  record.sections.skills = pilot.roles.map(role => claim(`${role.name}：${role.task}。需要的经历证据：${role.evidence}`, "editorial_inference", roleEvidenceId ? [roleEvidenceId] : []));
  record.sections.benefits = [claim(pilot.gain, "editorial_inference", refs.deliverables ? [refs.deliverables] : [], ["已实际完成相应工作", "公开展示已取得必要授权"] )];
  record.sections.investment = [...(pilot.verified.investment ? record.sections.investment : []), claim(pilot.investment), unknown("总费用和个人时间取决于所在学校、赛段及资源；未知金额不视为免费。")];
  record.sections.difficulty = [claim(`入门：${pilot.entry}`), claim(`完赛：${pilot.completion}`), claim("获奖：需结合所选赛道评审和同届作品比较；没有可靠数据，不给个人获奖概率。")];
  record.sections.value = [claim(pilot.gain), unknown("学校认定、企业招聘与升学作用尚无对该学生适用的保证，需分别核验。")];
  record.sections.nextStep = [claim(`${pilot.trial.action}完成标准：${pilot.trial.check}`)];
  record.roles = pilot.roles.map(role => ({ name: role.name, task: role.task, skills: role.skills, evidenceToAsk: role.evidence, personalDeliverable: role.output, prerequisite: "learnable", factIds: roleEvidenceId ? [roleEvidenceId] : [] }));
  record.skills = [...new Set(pilot.roles.flatMap(role => role.skills))];
  record.experienceSignals = pilot.roles.map(role => role.evidence);
  record.suitability = { goodFit: pilot.fit, poorFit: pilot.avoid, uncertainties: pilot.remaining };
  if (record.seriesId === "lanqiao-cup" && refs.investment) record.cost = { minimumPersonalCny: null, maximumPersonalCny: null, factIds: [refs.investment], scope: pilot.scope, note: "官网个人赛每科计费300元/人；学校是否承担/报销未确认，不能当作用户必付自费最低额，食宿交通和总额未知。" };
  if (record.seriesId === "chinese-classics" && refs.investment) record.cost = { minimumPersonalCny: null, maximumPersonalCny: null, factIds: [refs.investment], scope: pilot.scope, note: `所引费用条款：${pilot.verified.investment!.text}；报名费承担不等于个人总费用，制作与出行支出仍须核对。` };
  record.sevenDayTrial = { action: pilot.trial.action, output: pilot.trial.output, completionCheck: pilot.trial.check, reflection: pilot.trial.reflection };
  record.difficulty = [
    { stage: "entry", summary: pilot.entry, assumptions: ["根据学生真实经历判断；没有经历不等于没有潜力"], factIds: refs.track ? [refs.track] : [] },
    { stage: "completion", summary: pilot.completion, assumptions: ["需核对个人时间、队友、导师与必要资源"], factIds: refs.deliverables ? [refs.deliverables] : [] },
    { stage: "award", summary: "完成交付与获奖分开判断；本库没有可用于个人获奖概率的校准数据。", assumptions: ["奖项取决于当届赛道与评审，不承诺结果"], factIds: refs.rubric ? [refs.rubric] : [] }
  ];
  record.valueDimensions = VALUE_DIMENSIONS.map(dimension => {
    if (dimension === "governance") return { dimension, assessment: claim(`已读规则来源：${pilot.sources[0].publisher}。仍需按来源范围和后续补充通知使用。`, "editorial_inference", refs[pilot.governanceFactField ?? "track"] ? [refs[pilot.governanceFactField ?? "track"]!] : []), evidenceLevel: "partial" };
    if (dimension === "taskRelevance") return { dimension, assessment: claim(`该路径实际任务为：${pilot.task}；相关性须与学生目标相对照。`), evidenceLevel: "partial" };
    if (dimension === "portfolio") return { dimension, assessment: record.sections.benefits[0], evidenceLevel: "partial" };
    if (dimension === "learningFeedback") return { dimension, assessment: claim(`体验时可以这样检查学习：${pilot.trial.check}；这不是承诺赛事会提供个人反馈。`), evidenceLevel: "partial" };
    return { dimension, assessment: unknown("尚无可核实的个人行业/学术接触机会或学校/招聘认可承诺；不从赛事名称推导。"), evidenceLevel: "unknown" };
  });
  const deepSource = deepEvidence[record.seriesId];
  if (pilot.deep && deepSource) {
    record.sources.push(deepSource.source);
    deepSource.requirements.forEach((item, index) => record.facts.push({ id: `${record.seriesId}:v2:deep.requirement.${index}`, field: `deep.requirement.${index}`, text: item.requirement, kind: "official_fact", status: deepSource.source.accessStatus === "body_read" ? "historical" : "pending_review", sourceIds: [deepSource.source.id], scope: deepSource.source.scope, checkedAt: deepSource.source.checkedAt, supersedes: [], conflictsWith: [] }));
  }
  if (pilot.deep) record.deepDive = {
    status: "draft", representativeTask: deepSource?.representativeTask ?? pilot.task,
    workedExample: { title: deepSource?.title ?? pilot.deep.title, origin: deepSource?.origin ?? "editorial_example", sourceIds: deepSource ? [deepSource.source.id] : [], sourceBoundary: deepSource?.boundary, steps: deepSource?.steps ?? pilot.deep.steps, reviewQuestions: deepSource?.checks ?? pilot.deep.checks },
    requirementMapping: deepSource?.requirements.map((item, index) => ({ ...item, factIds: [`${record.seriesId}:v2:deep.requirement.${index}`] })),
    rubricMapping: pilot.deep.checks.map(criterion => ({ criterion, evidence: "检查体验作品及本人过程记录；这是编辑建议，非官方评分项。", official: false, factIds: [] })),
    rolePaths: pilot.roles.map(role => ({ role: role.name, steps: [role.task, `保留${role.output}`, "请另一人复核解释与结果是否一致"], contributionProof: role.output })),
    fourWeekPlan: pilot.deep.weeks.map((action, index) => ({ week: index + 1, action, completionCheck: index === 3 ? "能完整说明问题、方法、结果、局限与本人贡献。" : "保留本周实际产出与至少一项未解决的问题。" })),
    exitConditions: pilot.deep.exits,
    missingForPublication: deepSource?.missing ?? ["尚待补入并核验真实公开优秀作品或代表题的逐项拆解", "尚待将官方评分依据映射到案例证据", "尚待真实人工内容审核，不能标记已发布L3"]
  };
}

const migratedRecords = competitions.flatMap(competition => {
  const base = migrateSeries(competition);
  const pilot = pilotContents.find(item => item.seriesId === competition.id);
  const tracks = competition.recommendation.tracks ?? [];
  const migrated = tracks.length ? tracks.map(track => migrateLegacyTrack(base, competition, track)) : [base];
  if (pilot) {
    const pilotRecord = migrated.find(record => record.track.id === pilot.trackId) ?? (!tracks.length ? migrated[0] : undefined);
    if (pilotRecord) applyPilot(pilotRecord, pilot);
    else { const extra = structuredClone(base); applyPilot(extra, pilot); migrated.push(extra); }
  }
  return migrated;
});

function researchedRecord(content: ResearchedContent): DecisionCompetitionRecord {
  const existing = competitions.find(competition => competition.id === content.seriesId);
  const record: DecisionCompetitionRecord = existing ? migrateSeries(existing) : {
    schemaVersion: "saitu.competition.v2", catalogVersion: DECISION_CATALOG_VERSION,
    recordId: `${content.seriesId}:${content.trackId}:v2`, seriesId: content.seriesId, name: content.name,
    aliases: content.aliases, organizer: content.organizer, edition: content.edition,
    track: { id: content.trackId, name: content.trackName }, group: content.group, scope: content.scope,
    taskFamily: content.taskFamily, subjectTags: [], summary: content.task, pilot: false,
    contentTier: "L1", targetTier: content.deepCase ? "L3" : "L2",
    review: { status: "draft", reviewerIds: [], reviewedAt: null },
    registration: { status: content.registrationStatus, checkedAt: null, factIds: [], note: content.registrationNote },
    sources: [], facts: [], sections: Object.fromEntries(DECISION_MODULES.map(module => [module, [unknown(`尚无支持${module}的适用原文，暂不作事实承诺。`)]])) as Record<DecisionModule, DecisionClaim[]>,
    roles: [], valueDimensions: [], difficulty: [], skills: [], interests: [], preferredOutputs: [], experienceSignals: [],
    suitability: { goodFit: [], poorFit: [], uncertainties: [] },
    sevenDayTrial: { action: "", output: "", completionCheck: "", reflection: "" },
    schoolPolicyReminder: "请按本人学校、学院及当前年度政策核实认定；赛事名称不保证学校加分或招聘结果。",
    publication: { mode: "conditional_exploration", productionReady: false, blockers: [] },
    migration: { origin: content.origin, originalSeriesId: content.seriesId, originalCheckedAt: null, note: "依据本轮实际读取的主办方原文建档；AI双审与人工审核分别留痕。" }
  };
  applyPilot(record, content);
  record.facts.push(...authoredEligibilityFacts(content));
  record.pilot = false;
  record.review.authorAgentId = content.authorAgentId ?? "/root/audit_catalog";
  record.targetTier = content.deepCase ? "L3" : "L2";
  record.name = content.name;
  record.organizer = content.organizer;
  record.group = content.group;
  record.subjectDomains = content.subjectDomains;
  record.eligibilityRules = content.eligibilityRules ?? [];
  record.identity = { editionId: content.editionId, trackId: content.trackId, groupId: content.groupId, scopeId: content.scopeId, stageIds: [], supersedesRecordIds: [], legacyRecordIds: [] };
  record.registration = { status: content.registrationStatus, checkedAt: content.sources[0]?.checkedAt ?? null, factIds: [], note: content.registrationNote };
  record.milestones = content.milestones ?? [];
  if (content.deepCase) record.deepDive = structuredClone(content.deepCase);
  isolateResearchedLegacyReferences(record);
  return record;
}

const additionalRecords = researchedContents.map(researchedRecord);
const authoredRecords = [...migratedRecords, ...additionalRecords].map(input => {
  const record = bindRecordIdentity(input);
  const reviews = (reviewLedger as Record<string, DecisionCompetitionRecord["review"]["aiReviews"]>)[record.recordId];
  if (reviews) record.review.aiReviews = structuredClone(reviews);
  if (hasDualAiReview(record)) {
    record.review.status = "ai_dual_reviewed";
    if (record.deepDive && !record.deepDive.missingForPublication.length) record.deepDive.status = "reviewed";
  }
  const validation = validateDecisionRecord(record);
  record.contentTier = validation.tier;
  record.publication = { mode: validation.recommendationMode, policy: record.review.policy, productionReady: !validation.issues.some(issue => ["L1", "L2", "publication"].includes(issue.blocks)), humanPolicyReady: hasHumanReview(record) && ["L2", "L3"].includes(validation.tier), aiPolicyReady: hasDualAiReview(record) && ["L2", "L3"].includes(validation.tier), blockers: validation.issues.filter(issue => issue.blocks !== "L3" || record.targetTier === "L3").map(issue => `${issue.code}: ${issue.message}`) };
  return record;
});

const selectedSnapshot = activeSnapshot as CatalogSnapshot | null;
if (selectedSnapshot) {
  const assessment = checkSnapshot(selectedSnapshot, selectedSnapshot.records);
  if (!assessment.valid) throw new Error(`Active catalog snapshot rejected: ${assessment.errors.join(", ")}`);
}
function currentCatalog() {
  const snapshot = readRuntimeCatalogSnapshot(authoredRecords) ?? selectedSnapshot;
  return { records: snapshot?.records ?? authoredRecords, version: snapshot?.snapshotId ?? DECISION_CATALOG_VERSION };
}
/** Maintenance builds a candidate from source content even while an older snapshot is active. */
export function getAuthoredDecisionCatalog(): DecisionCompetitionRecord[] { return structuredClone(authoredRecords); }

/** Returns independent records so callers cannot accidentally change a published snapshot. */
export function getDecisionCatalog(): DecisionCompetitionRecord[] { return structuredClone(currentCatalog().records); }
export function getDecisionRecordsForSeries(seriesId: string): DecisionCompetitionRecord[] { return structuredClone(currentCatalog().records.filter(record => record.seriesId === seriesId)); }
export function getDecisionRecord(id: string): DecisionCompetitionRecord | undefined {
  const { records } = currentCatalog();
  const exact = records.find(item => item.recordId === id || item.identity?.legacyRecordIds.includes(id));
  const record = exact ?? records.filter(item => item.seriesId === id).sort((a,b) => Number(b.pilot) - Number(a.pilot) || Number(b.contentTier.slice(1)) - Number(a.contentTier.slice(1)))[0];
  return record ? structuredClone(record) : undefined;
}
export function getCoverageProfiles() { return structuredClone(coverageProfiles); }
export function getExpansionCandidates(): ExpansionCandidate[] {
  const published = new Set(currentCatalog().records.filter(record => record.publication.productionReady).map(record => record.seriesId));
  const candidates = structuredClone(expansionCandidates) as ExpansionCandidate[];
  return candidates.map(candidate => ({...candidate, publishable: candidate.verificationStatus === "verified" &&
    candidate.existingSeriesId !== null && published.has(candidate.existingSeriesId)}));
}
export function getCatalogSummary() {
  const { records, version } = currentCatalog();
  const tiers = { L0: 0, L1: 0, L2: 0, L3: 0 };
  records.forEach(record => tiers[record.contentTier]++);
  const priorities = getExpansionCandidates();
  const series = new Set(records.map(record => record.seriesId));
  const decisionSeries = new Set(records.filter(record => ["L2", "L3"].includes(record.contentTier)).map(record => record.seriesId));
  const publishedSeries = new Set(records.filter(record => record.publication.productionReady).map(record => record.seriesId));
  const mappedPriorities = priorities.filter(candidate => candidate.existingSeriesId && series.has(candidate.existingSeriesId));
  return {
    catalogVersion: version, seriesCount: new Set(records.map(record => record.seriesId)).size,
    recordCount: records.length, pilotCount: records.filter(record => record.pilot).length,
    legacySeriesCount: competitions.length,
    legacyTrackCount: competitions.reduce((sum, competition) => sum + (competition.recommendation.tracks?.length ?? 0), 0),
    migratedLegacyTrackCount: records.filter(record => record.migration.legacyTrack).length,
    editionCount: new Set(records.map(record => `${record.seriesId}:${record.identity?.editionId}`)).size,
    decisionReadySeriesCount: new Set(records.filter(record => ["L2", "L3"].includes(record.contentTier)).map(record => record.seriesId)).size,
    deepReadySeriesCount: new Set(records.filter(record => record.contentTier === "L3").map(record => record.seriesId)).size,
    verifiedExpansionCount: new Set(records.filter(record => record.migration.origin === "verified_expansion" && ["L2", "L3"].includes(record.contentTier)).map(record => record.seriesId)).size,
    tiers, deepDiveDrafts: records.filter(record => record.deepDive?.status === "draft").length,
    productionReadyCount: records.filter(record => record.publication.productionReady).length,
    coverageProfileCount: coverageProfiles.length, expansionCandidateCount: expansionCandidates.length,
    // The full expansion pool is larger than the original twenty P1 candidates.
    // Count mapped candidate identities, never records/editions or all new series.
    priorityCandidates: {
      total: priorities.length,
      mapped: mappedPriorities.length,
      unmapped: priorities.length - mappedPriorities.length,
      structuralL2OrL3: mappedPriorities.filter(candidate => decisionSeries.has(candidate.existingSeriesId!)).length,
      published: mappedPriorities.filter(candidate => publishedSeries.has(candidate.existingSeriesId!)).length,
      byVerificationStatus: Object.fromEntries(["pending", "partial", "verified", "rejected", "merged"].map(status =>
        [status, priorities.filter(candidate => candidate.verificationStatus === status).length]))
    },
    publishedExpansionCount: new Set(records.filter(record => record.migration.origin === "verified_expansion" && record.publication.productionReady).map(record => record.seriesId)).size,
    pendingAiReviewCount: records.filter(record => !hasDualAiReview(record)).length,
    pendingHumanReviewCount: records.filter(record => !hasHumanReview(record)).length
  };
}
