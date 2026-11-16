import { domainFieldSchema } from "./domain-facts";
import { profileMutationSchema, type ProfileMutation } from "./profile-contracts";
export { profileMutationSchema, type ProfileMutation } from "./profile-contracts";
import { competitionDecisionContextSchema, competitionRecommendationProfileV5Schema } from "@/lib/ai/competition-request-schema";
import { createHash } from "node:crypto";
import type { CompetitionRecommendationProfileV5 } from "@/types/competition-recommendation";
import * as options from "@/components/competitions/recommend/questionContent";
import {
  studentProfileSchema,
  type StudentFactV6,
  type StudentProfileV6,
} from "./contracts";

const optionValues: unknown[] = Object.values(options).flatMap((value) =>
  Array.isArray(value) ? value : [],
);
const labels = new Map<string, string>(
  optionValues
    .filter((o): o is { value: string; label: string } =>
      Boolean(o && typeof o === "object" && "value" in o && "label" in o),
    )
    .map((o) => [o.value, o.label]),
);
const fieldLabels: Record<string, string> = {
  stage: "学习阶段",
  majorFields: "专业",
  specificSubjects: "细分方向",
  skills: "自述技能",
  interests: "兴趣",
  goals: "参赛目标",
  preferredOutputs: "期望成果",
  startingPoint: "项目起点",
  weeklyCommitment: "每周投入",
  teamStatus: "队伍情况",
  availableResources: "已有资源",
  participationMode: "参与方式",
  participationTiming: "计划时间",
  taskFormats: "愿意承担的任务",
  experienceLevel: "参赛经历",
  evidence: "已有成果",
  enrollmentStatus: "学籍",
  firstHigherEducationYear: "首次入学年",
  teamUnit: "队伍范围",
  teamSize: "人数",
};
export const decisionGoalLabels: Record<string, string> = {
  project: "积累项目经历",
  award: "争取奖项",
  postgraduate: "支持升学探索",
  employment: "探索实习就业",
  portfolio: "积累可展示作品",
  entrepreneurship: "实践创业想法",
  networking: "认识合作伙伴",
  explore: "探索适合自己的方向",
  skill: "练习具体能力",
};
export const noviceTaskLabels: Record<string, string> = {
  "organize-information": "整理资料与数据",
  "explain-ideas": "解释问题与表达观点",
  "observe-record": "观察现象并记录证据",
  "make-content": "制作图文或创意内容",
  "build-tool": "制作能解决问题的小工具",
};
const contributionLabels: Record<string, string> = {
  observed: "主要观察学习",
  assisted: "协助完成",
  independent: "独立完成明确部分",
  led: "主导并承担核心工作",
  unknown: "贡献尚不清楚",
};
const completionLabels: Record<string, string> = {
  learning: "跟随学习",
  draft: "形成草稿",
  delivered: "已完成交付",
  feedback: "获得反馈并改进",
  unknown: "完成程度待确认",
};

/** Only signed, confirmed fields become evidence. Legacy compatibility defaults stay unknown. */
export function createStudentProfile(
  profile: CompetitionRecommendationProfileV5,
  identity: { profileId?: string; revision?: string; answerContext?: readonly {fieldId:string;selectedValues:readonly string[];freeText?:string}[]; answeredAt?: string } = {},
): StudentProfileV6 {
  const facts: StudentFactV6[] = [];
  const confirmed = new Set<string>([
    ...profile.confirmedFields,
    ...profile.confirmedFacts,
  ]);
  function add(
    field: string,
    value: string | number | boolean,
    label: string,
    state: StudentFactV6["state"] = "affirmed",
    level: StudentFactV6["evidenceLevel"] = "self_report",
  ) {
    const key = createHash("sha256")
      .update(`${field}:${String(value)}`)
      .digest("hex")
      .slice(0, 16);
    const answer = identity.answerContext?.find(answer => answer.fieldId === field || answer.selectedValues.some(option => option === `${field}:${String(value)}`));
    const originalText = answer?.freeText || answer?.selectedValues.find(option => option === `${field}:${String(value)}` || option === String(value)) || String(value);
    facts.push({
      id: `s.${field}.${key}`,
      field,
      value,
      label,
      state,
      confirmed: state !== "unknown",
      evidenceLevel: level,
      answerId: `questionnaire.${answer?.fieldId ?? field.split(".")[0]}`,
      originalText, sourceSpan: {start:0,end:originalText.length},
      updatedAt: identity.answeredAt ?? null,
      supersedesFactIds: [],
    });
  }
  for (const [field, label] of Object.entries(fieldLabels)) {
    if (!confirmed.has(field)) continue;
    const value = profile[field as keyof CompetitionRecommendationProfileV5];
    for (const item of Array.isArray(value) ? value : [value]) {
      if (
        typeof item !== "string" &&
        typeof item !== "number" &&
        typeof item !== "boolean"
      )
        continue;
      add(field, item, `${label}：${labels.get(String(item)) ?? item}`);
    }
  }
  const ctx = profile.decisionContext;
  if(ctx?.businessActivity)add("businessActivity",ctx.businessActivity,`业务任务：${ctx.businessActivity}`);
  if (ctx?.goalIntent)
    add(
      "goalIntent",
      ctx.goalIntent,
      `希望参赛帮助你${decisionGoalLabels[ctx.goalIntent] ?? ctx.goalIntent}`,
    );
  if (
    ctx?.primaryGoal &&
    ctx.goalResolution !== "undecided" &&
    (!ctx.goalIntent || ctx.goalResolution === "confirmed")
  )
    add(
      "primaryGoal",
      ctx.primaryGoal,
      `确认优先：${decisionGoalLabels[ctx.primaryGoal] ?? ctx.primaryGoal}`,
    );
  if (ctx?.goalResolution)
    add(
      "goalResolution",
      ctx.goalResolution,
      ctx.goalResolution === "undecided"
        ? "目标取舍暂未决定"
        : "已确认目标取舍",
    );
  if (ctx?.experienceStatus)
    add(
      "experienceStatus",
      ctx.experienceStatus,
      ctx.experienceStatus === "none"
        ? "暂时没有可描述的经历"
        : ctx.experienceStatus === "unknown"
          ? "经历尚未确认"
          : "已补充具体经历",
      ctx.experienceStatus === "unknown" ? "unknown" : "affirmed",
    );
  for (const [index, experience] of (ctx?.experiences ?? []).entries()) {
    if (!experience.confirmed) continue;
    const field = `experience.${index + 1}`;
    add(
      `${field}.task`,
      experience.task,
      `经历${index + 1}：${experience.task}`,
      "affirmed",
      "concrete_experience",
    );
    add(
      `${field}.contribution`,
      experience.contribution,
      `经历${index + 1}本人贡献：${contributionLabels[experience.contribution]}`,
      experience.contribution === "unknown" ? "unknown" : "affirmed",
      "concrete_experience",
    );
    add(
      `${field}.completion`,
      experience.completion,
      `经历${index + 1}完成程度：${completionLabels[experience.completion]}`,
      experience.completion === "unknown" ? "unknown" : "affirmed",
      "concrete_experience",
    );
    if (experience.challenge)
      add(
        `${field}.challenge`,
        experience.challenge,
        `经历${index + 1}困难与处理：${experience.challenge}`,
        "affirmed",
        "concrete_experience",
      );
  }
  for (const pref of ctx?.noviceTaskPreferences ?? [])
    add(
      "noviceTask",
      pref.task,
      `${noviceTaskLabels[pref.task]}：${pref.preference === "try" ? "愿意尝试" : pref.preference === "avoid" ? "明确不想做" : "不了解"}`,
      pref.preference === "avoid"
        ? "negated"
        : pref.preference === "unknown"
          ? "unknown"
          : "affirmed",
    );
  for (const task of ctx?.excludedTaskFormats ?? [])
    add(
      "excludedTask",
      task,
      `明确不想承担：${labels.get(task) ?? task}`,
      "negated",
    );
  for (const resource of ctx?.unavailableResources ?? [])
    add(
      "unavailableResource",
      resource,
      `确认无法获得：${labels.get(resource) ?? resource}`,
      "negated",
    );
  for (const resource of ctx?.obtainableResources ?? [])
    add(
      "obtainableResource",
      resource,
      `有机会争取：${labels.get(resource) ?? resource}`,
    );
  if (ctx?.fixedTeam !== undefined)
    add(
      "fixedTeam",
      ctx.fixedTeam,
      ctx.fixedTeam ? "队伍构成必须保持不变" : "允许调整或寻找队友",
    );
  if (ctx?.budget) {
    add(
      "budget",
      ctx.budget.range,
      `预算：${{ zero: "不愿发生支出", under100: "100元以内", "100-500": "100至500元", over500: "500元以上", unknown: "尚未确定" }[ctx.budget.range]}（${ctx.budget.scope === "personal" ? "个人" : ctx.budget.scope === "team" ? "全队" : "范围待确认"}）`,
      ctx.budget.range === "unknown" ? "unknown" : "affirmed",
    );
    if (ctx.budget.maximumYuan !== undefined)
      add(
        "budget.maximumYuan",
        ctx.budget.maximumYuan,
        `自付费用上限：${ctx.budget.maximumYuan}元`,
      );
  }
  if (ctx?.preparationHorizon)
    add(
      "preparationHorizon",
      ctx.preparationHorizon,
      `准备周期：${{ "1-2-weeks": "1–2周", "one-month": "约1个月", "2-3-months": "2–3个月", "long-term": "长期准备", unknown: "尚未确定" }[ctx.preparationHorizon]}`,
      ctx.preparationHorizon === "unknown" ? "unknown" : "affirmed",
    );
  const goals = confirmed.has("goals")
    ? profile.goals.map((g) => decisionGoalLabels[g])
    : [];
  if (ctx?.goalIntent && !goals.includes(decisionGoalLabels[ctx.goalIntent]))
    goals.unshift(decisionGoalLabels[ctx.goalIntent]);
  const primary =
    ctx?.goalResolution === "undecided"
      ? null
      : ctx?.goalIntent
        ? ctx.goalResolution === "confirmed"
          ? ctx.goalIntent
          : null
        : (ctx?.primaryGoal ??
          (goals.length === 1 ? profile.goals[0] : undefined));
  const revision =
    identity.revision ??
    createHash("sha256").update(JSON.stringify(facts)).digest("hex");
  return studentProfileSchema.parse({
    schemaVersion: "saitu.profile.v6",
    profileId: identity.profileId ?? `profile-${revision.slice(0, 20)}`,
    revision,
    facts,
    unknownFields: Object.keys(fieldLabels).filter((f) => !confirmed.has(f)),
    retractedFactIds: [],
    goals,
    primaryGoal: primary ? (decisionGoalLabels[primary] ?? primary) : null,
    tradeoffStatus:
      ctx?.goalResolution ??
      (ctx?.goalIntent
        ? "undecided"
        : ctx?.primaryGoal
          ? "confirmed"
          : goals.length > 1
            ? "undecided"
            : "not_needed"),
    mode: ctx?.mode ?? "quick",
    updates: [],
  });
}

/** A proposed edit contains only public profile fields; IDs are resolved against this student's snapshot. */
const extraFields = new Set(["businessActivity","goalIntent", "goalResolution", "primaryGoal", "experienceStatus", "noviceTask", "excludedTask", "unavailableResource", "obtainableResource", "fixedTeam", "budget", "budget.maximumYuan", "preparationHorizon"]);
export function isEditableProfileField(field: string) {
  return domainFieldSchema.safeParse(field).success;
}
export function activeStudentFacts(profile: StudentProfileV6) {
  return profile.facts.filter(f => f.confirmed && f.state !== "unknown" && f.state !== "conditional" && f.state !== "retracted" && !profile.retractedFactIds.includes(f.id));
}

/** The legacy scorer is an adapter only. The v6 profile remains authoritative. */
export function projectProfileToLegacy(profile: StudentProfileV6, base: CompetitionRecommendationProfileV5, compatibility: { openDomain?: boolean } = {}): CompetitionRecommendationProfileV5 {
  const facts = activeStudentFacts(profile).filter(f => f.state === "affirmed");
  const values = (field: string) => facts.filter(f => f.field === field).map(f => f.value);
  const one = (field: string) => values(field).at(-1);
  const output = structuredClone(base) as CompetitionRecommendationProfileV5 & Record<string, unknown>;
  output.confirmedFields = base.confirmedFields.filter(field => values(field).length > 0);
  output.confirmedFacts = base.confirmedFacts.filter(field => values(field).length > 0);
  for (const field of Object.keys(fieldLabels)) {
    const found = values(field);
    if (Array.isArray(output[field])) output[field] = found;
    else if (found.length) output[field] = found[found.length - 1];
    if (found.length && !output.confirmedFields.includes(field as never) && !output.confirmedFacts.includes(field as never)) {
      const eligibility = ["enrollmentStatus", "firstHigherEducationYear", "teamUnit", "teamSize"];
      (eligibility.includes(field) ? output.confirmedFacts : output.confirmedFields).push(field as never);
    }
  }
  const assertedGoal = one("goalIntent") ?? one("primaryGoal");
  const goal = compatibility.openDomain && !Object.hasOwn(decisionGoalLabels, String(assertedGoal)) ? undefined : assertedGoal;
  const resolution = one("goalResolution");
  const ctx = { ...base.decisionContext };
  ctx.goalIntent = goal as typeof ctx.goalIntent;
  ctx.primaryGoal = goal && !["explore", "skill"].includes(String(goal)) && resolution !== "undecided" ? goal as typeof ctx.primaryGoal : undefined;
  ctx.goalResolution = resolution as typeof ctx.goalResolution;
  // A confirmed chat goal is a genuine selection; keep the V5 cross-field view coherent.
  // The canonical profile retains its original facts and provenance unchanged.
  if(ctx.primaryGoal&&!output.goals.includes(ctx.primaryGoal))output.goals=[...output.goals,ctx.primaryGoal];
  ctx.experienceStatus = one("experienceStatus") as typeof ctx.experienceStatus;
  ctx.experiences = [1, 2].flatMap(index => {
    const task = one(`experience.${index}.task`);
    if (typeof task !== "string") return [];
    return [{ id: `experience-${index}`, task, contribution: (one(`experience.${index}.contribution`) ?? "unknown") as NonNullable<typeof ctx.experiences>[number]["contribution"], completion: (one(`experience.${index}.completion`) ?? "unknown") as NonNullable<typeof ctx.experiences>[number]["completion"], challenge: String(one(`experience.${index}.challenge`) ?? ""), confirmed: true }];
  });
  // An old aggregate contribution must never survive a per-experience correction.
  ctx.experienceRole = undefined;
  ctx.preparationHorizon = one("preparationHorizon") as typeof ctx.preparationHorizon;
  ctx.businessActivity = one("businessActivity") as typeof ctx.businessActivity;
  ctx.fixedTeam = one("fixedTeam") as boolean | undefined;
  ctx.excludedTaskFormats = activeStudentFacts(profile).filter(f => f.field === "excludedTask").map(f => String(f.value)) as typeof ctx.excludedTaskFormats;
  ctx.unavailableResources = activeStudentFacts(profile).filter(f => f.field === "unavailableResource").map(f => String(f.value)) as typeof ctx.unavailableResources;
  ctx.obtainableResources = values("obtainableResource") as typeof ctx.obtainableResources;
  ctx.noviceTaskPreferences = activeStudentFacts(profile).filter(f => f.field === "noviceTask").map(f => ({ task: String(f.value) as NonNullable<typeof ctx.noviceTaskPreferences>[number]["task"], preference: f.state === "negated" ? "avoid" : "try" }));
  const maximum = one("budget.maximumYuan");
  const range = one("budget");
  ctx.budget = range !== undefined || maximum !== undefined ? {
    range: typeof maximum === "number" ? maximum === 0 ? "zero" : maximum <= 100 ? "under100" : maximum <= 500 ? "100-500" : "over500" : range as NonNullable<typeof ctx.budget>["range"],
    scope: typeof maximum === "number" ? "personal" : base.decisionContext?.budget?.scope ?? "unknown",
    ...(typeof maximum === "number" && Number.isInteger(maximum) && maximum > 0 ? { maximumYuan: maximum } : {}),
  } : undefined;
  if (compatibility.openDomain) {
    // V7 keeps open facts in the canonical profile. Mirror only values the V5
    // view can express; never relabel a contribution or restore a superseded one.
    if (ctx.experiences) ctx.experiences = ctx.experiences.filter(experience => competitionDecisionContextSchema.safeParse({ experiences: [experience] }).success);
    for (const key of Object.keys(ctx) as (keyof typeof ctx)[]) {
      if (!competitionDecisionContextSchema.safeParse({ [key]: ctx[key] }).success) delete ctx[key];
    }
    if (ctx.primaryGoal && !output.goals.includes(ctx.primaryGoal)) output.goals = [...output.goals, ctx.primaryGoal];
  }
  output.decisionContext = ctx;
  return competitionRecommendationProfileV5Schema.parse(output);
}

export function applyProfileMutations(profile: StudentProfileV6, mutations: ProfileMutation[], source: { answerId: string; text: string; at: string }, base: CompetitionRecommendationProfileV5): StudentProfileV6 {
  if (!mutations.length || mutations.length > 12 || (profile.updates?.length ?? 0) >= 80) throw new Error("profile_update_limit");
  let facts = [...profile.facts];
  const removed = new Set<string>(), added: string[] = [];
  for (const raw of mutations) {
    const mutation = profileMutationSchema.parse(raw);
    if (!isEditableProfileField(mutation.field) || !source.text.includes(mutation.quote)) throw new Error("untraceable_profile_update");
    if (mutation.targetFactIds.some(id => !facts.some(f => f.id === id && f.field === mutation.field))) throw new Error("foreign_profile_fact");
    if (mutation.operation === "retract" && !mutation.targetFactIds.length) throw new Error("retraction_requires_fact");
    const targets = mutation.state === "conditional" ? facts.filter(f=>f.field===mutation.field&&f.state==="conditional").map(f=>f.id) : mutation.targetFactIds.length ? mutation.targetFactIds : facts.filter(f => f.field === mutation.field).map(f => f.id);
    for (const id of targets) removed.add(id);
    facts = facts.filter(f => !targets.includes(f.id));
    if (mutation.operation === "set") {
      if (mutation.value === undefined) throw new Error("profile_value_required");
      if (mutation.field.startsWith("qualification.") && typeof mutation.value !== "boolean") throw new Error("qualification_requires_boolean");
      if (/^eligibility\.(age|year|teamSize)$/.test(mutation.field) && (typeof mutation.value !== "number" || !Number.isInteger(mutation.value) || mutation.value < 0 || mutation.value > 150)) throw new Error("invalid_qualification_number");
      if (/^eligibility\.(enrolled|fullTime|sameInstitutionTeam|sameCountryTeam|mentor|professionalDeveloper)$/.test(mutation.field) && typeof mutation.value !== "boolean") throw new Error("invalid_qualification_boolean");
      const hash = createHash("sha256").update(`${source.answerId}:${mutation.field}:${JSON.stringify(mutation.value)}`).digest("hex").slice(0, 20);
      const fact: StudentFactV6 = { id: `s.${mutation.field}.${hash}`, field: mutation.field, value: mutation.value,
        label: `${mutation.state === "conditional" ? "条件计划（尚未发生）：" : mutation.state === "unknown" ? "暂不确定：" : ""}${profileFactLabel(mutation.field, mutation.value)}`,
        state: mutation.state ?? (["excludedTask", "unavailableResource"].includes(mutation.field) ? "negated" : mutation.value === "unknown" ? "unknown" : "affirmed"),
        confirmed: mutation.value !== "unknown" && mutation.state !== "unknown" && mutation.state !== "conditional", evidenceLevel: mutation.field.startsWith("experience.") ? "concrete_experience" : "self_report",
        answerId: source.answerId, originalText: mutation.quote, sourceSpan: {start:source.text.indexOf(mutation.quote),end:source.text.indexOf(mutation.quote)+mutation.quote.length}, updatedAt: source.at, supersedesFactIds: targets };
      facts.push(fact); added.push(fact.id);
    }
  }
  // Removing a task also removes dependent contribution/completion claims.
  const orphaned = facts.filter(f => /^experience\.[12]\./.test(f.field) && !facts.some(t => t.field === f.field.split(".").slice(0, 2).join(".") + ".task"));
  orphaned.forEach(f => removed.add(f.id)); facts = facts.filter(f => !removed.has(f.id));
  const next: StudentProfileV6 = { ...profile, facts, retractedFactIds: [...new Set([...profile.retractedFactIds, ...removed])].slice(-80),
    revision: createHash("sha256").update(JSON.stringify({ previous: profile.revision, answerId: source.answerId, facts })).digest("hex"),
    updates: [...(profile.updates ?? []), { id: source.answerId, answerId: source.answerId, originalText: source.text, updatedAt: source.at, previousRevision: profile.revision, removedFactIds: [...removed], addedFactIds: added.filter(id => facts.some(f => f.id === id)) }] };
  const legacy = projectProfileToLegacy(next, base); // field-value whitelist and cross-field checks
  const derived = createStudentProfile(legacy);
  next.goals = derived.goals; next.primaryGoal = derived.primaryGoal; next.tradeoffStatus = derived.tradeoffStatus; next.unknownFields = [...new Set([...derived.unknownFields,...profile.unknownFields.filter(field=>!(Object.hasOwn(fieldLabels, field))),...profile.facts.map(f=>f.field),...facts.filter(f=>f.state==="unknown"||f.state==="conditional").map(f=>f.field)])].filter(field=>!facts.some(f=>f.field===field&&f.confirmed&&["affirmed","negated"].includes(f.state)));
  return studentProfileSchema.parse(next);
}


function profileFactLabel(field: string, value: string | number | boolean) {
  const extra: Record<string,string> = {goalIntent:"当前首要目标",goalResolution:"目标取舍",primaryGoal:"优先目标",experienceStatus:"经历情况",noviceTask:"愿意尝试的任务",excludedTask:"不想承担的任务",unavailableResource:"确认无法获得",obtainableResource:"有机会获得",fixedTeam:"队伍是否固定",budget:"预算范围","budget.maximumYuan":"个人自付上限",preparationHorizon:"准备周期"};
  const experience = field.match(/^experience\.(\d)\.(task|contribution|completion|challenge)$/);
  const fieldLabel = experience ? `经历${experience[1]}${({task:"具体任务",contribution:"本人贡献",completion:"完成程度",challenge:"困难与处理"})[experience[2] as "task"]}` : fieldLabels[field] ?? extra[field] ?? field;
  const valueLabel = value === "confirmed" ? "已确认取舍" : value === "undecided" ? "尚未决定取舍" : labels.get(String(value)) ?? decisionGoalLabels[String(value)] ?? contributionLabels[String(value)] ?? completionLabels[String(value)] ?? String(value);
  return `${fieldLabel}：${valueLabel}${field === "budget.maximumYuan" ? "元" : ""}`;
}

/** Merge only explicitly edited, signed questionnaire fields. Chat-only facts and their IDs survive. */
export function mergeQuestionnaireEdits(profile:StudentProfileV6, incoming:CompetitionRecommendationProfileV5, fields:string[], source:{answerId:string;at:string;answerContext?:readonly {fieldId:string;selectedValues:readonly string[];freeText?:string}[]}) {
  const changed=new Set(fields);
  if([...changed].some(field=>!(Object.hasOwn(fieldLabels, field))&&!extraFields.has(field)&&!/^experience\.[12]\.(task|contribution|completion|challenge)$/.test(field)))throw new Error("invalid_questionnaire_edit_field");
  if(!changed.size)return profile;
  if((profile.updates?.length??0)>=80)throw new Error("profile_update_limit");
  const incomingProfile=createStudentProfile(incoming,{profileId:profile.profileId,answerContext:source.answerContext,answeredAt:source.at});
  const removed=profile.facts.filter(f=>changed.has(f.field));
  const added=incomingProfile.facts.filter(f=>changed.has(f.field)).map(f=>({...f,id:`s.edit.${createHash("sha256").update(`${source.answerId}:${f.id}`).digest("hex").slice(0,24)}`,answerId:source.answerId,supersedesFactIds:removed.filter(old=>old.field===f.field).map(old=>old.id)}));
  const facts=[...profile.facts.filter(f=>!changed.has(f.field)),...added];
  const next:StudentProfileV6={...profile,facts,revision:createHash("sha256").update(JSON.stringify({previous:profile.revision,answerId:source.answerId,facts})).digest("hex"),retractedFactIds:[...new Set([...profile.retractedFactIds,...removed.map(f=>f.id)])].slice(-80),updates:[...(profile.updates??[]),{id:source.answerId,answerId:source.answerId,originalText:`问卷中明确修改：${[...changed].join("、")}`,updatedAt:source.at,previousRevision:profile.revision,removedFactIds:removed.map(f=>f.id),addedFactIds:added.map(f=>f.id)}]};
  const derived=createStudentProfile(projectProfileToLegacy(next,incoming));
  return studentProfileSchema.parse({...next,goals:derived.goals,primaryGoal:derived.primaryGoal,tradeoffStatus:derived.tradeoffStatus,unknownFields:derived.unknownFields});
}
