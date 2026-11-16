import type { CatalogSource, DecisionCompetitionRecord } from "@/lib/competitions/v6/catalog-types";

/** Corrections for imported records only; original source reviews are not publication approval. */
type Field = "eligibility" | "team" | "mentor" | "fee";
export type LegacyTrackFactOverride = {
  edition: string; group: string; scope: string;
  facts: Partial<Record<Field, string>>;
};
const lifeScience: LegacyTrackFactOverride = {
  edition:"第12届科学探究类（2026—2027）", group:"全日制在校本科生；学校确认及项目条件另核",
  scope:"西安交通大学转发第12届科学探究类规则；校内组织流程仅限该校，不适用于创新创业类",
  facts:{
    eligibility:"第12届科学探究类列全日制在校本科生，报名时须在校并由所在学校确认。〔1〕",
    team:"第12届科学探究类至多5名学生，可跨学院、跨学校组队；当届每人一队、在校期间最多参赛2次，具体项目资格待核。〔1〕",
    mentor:"第12届科学探究类每队1—2名导师；每名导师当届最多3队、作为第一导师最多2队。〔1〕",
    fee:"第12届科学探究类报名费400元/队且不退；个人总费用待核，不适用于创新创业类。〔1〕"
  }
};
const lifeVenture: LegacyTrackFactOverride = {
  edition:"第11届创新创业类（2026历史资料）", group:"生命科学相关专业全日制非成人在校本专科学生；具体项目条件另核",
  scope:"西南交通大学转发第11届2026创新创业类规则；校内流程仅限该校，新届另核",
  facts:{
    eligibility:"第11届2026创新创业类列生命科学相关专业全日制非成人在校本、专科生，由所在学校确认报名时在校身份；新届资格待核。〔2〕",
    team:"第11届创新创业类至多6名学生，可跨校、跨学院；每名学生最多参加创新组和创业组各1项目且只能负责1项目。〔2〕",
    mentor:"第11届创新创业类每队1—2名导师；创新组导师须在成果署名，创业组导师指导创业项目不超过2项。〔2〕",
    fee:"第11届创新创业类初赛注册费320元/项，另有决赛参赛费但所引页未列金额；个人总费用待核，不使用科学探究类400元。〔2〕"
  }
};
const innovationTracks = new Set(["undergraduate-creative","undergraduate-startup","graduate-creative","graduate-startup","vocational-creative","vocational-startup"]);
export function legacyTrackFactOverride(seriesId:string,trackId:string):LegacyTrackFactOverride|undefined {
  if(seriesId==="culsc-life-sciences") {
    if(trackId==="scientific-inquiry")return lifeScience;
    if(trackId==="biological-innovation"||trackId==="biological-venture")return lifeVenture;
  }
  if(seriesId==="china-international-college-innovation"&&innovationTracks.has(trackId))return {
    edition:"2026所选赛道；具体条件待核",group:"所选高教或职教组别；具体资格须分别核验",
    scope:"所选赛道尚未完成逐项原文核验；保留产业赛道文件为背景，不将其条件绑定到本赛道",
    facts:{
      eligibility:"该记录不是产业赛道；不得套用产业项目负责人毕业5年内条件，所选高教或职教组资格待核。",
      team:"所选赛道组队条件待核；不能仅凭产业赛道的3—15人条款认证本赛道人数。",
      mentor:"所选赛道导师条件待核；产业赛道高校教师及入职日期条款不作为本赛道依据。",
      fee:"所选赛道报名费、阶段费用及个人总费用待核。"
    }
  };
}

/** These inherited facts describe the national 2026 source, not the authored local 2025 case. */
export function legacyReferenceEntity(seriesId: string, trackId: string, factId: string) {
  if (seriesId === "chinese-classics" && trackId === "classics-recitation" &&
      ["eligibility", "team", "mentor", "fee"].some(field => factId === `chinese-classics:legacy:fact:${field}`)) {
    return { editionId: "2026-national-8", trackId: "multi-event-reference", groupId: "source-defined-groups", scopeId: "china-national" };
  }
  return undefined;
}


// These authored records inherit local notices for a different edition, track or geographic scope.
// The original texts and imported/unreviewed status remain intact for audit. A citation is
// required to attach any date or school-specific entity; uncited unknowns have no such scope.
type ArchiveEntity = { editionId: string; trackId: string; groupId: string; scopeId: string };
type ArchiveSource = { index: number; authority: CatalogSource["authority"]; fields: Field[]; citedUnknown?: Field[]; entity: ArchiveEntity; scope: string };
type ResearchArchive = { sources: ArchiveSource[]; unknown: Field[]; dropAlias?: string };
const researchArchives: Record<string, ResearchArchive> = {
  "national-college-electronic-design:2025-national:monocular-measurement:undergraduate-task:china-2025-c": {
    sources: [{ index: 2, authority: "organizer", fields: ["eligibility", "team"], citedUnknown: ["team"],
      entity: { editionId: "2025-national", trackId: "national-process-reference", groupId: "undergraduate-and-vocational", scopeId: "china-2025-process" },
      scope: "旧库引用2025全国主赛实施过程说明，属于本科及高职高专的通用组织背景，不是C题细则；保留原待核状态。" }],
    unknown: ["mentor", "fee"],
  },
  "national-college-industrial-design:2024-7:product-system:fulltime-university:heilongjiang-rules-national-work": {
    sources: [{ index: 2, authority: "university_local", fields: ["eligibility", "team"],
      entity: { editionId: "2026-8", trackId: "school-selection-reference", groupId: "source-defined-group", scopeId: "zafu-school-selection" },
      scope: "2026第八届浙江农林大学校内选拔的旧库引用，仅限该校通知；原文未复核，不作为2024黑龙江省赛规则。" }],
    unknown: ["mentor", "fee"], dropAlias: "NCDA工业设计大赛",
  },
  "smart-car:2025-20-outdoor:outdoor-ros-mapping:higher-education:china-2025-outdoor-ros": {
    sources: [{ index: 2, authority: "university_local", fields: ["eligibility", "team", "mentor"],
      entity: { editionId: "2026-21", trackId: "outdoor-school-selection-reference", groupId: "source-defined-group", scopeId: "czu-school-selection" },
      scope: "2026第二十一届常州工学院室外赛校内选拔的旧库引用，仅限该校通知；原文未复核，不作为2025室外ROS高教组规则。" }],
    unknown: ["fee"],
  },
  "china-software-cup:2026-15:a3-learning-agents:a-higher-education:china-a3-2026": {
    sources: [{ index: 1, authority: "university_local", fields: ["eligibility", "team", "mentor"],
      entity: { editionId: "2026-15", trackId: "school-participation-reference", groupId: "source-defined-group", scopeId: "hrbeu-school-participation" },
      scope: "哈尔滨工程大学2026第十五届参赛校内通知的旧库引用，仅限该校组织；原文未复核，不作为全国A3赛题规则。" }],
    unknown: ["fee"],
  },
};

/** Pre-bind archival facts; bindRecordIdentity preserves fact.entity instead of inheriting the displayed record's identity. */
export function isolateResearchedLegacyReferences(record: DecisionCompetitionRecord): void {
  const id = record.identity;
  if (!id) return;
  const key = [record.seriesId, id.editionId, id.trackId, id.groupId, id.scopeId].join(":");
  if (!Object.hasOwn(researchArchives, key)) return;
  const archive = researchArchives[key];
  if (archive.dropAlias) record.aliases = record.aliases.filter(alias => alias !== archive.dropAlias);
  for (const reference of archive.sources) {
    const sourceId = record.seriesId + ":legacy:source:" + reference.index;
    const source = record.sources.find(entry => entry.id === sourceId);
    if (!source || source.accessStatus !== "imported_unrechecked") throw Error("Expected unrechecked archive source");
    source.authority = reference.authority;
    source.scope = reference.scope;
    for (const field of reference.fields) {
      const fact = record.facts.find(entry => entry.id === record.seriesId + ":legacy:fact:" + field);
      if (!fact || fact.status !== (reference.citedUnknown?.includes(field) ? "unknown" : "pending_review") || fact.sourceIds.length !== 1 || fact.sourceIds[0] !== sourceId)
        throw Error("Expected a pending imported fact citing the declared archive source");
      fact.entity = { ...reference.entity };
      fact.scope = reference.scope;
      fact.sourceScopes = [{ sourceId, scope: source.scope }];
    }
  }
  for (const field of archive.unknown) {
    const fact = record.facts.find(entry => entry.id === record.seriesId + ":legacy:fact:" + field);
    if (!fact || fact.status !== "unknown" || fact.sourceIds.length) throw Error("Expected an uncited unknown archive field");
    fact.entity = { editionId: "edition-unknown", trackId: "track-unknown", groupId: "group-unknown", scopeId: "scope-unknown" };
    fact.scope = "旧库待核字段，无引用；适用届次、赛道、组别和范围均未知。";
    fact.sourceScopes = [];
  }
}
