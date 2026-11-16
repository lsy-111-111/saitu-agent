import { evidenceRegistryLocation } from "./evidence-registry-context";
import { emitProductObservation } from "@/lib/ai/product-observation";
import "server-only";
import { readFileSync,realpathSync,statSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { getDecisionCatalog } from "./catalog";
import type { DecisionCompetitionRecord } from "./catalog-types";

const identitySchema=z.object({sourceId:z.string(),seriesId:z.string(),scope:z.string().min(1),url:z.string().url(),authority:z.enum(["organizer","official_host","university_local"]),editionId:z.string().min(1),historical:z.boolean()}).strict();
const indexSchema=z.object({schemaVersion:z.literal("saitu.frozen-source-text.v1"),identities:z.array(identitySchema).optional(),sources:z.array(z.object({sourceId:z.string(),url:z.string().url(),scope:z.string().optional(),status:z.string(),sourceArtifact:z.string().nullish(),sourceByteSha256:z.string().nullish(),bodyArtifact:z.string().nullish(),bodySha256:z.string().nullish(),retrievedAt:z.string().nullable().optional(),conflictingVersions:z.array(z.object({revision:z.string(),bodyArtifact:z.string(),bodySha256:z.string(),origin:z.literal("synthetic_fault_injection")})).optional()}).passthrough())}).passthrough();
function loadRegistry(){
  const location=evidenceRegistryLocation();
  const root=realpathSync(location?.root??process.env.SAITU_FROZEN_EVIDENCE_ROOT??process.cwd());
  const filename=location?.index??process.env.SAITU_FROZEN_EVIDENCE_INDEX??"artifacts/v6/content-research/frozen-source-text/index.json";
  const bytes=readArtifact(root,filename,2_000_000),expected=location?.indexSha256??process.env.SAITU_FROZEN_EVIDENCE_INDEX_SHA256;
  if(expected&&digest(bytes)!==expected)throw new Error("frozen_registry_hash_mismatch");
  return {root,index:indexSchema.parse(JSON.parse(bytes.toString("utf8"))),identityAuthorityBound:Boolean(expected)};
}
export function registeredEvidenceIds(seriesId:string,ids:string[]):string[]{
  try{const {index,identityAuthorityBound}=loadRegistry();if(!identityAuthorityBound)return [];return ids.filter(id=>index.identities?.some(identity=>identity.sourceId===id&&identity.seriesId===seriesId));}catch{return [];}
}

export type FrozenSource={sourceId:string;url:string;seriesId:string;scope:string;editionId:string;historical:boolean;body:string;bodySha256:string;sourceByteSha256:string;retrievedAt:string|null};
export type SourceRead={source:FrozenSource|null;reason:string};
const digest=(bytes:Buffer)=>createHash("sha256").update(bytes).digest("hex");
function readArtifact(root:string,file:string,limit:number){
  const resolved=realpathSync(path.resolve(root,file));
  if(!resolved.startsWith(root+path.sep)||resolved.split(path.sep).some(part=>part.endsWith("-private")))throw new Error("evidence_path_outside_frozen_root");
  if(statSync(resolved).size>limit)throw new Error("evidence_file_too_large");
  return readFileSync(resolved);
}
/** Metadata supplied by a request can narrow or invalidate evidence, never supply a trusted body. */
export function readFrozenSource(input:{sourceId:string;seriesId:string;scope?:string;sourcePacket?:unknown},records:readonly DecisionCompetitionRecord[]=getDecisionCatalog()):SourceRead {
  try{
    const packet=input.sourcePacket&&typeof input.sourcePacket==="object"?input.sourcePacket as Record<string,unknown>:{};
    if([packet.status,packet.accessStatus,packet.reviewStatus].some(value=>typeof value==="string"&&/metadata_only|pending|conflict|retract|unknown|unavailable/i.test(value)))return {source:null,reason:"source_not_usable"};
    if(typeof packet.scope==="string"&&input.scope&&packet.scope!==input.scope)return {source:null,reason:"source_scope_mismatch"};
    if(typeof packet.seriesId==="string"&&packet.seriesId!==input.seriesId)return {source:null,reason:"source_series_mismatch"};
    const {root,index,identityAuthorityBound}=loadRegistry();
    const identity=identityAuthorityBound?index.identities?.find(i=>i.sourceId===input.sourceId&&i.seriesId===input.seriesId&&(!input.scope||i.scope===input.scope)):undefined;
    const candidates=records.filter(r=>r.seriesId===input.seriesId&&r.sources.some(s=>s.id===input.sourceId));
    const record=candidates.find(r=>!input.scope||[r.scope,r.edition,r.identity?.editionId,...r.sources.filter(s=>s.id===input.sourceId).map(s=>s.scope)].includes(input.scope));
    if(!record&&!identity)return {source:null,reason:"source_scope_or_series_not_registered"};
    const reference=record?.sources.find(s=>s.id===input.sourceId)??(identity?{id:identity.sourceId,url:identity.url,scope:identity.scope,authority:identity.authority,accessStatus:"body_read",integrity:undefined}:null);
    if(!reference)return {source:null,reason:"source_identity_missing"};
    if(!["organizer","official_host","university_local"].includes(reference.authority)||!['body_read','excerpt_read'].includes(reference.accessStatus)||reference.integrity==="requires_recheck")return {source:null,reason:"source_not_verified_for_reading"};
    if(record?.facts.some(f=>f.sourceIds.includes(input.sourceId)&&["conflicting","pending_review"].includes(f.status)))return {source:null,reason:"source_has_unresolved_conflict"};
    const matchingRows=index.sources.filter(s=>s.sourceId===input.sourceId&&s.url===reference.url);
    if(matchingRows.length!==1)return {source:null,reason:"source_registry_identity_missing_or_ambiguous"};
    const row=matchingRows[0];
    if(!row||row.status!=="body_available_not_verified"||!row.bodyArtifact||!row.sourceArtifact||!row.bodySha256||!row.sourceByteSha256)return {source:null,reason:"frozen_body_missing"};
    if(row.scope&&row.scope!==reference.scope)return {source:null,reason:"source_registry_scope_mismatch"};
    if(row.scope&&input.scope&&row.scope!==input.scope)return {source:null,reason:"source_registry_scope_mismatch"};
    if(typeof packet.scope==="string"&&![reference.scope,record?.scope,record?.edition,record?.identity?.editionId].includes(packet.scope))return {source:null,reason:"source_scope_mismatch"};
    const capture=packet.capture&&typeof packet.capture==="object"?packet.capture as Record<string,unknown>:{};
    if([packet.bodyTextSha256,packet.bodySha256].some(value=>typeof value==="string"&&value!==row.bodySha256)||typeof capture.sha256==="string"&&capture.sha256!==row.sourceByteSha256)return {source:null,reason:"client_source_hash_binding_mismatch"};
    // The frozen official CCSP collection is 63.7 MB. Keep a finite limit while
    // allowing complete public source archives instead of silently losing them.
    const bodyBytes=readArtifact(root,row.bodyArtifact,2_000_000),sourceBytes=readArtifact(root,row.sourceArtifact,100_000_000);
    if(digest(bodyBytes)!==row.bodySha256||digest(sourceBytes)!==row.sourceByteSha256)return {source:null,reason:"frozen_evidence_hash_mismatch"};
    if(row.conflictingVersions?.length){
      const versions=row.conflictingVersions.map(version=>{const bytes=readArtifact(root,version.bodyArtifact,2_000_000);if(digest(bytes)!==version.bodySha256)throw new Error("conflicting_version_hash_mismatch");return {revision:version.revision,bodySha256:version.bodySha256,origin:version.origin};});
      emitProductObservation("source_conflict_observed",{sourceId:input.sourceId,originalBodySha256:row.bodySha256,versions});return {source:null,reason:"source_has_unresolved_conflicting_version"};
    }
    emitProductObservation("frozen_source_loaded",{sourceId:input.sourceId,seriesId:input.seriesId,bodySha256:row.bodySha256,sourceByteSha256:row.sourceByteSha256,scope:input.scope??record?.scope??identity?.scope});
    const body=bodyBytes.toString("utf8");if(!body.trim())return {source:null,reason:"frozen_body_empty"};
    return {source:{sourceId:reference.id,url:reference.url,seriesId:input.seriesId,scope:input.scope??record?.scope??identity!.scope,editionId:record?.identity?.editionId??record?.edition??identity!.editionId,historical:record?record.facts.filter(f=>f.sourceIds.includes(reference.id)).every(f=>f.status!=="verified_current"):identity!.historical,body,bodySha256:row.bodySha256,sourceByteSha256:row.sourceByteSha256,retrievedAt:row.retrievedAt??null},reason:"frozen_body_loaded_not_a_correctness_certificate"};
  }catch{return {source:null,reason:"frozen_evidence_unavailable"};}
}
export type EvidenceExcerpt={sourceId:string;url:string;scope:string;start:number;end:number;text:string;bodySha256:string};
/** Deterministic paragraph retrieval from frozen bytes; returned quotes carry exact offsets. */
export function retrieveEvidenceExcerpts(source:FrozenSource,query:string,maxCharacters=12_000):EvidenceExcerpt[]{
  const normalized=query.normalize("NFKC").toLowerCase();
  const words=normalized.match(/[a-z0-9_]{2,}|[\u3400-\u9fff]{2,}/g)??[];
  const tokens=[...new Set(words.flatMap(word=>/^[\u3400-\u9fff]+$/.test(word)?Array.from({length:word.length-1},(_,i)=>word.slice(i,i+2)):[word]))];
  const chunks:{start:number;end:number;text:string;score:number}[]=[];
  for(let start=0;start<source.body.length;start+=1000){const end=Math.min(source.body.length,start+1600),text=source.body.slice(start,end),lower=text.normalize("NFKC").toLowerCase();chunks.push({start,end,text,score:tokens.reduce((sum,token)=>sum+Number(lower.includes(token)),0)});}
  const selected=chunks.sort((a,b)=>b.score-a.score||a.start-b.start).slice(0,Math.max(1,Math.floor(maxCharacters/1600))).sort((a,b)=>a.start-b.start);
  return selected.map(({start,end,text})=>({sourceId:source.sourceId,url:source.url,scope:source.scope,start,end,text,bodySha256:source.bodySha256}));
}
