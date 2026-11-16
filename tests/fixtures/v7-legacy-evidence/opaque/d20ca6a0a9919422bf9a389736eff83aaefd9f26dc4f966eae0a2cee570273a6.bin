import type { DecisionCompetitionRecord } from "./catalog-types";
import type { StudentFactV6, StudentProfileV6 } from "./contracts";

const skills: Record<string, RegExp> = {
  programming: /编程|编写.{0,12}(?:程序|代码|软件|脚本|工具)|(?:开发|实现|调试).{0,12}(?:功能|程序|网页|软件|脚本)|(?:python|javascript).{0,8}(?:代码|脚本|编写|调试)|工具开发/i,
  "data-analysis": /数据|统计|建模|清洗|分析问卷|问卷.*整理|整理.*问卷/,
  design: /设计|插画|海报|视觉|交互|排版/,
  writing: /写作|撰写|文章|文案|编辑|写.{0,12}报告/,
  presentation: /演讲|汇报|讲解|主持|展示|答辩/,
  hardware: /硬件|电路|焊接|单片机|机器人/,
  laboratory: /实验|试剂|测量|化学|培养/,
  fieldwork: /访谈|调研|问卷|调查|走访/,
  language: /翻译|英语|外语|口译/,
  "accounting-finance": /财务|会计|成本|预算|财报/,
  "policy-analysis": /政策|法律|治理|公共事务/,
  "structural-design": /结构|机械|桥梁|建造/,
};
const familySkills: Record<string, string[]> = {
  "software-algorithms": ["programming"], "data-modeling": ["data-analysis"],
  "visual-interaction": ["design"], "language-communication": ["language", "writing", "presentation"],
  "investigation": ["fieldwork", "data-analysis", "policy-analysis"],
  "experimental-research": ["laboratory"], "engineering-prototype": ["hardware", "structural-design"],
  "business-practice": ["accounting-finance", "policy-analysis"], "teaching-service": ["presentation", "language"],
};
const affirmativeActions: Record<string, RegExp> = {
  programming: /^(?:(?:用|使用)?(?:python|javascript|java|c\+\+|c#)(?:语言)?(?:进行)?)?(?:编程|编写|写|开发|实现|调试|维护|优化)/i,
  "data-analysis": /^(?:清洗|整理|分析|统计|建模|处理|可视化|做(?=(?:了|过)?(?:统计|数据)分析)|数据(?:清洗|统计|整理|分析)|问卷(?:整理|分析)|(?:用|使用).{0,12}(?:清洗|整理|分析|统计|建模))/u,
  design: /^(?:设计|绘制|制作|排版|插画|海报设计|视觉设计)/u,
  writing: /^(?:写|撰写|编辑|起草|修改)/u,
  presentation: /^(?:演讲|汇报|讲解|主持|展示|答辩|准备.{0,5}(?:汇报|演讲))/u,
  hardware: /^(?:设计|焊接|搭建|制作|调试|连接|实现|开发)/u,
  laboratory: /^(?:做|进行|开展|设计|操作|测量|培养|配置|记录)/u,
  fieldwork: /^(?:访谈|调研|调查|走访|收集|发放|设计.{0,5}问卷)/u,
  language: /^(?:翻译|口译|(?:用|使用).{0,8}(?:翻译|讲解|写|撰写|演讲))/u,
  "accounting-finance": /^(?:编制|计算|整理|分析|核算|审计|记账|做|进行)/u,
  "policy-analysis": /^(?:分析|调研|撰写|研究|比较|梳理)/u,
  "structural-design": /^(?:设计|搭建|建造|制作|建模|测算|绘制)/u,
};
// Require the action's whole object, not just a skill noun somewhere inside a
// proposition. For example, "编写了程序的说法是假的" ends in a statement about
// a claim; it is not a completed personal action with a program as its object.
const actionObjects: Record<string, RegExp> = {
  programming: /(?:程序|代码|软件|脚本|工具|功能|网页|网站|应用|模块|接口|算法|系统)$/u,
  "data-analysis": /(?:数据|问卷|统计|分析|模型|图表|字段|需求说明|分析报告|统计报告)$/u,
  design: /(?:海报|封面|界面|图标|插画|视觉|交互|排版|版式|图案|原型|信息层级|设计稿)$/u,
  writing: /(?:报告|文章|文案|笔记|说明|论文|稿件|提纲|材料|文档|教程|心得|观后感|读后感)$/u,
  presentation: /(?:演讲|汇报|讲解|展示|答辩|活动|会议|成果|项目|方案|课程)$/u,
  hardware: /(?:硬件|电路|单片机|机器人|设备|原型|模块|电源|传感器)$/u,
  laboratory: /(?:实验|试剂|样品|浓度|温度|数据|结果|培养基|溶液|测量|实验记录)$/u,
  fieldwork: /(?:问卷|访谈|调研|调查|社区|学校|用户|需求|现场|样本|受访者|访谈记录)$/u,
  language: /(?:文章|报告|论文|文案|字幕|材料|文档|说明|内容|稿件|演讲|口译)$/u,
  "accounting-finance": /(?:财务|会计|成本|预算|财报|账目|报表|收入|支出|账务|财务分析)$/u,
  "policy-analysis": /(?:政策|法律|治理|公共事务|报告|条文|法规|案例|影响)$/u,
  "structural-design": /(?:结构|机械|桥梁|建筑|原型|模型|图纸|载荷|工程)$/u,
};
const standaloneActions = /^(?:编程|演讲|汇报|讲解|主持|展示|答辩|口译|建模|记账|数据(?:清洗|统计|整理|分析)|问卷(?:整理|分析)|海报设计|视觉设计)$/u;
function completeActionSkills(clause: string, requireSkillMention = true): string[] {
  const observationalObject = /学习笔记|课程笔记|听课笔记|观看|听讲|讲座|演示视频|教学视频|课件|教程|心得|观后感|读后感/u;
  return Object.entries(skills).filter(([skill, pattern]) => {
    const action = affirmativeActions[skill].exec(clause);
    if (!action || (requireSkillMention && !pattern.test(clause))) return false;
    if (skill !== "writing" && skill !== "design" && observationalObject.test(clause)) return false;
    const object = clause.slice(action[0].length).replace(/^(?:了|过|着)?\s*/u, "");
    // A noun phrase naming somebody's claim (or containing another assertion)
    // cannot be reinterpreted as the object of the student's technical action.
    if (/说法|说辞|传闻|传言|断言|指控|这件事|这句话|认为|以为|声称|意味着|是假的|是真的|[“”‘’"']/u.test(object)) return false;
    return object ? actionObjects[skill].test(object) : standaloneActions.test(clause);
  }).map(([skill]) => skill);
}
const selfSubject = /^(?:我(?:本人)?|本人)(?!们|的)/u;
const actionModifiers = /^(?:只(?:是)?|仅|独立|协助|主导|负责|完成(?:了)?|实际上?|曾经?|已经?|亲自|\s)+/u;
const uncertainAssertion = /不|没|未|并非|计划|打算|希望|将来|想要|看过|了解过|观摩|旁观|介绍|宣传|讲述|由.+(?:完成|负责)|[？?]|假设|如果|是否|能否|吗|么|呢|难道|何曾|何尝|谁说|以为|误会|听说|声称|说我|说本人/u;
function coordinatedActionSkills(text: string, requireSkillMention = true): string[] {
  const action = text.replace(selfSubject, "").replace(actionModifiers, "").trim();
  const extracted = action.split(/并(?:且)?|然后|随后|接着/u).map(part => completeActionSkills(part.trim(), requireSkillMention));
  return extracted.every(found => found.length > 0) ? extracted.flat() : [];
}
export function experienceTextSkills(task: string): string[] {
  const thirdParty = /团队|我们|组员|同学|队友|导师|老师|别人|他们|她们|他人|有人|某人/u;
  const mixedOwnership = thirdParty.test(task);
  const clauses = task.match(/[^，,；;。！？!?\n]+[，,；;。！？!?\n]?/gu) ?? [];
  // Keep provisional action groups until all clauses have been scoped. A full
  // stop starts a new group but does not make the previous one irrevocable.
  const groups: string[][] = [];
  let latestGroup: number | undefined;
  let startGroup = true;
  const disputedSkills = new Set<string>();
  let localUncertainClaim = false;
  let uncertainScope = false;
  let scopedPersonalClaim = false;
  let nonassertiveFrame = false;
  let quoteDepth = 0;
  let straightQuote = false;
  for (const clause of clauses) {
    const text = clause.trim().replace(/[，,；;。！？!?\n]$/u, "").trim();
    let quoted = quoteDepth > 0 || straightQuote;
    for (const char of clause) {
      if (/[“‘「『]/u.test(char)) { quoteDepth++; quoted = true; }
      else if (/[”’」』]/u.test(char)) { quoteDepth = Math.max(0, quoteDepth - 1); quoted = true; }
      else if (char === '"' || char === "'") { straightQuote = !straightQuote; quoted = true; }
    }
    const scoped = text.replace(/^(?:(?:实际上?|事实上|其实|而)\s*)/u, "");
    const deniedAction = scoped.replace(/^(?:我(?:本人)?|本人)?(?:并没有|没有|并未|未曾|未|没|不曾|不)/u, "");
    // Negative scopes may name an action with less redundant wording ("写代码"
    // rather than "编写程序"). This structural parse only removes evidence;
    // it cannot create affirmative skills.
    const deniedSkills = deniedAction !== scoped ? coordinatedActionSkills(deniedAction, false) : [];
    const questionAction = scoped.replace(/(?:吗|么|呢)$/u, "");
    const questionSkills = selfSubject.test(scoped) && (questionAction !== scoped || /[？?]$/u.test(clause))
      ? coordinatedActionSkills(questionAction) : [];
    const localUncertainty = !quoted && !uncertainScope && !nonassertiveFrame
      && (deniedSkills.length > 0 || questionSkills.length > 0
        || (localUncertainClaim && /^(?:没有|并没有|不是|并非)$/u.test(text)));
    if (!quoted && (/假设|如果|是否|能否|难道|何曾|何尝|谁说/u.test(text)
      || (!localUncertainty && /^(?:不是|并非|没有|并没有)(?:说)?$/u.test(text)))) nonassertiveFrame = true;
    const self = selfSubject.test(scoped);
    const found = !quoted && !uncertainAssertion.test(clause) && !thirdParty.test(scoped)
      && (!mixedOwnership || self) ? coordinatedActionSkills(scoped) : [];

    // An unknown comma prefix owns its continuation. Do not discard it merely
    // because the next fragment starts with "我"; this covers unknown reporting,
    // question and denial vocabulary without a list of reporting synonyms.
    // A correction needs an earlier personal claim, an explicit exclusive own
    // contribution and no enclosing quotation. "据说，实际我..." cannot unlock it.
    const correction = scopedPersonalClaim && !nonassertiveFrame && !quoted && found.length > 0
      && /^(?:实际上?|事实上|其实)\s*(?:我(?:本人)?|本人)(?:只(?:是)?|仅)/u.test(text);
    if (correction) { uncertainScope = false; scopedPersonalClaim = false; }
    if (found.length > 0 && !uncertainScope) {
      if (startGroup || latestGroup === undefined) { latestGroup = groups.push([]) - 1; startGroup = false; }
      groups[latestGroup].push(...found.filter(skill => !disputedSkills.has(skill)));
      localUncertainClaim = false;
    }
    else if (localUncertainty) {
      // A complete personal denial/question scopes its own task, not a later
      // explicit affirmative contribution in another task. Never use this
      // branch inside an enclosing report, hypothesis or rhetorical frame.
      for (const skill of [...deniedSkills, ...questionSkills]) disputedSkills.add(skill);
      for (let index = 0; index < groups.length; index++) groups[index] = groups[index].filter(skill => !disputedSkills.has(skill));
      scopedPersonalClaim = true;
      localUncertainClaim = true;
    }
    else {
      // A complete team action establishes background, not student evidence.
      // Only this explicit grammar permits a following personal contribution.
      const background = scoped.replace(/^(?:团队|我们|组员|同学|队友|导师|老师|别人|他们|她们|他人|有人|某人)/u, "");
      const completedObject = background.match(/^(?:完成|做)(?:了)?((?:一个|一份|一项|整个)?(?:软件|小程序|程序|网站|网页|应用|海报|报告|实验|问卷|电路|机器人|模型|图纸))$/u)?.[1];
      const completeBackground = !quoted && !uncertainAssertion.test(clause) && background !== scoped
        && (coordinatedActionSkills(background).length > 0
          || Boolean(completedObject && Object.values(actionObjects).some(pattern => pattern.test(completedObject))));
      if (!completeBackground) {
        uncertainScope = true;
        localUncertainClaim = false;
        // Any unsupported attachment may qualify the previous action group.
        // Its wording need not match a denial/source blacklist, and a period
        // does not prevent revocation. The revoked claim can be corrected but
        // is never used as skill evidence itself.
        if (groups.some(group => group.length > 0)) {
          // Without a supported attachment scope, it may refer to several
          // preceding sentences. None is permanently committed by punctuation.
          for (let index = 0; index < groups.length; index++) groups[index] = [];
          scopedPersonalClaim = true;
        }
        startGroup = true;
      }
    }
    // Recognition here only tracks the existence of a claim, never its truth
    // or skills. It cannot itself add evidence or end an uncertain scope.
    const claimedAction = text.match(/(?:我(?:本人)?|本人)(?!们|的)(.*)/u)?.[1]?.replace(actionModifiers, "");
    if (uncertainScope && claimedAction && Object.values(affirmativeActions).some(pattern => pattern.test(claimedAction))) scopedPersonalClaim = true;

    if (/[；;。！？!?\n]$/u.test(clause) && quoteDepth === 0 && !straightQuote) {
      startGroup = true;
      uncertainScope = false;
      scopedPersonalClaim = false;
      nonassertiveFrame = false;
      localUncertainClaim = false;
    }
  }
  const personal = groups.flat();
  return Object.keys(skills).filter(skill => personal.includes(skill));
}
export function experienceEvidence(record: DecisionCompetitionRecord, profile: StudentProfileV6) {
  const active = profile.facts.filter(f => f.confirmed && f.state === "affirmed" && !profile.retractedFactIds.includes(f.id));
  return active.filter(f => /^experience\.[12]\.task$/.test(f.field)).flatMap(task => {
    const prefix = task.field.replace(/\.task$/, "");
    const contribution = active.find(f => f.field === `${prefix}.contribution`);
    if (!contribution || !["assisted", "independent", "led"].includes(String(contribution.value))) return [];
    const matchedSkills = experienceTextSkills(String(task.value));
    const relevant = matchedSkills.filter(skill => (familySkills[record.taskFamily] ?? []).includes(skill));
    if (!relevant.length) return [];
    const completion = active.find(f => f.field === `${prefix}.completion`);
    const weight = (contribution.value === "assisted" ? 0.45 : 1) * (completion && ["delivered", "feedback"].includes(String(completion.value)) ? 1 : 0.7);
    return [{ task, contribution, completion, skills: matchedSkills, weight, factIds: [task, contribution, completion].filter((f): f is StudentFactV6 => Boolean(f)).map(f => f.id) }];
  });
}
export function experienceRoleIndex(record: DecisionCompetitionRecord, profile: StudentProfileV6) {
  const evidence = experienceEvidence(record, profile);
  return record.roles.map((role, index) => ({ index, score: evidence.reduce((sum, item) => sum + item.weight * role.skills.filter(skill => item.skills.includes(skill)).length, 0) }))
    .sort((a, b) => b.score - a.score || a.index - b.index).find(item => item.score > 0)?.index;
}
export function experienceBonus(record: DecisionCompetitionRecord, profile: StudentProfileV6) {
  return Math.min(12, experienceEvidence(record, profile).reduce((sum, item) => sum + item.weight * 8, 0));
}
