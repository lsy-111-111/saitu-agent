import type { CatalogFact, DecisionCompetitionRecord } from "../v6/catalog-types";
import type { DecisionContextV6 } from "../v6/engine";
import { isDecisionEvidenceFact } from "../v6/evidence";
import { compactCandidateEvidence } from "../v6/model-evidence-pack";
import { compactMatchingTables } from "../v6/model-match-tables";
import { matchReasonAnchorFactsV7 } from "./reason-anchor";
import { rankTaskFocusOptionsV7 } from "./role-task-practice";

const matchingModules = new Set(["task", "track", "participation", "deliverables", "rubric", "skills", "investment", "difficulty", "benefits", "value"]);
const matchingField = /^(?:task|track|participation|deliverables?|rubric|skills?|investment|difficulty|benefits?|value|cost|fee|team|mentor|laboratory|equipment|attendance|weeklyHours)(?:[.:]|$)/i;
const participationFields = new Set(["teamSize", "sameInstitutionTeam", "sameCountryTeam", "mentor", "language", "equipment"]);
const rankTaskField = /^(?:task|track|deliverables?)(?:[.:]|$)/i;
const rankTopicField = /^(?:task|track)(?:[.:]|$)/i;
const rankOutputField = /^deliverables?(?:[.:]|$)/i;
const rubricField = /^rubric(?:[.:]|$)/i;
const isAdditionalTaskFactV754 = (fact: CatalogFact) =>
  fact.kind === "official_fact" && rubricField.test(fact.field)
  || fact.kind === "participant_report" && /^material(?:[.:]|$)/i.test(fact.field);

const taskEvidencePatterns = [
  /读入|标准(?:输入|输出)|输出(?:[一二两三四五六七八九十\d]+(?:个|行|项|类|份)|删除数|最大|最小|合法|是否)|仅删除|保序|不(?:得|能)重排|非负|归一化|按角色顺序/u,
  /运行(?:所交|提交的)?(?:程序|算法)|给出(?:完整|可论证的)解答|现场识别|实时通路|(?:现场|首次|在比赛中)建图|能量集成|HAZOP/iu,
  /(?:检查|检验|测量|核查|验证|测试|复现|保留|比较)(?:所交|所提交|提交的|给定|实际|指定)?(?:源码|程序|算法|模型|数据|频谱|电路|功耗|图形|目标|实验结果|装配位姿|误差|不确定度|输出)/u,
  /(?:用|结合)(?:其|所交|所提交|提交的)?(?:源码|频谱|RTL|实测数据)(?:成功)?(?:验证|复现|互证)|(?:频谱|波形|实测数据|RTL)(?:与|和|及)(?:频谱|波形|实测数据|RTL)(?:互证|对照验证)|(?:用|使用)(?:其|实际)?(?:测量|观测)(?:数据|结果)?(?:构建|开发|校验|验证)模型/iu,
  /(?:形成性|总结性)(?:评量|评价)|(?:评量|评价)(?:须|必须)与目标相关|(?:须|需|必须)(?:一节|一堂)\d+\s*分钟教案|(?:检验|验证)(?:及|与|和)局限(?:性)?(?:须|必须|要)(?:清楚|说明|披露)|(?:等式|公式|矩阵)变换|代入(?:端点|初值|边界条件)|(?:无|没有|未经)(?:证明|验证)(?:的)?(?:例子|结论|断言|样例)/u,
  /(?:要求|必须|须)证明[^，,。；;]{0,30}(?:方程|函数|矩阵|序列|实数解|不等式)|(?:断言|结论)(?:必须|须|需要)(?:给出)?证明|针对(?:其|该)?(?:论证|证据|实验|模型)(?:质疑|反驳|核验)/u,
  /(?:任务|项目|工序)(?:在|仅在)[^，。；]{0,24}(?:空闲|可用|就绪)[^，。；]{0,8}(?:开始|执行)|(?:位姿|装配位置)[^，。；]{0,20}(?:判定|认定)(?:成功|有效)/u,
  /(?:订单|交易额|交易记录)[^，。；]{0,16}(?:须|必须)(?:已)?完成|(?:扩产|批量生产)[^，。；]{0,20}成本依据/u,
  /(?:试验|测试|测量|控制|程序|运行|算法|样本|用例|单点|输入|输出|误差|内存|延迟|采样率|响应用时|完成时点|停止运行|停(?:车|留))[^，,。；;]{0,20}(?:上限|下限|阈值|至多|至少|不超过|不得超过|不高于|恰为|低于|高于|\d+(?:\.\d+)?\s*(?:毫秒|秒|天|厘米|毫米|兆字节|MiB|GiB|MB))/iu,
  /(?:数量|个数|频率|采样率|耗时|距离)(?:乘以?|除以)[^，,。；;]{1,30}(?:数量|个数|频率|采样率|耗时|距离)(?:作为|为)(?:核心|评测|性能)?指标|^\d+(?:\.\d+)?\s*(?:秒|毫秒)\s*\d+\s*(?:KiB|MiB|GiB|MB|GB)$/iu,
  /(?:实机|样机|实物|原型|模型|报告|实测数据)(?:必须|须|应|需)与[^，,。；;]{1,24}(?:构型|工艺|图纸|数据|结果|方案|实物|实机|实况)[^，,。；;]{0,10}(?:相符|一致|对应)|(?:装置|仪器|系统)(?:及|和|与)?(?:系统|测量)?误差/u,
  /(?:作品|程序|应用|项目)(?:必须|须|应|需)(?:可|能)(?:全程)?离线(?:运行|评审|演示|使用)|可运行(?:的)?(?:代码|程序|源码|源文件)|(?:规则|任务|命题|题目)(?:明确)?要求(?:使用|采用)\s*[A-Za-z][A-Za-z0-9._+-]*\d[A-Za-z0-9._+-]*/u,
  /(?:任务|项目|命题|作品)(?:必须|须|应|需)(?:含|包括|开展|进行|完成)[^，,。；;]{0,20}(?:定量调查|实地采样|对照试验|实物测量)|分析[^，,。；;]{0,18}(?:真实操作[^，,。；;]{0,6}案例|全周期[^，,。；;]{0,6}数据)|(?:注明日期的(?:价格建议|目标价格|估值结果)|(?:价格建议|目标价格|估值结果)(?:必须|须|应|需)注明日期)/u,
  /(?:产出|生成|输出)[一二两三四五六七八九十\d]+(?:张|份|项|行)(?:结果表|校验结果)|可(?:拆卸?|更换|调整)(?:的)?(?:外壳|护罩|模块|接口|部件)|(?:装货|装载|行驶|运行|装配)(?:及|与|和)(?:装货|装载|行驶|运行|装配)测试/u,
  /(?:效果|成效|性能)(?:评估|评测)(?:是|为)(?:可选|备选)(?:加分)?(?:功能|任务)|(?:必备项|必做项|必选功能)(?:和|与|及)(?:可选|附加)[^，,。；;]{0,10}(?:必须|须|应|需)分别(?:演示|验证|证明)/u,
  /(?:编写|撰写|另写)(?:本队|团队|自编)(?:的)?案例|脱稿(?:朗诵|演讲)|要求(?:普通话|发音)(?:准确|清晰)/u,
];
const scoreAllocation = /^[\p{L}\s（）()]+(?:各|占|满分)?\d+(?:\.\d+)?(?:分|%|％)$/u;
const taskAcrossClauses = [
  /(?:输入|读入)[^，,。；;\n]{2,60}[，,]\s*(?:并)?(?:输出|返回|求出)[^，,。；;\n]{0,56}(?:次数|方案|序列|路径|最优解|校验结果|控制量)/u,
  /现场[^。；;\n]{0,20}检测[^。；;\n]{0,20}(?:对照|比较|比)[^。；;\n]{0,8}平均(?:耗时|响应时间)/u,
  /(?:实物|原型|样机)演示[^。\n]{0,28}现场(?:讲解(?:和|与|及))?演示|(?:实物|原型|样机)[^。；;\n]{0,25}功能(?:视频|展示|演示)|制作(?:及|与|和)(?:实际)?功能[，、,]\s*现场(?:讲解|演示|运行|验证)/u,
  /装配[^。；;\n]{0,20}(?:子系统|部件|装配件)的?(?:代码|图纸|模型)[^。；;\n]{0,24}(?:测试|检验|验证)证据/u,
  /运行(?:另)?按(?:标记|语音|距离|能耗|耗能|充电)\d+[，、,](?:标记|语音|距离|能耗|耗能|充电)\d+[^。；;\n]{0,18}评分|(?:运输|运载|装载)[^。；;\n]{0,32}(?:载质比|载重比|载荷效率)/u,
];

const roleBoundDeliverableActions = [
  {
    source: /创作示例[^。；;\n]{0,65}(?:\d+|[一二三四五六七八九十]+)(?:幅|件)静态(?:作品|内容)/u,
    task: /(?:安排|编排|创作|组织|制作)[^，,。；;\n]{0,24}静态(?:内容|作品)[^，,。；;\n]{0,12}(?:叙事|系列)/u,
  },
  {
    source: /(?:项目|研究)网站(?:须|应|用于)?记录(?:项目)?目标[，、,](?:数据|证据)(?:与|和|及)(?:结果|发现)/u,
    task: /(?:组织|编写|整理|维护|呈现|记录)[^，,。；;\n]{0,20}(?:项目|研究)?网站/u,
  },
  {
    source: /(?:建模内容|模型说明)(?:须|应|必须|需)在指定(?:model|模型)页面(?:清楚|清晰|完整)?说明/iu,
    task: /(?:组织|整理|编写|制作|呈现)[^，,。；;\n]{0,20}(?:可追溯|模型)(?:网页|页面)/u,
  },
];

/** A rubric or deliverable can describe a task operation or a measurable check.
 * Formatting, entry conditions and scoring weights remain contextual evidence. */
function hasConcreteTaskEvidence(fact: CatalogFact): boolean {
  if (taskAcrossClauses.some(pattern => pattern.test(fact.text))) return true;
  return fact.text.split(/[，,。；;、：:\n]+/u).some(clause => {
    const text = clause.trim();
    if (scoreAllocation.test(text) && !/须|要求|仅|否则|若|才能|成功|通过|计分/u.test(text)) return false;
    return taskEvidencePatterns.some(pattern => pattern.test(text));
  });
}

function supportsRoleDeliverable(record: DecisionCompetitionRecord, fact: CatalogFact): boolean {
  return rankOutputField.test(fact.field) && roleBoundDeliverableActions.some(({ source, task }) =>
    source.test(fact.text) && record.roles.some(role => task.test(role.task)));
}

type RankFact = Pick<CatalogFact, "id" | "field" | "text"> & { scopeParts: string[]; usable: boolean };
export type RankEvidenceV7 = Record<string, Record<string, RankFact[]>>;

/** Metadata is inherited from ordinary kind/status object keys. The fact body,
 * ID and scope are unchanged; this is grouping, never a text summary. */
function evidencePacket(record: DecisionCompetitionRecord, referenced: ReadonlySet<string>): RankEvidenceV7 {
  const result: RankEvidenceV7 = {};
  for (const fact of record.facts) {
    if (!referenced.has(fact.id) && !(matchingField.test(fact.field) && isDecisionEvidenceFact(record, fact))) continue;
    const statuses = result[fact.kind] ??= {};
    const facts = statuses[fact.status] ??= [];
    const boundScopes = fact.sourceScopes?.map(value => value.scope);
    // Canonical multi-source scopes are joined with this exact delimiter.
    // Exposing the same source scopes as a list lets exact repeated document
    // boundaries share the ordinary text dictionary. An atypical scope stays
    // one untouched string; no scope is inferred or shortened.
    const scopeParts = boundScopes?.length && boundScopes.join("；") === fact.scope ? boundScopes : [fact.scope];
    facts.push({ id: fact.id, field: fact.field, text: fact.text, scopeParts, usable: isDecisionEvidenceFact(record, fact) });
  }
  return result;
}

/** Exact offline expansion for checking the fact closure; not an output parser. */
export function expandRankEvidenceV7(evidence: RankEvidenceV7) {
  return Object.entries(evidence).flatMap(([kind, statuses]) => Object.entries(statuses).flatMap(([status, facts]) => facts.map(({ scopeParts, ...fact }) => ({ ...fact, scope: scopeParts.join("；"), kind, status }))));
}

/** Original v7.54 choice set for reading or verifying already stored bindings. */
export function rankTaskFactsV754(record: DecisionCompetitionRecord): CatalogFact[] {
  const anchors = matchReasonAnchorFactsV7(record);
  return [...anchors.filter(fact => rankTaskField.test(fact.field)), ...anchors.filter(isAdditionalTaskFactV754)];
}

export function rankTaskFactsV7(record: DecisionCompetitionRecord): CatalogFact[] {
  return rankTaskFactsV754(record).filter(fact =>
    rankTopicField.test(fact.field) || fact.kind === "participant_report"
    || (rankOutputField.test(fact.field) || rubricField.test(fact.field)) && hasConcreteTaskEvidence(fact)
    || supportsRoleDeliverable(record, fact));
}

function matchingClaims(record: DecisionCompetitionRecord) {
  return Object.entries(record.sections).filter(([module]) => matchingModules.has(module)).flatMap(([module, claims]) => claims.map(value => ({ module, ...value })));
}

function unknownClaims(record: DecisionCompetitionRecord) {
  const grouped = new Map<string, { modules: string[]; text: string; reason: string | null; conditions: string[]; factIds: string[] }>();
  for (const { module, text, kind, unknownReason, conditions, factIds } of matchingClaims(record)) {
    if (kind !== "unknown") continue;
    const reason = unknownReason && unknownReason !== text ? unknownReason : null;
    const key = JSON.stringify({ text, reason, conditions, factIds });
    const existing = grouped.get(key);
    if (existing) existing.modules.push(module);
    else grouped.set(key, { modules: [module], text, reason, conditions: [...conditions], factIds: [...factIds] });
  }
  return [...grouped.values()];
}

/** C receives every admitted candidate and every usable task/skill/output/input
 * fact. References from capabilities, official claim boundaries, cost and
 * participation inputs add their original facts to the same closure, including an
 * explicit unusable flag for unresolved references. No score or profile is
 * consulted. Preparation advice, proof questions and award commentary remain
 * in the selected-record explanation packet. */
export function rankingCandidatesV7(context: DecisionContextV6) {
  return context.candidates.map(({ record }) => {
    const claims = matchingClaims(record);
    const bounds = (record.eligibilityRules ?? []).filter(rule => participationFields.has(rule.field));
    const referenced = new Set([
      ...record.roles.flatMap(role => role.factIds),
      ...claims.filter(value => value.kind === "official_fact" || value.kind === "unknown").flatMap(value => value.factIds),
      ...(record.cost?.factIds ?? []),
      ...Object.values(record.participationRequirements ?? {}).flatMap(value => value.factIds),
    ]);
    const evidence = evidencePacket(record, referenced);
    const cost = record.cost;
    const verifiedCost = Boolean(cost?.factIds.length && cost.factIds.every(id => record.facts.some(fact => fact.id === id && fact.kind === "official_fact" && fact.status === "verified_current" && fact.scope === cost.scope && isDecisionEvidenceFact(record, fact))));
    return {
      itemId: record.recordId, seriesId: record.seriesId, name: record.name,
      edition: record.edition, track: record.track.name, group: record.group, scope: record.scope,
      taskFamily: record.taskFamily, taskEvidence: evidence,
      // All capability paths are retained. Choosing just the first learnable
      // role would hide a second, more demanding path from an experienced user.
      editorialRoleCapabilities: record.roles.map(({ name, task, skills, prerequisite, factIds }) => ({ name, task, skills: [...skills], prerequisite, factIds: [...factIds] })),
      editorialOutputForms: [...record.preferredOutputs],
      officialClaimBoundaries: claims.filter(value => value.kind === "official_fact" && (value.conditions.length || !value.factIds.some(id => record.facts.some(fact => fact.id === id && fact.text === value.text))))
        .map(({ module, text, factIds, conditions }) => ({ module, text, factIds: [...factIds], conditions: [...conditions] })),
      unknowns: unknownClaims(record),
      personalCost: cost ? { ...cost, factIds: [...cost.factIds], verifiedCurrent: verifiedCost } : null,
      participationRequirements: record.participationRequirements ?? null,
      // Typed task/resource limits retain their exact value, note and evidence
      // scope/status. Their long population/registration paragraphs are not
      // needed to compare tasks and remain untouched in the explain registry.
      participationBounds: bounds.map(({ field, operator, value, note, factIds }) => ({ field, operator, value, note,
        evidence: factIds.map(id => {
          const fact = record.facts.find(value => value.id === id);
          return fact ? { id, kind: fact.kind, status: fact.status, scope: fact.scope, usable: fact.kind === "official_fact" && isDecisionEvidenceFact(record, fact) }
            : { id, kind: "unknown", status: "unknown", scope: record.scope, usable: false };
        }),
        verified: Boolean(factIds.length && factIds.every(id => record.facts.some(fact => fact.id === id && fact.kind === "official_fact" && isDecisionEvidenceFact(record, fact)))) })),
    };
  });
}

/** User-specific conditions follow the stable catalog body in the prompt. The
 * entire condition is retained even if it mentions both a date and a resource. */
export function rankingConditionsV7(context: DecisionContextV6) {
  const groups = new Map<string, string[]>();
  for (const { record, conditions } of context.candidates) for (const text of new Set(conditions)) {
    const itemIds = groups.get(text);
    if (itemIds) itemIds.push(record.recordId);
    else groups.set(text, [record.recordId]);
  }
  return [...groups].map(([text, itemIds]) => ({ text, itemIds }));
}

export const RANK_CANDIDATE_BOUNDARIES_PROMPT_V7 = "按itemId将任务卡与candidateBoundaries.items的同项资源、费用、参与条件、来源限制及未知对照。candidateBoundaries.candidateConditions只适用于各行itemIds。若有candidateBoundaries.candidateDefaults.unknowns，未单列unknowns的同项边界继承这组完整未知条件。";
export const RANK_WIRE_DEFAULTS_PROMPT_V763 = "省略的supportingTaskFacts、participationBounds、officialClaimBoundaries和resources行内conditions均为空数组；省略的personalCost和participationRequirements均为null。空值不表示免费、无需条件或满足条件。";

type WireRow = Record<string, unknown>;
const wireRow = (value: unknown): value is WireRow => Boolean(value && typeof value === "object" && !Array.isArray(value));
const wireBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");

/** Rank only: ordinary arrays and $text tables have the same existing decoder.
 * Replace a single-column wrapper only when its ordinary array is smaller. */
function shortenRankTextTables(value: unknown): unknown {
  if (!wireRow(value) || !wireRow(value.tableSchemas)) return value;
  const schemas = value.tableSchemas;
  const visit = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(visit);
    if (!wireRow(item)) return item;
    const next = Object.fromEntries(Object.entries(item).map(([key, child]) => [key, visit(child)]));
    if (Object.keys(next).length === 2 && typeof next.$table === "string" &&
        JSON.stringify(schemas[next.$table]) === '["$text"]' && Array.isArray(next.rows) &&
        next.rows.every(row => Array.isArray(row) && row.length === 1)) {
      const ordinary = next.rows.map(row => ({ $text: (row as unknown[])[0] }));
      if (wireBytes(ordinary) < wireBytes(next)) return ordinary;
    }
    return next;
  };
  return { ...value, candidates: visit(value.candidates) };
}

/** Called explicitly on rank's identifier-encoded payload, before transport
 * packing. Existing rankingCandidates/Conditions and other stages are unchanged.
 * Shared defaults contain literal rows, never references to the candidate-only
 * evidence dictionary; the entire unknowns column must be exactly identical. */
export function compactRankInputV7(value: unknown): unknown {
  const ordinary = compactMatchingTables(compactCandidateEvidence(value));
  if (!wireRow(value) || !Array.isArray(value.candidates) || !value.candidates.length ||
      !value.candidates.every(wireRow)) return ordinary;
  let input = value;
  const unknowns = value.candidates[0].unknowns;
  if (!Object.hasOwn(value, "candidateDefaults") && Array.isArray(unknowns) &&
      value.candidates.every(candidate => Object.hasOwn(candidate, "unknowns") && JSON.stringify(candidate.unknowns) === JSON.stringify(unknowns))) {
    input = { candidateDefaults: { unknowns: structuredClone(unknowns) }, ...value,
      candidates: value.candidates.map(({ unknowns: _shared, ...candidate }) => candidate) };
  }
  const compact = shortenRankTextTables(compactMatchingTables(compactCandidateEvidence(input)));
  return wireBytes(compact) < wireBytes(ordinary) ? compact : ordinary;
}

/** Rank does not cite facts. Keep tasks directly readable instead of making
 * the model decode evidence IDs/tables. Rubric text is always kept verbatim:
 * score paragraphs can also carry real mechanisms, dimensions and limits. */
export function rankingTaskTextV7(field: string, text: string): string {
  if (field !== "participation") return text;
  return (text.match(/[^。；;]+[。；;]?/g) ?? [text]).filter(clause => {
    if (/任务|源文件|要求|必须|须|需|不得|禁止|不接受|独立|输入|输出|答案|字符|删除|保序|证明|运行|程序|算法|数据|模型|装置|设备|平台|资源|语言|英语|英文|中文|人工|自动|制作|制造|实现|控制|测量|误差|时限|延迟|功率|载重|实名|权限|许可|导师|教师|队外|网络|互联网|学生负责|角色分配|无效|失败/.test(clause)) return true;
    return !/报名|注册|选拔|推荐|遴选|初审|初选|晋级|复赛|决赛|国赛|校赛|省赛/.test(clause);
  }).join("");
}

/** The record scope supplies edition/task identity. Keep every explicit source,
 * permission or uncertainty restriction; reading/publishing governance stays in
 * the unchanged full registry used by review and the final report. */
export function rankingLearningBoundaryV7(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  return (text.match(/[^。；;]+[。；;]?/g) ?? [text])
    .filter(clause => /(?:仅|只|须|需|不得|禁止|不给|不提供|不进行|不开展|不能|未取得|未获得|没有|许可|授权|伦理|招募|条件|离线|脱机|断电|不适用|不外推)/.test(clause))
    .filter(clause => !/不(?:声称|宣称|保证|承诺)|不冒充|研究草稿|审阅|审查|奖项|获奖/.test(clause) || /数据|实验|采集|测试|设备|资源|许可|授权|伦理|招募|离线|脱机|断电/.test(clause)).join("");
}

export function rankingTaskConditionV7(text: string): string {
  return (text.match(/[^。；;]+[。；;]?/g) ?? [text]).filter(clause => {
    if (/费用|收费|费率|金额|开销|花费|成本|支出|预算|汇率|设备|硬件|软件|资源|实验|仪器|场地|材料|数据|代码|程序|算法|模型|采样|许可|授权|隐私|安全|伦理|队外|独立|实测|验证|证明|解法|误差|操作/.test(clause)) return true;
    return !/报名|资格|名额|届|赛程|停办|奖项|获奖|背书|评奖|审阅|审查|研究草稿|作者后续|学校认定|企业招聘|升学作用/.test(clause);
  }).join("");
}

export function rankingTaskConditionsV7(context: DecisionContextV6) {
  const groups = new Map<string, string[]>();
  for (const { record, conditions } of context.candidates) for (const text of new Set(conditions.map(rankingTaskConditionV7).filter(Boolean))) {
    const ids = groups.get(text); if (ids) ids.push(record.recordId); else groups.set(text, [record.recordId]);
  }
  return [...groups].map(([text, itemIds]) => ({ text, itemIds }));
}

export function readableRankingCandidatesV7(context: DecisionContextV6) {
  return rankingCandidatesV7(context).map((candidate, index) => {
    const record = context.candidates[index].record;
    const groups = new Map<string, { kind: string; status: string; usable: boolean; text: string[] }>();
    for (const [kind, statuses] of Object.entries(candidate.taskEvidence)) for (const [status, facts] of Object.entries(statuses)) for (const fact of facts) {
      const text = rankingTaskTextV7(fact.field, fact.text); if (!text) continue;
      const key = JSON.stringify([kind, status, fact.usable]);
      let group = groups.get(key);
      if (!group) groups.set(key, group = { kind, status, usable: fact.usable, text: [] });
      group.text.push(`${fact.field}: ${text}`);
    }
    const { factIds: _costFactIds, ...cost } = candidate.personalCost ?? {};
    return {
      itemId: candidate.itemId, seriesId: candidate.seriesId, name: candidate.name,
      edition: candidate.edition, track: candidate.track, scope: candidate.scope,
      taskContext: [...groups.values()],
      editorialRoles: candidate.editorialRoleCapabilities.map(role => `${role.name}：${role.task}（${role.prerequisite}）`),
      editorialSkills: [...new Set(candidate.editorialRoleCapabilities.flatMap(role => role.skills))],
      editorialOutputs: candidate.editorialOutputForms,
      editorialLearning: record.deepDive ? { task: record.deepDive.representativeTask,
        origin: record.deepDive.workedExample.origin, sourceBoundary: rankingLearningBoundaryV7(record.deepDive.workedExample.sourceBoundary),
        methods: [...new Set(record.deepDive.rolePaths.flatMap(path => path.steps))].filter(step => !candidate.editorialRoleCapabilities.some(role => role.task === step)) } : null,
      officialClaimBoundaries: candidate.officialClaimBoundaries.map(({ factIds: _ids, ...boundary }) => boundary),
      unknowns: candidate.unknowns.map(({ factIds: _ids, ...unknown }) => unknown),
      personalCost: candidate.personalCost ? cost : null,
      participationRequirements: candidate.participationRequirements,
      participationBounds: candidate.participationBounds.filter(bound => !["teamSize", "sameInstitutionTeam", "sameCountryTeam"].includes(bound.field)).map(({ evidence, ...bound }) => ({ ...bound,
        evidenceStatus: [...new Set(evidence.map(value => `${value.kind}/${value.status}/usable=${value.usable}`))] })),
    };
  });
}

/** One direct full-pool comparison needs the actual task and contribution paths,
 * not every scoring table or worked-example step. These are verbatim existing
 * catalog values; the complete evidence registry is unchanged for explanation
 * and review. A fact with an explicit task/resource prohibition remains whole. */
export function compactRankingCandidatesV7(context: DecisionContextV6) {
  const original = rankingCandidatesV7(context);
  return readableRankingCandidatesV7(context).map((row, index) => {
    const record = context.candidates[index].record;
    const rankFacts = rankTaskFactsV7(record);
    const anchors = new Set(rankFacts.map(fact => fact.id));
    const taskGroups = new Map<string, { kind: string; status: string; usable: boolean; scope: string; text: string[]; factIds: (string | null)[] }>();
    const contextualRubrics: { module: string; text: string; conditions: string[]; scope: string; status: string }[] = [];
    type Resource = { text: string; kind: string; status?: string; usable?: boolean; scope?: string; conditions: string[]; unknownReason?: string };
    const resources: Resource[] = [];
    for (const [kind, statuses] of Object.entries(original[index].taskEvidence)) for (const [status, facts] of Object.entries(statuses)) for (const fact of facts) {
      if (rankTaskField.test(fact.field)) {
        const scope = fact.scopeParts.join("；");
        const key = JSON.stringify([kind, status, fact.usable, scope]);
        let group = taskGroups.get(key);
        if (!group) taskGroups.set(key, group = { kind, status, usable: fact.usable, scope, text: [], factIds: [] });
        group.text.push(`${fact.field}: ${fact.text}`);
        group.factIds.push(anchors.has(fact.id) ? fact.id : null);
      }
      if (kind === "official_fact" && rubricField.test(fact.field) && !anchors.has(fact.id)) {
        contextualRubrics.push({ module: "rubric", text: fact.text, conditions: [], scope: fact.scopeParts.join("；"), status });
      }
      if (!/^(?:investment|fee|cost|equipment|laboratory|mentor|attendance|weeklyHours)(?:[:.]|$)/.test(fact.field)) continue;
      resources.push({ text: fact.text, kind, status, usable: fact.usable, scope: fact.scopeParts.join("；"), conditions: [] });
    }
    for (const section of record.sections.investment) {
      // Same-owner exact copies add their conditions to the existing statement.
      // A common unknown already appears verbatim in unknowns/shared defaults.
      if (section.kind === "unknown" && row.unknowns.some(unknown => unknown.text === section.text
        && JSON.stringify(unknown.conditions) === JSON.stringify(section.conditions)
        && (!section.unknownReason || section.unknownReason === section.text || unknown.reason === section.unknownReason))) continue;
      const existing = resources.find(value => value.kind === section.kind && value.text === section.text);
      if (existing) {
        existing.conditions = [...new Set([...existing.conditions, ...section.conditions])];
        if (section.unknownReason) existing.unknownReason = section.unknownReason;
      } else resources.push({ text: section.text, kind: section.kind, conditions: [...section.conditions], ...(section.unknownReason ? { unknownReason: section.unknownReason } : {}) });
    }
    const taskFacts = [...taskGroups.values()];
    const claimBoundaries = row.officialClaimBoundaries.filter(boundary =>
      boundary.conditions.length || !taskFacts.some(group => group.text.some(text => text.slice(text.indexOf(": ") + 2) === boundary.text)));
    return { itemId: row.itemId, seriesId: row.seriesId, scope: row.scope, theme: row.track,
      task: row.editorialLearning ? { text: row.editorialLearning.task, origin: row.editorialLearning.origin }
        : { text: taskFacts.flatMap(group => group.text).join("\n"), origin: "catalog_task_facts" },
      officialTask: taskFacts,
      supportingTaskFacts: rankFacts.filter(isAdditionalTaskFactV754).map(({ id, field, kind, status, scope, text }) => ({ id, field, kind, status, scope, text })),
      contributions: record.roles.map(({ name, task, personalDeliverable, prerequisite }, roleIndex) =>
        ({ roleIndex, name, task, personalDeliverable, prerequisite, taskSteps: rankTaskFocusOptionsV7(task).slice(1) })),
      methods: row.editorialLearning?.methods ?? [],
      resources, personalCost: row.personalCost, participationRequirements: row.participationRequirements, participationBounds: row.participationBounds,
      sourceBoundary: record.deepDive?.workedExample.sourceBoundary ?? null,
      unknowns: row.unknowns,
      officialClaimBoundaries: [...claimBoundaries, ...contextualRubrics.filter(rubric =>
        !claimBoundaries.some(boundary => boundary.module === rubric.module && boundary.text === rubric.text))] };
  });
}

/** Keep task cards and their full boundaries in candidate order. The same
 * itemId binds each pair, and common unknowns retain their literal text. */
export function readableRankInputV7(context: DecisionContextV6) {
  const rows = compactRankingCandidatesV7(context);
  const sharedUnknowns = rows[0]?.unknowns;
  const candidateDefaults = sharedUnknowns && rows.every(row => JSON.stringify(row.unknowns) === JSON.stringify(sharedUnknowns))
    ? { unknowns: sharedUnknowns } : undefined;
  const split = rows.map(({ resources, personalCost, participationRequirements, participationBounds, sourceBoundary, unknowns, officialClaimBoundaries, ...card }) => {
    const { supportingTaskFacts: _emptyFacts, ...cardWithoutSupportingFacts } = card;
    return {
      card: card.supportingTaskFacts.length ? card : cardWithoutSupportingFacts,
      boundary: {
        itemId: card.itemId,
        resources: resources.map(resource => {
          if (resource.conditions.length) return resource;
          const { conditions: _emptyConditions, ...rest } = resource;
          return rest;
        }),
        ...(personalCost === null ? {} : { personalCost }),
        ...(participationRequirements === null ? {} : { participationRequirements }),
        ...(participationBounds.length ? { participationBounds } : {}),
        sourceBoundary,
        ...(candidateDefaults ? {} : { unknowns }),
        ...(officialClaimBoundaries.length ? { officialClaimBoundaries } : {}),
      },
    };
  });
  return {
    candidates: split.map(({ card }) => card),
    candidateBoundaries: {
      ...(candidateDefaults ? { candidateDefaults } : {}),
      candidateConditions: rankingConditionsV7(context),
      items: split.map(({ boundary }) => boundary),
    },
  };
}
