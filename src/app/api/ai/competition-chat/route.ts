import {currentDecisionCatalogVersion} from "@/lib/competitions/v6/catalog-binding";
import { emitProductObservation, withRecommendationAccountingTrace } from "@/lib/ai/product-observation";
import { createHash } from "node:crypto";
import { containsCompetitionNotePersonalInfo } from "@/lib/ai/competition-note";
import { hasValidAiConsent, aiConsentRequiredResponse, recordAiConsent } from "@/lib/ai/consent";
import { getConfiguredAiProvider } from "@/lib/ai/ai-client";
import { competitionAiJson, readCompetitionAiJson, COMPETITION_AI_MAX_REQUEST_BYTES, competitionAiRequestErrorResponse } from "@/lib/ai/competition-api";
import { capDecisionRequestDeadlines, createCompetitionRequestDeadlines } from "@/lib/ai/request-deadline";
import { isCompetitionRecommenderEnabled } from "@/lib/config/features";
import { competitionTransitionId, executeCompetitionSessionTransition, getRequestId, rejectLargeRequest, withRequestId } from "@/lib/security/rate-limit";
import { decisionChatRequestSchema, decisionChatReplySchema, type DecisionChatReply } from "@/lib/competitions/v6/chat-contracts";
import { createDecisionToken, verifyDecisionToken, readDecisionState, compareAndSwapDecisionState } from "@/lib/competitions/v6/decision-state";
import { draftDecisionChat, makeProposal, type ChatDraft } from "@/lib/competitions/v6/chat";
import { applyProfileMutations, projectProfileToLegacy } from "@/lib/competitions/v6/profile";
import { buildDecisionContext, selectUsefulQuestions, assertCurrentReportCandidates } from "@/lib/competitions/v6/engine";
import { draftEvidenceAction } from "@/lib/competitions/v6/evidence-actions";
import { runDecisionRecommendation } from "@/lib/competitions/v6/model";
import { verifyDecisionTokenV7 } from "@/lib/competitions/v7/crypto";
import { chatV7 } from "@/lib/competitions/v7/chat-api";
import { readSubmissionTimingV7 } from "@/lib/competitions/v7/submission-timing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try { readSubmissionTimingV7(request); }
  catch { return withRequestId(competitionAiJson({ok:false,error:"DECISION_TIMING_INVALID"},{status:400}),requestId); }
  return withRecommendationAccountingTrace(requestId,()=>chat(request,requestId));
}
async function chat(request:Request,requestId:string) {
  const respond = (response: Response) => withRequestId(response, requestId);
  if (!isCompetitionRecommenderEnabled()) return respond(competitionAiJson({ok:false,error:"COMPETITION_RECOMMENDER_DISABLED"},{status:503}));
  const oversized = rejectLargeRequest(request,COMPETITION_AI_MAX_REQUEST_BYTES); if(oversized)return respond(oversized);
  const raw = await readCompetitionAiJson(request); if(!raw.ok)return respond(competitionAiRequestErrorResponse(raw.error));
  if(!hasValidAiConsent(raw.value))return respond(aiConsentRequiredResponse());
  const parsed = decisionChatRequestSchema.safeParse(raw.value);
  if(!parsed.success)return respond(competitionAiJson({ok:false,error:"INVALID_INPUT"},{status:400}));
  const input = parsed.data, token = verifyDecisionToken(input.decisionToken);
  const freeText=input.action.type === "message" ? input.action.text : input.action.type === "extract_profile" ? input.action.utterance : input.action.type === "review_conversation" ? input.action.turns.map(t=>t.text).join("\n") : input.action.type === "qualify_condition" ? input.action.question : "";
  if(containsCompetitionNotePersonalInfo(freeText)) return respond(competitionAiJson({ok:false,error:"PERSONAL_INFORMATION_NOT_NEEDED",message:"请删去个人标识后再描述任务或条件。"},{status:400}));
  const v7Token=verifyDecisionTokenV7(input.decisionToken);
  if(v7Token)return chatV7(request,requestId,input,v7Token);
  const requestHash = createHash("sha256").update(JSON.stringify({action:input.action,revision:input.expectedRevision,profileId:input.expectedProfileId,catalogVersion:input.expectedCatalogVersion})).digest("hex");
  if(!token)return respond(competitionAiJson({ok:false,error:"DECISION_SESSION_EXPIRED"},{status:401}));
  // Run before the idempotency cache: a response from a retired catalog is not replayed.
  try {const saved=await readDecisionState(token.id);if(!saved||saved.sessionId!==token.sessionId)return respond(competitionAiJson({ok:false,error:"DECISION_SESSION_EXPIRED"},{status:401}));const current=currentDecisionCatalogVersion();emitProductObservation("catalog_binding_checked",{storedCatalogVersion:saved.report.catalogVersion,currentCatalogVersion:current});if(saved.report.catalogVersion!==current)return respond(competitionAiJson({ok:false,error:"DECISION_CATALOG_CHANGED",message:"赛事资料已经更新，请重新生成报告，再继续确认更正。"},{status:409}));assertCurrentReportCandidates(buildDecisionContext(saved.legacy,{profile:saved.report.profile}),saved.report);}catch(error){if(error instanceof Error&&error.message==="DECISION_CATALOG_CHANGED")return respond(competitionAiJson({ok:false,error:"DECISION_CATALOG_CHANGED",message:"报告中的赛事资料已更新或不再满足发布与参与条件，请重新生成报告后继续。"},{status:409}));return respond(competitionAiJson({ok:false,error:"DECISION_CATALOG_UNAVAILABLE"},{status:503}));}
  const deadlines = capDecisionRequestDeadlines(createCompetitionRequestDeadlines());
  return executeCompetitionSessionTransition({request,requestId,operation:"competition_chat",sessionId:token.sessionId,
    sessionExpiresAtEpochSeconds:Math.floor(token.expiresAt/1000),deadlines,
    transitionId:competitionTransitionId("competition_chat",input),
    producer:async producer => {
      try {
        const state = await readDecisionState(token.id);
        if(!state || state.sessionId!==token.sessionId)return competitionAiJson({ok:false,error:"DECISION_SESSION_EXPIRED"},{status:401});
        if(input.expectedProfileId&&input.expectedProfileId!==state.report.profile.profileId)return competitionAiJson({ok:false,error:"DECISION_PROFILE_CHANGED"},{status:409});
        if(input.expectedCatalogVersion&&input.expectedCatalogVersion!==state.report.catalogVersion)return competitionAiJson({ok:false,error:"DECISION_CATALOG_CHANGED"},{status:409});
        emitProductObservation("chat_request_validated",{requestId:input.requestId,profileId:state.report.profile.profileId,profileRevision:state.report.profile.revision,catalogVersion:state.report.catalogVersion,generation:state.generation,action:input.action.type});
        // A committed CAS can be replayed even if the enclosing HTTP cache failed to finalize.
        if(state.lastRequestId===input.requestId && state.lastReply) return state.lastRequestHash === requestHash ? competitionAiJson(state.lastReply) : competitionAiJson({ok:false,error:"REQUEST_ID_REUSED"},{status:409});
        if(state.generation!==token.generation || state.report.profile.revision!==input.expectedRevision)return competitionAiJson({ok:false,error:"DECISION_REVISION_CHANGED",message:"这份报告已经更新，请使用最新结果继续。"},{status:409});
        let auditRecorded=false;
        const onUpstreamAttempt=async(model:string)=>{
          if(auditRecorded)return; auditRecorded=true;
          await recordAiConsent(request,"competition_recommend",{provider:getConfiguredAiProvider(),model},{deadlineEpochMs:producer.deadlines.producerDeadlineEpochMs,signal:producer.signal});
        };
        const next={...state,generation:state.generation+1,history:[...state.history],lastQuestionnaireEdit:undefined};
        let draft:ChatDraft;
        if(input.action.type==="skip_question") {
          const action=input.action;
          const question=state.report.usefulQuestions?.find(q=>q.id===action.questionId);
          if(!question)return competitionAiJson({ok:false,error:"INVALID_DECISION_QUESTION"},{status:400});
          const context=buildDecisionContext(state.legacy,{profile:state.report.profile});
          next.questionHistory=[...(state.questionHistory??[]).filter(q=>q.questionId!==question.id),{questionId:question.id,field:question.field,catalogVersion:context.catalogVersion,disposition:action.disposition}].slice(-100);
          context.questionHistory=next.questionHistory;
          next.report={...state.report,usefulQuestions:selectUsefulQuestions(context)};
          next.proposal=null;
          draft={kind:"answer",message:action.disposition==="unknown"?"已记为暂不确定，保留待核条件，不会把它当作符合资格；本轮不再重复追问。":"已跳过，本轮不再重复追问；你仍可随时在对话中补充。",claims:[],report:next.report,modelFallback:false};
        } else if(input.action.type==="answer_question") {
          const answer=input.action;
          const question=state.report.usefulQuestions?.find(item=>item.id===answer.questionId);
          const option=question?.options.find(item=>item.value===answer.value);
          if(!question||!option)return competitionAiJson({ok:false,error:"INVALID_DECISION_QUESTION"},{status:400});
          const originalText=`${question.prompt} ${option.label}`;
          const value=question.field.startsWith("qualification.")||/^eligibility\.(enrolled|fullTime|sameInstitutionTeam|sameCountryTeam|mentor|professionalDeveloper)$/.test(question.field)?option.value==="true":/^eligibility\.(age|year|teamSize)$/.test(question.field)?Number(option.value):option.value;
          const proposal=makeProposal(state,originalText,[{operation:"set",field:question.field,value,targetFactIds:state.report.profile.facts.filter(f=>f.field===question.field).map(f=>f.id),quote:originalText}]);
          next.proposal=proposal;
          draft={kind:"update_proposal",message:"请确认这个回答，确认后才会更新参与条件并重新匹配。",claims:[],proposal,modelFallback:false};
        } else if(input.action.type==="message") {
          draft=await draftDecisionChat(state,input.action.text,input.action.selectedItemIds??[],{signal:producer.signal,deadlineEpochMs:producer.deadlines.aiDeadlineEpochMs,onUpstreamAttempt});
          next.proposal=draft.proposal??null;
          next.historyRevision=state.report.profile.revision;
          next.history=[...(state.historyRevision===state.report.profile.revision?state.history:[]),{role:"user" as const,text:input.action.text},{role:"assistant" as const,text:draft.message}].slice(-12);
        } else if(input.action.type==="qualify_condition"||input.action.type==="extract_profile"||input.action.type==="review_conversation") {
          draft=await draftEvidenceAction(state,input.action,{signal:producer.signal,deadlineEpochMs:producer.deadlines.aiDeadlineEpochMs,onUpstreamAttempt});
          next.proposal=draft.proposal??null;
        } else {
          const proposal=state.proposal;
          if(!proposal || proposal.id!==input.action.proposalId || proposal.baseRevision!==state.report.profile.revision)return competitionAiJson({ok:false,error:"UPDATE_PROPOSAL_EXPIRED"},{status:409});
          next.proposal=null;
          if(input.action.type==="reject_update")draft={kind:"answer",message:"已取消这次更正，仍按原来确认的回答判断。",claims:[],modelFallback:false};
          else {
            const profile=applyProfileMutations(state.report.profile,proposal.mutations,{answerId:proposal.id,text:proposal.originalText,at:new Date().toISOString()},state.legacy);
            next.history=[]; next.historyRevision=profile.revision;
            next.legacy=projectProfileToLegacy(profile,state.legacy);
            const context=buildDecisionContext(next.legacy,{profile,questionHistory:state.questionHistory});
            next.report=await runDecisionRecommendation(next.legacy,{context,signal:producer.signal,deadlineEpochMs:producer.deadlines.aiDeadlineEpochMs,onUpstreamAttempt});
            draft={kind:"report_updated",message:"已按你确认的更正重新计算。下面是新的候选、依据与行动建议，旧报告仅用于对照。",claims:[],report:next.report,modelFallback:next.report.fallback.used};
          }
        }
        if(producer.signal.aborted || Date.now()>=producer.deadlines.producerDeadlineEpochMs)return competitionAiJson({ok:false,error:"DECISION_TIMEOUT"},{status:503});
        const reply:DecisionChatReply=decisionChatReplySchema.parse({...draft,binding:{requestId:input.requestId,profileId:next.report.profile.profileId,baseRevision:input.expectedRevision,profileRevision:next.report.profile.revision,catalogVersion:next.report.catalogVersion},decisionToken:createDecisionToken(next),profileRevision:next.report.profile.revision});
        next.lastRequestId=input.requestId; next.lastRequestHash=requestHash; next.lastReply=reply;
        if(!await compareAndSwapDecisionState(next,state.generation,{signal:producer.signal,expectedCatalogVersion:state.report.catalogVersion}))return competitionAiJson({ok:false,error:"DECISION_REVISION_CHANGED"},{status:409});
        return competitionAiJson(reply);
      } catch (error) {
        if(error instanceof Error&&error.message==="DECISION_CATALOG_CHANGED")return competitionAiJson({ok:false,error:"DECISION_CATALOG_CHANGED",message:"报告中的赛事资料已更新或不再满足发布与参与条件，请重新生成报告后继续。"},{status:409});
        return competitionAiJson({ok:false,error:"DECISION_STATE_UNAVAILABLE",message:"这次对话没有完成，请原地重试；未经确认的更正不会改变画像。"},{status:503});
      }
    },
  });
}
