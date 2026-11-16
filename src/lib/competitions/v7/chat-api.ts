import "server-only";
import { competitionAiJson } from "@/lib/ai/competition-api";
import { getConfiguredAiProvider } from "@/lib/ai/ai-client";
import { withDurableAiChat } from "@/lib/ai/durable-call";
import { isActiveDecisionReleaseV7 } from "./active-release";
import { readSubmissionTimingV7, submissionModelDeadlineV7 } from "./submission-timing";
import { withDecisionEffortPolicy } from "@/lib/ai/effort-context";
import { readFrozenRunEffortPolicyV7 } from "./store";
import { recordAiConsent } from "@/lib/ai/consent";
import { competitionTransitionId,executeCompetitionSessionTransition } from "@/lib/security/rate-limit";
import type { DecisionChatRequest } from "../v6/chat-contracts";
import { projectProfileToLegacy } from "../v6/profile";
import { draftDecisionChatV7 } from "./chat";
import { buildDecisionContextV7 } from "./model";
import { applyProfileMutationsV7 } from "./profile";
import { recommendationChatReplySchema } from "./contracts";
import { createDecisionTokenV7, type DecisionTokenV7 } from "./crypto";
import { appendChatAuditV7,beginChatRequestV7,finishChatRequestV7,enqueueRunV7,findSubmittedRunV7,presentRunV7,readRunV7,readSessionV7,restoreContextV7,submissionKeyV7 } from "./store";

export async function chatV7(request:Request,requestId:string,input:DecisionChatRequest,token:DecisionTokenV7) {
  const timing = readSubmissionTimingV7(request);
  return executeCompetitionSessionTransition({request,requestId,operation:"competition_chat",sessionId:token.sessionId,
    sessionExpiresAtEpochSeconds:Math.floor(token.expiresAt/1000),transitionId:competitionTransitionId("competition_chat_v7",input),producer:async producer=>{
      try{
        const session=await readSessionV7(token,{allowStale:true});if(!session)return competitionAiJson({ok:false,error:"DECISION_SESSION_EXPIRED"},{status:401});
        const key=submissionKeyV7(session.sessionId,{requestId:input.requestId,action:input.action,baseRevision:input.expectedRevision});
        const replay=await findSubmittedRunV7(key,session);
        if(replay)return competitionAiJson(recommendationChatReplySchema.parse({responseVersion:"competition-decision-chat.v7",requestId:input.requestId,message:"已采用这次更正，正在显示本次匹配进度。",profileRevision:session.profile.revision,decisionToken:createDecisionTokenV7(session),run:presentRunV7(replay,session),claims:[]}));
        if(session.generation!==token.generation||session.profile.revision!==input.expectedRevision||input.expectedProfileId&&input.expectedProfileId!==session.profile.profileId)return competitionAiJson({ok:false,error:"DECISION_REVISION_CHANGED"},{status:409});
        const run=await readRunV7(session.currentRunId);if(!run)return competitionAiJson({ok:false,error:"DECISION_RUN_NOT_FOUND"},{status:404});
        if(input.expectedCatalogVersion&&input.expectedCatalogVersion!==run.body.context.catalogVersion)return competitionAiJson({ok:false,error:"DECISION_CATALOG_CHANGED"},{status:409});
        const snapshot=await beginChatRequestV7(session,run,input.requestId,input);
        if(snapshot.reply)return competitionAiJson(snapshot.reply);
        const modelDeadline=submissionModelDeadlineV7(request,producer.deadlines.aiDeadlineEpochMs,"chat");
        const action=input.action;let text="",draft:Awaited<ReturnType<typeof draftDecisionChatV7>>;
        if(action.type==="message"||action.type==="extract_profile"){
          text=action.type==="message"?action.text:action.utterance;
          draft=await withDecisionEffortPolicy(readFrozenRunEffortPolicyV7(run.body),()=>withDurableAiChat(run.row.run_id,session.generation,input.requestId,()=>draftDecisionChatV7({profile:session.profile,legacy:session.legacy,report:snapshot.report,history:snapshot.history,context:restoreContextV7(run.body)},text,action.type==="message"?action.selectedItemIds??[]:[],{
            answerId:input.requestId,requestId:input.requestId,at:snapshot.at,
            onObservation:async event=>{if(event.stage==="v7.audit")await appendChatAuditV7(session,input.requestId,event);},
            signal:producer.signal,deadlineEpochMs:modelDeadline,
            onUpstreamAttempt:async model=>recordAiConsent(request,"competition_recommend",{provider:getConfiguredAiProvider(),model},{signal:producer.signal,deadlineEpochMs:producer.deadlines.producerDeadlineEpochMs})}),isActiveDecisionReleaseV7,run.body.executionPolicy?{recommendationPolicyVersion:run.body.executionPolicy.policyVersion,implementationVersion:run.row.implementation_version}:undefined,{executionMode:run.body.executionMode??"finite",authorizationRunId:run.body.executionAuthorization?.runId}));
        }else if(action.type==="answer_question"){
          const question=snapshot.report?.usefulQuestions?.find(question=>question.id===action.questionId),option=question?.options.find(option=>option.value===action.value);
          if(!question||!option)return competitionAiJson({ok:false,error:"INVALID_DECISION_QUESTION"},{status:400});
          text=`${question.prompt} ${option.label}`;
          const profile=applyProfileMutationsV7(session.profile,[{operation:"set",field:question.field,value:option.value,quote:text,targetFactIds:session.profile.facts.filter(fact=>fact.field===question.field).map(fact=>fact.id)}],{answerId:input.requestId,text,at:snapshot.at},session.legacy);
          draft={message:"已采用这个回答，正在重新匹配。",claims:[],profile};
        }else if(action.type==="skip_question"){
          draft={message:"已跳过这道问题，保留你已提交的其他信息。",claims:[]};
        }else{
          draft={message:"参赛资格和开赛时间请自行核查官网。修改自己的输入时，直接说明要改的内容即可。",claims:[]};
        }
        if(producer.signal.aborted)throw new Error("DECISION_TIMEOUT");
        if(draft.profile&&draft.profile.revision!==session.profile.revision){
          const legacy=projectProfileToLegacy(draft.profile,session.legacy,{openDomain:true}),context=buildDecisionContextV7(legacy,{profile:draft.profile});
          const queued=await enqueueRunV7({sessionId:session.sessionId,expiresAt:session.expiresAt,legacy,context,submissionKey:key,previous:token,expectedRevision:input.expectedRevision,submittedAtEpochMs:timing.submittedAtEpochMs,
            history:[{role:"user",text},{role:"assistant",text:draft.message}]});
          return competitionAiJson(recommendationChatReplySchema.parse({responseVersion:"competition-decision-chat.v7",requestId:input.requestId,message:draft.message,claims:draft.claims,profileRevision:queued.session.profile.revision,decisionToken:createDecisionTokenV7(queued.session),run:presentRunV7(queued.run,queued.session)}));
        }
        const reply=recommendationChatReplySchema.parse({responseVersion:"competition-decision-chat.v7",requestId:input.requestId,message:draft.message,claims:draft.claims,comparison:draft.comparison,profileRevision:session.profile.revision,decisionToken:createDecisionTokenV7(session)});
        return competitionAiJson(await finishChatRequestV7(session,input.requestId,reply,[...(text?[{role:"user" as const,text}]:[]),{role:"assistant",text:draft.message}]));
      }catch(error){
        if(error instanceof Error&&error.message==="DECISION_TIMEOUT")return competitionAiJson({ok:false,error:"DECISION_TIMEOUT"},{status:503});
        const changed=error instanceof Error&&["DECISION_REVISION_CHANGED","DECISION_REQUEST_CHANGED"].includes(error.message);
        return competitionAiJson({ok:false,error:changed?error.message:"DECISION_STATE_UNAVAILABLE"},{status:changed?409:503});
      }
    }});
}
