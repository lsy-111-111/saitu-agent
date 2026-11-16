import { createHash } from "node:crypto";
import { COMPETITION_ELIGIBILITY_FACT_IDS, COMPETITION_PROFILE_FIELD_IDS, type CompetitionRecommendationProfileV5 } from "@/types/competition-recommendation";
import { studentProfileSchema, type StudentFactV6, type StudentProfileV6 } from "../v6/contracts";
import { extractionSchema, validateProfileExtraction, type ProfileExtraction } from "../v6/domain-facts";
import { createStudentProfile, decisionGoalLabels, isEditableProfileField } from "../v6/profile";
import { profileMutationSchema, type ProfileMutation } from "../v6/profile-contracts";

export type ProfileSourceV7 = { answerId: string; text: string; at: string };
export type CreateProfileOptionsV7 = Parameters<typeof createStudentProfile>[1];

export const STRUCTURED_PROFILE_PROVENANCE_VERSION_V7 = "saitu.structured-profile-input.v7.1";
const profileDigest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export type StructuredProfileSubmissionV7 = { kind: "explicit_canonical_submission"; inputSha256: string; profilePointer: string };

/** A legacy canonical profile can itself be explicitly submitted as input.
 * Preserve that submission's scalar values as source text, never invent a
 * natural-language quote or infer an ability from its display label. The
 * receipt distinguishes this representation from a historical utterance. */
export function materializeStructuredProfileV7(input: StudentProfileV6, submission: StructuredProfileSubmissionV7) {
  if (submission?.kind !== "explicit_canonical_submission" || !/^[a-f0-9]{64}$/.test(submission.inputSha256)
    || !/^(?:\/(?:[^~]|~[01])*)?$/.test(submission.profilePointer)) throw new Error("explicit_structured_submission_binding_required");
  const before = studentProfileSchema.parse(input);
  const beforeProfileSha256 = profileDigest(before);
  const sources: { factId: string; pointer: string; valueSha256: string; answerId: string }[] = [];
  const facts = before.facts.map((fact, index) => {
    if (fact.originalText?.trim()) return fact;
    // An incomplete existing utterance binding is not an unbound legacy value.
    if (fact.answerId || fact.sourceSpan) throw new Error("incomplete_existing_profile_source");
    const originalText = typeof fact.value === "string" ? fact.value : JSON.stringify(fact.value);
    if (!originalText.trim() || originalText.length > 1600) throw new Error("structured_profile_value_source_unrepresentable");
    const valueSha256 = profileDigest(fact.value);
    const answerId = `structured-input.v7.${profileDigest({ submission, beforeProfileSha256, factId: fact.id, index, valueSha256 }).slice(0, 40)}`;
    sources.push({ factId: fact.id, pointer: `${submission.profilePointer}/facts/${index}/value`, valueSha256, answerId });
    return { ...fact, answerId, originalText, sourceSpan: { start: 0, end: originalText.length } };
  });
  const profile = sources.length ? studentProfileSchema.parse({ ...before, facts,
    revision: profileDigest({ version: STRUCTURED_PROFILE_PROVENANCE_VERSION_V7, submission, previousRevision: before.revision, facts }) }) : before;
  return { profile, provenance: { schemaVersion: STRUCTURED_PROFILE_PROVENANCE_VERSION_V7,
    origin: "explicitly_submitted_structured_values" as const, historicalUtteranceInvented: false,
    submission, beforeProfileSha256, afterProfileSha256: profileDigest(profile), sources } };
}

export function ensureStructuredProfileProvenanceV7(input: StudentProfileV6, submission: StructuredProfileSubmissionV7): StudentProfileV6 {
  return materializeStructuredProfileV7(input, submission).profile;
}

const independentSkillNames: readonly [RegExp, string][] = [
  [/^(?:编程|软件开发|Python|JavaScript|代码)$/iu, "programming"], [/^(?:数据分析|统计分析|建模)$/u, "data-analysis"],
  [/^(?:调研|科研)$/u, "research"], [/^(?:产品策划|需求分析)$/u, "product"], [/^(?:结构设计|工程制图)$/u, "structural-design"],
  [/^(?:设计|绘图|视觉设计)$/u, "design"], [/^(?:硬件|电路)$/u, "hardware"], [/^(?:写作|材料整理)$/u, "writing"],
  [/^(?:演讲|路演|答辩)$/u, "presentation"], [/^(?:实验|实验操作)$/u, "laboratory"], [/^(?:财会|金融分析)$/u, "accounting-finance"],
  [/^(?:政策分析|案例研判)$/u, "policy-analysis"], [/^(?:语言表达|跨文化|跨文化沟通)$/u, "language"], [/^(?:野外调查|测绘|田野|田野实践)$/u, "fieldwork"],
];

/** Keeping an existing field is an instruction to retain its value, not a new
 * value such as “未变”. Limit this to whole named-field clauses. */
export function isUnchangedProfileClauseV7(clause: string): boolean {
  if (/[？?“”「」"']|如果|假如|假设|计划|打算|(?:队友|同学|朋友|老师|他|她|别人)说/u.test(clause)) return false;
  const retained = String.raw`(?:(?:我|本人|当前|现有|原有)(?:的)?)?(?:文档(?:名称|编号)|(?:主要|参赛)?目标)`;
  if (new RegExp(String.raw`^(?:这(?:句话|条说明|次补充)|上述(?:说明|补充)|我|本人)(?:并)?(?:没有|没|未)(?:修改|改变|更改|调整|影响)${retained}(?:(?:或|和|与|及|以及)${retained})*$`, "u").test(literalPredicate(clause))) return true;
  if (/改成|改为|更正|修改|更新|调整|撤回|撤销|删除/u.test(clause)) return false;
  return /^[\p{L}\p{N}_.:-]{0,60}(?:号码|编号|名称|目标|预算|时间|投入|条件|限制|范围|权限)(?:仍然|仍|也|都)?(?:保持不变|没有变化|没变|未变|不变)[！!。.]?$/u.test(clause.trim());
}

function completeProfileClause(text: string, quote: string): boolean {
  const normalized = quote.trim().replace(/[。；;，,]+$/u, "");
  return text.split(/[，,。；;\n]/u).some(clause => clause.trim() === normalized);
}

const explicitAbsenceClause = /^(?:(?:我|我们)?(?:现在|目前|还|尚)*)?(?:没有|未有|未获|不具备|不允许)/u;
const unsettledReportedStatus = /^(?:我的?)?(?:队友|同学|朋友|老师|他|她|别人)(?:说|表示|提到)(?:此事|这件事|这件事情|这个问题)?(?:还|仍|要|得|需要|稍后|以后|下周)*(?:再(?:商量|讨论|确认|研究|决定)|(?:等待|等)(?:通知|确认|消息)|(?:尚|暂时)?(?:未定|没定|不确定))$/u;
const writtenFundingDomains = /^(?:budget|funding|reimbursement|expenses?)$/iu;
const writtenFundingPredicate = /^(?:(?:任何|明确|正式|确定)(?:的)?)*书面(?:的)?(?:(?:费用|经费|资金|预算)(?:承担|分摊|报销|支付|补贴)?|承担|分摊|报销|支付|补贴)(?:的)?(?:安排|承诺|约定|协议|批复|确认)$/u;
const mainGoalDeclarationV7 = /^(?:(?:更正|修改|更新)[：:]?)?(?:(?:我的?|本轮|这次|当前|目前)(?:的)?)?(?:主要|首要|最重要的?)目标(?:是|为|改为|改成|更改为|调整为|：|:)/u;

/** Canonically equivalent Unicode is still the same quotation. Recover the
 * original code units and boundaries; compatibility or approximate matches fail. */
function originalCanonicalQuote(text: string, quote: string): string {
  if (text.includes(quote)) return quote;
  const target = quote.normalize("NFC"), boundaries = new Map<number, number>();
  let normalized = "";
  for (const part of new Intl.Segmenter("und", { granularity: "grapheme" }).segment(text)) {
    boundaries.set(normalized.length, part.index);
    normalized += part.segment.normalize("NFC");
    boundaries.set(normalized.length, part.index + part.segment.length);
  }
  for (let at = normalized.indexOf(target); at >= 0; at = normalized.indexOf(target, at + 1)) {
    const start = boundaries.get(at), end = boundaries.get(at + target.length);
    if (start !== undefined && end !== undefined) {
      const original = text.slice(start, end);
      if (original.normalize("NFC") === target) return original;
    }
  }
  throw new Error("extraction_quote_not_in_utterance");
}

function isPersonalAbilityOrExperienceFieldV7(field: string): boolean {
  return /skill|ability|能力|experience|contribution|作品|成果|achievement/i.test(field)
    || /(?:^|[.:_])can[A-Z]/u.test(field);
}

const reportedScopeField = /^(?:team|members?|other|quoted)[.:_]/iu;
const projectOwnershipField = /^(?:project|work|activity|material)[.:_](?:owner|ownership|belongsTo)$/iu;
const otherProjectOwner = /^(?:(?:这|那|此)(?:是|属于)(?:他(?:们)?|她(?:们)?|对方)的?(?:项目|作品|活动|材料)|(?:这|那|此)(?:个|项|件|份)?(?:项目|作品|活动|材料)(?:是|属于)(?:他(?:们)?|她(?:们)?|对方)的?)$/u;
const explicitOtherProjectOwner = /^(?:(?:这|那|此)(?:是|属于)我(?:的)?(?:队友|朋友|同学|老师)的(?:项目|作品|活动|材料)|(?:这|那|此)(?:个|项|件|份)?(?:项目|作品|活动|材料)(?:是|属于)我(?:的)?(?:队友|朋友|同学|老师)的?)$/u;

/** Resolve a named relationship directly, or a pronoun through the adjacent
 * separately sourced third-party report. */
function scopeReportedOwnershipV7(text: string, fact: ExtractedFact, facts: readonly ExtractedFact[]): ExtractedFact {
  const quote = literalPredicate(fact.sourceText);
  const explicit = explicitOtherProjectOwner.test(quote);
  if (fact.state !== "affirmed" || !projectOwnershipField.test(fact.field) ||
    (!explicit && !otherProjectOwner.test(quote)) || !completeProfileClause(text, fact.sourceText) ||
    /[？?“”‘’「」『』"']|如果|假如|假设|一旦|除非|倘若|要是|只要|只有|传闻|据说/u.test(text)) return fact;
  if (explicit) return { ...fact, field: "other." + fact.field, value: quote };
  const prefix = text.slice(0, text.indexOf(fact.sourceText));
  const hasAdjacentReport = facts.some(report => {
    if (!reportedScopeField.test(report.field) || report.state !== "affirmed" || !completeProfileClause(text, report.sourceText) ||
      !/^(?:我的?)?(?:队友|朋友|同学|老师|他|她|别人)(?:说|表示|提到)/u.test(report.sourceText)) return false;
    const at = prefix.lastIndexOf(report.sourceText);
    return at >= 0 && /^[\s，,]+$/u.test(prefix.slice(at + report.sourceText.length));
  });
  if (!hasAdjacentReport) return fact;
  return { ...fact, field: "other." + fact.field, value: quote };
}

/** An independent same-domain denial can substantiate a whole-source unknown.
 * A quote confined to an unsettled discussion supports only reported context. */
function independentUnknownStatusContextV7(text: string, fact: ProfileExtraction["facts"][number], facts: ProfileExtraction["facts"]) {
  if (fact.state !== "unknown" || reportedScopeField.test(fact.field)
    || isPersonalAbilityOrExperienceFieldV7(fact.field)
    || /[“”「」"']|如果|假如|假设|一旦|只要|只有|除非|要是|倘若/u.test(text)) return undefined;
  const domain = fact.field.split(/[.:_]/u, 1)[0].toLowerCase();
  for (const absence of facts) {
    if ((absence.state !== "negated" && !(absence.state === "affirmed" && absence.value === false))
      || absence.field.split(/[.:_]/u, 1)[0].toLowerCase() !== domain
      || isPersonalAbilityOrExperienceFieldV7(absence.field) || !completeProfileClause(text, absence.sourceText)) continue;
    const quote = absence.sourceText.trim().replace(/[。；;，,]+$/u, ""), at = text.indexOf(absence.sourceText);
    if (!explicitAbsenceClause.test(quote)
      || !/^\s*(?:[。；;\n]|$)/u.test(text.slice(at + quote.length))) continue;
    const prefix = text.slice(0, at).match(/(?:^|[。；;\n])\s*((?:我的?)?(?:队友|同学|朋友|老师|他|她|别人)(?:说|表示|提到)[^，,。；;\n：:]+?)[，,]\s*$/u)?.[1];
    if (!prefix) continue;
    if (fact.sourceText.includes(prefix) && fact.sourceText.includes(quote)) {
      return { quote: absence.sourceText, reportedQuote: prefix, reportedOnly: false };
    }
    if (writtenFundingDomains.test(domain) && writtenFundingPredicate.test(quote.replace(explicitAbsenceClause, ""))
      && literalPredicate(fact.sourceText) === prefix && completeProfileClause(text, fact.sourceText)
      && unsettledReportedStatus.test(prefix) && !/[？?“”‘’「」『』"']/u.test(text)
      && text.indexOf(prefix) === text.lastIndexOf(prefix) && at === text.lastIndexOf(absence.sourceText)) {
      return { quote: absence.sourceText, reportedQuote: prefix, reportedOnly: true };
    }
  }
  return undefined;
}

function isRedundantReportedUnknownV7(text: string, fact: ExtractedFact, reportedQuotes: readonly string[]): boolean {
  if (fact.state !== "unknown" || reportedScopeField.test(fact.field) || isPersonalAbilityOrExperienceFieldV7(fact.field)
    || /[？?“”「」"']|如果|假如|假设|一旦|只要|只有|除非|要是|倘若/u.test(text)) return false;
  const quote = literalPredicate(fact.sourceText);
  return /^(?:我的?)?(?:队友|同学|朋友|老师|他|她|别人)(?:说|表示|提到)[^，,。；;\n：:]+$/u.test(quote)
    && completeProfileClause(text, fact.sourceText)
    && reportedQuotes.some(reported => literalPredicate(reported) === quote && completeProfileClause(text, reported));
}

/** Isolate an independently stated goal, restriction or skill only when its
 * original wording proves the clause boundary. A comma alone never does. */
function selfReportValidationContext(text: string, fact: ProfileExtraction["facts"][number], reportedQuotes: readonly string[] = []): string {
  const completedTrial = fact.state === "affirmed" ? completedClassTrialFactV7(text, fact) : null;
  if (completedTrial && (!classFeedbackField.test(fact.field) || completedTrial.groups?.feedback)) return fact.sourceText;
  if (!isPersonalAbilityOrExperienceFieldV7(fact.field)) {
    const quote = fact.sourceText.trim().replace(/[。；;，,]+$/u, "");
    const at = text.indexOf(fact.sourceText);
    const prefix = text.slice(0, at);
    // A complete personal restriction can follow another person's claim. Keep
    // that separate boundary without allowing reported abilities or contributions
    // to become the student's own evidence, or cutting inside a reported clause.
    const ownRestriction = /^(?:不能|不得|不可|不应|不等于).*(?:我的|我本人|本人).*(?:许可|授权|同意|限制|条件|预算|时间)/u.test(quote);
    const completeClause = completeProfileClause(text, fact.sourceText);
    const reportingTail = /(?:队友|同学|朋友|老师|他|她|别人)说[：:,，\s]*$/u.test(prefix);
    if (ownRestriction && completeClause && !reportingTail && !/[“”「」"']|如果|假如|假设/u.test(text)) return fact.sourceText;
    const completedReservation = fact.state === "affirmed" && /^(?:(?:我|我们)(?:目前|现在)?|目前|现在)?已(?:经)?(?:预约|预订|订好|租到|借到)/u.test(quote);
    const lastInSentence = /^\s*(?:[。；;\n]|$)/u.test(text.slice(at + quote.length));
    const sentencePrefix = prefix.slice(Math.max(prefix.lastIndexOf("。"), prefix.lastIndexOf("；"), prefix.lastIndexOf("\n")) + 1);
    const scopedContext = sentencePrefix + fact.sourceText;
    if ((fact.field === "primaryGoal" || fact.field === "goal.description") && fact.state === "affirmed"
      && typeof fact.value === "string" && completeClause && !sentencePrefix.trim()) {
      const declaration = mainGoalDeclarationV7.exec(quote);
      const goal = declaration ? quote.slice(declaration[0].length).trim() : "";
      const plan = /^\s*[，,]\s*(?:(?:我(?:本人)?|本人)\s*)?(?:计划|打算)\s*([^，,。；;.!！\n]+)\s*[。.!！]?\s*$/u
        .exec(text.slice(at + fact.sourceText.length))?.[1].trim();
      if (goal && goal.normalize("NFC") === fact.value.trim().normalize("NFC") && plan
        && !/[？?“”‘’「」『』"']|如果|假如|假设|一旦|只要|只有|仅当|除非|要是|倘若|前提是|据说|听说|(?:队友|同学|朋友|老师|他|她|别人)说/u.test(text)
        && !/目标|取消|撤回|再决定|是否|改成|改为|不再/u.test(plan)) return fact.sourceText;
    }
    if (completedReservation && completeClause && lastInSentence
      && !/[“”「」"']|如果|假如|假设|一旦|只要|只有|除非|要是|倘若|(?:队友|同学|朋友|老师|他|她|别人)说/u.test(scopedContext)) return fact.sourceText;
    const currentPermission = /^(?:我|我们)(?:现在|目前)(?:只有|仅有|只获准|仅获准).*(?:权限|许可|授权)$/u.test(quote);
    if (currentPermission && completeClause && lastInSentence
      && !/[“”「」"']|如果|假如|假设|一旦|只要|只有在|除非|要是|倘若|(?:队友|同学|朋友|老师|他|她|别人)说/u.test(scopedContext)) return fact.sourceText;
    const separatelyReported = reportedQuotes.some(reported => {
      const end = prefix.lastIndexOf(reported) + reported.length;
      return Boolean(reported.trim()) && completeProfileClause(text, reported) && end >= reported.length && /^[\s，,：:]*$/u.test(prefix.slice(end))
        && !/(?:队友|同学|朋友|老师|他|她|别人)说[：:,，\s]*$/u.test(reported);
    });
    if ((fact.state === "negated" || fact.state === "affirmed" && fact.value === false) && explicitAbsenceClause.test(quote)
      && completeClause && lastInSentence && separatelyReported
      && !/如果|假如|假设|一旦|只要|只有|除非|要是|倘若/u.test(scopedContext)) return fact.sourceText;
  }
  if (fact.field !== "skills" || fact.state !== "affirmed") return text;
  const current = fact.sourceText.match(/^我(?:已经|现在|目前)?(?:会|能|能够|掌握)(?:做)?(.+)$/u);
  if (!current || independentSkillNames.find(([pattern]) => pattern.test(current[1]))?.[1] !== fact.value) return text;
  const end = text.indexOf(fact.sourceText) + fact.sourceText.length;
  const continuation = text.slice(end).match(/^(?:[，,](?:但是|但)?|但是|但)(.+?)[。.!！]?$/u)?.[1];
  if (!continuation) return text;
  const plan = "(?:计划|打算)(?:以后)?(?:学习|学|练习)";
  const otherSpeaker = "(?:我的?)?(?:队友|朋友|同学|老师)说(?:他|她)";
  const target = continuation.match(new RegExp(`^(?:(?:我)?${plan}|${otherSpeaker}${plan})(.+)$`, "u"))?.[1]
    ?? continuation.match(/^(?:我)?对(.+)感兴趣$/u)?.[1];
  const nextSkill = target && independentSkillNames.find(([pattern]) => pattern.test(target))?.[1];
  return nextSkill && nextSkill !== fact.value ? text.slice(0, end) : text;
}

/** V7 citation checks keep explicit third-person work out of personal ability
 * fields. A joint first-person activity is not rejected as third-person work. */
export function validateSelfReportedExtractionV7(text: string, raw: unknown, options: NonNullable<Parameters<typeof validateProfileExtraction>[2]> & { allowIndependentReportedClauses?: boolean } = {}): ProfileExtraction {
  const parsed = extractionSchema.parse(raw);
  const exactQuotes = parsed.facts.map(fact => ({ ...fact, sourceText: originalCanonicalQuote(text, fact.sourceText) }));
  const deferredStorage = options.allowIndependentReportedClauses ? deferredStorageGrantsV7(text) : [];
  const scopedFacts = options.allowIndependentReportedClauses ? literalApprovalInferenceFactsV7(text, exactQuotes.map(fact => {
    const owned = scopeReportedOwnershipV7(text, fact, exactQuotes);
    return normalizeCompletedClassTrialV7(text, normalizeDeferredStorageGrantV7(owned, deferredStorage));
  })) : exactQuotes;
  const unknownContexts = options.allowIndependentReportedClauses ? scopedFacts.map(fact => independentUnknownStatusContextV7(text, fact, scopedFacts)) : [];
  const externalQuotes = options.allowIndependentReportedClauses ? scopedFacts.filter(fact => /^(?:team|members?|other|quoted)\./u.test(fact.field)) : [];
  const reportedQuotes = externalQuotes.map(fact => fact.sourceText).concat(unknownContexts.flatMap(context => context ? [context.reportedQuote] : []));
  const confirmedReportQuotes = externalQuotes.filter(fact => fact.state === "affirmed").map(fact => fact.sourceText);
  const ignoredUnknownFields = new Set<string>();
  const facts = scopedFacts.flatMap((rawFact, index) => {
    let fact = rawFact;
    // A provider may cite the whole reported sentence for its final, independent
    // personal restriction. Narrow only that exact last clause; retain other reports.
    const tail = text.trim().match(/(?:^|[，,。；;\n])((?:不能|不得|不可|不应|不等于)[^，,。；;\n]*(?:我的|我本人|本人)[^，,。；;\n]*(?:许可|授权|同意|限制|条件|预算|时间)[^，,。；;\n]*)[。.!！]?$/u)?.[1];
    if (tail && options.allowIndependentReportedClauses && fact.state === "negated"
      && !/skill|ability|experience|contribution|能力|经历|作品|成果/iu.test(fact.field)
      && fact.sourceText.includes(tail) && !/[“”「」"']|如果|假如|假设/u.test(text)) {
      const prefix = text.slice(0, text.lastIndexOf(tail)).split(/[，,。；;\n]/u).map(part => part.trim()).filter(Boolean);
      if (prefix.length && prefix.every(part => reportedQuotes.some(reported => reported.includes(part)))) fact = { ...fact, sourceText: tail };
    }
    const at = text.indexOf(fact.sourceText);
    if (at < 0) throw new Error("extraction_quote_not_in_utterance");
    if (isUnchangedProfileClauseV7(fact.sourceText) && completeProfileClause(text, fact.sourceText)) return [];
    const unknownContext = unknownContexts[index];
    if ((!unknownContext || unknownContext.reportedOnly) && isRedundantReportedUnknownV7(text, fact, confirmedReportQuotes)) {
      ignoredUnknownFields.add(fact.field);
      return [];
    }
    if (unknownContext?.reportedOnly) {
      ignoredUnknownFields.add(fact.field);
      const report = { ...fact, field: "quoted.statusContext", value: unknownContext.reportedQuote,
        sourceText: unknownContext.reportedQuote, state: "affirmed" as const, evidenceLevel: "self_report" as const };
      confirmedReportQuotes.push(report.sourceText);
      return validateProfileExtraction(text, { facts: [report], unknownFields: [] }, options).facts;
    }
    if (options.allowIndependentReportedClauses && !unknownContext && fact.state === "unknown"
      && !reportedScopeField.test(fact.field) && unsettledReportedStatus.test(literalPredicate(fact.sourceText))) {
      throw new Error("quoted_other_person_is_not_self_evidence");
    }
    const context = unknownContext?.quote ?? selfReportValidationContext(text, fact, reportedQuotes);
    const separateDenial = context !== text && context === fact.sourceText && fact.state === "affirmed" && fact.value === false
      && explicitAbsenceClause.test(fact.sourceText.trim());
    const validationFact = unknownContext ? { ...fact, sourceText: unknownContext.quote }
      : separateDenial ? { ...fact, state: "negated" as const } : fact;
    const checked = validateProfileExtraction(context, { facts: [validationFact], unknownFields: [] }, options).facts[0];
    return [{ ...checked, sourceText: fact.sourceText }];
  });
  const known = new Set(facts.filter(fact => !["unknown", "conditional", "retracted"].includes(fact.state)).map(fact => fact.field));
  const unknownFields = [...new Set([...(options.requestedFields ?? parsed.unknownFields.filter(field => !ignoredUnknownFields.has(field))),
    ...facts.filter(fact => fact.state === "unknown" || fact.state === "conditional").map(fact => fact.field)])].filter(field => !known.has(field));
  const checked = { facts, unknownFields };
  for (const fact of checked.facts) {
    if (/^(?:team|members?|other|quoted)[.:]/.test(fact.field) || !/skill|ability|can[A-Z]|能力/.test(fact.field)) continue;
    const at = text.indexOf(fact.sourceText), end = at + fact.sourceText.length;
    let start = 0, finish = text.length;
    for (const mark of text.matchAll(/[，,。；;\n]|但是|但(?!是)/gu)) {
      if (mark.index + mark[0].length <= at) start = mark.index + mark[0].length;
      else if (mark.index >= end) { finish = mark.index; break; }
    }
    const context = text.slice(start, finish).replace(/\s+/g, "");
    const third = "(?:队友|同学|朋友|老师|他|她|他们|她们|别人|其他成员|团队其他成员)";
    const action = "(?:已经|独立|主要|只|负责|主导)*(?:完成|做|写|开发|实现|制作|搭建|分析|设计|掌握|会|能|负责|主导)";
    if (new RegExp(`^(?:(?:是|由)|我的?)?${third}${action}|(?:是|由|让|交给)${third}(?:来)?${action}`).test(context)) throw new Error("other_person_work_is_not_student_ability");
  }
  return checked;
}

/** Submitting an answer is sufficient: a second acknowledgement or work sample
 * is never required to use a student's self-reported ability. Unanswered legacy
 * defaults remain unknown. The v6 storage shape keeps old archives readable. */
export function createStudentProfileV7(legacy: CompetitionRecommendationProfileV5, options: CreateProfileOptionsV7 = {}): StudentProfileV6 {
  const submitted = structuredClone(legacy);
  const fields = options.answerContext?.map(answer => answer.fieldId) ?? [];
  submitted.confirmedFields = [...new Set([...submitted.confirmedFields, ...fields])] as typeof submitted.confirmedFields;
  if (submitted.decisionContext?.experiences) submitted.decisionContext.experiences = submitted.decisionContext.experiences
    .map(experience => ({ ...experience, confirmed: Boolean(experience.task.trim()) }));
  let profile = createStudentProfile(submitted, options);
  const rawTask = options.answerContext?.find(answer => answer.fieldId === "taskFormats" && answer.freeText?.trim())?.freeText;
  if (rawTask && !submitted.taskFormats.length) {
    const field = "taskFormats.raw";
    const facts: StudentFactV6[] = [...profile.facts, {
      id: `s.${field}.${profileDigest(rawTask).slice(0, 16)}`, field, value: rawTask,
      label: `任务偏好原话：${rawTask}`, state: "affirmed", confirmed: true, evidenceLevel: "self_report",
      answerId: "questionnaire.taskFormats", originalText: rawTask, sourceSpan: { start: 0, end: rawTask.length },
      updatedAt: options.answeredAt ?? null, supersedesFactIds: [],
    }];
    profile = studentProfileSchema.parse({ ...profile, facts, revision: profileDigest(facts) });
  }
  // The old adapter uses one maximum field for all scopes. Keep a team or
  // unspecified amount in its own field so it cannot become a personal cap.
  if (submitted.decisionContext?.budget && submitted.decisionContext.budget.scope !== "personal") {
    const field = submitted.decisionContext.budget.scope === "team" ? "budget.teamMaximumYuan" : "budget.unspecifiedMaximumYuan";
    const facts = profile.facts.map(fact => fact.field !== "budget.maximumYuan" ? fact : { ...fact,
      id: `s.${field}.${createHash("sha256").update(String(fact.value)).digest("hex").slice(0, 16)}`, field,
      label: `${submitted.decisionContext!.budget!.scope === "team" ? "全队预算上限" : "范围未明确的预算上限"}：${String(fact.value)}元` });
    if (JSON.stringify(facts) !== JSON.stringify(profile.facts)) return studentProfileSchema.parse({ ...profile, facts, revision: createHash("sha256").update(JSON.stringify(facts)).digest("hex") });
  }
  return profile;
}

const labels: Record<string, string> = {
  skills: "自述技能", interests: "兴趣", weeklyHours: "每周可投入小时", weeklyCommitment: "每周投入",
  "budget.maximumYuan": "个人自付上限", teamStatus: "队伍情况", goalIntent: "当前目标", goalResolution: "目标取舍",
};
const multiValueFields = new Set(["skills", "interests", "goals", "majorFields", "specificSubjects", "preferredOutputs", "taskFormats", "availableResources", "excludedTask", "noviceTask", "unavailableResource", "obtainableResource"]);
const canonicalScalarFields = new Set<string>([...COMPETITION_PROFILE_FIELD_IDS, ...COMPETITION_ELIGIBILITY_FACT_IDS,
  "weeklyHours", "goalIntent", "goalResolution", "primaryGoal", "experienceStatus", "businessActivity", "fixedTeam", "budget", "preparationHorizon"]);
type ExtractedFact = ProfileExtraction["facts"][number];
const isOwnScopedField = (field: string) => !reportedScopeField.test(field);

const teamStageField = /^team[.:_]/iu;
const collectivePatentActor = /^(?:我们(?:团队|小组)?|本(?:团队|队|组))/u;
const individualPatentActor = /^我(?!们)/u;
const pendingAuthorization = /(?:授权|许可|审批|批准).{0,12}(?:待|尚|仍在|未|没|审核中|处理中)|(?:还|尚|未|待|仍在|正在|已(?:经)?提交).{0,12}(?:授权|许可|审批|批准)/u;
const classTrialScopeField = /^(?:assessment|trial|pilot)[.:_]?(?:scope|audience)$/iu;
const externalClassTrialField = /^(?:other|team|members?)[.:_](?:[^.:_]+[.:_])*(?:trial|pilot|assessment|testing|feedback)(?:[.:_]|$)/iu;
const classFeedbackField = /(?:^|[.:_])feedback(?:[.:_]|$)/iu;
const classTrialPermission = String.raw`(?:在(?:老师|教师)(?:已经|已)?(?:同意|允许|许可)下|经(?:老师|教师)(?:同意|允许|许可)后)`;
const classTrialPast = "已经|已|实际|曾经";
const completedCrossClassTrial = new RegExp(
  String.raw`^(?:${classTrialPermission}[，,]?\s*)?(?:(?:这项|这套|本项|同一项)?(?<trialSubject>测验|测试|小测|试用|练习|活动|方案)(?:由)?)?`
  + String.raw`(?:另一(?:个)?班(?:级)?|其他班(?:级)?|外班)也?(?<pastBeforePermission>${classTrialPast})?也?(?:${classTrialPermission})?(?<pastAfterPermission>${classTrialPast})?(?:试用|试做|参与试测)(?<finished>过|了)?`
  + String.raw`(?:[，,]?\s*(?:(?<feedback>(?:并且|并已|并|后)(?:提供|给出|给了|提交)?(?:反馈|意见)(?:了)?)`
  + String.raw`|(?<noFeedback>(?:但|不过)?(?:仍|尚|还)?(?:没有|没|未)(?:给出|提交|提供)?(?:反馈|意见))))?$`, "u");
const currentStageTransitions = [
  {
    kind: "patent",
    field: /^(?:team[.:_])?patent[.:_]?(?:status|stage)$/iu,
    allowExternalActor: false,
    before: /^(?:我们(?:团队|小组)?|本(?:团队|队|组)|我|目前|现在)?(?:已经|已|刚刚|刚|现已)?(?:收到|拿到|获得)(?:(?:这件|本件|该件|本|该)的?)?专利(?:申请)?受理通知(?:书)?$/u,
    after: /^(?:我们(?:团队|小组)?|本(?:团队|队|组|项目)|我)?(?:今天|目前|现在|已经|现已|刚刚|刚|正式|已)*(?:收到|获得|拿到)(?:(?:(?:同一件|这件|该件|本件|本|该)的?)?专利(?:申请)?)?授权通知(?:书)?$/u,
  },
  {
    kind: "trial",
    field: classTrialScopeField,
    allowExternalActor: true,
    before: /^(?:本|这项|这套)?(测验|测试|小测|试用|练习|活动|方案)(?:目前|现在)?(?:只|仅)(?:在|限于)(?:自己|本|我们)(?:的)?(?:小组|组内|班级|班)(?:做过|试过|试用过|开展过|进行过)$/u,
    after: completedCrossClassTrial,
  },
] as const;

function literalPredicate(quote: string): string {
  return quote.trim().replace(/[。！？.!]+$/u, "").trim();
}

function followingSourceClauses(text: string, quote: string): string[] {
  const at = text.indexOf(quote);
  if (at < 0 || at !== text.lastIndexOf(quote)) return [];
  return text.slice(at + quote.length).split(/[，,。；;！？.!?\n]/u)
    .map(clause => literalPredicate(clause).replace(/^(?:但是|但|不过|然而)\s*/u, "")).filter(Boolean);
}

const trialPlanReference = /^(?:这(?:次|项)?|上述|刚才那项)(?:试用|试做|试测)?(?:是|只是|仅是|仍是)(?:一个|后续|未来的)?(?:计划|设想|拟议安排)(?:而已)?$/u;
const trialNonoccurrence = /^(?:(?:这(?:次|项)|上述|刚才的)(?:试用|试做|试测)|另一(?:个)?班(?:级)?|外班)?(?:实际|事实上|目前|现在)?(?:并|还|尚|仍)?(?:没有|没|未)(?:实际|进行|开展|完成)?(?:试用|试做|试测|参与试测)(?:过|了)?$/u;
const trialConditionalReference = /^(?:这(?:次|项)|该(?:次|项)|上述)(?:外班)?(?:试用|试做|试测)(?:许可|授权|安排)?(?:还|仍)?(?:要等|需等|须等|必须等|只有|若|如果)[^，,。；;\n]{1,50}(?:才|方可)(?:进行|开展|实施|试用|试做|生效)$/u;

function qualifiesClassTrial(text: string, quote: string): boolean {
  const following = followingSourceClauses(text, quote);
  return trialPlanReference.test(following[0] ?? "") || trialNonoccurrence.test(following[0] ?? "")
    || following.some(clause => trialConditionalReference.test(clause));
}

function classTrialSourceProject(text: string, quote: string): string | null {
  const at = text.indexOf(quote);
  if (at < 0 || at !== text.lastIndexOf(quote) || /[？?“”‘’「」『』"']/u.test(quote)) return null;
  const tail = text.slice(at + quote.length);
  if (!/[。；;.!！]\s*$/u.test(quote) && !/^\s*(?:[。；;.!！\n]|$)/u.test(tail)) return null;
  if (qualifiesClassTrial(text, quote) || followingSourceClauses(text, quote)
    .some(clause => otherProjectOwner.test(clause) || explicitOtherProjectOwner.test(clause))) return null;
  return projectFromSourcePrefix(text.slice(0, at).trim(), true);
}

function completedTrialResult(match: RegExpExecArray | null): boolean {
  return Boolean(match?.groups?.pastBeforePermission || match?.groups?.pastAfterPermission || match?.groups?.finished || match?.groups?.feedback);
}

function completedClassTrialFactV7(text: string, fact: ExtractedFact): RegExpExecArray | null {
  if (!(classTrialScopeField.test(fact.field) || externalClassTrialField.test(fact.field))) return null;
  const completed = completedCrossClassTrial.exec(literalPredicate(fact.sourceText));
  return completedTrialResult(completed) && classTrialSourceProject(text, fact.sourceText) !== null ? completed : null;
}

/** Granted permission is part of a reported completed trial and feedback.
 * A full cited outcome can settle its state without attributing it to the student. */
function normalizeCompletedClassTrialV7(text: string, fact: ExtractedFact): ExtractedFact {
  if (fact.state !== "conditional" && fact.state !== "affirmed") return fact;
  if (fact.state === "affirmed" && (classTrialScopeField.test(fact.field) || externalClassTrialField.test(fact.field))
    && completedTrialResult(completedCrossClassTrial.exec(literalPredicate(fact.sourceText))) && qualifiesClassTrial(text, fact.sourceText)) {
    return { ...fact, state: "conditional", confirmed: false, evidenceLevel: "unknown" };
  }
  const completed = completedClassTrialFactV7(text, fact);
  if (!completed) return fact;
  if (classFeedbackField.test(fact.field) && !completed.groups?.feedback) {
    return completed.groups?.noFeedback ? { ...fact, state: "negated", value: false, evidenceLevel: "self_report" } : fact;
  }
  if (fact.state === "affirmed" || fact.value === false) return fact;
  return { ...fact, state: "affirmed", value: literalPredicate(fact.sourceText), evidenceLevel: "self_report" };
}

function currentProfileFacts(profile: StudentProfileV6): StudentFactV6[] {
  const inactive = new Set([...profile.retractedFactIds, ...profile.facts.flatMap(fact => fact.supersedesFactIds ?? [])]);
  return profile.facts.filter(fact => fact.state !== "retracted" && !inactive.has(fact.id));
}

const workspaceConfirmation = /^(?:管理员|工作人员|负责人)(?:已经|已)?确认(?:了)?(?:(?:[0-9０-９]{1,3}号)?(工作坊|工坊|会议室|实验室|机房)(?:的)?)?预约$/u;
const reservationTimeSlot = /^(?:周|星期)([一二三四五六日天])\s*[0-9０-９]{1,2}(?:点(?:半|[0-9０-９]{1,2}分)?|[:：][0-9０-９]{2})(?:\s*(?:到|至|[-–—])\s*)[0-9０-９]{1,2}(?:点(?:半|[0-9０-９]{1,2}分)?|[:：][0-9０-９]{2})$/u;
const workspaceRequest = /^(?:我(?:们)?|本人)(?:已经|已|还|也)?(?:申请|预约申请)(?:了)?(?:周|星期)([一二三四五六日天])(?:的)?(?:[0-9０-９]{1,3}号)?(工作坊|工坊|会议室|实验室|机房)(?:时段|的时段|使用时段|预约时段)$/u;
const workspaceField = { 工作坊: "workshop", 工坊: "workshop", 会议室: "meetingRoom", 实验室: "laboratory", 机房: "computerRoom" } as const;

export function literalSubmittedWorkspaceApplicationV7(quote: string): ExtractedFact | undefined {
  const statement = literalPredicate(quote);
  const submitted = /^(?:我(?:们)?|本人)(?:(?:已经|已)申请(?:了)?|(?:还|也)?申请了)/u.exec(statement);
  const request = workspaceRequest.exec(statement);
  if (!submitted || !request) return undefined;
  const workspace = workspaceField[request[2] as keyof typeof workspaceField];
  return { field: `${workspace}.appliedTimeSlot`, value: statement.slice(submitted[0].length), sourceText: quote,
    state: "affirmed", confirmed: true, evidenceLevel: "self_report" };
}

function confirmationWithWorkspaceSlot(sentence: string) {
  const [status, slot, ...rest] = sentence.split(/[，,]/u).map(part => part.trim());
  const day = slot && reservationTimeSlot.exec(slot)?.[1];
  const confirmation = workspaceConfirmation.exec(status);
  if (rest.length || !day || !confirmation) return undefined;
  const label = confirmation[1] as keyof typeof workspaceField | undefined;
  return { sentence, status, slot, day: day.replace("天", "日"), workspace: label ? workspaceField[label] : undefined };
}

/** A bare administrator confirmation can name an existing reservation only
 * when a sourced application on that weekday identifies one workspace. */
export function scopedReservationFactsV7(current: readonly StudentFactV6[], text: string, facts: ExtractedFact[]): {
  facts: ExtractedFact[]; unresolvedReservation?: string;
} {
  if (/[？?“”「」"']|如果|假如|假设|只有|除非|(?:队友|同学|朋友|老师|他|她|别人)说/u.test(text)) return { facts };
  const confirmations = text.split(/[。；;\n]/u).flatMap(sentence => confirmationWithWorkspaceSlot(sentence.trim()) ?? []);
  if (confirmations.length !== 1) return { facts };
  const { sentence, status, slot, day, workspace } = confirmations[0];
  const quoted = new Set([sentence, status, slot]);
  const canRebind = (fact: ExtractedFact) => isOwnScopedField(fact.field) && quoted.has(literalPredicate(fact.sourceText));
  if (!facts.some(fact => canRebind(fact) && fact.state === "affirmed" && fact.value !== false)) return { facts };

  const active = current.filter(fact => isOwnScopedField(fact.field) && fact.state === "affirmed" && fact.confirmed && fact.answerId && fact.originalText)
    .map(fact => ({ answerId: fact.answerId, source: literalPredicate(fact.originalText!).replace(/^(?:补充|说明)[：:]\s*/u, "") }));
  const requests = active.flatMap(({ answerId, source }) => {
    const match = workspaceRequest.exec(source);
    if (!match || match[1].replace("天", "日") !== day) return [];
    return [{ identity: JSON.stringify([answerId, source]), field: workspaceField[match[2] as keyof typeof workspaceField] }];
  });
  const uniqueRequest = new Set(requests.map(request => request.identity)).size === 1 ? requests[0].field : undefined;
  const otherBookedWorkspace = active.some(({ source }) => {
    // A saved canonical slot quotes the explicit confirmation and time together.
    const confirmed = confirmationWithWorkspaceSlot(source);
    if (confirmed?.workspace) return confirmed.day === day && confirmed.workspace !== uniqueRequest;
    const bookedDay = source.match(/(?:周|星期)([一二三四五六日天])/u)?.[1]?.replace("天", "日");
    const bookedWorkspace = source.match(/工作坊|工坊|会议室|实验室|机房/u)?.[0];
    return bookedDay === day && bookedWorkspace && workspaceField[bookedWorkspace as keyof typeof workspaceField] !== uniqueRequest
      && /(?:已经|已|刚)(?:成功)?(?:预约|预订)|(?:预约|预订)(?:已确认|成功)/u.test(source);
  });
  const namespace = workspace ?? (otherBookedWorkspace ? undefined : uniqueRequest);
  const remaining = facts.filter(fact => !canRebind(fact));
  if (!namespace) return { facts: remaining, unresolvedReservation: sentence };
  const scoped = [
    { field: `${namespace}.reservationStatus`, value: "confirmed", sourceText: status },
    { field: `${namespace}.reservationTimeSlot`, value: slot, sourceText: sentence },
  ].map((fact): ExtractedFact => ({ ...fact, state: "affirmed", confirmed: true, evidenceLevel: "self_report" }));
  return { facts: [...remaining, ...scoped] };
}

/** A follow-up may use a different field for the same current stage. Bind the
 * change to one sourced active stage and leave earlier events in update history. */
function sourcedStageUpdates(profile: StudentProfileV6, text: string, facts: ExtractedFact[]) {
  const active = currentProfileFacts(profile);
  return currentStageTransitions.flatMap(rule => {
    if (rule.kind === "patent" && /[？?“”「」"']|如果|假如|假设|将来|未来|计划|打算|可能|据说|传闻|(?:队友|朋友|同学|导师|老师|校方|学校|管理员|他|她|别人)说|(?:另(?:一|个)|其他|别的|不同)(?:件|套|项|个)?(?:专利|发明|项目|活动|方案|测验|作品)/u.test(text)) return [];
    const prior = active.filter(fact => rule.field.test(fact.field) && fact.confirmed && fact.state === "affirmed" && fact.answerId && fact.originalText);
    if (prior.length !== 1) return [];
    const [previous] = prior;
    const before = literalPredicate(previous.originalText!);
    const oldStage = rule.before.exec(before);
    if (!oldStage) return [];
    const previousPrefix = storedFactSourcePrefix(previous, profile.updates);
    if (previousPrefix === null) return [];
    const previousProject = projectFromSourcePrefix(previousPrefix, true);
    if (previousProject === null) return [];
    const teamPatent = rule.kind === "patent" && teamStageField.test(previous.field);
    if (teamPatent && !collectivePatentActor.test(before)) return [];
    const competingApproval = teamPatent && active.some(other => other.id !== previous.id && other.answerId
      && (other.state === "unknown" || other.state === "affirmed") && pendingAuthorization.test(literalPredicate(other.originalText ?? "")));
    const matching = facts.filter(fact => {
      const after = literalPredicate(fact.sourceText);
      const newStage = rule.after.exec(after);
      if (fact.state !== "affirmed" || fact.value === false || !newStage
        || !(rule.allowExternalActor || isOwnScopedField(fact.field) || teamPatent && teamStageField.test(fact.field))) return false;
      if (rule.kind === "trial") {
        const oldSubject = oldStage[1], newSubject = newStage.groups?.trialSubject;
        const assessment = /^(?:测验|测试|小测)$/u;
        return completedTrialResult(newStage) && classTrialSourceProject(text, fact.sourceText) === previousProject
          && (!newSubject || oldSubject === newSubject || assessment.test(oldSubject) && assessment.test(newSubject));
      }
      if (!completeProfileClause(text, fact.sourceText)) return false;
      const at = text.indexOf(fact.sourceText);
      if (at !== text.lastIndexOf(fact.sourceText) || projectFromSourcePrefix(text.slice(0, at).trim(), true) !== previousProject) return false;
      if (collectivePatentActor.test(before) && individualPatentActor.test(after)
        || individualPatentActor.test(before) && collectivePatentActor.test(after)) return false;
      return !competingApproval || /专利(?:申请)?授权通知/u.test(after);
    });
    if (new Set(matching.map(fact => fact.sourceText)).size !== 1) return [];
    const fact = matching[0];
    return [{ fact: { ...fact, field: previous.field, value: literalPredicate(fact.sourceText) }, targetFactIds: [previous.id],
      replacedAliases: teamPatent ? matching : [] }];
  });
}

const competitionDisplayField = "competition_display_permission";
const classroomDisplayGrant = /^(?:(?:本|该|这份)?(?:材料|作品|报告|项目))?(?:已经|已|现已|目前)?(?:获准|授权|获授权|允许|获许可)(?:在)?(?:课堂|课内)(?:上)?(?:展示|演示)$/u;
const competitionDisplaySubject = /^(?:(?:本|该|这份)?(?:材料|作品|报告|项目)(?:的)?)?(?:在)?(?:比赛|竞赛|赛事|赛场)(?:的|上)?公开(?:展示|演示|发布)(?:申请|权限|许可)?/u;
const pendingDisplay = /^(?:(?:目前|仍然|仍|尚|还|暂时)*(?:在审批|审批中|待审批|未核实|待确认)|(?:目前|仍然|仍|尚|还|暂时)+(?:未获准|未获批|没获准|没有获批))$/u;
const displayApprovalHeader = /^(?:明确)?(?:更正|纠正|修改|更新|补充|说明)(?:一下)?[：:]\s*/u;
const displayApprovalTail = /(?:比赛|竞赛|赛事|赛场)(?:的|上)?公开(?:展示|演示|发布)(?:申请|权限|许可)?([^，,。；;\n]*)$/u;
const displayApprovalProjectLead = /^([\p{L}\p{N}_-]{1,24}?项目|项目[\p{L}\p{N}_-]{1,24}?)(?:的)?(?=(?:在)?(?:比赛|竞赛|赛事|赛场))/u;
const displayApplicationSubmitted = /^(?:已经|已)(?:提交|递交)(?:了)?(?:申请|材料|申请材料)?$/u;
const genericDisplayUnknown = /^(?:展示|演示)(?:权限|许可)(?:还|仍|尚|暂时)*(?:没核实|未核实|没确认|未确认|不确定|待核实)$/u;
const goalDoesNotApproveDisplay = /^(?:上述|上面的?|刚才的?|当前的?)?(?:主要)?目标(?:调整|改变|更改|变更|更正|变化)(?:并)?(?:不等于|不代表|不能说明)(?:竞赛)?(?:公开)?(?:展示|演示)审批(?:已经|已)通过$/u;
export const DISPLAY_APPROVAL_INFERENCE_FIELD_V7 = "display_permission.approvalInference";
const personallyCheckedReporting = /^(?:(?:我|我们|本人)(?:只|仅)|(?:只能|仅能|只可|仅可))(?:能|可)?(?:报告|记录|写入|采用)(?:我|本人|自己)?(?:亲自|本人|亲手)(?:核对|核验|查阅|检查|验证)过?的(?:内容|材料|资料|结果)$/u;

function isPendingCompetitionDisplay(quote: string): boolean {
  const text = literalPredicate(quote), subject = text.match(competitionDisplaySubject)?.[0];
  return Boolean(subject && pendingDisplay.test(text.slice(subject.length)));
}

function displayApprovalDecision(suffix: string) {
  if (/^(?:审批)?(?:已经|已)(?:正式)?(?:通过(?:审批)?|获批|获准|获授权)$/u.test(suffix)) return "approved";
  if (/^(?:审批(?:已经|已)?(?:未通过|不通过|未获批)|(?:已经|已)被(?:拒绝|驳回))$/u.test(suffix)) return "denied";
  return undefined;
}

function scopedDisplayApproval(quote: string) {
  const text = literalPredicate(quote).replace(displayApprovalHeader, "");
  const lead = displayApprovalProjectLead.exec(text);
  const project = lead ? storageProjectName(lead[1]) : "";
  if (project === null) return undefined;
  const body = lead ? text.slice(lead[0].length) : text;
  const subject = body.match(competitionDisplaySubject)?.[0];
  if (!subject) return undefined;
  const suffix = body.slice(subject.length);
  const state = pendingDisplay.test(suffix) ? "pending" : displayApplicationSubmitted.test(suffix) ? "submitted" : displayApprovalDecision(suffix);
  const approvalSubject = subject.replace(/(?:申请|权限|许可)$/u, "").replace(/在(?=(?:比赛|竞赛|赛事|赛场))/u, "")
    .replace(/((?:比赛|竞赛|赛事|赛场))(?:的|上)(?=公开)/u, "$1");
  return state ? { project, subject: approvalSubject, state } : undefined;
}

function isDisplayDenial(state: StudentFactV6["state"] | undefined, value: StudentFactV6["value"] | undefined): boolean {
  return state === "negated" || state === "affirmed" && (value === false || typeof value === "string"
    && /^(?:审批)?(?:未通过|不通过|未获批|被拒绝|被驳回)$/u.test(literalPredicate(value)));
}

/** Replace a uniquely identified pending approval when the student reports the
 * concrete outcome for that same public display. */
function pendingDisplayResolution(profile: Pick<StudentProfileV6, "facts" | "updates">, text: string, quote: string,
  state: StudentFactV6["state"] | undefined, value: StudentFactV6["value"] | undefined) {
  const next = scopedDisplayApproval(quote);
  if (!next || !["approved", "denied"].includes(next.state)
    || (next.state === "approved" ? state !== "affirmed" || value === false : !isDisplayDenial(state, value))) return undefined;
  const statement = literalPredicate(quote);
  const ownSentence = text.split(/[。；;\n]/u).find(sentence => sentence.includes(statement));
  if (!ownSentence || /[？?“”「」"']|如果|假如|假设|一旦|只要|除非|将来|未来|计划|打算|可能|据说|传闻|(?:队友|同学|朋友|老师|校方|管理员|他|她|别人)说/u.test(ownSentence)) return undefined;
  const clause = statement.replace(displayApprovalHeader, "");
  const start = text.indexOf(quote);
  const sourceIsUnique = start >= 0 && text.lastIndexOf(quote) === start
    && ownSentence.split(/[，,]/u).some(part => literalPredicate(part).replace(displayApprovalHeader, "") === clause);
  const project = sourceIsUnique ? next.project || projectFromSourcePrefix(text.slice(0, start).trim()) : null;
  const pending = profile.facts.flatMap(old => {
    if (!isOwnScopedField(old.field) || old.state !== "unknown" || !old.answerId || !old.originalText) return [];
    const prior = scopedDisplayApproval(old.originalText);
    return prior?.state === "pending" ? [{ old, subject: prior.subject,
      project: prior.project || projectScopeFromStoredSource(old, "本项目", profile.updates) }] : [];
  });
  const targets = project === null ? [] : pending.filter(row => row.subject === next.subject && row.project === project).map(row => row.old);
  const targetAssertions = new Set(targets.map(old => JSON.stringify([old.answerId, old.originalText]))).size;
  if (targetAssertions === 1) return { targets, unresolved: false };
  return { targets: [], unresolved: targetAssertions > 1 || pending.length > 0 && !project };
}

export function unresolvedDisplayApprovalV7(profile: Pick<StudentProfileV6, "facts" | "updates">, text: string, facts: readonly ExtractedFact[]): string | undefined {
  return facts.find(fact => isOwnScopedField(fact.field)
    && pendingDisplayResolution(profile, text, fact.sourceText, fact.state, fact.value)?.unresolved)?.sourceText;
}

export function retainsPendingDisplayApprovalV7(profile: StudentProfileV6, quote: string): boolean {
  if (/[？?“”「」"']/u.test(quote) || !goalDoesNotApproveDisplay.test(literalPredicate(quote))) return false;
  const active = currentProfileFacts(profile).filter(fact => isOwnScopedField(fact.field) && fact.originalText);
  return active.some(fact => fact.state === "unknown" && isPendingCompetitionDisplay(fact.originalText!))
    && !active.some(fact => fact.confirmed && (fact.state === "affirmed" || fact.state === "negated")
      && scopedDisplayApproval(fact.originalText!)?.state !== "submitted"
      && (fact.field === competitionDisplayField || competitionDisplaySubject.test(literalPredicate(fact.originalText!))));
}

/** The user can explicitly rule out an inference without changing either
 * the goal or the underlying approval status. */
function literalApprovalInferenceFactsV7(text: string, facts: ExtractedFact[]): ExtractedFact[] {
  if (/[？?“”「」"']|如果|假如|假设|一旦|只要|除非|(?:队友|同学|朋友|老师|他|她|别人)说/u.test(text)) return facts;
  const statements = new Map(text.split(/[，,。；;\n]/u).map(clause => clause.trim())
    .filter(clause => goalDoesNotApproveDisplay.test(literalPredicate(clause))).map(clause => [literalPredicate(clause), clause]));
  if (!statements.size) return facts;
  const remaining = facts.filter(fact => {
    const predicate = literalPredicate(fact.sourceText);
    if (!isOwnScopedField(fact.field) || !statements.has(predicate) || !completeProfileClause(text, fact.sourceText)) return true;
    statements.set(predicate, fact.sourceText);
    return false;
  });
  return [...remaining, ...[...statements].map(([value, sourceText]): ExtractedFact => ({
    field: DISPLAY_APPROVAL_INFERENCE_FIELD_V7, value, sourceText, state: "negated", confirmed: true, evidenceLevel: "self_report",
  }))];
}

function scopedDisplayFacts(facts: ExtractedFact[]): ExtractedFact[] {
  return facts.map(fact => {
    if (!isOwnScopedField(fact.field)) return fact;
    const quote = literalPredicate(fact.sourceText);
    if (fact.state !== "conditional" && fact.state !== "retracted" && isPendingCompetitionDisplay(quote)) {
      return { ...fact, field: competitionDisplayField, value: quote, state: "unknown", confirmed: false };
    }
    if (fact.state === "affirmed" && fact.value !== false && scopedDisplayApproval(quote)?.state === "submitted") {
      return { ...fact, field: `${competitionDisplayField}.applicationSubmitted` };
    }
    if (scopedDisplayApproval(quote)?.state === "denied" && isDisplayDenial(fact.state, fact.value)) {
      return { ...fact, state: "negated", value: false, confirmed: true };
    }
    return fact;
  });
}

function resolvedUnknownFields(facts: StudentFactV6[], fields: Iterable<string>): string[] {
  const confirmed = facts.filter(fact => fact.confirmed && ["affirmed", "negated"].includes(fact.state));
  const known = new Set(confirmed.map(fact => fact.field));
  const scope = facts.find(fact => fact.field === competitionDisplayField && fact.state === "unknown" && fact.originalText && isPendingCompetitionDisplay(fact.originalText));
  const classroom = confirmed.some(fact => isOwnScopedField(fact.field) && fact.state === "affirmed" && fact.value !== false && fact.answerId && fact.answerId === scope?.answerId
    && fact.originalText && classroomDisplayGrant.test(literalPredicate(fact.originalText)));
  const unresolved = (field: string) => facts.some(fact => fact.field === field && ["unknown", "conditional"].includes(fact.state));
  const pendingPublic = facts.some(fact => isOwnScopedField(fact.field) && fact.state === "unknown"
    && fact.originalText && scopedDisplayApproval(fact.originalText)?.state === "pending");
  if (pendingPublic || unresolved(competitionDisplayField)) known.delete(competitionDisplayField);
  else if (confirmed.some(fact => {
    if (!isOwnScopedField(fact.field) || !fact.originalText) return false;
    const approval = scopedDisplayApproval(fact.originalText);
    return approval?.project === "" && (approval.state === "approved" && fact.state === "affirmed" && fact.value !== false
      || approval.state === "denied" && fact.state === "negated");
  })) known.add(competitionDisplayField);
  if (classroom && !unresolved("display_permission")) known.add("display_permission");
  if (scope && !unresolved("display_permission.competition_public")) known.add("display_permission.competition_public");
  if (!unresolved("reporting_limit") && confirmed.some(fact => isOwnScopedField(fact.field) && fact.state === "affirmed" && fact.value !== false
    && fact.originalText && personallyCheckedReporting.test(literalPredicate(fact.originalText)))) known.add("reporting_limit");
  return [...new Set(fields)].filter(field => !known.has(field));
}

function predicateTemplate(quote: string): string {
  return quote.normalize("NFC").trim()
    .replace(/^(?:更正|纠正|修改|更新|补充|说明|明确)(?:一下)?[：:]\s*/u, "").replace(/[。；;.!！]+$/u, "")
    .replace(/^(?:仍然|仍|也)/u, "").replace(/不(?=允许|可以|能|可|愿|会|具备)|未(?=获|取得|完成)|没(?=有)/gu, "");
}

const storageCorrectionLead = /^(?:更正|纠正|修改|更新)([^：:，,。；;\n]{0,40})[：:]\s*/u;
const storageHeading = /^(.*?)(?:的)?(?:文件)?(?:存储|储存|保存|存放|备份)(?:安排|权限|许可|地点|位置|范围|条件|限制)?$/u;
const storagePermissionAddition = /^(?:另(?:外)?|此外|新增|追加)(?:获准|允许|得到授权|获得许可)在[^，,。；;\n]{1,40}?(?:做)?(?:离线)?(?:保存|存储|储存|存放|备份)$/u;
const storageDisclosureRestriction = /^(?:不得|不能|不允许|未获准)(?:公开|对外)(?:上传|发布|共享)$/u;
const storagePermissionDeferral = /^(?:这|该|上述|刚才的)(?:条|项|份)?(?:离线)?(备份|保存|存储|储存|存放)(?:的)?(?:许可|权限|授权)(?:(?:目前|仍|尚|还)*(?:未|没)(?:正式)?生效|(?:还|仍)?(?:要等|需等|须等|等待|待|只有|若|如果)[^，,。；;\n]{1,48}(?:才|方可)(?:生效|有效|执行|使用))$/u;
export const DEFERRED_STORAGE_PERMISSION_SCOPE_ERROR_V7 = "deferred_storage_permission_requires_separate_state";
const unrelatedStorageScope = /[？?“”「」"']|如果|假如|假设|一旦|只要|只有|仅当|除非|前提是|将来|未来|计划|打算|可能|(?:另一(?:个)?|其他|别的|不同)[^，,。；;\n]{0,6}项目|(?:队友|朋友|同学|老师|他|她|别人)说/u;

function retainedStorageResource(quote: string): string | undefined {
  return literalPredicate(quote).replace(storageCorrectionLead, "")
    .match(/^(.{1,40}?)(?:仍然|仍|依然|继续)(?:可用|有效|可以使用|允许使用|保持有效)$/u)?.[1];
}

/** A storage correction can continue through its own permission clauses.
 * A following independent statement has its own time and scope. */
function storageCorrectionSource(text: string): string {
  const source = text.trim();
  const [first, ...following] = source.split(/(?<=[。！？；;\n]|[.!?](?=\s|$))/u);
  let end = first.length;
  for (const sentence of following) {
    const clauses = sentence.split(/[，,；;]/u).map(literalPredicate).filter(Boolean);
    if (!clauses.length || !clauses.every(clause => retainedStorageResource(clause)
      || storagePermissionAddition.test(clause) || storageDisclosureRestriction.test(clause))) break;
    end += sentence.length;
  }
  return source.slice(0, end);
}

function deferredStorageGrantsV7(text: string, correction?: string): string[] {
  if (!storageCorrectionLead.test(text.trim())) return [];
  const clauses = (correction ?? storageCorrectionSource(text)).replace(storageCorrectionLead, "").split(/[，,。；;\n]/u).map(literalPredicate);
  return clauses.filter(clause => storagePermissionAddition.test(clause)
    && followingSourceClauses(text, clause).some(following => {
      const action = storagePermissionDeferral.exec(following)?.[1];
      return action !== undefined && clause.endsWith(action);
    }));
}

function normalizeDeferredStorageGrantV7(fact: ExtractedFact, deferred: readonly string[]): ExtractedFact {
  if (fact.state !== "affirmed" || fact.value === false || !deferred.some(grant => fact.sourceText.includes(grant))) return fact;
  if (!deferred.includes(literalPredicate(fact.sourceText))) throw new Error(DEFERRED_STORAGE_PERMISSION_SCOPE_ERROR_V7);
  return { ...fact, state: "conditional", confirmed: false };
}

function storageProjectName(subject: string): string | null {
  const name = subject.trim().normalize("NFC");
  if (/^(?:本|这个|当前|该)项目$/u.test(name)) return "";
  if (/^(?:另|其他|别的|不同|某|上(?:一|个)|下(?:一|个)|之前|原来|我们的?|自己的?|我(?:的|朋友|同学|队友|老师)|(?:他|她|对方)(?:们)?的)/u.test(name)) return null;
  return /^(?:[\p{L}\p{N}_-]{1,24}项目|项目[\p{L}\p{N}_-]{1,24})$/u.test(name) ? name : null;
}

function storedFactSourcePrefix(old: StudentFactV6, updates: StudentProfileV6["updates"]): string | null {
  const quote = old.originalText;
  if (!quote) return null;
  const update = updates?.find(row => row.answerId === old.answerId && row.addedFactIds.includes(old.id));
  if (!update) return old.sourceSpan?.start ? null : "";
  const at = old.sourceSpan?.start ?? update.originalText.indexOf(quote);
  if (at < 0 || !update.originalText.startsWith(quote, at)) return null;
  if (!old.sourceSpan && at !== update.originalText.lastIndexOf(quote)) return null;
  return update.originalText.slice(0, at).trim();
}

function projectScopeFromStoredSource(old: StudentFactV6, subject: string, updates: StudentProfileV6["updates"]): string | null {
  const direct = storageProjectName(subject);
  if (direct !== "") return direct;
  const quotedTitle = old.originalText!.trim().match(storageCorrectionLead)?.[1];
  if (quotedTitle) return storageProjectName(quotedTitle.match(storageHeading)?.[1] ?? quotedTitle);
  const prefix = storedFactSourcePrefix(old, updates);
  return prefix === null ? null : projectFromSourcePrefix(prefix);
}

function projectFromSourcePrefix(prefix: string, requireHeading = false): string | null {
  if (!prefix || !prefix.includes("项目")) return requireHeading && prefix ? null : "";
  const named = prefix.match(/^(?:(?:现在|目前)?(?:补充(?:说明)?|说明|谈谈|说说|关于)[：:]?\s*)?([\p{L}\p{N}_-]{1,24}?项目|项目[\p{L}\p{N}_-]{1,24}?)(?:的?(?:存储|储存|保存|备份)(?:安排|权限)?)?[。；;：:]$/u)?.[1];
  return named ? storageProjectName(named) : null;
}

function storageFieldScope(field: string, project: string): string | null {
  const [namespace, property = ""] = field.split(/[.:]/u);
  if (/^(?:storage|project_storage)$/iu.test(namespace) || /^project$/iu.test(namespace)
    && (/^storage/iu.test(property) || /^workFiles?Storage(?:policy|scope|permissions?|arrangement|locations?)?$/iu.test(property))) return "storage";
  const flatProperty = namespace.match(/^(?:project[_-])?storage[_-]([a-z][a-z_-]*)$/iu)?.[1]?.replace(/[_-]/gu, "");
  if (flatProperty && /^(?:scope|policy|permissions?|arrangement|locations?|(?:server|workfiles?|backup|offlinebackup|publicupload)(?:scope|policy|permissions?|arrangement|locations?|availability)?)$/iu.test(flatProperty)) return "storage";
  return project && /^(?:project|项目)[_-][\p{L}\p{N}_-]+$/iu.test(namespace) ? namespace : null;
}

type PermissionAssertion = { field: string; state: string; sourceText: string; value?: StudentFactV6["value"] };

/** An empty name denotes a correction of current storage. Null denotes an
 * unbound project and undefined denotes a different kind of statement. */
export function storagePermissionCorrectionProjectV7(text: string, quote: string): string | null | undefined {
  const title = text.trim().match(storageCorrectionLead)?.[1];
  if (title === undefined || !retainedStorageResource(quote)) return undefined;
  const subject = title.match(storageHeading)?.[1];
  if (subject !== undefined) return subject ? storageProjectName(subject) : "";
  if (!text.trim().replace(storageCorrectionLead, "").split(/[，,。；;\n]/u)
    .some(clause => storagePermissionAddition.test(literalPredicate(clause)))) return undefined;
  return title ? storageProjectName(title) : "";
}

export function isCurrentStorageGrantV7(fact: StudentFactV6, updates: StudentProfileV6["updates"]): boolean {
  return storageFieldScope(fact.field, "") === "storage" && Boolean(fact.originalText
    && /^(?:我|我们)(?:已经|已|目前)?(?:获准|获授权|得到授权|获得许可)在/u.test(literalPredicate(fact.originalText))
    && projectScopeFromStoredSource(fact, "本项目", updates) === "");
}

/** Bind the retained resource and its previous exclusive predicate to the same
 * project as the grant. A deferred grant supports retention without retirement. */
export function storagePermissionExpansionTargetsV7(profile: Pick<StudentProfileV6, "facts" | "updates">, text: string,
  quote: string, facts: readonly PermissionAssertion[], field?: string, grantState: "affirmed" | "conditional" = "affirmed"): StudentFactV6[] {
  const correction = storageCorrectionSource(text);
  const project = storagePermissionCorrectionProjectV7(correction, quote);
  if (project == null || unrelatedStorageScope.test(correction)) return [];
  const body = correction.replace(storageCorrectionLead, ""), retained = literalPredicate(quote).replace(storageCorrectionLead, "");
  if (!completeProfileClause(body, retained)) return [];
  const deferred = deferredStorageGrantsV7(text, correction);
  const additions = new Set(facts.filter(fact => {
    const grant = literalPredicate(fact.sourceText);
    return fact.state === grantState && fact.value !== false && storagePermissionAddition.test(grant)
      && deferred.includes(grant) === (grantState === "conditional") && completeProfileClause(body, fact.sourceText);
  })
    .map(fact => storageFieldScope(fact.field, project)).filter(scope => scope !== null));
  if (!additions.size) return [];
  const resource = retainedStorageResource(quote)!.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const exclusive = new RegExp("^(.*?)(?:只允许|仅允许|仅限|只限)(?:在)?" + resource + "(?:保存|存储|储存|存放|备份)[^，,。；;\\n]{0,60}$", "u");
  const targets = profile.facts.filter(old => {
    if (!old.confirmed || old.state !== "affirmed" || old.value === false || !old.answerId || !old.originalText) return false;
    const scope = storageFieldScope(old.field, project);
    if (!scope || !additions.has(scope) || field !== undefined && storageFieldScope(field, project) !== scope) return false;
    const predicate = literalPredicate(old.originalText).replace(storageCorrectionLead, "")
      .replace(/^(?:补充|说明|明确)(?:一下)?[：:]\s*/u, "");
    const priorSubject = predicate.match(exclusive)?.[1];
    return priorSubject !== undefined && projectScopeFromStoredSource(old, priorSubject, profile.updates) === project;
  });
  return new Set(targets.map(old => JSON.stringify([old.answerId, old.originalText]))).size === 1 ? targets : [];
}

/** Open assertions coexist unless their source replaces an identified predicate. */
function selfReportTargetIds(profile: StudentProfileV6, field: string, value: StudentFactV6["value"] | undefined,
  state: StudentFactV6["state"] | undefined, quote: string, text: string): string[] {
  const current = profile.facts.filter(old => old.field === field && old.state !== "retracted" && !profile.retractedFactIds.includes(old.id)
    && (state !== "conditional" || old.state === "conditional"));
  if ((state === undefined || state === "affirmed") && storagePermissionCorrectionProjectV7(text, quote) !== undefined) return [];
  const displaySuffix = displayApprovalTail.exec(literalPredicate(quote))?.[1];
  if (displaySuffix !== undefined && (displayApprovalDecision(displaySuffix) || displayApplicationSubmitted.test(displaySuffix))) return [];
  const completedState = /(?:^|[_ -])(?:completed|finished|done|confirmed|ready)(?:$|[_ -])|已(?:完成|确认|就绪)/iu.test(String(value));
  if (current.length === 1 && /(?:^|[._])(?:status|state)$/iu.test(field) && state === "affirmed" && completedState
    && /尚未|还未|还没|未曾|没有/u.test(current[0].originalText ?? "")
    && !/另一|其他|别的|另外|不同(?:的)?项目/u.test(quote)) return [current[0].id];
  if (multiValueFields.has(field)) return current.filter(old => Object.is(old.value, value)).map(old => old.id);
  if (canonicalScalarFields.has(field) || /^experience\.\d+\.(?:task|contribution|completion|challenge)$|^budget\.(?:maximumYuan|teamMaximumYuan|unspecifiedMaximumYuan)$|^qualification\./u.test(field)) return current.map(old => old.id);
  if (state === "retracted") {
    const matching = current.filter(old => Object.is(old.value, value));
    if (current.length === 1 || /全部|所有|整个|整项/u.test(quote)) return current.map(old => old.id);
    if (matching.length === 1) return matching.map(old => old.id);
    const quoted = current.filter(old => old.originalText && quote.includes(old.originalText.replace(/[。.!！]+$/u, "")));
    if (quoted.length) return quoted.map(old => old.id);
    if (current.length) throw new Error("ambiguous_profile_retraction_target");
    return [];
  }
  const assertion = quote.trim().replace(/^(?:更正|纠正|修改|更新|说明|明确)[^：:，,。；;\n]{0,40}[：:]\s*/u, "");
  const additive = /^(?:另外|此外|另|新增|追加|增补|又|也|还|同时|补充)/u.test(assertion);
  const replacement = !additive && /更正|纠正|改为|改成|更改为|调整为|替换为|取代/u.test(quote);
  if (replacement) {
    if (current.length <= 1 || /全部|所有|整体|统一|仅|只/u.test(quote)) return current.map(old => old.id);
    const mentioned = current.filter(old => typeof old.value === "string" && old.value !== value && quote.includes(old.value));
    if (mentioned.length) return mentioned.map(old => old.id);
    throw new Error("ambiguous_profile_replacement_target");
  }
  return current.filter(old => old.originalText && predicateTemplate(old.originalText) === predicateTemplate(quote)).map(old => old.id);
}

/** Retire only a uniquely bound replaced predicate across open field names.
 * Neutral source facets and unrelated predicates retain their provenance. */
function explicitAssertionRetractionsV7(profile: StudentProfileV6, facts: ProfileExtraction["facts"]): ProfileMutation[] {
  const own = isOwnScopedField;
  const current = currentProfileFacts(profile).filter(fact => own(fact.field) && fact.answerId && fact.originalText);
  const retractions = new Map<string, ProfileMutation>();
  const retire = (selected: typeof current, quote: string) => {
    const assertions = new Map(selected.map(fact => [JSON.stringify([fact.answerId, fact.originalText]), fact]));
    if (assertions.size !== 1) return;
    for (const old of selected)
      retractions.set(old.id, { operation: "retract", field: old.field, targetFactIds: [old.id], quote });
  };
  for (const fact of facts.filter(fact => own(fact.field) && fact.state === "affirmed" && typeof fact.value === "number")) {
    const changed = fact.sourceText.trim().match(/^(?:只|仅)?把?(?:材料|耗材)预算(?:改成|改为|调整为)(\d+(?:\.\d+)?)(?:元|块)$/u);
    if (!changed || Number(changed[1]) !== fact.value) continue;
    retire(current.filter(old => ["affirmed", "conditional"].includes(old.state) && typeof old.value === "number"
      && Number(old.originalText!.match(/^(?:计划|预计)?(?:材料|耗材)预算(\d+(?:\.\d+)?)(?:元|块)[。.!！]?$/u)?.[1]) === old.value), fact.sourceText);
  }
  return [...retractions.values()];
}


/** Apply only traceable assertions from this utterance. State, original wording,
 * superseded IDs and exact numeric values survive; absence is never a denial. */
export function applyProfileMutationsV7(profile: StudentProfileV6, mutations: ProfileMutation[], source: ProfileSourceV7,
  legacy: CompetitionRecommendationProfileV5 | undefined, evidence?: ReadonlyMap<string, StudentFactV6["evidenceLevel"]>): StudentProfileV6 {
  studentProfileSchema.parse(profile);
  if (!source.answerId || !source.text.trim() || source.text.length > 1600 || !Number.isFinite(Date.parse(source.at))) throw new Error("invalid_profile_source");
  const updatedAt = new Date(source.at).toISOString();
  if (!mutations.length) return profile;
  if (mutations.length > 160 || (profile.updates?.length ?? 0) >= 80) throw new Error("profile_update_limit");
  const parsed = mutations.map(mutation => profileMutationSchema.parse(mutation));
  // Exact hours and the legacy time bucket describe the same current fact. A
  // later edit must not leave an old, contradictory representation in the pool.
  const hours = parsed.findLast(mutation => mutation.field === "weeklyHours" && mutation.operation === "set");
  const commitment = parsed.findLast(mutation => mutation.field === "weeklyCommitment");
  if (hours && !commitment && (typeof hours.value === "number" || hours.state === "unknown")) parsed.push({
    ...hours, field: "weeklyCommitment", value: hours.state === "unknown" ? "unknown" : Number(hours.value) < 5 ? "under-5" : Number(hours.value) <= 10 ? "5-10" : "over-10",
    targetFactIds: profile.facts.filter(fact => fact.field === "weeklyCommitment" && (hours.state !== "conditional" || fact.state === "conditional")).map(fact => fact.id),
  });
  if (commitment && !hours && commitment.state !== "conditional") {
    const targets = profile.facts.filter(fact => fact.field === "weeklyHours").map(fact => fact.id);
    if (targets.length) parsed.push({ operation: "retract", field: "weeklyHours", targetFactIds: targets, quote: commitment.quote });
  }
  const goal = parsed.findLast(mutation => mutation.field === "goalIntent" && mutation.state !== "conditional");
  if (goal && !parsed.some(mutation => mutation.field === "primaryGoal")) {
    const targets = profile.facts.filter(fact => fact.field === "primaryGoal").map(fact => fact.id);
    if (targets.length) parsed.push({ operation: "retract", field: "primaryGoal", targetFactIds: targets, quote: goal.quote });
  }
  for (const mutation of parsed) {
    if (!isEditableProfileField(mutation.field) || !source.text.includes(mutation.quote)) throw new Error("untraceable_profile_update");
    if (mutation.targetFactIds.some(id => !profile.facts.some(fact => fact.id === id && fact.field === mutation.field))) throw new Error("foreign_profile_fact");
    if (mutation.operation === "retract" && !mutation.targetFactIds.length) throw new Error("retraction_requires_fact");
    if (mutation.operation === "set" && mutation.value === undefined) throw new Error("profile_value_required");
    // Retraction has no value; explicit unknown remains unknown instead of
    // being rejected or coerced into a negative boolean/numeric assertion.
    if (mutation.operation === "retract" || mutation.state === "unknown") continue;
    if (mutation.field.startsWith("qualification.") && typeof mutation.value !== "boolean") throw new Error("qualification_requires_boolean");
    if (/^eligibility\.(age|year|teamSize)$/.test(mutation.field) && (typeof mutation.value !== "number" || !Number.isInteger(mutation.value) || mutation.value < 0 || mutation.value > 150)) throw new Error("invalid_qualification_number");
    if (/^eligibility\.(enrolled|fullTime|sameInstitutionTeam|sameCountryTeam|mentor|professionalDeveloper)$/.test(mutation.field) && typeof mutation.value !== "boolean") throw new Error("invalid_qualification_boolean");
    if (mutation.field === "weeklyHours" && (typeof mutation.value !== "number" || mutation.value < 0 || mutation.value > 168)) throw new Error("invalid_weekly_hours");
    if (/^budget\.(?:maximumYuan|teamMaximumYuan|unspecifiedMaximumYuan)$/.test(mutation.field) && (typeof mutation.value !== "number" || mutation.value < 0 || mutation.value > 1_000_000)) throw new Error("invalid_budget");
  }
  if (storageCorrectionLead.test(source.text.trim())) {
    const permissionChanges = parsed.filter(mutation => mutation.operation === "set" && (mutation.state ?? "affirmed") === "affirmed" && mutation.value !== false);
    const deferred = deferredStorageGrantsV7(source.text);
    if (permissionChanges.some(mutation => deferred.some(grant => mutation.quote.includes(grant)))) throw new Error(DEFERRED_STORAGE_PERMISSION_SCOPE_ERROR_V7);
    const permissionFacts = permissionChanges.map(mutation => ({ field: mutation.field, state: "affirmed", sourceText: mutation.quote, value: mutation.value }));
    const current = { facts: currentProfileFacts(profile), updates: profile.updates };
    for (const change of permissionChanges) {
      for (const old of storagePermissionExpansionTargetsV7(current, source.text, change.quote, permissionFacts, change.field)) {
        if (old.field === change.field) change.targetFactIds = [...new Set([...change.targetFactIds, old.id])];
        else parsed.push({ operation: "retract", field: old.field, targetFactIds: [old.id], quote: change.quote });
      }
    }
  }
  const activeDisplayProfile = { facts: currentProfileFacts(profile), updates: profile.updates };
  for (const change of parsed.filter(mutation => mutation.operation === "set" && isOwnScopedField(mutation.field))) {
    for (const old of pendingDisplayResolution(activeDisplayProfile, source.text, change.quote, change.state, change.value)?.targets ?? []) {
      if (old.field === change.field) change.targetFactIds = [...new Set([...change.targetFactIds, old.id])];
      else parsed.push({ operation: "retract", field: old.field, targetFactIds: [old.id], quote: change.quote });
    }
  }
  let facts = [...profile.facts];
  const removed = new Set<string>(), added: string[] = [];
  for (const field of new Set(parsed.map(mutation => mutation.field))) {
    const group = parsed.filter(mutation => mutation.field === field);
    const targetsFor = (mutation: ProfileMutation) => mutation.targetFactIds.length ? mutation.targetFactIds
      : selfReportTargetIds(profile, field, mutation.value, mutation.state, mutation.quote, source.text);
    const targets = [...new Set(group.flatMap(targetsFor))];
    targets.forEach(id => removed.add(id));
    facts = facts.filter(fact => !targets.includes(fact.id));
    for (const mutation of group.filter(mutation => mutation.operation === "set")) {
      const value = mutation.value!;
      const mutationTargets = targetsFor(mutation);
      const state = mutation.state ?? (["excludedTask", "unavailableResource"].includes(field) ? "negated" : value === "unknown" ? "unknown" : "affirmed");
      const id = `s.${field}.${createHash("sha256").update(JSON.stringify([source.answerId, field, value, state, mutation.quote])).digest("hex").slice(0, 20)}`;
      if (facts.some(fact => fact.id === id)) continue;
      const start = source.text.indexOf(mutation.quote);
      facts.push({ id, field, value, label: `${labels[field] ?? field}：${String(value)}`.slice(0, 1600), state,
        confirmed: state === "affirmed" || state === "negated", evidenceLevel: evidence?.get(`${field}\0${mutation.quote}`) ?? "self_report",
        answerId: source.answerId, originalText: mutation.quote, sourceSpan: { start, end: start + mutation.quote.length },
        updatedAt, supersedesFactIds: [...new Set(mutationTargets)] });
      added.push(id);
    }
  }
  const orphaned = facts.filter(fact => /^experience\.\d+\./.test(fact.field) && !facts.some(task => task.field === `${fact.field.split(".").slice(0, 2).join(".")}.task`));
  orphaned.forEach(fact => removed.add(fact.id));
  facts = facts.filter(fact => !removed.has(fact.id));
  const next: StudentProfileV6 = { ...profile, facts,
    retractedFactIds: [...new Set([...profile.retractedFactIds, ...removed])].slice(-80),
    revision: createHash("sha256").update(JSON.stringify({ previous: profile.revision, answerId: source.answerId, facts })).digest("hex"),
    updates: [...(profile.updates ?? []), { id: source.answerId, answerId: source.answerId, originalText: source.text, updatedAt,
      previousRevision: profile.revision, removedFactIds: [...removed], addedFactIds: added.filter(id => facts.some(fact => fact.id === id)) }] };
  // Goal metadata comes from the intact canonical assertions. A narrower legacy
  // enum cannot veto an otherwise valid self report or replace its wording.
  const derived = canonicalGoalMetadata(next, parsed);
  next.goals = derived.goals; next.primaryGoal = derived.primaryGoal; next.tradeoffStatus = derived.tradeoffStatus;
  next.unknownFields = resolvedUnknownFields(currentProfileFacts(next), [...profile.unknownFields, ...derived.unknownFields, ...parsed.map(mutation => mutation.field)]);
  return studentProfileSchema.parse(next);
}

/** An extractor may label facts unconfirmed; v7 adopts a traceable self report
 * on submission, while preserving negation, conditions, unknown and withdrawal. */
export function applySelfReportedFactsV7(profile: StudentProfileV6, extraction: ProfileExtraction, source: ProfileSourceV7,
  legacy: CompetitionRecommendationProfileV5 | undefined): StudentProfileV6 {
  const checked = validateSelfReportedExtractionV7(source.text, extraction, { confirmedSelection: true, allowIndependentReportedClauses: true });
  const active = currentProfileFacts(profile);
  const scoped = scopedDisplayFacts(scopedReservationFactsV7(active, source.text, checked.facts).facts);
  let facts = scoped.filter(fact => (fact.field !== DISPLAY_APPROVAL_INFERENCE_FIELD_V7 || !retainsPendingDisplayApprovalV7(profile, fact.sourceText))
    && !unresolvedDisplayApprovalV7({ facts: active, updates: profile.updates }, source.text, [fact]));
  if (!facts.length && scoped.length) return profile;
  const stageUpdates = sourcedStageUpdates(profile, source.text, facts);
  for (const { fact, replacedAliases } of stageUpdates) {
    const same = facts.findIndex(row => replacedAliases.includes(row) || row.field === fact.field && row.sourceText === fact.sourceText);
    if (same >= 0) facts[same] = fact;
    else facts.push(fact);
    if (replacedAliases.length) facts = facts.filter(row => !replacedAliases.includes(row));
  }
  // A provider may retain the wording in an open description field. An explicit
  // current main goal also belongs in canonical goal metadata, with the same quote.
  if (!facts.some(fact => fact.field === "primaryGoal")) {
    for (const fact of checked.facts.filter(fact => fact.field === "goal.description")) {
      const oldMain = profile.facts.find(old => old.field === "goal.description" && mainGoalDeclarationV7.test(old.originalText?.trim() ?? "") && profile.facts.some(primary => primary.field === "primaryGoal" && primary.value === old.value));
      if (typeof fact.value === "string" && (fact.state === "affirmed" && mainGoalDeclarationV7.test(fact.sourceText.trim()) || fact.state === "retracted" && oldMain)) facts.push({ ...fact, field: "primaryGoal" });
    }
  }
  const mutations: ProfileMutation[] = facts.flatMap<ProfileMutation>(fact => {
    const targets = stageUpdates.find(update => update.fact === fact)?.targetFactIds
      ?? selfReportTargetIds(profile, fact.field, fact.value, fact.state, fact.sourceText, source.text);
    if (fact.state === "retracted") {
      // Facets of one atomic assertion share its source binding and namespace.
      // Withdrawing that assertion must not leave its task/frequency projections active.
      const selected = profile.facts.filter(old => targets.includes(old.id));
      const wholeAssertion = /承诺|意愿|(?:这|那)(?:次|条)(?:自述|陈述)|刚才(?:的)?(?:自述|陈述|声明)/u.test(fact.sourceText);
      const related = profile.facts.filter(old => wholeAssertion && selected.some(target => {
        const parent = target.field.includes(".") ? target.field.slice(0, target.field.lastIndexOf(".")) : "";
        return parent && old.field.startsWith(`${parent}.`) && target.answerId && target.originalText
          && !/[，,。；;\n]|和|与|及|并|且/u.test(target.originalText.replace(/[。.!！]+$/u, ""))
          && old.answerId === target.answerId && old.originalText === target.originalText;
      }));
      return [...new Set([...selected, ...related].map(old => old.field))].map(field => ({ operation: "retract" as const, field,
        targetFactIds: [...selected, ...related].filter(old => old.field === field).map(old => old.id).filter((id, index, ids) => ids.indexOf(id) === index), quote: fact.sourceText }));
    }
    return [{ operation: "set" as const, field: fact.field, value: fact.value, state: fact.state, targetFactIds: targets, quote: fact.sourceText }];
  });
  const publicPending = facts.find(fact => fact.field === competitionDisplayField && fact.state === "unknown" && isPendingCompetitionDisplay(fact.sourceText));
  if (publicPending && facts.some(fact => isOwnScopedField(fact.field) && fact.state === "affirmed" && fact.value !== false && classroomDisplayGrant.test(literalPredicate(fact.sourceText)))) {
    const oldGeneric = currentProfileFacts(profile).filter(fact => fact.field === "display_permission" && fact.state === "unknown"
      && fact.originalText && genericDisplayUnknown.test(literalPredicate(fact.originalText)));
    if (oldGeneric.length) mutations.push({ operation: "retract", field: "display_permission", targetFactIds: oldGeneric.map(fact => fact.id), quote: publicPending.sourceText });
  }
  mutations.push(...explicitAssertionRetractionsV7(profile, facts));
  const levels = new Map(facts.map(fact => [`${fact.field}\0${fact.sourceText}`, fact.evidenceLevel]));
  const next = applyProfileMutationsV7(profile, mutations, source, legacy, levels);
  const unknownFields = resolvedUnknownFields(currentProfileFacts(next), [...next.unknownFields, ...checked.unknownFields]);
  if (JSON.stringify(unknownFields) === JSON.stringify(next.unknownFields)) return next;
  return studentProfileSchema.parse({ ...next, unknownFields, revision: createHash("sha256").update(JSON.stringify([next.revision, unknownFields])).digest("hex") });
}

function canonicalGoalMetadata(profile: StudentProfileV6, mutations: ProfileMutation[]) {
  if (!mutations.some(mutation => ["goals", "goalIntent", "primaryGoal", "goalResolution"].includes(mutation.field))) return profile;
  const active = profile.facts.filter(fact => fact.confirmed && fact.state === "affirmed" && !profile.retractedFactIds.includes(fact.id));
  const last = (field: string) => active.findLast(fact => fact.field === field)?.value;
  const label = (value: unknown) => decisionGoalLabels[String(value)] ?? String(value);
  const goalFacts = active.filter(fact => fact.field === "goals");
  const goals = goalFacts.map(fact => label(fact.value));
  const intent = last("goalIntent"), primary = last("primaryGoal"), resolution = last("goalResolution");
  if (intent !== undefined && !goals.includes(label(intent))) goals.unshift(label(intent));
  if (resolution !== undefined && !["confirmed", "undecided", "not_needed"].includes(String(resolution))) throw new Error("invalid_goal_resolution");
  const primaryGoal = resolution === "undecided" ? null : primary !== undefined ? label(primary)
    : intent !== undefined ? resolution === "confirmed" ? label(intent) : null : goals.length === 1 ? goals[0] : null;
  const tradeoffStatus = (intent === undefined && primary === undefined && !goals.length ? "not_needed"
    : resolution ?? (primary !== undefined ? "confirmed" : intent !== undefined ? "undecided" : goals.length > 1 ? "undecided" : "not_needed")) as StudentProfileV6["tradeoffStatus"];
  return { goals: [...new Set(goals)].slice(0, 5), primaryGoal, tradeoffStatus, unknownFields: profile.unknownFields };
}
