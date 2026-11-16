import type { DomainFact } from "../v6/domain-facts";
import { profileClauseContentV7, splitProfileClausesV7 } from "./corrections";

type ScopedClause = { pattern: RegExp; state: "affirmed" | "negated" };
const teamMemberCount = String.raw`(?:两|二|三|四|五|\d+)(?:个)?(?:人|位(?:同学|队员|成员)?|名(?:同学|队员|成员)?)`;
const sharedTeamNationality = new RegExp(String.raw`^${teamMemberCount}(?:同为|均为|都是|同属)[\p{L}]{1,20}籍$`, "u");
const locationName = String.raw`[\p{L}\p{M}]{1,24}`;
const locationList = String.raw`(?:${locationName}(?:、${locationName})+(?:(?:和|与|及)${locationName})?|${locationName}(?:和|与|及)${locationName})`;
const distributedStudyLocations = new RegExp(
  String.raw`^(?:${teamMemberCount}|他们|我们|这些(?:成员|同学))?(?:分别|各自)(?:(?:在|于)${locationList}(?:上学|学习|就读)|(?:上学|学习|就读)(?:于|在)${locationList})$`, "u");

// These fields can hold multiple related predicates. Preserve explicit clauses
// only when a returned fact already anchors the requested subject in the same turn.
const independentClauses: Record<string, readonly ScopedClause[]> = {
  mentorconfirmation: [
    { pattern: /^(?:导师|指导老师|指导教师)(?:已|已经|明确|通过|邮件|书面|口头|当面|亲自)*(?:确认|同意|答应)(?:愿意|可以|会)?(?:指导|辅导)(?:我|我们)?$/u, state: "affirmed" },
    { pattern: /^(?:这|此)?(?:并)?(?:不是|非|并非)(?:我|我们)(?:本人|自己|单方面|单方)?(?:的)?(?:猜测|猜想|推测)(?:的)?$/u, state: "negated" },
  ],
  teamcountry: [
    { pattern: sharedTeamNationality, state: "affirmed" },
    { pattern: distributedStudyLocations, state: "affirmed" },
  ],
  travelpermission: [
    { pattern: /^(?:我(?:本人)?|本人)(?:很|也|仍)?(?:愿意|愿)(?:去|到|前往)?(?:比赛|赛事)?(?:现场|到场|线下)(?:参加|参赛)?$/u, state: "affirmed" },
    { pattern: /^(?:学校|校方|学院)?(?:的)?(?:请假|外出|出行)(?:申请|许可)?(?:目前|暂时|尚|还|仍)*(?:未|没|没有)(?:获准|获批|批准|获批准|通过)$/u, state: "negated" },
  ],
  teamfuture: [
    { pattern: /^(?:我(?:本人)?|本人)?(?:目前|现在|已经)?认识[\p{L}\p{N}]{0,12}(?:同学|同事|同伴)$/u, state: "affirmed" },
    { pattern: /^(?:(?:我|我们)?(?:尚未|还没|没|未曾|没有)(?:问过|询问)(?:他们|同学|对方)?(?:是否|愿不愿意|愿否)(?:参赛|参加|组队)|(?:这|目前)?不能算(?:已经)?(?:有队伍|组好队|确认队伍))$/u, state: "negated" },
  ],
  registrationpayment: [
    { pattern: /^(?:我(?:们)?|本人)?(?:已|已经|刚刚)?(?:填(?:写)?了|填(?:写)?完(?:了)?|填写)(?:这次|本次|这份)?(?:报名|参赛)(?:表|申请表)$/u, state: "affirmed" },
    { pattern: /^(?:我(?:们)?|本人)?(?:还|尚|仍)?(?:未|没|没有)(?:付|支付|缴|缴纳)(?:所)?(?:要求的|规定的)?(?:报名费|参赛费|费用|款项)$/u, state: "negated" },
  ],
};

function literalCoverage(fact: DomainFact, clause: string): boolean {
  return profileClauseContentV7(fact.sourceText).includes(profileClauseContentV7(clause));
}

/** A single affirmed location from this complete quote loses the distribution.
 * Keep the explicit study predicate and all locations together in the value. */
function preserveStudyLocations(field: string, complete: readonly string[], facts: DomainFact[]): DomainFact[] {
  if (!complete.length) return facts;
  const retained = new Set<string>();
  return facts.flatMap(fact => {
    const quote = profileClauseContentV7(fact.sourceText);
    if (fact.field !== field || fact.state !== "affirmed" || complete.filter(clause => clause === quote).length !== 1) return [fact];
    if (retained.has(quote)) return [];
    retained.add(quote);
    return [fact.value === quote ? fact : { ...fact, value: quote }];
  });
}

/** A nested count qualifies the observed population; it is not a second total. */
function totalSampleFacts(clauses: readonly string[], facts: DomainFact[]): DomainFact[] {
  const subset = clauses.filter(clause => /^(?:其中|之中|当中)[^。；;]+/u.test(clause));
  const refersToSubset = (fact: DomainFact) => {
    const quote = profileClauseContentV7(fact.sourceText);
    return Boolean(quote && subset.some(clause => clause.includes(quote)));
  };
  const total = facts.some(fact => fact.state === "affirmed" && !refersToSubset(fact)
    && /(?:访谈|受访|调查|问卷|样本|受试)/u.test(fact.sourceText) && /[0-9０-９一二三四五六七八九十百千万两]/u.test(fact.sourceText));
  return total && facts.some(refersToSubset) ? facts.filter(fact => !refersToSubset(fact)) : facts;
}

const countNumeral = "[0-9０-９零〇一二两三四五六七八九十百千]+";
const participantCount = `(${countNumeral})(?:人|名|位)`;
const followUpCount = `${participantCount}(?:还|也|已|已经|实际)?(?:接受|完成|参加|参与)(?:了)?(?:后续)?(?:回访|复访|再次访谈)`;
const nestedFollowUp = new RegExp(`^(?:这|原先的)?${participantCount}(?:访谈对象|受访者|受访对象|调查对象)(?:里|中|里面|之中|当中)(?:有|已有|其中有)?${followUpCount}$`, "u");
const precedingPopulation = new RegExp(`^(?:我(?:们)?(?:已|已经)?(?:访谈|调查)(?:了)?${participantCount}|${participantCount}(?:访谈对象|受访者|受访对象|调查对象))$`, "u");
const followingSubset = new RegExp(`^(?:其中|之中|当中)(?:有|已有)?${followUpCount}$`, "u");

function literalParticipantCount(quote: string): number | undefined {
  const text = quote.normalize("NFKC").replace(/两/gu, "二").replace(/〇/gu, "零");
  if (/^[0-9]+$/u.test(text)) return Number.isSafeInteger(Number(text)) ? Number(text) : undefined;
  if (text === "零") return 0;
  if (text.startsWith("零")) return undefined;
  const match = /^(?:([一二三四五六七八九])千)?(?:零?([一二三四五六七八九])百)?(?:零?([一二三四五六七八九])?十)?(?:零?([一二三四五六七八九]))?$/u.exec(text);
  if (!match || /[百千][一二三四五六七八九]$/u.test(text)) return undefined;
  const digit = (value?: string) => value ? "零一二三四五六七八九".indexOf(value) : 0;
  const [, thousands, hundreds, tens, ones] = match;
  return digit(thousands) * 1000 + digit(hundreds) * 100 + (text.includes("十") ? digit(tens) || 1 : 0) * 10 + digit(ones);
}

/** Correct only an affirmative count that is provably the other side of a
 * quoted parent/subset relationship. Other scopes and uncertainty stay intact. */
function scopedFollowUpCounts(text: string, field: string, purpose: "total" | "overlap", facts: DomainFact[]): DomainFact[] {
  const scopes = text.split(/[。；;\n]/u).flatMap(sentence => {
    if (/[？?“”「」"']|如果|假如|假设|只要|除非|将来|计划|打算|可能|据说|听说|(?:队友|朋友|同学|老师|他|她|别人)说/u.test(sentence)) return [];
    const clauses = splitProfileClausesV7(sentence);
    return clauses.flatMap((clause, index) => {
      const main = profileClauseContentV7(clause);
      const nested = nestedFollowUp.exec(main);
      const preceding = precedingPopulation.exec(main);
      const nextClause = clauses[index + 1];
      const following = nextClause ? followingSubset.exec(profileClauseContentV7(nextClause)) : null;
      const totalText = nested?.[1] ?? preceding?.[1] ?? preceding?.[2];
      const overlapText = nested?.[2] ?? following?.[1];
      if (!totalText || !overlapText) return [];
      const total = literalParticipantCount(totalText), overlap = literalParticipantCount(overlapText);
      if (total === undefined || overlap === undefined || overlap >= total) return [];
      return [{ total, overlap, clauses: nested ? [main] : [main, profileClauseContentV7(nextClause)] }];
    });
  });
  if (!scopes.length) return facts;
  const other = purpose === "total" ? "overlap" : "total";
  const relatedTo = (quote: string, scope: (typeof scopes)[number]) => {
    const namesPopulationOrFollowUp = /访谈对象|受访者|受访对象|调查对象|回访|复访|再次访谈/u.test(quote);
    return Boolean(quote) && scope.clauses.some(clause => quote.includes(clause) || namesPopulationOrFollowUp && clause.includes(quote));
  };
  const corrected = new Set<(typeof scopes)[number]>();
  return facts.flatMap(fact => {
    if (fact.field !== field || fact.state !== "affirmed" || typeof fact.value !== "number") return [fact];
    const quote = profileClauseContentV7(fact.sourceText);
    const related = scopes.filter(scope => relatedTo(quote, scope));
    if (related.some(scope => scope[purpose] === fact.value) || !related.some(scope => scope[other] === fact.value)) return [fact];
    if (related.length !== 1) return [];
    const [scope] = related;
    if (!scope.clauses.every(clause => quote.includes(clause)) || corrected.has(scope)
      || facts.some(row => row.field === field && row.state === "affirmed" && row.value === scope[purpose]
        && relatedTo(profileClauseContentV7(row.sourceText), scope))) return [];
    corrected.add(scope);
    return [{ ...fact, value: scope[purpose] }];
  });
}

const personalMaterialsCap = /^(?:我(?:的)?个人|我本人|本人|个人)(?:最多|至多|最高|上限(?:是|为)?)(?:能|可)?(?:承担|支付|自付)?([0-9０-９]+(?:[.．][0-9０-９]+)?)(?:元|块)(?:材料|耗材)(?:费|费用)$/u;
const schoolEquipmentExclusion = /^(?:不含|不包含|不包括|不计入)(?:(?:已(?:经)?)?由(?:学校|校方)(?:已(?:经)?)?|(?:学校|校方)已(?:经)?)(?:承担|支付|报销)的(?:设备|仪器|器材)(?:费|费用)$/u;

/** Keep the exclusion in the numeric cap's contiguous source. The number stays
 * a numeric materials limit and the payer restriction stays literal. */
function preserveMaterialsCapExclusion(text: string, field: string, clauses: readonly string[], facts: DomainFact[]): DomainFact[] {
  return facts.map(fact => {
    if (fact.field !== field || fact.state !== "affirmed" || typeof fact.value !== "number") return fact;
    const amount = profileClauseContentV7(fact.sourceText).match(personalMaterialsCap)?.[1];
    if (!amount || Number(amount.normalize("NFKC")) !== fact.value) return fact;
    const start = text.indexOf(fact.sourceText), end = start + fact.sourceText.length;
    if (start < 0 || !clauses.includes(fact.sourceText.trim())) return fact;
    const next = text.slice(end).match(/^[，,]\s*([^，,。；;！!？?\n]+)[。！!]?/u);
    if (!next || !schoolEquipmentExclusion.test(next[1].trim()) || facts.some(other => literalCoverage(other, next[1]))) return fact;
    return { ...fact, sourceText: text.slice(start, end + next[0].length) };
  });
}

export function reconcileRequestedProfileFactsV7(text: string, requestedFields: readonly string[], facts: DomainFact[]): DomainFact[] {
  if (requestedFields.length !== 1 || !facts.length) return facts;
  const [field] = requestedFields;
  const scope = field.toLowerCase().replace(/[^a-z0-9]/g, "");
  const clauses = splitProfileClausesV7(text);
  if (scope === "samplecount") return totalSampleFacts(clauses, scopedFollowUpCounts(text, field, "total", facts));
  if (scope === "participantoverlap") return scopedFollowUpCounts(text, field, "overlap", facts);
  if (/[？?“”「」"']|如果|假如|假设|只要|除非|将来|计划|打算|可能|据说|听说|(?:队友|朋友|同学|导师|老师|校方|学校|管理员|他|她|别人)说/u.test(text)) return facts;
  if (scope === "budgetpersonalcny" || scope === "budgetmaximumyuan") return preserveMaterialsCapExclusion(text, field, clauses, facts);
  const rules = Object.hasOwn(independentClauses, scope) ? independentClauses[scope] : undefined;
  if (!rules) return facts;
  const teamPredicates = scope === "teamcountry" ? clauses.map(clause => clause
    .replace(/^(?:更正|纠正|修改|更新|补充|说明|明确)[：:]\s*/u, "").replace(/[.!！]+$/u, "").trim()) : [];
  // A detached location clause does not establish who said it or when it applies.
  const completeStudyClauses = teamPredicates.every(clause => sharedTeamNationality.test(clause) || distributedStudyLocations.test(clause))
    ? teamPredicates.filter(clause => distributedStudyLocations.test(clause)) : [];
  const recognized = clauses.flatMap(clause => {
    const predicate = profileClauseContentV7(clause);
    const rule = rules.find(({ pattern }) => pattern.test(predicate)
      && (pattern !== distributedStudyLocations || completeStudyClauses.includes(predicate)));
    return rule ? [{ clause, state: rule.state }] : [];
  });
  if (!recognized.some(({ clause }) => facts.some(fact => fact.field === field && literalCoverage(fact, clause)))) return facts;
  const scopedFacts = preserveStudyLocations(field, completeStudyClauses, facts);
  const additions: DomainFact[] = [];
  for (const { clause, state } of recognized) {
    const start = text.indexOf(clause);
    if (start < 0 || [...scopedFacts, ...additions].some(fact => literalCoverage(fact, clause))) continue;
    additions.push({ field, value: profileClauseContentV7(clause), state, evidenceLevel: "self_report", confirmed: true,
      sourceText: text.slice(start, start + clause.length) });
  }
  return additions.length && scopedFacts.length + additions.length <= 160 ? [...scopedFacts, ...additions] : scopedFacts;
}
