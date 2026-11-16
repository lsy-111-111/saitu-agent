import { z } from "zod";
import { decisionRecommendationSchema, type DecisionReportV6 } from "./contracts";
import { recommendationListItemSchema, type RecommendationRunV7 } from "../v7/contracts";

export const SAVED_DECISIONS_KEY = "saitu.savedDecisionChoices.v6" as const;
export const SAVED_DECISION_OFFICIAL_ENTRY_POLICY = "official-entry-only.v7" as const;
const savedOfficialEntrySchema = z.object({
  sourcePolicy:z.literal(SAVED_DECISION_OFFICIAL_ENTRY_POLICY),
  url:z.string().url().refine(value=>/^https?:\/\//.test(value)).nullable()
}).strict();
export const savedDecisionSchema = z.object({
  savedAt:z.string().datetime(), reportId:z.string(), catalogVersion:z.string(), profileRevision:z.string(),
  recommendation:decisionRecommendationSchema,
  // Absence preserves historical v6 behavior; an explicit null never falls back to evidence sources.
  officialEntry:savedOfficialEntrySchema.optional()
}).strict();
export const savedDecisionStoreSchema = z.object({schemaVersion:z.literal(SAVED_DECISIONS_KEY),items:z.array(savedDecisionSchema).max(50)}).strict();
export type SavedDecision = z.infer<typeof savedDecisionSchema>;
export type SavedDecisionStore = z.infer<typeof savedDecisionStoreSchema>;
type StorageLike = Pick<Storage,"getItem"|"setItem">;
type Outcome<T> = {ok:true;value:T}|{ok:false;message:string};
function storageOrDefault(storage?:StorageLike): StorageLike | null {
  if(storage)return storage;
  try{return typeof window==="undefined"?null:window.localStorage;}catch{return null;}
}
export function readSavedDecisions(storage?:StorageLike):Outcome<SavedDecisionStore> {
  const target=storageOrDefault(storage);
  if(!target)return {ok:false,message:"当前浏览器不能访问本地收藏，请稍后重试。"};
  try {
    const raw=target.getItem(SAVED_DECISIONS_KEY);
    if(!raw)return {ok:true,value:{schemaVersion:SAVED_DECISIONS_KEY,items:[]}};
    const parsed=savedDecisionStoreSchema.safeParse(JSON.parse(raw));
    return parsed.success?{ok:true,value:parsed.data}:{ok:false,message:"已有新版收藏格式无法读取，已保留原数据。"};
  }catch{return {ok:false,message:"无法读取新版收藏，已保留原数据。"};}
}
export function saveSelectedDecisions(report:DecisionReportV6,itemIds:readonly string[],storage?:StorageLike):Outcome<SavedDecisionStore> {
  return saveRecommendations({reportId:report.reportId,catalogVersion:report.catalogVersion,profileRevision:report.profile.revision},report.recommendations.filter(item=>itemIds.includes(item.itemId)).map(recommendation=>({recommendation})),storage);
}
export function saveSelectedRunDecisions(run:RecommendationRunV7,itemIds:readonly string[],storage?:StorageLike):Outcome<SavedDecisionStore> {
  const parsed=z.array(recommendationListItemSchema).safeParse(run.items.filter(item=>itemIds.includes(item.itemId)));
  if(!parsed.success)return {ok:false,message:"所选项目的官网或详情格式无效，已有收藏未被修改。"};
  const selected=parsed.data;
  if(selected.some(item=>!item.detail))return {ok:false,message:"所选项目的详情还在准备，请完成后再收藏。"};
  return saveRecommendations({reportId:run.report?.reportId??run.runId,catalogVersion:run.catalogVersion,profileRevision:run.profileRevision},selected.flatMap(item=>item.detail?[{recommendation:item.detail,officialEntry:{sourcePolicy:SAVED_DECISION_OFFICIAL_ENTRY_POLICY,url:item.officialUrl}}]:[]),storage);
}
function saveRecommendations(metadata:{reportId:string;catalogVersion:string;profileRevision:string},selected:Pick<SavedDecision,"recommendation"|"officialEntry">[],storage?:StorageLike):Outcome<SavedDecisionStore> {
  const target=storageOrDefault(storage);
  if(!target)return {ok:false,message:"当前浏览器不能保存收藏。"};
  const current=readSavedDecisions(target);
  if(!current.ok)return current;
  if(!selected.length)return {ok:false,message:"请先选择至少一项想收藏的竞赛。"};
  const byId=new Map(current.value.items.map(item=>[item.recommendation.itemId,item]));
  const savedAt=new Date().toISOString();
  selected.forEach(item=>byId.set(item.recommendation.itemId,{savedAt,...metadata,...item}));
  if(byId.size>50)return {ok:false,message:"新版收藏最多保存50项，请先在我的竞赛中移除不再关注的项目。"};
  const value:SavedDecisionStore={schemaVersion:SAVED_DECISIONS_KEY,items:[...byId.values()].sort((a,b)=>b.savedAt.localeCompare(a.savedAt))};
  if(!savedDecisionStoreSchema.safeParse(value).success)return {ok:false,message:"收藏内容格式无效，已有收藏未被修改。"};
  try{target.setItem(SAVED_DECISIONS_KEY,JSON.stringify(value));return {ok:true,value};}
  catch{return {ok:false,message:"浏览器空间不足或禁止保存；已有收藏未被主动清理。"};}
}
export function removeSavedDecision(itemId:string,storage?:StorageLike):Outcome<SavedDecisionStore> {
  const target=storageOrDefault(storage);
  if(!target)return {ok:false,message:"当前浏览器不能修改收藏。"};
  const current=readSavedDecisions(target);
  if(!current.ok)return current;
  const value={...current.value,items:current.value.items.filter(item=>item.recommendation.itemId!==itemId)};
  try{target.setItem(SAVED_DECISIONS_KEY,JSON.stringify(value));return {ok:true,value};}
  catch{return {ok:false,message:"移除失败，请稍后重试。"};}
}
export function clearSavedDecisions(storage?:StorageLike):Outcome<SavedDecisionStore> {
  const target=storageOrDefault(storage);
  if(!target)return {ok:false,message:"当前浏览器不能修改收藏。"};
  const value:SavedDecisionStore={schemaVersion:SAVED_DECISIONS_KEY,items:[]};
  try{target.setItem(SAVED_DECISIONS_KEY,JSON.stringify(value));return {ok:true,value};}
  catch{return {ok:false,message:"清理新版收藏失败，请稍后重试。"};}
}
