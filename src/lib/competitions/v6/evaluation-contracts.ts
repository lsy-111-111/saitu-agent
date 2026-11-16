import { createHash } from "node:crypto";
import { z } from "zod";
export const EVALUATION_ADAPTER_VERSION="saitu-product-adapter.v2.20261105";
export const evaluationOperations=["qualify","fact_check","recommend","extract_profile","conversation","robustness"] as const;
export type EvaluationOperation=typeof evaluationOperations[number];
export type EvaluationEvent={seq:number;time:string;type:string;requestId:string;origin:"injected"|"product"|"transport";details:Record<string,unknown>};
export const invocationSchema=z.object({caseId:z.string().min(1).max(180),inputSha256:z.string().regex(/^[a-f0-9]{64}$/),operation:z.enum(evaluationOperations),input:z.unknown(),sourcePackets:z.array(z.unknown()).optional(),requestContext:z.record(z.unknown()).optional()}).strict();
export type EvaluationInvocation=z.infer<typeof invocationSchema>;
export function canonicalJson(value:unknown):string{
  const normalize=(v:unknown):unknown=>{if(v===null||typeof v==="string"||typeof v==="boolean")return v;if(typeof v==="number"&&Number.isFinite(v))return v;if(Array.isArray(v))return v.map(normalize);if(v&&typeof v==="object"&&Object.getPrototypeOf(v)===Object.prototype){const out:Record<string,unknown>=Object.create(null);for(const key of Object.keys(v).sort())out[key]=normalize((v as Record<string,unknown>)[key]);return out;}throw new Error("non_json_input");};
  return JSON.stringify(normalize(value));
}
export function canonicalHash(value:unknown){return createHash("sha256").update(canonicalJson(value),"utf8").digest("hex");}
export const byteHash=(text:string)=>createHash("sha256").update(text,"utf8").digest("hex");
export type EvaluationObservation={caseId:string;inputSha256:string;operation:EvaluationOperation;adapterVersion:string;status:"observed"|"not_run"|"error";output:unknown;error:string|null;fallback:boolean;elapsedMs:number;events:EvaluationEvent[];usage:unknown[]|null;productBinding:unknown|null;capabilities:string[]};
export class EvaluationNotRun extends Error {constructor(message:string,public partialOutput?:unknown){super(message);}}
