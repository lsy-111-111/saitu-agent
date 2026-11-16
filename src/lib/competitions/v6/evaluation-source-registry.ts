import "server-only";
import { createHash } from "node:crypto";
import { mkdirSync,readFileSync,writeFileSync,realpathSync,mkdtempSync,rmSync,statSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { getDecisionCatalog } from "./catalog";
import { canonicalHash,EvaluationNotRun } from "./evaluation-contracts";
import type { EvidenceRegistryLocation } from "./evidence-registry-context";
const hash=(data:Buffer)=>createHash("sha256").update(data).digest("hex");
const sha=z.string().regex(/^[a-f0-9]{64}$/);
const identity=z.object({sourceId:z.string(),seriesId:z.string(),scope:z.string(),url:z.string().url(),authority:z.enum(["organizer","official_host","university_local"]),editionId:z.string(),historical:z.boolean()}).strict();
const source=z.object({sourceId:z.string(),seriesId:z.string(),scope:z.string(),url:z.string().url(),sourceArtifact:z.string(),sourceByteSha256:sha,bodyArtifact:z.string(),bodySha256:sha,captureMethod:z.enum(["inherited_http_body_bytes","inherited_web_tool_transcript"]),originalCaptureMethod:z.string(),retrievedAt:z.string().nullable(),aliases:z.object({catalogSeriesId:z.string(),catalogSourceId:z.string(),catalogScope:z.string(),authority:z.string()}).nullable()}).passthrough();
function safeRead(root:string,file:string,limit=50_000_000){const resolved=realpathSync(path.resolve(root,file));if(!resolved.startsWith(realpathSync(root)+path.sep)||statSync(resolved).size>limit)throw new EvaluationNotRun("source_artifact_outside_root_or_too_large");return readFileSync(resolved);}
function copyVerified(root:string,file:string,expected:string,destination:string){const bytes=safeRead(root,file);if(hash(bytes)!==expected)throw new EvaluationNotRun("source_import_hash_mismatch");writeFileSync(destination,bytes,{flag:"wx",mode:0o600});}
/** Call only after recorded opening. Reads exactly the supplied source index/artifacts, never questions/keys. */
export function importEvaluationSourceRegistry(options:{sourceRoot:string;indexFile:string;indexSha256:string;outputRoot:string;identities?:unknown[]}){
  const bytes=safeRead(options.sourceRoot,options.indexFile,5_000_000);if(hash(bytes)!==options.indexSha256)throw new EvaluationNotRun("source_index_sha256_mismatch");
  const input=z.object({schemaVersion:z.literal("saitu.sealed-source-index.v2"),sources:z.array(source)}).parse(JSON.parse(bytes.toString("utf8")));
  const explicit=z.array(identity).parse(options.identities??[]),catalog=getDecisionCatalog(),identities:z.infer<typeof identity>[]=[],sources:Record<string,unknown>[]=[],blocked:unknown[]=[];
  mkdirSync(options.outputRoot,{recursive:false,mode:0o700});mkdirSync(path.join(options.outputRoot,"bytes"),{mode:0o700});
  const seen=new Set<string>();
  for(const item of input.sources){
    if(seen.has(item.sourceId))throw new EvaluationNotRun("duplicate_source_identity");seen.add(item.sourceId);
    let binding=explicit.find(i=>i.sourceId===item.sourceId&&i.seriesId===item.seriesId&&i.url===item.url&&i.scope===item.scope);
    if(item.aliases){const alias=item.aliases;const records=catalog.filter(r=>r.seriesId===alias.catalogSeriesId);const found=records.flatMap(record=>record.sources.filter(s=>s.id===alias.catalogSourceId&&s.url===item.url&&s.scope===alias.catalogScope&&s.scope===item.scope&&s.authority===alias.authority).map(s=>({record,source:s})));
      const editions=new Set(found.map(f=>f.record.identity?.editionId??f.record.edition));
      if(found.length&&editions.size===1&&["organizer","official_host","university_local"].includes(found[0].source.authority))binding=identity.parse({sourceId:item.sourceId,seriesId:item.seriesId,scope:item.scope,url:item.url,authority:found[0].source.authority,editionId:[...editions][0],historical:found[0].record.facts.filter(f=>f.sourceIds.includes(found[0].source.id)).every(f=>f.status!=="verified_current")});
      else {blocked.push({sourceId:item.sourceId,reason:"exact_catalog_alias_missing_or_ambiguous"});continue;}
    }
    if(!binding){blocked.push({sourceId:item.sourceId,reason:"explicit_frozen_authority_identity_required"});continue;}
    const stem=canonicalHash(item.sourceId),rawFile=`bytes/${stem}.source`,bodyFile=`bytes/${stem}.body.txt`;
    copyVerified(options.sourceRoot,item.sourceArtifact,item.sourceByteSha256,path.join(options.outputRoot,rawFile));copyVerified(options.sourceRoot,item.bodyArtifact,item.bodySha256,path.join(options.outputRoot,bodyFile));
    identities.push(binding);sources.push({...item,sourceArtifact:rawFile,bodyArtifact:bodyFile,status:"body_available_not_verified",scope:binding.scope,independentReview:false});
  }
  const registry={schemaVersion:"saitu.frozen-source-text.v1",identities,sources,importedFromSha256:options.indexSha256,blocked};
  const output=Buffer.from(JSON.stringify(registry));writeFileSync(path.join(options.outputRoot,"index.json"),output,{flag:"wx",mode:0o600});
  return {location:{root:realpathSync(options.outputRoot),index:"index.json",indexSha256:hash(output)} satisfies EvidenceRegistryLocation,imported:sources.length,blocked};
}
/** Every mutation is scoped to a copied registry; original frozen artifacts are never overwritten. */
export async function withEvaluationSourceMutation<T>(location:EvidenceRegistryLocation,raw:unknown,work:(location:EvidenceRegistryLocation,proof:Record<string,unknown>)=>Promise<T>):Promise<T>{
  const payload=z.object({sourceId:z.string(),registryMutation:z.object({type:z.string(),status:z.string().optional(),scope:z.string().optional(),bodyAvailable:z.boolean().optional(),conflictingVersion:z.object({revision:z.string(),text:z.string(),origin:z.literal("synthetic_fault_injection"),supersedes:z.null()}).optional()}).strict(),restoreAfter:z.literal(true)}).strict().parse(raw);
  const bytes=safeRead(location.root,location.index,5_000_000);if(hash(bytes)!==location.indexSha256)throw new EvaluationNotRun("frozen_registry_hash_mismatch");
  const index=JSON.parse(bytes.toString("utf8")) as {sources:Record<string,unknown>[];identities?:unknown[]};
  const matches=index.sources.filter(s=>s.sourceId===payload.sourceId);if(matches.length!==1)throw new EvaluationNotRun("source_mutation_identity_missing_or_ambiguous");
  const beforeSemantic=canonicalHash({status:matches[0].status,scope:matches[0].scope??null,bodySha256:matches[0].bodySha256??null,conflictingVersions:matches[0].conflictingVersions??[]});
  const directory=mkdtempSync(path.join(path.dirname(location.root),"source-fault-"));
  try{
    mkdirSync(path.join(directory,"bytes"),{mode:0o700});
    for(const [i,row]of index.sources.entries())for(const [field,hashField]of [["sourceArtifact","sourceByteSha256"],["bodyArtifact","bodySha256"]])if(typeof row[field]==="string"&&typeof row[hashField]==="string"){const relative=`bytes/${i}-${field}`;copyVerified(location.root,row[field] as string,row[hashField] as string,path.join(directory,relative));row[field]=relative;}
    const row=matches[0],mutation=payload.registryMutation,originalBodySha256=row.bodySha256;
    if(mutation.status!==undefined)row.status=mutation.status;
    if(mutation.scope!==undefined)row.scope=mutation.scope;
    if(mutation.bodyAvailable===false){delete row.bodyArtifact;delete row.bodySha256;row.status="metadata_only";}
    if(mutation.conflictingVersion){const version=mutation.conflictingVersion,file="bytes/injected-conflict.txt",data=Buffer.from(version.text,"utf8");writeFileSync(path.join(directory,file),data,{flag:"wx",mode:0o600});row.conflictingVersions=[{revision:version.revision,bodyArtifact:file,bodySha256:hash(data),origin:version.origin}];}
    if(beforeSemantic===canonicalHash({status:row.status,scope:row.scope??null,bodySha256:row.bodySha256??null,conflictingVersions:row.conflictingVersions??[]}))throw new EvaluationNotRun("empty_source_registry_mutation");
    const changed=Buffer.from(JSON.stringify(index));if(hash(changed)===hash(bytes))throw new EvaluationNotRun("empty_source_registry_mutation");writeFileSync(path.join(directory,"index.json"),changed,{flag:"wx",mode:0o600});
    const proof={sourceId:payload.sourceId,origin:"synthetic_fault_injection",registryMutation:mutation.type,originalIndexSha256:location.indexSha256,mutatedIndexSha256:hash(changed),originalBodySha256,injectedVersions:row.conflictingVersions??[],scope:row.scope??null,status:row.status,restoreAfter:true};
    return await work({root:directory,index:"index.json",indexSha256:hash(changed)},proof);
  }finally{rmSync(directory,{recursive:true,force:true});}
}
