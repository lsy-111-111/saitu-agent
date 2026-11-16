import "server-only";
import type { DecisionChatRequest } from "./chat-contracts";
import type { DecisionState } from "./decision-state";
import { buildDecisionContext, assertCurrentReportCandidates } from "./engine";
import { makeProposal,type ChatDraft,type ChatOptions } from "./chat";
import { extractProfileFacts } from "./extract-profile";
import { observeProfileConversation } from "./conversation-observations";
import { qualifySourceCondition } from "./source-judgments";
import { conditionJudgmentSchema } from "./source-judgment-contracts";
import type { DomainFact } from "./domain-facts";
import type { ProfileMutation } from "./profile-contracts";
type EvidenceAction=Extract<DecisionChatRequest["action"],{type:"qualify_condition"|"extract_profile"|"review_conversation"}>;
/** Called by the authenticated chat route; no client-supplied trusted source body or canonical profile. */
export async function draftEvidenceAction(state:DecisionState,action:EvidenceAction,options:ChatOptions={}):Promise<ChatDraft>{
  const profile=state.report.profile;
  if(action.type==="qualify_condition"){
    if(!state.report.recommendations.some(item=>item.itemId===action.itemId))throw new Error("unknown_decision_item");
    const context=buildDecisionContext(state.legacy,{profile});
    assertCurrentReportCandidates(context,state.report);
    const record=context.candidates.find(c=>c.record.recordId===action.itemId)?.record;
    if(!record)throw new Error("unknown_decision_record");
    const result=await qualifySourceCondition({seriesId:record.seriesId,editionScope:record.scope,evidenceIds:record.sources.map(source=>source.id),target:action.target,question:action.question,facts:profile.facts.filter(f=>!profile.retractedFactIds.includes(f.id)).map(({field,value,state,confirmed})=>({field,value,state,confirmed}))},options);
    const rest=result;
    const conditionJudgment=conditionJudgmentSchema.parse({decision:rest.decision,scope:rest.scope,targetKind:rest.targetKind,reason:rest.reason,citations:rest.citations,evidence:rest.evidence});
    return {kind:"answer",message:"以下只核对你指定的一个条件，不能代替完整报名资格判断。",claims:[],conditionJudgment,modelFallback:result.fallback};
  }
  if(action.type==="review_conversation"){
    const initialFacts:DomainFact[]=profile.facts.filter(f=>!profile.retractedFactIds.includes(f.id)).map(f=>({field:f.field,value:f.value,state:f.state,evidenceLevel:f.evidenceLevel==="concrete_experience"?"concrete_experience":f.evidenceLevel==="unknown"?"unknown":"self_report",confirmed:f.confirmed,sourceText:f.originalText??f.label}));
    const result=await observeProfileConversation({initialFacts,turns:action.turns,requestedFields:action.requestedFields,checkpoints:action.turns.map(t=>({afterTurn:t.id}))},options);
    return {kind:"answer",message:result.fallback?"本次逐轮核对没有完成，当前画像保持原样。":"已逐轮整理这些补充与更正；它们尚未写入已确认画像。请把要采用的更正发送给助手并确认。",claims:[],conversationStates:result.states,modelFallback:result.fallback};
  }
  const result=await extractProfileFacts({utterance:action.utterance,requestedFields:action.requestedFields,context:profile.facts.map(({field,value,state,confirmed})=>({field,value,state,confirmed}))},options);
  const base:ChatDraft={kind:"answer",message:"已整理原话中的信息；尚未确认的内容不会改变推荐。",claims:[],extractedFacts:result.facts,modelFallback:result.fallback};
  if(result.fallback||!result.facts.length)return {...base,message:"这段话还不足以形成可追溯的更正，请补充具体条件。"};
  // Ambiguous multi-value fields are shown losslessly for clarification, never silently collapsed.
  if(result.facts.length>12||new Set(result.facts.map(f=>f.field)).size!==result.facts.length)return {...base,message:"这些信息包含同一字段的多个说法，请分别说明要保留哪项，再确认更正。"};
  const mutations:ProfileMutation[]=result.facts.flatMap<ProfileMutation>(f=>{const ids=profile.facts.filter(old=>old.field===f.field).map(old=>old.id);if(f.state==="retracted")return ids.length?[{operation:"retract",field:f.field,targetFactIds:ids,quote:f.sourceText}]:[];return [{operation:"set",field:f.field,value:f.value,state:f.state,targetFactIds:ids,quote:f.sourceText}];});
  if(!mutations.length)return base;
  try{return {...base,kind:"update_proposal",message:"请核对提取的内容，确认后才会更新画像并重新匹配。",proposal:makeProposal(state,action.utterance,mutations)};}catch{return {...base,message:"提取内容与当前字段条件不一致，请补充具体更正。"};}
}
