import { canonicalHash,byteHash,EvaluationNotRun } from "./evaluation-contracts";
/** RFC6901 transformations are preconditioned, business-text-only and never interpret expected answers. */
export function applyEvaluationTextTransform(input:unknown,payload:unknown){
  const data=payload as {targets?:{pointer:string;before:string;after:string}[];utf8BytesBefore?:number;utf8BytesAfter?:number};
  if(!Array.isArray(data.targets)||!data.targets.length||data.targets.length>40)throw new EvaluationNotRun("missing_nonempty_text_targets");
  const transformed=structuredClone(input),proof:{pointer:string;beforeSha256:string;afterSha256:string;utf8BytesBefore:number;utf8BytesAfter:number}[]=[];
  const seen=new Set<string>();
  for(const target of data.targets){
    if(!target||typeof target.pointer!=="string"||!target.pointer.startsWith("/")||typeof target.before!=="string"||typeof target.after!=="string"||target.before===target.after||seen.has(target.pointer))throw new EvaluationNotRun("invalid_text_mutation_precondition");seen.add(target.pointer);
    if(/~(?![01])/u.test(target.pointer))throw new EvaluationNotRun("invalid_json_pointer_escape");
    const parts=target.pointer.slice(1).split("/").map(p=>p.replace(/~1/g,"/").replace(/~0/g,"~"));
    if(parts.some(p=>/^(?:__proto__|prototype|constructor|caseId|profileId|revision|requestId|schemaVersion|familyId|templateFamilyId|sourceId|sourceIds|evidenceIds|sourceEvidenceIds|seriesId|id|catalogVersion|idempotencyKey|.*Sha256)$/i.test(p)))throw new EvaluationNotRun("text_mutation_cannot_change_identity_or_hash");
    let parent=transformed as Record<string,unknown>;
    for(const part of parts.slice(0,-1)){if(!parent||typeof parent!=="object"||!Object.hasOwn(parent,part))throw new EvaluationNotRun("text_pointer_missing");parent=parent[part] as Record<string,unknown>;}
    const last=parts.at(-1)!;
    if(!parent||typeof parent!=="object"||!Object.hasOwn(parent,last)||parent[last]!==target.before)throw new EvaluationNotRun("text_before_mismatch");
    parent[last]=target.after;proof.push({pointer:target.pointer,beforeSha256:byteHash(target.before),afterSha256:byteHash(target.after),utf8BytesBefore:Buffer.byteLength(target.before),utf8BytesAfter:Buffer.byteLength(target.after)});
  }
  if(data.utf8BytesBefore!==proof.reduce((sum,p)=>sum+p.utf8BytesBefore,0)||data.utf8BytesAfter!==proof.reduce((sum,p)=>sum+p.utf8BytesAfter,0))throw new EvaluationNotRun("declared_utf8_bytes_mismatch");
  if(canonicalHash(input)===canonicalHash(transformed))throw new EvaluationNotRun("empty_text_mutation");
  return {transformed,mutationProof:{originalInputSha256:canonicalHash(input),transformedInputSha256:canonicalHash(transformed),targets:proof}};
}
