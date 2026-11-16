import { randomUUID } from "node:crypto";
import type { CompetitionRecommendationProfileV5 } from "@/types/competition-recommendation";
import type { StudentProfileV6 } from "../v6/contracts";
import type { ProfileMutation } from "../v6/profile-contracts";
import { applyProfileMutationsV7, isUnchangedProfileClauseV7 } from "./profile";

export type ExplicitCorrectionResultV7 =
  | { kind: "applied"; profile: StudentProfileV6; mutations: ProfileMutation[]; message: string }
  | { kind: "clarification" | "none" | "semantic"; profile: StudentProfileV6; mutations: []; message: string };

export function splitProfileClausesV7(text: string): string[] {
  return text.split(/[。；;\n，,]|(?:但是|但(?!是)|并且|而且|同时|另外|此外|以及|且)/u).map(clause => clause.trim()).filter(Boolean);
}
/** Presentation markers are not part of a fact's meaning. Stored quotations
 * stay untouched; this form is used only for dispatch and coverage comparison. */
export function profileClauseContentV7(clause: string): string {
  return clause.trim().replace(/^(?:更正|纠正|修改|更新|补充|说明|明确)[^：:，,。；;\n]{0,40}[：:]\s*/u, "").replace(/[。；;.!！]+$/u, "").trim();
}
export function isProfileOperationClauseV7(clause: string): boolean {
  const text = profileClauseContentV7(clause);
  if (/[？?“”「」"']|^(?:如果|假如|假设)/u.test(text)) return false;
  const inputs = "(?:(?:其他|其余|已有|现有|当前)(?:的)?)?(?:确认|经历|事实|自述|陈述|主要目标|目标|文档名称|输入|档案|信息|条件|内容)";
  if (new RegExp(`^(?:我|我们)?(?:目前|现在|本轮|这次)?(?:只|仅)(?:确认|保留|沿用)${inputs}(?:和${inputs})*$`, "u").test(text)) return true;
  if (new RegExp(`^(?:并|也)?(?:请)?(?:不|不要|无需)(?:新增|增加|补充|改变|更改|变更)(?:任何|新的|已保留的)?${inputs}$`, "u").test(text)) return true;
  // A request to avoid inventing unprovided attributes is an answer constraint,
  // not a new negative fact about the student's experience or resources.
  if (/^(?:请)?(?:不要|别)(?:假设|推断|编造|补充)(?:(?:我|本人)(?:有|具备|拥有))?(?:我)?(?:没(?:有)?提(?:过|及)|未(?:提及|提供|陈述)|没有提供)(?:过)?的(?:经历|能力|技能|资源|资格)$/u.test(text)) return true;
  if (new RegExp(`^(?:并|也)?(?:我)?(?:没有|没|未)(?:撤回|撤销|删除)(?:关于)?${inputs}(?:和${inputs})*(?:的)?(?:陈述|自述|信息)?$`, "u").test(text)) return true;
  if (/^(?:请)?(?:重复|沿用|保留)(?:上一条|上条|前一条|刚才|上述|之前|原先|当前).*(?:要求|边界|条件|说明)$/u.test(text)) return true;
  return new RegExp(`^${inputs}(?:稍后|以后|下次)(?:再说|再填|再补充|再决定)$`, "u").test(text);
}
export function isLiteralProfileScopeClauseV7(clause: string): boolean {
  return /^(?:(?:这里|此处|这|此|上述内容|该项)(?:所指的?)?)?(?:只是|仅是|只作为|仅作为|纯粹是)(?:一个)?[\p{L}\p{N}_-]{0,24}(?:名称|名字|标题|标签|代号|称呼|昵称|编号)(?:而已)?$/u.test(profileClauseContentV7(clause));
}
export function isQuotedProfileContextOnlyV7(text: string): boolean {
  const match = text.trim().match(/^([^。；;\n“”「」"']{1,200})[：:](?:“[^”]+”|「[^」]+」|"[^"]+")[。.!！]?$/u);
  if (!match?.[1]) return false;
  return /^(?:下面|以下|这里|这段|上述|此处)?(?:是|为)?(?:引用|引号|引语|旧笔记)/u.test(match[1])
    && /(?:不是|不代表|不作为|不等于)(?:(?:我|本人|现在|当前|本轮)(?:的)?)*(?:更正|事实|自述|经历|陈述)/u.test(match[1]);
}
export function isProfileControlClauseV7(clause: string): boolean {
  if (isProfileOperationClauseV7(clause)) return true;
  if (isUnchangedProfileClauseV7(clause)) return true;
  const existingField = "(?:(?:最早|之前|原有|已有|现有|当前|目前)(?:那项|这项|的)?)*(?:文档名称|文档信息|主要目标|参赛目标|目标|条件|输入|内容|信息)";
  if (new RegExp(`^(?:(?:请|并)?保留${existingField}|${existingField}(?:和${existingField})*(?:都)?保留)[！!。.]?$`, "u").test(clause)) return true;
  return /^(?:更正|纠正|修改|更新|补充|说明)(?:一下)?[：:]?$|^(?:刚才|之前|我)?(?:填错|说错)(?:了)?$|^(?:其他|其余)(?:条件|输入|内容|信息)?(?:保持)?不变[！!。.]?$|^(?:请)?重新匹配[！!。.]?$|^(?:谢谢|多谢|好的|好|嗯|收到|明白了)[！!。.]?$/u.test(clause);
}
export function isProfileSummaryClauseV7(clause: string): boolean {
  return /^(?:请|帮我|替我|给我|只|仅|先|麻烦)*(?:(?:总结|汇总|梳理|概括)(?:一下)?(?:我|这份|当前|目前|现有|上述|上面)|(?:沿用|按|根据|基于).*(?:总结|汇总|梳理|概括))/u.test(clause.trim());
}
export function isChatQuestionClauseV7(clause: string): boolean {
  if (isProfileSummaryClauseV7(clause)) return true;
  // An embedded question can describe an unknown input rather than ask us to
  // resolve it: “我还不确定设备能否借到。” Preserve that statement for extraction.
  if (!/[？?]|吗[！!。.]?$/u.test(clause)
    && /^(?:我|我们)?(?:目前|现在|还|仍|也|暂时|尚)*(?:不确定|不清楚|不知道|未确定|没有确定|没确定)/u.test(clause)) return false;
  const restriction = /只能|仅限|不得|禁止|不允许|不愿|必须|不接受|限于/.test(clause);
  if (restriction && /^(?:请按|请采用|请考虑|请以|按我|采用)/.test(clause)) return false;
  if (/更正|纠正|修改|更新|撤销|撤回|改成|改为/.test(clause) && !/[？?]|为什么|怎么|如何|是否|能否/.test(clause)) return false;
  if (/[？?]|为什么|为何|怎么|怎样|如何|是否|能否|什么|哪(?:个|项|些|种)|吗[！!。.]?$/u.test(clause)) return true;
  if (restriction) return false;
  return /(?:比较|对比).*(?:区别|两|几|项)|^(?:下一步|具体任务|推荐理由|介绍|比较|对比|推荐|看看|帮我|请|能不能|可不可以)/u.test(clause);
}

const number = String.raw`-?\d+(?:\.\d+)?`;
const timePattern = new RegExp(String.raw`^(?:我)?(?:每周|一周|周投入|周时间)(?:的)?(?:时间)?(?:能稳定投入|可以投入|能够投入|可投入|能投入|只能投入|投入|只有|只能|能|可)?(?:(?:从)?${number}小时(?:改为|改成|调整为|调整到))?(?<value>${number})小时$`);
const budgetPattern = new RegExp(String.raw`^(?<scope>我的个人|我个人的|我个人|个人的|个人|我的|我|全队的|全队|团队的|团队总|团队|队伍总|队伍|我们的|我们)?(?:总)?(?:预算|自付上限|支出上限)(?:总额|上限)?(?:是|为|改为|改成|调整为|最多|只有|只能|不超过)?(?:(?:从)?${number}(?:元|块)(?:改为|改成|调整为))?(?<value>${number})(?:元|块)(?:以内)?$`);
const skillNames: readonly [RegExp, string][] = [
  [/编程|软件开发|Python|JavaScript|代码/i, "programming"], [/数据分析|统计分析|建模/, "data-analysis"],
  [/调研|科研/, "research"], [/产品策划|需求分析/, "product"], [/结构设计|工程制图/, "structural-design"],
  [/设计|绘图|视觉设计/, "design"], [/硬件|电路/, "hardware"], [/写作|材料整理/, "writing"],
  [/演讲|路演|答辩/, "presentation"], [/实验|实验操作/, "laboratory"], [/财会|金融分析/, "accounting-finance"],
  [/政策分析|案例研判/, "policy-analysis"], [/语言表达|跨文化|跨文化沟通/, "language"], [/野外调查|测绘|田野|田野实践/, "fieldwork"],
];
/** Narrow literal self-withdrawal only. Every clause must be recognized before
 * applying one atomic batch; tutorial exposure is never promoted into a skill. */
function literalSkillWithdrawalV7(current: StudentProfileV6["facts"], text: string): ProfileMutation[] | null {
  if (/[？?“”「」"']|如果|假如|假设|将来|未来|以后|后续|计划|打算|可能|大概|也许|只要|除非|据说|传闻|队友|朋友|同学|老师|别人|他们|她们|他说|她说/u.test(text)) return null;
  const clauses = splitProfileClausesV7(text);
  const withdrawal = clauses[0]?.match(/^我(?:撤回|撤销|删除|收回)(?:之前|原先|先前|刚才|此前)?(?:我)?(?:会|能|擅长|掌握)?(.+?)(?:能力|技能)?(?:的)?(?:自述|陈述|回答)$/u);
  if (!withdrawal) return null;
  const skillValue = (name: string) => skillNames.find(([pattern]) => new RegExp("^(?:" + pattern.source + ")$", pattern.flags).test(name))?.[1];
  const values = withdrawal[1].split(/和|与|及|、/u).map(skillValue);
  if (!values.length || values.some(value => !value) || new Set(values).size !== 1) return null;
  const selected = current.filter(fact => fact.field === "skills" && fact.value === values[0] && fact.confirmed && fact.state === "affirmed"
    && ["self_report", "concrete_experience"].includes(fact.evidenceLevel));
  if (selected.length !== 1) return null;
  const mutations: ProfileMutation[] = [{ operation: "retract", field: "skills", targetFactIds: [selected[0].id], quote: clauses[0] }];
  for (const quote of clauses.slice(1)) {
    if (isProfileControlClauseV7(quote)) continue;
    const content = quote.replace(/^(?:其实|实际上)/u, "");
    const exposure = content.match(/^我(?:只是|只)(看过|读过|听过)(教程|教材|资料|教学视频|演示|课程)(?:而已)?$/u);
    const negative = content.match(/^(?:我)?(?:没有|没|未)(自己|独立)((?:写|编写|制作|开发|完成|操作|实施|做)过(?:程序|代码|软件|作品|实验|项目|设备|任务))$/u);
    const assumption = content.match(/^(?:请)?(?:不要|别)(?:再)?(?:把我)?(?:当作|视为)((?:已经|已有|具备|有)(.+?)(?:能力|技能))(?:了)?$/u);
    if (exposure) mutations.push({ operation: "set", field: "selfReport.exposure", value: content.slice(1), state: "affirmed", targetFactIds: [], quote });
    else if (negative && (content.startsWith("我") || negative[1] === "自己")) mutations.push({ operation: "set", field: "selfReport.independentExecution", value: negative[1] + negative[2], state: "negated", targetFactIds: [], quote });
    else if (assumption && skillValue(assumption[2]) === values[0]) mutations.push({ operation: "set", field: "selfReport.abilityAssumption", value: assumption[1], state: "negated", targetFactIds: [], quote });
    else return null;
  }
  return mutations;
}

/** An explicit correction can bind one current experience, never an inferred skill. */
function literalContributionCorrectionV7(current: StudentProfileV6["facts"], text: string): ProfileMutation[] | null {
  if (/[？?“”「」"']|如果|假如|假设|将来|未来|以后|计划|打算|可能|大概|也许|据说|传闻|(?:队友|朋友|同学|老师|他|她|别人)说|另一|其他项目|别的经历|不同项目|第[一二三\d]/u.test(text)) return null;
  const clauses = splitProfileClausesV7(text), lead = /^(?:更正|纠正|修改|更新)(?:一下)?[：:]\s*/u;
  if (!lead.test(clauses[0] ?? "")) return null;
  const otherQuote = clauses[0].replace(lead, ""), other = otherQuote.match(/^(.+?)(?:都)?(?:是(?:由)?|由)(?:队友|其他成员|其他队员|同组同学)(?:做|完成)(?:的|了)$/u);
  const own = clauses[1]?.match(/^(?:我本人|我自己|本人|我)((?:只|仅)(?:帮忙|协助|辅助)(?:整理|收集|汇总|记录|核对|校对|标注|排版|抄录)(?:资料|材料|文档|文件|数据|记录|图片|表格|参考文献))$/u);
  const withdrawal = clauses[2]?.match(/^(?:请)?(?:撤回|撤销|删除|收回)我(?:本人)?独立完成(.+?)(?:的)?(?:说法|自述|陈述|回答)$/u);
  if (!other || !own || !withdrawal || clauses.slice(3).some(clause => !/^(?:(?:请)?重新匹配|谢谢|多谢|好的|好|嗯|收到|明白了)[！!。.]?$/u.test(clause))) return null;
  const activities = other[1].split(/和|与|及|、/u), withdrawn = withdrawal[1].split(/和|与|及|、|或/u);
  if (!activities.length || activities.length > 3 || activities.some(action => !/^[\p{L}\p{M}]{2,20}$/u.test(action)
    || /我|你|他|她|们|说|项目|阶段|以前|之前|那次|或者/u.test(action)) || new Set(activities).size !== activities.length
    || JSON.stringify([...activities].sort()) !== JSON.stringify([...withdrawn].sort())) return null;
  const inactive = new Set(current.flatMap(fact => fact.supersedesFactIds ?? []));
  const tasks = current.filter(fact => /^experience\.\d+\.task$/u.test(fact.field) && !inactive.has(fact.id));
  if (tasks.length !== 1) return null;
  const task = tasks[0], field = task.field.replace(/\.task$/u, ".contribution");
  const roles = current.filter(fact => fact.field === field && !inactive.has(fact.id));
  if (!task.confirmed || task.state !== "affirmed" || !task.answerId || !task.originalText
    || !activities.some(action => task.originalText!.includes(action)) || roles.length !== 1) return null;
  const role = roles[0];
  if (!role.confirmed || role.state !== "affirmed" || role.value !== "independent" || role.answerId !== task.answerId
    || !["self_report", "concrete_experience"].includes(task.evidenceLevel) || !["self_report", "concrete_experience"].includes(role.evidenceLevel)) return null;
  return [
    { operation: "set", field: "other.reportedWork", value: otherQuote, state: "affirmed", targetFactIds: [], quote: otherQuote },
    { operation: "set", field: task.field, value: own[1], state: "affirmed", targetFactIds: [task.id], quote: clauses[1] },
    { operation: "set", field: role.field, value: "assisted", state: "affirmed", targetFactIds: [role.id], quote: clauses[1] },
  ];
}

const goals = new Map<string, string>([
  ["项目经历", "project"], ["积累项目经历", "project"], ["作品", "portfolio"], ["作品集", "portfolio"], ["积累可展示作品", "portfolio"],
  ["就业", "employment"], ["实习", "employment"], ["实习就业", "employment"], ["探索实习就业", "employment"],
  ["研究", "postgraduate"], ["科研", "postgraduate"], ["升学", "postgraduate"], ["深造", "postgraduate"],
  ["奖项", "award"], ["获奖", "award"], ["争取奖项", "award"], ["创业", "entrepreneurship"], ["实践创业想法", "entrepreneurship"],
  ["探索", "explore"], ["探索方向", "explore"], ["探索适合自己的方向", "explore"],
  ["练习能力", "skill"], ["练习具体能力", "skill"], ["提升能力", "skill"], ["能力训练", "skill"],
]);

/** Only whole, simple standard clauses take the no-model path. Any remaining
 * content is delegated once as a complete utterance, before changing state. */
export function applyExplicitCorrectionV7(profile: StudentProfileV6, text: string, legacy: CompetitionRecommendationProfileV5 | undefined,
  options: { answerId?: string; at?: string } = {}): ExplicitCorrectionResultV7 {
  const result = (kind: "none" | "semantic" | "clarification", message = ""): ExplicitCorrectionResultV7 => ({ kind, profile, mutations: [], message });
  if (!text.trim() || text.length > 1600) return result("none");
  if (/如果|假如|假设|将来|计划|打算|队友说|朋友说|同学说|老师说|他说|她说|别人说|据说|传闻|[“”「」]/.test(text)) return result("none");
  const current = profile.facts.filter(fact => fact.state !== "retracted" && !profile.retractedFactIds.includes(fact.id));
  const budgetClauses = splitProfileClausesV7(text);
  const budgetHead = budgetClauses[0]?.replace(/^(?:更正|纠正|修改|更新)(?:一下)?[：:]?/u, "").trim() ?? "";
  const ownBudget = "(?:我的(?:个人)?|我个人的?|本人(?:的)?(?:个人)?)";
  const personalWithdrawal = new RegExp("^(?:我)?(?:撤回|撤销|删除|收回)" + ownBudget + "(?:总)?预算(?:总额|上限|限制|的自述|的陈述|的回答)?$", "u").test(budgetHead);
  if (personalWithdrawal || new RegExp("^" + ownBudget + "(?:总)?预算", "u").test(budgetHead)) {
    if (/[？?“”「」"']|可能|大概|也许|左右|或者|还是|全队|团队|队伍|朋友|同学|老师|别人|他说|她说/u.test(text)) return result("semantic");
    const previous = current.filter(fact => fact.field === "budget.maximumYuan" && fact.confirmed && fact.state === "affirmed" && typeof fact.value === "number");
    if (previous.length > 1 || personalWithdrawal && previous.length !== 1) return result("semantic");
    const parsedBudget = budgetPattern.exec(budgetHead.replace(/^本人(?:的)?(?:个人)?/u, "我个人"));
    const amount = Number(parsedBudget?.groups?.value);
    if (!personalWithdrawal && (!parsedBudget || !/(?:元|块)(?:以内)?$/u.test(budgetHead)
      || (budgetHead.match(/-?\d+(?:\.\d+)?/gu)?.length ?? 0) !== 1 || !Number.isFinite(amount) || amount < 0 || amount > 1_000_000)) return result("semantic");
    let deniedPrevious = false;
    for (const clause of budgetClauses.slice(1)) {
      if (isProfileControlClauseV7(clause)) continue;
      const denied = new RegExp(String.raw`^(?:不是|并非)(?<amount>${number})(?:元|块)$`, "u").exec(clause);
      const rematch = new RegExp(String.raw`^(?:请)?(?:按|以|用)(?<amount>${number})(?:元|块)(?:的)?(?:个人)?(?:总预算|预算上限|预算)?重新匹配$`, "u").exec(clause);
      if (!personalWithdrawal && denied && previous.length === 1 && !deniedPrevious && Number(denied.groups!.amount) === previous[0].value && Number(denied.groups!.amount) !== amount) { deniedPrevious = true; continue; }
      if (!personalWithdrawal && rematch && Number(rematch.groups!.amount) === amount) continue;
      return result("semantic");
    }
    const buckets = personalWithdrawal && legacy?.decisionContext?.budget?.scope === "personal"
      ? current.filter(fact => fact.field === "budget" && fact.confirmed && fact.state === "affirmed") : [];
    if (buckets.length > 1) return result("semantic");
    const changes: ProfileMutation[] = personalWithdrawal
      ? [...previous, ...buckets].map(fact => ({ operation: "retract", field: fact.field, targetFactIds: [fact.id], quote: text }))
      : [{ operation: "set", field: "budget.maximumYuan", value: amount, state: "affirmed", targetFactIds: previous.map(fact => fact.id), quote: text }];
    const next = applyProfileMutationsV7(profile, changes, { answerId: options.answerId ?? randomUUID(), text, at: options.at ?? new Date().toISOString() }, legacy);
    return { kind: "applied", profile: next, mutations: changes, message: "已采用这次更正，正在按更新后的条件重新匹配。" };
  }
  const contribution = literalContributionCorrectionV7(current, text);
  if (contribution) {
    const next = applyProfileMutationsV7(profile, contribution, { answerId: options.answerId ?? randomUUID(), text, at: options.at ?? new Date().toISOString() }, legacy);
    return { kind: "applied", profile: next, mutations: contribution, message: "已采用这次更正，正在按更新后的条件重新匹配。" };
  }
  const literal = literalSkillWithdrawalV7(current, text);
  if (literal) {
    const next = applyProfileMutationsV7(profile, literal, { answerId: options.answerId ?? randomUUID(), text, at: options.at ?? new Date().toISOString() }, legacy);
    return { kind: "applied", profile: next, mutations: literal, message: "已采用这次更正，正在按更新后的条件重新匹配。" };
  }
  const set = (field: string, value: string | number | boolean, state: ProfileMutation["state"] = "affirmed", exact?: string): ProfileMutation => ({ operation: "set", field, value, state, quote: text,
    targetFactIds: current.filter(fact => fact.field === field && (exact === undefined || String(fact.value) === exact)).map(fact => fact.id) });
  const retract = (fields: string[]): ProfileMutation[] => current.filter(fact => fields.includes(fact.field)).map(fact => ({ operation: "retract", field: fact.field, targetFactIds: [fact.id], quote: text }));
  const mutations: ProfileMutation[] = [];
  let unparsed = false;
  for (const original of splitProfileClausesV7(text)) {
    if (isProfileControlClauseV7(original) || isChatQuestionClauseV7(original)) continue;
    const clause = original.replace(/^(?:更正|纠正|修改|更新)(?:一下)?[：:]?/, "").replace(/^(?:其实|实际上)/, "").trim();
    const time = timePattern.exec(clause), budget = budgetPattern.exec(clause);
    const hoursMentioned = /每周|一周|周时间|周投入/.test(clause) && /小时/.test(clause);
    const budgetMentioned = /预算|自付|自费|支出/.test(clause) && /\d/.test(clause);
    const alternatives = /还是|或者|或是|不确定|大概|可能|左右|\d\s*(?:[-–—~～]|到|至|或)\s*\d/.test(clause);
    if (hoursMentioned && !time && alternatives) return result("clarification", "这次每周可投入的时间还不明确，请给出要采用的小时数。");
    if (budgetMentioned && !budget && alternatives) return result("clarification", "请给出这次要采用的预算上限。");
    if (time) {
      const hours = Number(time.groups!.value);
      if (hours < 0 || hours > 168) return result("clarification", "请给出每周可投入的小时数，范围为 0 至 168 小时。");
      mutations.push(set("weeklyHours", hours), set("weeklyCommitment", hours < 5 ? "under-5" : hours <= 10 ? "5-10" : "over-10"));
      continue;
    }
    if (budget) {
      const amount = Number(budget.groups!.value), scope = budget.groups!.scope ?? "";
      if (amount < 0 || amount > 1_000_000) return result("clarification", "请给出明确的预算上限，例如 100 元。");
      const field = /全队|团队|队伍|我们/.test(scope) ? "budget.teamMaximumYuan" : /我|个人/.test(scope) || legacy?.decisionContext?.budget?.scope === "personal" ? "budget.maximumYuan" : "budget.unspecifiedMaximumYuan";
      mutations.push(set(field, amount)); continue;
    }
    if (/^(?:我)?(?:不(?:愿|能|想)?自费|不花钱)$/.test(clause)) { mutations.push(set("budget.maximumYuan", 0)); continue; }
    const withdrawal = clause.match(/^(?:撤回|撤销|删除|收回)(?:我的?)?(预算限制|预算|每周时间|每周投入|时间自述|时间限制)$/);
    if (withdrawal) {
      if (/预算/u.test(withdrawal[1])) return result("semantic");
      const selected = retract(["weeklyHours", "weeklyCommitment"]);
      if (!selected.length) { unparsed = true; continue; }
      mutations.push(...selected); continue;
    }
    const skill = clause.match(/^(?:我)?(?:已经|现在|目前)?(只会|会|能|擅长|掌握|不会|不擅长)(?:做)?(.+?)(?:了)?$/);
    const withdrawnSkill = clause.match(/^(?:撤回|撤销|删除|收回)(.+?)(?:能力|技能)?(?:的)?(?:自述|陈述)$/);
    if (skill || withdrawnSkill) {
      const names = (skill?.[2] ?? withdrawnSkill![1]).split(/和|与|及|、/).filter(Boolean);
      const values = names.map(name => skillNames.find(([pattern]) => new RegExp(`^(?:${pattern.source})$`, pattern.flags).test(name))?.[1]);
      if (!values.length || values.some(value => !value)) { unparsed = true; continue; }
      for (const value of new Set(values as string[])) {
        if (withdrawnSkill) {
          const selected = current.filter(fact => fact.field === "skills" && fact.value === value);
          if (!selected.length) { unparsed = true; continue; }
          mutations.push({ operation: "retract", field: "skills", targetFactIds: selected.map(fact => fact.id), quote: text });
        } else mutations.push(set("skills", value, /不会|不擅长/.test(skill![1]) ? "negated" : "affirmed", value));
      }
      continue;
    }
    if (/^(?:我)?(?:目前|现在|已经)?(?:没有队友|独自准备|独自参赛|有队友|找到队友|有稳定队伍)$/.test(clause)) {
      mutations.push(set("teamStatus", /没有|独自/.test(clause) ? "solo" : "ready")); continue;
    }
    const goal = clause.match(/^(?:我的?|本轮|这次)?(?:最重要的)?(?:目标|优先目标|优先|更想|更希望)(?:是|为|改为|改成|调整为)?(.+)$/);
    if (goal) {
      const value = goals.get(goal[1]);
      if (!value) { unparsed = true; continue; }
      mutations.push(set("goalIntent", value), set("goalResolution", "confirmed")); continue;
    }
    const experience = clause.match(/^(撤回|撤销|删除|收回)(第一|第二|第1|第2)(?:段)?经历$/);
    if (experience) {
      const index = /第二|第2/.test(experience[2]) ? "2" : "1";
      const selected = retract([`experience.${index}.task`]);
      if (!selected.length) { unparsed = true; continue; }
      mutations.push(...selected); continue;
    }
    unparsed = true;
  }
  if (unparsed) return result("semantic");
  if (!mutations.length) return /^(?:更正|纠正|修改|更新|撤销|撤回)[：:]?$/.test(text.trim()) ? result("clarification", "请说明要更正的具体条件和新值。") : result("none");
  const resolved = [...new Map(mutations.map(mutation => [mutation.field === "skills" ? `${mutation.field}:${String(mutation.value ?? mutation.targetFactIds.join(","))}` : mutation.field, mutation])).values()];
  const next = applyProfileMutationsV7(profile, resolved, { answerId: options.answerId ?? randomUUID(), text, at: options.at ?? new Date().toISOString() }, legacy);
  return { kind: "applied", profile: next, mutations: resolved, message: "已采用这次更正，正在按更新后的条件重新匹配。" };
}
