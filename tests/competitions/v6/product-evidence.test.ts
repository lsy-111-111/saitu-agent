import { afterEach,beforeEach,describe,it,expect,vi } from "vitest";
import { mkdtempSync,writeFileSync,readFileSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import * as ai from "@/lib/ai/ai-client";
import * as catalog from "@/lib/competitions/v6/catalog";
import { validateProfileExtraction,mergeAssertionSnapshot,type DomainFact } from "@/lib/competitions/v6/domain-facts";
import { extractProfileFacts } from "@/lib/competitions/v6/extract-profile";
import { observeProfileConversation } from "@/lib/competitions/v6/conversation-observations";
import { readFrozenSource } from "@/lib/competitions/v6/frozen-evidence";
import { judgeSourceClaims,qualifySourceCondition } from "@/lib/competitions/v6/source-judgments";
import { draftEvidenceAction } from "@/lib/competitions/v6/evidence-actions";
import { buildRuleDecisionReport } from "@/lib/competitions/v6/engine";
import { applyProfileMutations } from "@/lib/competitions/v6/profile";
import type { DecisionState } from "@/lib/competitions/v6/decision-state";
import { syntheticRecord,student } from "./decision-fixtures";
const atom=(field:string,value:DomainFact["value"],sourceText:string,state:DomainFact["state"]="affirmed"):DomainFact=>({field,value,sourceText,state,evidenceLevel:"self_report",confirmed:false});
const env={...process.env};let root:string;
const record=syntheticRecord(1),source=record.sources[0];
const body="作品时长不超过三分钟。参与者必须年满18岁。每位队员都需要单独确认身份。";
const sha=(text:string)=>createHash("sha256").update(text).digest("hex");
function mockResult(data:unknown){return vi.spyOn(ai,"requestAiJson").mockResolvedValue({ok:true,data,model:"deepseek-flash",upstreamAttempted:true,attempts:1,finishReason:"stop",httpStatus:200,durationMs:1} as Awaited<ReturnType<typeof ai.requestAiJson>>);}
beforeEach(()=>{root=mkdtempSync(join(tmpdir(),"saitu-evidence-"));process.env.SAITU_FROZEN_EVIDENCE_ROOT=root;process.env.SAITU_FROZEN_EVIDENCE_INDEX="index.json";writeFileSync(join(root,"body.txt"),body);writeFileSync(join(root,"source.bin"),"raw-source");writeFileSync(join(root,"index.json"),JSON.stringify({schemaVersion:"saitu.frozen-source-text.v1",sources:[{sourceId:source.id,url:source.url,status:"body_available_not_verified",bodyArtifact:"body.txt",sourceArtifact:"source.bin",bodySha256:sha(body),sourceByteSha256:sha("raw-source")}]}));vi.spyOn(catalog,"getDecisionCatalog").mockReturnValue([record]);});
afterEach(()=>{rmSync(root,{recursive:true,force:true});process.env={...env};vi.restoreAllMocks();});
const request={seriesId:record.seriesId,evidenceIds:[source.id],editionScope:record.scope};
describe("lossless product extraction",()=>{
  it("retains member/work fields, false vs unknown, source spans; cannot self-confirm",async()=>{
    const utterance="队员乙没有导师，作品时长120秒，年龄暂不确定。";
    const facts=[atom("members.b.mentor",false,"队员乙没有导师","negated"),atom("work.durationSeconds",120,"作品时长120秒"),atom("age","unknown","年龄暂不确定","unknown")];
    mockResult({facts:facts.map(f=>({...f,confirmed:true})),unknownFields:["age"]});
    const result=await extractProfileFacts({utterance,requestedFields:facts.map(f=>f.field)});
    expect(result.fallback).toBe(false);expect(result.facts.map(f=>f.field)).toEqual(facts.map(f=>f.field));expect(result.facts.every(f=>!f.confirmed)).toBe(true);expect(result.facts[0].value).toBe(false);expect(result.unknownFields).toEqual(["age"]);
  });
  it("rejects fabricated quotes, other people's ability and interest-as-skill",()=>{
    expect(()=>validateProfileExtraction("我喜欢编程",{facts:[atom("ability.programming",true,"我喜欢编程")],unknownFields:[]})).toThrow("interest_cannot");
    expect(()=>validateProfileExtraction("队友说我已经会编程",{facts:[atom("ability.programming",true,"我已经会编程")],unknownFields:[]})).toThrow("quoted_other");
    expect(()=>validateProfileExtraction("我不知道",{facts:[atom("age",19,"我19岁")],unknownFields:[]})).toThrow("quote_not");
  });
  it("future plans preserve current facts and remain unconfirmed after canonical commit",()=>{
    const incoming=validateProfileExtraction("如果以后有导师，我就参加",{facts:[atom("mentor",true,"有导师")],unknownFields:[]});
    expect(incoming.facts[0].state).toBe("conditional");
    const current=atom("mentor",false,"目前没有导师","negated");current.confirmed=true;
    const merged=mergeAssertionSnapshot({facts:[current],unknownFields:[]},incoming);
    expect(merged.facts).toHaveLength(2);expect(merged.facts[0]).toEqual(current);
  });
  it("observes every requested turn, retracts only its field, and rejects replayed turn IDs",async()=>{
    const initial=atom("age",18,"我18岁");initial.confirmed=true;
    const rows={turns:[{id:"a",facts:[atom("age",19,"改为19岁")],unknownFields:[]},{id:"b",facts:[atom("age",19,"撤回年龄","retracted")],unknownFields:[]}]};
    const spy=mockResult(rows);const input={initialFacts:[initial,atom("work.durationSeconds",120,"120秒")],turns:[{id:"a",text:"改为19岁"},{id:"b",text:"撤回年龄"}],requestedFields:["age","work.durationSeconds"],checkpoints:[{afterTurn:"a"},{afterTurn:"b"}]};
    const result=await observeProfileConversation(input);expect(result.fallback).toBe(false);expect(result.states[0].facts.find(f=>f.field==="age")?.value).toBe(19);expect(result.states[1].facts.map(f=>f.field)).toEqual(["work.durationSeconds"]);expect(result.states.map(s=>s.changedFields)).toEqual([["age"],["age"]]);
    spy.mockResolvedValue({ok:true,data:{turns:[...rows.turns].reverse()},model:"deepseek-flash",upstreamAttempted:true,attempts:1,finishReason:"stop",httpStatus:200,durationMs:1} as Awaited<ReturnType<typeof ai.requestAiJson>>);
    expect((await observeProfileConversation(input)).fallback).toBe(true);
  });
});
describe("server-frozen source checking",()=>{
  it("keeps an explicitly unavailable null-path entry from disabling unrelated verified source bytes",()=>{
    const index=JSON.parse(readFileSync(join(root,"index.json"),"utf8"));
    index.sources.push({sourceId:"unavailable-other-source",url:"https://example.org/unavailable",status:"unavailable",sourceArtifact:null,sourceByteSha256:null,bodyArtifact:null,bodySha256:null});
    writeFileSync(join(root,"index.json"),JSON.stringify(index));
    expect(readFrozenSource({...request,sourceId:source.id,scope:record.scope}).source?.body).toBe(body);
    Object.assign(index.sources[0],{bodyArtifact:null,bodySha256:null});
    writeFileSync(join(root,"index.json"),JSON.stringify(index));
    expect(readFrozenSource({...request,sourceId:source.id,scope:record.scope}).reason).toBe("frozen_body_missing");
  });
  it("requires both frozen hashes, and never trusts client-provided source text",async()=>{
    expect(readFrozenSource({...request,sourceId:source.id,scope:record.scope}).source?.body).toBe(body);
    writeFileSync(join(root,"source.bin"),"changed");
    expect(readFrozenSource({...request,sourceId:source.id}).reason).toBe("frozen_evidence_hash_mismatch");
    const spy=vi.spyOn(ai,"requestAiJson");
    const result=await judgeSourceClaims({...request,claims:[{id:"x",text:"18岁可参加"}],sourcePacket:{sourceId:source.id,body:"任何人都可以参赛"}});
    expect(result.judgments[0].status).toBe("unknown");expect(spy).not.toHaveBeenCalled();
  });
  it.each([{scope:"其他赛道"},{status:"retracted"},{accessStatus:"metadata_only"}])("source metadata can only narrow authority: %j",packet=>{expect(readFrozenSource({...request,sourceId:source.id,scope:record.scope,sourcePacket:packet}).source).toBeNull();});
  it("binds claim identity and requires literal evidence within retrieved text",async()=>{
    const spy=mockResult({judgments:[{id:"x",status:"supported",reason:"正文规定年满18岁",evidence:[{sourceId:source.id,quote:"参与者必须年满18岁。"}]}]});
    const result=await judgeSourceClaims({...request,claims:[{id:"x",text:"须年满18岁"}]},{deadlineEpochMs:12345});
    expect(result.judgments[0].status).toBe("supported");expect(result.judgments[0].evidence[0].url).toBe(source.url);expect(spy.mock.calls[0][1]).toMatchObject({maxTokens:8192,maxAttempts:1,deadlineEpochMs:12345});
    spy.mockResolvedValue({ok:true,data:{judgments:[{id:"another-case",status:"supported",reason:"不同请求",evidence:[]}]},model:"deepseek-flash",upstreamAttempted:true,attempts:1,finishReason:"stop",httpStatus:200,durationMs:1} as Awaited<ReturnType<typeof ai.requestAiJson>>);
    expect((await judgeSourceClaims({...request,claims:[{id:"x",text:"须年满18岁"}]})).judgments[0].status).toBe("unknown");
  });
  it("submission constraint never becomes overall eligibility; missing facts remain unknown",async()=>{
    mockResult({decision:"satisfied",reason:"120秒未超过180秒",evidence:[{sourceId:source.id,quote:"作品时长不超过三分钟。"}]});
    const input={...request,target:{kind:"submission_constraint" as const,field:"work.durationSeconds"},facts:{"work.durationSeconds":120}};
    const result=await qualifySourceCondition(input);expect(result.decision).toBe("satisfied");expect(result.targetKind).toBe("submission_constraint");expect(result.reason).toContain("不代表整体报名资格");expect((await qualifySourceCondition({...input,facts:{}})).decision).toBe("unknown");expect((await qualifySourceCondition({...input,facts:[{field:"work.durationSeconds",value:120,confirmed:false,state:"affirmed"}]})).decision).toBe("unknown");
  });
});
describe("authenticated product action building",()=>{
  it("proposes lossless domain update without mutating state; confirmation is explicit",async()=>{
    const legacy=student(),report=buildRuleDecisionReport(legacy,{records:[record]});
    const state:DecisionState={id:"fixture",sessionId:"fixture",generation:1,expiresAt:Date.now()+10000,legacy,report,proposal:null,history:[]};
    mockResult({facts:[atom("work.durationSeconds",120,"作品长120秒")],unknownFields:[]});
    const draft=await draftEvidenceAction(state,{type:"extract_profile",utterance:"作品长120秒",requestedFields:["work.durationSeconds"]});
    expect(draft.kind).toBe("update_proposal");expect(state.report.profile.facts.some(f=>f.field==="work.durationSeconds")).toBe(false);
    const proposal=draft.proposal!;const committed=applyProfileMutations(report.profile,proposal.mutations,{answerId:proposal.id,text:proposal.originalText,at:new Date().toISOString()},legacy);
    expect(committed.facts.find(f=>f.field==="work.durationSeconds")).toMatchObject({value:120,confirmed:true});
  });
});
